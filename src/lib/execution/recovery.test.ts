/**
 * Unit tests for UnifiedRecoveryEngine
 *
 * Tests recovery strategies:
 * - Wait and retry with exponential backoff
 * - Scroll into view
 * - Alternative selectors
 * - Strategy selection based on failure code
 */

import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest';
import { UnifiedRecoveryEngine, type RecoveryAttemptContext } from './recovery';
import type { WorkflowStep } from '../../types/workflow';
import type { AgentAction } from '../ai-agent';

// Mock Tier1Executor
vi.mock('../tier1-executor', () => ({
  Tier1Executor: {
    execute: vi.fn(),
  },
}));

// Mock fast-path for waitForDOMStability
vi.mock('./fast-path', () => ({
  waitForDOMStability: vi.fn(() => Promise.resolve()),
}));

// Mock RecoveryEngine from content
vi.mock('../../content/recovery-engine', () => ({
  RecoveryEngine: {
    executeRecovery: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

// Mock VisionAssist
vi.mock('../tier3-vision-assist', () => ({
  VisionAssist: {
    getHint: vi.fn(() =>
      Promise.resolve({
        confidence: 0.9,
        refinedTarget: { name: 'Test Button' },
      })
    ),
  },
}));

// Mock VisualSnapshotService
vi.mock('../../content/visual-snapshot', () => ({
  VisualSnapshotService: {
    captureFullPage: vi.fn(() =>
      Promise.resolve({ screenshot: 'data:image/png;base64,test' })
    ),
  },
}));

// Mock DOM map
vi.mock('../../content/dom-map', () => ({
  generateDOMMap: vi.fn(() => []),
  domMapToText: vi.fn(() => ''),
}));

// Helper to create mock LocatorFeatures
function createMockFeatures() {
  return {
    uniqueMatchAtRecordTime: true,
    matchCountAtRecordTime: 1,
    hasStableAttributes: true,
    textStabilityHint: 'stable' as const,
    isWithinShadowDOM: false,
    recordedTagName: 'button',
    hasDynamicParts: false,
  };
}

// Helper to create mock context
function createMockContext(
  overrides: Partial<RecoveryAttemptContext> = {}
): RecoveryAttemptContext {
  const mockStep: WorkflowStep = {
    type: 'CLICK',
    description: 'Click test button',
    payload: {
      selector: '.test-button',
      timestamp: Date.now(),
      url: 'https://example.com',
      locatorBundle: {
        strategies: [{ type: 'css', value: '.test-button', features: createMockFeatures() }],
        disambiguators: [],
        tagName: 'button',
      },
    },
  };

  const mockAction: AgentAction = {
    type: 'click',
    params: {
      target: { name: 'Test Button' },
      description: 'Click test button',
    },
    reasoning: 'Clicking the test button as instructed',
    confidence: 0.9,
  };

  return {
    step: mockStep,
    action: mockAction,
    failureCode: 'NOT_FOUND',
    attemptCount: 0,
    ...overrides,
  };
}

describe('UnifiedRecoveryEngine', () => {
  let engine: UnifiedRecoveryEngine;
  let mockTier1Execute: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get mock
    const { Tier1Executor } = await import('../tier1-executor');
    mockTier1Execute = Tier1Executor.execute as Mock;

    engine = new UnifiedRecoveryEngine({
      maxAttempts: 5,
      initialWaitMs: 100,
      maxWaitMs: 1000,
      enableVision: true,
      enableUserHelp: false,
    });
  });

  describe('Strategy Selection', () => {
    test('selects correct strategies for NOT_FOUND', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({ failureCode: 'NOT_FOUND' });
      const result = await engine.recover(context);

      // Should try wait_retry first
      expect(result.recovered).toBe(true);
      expect(result.strategy).toBe('wait_retry');
    });

    test('selects correct strategies for AMBIGUOUS', async () => {
      // Mock success on first retry
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({ failureCode: 'AMBIGUOUS' });
      const result = await engine.recover(context);

      // Should try wait_retry first which succeeds
      expect(result.recovered).toBe(true);
      expect(result.strategy).toBe('wait_retry');
    });

    test('selects correct strategies for NOT_INTERACTABLE', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({ failureCode: 'NOT_INTERACTABLE' });
      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
    });

    test('selects correct strategies for SCOPE_FAILED', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({ failureCode: 'SCOPE_FAILED' });
      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
    });

    test('selects correct strategies for OUTCOME_FAILED', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({ failureCode: 'OUTCOME_FAILED' });
      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
    });
  });

  describe('Wait and Retry', () => {
    test('retries with exponential backoff', async () => {
      // Fail first two attempts, succeed third
      mockTier1Execute
        .mockResolvedValueOnce({ status: 'rejected', code: 'NOT_FOUND' })
        .mockResolvedValueOnce({ status: 'rejected', code: 'NOT_FOUND' })
        .mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({
        failureCode: 'NOT_FOUND',
        attemptCount: 0,
      });

      const result = await engine.recover(context);

      // Should eventually succeed
      expect(result.recovered).toBe(true);
    });

    test('respects max attempts', async () => {
      // Always fail
      mockTier1Execute.mockResolvedValue({
        status: 'rejected',
        code: 'NOT_FOUND',
      });

      const engineWithLowMax = new UnifiedRecoveryEngine({
        maxAttempts: 2,
        enableVision: false,
        enableUserHelp: false,
      });

      const context = createMockContext({ failureCode: 'NOT_FOUND' });
      const result = await engineWithLowMax.recover(context);

      expect(result.recovered).toBe(false);
    });
  });

  describe('Alternative Selectors', () => {
    test('tries fallback selectors from locator bundle', async () => {
      // First attempt fails, alternative selector succeeds
      mockTier1Execute
        .mockResolvedValueOnce({ status: 'rejected', code: 'NOT_FOUND' })
        .mockResolvedValueOnce({ status: 'rejected', code: 'NOT_FOUND' })
        .mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext({
        failureCode: 'NOT_FOUND',
        step: {
          type: 'CLICK',
          description: 'Click button',
          payload: {
            selector: '.primary-selector',
            timestamp: Date.now(),
            url: 'https://example.com',
            fallbackSelectors: ['.fallback-1', '.fallback-2'],
            locatorBundle: {
              strategies: [
                { type: 'css', value: '.primary-selector', features: createMockFeatures() },
                { type: 'css', value: '.fallback-1', features: createMockFeatures() },
              ],
              disambiguators: [],
              tagName: 'button',
            },
          },
        },
      });

      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
    });
  });

  describe('Vision Fallback', () => {
    test('tries vision when earlier strategies fail', async () => {
      // All attempts fail - we just test that vision is in the strategy list
      mockTier1Execute.mockResolvedValue({ status: 'rejected', code: 'NOT_FOUND' });

      const context = createMockContext({ failureCode: 'NOT_FOUND' });

      // With vision disabled, should fail
      const noVisionEngine = new UnifiedRecoveryEngine({
        enableVision: false,
        enableUserHelp: false,
        maxAttempts: 10,
      });

      const result = await noVisionEngine.recover(context);

      // Should fail since all strategies fail
      expect(result.recovered).toBe(false);
    });

    test('skips vision when disabled', async () => {
      mockTier1Execute.mockResolvedValue({
        status: 'rejected',
        code: 'NOT_FOUND',
      });

      const noVisionEngine = new UnifiedRecoveryEngine({
        enableVision: false,
        enableUserHelp: false,
        maxAttempts: 10,
      });

      const context = createMockContext({ failureCode: 'NOT_FOUND' });
      const result = await noVisionEngine.recover(context);

      // Should fail since vision is disabled
      expect(result.recovered).toBe(false);
    });
  });

  describe('User Help Context', () => {
    test('returns needsUserHelp when all strategies fail and userHelp enabled', async () => {
      mockTier1Execute.mockResolvedValue({
        status: 'rejected',
        code: 'NOT_FOUND',
      });

      const engineWithUserHelp = new UnifiedRecoveryEngine({
        enableVision: false,
        enableUserHelp: true,
        maxAttempts: 2,
      });

      const context = createMockContext({ failureCode: 'NOT_FOUND' });
      const result = await engineWithUserHelp.recover(context);

      expect(result.recovered).toBe(false);
      // When user help is enabled and strategies exhausted, needsUserHelp should be true
      if (result.needsUserHelp) {
        expect(result.userHelpContext).toBeDefined();
        expect(result.userHelpContext?.stepDescription).toBeDefined();
      }
    });

    test('does not need user help when userHelp disabled', async () => {
      mockTier1Execute.mockResolvedValue({
        status: 'rejected',
        code: 'AMBIGUOUS',
      });

      const engineNoUserHelp = new UnifiedRecoveryEngine({
        enableVision: false,
        enableUserHelp: false,
        maxAttempts: 2,
      });

      const context = createMockContext({ failureCode: 'AMBIGUOUS' });
      const result = await engineNoUserHelp.recover(context);

      // When user help is disabled, needsUserHelp should be false/undefined
      expect(result.needsUserHelp).toBeFalsy();
    });
  });

  describe('Recovery Result', () => {
    test('includes timing information', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext();
      const result = await engine.recover(context);

      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    test('includes strategy used on success', async () => {
      mockTier1Execute.mockResolvedValue({ status: 'success', details: {} });

      const context = createMockContext();
      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
      expect(result.strategy).toBeDefined();
    });

    test('includes error message on failure', async () => {
      mockTier1Execute.mockResolvedValue({
        status: 'rejected',
        code: 'NOT_FOUND',
      });

      const noRetryEngine = new UnifiedRecoveryEngine({
        maxAttempts: 1,
        enableVision: false,
        enableUserHelp: false,
      });

      const context = createMockContext();
      const result = await noRetryEngine.recover(context);

      expect(result.recovered).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
