/**
 * Optimized Click Primitive with Chrome Debugger API
 * 
 * Uses Chrome Debugger API for real trusted clicks.
 * Falls back to synthetic events only if debugger fails.
 */

import type {
  ActionResult,
  ElementSignature,
  ActionOptions,
} from '../../../types/universal-types';
import { checkInteractability, findClickableAncestor } from '../interactability-gate';

// ============================================================================
// Main Click Execution
// ============================================================================

/**
 * Execute a click - tries debugger first, falls back to synthetic
 */
export async function executeHumanClick(
  element: Element,
  signature: ElementSignature,
  options: ActionOptions = {}
): Promise<ActionResult> {
  const startTime = Date.now();
  const strategiesTried: string[] = [];
  const { timeout = 3000 } = options;

  // Get target element (handle wrappers)
  let targetElement = element;
  let interactability = checkInteractability(targetElement);
  
  if (!interactability.ok) {
    const clickableAncestor = findClickableAncestor(element);
    if (clickableAncestor) {
      targetElement = clickableAncestor;
      interactability = checkInteractability(targetElement);
    }
    
    // If element has zero dimensions, wait for it to render (especially for Salesforce Lightning)
    if (!interactability.ok && interactability.reason?.includes('zero dimensions')) {
      console.log(`[Click] Element has zero dimensions, waiting for render...`);
      const maxWait = 5000; // Wait up to 5 seconds
      const waitStart = Date.now();
      
      while (Date.now() - waitStart < maxWait) {
        await sleep(200);
        interactability = checkInteractability(targetElement);
        
        if (interactability.ok) {
          console.log(`[Click] Element became visible after ${Date.now() - waitStart}ms`);
          break;
        }
      }
      
      if (!interactability.ok) {
        console.warn(`[Click] Element still has zero dimensions after ${Date.now() - waitStart}ms wait`);
      }
    }
    
    if (!interactability.ok && interactability.reason?.includes('obscured')) {
      // CRITICAL: Only scroll if element is NOT in shadow DOM
      const isInShadowDOM = targetElement.getRootNode() instanceof ShadowRoot;
      if (!isInShadowDOM) {
        (targetElement as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(80);
        interactability = checkInteractability(targetElement);
      } else {
        console.log('[HumanClick] ⚠️ Element in shadow DOM - widget already visible, skipping scroll');
      }
    }
    
    if (!interactability.ok) {
      return {
        success: false,
        actionType: 'click',
        elapsedMs: Date.now() - startTime,
        strategiesTried: ['scroll-into-view', 'wait-for-dimensions'],
        error: `Element not interactable: ${interactability.reason}`,
      };
    }
  }

  // Calculate click position
  const rect = targetElement.getBoundingClientRect();
  const clickX = rect.left + rect.width / 2;
  const clickY = rect.top + rect.height / 2;
  
  const position = signature.clickTarget?.offsetFromCenter
    ? {
        x: clickX + signature.clickTarget.offsetFromCenter.x,
        y: clickY + signature.clickTarget.offsetFromCenter.y,
      }
    : { x: clickX, y: clickY };

  // Find element at coordinates (handles overlays)
  const elementAtPoint = document.elementFromPoint(position.x, position.y);
  if (elementAtPoint && elementAtPoint !== targetElement) {
    if (targetElement.contains(elementAtPoint) || elementAtPoint.contains(targetElement)) {
      targetElement = elementAtPoint;
    }
  }

  console.log(`[Click] ${targetElement.tagName} at (${Math.round(position.x)}, ${Math.round(position.y)})`);

  // Strategy 1: Try Chrome Debugger API first (real trusted clicks)
  strategiesTried.push('debugger-click');
  try {
    await debuggerClick(position);
    console.log(`[Click] Success with debugger`);
    return {
      success: true,
      actionType: 'click',
      elapsedMs: Date.now() - startTime,
      successfulStrategy: 'debugger-click',
      strategiesTried,
    };
  } catch (error) {
    console.debug(`[Click] Debugger failed, trying fallback:`, error);
  }

  // Strategy 2: Fast synthetic click (fallback)
  if (Date.now() - startTime < timeout) {
    strategiesTried.push('fast-click');
    try {
      await fastClick(targetElement, position);
      return {
        success: true,
        actionType: 'click',
        elapsedMs: Date.now() - startTime,
        successfulStrategy: 'fast-click',
        strategiesTried,
      };
    } catch (error) {
      // Continue
    }
  }

  // Strategy 3: Native click (last resort)
  if (Date.now() - startTime < timeout) {
    strategiesTried.push('native-click');
    try {
      if (targetElement instanceof HTMLElement) {
        targetElement.focus();
        targetElement.click();
        return {
          success: true,
          actionType: 'click',
          elapsedMs: Date.now() - startTime,
          successfulStrategy: 'native-click',
          strategiesTried,
        };
      }
    } catch (error) {
      // Continue
    }
  }

  return {
    success: false,
    actionType: 'click',
    elapsedMs: Date.now() - startTime,
    strategiesTried,
    error: 'All click strategies failed',
  };
}

// ============================================================================
// Click Strategies
// ============================================================================

/**
 * Chrome Debugger API click - sends REAL trusted events
 */
async function debuggerClick(position: { x: number; y: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'DEBUGGER_CLICK',
      x: position.x,
      y: position.y,
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve();
      } else {
        reject(new Error(response?.error || 'Debugger click failed'));
      }
    });
  });
}

/**
 * Fast synthetic click with minimal events
 */
async function fastClick(
  element: Element,
  position: { x: number; y: number }
): Promise<void> {
  const opts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: position.x,
    clientY: position.y,
    button: 0,
  };

  if (element instanceof HTMLElement) {
    element.focus();
  }

  // Minimal event sequence
  element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }));
  
  await sleep(15);
  
  element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', opts));
}

// ============================================================================
// Helper
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
