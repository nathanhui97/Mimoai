/**
 * ElementText - Utilities for capturing element text content
 */

export class ElementTextCapture {
  /**
   * Capture the exact text content of an element
   * Returns undefined if element has no meaningful text
   * IMPORTANT: Only captures text from the element itself, not from children/containers
   */
  static captureElementText(element: Element): string | undefined {
    const tagName = element.tagName.toLowerCase();
    
    // For buttons, links, labels, and interactive elements
    if (['button', 'a', 'label', 'span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      // PRIORITY 1: Check aria-label first (most reliable for buttons/icons)
      if (tagName === 'button' || tagName === 'a' || element.getAttribute('role') === 'button') {
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim().length > 0) {
          const text = ariaLabel.trim();
          // Limit to 50 chars for descriptions
          return text.length > 50 ? text.substring(0, 50) + '...' : text;
        }
        
        // SHADOW DOM: Check if button is in shadow root and look for aria-label on host
        const rootNode = element.getRootNode();
        if (rootNode !== document && 'host' in rootNode) {
          const shadowHost = (rootNode as ShadowRoot).host;
          const hostAriaLabel = shadowHost.getAttribute('aria-label');
          if (hostAriaLabel && hostAriaLabel.trim().length > 0) {
            const text = hostAriaLabel.trim();
            console.log('[ElementText] 🌑 Using aria-label from shadow host:', text);
            return text.length > 50 ? text.substring(0, 50) + '...' : text;
          }
        }
      }
      
      // PRIORITY 2: Try innerText (only visible text, excludes hidden children)
      // This is better than textContent because it doesn't include hidden elements
      let text: string | undefined = undefined;
      if (element instanceof HTMLElement) {
        text = element.innerText?.trim();
      }
      
      // PRIORITY 3: If innerText is empty or too long (might include container text), try direct text nodes
      if (!text || text.length > 100) {
        // Extract only direct text nodes (not from children)
        const directText: string[] = [];
        for (const node of Array.from(element.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            const trimmed = node.textContent.trim();
            if (trimmed.length > 0) {
              directText.push(trimmed);
            }
          }
        }
        if (directText.length > 0) {
          text = directText.join(' ').trim();
        }
      }
      
      // If still no text, try textContent as last resort (but limit aggressively)
      if (!text || text.length === 0) {
        text = element.textContent?.trim();
      }
      
      // Normalize and limit text
      if (text && text.length > 0) {
        // Normalize whitespace (replace multiple spaces/tabs/newlines with single space)
        text = text.replace(/\s+/g, ' ').trim();
        
        // Limit to 50 characters for descriptions (was 200, too long)
        if (text.length > 50) {
          // Try to truncate at word boundary
          const truncated = text.substring(0, 50);
          const lastSpace = truncated.lastIndexOf(' ');
          if (lastSpace > 30) {
            text = truncated.substring(0, lastSpace) + '...';
          } else {
            text = truncated + '...';
          }
        }
        
        return text;
      }
    }
    
    // For input elements with value
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      // Don't capture input values as element text (that's in the value field)
      // But we can capture placeholder if no other text
      const placeholder = element.placeholder;
      if (placeholder) {
        return placeholder.trim();
      }
    }

    return undefined;
  }
}
