/**
 * Supabase Edge Function: analyze_intent
 * Analyzes workflow steps to understand user intent
 * Uses Gemini API for human-like intent understanding
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface WorkflowMetadata {
  id: string;
  name: string;
  stepCount: number;
}

interface StepPayload {
  action: {
    type: string;
    url: string;
  };
  semanticContext?: any;
  elementContext?: any;
  pageContext?: any;
  visualSnapshot?: {
    viewport?: string;
    elementSnippet?: string;
  };
}

interface AnalyzeIntentRequest {
  workflow: WorkflowMetadata;
  steps: StepPayload[];
  pattern?: {
    type: string;
    sequenceType?: string;
    confidence: number;
  };
}

interface AnalyzedIntent {
  primaryGoal: string;
  subGoals: string[];
  expectedOutcome: string;
  visualConfirmation?: string;
  confidence: number;
  failurePatterns?: Array<{
    description: string;
    visualIndicator?: string;
    recovery?: string;
  }>;
}

interface AnalyzeIntentResponse {
  intent: AnalyzedIntent;
  suggestions?: string[];
  confidence: number;
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
    const payload: AnalyzeIntentRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.workflow || !payload.steps?.length) {
      throw new Error('Workflow and steps are required');
    }

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for intent analysis:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build prompt
    const prompt = buildIntentPrompt(payload);

    // Build Gemini API request
    const geminiRequest: any = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      }
    };

    // Add visual snapshots if available (limit to first and last step to save tokens)
    if (payload.steps.length > 0) {
      const firstStep = payload.steps[0];
      const lastStep = payload.steps[payload.steps.length - 1];
      
      if (firstStep.visualSnapshot?.elementSnippet) {
        const base64 = extractBase64Data(firstStep.visualSnapshot.elementSnippet);
        geminiRequest.contents[0].parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64
          }
        });
      }
      
      if (payload.steps.length > 1 && lastStep.visualSnapshot?.elementSnippet) {
        const base64 = extractBase64Data(lastStep.visualSnapshot.elementSnippet);
        geminiRequest.contents[0].parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64
          }
        });
      }
    }

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
    const result = parseGeminiResponse(geminiData);

    // Cache the result (30 minute TTL)
    await saveToCache(supabase, cacheKey, result, 30 * 60);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in analyze_intent:', error);
    return new Response(
      JSON.stringify({
        intent: {
          primaryGoal: 'Unknown goal',
          subGoals: [],
          expectedOutcome: 'Unknown outcome',
          confidence: 0,
        },
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

/**
 * Build intent analysis prompt
 */
function buildIntentPrompt(payload: AnalyzeIntentRequest): string {
  const { workflow, steps, pattern } = payload;
  
  let prompt = `Analyze this recorded browser workflow to understand the user's intent.

WORKFLOW INFO:
- Name: "${workflow.name}"
- Steps: ${workflow.stepCount}
${pattern ? `- Pattern: ${pattern.type} (${pattern.sequenceType || 'none'}) with ${(pattern.confidence * 100).toFixed(0)}% confidence` : ''}

RECORDED STEPS:
`;

  // Describe each step
  steps.forEach((step, index) => {
    prompt += `\n${index + 1}. ${step.action.type} on ${new URL(step.action.url).hostname}`;
    
    if (step.semanticContext?.gridCoordinates) {
      const grid = step.semanticContext.gridCoordinates;
      prompt += `\n   - Grid cell: ${grid.cellReference || 'unknown'}`;
      if (grid.columnHeader) prompt += ` (column: "${grid.columnHeader}")`;
    }
    
    if (step.semanticContext?.formCoordinates) {
      const form = step.semanticContext.formCoordinates;
      prompt += `\n   - Form field: "${form.label || 'unknown'}"`;
      if (form.section) prompt += ` in section "${form.section}"`;
    }
    
    if (step.semanticContext?.decisionSpace) {
      const decision = step.semanticContext.decisionSpace;
      prompt += `\n   - Selected: "${decision.selectedText}" from dropdown`;
    }
    
    if (step.semanticContext?.buttonContext) {
      const button = step.semanticContext.buttonContext;
      prompt += `\n   - Button: "${button.label || 'unknown'}"`;
      if (button.section) prompt += ` in "${button.section}" section`;
    }
    
    if (step.elementContext?.text) {
      prompt += `\n   - Element text: "${step.elementContext.text.substring(0, 50)}"`;
    }
    
    if (step.elementContext?.value) {
      prompt += `\n   - Entered value: "${step.elementContext.value.substring(0, 30)}"`;
    }
  });

  prompt += `

${steps.length > 0 && steps[0].visualSnapshot ? '\nVISUAL CONTEXT:\n- First step screenshot provided as image 1' : ''}
${steps.length > 1 && steps[steps.length - 1].visualSnapshot ? '\n- Last step screenshot provided as image 2' : ''}

ANALYZE AND RETURN JSON:
{
  "intent": {
    "primaryGoal": "<What is the user trying to accomplish? Be specific and concise>",
    "subGoals": ["<Step 1 goal>", "<Step 2 goal>", ...],
    "expectedOutcome": "<What should happen when workflow completes successfully?>",
    "visualConfirmation": "<What would the success state look like visually?>",
    "confidence": <0-1>,
    "failurePatterns": [
      {
        "description": "<What could go wrong>",
        "visualIndicator": "<What would failure look like?>",
        "recovery": "<How to recover from this failure>"
      }
    ]
  },
  "suggestions": ["<Improvement suggestion 1>", "<Improvement suggestion 2>"],
  "confidence": <overall confidence 0-1>
}

GUIDELINES:
- Be specific about the PRIMARY GOAL (e.g., "Fill out invoice form and submit" not "Fill form")
- List sub-goals in order of execution
- Describe expected outcome in user-friendly terms
- Include 2-3 likely failure patterns
- Provide actionable suggestions for improving reliability`;

  return prompt;
}

/**
 * Generate cache key
 */
function generateCacheKey(payload: AnalyzeIntentRequest): string {
  const keyData = {
    type: 'intent_analysis',
    workflowId: payload.workflow.id,
    stepCount: payload.workflow.stepCount,
    patternType: payload.pattern?.type,
    firstStepType: payload.steps[0]?.action.type,
    lastStepType: payload.steps[payload.steps.length - 1]?.action.type,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `intent_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<AnalyzeIntentResponse | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    if (new Date(data.expires_at) < new Date()) {
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as AnalyzeIntentResponse;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save to cache
 */
async function saveToCache(
  supabase: any,
  cacheKey: string,
  result: AnalyzeIntentResponse,
  ttlSeconds: number = 1800
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);

    await supabase
      .from('ai_cache')
      .upsert({
        cache_key: cacheKey,
        response_data: result,
        expires_at: expiresAt.toISOString(),
      });
  } catch (e) {
    console.error('Cache save error:', e);
  }
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

/**
 * Parse Gemini response
 */
function parseGeminiResponse(geminiData: any): AnalyzeIntentResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      intent: {
        primaryGoal: parsed.intent?.primaryGoal || 'Unknown goal',
        subGoals: Array.isArray(parsed.intent?.subGoals) ? parsed.intent.subGoals : [],
        expectedOutcome: parsed.intent?.expectedOutcome || 'Unknown outcome',
        visualConfirmation: parsed.intent?.visualConfirmation,
        confidence: typeof parsed.intent?.confidence === 'number' ? parsed.intent.confidence : 0,
        failurePatterns: Array.isArray(parsed.intent?.failurePatterns) 
          ? parsed.intent.failurePatterns.map((p: any) => ({
              description: p.description || '',
              visualIndicator: p.visualIndicator,
              recovery: p.recovery,
            }))
          : [],
      },
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      intent: {
        primaryGoal: 'Could not analyze intent',
        subGoals: [],
        expectedOutcome: 'Unknown',
        confidence: 0,
      },
      confidence: 0,
    };
  }
}










