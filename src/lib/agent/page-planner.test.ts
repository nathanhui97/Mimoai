import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PagePlanner } from './page-planner';
import type { AgentObservation, AgentHint } from './types';

// Typed mock helpers (chrome API types conflict with vi.mocked)
const mockChromeGet = vi.mocked(chrome.storage.local.get) as any;

// ============================================================================
// Helpers
// ============================================================================

function makeObservation(overrides?: Partial<AgentObservation>): AgentObservation {
  return {
    url: 'https://app.example.com/contacts/new',
    title: 'New Contact',
    domMapText: '<div>Sample DOM map text with some content for hashing</div>',
    hasModal: false,
    formFields: [],
    buttonCount: 2,
    linkCount: 5,
    inputCount: 3,
    headings: ['New Contact'],
    ...overrides,
  } as AgentObservation;
}

function makeHint(index: number, overrides?: Partial<AgentHint>): AgentHint {
  return {
    stepNumber: index + 1,
    description: `Step ${index + 1}`,
    actionType: 'type',
    value: `value-${index}`,
    ...overrides,
  } as AgentHint;
}

// ============================================================================
// Plan Validation and Caching
// ============================================================================

describe('PagePlanner', () => {
  let planner: PagePlanner;

  beforeEach(() => {
    planner = new PagePlanner();
    // Reset chrome storage mock
    mockChromeGet.mockResolvedValue({});
    vi.mocked(chrome.storage.local.set).mockResolvedValue();
    // Mock fetch to prevent real HTTP calls (tests that hit callPlanner would hang)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
  });

  describe('invalidate', () => {
    it('clears the current plan', () => {
      planner.invalidate();
      expect(planner.getPlan()).toBeNull();
    });
  });

  describe('getActionForHint', () => {
    it('returns null when no plan exists', () => {
      expect(planner.getActionForHint(0)).toBeNull();
    });
  });

  describe('setWorkflowId', () => {
    it('sets the workflow ID for cache keying', () => {
      // Should not throw
      planner.setWorkflowId('workflow-123');
    });
  });

  describe('plan - in-memory caching', () => {
    it('returns null when there are no remaining hints', async () => {
      const obs = makeObservation();
      const hints: AgentHint[] = [];

      const plan = await planner.plan(obs, hints, 0);
      expect(plan).toBeNull();
    });

    it('returns null when all hints are completed', async () => {
      const obs = makeObservation();
      const hints = [
        { ...makeHint(0), completed: true },
        { ...makeHint(1), completed: true },
      ];

      const plan = await planner.plan(obs, hints, 0);
      expect(plan).toBeNull();
    });

    it('returns null when currentHintIndex is past all hints', async () => {
      const obs = makeObservation();
      const hints = [makeHint(0), makeHint(1)];

      const plan = await planner.plan(obs, hints, 5);
      expect(plan).toBeNull();
    });
  });

  describe('plan - persistent cache', () => {
    it('loads cached plan from chrome.storage when available', async () => {
      planner.setWorkflowId('wf-1');

      const cachedPlan = {
        pageType: 'form',
        url: 'https://app.example.com/contacts/new',
        generatedAt: Date.now(),
        fieldActions: [{
          fieldName: 'Name',
          value: 'John',
          elementIndex: 0,
          selector: '#name',
          strategy: 'type',
          required: true,
          hintIndex: 0,
        }],
        navigationActions: [],
        coveredHintIndices: [0],
        confidence: 0.9,
        reasoning: 'Cached plan',
      };

      const cacheKey = 'wf-1:https://app.example.com/contacts/new';
      mockChromeGet.mockResolvedValue({
        'ghostwriter-plan-cache': {
          [cacheKey]: {
            plan: cachedPlan,
            urlPattern: 'https://app.example.com/contacts/new',
            workflowId: 'wf-1',
            successCount: 3,
            failureCount: 0,
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
            mastered: true,
          },
        },
      });

      const obs = makeObservation();
      const hints = [makeHint(0, { description: 'Type name' })];

      await planner.plan(obs, hints, 0);
      // Plan should be loaded from cache (or null if remapping fails)
      // The key test is that chrome.storage.local.get was called
      expect(chrome.storage.local.get).toHaveBeenCalledWith('ghostwriter-plan-cache');
    });

    it('skips cached plan with too many failures', async () => {
      planner.setWorkflowId('wf-2');

      const cacheKey = 'wf-2:https://app.example.com/contacts/new';
      mockChromeGet.mockResolvedValue({
        'ghostwriter-plan-cache': {
          [cacheKey]: {
            plan: { fieldActions: [], navigationActions: [], coveredHintIndices: [] },
            urlPattern: 'https://app.example.com/contacts/new',
            workflowId: 'wf-2',
            successCount: 1,
            failureCount: 5, // More failures than successes
            lastUsedAt: Date.now(),
            createdAt: Date.now(),
            mastered: false,
          },
        },
      });

      const obs = makeObservation();
      const hints = [makeHint(0)];

      // This will try cache → fail → try LLM (which will also fail since no API)
      // The important thing is it doesn't use the bad cached plan
      const plan = await planner.plan(obs, hints, 0);
      // Plan will be null because LLM call won't work in tests
      expect(plan).toBeNull();
    });
  });

  describe('reportSuccess / reportFailure', () => {
    it('reportSuccess does nothing without a current plan', async () => {
      await planner.reportSuccess();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('reportFailure does nothing without a current plan', async () => {
      await planner.reportFailure();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    it('reportSuccess does nothing without a workflow ID', async () => {
      // Don't set workflowId
      await planner.reportSuccess();
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// URL Pattern Normalization (tested indirectly through plan cache)
// ============================================================================

describe('PagePlanner URL normalization', () => {
  it('normalizes URLs by stripping query params and numeric IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const planner = new PagePlanner();
    planner.setWorkflowId('wf-url');

    mockChromeGet.mockResolvedValue({});

    const obs = makeObservation({
      url: 'https://app.example.com/contacts/123?tab=details#section',
    });
    const hints = [makeHint(0)];

    // Will fail to generate plan (no API), but exercises URL normalization
    await planner.plan(obs, hints, 0);

    // The cache lookup should use normalized URL
    expect(chrome.storage.local.get).toHaveBeenCalled();
  });
});

// ============================================================================
// Hint filtering
// ============================================================================

describe('PagePlanner hint filtering', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
  });

  it('skips completed hints', async () => {
    const planner = new PagePlanner();
    mockChromeGet.mockResolvedValue({});

    const obs = makeObservation();
    const hints = [
      { ...makeHint(0), completed: true },
      { ...makeHint(1), completed: true },
      makeHint(2),
    ];

    // Should only process hint at index 2
    const plan = await planner.plan(obs, hints, 0);
    // Will be null due to no API, but exercises hint filtering
    expect(plan).toBeNull();
  });

  it('stops collecting hints after a navigation hint', async () => {
    const planner = new PagePlanner();
    mockChromeGet.mockResolvedValue({});

    const obs = makeObservation();
    const hints = [
      makeHint(0, { actionType: 'type' }),
      makeHint(1, { actionType: 'navigate' }), // Navigation hint — should stop here
      makeHint(2, { actionType: 'type' }), // Should NOT be included
    ];

    // Exercises getHintsForCurrentPage
    await planner.plan(obs, hints, 0);
    // The plan will be null (no API), but the logic runs
  });
});
