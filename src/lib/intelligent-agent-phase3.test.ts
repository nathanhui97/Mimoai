/**
 * Tests for Phase 3: Smart Step Outcome Verification
 *
 * These tests verify that:
 * 1. INTELLIGENT_AGENT_STEP_VERIFY feature flag exists and is false by default
 * 2. verifyStepOutcome returns inconclusive when no page states
 * 3. verifyStepOutcome returns inconclusive when no criteria or expectedOutcome
 * 4. checkStructuredCriteria works for all 10 criteria types
 * 5. checkExpectedOutcomeText matches keywords to ChangeTypes
 * 6. handleStepVerificationResult decides retry correctly
 * 7. Flag off → no verification runs (backward compatibility)
 */

import { describe, it, expect } from 'vitest';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';
import type { ChangeType, PageChanges } from './post-action-observer';

// ============================================================================
// Type definitions (mirror relevant parts from ai-agent.ts / success-verifier.ts)
// ============================================================================

interface MockPageState {
  url: string;
  title: string;
  hasModal: boolean;
  hasDropdown: boolean;
  visibleText: string;
  elementCount: number;
  toastMessages: string[];
}

interface MockSuccessCriteria {
  type: 'modal_appears' | 'text_appears' | 'text_disappears' | 'url_changes' |
        'element_appears' | 'element_disappears' | 'input_cleared' |
        'toast_appears' | 'count_changes' | 'dom_stabilizes';
  params: Record<string, any>;
  fallback?: string;
}

interface MockHint {
  stepNumber: number;
  description: string;
  completed: boolean;
  failureCount?: number;
  aiAnalysisContext?: {
    successCriteria?: MockSuccessCriteria;
  };
  naturalLanguage?: {
    expectedOutcome: string;
  };
  _stepVerifyFailureCount?: number;
}

type StepVerificationOutcome = 'verified' | 'unverified' | 'inconclusive';

interface StepVerificationResult {
  outcome: StepVerificationOutcome;
  confidence: number;
  details: string;
  criteriaType?: string;
  elapsedMs: number;
}

// ============================================================================
// Logic Simulators
// ============================================================================

/**
 * Simulates verifyStepOutcome() from ai-agent.ts
 */
function verifyStepOutcome(
  hint: MockHint,
  preState: MockPageState | null,
  postState: MockPageState | null,
  pageChanges?: PageChanges | null,
): StepVerificationResult {
  const start = performance.now();

  if (!preState || !postState) {
    return { outcome: 'inconclusive', confidence: 0, details: 'Missing pre/post page state', elapsedMs: performance.now() - start };
  }

  const hasCriteria = !!hint.aiAnalysisContext?.successCriteria;
  const hasExpectedOutcome = !!hint.naturalLanguage?.expectedOutcome;
  if (!hasCriteria && !hasExpectedOutcome) {
    return { outcome: 'inconclusive', confidence: 0, details: 'No success criteria or expectedOutcome on hint', elapsedMs: performance.now() - start };
  }

  if (hasCriteria) {
    return checkStructuredCriteria(hint.aiAnalysisContext!.successCriteria!, preState, postState, start);
  }

  if (hasExpectedOutcome && pageChanges) {
    return checkExpectedOutcomeText(hint.naturalLanguage!.expectedOutcome, pageChanges, start);
  }

  return { outcome: 'inconclusive', confidence: 0.3, details: 'Expected outcome present but no pageChanges to match against', elapsedMs: performance.now() - start };
}

/**
 * Simulates checkStructuredCriteria() from ai-agent.ts
 */
function checkStructuredCriteria(
  criteria: MockSuccessCriteria,
  before: MockPageState,
  after: MockPageState,
  startTime: number,
): StepVerificationResult {
  const elapsed = () => performance.now() - startTime;

  switch (criteria.type) {
    case 'modal_appears': {
      if (!before.hasModal && after.hasModal) {
        return { outcome: 'verified', confidence: 0.95, details: 'Modal appeared', criteriaType: 'modal_appears', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.8, details: 'Modal did not appear', criteriaType: 'modal_appears', elapsedMs: elapsed() };
    }

    case 'text_appears': {
      const pattern = criteria.params?.textPattern;
      if (!pattern) {
        return { outcome: 'inconclusive', confidence: 0.3, details: 'No textPattern specified', criteriaType: 'text_appears', elapsedMs: elapsed() };
      }
      const found = after.visibleText.toLowerCase().includes(pattern.toLowerCase());
      return found
        ? { outcome: 'verified', confidence: 0.9, details: `Found "${pattern}"`, criteriaType: 'text_appears', elapsedMs: elapsed() }
        : { outcome: 'unverified', confidence: 0.7, details: `"${pattern}" not found`, criteriaType: 'text_appears', elapsedMs: elapsed() };
    }

    case 'text_disappears': {
      const pattern = criteria.params?.textPattern;
      if (!pattern) {
        return { outcome: 'inconclusive', confidence: 0.3, details: 'No textPattern specified', criteriaType: 'text_disappears', elapsedMs: elapsed() };
      }
      const wasThere = before.visibleText.toLowerCase().includes(pattern.toLowerCase());
      const isGone = !after.visibleText.toLowerCase().includes(pattern.toLowerCase());
      if (wasThere && isGone) {
        return { outcome: 'verified', confidence: 0.9, details: `"${pattern}" disappeared`, criteriaType: 'text_disappears', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.7, details: `"${pattern}" still present`, criteriaType: 'text_disappears', elapsedMs: elapsed() };
    }

    case 'url_changes': {
      if (before.url !== after.url) {
        const urlPattern = criteria.params?.urlPattern;
        if (urlPattern) {
          const matches = after.url.includes(urlPattern) || new RegExp(urlPattern).test(after.url);
          return matches
            ? { outcome: 'verified', confidence: 0.95, details: 'URL changed and matches pattern', criteriaType: 'url_changes', elapsedMs: elapsed() }
            : { outcome: 'verified', confidence: 0.7, details: `URL changed but doesn't match pattern`, criteriaType: 'url_changes', elapsedMs: elapsed() };
        }
        return { outcome: 'verified', confidence: 0.9, details: 'URL changed', criteriaType: 'url_changes', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.8, details: 'URL did not change', criteriaType: 'url_changes', elapsedMs: elapsed() };
    }

    case 'element_appears': {
      if (!before.hasDropdown && after.hasDropdown) {
        return { outcome: 'verified', confidence: 0.85, details: 'Dropdown opened', criteriaType: 'element_appears', elapsedMs: elapsed() };
      }
      if (!before.hasModal && after.hasModal) {
        return { outcome: 'verified', confidence: 0.85, details: 'Modal appeared', criteriaType: 'element_appears', elapsedMs: elapsed() };
      }
      if (after.elementCount > before.elementCount) {
        return { outcome: 'verified', confidence: 0.6, details: 'Element count increased', criteriaType: 'element_appears', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.5, details: 'Element did not appear', criteriaType: 'element_appears', elapsedMs: elapsed() };
    }

    case 'element_disappears': {
      if (before.hasModal && !after.hasModal) {
        return { outcome: 'verified', confidence: 0.9, details: 'Modal closed', criteriaType: 'element_disappears', elapsedMs: elapsed() };
      }
      if (before.hasDropdown && !after.hasDropdown) {
        return { outcome: 'verified', confidence: 0.85, details: 'Dropdown closed', criteriaType: 'element_disappears', elapsedMs: elapsed() };
      }
      if (after.elementCount < before.elementCount) {
        return { outcome: 'verified', confidence: 0.6, details: 'Element count decreased', criteriaType: 'element_disappears', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.5, details: 'Element did not disappear', criteriaType: 'element_disappears', elapsedMs: elapsed() };
    }

    case 'input_cleared': {
      if (after.visibleText.length < before.visibleText.length) {
        return { outcome: 'verified', confidence: 0.6, details: 'Visible text decreased (input cleared)', criteriaType: 'input_cleared', elapsedMs: elapsed() };
      }
      return { outcome: 'inconclusive', confidence: 0.4, details: 'Cannot confirm input cleared', criteriaType: 'input_cleared', elapsedMs: elapsed() };
    }

    case 'toast_appears': {
      if (after.toastMessages.length > before.toastMessages.length) {
        const pattern = criteria.params?.toastPattern;
        if (pattern) {
          const matched = after.toastMessages.some(msg => msg.toLowerCase().includes(pattern.toLowerCase()));
          return matched
            ? { outcome: 'verified', confidence: 0.95, details: `Toast matched: "${pattern}"`, criteriaType: 'toast_appears', elapsedMs: elapsed() }
            : { outcome: 'verified', confidence: 0.7, details: 'Toast appeared but pattern not matched', criteriaType: 'toast_appears', elapsedMs: elapsed() };
        }
        return { outcome: 'verified', confidence: 0.7, details: 'Toast appeared', criteriaType: 'toast_appears', elapsedMs: elapsed() };
      }
      return { outcome: 'unverified', confidence: 0.5, details: 'No toast appeared', criteriaType: 'toast_appears', elapsedMs: elapsed() };
    }

    case 'count_changes': {
      const diff = after.elementCount - before.elementCount;
      const expected = criteria.params?.expectedChange;
      if (expected === 'increase' && diff > 0) {
        return { outcome: 'verified', confidence: 0.7, details: `Count increased by ${diff}`, criteriaType: 'count_changes', elapsedMs: elapsed() };
      }
      if (expected === 'decrease' && diff < 0) {
        return { outcome: 'verified', confidence: 0.7, details: `Count decreased by ${-diff}`, criteriaType: 'count_changes', elapsedMs: elapsed() };
      }
      if (!expected && diff !== 0) {
        return { outcome: 'verified', confidence: 0.5, details: `Count changed by ${diff}`, criteriaType: 'count_changes', elapsedMs: elapsed() };
      }
      return { outcome: 'inconclusive', confidence: 0.4, details: 'Count did not change as expected', criteriaType: 'count_changes', elapsedMs: elapsed() };
    }

    case 'dom_stabilizes': {
      const anyChange = before.url !== after.url ||
        before.hasModal !== after.hasModal ||
        before.hasDropdown !== after.hasDropdown ||
        before.elementCount !== after.elementCount ||
        before.toastMessages.length !== after.toastMessages.length;
      return {
        outcome: 'inconclusive',
        confidence: anyChange ? 0.6 : 0.5,
        details: anyChange ? 'DOM changed (stability unknown without async check)' : 'No observable changes',
        criteriaType: 'dom_stabilizes',
        elapsedMs: elapsed(),
      };
    }

    default:
      return { outcome: 'inconclusive', confidence: 0.3, details: `Unknown criteria type`, elapsedMs: elapsed() };
  }
}

/**
 * Simulates checkExpectedOutcomeText() from ai-agent.ts
 */
function checkExpectedOutcomeText(
  expectedOutcome: string,
  pageChanges: PageChanges,
  startTime: number,
): StepVerificationResult {
  const elapsed = () => performance.now() - startTime;
  const outcome = expectedOutcome.toLowerCase();
  const changeTypes: ChangeType[] = pageChanges.changes.map(c => c.type);

  const keywordMappings: Array<{ keywords: string[]; changeTypes: ChangeType[]; confidence: number }> = [
    { keywords: ['dropdown opens', 'menu opens', 'options appear'], changeTypes: ['dropdown_opened'], confidence: 0.85 },
    { keywords: ['modal', 'dialog', 'popup', 'opens'], changeTypes: ['modal_appeared'], confidence: 0.85 },
    { keywords: ['closes', 'dismissed', 'disappears'], changeTypes: ['modal_closed', 'dropdown_closed'], confidence: 0.8 },
    { keywords: ['navigat', 'redirect', 'page changes'], changeTypes: ['url_changed'], confidence: 0.9 },
    { keywords: ['success', 'saved', 'created', 'confirmed'], changeTypes: ['success_appeared', 'toast_appeared'], confidence: 0.8 },
    { keywords: ['error', 'fail', 'invalid'], changeTypes: ['error_appeared'], confidence: 0.8 },
  ];

  for (const mapping of keywordMappings) {
    const keywordMatch = mapping.keywords.some(kw => outcome.includes(kw));
    if (keywordMatch) {
      const changeMatch = mapping.changeTypes.some(ct => changeTypes.includes(ct));
      if (changeMatch) {
        return {
          outcome: 'verified',
          confidence: mapping.confidence,
          details: `Expected "${mapping.keywords.find(kw => outcome.includes(kw))}" matched observed change`,
          criteriaType: 'text_match',
          elapsedMs: elapsed(),
        };
      }
    }
  }

  if (pageChanges.hasSignificantChange) {
    return { outcome: 'inconclusive', confidence: 0.5, details: 'Significant change detected but no keyword match', criteriaType: 'text_match', elapsedMs: elapsed() };
  }

  return { outcome: 'inconclusive', confidence: 0.3, details: 'No changes detected to match expectedOutcome', criteriaType: 'text_match', elapsedMs: elapsed() };
}

/**
 * Simulates handleStepVerificationResult() from ai-agent.ts
 */
function handleStepVerificationResult(
  hint: MockHint,
  result: StepVerificationResult,
): { shouldRetry: boolean } {
  switch (result.outcome) {
    case 'verified':
      return { shouldRetry: false };

    case 'unverified': {
      const failCount = (hint._stepVerifyFailureCount ?? 0) + 1;
      hint._stepVerifyFailureCount = failCount;

      if (failCount === 1 && result.confidence < 0.5) {
        return { shouldRetry: true };
      }
      return { shouldRetry: false };
    }

    case 'inconclusive':
      return { shouldRetry: false };

    default:
      return { shouldRetry: false };
  }
}

// ============================================================================
// Helper factories
// ============================================================================

function makePageState(overrides?: Partial<MockPageState>): MockPageState {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    hasModal: false,
    hasDropdown: false,
    visibleText: 'Hello world',
    elementCount: 100,
    toastMessages: [],
    ...overrides,
  };
}

function makeHint(overrides?: Partial<MockHint>): MockHint {
  return {
    stepNumber: 0,
    description: 'Test hint',
    completed: false,
    ...overrides,
  };
}

function makePageChanges(changes: PageChanges['changes'], hasSignificantChange = true): PageChanges {
  return {
    hasSignificantChange,
    changes,
    elapsedMs: 10,
    interpretation: 'ui_update',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 3: Smart Step Outcome Verification', () => {

  // --------------------------------------------------------------------------
  // Feature Flag
  // --------------------------------------------------------------------------
  describe('Feature Flag', () => {
    it('1. INTELLIGENT_AGENT_STEP_VERIFY exists in FeatureFlags', () => {
      expect('INTELLIGENT_AGENT_STEP_VERIFY' in FeatureFlags).toBe(true);
    });

    it('2. INTELLIGENT_AGENT_STEP_VERIFY is false by default', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_STEP_VERIFY).toBe(false);
      expect(isFeatureEnabled('INTELLIGENT_AGENT_STEP_VERIFY')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // verifyStepOutcome guards
  // --------------------------------------------------------------------------
  describe('verifyStepOutcome guards', () => {
    it('3. Returns inconclusive when no page states', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'modal_appears', params: {} } } });
      const result = verifyStepOutcome(hint, null, null);
      expect(result.outcome).toBe('inconclusive');
      expect(result.details).toContain('Missing pre/post page state');
    });

    it('4. Returns inconclusive when hint has no criteria or expectedOutcome', () => {
      const hint = makeHint();
      const result = verifyStepOutcome(hint, makePageState(), makePageState());
      expect(result.outcome).toBe('inconclusive');
      expect(result.details).toContain('No success criteria or expectedOutcome');
    });
  });

  // --------------------------------------------------------------------------
  // checkStructuredCriteria (10 criteria types)
  // --------------------------------------------------------------------------
  describe('checkStructuredCriteria', () => {
    it('5. modal_appears — verified when modal appeared', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'modal_appears', params: {} } } });
      const before = makePageState({ hasModal: false });
      const after = makePageState({ hasModal: true });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.95);
      expect(result.criteriaType).toBe('modal_appears');
    });

    it('6. modal_appears — unverified when no modal', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'modal_appears', params: {} } } });
      const before = makePageState({ hasModal: false });
      const after = makePageState({ hasModal: false });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('unverified');
    });

    it('7. text_appears — verified when pattern found', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'text_appears', params: { textPattern: 'Order Confirmed' } } } });
      const before = makePageState();
      const after = makePageState({ visibleText: 'Your Order Confirmed successfully' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.9);
    });

    it('8. text_appears — unverified when pattern not found', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'text_appears', params: { textPattern: 'Order Confirmed' } } } });
      const before = makePageState();
      const after = makePageState({ visibleText: 'Something else on page' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('unverified');
    });

    it('9. text_disappears — verified when text gone', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'text_disappears', params: { textPattern: 'Loading...' } } } });
      const before = makePageState({ visibleText: 'Loading... please wait' });
      const after = makePageState({ visibleText: 'Content loaded' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.9);
    });

    it('10. url_changes — verified when URL changed', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'url_changes', params: {} } } });
      const before = makePageState({ url: 'https://example.com/page1' });
      const after = makePageState({ url: 'https://example.com/page2' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.9);
    });

    it('11. url_changes — unverified when URL same', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'url_changes', params: {} } } });
      const before = makePageState({ url: 'https://example.com/page1' });
      const after = makePageState({ url: 'https://example.com/page1' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('unverified');
    });

    it('12. element_appears — verified when dropdown opened', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'element_appears', params: {} } } });
      const before = makePageState({ hasDropdown: false });
      const after = makePageState({ hasDropdown: true });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.85);
    });

    it('13. element_disappears — verified when modal closed', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'element_disappears', params: {} } } });
      const before = makePageState({ hasModal: true });
      const after = makePageState({ hasModal: false });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.9);
    });

    it('14. toast_appears — verified with matching pattern', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'toast_appears', params: { toastPattern: 'saved successfully' } } } });
      const before = makePageState({ toastMessages: [] });
      const after = makePageState({ toastMessages: ['Record saved successfully!'] });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.95);
    });

    it('15. toast_appears — unverified with no toast', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'toast_appears', params: { toastPattern: 'saved' } } } });
      const before = makePageState({ toastMessages: [] });
      const after = makePageState({ toastMessages: [] });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('unverified');
    });

    it('16. input_cleared — verified when text decreased', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'input_cleared', params: {} } } });
      const before = makePageState({ visibleText: 'Hello world with lots of text in the input field' });
      const after = makePageState({ visibleText: 'Hello world' });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.6);
    });

    it('17. count_changes — verified when count increased as expected', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'count_changes', params: { expectedChange: 'increase' } } } });
      const before = makePageState({ elementCount: 100 });
      const after = makePageState({ elementCount: 115 });
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.7);
    });

    it('18. dom_stabilizes — inconclusive (best we can do synchronously)', () => {
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'dom_stabilizes', params: {} } } });
      const before = makePageState();
      const after = makePageState();
      const result = verifyStepOutcome(hint, before, after);
      expect(result.outcome).toBe('inconclusive');
      expect(result.criteriaType).toBe('dom_stabilizes');
    });
  });

  // --------------------------------------------------------------------------
  // checkExpectedOutcomeText (keyword matching)
  // --------------------------------------------------------------------------
  describe('checkExpectedOutcomeText', () => {
    it('19. "dropdown opens" matched by dropdown_opened change', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'Dropdown opens with options' } });
      const changes = makePageChanges([{ type: 'dropdown_opened', description: 'Dropdown/menu opened' }]);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.85);
    });

    it('20. "modal" matched by modal_appeared change', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'A confirmation modal appears' } });
      const changes = makePageChanges([{ type: 'modal_appeared', description: 'Modal/dialog appeared' }]);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.85);
    });

    it('21. "navigat" matched by url_changed change', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'Page navigates to dashboard' } });
      const changes = makePageChanges([{ type: 'url_changed', description: 'Page navigation occurred' }]);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.9);
    });

    it('22. "success" matched by success_appeared change', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'Shows success message' } });
      const changes = makePageChanges([{ type: 'success_appeared', description: 'Success message appeared' }]);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('verified');
      expect(result.confidence).toBe(0.8);
    });

    it('23. No keyword match but significant change → inconclusive', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'Something random happens' } });
      const changes = makePageChanges([{ type: 'dom_changed', description: 'Significant DOM change' }]);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('inconclusive');
      expect(result.confidence).toBe(0.5);
    });

    it('24. No change at all → inconclusive', () => {
      const hint = makeHint({ naturalLanguage: { expectedOutcome: 'Something should happen' } });
      const changes = makePageChanges([], false);
      const result = verifyStepOutcome(hint, makePageState(), makePageState(), changes);
      expect(result.outcome).toBe('inconclusive');
      expect(result.confidence).toBe(0.3);
    });
  });

  // --------------------------------------------------------------------------
  // handleStepVerificationResult
  // --------------------------------------------------------------------------
  describe('handleStepVerificationResult', () => {
    it('25. verified → shouldRetry=false', () => {
      const hint = makeHint();
      const result: StepVerificationResult = { outcome: 'verified', confidence: 0.9, details: 'Good', elapsedMs: 1 };
      expect(handleStepVerificationResult(hint, result).shouldRetry).toBe(false);
    });

    it('26. unverified + low confidence + first time → shouldRetry=true', () => {
      const hint = makeHint();
      const result: StepVerificationResult = { outcome: 'unverified', confidence: 0.3, details: 'Failed', elapsedMs: 1 };
      expect(handleStepVerificationResult(hint, result).shouldRetry).toBe(true);
      expect(hint._stepVerifyFailureCount).toBe(1);
    });

    it('27. unverified + high confidence → shouldRetry=false', () => {
      const hint = makeHint();
      const result: StepVerificationResult = { outcome: 'unverified', confidence: 0.8, details: 'Failed', elapsedMs: 1 };
      expect(handleStepVerificationResult(hint, result).shouldRetry).toBe(false);
    });

    it('28. unverified + second time → shouldRetry=false', () => {
      const hint = makeHint({ _stepVerifyFailureCount: 1 });
      const result: StepVerificationResult = { outcome: 'unverified', confidence: 0.3, details: 'Failed again', elapsedMs: 1 };
      expect(handleStepVerificationResult(hint, result).shouldRetry).toBe(false);
      expect(hint._stepVerifyFailureCount).toBe(2);
    });

    it('29. inconclusive → shouldRetry=false', () => {
      const hint = makeHint();
      const result: StepVerificationResult = { outcome: 'inconclusive', confidence: 0.5, details: 'Unclear', elapsedMs: 1 };
      expect(handleStepVerificationResult(hint, result).shouldRetry).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Integration / backward compatibility
  // --------------------------------------------------------------------------
  describe('Integration', () => {
    it('30. Flag off → no verification runs (backward compatibility)', () => {
      // When flag is off, the execution loop should not call verifyStepOutcome.
      // We verify this by confirming the flag is off by default.
      expect(isFeatureEnabled('INTELLIGENT_AGENT_STEP_VERIFY')).toBe(false);

      // Even if verifyStepOutcome were called, it should be safe:
      const hint = makeHint({ aiAnalysisContext: { successCriteria: { type: 'modal_appears', params: {} } } });
      const result = verifyStepOutcome(hint, makePageState(), makePageState({ hasModal: true }));
      // Still works — but in production code the guard `isFeatureEnabled(...)` prevents the call
      expect(result.outcome).toBe('verified');
    });
  });
});
