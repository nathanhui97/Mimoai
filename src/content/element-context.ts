/**
 * ElementContext - Captures contextual information about elements for better identification
 */

import { SelectorEngine } from './selector-engine';
import { ElementSimilarity } from './element-similarity';
import { LabelFinder } from './label-finder';

export interface ElementContextData {
  siblings: {
    before: string[];
    after: string[];
  };
  parent: {
    selector: string;
    text?: string;
    attributes?: Record<string, string>;
    index?: number;
  } | null;
  ancestors: Array<{
    selector: string;
    text?: string;
    role?: string;
  }>;
  container: {
    selector: string;
    text?: string;
    type?: string;
    index?: number;
  } | null;
  position: {
    index: number;
    total: number;
    type: string;
  };
  surroundingText?: string;
  uniqueAttributes: Record<string, string>;
  formContext?: {
    formId?: string;
    fieldset?: string;
    section?: string;
  };
  // Dropdown container context for dropdown options
  dropdownContainer?: {
    selector: string;
    role?: string;
    id?: string;
    label?: string;
    triggerLabel?: string;
  };
}

export interface ContainerContext {
  selector: string;
  text?: string;
  type?: string;
  index?: number;
}

export class ElementContext {
  /**
   * Capture full context for an element
   */
  static captureContext(element: Element): ElementContextData {
    const similarElements = ElementSimilarity.findSimilarElements(element);
    const uniqueAttributes = ElementSimilarity.getDisambiguationAttributes(element, similarElements);

    return {
      siblings: this.captureSiblingContext(element),
      parent: this.captureParentContext(element),
      ancestors: this.captureAncestorHierarchy(element, 3),
      container: this.captureContainerContext(element),
      position: this.capturePosition(element, similarElements),
      surroundingText: this.captureSurroundingText(element),
      uniqueAttributes,
      formContext: this.captureFormContext(element),
    };
  }

  /**
   * Get semantic anchors for element identification (Phase 6)
   * Returns human-readable labels and nearby text for AI understanding
   */
  static getSemanticAnchors(element: HTMLElement): {
    textLabel?: string;
    nearbyText?: string[];
    ariaLabel?: string;
  } {
    const anchors: {
      textLabel?: string;
      nearbyText?: string[];
      ariaLabel?: string;
    } = {};

    // 1. Text Label - multiple strategies
    let textLabel: string | undefined;

    // For inputs, use LabelFinder
    if (element.tagName === 'INPUT' || 
        element.tagName === 'TEXTAREA' || 
        element.tagName === 'SELECT') {
      const label = LabelFinder.findLabel(element);
      if (label) {
        textLabel = label;
      }
    }

    // For images/icons, check alt or title
    if (!textLabel && (element.tagName === 'IMG' || element.tagName === 'SVG')) {
      const alt = element.getAttribute('alt');
      const title = element.getAttribute('title');
      textLabel = alt || title || undefined;
    }

    // For other elements, use direct text content (first 100 chars)
    if (!textLabel) {
      const text = element.textContent?.trim();
      if (text && text.length > 0) {
        textLabel = text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }

    if (textLabel) {
      anchors.textLabel = textLabel;
    }

    // 2. ARIA Label - check multiple aria attributes
    const ariaLabel = element.getAttribute('aria-label');
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    const ariaDescription = element.getAttribute('aria-description');

    // If aria-labelledby exists, resolve it to actual text
    let resolvedAriaLabel: string | undefined;
    if (ariaLabelledBy) {
      try {
        const labelElement = document.getElementById(ariaLabelledBy);
        if (labelElement) {
          resolvedAriaLabel = labelElement.textContent?.trim() || undefined;
        }
      } catch (e) {
        // Invalid ID, skip
      }
    }

    const finalAriaLabel = ariaLabel || resolvedAriaLabel || ariaDescription;
    if (finalAriaLabel) {
      anchors.ariaLabel = finalAriaLabel;
    }

    // 3. Nearby Text - immediate siblings only
    const nearbyText: string[] = [];

    // Check immediate previous sibling
    const prevSibling = element.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        nearbyText.push(`[before] ${text}`);
      }
    }

    // Check immediate next sibling
    const nextSibling = element.nextElementSibling;
    if (nextSibling) {
      const text = nextSibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        nearbyText.push(`[after] ${text}`);
      }
    }

    if (nearbyText.length > 0) {
      anchors.nearbyText = nearbyText;
    }

    return anchors;
  }

  /**
   * Capture sibling context (before and after)
   */
  private static captureSiblingContext(element: Element): {
    before: string[];
    after: string[];
  } {
    const before: string[] = [];
    const after: string[] = [];

    // Get preceding siblings (up to 3)
    let sibling = element.previousElementSibling;
    let count = 0;
    while (sibling && count < 3) {
      const text = sibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        before.unshift(text);
      }
      sibling = sibling.previousElementSibling;
      count++;
    }

    // Get following siblings (up to 3)
    sibling = element.nextElementSibling;
    count = 0;
    while (sibling && count < 3) {
      const text = sibling.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        after.push(text);
      }
      sibling = sibling.nextElementSibling;
      count++;
    }

    return { before, after };
  }

  /**
   * Capture parent context
   */
  private static captureParentContext(element: Element): {
    selector: string;
    text?: string;
    attributes?: Record<string, string>;
    index?: number;
    state?: {
      expanded?: boolean;
      visible?: boolean;
      enabled?: boolean;
    };
  } | null {
    const parent = element.parentElement;
    if (!parent) return null;

    const selector = SelectorEngine.generateSelectors(parent).primary;
    const text = parent.textContent?.trim();
    const attributes: Record<string, string> = {};

    // Capture important attributes
    if (parent.id) attributes.id = parent.id;
    const className = parent.className;
    if (className && typeof className === 'string' && className.length < 100) {
      attributes.class = className;
    }
    // Capture ARIA attributes for dropdown detection
    const ariaHaspopup = parent.getAttribute('aria-haspopup');
    if (ariaHaspopup) attributes['aria-haspopup'] = ariaHaspopup;
    const ariaExpanded = parent.getAttribute('aria-expanded');
    if (ariaExpanded !== null) attributes['aria-expanded'] = ariaExpanded;
    const role = parent.getAttribute('role');
    if (role) attributes.role = role;

    // Find index among similar parents
    const similarParents = this.findSimilarParents(parent);
    const index = similarParents.indexOf(parent) + 1;

    // Capture parent state (Phase 3: Minor enhancement)
    const state: {
      expanded?: boolean;
      visible?: boolean;
      enabled?: boolean;
    } = {};

    if (parent instanceof HTMLElement) {
      // Check if expanded (for accordions, collapsibles)
      const ariaExpanded = parent.getAttribute('aria-expanded');
      if (ariaExpanded !== null) {
        state.expanded = ariaExpanded === 'true';
      } else {
        // Check for common expanded indicators
        const style = window.getComputedStyle(parent);
        const display = style.display;
        const visibility = style.visibility;
        state.visible = display !== 'none' && visibility !== 'hidden';
      }

      // Check if enabled
      if ('disabled' in parent && (parent as HTMLButtonElement | HTMLInputElement).disabled) {
        state.enabled = false;
      } else {
        state.enabled = true;
      }
    }

    return {
      selector,
      text: text && text.length < 200 ? text : undefined,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      index: similarParents.length > 1 ? index : undefined,
      state: Object.keys(state).length > 0 ? state : undefined,
    };
  }

  /**
   * Find similar parent elements
   */
  private static findSimilarParents(parent: Element): Element[] {
    const similar: Element[] = [];
    const parentTag = parent.tagName.toLowerCase();
    const parentClasses = parent.className && typeof parent.className === 'string'
      ? parent.className.split(/\s+/)
      : [];

    const allParents = document.querySelectorAll(parentTag);
    for (const p of allParents) {
      if (p === parent) {
        similar.push(p);
        continue;
      }

      const pClasses = p.className && typeof p.className === 'string'
        ? p.className.split(/\s+/)
        : [];

      // Check if classes overlap
      const commonClasses = parentClasses.filter(c => pClasses.includes(c));
      if (commonClasses.length > 0) {
        similar.push(p);
      }
    }

    return similar;
  }

  /**
   * Capture ancestor hierarchy
   */
  private static captureAncestorHierarchy(
    element: Element,
    maxDepth: number
  ): Array<{ selector: string; text?: string; role?: string }> {
    const ancestors: Array<{ selector: string; text?: string; role?: string }> = [];
    const seenSelectors = new Set<string>(); // Deduplicate by selector
    let current: Element | null = element.parentElement;
    let depth = 0;

    while (current && depth < maxDepth) {
      const selector = SelectorEngine.generateSelectors(current).primary;
      const text = current.textContent?.trim();
      const role = current.getAttribute('role');

      // Skip if we've already seen this selector (deduplication)
      if (!seenSelectors.has(selector)) {
        seenSelectors.add(selector);
        ancestors.push({
          selector,
          text: text && text.length < 200 ? text : undefined,
          role: role || undefined,
        });
      }

      current = current.parentElement;
      depth++;
    }

    return ancestors;
  }

  /**
   * Capture container context (dashboard, widget, etc.)
   */
  static captureContainerContext(element: Element): ContainerContext | null {
    const container = this.findParentContainer(element, [
      'gridster-item',
      'dashboard',
      'widget',
      'gs-report-widget-element',
      'gs-dashboard-viewer',
      '[class*="dashboard"]',
      '[class*="widget"]',
      '[id*="dashboard"]',
      '[id*="widget"]',
    ]);

    if (!container) return null;

    // SPECIAL CASE: If container is the element itself (e.g., gs-report-widget-element),
    // look for a parent container with text (e.g., div containing "How To Guide")
    let finalContainer = container;
    let containerText = this.getContainerText(container);
    
    // If we found a container but it has no text, check parent containers
    // This is especially important for Gainsight where gs-report-widget-element
    // might be the container, but the actual title is in a parent div
    if (!containerText || containerText.length === 0) {
      let parent: Element | null = container.parentElement;
      let levelsChecked = 0;
      const maxLevels = 5; // Check up to 5 levels up
      
      while (parent && parent !== document.body && levelsChecked < maxLevels) {
        const parentText = this.getContainerText(parent);
        if (parentText && parentText.length > 0 && parentText.length <= 80) {
          // Found a parent with meaningful text - use it instead
          finalContainer = parent;
          containerText = parentText;
          console.log('GhostWriter: Found container text in parent:', parentText, 'from element:', parent.tagName);
          break;
        }
        parent = parent.parentElement;
        levelsChecked++;
      }
    }

    const selector = SelectorEngine.generateSelectors(finalContainer).primary;
    const text = containerText || this.getContainerText(finalContainer);
    const type = this.getContainerType(finalContainer);
    const index = this.getContainerIndex(finalContainer);

    // Debug logging for Gainsight widgets
    if (element.tagName?.toLowerCase() === 'gs-report-widget-element' || 
        finalContainer.tagName?.toLowerCase() === 'gs-report-widget-element') {
      console.log('🔍 GhostWriter: Gainsight widget detected');
      console.log('  - Container element:', finalContainer.tagName);
      console.log('  - Container text:', text || 'NONE');
      console.log('  - Original container:', container.tagName);
    }

    return {
      selector,
      text,
      type,
      index,
    };
  }

  /**
   * Find parent container matching patterns
   * NOTE: This may return the element itself if it matches a pattern
   */
  static findParentContainer(
    element: Element,
    containerPatterns: string[]
  ): Element | null {
    let current: Element | null = element;

    while (current) {
      // Check if current element matches any pattern
      for (const pattern of containerPatterns) {
        if (this.matchesPattern(current, pattern)) {
          return current;
        }
      }

      current = current.parentElement;
      
      // SHADOW DOM: If we reached the shadow root boundary, continue from the shadow host
      if (!current) {
        const rootNode = element.getRootNode();
        if (rootNode !== document && 'host' in rootNode) {
          const shadowHost = (rootNode as ShadowRoot).host;
          console.log('[ElementContext] 🌑 Crossed shadow boundary, checking host:', shadowHost.tagName);
          
          // Check if shadow host itself is a container
          for (const pattern of containerPatterns) {
            if (this.matchesPattern(shadowHost, pattern)) {
              console.log('[ElementContext] 🌑 Shadow host is a widget container');
              return shadowHost;
            }
          }
          
          // Continue searching from host's parent
          current = shadowHost.parentElement;
        }
      }
    }

    return null;
  }

  /**
   * Check if element matches a pattern
   */
  private static matchesPattern(element: Element, pattern: string): boolean {
    // Exact tag match
    if (pattern === element.tagName.toLowerCase()) {
      return true;
    }

    // ID contains pattern
    if (pattern.startsWith('[id*=') && element.id) {
      const idPattern = pattern.match(/\[id\*="([^"]+)"/)?.[1];
      if (idPattern && element.id.includes(idPattern)) {
        return true;
      }
    }

    // Class contains pattern
    if (pattern.startsWith('[class*=') && element.className) {
      const classPattern = pattern.match(/\[class\*="([^"]+)"/)?.[1];
      if (classPattern && typeof element.className === 'string') {
        if (element.className.includes(classPattern)) {
          return true;
        }
      }
    }

    // Check class name directly
    if (typeof element.className === 'string') {
      const classes = element.className.split(/\s+/);
      if (classes.some(c => c.includes(pattern))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get container text (title, label, etc.)
   * Returns concise text (max 50 chars) - prefers title/header over full text
   */
  private static getContainerText(container: Element): string | undefined {
    // Look for common title/label selectors (PRIORITY: prefer these over full text)
    const titleSelectors = [
      'h1', 'h2', 'h3', 'h4',
      '[class*="title"]',
      '[class*="widget-title"]',
      '[class*="dashboard-title"]',
      '[class*="report-title"]',
      '[class*="header"]',
      '[class*="label"]',
      'title',
      '[data-title]',
      '[data-label]',
      '[aria-label*="title"]',
      '[aria-label*="label"]',
      'aria-label',
    ];

    for (const selector of titleSelectors) {
      if (selector.startsWith('[')) {
        const attr = selector.match(/\[([^\]]+)\]/)?.[1];
        if (attr && container.hasAttribute(attr)) {
          const attrValue = container.getAttribute(attr)?.trim();
          if (attrValue && attrValue.length > 0) {
            // Limit to 50 chars for descriptions
            return attrValue.length > 50 ? attrValue.substring(0, 50) + '...' : attrValue;
          }
        }
      } else {
        // LIGHT DOM: Standard querySelector
        const titleEl = container.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent?.trim();
          if (text && text.length > 0) {
            // Limit to 50 chars for descriptions
            return text.length > 50 ? text.substring(0, 50) + '...' : text;
          }
        }
        
        // SHADOW DOM: If container has shadow root, search inside it
        if (container.shadowRoot) {
          const shadowTitleEl = container.shadowRoot.querySelector(selector);
          if (shadowTitleEl) {
            const text = shadowTitleEl.textContent?.trim();
            if (text && text.length > 0) {
              console.log('[ElementContext] 🌑 Found title in shadow root:', text);
              return text.length > 50 ? text.substring(0, 50) + '...' : text;
            }
          }
        }
      }
    }

    // Enhanced: Check direct children for title-like text (e.g., "STORE LIST - PORTFOLIO")
    // This catches dashboard/widget names that might not use standard selectors
    const titleWords = ['dashboard', 'widget', 'report', 'list', 'portfolio', 'view'];
    for (const child of Array.from(container.children)) {
      const childText = child.textContent?.trim();
      if (childText && childText.length > 0 && childText.length <= 80) {
        // Check if it looks like a title (short, uppercase, or contains title words)
        const isUppercase = childText === childText.toUpperCase() && childText.length > 3;
        const hasTitleWord = titleWords.some(word => childText.toLowerCase().includes(word));
        const isShort = childText.length <= 50;
        
        if ((isUppercase || hasTitleWord) && isShort) {
          return childText.length > 50 ? childText.substring(0, 50) + '...' : childText;
        }
      }
    }

    // Fallback: Extract first meaningful line from container text (not full textContent)
    // This prevents capturing huge amounts of concatenated text
    const text = container.textContent?.trim();
    if (!text || text.length === 0) {
      return undefined;
    }
    
    // For Gainsight widgets: Look for quoted text patterns like "How To Guide"
    // These are often in the container's text content
    const quotedPattern = /"([^"]{3,50})"/;
    const quotedMatch = text.match(quotedPattern);
    if (quotedMatch && quotedMatch[1]) {
      const quotedText = quotedMatch[1].trim();
      if (quotedText.length >= 3 && quotedText.length <= 50) {
        return quotedText;
      }
    }
    
    // Get first line or first 50 chars (whichever is shorter)
    const firstLine = text.split(/\n+/)[0]?.trim() || text;
    if (firstLine.length > 50) {
      // Try to truncate at word boundary
      const truncated = firstLine.substring(0, 50);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 30) {
        return truncated.substring(0, lastSpace) + '...';
      }
      return truncated + '...';
    }
    
    return firstLine;
  }

  /**
   * Get container type
   */
  private static getContainerType(container: Element): string | undefined {
    const tagName = container.tagName.toLowerCase();
    const className = container.className;
    const id = container.id;

    if (tagName.includes('dashboard') || className?.toString().includes('dashboard')) {
      return 'dashboard';
    }
    if (tagName.includes('widget') || className?.toString().includes('widget')) {
      return 'widget';
    }
    if (tagName.includes('table') || className?.toString().includes('table')) {
      return 'table';
    }
    if (id?.includes('dashboard')) return 'dashboard';
    if (id?.includes('widget')) return 'widget';

    return undefined;
  }

  /**
   * Get container index (which dashboard/widget on page)
   */
  private static getContainerIndex(container: Element): number | undefined {
    const tagName = container.tagName.toLowerCase();
    const similarContainers = Array.from(document.querySelectorAll(tagName)).filter(
      el => {
        // Check if similar (same tag and similar classes)
        const elClasses = el.className?.toString() || '';
        const containerClasses = container.className?.toString() || '';
        return elClasses && containerClasses && 
               elClasses.split(/\s+/).some(c => containerClasses.includes(c));
      }
    );

    if (similarContainers.length <= 1) return undefined;

    return similarContainers.indexOf(container) + 1;
  }

  /**
   * Capture position among similar elements
   */
  private static capturePosition(
    element: Element,
    similarElements: Element[]
  ): { index: number; total: number; type: string } {
    const total = similarElements.length + 1; // +1 for the element itself
    const allSimilar = [element, ...similarElements];
    
    // Sort by DOM position
    allSimilar.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const index = allSimilar.indexOf(element) + 1;
    const type = this.getElementType(element);

    return { index, total, type };
  }

  /**
   * Get element type for position
   */
  private static getElementType(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    
    if (role) return role;
    if (tagName === 'button') return 'button';
    if (tagName === 'a') return 'link';
    if (tagName === 'input') return 'input';
    if (tagName.includes('menu')) return 'menu';
    
    return tagName;
  }

  /**
   * Capture surrounding text (within 50px radius)
   */
  private static captureSurroundingText(element: Element): string | undefined {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = 50;

    // Find all text nodes within radius
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const nearbyTexts: string[] = [];
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (node.parentElement) {
        const nodeRect = node.parentElement.getBoundingClientRect();
        const nodeX = nodeRect.left + nodeRect.width / 2;
        const nodeY = nodeRect.top + nodeRect.height / 2;

        const distance = Math.sqrt(
          Math.pow(nodeX - centerX, 2) + Math.pow(nodeY - centerY, 2)
        );

        if (distance <= radius && node.textContent) {
          const text = node.textContent.trim();
          if (text.length > 0 && text.length < 100) {
            nearbyTexts.push(text);
          }
        }
      }
    }

    return nearbyTexts.length > 0 ? nearbyTexts.join(' | ') : undefined;
  }

  /**
   * Capture form context
   */
  private static captureFormContext(element: Element): {
    formId?: string;
    fieldset?: string;
    section?: string;
    isValid?: boolean;
    isSubmitting?: boolean;
  } | undefined {
    const form = element.closest('form');
    if (!form) return undefined;

    const formId = form.id || undefined;
    const fieldset = element.closest('fieldset');
    const fieldsetId = fieldset?.id || fieldset?.getAttribute('name') || undefined;
    
    // Look for section/div with role="region" or aria-label
    const section = element.closest('[role="region"], section, [class*="section"]');
    const sectionLabel = section?.getAttribute('aria-label') || 
                        section?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim() ||
                        undefined;

    // Capture form state (Phase 3: Minor enhancement)
    let isValid: boolean | undefined = undefined;
    let isSubmitting: boolean | undefined = undefined;

    if (form instanceof HTMLFormElement) {
      // Check form validity (if HTML5 validation is available)
      try {
        isValid = form.checkValidity();
      } catch (e) {
        // Form might not support checkValidity
      }

      // Check if form is submitting (look for disabled submit buttons or loading indicators)
      const submitButtons = form.querySelectorAll('button[type="submit"], input[type="submit"]');
      for (const btn of submitButtons) {
        if (btn instanceof HTMLElement && btn.hasAttribute('disabled')) {
          isSubmitting = true;
          break;
        }
      }
    }

    if (!formId && !fieldsetId && !sectionLabel && isValid === undefined && isSubmitting === undefined) {
      return undefined;
    }

    return {
      formId,
      fieldset: fieldsetId,
      section: sectionLabel,
      isValid,
      isSubmitting,
    };
  }
}

