/**
 * IframeUtils - Utilities for detecting and working with iframes
 */

import { SelectorEngine } from './selector-engine';

export interface IframeContext {
  selector: string;
  src?: string;
  name?: string;
  index?: number;
}

export class IframeUtils {
  /**
   * Check if an element is inside an iframe
   */
  static isInIframe(element: Element): boolean {
    try {
      return window.self !== window.top && this.getIframeElement(element) !== null;
    } catch (e) {
      // Cross-origin iframe - can't access parent
      return true;
    }
  }

  /**
   * Get the iframe element that contains the given element
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
   * Get iframe context for an element
   */
  static getIframeContext(element: Element): IframeContext | null {
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
      };
    } catch (error) {
      console.warn('GhostWriter: Error getting iframe context:', error);
      return null;
    }
  }
}












