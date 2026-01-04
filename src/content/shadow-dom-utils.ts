/**
 * ShadowDOMUtils - Utilities for working with Shadow DOM
 */

export interface ShadowPath {
  hostSelector: string; // Selector for shadow host
  shadowRootIndex?: number; // If multiple shadow roots
  path: string; // Path within shadow DOM
}

export class ShadowDOMUtils {
  /**
   * Get shadow root if element is a shadow host
   */
  static getShadowRoot(element: Element): ShadowRoot | null {
    if (element.shadowRoot) {
      return element.shadowRoot;
    }
    return null;
  }

  /**
   * Check if an element is inside Shadow DOM
   */
  static isInShadowDOM(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
      if (current.getRootNode() instanceof ShadowRoot) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  /**
   * Get the shadow host containing this element
   */
  static getShadowHost(element: Element): Element | null {
    let root = element.getRootNode();
    while (root && root !== document) {
      if (root instanceof ShadowRoot) {
        return root.host;
      }
      // If we're in a shadow root, get its host and check its root
      if (root instanceof DocumentFragment) {
        const host = (root as any).host;
        if (host) {
          root = host.getRootNode();
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return null;
  }

  /**
   * Get path through shadow boundaries
   */
  static getShadowPath(element: Element): ShadowPath[] {
    const path: ShadowPath[] = [];
    let current: Element | null = element;

    while (current) {
      const shadowHost = this.getShadowHost(current);
      if (shadowHost) {
        // Generate selector for shadow host
        const hostSelector = this.generateHostSelector(shadowHost);
        // Generate path within shadow DOM
        const innerPath = this.generatePathInShadow(current, shadowHost);
        
        path.unshift({
          hostSelector,
          path: innerPath,
        });

        current = shadowHost;
      } else {
        break;
      }
    }

    return path;
  }

  /**
   * Generate a selector for the shadow host
   */
  private static generateHostSelector(host: Element): string {
    if (host.id) {
      return `#${CSS.escape(host.id)}`;
    }
    
    const tagName = host.tagName.toLowerCase();
    if (host.className && typeof host.className === 'string') {
      const classes = host.className
        .split(/\s+/)
        .filter((c) => c.length > 0)
        .map((c) => `.${CSS.escape(c)}`)
        .join('');
      if (classes) {
        return `${tagName}${classes}`;
      }
    }
    
    return tagName;
  }

  /**
   * Generate path to element within shadow DOM
   */
  private static generatePathInShadow(element: Element, shadowHost: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== shadowHost) {
      const tagName = current.tagName.toLowerCase();
      let selector = tagName;

      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .split(/\s+/)
          .filter((c) => c.length > 0)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        if (classes) {
          selector += classes;
        }
      }

      // Count preceding siblings
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      if (index > 1) {
        selector += `:nth-of-type(${index})`;
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  /**
   * Find element within shadow DOM
   */
  static findElementInShadowDOM(host: Element, selector: string): Element | null {
    const shadowRoot = this.getShadowRoot(host);
    if (!shadowRoot) {
      return null;
    }

    try {
      return shadowRoot.querySelector(selector);
    } catch (error) {
      console.error('Error querying shadow DOM:', error);
      return null;
    }
  }

  /**
   * Recursively traverse all shadow roots
   */
  static traverseShadowDOM(
    root: Document | ShadowRoot,
    callback: (element: Element) => void
  ): void {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    let node: Node | null = walker.nextNode();
    while (node) {
      if (node instanceof Element) {
        callback(node);

        // If this element has a shadow root, traverse it
        if (node.shadowRoot) {
          this.traverseShadowDOM(node.shadowRoot, callback);
        }
      }
      node = walker.nextNode();
    }
  }
}














