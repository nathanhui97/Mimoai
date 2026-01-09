/**
 * @protected DO NOT MODIFY without running full regression suite
 * 
 * This module is used by: CandidateFinder, Resolver, ScopeResolver, RecordingManager
 * Changes here affect ALL workflows including:
 * - Fuzzy text matching for element detection
 * - Partial text matching for ambiguous elements
 * - Widget title matching with dynamic numbers
 * - Menu item text comparison
 * 
 * Before modifying, run: npm run test:integration
 * 
 * TextMatcher - Utilities for fuzzy and partial text matching
 * Used for finding elements when exact text matching fails
 */

export class TextMatcher {
  /**
   * Calculate Levenshtein distance between two strings
   * Returns the minimum number of single-character edits needed to transform str1 into str2
   */
  static levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    // Create a matrix to store distances
    const matrix: number[][] = Array(len1 + 1)
      .fill(null)
      .map(() => Array(len2 + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= len1; i++) {
      matrix[i][0] = i;
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill the matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Calculate Jaccard similarity between two strings
   * Returns a value between 0 and 1 (1 = identical)
   * Uses character bigrams (2-character sequences) for comparison
   */
  static jaccardSimilarity(str1: string, str2: string): number {
    const normalize = (s: string) => s.toLowerCase().trim();
    const s1 = normalize(str1);
    const s2 = normalize(str2);

    if (s1.length === 0 && s2.length === 0) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    // Create bigrams (2-character sequences)
    const getBigrams = (s: string): Set<string> => {
      const bigrams = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.substring(i, i + 2));
      }
      return bigrams;
    };

    const bigrams1 = getBigrams(s1);
    const bigrams2 = getBigrams(s2);

    // Calculate intersection and union
    let intersection = 0;
    const union = new Set<string>([...bigrams1, ...bigrams2]);

    for (const bigram of bigrams1) {
      if (bigrams2.has(bigram)) {
        intersection++;
      }
    }

    return intersection / union.size;
  }

  /**
   * Calculate similarity score (0-1) between two strings
   * Uses a combination of Levenshtein and Jaccard for better accuracy
   * Returns 1.0 for identical strings, 0.0 for completely different
   */
  static similarityScore(str1: string, str2: string): number {
    const normalized1 = this.normalize(str1);
    const normalized2 = this.normalize(str2);

    if (normalized1 === normalized2) return 1.0;

    const maxLen = Math.max(normalized1.length, normalized2.length);
    if (maxLen === 0) return 1.0;

    // Levenshtein-based similarity
    const levenshteinDist = this.levenshteinDistance(normalized1, normalized2);
    const levenshteinScore = 1 - levenshteinDist / maxLen;

    // Jaccard similarity
    const jaccardScore = this.jaccardSimilarity(normalized1, normalized2);

    // Weighted combination (Jaccard is better for longer strings, Levenshtein for shorter)
    const weight = normalized1.length < 10 ? 0.7 : 0.5;
    return weight * levenshteinScore + (1 - weight) * jaccardScore;
  }

  /**
   * Check if text matches with fuzzy threshold
   * @param threshold Minimum similarity score (0-1), default 0.8
   */
  static fuzzyMatch(text1: string, text2: string, threshold: number = 0.8): boolean {
    return this.similarityScore(text1, text2) >= threshold;
  }

  /**
   * Check if text1 contains any significant words from text2
   * @param minWords Minimum number of matching words required, default 2
   */
  static partialMatch(text1: string, text2: string, minWords: number = 2): boolean {
    const normalizeWords = (text: string): string[] => {
      return text
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2); // Only words longer than 2 characters
    };

    const words1 = normalizeWords(text1);
    const words2 = normalizeWords(text2);

    if (words2.length === 0) return false;

    const matchingWords = words2.filter(w2 =>
      words1.some(w1 => w1.includes(w2) || w2.includes(w1))
    );

    return matchingWords.length >= minWords;
  }

  /**
   * Normalize text for comparison
   * - Trims whitespace
   * - Converts to lowercase
   * - Replaces &nbsp; with regular space
   * - Collapses multiple whitespace/newlines into single space
   * - Removes leading/trailing whitespace
   */
  static normalize(text: string): string {
    if (!text) return '';

    return text
      .replace(/\u00A0/g, ' ') // Replace &nbsp; with regular space
      .replace(/[\r\n\t]+/g, ' ') // Replace newlines/tabs with space
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()
      .toLowerCase();
  }

  /**
   * Extract significant words from text (for partial matching)
   * Returns array of words longer than 2 characters
   */
  static extractSignificantWords(text: string): string[] {
    return this.normalize(text)
      .split(/\s+/)
      .filter(w => w.length > 2);
  }
}
