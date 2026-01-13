/**
 * Unit tests for PostActionObserver
 * 
 * Tests all detection patterns, change detection, interpretation,
 * and safety/error handling.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  captureQuickState,
  detectChanges,
  interpretChanges,
  type PageState,
  type ChangeType,
} from './post-action-observer';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock DOM structure
 */
function setupDOM(html: string): void {
  document.body.innerHTML = html;
}

/**
 * Clean up DOM
 */
function cleanupDOM(): void {
  document.body.innerHTML = '';
}

/**
 * Create a base page state for testing
 */
function createBaseState(overrides?: Partial<PageState>): PageState {
  return {
    url: 'https://example.com',
    hasModal: false,
    hasError: false,
    isLoading: false,
    hasToast: false,
    hasDropdown: false,
    hasSuccess: false,
    interactiveElementCount: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ============================================================================
// captureQuickState() Tests
// ============================================================================

describe('PostActionObserver - captureQuickState()', () => {
  beforeEach(() => {
    cleanupDOM();
  });

  afterEach(() => {
    cleanupDOM();
  });

  test('detects modal when role="dialog" present', () => {
    setupDOM(`
      <div role="dialog">
        <h1>Test Modal</h1>
        <p>Modal content</p>
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasModal).toBe(true);
    expect(state?.modalTitle).toBe('Test Modal');
  });

  test('detects modal when aria-modal="true" present', () => {
    setupDOM(`
      <div aria-modal="true">
        <h2>Another Modal</h2>
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasModal).toBe(true);
    expect(state?.modalTitle).toBe('Another Modal');
  });

  test('detects modal when role="alertdialog" present', () => {
    setupDOM(`
      <div role="alertdialog">
        <h1>Alert Dialog</h1>
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasModal).toBe(true);
  });

  test('detects error when role="alert" present', () => {
    setupDOM(`
      <div role="alert" aria-live="assertive">
        Invalid email format
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasError).toBe(true);
    expect(state?.errorText).toContain('Invalid email');
  });

  test('detects error with class containing "error"', () => {
    setupDOM(`
      <div class="error-message">
        Something went wrong
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasError).toBe(true);
    expect(state?.errorText).toContain('Something went wrong');
  });

  test('detects error with class containing "danger"', () => {
    setupDOM(`
      <div class="alert-danger">
        Danger! Action failed.
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasError).toBe(true);
  });

  test('detects success message', () => {
    setupDOM(`
      <div class="success-message">
        Record saved successfully
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasSuccess).toBe(true);
  });

  test('detects loading when aria-busy="true" present', () => {
    setupDOM(`
      <div aria-busy="true">Loading...</div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.isLoading).toBe(true);
  });

  test('detects loading with class containing "loading"', () => {
    setupDOM(`
      <div class="loading-spinner"></div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.isLoading).toBe(true);
  });

  test('detects loading with class containing "spinner"', () => {
    setupDOM(`
      <div class="spinner"></div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.isLoading).toBe(true);
  });

  test('detects toast/notification elements', () => {
    setupDOM(`
      <div class="toast">
        Item added to cart
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasToast).toBe(true);
    expect(state?.toastText).toContain('Item added to cart');
  });

  test('detects open dropdown with role="listbox"', () => {
    setupDOM(`
      <ul role="listbox">
        <li role="option">Option 1</li>
        <li role="option">Option 2</li>
      </ul>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasDropdown).toBe(true);
  });

  test('detects open dropdown with role="menu"', () => {
    setupDOM(`
      <div role="menu">
        <div role="menuitem">Edit</div>
        <div role="menuitem">Delete</div>
      </div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasDropdown).toBe(true);
  });

  test('captures current URL', () => {
    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.url).toBe(window.location.href);
  });

  test('counts interactive elements', () => {
    setupDOM(`
      <button>Click me</button>
      <a href="#">Link</a>
      <input type="text" />
      <select></select>
      <div role="button">Custom button</div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.interactiveElementCount).toBe(5);
  });

  test('returns clean state when page is empty', () => {
    setupDOM('');

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasModal).toBe(false);
    expect(state?.hasError).toBe(false);
    expect(state?.isLoading).toBe(false);
    expect(state?.hasToast).toBe(false);
    expect(state?.hasDropdown).toBe(false);
    expect(state?.hasSuccess).toBe(false);
    expect(state?.interactiveElementCount).toBe(0);
  });

  test('ignores hidden elements', () => {
    setupDOM(`
      <div role="dialog" hidden>Hidden modal</div>
      <div class="error" style="display: none">Hidden error</div>
      <div class="loading" hidden>Hidden loading</div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.hasModal).toBe(false);
    expect(state?.hasError).toBe(false);
    expect(state?.isLoading).toBe(false);
  });

  test('truncates long error text', () => {
    const longError = 'A'.repeat(200);
    setupDOM(`
      <div class="error-message">${longError}</div>
    `);

    const state = captureQuickState();
    
    expect(state).not.toBeNull();
    expect(state?.errorText).toBeDefined();
    expect(state!.errorText!.length).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// detectChanges() Tests
// ============================================================================

describe('PostActionObserver - detectChanges()', () => {
  test('detects modal appeared (was false, now true)', () => {
    const before = createBaseState({ hasModal: false });
    const after = createBaseState({ hasModal: true, modalTitle: 'Confirm Action' });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(true);
    expect(changes?.changes).toHaveLength(1);
    expect(changes?.changes[0].type).toBe('modal_appeared');
    expect(changes?.changes[0].context).toBe('Confirm Action');
  });

  test('detects modal closed (was true, now false)', () => {
    const before = createBaseState({ hasModal: true, modalTitle: 'Old Modal' });
    const after = createBaseState({ hasModal: false });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(true);
    expect(changes?.changes).toHaveLength(1);
    expect(changes?.changes[0].type).toBe('modal_closed');
  });

  test('detects error appeared', () => {
    const before = createBaseState({ hasError: false });
    const after = createBaseState({ hasError: true, errorText: 'Invalid input' });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(true);
    expect(changes?.changes[0].type).toBe('error_appeared');
    expect(changes?.changes[0].context).toBe('Invalid input');
  });

  test('detects error cleared', () => {
    const before = createBaseState({ hasError: true });
    const after = createBaseState({ hasError: false });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('error_cleared');
  });

  test('detects success appeared', () => {
    const before = createBaseState({ hasSuccess: false });
    const after = createBaseState({ hasSuccess: true });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('success_appeared');
  });

  test('detects URL changed', () => {
    const before = createBaseState({ url: 'https://example.com/page1' });
    const after = createBaseState({ url: 'https://example.com/page2' });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(true);
    expect(changes?.changes[0].type).toBe('url_changed');
    expect(changes?.changes[0].context).toContain('page1');
    expect(changes?.changes[0].context).toContain('page2');
  });

  test('detects loading started', () => {
    const before = createBaseState({ isLoading: false });
    const after = createBaseState({ isLoading: true });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('loading_started');
  });

  test('detects loading finished', () => {
    const before = createBaseState({ isLoading: true });
    const after = createBaseState({ isLoading: false });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('loading_finished');
  });

  test('detects dropdown opened', () => {
    const before = createBaseState({ hasDropdown: false });
    const after = createBaseState({ hasDropdown: true });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('dropdown_opened');
  });

  test('detects dropdown closed', () => {
    const before = createBaseState({ hasDropdown: true });
    const after = createBaseState({ hasDropdown: false });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('dropdown_closed');
  });

  test('detects toast appeared', () => {
    const before = createBaseState({ hasToast: false });
    const after = createBaseState({ hasToast: true, toastText: 'Saved!' });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes[0].type).toBe('toast_appeared');
    expect(changes?.changes[0].context).toBe('Saved!');
  });

  test('reports no significant change when states identical', () => {
    const before = createBaseState();
    const after = createBaseState();

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(false);
    expect(changes?.changes).toHaveLength(0);
  });

  test('detects multiple simultaneous changes', () => {
    const before = createBaseState({
      hasModal: false,
      hasError: false,
      isLoading: false,
    });
    const after = createBaseState({
      hasModal: true,
      hasError: true,
      isLoading: true,
    });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.hasSignificantChange).toBe(true);
    expect(changes?.changes.length).toBeGreaterThanOrEqual(3);
    
    const types = changes!.changes.map(c => c.type);
    expect(types).toContain('modal_appeared');
    expect(types).toContain('error_appeared');
    expect(types).toContain('loading_started');
  });

  test('detects significant DOM change (>20% element count change)', () => {
    const before = createBaseState({ interactiveElementCount: 100 });
    const after = createBaseState({ interactiveElementCount: 150 }); // 50% increase

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes.some(c => c.type === 'dom_changed')).toBe(true);
  });

  test('ignores insignificant DOM change (<20% element count change)', () => {
    const before = createBaseState({ interactiveElementCount: 100 });
    const after = createBaseState({ interactiveElementCount: 110 }); // 10% increase

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.changes.some(c => c.type === 'dom_changed')).toBe(false);
  });

  test('calculates elapsed time correctly', () => {
    const before = createBaseState({ timestamp: 1000 });
    const after = createBaseState({ timestamp: 1500 });

    const changes = detectChanges(before, after);
    
    expect(changes).not.toBeNull();
    expect(changes?.elapsedMs).toBe(500);
  });
});

// ============================================================================
// interpretChanges() Tests
// ============================================================================

describe('PostActionObserver - interpretChanges()', () => {
  test('classifies no changes as no_change', () => {
    const interpretation = interpretChanges([]);
    expect(interpretation).toBe('no_change');
  });

  test('classifies modal appearance as modal_interaction', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'modal_appeared', description: 'Modal appeared' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('modal_interaction');
  });

  test('classifies modal close as modal_interaction', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'modal_closed', description: 'Modal closed' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('modal_interaction');
  });

  test('classifies error appearance as error_state', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'error_appeared', description: 'Error appeared' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('error_state');
  });

  test('classifies navigation as navigation', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'url_changed', description: 'URL changed' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('navigation');
  });

  test('classifies success as success_state', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'success_appeared', description: 'Success message' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('success_state');
  });

  test('classifies loading as loading_state', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'loading_started', description: 'Loading started' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('loading_state');
  });

  test('classifies dropdown as ui_update', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'dropdown_opened', description: 'Dropdown opened' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('ui_update');
  });

  test('prioritizes error over other changes', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'modal_appeared', description: 'Modal' },
      { type: 'error_appeared', description: 'Error' },
      { type: 'success_appeared', description: 'Success' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('error_state');
  });

  test('prioritizes navigation over success', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'success_appeared', description: 'Success' },
      { type: 'url_changed', description: 'Navigation' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('navigation');
  });

  test('prioritizes success over modal', () => {
    const changes: Array<{ type: ChangeType; description: string }> = [
      { type: 'modal_appeared', description: 'Modal' },
      { type: 'success_appeared', description: 'Success' },
    ];
    const interpretation = interpretChanges(changes);
    expect(interpretation).toBe('success_state');
  });
});

// ============================================================================
// Safety Tests
// ============================================================================

describe('PostActionObserver - Safety', () => {
  test('captureQuickState handles querySelector errors gracefully', () => {
    // Mock document.body.querySelector to throw an error
    const originalBody = document.body;
    const mockBody = {
      querySelector: vi.fn(() => {
        throw new Error('DOM access error');
      }),
      querySelectorAll: vi.fn(() => {
        throw new Error('DOM access error');
      }),
    } as any;
    
    Object.defineProperty(document, 'body', {
      value: mockBody,
      writable: true,
      configurable: true,
    });

    const state = captureQuickState();
    
    // Should return null instead of throwing
    expect(state).toBeNull();

    // Restore
    Object.defineProperty(document, 'body', {
      value: originalBody,
      writable: true,
      configurable: true,
    });
  });

  test('detectChanges handles invalid states gracefully', () => {
    const before = createBaseState();
    const after = createBaseState();

    // Should not throw
    expect(() => detectChanges(before, after)).not.toThrow();
  });

  test('captureQuickState completes within performance budget', () => {
    // Setup a reasonably complex DOM
    setupDOM(`
      <div role="dialog"><h1>Modal</h1></div>
      <div class="error-message">Error</div>
      <div class="loading"></div>
      <button>Button 1</button>
      <button>Button 2</button>
      <a href="#">Link</a>
      <input type="text" />
    `);

    const startTime = performance.now();
    const state = captureQuickState();
    const elapsedMs = performance.now() - startTime;

    expect(state).not.toBeNull();
    expect(elapsedMs).toBeLessThan(20); // Should complete in <20ms
  });

  test('detectChanges completes quickly', () => {
    const before = createBaseState({ interactiveElementCount: 100 });
    const after = createBaseState({ 
      hasModal: true,
      hasError: true,
      interactiveElementCount: 150,
    });

    const startTime = performance.now();
    const changes = detectChanges(before, after);
    const elapsedMs = performance.now() - startTime;

    expect(changes).not.toBeNull();
    expect(elapsedMs).toBeLessThan(5); // Should complete in <5ms
  });
});
