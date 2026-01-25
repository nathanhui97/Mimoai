/**
 * Fast Path Executor - Optimized Wrapper for Tier1Executor
 *
 * This module provides performance optimizations on top of Tier1Executor:
 * 1. Parallel selector resolution - Try multiple selectors simultaneously
 * 2. Smart wait optimization - Use MutationObserver instead of fixed delays
 * 3. Element caching - Cache resolved elements within a step sequence
 * 4. Early exit patterns - Skip unnecessary work for simple steps
 *
 * The goal is to reduce execution time from 15-25s to 3-5s for simple workflows.
 */

import type { AgentAction, SemanticTarget } from '../ai-agent';
import type { Tier1ExecutionResult } from '../tier1-executor';

// ============================================================================
// Types
// ============================================================================

/** Options for fast path execution */
export interface FastPathOptions {
  /** Maximum time to wait for element (ms) */
  timeout?: number;
  /** Enable parallel selector resolution */
  parallelResolution?: boolean;
  /** Use smart wait instead of fixed delays */
  smartWait?: boolean;
  /** Enable element caching */
  cacheElements?: boolean;
}

/** Cached element with timestamp */
interface CachedElement {
  element: Element;
  timestamp: number;
  target: SemanticTarget;
}

// ============================================================================
// Fast Path Executor
// ============================================================================

export class FastPathExecutor {
  private cache: Map<string, CachedElement> = new Map();
  private options: Required<FastPathOptions>;
  private cacheMaxAge = 5000; // 5 seconds

  constructor(options: FastPathOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 5000,
      parallelResolution: options.parallelResolution ?? true,
      smartWait: options.smartWait ?? true,
      cacheElements: options.cacheElements ?? true,
    };
  }

  /**
   * Execute action with fast path optimizations
   */
  async execute(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { Tier1Executor } = await import('../tier1-executor');

    // Check cache first
    if (this.options.cacheElements && action.params.target) {
      const cached = this.getCachedElement(action.params.target);
      if (cached && this.isElementValid(cached)) {
        console.log('[FastPath] Using cached element');
        return this.executeOnElement(action, cached);
      }
    }

    // Try parallel resolution for better performance
    if (this.options.parallelResolution && action.params.target) {
      const element = await this.resolveWithParallelStrategies(action.params.target);
      if (element) {
        if (this.options.cacheElements) {
          this.cacheElement(action.params.target, element);
        }
        return this.executeOnElement(action, element);
      }
    }

    // Fall back to standard Tier1Executor
    return Tier1Executor.execute(action);
  }

  /**
   * Resolve element using multiple strategies in parallel
   */
  private async resolveWithParallelStrategies(target: SemanticTarget): Promise<Element | null> {
    const strategies = this.buildResolutionStrategies(target);

    if (strategies.length === 0) {
      return null;
    }

    // Run all strategies in parallel
    const results = await Promise.all(
      strategies.map(async (strategy) => {
        try {
          const element = await strategy();
          return element;
        } catch {
          return null;
        }
      })
    );

    // Return first successful result
    const validElement = results.find((el) => el && this.isElementValid(el));
    return validElement || null;
  }

  /**
   * Build resolution strategies based on target properties
   */
  private buildResolutionStrategies(target: SemanticTarget): Array<() => Promise<Element | null>> {
    const strategies: Array<() => Promise<Element | null>> = [];

    // Test ID is highest priority (most stable)
    if (target.testId) {
      strategies.push(async () => {
        const selector = `[data-testid="${target.testId}"]`;
        return document.querySelector(selector);
      });
    }

    // ARIA label is second priority
    if (target.name) {
      strategies.push(async () => {
        // Try exact aria-label match
        const byAriaLabel = document.querySelector(`[aria-label="${target.name}"]`);
        if (byAriaLabel) return byAriaLabel;

        // Try button/link with matching text
        if (target.role === 'button' || target.role === 'link') {
          const elements = document.querySelectorAll(`${target.role === 'button' ? 'button' : 'a'}`);
          for (const el of elements) {
            if (el.textContent?.trim() === target.name) {
              return el;
            }
          }
        }

        return null;
      });
    }

    // Role-based lookup
    if (target.role) {
      strategies.push(async () => {
        const elements = document.querySelectorAll(`[role="${target.role}"]`);

        // If we have name, filter by it
        if (target.name) {
          for (const el of elements) {
            const ariaLabel = el.getAttribute('aria-label');
            const text = el.textContent?.trim();
            if (ariaLabel === target.name || text === target.name) {
              return el;
            }
          }
        }

        // If only one element with role, return it
        if (elements.length === 1) {
          return elements[0];
        }

        return null;
      });
    }

    // Text-based lookup
    if (target.text) {
      strategies.push(async () => {
        // Use XPath for text content search
        const xpath = `//*[normalize-space(text())="${target.text}"]`;
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue as Element | null;
      });
    }

    // Recorded fallback selectors (with container context)
    if (target.recordedFallbackSelectors) {
      for (const selector of target.recordedFallbackSelectors) {
        strategies.push(async () => {
          try {
            if (selector.startsWith('//')) {
              // XPath
              const result = document.evaluate(
                selector,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
              );
              return result.singleNodeValue as Element | null;
            } else {
              // CSS selector
              return document.querySelector(selector);
            }
          } catch {
            return null;
          }
        });
      }
    }

    return strategies;
  }

  /**
   * Execute action on a resolved element
   */
  private async executeOnElement(action: AgentAction, element: Element): Promise<Tier1ExecutionResult> {
    try {
      switch (action.type) {
        case 'click':
          await this.performClick(element as HTMLElement);
          return { status: 'success', details: { element } };

        case 'type':
          if (action.params.text && element instanceof HTMLInputElement) {
            if (action.params.clearFirst) {
              element.value = '';
              element.dispatchEvent(new Event('input', { bubbles: true }));
            }
            element.value = action.params.text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return { status: 'success', details: { element } };
          }
          break;

        case 'keyboard':
          if (action.params.key) {
            const keyEvent = new KeyboardEvent('keydown', {
              key: action.params.key,
              bubbles: true,
              cancelable: true,
            });
            element.dispatchEvent(keyEvent);
            return { status: 'success', details: { element } };
          }
          break;
      }

      // Fall back to Tier1Executor for complex actions
      const { Tier1Executor } = await import('../tier1-executor');
      return Tier1Executor.execute(action);

    } catch (error) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          element,
          interactabilityIssue: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Perform a click on an element with proper event sequence
   */
  private async performClick(element: HTMLElement): Promise<void> {
    // Scroll into view if needed
    element.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Wait a tiny bit for scroll to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Focus the element first
    if (element.focus) {
      element.focus();
    }

    // Dispatch mouse events in proper sequence
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const mouseEventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    };

    element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
    element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
    element.dispatchEvent(new MouseEvent('click', mouseEventInit));

    // If it's a native clickable element, also call click()
    if (element.click) {
      element.click();
    }
  }

  /**
   * Check if element is still valid (visible and interactable)
   */
  private isElementValid(element: Element): boolean {
    if (!element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    return true;
  }

  /**
   * Generate cache key from target
   */
  private getCacheKey(target: SemanticTarget): string {
    return JSON.stringify({
      testId: target.testId,
      name: target.name,
      role: target.role,
      text: target.text,
    });
  }

  /**
   * Get cached element if valid
   */
  private getCachedElement(target: SemanticTarget): Element | null {
    const key = this.getCacheKey(target);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.cacheMaxAge) {
      this.cache.delete(key);
      return null;
    }

    // Check if element is still valid
    if (!this.isElementValid(cached.element)) {
      this.cache.delete(key);
      return null;
    }

    return cached.element;
  }

  /**
   * Cache an element
   */
  private cacheElement(target: SemanticTarget, element: Element): void {
    const key = this.getCacheKey(target);
    this.cache.set(key, {
      element,
      timestamp: Date.now(),
      target,
    });
  }

  /**
   * Clear element cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Smart Wait - MutationObserver-based stability detection
// ============================================================================

/**
 * Wait for DOM stability using MutationObserver
 * More efficient than fixed delays
 */
export async function waitForDOMStability(options: {
  maxWait?: number;
  stabilityThreshold?: number;
} = {}): Promise<void> {
  const { maxWait = 1500, stabilityThreshold = 100 } = options;

  return new Promise((resolve) => {
    let lastMutationTime = Date.now();
    let resolved = false;

    const observer = new MutationObserver(() => {
      lastMutationTime = Date.now();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Check stability periodically
    const checkInterval = setInterval(() => {
      const timeSinceLastMutation = Date.now() - lastMutationTime;

      if (timeSinceLastMutation >= stabilityThreshold) {
        cleanup();
        resolve();
      }
    }, 50);

    // Max wait timeout
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, maxWait);

    function cleanup() {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      clearInterval(checkInterval);
      clearTimeout(timeout);
    }
  });
}

// ============================================================================
// Module Exports
// ============================================================================

export { FastPathExecutor as default };
