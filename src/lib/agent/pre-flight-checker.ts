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
   * This is the systematized version of `checkIfOutcomeAlreadySatisfied()`.
   */
  private static checkExpectedOutcome(
    hint: AgentHint,
    observation: AgentObservation,
  ): PreFlightResult {
    const expectedOutcome = hint.naturalLanguage?.expectedOutcome;
    if (!expectedOutcome) return { canSkip: false, confidence: 0 };

    const domText = observation.domMapText.toLowerCase();
    const expected = expectedOutcome.toLowerCase();

    // Check for URL-based outcomes
    if (expected.includes('navigate') || expected.includes('url')) {
      const urlKeywords = extractKeywords(expected);
      const urlLower = observation.url.toLowerCase();
      if (urlKeywords.some(kw => urlLower.includes(kw))) {
        return {
          canSkip: true,
          reason: `URL already matches expected outcome: "${expectedOutcome}"`,
          confidence: 0.85,
          checkType: 'expected_outcome',
        };
      }
    }

    // Check for text-appears outcomes
    if (expected.includes('appears') || expected.includes('visible') || expected.includes('shows')) {
      const keywords = extractKeywords(expected);
      const matchCount = keywords.filter(kw => domText.includes(kw)).length;
      if (keywords.length > 0 && matchCount >= Math.ceil(keywords.length * 0.6)) {
        return {
          canSkip: true,
          reason: `Expected content already visible: "${expectedOutcome}"`,
          confidence: 0.8,
          checkType: 'expected_outcome',
        };
      }
    }

    // Check for "selected" or "filled" outcomes
    if (expected.includes('selected') || expected.includes('filled') || expected.includes('set to')) {
      const keywords = extractKeywords(expected);
      const matchCount = keywords.filter(kw => domText.includes(kw)).length;
      if (keywords.length > 0 && matchCount >= Math.ceil(keywords.length * 0.5)) {
        return {
          canSkip: true,
          reason: `Expected state already achieved: "${expectedOutcome}"`,
          confidence: 0.75,
          checkType: 'expected_outcome',
        };
      }
    }

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
    const targetName = (hint.targetText || hint.targetPlaceholder || hint.description || '').toLowerCase();

    for (const field of observation.formFields) {
      if (!field.value) continue;

      const fieldValue = field.value.trim().toLowerCase();
      const fieldName = field.name.toLowerCase();

      // Match by name similarity
      const nameMatch = targetName && (
        fieldName.includes(targetName) ||
        targetName.includes(fieldName) ||
        levenshteinSimilarity(fieldName, targetName) > 0.6
      );

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

/** Extract meaningful keywords from a description, filtering stop words. */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this',
    'it', 'its', 'my', 'your', 'his', 'her', 'their', 'our',
    'appears', 'visible', 'shows', 'displayed', 'navigate', 'navigates',
    'selected', 'filled', 'set', 'already', 'page', 'field', 'url',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
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
