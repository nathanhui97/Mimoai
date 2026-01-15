/**
 * Semantic Option Matcher
 *
 * LLM-based fallback for option matching when fuzzy matching has medium confidence.
 * Uses semantic understanding to match user input to dropdown options.
 *
 * Part of the Hybrid Matching System (Tier 2 - LLM Fallback)
 */

import { aiConfig, debugLog } from './ai-config';

export interface SemanticMatchResult {
  /** The best matching option, or null if no good match */
  matchedOption: string | null;
  /** Confidence score 0-1 */
  confidence: number;
  /** Reasoning for the match */
  reasoning: string;
  /** Alternative matches with their confidence scores */
  alternatives: Array<{ option: string; confidence: number }>;
  /** Whether user confirmation is needed */
  requiresConfirmation: boolean;
}

interface LLMResponse {
  bestMatch: number | null;
  confidence: number;
  reasoning: string;
  alternatives?: Array<{ index: number; confidence: number }>;
}

/**
 * Match user input to dropdown options using LLM semantic understanding
 *
 * @param userInput - The user's input value to match
 * @param options - Available dropdown options
 * @param fieldContext - Context about the field (label, form context)
 * @returns Semantic match result with confidence and reasoning
 */
export async function matchWithLLM(
  userInput: string,
  options: string[],
  fieldContext: string = ''
): Promise<SemanticMatchResult> {
  if (!aiConfig.isEnabled()) {
    return {
      matchedOption: null,
      confidence: 0,
      reasoning: 'AI is disabled',
      alternatives: [],
      requiresConfirmation: true,
    };
  }

  if (!userInput || options.length === 0) {
    return {
      matchedOption: null,
      confidence: 0,
      reasoning: 'No input or options provided',
      alternatives: [],
      requiresConfirmation: true,
    };
  }

  try {
    const result = await callSemanticMatchFunction(userInput, options, fieldContext);
    return result;
  } catch (error) {
    console.warn('[SemanticMatcher] LLM matching failed:', error);
    return {
      matchedOption: null,
      confidence: 0,
      reasoning: `LLM matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      alternatives: [],
      requiresConfirmation: true,
    };
  }
}

/**
 * Call Supabase Edge Function for semantic option matching
 */
async function callSemanticMatchFunction(
  userInput: string,
  options: string[],
  fieldContext: string
): Promise<SemanticMatchResult> {
  const config = aiConfig.getConfig();

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase configuration missing');
  }

  const functionName = 'semantic_option_match';
  const timeout = config.timeout || 10000;
  const url = `${config.supabaseUrl}/functions/v1/${functionName}`;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    debugLog('SemanticMatcher', `Request timeout after ${timeout}ms`);
    controller.abort();
  }, timeout);

  try {
    // Build numbered options list for the prompt
    const numberedOptions = options
      .map((opt, idx) => `${idx + 1}. ${opt}`)
      .join('\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
      },
      body: JSON.stringify({
        userInput,
        options,
        numberedOptions,
        fieldContext,
        prompt: buildMatchingPrompt(userInput, numberedOptions, fieldContext),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return parseResponse(data, options);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Semantic matching timeout after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Build the prompt for the LLM
 */
function buildMatchingPrompt(
  userInput: string,
  numberedOptions: string,
  fieldContext: string
): string {
  const contextPart = fieldContext
    ? `\nField context: ${fieldContext}`
    : '';

  return `Match the user's selection "${userInput}" to the most appropriate option from this list:

${numberedOptions}
${contextPart}

Consider:
- Partial text matches (e.g., "honey" matches "Honey Mustard Chicken")
- Multilingual content (e.g., "honey mustard" matches "蜂蜜芥末鸡 Honey Mustard")
- Common typos and misspellings
- Abbreviations (e.g., "HM" could mean "Honey Mustard")
- Semantic similarity (e.g., "chicken wings" matches "Buffalo Wings")

Return a JSON object with:
{
  "bestMatch": <option number 1-${numberedOptions.split('\n').length} or null if no good match>,
  "confidence": <0-1 score>,
  "reasoning": "<brief explanation>",
  "alternatives": [{"index": <number>, "confidence": <score>}, ...] // other possible matches
}`;
}

/**
 * Parse the LLM response into SemanticMatchResult
 */
function parseResponse(response: unknown, options: string[]): SemanticMatchResult {
  if (typeof response !== 'object' || response === null) {
    throw new Error('Invalid response format from Edge Function');
  }

  const data = response as Partial<LLMResponse>;

  // Extract best match
  let matchedOption: string | null = null;
  if (typeof data.bestMatch === 'number' && data.bestMatch >= 1 && data.bestMatch <= options.length) {
    matchedOption = options[data.bestMatch - 1];
  }

  // Extract confidence
  const confidence = typeof data.confidence === 'number'
    ? Math.max(0, Math.min(1, data.confidence))
    : 0;

  // Extract reasoning
  const reasoning = typeof data.reasoning === 'string'
    ? data.reasoning
    : 'No reasoning provided';

  // Extract alternatives
  const alternatives: Array<{ option: string; confidence: number }> = [];
  if (Array.isArray(data.alternatives)) {
    for (const alt of data.alternatives) {
      if (
        typeof alt === 'object' &&
        alt !== null &&
        typeof alt.index === 'number' &&
        alt.index >= 1 &&
        alt.index <= options.length
      ) {
        alternatives.push({
          option: options[alt.index - 1],
          confidence: typeof alt.confidence === 'number' ? alt.confidence : 0,
        });
      }
    }
  }

  // Determine if confirmation is needed
  // - Low confidence (< 0.70)
  // - Multiple alternatives close to best match
  const hasCloseAlternatives = alternatives.some(
    alt => confidence - alt.confidence < 0.15
  );
  const requiresConfirmation = confidence < 0.70 || hasCloseAlternatives;

  return {
    matchedOption,
    confidence,
    reasoning,
    alternatives,
    requiresConfirmation,
  };
}

/**
 * Quick check if LLM matching would be beneficial
 * (avoids unnecessary API calls)
 */
export function shouldUseLLM(fuzzyConfidence: number, optionCount: number): boolean {
  // Don't use LLM for very high or very low fuzzy confidence
  if (fuzzyConfidence >= 0.85) return false;
  if (fuzzyConfidence < 0.20) return false;

  // Don't use LLM if there are too many options (would be expensive)
  if (optionCount > 50) return false;

  // Use LLM for medium confidence range
  return fuzzyConfidence >= 0.30 && fuzzyConfidence < 0.85;
}
