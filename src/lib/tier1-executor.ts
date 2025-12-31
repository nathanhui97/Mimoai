/**
 * Tier 1 Executor - Deterministic "Hands + Reflexes"
 * 
 * Responsibilities:
 * - Resolve targets in DOM using existing Resolver
 * - Scope/container resolution
 * - Interactability checks
 * - Safe clicking/typing with action primitives
 * - Stability waits
 * - Outcome verification
 * - Recovery actions
 * 
 * NEVER calls LLM - only returns structured rejection codes.
 */

import type { AgentAction, SemanticTarget, ExpectedOutcome } from './ai-agent';
import { Resolver, type ResolveResult } from '../content/resolver';
import { StateWaitEngine } from '../content/state-wait-engine';
import type { LocatorBundle, LocatorStrategy } from '../types/locator';
import type { Intent } from '../types/intent';

// ============================================================================
// Types
// ============================================================================

/**
 * Explicit rejection codes (not generic errors)
 */
export type RejectionCode = 
  | 'NOT_FOUND'        // No candidates matched
  | 'AMBIGUOUS'        // Multiple candidates, can't decide
  | 'NOT_INTERACTABLE' // Element found but not clickable/visible
  | 'SCOPE_FAILED'     // Scope container not found
  | 'UNSAFE_ACTION'    // Would click delete/confirm in popup
  | 'OUTCOME_FAILED';  // Action succeeded but outcome verification failed

/**
 * Execution result with explicit rejection codes
 */
export interface Tier1ExecutionResult {
  status: 'success' | 'rejected';
  code?: RejectionCode;
  details: {
    // For NOT_FOUND / AMBIGUOUS
    matchCount?: number;
    candidates?: Array<{ role: string; name: string; text?: string }>;
    triedStrategies?: string[];
    
    // For SCOPE_FAILED
    scopeStatus?: string;
    
    // For NOT_INTERACTABLE
    interactabilityIssue?: string;
    
    // For OUTCOME_FAILED
    outcomeResult?: string;
    expectedOutcome?: ExpectedOutcome;
    
    // For UNSAFE_ACTION
    dangerousPattern?: string;
    
    // General
    element?: Element;
    resolveMetrics?: any;
  };
  message?: string;
}

// ============================================================================
// Tier 1 Executor
// ============================================================================

export class Tier1Executor {
  /**
   * Execute an action with full deterministic safety checks
   */
  static async execute(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.log(`[Tier1] 🎯 Executing: ${action.type}`, action.params.target || action.params);

    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action);
        
        case 'type':
          return await this.executeType(action);
        
        case 'select':
          return await this.executeSelect(action);
        
        case 'scroll':
          return await this.executeScroll(action);
        
        case 'navigate':
          return await this.executeNavigate(action);
        
        case 'wait':
          return await this.executeWait(action);
        
        case 'assert':
          return await this.executeAssert(action);
        
        case 'done':
          return { status: 'success', details: {} };
        
        case 'fail':
          return {
            status: 'rejected',
            code: 'NOT_FOUND',
            details: {},
            message: action.params.reason || 'Agent decided to fail',
          };
        
        default:
          return {
            status: 'rejected',
            code: 'UNSAFE_ACTION',
            details: { dangerousPattern: `Unknown action type: ${action.type}` },
          };
      }
    } catch (error) {
      console.error('[Tier1] Error:', error);
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute click with full resolution pipeline
   */
  private static async executeClick(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, expectedOutcome } = action.params;
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified',
      };
    }

    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' };
    
    // Resolve element using Resolver
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Check interactability
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }
    
    // Check if this is a dangerous action (delete/confirm in popup)
    const safetyCheck = this.checkActionSafety(element, 'click');
    if (!safetyCheck.safe) {
      return {
        status: 'rejected',
        code: 'UNSAFE_ACTION',
        details: {
          dangerousPattern: safetyCheck.reason,
          element,
        },
        message: safetyCheck.reason,
      };
    }
    
    // CRITICAL: Verify we're clicking the RIGHT element (exact text match for options)
    // This prevents clicking "BOGA" when AI wanted "BOGO" or "DISCOUNTED" when AI wanted "BOGO"
    if (target.role === 'option' || target.role === 'menuitem') {
      const actualText = element.textContent?.trim() || '';
      const targetText = target.text || target.name || '';
      
      if (targetText && actualText.toLowerCase() !== targetText.toLowerCase()) {
        console.warn(`[Tier1] ❌ Text mismatch: AI wanted "${targetText}", but would click "${actualText}"`);
        return {
          status: 'rejected',
          code: 'AMBIGUOUS',
          details: {
            matchCount: 1,
            candidates: [{ role: target.role, name: actualText, text: actualText }],
            element,
          },
          message: `Element text "${actualText}" doesn't match requested "${targetText}"`,
        };
      }
    }
    
    // Execute click
    const actualElementText = element.textContent?.trim().substring(0, 50) || '';
    console.log(`[Tier1] ✅ Clicking element: ${element.tagName} ${actualElementText}`);
    this.clickElement(element);
    
    // Wait for stability
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      networkQuietMs: 200,
      maxWaitMs: 3000,
    });
    
    // Verify outcome if specified
    if (expectedOutcome) {
      const outcomeResult = await this.verifyOutcome(expectedOutcome);
      if (!outcomeResult.success) {
        return {
          status: 'rejected',
          code: 'OUTCOME_FAILED',
          details: {
            outcomeResult: outcomeResult.message,
            expectedOutcome,
            element,
          },
          message: outcomeResult.message,
        };
      }
    }
    
    return {
      status: 'success',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
    };
  }

  /**
   * Execute type action
   */
  private static async executeType(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { text, fieldTarget, clearFirst } = action.params;
    
    // Debug logging
    console.log('[Tier1] 📝 Type action params:', {
      hasFieldTarget: !!fieldTarget,
      fieldTarget: fieldTarget ? { role: fieldTarget.role, name: fieldTarget.name, id: fieldTarget.id } : null,
      text: text?.substring(0, 20),
    });
    
    if (!text) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No text specified',
      };
    }
    
    let element: Element | null = null;
    
    // If fieldTarget specified, resolve it
    if (fieldTarget) {
      console.log('[Tier1] 🎯 Resolving fieldTarget:', fieldTarget.name || fieldTarget.role);
      const bundle = this.buildLocatorBundle(fieldTarget);
      const intent: Intent = { kind: 'TYPE', valueVar: 'value' };
      const resolveResult = await this.resolveElement(bundle, intent);
      
      if (resolveResult.status !== 'success') {
        console.log('[Tier1] ❌ Failed to resolve fieldTarget, falling back to activeElement');
        // Fall back to activeElement instead of failing
        element = document.activeElement as Element;
        if (!element || element === document.body) {
          return resolveResult;
        }
      } else {
        element = resolveResult.details.element!;
      }
    } else {
      // Use focused element
      console.log('[Tier1] ⚠️ No fieldTarget provided, using activeElement');
      element = document.activeElement;
      if (!element || element === document.body) {
        return {
          status: 'rejected',
          code: 'NOT_FOUND',
          details: {},
          message: 'No field focused and no fieldTarget specified',
        };
      }
    }
    
    // Check if element accepts input
    const isInput = element instanceof HTMLInputElement ||
                   element instanceof HTMLTextAreaElement ||
                   element.getAttribute('contenteditable') === 'true';
    
    if (!isInput) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: `Element ${element.tagName} does not accept text input`,
          element,
        },
      };
    }
    
    // Log which element we're typing into
    const elementId = (element as HTMLElement).id || 'no-id';
    const elementName = element.getAttribute('aria-label') || element.getAttribute('name') || 'no-name';
    console.log(`[Tier1] ⌨️ Typing into: ${element.tagName} id="${elementId}" name="${elementName}"`);
    
    // Focus element
    (element as HTMLElement).focus();
    await this.sleep(50);  // Brief pause after focus
    
    // Clear if requested
    if (clearFirst && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(50);
    }
    
    // Type using native setter (React-friendly)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, text);
      } else {
        element.value = text;
      }
      
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));  // Some fields need blur to commit
    } else {
      // Contenteditable
      (element as HTMLElement).textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
    
    console.log('[Tier1] ⌨️ Typed:', text.substring(0, 50), '→ Final value:', (element as any).value || (element as HTMLElement).textContent?.substring(0, 50));
    
    return {
      status: 'success',
      details: { element },
    };
  }

  /**
   * Execute select (dropdown)
   */
  private static async executeSelect(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, option } = action.params;
    
    if (!option) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No option specified',
      };
    }
    
    // First, open dropdown if target specified
    if (target) {
      const clickResult = await this.executeClick({
        ...action,
        type: 'click',
        params: { target, description: 'Open dropdown' },
      });
      
      if (clickResult.status !== 'success') {
        return clickResult;
      }
      
      // Wait for dropdown to open
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Find and click option
    const optionTarget: SemanticTarget = {
      role: 'option',
      text: option,
    };
    
    const bundle = this.buildLocatorBundle(optionTarget);
    const intent: Intent = { kind: 'SELECT_DROPDOWN_OPTION', optionVar: 'option' };
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    this.clickElement(element);
    
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });
    
    return {
      status: 'success',
      details: { element },
    };
  }

  /**
   * Execute scroll
   * MODAL-AWARE: Scrolls within modal if one is open, otherwise scrolls the page
   */
  private static async executeScroll(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { direction, amount = 300 } = action.params;
    
    const scrollOptions: ScrollToOptions = { behavior: 'smooth' };
    
    // Check if there's an active modal - if so, scroll within it
    let scrollTarget: Element | Window = window;
    
    const modalSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '[class*="Modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
      '[class*="popup"]',
      '[class*="Popup"]',
    ];
    
    for (const selector of modalSelectors) {
      const modals = Array.from(document.querySelectorAll(selector));
      for (const modal of modals) {
        const style = window.getComputedStyle(modal);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        const zIndex = parseInt(style.zIndex) || 0;
        
        if (isVisible && zIndex > 50) {
          // Found an active modal - look for scrollable container within it
          const scrollableContainer = this.findScrollableContainer(modal);
          if (scrollableContainer) {
            scrollTarget = scrollableContainer;
            console.log('[Tier1] 📜 Found scrollable modal container, will scroll within it');
            break;
          }
        }
      }
      if (scrollTarget !== window) break;
    }
    
    // Perform scroll
    if (scrollTarget === window) {
      console.log(`[Tier1] 📜 Scrolling page ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          window.scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          window.scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          window.scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          window.scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    } else {
      console.log(`[Tier1] 📜 Scrolling modal container ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          scrollTarget.scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          scrollTarget.scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          scrollTarget.scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          scrollTarget.scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    }
    
    // Wait for scroll to complete and DOM to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return { status: 'success', details: {} };
  }
  
  /**
   * Find scrollable container within an element
   */
  private static findScrollableContainer(element: Element): Element | null {
    // Check if element itself is scrollable
    const style = window.getComputedStyle(element);
    const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                        style.overflowY === 'auto' || style.overflowY === 'scroll';
    
    if (isScrollable && element.scrollHeight > element.clientHeight) {
      return element;
    }
    
    // Look for scrollable children
    const children = Array.from(element.querySelectorAll('*'));
    for (const child of children) {
      const childStyle = window.getComputedStyle(child);
      const isChildScrollable = childStyle.overflow === 'auto' || childStyle.overflow === 'scroll' || 
                               childStyle.overflowY === 'auto' || childStyle.overflowY === 'scroll';
      
      if (isChildScrollable && child.scrollHeight > child.clientHeight) {
        return child;
      }
    }
    
    return null;
  }

  /**
   * Execute navigation
   * @deprecated Direct URL navigation is deprecated - use click-through instead.
   * All NAVIGATION steps should be converted to CLICK actions in the agent.
   * This prevents navigating to stale URLs (e.g., wrong account IDs).
   */
  private static async executeNavigate(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.warn('[Tier1] ⚠️ Direct navigation is DEPRECATED - should use click-through instead');
    console.warn('[Tier1] ⚠️ NAVIGATION steps should be converted to CLICK in extractHints()');
    
    const { url } = action.params;
    
    if (!url) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No URL specified (direct navigation is deprecated - use click-through)',
      };
    }
    
    // Still allow it for backwards compatibility, but warn
    console.warn(`[Tier1] ⚠️ Navigating directly to: ${url} (this should not happen in normal operation)`);
    window.location.href = url;
    
    return { status: 'success', details: {} };
  }

  /**
   * Execute wait
   */
  private static async executeWait(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { duration = 1000, waitFor } = action.params;
    
    if (waitFor) {
      const startTime = Date.now();
      const timeout = duration || 5000;
      
      while (Date.now() - startTime < timeout) {
        if (document.body.textContent?.includes(waitFor)) {
          return { status: 'success', details: {} };
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      return {
        status: 'rejected',
        code: 'OUTCOME_FAILED',
        details: { outcomeResult: `Timeout waiting for: ${waitFor}` },
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, duration));
    return { status: 'success', details: {} };
  }

  /**
   * Execute assertion
   */
  private static async executeAssert(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { assertion } = action.params;
    
    if (!assertion) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No assertion specified',
      };
    }
    
    if (document.body.textContent?.includes(assertion)) {
      return { status: 'success', details: {} };
    }
    
    return {
      status: 'rejected',
      code: 'OUTCOME_FAILED',
      details: { outcomeResult: `Assertion failed: "${assertion}" not found` },
    };
  }

  // ============================================================================
  // Helper Methods - Integration with Reliable Replayer
  // ============================================================================

  /**
   * Resolve element using the Resolver with proper scoping
   */
  private static async resolveElement(
    bundle: LocatorBundle,
    intent: Intent
  ): Promise<Tier1ExecutionResult> {
    console.log('[Tier1] Resolving element with', bundle.strategies.length, 'strategies');
    
    // Use Resolver.resolve() which returns found/ambiguous/not_found
    const result: ResolveResult = Resolver.resolve(bundle, intent);
    
    if (result.status === 'found') {
      console.log(`[Tier1] ✅ Found via ${result.winningStrategy}`);
      return {
        status: 'success',
        details: {
          element: result.element,
          resolveMetrics: result.metrics,
        },
      };
    }
    
    if (result.status === 'ambiguous') {
      console.warn(`[Tier1] ⚠️ Ambiguous: ${result.candidates.length} candidates`);
      
      // AUTO-DISAMBIGUATE: Use deterministic heuristics to pick the best candidate
      // This mimics what a human would do: click the visible one, ignore hidden copies
      const bestCandidate = this.pickBestCandidate(
        result.candidates,
        bundle,
        intent
      );
      
      if (bestCandidate) {
        console.log(`[Tier1] ✅ Auto-disambiguated (${bestCandidate.reason})`);
        return {
          status: 'success',
          details: {
            element: bestCandidate.element,
            resolveMetrics: result.metrics,
          },
        };
      }
      
      // Only reject if truly ambiguous after all heuristics
      return {
        status: 'rejected',
        code: 'AMBIGUOUS',
        details: {
          matchCount: result.candidates.length,
          candidates: result.candidates.map(c => ({
            role: c.element.getAttribute('role') || c.element.tagName.toLowerCase(),
            name: c.element.textContent?.trim().substring(0, 50) || '',
            text: c.matchedText,
          })),
          resolveMetrics: result.metrics,
        },
        message: `Found ${result.candidates.length} matching elements, cannot decide which one`,
      };
    }
    
    // not_found
    console.warn(`[Tier1] ❌ Not found. Tried: ${result.triedStrategies.join(', ')}`);
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      details: {
        matchCount: 0,
        triedStrategies: result.triedStrategies,
        resolveMetrics: result.metrics,
      },
      message: `Element not found after trying ${result.triedStrategies.length} strategies`,
    };
  }

  /**
   * AUTO-DISAMBIGUATION: Pick the best candidate when multiple elements match
   * 
   * This implements human-like intuition:
   * - Click the visible BOGO in the open dropdown, not hidden ones
   * - Click the "Submit" button in the modal, not the one behind it
   * - Click the interactive element, not the disabled one
   * 
   * Priority order:
   * 1. VISIBILITY - must be actually visible to user
   * 2. CONTEXT - prefer elements in semantically relevant containers
   * 3. INTERACTABILITY - must be clickable/typeable
   * 4. Z-INDEX - prefer elements on top
   * 5. DOM ORDER - prefer later elements (more recent renders)
   */
  private static pickBestCandidate(
    candidates: Array<{ element: Element; matchedText?: string }>,
    bundle: LocatorBundle,
    intent: Intent
  ): { element: Element; reason: string } | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { element: candidates[0].element, reason: 'only one' };
    
    console.log(`[Tier1] 🔍 Disambiguating ${candidates.length} candidates...`);
    
    // STEP 1: Filter to VISIBLE elements only
    // Remove display:none, visibility:hidden, opacity:0, zero-size
    const visibleCandidates = candidates.filter(c => {
      const el = c.element;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (rect.width === 0 && rect.height === 0) return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After visibility filter: ${visibleCandidates.length}/${candidates.length}`);
    if (visibleCandidates.length === 0) return null;
    if (visibleCandidates.length === 1) return { element: visibleCandidates[0].element, reason: 'only visible one' };
    
    // STEP 2: CONTEXT-AWARE filtering based on element role/type
    const role = bundle.strategies.find(s => s.type === 'role')?.value;
    let contextFiltered = visibleCandidates;
    
    // For dropdown options: prefer elements inside open listbox/menu
    if (role === 'option' || role === 'menuitem') {
      const inListbox = visibleCandidates.filter(c => {
        const listbox = c.element.closest('[role="listbox"], [role="menu"], ul, [class*="dropdown"], [class*="menu"]');
        return listbox && window.getComputedStyle(listbox).display !== 'none';
      });
      
      if (inListbox.length > 0) {
        contextFiltered = inListbox;
        console.log(`[Tier1] 🎯 Filtered to ${inListbox.length} inside open listbox/menu`);
      }
    }
    
    // For modal/dialog buttons: prefer elements inside modal
    const modal = document.querySelector('[role="dialog"][aria-modal="true"], .modal:not([style*="display: none"])');
    if (modal) {
      const inModal = contextFiltered.filter(c => modal.contains(c.element));
      if (inModal.length > 0) {
        contextFiltered = inModal;
        console.log(`[Tier1] 🎯 Filtered to ${inModal.length} inside active modal`);
      }
    }
    
    if (contextFiltered.length === 1) return { element: contextFiltered[0].element, reason: 'only one in context' };
    
    // STEP 3: INTERACTABILITY - prefer elements that are actually interactive
    const interactiveCandidates = contextFiltered.filter(c => {
      const el = c.element as HTMLElement;
      const style = window.getComputedStyle(el);
      
      // Not disabled
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
      
      // Can receive pointer events
      if (style.pointerEvents === 'none') return false;
      
      // Not readonly (for inputs) - but allow readonly if we're just reading the value
      if (el instanceof HTMLInputElement && el.readOnly && intent.kind === 'TYPE') return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After interactability filter: ${interactiveCandidates.length}/${contextFiltered.length}`);
    if (interactiveCandidates.length === 0) {
      // Fallback: if no interactive ones, keep all contextFiltered
      console.log(`[Tier1] ⚠️ No interactive candidates, keeping all ${contextFiltered.length}`);
    } else if (interactiveCandidates.length === 1) {
      return { element: interactiveCandidates[0].element, reason: 'only interactive one' };
    } else {
      contextFiltered = interactiveCandidates;
    }
    
    // STEP 4: Z-INDEX - prefer elements on top (higher z-index)
    const withZIndex = contextFiltered.map(c => {
      const style = window.getComputedStyle(c.element);
      const zIndex = parseInt(style.zIndex) || 0;
      return { ...c, zIndex };
    });
    
    const maxZIndex = Math.max(...withZIndex.map(c => c.zIndex));
    const topLayerCandidates = withZIndex.filter(c => c.zIndex === maxZIndex);
    
    if (topLayerCandidates.length === 1) {
      return { element: topLayerCandidates[0].element, reason: `highest z-index (${maxZIndex})` };
    }
    
    console.log(`[Tier1] 📊 After z-index filter: ${topLayerCandidates.length} at z-index ${maxZIndex}`);
    
    // STEP 5: VIEWPORT POSITION - prefer elements in viewport center (more likely to be interactive)
    const inViewport = topLayerCandidates.filter(c => {
      const rect = c.element.getBoundingClientRect();
      return rect.top >= 0 && 
             rect.left >= 0 && 
             rect.bottom <= window.innerHeight && 
             rect.right <= window.innerWidth;
    });
    
    if (inViewport.length > 0 && inViewport.length < topLayerCandidates.length) {
      console.log(`[Tier1] 📊 Filtered to ${inViewport.length} in viewport`);
      if (inViewport.length === 1) {
        return { element: inViewport[0].element, reason: 'only one in viewport' };
      }
      contextFiltered = inViewport.map(c => ({ element: c.element, matchedText: c.matchedText }));
    } else {
      contextFiltered = topLayerCandidates.map(c => ({ element: c.element, matchedText: c.matchedText }));
    }
    
    // STEP 6: EXACT TEXT MATCH - prefer elements that EXACTLY match the target text
    // This is critical for dropdowns where you want "BOGO" not "BOGA" or "BOGO 2"
    const targetText = bundle.strategies.find(s => s.type === 'text')?.value;
    const targetRole = bundle.strategies.find(s => s.type === 'role')?.value;
    
    // Extract name from role strategy (e.g., "option:BOGO" -> "BOGO")
    let targetName: string | undefined;
    if (targetRole && targetRole.includes(':')) {
      targetName = targetRole.split(':')[1];
    }
    
    // Try exact text match
    const exactTextMatches = contextFiltered.filter(c => {
      const elText = c.element.textContent?.trim();
      const matchTarget = targetText || targetName;
      
      if (!matchTarget || !elText) return false;
      
      // Exact match (case-insensitive)
      return elText.toLowerCase() === matchTarget.toLowerCase();
    });
    
    if (exactTextMatches.length > 0) {
      console.log(`[Tier1] 📊 Filtered to ${exactTextMatches.length} with exact text match`);
      if (exactTextMatches.length === 1) {
        return { element: exactTextMatches[0].element, reason: 'exact text match' };
      }
      // Use exact matches for next steps
      contextFiltered = exactTextMatches;
    }
    
    // STEP 7: DOM ORDER - prefer later elements (more recent React renders)
    // Elements later in DOM tree are typically more recent
    const sortedByDomOrder = [...contextFiltered].sort((a, b) => {
      const comparison = a.element.compareDocumentPosition(b.element);
      if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // a comes before b
      if (comparison & Node.DOCUMENT_POSITION_PRECEDING) return 1;  // a comes after b
      return 0;
    });
    
    // Take the LAST one (most recent)
    const lastElement = sortedByDomOrder[sortedByDomOrder.length - 1];
    console.log(`[Tier1] 📊 Picked last in DOM order out of ${sortedByDomOrder.length}`);
    
    return { 
      element: lastElement.element, 
      reason: `last of ${sortedByDomOrder.length} (most recent)` 
    };
  }

  /**
   * Build locator bundle from semantic target
   */
  private static buildLocatorBundle(target: SemanticTarget): LocatorBundle {
    const strategies: LocatorStrategy[] = [];
    
    // Check if name is actually unlabeled
    const isUnlabeled = !target.name || 
                       target.name === '(unlabeled)' || 
                       target.name.trim() === '';
    
    // Test ID (highest priority)
    if (target.testId) {
      strategies.push({
        type: 'testid',
        value: target.testId,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // ID attribute (also very stable)
    if (target.id) {
      strategies.push({
        type: 'css',
        value: `#${target.id}`,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // Role strategy - use correct format: "role:accessibleName" or just "role"
    if (target.role) {
      if (isUnlabeled) {
        // No name filter, just role
        console.log(`[Tier1] Building locator for unlabeled ${target.role}`);
        strategies.push({
          type: 'role',
          value: target.role,  // Just "combobox", no name part
          features: this.createFeatures(true, false, false),
        });
      } else {
        // Role with name filter
        strategies.push({
          type: 'role',
          value: `${target.role}:${target.name}`,  // Correct format: "role:name"
          features: this.createFeatures(true, false, false),
        });
      }
    }
    
    // ARIA label (only if not unlabeled)
    if (target.name && !isUnlabeled) {
      strategies.push({
        type: 'aria',
        value: target.name,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // Text content (only if valid and not a number/single char)
    const hasValidText = target.text && 
                        target.text !== '(unlabeled)' && 
                        target.text.trim() !== '' &&
                        target.text.trim().length > 1 &&  // Skip single characters
                        !/^\d+$/.test(target.text.trim());  // Skip pure numbers like "0", "100"
    
    if (hasValidText && target.text) {
      console.log(`[Tier1] Adding text strategy with value: "${target.text}"`);
      strategies.push({
        type: 'text',
        value: target.text.trim(),  // Trim to avoid whitespace issues
        features: this.createFeatures(false, false, false),
      });
    }
    
    // Placeholder (for inputs)
    if (target.placeholder) {
      strategies.push({
        type: 'css',
        value: `[placeholder="${target.placeholder}"]`,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // If no strategies were added, add a basic CSS selector for the role
    if (strategies.length === 0 && target.role) {
      console.warn('[Tier1] No valid strategies, adding fallback role selector');
      strategies.push({
        type: 'css',
        value: `[role="${target.role}"]`,
        features: this.createFeatures(false, false, false),
      });
    }
    
    // Final safety check - must have at least one strategy
    if (strategies.length === 0) {
      console.error('[Tier1] Cannot build locator bundle - no valid strategies for target:', target);
      // Add a dummy strategy that will fail gracefully
      strategies.push({
        type: 'css',
        value: '[data-ghostwriter-impossible-selector]',
        features: this.createFeatures(false, false, false),
      });
    }
    
    console.log(`[Tier1] Built locator bundle with ${strategies.length} strategies:`, strategies.map(s => `${s.type}:${s.value.substring(0, 20)}`));
    
    // Build scope if scopeHint provided
    const scope = target.scopeHint ? {
      kind: 'CONTAINER' as const,
      selector: `[aria-label*="${target.scopeHint}"], [data-testid*="${target.scopeHint}"]`,
      fallbackText: target.scopeHint,
    } : undefined;
    
    return {
      strategies,
      scope,
      disambiguators: target.nearbyText || [],
      tagName: target.role || '',
      role: target.role,
    };
  }

  /**
   * Create locator features
   */
  private static createFeatures(
    hasStableAttributes: boolean,
    uniqueMatchAtRecordTime: boolean,
    hasDynamicParts: boolean
  ) {
    return {
      hasStableAttributes,
      uniqueMatchAtRecordTime,
      matchCountAtRecordTime: uniqueMatchAtRecordTime ? 1 : 0,
      hasDynamicParts,
      textStabilityHint: 'unknown' as const,
      isWithinShadowDOM: false,
      recordedTagName: '',
    };
  }

  /**
   * Check if element is interactable
   */
  private static async checkInteractability(element: Element): Promise<{ success: boolean; reason?: string }> {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check visibility
    if (rect.width === 0 || rect.height === 0) {
      return { success: false, reason: 'Element has zero size' };
    }
    
    if (style.visibility === 'hidden') {
      return { success: false, reason: 'Element visibility is hidden' };
    }
    
    if (style.display === 'none') {
      return { success: false, reason: 'Element display is none' };
    }
    
    if (parseFloat(style.opacity) === 0) {
      return { success: false, reason: 'Element opacity is 0' };
    }
    
    // Check if disabled
    if ((element as HTMLButtonElement).disabled) {
      return { success: false, reason: 'Element is disabled' };
    }
    
    if (element.getAttribute('aria-disabled') === 'true') {
      return { success: false, reason: 'Element is aria-disabled' };
    }
    
    return { success: true };
  }

  /**
   * Check if action is safe (not delete/confirm in dangerous context)
   */
  private static checkActionSafety(element: Element, action: 'click' | 'type'): { safe: boolean; reason?: string } {
    if (action !== 'click') {
      return { safe: true };
    }
    
    const text = element.textContent?.toLowerCase().trim() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const combinedText = `${text} ${ariaLabel}`;
    
    // Check if we're in a modal/dialog
    const modal = element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal');
    
    if (modal) {
      // In modal: block ONLY highly dangerous patterns
      // "continue", "proceed", "submit", "save" are legitimate workflow progression buttons
      const highlyDangerousPatterns = [
        'delete', 'remove', 'destroy', 'purge', 'erase', 'terminate',
      ];
      
      // Additional checks for confirm/yes (only block if NOT part of normal flow)
      const contextuallyDangerousPatterns = [
        'confirm delete', 'confirm removal', 'yes, delete', 'yes, remove',
      ];
      
      const safePatterns = ['cancel', 'close', 'dismiss', 'no', 'back'];
      
      // If it's a safe pattern, allow
      if (safePatterns.some(p => combinedText.includes(p))) {
        return { safe: true };
      }
      
      // Check contextually dangerous (e.g., "Confirm Delete" but not just "Confirm")
      if (contextuallyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive confirmation)`,
        };
      }
      
      // If it's highly dangerous, block
      if (highlyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive action)`,
        };
      }
    }
    
    return { safe: true };
  }

  /**
   * Click element with proper event dispatching
   */
  private static clickElement(element: Element): void {
    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Focus
    if (element instanceof HTMLElement) {
      element.focus();
    }
    
    // Dispatch events
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
  }

  /**
   * Verify outcome using SuccessVerifier
   */
  private static async verifyOutcome(expected: ExpectedOutcome): Promise<{ success: boolean; message?: string }> {
    // Wait if specified
    if (expected.waitMs) {
      await new Promise(resolve => setTimeout(resolve, expected.waitMs));
    }
    
    if (expected.urlContains) {
      if (!window.location.href.includes(expected.urlContains)) {
        return {
          success: false,
          message: `URL does not contain: ${expected.urlContains}`,
        };
      }
    }
    
    if (expected.urlEquals) {
      if (window.location.href !== expected.urlEquals) {
        return {
          success: false,
          message: `URL mismatch: expected ${expected.urlEquals}`,
        };
      }
    }
    
    if (expected.textAppears) {
      if (!document.body.textContent?.includes(expected.textAppears)) {
        return {
          success: false,
          message: `Text not found: ${expected.textAppears}`,
        };
      }
    }
    
    if (expected.textDisappears) {
      if (document.body.textContent?.includes(expected.textDisappears)) {
        return {
          success: false,
          message: `Text still present: ${expected.textDisappears}`,
        };
      }
    }
    
    if (expected.modalAppears !== undefined) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (expected.modalAppears && !modal) {
        return {
          success: false,
          message: 'Modal did not appear',
        };
      }
      if (!expected.modalAppears && modal) {
        return {
          success: false,
          message: 'Modal appeared unexpectedly',
        };
      }
    }
    
    if (expected.modalCloses !== undefined && expected.modalCloses) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (modal) {
        return {
          success: false,
          message: 'Modal did not close',
        };
      }
    }
    
    return { success: true };
  }
  
  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

