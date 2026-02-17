/**
 * Goal Checker Module
 *
 * Responsible for verifying workflow and step outcomes:
 * - verifyWorkflowOutcome(): checks if overall workflow goal is met
 * - checkGoalProgress(): mid-execution goal progress check
 * - verifyStepOutcome(): verifies individual step outcomes
 * - checkAndHandleEarlyCompletion(): decides if execution can finish early
 *
 * Extracted from AIAgent for modularity.
 */

import { isFeatureEnabled } from '../feature-flags';
import type { PageState as VerifierPageState } from '../success-verifier';
import type { PageChanges, ChangeType } from '../post-action-observer';
import type { AgentHint } from './types';
import type { StepVerificationResult } from './types';
import type { AnalyzedIntent } from '../intent-analyzer';

/** Minimal state interface needed by GoalChecker (avoids coupling to full AgentState) */
interface GoalCheckerState {
  hints: AgentHint[];
  status: string;
  analyzedIntent?: AnalyzedIntent;
}

export class GoalChecker {
  /**
   * Verify that an individual step achieved its intended outcome.
   * Uses structured successCriteria (preferred) or expectedOutcome text (fallback).
   * Synchronous single-pass — no polling, no LLM calls.
   */
  static verifyStepOutcome(
    hint: AgentHint,
    preState: VerifierPageState | null,
    postState: VerifierPageState | null,
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
      return GoalChecker.checkStructuredCriteria(hint.aiAnalysisContext!.successCriteria!, preState, postState, start);
    }

    if (hasExpectedOutcome && pageChanges) {
      return GoalChecker.checkExpectedOutcomeText(hint.naturalLanguage!.expectedOutcome, pageChanges, start);
    }

    return { outcome: 'inconclusive', confidence: 0.3, details: 'Expected outcome present but no pageChanges to match against', elapsedMs: performance.now() - start };
  }

  /**
   * Check structured success criteria synchronously.
   */
  static checkStructuredCriteria(
    criteria: NonNullable<AgentHint['aiAnalysisContext']>['successCriteria'] & {},
    before: VerifierPageState,
    after: VerifierPageState,
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
              : { outcome: 'verified', confidence: 0.7, details: "URL changed but doesn't match pattern", criteriaType: 'url_changes', elapsedMs: elapsed() };
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
        return { outcome: 'inconclusive', confidence: 0.3, details: `Unknown criteria type: ${(criteria as any).type}`, elapsedMs: elapsed() };
    }
  }

  /**
   * Text-based fallback verification using expectedOutcome keywords
   * mapped to observed PageChanges.
   */
  static checkExpectedOutcomeText(
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
   * Handle the result of step verification. Decides whether to retry.
   */
  static handleStepVerificationResult(
    hint: AgentHint & { _stepVerifyFailureCount?: number },
    result: StepVerificationResult,
  ): { shouldRetry: boolean } {
    const tag = `[Phase3] Step ${hint.stepNumber}`;

    switch (result.outcome) {
      case 'verified':
        console.log(`${tag} VERIFIED: ${result.details} (confidence=${result.confidence.toFixed(2)}, ${result.elapsedMs.toFixed(1)}ms)`);
        return { shouldRetry: false };

      case 'unverified': {
        const failCount = (hint._stepVerifyFailureCount ?? 0) + 1;
        (hint as any)._stepVerifyFailureCount = failCount;

        if (failCount === 1 && result.confidence < 0.5) {
          console.warn(`${tag} UNVERIFIED (will retry): ${result.details} (confidence=${result.confidence.toFixed(2)}, attempt=${failCount})`);
          return { shouldRetry: true };
        }

        console.warn(`${tag} UNVERIFIED (continuing): ${result.details} (confidence=${result.confidence.toFixed(2)}, attempt=${failCount})`);
        return { shouldRetry: false };
      }

      case 'inconclusive':
        console.log(`${tag} INCONCLUSIVE: ${result.details} (confidence=${result.confidence.toFixed(2)}, ${result.elapsedMs.toFixed(1)}ms)`);
        return { shouldRetry: false };

      default:
        return { shouldRetry: false };
    }
  }

  /**
   * Verify if the workflow's expected outcome has been achieved.
   */
  static verifyWorkflowOutcome(analyzedIntent?: AnalyzedIntent): { achieved: boolean; reason: string } {
    if (!analyzedIntent?.expectedOutcome) {
      return { achieved: false, reason: 'No expectedOutcome defined' };
    }

    const expectedOutcome = analyzedIntent.expectedOutcome.toLowerCase();

    // Check URL-based outcomes
    const currentUrl = window.location.href.toLowerCase();
    if (expectedOutcome.includes('confirmation') && currentUrl.includes('confirm')) {
      return { achieved: true, reason: 'URL indicates confirmation page' };
    }
    if (expectedOutcome.includes('success') && currentUrl.includes('success')) {
      return { achieved: true, reason: 'URL indicates success page' };
    }
    if (expectedOutcome.includes('thank you') && (currentUrl.includes('thankyou') || currentUrl.includes('thank-you'))) {
      return { achieved: true, reason: 'URL indicates thank you page' };
    }

    // Check for success indicators in DOM
    const successIndicators = ['success', 'confirmed', 'complete', 'saved', 'submitted', 'thank you'];
    const bodyText = document.body.innerText.toLowerCase();
    for (const indicator of successIndicators) {
      if (expectedOutcome.includes(indicator) && bodyText.includes(indicator)) {
        return { achieved: true, reason: `Found "${indicator}" on page` };
      }
    }

    // Check visual confirmation
    if (analyzedIntent.visualConfirmation) {
      const visualConfirmation = analyzedIntent.visualConfirmation.toLowerCase();
      const visualIndicators = visualConfirmation.split(/,|\sand\s/).map(s => s.trim());
      for (const indicator of visualIndicators) {
        if (indicator && bodyText.includes(indicator)) {
          return { achieved: true, reason: `Found visual confirmation: "${indicator}"` };
        }
      }
    }

    return { achieved: false, reason: 'Outcome not yet verified' };
  }

  /**
   * Check if the overall workflow goal is already achieved mid-execution.
   * Pure DOM / URL check — no extra LLM calls or screenshots.
   */
  static checkGoalProgress(
    state: GoalCheckerState,
  ): { goalAchieved: boolean; reason: string; confidence: number } {
    if (!state.analyzedIntent?.expectedOutcome) {
      return { goalAchieved: false, reason: 'No expectedOutcome defined', confidence: 0 };
    }

    const completedCount = state.hints.filter(h => h.completed || h.skipped).length;
    const totalCount = state.hints.length;
    if (totalCount === 0 || completedCount / totalCount < 0.3) {
      return { goalAchieved: false, reason: 'Too early to check goal', confidence: 0 };
    }

    const expectedOutcome = state.analyzedIntent.expectedOutcome.toLowerCase();
    const currentUrl = window.location.href.toLowerCase();
    const bodyText = document.body.innerText.toLowerCase();

    if (expectedOutcome.includes('confirmation') && currentUrl.includes('confirm')) {
      return { goalAchieved: true, reason: 'URL indicates confirmation page', confidence: 0.9 };
    }
    if (expectedOutcome.includes('success') && currentUrl.includes('success')) {
      return { goalAchieved: true, reason: 'URL indicates success page', confidence: 0.9 };
    }
    if (expectedOutcome.includes('thank you') && (currentUrl.includes('thankyou') || currentUrl.includes('thank-you'))) {
      return { goalAchieved: true, reason: 'URL indicates thank you page', confidence: 0.9 };
    }

    const successIndicators = ['success', 'confirmed', 'complete', 'saved', 'submitted', 'thank you'];
    for (const indicator of successIndicators) {
      if (expectedOutcome.includes(indicator) && bodyText.includes(indicator)) {
        return { goalAchieved: true, reason: `Found "${indicator}" on page`, confidence: 0.85 };
      }
    }

    if (state.analyzedIntent.visualConfirmation) {
      const visualConfirmation = state.analyzedIntent.visualConfirmation.toLowerCase();
      const visualIndicators = visualConfirmation.split(/,|\sand\s/).map(s => s.trim());
      for (const indicator of visualIndicators) {
        if (indicator && bodyText.includes(indicator)) {
          return { goalAchieved: true, reason: `Found visual confirmation: "${indicator}"`, confidence: 0.85 };
        }
      }
    }

    return { goalAchieved: false, reason: 'Goal not yet achieved', confidence: 0 };
  }

  /**
   * Mark all remaining incomplete hints as skipped.
   */
  static skipRemainingHints(state: GoalCheckerState, reason: string): void {
    for (const hint of state.hints) {
      if (!hint.completed && !hint.skipped) {
        hint.skipped = true;
      }
    }
    const skippedCount = state.hints.filter(h => h.skipped).length;
    console.log(`[GoalChecker] Skipped ${skippedCount} remaining hints: ${reason}`);
  }

  /**
   * Shared helper: returns true when the caller should break out of the main loop.
   */
  static checkAndHandleEarlyCompletion(state: GoalCheckerState): boolean {
    if (!isFeatureEnabled('INTELLIGENT_AGENT_VERIFY')) {
      return false;
    }

    const goalCheck = GoalChecker.checkGoalProgress(state);
    const completedCount = state.hints.filter(h => h.completed || h.skipped).length;
    const totalCount = state.hints.length;
    console.log(
      `[GoalChecker] 🔍 Goal check (${completedCount}/${totalCount}): ${goalCheck.reason} ` +
      `(achieved=${goalCheck.goalAchieved}, confidence=${goalCheck.confidence})`
    );

    if (goalCheck.goalAchieved && goalCheck.confidence >= 0.8) {
      console.log(`[GoalChecker] 🎉 GOAL ACHIEVED EARLY: ${goalCheck.reason} (confidence: ${goalCheck.confidence})`);
      GoalChecker.skipRemainingHints(state, `Goal achieved early: ${goalCheck.reason}`);
      state.status = 'completed';
      return true;
    }

    return false;
  }

  /**
   * Build a human-readable progress summary for recovery context.
   */
  static buildProgressSummary(currentStep: number, totalSteps: number, completedSteps: number[]): string {
    const percentComplete = Math.round((completedSteps.length / totalSteps) * 100);

    if (currentStep === 0) {
      return 'Just starting - this is the first step';
    }
    if (currentStep >= totalSteps - 1) {
      return `Almost done (${percentComplete}%) - this is the FINAL step, try harder!`;
    }
    if (percentComplete >= 80) {
      return `Near completion (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
    }
    if (percentComplete >= 50) {
      return `Halfway through (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
    }
    return `In progress (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
  }
}
