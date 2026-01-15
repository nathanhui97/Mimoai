/**
 * Annotation Parser
 *
 * Detects patterns in user annotations during recording.
 * Identifies skill boundaries, repeatability, selection behavior, and instructions.
 */

import type {
  AnnotationPattern,
  StepAnnotation,
  ParsedAnnotation,
  SkillBoundary,
} from '../types/skill';

// ============================================================================
// Pattern Detection Rules
// ============================================================================

interface PatternRule {
  type: AnnotationPattern['type'];
  patterns: RegExp[];
  extractName?: (match: RegExpMatchArray, text: string) => string | undefined;
  extractVariables?: (match: RegExpMatchArray, text: string) => string[];
}

const PATTERN_RULES: PatternRule[] = [
  // Skill Start patterns
  {
    type: 'skill_start',
    patterns: [
      /\bthis is how (?:we|i|you)\s+(.+)/i,
      /\bnow (?:i'm|we're|i am) going to\s+(.+)/i,
      /\bthis part is for\s+(.+)/i,
      /\bstarting to\s+(.+)/i,
      /\bbeginning the\s+(.+)/i,
      /\bfirst[,:]?\s+(.+)/i,
      /\bstep \d+[:\s]+(.+)/i,
    ],
    extractName: (match) => {
      // Extract skill name from captured group
      const captured = match[1]?.trim();
      if (captured) {
        // Clean up common suffixes
        return captured
          .replace(/\s+now$/i, '')
          .replace(/\s+here$/i, '')
          .replace(/\.$/, '');
      }
      return undefined;
    },
  },

  // Skill End patterns
  {
    type: 'skill_end',
    patterns: [
      /\bthat's it for\s+(.+)/i,
      /\bdone with\s+(.+)/i,
      /\bfinished\s+(.+)/i,
      /\bcompleted\s+(.+)/i,
      /\bnow we move on/i,
      /\bnext[,:]?\s+(.+)/i,
      /\bend of\s+(.+)/i,
    ],
  },

  // Repeatable patterns
  {
    type: 'repeatable',
    patterns: [
      /\bthis repeats\s+(?:for )?(?:each|every)\s+(.+)/i,
      /\bdo this for (?:each|every)\s+(.+)/i,
      /\bloop through\s+(.+)/i,
      /\brepeat\s+(?:for )?(?:each|every|all)\s+(.+)/i,
      /\bfor each\s+(.+)/i,
      /\bfor every\s+(.+)/i,
      /\buntil (?:done|finished|complete)/i,
      /\bkeep doing this/i,
      /\bdo this\s+(\d+)\s+times/i,
    ],
    extractVariables: (match) => {
      const captured = match[1]?.trim();
      if (captured && !/^\d+$/.test(captured)) {
        // Return as variable name (e.g., "item", "product")
        return [captured.replace(/s$/i, '')]; // Singularize
      }
      return [];
    },
  },

  // Selection All patterns
  {
    type: 'selection_all',
    patterns: [
      /\bselect all\b/i,
      /\bcheck all\b/i,
      /\bchoose (?:all|every)\b/i,
      /\bpick (?:all|every)\b/i,
      /\ball (?:of them|matches|options)/i,
      /\bevery (?:one|match|option)/i,
      /\bmultiple\s+(?:items|selections)/i,
    ],
  },

  // Selection First patterns
  {
    type: 'selection_first',
    patterns: [
      /\bjust (?:pick|select|choose) the first/i,
      /\bfirst (?:one|match|option|result)/i,
      /\btop result/i,
      /\bonly one/i,
      /\bsingle selection/i,
    ],
  },

  // Instruction patterns
  {
    type: 'instruction',
    patterns: [
      /\bmake sure to\s+(.+)/i,
      /\bdon't forget to\s+(.+)/i,
      /\bimportant[:\s]+(.+)/i,
      /\balways\s+(.+)/i,
      /\bnever\s+(.+)/i,
      /\bremember to\s+(.+)/i,
      /\bbe sure to\s+(.+)/i,
    ],
  },

  // Edge Case patterns
  {
    type: 'edge_case',
    patterns: [
      /\bsometimes (?:there are|you'll see)\s+(.+)/i,
      /\bif (?:you see|there (?:is|are))\s+(.+)/i,
      /\bwatch out for\s+(.+)/i,
      /\bin case of\s+(.+)/i,
      /\bwhen there (?:is|are)\s+(.+)/i,
      /\bmight (?:see|have|be)\s+(.+)/i,
    ],
  },
];

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Parse annotation text and detect patterns
 */
export function parseAnnotation(text: string): ParsedAnnotation {
  const patterns: AnnotationPattern[] = [];
  let suggestedSkillName: string | undefined;
  const variables: string[] = [];

  for (const rule of PATTERN_RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Calculate confidence based on match quality
        const confidence = calculateConfidence(match, text);

        patterns.push({
          type: rule.type,
          phrase: match[0],
          confidence,
        });

        // Extract skill name if available
        if (rule.extractName && rule.type === 'skill_start') {
          const name = rule.extractName(match, text);
          if (name && !suggestedSkillName) {
            suggestedSkillName = name;
          }
        }

        // Extract variables if available
        if (rule.extractVariables) {
          const extracted = rule.extractVariables(match, text);
          variables.push(...extracted);
        }

        // Only match one pattern per rule type
        break;
      }
    }
  }

  return {
    rawText: text,
    patterns,
    suggestedSkillName,
    variables: variables.length > 0 ? [...new Set(variables)] : undefined,
  };
}

/**
 * Calculate confidence score for a pattern match
 */
function calculateConfidence(match: RegExpMatchArray, text: string): number {
  // Base confidence from match length ratio
  const matchRatio = match[0].length / text.length;

  // Higher confidence if match is at start or end
  const isAtStart = match.index === 0;
  const isAtEnd = (match.index || 0) + match[0].length === text.length;

  let confidence = 0.6 + matchRatio * 0.2;

  if (isAtStart || isAtEnd) {
    confidence += 0.1;
  }

  // Higher confidence for longer captured groups
  if (match[1] && match[1].length > 3) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

/**
 * Detect skill boundaries from a list of step annotations
 */
export function detectSkillBoundaries(
  annotations: StepAnnotation[]
): SkillBoundary[] {
  const boundaries: SkillBoundary[] = [];

  // Sort annotations by step index
  const sorted = [...annotations]
    .filter(a => a.attachedToStepIndex >= 0)
    .sort((a, b) => a.attachedToStepIndex - b.attachedToStepIndex);

  if (sorted.length === 0) return boundaries;

  let currentStart: number | null = null;
  let currentName: string | undefined;
  let maxConfidence = 0;

  for (const annotation of sorted) {
    const hasStart = annotation.detectedPatterns.some(
      p => p.type === 'skill_start'
    );
    const hasEnd = annotation.detectedPatterns.some(
      p => p.type === 'skill_end'
    );

    // Start of new skill
    if (hasStart) {
      // Close previous skill if open
      if (currentStart !== null) {
        boundaries.push({
          start: currentStart,
          end: annotation.attachedToStepIndex - 1,
          suggestedName: currentName,
          confidence: maxConfidence,
          source: 'annotation',
        });
      }

      currentStart = annotation.attachedToStepIndex;
      currentName = extractSkillName(annotation);
      maxConfidence = Math.max(
        ...annotation.detectedPatterns.map(p => p.confidence)
      );
    }

    // End of current skill
    if (hasEnd && currentStart !== null) {
      boundaries.push({
        start: currentStart,
        end: annotation.attachedToStepIndex,
        suggestedName: currentName,
        confidence: maxConfidence,
        source: 'annotation',
      });
      currentStart = null;
      currentName = undefined;
      maxConfidence = 0;
    }

    // Track confidence for current skill
    if (currentStart !== null) {
      const patternConfidences = annotation.detectedPatterns.map(
        p => p.confidence
      );
      if (patternConfidences.length > 0) {
        maxConfidence = Math.max(maxConfidence, ...patternConfidences);
      }
    }
  }

  // Close any remaining open skill (extends to end of workflow)
  // This will be handled by the caller who knows the total step count

  return boundaries;
}

/**
 * Extract skill name from annotation
 */
function extractSkillName(annotation: StepAnnotation): string | undefined {
  const parsed = parseAnnotation(annotation.text);
  return parsed.suggestedSkillName;
}

/**
 * Extract repeatability info from annotations
 */
export function extractRepeatability(
  annotations: StepAnnotation[]
): { isRepeatable: boolean; repeatHint?: string; variables?: string[] } {
  for (const annotation of annotations) {
    const repeatPattern = annotation.detectedPatterns.find(
      p => p.type === 'repeatable'
    );
    if (repeatPattern) {
      const parsed = parseAnnotation(annotation.text);
      return {
        isRepeatable: true,
        repeatHint: repeatPattern.phrase,
        variables: parsed.variables,
      };
    }
  }
  return { isRepeatable: false };
}

/**
 * Extract selection behavior from annotations
 */
export function extractSelectionBehavior(
  annotations: StepAnnotation[]
): 'first' | 'all' | 'ask' | null {
  for (const annotation of annotations) {
    if (annotation.detectedPatterns.some(p => p.type === 'selection_all')) {
      return 'all';
    }
    if (annotation.detectedPatterns.some(p => p.type === 'selection_first')) {
      return 'first';
    }
  }
  return null;
}

/**
 * Extract instructions from annotations
 */
export function extractInstructions(annotations: StepAnnotation[]): string[] {
  const instructions: string[] = [];

  for (const annotation of annotations) {
    const instructionPatterns = annotation.detectedPatterns.filter(
      p => p.type === 'instruction'
    );
    if (instructionPatterns.length > 0) {
      instructions.push(annotation.text);
    }
  }

  return instructions;
}

/**
 * Extract edge cases from annotations
 */
export function extractEdgeCases(
  annotations: StepAnnotation[]
): Array<{ condition: string; action: string }> {
  const edgeCases: Array<{ condition: string; action: string }> = [];

  for (const annotation of annotations) {
    const edgeCasePattern = annotation.detectedPatterns.find(
      p => p.type === 'edge_case'
    );
    if (edgeCasePattern) {
      // Try to parse condition and action from the text
      const text = annotation.text;
      // Simple heuristic: split by comma or "then"
      const parts = text.split(/,|\bthen\b/i);
      if (parts.length >= 2) {
        edgeCases.push({
          condition: parts[0].trim(),
          action: parts.slice(1).join(' ').trim(),
        });
      } else {
        edgeCases.push({
          condition: text,
          action: 'Handle appropriately',
        });
      }
    }
  }

  return edgeCases;
}

/**
 * Check if annotation text contains any detectable patterns
 */
export function hasPatterns(text: string): boolean {
  const parsed = parseAnnotation(text);
  return parsed.patterns.length > 0;
}

/**
 * Get pattern summary for display
 */
export function getPatternSummary(text: string): string[] {
  const parsed = parseAnnotation(text);
  return parsed.patterns.map(p => {
    switch (p.type) {
      case 'skill_start':
        return `Skill start: "${parsed.suggestedSkillName || 'unnamed'}"`;
      case 'skill_end':
        return 'Skill end';
      case 'repeatable':
        return 'Repeatable';
      case 'selection_all':
        return 'Selection: all';
      case 'selection_first':
        return 'Selection: first';
      case 'instruction':
        return 'Instruction';
      case 'edge_case':
        return 'Edge case';
      default:
        return p.type;
    }
  });
}
