/**
 * Plan Executor Module
 *
 * Executes PagePlan actions deterministically — NO LLM calls.
 * Each action maps directly to DOM operations: focus, type, click, select.
 *
 * This is the "code executes per step" layer that runs at ~50ms per action.
 */

import type {
  PlannedFieldAction,
  PlannedNavigationAction,
  PlannedSubmitAction,
  PlanExecutionResult,
} from './types';

// ============================================================================
// PlanExecutor
// ============================================================================

export class PlanExecutor {
  /**
   * Execute a single planned field action (type, select, checkbox, etc.)
   */
  async executeField(action: PlannedFieldAction): Promise<PlanExecutionResult> {
    const start = Date.now();
    try {
      const element = this.findElement(action.selector, action.elementIndex);
      if (!element) {
        return {
          success: false,
          error: `Element not found for field "${action.fieldName}" (selector: ${action.selector})`,
          hintIndex: action.hintIndex,
          durationMs: Date.now() - start,
        };
      }

      // Auto-detect actual element type and reject mismatched strategies.
      // When the cached plan has the wrong strategy (e.g., 'checkbox' for a <select>),
      // the value is likely wrong too (e.g., 'true' instead of an option name).
      // Return failure so the Hybrid executor handles it correctly.
      const effectiveStrategy = this.resolveStrategy(element, action.strategy);
      if (effectiveStrategy !== action.strategy) {
        console.log(`[PlanExecutor] ⚠️ Strategy mismatch: plan says '${action.strategy}' but element is <${element.tagName.toLowerCase()}> (needs '${effectiveStrategy}'). Deferring to Hybrid executor.`);
        return {
          success: false,
          error: `Strategy mismatch: plan='${action.strategy}', element needs '${effectiveStrategy}'`,
          hintIndex: action.hintIndex,
          durationMs: Date.now() - start,
        };
      }

      switch (effectiveStrategy) {
        case 'type':
          await this.executeType(element, action.value, action.clearFirst);
          break;

        case 'select':
          await this.executeSelect(element, action.optionText || action.value);
          break;

        case 'checkbox':
          await this.executeCheckbox(element, action.value);
          break;

        case 'typeahead':
          await this.executeTypeahead(element, action.value, action.optionText);
          break;

        case 'date_picker':
          // Date pickers are complex — fall back to typing the date
          await this.executeType(element, action.value, true);
          break;

        case 'click':
          this.simulateClick(element);
          break;

        case 'inline_edit':
          await this.executeInlineEdit(element, action.value);
          break;

        default:
          await this.executeType(element, action.value, action.clearFirst);
      }

      console.log(`[PlanExecutor] Field "${action.fieldName}" = "${action.value}" (${effectiveStrategy}, ${Date.now() - start}ms)`);

      return {
        success: true,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to fill "${action.fieldName}": ${error}`,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Execute a navigation/click action.
   */
  async executeNavigation(action: PlannedNavigationAction): Promise<PlanExecutionResult> {
    const start = Date.now();
    try {
      const element = this.findElement(action.selector, action.elementIndex);
      if (!element) {
        return {
          success: false,
          error: `Element not found for "${action.description}" (selector: ${action.selector})`,
          hintIndex: action.hintIndex,
          durationMs: Date.now() - start,
        };
      }

      // Scroll into view if needed
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      await this.sleep(50);

      this.simulateClick(element);

      // Wait for navigation or modal if expected
      if (action.expectsNavigation) {
        await this.sleep(500);
      } else if (action.expectsModal) {
        await this.waitForModal(2000);
      }

      console.log(`[PlanExecutor] Navigation: "${action.description}" (${Date.now() - start}ms)`);

      return {
        success: true,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed nav action "${action.description}": ${error}`,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Execute a submit action.
   */
  async executeSubmit(action: PlannedSubmitAction): Promise<PlanExecutionResult> {
    const start = Date.now();
    try {
      const element = this.findElement(action.selector, action.elementIndex);
      if (!element) {
        return {
          success: false,
          error: `Submit button not found (selector: ${action.selector})`,
          hintIndex: action.hintIndex,
          durationMs: Date.now() - start,
        };
      }

      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      await this.sleep(50);

      this.simulateClick(element);

      // Wait for page response
      if (action.waitAfterMs > 0) {
        await this.sleep(action.waitAfterMs);
      }

      console.log(`[PlanExecutor] Submit clicked (${Date.now() - start}ms)`);

      return {
        success: true,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to submit: ${error}`,
        hintIndex: action.hintIndex,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Private: Strategy Resolution ──────────────────────────────

  /**
   * Resolve the actual strategy based on the real element type.
   * Cached plans may have wrong strategies (e.g., 'checkbox' for a <select>).
   */
  private resolveStrategy(element: Element, plannedStrategy: string): string {
    const tagName = element.tagName.toLowerCase();
    const inputType = (element as HTMLInputElement).type?.toLowerCase();

    // <select> elements must use 'select' strategy
    if (tagName === 'select') return 'select';

    // Radio inputs must use 'radio' (click the right one), not 'checkbox' or 'type'
    if (tagName === 'input' && inputType === 'radio') return 'radio';

    // Checkbox inputs must use 'checkbox'
    if (tagName === 'input' && inputType === 'checkbox') return 'checkbox';

    // Text-like inputs should use 'type' unless planned as something more specific
    if (tagName === 'input' && ['text', 'email', 'tel', 'number', 'url', 'search', 'password'].includes(inputType)) {
      if (plannedStrategy === 'checkbox' || plannedStrategy === 'radio') return 'type';
    }

    // Textarea always types
    if (tagName === 'textarea') return 'type';

    return plannedStrategy;
  }

  // ── Private: Element Finding ───────────────────────────────────

  private findElement(selector: string, elementIndex: number): Element | null {
    // Try CSS selector first
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch {
        // Invalid selector, fall through
      }
    }

    // Fall back to DOM map index (all interactive elements)
    const interactiveSelectors = [
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'button',
      'a[href]',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[contenteditable="true"]',
    ].join(', ');

    const allInteractive = document.querySelectorAll(interactiveSelectors);
    if (elementIndex >= 0 && elementIndex < allInteractive.length) {
      return allInteractive[elementIndex];
    }

    return null;
  }

  // ── Private: Field Strategies ──────────────────────────────────

  private async executeType(element: Element, value: string, clearFirst?: boolean): Promise<void> {
    const input = element as HTMLInputElement | HTMLTextAreaElement;

    // Focus the element
    input.focus();
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await this.sleep(30);

    // Clear if needed
    if (clearFirst || input.value) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Type character by character for framework compatibility
    for (const char of value) {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }

    // Trigger change/blur for validation
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  private async executeSelect(element: Element, optionText: string): Promise<void> {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'select') {
      // Native <select>: set value directly
      const select = element as HTMLSelectElement;
      const option = Array.from(select.options).find(
        o => o.text.trim() === optionText || o.value === optionText
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        throw new Error(`Option "${optionText}" not found in select`);
      }
      return;
    }

    // Custom dropdown: click trigger → wait for listbox → click option
    this.simulateClick(element);
    await this.sleep(200);

    // Wait for listbox to appear
    const listbox = await this.waitForElement(
      '[role="listbox"], [role="menu"], .dropdown-menu, .select-dropdown, [class*="dropdown"]',
      2000
    );

    if (!listbox) {
      throw new Error('Dropdown did not open');
    }

    // Find matching option
    const options = listbox.querySelectorAll(
      '[role="option"], [role="menuitem"], li, .dropdown-item, [class*="option"]'
    );
    let matchingOption: Element | null = null;

    for (const opt of options) {
      const text = opt.textContent?.trim() || '';
      if (text === optionText || text.includes(optionText)) {
        matchingOption = opt;
        break;
      }
    }

    if (!matchingOption) {
      throw new Error(`Option "${optionText}" not found in dropdown`);
    }

    this.simulateClick(matchingOption);
    await this.sleep(100);
  }

  private async executeCheckbox(element: Element, value: string): Promise<void> {
    const checkbox = element as HTMLInputElement;
    const shouldBeChecked = value === 'true' || value === 'checked';

    if (checkbox.checked !== shouldBeChecked) {
      this.simulateClick(element);
    }
  }

  private async executeTypeahead(element: Element, value: string, optionText?: string): Promise<void> {
    const input = element as HTMLInputElement;

    // Focus and type search text
    input.focus();
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await this.sleep(30);

    // Type search text
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait for suggestions to appear
    const suggestions = await this.waitForElement(
      '[role="listbox"], [role="option"], .autocomplete-results, .suggestions, [class*="suggestion"]',
      2000
    );

    if (suggestions) {
      // Find matching suggestion
      const textToMatch = optionText || value;
      const options = suggestions.querySelectorAll(
        '[role="option"], li, .suggestion-item, [class*="option"]'
      );

      for (const opt of options) {
        const text = opt.textContent?.trim() || '';
        if (text === textToMatch || text.includes(textToMatch)) {
          this.simulateClick(opt);
          await this.sleep(100);
          return;
        }
      }
    }

    // No matching suggestion — keep typed value and blur
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  private async executeInlineEdit(element: Element, value: string): Promise<void> {
    // Click to enter edit mode
    this.simulateClick(element);
    await this.sleep(200);

    // Find the input that appeared (often a sibling or child that replaces the text)
    const input = element.querySelector('input, textarea') ||
                  element.closest('[contenteditable]') ||
                  document.activeElement;

    if (!input || !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      throw new Error('Could not find input after clicking for inline edit');
    }

    // Clear and type
    await this.executeType(input, value, true);

    // Press Enter to confirm
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  }

  // ── Private: DOM Utilities ─────────────────────────────────────

  private simulateClick(element: Element): void {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  }

  private async waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await this.sleep(50);
    }
    return null;
  }

  private async waitForModal(timeoutMs: number): Promise<boolean> {
    const modalSelectors = '[role="dialog"], [aria-modal="true"], .modal.show, .modal-dialog';
    const el = await this.waitForElement(modalSelectors, timeoutMs);
    return !!el;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
