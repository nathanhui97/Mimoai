/**
 * Post-Action Observer
 * 
 * Lightweight observation system that detects page changes after actions.
 * Enables intelligent decision-making by understanding what happened (modals,
 * errors, navigation, loading states) instead of just "did it work or not".
 * 
 * Design principles:
 * - Fast: ~5-15ms per capture (uses simple querySelector, not full DOM traversal)
 * - Universal: Works on any website using semantic patterns (ARIA, common classes)
 * - Safe: Wrapped in try-catch, never breaks execution
 * - Non-invasive: Only observes, doesn't modify anything
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Lightweight snapshot of page state at a point in time
 */
export interface PageState {
  /** Current URL */
  url: string;
  
  /** Modal/dialog state */
  hasModal: boolean;
  modalTitle?: string;
  
  /** Error state */
  hasError: boolean;
  errorText?: string;
  
  /** Loading state */
  isLoading: boolean;
  
  /** Toast/notification state */
  hasToast: boolean;
  toastText?: string;
  
  /** Dropdown state */
  hasDropdown: boolean;
  
  /** Success message state */
  hasSuccess: boolean;
  
  /** Interactive element count (for detecting major DOM changes) */
  interactiveElementCount: number;
  
  /** Timestamp when state was captured */
  timestamp: number;
}

/**
 * Detected changes between two page states
 */
export interface PageChanges {
  /** Was there any significant change? */
  hasSignificantChange: boolean;
  
  /** What changed */
  changes: Array<{
    type: ChangeType;
    description: string;
    context?: string;  // Additional context (e.g., modal title, error message)
  }>;
  
  /** Time elapsed between states */
  elapsedMs: number;
  
  /** Classification of what happened */
  interpretation: ChangeInterpretation;
}

/**
 * Types of changes we can detect
 */
export type ChangeType =
  | 'modal_appeared'
  | 'modal_closed'
  | 'error_appeared'
  | 'error_cleared'
  | 'success_appeared'
  | 'loading_started'
  | 'loading_finished'
  | 'dropdown_opened'
  | 'dropdown_closed'
  | 'toast_appeared'
  | 'url_changed'
  | 'dom_changed';

/**
 * High-level interpretation of what the changes mean
 */
export type ChangeInterpretation =
  | 'no_change'           // Nothing happened
  | 'modal_interaction'   // Modal appeared or closed
  | 'error_state'         // Error occurred
  | 'success_state'       // Success confirmed
  | 'navigation'          // URL changed
  | 'loading_state'       // Loading started or finished
  | 'ui_update';          // General UI change (dropdown, DOM)

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Capture a lightweight snapshot of the current page state
 * 
 * Performance target: 5-15ms
 * Uses simple querySelector calls, no heavy DOM traversal
 * 
 * @returns Current page state or null if capture fails
 */
export function captureQuickState(): PageState | null {
  try {
    const startTime = performance.now();
    
    // Modal detection - ARIA-based (works everywhere)
    // Note: Using document.body.querySelector for better JSDOM compatibility
    const modalSelectors = [
      '[role="dialog"]:not([hidden])',
      '[role="alertdialog"]:not([hidden])',
      '[aria-modal="true"]:not([hidden])',
    ];
    
    let modalElement: Element | null = null;
    for (const selector of modalSelectors) {
      modalElement = document.body?.querySelector(selector) || null;
      if (modalElement) {
        const style = modalElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          modalElement = null;
          continue;
        }
        break;
      }
    }
    
    const hasModal = !!modalElement;
    const modalTitle = modalElement?.querySelector('h1, h2, [role="heading"]')?.textContent?.trim();
    
    // Error detection - semantic patterns
    // Note: Using [class*="..."] to match class names containing keywords
    const errorSelectors = [
      '[role="alert"][aria-live="assertive"]',
      '[role="alert"]:not([role="status"])',
      '[class*="error"]:not([hidden])',
      '[class*="danger"]:not([hidden])',
      '[class*="alert-danger"]:not([hidden])',
    ];
    
    let errorElement: Element | null = null;
    for (const selector of errorSelectors) {
      errorElement = document.body?.querySelector(selector) || null;
      if (errorElement) {
        // Check if element is actually visible (not display: none via style attribute)
        const style = errorElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          errorElement = null;
          continue;
        }
        break;
      }
    }
    
    const hasError = !!errorElement;
    const errorText = errorElement?.textContent?.trim().substring(0, 100);
    
    // Success detection - semantic patterns
    const successSelectors = [
      '[role="status"][aria-live="polite"]',
      '[class*="success"]:not([hidden])',
      '[class*="alert-success"]:not([hidden])',
    ];
    
    let successElement: Element | null = null;
    for (const selector of successSelectors) {
      successElement = document.body?.querySelector(selector) || null;
      if (successElement) {
        const style = successElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          successElement = null;
          continue;
        }
        break;
      }
    }
    
    const hasSuccess = !!successElement;
    
    // Loading detection - standard patterns
    // Note: Using [class*="..."] to match class names containing the keyword
    const loadingSelectors = [
      '[aria-busy="true"]',
      '[class*="loading"]:not([hidden])',
      '[class*="spinner"]:not([hidden])',
      '[class*="loader"]:not([hidden])',
    ];
    
    let loadingElement: Element | null = null;
    for (const selector of loadingSelectors) {
      loadingElement = document.body?.querySelector(selector) || null;
      if (loadingElement) {
        const style = loadingElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          loadingElement = null;
          continue;
        }
        break;
      }
    }
    
    const isLoading = !!loadingElement;
    
    // Toast/notification detection - common patterns
    const toastSelectors = [
      '[role="status"]',
      '[class*="toast"]:not([hidden])',
      '[class*="snackbar"]:not([hidden])',
      '[class*="notification"]:not([hidden])',
    ];
    
    let toastElement: Element | null = null;
    for (const selector of toastSelectors) {
      toastElement = document.body?.querySelector(selector) || null;
      if (toastElement) {
        const style = toastElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          toastElement = null;
          continue;
        }
        break;
      }
    }
    
    const hasToast = !!toastElement && !hasSuccess; // Exclude success messages already counted
    const toastText = toastElement?.textContent?.trim().substring(0, 100);
    
    // Dropdown detection
    const dropdownSelectors = [
      '[role="listbox"]:not([hidden])',
      '[role="menu"]:not([hidden])',
    ];
    
    let dropdownElement: Element | null = null;
    for (const selector of dropdownSelectors) {
      dropdownElement = document.body?.querySelector(selector) || null;
      if (dropdownElement) {
        const style = dropdownElement.getAttribute('style');
        if (style && style.includes('display: none')) {
          dropdownElement = null;
          continue;
        }
        break;
      }
    }
    
    const hasDropdown = !!dropdownElement;
    
    // Count interactive elements (for detecting major DOM changes)
    const interactiveElementCount = (document.body?.querySelectorAll(
      'button:not([hidden]), ' +
      'a:not([hidden]), ' +
      'input:not([hidden]), ' +
      'select:not([hidden]), ' +
      'textarea:not([hidden]), ' +
      '[role="button"]:not([hidden]), ' +
      '[role="link"]:not([hidden])'
    ) || []).length;
    
    const state: PageState = {
      url: window.location.href,
      hasModal,
      modalTitle,
      hasError,
      errorText,
      isLoading,
      hasToast,
      toastText,
      hasDropdown,
      hasSuccess,
      interactiveElementCount,
      timestamp: Date.now(),
    };
    
    const elapsedMs = performance.now() - startTime;
    if (elapsedMs > 20) {
      console.warn(`[PostActionObserver] captureQuickState took ${elapsedMs.toFixed(1)}ms (target: <20ms)`);
    }
    
    return state;
  } catch (error) {
    console.error('[PostActionObserver] captureQuickState failed:', error);
    return null;
  }
}

/**
 * Detect changes between two page states
 * 
 * Performance target: 1-2ms
 * Simple object comparison
 * 
 * @param before State before action
 * @param after State after action
 * @returns Detected changes or null if detection fails
 */
export function detectChanges(before: PageState, after: PageState): PageChanges | null {
  try {
    const changes: PageChanges['changes'] = [];
    
    // Modal changes
    if (!before.hasModal && after.hasModal) {
      changes.push({
        type: 'modal_appeared',
        description: 'Modal/dialog appeared',
        context: after.modalTitle,
      });
    } else if (before.hasModal && !after.hasModal) {
      changes.push({
        type: 'modal_closed',
        description: 'Modal/dialog closed',
      });
    }
    
    // Error changes
    if (!before.hasError && after.hasError) {
      changes.push({
        type: 'error_appeared',
        description: 'Error message appeared',
        context: after.errorText,
      });
    } else if (before.hasError && !after.hasError) {
      changes.push({
        type: 'error_cleared',
        description: 'Error message cleared',
      });
    }
    
    // Success changes
    if (!before.hasSuccess && after.hasSuccess) {
      changes.push({
        type: 'success_appeared',
        description: 'Success message appeared',
      });
    }
    
    // Loading changes
    if (!before.isLoading && after.isLoading) {
      changes.push({
        type: 'loading_started',
        description: 'Loading/spinner started',
      });
    } else if (before.isLoading && !after.isLoading) {
      changes.push({
        type: 'loading_finished',
        description: 'Loading/spinner finished',
      });
    }
    
    // Dropdown changes
    if (!before.hasDropdown && after.hasDropdown) {
      changes.push({
        type: 'dropdown_opened',
        description: 'Dropdown/menu opened',
      });
    } else if (before.hasDropdown && !after.hasDropdown) {
      changes.push({
        type: 'dropdown_closed',
        description: 'Dropdown/menu closed',
      });
    }
    
    // Toast changes
    if (!before.hasToast && after.hasToast) {
      changes.push({
        type: 'toast_appeared',
        description: 'Toast/notification appeared',
        context: after.toastText,
      });
    }
    
    // URL changes
    if (before.url !== after.url) {
      changes.push({
        type: 'url_changed',
        description: 'Page navigation occurred',
        context: `${before.url} → ${after.url}`,
      });
    }
    
    // Major DOM changes (threshold: 20% change in interactive element count)
    const elementDelta = Math.abs(after.interactiveElementCount - before.interactiveElementCount);
    const elementChangePercent = before.interactiveElementCount > 0
      ? (elementDelta / before.interactiveElementCount) * 100
      : 0;
    
    if (elementChangePercent > 20) {
      changes.push({
        type: 'dom_changed',
        description: 'Significant DOM change detected',
        context: `${before.interactiveElementCount} → ${after.interactiveElementCount} elements`,
      });
    }
    
    // Determine if there's any significant change
    const hasSignificantChange = changes.length > 0;
    
    // Interpret what happened
    const interpretation = interpretChanges(changes);
    
    return {
      hasSignificantChange,
      changes,
      elapsedMs: after.timestamp - before.timestamp,
      interpretation,
    };
  } catch (error) {
    console.error('[PostActionObserver] detectChanges failed:', error);
    return null;
  }
}

/**
 * Classify changes into high-level interpretation
 * 
 * @param changes List of detected changes
 * @returns High-level interpretation of what happened
 */
export function interpretChanges(changes: PageChanges['changes']): ChangeInterpretation {
  if (changes.length === 0) {
    return 'no_change';
  }
  
  // Priority order: error > navigation > success > modal > loading > ui
  
  if (changes.some(c => c.type === 'error_appeared')) {
    return 'error_state';
  }
  
  if (changes.some(c => c.type === 'url_changed')) {
    return 'navigation';
  }
  
  if (changes.some(c => c.type === 'success_appeared')) {
    return 'success_state';
  }
  
  if (changes.some(c => c.type === 'modal_appeared' || c.type === 'modal_closed')) {
    return 'modal_interaction';
  }
  
  if (changes.some(c => c.type === 'loading_started' || c.type === 'loading_finished')) {
    return 'loading_state';
  }
  
  return 'ui_update';
}

// ============================================================================
// Convenience API
// ============================================================================

/**
 * Convenience class for using the observer
 */
export class PostActionObserver {
  static captureQuickState = captureQuickState;
  static detectChanges = detectChanges;
  static interpretChanges = interpretChanges;
}
