/**
 * Tests for Phase 2C: Intelligent Agent - Goal Verification & Early Completion
 *
 * These tests verify that:
 * 1. INTELLIGENT_AGENT_VERIFY feature flag exists and is enabled
 * 2. checkGoalProgress returns false when no analyzedIntent
 * 3. checkGoalProgress returns false when < 30% steps done (too early guard)
 * 4. checkGoalProgress returns true when expectedOutcome text found in body
 * 5. checkGoalProgress returns true when URL matches success pattern
 * 6. checkGoalProgress returns true when visualConfirmation found
 * 7. checkGoalProgress returns false when outcome text not on page
 * 8. skipRemainingHints marks all incomplete hints as skipped
 * 9. Early completion triggers when confidence >= 0.8
 * 10. Backward compatibility — flag off = no early completion checks
 */

import { describe, it, expect } from 'vitest';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';

// ============================================================================
// Type definitions (mirror the relevant parts of AgentHint / AgentState)
// ============================================================================

interface MockHint {
  stepNumber: number;
  description: string;
  completed: boolean;
  skipped?: boolean;
}

interface MockAnalyzedIntent {
  primaryGoal: string;
  expectedOutcome: string;
  visualConfirmation?: string;
  confidence: number;
}

// ============================================================================
// Logic Simulators
// ============================================================================
// We replicate the conditional logic from ai-agent.ts to unit-test each
// scenario without needing the full agent runtime or DOM.

/**
 * Simulates checkGoalProgress() from ai-agent.ts.
 *
 * @param analyzedIntent  The analyzed workflow intent (may be undefined)
 * @param hints           Array of hint step objects
 * @param bodyText        Simulated document.body.innerText
 * @param currentUrl      Simulated window.location.href
 */
function checkGoalProgress(
  analyzedIntent: MockAnalyzedIntent | undefined,
  hints: MockHint[],
  bodyText: string,
  currentUrl: string
): { goalAchieved: boolean; reason: string; confidence: number } {
  // Guard: need analyzedIntent with expectedOutcome
  if (!analyzedIntent?.expectedOutcome) {
    return { goalAchieved: false, reason: 'No expectedOutcome defined', confidence: 0 };
  }

  // Guard: too early — skip check if less than 30 % of steps done
  const completedCount = hints.filter(h => h.completed || h.skipped).length;
  const totalCount = hints.length;
  if (totalCount === 0 || completedCount / totalCount < 0.3) {
    return { goalAchieved: false, reason: 'Too early to check goal', confidence: 0 };
  }

  const expectedOutcome = analyzedIntent.expectedOutcome.toLowerCase();
  const url = currentUrl.toLowerCase();
  const body = bodyText.toLowerCase();

  // --- URL-based checks ---
  if (expectedOutcome.includes('confirmation') && url.includes('confirm')) {
    return { goalAchieved: true, reason: 'URL indicates confirmation page', confidence: 0.9 };
  }
  if (expectedOutcome.includes('success') && url.includes('success')) {
    return { goalAchieved: true, reason: 'URL indicates success page', confidence: 0.9 };
  }
  if (expectedOutcome.includes('thank you') && (url.includes('thankyou') || url.includes('thank-you'))) {
    return { goalAchieved: true, reason: 'URL indicates thank you page', confidence: 0.9 };
  }

  // --- Body-text keyword checks ---
  const successIndicators = ['success', 'confirmed', 'complete', 'saved', 'submitted', 'thank you'];
  for (const indicator of successIndicators) {
    if (expectedOutcome.includes(indicator) && body.includes(indicator)) {
      return { goalAchieved: true, reason: `Found "${indicator}" on page`, confidence: 0.85 };
    }
  }

  // --- Visual confirmation checks ---
  if (analyzedIntent.visualConfirmation) {
    const visualConfirmation = analyzedIntent.visualConfirmation.toLowerCase();
    const visualIndicators = visualConfirmation.split(/,|\sand\s/).map(s => s.trim());
    for (const indicator of visualIndicators) {
      if (indicator && body.includes(indicator)) {
        return { goalAchieved: true, reason: `Found visual confirmation: "${indicator}"`, confidence: 0.85 };
      }
    }
  }

  return { goalAchieved: false, reason: 'Goal not yet achieved', confidence: 0 };
}

/**
 * Simulates skipRemainingHints() from ai-agent.ts.
 */
function skipRemainingHints(hints: MockHint[]): MockHint[] {
  return hints.map(h => {
    if (!h.completed && !h.skipped) {
      return { ...h, skipped: true };
    }
    return { ...h };
  });
}

/**
 * Simulates checkAndHandleEarlyCompletion() from ai-agent.ts.
 *
 * @param featureEnabled  Whether INTELLIGENT_AGENT_VERIFY is on
 * @param goalCheck       Result from checkGoalProgress
 */
function checkAndHandleEarlyCompletion(
  featureEnabled: boolean,
  goalCheck: { goalAchieved: boolean; reason: string; confidence: number }
): boolean {
  if (!featureEnabled) {
    return false;
  }
  if (goalCheck.goalAchieved && goalCheck.confidence >= 0.8) {
    return true;
  }
  return false;
}

// ============================================================================
// Helper to build hints quickly
// ============================================================================

function makeHints(total: number, completedCount: number): MockHint[] {
  return Array.from({ length: total }, (_, i) => ({
    stepNumber: i,
    description: `Step ${i}`,
    completed: i < completedCount,
    skipped: false,
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 2C: Goal Verification & Early Completion', () => {
  // --------------------------------------------------------------------------
  // Feature Flag Tests
  // --------------------------------------------------------------------------
  describe('Feature Flag', () => {
    it('should have INTELLIGENT_AGENT_VERIFY defined in FeatureFlags', () => {
      expect('INTELLIGENT_AGENT_VERIFY' in FeatureFlags).toBe(true);
    });

    it('should have INTELLIGENT_AGENT_VERIFY enabled', () => {
      expect(FeatureFlags.INTELLIGENT_AGENT_VERIFY).toBe(true);
    });

    it('isFeatureEnabled should return true for INTELLIGENT_AGENT_VERIFY', () => {
      expect(isFeatureEnabled('INTELLIGENT_AGENT_VERIFY')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkGoalProgress — Guard clauses
  // --------------------------------------------------------------------------
  describe('checkGoalProgress — guards', () => {
    it('should return false when no analyzedIntent', () => {
      const result = checkGoalProgress(undefined, makeHints(10, 5), '', 'http://localhost');
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('No expectedOutcome defined');
      expect(result.confidence).toBe(0);
    });

    it('should return false when expectedOutcome is empty string', () => {
      const intent: MockAnalyzedIntent = { primaryGoal: 'Test', expectedOutcome: '', confidence: 0.8 };
      const result = checkGoalProgress(intent, makeHints(10, 5), '', 'http://localhost');
      // Empty string is falsy
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('No expectedOutcome defined');
    });

    it('should return false when < 30% steps done (too early)', () => {
      // 2 out of 10 = 20%
      const intent: MockAnalyzedIntent = { primaryGoal: 'Submit form', expectedOutcome: 'Form submitted', confidence: 0.9 };
      const result = checkGoalProgress(intent, makeHints(10, 2), 'Form submitted', 'http://localhost');
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('Too early to check goal');
      expect(result.confidence).toBe(0);
    });

    it('should return false when exactly 29% steps done', () => {
      // For a workflow of 100 steps, 29 completed = 29%
      const intent: MockAnalyzedIntent = { primaryGoal: 'Submit', expectedOutcome: 'success', confidence: 0.9 };
      const hints = makeHints(100, 29);
      const result = checkGoalProgress(intent, hints, 'success message', 'http://localhost');
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('Too early to check goal');
    });

    it('should proceed with check when exactly 30% steps done', () => {
      // For a workflow of 10 steps, 3 completed = 30%
      const intent: MockAnalyzedIntent = { primaryGoal: 'Submit', expectedOutcome: 'success', confidence: 0.9 };
      const hints = makeHints(10, 3);
      const result = checkGoalProgress(intent, hints, 'success message', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('success');
    });

    it('should return false when hints array is empty', () => {
      const intent: MockAnalyzedIntent = { primaryGoal: 'Submit', expectedOutcome: 'success', confidence: 0.9 };
      const result = checkGoalProgress(intent, [], 'success', 'http://localhost');
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('Too early to check goal');
    });
  });

  // --------------------------------------------------------------------------
  // checkGoalProgress — URL matching
  // --------------------------------------------------------------------------
  describe('checkGoalProgress — URL matching', () => {
    const intent = (outcome: string): MockAnalyzedIntent => ({
      primaryGoal: 'Test',
      expectedOutcome: outcome,
      confidence: 0.9,
    });
    const hints = makeHints(10, 5); // 50% done

    it('should detect confirmation URL', () => {
      const result = checkGoalProgress(intent('Order confirmation'), hints, '', 'https://shop.com/confirm-order');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toBe('URL indicates confirmation page');
      expect(result.confidence).toBe(0.9);
    });

    it('should detect success URL', () => {
      const result = checkGoalProgress(intent('Registration success'), hints, '', 'https://app.com/success');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toBe('URL indicates success page');
      expect(result.confidence).toBe(0.9);
    });

    it('should detect thank you URL (thankyou)', () => {
      const result = checkGoalProgress(intent('See thank you page'), hints, '', 'https://forms.com/thankyou');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toBe('URL indicates thank you page');
      expect(result.confidence).toBe(0.9);
    });

    it('should detect thank you URL (thank-you)', () => {
      const result = checkGoalProgress(intent('See thank you page'), hints, '', 'https://forms.com/thank-you');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toBe('URL indicates thank you page');
      expect(result.confidence).toBe(0.9);
    });

    it('should be case-insensitive for URL checks', () => {
      const result = checkGoalProgress(intent('See CONFIRMATION page'), hints, '', 'https://shop.com/CONFIRM-page');
      expect(result.goalAchieved).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkGoalProgress — Body text matching
  // --------------------------------------------------------------------------
  describe('checkGoalProgress — body text matching', () => {
    const hints = makeHints(10, 5); // 50% done

    it('should find "submitted" in body text', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Submit form',
        expectedOutcome: 'Form submitted successfully',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Your form has been submitted. Thank you.', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('submitted');
      expect(result.confidence).toBe(0.85);
    });

    it('should find "saved" in body text', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Save settings',
        expectedOutcome: 'Settings saved',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Settings saved successfully', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('saved');
    });

    it('should find "complete" in body text', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Finish checkout',
        expectedOutcome: 'Order complete',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Your order is complete!', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('complete');
    });

    it('should return false when outcome text NOT on page', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Submit form',
        expectedOutcome: 'Form submitted successfully',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Please fill in all fields before proceeding.', 'http://localhost/form');
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('Goal not yet achieved');
      expect(result.confidence).toBe(0);
    });

    it('should be case-insensitive for body text checks', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Submit',
        expectedOutcome: 'CONFIRMED',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Your action has been Confirmed.', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkGoalProgress — Visual confirmation matching
  // --------------------------------------------------------------------------
  describe('checkGoalProgress — visual confirmation', () => {
    const hints = makeHints(10, 5); // 50% done

    it('should detect visual confirmation text in body', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Create user',
        expectedOutcome: 'User profile page loads',
        visualConfirmation: 'green checkmark, welcome banner',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Welcome! Here is your welcome banner and profile.', 'http://localhost/profile');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('visual confirmation');
      expect(result.reason).toContain('welcome banner');
      expect(result.confidence).toBe(0.85);
    });

    it('should split visual confirmation on comma', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Checkout',
        expectedOutcome: 'Order placed',
        visualConfirmation: 'order number,receipt',
        confidence: 0.9,
      };
      // Only "receipt" is on the page
      const result = checkGoalProgress(intent, hints, 'Here is your receipt for the purchase.', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('receipt');
    });

    it('should split visual confirmation on "and"', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Save',
        expectedOutcome: 'Data persisted',
        visualConfirmation: 'toast notification and saved badge',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Changes applied. Saved badge visible.', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
      expect(result.reason).toContain('saved badge');
    });

    it('should return false when visual confirmation not found', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Checkout',
        expectedOutcome: 'Order placed',
        visualConfirmation: 'green checkmark, order number',
        confidence: 0.9,
      };
      const result = checkGoalProgress(intent, hints, 'Your cart has 3 items. Continue shopping.', 'http://localhost/cart');
      expect(result.goalAchieved).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // skipRemainingHints
  // --------------------------------------------------------------------------
  describe('skipRemainingHints', () => {
    it('should mark all incomplete hints as skipped', () => {
      const hints: MockHint[] = [
        { stepNumber: 0, description: 'Step 0', completed: true },
        { stepNumber: 1, description: 'Step 1', completed: true },
        { stepNumber: 2, description: 'Step 2', completed: false },
        { stepNumber: 3, description: 'Step 3', completed: false },
        { stepNumber: 4, description: 'Step 4', completed: false },
      ];
      const result = skipRemainingHints(hints);
      expect(result[0].skipped).toBeFalsy();
      expect(result[1].skipped).toBeFalsy();
      expect(result[2].skipped).toBe(true);
      expect(result[3].skipped).toBe(true);
      expect(result[4].skipped).toBe(true);
    });

    it('should not re-skip already skipped hints', () => {
      const hints: MockHint[] = [
        { stepNumber: 0, description: 'Step 0', completed: false, skipped: true },
        { stepNumber: 1, description: 'Step 1', completed: false },
      ];
      const result = skipRemainingHints(hints);
      // Already skipped — should still be skipped (not double-processed)
      expect(result[0].skipped).toBe(true);
      expect(result[1].skipped).toBe(true);
    });

    it('should not modify completed hints', () => {
      const hints: MockHint[] = [
        { stepNumber: 0, description: 'Step 0', completed: true },
        { stepNumber: 1, description: 'Step 1', completed: true },
      ];
      const result = skipRemainingHints(hints);
      expect(result[0].completed).toBe(true);
      expect(result[0].skipped).toBeFalsy();
      expect(result[1].completed).toBe(true);
      expect(result[1].skipped).toBeFalsy();
    });

    it('should handle empty hints array', () => {
      const result = skipRemainingHints([]);
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // checkAndHandleEarlyCompletion
  // --------------------------------------------------------------------------
  describe('checkAndHandleEarlyCompletion', () => {
    it('should return true when goal achieved with confidence >= 0.8', () => {
      const goalCheck = { goalAchieved: true, reason: 'Found "success" on page', confidence: 0.85 };
      expect(checkAndHandleEarlyCompletion(true, goalCheck)).toBe(true);
    });

    it('should return true when confidence is exactly 0.8', () => {
      const goalCheck = { goalAchieved: true, reason: 'URL indicates success page', confidence: 0.8 };
      expect(checkAndHandleEarlyCompletion(true, goalCheck)).toBe(true);
    });

    it('should return false when confidence < 0.8 even if goal achieved', () => {
      const goalCheck = { goalAchieved: true, reason: 'Partial match', confidence: 0.5 };
      expect(checkAndHandleEarlyCompletion(true, goalCheck)).toBe(false);
    });

    it('should return false when goal not achieved', () => {
      const goalCheck = { goalAchieved: false, reason: 'Goal not yet achieved', confidence: 0 };
      expect(checkAndHandleEarlyCompletion(true, goalCheck)).toBe(false);
    });

    it('should return false when feature flag is disabled', () => {
      const goalCheck = { goalAchieved: true, reason: 'URL indicates success page', confidence: 0.9 };
      expect(checkAndHandleEarlyCompletion(false, goalCheck)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Backward compatibility
  // --------------------------------------------------------------------------
  describe('Backward compatibility', () => {
    it('flag off = no early completion checks (always returns false)', () => {
      const goalCheck = { goalAchieved: true, reason: 'Found "success" on page', confidence: 0.9 };
      const result = checkAndHandleEarlyCompletion(false, goalCheck);
      expect(result).toBe(false);
    });

    it('checkGoalProgress still works independently of flag', () => {
      // checkGoalProgress is pure logic — the flag gates the caller, not the check itself
      const intent: MockAnalyzedIntent = { primaryGoal: 'Submit', expectedOutcome: 'success', confidence: 0.9 };
      const hints = makeHints(10, 5);
      const result = checkGoalProgress(intent, hints, 'Operation success!', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // End-to-End Scenarios
  // --------------------------------------------------------------------------
  describe('End-to-End Scenarios', () => {
    it('Scenario: Form workflow at step 4/13 — too early, no check', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Fill out form',
        expectedOutcome: 'Form submitted',
        confidence: 0.9,
      };
      // 4 out of 13 = ~30.7% — just past the threshold but body text doesn't match
      const hints = makeHints(13, 4);
      const result = checkGoalProgress(intent, hints, 'Please fill in the required fields.', 'http://localhost/form');
      expect(result.goalAchieved).toBe(false);
    });

    it('Scenario: Form workflow at step 3/13 — too early, skip check', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Fill out form',
        expectedOutcome: 'Form submitted',
        confidence: 0.9,
      };
      // 3 out of 13 = ~23% — below threshold
      const hints = makeHints(13, 3);
      const result = checkGoalProgress(intent, hints, 'Form submitted successfully!', 'http://localhost/success');
      // Even though "submitted" is on page, we're below 30%
      expect(result.goalAchieved).toBe(false);
      expect(result.reason).toBe('Too early to check goal');
    });

    it('Scenario: Checkout workflow — success URL detected mid-workflow', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Complete checkout',
        expectedOutcome: 'Order confirmation page',
        confidence: 0.9,
      };
      const hints = makeHints(8, 5); // 62.5% done
      const goalCheck = checkGoalProgress(intent, hints, 'Thank you for your order!', 'https://shop.com/confirm');
      expect(goalCheck.goalAchieved).toBe(true);
      expect(goalCheck.confidence).toBe(0.9);

      // Should trigger early completion
      const shouldBreak = checkAndHandleEarlyCompletion(true, goalCheck);
      expect(shouldBreak).toBe(true);

      // Remaining hints should be skipped
      const afterSkip = skipRemainingHints(hints);
      const skippedCount = afterSkip.filter(h => h.skipped).length;
      expect(skippedCount).toBe(3); // 3 remaining steps skipped
    });

    it('Scenario: Full workflow completes normally — no early exit', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Update settings',
        expectedOutcome: 'Settings saved',
        confidence: 0.9,
      };
      // 9 out of 10 = 90% done, but "saved" not on page yet
      const hints = makeHints(10, 9);
      const goalCheck = checkGoalProgress(intent, hints, 'Review your changes before saving.', 'http://localhost/settings');
      expect(goalCheck.goalAchieved).toBe(false);

      const shouldBreak = checkAndHandleEarlyCompletion(true, goalCheck);
      expect(shouldBreak).toBe(false);
    });

    it('Scenario: Visual confirmation detected before all steps done', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Register account',
        expectedOutcome: 'Account created',
        visualConfirmation: 'welcome message, account dashboard',
        confidence: 0.9,
      };
      const hints = makeHints(6, 4); // 67% done
      const goalCheck = checkGoalProgress(intent, hints, 'Welcome message: Your account has been created!', 'http://localhost/dashboard');
      expect(goalCheck.goalAchieved).toBe(true);
      expect(goalCheck.reason).toContain('welcome message');

      const shouldBreak = checkAndHandleEarlyCompletion(true, goalCheck);
      expect(shouldBreak).toBe(true);
    });

    it('Scenario: Skipped hints count toward progress threshold', () => {
      const intent: MockAnalyzedIntent = {
        primaryGoal: 'Submit',
        expectedOutcome: 'Form submitted',
        confidence: 0.9,
      };
      // 10 hints: 2 completed + 1 skipped = 30% done
      const hints: MockHint[] = Array.from({ length: 10 }, (_, i) => ({
        stepNumber: i,
        description: `Step ${i}`,
        completed: i < 2,
        skipped: i === 2,
      }));
      const result = checkGoalProgress(intent, hints, 'Form submitted!', 'http://localhost');
      expect(result.goalAchieved).toBe(true);
    });
  });
});
