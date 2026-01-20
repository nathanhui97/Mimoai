/**
 * Variable Extraction Edge Function (Phase 2)
 *
 * Extracts variable values from natural language queries.
 * Handles:
 * - "create opportunity for Acme Corp worth $50k" → { company: "Acme Corp", amount: "$50k" }
 * - "worth $50k for Acme" (reordered) → same extraction
 * - "for them" with context → resolve from conversation history
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 3.0 Flash for text-based reasoning
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// ============================================================================
// Types
// ============================================================================

interface ExtractVariablesRequest {
  userQuery: string;
  variables: Array<{
    variableName: string;
    fieldName: string;
    defaultValue: string;
    inputType?: string;
    options?: string[];
  }>;
  conversationContext?: string[];
  workflowName?: string;
  workflowDescription?: string;
}

interface ExtractVariablesResponse {
  extracted: Record<string, string>;
  confidence: Record<string, number>;
  ambiguous: string[];
  reasoning: string;
  error?: string;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// Main Handler
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const payload: ExtractVariablesRequest = await req.json();
    const { userQuery, variables, conversationContext, workflowName, workflowDescription } = payload;

    if (!userQuery || !variables || variables.length === 0) {
      return new Response(
        JSON.stringify({
          extracted: {},
          confidence: {},
          ambiguous: [],
          reasoning: 'Missing userQuery or variables',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`[ExtractVariables] Query: "${userQuery}", Variables: ${variables.length}`);

    // Build the extraction prompt
    const prompt = buildExtractionPrompt(userQuery, variables, conversationContext, workflowName, workflowDescription);

    // Call Gemini API
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
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
      console.error('[ExtractVariables] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();

    // Parse response
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = parseExtractionResponse(responseText, variables);

    const duration = Date.now() - startTime;
    console.log(`[ExtractVariables] Completed in ${duration}ms, extracted ${Object.keys(result.extracted).length} values`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[ExtractVariables] Error:', error);
    return new Response(
      JSON.stringify({
        extracted: {},
        confidence: {},
        ambiguous: [],
        reasoning: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// ============================================================================
// Prompt Building
// ============================================================================

function buildExtractionPrompt(
  userQuery: string,
  variables: ExtractVariablesRequest['variables'],
  conversationContext?: string[],
  workflowName?: string,
  workflowDescription?: string
): string {
  // Build variable descriptions
  const variableDescriptions = variables.map((v, i) => {
    const parts = [`${i + 1}. Variable: "${v.variableName}"`];
    parts.push(`   Field: "${v.fieldName}"`);
    parts.push(`   Type: ${v.inputType || 'text'}`);

    if (v.defaultValue) {
      parts.push(`   Default: "${v.defaultValue}"`);
    }

    if (v.options && v.options.length > 0) {
      parts.push(`   Options: ${v.options.map(o => `"${o}"`).join(', ')}`);
    }

    return parts.join('\n');
  }).join('\n\n');

  const contextSection = conversationContext && conversationContext.length > 0
    ? `## Conversation Context (for reference resolution)
${conversationContext.map((c, i) => `${i + 1}. "${c}"`).join('\n')}
`
    : '';

  const workflowSection = workflowName || workflowDescription
    ? `## Workflow Context
${workflowName ? `Name: "${workflowName}"` : ''}
${workflowDescription ? `Description: ${workflowDescription}` : ''}
`
    : '';

  return `You are a variable extraction system. Extract variable values from a user's natural language query.

## User Query
"${userQuery}"

${workflowSection}
${contextSection}

## Variables to Extract
${variableDescriptions}

## Extraction Rules

1. **Extract explicit values**: Look for values directly stated in the query
   - "for Acme Corp" → company = "Acme Corp"
   - "worth $50k" → amount = "$50k" or "50000"
   - "50 thousand" → amount = "50000"

2. **Handle reordering**: Values can appear in any order
   - "worth $50k, create opportunity for Acme" → amount=$50k, company=Acme

3. **Resolve references**: Use conversation context for pronouns
   - "create opportunity for them" → check context for company name
   - "use the same amount" → check context for amount

4. **Fuzzy amounts**: Convert natural language to values
   - "fifty thousand" → 50000
   - "5k" → 5000
   - "$1.5M" → 1500000

5. **Type matching**: If variable has options, match to closest option
   - If options are ["High", "Medium", "Low"] and query says "important", suggest "High"

6. **Mark ambiguous**: If multiple values could apply, mark as ambiguous
   - "create opportunity for Acme and Beta" → company is ambiguous

## Response Format

Respond with ONLY valid JSON (no markdown, no explanation):

{
  "extracted": {
    "variableName1": "extracted value",
    "variableName2": "extracted value"
  },
  "confidence": {
    "variableName1": 0.95,
    "variableName2": 0.7
  },
  "ambiguous": ["variableName3"],
  "reasoning": "Brief explanation of extraction logic"
}

Confidence levels:
- 0.9-1.0: Explicit, clear match
- 0.7-0.9: High confidence inference
- 0.5-0.7: Moderate confidence, might need confirmation
- 0.3-0.5: Low confidence guess
- 0.0-0.3: Very uncertain, likely wrong

If a variable cannot be extracted, don't include it in "extracted".`;
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseExtractionResponse(
  responseText: string,
  variables: ExtractVariablesRequest['variables']
): ExtractVariablesResponse {
  try {
    // Try to extract JSON from response
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate extracted values
    const extracted: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    const validVariableNames = new Set(variables.map(v => v.variableName));

    for (const [key, value] of Object.entries(parsed.extracted || {})) {
      if (validVariableNames.has(key) && value !== null && value !== undefined) {
        extracted[key] = String(value);
        confidence[key] = parsed.confidence?.[key] || 0.5;
      }
    }

    // Validate ambiguous list
    const ambiguous = (parsed.ambiguous || []).filter((v: string) => validVariableNames.has(v));

    return {
      extracted,
      confidence,
      ambiguous,
      reasoning: parsed.reasoning || 'Extraction completed',
    };
  } catch (error) {
    console.error('[ExtractVariables] Failed to parse response:', error);
    console.error('[ExtractVariables] Raw response:', responseText.substring(0, 500));

    return {
      extracted: {},
      confidence: {},
      ambiguous: [],
      reasoning: 'Failed to parse extraction results',
    };
  }
}
