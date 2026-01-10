/**
 * DropdownOptionScanner - Scans and extracts all options from dropdown/select elements
 * 
 * Universal approach that works across:
 * - Native <select> elements
 * - Custom dropdown components (React, Angular, Vue, etc.)
 * - Shadow DOM components
 * - ARIA listbox patterns
 */

import { ShadowDOMUtils } from './shadow-dom-utils';

export interface DropdownOptions {
  options: string[];
  selectedIndex: number;
  selectedText: string;
  containerSelector?: string;
  confidence: number; // How confident we are that we captured all options
}

export class DropdownOptionScanner {
  /**
   * Scan for all dropdown options after a dropdown is opened
   * Should be called after clicking on a dropdown trigger
   */
  static async scanDropdownOptions(
    triggerElement: Element,
    waitMs: number = 300
  ): Promise<DropdownOptions> {
    // Wait for dropdown to open/render
    await this.wait(waitMs);

    // Try multiple strategies to find options
    const results: DropdownOptions[] = [];

    // Strategy 1: Native <select> element
    const selectResult = this.scanNativeSelect(triggerElement);
    if (selectResult) results.push(selectResult);

    // Strategy 2: ARIA listbox pattern
    const listboxResult = this.scanAriaListbox(triggerElement);
    if (listboxResult) results.push(listboxResult);

    // Strategy 3: Role="option" elements
    const roleOptionResult = this.scanRoleOptions(triggerElement);
    if (roleOptionResult) results.push(roleOptionResult);

    // Strategy 4: Generic dropdown menu patterns
    const menuResult = this.scanDropdownMenu(triggerElement);
    if (menuResult) results.push(menuResult);

    // Strategy 5: Shadow DOM options
    const shadowResult = this.scanShadowDOMOptions(triggerElement);
    if (shadowResult) results.push(shadowResult);

    // Strategy 6: Visible list items (fallback)
    const listItemResult = this.scanVisibleListItems();
    if (listItemResult) results.push(listItemResult);

    // Return the result with most options and highest confidence
    if (results.length === 0) {
      return {
        options: [],
        selectedIndex: -1,
        selectedText: '',
        confidence: 0,
      };
    }

    // Sort by number of options (more is usually better) and confidence
    results.sort((a, b) => {
      const aScore = a.options.length * a.confidence;
      const bScore = b.options.length * b.confidence;
      return bScore - aScore;
    });

    return results[0];
  }

  /**
   * Get all options from a dropdown element (for recording)
   * Captures options without waiting (call after dropdown is already open)
   */
  static getDropdownOptionsImmediate(element: Element): string[] {
    const results: string[][] = [];

    // Try all strategies and collect results
    const selectResult = this.scanNativeSelect(element);
    if (selectResult?.options.length) results.push(selectResult.options);

    const listboxResult = this.scanAriaListbox(element);
    if (listboxResult?.options.length) results.push(listboxResult.options);

    const roleOptionResult = this.scanRoleOptions(element);
    if (roleOptionResult?.options.length) results.push(roleOptionResult.options);

    const menuResult = this.scanDropdownMenu(element);
    if (menuResult?.options.length) results.push(menuResult.options);

    const shadowResult = this.scanShadowDOMOptions(element);
    if (shadowResult?.options.length) results.push(shadowResult.options);

    const listItemResult = this.scanVisibleListItems();
    if (listItemResult?.options.length) results.push(listItemResult.options);

    // Return the longest list of options
    if (results.length === 0) return [];
    
    results.sort((a, b) => b.length - a.length);
    return this.deduplicateOptions(results[0]);
  }

  // ============================================================================
  // Strategy 1: Native <select> element
  // ============================================================================
  private static scanNativeSelect(element: Element): DropdownOptions | null {
    // Check if element is a select
    let select: HTMLSelectElement | null = null;

    if (element.tagName === 'SELECT') {
      select = element as HTMLSelectElement;
    } else {
      // Look for select in ancestors or siblings
      select = element.closest('select') as HTMLSelectElement | null;
      if (!select) {
        select = element.querySelector('select') as HTMLSelectElement | null;
      }
      if (!select && element.parentElement) {
        select = element.parentElement.querySelector('select') as HTMLSelectElement | null;
      }
    }

    if (!select) return null;

    const options: string[] = [];
    let selectedIndex = -1;
    let selectedText = '';

    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      const text = option.textContent?.trim() || option.value;
      if (text) {
        options.push(text);
        if (option.selected) {
          selectedIndex = i;
          selectedText = text;
        }
      }
    }

    if (options.length === 0) return null;

    return {
      options: this.deduplicateOptions(options),
      selectedIndex,
      selectedText,
      containerSelector: this.getSelector(select),
      confidence: 0.95, // Native select is very reliable
    };
  }

  // ============================================================================
  // Strategy 2: ARIA listbox pattern
  // ============================================================================
  private static scanAriaListbox(element: Element): DropdownOptions | null {
    // Find listbox - could be the element itself, associated, or nearby
    let listbox: Element | null = null;

    // Check aria-controls
    const controls = element.getAttribute('aria-controls');
    if (controls) {
      listbox = document.getElementById(controls);
    }

    // Check aria-owns
    if (!listbox) {
      const owns = element.getAttribute('aria-owns');
      if (owns) {
        listbox = document.getElementById(owns);
      }
    }

    // Look for nearby listbox
    if (!listbox) {
      listbox = document.querySelector('[role="listbox"]');
    }

    // Look for listbox in element's subtree
    if (!listbox && element.querySelector) {
      listbox = element.querySelector('[role="listbox"]');
    }

    if (!listbox) return null;

    const optionElements = listbox.querySelectorAll('[role="option"]');
    if (optionElements.length === 0) return null;

    const options: string[] = [];
    let selectedIndex = -1;
    let selectedText = '';

    optionElements.forEach((opt, i) => {
      const text = opt.textContent?.trim();
      if (text) {
        options.push(text);
        if (opt.getAttribute('aria-selected') === 'true') {
          selectedIndex = i;
          selectedText = text;
        }
      }
    });

    if (options.length === 0) return null;

    return {
      options: this.deduplicateOptions(options),
      selectedIndex,
      selectedText,
      containerSelector: this.getSelector(listbox),
      confidence: 0.9,
    };
  }

  // ============================================================================
  // Strategy 3: Role="option" elements anywhere in DOM
  // ============================================================================
  private static scanRoleOptions(_element: Element): DropdownOptions | null {
    // Find all visible option elements
    const optionElements = document.querySelectorAll('[role="option"]:not([aria-hidden="true"])');
    if (optionElements.length === 0) return null;

    // Filter to only visible options
    const visibleOptions = Array.from(optionElements).filter(opt => {
      const rect = opt.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (visibleOptions.length === 0) return null;

    const options: string[] = [];
    let selectedIndex = -1;
    let selectedText = '';

    visibleOptions.forEach((opt, i) => {
      const text = opt.textContent?.trim();
      if (text) {
        options.push(text);
        if (opt.getAttribute('aria-selected') === 'true' || 
            opt.classList.contains('selected') ||
            opt.hasAttribute('data-selected')) {
          selectedIndex = i;
          selectedText = text;
        }
      }
    });

    if (options.length === 0) return null;

    return {
      options: this.deduplicateOptions(options),
      selectedIndex,
      selectedText,
      confidence: 0.85,
    };
  }

  // ============================================================================
  // Strategy 4: Generic dropdown menu patterns
  // ============================================================================
  private static scanDropdownMenu(_element: Element): DropdownOptions | null {
    // Common dropdown menu selectors
    const menuSelectors = [
      '.dropdown-menu',
      '.dropdown-content',
      '.select-menu',
      '.menu-items',
      '.options-list',
      '.suggestion-list',
      '.autocomplete-results',
      '[class*="dropdown-menu"]',
      '[class*="dropdown-list"]',
      '[class*="select-options"]',
      '[class*="menu-list"]',
      '[role="menu"]',
      '[role="menubar"]',
      // Specific frameworks
      '.MuiMenu-list',
      '.ant-select-dropdown',
      '.p-dropdown-panel',
      '.vs__dropdown-menu',
    ];

    let menu: Element | null = null;

    // Try to find menu
    for (const selector of menuSelectors) {
      try {
        // Check in document
        const found = document.querySelector(selector);
        if (found && this.isVisible(found)) {
          menu = found;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!menu) return null;

    // Find option items within menu
    const itemSelectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '.dropdown-item',
      '.menu-item',
      '.option',
      '.select-option',
      'li',
      '[class*="option"]',
      '[class*="item"]',
    ];

    let items: Element[] = [];

    for (const selector of itemSelectors) {
      try {
        const found = menu.querySelectorAll(selector);
        if (found.length > 0) {
          items = Array.from(found).filter(el => this.isVisible(el));
          if (items.length > 0) break;
        }
      } catch {
        continue;
      }
    }

    if (items.length === 0) return null;

    const options: string[] = [];
    let selectedIndex = -1;
    let selectedText = '';

    items.forEach((item, i) => {
      const text = item.textContent?.trim();
      if (text && text.length < 200) { // Reasonable length for option text
        options.push(text);
        if (item.classList.contains('selected') ||
            item.classList.contains('active') ||
            item.getAttribute('aria-selected') === 'true') {
          selectedIndex = i;
          selectedText = text;
        }
      }
    });

    if (options.length === 0) return null;

    return {
      options: this.deduplicateOptions(options),
      selectedIndex,
      selectedText,
      containerSelector: this.getSelector(menu),
      confidence: 0.75,
    };
  }

  // ============================================================================
  // Strategy 5: Shadow DOM options
  // ============================================================================
  private static scanShadowDOMOptions(element: Element): DropdownOptions | null {
    // Get shadow host
    const shadowHost = ShadowDOMUtils.getShadowHost(element as HTMLElement);
    if (!shadowHost?.shadowRoot) return null;

    const shadowRoot = shadowHost.shadowRoot;

    // Look for options in shadow DOM
    const optionSelectors = [
      '[role="option"]',
      '[role="listitem"]',
      '.option',
      '.dropdown-item',
      'li',
    ];

    let items: Element[] = [];

    for (const selector of optionSelectors) {
      const found = shadowRoot.querySelectorAll(selector);
      if (found.length > 0) {
        items = Array.from(found).filter(el => this.isVisible(el));
        if (items.length > 0) break;
      }
    }

    if (items.length === 0) return null;

    const options: string[] = [];
    let selectedIndex = -1;
    let selectedText = '';

    items.forEach((item, i) => {
      const text = item.textContent?.trim();
      if (text) {
        options.push(text);
        if (item.getAttribute('aria-selected') === 'true' ||
            item.classList.contains('selected')) {
          selectedIndex = i;
          selectedText = text;
        }
      }
    });

    if (options.length === 0) return null;

    return {
      options: this.deduplicateOptions(options),
      selectedIndex,
      selectedText,
      confidence: 0.8,
    };
  }

  // ============================================================================
  // Strategy 6: Visible list items (fallback)
  // ============================================================================
  private static scanVisibleListItems(): DropdownOptions | null {
    // Find any recently appeared list of items
    // This is a fallback for custom implementations

    // Look for visible containers that might be dropdowns
    const containers = document.querySelectorAll(
      'ul:not([hidden]), ol:not([hidden]), [class*="list"]:not([hidden]), [class*="menu"]:not([hidden])'
    );

    for (const container of containers) {
      if (!this.isVisible(container)) continue;

      // Check if this looks like a dropdown (has proper styling)
      const style = window.getComputedStyle(container);
      const isOverlay = style.position === 'absolute' || 
                        style.position === 'fixed' ||
                        parseInt(style.zIndex) > 100;

      if (!isOverlay) continue;

      const items = container.querySelectorAll('li, [role="option"], [role="menuitem"]');
      if (items.length < 2) continue; // Need at least 2 options

      const options: string[] = [];
      items.forEach(item => {
        const text = item.textContent?.trim();
        if (text && text.length < 200) {
          options.push(text);
        }
      });

      if (options.length >= 2) {
        return {
          options: this.deduplicateOptions(options),
          selectedIndex: -1,
          selectedText: '',
          containerSelector: this.getSelector(container),
          confidence: 0.6,
        };
      }
    }

    return null;
  }

  // ============================================================================
  // Helper methods
  // ============================================================================

  private static wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private static isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;

    return true;
  }

  private static getSelector(element: Element): string {
    // Generate a simple selector for the element
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const role = element.getAttribute('role');
    if (role) {
      return `[role="${role}"]`;
    }

    const classes = Array.from(element.classList).slice(0, 2).join('.');
    if (classes) {
      return `.${classes}`;
    }

    return element.tagName.toLowerCase();
  }

  private static deduplicateOptions(options: string[]): string[] {
    // Remove duplicates while preserving order
    const seen = new Set<string>();
    return options.filter(opt => {
      const normalized = opt.toLowerCase().trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }
}
