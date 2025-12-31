/**
 * Supabase Edge Function: analyze_navigation_steps
 * Analyzes workflow steps to determine which are necessary vs optimizable for navigation
 * Uses Gemini API for intelligent step classification
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface StepInfo {
  type: string;
  elementText?: string;
  label?: string;
  url: string;
  formContext?: any;
  inputDetails?: any;
  hasClipboardData: boolean;
  ruleBasedClassification: 'necessary' | 'optimizable' | 'uncertain';
  stepIndex: number;
}

interface AnalysisInput {
  sequence: {
    startUrl: string;
    endUrl: string;
    stepCount: number;
  };
  steps: StepInfo[];
}

interface StepClassification {
  stepIndex: number;
  isNecessary: boolean;
  confidence: number;
  reasoning: string;
}

interface AnalysisOutput {
  stepClassifications: StepClassification[];
  overallRecommendation: 'optimize' | 'keep' | 'partial';
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    const payload: AnalysisInput = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.sequence || !payload.steps?.length) {
      throw new Error('Sequence and steps are required');
    }

    // Build prompt
    const prompt = buildAnalysisPrompt(payload);

    // Build Gemini API request
    const geminiRequest = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.2, // Low temperature for consistent classification
        maxOutputTokens: 2048,
      }
    };

    // Call Gemini API
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const result = parseGeminiResponse(geminiData, payload.steps);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in analyze_navigation_steps:', error);
    
    // Return safe fallback - keep all steps
    return new Response(
      JSON.stringify({
        stepClassifications: [],
        overallRecommendation: 'keep',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 200, // Return 200 to allow graceful fallback
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

/**
 * Build analysis prompt for step classification
 */
function buildAnalysisPrompt(payload: AnalysisInput): string {
  const { sequence, steps } = payload;
  
  let prompt = `You are an expert at analyzing web automation workflows. Your task is to classify each step in a navigation sequence to determine if it's NECESSARY (must be preserved) or OPTIMIZABLE (can be replaced with direct URL navigation).

NAVIGATION SEQUENCE:
- Start URL: ${sequence.startUrl}
- End URL: ${sequence.endUrl}
- Step Count: ${sequence.stepCount}

STEPS TO ANALYZE:
`;

  // Describe each step
  steps.forEach((step, index) => {
    prompt += `
Step ${step.stepIndex} (${step.type}):
- Element text: "${step.elementText || 'N/A'}"
- Label: "${step.label || 'N/A'}"
- URL: ${step.url}
- Has form context: ${step.formContext ? 'Yes' : 'No'}
- Has input details: ${step.inputDetails ? 'Yes' : 'No'}
- Has clipboard data: ${step.hasClipboardData}
- Rule-based classification: ${step.ruleBasedClassification}
`;
  });

  prompt += `
CLASSIFICATION CRITERIA:

NECESSARY steps (must preserve):
1. Any step that enters/modifies data (forms, inputs, text fields)
2. Steps that change application state (beyond just navigation)
3. Steps involving authentication or session management
4. Steps with clipboard operations (copy/paste)
5. Steps that select options that affect data/behavior (not just navigation)
6. Submit buttons, confirmation dialogs, action buttons

OPTIMIZABLE steps (can be replaced):
1. Pure navigation clicks (menu items, links, tabs)
2. Dropdown/menu expansions that only reveal navigation options
3. Intermediate clicks that lead to a URL change with no other purpose
4. Scroll actions used only to reveal navigation elements

ANALYZE each step and return JSON:
{
  "stepClassifications": [
    {
      "stepIndex": <step index>,
      "isNecessary": <true/false>,
      "confidence": <0.0-1.0>,
      "reasoning": "<brief explanation>"
    }
  ],
  "overallRecommendation": "<optimize|keep|partial>"
}

IMPORTANT:
- When in doubt, classify as NECESSARY (isNecessary: true) for safety
- Focus on whether the step modifies data or just navigates
- Consider the overall flow - some "click" steps might be submits
- Return "optimize" only if ALL steps are optimizable
- Return "partial" if some steps are necessary but others can be removed
- Return "keep" if most or all steps should be preserved

Return ONLY the JSON, no other text.`;

  return prompt;
}

/**
 * Parse Gemini response into structured output
 */
function parseGeminiResponse(geminiData: any, originalSteps: StepInfo[]): AnalysisOutput {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('No JSON found in Gemini response, returning fallback');
      return createFallbackResponse(originalSteps);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize response
    const stepClassifications: StepClassification[] = [];
    
    if (Array.isArray(parsed.stepClassifications)) {
      for (const classification of parsed.stepClassifications) {
        if (typeof classification.stepIndex === 'number') {
          stepClassifications.push({
            stepIndex: classification.stepIndex,
            isNecessary: classification.isNecessary !== false, // Default to true for safety
            confidence: typeof classification.confidence === 'number' 
              ? Math.max(0, Math.min(1, classification.confidence)) 
              : 0.5,
            reasoning: typeof classification.reasoning === 'string' 
              ? classification.reasoning 
              : 'No reasoning provided',
          });
        }
      }
    }

    // Determine overall recommendation
    let overallRecommendation: 'optimize' | 'keep' | 'partial' = 'keep';
    if (parsed.overallRecommendation === 'optimize') {
      overallRecommendation = 'optimize';
    } else if (parsed.overallRecommendation === 'partial') {
      overallRecommendation = 'partial';
    }

    return {
      stepClassifications,
      overallRecommendation,
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return createFallbackResponse(originalSteps);
  }
}

/**
 * Create fallback response that preserves all steps
 */
function createFallbackResponse(steps: StepInfo[]): AnalysisOutput {
  return {
    stepClassifications: steps.map(step => ({
      stepIndex: step.stepIndex,
      isNecessary: true,
      confidence: 0,
      reasoning: 'Fallback: Unable to analyze, preserving step for safety',
    })),
    overallRecommendation: 'keep',
  };
}






