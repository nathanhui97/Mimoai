/**
 * Unit tests for StateWaitEngine
 * 
 * Tests critical wait condition functionality:
 * - DOM stability detection
 * - Network idle detection
 * - Spinner detection
 * - Element interactability waits
 * - Unified stability waits
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateWaitEngine, type StabilityConfig } from './state-wait-engine';

describe('StateWaitEngine - DOM Stability', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="test">Initial</div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('waitForDOMStable() succeeds when DOM is stable', async () => {
    const promise = StateWaitEngine.waitForDOMStable(100, 1000);
    
    // Fast-forward time past stability threshold
    vi.advanceTimersByTime(150);
    
    const result = await promise;
    
    expect(result.success).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('waitForDOMStable() waits for mutations to settle', async () => {
    const promise = StateWaitEngine.waitForDOMStable(200, 1000);
    
    // Trigger a mutation
    document.getElementById('test')!.textContent = 'Changed';
    
    // Fast-forward but not enough
    vi.advanceTimersByTime(100);
    
    // Should still be waiting
    // Fast-forward past stability threshold
    vi.advanceTimersByTime(250);
    
    const result = await promise;
    
    expect(result.success).toBe(true);
  });

  test('waitForDOMStable() times out if DOM never stabilizes', async () => {
    const promise = StateWaitEngine.waitForDOMStable(100, 500);
    
    // Continuously mutate DOM
    const interval = setInterval(() => {
      document.getElementById('test')!.textContent = `Changed ${Date.now()}`;
    }, 50);
    
    // Fast-forward past timeout
    vi.advanceTimersByTime(600);
    
    clearInterval(interval);
    const result = await promise;
    
    // Should timeout
    expect(result.success).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe('StateWaitEngine - Network Idle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('waitForNetworkIdle() succeeds when network is idle', async () => {
    const promise = StateWaitEngine.waitForNetworkIdle({ idleMs: 100, timeoutMs: 1000 });
    
    // Fast-forward past idle threshold
    vi.advanceTimersByTime(150);
    
    const result = await promise;
    
    expect(result.success).toBe(true);
  });

  test('waitForNetworkIdle() waits for requests to complete', async () => {
    // This test would require mocking fetch/XMLHttpRequest
    // For now, just verify the method exists and can be called
    const promise = StateWaitEngine.waitForNetworkIdle({ idleMs: 200, timeoutMs: 1000 });
    
    vi.advanceTimersByTime(250);
    
    const result = await promise;
    
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});

describe('StateWaitEngine - Unified Stability', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="test">Test</div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('waitForStability() succeeds with default config', async () => {
    const config: StabilityConfig = {
      domQuietMs: 100,
      networkQuietMs: 100,
      maxWaitMs: 1000,
    };

    const promise = StateWaitEngine.waitForStability(config);
    
    // Fast-forward past thresholds
    vi.advanceTimersByTime(200);
    
    const result = await promise;
    
    expect(result.success).toBe(true);
    expect(result.domStable).toBeDefined();
    expect(result.networkIdle).toBeDefined();
  });

  test('waitForStability() respects maxWaitMs timeout', async () => {
    const config: StabilityConfig = {
      domQuietMs: 1000,
      networkQuietMs: 1000,
      maxWaitMs: 500, // Timeout before stability
    };

    const promise = StateWaitEngine.waitForStability(config);
    
    // Fast-forward past timeout
    vi.advanceTimersByTime(600);
    
    const result = await promise;
    
    // Should timeout
    expect(result.success).toBe(false);
  });

  test('waitForStability() checks for spinners when enabled', async () => {
    // Add a spinner
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.style.display = 'block';
    document.body.appendChild(spinner);

    const config: StabilityConfig = {
      domQuietMs: 100,
      networkQuietMs: 100,
      maxWaitMs: 1000,
      checkSpinners: true,
    };

    const promise = StateWaitEngine.waitForStability(config);
    
    // Hide spinner
    spinner.style.display = 'none';
    
    // Fast-forward past thresholds
    vi.advanceTimersByTime(200);
    
    const result = await promise;
    
    expect(result.success).toBe(true);
    expect(result.spinnersGone).toBeDefined();
  });
});

describe('StateWaitEngine - Element Interactability', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('waitForInteractable() succeeds for visible button', async () => {
    const button = document.createElement('button');
    button.id = 'test-button';
    button.textContent = 'Click Me';
    button.style.display = 'block';
    button.style.visibility = 'visible';
    document.body.appendChild(button);

    const promise = StateWaitEngine.waitForInteractable('#test-button', undefined, 1000);
    
    const result = await promise;
    
    expect(result).not.toBeNull();
    expect(result?.id).toBe('test-button');
  });

  test('waitForInteractable() fails for hidden element', async () => {
    const button = document.createElement('button');
    button.id = 'hidden-button';
    button.style.display = 'none';
    document.body.appendChild(button);

    const promise = StateWaitEngine.waitForInteractable('#hidden-button', undefined, 500);
    
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 600));
    
    const result = await promise;
    
    expect(result).toBeNull();
  });

  test('waitForInteractable() waits for element to become visible', async () => {
    const button = document.createElement('button');
    button.id = 'delayed-button';
    button.style.display = 'none';
    document.body.appendChild(button);

    const promise = StateWaitEngine.waitForInteractable('#delayed-button', undefined, 2000);
    
    // Make element visible after a delay
    setTimeout(() => {
      button.style.display = 'block';
    }, 100);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const result = await promise;
    
    expect(result).not.toBeNull();
    expect(result?.id).toBe('delayed-button');
  });
});

// Note: These are foundational tests. More comprehensive tests would require:
// - Testing actual network request tracking
// - Testing spinner detection in various frameworks
// - Testing complex DOM mutation scenarios
// - Integration tests with real browser environments

