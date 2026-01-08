/**
 * RecoveryEngine - Deterministic recovery actions (SIMPLIFIED)
 * 
 * When element resolution or verification fails, this engine executes
 * recovery actions to fix the state. No time-based delays - all actions
 * are deterministic and state-based.
 * 
 * Simplified to 4 essential actions:
 * 1. WAIT_FOR_STABILITY - DOM/network/spinner quiet
 * 2. DISMISS_POPUPS - Safe dismiss (close/cancel only, NOT delete/confirm)
 * 3. SCROLL_INTO_VIEW - Smart scroll with offset
 * 4. RETRY_LOOSER_MATCH - Lower matching thresholds
 */

import type { Intent } from '../types/intent';
import type { LocatorBundle } from '../types/locator';
import { StateWaitEngine } from './state-wait-engine';

/**
 * Structured scroll recovery directive from LLM
 */
export interface ScrollRecoveryDirective {
  kind: 'SCROLL_AND_RETRY';
  containerSelector?: string;       // CSS selector for scroll container
  containerHint?: string;           // Fallback: "Accounts table", "Main content"
  untilTextVisible?: string;        // Stop when this text appears
  maxScrolls: number;               // Default 10
  scrollDirection: 'down' | 'up';   // Default 'down'
  pixelsPerScroll: number;          // Default 300
}

/**
 * Structured dismiss recovery directive from LLM
 */
export interface DismissRecoveryDirective {
  kind: 'DISMISS_POPUP';
  popupHint?: string;               // "Cookie banner", "Notification"
  dismissMethod?: 'escape' | 'click_outside' | 'close_button';  // Default 'escape'
}

/**
 * Types of recovery actions (SIMPLIFIED - only 4 essential actions)
 */
export type RecoveryAction =
  | { kind: 'WAIT_FOR_STABILITY' }              // Network + DOM quiet + spinners gone
  | { kind: 'DISMISS_POPUPS' }                  // Escape + SAFE close buttons only
  | { kind: 'SCROLL_INTO_VIEW'; target: string } // Smart scroll into view
  | { kind: 'RETRY_LOOSER_MATCH' }              // Lower thresholds within scope
  | ScrollRecoveryDirective                     // Structured scroll from LLM
  | DismissRecoveryDirective;                   // Structured dismiss from LLM

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
  /** Maximum number of recovery attempts */
  maxAttempts: number;
  /** Ordered list of recovery actions to try */
  actions: RecoveryAction[];
}

/**
 * Context for recovery execution
 */
export interface RecoveryContext {
  /** Current locator bundle being resolved */
  locatorBundle?: LocatorBundle;
  /** Current intent */
  intent?: Intent;
  /** Number of attempts so far */
  attemptNumber: number;
  /** Last error message */
  lastError?: string;
  /** Callback for user intervention */
  onAskUser?: (message: string) => Promise<boolean>;
}

/**
 * Result of recovery action
 */
export interface RecoveryResult {
  /** Whether recovery action succeeded */
  success: boolean;
  /** Action that was executed */
  action: RecoveryAction;
  /** Time taken in ms */
  elapsedMs: number;
  /** Message about what happened */
  message?: string;
  /** Whether to retry resolution */
  shouldRetry: boolean;
}

/**
 * RecoveryEngine handles recovery when resolution or verification fails
 */
export class RecoveryEngine {
  /**
   * Execute a single recovery action (SIMPLIFIED - only 4 actions)
   */
  static async executeRecovery(
    action: RecoveryAction,
    _context: RecoveryContext
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    try {
      switch (action.kind) {
        case 'WAIT_FOR_STABILITY':
          return await this.waitForStability(startTime);
          
        case 'DISMISS_POPUPS':
          return await this.dismissPopupsSafe(startTime);
        
        case 'DISMISS_POPUP':
          return await this.dismissPopupStructured(action, startTime);
          
        case 'SCROLL_INTO_VIEW':
          return await this.scrollTargetIntoView(action.target, startTime);
        
        case 'SCROLL_AND_RETRY':
          return await this.executeScrollRecovery(action, startTime);
          
        case 'RETRY_LOOSER_MATCH':
          return this.retryWithLooserMatch(startTime);
          
        default:
          return {
            success: false,
            action,
            elapsedMs: Date.now() - startTime,
            message: 'Unknown recovery action',
            shouldRetry: false,
          };
      }
    } catch (error) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Recovery action failed',
        shouldRetry: false,
      };
    }
  }
  
  /**
   * Execute a recovery strategy
   */
  static async executeStrategy(
    strategy: RecoveryStrategy,
    context: RecoveryContext
  ): Promise<RecoveryResult[]> {
    const results: RecoveryResult[] = [];
    
    for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
      for (const action of strategy.actions) {
        const result = await this.executeRecovery(action, {
          ...context,
          attemptNumber: attempt,
        });
        
        results.push(result);
        
        if (result.success && result.shouldRetry) {
          // Recovery succeeded and suggests retry
          return results;
        }
        
        // No more ASK_USER action in simplified version
      }
    }
    
    return results;
  }
  
  /**
   * Get default recovery strategy for an intent (SIMPLIFIED)
   */
  static getDefaultRecoveryForIntent(intent: Intent): RecoveryStrategy {
    switch (intent.kind) {
      case 'CLICK':
      case 'OPEN_ROW_ACTIONS':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'DISMISS_POPUPS' },
            { kind: 'WAIT_FOR_STABILITY' },
            { kind: 'SCROLL_INTO_VIEW', target: '' }, // Will be filled in
            { kind: 'RETRY_LOOSER_MATCH' },
          ],
        };
        
      case 'TYPE':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'DISMISS_POPUPS' },          // Closes dropdowns
            { kind: 'WAIT_FOR_STABILITY' },
            { kind: 'SCROLL_INTO_VIEW', target: '' },
          ],
        };
        
      case 'SELECT_DROPDOWN_OPTION':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'WAIT_FOR_STABILITY' },
            { kind: 'SCROLL_INTO_VIEW', target: '' },
            { kind: 'RETRY_LOOSER_MATCH' },
          ],
        };
        
      case 'NAVIGATE':
        return {
          maxAttempts: 1,
          actions: [
            { kind: 'WAIT_FOR_STABILITY' },
          ],
        };
        
      case 'SUBMIT_FORM':
        return {
          maxAttempts: 2,
          actions: [
            { kind: 'SCROLL_INTO_VIEW', target: '' },
            { kind: 'WAIT_FOR_STABILITY' },
            { kind: 'DISMISS_POPUPS' },
          ],
        };
        
      default:
        return {
          maxAttempts: 1,
          actions: [
            { kind: 'WAIT_FOR_STABILITY' },
          ],
        };
    }
  }
  
  // ============ Recovery action implementations (SIMPLIFIED) ============
  
  /**
   * Wait for stability (DOM + network + spinners)
   */
  private static async waitForStability(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'WAIT_FOR_STABILITY' };
    
    const result = await StateWaitEngine.waitForStability({
      domQuietMs: 400,
      networkQuietMs: 600,
      maxWaitMs: 5000,
      checkSpinners: true,
    });
    
    return {
      success: result.success,
      action,
      elapsedMs: Date.now() - startTime,
      message: result.success ? 'Page is stable' : 'Stability timeout (partial success)',
      shouldRetry: true, // Always retry after stability wait
    };
  }
  
  /**
   * Dismiss popups SAFELY (close/cancel/dismiss only, NEVER delete/confirm/save)
   */
  private static async dismissPopupsSafe(startTime: number): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'DISMISS_POPUPS' };
    let dismissed = 0;
    
    // 1. Press Escape first (safest method)
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await this.sleep(100);
    } catch (e) {
      console.warn('[Recovery] Error pressing Escape:', e);
    }
    
    // 2. Safe dismiss patterns (whitelist)
    const SAFE_DISMISS_PATTERNS = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[aria-label="Dismiss"]',
      '[aria-label="dismiss"]',
      '[aria-label="Cancel"]',
      '[aria-label="cancel"]',
      'button.close',
      '.modal-close',
      '.popup-close',
      '[data-dismiss="modal"]',
      '[data-testid*="close"]',
      '[data-testid*="dismiss"]',
    ];
    
    for (const selector of SAFE_DISMISS_PATTERNS) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (const button of Array.from(buttons)) {
          if (button instanceof HTMLElement && this.isVisible(button)) {
            // Extra safety check
            if (this.isSafeToDismiss(button)) {
              try {
                button.click();
                dismissed++;
                await this.sleep(100);
              } catch (e) {
                console.warn('[Recovery] Error clicking close button:', e);
              }
            }
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: `Safely dismissed ${dismissed} popup(s)`,
      shouldRetry: dismissed > 0,
    };
  }
  
  /**
   * Safety check for dismiss buttons
   * BLOCKS dangerous actions (delete, remove, confirm, yes, submit, save)
   * ALLOWS safe actions (close, cancel, dismiss, x, no)
   */
  private static isSafeToDismiss(element: Element): boolean {
    const text = element.textContent?.toLowerCase()?.trim() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase()?.trim() || '';
    const className = element.className?.toString()?.toLowerCase() || '';
    const combined = `${text} ${ariaLabel} ${className}`;
    
    // DANGEROUS words - NEVER click these automatically
    const dangerousWords = [
      'delete', 'remove', 'confirm', 'yes', 
      'submit', 'save', 'apply', 'ok', 'accept',
      'danger', 'destructive', 'warning'
    ];
    
    for (const word of dangerousWords) {
      if (combined.includes(word)) {
        console.log(`[Recovery] 🚫 Blocked unsafe dismiss: "${text || ariaLabel}" (contains "${word}")`);
        return false;
      }
    }
    
    // SAFE words - only these are allowed
    const safeWords = ['close', 'cancel', 'dismiss', 'x', 'no', 'back', 'exit'];
    const hasSafeWord = safeWords.some(word => combined.includes(word));
    
    // Also allow if it's just an X icon (common pattern)
    const isXIcon = text === '×' || text === 'x' || text === '✕';
    
    if (hasSafeWord || isXIcon) {
      return true;
    }
    
    // Default: reject if we're not sure
    console.log(`[Recovery] 🚫 Blocked uncertain dismiss: "${text || ariaLabel}"`);
    return false;
  }
  
  private static async scrollTargetIntoView(
    target: string,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = { kind: 'SCROLL_INTO_VIEW', target };
    
    if (!target) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: 'No target specified for scroll',
        shouldRetry: false,
      };
    }
    
    try {
      const element = document.querySelector(target);
      if (element) {
        try {
          // CRITICAL: Only scroll if element is NOT in shadow DOM
          const isInShadowDOM = element.getRootNode() instanceof ShadowRoot;
          const rect = element.getBoundingClientRect();
          const isInViewport = (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth
          );
          
          if (!isInShadowDOM && !isInViewport) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Wait for scroll to complete
            await this.sleep(500);
          } else if (isInShadowDOM) {
            console.log('[RecoveryEngine] ⚠️ Element in shadow DOM - widget already visible, skipping scroll');
          } else {
            console.log('[RecoveryEngine] Element already in viewport, skipping scroll');
          }
          
          return {
            success: true,
            action,
            elapsedMs: Date.now() - startTime,
            message: `Scrolled "${target}" into view`,
            shouldRetry: true,
          };
        } catch (e) {
          // Page error during scroll - return failure but don't throw
          return {
            success: false,
            action,
            elapsedMs: Date.now() - startTime,
            message: 'Scroll triggered page error',
            shouldRetry: false,
          };
        }
      }
    } catch (e) {
      // Invalid selector or other error
    }
    
    return {
      success: false,
      action,
      elapsedMs: Date.now() - startTime,
      message: `Could not find element "${target}" to scroll`,
      shouldRetry: false,
    };
  }
  
  private static retryWithLooserMatch(startTime: number): RecoveryResult {
    const action: RecoveryAction = { kind: 'RETRY_LOOSER_MATCH' };
    
    // This is a signal to the resolver to use looser matching
    return {
      success: true,
      action,
      elapsedMs: Date.now() - startTime,
      message: 'Will retry with looser matching thresholds',
      shouldRetry: true,
    };
  }
  
  // ============ OLD METHODS REMOVED ============
  // Removed: scrollToTop, scrollToBottom (rarely needed)
  // Removed: dismissCommonPopups (replaced by dismissPopupsSafe)
  // Removed: waitForPageReady (replaced by waitForStability)
  // Removed: switchToFrame, switchToMainFrame (handle in orchestrator)
  // Removed: refreshElementReferences (redundant with stability wait)
  // Removed: clickAway, pressEscape, focusBody (consolidated into dismissPopupsSafe)
  // Removed: askUser (defer to later - complicates UX)
  
  // ============ Helper methods ============
  
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
  
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Execute structured scroll recovery with container finding and text checking
   */
  private static async executeScrollRecovery(
    directive: ScrollRecoveryDirective,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = directive;
    
    try {
      // Find scroll container
      const container = this.findScrollContainer(directive.containerHint);
      if (!container) {
        return {
          success: false,
          action,
          elapsedMs: Date.now() - startTime,
          message: `Could not find scroll container: ${directive.containerHint || 'default'}`,
          shouldRetry: false,
        };
      }
      
      console.log(`[Recovery] Found scroll container, scrolling ${directive.scrollDirection} to find: ${directive.untilTextVisible}`);
      
      // Scroll incrementally until text appears or max scrolls reached
      for (let i = 0; i < directive.maxScrolls; i++) {
        // Scroll
        const scrollAmount = directive.scrollDirection === 'down' 
          ? directive.pixelsPerScroll 
          : -directive.pixelsPerScroll;
        
        container.scrollBy({
          top: scrollAmount,
          behavior: 'smooth'
        });
        
        // Wait for scroll to complete
        await this.sleep(200);
        
        // Check if target text is now visible
        if (directive.untilTextVisible) {
          const found = document.body.innerText.includes(directive.untilTextVisible);
          if (found) {
            console.log(`[Recovery] Found target text after ${i + 1} scrolls`);
            return {
              success: true,
              action,
              elapsedMs: Date.now() - startTime,
              message: `Found "${directive.untilTextVisible}" after ${i + 1} scrolls`,
              shouldRetry: true,
            };
          }
        }
        
        // Check if we reached the end of scrollable area
        const atEnd = directive.scrollDirection === 'down'
          ? container.scrollTop + container.clientHeight >= container.scrollHeight - 10
          : container.scrollTop <= 10;
        
        if (atEnd) {
          console.log(`[Recovery] Reached end of scroll area after ${i + 1} scrolls`);
          break;
        }
      }
      
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: `Target text not found after ${directive.maxScrolls} scrolls`,
        shouldRetry: false,
      };
    } catch (error) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Scroll recovery failed',
        shouldRetry: false,
      };
    }
  }
  
  /**
   * Find scroll container based on hint
   */
  private static findScrollContainer(containerHint?: string): Element | null {
    // Strategy 1: If hint provided, try to find by text content
    if (containerHint) {
      // Look for elements with text matching the hint
      const candidates = document.querySelectorAll('[role="region"], [role="main"], main, [class*="table"], [class*="list"], [class*="scroll"]');
      for (const candidate of candidates) {
        const text = candidate.textContent?.toLowerCase() || '';
        const hint = containerHint.toLowerCase();
        if (text.includes(hint) || candidate.getAttribute('aria-label')?.toLowerCase().includes(hint)) {
          // Check if it's scrollable
          const style = window.getComputedStyle(candidate);
          if (style.overflow === 'auto' || style.overflow === 'scroll' || 
              style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return candidate;
          }
          // Check if any parent is scrollable
          let parent = candidate.parentElement;
          while (parent) {
            const parentStyle = window.getComputedStyle(parent);
            if (parentStyle.overflow === 'auto' || parentStyle.overflow === 'scroll' ||
                parentStyle.overflowY === 'auto' || parentStyle.overflowY === 'scroll') {
              return parent;
            }
            parent = parent.parentElement;
          }
        }
      }
    }
    
    // Strategy 2: Find first scrollable container
    const scrollables = document.querySelectorAll('[role="region"], [role="main"], main, div');
    for (const el of scrollables) {
      const style = window.getComputedStyle(el);
      if (style.overflow === 'auto' || style.overflow === 'scroll' ||
          style.overflowY === 'auto' || style.overflowY === 'scroll') {
        if (el.scrollHeight > el.clientHeight) {
          return el;
        }
      }
    }
    
    // Strategy 3: Fallback to window
    return document.documentElement;
  }
  
  /**
   * Execute structured dismiss popup recovery
   */
  private static async dismissPopupStructured(
    directive: DismissRecoveryDirective,
    startTime: number
  ): Promise<RecoveryResult> {
    const action: RecoveryAction = directive;
    const method = directive.dismissMethod || 'escape';
    
    try {
      switch (method) {
        case 'escape':
          // Press Escape key
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true }));
          await this.sleep(300);
          break;
          
        case 'click_outside':
          // Click on body to dismiss
          document.body.click();
          await this.sleep(300);
          break;
          
        case 'close_button':
          // Find and click close button
          const closeButton = this.findCloseButton(directive.popupHint);
          if (closeButton) {
            closeButton.click();
            await this.sleep(300);
          } else {
            return {
              success: false,
              action,
              elapsedMs: Date.now() - startTime,
              message: 'Close button not found',
              shouldRetry: false,
            };
          }
          break;
      }
      
      return {
        success: true,
        action,
        elapsedMs: Date.now() - startTime,
        message: `Dismissed popup using ${method}`,
        shouldRetry: true,
      };
    } catch (error) {
      return {
        success: false,
        action,
        elapsedMs: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Dismiss popup failed',
        shouldRetry: false,
      };
    }
  }
  
  /**
   * Find close button for popup
   */
  private static findCloseButton(popupHint?: string): HTMLElement | null {
    // Look for common close button selectors
    const selectors = [
      '[aria-label*="close" i]',
      '[aria-label*="dismiss" i]',
      '[title*="close" i]',
      'button[class*="close" i]',
      '[role="button"][class*="close" i]',
      'button[class*="dismiss" i]',
    ];
    
    for (const selector of selectors) {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        // If popup hint provided, check if button is inside that popup
        if (popupHint) {
          const text = button.closest('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"]')?.textContent?.toLowerCase() || '';
          if (text.includes(popupHint.toLowerCase())) {
            return button as HTMLElement;
          }
        } else {
          // Return first close button found
          return button as HTMLElement;
        }
      }
    }
    
    return null;
  }
}

