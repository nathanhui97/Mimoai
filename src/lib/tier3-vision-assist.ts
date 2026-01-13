/**
 * Tier 3 Vision Assist - "Eyes"
 * 
 * Provides visual hints when DOM resolution fails.
 * NEVER bypasses Tier 1 safety checks.
 * 
 * Flow:
 * 1. Tier 1 returns NOT_FOUND
 * 2. Tier 3 analyzes screenshot → returns hint (NOT coordinates)
 * 3. Tier 2 uses hint to refine semantic target
 * 4. Back to Tier 1 with refined target
 * 
 * If coordinates are ever returned, they MUST be validated before clicking.
 */

import { aiConfig } from './ai-config';
import { isFeatureEnabled } from './feature-flags';
import type { SemanticTarget } from './ai-agent';
import { computeAccessibleName } from './accessible-name';

// ============================================================================
// Types
// ============================================================================

/**
 * Vision hint - describes what the AI sees, NOT where to click
 */
export interface VisionHint {
  /** Human-readable description */
  description: string;
  
  /** Refined semantic target (NOT coordinates) */
  refinedTarget: {
    role?: string;
    name?: string;
    text?: string;
    testId?: string;
    id?: string;
    scopeHint?: string;
    nearbyText?: string[];
  };
  
  /** Confidence in the hint */
  confidence: number;
  
  /** Optional: coordinates (must be validated before use) */
  coordinatesIfNeeded?: {
    x: number;
    y: number;
    mustValidate: true; // Always true to force validation
  };
}

/**
 * Result of coordinate validation
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  matchedElement?: Element;
  actualRole?: string;
  actualName?: string;
}

// ============================================================================
// Tier 3 Vision Assist
// ============================================================================

export class VisionAssist {
  /**
   * Get vision hint from screenshot when DOM resolution fails
   * Returns semantic description, NOT coordinates
   * 
   * Uses computer_use endpoint when COMPUTER_USE_MODEL flag is enabled
   * Falls back to vision_hint endpoint otherwise
   */
  static async getHint(
    screenshot: string,
    failedTarget: SemanticTarget,
    domMap: string
  ): Promise<VisionHint> {
    console.log('[Tier3] 🔍 Getting vision hint for failed target:', failedTarget);
    
    const config = aiConfig.getConfig();
    if (!config.enabled) {
      return {
        description: 'Vision assist not available (AI disabled)',
        refinedTarget: failedTarget,
        confidence: 0,
      };
    }
    
    const useComputerUse = isFeatureEnabled('COMPUTER_USE_MODEL');
    
    try {
      // Choose endpoint based on feature flag
      const endpoint = useComputerUse ? 'computer_use' : 'vision_hint';
      const url = `${config.supabaseUrl}/functions/v1/${endpoint}`;
      
      // Build payload based on endpoint
      const payload = useComputerUse ? {
        // Computer Use endpoint format
        mode: 'find_element' as const,
        screenshot,
        target: {
          text: failedTarget.text,
          role: failedTarget.role,
          label: failedTarget.name,
          description: `Find element: ${failedTarget.text || failedTarget.name || failedTarget.role || 'unknown'}`,
        },
        hints: {
          nearbyElements: failedTarget.nearbyText,
        },
        pageContext: {
          title: document.title,
          url: window.location.href,
          viewportSize: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        },
      } : {
        // Legacy vision_hint endpoint format
        screenshot,
        failedTarget,
        domMap,
        mode: 'hint',
      };
      
      // Use AbortController with timeout to avoid hanging on CORS errors
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for Computer Use
      
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.warn(`[Tier3] ${endpoint} fetch failed:`, 
          fetchError instanceof Error ? fetchError.message : 'Unknown error');
        return {
          description: `Vision hint unavailable (${endpoint} not deployed)`,
          refinedTarget: failedTarget,
          confidence: 0,
        };
      }
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error(`[Tier3] ${endpoint} API error:`, response.status);
        return {
          description: 'Vision hint failed',
          refinedTarget: failedTarget,
          confidence: 0,
        };
      }
      
      const result = await response.json();
      
      console.log(`[Tier3] ✅ Vision hint received (${endpoint}):`, 
        useComputerUse ? result.reasoning : result.description);
      
      // Handle Computer Use response format
      if (useComputerUse) {
        return {
          description: result.reasoning || 'No description',
          refinedTarget: failedTarget, // Computer Use returns coordinates, not refined targets
          confidence: result.confidence || 0.5,
          coordinatesIfNeeded: result.coordinates && result.coordinates.x > 0 ? {
            x: result.coordinates.x,
            y: result.coordinates.y,
            mustValidate: true,
          } : undefined,
        };
      }
      
      // Handle legacy vision_hint response
      return {
        description: result.description || 'No description',
        refinedTarget: result.refinedTarget || failedTarget,
        confidence: result.confidence || 0.5,
        coordinatesIfNeeded: result.coordinates ? {
          x: result.coordinates.x,
          y: result.coordinates.y,
          mustValidate: true,
        } : undefined,
      };
    } catch (error) {
      console.warn('[Tier3] Error getting vision hint:', error);
      return {
        description: 'Vision hint error',
        refinedTarget: failedTarget,
        confidence: 0,
      };
    }
  }

  /**
   * Validate coordinates before allowing click
   * CRITICAL: This prevents blind coordinate clicking
   */
  static async validateCoordinates(
    x: number,
    y: number,
    expectedTarget: SemanticTarget
  ): Promise<ValidationResult> {
    console.log(`[Tier3] 🔍 Validating coordinates (${x}, ${y}) for:`, expectedTarget);
    
    try {
      // Get elements at this position
      const elements = document.elementsFromPoint(x, y);
      
      if (elements.length === 0) {
        return {
          valid: false,
          reason: 'No elements at coordinates',
        };
      }
      
      // Check if any element matches expected target
      for (const element of elements) {
        const role = element.getAttribute('role') || 
                    this.getImplicitRole(element);
        
        const name = computeAccessibleName(element) || 
                    element.textContent?.trim() ||
                    '';
        
        // Match by role
        if (expectedTarget.role && role !== expectedTarget.role) {
          continue;
        }
        
        // Match by name (fuzzy)
        if (expectedTarget.name) {
          const nameMatch = name.toLowerCase().includes(expectedTarget.name.toLowerCase()) ||
                           expectedTarget.name.toLowerCase().includes(name.toLowerCase());
          if (!nameMatch) {
            continue;
          }
        }
        
        // Match by text
        if (expectedTarget.text) {
          const textMatch = name.toLowerCase().includes(expectedTarget.text.toLowerCase());
          if (!textMatch) {
            continue;
          }
        }
        
        // Found a match!
        console.log('[Tier3] ✅ Coordinates validated:', { role, name });
        return {
          valid: true,
          matchedElement: element,
          actualRole: role,
          actualName: name,
        };
      }
      
      // No match found
      console.warn('[Tier3] ❌ Validation failed: No element matches expected target');
      return {
        valid: false,
        reason: `No element at coordinates matches expected role="${expectedTarget.role}" name="${expectedTarget.name}"`,
        actualRole: elements[0].getAttribute('role') || this.getImplicitRole(elements[0]),
        actualName: computeAccessibleName(elements[0]) || elements[0].textContent?.trim().substring(0, 50) || '',
      };
    } catch (error) {
      console.error('[Tier3] Validation error:', error);
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Click at coordinates after validation
   * This is the ONLY way Tier 3 can click - and it still validates
   */
  static async clickWithValidation(
    x: number,
    y: number,
    expectedTarget: SemanticTarget
  ): Promise<{ success: boolean; error?: string }> {
    // Step 1: Validate
    const validation = await this.validateCoordinates(x, y, expectedTarget);
    
    if (!validation.valid) {
      return {
        success: false,
        error: `Coordinate validation failed: ${validation.reason}`,
      };
    }
    
    // Step 2: Click the validated element (NOT raw coordinates)
    const element = validation.matchedElement!;
    
    // CRITICAL: Only scroll if element is NOT in shadow DOM and NOT in viewport
    // Elements inside shadow roots should NEVER trigger page scrolls!
    const isInShadowDOM = element.getRootNode() instanceof ShadowRoot;
    const rect = element.getBoundingClientRect();
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
    
    if (!isInShadowDOM && !isInViewport) {
      console.log('[Tier3Vision] Element not in viewport, scrolling into view');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (isInShadowDOM) {
      console.log('[Tier3Vision] ⚠️ Element in shadow DOM - NEVER scroll page (widget already visible)');
    } else {
      console.log('[Tier3Vision] Element already in viewport, skipping scroll');
    }
    
    if (element instanceof HTMLElement) {
      element.focus();
    }
    
    // Reuse rect if already computed, otherwise get fresh one
    const elementRect = element.getBoundingClientRect();
    const centerX = elementRect.left + elementRect.width / 2;
    const centerY = elementRect.top + elementRect.height / 2;
    
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    }));
    
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    }));
    
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    }));
    
    console.log('[Tier3] ✅ Clicked validated element at coordinates');
    
    return { success: true };
  }

  /**
   * Get implicit ARIA role from element
   */
  private static getImplicitRole(element: Element): string {
    const tag = element.tagName.toLowerCase();
    
    const roleMap: Record<string, string> = {
      'button': 'button',
      'a': 'link',
      'input': this.getInputRole(element as HTMLInputElement),
      'textarea': 'textbox',
      'select': 'combobox',
      'img': 'img',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'section': 'region',
      'article': 'article',
      'form': 'form',
      'table': 'table',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'h4': 'heading',
      'h5': 'heading',
      'h6': 'heading',
    };
    
    return roleMap[tag] || '';
  }

  /**
   * Get role for input element based on type
   */
  private static getInputRole(input: HTMLInputElement): string {
    const type = input.type.toLowerCase();
    
    const typeMap: Record<string, string> = {
      'button': 'button',
      'submit': 'button',
      'reset': 'button',
      'checkbox': 'checkbox',
      'radio': 'radio',
      'search': 'searchbox',
      'number': 'spinbutton',
      'range': 'slider',
    };
    
    return typeMap[type] || 'textbox';
  }

  /**
   * Check if vision assist should be used
   * Only use when:
   * 1. DOM resolution failed
   * 2. Screenshot is available
   * 3. Not a simple NOT_FOUND (maybe ambiguous or special case)
   */
  static shouldUseVisionAssist(
    rejectionCode: string,
    hasScreenshot: boolean,
    attemptNumber: number
  ): boolean {
    // Don't use on first attempt - try DOM recovery first
    if (attemptNumber < 2) {
      return false;
    }
    
    // Don't use if no screenshot
    if (!hasScreenshot) {
      return false;
    }
    
    // Use for persistent NOT_FOUND or AMBIGUOUS
    if (rejectionCode === 'NOT_FOUND' || rejectionCode === 'AMBIGUOUS') {
      return true;
    }
    
    return false;
  }

  /**
   * Generate a fallback hint without AI
   * Used when vision API is unavailable
   */
  static generateFallbackHint(
    failedTarget: SemanticTarget,
    domMap: string
  ): VisionHint {
    // Try to suggest nearby text from DOM map
    const lines = domMap.split('\n');
    const targetText = failedTarget.name || failedTarget.text || '';
    
    // Find lines that might contain the target
    const relevantLines = lines.filter(line => 
      line.toLowerCase().includes(targetText.toLowerCase())
    );
    
    if (relevantLines.length > 0) {
      // Extract nearby text from the same section
      const nearbyText: string[] = [];
      for (const line of relevantLines.slice(0, 3)) {
        const match = line.match(/\[([\w]+)\]\s+"([^"]+)"/);
        if (match) {
          nearbyText.push(match[2]);
        }
      }
      
      return {
        description: `Found "${targetText}" in DOM map with nearby elements`,
        refinedTarget: {
          ...failedTarget,
          nearbyText: nearbyText.length > 0 ? nearbyText : undefined,
        },
        confidence: 0.6,
      };
    }
    
    // No hint available
    return {
      description: 'No additional hints available from DOM',
      refinedTarget: failedTarget,
      confidence: 0.3,
    };
  }
}

