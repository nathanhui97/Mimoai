/**
 * Interactability Gate
 * 
 * Pre-action validation to ensure an element can actually be interacted with.
 * Provides clear failure reasons instead of mysterious "click didn't work".
 */

import type {
  InteractabilityResult,
  VisibilityDetails,
} from '../../types/universal-types';

// ============================================================================
// Main Interactability Check
// ============================================================================

/**
 * Check if an element is interactable (visible, enabled, not obscured)
 */
export function checkInteractability(element: Element): InteractabilityResult {
  // 1. Check visibility
  const visibility = checkVisibility(element);
  if (!visibility.isDisplayed) {
    return {
      ok: false,
      reason: `Element has display: ${visibility.computedDisplay}`,
      suggestion: 'Wait for element to be displayed or check if it exists in the DOM',
    };
  }
  if (!visibility.isVisible) {
    return {
      ok: false,
      reason: `Element has visibility: ${visibility.computedVisibility}`,
      suggestion: 'Wait for element to become visible',
    };
  }
  if (!visibility.hasOpacity) {
    return {
      ok: false,
      reason: `Element has opacity: ${visibility.computedOpacity}`,
      suggestion: 'Wait for element opacity animation to complete',
    };
  }
  if (!visibility.hasDimensions) {
    return {
      ok: false,
      reason: 'Element has zero dimensions (width or height is 0)',
      suggestion: 'Element may not be fully rendered yet',
    };
  }

  // 2. Check if element is in viewport (or can be scrolled)
  if (!visibility.isInViewport) {
    // Try to scroll into view
    const scrolled = scrollIntoViewIfNeeded(element);
    if (!scrolled) {
      return {
        ok: false,
        reason: 'Element is outside viewport and cannot be scrolled into view',
        suggestion: 'Check if element is in a hidden scrollable container',
      };
    }
  }

  // 3. Check if element is enabled
  const enabledCheck = checkEnabled(element);
  if (!enabledCheck.ok) {
    return enabledCheck;
  }

  // 4. Check if element is obscured by another element
  const obscuredCheck = checkNotObscured(element);
  if (!obscuredCheck.ok) {
    return obscuredCheck;
  }

  // 5. Check if element is correct type for interaction
  const typeCheck = checkInteractableType(element);
  if (!typeCheck.ok) {
    return typeCheck;
  }

  return { ok: true };
}

// ============================================================================
// Individual Checks
// ============================================================================

/**
 * Check element visibility
 */
export function checkVisibility(element: Element): VisibilityDetails {
  const result: VisibilityDetails = {
    isDisplayed: true,
    isVisible: true,
    hasOpacity: true,
    hasDimensions: true,
    isInViewport: false,
  };

  if (!(element instanceof HTMLElement)) {
    // For non-HTML elements (SVG etc.), assume visible
    result.isInViewport = true;
    return result;
  }

  const style = window.getComputedStyle(element);
  
  // Check display
  result.computedDisplay = style.display;
  if (style.display === 'none') {
    result.isDisplayed = false;
    return result;
  }

  // Check visibility
  result.computedVisibility = style.visibility;
  if (style.visibility === 'hidden') {
    result.isVisible = false;
    return result;
  }

  // Check opacity
  result.computedOpacity = style.opacity;
  const opacity = parseFloat(style.opacity);
  if (opacity === 0) {
    result.hasOpacity = false;
    return result;
  }

  // Check dimensions
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    result.hasDimensions = false;
    return result;
  }

  // Check if in viewport
  result.isInViewport = isInViewport(element);

  return result;
}

/**
 * Check if element is in the viewport
 */
function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

/**
 * Scroll element into view if needed
 * CRITICAL: Never scroll elements inside shadow DOM - they're already visible!
 */
function scrollIntoViewIfNeeded(element: Element): boolean {
  if (isInViewport(element)) {
    return true;
  }

  // CRITICAL: Check if element is in shadow DOM
  // Elements inside shadow roots should NEVER trigger page scrolls!
  const isInShadowDOM = element.getRootNode() instanceof ShadowRoot;
  if (isInShadowDOM) {
    console.log('[InteractabilityGate] ⚠️ Element in shadow DOM - NEVER scroll page (widget already visible)');
    return true; // Consider it "in viewport" since shadow host is visible
  }

  try {
    element.scrollIntoView({
      behavior: 'instant',
      block: 'center',
      inline: 'center',
    });
    
    // Check if now in viewport
    return isInViewport(element);
  } catch {
    return false;
  }
}

/**
 * Check if element is enabled (not disabled)
 */
function checkEnabled(element: Element): InteractabilityResult {
  // Check disabled attribute
  if (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) {
    if (element.disabled) {
      return {
        ok: false,
        reason: 'Element has disabled attribute',
        suggestion: 'Wait for element to be enabled',
      };
    }
  }

  // Check aria-disabled
  const ariaDisabled = element.getAttribute('aria-disabled');
  if (ariaDisabled === 'true') {
    return {
      ok: false,
      reason: 'Element has aria-disabled="true"',
      suggestion: 'Wait for element to be enabled',
    };
  }

  // Check for disabled class (common pattern)
  if (element.classList.contains('disabled') ||
      element.classList.contains('is-disabled')) {
    return {
      ok: false,
      reason: 'Element has disabled class',
      suggestion: 'Wait for disabled class to be removed',
    };
  }

  // Check pointer-events
  if (element instanceof HTMLElement) {
    const style = window.getComputedStyle(element);
    if (style.pointerEvents === 'none') {
      return {
        ok: false,
        reason: 'Element has pointer-events: none',
        suggestion: 'Element may be disabled via CSS',
      };
    }
  }

  return { ok: true };
}

/**
 * Check if element is obscured by another element
 */
function checkNotObscured(element: Element): InteractabilityResult {
  const rect = element.getBoundingClientRect();
  
  // Check center point
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const topElement = document.elementFromPoint(centerX, centerY);
  
  if (!topElement) {
    // Point is outside viewport or on something weird
    return { ok: true }; // Allow it anyway
  }

  // Check if the top element is the target or a child of target
  if (topElement === element || element.contains(topElement)) {
    return { ok: true };
  }

  // Check if target contains the top element (click might still work)
  if (topElement.contains(element)) {
    return { ok: true };
  }

  // Check if they share a common clickable parent
  const commonAncestor = findCommonAncestor(element, topElement);
  if (commonAncestor && isClickableAncestor(commonAncestor, element)) {
    return { ok: true };
  }

  // Element is obscured
  return {
    ok: false,
    reason: `Element is obscured by ${describeElement(topElement)}`,
    suggestion: 'Close any modals, dropdowns, or overlays that may be covering the element',
    blockingElement: topElement,
  };
}

/**
 * Check if element is an interactable type
 */
function checkInteractableType(element: Element): InteractabilityResult {
  // Native interactive elements are always ok
  const interactiveTags = new Set([
    'BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY',
  ]);
  
  if (interactiveTags.has(element.tagName)) {
    return { ok: true };
  }

  // ARIA roles that are interactive
  const role = element.getAttribute('role');
  const interactiveRoles = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'tab', 'checkbox', 'radio', 'switch', 'combobox',
    'listbox', 'textbox', 'slider', 'spinbutton', 'treeitem',
  ]);
  
  if (role && interactiveRoles.has(role)) {
    return { ok: true };
  }

  // Elements with tabindex are focusable/clickable
  const tabIndex = element.getAttribute('tabindex');
  if (tabIndex !== null) {
    const tabIndexNum = parseInt(tabIndex, 10);
    if (tabIndexNum >= 0) {
      return { ok: true };
    }
  }

  // Elements with click handlers (data attributes)
  if (element.hasAttribute('onclick') ||
      element.hasAttribute('data-clickable') ||
      element.hasAttribute('data-action')) {
    return { ok: true };
  }

  // Check for cursor: pointer (often indicates clickable)
  if (element instanceof HTMLElement) {
    const style = window.getComputedStyle(element);
    if (style.cursor === 'pointer') {
      return { ok: true };
    }
  }

  // Allow DIV and SPAN with role or tabindex (covered above)
  // For other elements, warn but allow
  return { ok: true };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find common ancestor of two elements
 */
function findCommonAncestor(el1: Element, el2: Element): Element | null {
  const ancestors1 = new Set<Element>();
  let current: Element | null = el1;
  
  while (current) {
    ancestors1.add(current);
    current = current.parentElement;
  }
  
  current = el2;
  while (current) {
    if (ancestors1.has(current)) {
      return current;
    }
    current = current.parentElement;
  }
  
  return null;
}

/**
 * Check if ancestor is a clickable parent that would delegate click to child
 */
function isClickableAncestor(ancestor: Element, child: Element): boolean {
  // Check if ancestor is a button or link that contains the child
  if (['BUTTON', 'A'].includes(ancestor.tagName)) {
    return ancestor.contains(child);
  }
  
  // Check for role
  const role = ancestor.getAttribute('role');
  if (role && ['button', 'link', 'menuitem', 'option'].includes(role)) {
    return ancestor.contains(child);
  }
  
  return false;
}

/**
 * Describe an element for error messages
 */
function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = element.className && typeof element.className === 'string'
    ? '.' + element.className.split(' ').slice(0, 2).join('.')
    : '';
  const role = element.getAttribute('role') ? `[role="${element.getAttribute('role')}"]` : '';
  
  let description = tag + id + classes + role;
  
  // Add text hint
  const text = element.textContent?.trim().slice(0, 20);
  if (text) {
    description += ` ("${text}${text.length >= 20 ? '...' : ''}")`;
  }
  
  return description;
}

// ============================================================================
// Wait for Interactable
// ============================================================================

/**
 * Wait for element to become interactable
 */
export async function waitForInteractable(
  element: Element,
  timeout: number = 5000
): Promise<InteractabilityResult> {
  const startTime = Date.now();
  let lastResult: InteractabilityResult = { ok: false, reason: 'Timeout' };
  
  while (Date.now() - startTime < timeout) {
    lastResult = checkInteractability(element);
    
    if (lastResult.ok) {
      return lastResult;
    }
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return {
    ok: false,
    reason: `Timeout waiting for element to be interactable: ${lastResult.reason}`,
    suggestion: lastResult.suggestion,
  };
}

/**
 * Find a clickable ancestor if element itself is not directly clickable
 */
export function findClickableAncestor(element: Element): Element | null {
  let current: Element | null = element.parentElement;
  
  while (current && current !== document.body) {
    // Check if this ancestor is clickable and visible
    const visibility = checkVisibility(current);
    if (!visibility.isDisplayed || !visibility.isVisible) {
      current = current.parentElement;
      continue;
    }
    
    // Check if it's an interactive element
    if (isInteractiveElement(current)) {
      return current;
    }
    
    current = current.parentElement;
  }
  
  return null;
}

/**
 * Check if element is natively interactive
 */
function isInteractiveElement(element: Element): boolean {
  // Native interactive tags
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
    return true;
  }
  
  // Interactive ARIA roles
  const role = element.getAttribute('role');
  if (role && ['button', 'link', 'menuitem', 'option', 'tab', 'checkbox', 'radio'].includes(role)) {
    return true;
  }
  
  // Focusable elements
  const tabIndex = element.getAttribute('tabindex');
  if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) {
    return true;
  }
  
  return false;
}








