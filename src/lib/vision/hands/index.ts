/**
 * Hands Module
 *
 * The action capabilities of the agent using Chrome DevTools Protocol:
 * - Mouse control (click, drag, hover)
 * - Keyboard control (type, keys, shortcuts)
 * - Scroll control (wheel, page navigation)
 *
 * All actions are coordinate-based - no DOM access.
 */

// Mouse control
export {
  attachDebugger,
  detachDebugger,
  getCurrentConnection,
  isDebuggerAttached,
  mouseMove,
  mouseDown,
  mouseUp,
  mouseClick,
  mouseDoubleClick,
  mouseRightClick,
  mouseHover,
  mouseDrag,
  mouseDragBy,
  mouseClickAndHold,
  mouseClickWithModifiers,
} from './mouse';

// Keyboard control
export {
  keyDown,
  keyUp,
  pressKey,
  typeText,
  typeTextInstant,
  clearAndType,
  pressHotkey,
  selectAll,
  copy,
  paste,
  cut,
  undo,
  redo,
} from './keyboard';

// Scroll control
export {
  scrollBy,
  scrollDown,
  scrollUp,
  scrollLeft,
  scrollRight,
  smoothScrollBy,
  smoothScrollDown,
  smoothScrollUp,
  scrollToTop,
  scrollToBottom,
  pageDown,
  pageUp,
  scrollToElement,
  scrollInContainer,
  waitForScrollEnd,
} from './scroll';
