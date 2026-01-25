/**
 * Unified Action Executor - Clean Interface for All Action Types
 *
 * This module consolidates action execution from various sources into a
 * single, clean interface. It handles:
 * - Click, Double-click, Right-click
 * - Type/Input operations
 * - Select/Dropdown handling
 * - Scroll operations
 * - Navigation
 * - Keyboard shortcuts
 * - Modal/Popup handling
 * - Spreadsheet operations
 *
 * The goal is to provide a consistent interface that can be used by
 * both the FastPathExecutor and SmartExecutor.
 */

import type { AgentAction, SemanticTarget } from '../ai-agent';

// ============================================================================
// Types
// ============================================================================

/** Result of action execution */
export interface ActionResult {
  success: boolean;
  /** Element that was acted upon (if applicable) */
  element?: Element;
  /** Value that was read or produced */
  value?: string | number | boolean;
  /** Error message if failed */
  error?: string;
  /** Time taken in ms */
  elapsedMs: number;
}

/** Action execution options */
export interface ActionExecutorOptions {
  /** Wait for DOM stability after action */
  waitForStability?: boolean;
  /** Verify action outcome */
  verifyOutcome?: boolean;
  /** Timeout for action in ms */
  timeout?: number;
}

// ============================================================================
// Action Executor Class
// ============================================================================

export class ActionExecutor {
  private options: Required<ActionExecutorOptions>;

  constructor(options: ActionExecutorOptions = {}) {
    this.options = {
      waitForStability: options.waitForStability ?? true,
      verifyOutcome: options.verifyOutcome ?? true,
      timeout: options.timeout ?? 10000,
    };
  }

  /**
   * Execute an action
   */
  async execute(action: AgentAction): Promise<ActionResult> {
    const startTime = Date.now();

    try {
      let result: ActionResult;

      switch (action.type) {
        case 'click':
          result = await this.executeClick(action);
          break;
        case 'double_click':
          result = await this.executeDoubleClick(action);
          break;
        case 'right_click':
          result = await this.executeRightClick(action);
          break;
        case 'type':
          result = await this.executeType(action);
          break;
        case 'select':
          result = await this.executeSelect(action);
          break;
        case 'scroll':
          result = await this.executeScroll(action);
          break;
        case 'navigate':
          result = await this.executeNavigate(action);
          break;
        case 'keyboard':
          result = await this.executeKeyboard(action);
          break;
        case 'hover':
          result = await this.executeHover(action);
          break;
        case 'wait':
          result = await this.executeWait(action);
          break;
        case 'read':
          result = await this.executeRead(action);
          break;
        case 'copy':
          result = await this.executeCopy(action);
          break;
        case 'paste':
          result = await this.executePaste(action);
          break;
        case 'tab_switch':
          result = await this.executeTabSwitch(action);
          break;
        // Spreadsheet actions
        case 'click_cell':
        case 'type_in_cell':
        case 'type_in_header_column':
          result = await this.executeSpreadsheetAction(action);
          break;
        case 'done':
          result = { success: true, elapsedMs: 0 };
          break;
        case 'fail':
          result = {
            success: false,
            error: action.params.reason || 'Action failed',
            elapsedMs: 0,
          };
          break;
        default:
          result = {
            success: false,
            error: `Unknown action type: ${action.type}`,
            elapsedMs: 0,
          };
      }

      result.elapsedMs = Date.now() - startTime;

      // Wait for stability if requested
      if (this.options.waitForStability && result.success) {
        await this.waitForStability();
      }

      return result;

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Click Actions
  // ============================================================================

  private async executeClick(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    await this.performClick(element as HTMLElement, 'click');
    return { success: true, element, elapsedMs: 0 };
  }

  private async executeDoubleClick(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    await this.performClick(element as HTMLElement, 'dblclick');
    return { success: true, element, elapsedMs: 0 };
  }

  private async executeRightClick(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    await this.performClick(element as HTMLElement, 'contextmenu');
    return { success: true, element, elapsedMs: 0 };
  }

  private async performClick(
    element: HTMLElement,
    eventType: 'click' | 'dblclick' | 'contextmenu'
  ): Promise<void> {
    // Scroll into view
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    await this.wait(50);

    // Focus
    if (element.focus) {
      element.focus();
    }

    // Get coordinates
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const mouseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: eventType === 'contextmenu' ? 2 : 0,
    };

    // Dispatch events
    if (eventType === 'click') {
      element.dispatchEvent(new MouseEvent('mousedown', mouseInit));
      element.dispatchEvent(new MouseEvent('mouseup', mouseInit));
      element.dispatchEvent(new MouseEvent('click', mouseInit));
      if (element.click) element.click();
    } else if (eventType === 'dblclick') {
      element.dispatchEvent(new MouseEvent('mousedown', mouseInit));
      element.dispatchEvent(new MouseEvent('mouseup', mouseInit));
      element.dispatchEvent(new MouseEvent('click', mouseInit));
      element.dispatchEvent(new MouseEvent('mousedown', mouseInit));
      element.dispatchEvent(new MouseEvent('mouseup', mouseInit));
      element.dispatchEvent(new MouseEvent('click', mouseInit));
      element.dispatchEvent(new MouseEvent('dblclick', mouseInit));
    } else if (eventType === 'contextmenu') {
      element.dispatchEvent(new MouseEvent('contextmenu', mouseInit));
    }
  }

  // ============================================================================
  // Type/Input Actions
  // ============================================================================

  private async executeType(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target || action.params.fieldTarget);
    if (!element) {
      return { success: false, error: 'Input element not found', elapsedMs: 0 };
    }

    const text = action.params.text || '';
    const clearFirst = action.params.clearFirst ?? true;

    // Focus the element
    if ((element as HTMLElement).focus) {
      (element as HTMLElement).focus();
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      // Clear if needed
      if (clearFirst) {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Type the text
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

    } else if ((element as HTMLElement).isContentEditable) {
      // ContentEditable element
      if (clearFirst) {
        element.textContent = '';
      }
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));

    } else {
      return { success: false, error: 'Element is not editable', elapsedMs: 0 };
    }

    return { success: true, element, elapsedMs: 0 };
  }

  // ============================================================================
  // Select/Dropdown Actions
  // ============================================================================

  private async executeSelect(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Select element not found', elapsedMs: 0 };
    }

    const optionText = action.params.option;
    if (!optionText) {
      return { success: false, error: 'No option specified', elapsedMs: 0 };
    }

    // Handle native select
    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.options);
      const option = options.find(o =>
        o.textContent?.trim() === optionText ||
        o.value === optionText
      );

      if (option) {
        element.value = option.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, element, elapsedMs: 0 };
      }
      return { success: false, error: `Option not found: ${optionText}`, elapsedMs: 0 };
    }

    // Handle custom dropdown (click to open, then click option)
    await this.performClick(element as HTMLElement, 'click');
    await this.wait(200);

    // Try to find the option using XPath
    try {
      const xpath = `//*[@role='option' and normalize-space(.)='${optionText}'] | //*[@role='menuitem' and normalize-space(.)='${optionText}'] | //li[normalize-space(.)='${optionText}']`;
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const optionElement = result.singleNodeValue as HTMLElement;

      if (optionElement) {
        await this.performClick(optionElement, 'click');
        return { success: true, element: optionElement, elapsedMs: 0 };
      }
    } catch {
      // XPath failed
    }

    return { success: false, error: `Option not found: ${optionText}`, elapsedMs: 0 };
  }

  // ============================================================================
  // Scroll Actions
  // ============================================================================

  private async executeScroll(action: AgentAction): Promise<ActionResult> {
    const { direction, amount, scrollContainerSelector } = action.params;
    const scrollAmount = amount || 300;

    let scrollTarget: Element | Window = window;

    // Find scroll container
    if (scrollContainerSelector) {
      const container = document.querySelector(scrollContainerSelector);
      if (container) {
        scrollTarget = container;
      }
    } else if (action.params.target) {
      const element = await this.resolveTarget(action.params.target);
      if (element) {
        scrollTarget = element;
      }
    }

    // Calculate scroll delta
    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case 'down':
        deltaY = scrollAmount;
        break;
      case 'up':
        deltaY = -scrollAmount;
        break;
      case 'right':
        deltaX = scrollAmount;
        break;
      case 'left':
        deltaX = -scrollAmount;
        break;
    }

    // Perform scroll
    if (scrollTarget === window) {
      window.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });
    } else {
      (scrollTarget as Element).scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });
    }

    await this.wait(200);

    return { success: true, elapsedMs: 0 };
  }

  // ============================================================================
  // Navigation Actions
  // ============================================================================

  private async executeNavigate(action: AgentAction): Promise<ActionResult> {
    const url = action.params.url;
    if (!url) {
      return { success: false, error: 'No URL specified', elapsedMs: 0 };
    }

    window.location.href = url;
    return { success: true, elapsedMs: 0 };
  }

  // ============================================================================
  // Keyboard Actions
  // ============================================================================

  private async executeKeyboard(action: AgentAction): Promise<ActionResult> {
    const { key, modifiers, repeat } = action.params;
    const target = action.params.target
      ? await this.resolveTarget(action.params.target)
      : document.activeElement || document.body;

    const repeatCount = repeat || 1;

    const keyEventInit: KeyboardEventInit = {
      key: key || 'Enter',
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers?.includes('ctrl'),
      shiftKey: modifiers?.includes('shift'),
      altKey: modifiers?.includes('alt'),
      metaKey: modifiers?.includes('meta'),
    };

    for (let i = 0; i < repeatCount; i++) {
      target?.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
      target?.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

      if (repeatCount > 1) {
        await this.wait(50);
      }
    }

    return { success: true, elapsedMs: 0 };
  }

  // ============================================================================
  // Hover Actions
  // ============================================================================

  private async executeHover(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const mouseEnter = new MouseEvent('mouseenter', {
      bubbles: true,
      clientX: x,
      clientY: y,
    });
    element.dispatchEvent(mouseEnter);

    const mouseOver = new MouseEvent('mouseover', {
      bubbles: true,
      clientX: x,
      clientY: y,
    });
    element.dispatchEvent(mouseOver);

    // Hold hover for specified duration
    const duration = action.params.hoverDuration || 500;
    await this.wait(duration);

    return { success: true, element, elapsedMs: 0 };
  }

  // ============================================================================
  // Wait Actions
  // ============================================================================

  private async executeWait(action: AgentAction): Promise<ActionResult> {
    const duration = action.params.duration || 1000;
    await this.wait(duration);
    return { success: true, elapsedMs: 0 };
  }

  // ============================================================================
  // Read Actions
  // ============================================================================

  private async executeRead(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    const attribute = action.params.attribute || 'text';
    let value: string | boolean | number;

    switch (attribute) {
      case 'value':
        value = (element as HTMLInputElement).value;
        break;
      case 'text':
        value = element.textContent?.trim() || '';
        break;
      case 'checked':
        value = (element as HTMLInputElement).checked;
        break;
      case 'selected':
        value = (element as HTMLOptionElement).selected;
        break;
      case 'disabled':
        value = (element as HTMLInputElement).disabled;
        break;
      case 'visible':
        const style = window.getComputedStyle(element);
        value = style.display !== 'none' && style.visibility !== 'hidden';
        break;
      case 'count':
        value = 1; // Single element
        break;
      default:
        value = element.getAttribute(attribute) || '';
    }

    return { success: true, element, value, elapsedMs: 0 };
  }

  // ============================================================================
  // Copy/Paste Actions
  // ============================================================================

  private async executeCopy(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    let text = '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      text = element.value;
    } else {
      text = element.textContent || '';
    }

    try {
      await navigator.clipboard.writeText(text);
      return { success: true, element, value: text, elapsedMs: 0 };
    } catch {
      return { success: false, error: 'Clipboard write failed', elapsedMs: 0 };
    }
  }

  private async executePaste(action: AgentAction): Promise<ActionResult> {
    const element = await this.resolveTarget(action.params.target);
    if (!element) {
      return { success: false, error: 'Element not found', elapsedMs: 0 };
    }

    let text = action.params.text || '';

    // Try reading from clipboard if no text provided
    if (!text) {
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return { success: false, error: 'Clipboard read failed', elapsedMs: 0 };
      }
    }

    // Paste the text
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if ((element as HTMLElement).isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      return { success: false, error: 'Element is not editable', elapsedMs: 0 };
    }

    return { success: true, element, elapsedMs: 0 };
  }

  // ============================================================================
  // Tab Switch Actions
  // ============================================================================

  private async executeTabSwitch(action: AgentAction): Promise<ActionResult> {
    // Tab switching is handled by the service worker, not content script
    // Send message to service worker
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ACTIVATE_TAB',
        payload: {
          tabIndex: action.params.toTabIndex,
          url: action.params.toUrl,
          isNewTab: action.params.isNewTab,
        },
      });

      if (response?.success) {
        return { success: true, elapsedMs: 0 };
      } else {
        return { success: false, error: response?.error || 'Tab switch failed', elapsedMs: 0 };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tab switch failed',
        elapsedMs: 0,
      };
    }
  }

  // ============================================================================
  // Spreadsheet Actions
  // ============================================================================

  private async executeSpreadsheetAction(action: AgentAction): Promise<ActionResult> {
    // Delegate to SpreadsheetExecutor for complex spreadsheet operations
    const { SpreadsheetExecutor } = await import('../spreadsheet-executor');

    const result = await SpreadsheetExecutor.execute(action as any);

    return {
      success: result.success,
      value: result.value,
      error: result.error,
      elapsedMs: 0,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async resolveTarget(target?: SemanticTarget): Promise<Element | null> {
    if (!target) return null;

    // Try various resolution strategies

    // 1. Test ID
    if (target.testId) {
      const element = document.querySelector(`[data-testid="${target.testId}"]`);
      if (element) return element;
    }

    // 2. ARIA label
    if (target.name) {
      const byAriaLabel = document.querySelector(`[aria-label="${target.name}"]`);
      if (byAriaLabel) return byAriaLabel;

      // Try button text
      const buttons = document.querySelectorAll('button');
      for (const button of buttons) {
        if (button.textContent?.trim() === target.name) {
          return button;
        }
      }
    }

    // 3. Role + name
    if (target.role) {
      const byRole = document.querySelectorAll(`[role="${target.role}"]`);
      for (const el of byRole) {
        const name = el.getAttribute('aria-label') || el.textContent?.trim();
        if (name === target.name) {
          return el;
        }
      }
      if (byRole.length === 1) {
        return byRole[0];
      }
    }

    // 4. Text content
    if (target.text) {
      const xpath = `//*[normalize-space(text())="${target.text}"]`;
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      if (result.singleNodeValue) {
        return result.singleNodeValue as Element;
      }
    }

    // 5. Recorded fallback selectors
    if (target.recordedFallbackSelectors) {
      for (const selector of target.recordedFallbackSelectors) {
        try {
          if (selector.startsWith('//')) {
            const result = document.evaluate(
              selector,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            if (result.singleNodeValue) {
              return result.singleNodeValue as Element;
            }
          } else {
            const element = document.querySelector(selector);
            if (element) return element;
          }
        } catch {
          // Invalid selector
        }
      }
    }

    return null;
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForStability(): Promise<void> {
    const { waitForDOMStability } = await import('./fast-path');
    await waitForDOMStability({ maxWait: 500 });
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export default ActionExecutor;
