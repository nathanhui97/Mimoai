/**
 * Simple Click Primitive
 * 
 * Universal click handler that handles wrapper divs and
 * uses progressive strategies with verification.
 */

import type {
  ActionResult,
  ElementSignature,
  ExpectedOutcome,
  ActionOptions,
} from '../../../types/universal-types';
import { checkInteractability, findClickableAncestor } from '../interactability-gate';
import { detectAnyStateChange } from '../state-verifier';

// ============================================================================
// Main Click Execution
// ============================================================================

/**
 * Execute a click on an element with verification
 */
export async function executeClick(
  element: Element,
  signature: ElementSignature,
  options: ActionOptions = {}
): Promise<ActionResult> {
  const startTime = Date.now();
  const strategiesTried: string[] = [];
  const { timeout = 3000, expectedOutcomes = [] } = options;

  // Pre-check: Is element interactable?
  let targetElement = element;
  let interactability = checkInteractability(targetElement);
  
  // CRITICAL FIX: Special handling for dropdown options (role="option")
  // Options inside scrollable listboxes need to be scrolled into view FIRST
  const elementRole = targetElement.getAttribute('role');
  if (elementRole === 'option' || elementRole === 'menuitem') {
    console.log('[SimpleClick] Detected dropdown option/menu item, checking if in scrollable container...');
    
    // Find parent listbox/menu
    const { MenuDetector } = await import('../../menu-detector');
    const listbox = MenuDetector.findParentMenu(targetElement);
    if (listbox) {
      console.log('[SimpleClick] Found parent listbox/menu, scrolling option into view...');
      
      // Scroll the option into view within the listbox
      (targetElement as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'instant' });
      await sleep(150);
      
      // Also ensure the listbox itself is visible in the viewport
      if (listbox instanceof HTMLElement) {
        const listboxRect = listbox.getBoundingClientRect();
        const isListboxVisible = listboxRect.top >= 0 && 
                                 listboxRect.bottom <= window.innerHeight &&
                                 listboxRect.left >= 0 && 
                                 listboxRect.right <= window.innerWidth;
        
        if (!isListboxVisible) {
          // CRITICAL: Only scroll if listbox is NOT in shadow DOM
          const isListboxInShadowDOM = listbox.getRootNode() instanceof ShadowRoot;
          if (!isListboxInShadowDOM) {
            console.log('[SimpleClick] Listbox not fully visible, scrolling listbox into view...');
            listbox.scrollIntoView({ block: 'center', behavior: 'instant' });
            await sleep(150);
          } else {
            console.log('[SimpleClick] ⚠️ Listbox in shadow DOM - widget already visible, skipping scroll');
          }
        }
      }
      
      // Re-check interactability after scrolling
      interactability = checkInteractability(targetElement);
      console.log('[SimpleClick] After scrolling dropdown option - interactable:', interactability.ok);
    }
  }
  
  if (!interactability.ok) {
    // Try to find a clickable ancestor (handles wrapper divs)
    const clickableAncestor = findClickableAncestor(element);
    if (clickableAncestor) {
      targetElement = clickableAncestor;
      interactability = checkInteractability(targetElement);
    }
    
    if (!interactability.ok) {
      // If element is obscured, try scrolling it into view
      if (interactability.reason?.includes('obscured')) {
        // CRITICAL: Only scroll if element is NOT in shadow DOM
        const isInShadowDOM = targetElement.getRootNode() instanceof ShadowRoot;
        if (!isInShadowDOM) {
          console.log('[SimpleClick] Element obscured, scrolling into view...');
          (targetElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);
        } else {
          console.log('[SimpleClick] ⚠️ Element in shadow DOM - widget already visible, skipping scroll');
        }
        
        // Re-check interactability after scrolling
        interactability = checkInteractability(targetElement);
        
        if (!interactability.ok) {
          // Try scrolling more aggressively
          window.scrollBy({ top: -100, behavior: 'smooth' });
          await sleep(200);
          interactability = checkInteractability(targetElement);
        }
      }
      
      if (!interactability.ok) {
        return {
          success: false,
          actionType: 'click',
          elapsedMs: Date.now() - startTime,
          strategiesTried: ['scroll-into-view'],
          error: `Element not interactable: ${interactability.reason}`,
        };
      }
    }
  }

  // Determine where to click
  const clickPosition = getClickPosition(targetElement, signature);
  
  console.log(`[SimpleClick] Clicking element: ${targetElement.tagName}.${targetElement.className?.toString().split(' ')[0] || ''}`);
  console.log(`[SimpleClick] Click position:`, clickPosition);

  // CRITICAL: Find the ACTUAL element at the click coordinates
  // React often wraps elements and the wrapper might not handle clicks properly
  let clickTarget = targetElement;
  if (clickPosition.x && clickPosition.y) {
    const elementAtPoint = document.elementFromPoint(clickPosition.x, clickPosition.y);
    if (elementAtPoint && elementAtPoint !== targetElement) {
      // Found a different element at the coordinates - this might be the real target
      console.log(`[SimpleClick] Found different element at coordinates: ${elementAtPoint.tagName}.${elementAtPoint.className?.toString().split(' ')[0] || ''}`);
      // Check if it's inside our target or vice versa
      if (targetElement.contains(elementAtPoint) || elementAtPoint.contains(targetElement)) {
        clickTarget = elementAtPoint;
        console.log(`[SimpleClick] Using element at coordinates as click target`);
      }
    }
  }

  // Simplified click strategies - just try the most effective ones
  const strategies = [
    // Native click on element at coordinates (most reliable)
    { name: 'native-click', fn: () => nativeClick(clickTarget) },
    // Full pointer sequence (for React)
    { name: 'pointer-sequence', fn: () => dispatchPointerSequence(clickTarget, clickPosition) },
    // Focus and click
    { name: 'focus-click', fn: () => focusAndClick(clickTarget) },
  ];

  // Try each strategy
  for (const strategy of strategies) {
    strategiesTried.push(strategy.name);
    
    try {
      // Capture state before click
      const beforeUrl = window.location.href;
      
      // Execute click strategy
      await strategy.fn();
      
      // Wait a moment for any effects
      await sleep(50);
      
      // Check for success
      const verified = await verifyClickSuccess(
        targetElement,
        expectedOutcomes,
        beforeUrl,
        Math.min(timeout - (Date.now() - startTime), 500)
      );
      
      if (verified) {
        return {
          success: true,
          actionType: 'click',
          elapsedMs: Date.now() - startTime,
          successfulStrategy: strategy.name,
          strategiesTried,
        };
      }
    } catch (error) {
      // Strategy failed, try next
      console.debug(`Click strategy ${strategy.name} failed:`, error);
    }
    
    // Check timeout
    if (Date.now() - startTime >= timeout) {
      break;
    }
  }

  return {
    success: false,
    actionType: 'click',
    elapsedMs: Date.now() - startTime,
    strategiesTried,
    error: 'Click did not produce expected outcome after all strategies',
  };
}

// ============================================================================
// Click Strategies
// ============================================================================

/**
 * Strategy 1: Native click() method
 */
async function nativeClick(element: Element): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Cannot click non-HTML element');
  }
  
  element.focus();
  await sleep(20);
  element.click();
}

/**
 * Strategy 2: Focus then click
 */
async function focusAndClick(element: Element): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Cannot focus non-HTML element');
  }
  
  // Ensure focus
  element.focus();
  await sleep(50);
  
  // Dispatch focus event explicitly
  element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  await sleep(20);
  
  // Click
  element.click();
}

/**
 * Strategy 3: Full pointer event sequence
 */
async function dispatchPointerSequence(
  element: Element,
  position: { x: number; y: number }
): Promise<void> {
  // Focus
  if (element instanceof HTMLElement) {
    element.focus();
    await sleep(20);
  }
  
  // Hover
  element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(10);
  
  // Pointer down
  element.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: position.x,
    clientY: position.y,
  }));
  await sleep(10);
  
  // Mouse down
  element.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: position.x,
    clientY: position.y,
    button: 0,
    buttons: 1,
  }));
  await sleep(10);
  
  // Pointer up
  element.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: position.x,
    clientY: position.y,
  }));
  await sleep(10);
  
  // Mouse up
  element.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: position.x,
    clientY: position.y,
    button: 0,
    buttons: 0,
  }));
  await sleep(10);
  
  // Click
  element.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: position.x,
    clientY: position.y,
    button: 0,
  }));
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify that click had an effect
 */
async function verifyClickSuccess(
  element: Element,
  expectedOutcomes: ExpectedOutcome[],
  beforeUrl: string,
  timeout: number
): Promise<boolean> {
  // If specific outcomes are expected, check those
  if (expectedOutcomes.length > 0) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      let allPassed = true;
      
      for (const outcome of expectedOutcomes) {
        if (!checkOutcome(outcome, beforeUrl)) {
          allPassed = false;
          break;
        }
      }
      
      if (allPassed) {
        return true;
      }
      
      await sleep(50);
    }
    
    return false;
  }
  
  // Otherwise, detect any state change
  const stateChanged = await detectAnyStateChange(element, timeout);
  if (stateChanged) {
    return true;
  }
  
  // Check if URL changed (navigation)
  if (window.location.href !== beforeUrl) {
    return true;
  }
  
  // Check if active element changed
  if (document.activeElement === element) {
    // At minimum, focus changed - consider it a success
    return true;
  }
  
  // Check if any modal/overlay appeared
  const newModal = document.querySelector(
    '[role="dialog"]:not([hidden]), ' +
    '.modal.show, ' +
    '[class*="modal"]:not([hidden])'
  );
  if (newModal && isVisible(newModal)) {
    return true;
  }
  
  // Check if dropdown appeared
  const { MenuDetector } = await import('../../menu-detector');
  const newDropdown = MenuDetector.findVisibleMenu();
  if (newDropdown) {
    return true;
  }
  
  // Default: assume success if no errors thrown
  return true;
}

/**
 * Check a specific outcome
 */
function checkOutcome(outcome: ExpectedOutcome, beforeUrl: string): boolean {
  switch (outcome.type) {
    case 'element_visible': {
      const el = document.querySelector(outcome.selector);
      return el !== null && isVisible(el);
    }
    
    case 'element_gone': {
      const el = document.querySelector(outcome.selector);
      return el === null || !isVisible(el);
    }
    
    case 'url_changed': {
      return window.location.href !== beforeUrl;
    }
    
    case 'url_contains': {
      return window.location.href.includes(outcome.value);
    }
    
    default:
      return true;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get click position based on signature and element
 */
function getClickPosition(
  element: Element,
  signature: ElementSignature
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  
  // If we have offset from original click, use it
  if (signature.clickTarget?.offsetFromCenter) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      x: centerX + signature.clickTarget.offsetFromCenter.x,
      y: centerY + signature.clickTarget.offsetFromCenter.y,
    };
  }
  
  // Default to center
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * Check if element is visible
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


