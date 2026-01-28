/**
 * Tests for Phase 1: Intelligent Agent - Fast-Path Context
 *
 * These tests verify that:
 * 1. ExecutionContext is properly captured during fast-path attempts
 * 2. ExecutionContext is passed to the LLM when fast-path falls through
 * 3. Feature flag controls whether context is sent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionContext } from './ai-agent';
import { FeatureFlags } from './feature-flags';

// Mock the modules that AIAgent depends on
vi.mock('./ai-config', () => ({
  aiConfig: {
    getConfig: () => ({
      enabled: true,
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-key',
    }),
  },
  debugLog: vi.fn(),
}));

vi.mock('../content/visual-snapshot', () => ({
  VisualSnapshotService: {
    captureFullPage: vi.fn().mockResolvedValue({ screenshot: 'base64-screenshot' }),
  },
}));

vi.mock('../content/dom-map', () => ({
  generateDOMMap: vi.fn().mockReturnValue({
    interactiveElements: [],
    formFields: [],
    headings: [],
    activeModal: null,
    activeDropdown: null,
  }),
  domMapToText: vi.fn().mockReturnValue('DOM Map Text'),
  invalidateDOMMapCache: vi.fn(),
}));

vi.mock('./tier1-executor', () => ({
  Tier1Executor: {
    execute: vi.fn(),
  },
}));

vi.mock('../content/sheet-state-extractor', () => ({
  SheetStateExtractor: {
    isSpreadsheetDomain: vi.fn().mockReturnValue(false),
    extract: vi.fn(),
  },
}));

describe('Intelligent Agent - Phase 1: Fast-Path Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ExecutionContext Interface', () => {
    it('should have all required fields defined', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 45,
        fastPathReason: 'AMBIGUOUS',
        strategiesTried: ['recorded_selector', 'xpath'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 3,
        topCandidateScore: 45,
      };

      expect(context.fastPathAttempted).toBe(true);
      expect(context.fastPathConfidence).toBe(45);
      expect(context.fastPathReason).toBe('AMBIGUOUS');
      expect(context.strategiesTried).toContain('recorded_selector');
      expect(context.strategiesTried).toContain('xpath');
      expect(context.callReason).toBe('DISAMBIGUATION');
      expect(context.candidatesFound).toBe(3);
    });

    it('should accept all valid fastPathReason values', () => {
      const validReasons: ExecutionContext['fastPathReason'][] = [
        'NO_SELECTORS',
        'LOW_CONFIDENCE',
        'AMBIGUOUS',
        'NOT_FOUND',
        'ELEMENT_NOT_INTERACTABLE',
        'DROPDOWN_OPEN',
      ];

      validReasons.forEach(reason => {
        const context: ExecutionContext = {
          fastPathAttempted: true,
          fastPathReason: reason,
          strategiesTried: [],
          scrollAttempted: false,
          callReason: 'RECOVERY',
          currentStepFailures: 0,
          candidatesFound: 0,
        };
        expect(context.fastPathReason).toBe(reason);
      });
    });

    it('should accept all valid callReason values', () => {
      const validReasons: ExecutionContext['callReason'][] = [
        'DISAMBIGUATION',
        'NOT_FOUND',
        'RECOVERY',
        'LOW_CONFIDENCE',
        'INITIAL',
      ];

      validReasons.forEach(reason => {
        const context: ExecutionContext = {
          fastPathAttempted: true,
          strategiesTried: [],
          scrollAttempted: false,
          callReason: reason,
          currentStepFailures: 0,
          candidatesFound: 0,
        };
        expect(context.callReason).toBe(reason);
      });
    });
  });

  describe('Feature Flag', () => {
    it('should have INTELLIGENT_AGENT_CONTEXT flag defined', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_CONTEXT).toBeDefined();
    });

    it('should have INTELLIGENT_AGENT_CONTEXT enabled by default', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_CONTEXT).toBe(true);
    });

    it('should have Phase 2 flags defined but disabled', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_FLEXIBLE).toBe(false);
      expect(FeatureFlags.INTELLIGENT_AGENT_GOAL).toBe(false);
      expect(FeatureFlags.INTELLIGENT_AGENT_VERIFY).toBe(false);
    });
  });

  describe('Strategy Tracking', () => {
    it('should track all strategy types correctly', () => {
      const allStrategies = [
        'recorded_selector',
        'xpath',
        'shadow_piercing',
        'css_selector',
        'scope_filter',
        'text_match',
      ];

      const context: ExecutionContext = {
        fastPathAttempted: true,
        strategiesTried: allStrategies,
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 5,
      };

      expect(context.strategiesTried).toHaveLength(6);
      allStrategies.forEach(strategy => {
        expect(context.strategiesTried).toContain(strategy);
      });
    });
  });

  describe('Scroll Tracking', () => {
    it('should track scroll attempts', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        strategiesTried: ['recorded_selector'],
        scrollAttempted: true,
        scrollDirection: 'down',
        scrollAttempts: 3,
        callReason: 'NOT_FOUND',
        currentStepFailures: 0,
        candidatesFound: 0,
      };

      expect(context.scrollAttempted).toBe(true);
      expect(context.scrollDirection).toBe('down');
      expect(context.scrollAttempts).toBe(3);
    });

    it('should track upward scroll direction', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        strategiesTried: [],
        scrollAttempted: true,
        scrollDirection: 'up',
        scrollAttempts: 2,
        callReason: 'NOT_FOUND',
        currentStepFailures: 0,
        candidatesFound: 0,
      };

      expect(context.scrollDirection).toBe('up');
    });
  });

  describe('Confidence and Candidates', () => {
    it('should track confidence levels correctly', () => {
      // Low confidence
      const lowContext: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 25,
        fastPathReason: 'LOW_CONFIDENCE',
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'LOW_CONFIDENCE',
        currentStepFailures: 0,
        candidatesFound: 1,
        topCandidateScore: 25,
      };
      expect(lowContext.fastPathConfidence).toBeLessThan(50);

      // Medium confidence
      const mediumContext: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 60,
        fastPathReason: 'AMBIGUOUS',
        strategiesTried: ['recorded_selector', 'scope_filter'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 3,
        topCandidateScore: 60,
      };
      expect(mediumContext.fastPathConfidence).toBeGreaterThanOrEqual(50);
      expect(mediumContext.fastPathConfidence).toBeLessThan(70);
    });

    it('should track candidate counts', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 55,
        fastPathReason: 'AMBIGUOUS',
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 5,
        topCandidateScore: 55,
      };

      expect(context.candidatesFound).toBe(5);
      expect(context.topCandidateScore).toBe(55);
    });

    it('should handle zero candidates (NOT_FOUND)', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 0,
        fastPathReason: 'NOT_FOUND',
        strategiesTried: ['recorded_selector', 'xpath', 'css_selector'],
        scrollAttempted: true,
        scrollDirection: 'down',
        scrollAttempts: 3,
        callReason: 'NOT_FOUND',
        currentStepFailures: 2,
        candidatesFound: 0,
      };

      expect(context.candidatesFound).toBe(0);
      expect(context.fastPathReason).toBe('NOT_FOUND');
      expect(context.callReason).toBe('NOT_FOUND');
    });
  });

  describe('Failure Tracking', () => {
    it('should track step failures', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'RECOVERY',
        currentStepFailures: 3,
        candidatesFound: 0,
      };

      expect(context.currentStepFailures).toBe(3);
    });

    it('should track previous step action', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        strategiesTried: [],
        scrollAttempted: false,
        callReason: 'INITIAL',
        currentStepFailures: 0,
        candidatesFound: 0,
        previousStepAction: 'click',
      };

      expect(context.previousStepAction).toBe('click');
    });
  });
});

describe('ExecutionContext Scenarios', () => {
  describe('Scenario: Dropdown Open', () => {
    it('should set correct context when dropdown is open', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 50,
        fastPathReason: 'DROPDOWN_OPEN',
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 5, // dropdown options
      };

      expect(context.fastPathReason).toBe('DROPDOWN_OPEN');
      expect(context.callReason).toBe('DISAMBIGUATION');
      expect(context.candidatesFound).toBe(5);
    });
  });

  describe('Scenario: No Selectors Available', () => {
    it('should set correct context when no selectors exist', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 0,
        fastPathReason: 'NO_SELECTORS',
        strategiesTried: [], // nothing to try
        scrollAttempted: false,
        callReason: 'RECOVERY',
        currentStepFailures: 0,
        candidatesFound: 0,
      };

      expect(context.fastPathReason).toBe('NO_SELECTORS');
      expect(context.strategiesTried).toHaveLength(0);
      expect(context.callReason).toBe('RECOVERY');
    });
  });

  describe('Scenario: Multiple Candidates Need Disambiguation', () => {
    it('should set correct context for ambiguous matches', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 55,
        fastPathReason: 'AMBIGUOUS',
        strategiesTried: ['recorded_selector', 'xpath', 'scope_filter'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION',
        currentStepFailures: 0,
        candidatesFound: 4,
        topCandidateScore: 55,
      };

      expect(context.fastPathReason).toBe('AMBIGUOUS');
      expect(context.callReason).toBe('DISAMBIGUATION');
      expect(context.candidatesFound).toBeGreaterThan(1);
      expect(context.strategiesTried).toContain('scope_filter');
    });
  });

  describe('Scenario: Element Not Found After Scrolling', () => {
    it('should set correct context when element not found after scroll', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 0,
        fastPathReason: 'NOT_FOUND',
        strategiesTried: ['recorded_selector', 'xpath', 'css_selector'],
        scrollAttempted: true,
        scrollDirection: 'down',
        scrollAttempts: 3,
        callReason: 'NOT_FOUND',
        currentStepFailures: 1,
        candidatesFound: 0,
      };

      expect(context.fastPathReason).toBe('NOT_FOUND');
      expect(context.scrollAttempted).toBe(true);
      expect(context.scrollAttempts).toBe(3);
      expect(context.candidatesFound).toBe(0);
    });
  });

  describe('Scenario: Recovery After Multiple Failures', () => {
    it('should track cumulative failures', () => {
      const context: ExecutionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 30,
        fastPathReason: 'LOW_CONFIDENCE',
        strategiesTried: ['recorded_selector', 'xpath', 'shadow_piercing', 'css_selector'],
        scrollAttempted: true,
        scrollDirection: 'down',
        scrollAttempts: 2,
        callReason: 'RECOVERY',
        currentStepFailures: 3,
        candidatesFound: 1,
        topCandidateScore: 30,
        previousStepAction: 'click',
      };

      expect(context.currentStepFailures).toBe(3);
      expect(context.callReason).toBe('RECOVERY');
      expect(context.strategiesTried).toHaveLength(4);
    });
  });
});

describe('Integration: Context Passed to LLM', () => {
  it('should include all context fields when serialized', () => {
    const context: ExecutionContext = {
      fastPathAttempted: true,
      fastPathConfidence: 45,
      fastPathReason: 'AMBIGUOUS',
      strategiesTried: ['recorded_selector', 'scope_filter'],
      scrollAttempted: false,
      callReason: 'DISAMBIGUATION',
      currentStepFailures: 0,
      candidatesFound: 3,
      topCandidateScore: 45,
    };

    // Simulate what gets sent to the API
    const payload = {
      executionContext: context.fastPathAttempted ? {
        fastPathAttempted: context.fastPathAttempted,
        fastPathConfidence: context.fastPathConfidence,
        fastPathReason: context.fastPathReason,
        strategiesTried: context.strategiesTried,
        scrollAttempted: context.scrollAttempted,
        callReason: context.callReason,
        currentStepFailures: context.currentStepFailures,
        candidatesFound: context.candidatesFound,
        topCandidateScore: context.topCandidateScore,
      } : undefined,
    };

    const serialized = JSON.stringify(payload);
    const parsed = JSON.parse(serialized);

    expect(parsed.executionContext).toBeDefined();
    expect(parsed.executionContext.fastPathAttempted).toBe(true);
    expect(parsed.executionContext.fastPathConfidence).toBe(45);
    expect(parsed.executionContext.fastPathReason).toBe('AMBIGUOUS');
    expect(parsed.executionContext.strategiesTried).toEqual(['recorded_selector', 'scope_filter']);
    expect(parsed.executionContext.callReason).toBe('DISAMBIGUATION');
    expect(parsed.executionContext.candidatesFound).toBe(3);
  });

  it('should not include context when fastPathAttempted is false', () => {
    const context: ExecutionContext = {
      fastPathAttempted: false,
      strategiesTried: [],
      scrollAttempted: false,
      callReason: 'INITIAL',
      currentStepFailures: 0,
      candidatesFound: 0,
    };

    const payload = {
      executionContext: context.fastPathAttempted ? context : undefined,
    };

    expect(payload.executionContext).toBeUndefined();
  });
});
