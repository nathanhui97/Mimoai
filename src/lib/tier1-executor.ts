/**
 * Tier 1 Executor - Deterministic "Hands + Reflexes"
 * 
 * Responsibilities:
 * - Resolve targets in DOM using existing Resolver
 * - Scope/container resolution
 * - Interactability checks
 * - Safe clicking/typing with action primitives
 * - Stability waits
 * - Outcome verification
 * - Recovery actions
 * 
 * NEVER calls LLM - only returns structured rejection codes.
 */

import type { AgentAction, SemanticTarget, ExpectedOutcome } from './ai-agent';
import { Resolver, type ResolveResult } from '../content/resolver';
import { StateWaitEngine } from '../content/state-wait-engine';
import type { LocatorBundle, LocatorStrategy } from '../types/locator';
import type { Intent } from '../types/intent';

// ============================================================================
// Types
// ============================================================================

/**
 * Explicit rejection codes (not generic errors)
 */
export type RejectionCode = 
  | 'NOT_FOUND'        // No candidates matched
  | 'AMBIGUOUS'        // Multiple candidates, can't decide
  | 'NOT_INTERACTABLE' // Element found but not clickable/visible
  | 'SCOPE_FAILED'     // Scope container not found
  | 'UNSAFE_ACTION'    // Would click delete/confirm in popup
  | 'OUTCOME_FAILED';  // Action succeeded but outcome verification failed

/**
 * Execution result with explicit rejection codes
 */
export interface Tier1ExecutionResult {
  status: 'success' | 'rejected';
  code?: RejectionCode;
  details: {
    // For NOT_FOUND / AMBIGUOUS
    matchCount?: number;
    candidates?: Array<{ role: string; name: string; text?: string }>;
    triedStrategies?: string[];
    
    // For SCOPE_FAILED
    scopeStatus?: string;
    
    // For NOT_INTERACTABLE
    interactabilityIssue?: string;
    
    // For OUTCOME_FAILED
    outcomeResult?: string;
    expectedOutcome?: ExpectedOutcome;
    
    // For UNSAFE_ACTION
    dangerousPattern?: string;
    
    // General
    element?: Element;
    resolveMetrics?: any;
    
    // For read action
    value?: string | boolean | number;
  };
  message?: string;
}

// ============================================================================
// Tier 1 Executor
// ============================================================================

export class Tier1Executor {
  /**
   * Execute an action with full deterministic safety checks
   */
  static async execute(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.log(`[Tier1] 🎯 Executing: ${action.type}`, action.params.target || action.params);

    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action);
        
        case 'type':
          return await this.executeType(action);
        
        case 'select':
          return await this.executeSelect(action);
        
        case 'scroll':
          return await this.executeScroll(action);
        
        case 'navigate':
          return await this.executeNavigate(action);
        
        case 'wait':
          return await this.executeWait(action);
        
        case 'assert':
          return await this.executeAssert(action);
        
        case 'read':
          return await this.executeRead(action);
        
        case 'keyboard':
          return await this.executeKeyboard(action);
        
        case 'hover':
          return await this.executeHover(action);
        
        case 'done':
          return { status: 'success', details: {} };
        
        case 'fail':
          return {
            status: 'rejected',
            code: 'NOT_FOUND',
            details: {},
            message: action.params.reason || 'Agent decided to fail',
          };
        
        default:
          return {
            status: 'rejected',
            code: 'UNSAFE_ACTION',
            details: { dangerousPattern: `Unknown action type: ${action.type}` },
          };
      }
    } catch (error) {
      console.error('[Tier1] Error:', error);
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute click with full resolution pipeline
   */
  private static async executeClick(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, expectedOutcome } = action.params;
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified',
      };
    }

    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' };
    
    // Resolve element using Resolver
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Check interactability
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }
    
    // Check if this is a dangerous action (delete/confirm in popup)
    const safetyCheck = this.checkActionSafety(element, 'click');
    if (!safetyCheck.safe) {
      return {
        status: 'rejected',
        code: 'UNSAFE_ACTION',
        details: {
          dangerousPattern: safetyCheck.reason,
          element,
        },
        message: safetyCheck.reason,
      };
    }
    
    // CRITICAL: Verify we're clicking the RIGHT element (exact text match for options)
    // This prevents clicking "BOGA" when AI wanted "BOGO" or "DISCOUNTED" when AI wanted "BOGO"
    if (target.role === 'option' || target.role === 'menuitem') {
      const actualText = element.textContent?.trim() || '';
      const targetText = target.text || target.name || '';
      
      if (targetText && actualText.toLowerCase() !== targetText.toLowerCase()) {
        console.warn(`[Tier1] ❌ Text mismatch: AI wanted "${targetText}", but would click "${actualText}"`);
        return {
          status: 'rejected',
          code: 'AMBIGUOUS',
          details: {
            matchCount: 1,
            candidates: [{ role: target.role, name: actualText, text: actualText }],
            element,
          },
          message: `Element text "${actualText}" doesn't match requested "${targetText}"`,
        };
      }
    }
    
    // Execute click
    const actualElementText = element.textContent?.trim().substring(0, 50) || '';
    console.log(`[Tier1] ✅ Clicking element: ${element.tagName} ${actualElementText}`);
    this.clickElement(element);
    
    // Wait for stability
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      networkQuietMs: 200,
      maxWaitMs: 3000,
    });
    
    // Verify outcome if specified
    if (expectedOutcome) {
      const outcomeResult = await this.verifyOutcome(expectedOutcome);
      if (!outcomeResult.success) {
        return {
          status: 'rejected',
          code: 'OUTCOME_FAILED',
          details: {
            outcomeResult: outcomeResult.message,
            expectedOutcome,
            element,
          },
          message: outcomeResult.message,
        };
      }
    }
    
    return {
      status: 'success',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
    };
  }

  /**
   * Execute type action
   */
  private static async executeType(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { text, fieldTarget, clearFirst } = action.params;
    
    // Debug logging
    console.log('[Tier1] 📝 Type action params:', {
      hasFieldTarget: !!fieldTarget,
      fieldTarget: fieldTarget ? { role: fieldTarget.role, name: fieldTarget.name, id: fieldTarget.id } : null,
      text: text?.substring(0, 20),
    });
    
    if (!text) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No text specified',
      };
    }
    
    let element: Element | null = null;
    
    // If fieldTarget specified, resolve it
    if (fieldTarget) {
      console.log('[Tier1] 🎯 Resolving fieldTarget:', fieldTarget.name || fieldTarget.role);
      const bundle = this.buildLocatorBundle(fieldTarget);
      const intent: Intent = { kind: 'TYPE', valueVar: 'value' };
      const resolveResult = await this.resolveElement(bundle, intent);
      
      if (resolveResult.status !== 'success') {
        console.log('[Tier1] ❌ Failed to resolve fieldTarget, falling back to activeElement');
        // Fall back to activeElement instead of failing
        element = document.activeElement as Element;
        if (!element || element === document.body) {
          return resolveResult;
        }
      } else {
        element = resolveResult.details.element!;
      }
    } else {
      // Use focused element
      console.log('[Tier1] ⚠️ No fieldTarget provided, using activeElement');
      element = document.activeElement;
      if (!element || element === document.body) {
        return {
          status: 'rejected',
          code: 'NOT_FOUND',
          details: {},
          message: 'No field focused and no fieldTarget specified',
        };
      }
    }
    
    // Check if element accepts input
    const isInput = element instanceof HTMLInputElement ||
                   element instanceof HTMLTextAreaElement ||
                   element.getAttribute('contenteditable') === 'true';
    
    if (!isInput) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: `Element ${element.tagName} does not accept text input`,
          element,
        },
      };
    }
    
    // Log which element we're typing into
    const elementId = (element as HTMLElement).id || 'no-id';
    const elementName = element.getAttribute('aria-label') || element.getAttribute('name') || 'no-name';
    console.log(`[Tier1] ⌨️ Typing into: ${element.tagName} id="${elementId}" name="${elementName}"`);
    
    // Focus element
    (element as HTMLElement).focus();
    await this.sleep(50);  // Brief pause after focus
    
    // Clear if requested
    if (clearFirst && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(50);
    }
    
    // Type using native setter (React-friendly)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, text);
      } else {
        element.value = text;
      }
      
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));  // Some fields need blur to commit
    } else {
      // Contenteditable
      (element as HTMLElement).textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
    
    console.log('[Tier1] ⌨️ Typed:', text.substring(0, 50), '→ Final value:', (element as any).value || (element as HTMLElement).textContent?.substring(0, 50));
    
    return {
      status: 'success',
      details: { element },
    };
  }

  /**
   * Execute select (dropdown)
   */
  private static async executeSelect(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, option } = action.params;
    
    if (!option) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No option specified',
      };
    }
    
    // First, open dropdown if target specified
    if (target) {
      const clickResult = await this.executeClick({
        ...action,
        type: 'click',
        params: { target, description: 'Open dropdown' },
      });
      
      if (clickResult.status !== 'success') {
        return clickResult;
      }
      
      // Wait for dropdown to open (optimized from 300ms)
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    // Find and click option
    const optionTarget: SemanticTarget = {
      role: 'option',
      text: option,
    };
    
    const bundle = this.buildLocatorBundle(optionTarget);
    const intent: Intent = { kind: 'SELECT_DROPDOWN_OPTION', optionVar: 'option' };
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    this.clickElement(element);
    
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });
    
    return {
      status: 'success',
      details: { element },
    };
  }

  /**
   * Execute scroll
   * MODAL-AWARE: Scrolls within modal if one is open, otherwise scrolls the page
   */
  private static async executeScroll(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { direction, amount = 300, scrollContainerSelector } = action.params;
    
    const scrollOptions: ScrollToOptions = { behavior: 'smooth' };
    let scrollTarget: Element | Window = window;
    
    // PRIORITY 1: Use recorded scroll container selector if provided
    // This is what the user recorded, so it should be used first!
    if (scrollContainerSelector) {
      try {
        const container = document.querySelector(scrollContainerSelector);
        if (container) {
          // Check if container is scrollable:
          // 1. Has overflow CSS allowing scroll, OR
          // 2. Has scrollable content (scrollHeight > clientHeight)
          const style = window.getComputedStyle(container);
          const hasOverflowCSS = style.overflow === 'auto' || style.overflow === 'scroll' || 
                                style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                                style.overflow === 'hidden'; // hidden can still be scrolled via JS
          const hasScrollableContent = container.scrollHeight > container.clientHeight;
          
          if (hasOverflowCSS || hasScrollableContent) {
            scrollTarget = container;
            console.log(`[Tier1] 📜 Using recorded scroll container: "${scrollContainerSelector}" (scrollHeight: ${container.scrollHeight}, clientHeight: ${container.clientHeight})`);
          } else {
            console.warn(`[Tier1] ⚠️ Recorded container "${scrollContainerSelector}" found but not scrollable`);
          }
        } else {
          console.warn(`[Tier1] ⚠️ Recorded scroll container "${scrollContainerSelector}" not found in DOM`);
        }
      } catch (e) {
        console.warn(`[Tier1] ⚠️ Invalid scroll container selector: "${scrollContainerSelector}"`);
      }
    }
    
    // PRIORITY 2: Auto-detect scrollable container using SMART heuristics
    if (scrollTarget === window) {
      console.log('[Tier1] 📜 Auto-detecting scrollable container...');
      
      // Strategy 1: Find ALL potentially scrollable elements
      const allElements = document.querySelectorAll('*');
      const scrollableCandidates: Array<{ element: Element; score: number; reason: string }> = [];
      
      for (const el of Array.from(allElements)) {
        const style = window.getComputedStyle(el);
        const hasScrollableContent = el.scrollHeight > el.clientHeight + 10; // +10px tolerance
        
        if (!hasScrollableContent) continue;
        
        // Check if it has overflow that allows scrolling
        const canScroll = style.overflow === 'auto' || style.overflow === 'scroll' || 
                         style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                         style.overflow === 'hidden'; // hidden can still be JS scrolled
        
        if (!canScroll) continue;
        
        // Score this candidate
        let score = 0;
        const className = el.className?.toString() || '';
        const tagName = el.tagName.toLowerCase();
        
        // Prefer elements with content-related classes
        if (className.includes('content')) score += 50;
        if (className.includes('main')) score += 40;
        if (className.includes('scroll')) score += 30;
        if (className.includes('wrapper')) score += 20;
        if (className.includes('container')) score += 10;
        if (className.includes('page')) score += 15;
        if (className.includes('app')) score += 10;
        if (className.includes('viewer')) score += 25;
        if (className.includes('renderer')) score += 25;
        
        // Prefer semantic elements
        if (tagName === 'main') score += 60;
        if (el.getAttribute('role') === 'main') score += 55;
        
        // Prefer elements with large scrollable area (actual content)
        const scrollableHeight = el.scrollHeight - el.clientHeight;
        if (scrollableHeight > 500) score += 30;
        else if (scrollableHeight > 200) score += 20;
        else if (scrollableHeight > 100) score += 10;
        
        // Deprioritize body (too generic)
        if (tagName === 'body') score -= 20;
        
        // Only consider elements with reasonable score
        if (score > 0) {
          scrollableCandidates.push({
            element: el,
            score,
            reason: `${tagName}.${className.split(' ')[0] || 'no-class'} (scrollHeight: ${el.scrollHeight}, clientHeight: ${el.clientHeight})`,
          });
        }
      }
      
      // Sort by score and pick the best
      if (scrollableCandidates.length > 0) {
        scrollableCandidates.sort((a, b) => b.score - a.score);
        scrollTarget = scrollableCandidates[0].element;
        console.log(`[Tier1] 📜 Smart-detected scrollable container (score: ${scrollableCandidates[0].score}): ${scrollableCandidates[0].reason}`);
        
        // Log top 3 candidates for debugging
        if (scrollableCandidates.length > 1) {
          console.log(`[Tier1] 📜 Other candidates:`, scrollableCandidates.slice(1, 3).map(c => `${c.reason} (score: ${c.score})`));
        }
      } else {
        console.log('[Tier1] ⚠️ No scrollable container detected, will scroll window');
      }
    }
    
    // Priority 3: Check if there's an active modal - if so, scroll within it
    if (scrollTarget === window) {
      const modalSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.modal',
        '[class*="Modal"]',
        '[class*="dialog"]',
        '[class*="Dialog"]',
        '[class*="popup"]',
        '[class*="Popup"]',
      ];
      
      for (const selector of modalSelectors) {
        const modals = Array.from(document.querySelectorAll(selector));
        for (const modal of modals) {
          const style = window.getComputedStyle(modal);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          const zIndex = parseInt(style.zIndex) || 0;
          
          if (isVisible && zIndex > 50) {
            // Found an active modal - look for scrollable container within it
            const scrollableContainer = this.findScrollableContainer(modal);
            if (scrollableContainer) {
              scrollTarget = scrollableContainer;
              console.log('[Tier1] 📜 Found scrollable modal container');
              break;
            }
          }
        }
        if (scrollTarget !== window) break;
      }
    }
    
    // Perform scroll
    if (scrollTarget === window) {
      console.log(`[Tier1] 📜 Scrolling window ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          window.scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          window.scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          window.scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          window.scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    } else {
      const targetName = scrollContainerSelector || 'container';
      console.log(`[Tier1] 📜 Scrolling ${targetName} ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          (scrollTarget as Element).scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          (scrollTarget as Element).scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          (scrollTarget as Element).scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          (scrollTarget as Element).scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    }
    
    // Wait for scroll animation to complete (optimized from 300ms)
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Wait for lazy-loaded content to render (critical for dashboards like Gainsight!)
    // Use StateWaitEngine to wait for actual DOM stability
    try {
      const { StateWaitEngine } = await import('../content/state-wait-engine');
      const stabilityResult = await StateWaitEngine.waitForStability({
        domQuietMs: 800,      // Wait 800ms of no DOM changes
        networkQuietMs: 1000, // Wait 1s of no network activity  
        maxWaitMs: 5000,      // Max 5s total wait
        checkSpinners: true,  // Wait for loading spinners
      });
      console.log('[Tier1] 📜 Post-scroll stability:', 
        stabilityResult.domStable ? '✅ DOM stable' : '⚠️ DOM changing',
        stabilityResult.spinnersGone ? '✅ No spinners' : '⚠️ Loading'
      );
    } catch (e) {
      // Fallback if StateWaitEngine not available
      console.log('[Tier1] ⚠️ StateWaitEngine not available, using 2s delay');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return { status: 'success', details: {} };
  }
  
  /**
   * Find scrollable container within an element
   */
  private static findScrollableContainer(element: Element): Element | null {
    // Check if element itself is scrollable
    const style = window.getComputedStyle(element);
    const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                        style.overflowY === 'auto' || style.overflowY === 'scroll';
    
    if (isScrollable && element.scrollHeight > element.clientHeight) {
      return element;
    }
    
    // Look for scrollable children
    const children = Array.from(element.querySelectorAll('*'));
    for (const child of children) {
      const childStyle = window.getComputedStyle(child);
      const isChildScrollable = childStyle.overflow === 'auto' || childStyle.overflow === 'scroll' || 
                               childStyle.overflowY === 'auto' || childStyle.overflowY === 'scroll';
      
      if (isChildScrollable && child.scrollHeight > child.clientHeight) {
        return child;
      }
    }
    
    return null;
  }

  /**
   * Execute navigation
   * @deprecated Direct URL navigation is deprecated - use click-through instead.
   * All NAVIGATION steps should be converted to CLICK actions in the agent.
   * This prevents navigating to stale URLs (e.g., wrong account IDs).
   */
  private static async executeNavigate(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.warn('[Tier1] ⚠️ Direct navigation is DEPRECATED - should use click-through instead');
    console.warn('[Tier1] ⚠️ NAVIGATION steps should be converted to CLICK in extractHints()');
    
    const { url } = action.params;
    
    if (!url) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No URL specified (direct navigation is deprecated - use click-through)',
      };
    }
    
    // Still allow it for backwards compatibility, but warn
    console.warn(`[Tier1] ⚠️ Navigating directly to: ${url} (this should not happen in normal operation)`);
    window.location.href = url;
    
    return { status: 'success', details: {} };
  }

  /**
   * Execute wait
   */
  private static async executeWait(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { duration = 1000, waitFor } = action.params;
    
    if (waitFor) {
      const startTime = Date.now();
      const timeout = duration || 5000;
      
      while (Date.now() - startTime < timeout) {
        if (document.body.textContent?.includes(waitFor)) {
          return { status: 'success', details: {} };
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      return {
        status: 'rejected',
        code: 'OUTCOME_FAILED',
        details: { outcomeResult: `Timeout waiting for: ${waitFor}` },
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, duration));
    return { status: 'success', details: {} };
  }

  /**
   * Execute assertion
   */
  private static async executeAssert(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { assertion } = action.params;
    
    if (!assertion) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No assertion specified',
      };
    }
    
    if (document.body.textContent?.includes(assertion)) {
      return { status: 'success', details: {} };
    }
    
    return {
      status: 'rejected',
      code: 'OUTCOME_FAILED',
      details: { outcomeResult: `Assertion failed: "${assertion}" not found` },
    };
  }

  /**
   * Execute read action - query element values
   */
  private static async executeRead(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, attribute = 'value' } = action.params;
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified for read action',
      };
    }
    
    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' }; // Use CLICK intent for resolution
    
    // Resolve element
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Read value based on attribute
    let value: string | boolean | number;
    try {
      switch (attribute) {
        case 'value':
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            value = element.value;
          } else {
            value = element.getAttribute('value') || '';
          }
          break;
        
        case 'text':
          value = element.textContent?.trim() || '';
          break;
        
        case 'checked':
          if (element instanceof HTMLInputElement) {
            value = element.checked;
          } else {
            value = element.getAttribute('aria-checked') === 'true';
          }
          break;
        
        case 'selected':
          if (element instanceof HTMLOptionElement) {
            value = element.selected;
          } else {
            value = element.getAttribute('aria-selected') === 'true';
          }
          break;
        
        case 'count':
          // Count matching elements (use the target selector)
          const selector = target.testId ? `[data-testid="${target.testId}"]` : 
                          target.id ? `#${target.id}` : 
                          target.role ? `[role="${target.role}"]` : '*';
          value = document.querySelectorAll(selector).length;
          break;
        
        default:
          value = '';
      }
      
      console.log(`[Tier1] 📖 Read ${attribute} from element: ${value}`);
      
      return {
        status: 'success',
        details: {
          element,
          value, // Store the read value in details
          resolveMetrics: resolveResult.details.resolveMetrics,
        },
      };
    } catch (error) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: error instanceof Error ? error.message : 'Failed to read value',
      };
    }
  }

  /**
   * Execute keyboard action - Tab, Enter, Escape, shortcuts
   */
  private static async executeKeyboard(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { key, modifiers = [], repeat = 1, target } = action.params;
    
    if (!key) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No key specified for keyboard action',
      };
    }
    
    // Focus target element if specified
    if (target) {
      const bundle = this.buildLocatorBundle(target);
      const result = await this.resolveElement(bundle, { kind: 'CLICK' });
      if (result.status === 'success' && result.details.element instanceof HTMLElement) {
        result.details.element.focus();
        await this.sleep(50);
      }
    }
    
    // Dispatch keyboard events
    const eventInit: KeyboardEventInit = {
      key,
      code: this.keyToCode(key),
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers.includes('ctrl'),
      shiftKey: modifiers.includes('shift'),
      altKey: modifiers.includes('alt'),
      metaKey: modifiers.includes('meta'),
    };
    
    console.log(`[Tier1] ⌨️ Pressing key: ${key}${modifiers.length > 0 ? ' with ' + modifiers.join('+') : ''} (${repeat}x)`);
    
    for (let i = 0; i < repeat; i++) {
      const activeElement = document.activeElement || document.body;
      activeElement.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      activeElement.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      activeElement.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(50);
    }
    
    // Wait for stability after keyboard action
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });
    
    return {
      status: 'success',
      details: {},
    };
  }

  /**
   * Execute hover action - reveal hover-activated menus
   */
  private static async executeHover(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, hoverDuration = 500, waitForMenu = true } = action.params;
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified for hover action',
      };
    }
    
    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' };
    
    // Resolve element
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Check interactability
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }
    
    // Get element coordinates
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    console.log(`[Tier1] 🖱️ Hovering over element for ${hoverDuration}ms`);
    
    // Dispatch mouse events for hover
    element.dispatchEvent(new MouseEvent('mouseenter', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    element.dispatchEvent(new MouseEvent('mouseover', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    element.dispatchEvent(new MouseEvent('mousemove', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    // Hold hover for duration
    await this.sleep(hoverDuration);
    
    // Optionally wait for menu to appear
    if (waitForMenu) {
      await StateWaitEngine.waitForStability({ 
        domQuietMs: 200, 
        maxWaitMs: 2000 
      });
    }
    
    return {
      status: 'success',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
    };
  }

  // ============================================================================
  // Helper Methods - Integration with Reliable Replayer
  // ============================================================================

  /**
   * Resolve element using the Resolver with proper scoping
   */
  private static async resolveElement(
    bundle: LocatorBundle,
    intent: Intent
  ): Promise<Tier1ExecutionResult> {
    console.log('[Tier1] Resolving element with', bundle.strategies.length, 'strategies');
    
    // PRIORITY 1: Try recorded fallback selectors FIRST!
    // But sort them by SPECIFICITY - specific selectors should come before broad container XPaths
    if (bundle.recordedFallbackSelectors && bundle.recordedFallbackSelectors.length > 0) {
      console.log(`[Tier1] 🎯 Trying ${bundle.recordedFallbackSelectors.length} recorded fallback selectors...`);
      
      // 🎯 CRITICAL: Sort selectors by specificity (high to low)
      // This ensures we try [aria-label="X"] BEFORE //section[contains(.,"Y")]//button
      const sortedSelectors = [...bundle.recordedFallbackSelectors].sort((a, b) => {
        const scoreSelector = (sel: string): number => {
          // Highest priority: Attribute-based selectors (very specific)
          if (sel.includes('[aria-label=')) return 100;
          if (sel.includes('[title=')) return 95;
          if (sel.includes('[data-testid=') || sel.includes('[data-test-id=')) return 90;
          if (sel.includes('[id=')) return 85;
          if (sel.includes('[name=')) return 80;
          
          // Medium priority: XPath with exact text match
          if (sel.includes('[normalize-space(text())=') || sel.includes('[text()=')) return 70;
          if (sel.includes("normalize-space(.)=\"") || sel.includes("text()=\"")) return 65;
          
          // Lower priority: Contains-based selectors (can match multiple)
          if (sel.includes('contains(normalize-space(.)') && !sel.includes('//button') && !sel.includes('//a')) return 50;
          
          // Lowest priority: Container + element type (e.g., //section[...]//button)
          // These are the MOST DANGEROUS - they match the first element in a container!
          if ((sel.includes('//section') || sel.includes('//div')) && 
              (sel.includes('//button') || sel.includes('//a') || sel.includes('//input'))) {
            return 10; // Very low - try last
          }
          
          // Default: medium-low priority
          return 40;
        };
        return scoreSelector(b) - scoreSelector(a); // Higher score first
      });
      
      console.log(`[Tier1] 📊 Sorted selectors by specificity (first 3):`, sortedSelectors.slice(0, 3).map(s => s.substring(0, 50)));
      
      // 🎯 CRITICAL: Get expected text from bundle for verification
      // Fallback selectors can match the wrong element (e.g., first button in a section)
      // We MUST verify the element text/aria-label matches before accepting!
      const expectedText = bundle.strategies
        .filter(s => s.type === 'aria' || s.type === 'text')
        .map(s => s.value.toLowerCase().trim())
        .filter(Boolean);
      
      for (const selector of sortedSelectors) {
        try {
          let element: Element | null = null;
          
          if (selector.startsWith('//') || selector.startsWith('(//')) {
            // XPath selector
            const result = document.evaluate(
              selector,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = result.singleNodeValue as Element | null;
          } else {
            // CSS selector
            element = document.querySelector(selector);
          }
          
          if (element && this.isElementVisible(element)) {
            // 🛡️ VERIFICATION: Check if element matches expected text
            // This prevents fallback selectors from picking wrong elements!
            if (expectedText.length > 0) {
              const elementText = (element.textContent || '').toLowerCase().trim();
              const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase().trim();
              const title = (element.getAttribute('title') || '').toLowerCase().trim();
              
              // CRITICAL: For dropdown options, use FUZZY matching (bidirectional)
              // Example: Dropdown says "Accounts", but expected is "AM - My Accounts"
              // Both "accounts".includes("accounts") AND "am - my accounts".includes("accounts") should match
              const role = element.getAttribute('role');
              const isDropdownOption = role === 'option' || role === 'menuitem' || role === 'menuitemradio';
              
              const textMatches = expectedText.some(expected => {
                // 🛡️ CRITICAL: Reject elements with excessively long text (likely containers, not the target element)
                // Example: DIV with textContent = "Skip to Navigation...New...Accounts..." (entire page)
                // should NOT match when looking for "New" button
                const MAX_TEXT_LENGTH = 200; // Buttons/links/inputs rarely exceed this
                if (elementText.length > MAX_TEXT_LENGTH) {
                  console.log(`[Tier1] ⚠️ Element text too long (${elementText.length} chars) - likely a container, not target element`);
                  return false;
                }
                
                // Exact or contains match (forward direction)
                const forwardMatch = 
                  elementText === expected ||
                  elementText.includes(expected) ||
                  ariaLabel === expected ||
                  ariaLabel.includes(expected) ||
                  title === expected ||
                  title.includes(expected);
                
                if (forwardMatch) return true;
                
                // For dropdown options: Also check reverse (element text is subset of expected)
                // This handles: Dropdown option "Accounts" vs expected "AM - My Accounts"
                if (isDropdownOption && elementText.length >= 3) {
                  const reverseMatch = expected.includes(elementText);
                  if (reverseMatch) {
                    console.log(`[Tier1] ✅ Fuzzy match for dropdown option: "${elementText}" is contained in expected "${expected}"`);
                    return true;
                  }
                }
                
                return false;
              });
              
              if (!textMatches) {
                console.log(`[Tier1] ⚠️ Fallback selector found element but text doesn't match. Expected: "${expectedText[0]}", found: "${ariaLabel || elementText.substring(0, 50)}"`);
                continue; // Try next fallback selector
              }
            }
            
            console.log(`[Tier1] ✅ Found via recorded fallback selector: "${selector.substring(0, 60)}..."`);
            return {
              status: 'success',
              details: {
                element,
                resolveMetrics: { method: 'recorded_fallback_selector' },
              },
            };
          }
        } catch (e) {
          // Invalid selector, try next
          console.warn(`[Tier1] ⚠️ Invalid fallback selector: "${selector.substring(0, 40)}..."`);
        }
      }
      
      console.log('[Tier1] ℹ️ Recorded fallback selectors didn\'t find element, trying semantic strategies...');
    }
    
    // PRIORITY 2: Use Resolver.resolve() with semantic strategies
    const result: ResolveResult = Resolver.resolve(bundle, intent);
    
    if (result.status === 'found') {
      console.log(`[Tier1] ✅ Found via ${result.winningStrategy}`);
      return {
        status: 'success',
        details: {
          element: result.element,
          resolveMetrics: result.metrics,
        },
      };
    }
    
    if (result.status === 'ambiguous') {
      console.warn(`[Tier1] ⚠️ Ambiguous: ${result.candidates.length} candidates`);
      
      // AUTO-DISAMBIGUATE: Use deterministic heuristics to pick the best candidate
      // This mimics what a human would do: click the visible one, ignore hidden copies
      const bestCandidate = this.pickBestCandidate(
        result.candidates,
        bundle,
        intent
      );
      
      if (bestCandidate) {
        console.log(`[Tier1] ✅ Auto-disambiguated (${bestCandidate.reason})`);
        return {
          status: 'success',
          details: {
            element: bestCandidate.element,
            resolveMetrics: result.metrics,
          },
        };
      }
      
      // Only reject if truly ambiguous after all heuristics
      return {
        status: 'rejected',
        code: 'AMBIGUOUS',
        details: {
          matchCount: result.candidates.length,
          candidates: result.candidates.map(c => ({
            role: c.element.getAttribute('role') || c.element.tagName.toLowerCase(),
            name: c.element.textContent?.trim().substring(0, 50) || '',
            text: c.matchedText,
          })),
          resolveMetrics: result.metrics,
        },
        message: `Found ${result.candidates.length} matching elements, cannot decide which one`,
      };
    }
    
    // not_found
    console.warn(`[Tier1] ❌ Not found. Tried: ${result.triedStrategies.join(', ')}`);
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      details: {
        matchCount: 0,
        triedStrategies: result.triedStrategies,
        resolveMetrics: result.metrics,
      },
      message: `Element not found after trying ${result.triedStrategies.length} strategies`,
    };
  }

  /**
   * AUTO-DISAMBIGUATION: Pick the best candidate when multiple elements match
   * 
   * This implements human-like intuition:
   * - Click the visible BOGO in the open dropdown, not hidden ones
   * - Click the "Submit" button in the modal, not the one behind it
   * - Click the interactive element, not the disabled one
   * 
   * Priority order:
   * 1. VISIBILITY - must be actually visible to user
   * 2. CONTEXT - prefer elements in semantically relevant containers
   * 3. INTERACTABILITY - must be clickable/typeable
   * 4. Z-INDEX - prefer elements on top
   * 5. DOM ORDER - prefer later elements (more recent renders)
   */
  private static pickBestCandidate(
    candidates: Array<{ element: Element; matchedText?: string }>,
    bundle: LocatorBundle,
    intent: Intent
  ): { element: Element; reason: string } | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { element: candidates[0].element, reason: 'only one' };
    
    console.log(`[Tier1] 🔍 Disambiguating ${candidates.length} candidates...`);
    
    // STEP 1: Filter to VISIBLE elements only
    // Remove display:none, visibility:hidden, opacity:0, zero-size
    const visibleCandidates = candidates.filter(c => {
      const el = c.element;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (rect.width === 0 && rect.height === 0) return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After visibility filter: ${visibleCandidates.length}/${candidates.length}`);
    if (visibleCandidates.length === 0) return null;
    if (visibleCandidates.length === 1) return { element: visibleCandidates[0].element, reason: 'only visible one' };
    
    // STEP 1.5: SCOPE-AWARE filtering - use recorded container/widget context!
    // This is CRITICAL for distinguishing between identical elements in different widgets
    let scopeFiltered = visibleCandidates;
    if (bundle.scopeHint) {
      console.log(`[Tier1] 🎯 Filtering by scope hint: "${bundle.scopeHint}"`);
      
      // Helper function for fuzzy title matching (handles dynamic numbers like "STORE48" vs "STORE")
      const fuzzyTitleMatch = (recorded: string, actual: string): boolean => {
        if (!recorded || !actual) return false;
        const r = recorded.toLowerCase().trim();
        const a = actual.toLowerCase().trim();
        
        // Exact match
        if (r === a) return true;
        
        // One contains the other
        if (r.includes(a) || a.includes(r)) return true;
        
        // Strip trailing numbers and compare (e.g., "STORE48" -> "STORE")
        const rStripped = r.replace(/\d+$/, '').trim();
        const aStripped = a.replace(/\d+$/, '').trim();
        
        if (rStripped && aStripped) {
          if (rStripped === aStripped) return true;
          if (rStripped.includes(aStripped) || aStripped.includes(rStripped)) return true;
        }
        
        return false;
      };
      
      const inScope = visibleCandidates.filter((c, idx) => {
        // Walk up the DOM tree AND shadow DOM to find a container that matches the scope hint
        let current: Element | null = c.element;
        const maxLevels = 20; // Increased for shadow DOM depth
        let level = 0;
        const scopeHint = bundle.scopeHint!;
        const isFirstCandidate = idx === 0; // Only log detailed debug for first candidate
        
        while (current && level < maxLevels) {
          // Check headers in this element (light DOM)
          const headers = current.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [role="heading"]');
          for (const header of Array.from(headers)) {
            const headerText = header.textContent?.trim() || '';
            if (fuzzyTitleMatch(scopeHint, headerText)) {
              console.log(`[Tier1] ✅ Candidate matched scope via header: "${headerText.substring(0, 50)}"`);
              return true;
            }
          }
          
          // Check shadow DOM for titles - ALSO check text content directly!
          if (current.shadowRoot) {
            // Method 1: Check headers
            const shadowHeaders = current.shadowRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [role="heading"]');
            if (isFirstCandidate) {
              console.log(`[Tier1] 🔍 Checking ${shadowHeaders.length} headers in shadowRoot of ${current.tagName}`);
            }
            for (const header of Array.from(shadowHeaders)) {
              const headerText = header.textContent?.trim() || '';
              if (isFirstCandidate && headerText.length > 0) {
                console.log(`[Tier1] 🔍 Shadow header found: "${headerText.substring(0, 60)}"`);
              }
              if (fuzzyTitleMatch(scopeHint, headerText)) {
                console.log(`[Tier1] ✅ Candidate matched scope via shadow header: "${headerText.substring(0, 50)}"`);
                return true;
              }
            }
            
            // Method 2: Check all text content in shadow root for widget title
            // Some frameworks put titles in spans or divs, not headers
            const allTextElements = current.shadowRoot.querySelectorAll('span, div, p, label');
            for (const el of Array.from(allTextElements)) {
              const text = el.textContent?.trim() || '';
              // Only check elements with short text (likely labels/titles, not content blocks)
              if (text.length > 5 && text.length < 100) {
                if (fuzzyTitleMatch(scopeHint, text)) {
                  console.log(`[Tier1] ✅ Candidate matched scope via shadow text: "${text.substring(0, 50)}"`);
                  return true;
                }
              }
            }
          } else if (isFirstCandidate && current.tagName?.toLowerCase().includes('widget')) {
            console.log(`[Tier1] ⚠️ ${current.tagName} has no accessible shadowRoot (may be closed)`);
          }
          
          // Move up - handle shadow DOM boundaries!
          // If current element is in a shadow root, we need to go to the shadow host
          const rootNode = current.getRootNode();
          if (rootNode instanceof ShadowRoot) {
            // We're in a shadow DOM - jump to the host element
            current = rootNode.host;
            console.log(`[Tier1] 🔍 Crossed shadow boundary to host: ${current.tagName}`);
          } else {
            // Normal DOM traversal
            current = current.parentElement;
          }
          level++;
        }
        return false;
      });
      
      if (inScope.length > 0) {
        scopeFiltered = inScope;
        console.log(`[Tier1] 🎯 Filtered to ${inScope.length} inside scope "${bundle.scopeHint}"`);
        if (inScope.length === 1) {
          return { element: inScope[0].element, reason: `only one in scope "${bundle.scopeHint}"` };
        }
      } else {
        // Scope hint not found - log warning but CONTINUE with normal disambiguation
        // The scope hint is a preference, not a hard requirement
        console.warn(`[Tier1] ⚠️ Scope hint "${bundle.scopeHint}" not found - proceeding with normal disambiguation`);
        console.warn(`[Tier1] 💡 Note: Will use visibility, position, and other signals to pick best candidate`);
        // Don't modify scopeFiltered - continue with all visible candidates
      }
    }
    
    // STEP 2: CONTEXT-AWARE filtering based on element role/type
    const role = bundle.strategies.find(s => s.type === 'role')?.value;
    let contextFiltered = scopeFiltered;
    
    // For dropdown options: prefer elements inside open listbox/menu
    if (role === 'option' || role === 'menuitem') {
      const inListbox = scopeFiltered.filter(c => {
        const listbox = c.element.closest('[role="listbox"], [role="menu"], ul, [class*="dropdown"], [class*="menu"]');
        return listbox && window.getComputedStyle(listbox).display !== 'none';
      });
      
      if (inListbox.length > 0) {
        contextFiltered = inListbox;
        console.log(`[Tier1] 🎯 Filtered to ${inListbox.length} inside open listbox/menu`);
      }
    }
    
    // For modal/dialog buttons: prefer elements inside modal
    const modal = document.querySelector('[role="dialog"][aria-modal="true"], .modal:not([style*="display: none"])');
    if (modal) {
      const inModal = contextFiltered.filter(c => modal.contains(c.element));
      if (inModal.length > 0) {
        contextFiltered = inModal;
        console.log(`[Tier1] 🎯 Filtered to ${inModal.length} inside active modal`);
      }
    }
    
    if (contextFiltered.length === 1) return { element: contextFiltered[0].element, reason: 'only one in context' };
    
    // STEP 3: INTERACTABILITY - prefer elements that are actually interactive
    const interactiveCandidates = contextFiltered.filter(c => {
      const el = c.element as HTMLElement;
      const style = window.getComputedStyle(el);
      
      // Not disabled
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
      
      // Can receive pointer events
      if (style.pointerEvents === 'none') return false;
      
      // Not readonly (for inputs) - but allow readonly if we're just reading the value
      if (el instanceof HTMLInputElement && el.readOnly && intent.kind === 'TYPE') return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After interactability filter: ${interactiveCandidates.length}/${contextFiltered.length}`);
    if (interactiveCandidates.length === 0) {
      // Fallback: if no interactive ones, keep all contextFiltered
      console.log(`[Tier1] ⚠️ No interactive candidates, keeping all ${contextFiltered.length}`);
    } else if (interactiveCandidates.length === 1) {
      return { element: interactiveCandidates[0].element, reason: 'only interactive one' };
    } else {
      contextFiltered = interactiveCandidates;
    }
    
    // STEP 4: Z-INDEX - prefer elements on top (higher z-index)
    const withZIndex = contextFiltered.map(c => {
      const style = window.getComputedStyle(c.element);
      const zIndex = parseInt(style.zIndex) || 0;
      return { ...c, zIndex };
    });
    
    const maxZIndex = Math.max(...withZIndex.map(c => c.zIndex));
    const topLayerCandidates = withZIndex.filter(c => c.zIndex === maxZIndex);
    
    if (topLayerCandidates.length === 1) {
      return { element: topLayerCandidates[0].element, reason: `highest z-index (${maxZIndex})` };
    }
    
    console.log(`[Tier1] 📊 After z-index filter: ${topLayerCandidates.length} at z-index ${maxZIndex}`);
    
    // STEP 5: VIEWPORT POSITION - prefer elements in viewport center (more likely to be interactive)
    const inViewport = topLayerCandidates.filter(c => {
      const rect = c.element.getBoundingClientRect();
      return rect.top >= 0 && 
             rect.left >= 0 && 
             rect.bottom <= window.innerHeight && 
             rect.right <= window.innerWidth;
    });
    
    if (inViewport.length > 0 && inViewport.length < topLayerCandidates.length) {
      console.log(`[Tier1] 📊 Filtered to ${inViewport.length} in viewport`);
      if (inViewport.length === 1) {
        return { element: inViewport[0].element, reason: 'only one in viewport' };
      }
      contextFiltered = inViewport.map(c => ({ element: c.element, matchedText: c.matchedText }));
    } else {
      contextFiltered = topLayerCandidates.map(c => ({ element: c.element, matchedText: c.matchedText }));
    }
    
    // STEP 6: EXACT TEXT MATCH - prefer elements that EXACTLY match the target text
    // This is critical for dropdowns where you want "BOGO" not "BOGA" or "BOGO 2"
    const targetText = bundle.strategies.find(s => s.type === 'text')?.value;
    const targetRole = bundle.strategies.find(s => s.type === 'role')?.value;
    
    // Extract name from role strategy (e.g., "option:BOGO" -> "BOGO")
    let targetName: string | undefined;
    if (targetRole && targetRole.includes(':')) {
      targetName = targetRole.split(':')[1];
    }
    
    // Try exact text match
    const exactTextMatches = contextFiltered.filter(c => {
      const elText = c.element.textContent?.trim();
      const matchTarget = targetText || targetName;
      
      if (!matchTarget || !elText) return false;
      
      // Exact match (case-insensitive)
      return elText.toLowerCase() === matchTarget.toLowerCase();
    });
    
    if (exactTextMatches.length > 0) {
      console.log(`[Tier1] 📊 Filtered to ${exactTextMatches.length} with exact text match`);
      if (exactTextMatches.length === 1) {
        return { element: exactTextMatches[0].element, reason: 'exact text match' };
      }
      // Use exact matches for next steps
      contextFiltered = exactTextMatches;
    }
    
    // STEP 7: DOM ORDER - prefer later elements (more recent React renders)
    // Elements later in DOM tree are typically more recent
    const sortedByDomOrder = [...contextFiltered].sort((a, b) => {
      const comparison = a.element.compareDocumentPosition(b.element);
      if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // a comes before b
      if (comparison & Node.DOCUMENT_POSITION_PRECEDING) return 1;  // a comes after b
      return 0;
    });
    
    // Take the LAST one (most recent)
    const lastElement = sortedByDomOrder[sortedByDomOrder.length - 1];
    console.log(`[Tier1] 📊 Picked last in DOM order out of ${sortedByDomOrder.length}`);
    
    return { 
      element: lastElement.element, 
      reason: `last of ${sortedByDomOrder.length} (most recent)` 
    };
  }

  /**
   * Build locator bundle from semantic target
   */
  private static buildLocatorBundle(target: SemanticTarget): LocatorBundle {
    const strategies: LocatorStrategy[] = [];
    
    // Check if name is actually unlabeled
    const isUnlabeled = !target.name || 
                       target.name === '(unlabeled)' || 
                       target.name.trim() === '';
    
    // Test ID (highest priority)
    if (target.testId) {
      strategies.push({
        type: 'testid',
        value: target.testId,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // ID attribute (also very stable)
    if (target.id) {
      strategies.push({
        type: 'css',
        value: `#${target.id}`,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // Role strategy - use correct format: "role:accessibleName" or just "role"
    if (target.role) {
      if (isUnlabeled) {
        // No name filter, just role
        console.log(`[Tier1] Building locator for unlabeled ${target.role}`);
        strategies.push({
          type: 'role',
          value: target.role,  // Just "combobox", no name part
          features: this.createFeatures(true, false, false),
        });
      } else {
        // Role with name filter
        strategies.push({
          type: 'role',
          value: `${target.role}:${target.name}`,  // Correct format: "role:name"
          features: this.createFeatures(true, false, false),
        });
      }
    }
    
    // ARIA label (only if not unlabeled)
    if (target.name && !isUnlabeled) {
      strategies.push({
        type: 'aria',
        value: target.name,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // Text content (only if valid and not a number/single char)
    const hasValidText = target.text && 
                        target.text !== '(unlabeled)' && 
                        target.text.trim() !== '' &&
                        target.text.trim().length > 1 &&  // Skip single characters
                        !/^\d+$/.test(target.text.trim());  // Skip pure numbers like "0", "100"
    
    if (hasValidText && target.text) {
      console.log(`[Tier1] Adding text strategy with value: "${target.text}"`);
      strategies.push({
        type: 'text',
        value: target.text.trim(),  // Trim to avoid whitespace issues
        features: this.createFeatures(false, false, false),
      });
    }
    
    // Placeholder (for inputs)
    if (target.placeholder) {
      strategies.push({
        type: 'css',
        value: `[placeholder="${target.placeholder}"]`,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // If no strategies were added, add a basic CSS selector for the role
    if (strategies.length === 0 && target.role) {
      console.warn('[Tier1] No valid strategies, adding fallback role selector');
      strategies.push({
        type: 'css',
        value: `[role="${target.role}"]`,
        features: this.createFeatures(false, false, false),
      });
    }
    
    // Final safety check - must have at least one strategy
    if (strategies.length === 0) {
      console.error('[Tier1] Cannot build locator bundle - no valid strategies for target:', target);
      // Add a dummy strategy that will fail gracefully
      strategies.push({
        type: 'css',
        value: '[data-ghostwriter-impossible-selector]',
        features: this.createFeatures(false, false, false),
      });
    }
    
    console.log(`[Tier1] Built locator bundle with ${strategies.length} strategies:`, strategies.map(s => `${s.type}:${s.value.substring(0, 20)}`));
    
    // Build scope if scopeHint provided - use WIDGET scope for better widget title matching
    const scope = target.scopeHint ? {
      kind: 'WIDGET' as const,
      title: target.scopeHint,
    } : undefined;
    
    if (scope) {
      console.log(`[Tier1] 🎯 Using WIDGET scope: "${scope.title}"`);
    }
    
    // CRITICAL: Include recorded fallback selectors - these contain container context!
    // e.g., "//div[descendant::*[contains(normalize-space(.), 'Widget Title')]]//button"
    if (target.recordedFallbackSelectors && target.recordedFallbackSelectors.length > 0) {
      console.log(`[Tier1] 📋 Including ${target.recordedFallbackSelectors.length} recorded fallback selectors with container context`);
    }
    
    return {
      strategies,
      scope,
      disambiguators: target.nearbyText || [],
      tagName: target.role || '',
      role: target.role,
      // CRITICAL: Pass fallback selectors for reliable disambiguation
      recordedFallbackSelectors: target.recordedFallbackSelectors,
      scopeHint: target.scopeHint,
    };
  }

  /**
   * Create locator features
   */
  private static createFeatures(
    hasStableAttributes: boolean,
    uniqueMatchAtRecordTime: boolean,
    hasDynamicParts: boolean
  ) {
    return {
      hasStableAttributes,
      uniqueMatchAtRecordTime,
      matchCountAtRecordTime: uniqueMatchAtRecordTime ? 1 : 0,
      hasDynamicParts,
      textStabilityHint: 'unknown' as const,
      isWithinShadowDOM: false,
      recordedTagName: '',
    };
  }

  /**
   * Quick check if element is visible (for fallback selector validation)
   */
  private static isElementVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    
    if (rect.width === 0 && rect.height === 0) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    
    return true;
  }

  /**
   * Check if element is interactable
   */
  private static async checkInteractability(element: Element): Promise<{ success: boolean; reason?: string }> {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check visibility
    if (rect.width === 0 || rect.height === 0) {
      return { success: false, reason: 'Element has zero size' };
    }
    
    if (style.visibility === 'hidden') {
      return { success: false, reason: 'Element visibility is hidden' };
    }
    
    if (style.display === 'none') {
      return { success: false, reason: 'Element display is none' };
    }
    
    if (parseFloat(style.opacity) === 0) {
      return { success: false, reason: 'Element opacity is 0' };
    }
    
    // Check if disabled
    if ((element as HTMLButtonElement).disabled) {
      return { success: false, reason: 'Element is disabled' };
    }
    
    if (element.getAttribute('aria-disabled') === 'true') {
      return { success: false, reason: 'Element is aria-disabled' };
    }
    
    return { success: true };
  }

  /**
   * Check if action is safe (not delete/confirm in dangerous context)
   */
  private static checkActionSafety(element: Element, action: 'click' | 'type'): { safe: boolean; reason?: string } {
    if (action !== 'click') {
      return { safe: true };
    }
    
    const text = element.textContent?.toLowerCase().trim() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const combinedText = `${text} ${ariaLabel}`;
    
    // Check if we're in a modal/dialog
    const modal = element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal');
    
    if (modal) {
      // In modal: block ONLY highly dangerous patterns
      // "continue", "proceed", "submit", "save" are legitimate workflow progression buttons
      const highlyDangerousPatterns = [
        'delete', 'remove', 'destroy', 'purge', 'erase', 'terminate',
      ];
      
      // Additional checks for confirm/yes (only block if NOT part of normal flow)
      const contextuallyDangerousPatterns = [
        'confirm delete', 'confirm removal', 'yes, delete', 'yes, remove',
      ];
      
      const safePatterns = ['cancel', 'close', 'dismiss', 'no', 'back'];
      
      // If it's a safe pattern, allow
      if (safePatterns.some(p => combinedText.includes(p))) {
        return { safe: true };
      }
      
      // Check contextually dangerous (e.g., "Confirm Delete" but not just "Confirm")
      if (contextuallyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive confirmation)`,
        };
      }
      
      // If it's highly dangerous, block
      if (highlyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive action)`,
        };
      }
    }
    
    return { safe: true };
  }

  /**
   * Click element with proper event dispatching
   */
  private static clickElement(element: Element): void {
    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Focus
    if (element instanceof HTMLElement) {
      element.focus();
    }
    
    // Dispatch events
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
  }

  /**
   * Verify outcome using SuccessVerifier
   */
  private static async verifyOutcome(expected: ExpectedOutcome): Promise<{ success: boolean; message?: string }> {
    // Wait if specified
    if (expected.waitMs) {
      await new Promise(resolve => setTimeout(resolve, expected.waitMs));
    }
    
    if (expected.urlContains) {
      if (!window.location.href.includes(expected.urlContains)) {
        return {
          success: false,
          message: `URL does not contain: ${expected.urlContains}`,
        };
      }
    }
    
    if (expected.urlEquals) {
      if (window.location.href !== expected.urlEquals) {
        return {
          success: false,
          message: `URL mismatch: expected ${expected.urlEquals}`,
        };
      }
    }
    
    if (expected.textAppears) {
      if (!document.body.textContent?.includes(expected.textAppears)) {
        return {
          success: false,
          message: `Text not found: ${expected.textAppears}`,
        };
      }
    }
    
    if (expected.textDisappears) {
      if (document.body.textContent?.includes(expected.textDisappears)) {
        return {
          success: false,
          message: `Text still present: ${expected.textDisappears}`,
        };
      }
    }
    
    if (expected.modalAppears !== undefined) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (expected.modalAppears && !modal) {
        return {
          success: false,
          message: 'Modal did not appear',
        };
      }
      if (!expected.modalAppears && modal) {
        return {
          success: false,
          message: 'Modal appeared unexpectedly',
        };
      }
    }
    
    if (expected.modalCloses !== undefined && expected.modalCloses) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (modal) {
        return {
          success: false,
          message: 'Modal did not close',
        };
      }
    }
    
    return { success: true };
  }
  
  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Convert key name to key code for keyboard events
   */
  private static keyToCode(key: string): string {
    const keyCodeMap: Record<string, string> = {
      'Tab': 'Tab',
      'Enter': 'Enter',
      'Escape': 'Escape',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Space': 'Space',
      ' ': 'Space',
    };
    
    return keyCodeMap[key] || key;
  }
}

