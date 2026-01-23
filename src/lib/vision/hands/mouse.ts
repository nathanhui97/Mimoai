/**
 * CDP Mouse Control
 *
 * Precise mouse control using Chrome DevTools Protocol.
 * All actions are coordinate-based - no DOM access.
 */

import type { Point } from '../types';

/**
 * CDP connection state
 */
interface CDPConnection {
  tabId: number;
  attached: boolean;
}

let currentConnection: CDPConnection | null = null;

/**
 * Attach debugger to a tab for CDP access
 */
export async function attachDebugger(tabId: number): Promise<void> {
  if (currentConnection?.tabId === tabId && currentConnection.attached) {
    return; // Already attached
  }

  // Detach from any previous tab
  if (currentConnection?.attached) {
    try {
      await chrome.debugger.detach({ tabId: currentConnection.tabId });
    } catch {
      // Ignore errors when detaching
    }
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      currentConnection = { tabId, attached: true };
      resolve();
    });
  });
}

/**
 * Detach debugger from current tab
 */
export async function detachDebugger(): Promise<void> {
  if (!currentConnection?.attached) {
    return;
  }

  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId: currentConnection!.tabId }, () => {
      currentConnection = null;
      resolve();
    });
  });
}

/**
 * Get the current connection
 */
export function getCurrentConnection(): CDPConnection | null {
  return currentConnection;
}

/**
 * Check if debugger is attached
 */
export function isDebuggerAttached(): boolean {
  return currentConnection?.attached ?? false;
}

/**
 * Send CDP command
 */
async function sendCommand<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  if (!currentConnection?.attached) {
    throw new Error('Debugger not attached. Call attachDebugger() first.');
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId: currentConnection!.tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result as T);
    });
  });
}

/**
 * Move mouse to coordinates
 */
export async function mouseMove(x: number, y: number): Promise<void> {
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
}

/**
 * Press mouse button down at coordinates
 */
export async function mouseDown(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount: 1,
  });
}

/**
 * Release mouse button at coordinates
 */
export async function mouseUp(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    clickCount: 1,
  });
}

/**
 * Click at coordinates
 */
export async function mouseClick(x: number, y: number): Promise<void> {
  console.log(`[CDP Mouse] Clicking at (${x}, ${y}), tabId=${currentConnection?.tabId}`);

  // Move to position
  await mouseMove(x, y);
  console.log(`[CDP Mouse] Mouse moved to (${x}, ${y})`);

  // Small delay to simulate human movement
  await delay(50);

  // Click
  await mouseDown(x, y);
  console.log(`[CDP Mouse] Mouse down at (${x}, ${y})`);
  await delay(50);
  await mouseUp(x, y);
  console.log(`[CDP Mouse] Mouse up at (${x}, ${y}) - click complete`);
}

/**
 * Double-click at coordinates
 */
export async function mouseDoubleClick(x: number, y: number): Promise<void> {
  await mouseMove(x, y);
  await delay(50);

  // First click
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });

  await delay(50);

  // Second click
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 2,
  });
  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 2,
  });
}

/**
 * Right-click at coordinates
 */
export async function mouseRightClick(x: number, y: number): Promise<void> {
  await mouseMove(x, y);
  await delay(50);
  await mouseDown(x, y, 'right');
  await delay(50);
  await mouseUp(x, y, 'right');
}

/**
 * Hover at coordinates (move mouse and wait)
 */
export async function mouseHover(x: number, y: number, duration: number = 500): Promise<void> {
  await mouseMove(x, y);
  await delay(duration);
}

/**
 * Drag from one point to another
 */
export async function mouseDrag(from: Point, to: Point): Promise<void> {
  // Move to start position
  await mouseMove(from.x, from.y);
  await delay(100);

  // Press button
  await mouseDown(from.x, from.y);
  await delay(50);

  // Calculate intermediate points for smooth drag
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const currentX = from.x + (to.x - from.x) * progress;
    const currentY = from.y + (to.y - from.y) * progress;
    await mouseMove(currentX, currentY);
    await delay(20);
  }

  // Release at end position
  await delay(50);
  await mouseUp(to.x, to.y);
}

/**
 * Drag element by offset
 */
export async function mouseDragBy(from: Point, offsetX: number, offsetY: number): Promise<void> {
  await mouseDrag(from, { x: from.x + offsetX, y: from.y + offsetY });
}

/**
 * Click and hold at coordinates
 */
export async function mouseClickAndHold(x: number, y: number, duration: number = 1000): Promise<void> {
  await mouseMove(x, y);
  await delay(50);
  await mouseDown(x, y);
  await delay(duration);
  await mouseUp(x, y);
}

/**
 * Utility function for delays
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mouse event with modifiers
 */
export async function mouseClickWithModifiers(
  x: number,
  y: number,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
): Promise<void> {
  let modifierFlags = 0;
  if (modifiers.alt) modifierFlags |= 1;
  if (modifiers.ctrl) modifierFlags |= 2;
  if (modifiers.meta) modifierFlags |= 4;
  if (modifiers.shift) modifierFlags |= 8;

  await mouseMove(x, y);
  await delay(50);

  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
    modifiers: modifierFlags,
  });

  await delay(50);

  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
    modifiers: modifierFlags,
  });
}
