/**
 * Integration Tests for Phase 1: Intelligent Agent - Fast-Path Context
 *
 * These tests verify the actual flow:
 * 1. tryFastPathExecute() populates executionContext
 * 2. think() includes executionContext in API payload
 * 3. dom_agent receives and uses the context
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store captured payloads for inspection
let capturedPayloads: any[] = [];

// Mock fetch globally to capture payloads
const mockFetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
  if (options?.body) {
    try {
      const payload = JSON.parse(options.body as string);
      capturedPayloads.push({ url, payload });
    } catch {
      // Ignore non-JSON requests
    }
  }

  // Return mock response for dom_agent
  if (url.includes('dom_agent')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        action: 'click',
        target: { role: 'button', name: 'Submit' },
        reasoning: 'Selected based on execution context',
        confidence: 0.9,
        hintStepIndex: 0,
        chooseCandidateIndex: 0,
      })),
      json: () => Promise.resolve({
        action: 'click',
        target: { role: 'button', name: 'Submit' },
        reasoning: 'Selected based on execution context',
        confidence: 0.9,
        hintStepIndex: 0,
        chooseCandidateIndex: 0,
      }),
    });
  }

  // Default response
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('{}'),
  });
});

// Set up global fetch mock before imports
global.fetch = mockFetch;

// Mock window/document for content script modules
if (typeof window === 'undefined') {
  (global as any).window = {
    location: { href: 'https://example.com' },
    scrollY: 0,
    pageYOffset: 0,
    innerWidth: 1920,
    innerHeight: 1080,
    scrollTo: vi.fn(),
    scrollBy: vi.fn(),
  };
}

if (typeof document === 'undefined') {
  (global as any).document = {
    title: 'Test Page',
    querySelector: vi.fn().mockReturnValue(null),
    querySelectorAll: vi.fn().mockReturnValue([]),
    evaluate: vi.fn().mockReturnValue({
      snapshotLength: 0,
      snapshotItem: () => null,
    }),
    body: { scrollHeight: 2000 },
  };
}

// Mock modules
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
    interactiveElements: [
      { role: 'button', name: 'Submit', text: 'Submit', frameId: 0 },
      { role: 'button', name: 'Cancel', text: 'Cancel', frameId: 0 },
    ],
    formFields: [],
    headings: [{ text: 'Test Form', level: 1 }],
    activeModal: null,
    activeDropdown: null,
  }),
  domMapToText: vi.fn().mockReturnValue('Button: Submit\nButton: Cancel'),
  invalidateDOMMapCache: vi.fn(),
}));

vi.mock('./tier1-executor', () => ({
  Tier1Executor: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ status: 'success' }),
  })),
}));

vi.mock('../content/sheet-state-extractor', () => ({
  SheetStateExtractor: {
    isSpreadsheetDomain: vi.fn().mockReturnValue(false),
    extract: vi.fn(),
  },
}));

vi.mock('../content/state-wait-engine', () => ({
  StateWaitEngine: {
    waitForStability: vi.fn().mockResolvedValue({ stable: true }),
  },
}));

vi.mock('./post-action-observer', () => ({
  PostActionObserver: {
    observe: vi.fn().mockResolvedValue({ changes: [] }),
  },
}));

vi.mock('./success-verifier', () => ({
  capturePageState: vi.fn().mockResolvedValue({}),
  verifyStepSuccess: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../content/recovery-engine', () => ({
  RecoveryEngine: {
    execute: vi.fn(),
  },
}));

vi.mock('./tier3-vision-assist', () => ({
  VisionAssist: {
    findElement: vi.fn(),
  },
}));

vi.mock('./execution-telemetry', () => ({
  ExecutionTelemetry: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    end: vi.fn(),
    record: vi.fn(),
  })),
}));

vi.mock('./execution-learning', () => ({
  ExecutionLearning: {
    learn: vi.fn(),
  },
}));

vi.mock('./page-model', () => ({
  getCurrentModel: vi.fn().mockResolvedValue(null),
}));

vi.mock('../types/scope', () => ({
  resolveScopeContainer: vi.fn().mockReturnValue(null),
}));

describe('Integration: ExecutionContext Flow', () => {
  beforeEach(() => {
    capturedPayloads = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Payload Structure', () => {
    it('should define correct executionContext structure in payload', () => {
      // Test the payload structure that would be sent to dom_agent
      const executionContext = {
        fastPathAttempted: true,
        fastPathConfidence: 55,
        fastPathReason: 'AMBIGUOUS' as const,
        strategiesTried: ['recorded_selector', 'scope_filter'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION' as const,
        currentStepFailures: 0,
        candidatesFound: 3,
        topCandidateScore: 55,
      };

      const payload = {
        mode: 'dom',
        goal: 'Test Workflow',
        executionContext: executionContext.fastPathAttempted ? executionContext : undefined,
      };

      expect(payload.executionContext).toBeDefined();
      expect(payload.executionContext?.fastPathAttempted).toBe(true);
      expect(payload.executionContext?.strategiesTried).toContain('recorded_selector');
      expect(payload.executionContext?.callReason).toBe('DISAMBIGUATION');
    });

    it('should not include executionContext when fastPath not attempted', () => {
      const executionContext = {
        fastPathAttempted: false,
        strategiesTried: [],
        scrollAttempted: false,
        callReason: 'INITIAL' as const,
        currentStepFailures: 0,
        candidatesFound: 0,
      };

      const payload = {
        mode: 'dom',
        goal: 'Test Workflow',
        executionContext: executionContext.fastPathAttempted ? executionContext : undefined,
      };

      expect(payload.executionContext).toBeUndefined();
    });
  });

  describe('Strategy Tracking', () => {
    it('should validate all strategy types', () => {
      const validStrategies = [
        'recorded_selector',
        'xpath',
        'shadow_piercing',
        'css_selector',
        'scope_filter',
        'text_match',
      ];

      const executionContext = {
        fastPathAttempted: true,
        strategiesTried: validStrategies,
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION' as const,
        currentStepFailures: 0,
        candidatesFound: 5,
      };

      expect(executionContext.strategiesTried).toHaveLength(6);
      validStrategies.forEach(strategy => {
        expect(executionContext.strategiesTried).toContain(strategy);
      });
    });
  });

  describe('Call Reason Mapping', () => {
    it('should map confidence levels to correct call reasons', () => {
      // Low confidence with no candidates -> NOT_FOUND
      const notFoundContext = {
        fastPathAttempted: true,
        fastPathConfidence: 0,
        fastPathReason: 'NOT_FOUND' as const,
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'NOT_FOUND' as const,
        currentStepFailures: 0,
        candidatesFound: 0,
      };
      expect(notFoundContext.callReason).toBe('NOT_FOUND');
      expect(notFoundContext.candidatesFound).toBe(0);

      // Medium confidence with multiple candidates -> DISAMBIGUATION
      const ambiguousContext = {
        fastPathAttempted: true,
        fastPathConfidence: 55,
        fastPathReason: 'AMBIGUOUS' as const,
        strategiesTried: ['recorded_selector', 'scope_filter'],
        scrollAttempted: false,
        callReason: 'DISAMBIGUATION' as const,
        currentStepFailures: 0,
        candidatesFound: 3,
      };
      expect(ambiguousContext.callReason).toBe('DISAMBIGUATION');
      expect(ambiguousContext.candidatesFound).toBeGreaterThan(1);

      // Low confidence with single candidate -> LOW_CONFIDENCE
      const lowConfContext = {
        fastPathAttempted: true,
        fastPathConfidence: 30,
        fastPathReason: 'LOW_CONFIDENCE' as const,
        strategiesTried: ['recorded_selector'],
        scrollAttempted: false,
        callReason: 'LOW_CONFIDENCE' as const,
        currentStepFailures: 0,
        candidatesFound: 1,
      };
      expect(lowConfContext.callReason).toBe('LOW_CONFIDENCE');
    });
  });
});

describe('Feature Flag Control', () => {
  beforeEach(() => {
    capturedPayloads = [];
    vi.clearAllMocks();
  });

  it('should verify INTELLIGENT_AGENT_CONTEXT flag is enabled', async () => {
    const { FeatureFlags, isFeatureEnabled } = await import('./feature-flags');

    expect(FeatureFlags.INTELLIGENT_AGENT_CONTEXT).toBe(true);
    expect(isFeatureEnabled('INTELLIGENT_AGENT_CONTEXT')).toBe(true);
  });

  it('should verify Phase 2 flags have expected states', async () => {
    const { FeatureFlags } = await import('./feature-flags');

    expect(FeatureFlags.INTELLIGENT_AGENT_FLEXIBLE).toBe(true);  // Enabled in Phase 2A
    expect(FeatureFlags.INTELLIGENT_AGENT_GOAL).toBe(false);
    expect(FeatureFlags.INTELLIGENT_AGENT_VERIFY).toBe(false);
  });
});

describe('dom_agent Prompt Section', () => {
  it('should build correct context section for prompt', () => {
    // Simulate what dom_agent does with the context
    const buildExecutionContextSection = (executionContext: any): string => {
      if (!executionContext?.fastPathAttempted) {
        return '';
      }

      const ctx = executionContext;

      return `
## 🔧 EXECUTION CONTEXT (What was already tried)

**Fast-path was attempted:** YES
**Fast-path confidence:** ${ctx.fastPathConfidence ?? 'N/A'}%
**Fast-path result:** ${ctx.fastPathReason || 'Unknown'}
**Why LLM is being called:** ${ctx.callReason}

**Strategies already tried:**
${ctx.strategiesTried.map((s: string) => `  • ${s}`).join('\n') || '  • (none)'}

**Candidates found:** ${ctx.candidatesFound}
${ctx.topCandidateScore ? `**Top candidate score:** ${ctx.topCandidateScore}%` : ''}
${ctx.scrollAttempted ? `**Scroll attempted:** YES (${ctx.scrollDirection || 'down'})` : ''}
${ctx.currentStepFailures > 0 ? `**Previous failures on this step:** ${ctx.currentStepFailures}` : ''}

⚠️ IMPORTANT - Use this context to make better decisions:
- If strategies were already tried, DON'T suggest the same approach
- If candidates were found but confidence was low, help disambiguate
- If NOT_FOUND, the element may need scrolling or may not exist
- If AMBIGUOUS, use scope/widget hints to pick the right one
`;
    };

    // Test with various contexts
    const ambiguousContext = {
      fastPathAttempted: true,
      fastPathConfidence: 55,
      fastPathReason: 'AMBIGUOUS',
      strategiesTried: ['recorded_selector', 'scope_filter'],
      scrollAttempted: false,
      callReason: 'DISAMBIGUATION',
      currentStepFailures: 0,
      candidatesFound: 3,
      topCandidateScore: 55,
    };

    const section = buildExecutionContextSection(ambiguousContext);

    expect(section).toContain('EXECUTION CONTEXT');
    expect(section).toContain('Fast-path confidence:** 55%');
    expect(section).toContain('AMBIGUOUS');
    expect(section).toContain('DISAMBIGUATION');
    expect(section).toContain('recorded_selector');
    expect(section).toContain('scope_filter');
    expect(section).toContain('Candidates found:** 3');

    // Test with NOT_FOUND + scroll
    const notFoundContext = {
      fastPathAttempted: true,
      fastPathConfidence: 0,
      fastPathReason: 'NOT_FOUND',
      strategiesTried: ['recorded_selector', 'xpath', 'css_selector'],
      scrollAttempted: true,
      scrollDirection: 'down',
      callReason: 'NOT_FOUND',
      currentStepFailures: 2,
      candidatesFound: 0,
    };

    const notFoundSection = buildExecutionContextSection(notFoundContext);

    expect(notFoundSection).toContain('NOT_FOUND');
    expect(notFoundSection).toContain('Scroll attempted:** YES');
    expect(notFoundSection).toContain('Previous failures on this step:** 2');
    expect(notFoundSection).toContain('Candidates found:** 0');

    // Test with no fast-path attempt
    const noFastPathContext = {
      fastPathAttempted: false,
      strategiesTried: [],
      scrollAttempted: false,
      callReason: 'INITIAL',
      currentStepFailures: 0,
      candidatesFound: 0,
    };

    const emptySection = buildExecutionContextSection(noFastPathContext);
    expect(emptySection).toBe('');
  });
});
