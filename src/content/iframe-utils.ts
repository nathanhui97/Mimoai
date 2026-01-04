/**
 * IframeUtils - Utilities for detecting and working with iframes
 */

import { SelectorEngine } from './selector-engine';

// Import getCurrentFrameId - will be available after content-script initializes
let getCurrentFrameId: (() => number) | null = null;
(async () => {
  try {
    const module = await import('./content-script');
    getCurrentFrameId = module.getCurrentFrameId;
  } catch (e) {
    console.warn('IframeUtils: Could not import getCurrentFrameId:', e);
  }
})();

export interface IframeContext {
  selector: string;
  src?: string;
  name?: string;
  index?: number;
  frameId?: number; // Chrome's internal frame ID - used for cross-frame execution
}

export class IframeUtils {
  /**
   * Check if the current window is inside an iframe
   * @returns true if we're in an iframe, false if main frame
   */
  static isInIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch (e) {
      // Cross-origin - if we can't access parent, we ARE in an iframe
      return true;
    }
  }

  /**
   * Get iframe context for the current frame
   * @param frameId Chrome's internal frame ID
   * @returns IframeContext if we're in an iframe, null if main frame
   */
  static getCurrentFrameContext(frameId: number): IframeContext | null {
    if (!this.isInIframe()) {
      return null; // Main frame has no iframe context
    }
    
    return {
      selector: '', // Cannot determine from inside the iframe
      src: window.location.href,
      name: window.name || undefined,
      frameId: frameId !== 0 ? frameId : undefined,
    };
  }

  /**
   * Get the iframe element that contains the given element
   * @deprecated This method doesn't work when called from inside an iframe
   * Use getCurrentFrameContext() instead
   */
  static getIframeElement(element: Element): HTMLIFrameElement | null {
    let current: Element | null = element;
    const maxLevels = 20;
    let level = 0;

    while (current && level < maxLevels && current !== document.body && current !== document.documentElement) {
      if (current.tagName.toLowerCase() === 'iframe') {
        return current as HTMLIFrameElement;
      }
      current = current.parentElement;
      level++;
    }

    return null;
  }

  /**
   * Get iframe context for an element (legacy method)
   * @deprecated Use getCurrentFrameContext() instead for proper cross-frame support
   */
  static getIframeContext(element: Element): IframeContext | null {
    // NEW: Use the fixed detection method
    const frameId = getCurrentFrameId ? getCurrentFrameId() : 0;
    
    // If we're inside an iframe, return the current frame context
    if (this.isInIframe()) {
      return this.getCurrentFrameContext(frameId);
    }
    
    // If we're in the main frame, try the old approach (looking for iframe elements)
    const iframe = this.getIframeElement(element);
    if (!iframe) {
      return null;
    }

    try {
      const selector = SelectorEngine.generateSelectors(iframe).primary;
      const src = iframe.src || undefined;
      const name = iframe.name || undefined;

      // Count iframe index (how many iframes before this one)
      let index = 0;
      const allIframes = document.querySelectorAll('iframe');
      for (let i = 0; i < allIframes.length; i++) {
        if (allIframes[i] === iframe) {
          index = i;
          break;
        }
      }

      return {
        selector,
        src,
        name,
        index: index > 0 ? index : undefined,
        frameId: frameId !== 0 ? frameId : undefined, // Only include if not main frame
      };
    } catch (error) {
      console.warn('GhostWriter: Error getting iframe context:', error);
      return null;
    }
  }
}














