/**
 * State Verifier
 * 
 * Verifies that actions produced expected outcomes.
 * Uses polling-based verification instead of arbitrary delays.
 */

import type {
  ExpectedOutcome,
  CapturedElementState,
} from '../../types/universal-types';

// ============================================================================
// Outcome Verification
// ============================================================================

/**
 * Verify that expected outcomes are met
 */
export async function verifyOutcome(
  outcomes: ExpectedOutcome[],
  timeout: number = 2000
): Promise<{ success: boolean; failedConditions: string[] }> {
  const startTime = Date.now();
  const failedConditions: string[] = [];
  
  while (Date.now() - startTime < timeout) {
    failedConditions.length = 0;
    let allPassed = true;
    
    for (const outcome of outcomes) {
      const passed = checkSingleOutcome(outcome);
      if (!passed) {
        allPassed = false;
        failedConditions.push(describeOutcome(outcome));
      }
    }
    
    if (allPassed) {
      return { success: true, failedConditions: [] };
    }
    
    // Wait before retry
    await sleep(50);
  }
  
  return { success: false, failedConditions };
}

/**
 * Check a single outcome condition
 */
function checkSingleOutcome(outcome: ExpectedOutcome): boolean {
  switch (outcome.type) {
    case 'element_visible': {
      const el = document.querySelector(outcome.selector);
      return el !== null && isVisible(el);
    }
    
    case 'element_gone': {
      const el = document.querySelector(outcome.selector);
      return el === null || !isVisible(el);
    }
    
    case 'element_has_text': {
      const el = document.querySelector(outcome.selector);
      return el !== null && el.textContent?.includes(outcome.text) === true;
    }
    
    case 'text_appears': {
      return document.body.textContent?.includes(outcome.text) === true;
    }
    
    case 'text_gone': {
      return document.body.textContent?.includes(outcome.text) === false;
    }
    
    case 'attribute_equals': {
      const el = document.querySelector(outcome.selector);
      return el !== null && el.getAttribute(outcome.attr) === outcome.value;
    }
    
    case 'attribute_contains': {
      const el = document.querySelector(outcome.selector);
      const attr = el?.getAttribute(outcome.attr);
      return attr !== null && attr !== undefined && attr.includes(outcome.value);
    }
    
    case 'url_contains': {
      return window.location.href.includes(outcome.value);
    }
    
    case 'url_changed': {
      // This needs to be checked against a baseline - handled separately
      return true;
    }
    
    case 'input_value': {
      const el = document.querySelector(outcome.selector);
      if (!el) return false;
      
      if (el instanceof HTMLInputElement || 
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement) {
        return el.value === outcome.value;
      }
      
      // Contenteditable
      return el.textContent?.trim() === outcome.value;
    }
    
    case 'dropdown_closed': {
      // Check for common dropdown menu patterns
      const openMenus = document.querySelectorAll(
        '[role="listbox"]:not([hidden]), ' +
        '[role="menu"]:not([hidden]), ' +
        '.MuiMenu-paper, ' +
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden), ' +
        '.dropdown-menu.show, ' +
        '[data-radix-select-content]'
      );
      
      for (const menu of openMenus) {
        if (isVisible(menu)) {
          return false;
        }
      }
      return true;
    }
    
    case 'dropdown_value': {
      const trigger = document.querySelector(outcome.triggerSelector);
      if (!trigger) return false;
      
      // Check various ways dropdown might show value
      const displayedValue = trigger.textContent?.trim();
      if (displayedValue?.includes(outcome.value)) return true;
      
      // Check aria-label
      const ariaLabel = trigger.getAttribute('aria-label');
      if (ariaLabel?.includes(outcome.value)) return true;
      
      // For native select
      if (trigger instanceof HTMLSelectElement) {
        const selectedOption = trigger.options[trigger.selectedIndex];
        if (selectedOption?.textContent?.includes(outcome.value)) return true;
      }
      
      return false;
    }
    
    case 'any_state_change': {
      // This is checked via captureElementState comparison
      return true;
    }
    
    default:
      return true;
  }
}

/**
 * Describe an outcome for error messages
 */
function describeOutcome(outcome: ExpectedOutcome): string {
  switch (outcome.type) {
    case 'element_visible':
      return `Element "${outcome.selector}" should be visible`;
    case 'element_gone':
      return `Element "${outcome.selector}" should be gone`;
    case 'element_has_text':
      return `Element "${outcome.selector}" should contain "${outcome.text}"`;
    case 'text_appears':
      return `Text "${outcome.text}" should appear`;
    case 'text_gone':
      return `Text "${outcome.text}" should disappear`;
    case 'attribute_equals':
      return `Element "${outcome.selector}" should have ${outcome.attr}="${outcome.value}"`;
    case 'attribute_contains':
      return `Element "${outcome.selector}" ${outcome.attr} should contain "${outcome.value}"`;
    case 'url_contains':
      return `URL should contain "${outcome.value}"`;
    case 'url_changed':
      return 'URL should change';
    case 'input_value':
      return `Input "${outcome.selector}" should have value "${outcome.value}"`;
    case 'dropdown_closed':
      return 'Dropdown should be closed';
    case 'dropdown_value':
      return `Dropdown should show value "${outcome.value}"`;
    case 'any_state_change':
      return 'Element state should change';
    default:
      return 'Unknown condition';
  }
}

// ============================================================================
// State Capture and Comparison
// ============================================================================

/**
 * Capture the current state of an element
 */
export function captureElementState(element: Element): CapturedElementState {
  return {
    className: element.className?.toString() || '',
    ariaExpanded: element.getAttribute('aria-expanded') || undefined,
    ariaChecked: element.getAttribute('aria-checked') || undefined,
    ariaPressed: element.getAttribute('aria-pressed') || undefined,
    ariaSelected: element.getAttribute('aria-selected') || undefined,
    ariaDisabled: element.getAttribute('aria-disabled') || undefined,
    disabled: (element as any).disabled === true,
    checked: (element as HTMLInputElement).checked,
    value: (element as HTMLInputElement).value,
    textContent: element.textContent?.slice(0, 100) || '',
    childCount: element.children.length,
    visible: isVisible(element),
  };
}

/**
 * Check if element state has changed
 */
export function hasStateChanged(
  before: CapturedElementState,
  after: CapturedElementState
): boolean {
  return (
    before.className !== after.className ||
    before.ariaExpanded !== after.ariaExpanded ||
    before.ariaChecked !== after.ariaChecked ||
    before.ariaPressed !== after.ariaPressed ||
    before.ariaSelected !== after.ariaSelected ||
    before.ariaDisabled !== after.ariaDisabled ||
    before.disabled !== after.disabled ||
    before.checked !== after.checked ||
    before.value !== after.value ||
    before.textContent !== after.textContent ||
    before.childCount !== after.childCount ||
    before.visible !== after.visible
  );
}

/**
 * Detect any state change on an element
 */
export async function detectAnyStateChange(
  element: Element,
  timeout: number = 1000
): Promise<boolean> {
  const initialState = captureElementState(element);
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const currentState = captureElementState(element);
    if (hasStateChanged(initialState, currentState)) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

// ============================================================================
// Wait for Conditions
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function waitForCondition(
  predicate: () => boolean,
  timeout: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (predicate()) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

/**
 * Wait for DOM to stabilize (no mutations)
 */
export async function waitForDOMStable(
  timeout: number = 2000,
  stableTime: number = 150
): Promise<boolean> {
  return new Promise(resolve => {
    let lastMutation = Date.now();
    let resolved = false;
    
    const observer = new MutationObserver(() => {
      lastMutation = Date.now();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    
    const checkStable = () => {
      if (resolved) return;
      
      const timeSinceLastMutation = Date.now() - lastMutation;
      
      if (timeSinceLastMutation >= stableTime) {
        resolved = true;
        observer.disconnect();
        resolve(true);
      } else if (Date.now() - lastMutation > timeout) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      } else {
        setTimeout(checkStable, 50);
      }
    };
    
    // Start checking after a brief delay
    setTimeout(checkStable, 50);
    
    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(false);
      }
    }, timeout);
  });
}

/**
 * Wait for an element to appear
 */
export async function waitForElement(
  selector: string,
  timeout: number = 2000
): Promise<Element | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) {
      return element;
    }
    await sleep(50);
  }
  
  return null;
}

/**
 * Wait for an element to disappear
 */
export async function waitForElementGone(
  selector: string,
  timeout: number = 2000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (!element || !isVisible(element)) {
      return true;
    }
    await sleep(50);
  }
  
  return false;
}

/**
 * Wait for dropdown menu to appear
 * Now uses unified MenuDetector for framework-agnostic detection
 */
export async function waitForDropdownMenu(
  timeout: number = 2000
): Promise<Element | null> {
  const { MenuDetector } = await import('../menu-detector');
  const result = await MenuDetector.waitForMenu(timeout);
  
  if (result.menu) {
    console.log(`[waitForDropdownMenu] ✅ Found menu via ${result.method} (${(result.confidence * 100).toFixed(0)}% confidence) in ${result.elapsedMs}ms`);
  } else {
    console.warn(`[waitForDropdownMenu] ⚠️ No menu found after ${result.elapsedMs}ms`);
  }
  
  return result.menu;
}

// ============================================================================
// Visibility Helpers
// ============================================================================

/**
 * Check if an element is visible
 */
function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return true;
  }
  
  const style = window.getComputedStyle(element);
  
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  
  return true;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Dropdown-Specific Verification
// ============================================================================

/**
 * Verify that a dropdown selection was successful
 */
export async function verifyDropdownSelection(
  trigger: Element,
  expectedValue: string,
  timeout: number = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    // Check trigger text content
    const triggerText = trigger.textContent?.trim();
    if (triggerText?.includes(expectedValue)) {
      return true;
    }
    
    // Check for native select
    if (trigger instanceof HTMLSelectElement) {
      const selectedOption = trigger.options[trigger.selectedIndex];
      if (selectedOption?.textContent?.includes(expectedValue)) {
        return true;
      }
      if (trigger.value === expectedValue) {
        return true;
      }
    }
    
    // Check value display elements inside trigger
    const valueDisplay = trigger.querySelector(
      '.MuiSelect-select, .ant-select-selection-item, ' +
      '[class*="value"], [class*="selected"]'
    );
    if (valueDisplay?.textContent?.includes(expectedValue)) {
      return true;
    }
    
    // Check aria-label
    const ariaLabel = trigger.getAttribute('aria-label');
    if (ariaLabel?.includes(expectedValue)) {
      return true;
    }
    
    await sleep(50);
  }
  
  return false;
}

/**
 * Verify that dropdown is closed
 */
export async function verifyDropdownClosed(
  timeout: number = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const openMenus = document.querySelectorAll(
      '[role="listbox"], [role="menu"], ' +
      '.MuiMenu-paper, .ant-select-dropdown:not(.ant-select-dropdown-hidden), ' +
      '.dropdown-menu.show, [data-radix-select-content]'
    );
    
    let anyVisible = false;
    for (const menu of openMenus) {
      if (isVisible(menu)) {
        anyVisible = true;
        break;
      }
    }
    
    if (!anyVisible) {
      return true;
    }
    
    await sleep(50);
  }
  
  return false;
}

// ============================================================================
// Semantic Page Signals Capture (for auto-generating outcomes)
// ============================================================================

/**
 * Modal fingerprint - semantic, not selector-based
 */
export interface ModalFingerprint {
  role: string;              // 'dialog' | 'alertdialog'
  headingText?: string;      // First h1/h2 text
  ariaLabel?: string;        // aria-label or aria-labelledby resolved text
  sizeBucket: 'small' | 'medium' | 'large' | 'fullscreen';
}

/**
 * Toast/notification fingerprint - semantic, not selector-based
 */
export interface ToastFingerprint {
  role: string;              // 'status' | 'alert'
  textSnippet: string;       // First 50 chars
  positionBucket: 'top' | 'bottom' | 'center';
}

/**
 * Region fingerprint for detecting DOM changes near target
 */
export interface RegionFingerprint {
  containerSelector: string; // Scope container near target
  textHash: string;          // Hash of text content
  childCount: number;
}

/**
 * Page signals captured before/after action
 * Uses semantic fingerprints, NOT brittle selectors
 */
export interface PageSignals {
  url: string;
  title: string;
  modals: ModalFingerprint[];
  toasts: ToastFingerprint[];
  regionFingerprints: RegionFingerprint[];
  spinnerCount: number;
  tableRowCounts: Map<string, number>;
}

/**
 * Capture semantic page signals for before/after diffing
 * 
 * @param nearElement - Optional element to capture region fingerprints near
 * @returns PageSignals with semantic fingerprints
 */
export function capturePageSignals(nearElement?: Element): PageSignals {
  return {
    url: window.location.href,
    title: document.title,
    modals: captureModalFingerprints(),
    toasts: captureToastFingerprints(),
    regionFingerprints: nearElement ? captureRegionFingerprints(nearElement) : [],
    spinnerCount: countVisibleSpinners(),
    tableRowCounts: captureTableRowCounts(),
  };
}

/**
 * Capture modal/dialog fingerprints
 */
function captureModalFingerprints(): ModalFingerprint[] {
  const fingerprints: ModalFingerprint[] = [];
  
  const modalSelectors = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '.modal',
    '[class*="modal"]',
    '[class*="Modal"]',
    '.MuiDialog-root',
  ];
  
  const modals = document.querySelectorAll(modalSelectors.join(', '));
  
  for (const modal of modals) {
    if (!isVisible(modal)) continue;
    
    // Get heading text
    const heading = modal.querySelector('h1, h2, h3, h4, [class*="title"], [class*="Title"], [class*="header"], [class*="Header"]');
    const headingText = heading?.textContent?.trim() || undefined;
    
    // Get aria-label or aria-labelledby
    const ariaLabel = modal.getAttribute('aria-label') || undefined;
    const ariaLabelledBy = modal.getAttribute('aria-labelledby');
    let resolvedAriaLabel = ariaLabel;
    if (!resolvedAriaLabel && ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      resolvedAriaLabel = labelEl?.textContent?.trim() || undefined;
    }
    
    // Determine size bucket
    const rect = modal.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const modalArea = rect.width * rect.height;
    const modalPercentage = (modalArea / viewportArea) * 100;
    
    let sizeBucket: ModalFingerprint['sizeBucket'];
    if (modalPercentage >= 80) {
      sizeBucket = 'fullscreen';
    } else if (modalPercentage >= 50) {
      sizeBucket = 'large';
    } else if (modalPercentage >= 20) {
      sizeBucket = 'medium';
    } else {
      sizeBucket = 'small';
    }
    
    fingerprints.push({
      role: modal.getAttribute('role') || 'dialog',
      headingText,
      ariaLabel: resolvedAriaLabel,
      sizeBucket,
    });
  }
  
  return fingerprints;
}

/**
 * Capture toast/notification fingerprints
 */
function captureToastFingerprints(): ToastFingerprint[] {
  const fingerprints: ToastFingerprint[] = [];
  
  const toastSelectors = [
    '[role="status"]',
    '[role="alert"]',
    '.toast',
    '.notification',
    '[class*="toast"]',
    '[class*="Toast"]',
    '[class*="notification"]',
    '[class*="Notification"]',
    '.MuiSnackbar-root',
    '.ant-message',
  ];
  
  const toasts = document.querySelectorAll(toastSelectors.join(', '));
  
  for (const toast of toasts) {
    if (!isVisible(toast)) continue;
    
    // Get text snippet (first 50 chars)
    const text = toast.textContent?.trim() || '';
    const textSnippet = text.slice(0, 50);
    if (!textSnippet) continue;
    
    // Determine position bucket
    const rect = toast.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    let positionBucket: ToastFingerprint['positionBucket'];
    
    if (rect.top < viewportHeight / 3) {
      positionBucket = 'top';
    } else if (rect.top > (viewportHeight * 2) / 3) {
      positionBucket = 'bottom';
    } else {
      positionBucket = 'center';
    }
    
    fingerprints.push({
      role: toast.getAttribute('role') || 'status',
      textSnippet,
      positionBucket,
    });
  }
  
  return fingerprints;
}

/**
 * Capture region fingerprints near target element (1-3 containers)
 */
function captureRegionFingerprints(nearElement: Element): RegionFingerprint[] {
  const fingerprints: RegionFingerprint[] = [];
  
  // Find up to 3 container elements
  let current: Element | null = nearElement.parentElement;
  let checked = 0;
  const maxContainers = 3;
  
  while (current && checked < maxContainers) {
    // Skip body/html
    if (current.tagName === 'BODY' || current.tagName === 'HTML') {
      current = current.parentElement;
      continue;
    }
    
    // Look for meaningful containers (sections, articles, divs with role, etc.)
    const role = current.getAttribute('role');
    const hasId = !!current.id;
    const hasClass = current.classList.length > 0;
    
    if (role || hasId || hasClass) {
      try {
        // Generate a simple selector
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector = `#${current.id}`;
        } else if (role) {
          selector = `[role="${role}"]`;
        } else if (current.classList.length > 0) {
          selector = `.${Array.from(current.classList).slice(0, 2).join('.')}`;
        }
        
        // Hash text content
        const textContent = current.textContent?.trim() || '';
        const textHash = simpleHash(textContent.slice(0, 200)); // Hash first 200 chars
        
        fingerprints.push({
          containerSelector: selector,
          textHash,
          childCount: current.children.length,
        });
        
        checked++;
      } catch (e) {
        // Skip this container
      }
    }
    
    current = current.parentElement;
  }
  
  return fingerprints;
}

/**
 * Count visible spinners/loaders
 */
function countVisibleSpinners(): number {
  const spinnerSelectors = [
    '.loading',
    '.loader',
    '.spinner',
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="loader"]',
    '[role="progressbar"]',
    '.MuiCircularProgress-root',
    '.sk-spinner',
    '.ant-spin',
  ];
  
  const spinners = document.querySelectorAll(spinnerSelectors.join(', '));
  let count = 0;
  
  for (const spinner of spinners) {
    if (isVisible(spinner)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Capture row counts for visible tables
 */
function captureTableRowCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  
  const tables = document.querySelectorAll('table, [role="table"], [role="grid"]');
  
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    if (!isVisible(table)) continue;
    
    const rows = table.querySelectorAll('tr, [role="row"]');
    const visibleRows = Array.from(rows).filter(row => isVisible(row));
    
    // Use table index as key
    counts.set(`table-${i}`, visibleRows.length);
  }
  
  return counts;
}

/**
 * Simple string hash function
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Generate expected outcomes by diffing before/after page signals
 * 
 * @param before - Page signals captured before action
 * @param after - Page signals captured after action
 * @returns Array of ExpectedOutcome that can be verified
 */
export function generateOutcomesFromDiff(
  before: PageSignals,
  after: PageSignals
): ExpectedOutcome[] {
  const outcomes: ExpectedOutcome[] = [];
  
  // 1. URL changed
  if (before.url !== after.url) {
    outcomes.push({
      type: 'url_contains',
      value: new URL(after.url).pathname, // Just the path
    });
  }
  
  // 2. Title changed
  if (before.title !== after.title) {
    outcomes.push({
      type: 'text_appears',
      text: after.title.slice(0, 50), // First 50 chars
    });
  }
  
  // 3. Modal appeared
  if (after.modals.length > before.modals.length) {
    const newModal = after.modals[after.modals.length - 1];
    if (newModal.headingText) {
      outcomes.push({
        type: 'text_appears',
        text: newModal.headingText,
      });
    }
    // Generic modal visible check
    outcomes.push({
      type: 'element_visible',
      selector: '[role="dialog"], [role="alertdialog"]',
    });
  }
  
  // 4. Modal disappeared
  if (before.modals.length > after.modals.length) {
    outcomes.push({
      type: 'element_gone',
      selector: '[role="dialog"], [role="alertdialog"]',
    });
  }
  
  // 5. Toast appeared
  if (after.toasts.length > before.toasts.length) {
    const newToast = after.toasts[after.toasts.length - 1];
    if (newToast.textSnippet) {
      outcomes.push({
        type: 'text_appears',
        text: newToast.textSnippet,
      });
    }
  }
  
  // 6. Spinner count changed (e.g., spinner appeared then disappeared)
  if (before.spinnerCount !== after.spinnerCount) {
    if (after.spinnerCount === 0 && before.spinnerCount > 0) {
      // Spinners disappeared - good outcome
      outcomes.push({
        type: 'element_gone',
        selector: '[class*="spinner"], [class*="loading"]',
      });
    }
  }
  
  // 7. Table row count changed
  for (const [tableKey, beforeCount] of before.tableRowCounts) {
    const afterCount = after.tableRowCounts.get(tableKey);
    if (afterCount !== undefined && afterCount !== beforeCount) {
      // Don't add specific outcome for table rows (too brittle)
      // Just log it for debugging
      console.log(`[PageSignals] Table ${tableKey} rows changed: ${beforeCount} → ${afterCount}`);
    }
  }
  
  // 8. Region changed (DOM changed near target)
  for (const beforeRegion of before.regionFingerprints) {
    const afterRegion = after.regionFingerprints.find(
      r => r.containerSelector === beforeRegion.containerSelector
    );
    if (afterRegion) {
      if (beforeRegion.textHash !== afterRegion.textHash || 
          beforeRegion.childCount !== afterRegion.childCount) {
        // Region changed - generic "DOM changed" outcome
        outcomes.push({
          type: 'any_state_change',
        });
        break; // Only add once
      }
    }
  }
  
  // If no specific outcomes detected, add a generic "DOM stable" check
  if (outcomes.length === 0) {
    outcomes.push({
      type: 'any_state_change',
    });
  }
  
  return outcomes;
}

