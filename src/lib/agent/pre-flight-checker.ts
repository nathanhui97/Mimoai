/**
 * Pre-Flight Checker Module
 *
 * Before each step: is the field already filled correctly?
 * Is the UI already in the right state? Is the page in an unexpected state?
 *
 * Systematizes the existing `checkIfOutcomeAlreadySatisfied()` logic and adds:
 * - Field value pre-checks (field already has correct value → skip type step)
 * - UI state pre-checks (dropdown already showing correct option → skip select)
 * - Navigation pre-checks (already on correct URL → skip navigate)
 */

import type { AgentHint, AgentObservation } from './types';

// ============================================================================
// Types
// ============================================================================

export interface PreFlightResult {
  /** Whether the step can be skipped */
  canSkip: boolean;
  /** Why the step can be skipped (for logging/LLM context) */
  reason?: string;
  /** Confidence in the skip decision (0-1) */
  confidence: number;
  /** What check determined this */
  checkType?: 'field_value' | 'url_match' | 'expected_outcome' | 'ui_state';
}

// ============================================================================
// Pre-Flight Checker
// ============================================================================

export class PreFlightChecker {
  /**
   * Run all pre-flight checks for a step.
   * Returns whether the step can be skipped because its outcome is already achieved.
   */
  static check(hint: AgentHint, observation: AgentObservation): PreFlightResult {
    // Check 1: Expected outcome already satisfied (natural language)
    const outcomeCheck = PreFlightChecker.checkExpectedOutcome(hint, observation);
    if (outcomeCheck.canSkip) return outcomeCheck;

    // Check 2: Type step — field already has the correct value
    if (hint.actionType === 'type' && hint.value) {
      const fieldCheck = PreFlightChecker.checkFieldValue(hint, observation);
      if (fieldCheck.canSkip) return fieldCheck;
    }

    // Check 3: Navigate step — already on correct URL
    if (hint.actionType === 'navigate') {
      const navCheck = PreFlightChecker.checkNavigation(hint, observation);
      if (navCheck.canSkip) return navCheck;
    }

    return { canSkip: false, confidence: 0 };
  }

  /**
   * Check if the hint's expected outcome (from naturalLanguage) is already satisfied.
   *
   * DISABLED: Text-based keyword matching against DOM text is fundamentally unreliable.
   * Keywords like "test", "name", "box" appear across all fields in the DOM, so an
   * expected outcome like "The text 'test' is visible in the first name box" would
   * match even for unrelated steps (last name, radio buttons, etc.), causing false skips.
   *
   * Only checkFieldValue() (actual field value comparison) and checkNavigation()
   * (URL comparison) are reliable pre-flight checks.
   */
  private static checkExpectedOutcome(
    _hint: AgentHint,
    _observation: AgentObservation,
  ): PreFlightResult {
    return { canSkip: false, confidence: 0 };
  }

  /**
   * For 'type' steps: check if the target field already has the correct value.
   */
  private static checkFieldValue(
    hint: AgentHint,
    observation: AgentObservation,
  ): PreFlightResult {
    if (!hint.value || !observation.formFields?.length) {
      return { canSkip: false, confidence: 0 };
    }

    const targetValue = hint.value.trim().toLowerCase();
    const targetName = normalizeFieldName(
      (hint.targetText || hint.targetPlaceholder || hint.description || '')
    );

    if (!targetName) return { canSkip: false, confidence: 0 };

    for (const field of observation.formFields) {
      if (!field.value) continue;

      const fieldValue = field.value.trim().toLowerCase();
      const fieldName = normalizeFieldName(field.name);

      if (!fieldName) continue;

      // Strict name matching: exact match after normalization, or very high
      // similarity (>0.9) to only catch trivial differences like trailing colons.
      // Previous threshold of 0.6 caused "First name" to match "Last name".
      const nameMatch =
        fieldName === targetName ||
        levenshteinSimilarity(fieldName, targetName) > 0.9;

      if (nameMatch && fieldValue === targetValue) {
        return {
          canSkip: true,
          reason: `Field "${field.name}" already has value "${hint.value}"`,
          confidence: 0.9,
          checkType: 'field_value',
        };
      }
    }

    return { canSkip: false, confidence: 0 };
  }

  /**
   * For 'navigate' steps: check if already on the correct URL.
   */
  private static checkNavigation(
    hint: AgentHint,
    observation: AgentObservation,
  ): PreFlightResult {
    if (!hint.description) return { canSkip: false, confidence: 0 };

    // Extract URL-like patterns from the hint description
    const urlMatch = hint.description.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const targetUrl = urlMatch[0].toLowerCase().replace(/\/$/, '');
      const currentUrl = observation.url.toLowerCase().replace(/\/$/, '');

      if (currentUrl === targetUrl || currentUrl.startsWith(targetUrl)) {
        return {
          canSkip: true,
          reason: `Already on target URL: ${observation.url}`,
          confidence: 0.95,
          checkType: 'url_match',
        };
      }
    }

    return { canSkip: false, confidence: 0 };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Normalize a field name for comparison: lowercase, strip punctuation, collapse whitespace. */
function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // strip colons, punctuation
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim();
}

/** Simple Levenshtein similarity (0-1 range). */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return 1 - matrix[a.length][b.length] / maxLen;
}
