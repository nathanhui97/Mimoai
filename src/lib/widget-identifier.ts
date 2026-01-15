/**
 * Widget Identifier Service
 * 
 * Uses AI Vision to identify what widget/panel/card contains a clicked element.
 * Called during RECORDING to capture precise widget context.
 * 
 * This replaces brittle CSS heuristics with AI-powered visual understanding.
 */

import { VisualSnapshotService } from '../content/visual-snapshot';
import { aiConfig } from './ai-config';

export interface AIWidgetContext {
  /** Exact title/heading of the widget as identified by AI */
  widgetTitle: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Description of the widget for debugging */
  widgetDescription?: string;
  /** Visual position description */
  visualPosition?: string;
  /** Unique visual features */
  uniqueFeatures?: string[];
  /** If no widget container was identified */
  noWidgetFound?: boolean;
  /** How the context was identified */
  identifiedBy: 'ai-vision' | 'fallback-dom';
  /** Timestamp when identified */
  identifiedAt: number;
}

export interface WidgetIdentifierRequest {
  screenshot: string;
  elementDescription: string;
  elementPosition?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  htmlContext?: string;
  pageUrl?: string;
}

export interface WidgetIdentifierResponse {
  widgetTitle: string;
  confidence: number;
  widgetDescription?: string;
  visualPosition?: string;
  uniqueFeatures?: string[];
  noWidgetFound?: boolean;
  reasoning: string;
}

/**
 * Service for AI-powered widget identification during recording
 */
export class WidgetIdentifierService {
  private static readonly EDGE_FUNCTION_URL = 'widget_identifier';
  private static readonly TIMEOUT_MS = 8000; // 8 seconds timeout
  private static readonly CACHE = new Map<string, AIWidgetContext>(); // Cache by element fingerprint
  
  /**
   * Identify the widget containing an element using AI Vision
   * 
   * @param element The clicked element
   * @param event Optional mouse event for position info
   * @returns AI-identified widget context
   */
  static async identifyWidget(
    element: HTMLElement,
    _event?: MouseEvent // Event currently unused but may be useful for future position hints
  ): Promise<AIWidgetContext> {
    const startTime = Date.now();
    
    try {
      // 1. Generate a fingerprint for caching
      const fingerprint = this.getElementFingerprint(element);
      
      // Check cache first
      const cached = this.CACHE.get(fingerprint);
      if (cached && (Date.now() - cached.identifiedAt) < 30000) { // 30s cache
        console.log('[WidgetIdentifier] ✅ Using cached context:', cached.widgetTitle);
        return cached;
      }
      
      // 2. Capture screenshot of the area around the element
      const rect = element.getBoundingClientRect();
      const screenshot = await this.captureElementContext(element, rect);
      
      if (!screenshot) {
        console.warn('[WidgetIdentifier] Failed to capture screenshot, using DOM fallback');
        return this.fallbackToDOMAnalysis(element);
      }
      
      // 3. Build element description
      const elementDescription = this.describeElement(element);
      
      // 4. Call the edge function
      console.log('[WidgetIdentifier] Calling edge function with screenshot length:', screenshot.length);
      const response = await this.callEdgeFunction({
        screenshot,
        elementDescription,
        elementPosition: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        pageUrl: window.location.href,
      });
      console.log('[WidgetIdentifier] Edge function response:', response);
      
      // 5. Build result
      const result: AIWidgetContext = {
        widgetTitle: response.widgetTitle || '',
        confidence: response.confidence || 0,
        widgetDescription: response.widgetDescription,
        visualPosition: response.visualPosition,
        uniqueFeatures: response.uniqueFeatures,
        noWidgetFound: response.noWidgetFound || false,
        identifiedBy: 'ai-vision',
        identifiedAt: Date.now(),
      };
      
      // Log detailed response for debugging
      console.log('[WidgetIdentifier] 📋 AI Response Details:', {
        widgetTitle: response.widgetTitle,
        confidence: response.confidence,
        noWidgetFound: response.noWidgetFound,
        reasoning: response.reasoning?.substring(0, 200),
      });
      
      // Cache the result
      this.CACHE.set(fingerprint, result);
      
      const elapsed = Date.now() - startTime;
      console.log(`[WidgetIdentifier] ✅ AI identified widget: "${result.widgetTitle}" (${result.confidence.toFixed(2)}) in ${elapsed}ms`);
      
      return result;
      
    } catch (error) {
      console.error('[WidgetIdentifier] Error:', error);
      return this.fallbackToDOMAnalysis(element);
    }
  }
  
  /**
   * Capture a screenshot of the viewport with the element highlighted
   */
  private static async captureElementContext(
    element: HTMLElement,
    _rect: DOMRect // DOMRect passed for future use but currently using element directly
  ): Promise<string | null> {
    try {
      // Capture the viewport with element context (200px padding around element)
      const result = await VisualSnapshotService.captureElementWithContext(element, 200);
      
      // Use the standard capture (1x zoom is sufficient for widget identification)
      return result?.standard || null;
    } catch (error) {
      console.warn('[WidgetIdentifier] Screenshot capture failed:', error);
      
      // Fallback: try full page capture (skipZoom=true for execution)
      try {
        const fullPage = await VisualSnapshotService.captureFullPage(0.7, true);
        return fullPage?.screenshot || null;
      } catch (e) {
        return null;
      }
    }
  }
  
  /**
   * Generate a human-readable description of the element
   */
  private static describeElement(element: HTMLElement): string {
    const parts: string[] = [];
    
    // Tag and role
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    parts.push(role ? `[${role}] ${tag}` : tag);
    
    // Aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      parts.push(`aria-label="${ariaLabel}"`);
    }
    
    // Text content (truncated)
    const text = element.textContent?.trim().substring(0, 50);
    if (text) {
      parts.push(`text="${text}"`);
    }
    
    // Class hints
    const className = element.className?.toString() || '';
    if (className.includes('option') || className.includes('menu-item')) {
      parts.push('(appears to be a menu/dropdown item)');
    } else if (className.includes('button') || tag === 'button') {
      parts.push('(button)');
    }
    
    return parts.join(' ');
  }
  
  /**
   * Generate a fingerprint for caching
   */
  private static getElementFingerprint(element: HTMLElement): string {
    const rect = element.getBoundingClientRect();
    const ariaLabel = element.getAttribute('aria-label') || '';
    const text = element.textContent?.trim().substring(0, 30) || '';
    
    return `${element.tagName}-${ariaLabel}-${text}-${Math.round(rect.x)}-${Math.round(rect.y)}`;
  }
  
  /**
   * Call the widget_identifier edge function
   */
  private static async callEdgeFunction(
    request: WidgetIdentifierRequest
  ): Promise<WidgetIdentifierResponse> {
    const baseUrl = aiConfig.getEdgeFunctionUrl(this.EDGE_FUNCTION_URL);
    console.log('[WidgetIdentifier] Calling edge function at:', baseUrl);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
    
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.getSupabaseAnonKey()}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      console.log('[WidgetIdentifier] Edge function responded with status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[WidgetIdentifier] Edge function error response:', errorText);
        throw new Error(`Edge function error: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('[WidgetIdentifier] Edge function result:', result);
      return result;
    } catch (error) {
      clearTimeout(timeout);
      console.error('[WidgetIdentifier] Edge function call failed:', error);
      throw error;
    }
  }
  
  /**
   * Fallback to DOM-based analysis when AI is unavailable
   */
  private static fallbackToDOMAnalysis(element: HTMLElement): AIWidgetContext {
    console.log('[WidgetIdentifier] Using DOM fallback analysis');
    
    // Try to find widget title by traversing up the DOM
    let current: HTMLElement | null = element;
    let widgetTitle = '';
    let depth = 0;
    const maxDepth = 10;
    
    while (current && depth < maxDepth) {
      // Check for heading elements
      const heading = current.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading?.textContent?.trim()) {
        widgetTitle = heading.textContent.trim().substring(0, 60);
        break;
      }
      
      // Check shadow DOM
      if (current.shadowRoot) {
        const shadowHeading = current.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
        if (shadowHeading?.textContent?.trim()) {
          widgetTitle = shadowHeading.textContent.trim().substring(0, 60);
          break;
        }
      }
      
      // Check title/aria-label attributes
      const title = current.getAttribute('title') || current.getAttribute('aria-label');
      if (title?.trim()) {
        widgetTitle = title.trim().substring(0, 60);
        break;
      }
      
      // Check for widget-like class names
      const className = current.className?.toString()?.toLowerCase() || '';
      if (className.includes('widget') || className.includes('card') || className.includes('panel')) {
        // Found a widget container, look for title inside
        const innerHeading = current.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
        if (innerHeading?.textContent?.trim()) {
          widgetTitle = innerHeading.textContent.trim().substring(0, 60);
          break;
        }
      }
      
      // Move up - handle shadow DOM boundaries
      const rootNode = current.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        current = rootNode.host as HTMLElement;
      } else {
        current = current.parentElement;
      }
      depth++;
    }
    
    return {
      widgetTitle,
      confidence: widgetTitle ? 0.5 : 0,
      noWidgetFound: !widgetTitle,
      identifiedBy: 'fallback-dom',
      identifiedAt: Date.now(),
    };
  }
  
  /**
   * Clear the cache (call when navigating to a new page)
   */
  static clearCache(): void {
    this.CACHE.clear();
    console.log('[WidgetIdentifier] Cache cleared');
  }
}

