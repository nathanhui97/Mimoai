/**
 * CDP Keyboard Control
 *
 * Precise keyboard control using Chrome DevTools Protocol.
 * Handles text input, special keys, and keyboard shortcuts.
 */

/**
 * Key codes for special keys
 * Based on Chrome DevTools Protocol Input.dispatchKeyEvent
 */
const KEY_CODES: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  // Navigation
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },

  // Arrows
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },

  // Modifiers
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },

  // Function keys
  F1: { key: 'F1', code: 'F1', keyCode: 112 },
  F2: { key: 'F2', code: 'F2', keyCode: 113 },
  F3: { key: 'F3', code: 'F3', keyCode: 114 },
  F4: { key: 'F4', code: 'F4', keyCode: 115 },
  F5: { key: 'F5', code: 'F5', keyCode: 116 },
  F6: { key: 'F6', code: 'F6', keyCode: 117 },
  F7: { key: 'F7', code: 'F7', keyCode: 118 },
  F8: { key: 'F8', code: 'F8', keyCode: 119 },
  F9: { key: 'F9', code: 'F9', keyCode: 120 },
  F10: { key: 'F10', code: 'F10', keyCode: 121 },
  F11: { key: 'F11', code: 'F11', keyCode: 122 },
  F12: { key: 'F12', code: 'F12', keyCode: 123 },

  // Other
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
};

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
 * Press a key down
 */
export async function keyDown(
  key: string,
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
): Promise<void> {
  const keyInfo = KEY_CODES[key];

  let modifierFlags = 0;
  if (modifiers?.alt) modifierFlags |= 1;
  if (modifiers?.ctrl) modifierFlags |= 2;
  if (modifiers?.meta) modifierFlags |= 4;
  if (modifiers?.shift) modifierFlags |= 8;

  if (keyInfo) {
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
      modifiers: modifierFlags,
    });
  } else {
    // Regular character
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      modifiers: modifierFlags,
    });
  }
}

/**
 * Release a key
 */
export async function keyUp(
  key: string,
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
): Promise<void> {
  const keyInfo = KEY_CODES[key];

  let modifierFlags = 0;
  if (modifiers?.alt) modifierFlags |= 1;
  if (modifiers?.ctrl) modifierFlags |= 2;
  if (modifiers?.meta) modifierFlags |= 4;
  if (modifiers?.shift) modifierFlags |= 8;

  if (keyInfo) {
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
      modifiers: modifierFlags,
    });
  } else {
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: `Key${key.toUpperCase()}`,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
      modifiers: modifierFlags,
    });
  }
}

/**
 * Press and release a single key
 */
export async function pressKey(key: string): Promise<void> {
  const keyInfo = KEY_CODES[key];

  if (keyInfo) {
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
    });

    if (keyInfo.text) {
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        text: keyInfo.text,
      });
    }

    await delay(30);

    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      nativeVirtualKeyCode: keyInfo.keyCode,
    });
  } else {
    // Regular character - just type it
    await typeChar(key);
  }
}

/**
 * Type a single character
 */
async function typeChar(char: string): Promise<void> {
  const keyCode = char.toUpperCase().charCodeAt(0);

  await sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: char,
    code: `Key${char.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode,
    text: char,
  });

  await sendCommand('Input.dispatchKeyEvent', {
    type: 'char',
    text: char,
  });

  await sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: char,
    code: `Key${char.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode,
  });
}

/**
 * Type a string of text
 */
export async function typeText(text: string, delayBetweenChars: number = 30): Promise<void> {
  for (const char of text) {
    // Use insertText for most characters - more reliable
    await sendCommand('Input.insertText', {
      text: char,
    });

    if (delayBetweenChars > 0) {
      await delay(delayBetweenChars);
    }
  }
}

/**
 * Type text instantly (no character-by-character delay)
 */
export async function typeTextInstant(text: string): Promise<void> {
  await sendCommand('Input.insertText', {
    text,
  });
}

/**
 * Clear current input field and type new text
 */
export async function clearAndType(text: string): Promise<void> {
  // Select all
  await pressHotkey(['Control', 'a']);
  await delay(50);

  // Type new text (replaces selection)
  await typeText(text);
}

/**
 * Press a keyboard shortcut
 */
export async function pressHotkey(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  // Build modifiers from the keys
  const modifiers = {
    ctrl: keys.includes('Control') || keys.includes('Ctrl'),
    shift: keys.includes('Shift'),
    alt: keys.includes('Alt'),
    meta: keys.includes('Meta') || keys.includes('Command') || keys.includes('Cmd'),
  };

  // Find the main key (non-modifier)
  const mainKey = keys.find(
    (k) =>
      !['Control', 'Ctrl', 'Shift', 'Alt', 'Meta', 'Command', 'Cmd'].includes(k)
  );

  if (!mainKey) {
    // Just modifiers, no main key
    return;
  }

  // Press modifiers down
  if (modifiers.ctrl) await keyDown('Control');
  if (modifiers.shift) await keyDown('Shift');
  if (modifiers.alt) await keyDown('Alt');
  if (modifiers.meta) await keyDown('Meta');

  await delay(30);

  // Press main key
  const keyInfo = KEY_CODES[mainKey];
  let modifierFlags = 0;
  if (modifiers.alt) modifierFlags |= 1;
  if (modifiers.ctrl) modifierFlags |= 2;
  if (modifiers.meta) modifierFlags |= 4;
  if (modifiers.shift) modifierFlags |= 8;

  if (keyInfo) {
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      modifiers: modifierFlags,
    });

    await delay(30);

    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.keyCode,
      modifiers: modifierFlags,
    });
  } else {
    // Letter key
    const keyCode = mainKey.toUpperCase().charCodeAt(0);
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: mainKey.toLowerCase(),
      code: `Key${mainKey.toUpperCase()}`,
      windowsVirtualKeyCode: keyCode,
      modifiers: modifierFlags,
    });

    await delay(30);

    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: mainKey.toLowerCase(),
      code: `Key${mainKey.toUpperCase()}`,
      windowsVirtualKeyCode: keyCode,
      modifiers: modifierFlags,
    });
  }

  await delay(30);

  // Release modifiers
  if (modifiers.meta) await keyUp('Meta');
  if (modifiers.alt) await keyUp('Alt');
  if (modifiers.shift) await keyUp('Shift');
  if (modifiers.ctrl) await keyUp('Control');
}

/**
 * Common shortcuts
 */
export async function selectAll(): Promise<void> {
  await pressHotkey(['Control', 'a']);
}

export async function copy(): Promise<void> {
  await pressHotkey(['Control', 'c']);
}

export async function paste(): Promise<void> {
  await pressHotkey(['Control', 'v']);
}

export async function cut(): Promise<void> {
  await pressHotkey(['Control', 'x']);
}

export async function undo(): Promise<void> {
  await pressHotkey(['Control', 'z']);
}

export async function redo(): Promise<void> {
  await pressHotkey(['Control', 'Shift', 'z']);
}

/**
 * Utility function for delays
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
