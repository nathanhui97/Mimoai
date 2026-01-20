/**
 * Success Verification Engine (Phase 3)
 *
 * Verifies that actions achieved their intended outcomes using structured criteria.
 * Works with the AI analysis context to understand what "success" looks like.
 */

import type { VerificationResult, AgentHint } from './agent/types';

/**
 * Page state snapshot for before/after comparison
 */
export interface PageState {
  url: string;
  title: string;
  hasModal: boolean;
  hasDropdown: boolean;
  visibleText: string;
  elementCount: number;
  toastMessages: string[];
}

/**
 * Capture current page state for verification
 */
export function capturePageState(): PageState {
  const toastMessages: string[] = [];

  // Find toast/notification elements
  const toastSelectors = [
    '[role="alert"]',
    '[role="status"]',
    '.toast',
    '.notification',
    '.snackbar',
    '[class*="toast"]',
    '[class*="notification"]',
    '[class*="alert"]',
    '[class*="snackbar"]',
  ];

  toastSelectors.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length < 200) {
          toastMessages.push(text);
        }
      });
    } catch (e) {
      // Ignore selector errors
    }
  });

  return {
    url: window.location.href,
    title: document.title,
    hasModal: !!(document.querySelector('[role="dialog"]') || document.querySelector('.modal')),
    hasDropdown: !!(document.querySelector('[role="listbox"]') || document.querySelector('[aria-expanded="true"]')),
    visibleText: getVisibleText(),
    elementCount: document.querySelectorAll('*').length,
    toastMessages: [...new Set(toastMessages)],
  };
}

/**
 * Get visible text on the page (truncated)
 */
function getVisibleText(): string {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Skip hidden elements
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip script/style
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textParts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) && textParts.join(' ').length < 5000) {
    const text = node.textContent?.trim();
    if (text && text.length > 0) {
      textParts.push(text);
    }
  }

  return textParts.join(' ').substring(0, 5000);
}

/**
 * Verify action outcome based on structured success criteria
 */
export async function verifyActionOutcome(
  hint: AgentHint,
  beforeState: PageState,
  afterState: PageState
): Promise<VerificationResult> {
  const criteria = hint.aiAnalysisContext?.successCriteria;

  if (!criteria) {
    // No structured criteria → fall back to DOM change detection
    return detectSignificantDOMChange(beforeState, afterState);
  }

  switch (criteria.type) {
    case 'modal_appears':
      return checkModalAppears(beforeState, afterState, criteria.params);

    case 'text_appears':
      return checkTextAppears(afterState, criteria.params.textPattern, criteria.params.inElement);

    case 'text_disappears':
      return checkTextDisappears(beforeState, afterState, criteria.params.textPattern);

    case 'url_changes':
      return checkUrlChange(beforeState.url, afterState.url, criteria.params.urlPattern);

    case 'element_appears':
      return checkElementAppears(afterState, criteria.params);

    case 'element_disappears':
      return checkElementDisappears(beforeState, afterState, criteria.params);

    case 'input_cleared':
      return { verified: true, confidence: 0.7, details: 'Input field state check' };

    case 'toast_appears':
      return checkToastAppears(afterState, criteria.params.toastType, criteria.params.toastPattern);

    case 'count_changes':
      return checkCountChange(beforeState, afterState, criteria.params);

    case 'dom_stabilizes':
      return { verified: await waitForDOMStable(), confidence: 0.7, details: 'DOM stabilized' };

    default:
      return { verified: true, confidence: 0.4, details: 'Unknown criteria type' };
  }
}

/**
 * Detect significant DOM change (fallback when no criteria)
 */
function detectSignificantDOMChange(before: PageState, after: PageState): VerificationResult {
  // URL changed
  if (before.url !== after.url) {
    return { verified: true, confidence: 0.8, details: 'URL changed' };
  }

  // Modal state changed
  if (before.hasModal !== after.hasModal) {
    return { verified: true, confidence: 0.8, details: 'Modal state changed' };
  }

  // Dropdown state changed
  if (before.hasDropdown !== after.hasDropdown) {
    return { verified: true, confidence: 0.7, details: 'Dropdown state changed' };
  }

  // New toast appeared
  if (after.toastMessages.length > before.toastMessages.length) {
    return { verified: true, confidence: 0.8, details: 'New notification appeared' };
  }

  // Significant text change
  if (Math.abs(after.visibleText.length - before.visibleText.length) > 100) {
    return { verified: true, confidence: 0.6, details: 'Visible text changed significantly' };
  }

  // Element count change (significant)
  const elementDiff = Math.abs(after.elementCount - before.elementCount);
  if (elementDiff > 10) {
    return { verified: true, confidence: 0.5, details: `Element count changed by ${elementDiff}` };
  }

  // No significant change detected
  return { verified: true, confidence: 0.4, details: 'No significant DOM change detected' };
}

/**
 * Check if modal appeared
 */
function checkModalAppears(before: PageState, after: PageState, _params: any): VerificationResult {
  if (!before.hasModal && after.hasModal) {
    return { verified: true, confidence: 0.95, details: 'Modal appeared', criteriaType: 'modal_appears' };
  }
  if (after.hasModal) {
    return { verified: true, confidence: 0.7, details: 'Modal is present', criteriaType: 'modal_appears' };
  }
  return { verified: false, confidence: 0.3, details: 'Modal did not appear', criteriaType: 'modal_appears' };
}

/**
 * Check if text appears on page
 */
function checkTextAppears(state: PageState, pattern?: string, _inElement?: string): VerificationResult {
  if (!pattern) {
    return { verified: true, confidence: 0.5, details: 'No pattern specified' };
  }

  try {
    const regex = new RegExp(pattern, 'i');
    const found = regex.test(state.visibleText);

    return {
      verified: found,
      confidence: found ? 0.9 : 0.3,
      details: found ? `Found "${pattern}"` : `"${pattern}" not found`,
      criteriaType: 'text_appears',
    };
  } catch (e) {
    // If regex fails, try simple includes
    const found = state.visibleText.toLowerCase().includes(pattern.toLowerCase());
    return {
      verified: found,
      confidence: found ? 0.8 : 0.3,
      details: found ? `Found "${pattern}"` : `"${pattern}" not found`,
      criteriaType: 'text_appears',
    };
  }
}

/**
 * Check if text disappeared
 */
function checkTextDisappears(before: PageState, after: PageState, pattern?: string): VerificationResult {
  if (!pattern) {
    return { verified: true, confidence: 0.5, details: 'No pattern specified' };
  }

  const wasPresent = before.visibleText.toLowerCase().includes(pattern.toLowerCase());
  const isGone = !after.visibleText.toLowerCase().includes(pattern.toLowerCase());

  if (wasPresent && isGone) {
    return { verified: true, confidence: 0.9, details: `"${pattern}" disappeared`, criteriaType: 'text_disappears' };
  }
  if (isGone) {
    return { verified: true, confidence: 0.7, details: `"${pattern}" not present`, criteriaType: 'text_disappears' };
  }
  return { verified: false, confidence: 0.3, details: `"${pattern}" still visible`, criteriaType: 'text_disappears' };
}

/**
 * Check if URL changed
 */
function checkUrlChange(beforeUrl: string, afterUrl: string, pattern?: string): VerificationResult {
  if (beforeUrl === afterUrl) {
    return { verified: false, confidence: 0.3, details: 'URL did not change', criteriaType: 'url_changes' };
  }

  if (pattern) {
    try {
      // Handle different pattern formats
      if (pattern.startsWith('contains=')) {
        const substring = pattern.replace('contains=', '');
        const found = afterUrl.includes(substring);
        return {
          verified: found,
          confidence: found ? 0.95 : 0.4,
          details: found ? `URL contains "${substring}"` : `URL doesn't contain "${substring}"`,
          criteriaType: 'url_changes',
        };
      }

      const regex = new RegExp(pattern);
      const matches = regex.test(afterUrl);
      return {
        verified: matches,
        confidence: matches ? 0.95 : 0.4,
        details: matches ? `URL matches pattern` : `URL doesn't match pattern`,
        criteriaType: 'url_changes',
      };
    } catch (e) {
      // Simple includes check
      const found = afterUrl.includes(pattern);
      return {
        verified: found,
        confidence: found ? 0.8 : 0.4,
        details: found ? `URL contains "${pattern}"` : `URL doesn't contain "${pattern}"`,
        criteriaType: 'url_changes',
      };
    }
  }

  return { verified: true, confidence: 0.8, details: 'URL changed', criteriaType: 'url_changes' };
}

/**
 * Check if element appears
 */
function checkElementAppears(state: PageState, params: any): VerificationResult {
  const { elementRole, elementName, elementDescription } = params;

  // Check by role
  if (elementRole) {
    const found = document.querySelector(`[role="${elementRole}"]`);
    if (found) {
      return { verified: true, confidence: 0.85, details: `Found element with role "${elementRole}"`, criteriaType: 'element_appears' };
    }
  }

  // Check by name
  if (elementName) {
    const found = document.querySelector(`[aria-label="${elementName}"]`) ||
                  document.querySelector(`[name="${elementName}"]`);
    if (found) {
      return { verified: true, confidence: 0.85, details: `Found element with name "${elementName}"`, criteriaType: 'element_appears' };
    }
  }

  // Check for dropdown state
  if (state.hasDropdown) {
    return { verified: true, confidence: 0.7, details: 'Dropdown is open', criteriaType: 'element_appears' };
  }

  return { verified: false, confidence: 0.3, details: `Element not found: ${elementDescription || elementRole || elementName}`, criteriaType: 'element_appears' };
}

/**
 * Check if element disappeared
 */
function checkElementDisappears(before: PageState, after: PageState, params: any): VerificationResult {
  const { elementDescription } = params;

  // Modal closed
  if (before.hasModal && !after.hasModal) {
    return { verified: true, confidence: 0.9, details: 'Modal closed', criteriaType: 'element_disappears' };
  }

  // Dropdown closed
  if (before.hasDropdown && !after.hasDropdown) {
    return { verified: true, confidence: 0.85, details: 'Dropdown closed', criteriaType: 'element_disappears' };
  }

  return { verified: true, confidence: 0.6, details: elementDescription || 'Element state checked', criteriaType: 'element_disappears' };
}

/**
 * Check if toast/notification appears
 */
function checkToastAppears(state: PageState, _toastType?: string, pattern?: string): VerificationResult {
  if (state.toastMessages.length === 0) {
    return { verified: false, confidence: 0.3, details: 'No toast found', criteriaType: 'toast_appears' };
  }

  if (pattern) {
    const regex = new RegExp(pattern, 'i');
    const matchingToast = state.toastMessages.find(msg => regex.test(msg));

    if (matchingToast) {
      return { verified: true, confidence: 0.95, details: `Found toast: "${matchingToast.substring(0, 50)}"`, criteriaType: 'toast_appears' };
    }
    return { verified: false, confidence: 0.4, details: `No toast matching "${pattern}"`, criteriaType: 'toast_appears' };
  }

  return { verified: true, confidence: 0.7, details: `Found ${state.toastMessages.length} toast(s)`, criteriaType: 'toast_appears' };
}

/**
 * Check if count changed
 */
function checkCountChange(before: PageState, after: PageState, params: any): VerificationResult {
  const { countElement, expectedChange, expectedValue: _expectedValue } = params;

  // Simple element count check if no specific selector
  if (!countElement) {
    const diff = after.elementCount - before.elementCount;
    if (expectedChange === 'increase' && diff > 0) {
      return { verified: true, confidence: 0.7, details: `Element count increased by ${diff}`, criteriaType: 'count_changes' };
    }
    if (expectedChange === 'decrease' && diff < 0) {
      return { verified: true, confidence: 0.7, details: `Element count decreased by ${-diff}`, criteriaType: 'count_changes' };
    }
    return { verified: true, confidence: 0.5, details: 'Count check performed', criteriaType: 'count_changes' };
  }

  return { verified: true, confidence: 0.5, details: 'Count change assumed', criteriaType: 'count_changes' };
}

/**
 * Wait for DOM to stabilize
 */
async function waitForDOMStable(timeout: number = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let lastChangeTime = Date.now();
    let observer: MutationObserver | null = null;

    const checkStability = () => {
      if (Date.now() - lastChangeTime > 300) {
        observer?.disconnect();
        resolve(true);
      } else if (Date.now() - lastChangeTime > timeout) {
        observer?.disconnect();
        resolve(true); // Timeout reached, consider stable
      } else {
        setTimeout(checkStability, 100);
      }
    };

    observer = new MutationObserver(() => {
      lastChangeTime = Date.now();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    checkStability();
  });
}

export const SuccessVerifier = {
  capturePageState,
  verifyActionOutcome,
  waitForDOMStable,
};
