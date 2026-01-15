/**
 * Fuzzy Option Matcher
 *
 * Intelligent matching of user input to dropdown/list options.
 * Uses multiple strategies: exact → normalized → contains → word overlap → fuzzy
 *
 * Part of the Hybrid Matching System (Tier 1 - Fast Path)
 */

import { TextMatcher } from '../core/text-matcher';

export interface FuzzyMatchResult {
  /** The best matching option, or null if no good match */
  matchedOption: string | null;
  /** Confidence score 0-1 */
  confidence: number;
  /** How the match was found */
  matchType: 'exact' | 'normalized' | 'contains' | 'word_overlap' | 'fuzzy' | 'none';
  /** All options with their scores, sorted by score descending */
  allScores: Array<{ option: string; score: number }>;
  /** Whether LLM should be consulted (medium confidence range) */
  needsLLM: boolean;
  /** Whether user confirmation is likely needed */
  needsConfirmation: boolean;
}

export interface FuzzyMatchConfig {
  /** Threshold for auto-select (default: 0.85) */
  highThreshold: number;
  /** Threshold below which to skip LLM and go to user (default: 0.30) */
  lowThreshold: number;
  /** Threshold for detecting "similar" matches (default: 0.15) */
  similarityGap: number;
}

const DEFAULT_CONFIG: FuzzyMatchConfig = {
  highThreshold: 0.85,
  lowThreshold: 0.30,
  similarityGap: 0.15,
};

/**
 * Strip parenthetical content from text
 * "Honey Mustard (6 pcs)" → "Honey Mustard"
 */
function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

/**
 * Extract Latin characters from mixed text
 * "蜂蜜芥末鸡 Honey Mustard" → "Honey Mustard"
 */
function extractLatin(text: string): string {
  const latinMatch = text.match(/[a-zA-Z\s]+/g);
  return latinMatch ? latinMatch.join(' ').trim() : '';
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u00A0\s]+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Score a single option against user input
 */
function scoreOption(userInput: string, option: string): { score: number; matchType: FuzzyMatchResult['matchType'] } {
  const normalizedInput = normalizeText(userInput);
  const normalizedOption = normalizeText(option);

  // Strategy 1: Exact match
  if (normalizedInput === normalizedOption) {
    return { score: 1.0, matchType: 'exact' };
  }

  // Strategy 2: Stripped parenthetical match
  const strippedOption = normalizeText(stripParenthetical(option));
  if (normalizedInput === strippedOption) {
    return { score: 0.98, matchType: 'normalized' };
  }

  // Strategy 3: Latin extraction match (for multilingual)
  const latinOption = normalizeText(extractLatin(option));
  if (latinOption && normalizedInput === latinOption) {
    return { score: 0.96, matchType: 'normalized' };
  }

  // Strategy 4: Contains match (input in option OR option contains input)
  if (normalizedOption.includes(normalizedInput)) {
    // How much of the option is the input? More coverage = higher score
    const coverage = normalizedInput.length / normalizedOption.length;
    const score = 0.80 + (coverage * 0.15);  // 0.80 - 0.95
    return { score, matchType: 'contains' };
  }

  if (normalizedInput.includes(normalizedOption)) {
    const coverage = normalizedOption.length / normalizedInput.length;
    const score = 0.70 + (coverage * 0.15);  // 0.70 - 0.85
    return { score, matchType: 'contains' };
  }

  // Strategy 5: Stripped version contains
  if (strippedOption && normalizedInput.includes(strippedOption)) {
    return { score: 0.75, matchType: 'contains' };
  }
  if (strippedOption && strippedOption.includes(normalizedInput)) {
    return { score: 0.78, matchType: 'contains' };
  }

  // Strategy 6: Latin extraction contains
  if (latinOption && normalizedInput.includes(latinOption)) {
    return { score: 0.73, matchType: 'contains' };
  }
  if (latinOption && latinOption.includes(normalizedInput)) {
    return { score: 0.76, matchType: 'contains' };
  }

  // Strategy 7: Word overlap
  const inputWords = TextMatcher.extractSignificantWords(userInput);
  const optionWords = TextMatcher.extractSignificantWords(option);

  if (inputWords.length > 0 && optionWords.length > 0) {
    const matchingWords = inputWords.filter(iw =>
      optionWords.some(ow => ow.includes(iw) || iw.includes(ow))
    );

    if (matchingWords.length > 0) {
      // More matching words = higher score
      const wordOverlap = matchingWords.length / Math.max(inputWords.length, 1);
      const score = 0.50 + (wordOverlap * 0.30);  // 0.50 - 0.80
      return { score, matchType: 'word_overlap' };
    }
  }

  // Strategy 8: Fuzzy similarity (Levenshtein + Jaccard)
  const fuzzyScore = TextMatcher.similarityScore(normalizedInput, normalizedOption);

  // Also try against stripped and latin versions
  const strippedScore = strippedOption
    ? TextMatcher.similarityScore(normalizedInput, strippedOption)
    : 0;
  const latinScore = latinOption
    ? TextMatcher.similarityScore(normalizedInput, latinOption)
    : 0;

  const bestFuzzyScore = Math.max(fuzzyScore, strippedScore, latinScore);

  if (bestFuzzyScore > 0.3) {
    return { score: bestFuzzyScore * 0.8, matchType: 'fuzzy' };  // Cap fuzzy at 0.8
  }

  return { score: bestFuzzyScore * 0.5, matchType: 'none' };
}

/**
 * Find the best matching option for user input
 */
export function findBestMatch(
  userInput: string,
  options: string[],
  config: Partial<FuzzyMatchConfig> = {}
): FuzzyMatchResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!userInput || options.length === 0) {
    return {
      matchedOption: null,
      confidence: 0,
      matchType: 'none',
      allScores: [],
      needsLLM: false,
      needsConfirmation: true,
    };
  }

  // Score all options
  const scores = options.map(option => {
    const { score, matchType } = scoreOption(userInput, option);
    return { option, score, matchType };
  });

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const allScores = scores.map(s => ({ option: s.option, score: s.score }));
  const best = scores[0];

  if (!best || best.score === 0) {
    return {
      matchedOption: null,
      confidence: 0,
      matchType: 'none',
      allScores,
      needsLLM: true,
      needsConfirmation: true,
    };
  }

  // Check for multiple similar high-confidence matches
  const similarMatches = scores.filter(s => s.score >= best.score - cfg.similarityGap);
  const hasMultipleSimilar = similarMatches.length > 1 && best.score >= 0.70;

  // Determine if LLM or user confirmation needed
  const needsLLM = best.score < cfg.highThreshold && best.score >= cfg.lowThreshold;
  const needsConfirmation = hasMultipleSimilar || best.score < 0.70;

  return {
    matchedOption: best.option,
    confidence: best.score,
    matchType: best.matchType,
    allScores,
    needsLLM,
    needsConfirmation,
  };
}

/**
 * Find all options that match above a threshold
 * Useful for multi-select scenarios
 */
export function findAllMatches(
  userInput: string,
  options: string[],
  threshold: number = 0.70
): Array<{ option: string; score: number }> {
  const result = findBestMatch(userInput, options);
  return result.allScores.filter(s => s.score >= threshold);
}

/**
 * Check if there are multiple similar matches (variants of same item)
 */
export function hasSimilarMatches(
  userInput: string,
  options: string[],
  gap: number = 0.15
): boolean {
  const result = findBestMatch(userInput, options);
  if (result.confidence < 0.70) return false;

  const similar = result.allScores.filter(s => s.score >= result.confidence - gap);
  return similar.length > 1;
}
