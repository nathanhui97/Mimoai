/**
 * Test setup file for Vitest
 * 
 * Sets up global mocks and configurations for all tests
 */

import { vi } from 'vitest';

// Mock Chrome APIs globally
const mockChromeRuntime = {
  sendMessage: vi.fn(() => Promise.resolve({ success: true, data: {} })),
  onMessage: {
    hasListeners: vi.fn(() => false),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
};

const mockChromeStorage = {
  local: {
    get: vi.fn(() => Promise.resolve({})),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  },
  session: {
    get: vi.fn(() => Promise.resolve({})),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  },
};

// Set up global Chrome mock
(global as any).chrome = {
  runtime: mockChromeRuntime,
  storage: mockChromeStorage,
};

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    hostname: 'localhost',
    pathname: '/',
    search: '',
    hash: '',
  },
  writable: true,
});

// Mock document.title
Object.defineProperty(document, 'title', {
  value: 'Test Page',
  writable: true,
});

// Mock document.body with proper methods
const mockBody = document.createElement('body');
Object.defineProperty(document, 'body', {
  value: mockBody,
  writable: true,
  configurable: true,
});

// Mock getComputedStyle
global.getComputedStyle = vi.fn(() => ({
  cursor: 'default',
  pointerEvents: 'auto',
  position: 'static',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  overflow: 'visible',
  overflowY: 'visible',
  overflowX: 'visible',
})) as any;

// Mock document.elementsFromPoint
document.elementsFromPoint = vi.fn(() => []) as any;

// Mock window methods
Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true });
Object.defineProperty(window, 'scrollX', { value: 0, writable: true });
Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
Object.defineProperty(window, 'pageXOffset', { value: 0, writable: true });
Object.defineProperty(window, 'pageYOffset', { value: 0, writable: true });

// Suppress console warnings in tests (optional)
// global.console = {
//   ...console,
//   warn: vi.fn(),
//   error: vi.fn(),
// };

