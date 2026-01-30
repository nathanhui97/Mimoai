/**
 * Tests for Phase 2B: Intelligent Agent - Goal-Oriented Prompting
 *
 * These tests verify that:
 * 1. INTELLIGENT_AGENT_GOAL feature flag exists and is disabled by default
 * 2. System framing changes when goalOriented=true
 * 3. Steps header changes to "GUIDANCE" when goalOriented=true
 * 4. Current focus changes to "SUGGESTED NEXT STEP" with goal-oriented reasoning
 * 5. Candidates section uses goal-first framework when goalOriented+flexible
 * 6. Your Task section includes reasoning protocol when goalOriented=true
 * 7. goalOriented field is correctly passed in the payload
 * 8. End-to-end scenarios work with goal-oriented reasoning
 */

import { describe, it, expect } from 'vitest';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';

// ============================================================================
// Prompt Section Simulators
// ============================================================================
// We replicate the conditional logic from buildAgentPrompt to unit-test
// each section without needing a Deno runtime.

/**
 * Simulates the system framing section (lines ~727-731 equivalent).
 */
function buildSystemFraming(goalOriented: boolean): string {
  if (goalOriented) {
    return `You are a GOAL-ORIENTED AI agent that automates web tasks. Your primary objective is to ACHIEVE THE GOAL, not to follow hints literally.

Hints are GUIDANCE from a previous recording run — they suggest a path, but the current page state may differ.

DECISION FRAMEWORK:
1. **Goal First**: What is the overall goal? What sub-goal does this step serve?
2. **Page State**: What does the current page actually show? What's already done?
3. **Hints as Guidance**: Do the hints suggest a useful next action? Or is there a better path?
4. **Adapt**: If the page has changed, skip irrelevant hints and find the best action to advance the goal.

IMPORTANT: You must output semantic targets (role, name, text) - NOT pixel coordinates. The executor will use DOM-based element resolution.`;
  }
  return `You are an AI agent that automates web tasks. You analyze the current page state and decide what action to take next.

IMPORTANT: You must output semantic targets (role, name, text) - NOT pixel coordinates. The executor will use DOM-based element resolution.`;
}

/**
 * Simulates the steps header section.
 */
function buildStepsHeader(goalOriented: boolean): string {
  if (goalOriented) {
    return `## Recorded Steps (GUIDANCE — not strict orders)
Use these as a roadmap, but ADAPT based on current page state. Skip steps whose outcomes are already achieved.`;
  }
  return `## Steps to Complete`;
}

/**
 * Simulates the current focus label.
 */
function buildCurrentFocusLabel(goalOriented: boolean, stepNumber: number): string {
  if (goalOriented) {
    return `🎯 SUGGESTED NEXT STEP: Step ${stepNumber}`;
  }
  return `⭐ WORK ON THIS NEXT: Step ${stepNumber}`;
}

/**
 * Simulates the reasoning preamble in current focus section.
 */
function buildReasoningPreamble(
  goalOriented: boolean,
  goal: string,
  expectedOutcome: string
): string {
  if (goalOriented) {
    return `GOAL-ORIENTED REASONING (REQUIRED):
     1. GOAL CHECK: Does this step advance the overall goal "${goal}"?
     2. OUTCOME CHECK: Is the expected outcome "${expectedOutcome}" already visible on the page?
     3. BETTER PATH: Is there a more direct way to achieve the goal from the current page state?

     → If outcome is already achieved → return "skip" with goal-based reasoning
     → If overall goal is achieved (even with hints remaining) → return "done"
     → If this step advances the goal → execute it`;
  }
  return `BEFORE ACTING - CHECK IF OUTCOME ALREADY ACHIEVED:
     1. Check if the expected outcome "${expectedOutcome}" is already true`;
}

/**
 * Simulates the candidates instruction section (extracted helper).
 */
function buildCandidatesInstruction(
  candidateCount: number,
  _currentHintIndex: number,
  allowFlexibleResponses: boolean,
  goalOriented: boolean
): string {
  if (candidateCount === 0) {
    return '';
  }

  if (goalOriented && allowFlexibleResponses) {
    return `🎯 ${candidateCount} CANDIDATES EXIST — THINK STEP BY STEP:

1. What is the current SUB-GOAL for this step?
2. Is the sub-goal already achieved on the page? → return "done" or "skip"
3. Does a candidate match what's needed to advance the sub-goal? → pick it
4. Is the target element possibly off-screen? → return "scroll"
5. Is the page still loading? → return "wait"

REQUIRED: Always prefix your "reasoning" with "Goal: <sub-goal>." to explain what you're trying to achieve.
Choose the action that BEST advances the goal — there is no preferred option.`;
  }

  if (allowFlexibleResponses) {
    return `Option A (PREFERRED): Pick a candidate
Option B: Scroll
Option C: Skip
Option D: Done
Option E: Wait
IMPORTANT: Option A (picking a candidate) is STRONGLY PREFERRED.`;
  }

  return `⛔⛔⛔ CRITICAL: ${candidateCount} CANDIDATES EXIST - YOU MUST USE chooseCandidateIndex ⛔⛔⛔
THE "target" FIELD IS FORBIDDEN WHEN CANDIDATES EXIST. DO NOT INCLUDE IT.`;
}

/**
 * Simulates the "Your Task" opening section.
 */
function buildYourTaskSection(goalOriented: boolean, _goal: string): string {
  if (goalOriented) {
    return `Analyze the page and decide the next action to ADVANCE THE GOAL. Use the DOM map and recorded steps as guidance.

🧠 REASONING PROTOCOL (REQUIRED):
Before choosing an action, state your reasoning:
1. CURRENT SUB-GOAL: What am I trying to achieve in this step?
2. ACHIEVEMENT CHECK: Is this sub-goal already achieved on the page?
3. BEST ACTION: What action best advances the goal from the current state?
4. WHY: Why is this the right action? (reference page state, not just hints)`;
  }
  return `Analyze the page and decide the next action. Look at the DOM map to find the element you need to interact with.`;
}

/**
 * Simulates the priority item 4 section.
 */
function buildPriorityItem4(goalOriented: boolean, goal: string): string {
  if (goalOriented) {
    return `GOAL-ORIENTED: Every action must advance the goal "${goal}"
   - Return "done" if the overall goal is visibly achieved, even if recorded steps remain
   - Skip hints whose outcomes are already satisfied
   - Adapt to current page state — hints are guidance, not strict orders
   - If a more direct path to the goal exists, take it`;
  }
  return `ADAPTIVE: The hints are a GUIDE, not strict commands
   - Skip hints that reference elements that don't exist
   - Skip TYPE hints ONLY if field value exactly matches the target value
   - Adapt to current page state, don't blindly follow hint order`;
}


// ============================================================================
// Tests
// ============================================================================

describe('Phase 2B: Goal-Oriented Prompting', () => {
  // --------------------------------------------------------------------------
  // Feature Flag Tests
  // --------------------------------------------------------------------------
  describe('Feature Flag', () => {
    it('should have INTELLIGENT_AGENT_GOAL defined in FeatureFlags', () => {
      expect('INTELLIGENT_AGENT_GOAL' in FeatureFlags).toBe(true);
    });

    it('should have INTELLIGENT_AGENT_GOAL disabled by default', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_GOAL).toBe(false);
    });

    it('isFeatureEnabled should return false for INTELLIGENT_AGENT_GOAL', () => {
      expect(isFeatureEnabled('INTELLIGENT_AGENT_GOAL')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // System Framing Tests
  // --------------------------------------------------------------------------
  describe('System Framing', () => {
    it('should use GOAL-ORIENTED framing when goalOriented=true', () => {
      const framing = buildSystemFraming(true);
      expect(framing).toContain('GOAL-ORIENTED AI agent');
      expect(framing).toContain('ACHIEVE THE GOAL');
      expect(framing).toContain('Hints are GUIDANCE');
    });

    it('should include decision framework when goalOriented=true', () => {
      const framing = buildSystemFraming(true);
      expect(framing).toContain('DECISION FRAMEWORK');
      expect(framing).toContain('Goal First');
      expect(framing).toContain('Page State');
      expect(framing).toContain('Hints as Guidance');
      expect(framing).toContain('Adapt');
    });

    it('should use original framing when goalOriented=false', () => {
      const framing = buildSystemFraming(false);
      expect(framing).toContain('You are an AI agent that automates web tasks');
      expect(framing).not.toContain('GOAL-ORIENTED');
      expect(framing).not.toContain('DECISION FRAMEWORK');
      expect(framing).not.toContain('Hints are GUIDANCE');
    });

    it('should always include semantic target instruction', () => {
      const framingOn = buildSystemFraming(true);
      const framingOff = buildSystemFraming(false);
      expect(framingOn).toContain('semantic targets');
      expect(framingOff).toContain('semantic targets');
    });
  });

  // --------------------------------------------------------------------------
  // Steps Header Tests
  // --------------------------------------------------------------------------
  describe('Steps Header', () => {
    it('should use "Recorded Steps (GUIDANCE)" when goalOriented=true', () => {
      const header = buildStepsHeader(true);
      expect(header).toContain('Recorded Steps (GUIDANCE');
      expect(header).toContain('not strict orders');
      expect(header).toContain('ADAPT');
    });

    it('should use "Steps to Complete" when goalOriented=false', () => {
      const header = buildStepsHeader(false);
      expect(header).toBe('## Steps to Complete');
      expect(header).not.toContain('GUIDANCE');
      expect(header).not.toContain('ADAPT');
    });
  });

  // --------------------------------------------------------------------------
  // Current Focus Tests
  // --------------------------------------------------------------------------
  describe('Current Focus', () => {
    it('should show "SUGGESTED NEXT STEP" when goalOriented=true', () => {
      const label = buildCurrentFocusLabel(true, 3);
      expect(label).toContain('🎯 SUGGESTED NEXT STEP');
      expect(label).toContain('Step 3');
      expect(label).not.toContain('WORK ON THIS NEXT');
    });

    it('should show "WORK ON THIS NEXT" when goalOriented=false', () => {
      const label = buildCurrentFocusLabel(false, 3);
      expect(label).toContain('⭐ WORK ON THIS NEXT');
      expect(label).toContain('Step 3');
      expect(label).not.toContain('SUGGESTED NEXT STEP');
    });

    it('should include GOAL-ORIENTED REASONING when goalOriented=true', () => {
      const preamble = buildReasoningPreamble(true, 'Fill out form', 'Form submitted');
      expect(preamble).toContain('GOAL-ORIENTED REASONING (REQUIRED)');
      expect(preamble).toContain('GOAL CHECK');
      expect(preamble).toContain('OUTCOME CHECK');
      expect(preamble).toContain('BETTER PATH');
    });

    it('should include goal in GOAL CHECK', () => {
      const preamble = buildReasoningPreamble(true, 'Submit order', 'Order confirmed');
      expect(preamble).toContain('advance the overall goal "Submit order"');
    });

    it('should include expected outcome in OUTCOME CHECK', () => {
      const preamble = buildReasoningPreamble(true, 'Submit order', 'Order confirmed');
      expect(preamble).toContain('"Order confirmed" already visible');
    });

    it('should include skip/done/execute decision rules', () => {
      const preamble = buildReasoningPreamble(true, 'Goal', 'Outcome');
      expect(preamble).toContain('return "skip"');
      expect(preamble).toContain('return "done"');
      expect(preamble).toContain('execute it');
    });

    it('should use BEFORE ACTING checklist when goalOriented=false', () => {
      const preamble = buildReasoningPreamble(false, 'Goal', 'Outcome');
      expect(preamble).toContain('BEFORE ACTING - CHECK IF OUTCOME ALREADY ACHIEVED');
      expect(preamble).not.toContain('GOAL-ORIENTED REASONING');
      expect(preamble).not.toContain('GOAL CHECK');
      expect(preamble).not.toContain('BETTER PATH');
    });
  });

  // --------------------------------------------------------------------------
  // Candidates Section Tests
  // --------------------------------------------------------------------------
  describe('Candidates Section', () => {
    it('should return empty string when no candidates', () => {
      const result = buildCandidatesInstruction(0, 0, true, true);
      expect(result).toBe('');
    });

    it('should use goal-first framework when goalOriented=true AND flexible=true', () => {
      const result = buildCandidatesInstruction(3, 0, true, true);
      expect(result).toContain('THINK STEP BY STEP');
      expect(result).toContain('SUB-GOAL');
      expect(result).toContain('Goal: <sub-goal>');
      expect(result).not.toContain('Option A (PREFERRED)');
      expect(result).not.toContain('STRONGLY PREFERRED');
    });

    it('should require goal-framed reasoning when goalOriented=true', () => {
      const result = buildCandidatesInstruction(3, 0, true, true);
      expect(result).toContain('Always prefix your "reasoning" with "Goal:');
    });

    it('should not bias toward picking candidates when goalOriented=true', () => {
      const result = buildCandidatesInstruction(3, 0, true, true);
      expect(result).toContain('no preferred option');
      expect(result).not.toContain('STRONGLY PREFERRED');
      expect(result).not.toContain('PREFERRED');
    });

    it('should use Phase 2A flexible prompt when goalOriented=false AND flexible=true', () => {
      const result = buildCandidatesInstruction(3, 0, true, false);
      expect(result).toContain('Option A (PREFERRED)');
      expect(result).toContain('Option B: Scroll');
      expect(result).toContain('STRONGLY PREFERRED');
      expect(result).not.toContain('THINK STEP BY STEP');
    });

    it('should use rigid prompt when flexible=false (regardless of goalOriented)', () => {
      const resultGoalOn = buildCandidatesInstruction(3, 0, false, true);
      const resultGoalOff = buildCandidatesInstruction(3, 0, false, false);
      expect(resultGoalOn).toContain('⛔');
      expect(resultGoalOn).toContain('MUST USE chooseCandidateIndex');
      expect(resultGoalOff).toContain('⛔');
      expect(resultGoalOff).toContain('MUST USE chooseCandidateIndex');
    });

    it('should include candidate count in goal-oriented prompt', () => {
      const result = buildCandidatesInstruction(5, 0, true, true);
      expect(result).toContain('5 CANDIDATES EXIST');
    });

    it('should list all decision paths in goal-oriented prompt', () => {
      const result = buildCandidatesInstruction(3, 0, true, true);
      expect(result).toContain('"done"');
      expect(result).toContain('"skip"');
      expect(result).toContain('"scroll"');
      expect(result).toContain('"wait"');
    });
  });

  // --------------------------------------------------------------------------
  // Your Task Section Tests
  // --------------------------------------------------------------------------
  describe('Your Task Section', () => {
    it('should include reasoning protocol when goalOriented=true', () => {
      const task = buildYourTaskSection(true, 'Submit form');
      expect(task).toContain('REASONING PROTOCOL (REQUIRED)');
      expect(task).toContain('CURRENT SUB-GOAL');
      expect(task).toContain('ACHIEVEMENT CHECK');
      expect(task).toContain('BEST ACTION');
      expect(task).toContain('WHY');
    });

    it('should reference ADVANCE THE GOAL when goalOriented=true', () => {
      const task = buildYourTaskSection(true, 'Submit form');
      expect(task).toContain('ADVANCE THE GOAL');
    });

    it('should use original task description when goalOriented=false', () => {
      const task = buildYourTaskSection(false, 'Submit form');
      expect(task).toContain('Analyze the page and decide the next action');
      expect(task).not.toContain('REASONING PROTOCOL');
      expect(task).not.toContain('ADVANCE THE GOAL');
    });

    it('should include GOAL-ORIENTED priority when goalOriented=true', () => {
      const priority = buildPriorityItem4(true, 'Complete checkout');
      expect(priority).toContain('GOAL-ORIENTED');
      expect(priority).toContain('advance the goal "Complete checkout"');
      expect(priority).toContain('Return "done" if the overall goal is visibly achieved');
      expect(priority).toContain('even if recorded steps remain');
    });

    it('should include ADAPTIVE priority when goalOriented=false', () => {
      const priority = buildPriorityItem4(false, 'Complete checkout');
      expect(priority).toContain('ADAPTIVE');
      expect(priority).toContain('hints are a GUIDE');
      expect(priority).not.toContain('GOAL-ORIENTED');
      expect(priority).not.toContain('advance the goal');
    });

    it('should mention direct path option when goalOriented=true', () => {
      const priority = buildPriorityItem4(true, 'Goal');
      expect(priority).toContain('more direct path');
    });
  });

  // --------------------------------------------------------------------------
  // Payload Construction Tests
  // --------------------------------------------------------------------------
  describe('Payload Construction', () => {
    it('should include goalOriented=false when flag is disabled', () => {
      const payload = {
        mode: 'dom',
        goal: 'Fill out form',
        goalOriented: isFeatureEnabled('INTELLIGENT_AGENT_GOAL'),
      };
      expect(payload.goalOriented).toBe(false);
    });

    it('should serialize goalOriented correctly in JSON', () => {
      const payload = {
        mode: 'dom',
        goal: 'Fill out form',
        goalOriented: true,
        allowFlexibleResponses: true,
      };

      const serialized = JSON.stringify(payload);
      const parsed = JSON.parse(serialized);

      expect(parsed.goalOriented).toBe(true);
      expect(parsed.allowFlexibleResponses).toBe(true);
    });

    it('should handle goalOriented=undefined gracefully', () => {
      const payload: { goalOriented?: boolean } = {};
      // When undefined, should be treated as false
      const isGoalOriented = payload.goalOriented === true;
      expect(isGoalOriented).toBe(false);
    });

    it('should pass both goalOriented and allowFlexibleResponses independently', () => {
      // goalOriented=true but flexible=false — goal-oriented framing but rigid candidates
      const payload1 = { goalOriented: true, allowFlexibleResponses: false };
      expect(payload1.goalOriented).toBe(true);
      expect(payload1.allowFlexibleResponses).toBe(false);

      // goalOriented=false but flexible=true — Phase 2A behavior
      const payload2 = { goalOriented: false, allowFlexibleResponses: true };
      expect(payload2.goalOriented).toBe(false);
      expect(payload2.allowFlexibleResponses).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // End-to-End Scenarios
  // --------------------------------------------------------------------------
  describe('End-to-End Scenarios', () => {
    it('Scenario: Skip with goal-oriented reasoning', () => {
      // When goalOriented=true, skip reasoning should reference the goal
      const label = buildCurrentFocusLabel(true, 2);
      const preamble = buildReasoningPreamble(true, 'Submit purchase order', 'Amount field shows 1000');
      const candidates = buildCandidatesInstruction(3, 1, true, true);

      expect(label).toContain('SUGGESTED NEXT STEP');
      expect(preamble).toContain('GOAL CHECK');
      expect(preamble).toContain('Submit purchase order');
      expect(candidates).toContain('Goal: <sub-goal>');
    });

    it('Scenario: Done early because overall goal achieved', () => {
      // Goal-oriented agent should be told it can return done even with remaining hints
      const priority = buildPriorityItem4(true, 'Create new user account');
      const preamble = buildReasoningPreamble(true, 'Create new user account', 'Confirmation page visible');

      expect(priority).toContain('Return "done" if the overall goal is visibly achieved, even if recorded steps remain');
      expect(preamble).toContain('overall goal is achieved (even with hints remaining) → return "done"');
    });

    it('Scenario: Candidate selection with goal reasoning', () => {
      // Goal-oriented candidates section should ask for goal-framed reasoning
      const candidates = buildCandidatesInstruction(5, 3, true, true);

      expect(candidates).toContain('THINK STEP BY STEP');
      expect(candidates).toContain('SUB-GOAL');
      expect(candidates).toContain('Goal: <sub-goal>');
      expect(candidates).not.toContain('STRONGLY PREFERRED');
    });

    it('Scenario: Hint deviation — better path exists', () => {
      // Priority 4 should tell the agent to take a more direct path
      const priority = buildPriorityItem4(true, 'Navigate to settings');

      expect(priority).toContain('more direct path to the goal exists, take it');
      expect(priority).toContain('hints are guidance, not strict orders');
    });

    it('Scenario: Backward compatibility — flag off means no changes', () => {
      // Everything should use original text when goalOriented=false
      const framing = buildSystemFraming(false);
      const header = buildStepsHeader(false);
      const label = buildCurrentFocusLabel(false, 1);
      const preamble = buildReasoningPreamble(false, 'Goal', 'Outcome');
      const candidates = buildCandidatesInstruction(3, 0, true, false);
      const task = buildYourTaskSection(false, 'Goal');
      const priority = buildPriorityItem4(false, 'Goal');

      // None should contain goal-oriented markers
      expect(framing).not.toContain('GOAL-ORIENTED');
      expect(header).not.toContain('GUIDANCE');
      expect(label).not.toContain('SUGGESTED NEXT STEP');
      expect(preamble).not.toContain('GOAL-ORIENTED REASONING');
      expect(candidates).not.toContain('THINK STEP BY STEP');
      expect(task).not.toContain('REASONING PROTOCOL');
      expect(priority).not.toContain('GOAL-ORIENTED');
    });

    it('Scenario: goalOriented=true but flexible=false — framing changes but candidates rigid', () => {
      // System framing, steps header, current focus, your task should change
      // But candidates section stays rigid
      const framing = buildSystemFraming(true);
      const header = buildStepsHeader(true);
      const label = buildCurrentFocusLabel(true, 1);
      const candidates = buildCandidatesInstruction(3, 0, false, true);
      const priority = buildPriorityItem4(true, 'Goal');

      expect(framing).toContain('GOAL-ORIENTED');
      expect(header).toContain('GUIDANCE');
      expect(label).toContain('SUGGESTED NEXT STEP');
      expect(candidates).toContain('⛔');
      expect(candidates).toContain('MUST USE chooseCandidateIndex');
      expect(priority).toContain('GOAL-ORIENTED');
    });

    it('Scenario: All flags enabled together', () => {
      // goalOriented=true + flexible=true = full goal-oriented experience
      const framing = buildSystemFraming(true);
      const header = buildStepsHeader(true);
      const label = buildCurrentFocusLabel(true, 5);
      const preamble = buildReasoningPreamble(true, 'Complete checkout', 'Payment confirmed');
      const candidates = buildCandidatesInstruction(4, 4, true, true);
      const task = buildYourTaskSection(true, 'Complete checkout');
      const priority = buildPriorityItem4(true, 'Complete checkout');

      expect(framing).toContain('GOAL-ORIENTED AI agent');
      expect(header).toContain('Recorded Steps (GUIDANCE');
      expect(label).toContain('🎯 SUGGESTED NEXT STEP: Step 5');
      expect(preamble).toContain('GOAL-ORIENTED REASONING (REQUIRED)');
      expect(candidates).toContain('THINK STEP BY STEP');
      expect(candidates).toContain('no preferred option');
      expect(task).toContain('REASONING PROTOCOL (REQUIRED)');
      expect(priority).toContain('GOAL-ORIENTED');
      expect(priority).toContain('Complete checkout');
    });
  });
});
