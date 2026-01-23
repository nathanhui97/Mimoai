/**
 * CDP Scroll Control
 *
 * Scrolling actions using Chrome DevTools Protocol.
 * Uses mouse wheel events for natural scrolling behavior.
 */

import type { Point } from '../types';

/**
 * Get CDP connection from mouse module
 */
async function sendCommand<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const { getCurrentConnection } = await import('./mouse');
  const connection = getCurrentConnection();

  if (!connection?.attached) {
    throw new Error('Debugger not attached. Call attachDebugger() first.');
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId: connection.tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result as T);
    });
  });
}

/**
 * Scroll by delta amount using mouse wheel
 */
export async function scrollBy(
  deltaX: number,
  deltaY: number,
  position?: Point
): Promise<void> {
  // Default to center of viewport if no position specified
  const x = position?.x ?? 640;
  const y = position?.y ?? 360;

  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  });

  // Allow page to update
  await delay(100);
}

/**
 * Scroll down by pixels
 */
export async function scrollDown(pixels: number = 300, position?: Point): Promise<void> {
  await scrollBy(0, pixels, position);
}

/**
 * Scroll up by pixels
 */
export async function scrollUp(pixels: number = 300, position?: Point): Promise<void> {
  await scrollBy(0, -pixels, position);
}

/**
 * Scroll left by pixels
 */
export async function scrollLeft(pixels: number = 300, position?: Point): Promise<void> {
  await scrollBy(-pixels, 0, position);
}

/**
 * Scroll right by pixels
 */
export async function scrollRight(pixels: number = 300, position?: Point): Promise<void> {
  await scrollBy(pixels, 0, position);
}

/**
 * Smooth scroll by total delta over multiple steps
 */
export async function smoothScrollBy(
  deltaX: number,
  deltaY: number,
  duration: number = 500
): Promise<void> {
  const steps = Math.ceil(duration / 50);
  const stepDeltaX = deltaX / steps;
  const stepDeltaY = deltaY / steps;

  for (let i = 0; i < steps; i++) {
    await scrollBy(stepDeltaX, stepDeltaY);
    await delay(50);
  }
}

/**
 * Smooth scroll down
 */
export async function smoothScrollDown(pixels: number = 500, duration: number = 500): Promise<void> {
  await smoothScrollBy(0, pixels, duration);
}

/**
 * Smooth scroll up
 */
export async function smoothScrollUp(pixels: number = 500, duration: number = 500): Promise<void> {
  await smoothScrollBy(0, -pixels, duration);
}

/**
 * Scroll to top of page
 */
export async function scrollToTop(): Promise<void> {
  // Use keyboard shortcut - most reliable
  const { pressHotkey } = await import('./keyboard');
  await pressHotkey(['Control', 'Home']);
  await delay(200);
}

/**
 * Scroll to bottom of page
 */
export async function scrollToBottom(): Promise<void> {
  const { pressHotkey } = await import('./keyboard');
  await pressHotkey(['Control', 'End']);
  await delay(200);
}

/**
 * Page down (scroll by viewport height)
 */
export async function pageDown(): Promise<void> {
  const { pressKey } = await import('./keyboard');
  await pressKey('PageDown');
  await delay(200);
}

/**
 * Page up (scroll by viewport height)
 */
export async function pageUp(): Promise<void> {
  const { pressKey } = await import('./keyboard');
  await pressKey('PageUp');
  await delay(200);
}

/**
 * Scroll to bring an element into view
 * This is a higher-level function that works with element coordinates
 */
export async function scrollToElement(
  elementCenter: Point,
  viewport: { width: number; height: number }
): Promise<void> {
  const viewportCenter = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };

  // Calculate offset needed
  const offsetY = elementCenter.y - viewportCenter.y;

  if (Math.abs(offsetY) > viewport.height * 0.3) {
    // Element is significantly off-center, scroll to bring it into view
    await smoothScrollBy(0, offsetY * 0.8, 300);
  }
}

/**
 * Scroll within a specific scrollable container
 * Requires knowing the container's position
 */
export async function scrollInContainer(
  containerCenter: Point,
  deltaY: number
): Promise<void> {
  // Position mouse over container first
  const { mouseMove } = await import('./mouse');
  await mouseMove(containerCenter.x, containerCenter.y);
  await delay(50);

  // Now scroll
  await scrollBy(0, deltaY, containerCenter);
}

/**
 * Wait for scroll to settle
 */
export async function waitForScrollEnd(timeout: number = 1000): Promise<void> {
  await delay(Math.min(timeout, 300));
}

/**
 * Utility function for delays
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
