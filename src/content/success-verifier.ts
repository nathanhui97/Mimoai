/**
 * SuccessVerifier - Verify compound success conditions
 * 
 * Handles AND/OR/NOT combinations recursively.
 * All conditions are required by default.
 */

import type { 
  SuccessCondition, 
  AllCondition, 
  AnyCondition, 
  NotCondition,
  ElementCondition, 
  StateCondition 
} from '../types/conditions';
import { 
  isAllCondition, 
  isAnyCondition, 
  isNotCondition, 
  isElementCondition, 
  isStateCondition 
} from '../types/conditions';
import type { Scope } from '../types/scope';
import { resolveScopeContainer } from '../types/scope';
import { StateWaitEngine } from './state-wait-engine';

/**
 * Result of verification
 */
export interface VerificationResult {
  /** Whether verification passed */
  passed: boolean;
  /** The condition that was verified */
  condition: SuccessCondition;
  /** Reason for failure (if failed) */
  failureReason?: string;
  /** Time taken in ms */
  elapsedMs: number;
  /** Details about sub-conditions (for compound conditions) */
  details?: VerificationResult[];
}

/**
 * SuccessVerifier handles verification of compound success conditions
 */
export class SuccessVerifier {
  // Track original URL for url_changed detection
  private static originalUrl: string = '';
  
  /**
   * Set the original URL before action (for url_changed detection)
   */
  static capturePreActionState(): void {
    this.originalUrl = window.location.href;
  }
  
  /**
   * Verify a success condition
   */
  static async verify(
    condition: SuccessCondition,
    scope?: Scope
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    
    try {
      // Handle compound conditions
      if (isAllCondition(condition)) {
        return await this.verifyAll(condition, scope, startTime);
      }
      
      if (isAnyCondition(condition)) {
        return await this.verifyAny(condition, scope, startTime);
      }
      
      if (isNotCondition(condition)) {
        return await this.verifyNot(condition, scope, startTime);
      }
      
      // Handle leaf conditions
      if (isElementCondition(condition)) {
        return await this.verifyElement(condition, startTime);
      }
      
      if (isStateCondition(condition)) {
        return await this.verifyState(condition, startTime);
      }
      
      return {
        passed: false,
        condition,
        failureReason: 'Unknown condition type',
        elapsedMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        passed: false,
        condition,
        failureReason: error instanceof Error ? error.message : 'Verification error',
        elapsedMs: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Verify ALL conditions (AND)
   */
  private static async verifyAll(
    condition: AllCondition,
    scope: Scope | undefined,
    startTime: number
  ): Promise<VerificationResult> {
    const details: VerificationResult[] = [];
    
    for (const subCondition of condition.all) {
      const subResult = await this.verify(subCondition, scope);
      details.push(subResult);
      
      if (!subResult.passed) {
        return {
          passed: false,
          condition,
          failureReason: `Failed condition: ${subResult.failureReason}`,
          elapsedMs: Date.now() - startTime,
          details,
        };
      }
    }
    
    return {
      passed: true,
      condition,
      elapsedMs: Date.now() - startTime,
      details,
    };
  }
  
  /**
   * Verify ANY condition (OR)
   */
  private static async verifyAny(
    condition: AnyCondition,
    scope: Scope | undefined,
    startTime: number
  ): Promise<VerificationResult> {
    const details: VerificationResult[] = [];
    
    for (const subCondition of condition.any) {
      const subResult = await this.verify(subCondition, scope);
      details.push(subResult);
      
      if (subResult.passed) {
        return {
          passed: true,
          condition,
          elapsedMs: Date.now() - startTime,
          details,
        };
      }
    }
    
    return {
      passed: false,
      condition,
      failureReason: 'No conditions in ANY block passed',
      elapsedMs: Date.now() - startTime,
      details,
    };
  }
  
  /**
   * Verify NOT condition (negation)
   */
  private static async verifyNot(
    condition: NotCondition,
    scope: Scope | undefined,
    startTime: number
  ): Promise<VerificationResult> {
    const subResult = await this.verify(condition.not, scope);
    
    return {
      passed: !subResult.passed,
      condition,
      failureReason: subResult.passed ? 'Condition passed when it should not have' : undefined,
      elapsedMs: Date.now() - startTime,
      details: [subResult],
    };
  }
  
  /**
   * Verify element conditions
   */
  private static async verifyElement(
    condition: ElementCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const container = condition.scope 
      ? resolveScopeContainer(condition.scope)
      : document.body;
    
    if (!container) {
      return {
        passed: false,
        condition,
        failureReason: 'Could not resolve scope container',
        elapsedMs: Date.now() - startTime,
      };
    }
    
    switch (condition.type) {
      case 'element_visible':
        return await this.waitForElementVisible(condition, container, startTime);
        
      case 'element_gone':
        return await this.waitForElementGone(condition, container, startTime);
        
      case 'element_enabled':
        return await this.waitForElementEnabled(condition, container, startTime);
        
      case 'element_disabled':
        return await this.waitForElementDisabled(condition, container, startTime);
        
      case 'element_checked':
        return await this.waitForElementChecked(condition, container, startTime);
        
      case 'element_unchecked':
        return await this.waitForElementUnchecked(condition, container, startTime);
        
      case 'element_focused':
        return await this.waitForElementFocused(condition, container, startTime);
        
      case 'element_has_text':
        return await this.waitForElementHasText(condition, container, startTime);
        
      case 'element_has_value':
        return await this.waitForElementHasValue(condition, container, startTime);
        
      case 'element_has_attribute':
        return await this.waitForElementHasAttribute(condition, container, startTime);
        
      default:
        return {
          passed: false,
          condition,
          failureReason: `Unknown element condition type: ${(condition as any).type}`,
          elapsedMs: Date.now() - startTime,
        };
    }
  }
  
  /**
   * Verify state conditions
   */
  private static async verifyState(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    switch (condition.type) {
      case 'url_changed':
        return await this.waitForURLChanged(condition, startTime);
        
      case 'url_contains':
        return await this.waitForURLContains(condition, startTime);
        
      case 'url_matches':
        return await this.waitForURLMatches(condition, startTime);
        
      case 'text_appeared':
        return await this.waitForTextAppeared(condition, startTime);
        
      case 'text_gone':
        return await this.waitForTextGone(condition, startTime);
        
      case 'title_contains':
        return await this.waitForTitleContains(condition, startTime);
        
      case 'dom_stable':
        return await this.waitForDOMStable(condition, startTime);
        
      case 'network_idle':
        return await this.waitForNetworkIdle(condition, startTime);
        
      case 'no_loaders':
        return await this.waitForNoLoaders(condition, startTime);
        
      default:
        return {
          passed: false,
          condition,
          failureReason: `Unknown state condition type: ${(condition as any).type}`,
          elapsedMs: Date.now() - startTime,
        };
    }
  }
  
  // ============ Element condition implementations ============
  
  private static async waitForElementVisible(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && this.isVisible(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" not visible after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementGone(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (!element || !this.isVisible(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" still present after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementEnabled(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && !this.isDisabled(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" not enabled after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementDisabled(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && this.isDisabled(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" not disabled after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementChecked(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && this.isChecked(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" not checked after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementUnchecked(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && !this.isChecked(element)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" still checked after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementFocused(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && document.activeElement === element) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" not focused after ${condition.timeout}ms`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementHasText(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    const expectedText = condition.expectedValue?.toLowerCase() || '';
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element) {
        const text = element.textContent?.toLowerCase() || '';
        if (text.includes(expectedText)) {
          return { passed: true, condition, elapsedMs: Date.now() - startTime };
        }
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" does not have text "${condition.expectedValue}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementHasValue(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element instanceof HTMLInputElement || 
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement) {
        if (element.value === condition.expectedValue) {
          return { passed: true, condition, elapsedMs: Date.now() - startTime };
        }
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" does not have value "${condition.expectedValue}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForElementHasAttribute(
    condition: ElementCondition,
    container: Element,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    
    while (Date.now() < endTime) {
      const element = this.findElement(condition.target, container);
      if (element && condition.attributeName) {
        const attrValue = element.getAttribute(condition.attributeName);
        if (attrValue === condition.expectedValue) {
          return { passed: true, condition, elapsedMs: Date.now() - startTime };
        }
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Element "${condition.target}" does not have ${condition.attributeName}="${condition.expectedValue}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  // ============ State condition implementations ============
  
  private static async waitForURLChanged(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForURLChange(this.originalUrl, condition.timeout);
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : 'URL did not change',
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForURLContains(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForURLContains(condition.value || '', condition.timeout);
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : `URL does not contain "${condition.value}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForURLMatches(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    const pattern = new RegExp(condition.value || '');
    
    while (Date.now() < endTime) {
      if (pattern.test(window.location.href)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `URL does not match pattern "${condition.value}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForTextAppeared(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForText(
      condition.value || '', 
      condition.scope, 
      condition.timeout
    );
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : `Text "${condition.value}" not found`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForTextGone(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForTextGone(
      condition.value || '', 
      condition.scope, 
      condition.timeout
    );
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : `Text "${condition.value}" still present`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForTitleContains(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const endTime = startTime + condition.timeout;
    const expectedTitle = condition.value?.toLowerCase() || '';
    
    while (Date.now() < endTime) {
      if (document.title.toLowerCase().includes(expectedTitle)) {
        return { passed: true, condition, elapsedMs: Date.now() - startTime };
      }
      await this.sleep(100);
    }
    
    return {
      passed: false,
      condition,
      failureReason: `Title does not contain "${condition.value}"`,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForDOMStable(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForDOMStable(300, condition.timeout);
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : 'DOM not stable',
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForNetworkIdle(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForNetworkIdle({
      idleMs: 500,
      timeoutMs: condition.timeout,
    });
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : 'Network not idle',
      elapsedMs: Date.now() - startTime,
    };
  }
  
  private static async waitForNoLoaders(
    condition: StateCondition,
    startTime: number
  ): Promise<VerificationResult> {
    const result = await StateWaitEngine.waitForLoadersGone(condition.timeout);
    
    return {
      passed: result.success,
      condition,
      failureReason: result.success ? undefined : 'Loaders still visible',
      elapsedMs: Date.now() - startTime,
    };
  }
  
  // ============ Helper methods ============
  
  private static findElement(target: string, container: Element): Element | null {
    // Try as selector first
    try {
      const element = container.querySelector(target);
      if (element) return element;
    } catch (e) {
      // Not a valid selector, try as text
    }
    
    // Try to find by text content
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node instanceof Element) {
        const text = node.textContent?.trim().toLowerCase() || '';
        if (text === target.toLowerCase()) {
          return node;
        }
      }
    }
    
    return null;
  }
  
  private static isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    return true;
  }
  
  private static isDisabled(element: Element): boolean {
    if (element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) {
      return element.disabled;
    }
    return element.getAttribute('aria-disabled') === 'true';
  }
  
  private static isChecked(element: Element): boolean {
    if (element instanceof HTMLInputElement) {
      return element.checked;
    }
    return element.getAttribute('aria-checked') === 'true';
  }
  
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}








