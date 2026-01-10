/**
 * LabelFinder - Finds labels associated with input elements
 * 
 * Enhanced with:
 * - Universal strategies that work across all websites
 * - Confidence scoring for each strategy
 * - Support for Shadow DOM and custom web components
 * - Fallback to AI vision when confidence is low
 */

import { ShadowDOMUtils } from './shadow-dom-utils';

/**
 * Result of label finding with confidence score
 */
export interface LabelResult {
  label: string;
  confidence: number; // 0-1, where 1 is highest confidence
  source: LabelSource;
}

export type LabelSource = 
  | 'label-for'           // <label for="id">
  | 'parent-label'        // Parent <label> element
  | 'aria-label'          // aria-label attribute
  | 'aria-labelledby'     // aria-labelledby reference
  | 'sibling-text'        // Preceding sibling text
  | 'shadow-dom'          // Label inside Shadow DOM
  | 'placeholder'         // Input placeholder
  | 'title'               // Title attribute
  | 'form-element-label'  // Common form patterns (.form-label, .slds-form-element__label, etc.)
  | 'custom-component'    // Custom component attributes (label, field-label, data-label)
  | 'adjacent-text'       // Visually adjacent text element
  | 'fieldset-legend'     // Fieldset legend
  | 'heading-context'     // Nearby heading
  | 'unknown';

// Confidence thresholds
export const CONFIDENCE_THRESHOLD = {
  HIGH: 0.9,      // Very reliable - explicit label association
  MEDIUM: 0.7,    // Reliable - strong patterns
  LOW: 0.5,       // Acceptable - weaker patterns
  MINIMUM: 0.3,   // Last resort - placeholder, title
  AI_NEEDED: 0.7, // Below this, queue for AI enhancement
};

export class LabelFinder {
  /**
   * Find the label for an input element with confidence scoring
   * Returns the best label found along with confidence score
   */
  static findLabelWithConfidence(inputElement: HTMLElement): LabelResult {
    const results: LabelResult[] = [];

    // Strategy 1: Explicit label[for="id"] association (highest confidence)
    const labelForResult = this.findLabelByFor(inputElement);
    if (labelForResult) results.push(labelForResult);

    // Strategy 2: aria-labelledby (high confidence)
    const ariaLabelledByResult = this.findLabelByAriaLabelledBy(inputElement);
    if (ariaLabelledByResult) results.push(ariaLabelledByResult);

    // Strategy 3: aria-label attribute (high confidence)
    const ariaLabelResult = this.findAriaLabel(inputElement);
    if (ariaLabelResult) results.push(ariaLabelResult);

    // Strategy 4: Parent <label> element (high confidence)
    const parentLabelResult = this.findParentLabel(inputElement);
    if (parentLabelResult) results.push(parentLabelResult);

    // Strategy 5: Shadow DOM label (medium-high confidence)
    const shadowLabelResult = this.findShadowDOMLabel(inputElement);
    if (shadowLabelResult) results.push(shadowLabelResult);

    // Strategy 6: Custom component attributes (medium confidence)
    const customComponentResult = this.findCustomComponentLabel(inputElement);
    if (customComponentResult) results.push(customComponentResult);

    // Strategy 7: Form element patterns - universal class-based (medium confidence)
    const formPatternResult = this.findFormPatternLabel(inputElement);
    if (formPatternResult) results.push(formPatternResult);

    // Strategy 8: Preceding sibling text (medium confidence)
    const siblingResult = this.findSiblingLabel(inputElement);
    if (siblingResult) results.push(siblingResult);

    // Strategy 9: Adjacent text element by position (medium-low confidence)
    const adjacentResult = this.findAdjacentTextLabel(inputElement);
    if (adjacentResult) results.push(adjacentResult);

    // Strategy 10: Fieldset legend (medium confidence for grouped fields)
    const fieldsetResult = this.findFieldsetLegend(inputElement);
    if (fieldsetResult) results.push(fieldsetResult);

    // Strategy 11: Nearby heading (low-medium confidence)
    const headingResult = this.findNearbyHeading(inputElement);
    if (headingResult) results.push(headingResult);

    // Strategy 12: Placeholder (low confidence - fallback)
    const placeholderResult = this.findPlaceholder(inputElement);
    if (placeholderResult) results.push(placeholderResult);

    // Strategy 13: Title attribute (low confidence - fallback)
    const titleResult = this.findTitle(inputElement);
    if (titleResult) results.push(titleResult);

    // Sort by confidence and return the best result
    results.sort((a, b) => b.confidence - a.confidence);

    if (results.length > 0) {
      return results[0];
    }

    // No label found
    return {
      label: 'Unknown Field',
      confidence: 0,
      source: 'unknown',
    };
  }

  /**
   * Original findLabel method for backward compatibility
   */
  static findLabel(inputElement: HTMLElement): string | null {
    const result = this.findLabelWithConfidence(inputElement);
    return result.confidence > 0 ? result.label : null;
  }

  /**
   * Check if the label result needs AI enhancement
   */
  static needsAIEnhancement(result: LabelResult): boolean {
    return result.confidence < CONFIDENCE_THRESHOLD.AI_NEEDED;
  }

  // ============================================================================
  // Strategy 1: Explicit label[for="id"] association
  // ============================================================================
  private static findLabelByFor(inputElement: HTMLElement): LabelResult | null {
    if (!inputElement.id) return null;

    // Check in regular DOM
    let label = document.querySelector(`label[for="${CSS.escape(inputElement.id)}"]`);
    if (label) {
      const text = this.cleanLabelText(label.textContent);
      if (text) {
        return { label: text, confidence: 0.95, source: 'label-for' };
      }
    }

    // Check in Shadow DOM
    label = this.findLabelInShadowDOM(inputElement.id);
    if (label) {
      const text = this.cleanLabelText(label.textContent);
      if (text) {
        return { label: text, confidence: 0.9, source: 'label-for' };
      }
    }

    return null;
  }

  // ============================================================================
  // Strategy 2: aria-labelledby
  // ============================================================================
  private static findLabelByAriaLabelledBy(inputElement: HTMLElement): LabelResult | null {
    const labelledBy = inputElement.getAttribute('aria-labelledby');
    if (!labelledBy) return null;

    // Can reference multiple IDs separated by space
    const ids = labelledBy.split(/\s+/);
    const texts: string[] = [];

    for (const id of ids) {
      // Check regular DOM
      let element = document.getElementById(id);
      
      // Check Shadow DOM if not found
      if (!element) {
        element = this.findElementByIdInShadowDOM(id);
      }

      if (element) {
        const text = this.cleanLabelText(element.textContent);
        if (text) texts.push(text);
      }
    }

    if (texts.length > 0) {
      return { 
        label: texts.join(' '), 
        confidence: 0.9, 
        source: 'aria-labelledby' 
      };
    }

    return null;
  }

  // ============================================================================
  // Strategy 3: aria-label attribute
  // ============================================================================
  private static findAriaLabel(inputElement: HTMLElement): LabelResult | null {
    const ariaLabel = inputElement.getAttribute('aria-label');
    if (ariaLabel) {
      const text = this.cleanLabelText(ariaLabel);
      if (text && !this.isCellReference(text)) {
        return { label: text, confidence: 0.85, source: 'aria-label' };
      }
    }
    return null;
  }

  // ============================================================================
  // Strategy 4: Parent <label> element
  // ============================================================================
  private static findParentLabel(inputElement: HTMLElement): LabelResult | null {
    let parent = inputElement.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (parent && depth < maxDepth) {
      if (parent.tagName.toLowerCase() === 'label') {
        const text = this.cleanLabelText(parent.textContent);
        if (text) {
          // Remove the input's own text content if included
          const inputText = inputElement.textContent?.trim() || '';
          const labelText = text.replace(inputText, '').trim();
          const finalText = labelText.length > 0 ? labelText : text;
          
          // Confidence decreases with depth
          const confidence = 0.9 - (depth * 0.05);
          return { label: finalText, confidence, source: 'parent-label' };
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    return null;
  }

  // ============================================================================
  // Strategy 5: Shadow DOM label
  // ============================================================================
  private static findShadowDOMLabel(inputElement: HTMLElement): LabelResult | null {
    const shadowHost = ShadowDOMUtils.getShadowHost(inputElement);
    if (!shadowHost) return null;

    // Check host element's label attribute (common in custom components)
    const hostLabel = shadowHost.getAttribute('label') || 
                     shadowHost.getAttribute('field-label') ||
                     shadowHost.getAttribute('data-label');
    if (hostLabel) {
      const text = this.cleanLabelText(hostLabel);
      if (text) {
        return { label: text, confidence: 0.85, source: 'shadow-dom' };
      }
    }

    // Check for label inside shadow root
    if (shadowHost.shadowRoot) {
      const labelElement = shadowHost.shadowRoot.querySelector('label, .label, [class*="label"]');
      if (labelElement) {
        const text = this.cleanLabelText(labelElement.textContent);
        if (text) {
          return { label: text, confidence: 0.8, source: 'shadow-dom' };
        }
      }
    }

    // Check parent label in Shadow DOM
    const parentLabel = this.findParentLabelInShadowDOM(inputElement);
    if (parentLabel) {
      return { label: parentLabel, confidence: 0.8, source: 'shadow-dom' };
    }

    return null;
  }

  // ============================================================================
  // Strategy 6: Custom component attributes
  // ============================================================================
  private static findCustomComponentLabel(inputElement: HTMLElement): LabelResult | null {
    // Check the input element itself
    const directLabel = this.getCustomLabelAttribute(inputElement);
    if (directLabel) {
      return { label: directLabel, confidence: 0.8, source: 'custom-component' };
    }

    // Check parent custom elements (up to 5 levels)
    let parent = inputElement.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (parent && depth < maxDepth) {
      // Check if parent is a custom element (contains hyphen in tag name)
      const tagName = parent.tagName.toLowerCase();
      if (tagName.includes('-') || parent.hasAttribute('data-component')) {
        const label = this.getCustomLabelAttribute(parent);
        if (label) {
          const confidence = 0.75 - (depth * 0.05);
          return { label, confidence, source: 'custom-component' };
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    return null;
  }

  private static getCustomLabelAttribute(element: Element): string | null {
    // Common label attributes used by various frameworks
    const labelAttrs = [
      'label',
      'field-label',
      'data-label',
      'data-field-label',
      'data-field-name',
      'ng-reflect-label',    // Angular
      'formcontrolname',     // Angular Reactive Forms
      'data-testid',         // Often contains field name
      'data-cy',             // Cypress test IDs often have field names
    ];

    for (const attr of labelAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        const text = this.cleanLabelText(value);
        // Skip if it looks like a technical ID
        if (text && !text.match(/^[a-z0-9_-]+$/i)) {
          return text;
        }
        // For camelCase or snake_case IDs, convert to readable text
        if (text && text.match(/^[a-zA-Z][a-zA-Z0-9_-]*$/)) {
          return this.humanizeFieldName(text);
        }
      }
    }

    return null;
  }

  // ============================================================================
  // Strategy 7: Form element patterns (universal class-based)
  // ============================================================================
  private static findFormPatternLabel(inputElement: HTMLElement): LabelResult | null {
    // Universal patterns for form labels (works across different frameworks)
    const labelPatterns = [
      // Generic patterns
      '.label',
      '.form-label',
      '.field-label',
      '.input-label',
      '.control-label',
      '[class*="label"]',
      // SLDS (Salesforce Lightning Design System)
      '.slds-form-element__label',
      // Bootstrap
      '.form-control-label',
      // Material UI
      '.MuiInputLabel-root',
      '.MuiFormLabel-root',
      // Ant Design
      '.ant-form-item-label',
      // Semantic UI
      '.ui.label',
    ];

    // Find the form field container
    const container = this.findFormFieldContainer(inputElement);
    if (!container) return null;

    // Try each pattern
    for (const pattern of labelPatterns) {
      try {
        const labelElement = container.querySelector(pattern);
        if (labelElement && labelElement !== inputElement) {
          const text = this.cleanLabelText(labelElement.textContent);
          if (text) {
            return { label: text, confidence: 0.75, source: 'form-element-label' };
          }
        }
      } catch {
        // Invalid selector, skip
        continue;
      }
    }

    return null;
  }

  private static findFormFieldContainer(inputElement: HTMLElement): Element | null {
    // Common container patterns
    const containerPatterns = [
      '.form-group',
      '.form-field',
      '.form-element',
      '.field',
      '.input-group',
      '.form-control',
      '.slds-form-element',
      '.MuiFormControl-root',
      '.ant-form-item',
      '[class*="form-group"]',
      '[class*="form-field"]',
      '[class*="field-container"]',
    ];

    for (const pattern of containerPatterns) {
      try {
        const container = inputElement.closest(pattern);
        if (container) return container;
      } catch {
        continue;
      }
    }

    // Fallback: use parent element
    return inputElement.parentElement;
  }

  // ============================================================================
  // Strategy 8: Preceding sibling text
  // ============================================================================
  private static findSiblingLabel(inputElement: HTMLElement): LabelResult | null {
    let sibling = inputElement.previousElementSibling;
    let depth = 0;
    const maxDepth = 3;

    while (sibling && depth < maxDepth) {
      const text = this.cleanLabelText(sibling.textContent);
      if (text && text.length < 100) {
        // Check if it looks like a label
        if (this.looksLikeLabel(text)) {
          const confidence = 0.7 - (depth * 0.1);
          return { 
            label: text.replace(/:\s*$/, '').trim(), 
            confidence, 
            source: 'sibling-text' 
          };
        }
      }
      sibling = sibling.previousElementSibling;
      depth++;
    }

    return null;
  }

  // ============================================================================
  // Strategy 9: Adjacent text by visual position
  // ============================================================================
  private static findAdjacentTextLabel(inputElement: HTMLElement): LabelResult | null {
    const inputRect = inputElement.getBoundingClientRect();
    if (inputRect.width === 0 || inputRect.height === 0) return null;

    const container = inputElement.parentElement?.parentElement || document.body;
    const textElements = container.querySelectorAll('span, div, p, label, strong, b');

    let bestMatch: { text: string; distance: number } | null = null;

    for (const el of textElements) {
      if (el === inputElement || el.contains(inputElement)) continue;

      const text = this.cleanLabelText(el.textContent);
      if (!text || text.length > 50 || !this.looksLikeLabel(text)) continue;

      const elRect = el.getBoundingClientRect();
      if (elRect.width === 0 || elRect.height === 0) continue;

      // Check if element is to the left or above the input
      const isAbove = elRect.bottom <= inputRect.top + 5 && 
                      elRect.left < inputRect.right && 
                      elRect.right > inputRect.left;
      const isLeft = elRect.right <= inputRect.left + 5 && 
                     elRect.top < inputRect.bottom && 
                     elRect.bottom > inputRect.top;

      if (isAbove || isLeft) {
        const distance = isAbove 
          ? inputRect.top - elRect.bottom 
          : inputRect.left - elRect.right;

        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { text: text.replace(/:\s*$/, '').trim(), distance };
        }
      }
    }

    if (bestMatch && bestMatch.distance < 100) {
      const confidence = Math.max(0.4, 0.65 - (bestMatch.distance / 200));
      return { label: bestMatch.text, confidence, source: 'adjacent-text' };
    }

    return null;
  }

  // ============================================================================
  // Strategy 10: Fieldset legend
  // ============================================================================
  private static findFieldsetLegend(inputElement: HTMLElement): LabelResult | null {
    const fieldset = inputElement.closest('fieldset');
    if (!fieldset) return null;

    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = this.cleanLabelText(legend.textContent);
      if (text) {
        return { label: text, confidence: 0.6, source: 'fieldset-legend' };
      }
    }

    return null;
  }

  // ============================================================================
  // Strategy 11: Nearby heading
  // ============================================================================
  private static findNearbyHeading(inputElement: HTMLElement): LabelResult | null {
    // Look for headings in ancestors
    let parent = inputElement.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (parent && depth < maxDepth) {
      const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
      if (heading && !heading.contains(inputElement)) {
        const text = this.cleanLabelText(heading.textContent);
        if (text && text.length < 50) {
          const confidence = 0.5 - (depth * 0.05);
          return { label: text, confidence, source: 'heading-context' };
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    return null;
  }

  // ============================================================================
  // Strategy 12: Placeholder
  // ============================================================================
  private static findPlaceholder(inputElement: HTMLElement): LabelResult | null {
    const placeholder = (inputElement as HTMLInputElement).placeholder;
    if (placeholder) {
      const text = this.cleanLabelText(placeholder);
      if (text) {
        return { label: text, confidence: 0.4, source: 'placeholder' };
      }
    }
    return null;
  }

  // ============================================================================
  // Strategy 13: Title attribute
  // ============================================================================
  private static findTitle(inputElement: HTMLElement): LabelResult | null {
    const title = inputElement.getAttribute('title');
    if (title) {
      const text = this.cleanLabelText(title);
      if (text) {
        return { label: text, confidence: 0.35, source: 'title' };
      }
    }
    return null;
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  /**
   * Find label in Shadow DOM by for attribute
   */
  private static findLabelInShadowDOM(inputId: string): HTMLLabelElement | null {
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const label = element.shadowRoot.querySelector(`label[for="${CSS.escape(inputId)}"]`);
        if (label) {
          return label as HTMLLabelElement;
        }
      }
    }
    return null;
  }

  /**
   * Find element by ID in Shadow DOM
   */
  private static findElementByIdInShadowDOM(id: string): HTMLElement | null {
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const found = element.shadowRoot.getElementById(id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Find parent label in Shadow DOM
   */
  private static findParentLabelInShadowDOM(element: HTMLElement): string | null {
    const shadowHost = ShadowDOMUtils.getShadowHost(element);
    if (!shadowHost || !shadowHost.shadowRoot) {
      return null;
    }

    let current: Element | null = element;
    const shadowRoot = shadowHost.shadowRoot;

    while (current && current.getRootNode() === shadowRoot) {
      if (current.tagName.toLowerCase() === 'label') {
        const text = this.cleanLabelText(current.textContent);
        if (text) return text;
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * Clean and normalize label text
   */
  private static cleanLabelText(text: string | null | undefined): string {
    if (!text) return '';
    
    return text
      .trim()
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/^\*\s*/, '')          // Remove leading asterisk (required indicator)
      .replace(/\s*\*$/, '')          // Remove trailing asterisk
      .replace(/:\s*$/, '')           // Remove trailing colon
      .replace(/^\s*-\s*/, '')        // Remove leading dash
      .trim();
  }

  /**
   * Check if text looks like a field label
   */
  private static looksLikeLabel(text: string): boolean {
    if (!text || text.length === 0) return false;
    if (text.length > 100) return false;
    
    // Should not be all numbers
    if (/^\d+$/.test(text)) return false;
    
    // Should not be a cell reference (A1, B2, etc.)
    if (this.isCellReference(text)) return false;
    
    // Should contain at least one letter
    if (!/[a-zA-Z]/.test(text)) return false;
    
    // Common label patterns
    if (text.match(/^[^:]+:?\s*$/)) return true;
    
    // Starts with capital letter
    if (/^[A-Z]/.test(text)) return true;
    
    return true;
  }

  /**
   * Check if text is a spreadsheet cell reference
   */
  private static isCellReference(text: string): boolean {
    return /^[A-Z]+\d+$/i.test(text.trim());
  }

  /**
   * Convert technical field name to human-readable text
   */
  private static humanizeFieldName(text: string): string {
    return text
      // camelCase to spaces
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // snake_case to spaces
      .replace(/_/g, ' ')
      // kebab-case to spaces
      .replace(/-/g, ' ')
      // Capitalize first letter
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }
}
