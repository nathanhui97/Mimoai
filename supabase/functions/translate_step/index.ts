/**
 * Translate Step Edge Function
 * 
 * Translates a raw workflow step into natural language with context.
 * This helps the AI agent understand the intent behind each step.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const VERSION = 'v1.0.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// ============================================================================
// Types
// ============================================================================

interface TranslateStepRequest {
  step: {
    index: number;
    type: string;
    description?: string;
    elementText?: string;
    elementRole?: string;
    value?: string;
    url?: string;
    selector?: string;
    placeholder?: string;
    containerText?: string;
    // Additional context for accurate translation
    parentText?: string;
    nearbyText?: string[];
    disambiguators?: string[];
    ariaLabel?: string;
  };
  previousSteps: Array<{
    index: number;
    type: string;
    description?: string;
    intent?: string;
  }>;
  remainingSteps: Array<{
    index: number;
    type: string;
    description?: string;
  }>;
  totalSteps: number;
}

interface TranslateStepResponse {
  intent: string;
  precondition: string;
  expectedOutcome: string;
  dependencies: number[];
  alternateDescriptions?: string[];
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    console.log('translate_step', VERSION, 'received request');
    const payload: TranslateStepRequest = await req.json();
    
    console.log('Step:', payload.step.index, payload.step.type, payload.step.description);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build prompt
    const prompt = buildPrompt(payload);
    
    // Call Gemini API
    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    };

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    const response = parseResponse(geminiResult, payload);
    
    console.log('Translated intent:', response.intent);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('translate_step error:', error);
    return new Response(JSON.stringify({
      intent: 'Perform the recorded action',
      precondition: 'Page must be loaded',
      expectedOutcome: 'Action completes successfully',
      dependencies: [],
    }), {
      status: 200, // Return 200 with fallback so workflow saving doesn't fail
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPrompt(payload: TranslateStepRequest): string {
  const { step, previousSteps, remainingSteps, totalSteps } = payload;
  
  // Build context string from all available info
  const nearbyContext = step.nearbyText?.length ? `\n- Nearby text: ${step.nearbyText.join(', ')}` : '';
  const disambiguatorContext = step.disambiguators?.length ? `\n- Disambiguators: ${step.disambiguators.join(', ')}` : '';
  const ariaContext = step.ariaLabel ? `\n- Aria label: "${step.ariaLabel}"` : '';
  const parentContext = step.parentText ? `\n- Parent element text: "${step.parentText}"` : '';
  
  return `You are translating a recorded workflow step into natural language.

## Step to Translate
Step ${step.index + 1} of ${totalSteps}:
- Action type: ${step.type}
- Element text: "${step.elementText || 'unlabeled'}"
- Element role: ${step.elementRole || 'unknown'}${parentContext}${ariaContext}${nearbyContext}${disambiguatorContext}
- Value to enter: ${step.value || 'N/A'}
- Placeholder: ${step.placeholder || 'N/A'}
- Container: ${step.containerText || 'N/A'}
- URL: ${step.url || 'N/A'}

IMPORTANT: Use the element text, parent text, aria label, and nearby text to understand what was ACTUALLY clicked. 
Do NOT rely on the description field as it may be incorrect.

## Previous Steps (already completed)
${previousSteps.length > 0 
  ? previousSteps.map(s => `Step ${s.index + 1}: ${s.intent || s.description || s.type}`).join('\n')
  : '(this is the first step)'}

## Upcoming Steps (for context)
${remainingSteps.length > 0
  ? remainingSteps.map(s => `Step ${s.index + 1}: ${s.description || s.type}`).join('\n')
  : '(this is the last step)'}

## Your Task
Translate this step into natural language that helps an AI agent understand:
1. **Intent**: What is the user trying to accomplish? (Be specific but concise)
2. **Precondition**: What must be true before this step can execute? (e.g., "modal must be open", "dropdown must be visible")
3. **Expected Outcome**: What should happen after this step succeeds? (Be observable/verifiable)
4. **Dependencies**: Which previous step indices must complete first? (array of numbers, e.g., [0, 1])

IMPORTANT RULES:
- For dropdown/combobox clicks: The outcome is "dropdown menu opens with options"
- For option selection: The outcome is "option is selected and dropdown closes" or "modal/dialog appears"
- For INPUT actions: The outcome is "field contains the entered value"
- For button clicks: Think about what the button does (opens modal? submits form? navigates?)
- Dependencies: If this step requires a previous action (e.g., option selection requires dropdown open), include that step index

Respond with JSON:
{
  "intent": "Clear description of what user is trying to do",
  "precondition": "What must be true before this step",
  "expectedOutcome": "What should happen after success",
  "dependencies": [list of step indices],
  "alternateDescriptions": ["other ways to describe this action"]
}`;
}

// ============================================================================
// Response Parser
// ============================================================================

function parseResponse(geminiResult: any, payload: TranslateStepRequest): TranslateStepResponse {
  try {
    const text = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    
    return {
      intent: parsed.intent || payload.step.description || 'Perform action',
      precondition: parsed.precondition || 'Page must be loaded',
      expectedOutcome: parsed.expectedOutcome || 'Action completes successfully',
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      alternateDescriptions: parsed.alternateDescriptions,
    };
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    return {
      intent: payload.step.description || 'Perform action',
      precondition: 'Page must be loaded',
      expectedOutcome: 'Action completes successfully',
      dependencies: [],
    };
  }
}

