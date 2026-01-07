/**
 * Unit tests for RecoveryEngine
 * 
 * Tests critical recovery functionality:
 * - Recovery action execution
 * - Wait for stability
 * - Popup dismissal
 * - Scroll into view
 * - Retry with looser match
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { RecoveryEngine, type RecoveryAction, type RecoveryContext } from './recovery-engine';

// Mock dependencies
vi.mock('./state-wait-engine', () => ({
  StateWaitEngine: {
    waitForStability: vi.fn(() => Promise.resolve()),
  },
}));

describe('RecoveryEngine - Recovery Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('executeRecovery() handles WAIT_FOR_STABILITY', async () => {
    const action: RecoveryAction = {
      kind: 'WAIT_FOR_STABILITY',
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    // Mock StateWaitEngine
    const { StateWaitEngine } = await import('./state-wait-engine');
    vi.mocked(StateWaitEngine.waitForStability).mockResolvedValue({
      success: true,
      elapsedMs: 100,
      domStable: true,
      networkIdle: true,
      spinnersGone: true,
    });

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('WAIT_FOR_STABILITY');
    expect(result.shouldRetry).toBe(true);
  });

  test('executeRecovery() handles DISMISS_POPUPS', async () => {
    // Create a modal/popup
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<button class="close">×</button>';
    document.body.appendChild(modal);

    const action: RecoveryAction = {
      kind: 'DISMISS_POPUPS',
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('DISMISS_POPUPS');
  });

  test('executeRecovery() handles SCROLL_INTO_VIEW', async () => {
    const target = document.createElement('div');
    target.id = 'target-element';
    target.style.height = '2000px'; // Make it tall
    document.body.appendChild(target);

    // Mock querySelector to return the element
    const originalQuerySelector = document.querySelector;
    document.querySelector = vi.fn((selector: string) => {
      if (selector === '#target-element') return target;
      return originalQuerySelector.call(document, selector);
    });

    const action: RecoveryAction = {
      kind: 'SCROLL_INTO_VIEW',
      target: '#target-element',
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    // Restore original
    document.querySelector = originalQuerySelector;
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('SCROLL_INTO_VIEW');
  });

  test('executeRecovery() handles RETRY_LOOSER_MATCH', async () => {
    const action: RecoveryAction = {
      kind: 'RETRY_LOOSER_MATCH',
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('RETRY_LOOSER_MATCH');
    expect(result.shouldRetry).toBe(true);
  });
});

describe('RecoveryEngine - Structured Directives', () => {
  test('handles ScrollRecoveryDirective', async () => {
    // Create scroll container
    const container = document.createElement('div');
    container.className = 'scroll-container';
    container.style.height = '500px';
    container.style.overflow = 'auto';
    document.body.appendChild(container);

    const action: RecoveryAction = {
      kind: 'SCROLL_AND_RETRY',
      containerSelector: '.scroll-container',
      scrollDirection: 'down',
      pixelsPerScroll: 300,
      maxScrolls: 10,
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('SCROLL_AND_RETRY');
  });

  test('handles DismissRecoveryDirective', async () => {
    const action: RecoveryAction = {
      kind: 'DISMISS_POPUP',
      dismissMethod: 'escape',
    };

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    const result = await RecoveryEngine.executeRecovery(action, context);
    
    expect(result.success).toBe(true);
    expect(result.action.kind).toBe('DISMISS_POPUP');
  });
});

describe('RecoveryEngine - Recovery Strategy', () => {
  test('executeStrategy() tries actions in order', async () => {
    const actions: RecoveryAction[] = [
      { kind: 'WAIT_FOR_STABILITY' },
      { kind: 'DISMISS_POPUPS' },
      { kind: 'RETRY_LOOSER_MATCH' },
    ];

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    // Mock first action to fail, second to succeed
    vi.spyOn(RecoveryEngine, 'executeRecovery')
      .mockResolvedValueOnce({
        success: false,
        action: actions[0],
        elapsedMs: 100,
        shouldRetry: false,
      })
      .mockResolvedValueOnce({
        success: true,
        action: actions[1],
        elapsedMs: 200,
        shouldRetry: true,
      });

    const strategy = {
      maxAttempts: 3,
      actions,
    };

    const results = await RecoveryEngine.executeStrategy(strategy, context);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.success)).toBe(true);
    expect(RecoveryEngine.executeRecovery).toHaveBeenCalledTimes(2);
  });

  test('executeStrategy() stops at maxAttempts', async () => {
    const actions: RecoveryAction[] = [
      { kind: 'WAIT_FOR_STABILITY' },
    ];

    const context: RecoveryContext = {
      attemptNumber: 1,
    };

    // Mock all actions to fail
    vi.spyOn(RecoveryEngine, 'executeRecovery').mockResolvedValue({
      success: false,
      action: actions[0],
      elapsedMs: 100,
      shouldRetry: false,
    });

    const strategy = {
      maxAttempts: 2,
      actions,
    };

    const results = await RecoveryEngine.executeStrategy(strategy, context);
    
    expect(results.length).toBe(2);
    expect(results.every(r => !r.success)).toBe(true);
    expect(RecoveryEngine.executeRecovery).toHaveBeenCalledTimes(2);
  });
});

// Note: These are foundational tests. More comprehensive tests would require:
// - Testing actual DOM manipulation
// - Testing scroll behavior
// - Testing popup detection and dismissal
// - Integration tests with real browser environments

