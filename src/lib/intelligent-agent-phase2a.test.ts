/**
 * Tests for Phase 2A: Intelligent Agent - Flexible LLM Responses
 *
 * These tests verify that:
 * 1. parseGeminiResponse allows scroll/wait/skip/done when allowFlexibleResponses=true
 * 2. parseGeminiResponse still throws when allowFlexibleResponses=false (backward compat)
 * 3. Candidate selection still works normally with flexible responses enabled
 * 4. detectIntermediateAction treats scroll/wait as intermediate when flag is on
 * 5. Feature flag controls all behavior
 */

import { describe, it, expect } from 'vitest';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';

// ============================================================================
// parseGeminiResponse Tests
// ============================================================================
// We extract the parsing logic inline since parseGeminiResponse lives in an
// edge function (Deno). We replicate its candidate-enforcement logic here to
// unit-test the branching without needing a Deno runtime.

/**
 * Simulates the candidate enforcement section of parseGeminiResponse.
 * This mirrors the logic in supabase/functions/dom_agent/index.ts lines ~1376-1421.
 */
function simulateParseCandiateEnforcement(
  parsed: any,
  payload: {
    currentCandidates: Array<{ role: string; name: string; text?: string; testId?: string; id?: string; placeholder?: string; scopePath?: string; rowKey?: string; widgetTitle?: string; frameId?: number }>;
    allowFlexibleResponses?: boolean;
    currentHintIndex?: number;
  }
): { action: string; target?: any; reason?: string; reasoning?: string; confidence?: number; hintStepIndex?: number; skippedCandidateSelection?: boolean } {
  const currentCandidates = payload.currentCandidates || [];

  if (currentCandidates.length > 0) {
    const allowFlexible = payload.allowFlexibleResponses === true;
    const flexibleActions = ['scroll', 'wait', 'skip', 'done'];

    if (typeof parsed.chooseCandidateIndex !== 'number') {
      // Phase 2A: Allow flexible responses without candidate index
      if (allowFlexible && flexibleActions.includes(parsed.action)) {
        // Fall through — skip candidate mapping
      } else {
        throw new Error('LLM must return chooseCandidateIndex when candidates are provided');
      }
    } else {
      // Validate index is in range
      if (parsed.chooseCandidateIndex < -1 || parsed.chooseCandidateIndex >= currentCandidates.length) {
        throw new Error(`Invalid chooseCandidateIndex: ${parsed.chooseCandidateIndex}`);
      }

      // If LLM chose -1, no candidate matches
      if (parsed.chooseCandidateIndex === -1) {
        return {
          action: 'fail',
          reason: parsed.reasoning || 'No suitable candidate found',
          reasoning: parsed.reasoning || 'No suitable candidate found',
          confidence: 0,
          hintStepIndex: parsed.hintStepIndex ?? payload.currentHintIndex,
        };
      }

      // Map chosen candidate to target
      const chosen = currentCandidates[parsed.chooseCandidateIndex];
      return {
        action: parsed.action || 'click',
        target: {
          role: chosen.role,
          name: chosen.name,
          text: chosen.text,
          testId: chosen.testId,
          id: chosen.id,
          placeholder: chosen.placeholder,
          scopePath: chosen.scopePath,
          rowKey: chosen.rowKey,
          widgetTitle: chosen.widgetTitle,
          frameId: chosen.frameId,
        },
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
        hintStepIndex: parsed.hintStepIndex ?? payload.currentHintIndex,
      };
    }
  }

  // Regular action response (no candidates, or flexible action fell through)
  const validActions = ['click', 'type', 'select', 'scroll', 'navigate', 'wait', 'assert', 'done', 'fail', 'skip', 'read', 'keyboard', 'hover'];
  const action = validActions.includes(parsed.action) ? parsed.action : 'fail';

  return {
    action,
    target: parsed.target,
    reasoning: parsed.reasoning || 'No reasoning provided',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    hintStepIndex: parsed.hintStepIndex ?? payload.currentHintIndex,
    skippedCandidateSelection: true,
  };
}

// ============================================================================
// detectIntermediateAction Tests
// ============================================================================
// We replicate the Phase 2A logic from detectIntermediateAction to unit test it.

interface TestHint {
  actionType: 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'other';
  targetText?: string;
  description?: string;
}

interface TestAction {
  type: string;
  params?: any;
}

/**
 * Simulates the Phase 2A check at the top of detectIntermediateAction.
 * Returns true if the action is intermediate, false otherwise,
 * or null if the Phase 2A check doesn't apply (should fall through to other logic).
 */
function phase2aIntermediateCheck(
  hint: TestHint,
  action: TestAction,
  flexibleEnabled: boolean
): boolean | null {
  if (flexibleEnabled &&
      (action.type === 'scroll' || action.type === 'wait') &&
      hint.actionType !== 'scroll') {
    return true;
  }
  return null; // Phase 2A check doesn't apply, fall through to other detection
}

// ============================================================================
// Sample Data
// ============================================================================

const sampleCandidates = [
  { role: 'button', name: 'Submit', text: 'Submit', testId: 'submit-btn', id: 'btn-1', placeholder: undefined, scopePath: 'form', rowKey: undefined, widgetTitle: 'Main Form', frameId: 0 },
  { role: 'button', name: 'Cancel', text: 'Cancel', testId: 'cancel-btn', id: 'btn-2', placeholder: undefined, scopePath: 'form', rowKey: undefined, widgetTitle: 'Main Form', frameId: 0 },
  { role: 'link', name: 'Submit Feedback', text: 'Submit Feedback', testId: undefined, id: 'link-1', placeholder: undefined, scopePath: 'sidebar', rowKey: undefined, widgetTitle: 'Sidebar', frameId: 0 },
];


// ============================================================================
// Tests
// ============================================================================

describe('Phase 2A: Flexible LLM Responses', () => {
  describe('Feature Flag', () => {
    it('should have INTELLIGENT_AGENT_FLEXIBLE enabled', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_FLEXIBLE).toBe(true);
    });

    it('isFeatureEnabled should return true for INTELLIGENT_AGENT_FLEXIBLE', () => {
      expect(isFeatureEnabled('INTELLIGENT_AGENT_FLEXIBLE')).toBe(true);
    });
  });

  describe('parseGeminiResponse - Candidate Enforcement', () => {
    describe('when allowFlexibleResponses=false (backward compatibility)', () => {
      const basePayload = {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: false,
        currentHintIndex: 0,
      };

      it('should throw when no chooseCandidateIndex and action is scroll', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'scroll', direction: 'down', reasoning: 'Scroll to find element' },
          basePayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should throw when no chooseCandidateIndex and action is wait', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'wait', duration: 1000, reasoning: 'Page loading' },
          basePayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should throw when no chooseCandidateIndex and action is skip', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'skip', reason: 'Already satisfied', reasoning: 'Hint done' },
          basePayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should throw when no chooseCandidateIndex and action is done', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'done', reason: 'Goal achieved', reasoning: 'Complete' },
          basePayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should throw when no chooseCandidateIndex and action is click', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'click', target: { role: 'button', name: 'Submit' }, reasoning: 'Click it' },
          basePayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should still work when chooseCandidateIndex is provided', () => {
        const result = simulateParseCandiateEnforcement(
          { chooseCandidateIndex: 0, action: 'click', reasoning: 'Chose first', confidence: 0.9, hintStepIndex: 0 },
          basePayload
        );
        expect(result.action).toBe('click');
        expect(result.target?.role).toBe('button');
        expect(result.target?.name).toBe('Submit');
      });
    });

    describe('when allowFlexibleResponses=true', () => {
      const flexPayload = {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 0,
      };

      it('should allow scroll without chooseCandidateIndex', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'scroll', direction: 'down', amount: 300, reasoning: 'Element off-screen', confidence: 0.7, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('scroll');
        expect(result.skippedCandidateSelection).toBe(true);
      });

      it('should allow wait without chooseCandidateIndex', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'wait', duration: 1000, reasoning: 'Page loading', confidence: 0.7, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('wait');
        expect(result.skippedCandidateSelection).toBe(true);
      });

      it('should allow skip without chooseCandidateIndex', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'skip', reason: 'Already satisfied', reasoning: 'Value pre-filled', confidence: 0.9, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('skip');
        expect(result.skippedCandidateSelection).toBe(true);
      });

      it('should allow done without chooseCandidateIndex', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'done', reason: 'Goal achieved', reasoning: 'Success page visible', confidence: 0.95, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('done');
        expect(result.skippedCandidateSelection).toBe(true);
      });

      it('should still throw for non-flexible actions without chooseCandidateIndex', () => {
        // 'click' is not a flexible action — it still requires candidate selection
        expect(() => simulateParseCandiateEnforcement(
          { action: 'click', target: { role: 'button', name: 'Submit' }, reasoning: 'Click it' },
          flexPayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should still throw for type action without chooseCandidateIndex', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'type', text: 'hello', reasoning: 'Typing' },
          flexPayload
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });

      it('should still accept chooseCandidateIndex normally', () => {
        const result = simulateParseCandiateEnforcement(
          { chooseCandidateIndex: 1, action: 'click', reasoning: 'Cancel is correct', confidence: 0.95, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('click');
        expect(result.target?.role).toBe('button');
        expect(result.target?.name).toBe('Cancel');
        expect(result.target?.testId).toBe('cancel-btn');
      });

      it('should handle chooseCandidateIndex=-1 (reject all) normally', () => {
        const result = simulateParseCandiateEnforcement(
          { chooseCandidateIndex: -1, action: 'click', reasoning: 'None match', confidence: 0.1, hintStepIndex: 0 },
          flexPayload
        );
        expect(result.action).toBe('fail');
        expect(result.confidence).toBe(0);
      });

      it('should throw on invalid chooseCandidateIndex (out of range)', () => {
        expect(() => simulateParseCandiateEnforcement(
          { chooseCandidateIndex: 99, action: 'click', reasoning: 'Bad index' },
          flexPayload
        )).toThrow('Invalid chooseCandidateIndex: 99');
      });

      it('should throw on negative chooseCandidateIndex below -1', () => {
        expect(() => simulateParseCandiateEnforcement(
          { chooseCandidateIndex: -2, action: 'click', reasoning: 'Bad index' },
          flexPayload
        )).toThrow('Invalid chooseCandidateIndex: -2');
      });
    });

    describe('when no candidates exist', () => {
      it('should return action normally regardless of flag', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'scroll', direction: 'down', reasoning: 'Scrolling', confidence: 0.8, hintStepIndex: 0 },
          { currentCandidates: [], allowFlexibleResponses: false, currentHintIndex: 0 }
        );
        expect(result.action).toBe('scroll');
      });

      it('should not require chooseCandidateIndex when no candidates', () => {
        const result = simulateParseCandiateEnforcement(
          { action: 'click', target: { role: 'button', name: 'Submit' }, reasoning: 'Click', confidence: 0.9, hintStepIndex: 0 },
          { currentCandidates: [], allowFlexibleResponses: false, currentHintIndex: 0 }
        );
        expect(result.action).toBe('click');
      });
    });

    describe('when allowFlexibleResponses is undefined', () => {
      it('should behave like false (throw on missing index)', () => {
        expect(() => simulateParseCandiateEnforcement(
          { action: 'scroll', reasoning: 'Scroll down' },
          { currentCandidates: sampleCandidates, currentHintIndex: 0 }
        )).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
      });
    });
  });

  describe('detectIntermediateAction - Phase 2A Check', () => {
    describe('when flexible flag is enabled', () => {
      it('should treat scroll as intermediate when hint is click', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'scroll' },
          true
        );
        expect(result).toBe(true);
      });

      it('should treat scroll as intermediate when hint is type', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'type', targetText: 'email field' },
          { type: 'scroll' },
          true
        );
        expect(result).toBe(true);
      });

      it('should treat scroll as intermediate when hint is select', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'select', targetText: 'Option A' },
          { type: 'scroll' },
          true
        );
        expect(result).toBe(true);
      });

      it('should treat wait as intermediate when hint is click', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'wait' },
          true
        );
        expect(result).toBe(true);
      });

      it('should treat wait as intermediate when hint is type', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'type', targetText: 'Input field' },
          { type: 'wait' },
          true
        );
        expect(result).toBe(true);
      });

      it('should NOT treat scroll as intermediate when hint IS scroll', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'scroll', description: 'Scroll down the page' },
          { type: 'scroll' },
          true
        );
        // Should return null — the Phase 2A check does not apply when hint is scroll
        expect(result).toBeNull();
      });

      it('should NOT apply to click actions (not scroll/wait)', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'click' },
          true
        );
        expect(result).toBeNull();
      });

      it('should NOT apply to skip actions', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'skip' },
          true
        );
        expect(result).toBeNull();
      });

      it('should NOT apply to done actions', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'done' },
          true
        );
        expect(result).toBeNull();
      });
    });

    describe('when flexible flag is disabled', () => {
      it('should NOT treat scroll as intermediate even when hint is click', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'scroll' },
          false
        );
        expect(result).toBeNull();
      });

      it('should NOT treat wait as intermediate even when hint is click', () => {
        const result = phase2aIntermediateCheck(
          { actionType: 'click', targetText: 'Submit' },
          { type: 'wait' },
          false
        );
        expect(result).toBeNull();
      });
    });
  });

  describe('Prompt Construction', () => {
    // Simulates the prompt conditional from buildAgentPrompt
    function buildCandidatePromptSection(
      candidateCount: number,
      allowFlexible: boolean,
      _hintIndex: number
    ): string {
      if (candidateCount > 0) {
        if (allowFlexible) {
          return `🎯 ${candidateCount} CANDIDATES EXIST — Choose the BEST option:\n` +
            `Option A (PREFERRED): Pick a candidate\n` +
            `Option B: Scroll\n` +
            `Option C: Skip\n` +
            `Option D: Done\n` +
            `Option E: Wait\n` +
            `IMPORTANT: Option A (picking a candidate) is STRONGLY PREFERRED.`;
        } else {
          return `⛔⛔⛔ CRITICAL: ${candidateCount} CANDIDATES EXIST - YOU MUST USE chooseCandidateIndex ⛔⛔⛔`;
        }
      }
      return 'WHEN NO CANDIDATES (free-form target)';
    }

    it('should use rigid prompt when flexible=false and candidates exist', () => {
      const prompt = buildCandidatePromptSection(3, false, 0);
      expect(prompt).toContain('⛔');
      expect(prompt).toContain('MUST USE chooseCandidateIndex');
      expect(prompt).not.toContain('Option B');
    });

    it('should use flexible prompt when flexible=true and candidates exist', () => {
      const prompt = buildCandidatePromptSection(3, true, 0);
      expect(prompt).toContain('🎯');
      expect(prompt).toContain('Option A (PREFERRED)');
      expect(prompt).toContain('Option B: Scroll');
      expect(prompt).toContain('Option C: Skip');
      expect(prompt).toContain('Option D: Done');
      expect(prompt).toContain('Option E: Wait');
      expect(prompt).toContain('STRONGLY PREFERRED');
      expect(prompt).not.toContain('⛔');
    });

    it('should show no-candidates prompt when no candidates', () => {
      const prompt = buildCandidatePromptSection(0, true, 0);
      expect(prompt).toContain('WHEN NO CANDIDATES');
    });

    it('should show no-candidates prompt when no candidates and flexible=false', () => {
      const prompt = buildCandidatePromptSection(0, false, 0);
      expect(prompt).toContain('WHEN NO CANDIDATES');
    });

    it('should include candidate count in flexible prompt', () => {
      const prompt = buildCandidatePromptSection(5, true, 0);
      expect(prompt).toContain('5 CANDIDATES EXIST');
    });

    it('should include candidate count in rigid prompt', () => {
      const prompt = buildCandidatePromptSection(5, false, 0);
      expect(prompt).toContain('5 CANDIDATES EXIST');
    });
  });

  describe('Payload Construction', () => {
    it('should include allowFlexibleResponses=true when flag is enabled', () => {
      // Simulate what think() does
      const payload = {
        mode: 'dom',
        goal: 'Fill out form',
        allowFlexibleResponses: isFeatureEnabled('INTELLIGENT_AGENT_FLEXIBLE'),
      };

      expect(payload.allowFlexibleResponses).toBe(true);
    });

    it('should serialize allowFlexibleResponses correctly in JSON', () => {
      const payload = {
        mode: 'dom',
        goal: 'Fill out form',
        allowFlexibleResponses: true,
        currentCandidates: sampleCandidates,
      };

      const serialized = JSON.stringify(payload);
      const parsed = JSON.parse(serialized);

      expect(parsed.allowFlexibleResponses).toBe(true);
      expect(parsed.currentCandidates).toHaveLength(3);
    });
  });

  describe('End-to-End Scenarios', () => {
    it('Scenario: Element off-screen — LLM returns scroll', () => {
      // LLM sees candidates but none match the target (it is off-screen)
      const llmResponse = {
        action: 'scroll',
        direction: 'down',
        amount: 300,
        reasoning: 'Target element "Save Draft" not visible among candidates, scrolling to reveal it',
        confidence: 0.7,
        hintStepIndex: 2,
      };

      // Parser should allow this
      const result = simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 2,
      });
      expect(result.action).toBe('scroll');

      // Intermediate check should mark it as intermediate
      const isIntermediate = phase2aIntermediateCheck(
        { actionType: 'click', targetText: 'Save Draft' },
        { type: 'scroll' },
        true
      );
      expect(isIntermediate).toBe(true);
    });

    it('Scenario: Hint already satisfied — LLM returns skip', () => {
      const llmResponse = {
        action: 'skip',
        reason: 'The input already contains the required value "test@example.com"',
        reasoning: 'Hint goal already achieved',
        confidence: 0.9,
        hintStepIndex: 1,
      };

      const result = simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 1,
      });
      expect(result.action).toBe('skip');
    });

    it('Scenario: Workflow goal achieved early — LLM returns done', () => {
      const llmResponse = {
        action: 'done',
        reason: 'Success page is visible, workflow goal achieved',
        reasoning: 'Goal complete',
        confidence: 0.95,
        hintStepIndex: 3,
      };

      const result = simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 3,
      });
      expect(result.action).toBe('done');
    });

    it('Scenario: Page loading — LLM returns wait', () => {
      const llmResponse = {
        action: 'wait',
        duration: 2000,
        reasoning: 'Page content is still loading, spinner visible',
        confidence: 0.7,
        hintStepIndex: 0,
      };

      const result = simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 0,
      });
      expect(result.action).toBe('wait');

      // Intermediate check should mark wait as intermediate
      const isIntermediate = phase2aIntermediateCheck(
        { actionType: 'click', targetText: 'Submit' },
        { type: 'wait' },
        true
      );
      expect(isIntermediate).toBe(true);
    });

    it('Scenario: Normal case — LLM picks candidate (preferred)', () => {
      const llmResponse = {
        chooseCandidateIndex: 0,
        action: 'click',
        reasoning: 'Candidate 0 matches the Submit button in the Main Form',
        confidence: 0.95,
        hintStepIndex: 0,
      };

      const result = simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: true,
        currentHintIndex: 0,
      });
      expect(result.action).toBe('click');
      expect(result.target?.name).toBe('Submit');
      expect(result.target?.widgetTitle).toBe('Main Form');
    });

    it('Scenario: Flag off — flexible actions rejected even if LLM tries them', () => {
      const llmResponse = {
        action: 'scroll',
        direction: 'down',
        reasoning: 'Need to scroll',
        confidence: 0.7,
        hintStepIndex: 0,
      };

      expect(() => simulateParseCandiateEnforcement(llmResponse, {
        currentCandidates: sampleCandidates,
        allowFlexibleResponses: false,
        currentHintIndex: 0,
      })).toThrow('LLM must return chooseCandidateIndex when candidates are provided');
    });
  });
});
