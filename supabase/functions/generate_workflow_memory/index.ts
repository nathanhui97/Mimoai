/**
 * Generate Workflow Memory Edge Function
 *
 * Enhances a workflow memory with AI-powered analysis to fill gaps
 * and make the memory more human-like.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SYSTEM_PROMPT_SHORT, getSystemPromptForTask } from '../_shared/system-prompt.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkflowData {
  name: string;
  description?: string;
  steps: any[];
  variables?: any[];
  existingAnalysis?: any;
  learnedSkill?: any;
}

interface CurrentMemory {
  identity: any;
  understanding: any;
  inputs: any;
  triggers: any;
  pattern: any;
  success: any;
  adaptability: any;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { workflow, currentMemory } = await req.json() as {
      workflow: WorkflowData;
      currentMemory: CurrentMemory;
    };

    console.log(`[GenerateMemory] Enhancing memory for: ${workflow.name}`);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const prompt = buildEnhancementPrompt(workflow, currentMemory);

    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    };

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('[GenerateMemory] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse and merge the enhanced memory
    const enhanced = parseEnhancedMemory(responseText, currentMemory);

    const duration = Date.now() - startTime;
    console.log(`[GenerateMemory] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify(enhanced),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[GenerateMemory] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function buildEnhancementPrompt(workflow: WorkflowData, currentMemory: CurrentMemory): string {
  const systemContext = getSystemPromptForTask('generate_memory');

  const stepsDescription = workflow.steps.map((s, i) => {
    const desc = s.description || `${s.type} on ${s.label || 'element'}`;
    return `${i + 1}. ${desc}`;
  }).join('\n');

  const variablesDescription = (workflow.variables || []).map(v =>
    `- ${v.fieldName}: ${v.defaultValue || '(no default)'}`
  ).join('\n') || 'No variables detected';

  return `${systemContext}

You are an AI that creates human-like "memories" for automation workflows.

## Current Workflow

**Name:** ${workflow.name}
**Description:** ${workflow.description || 'Not provided'}

**Steps:**
${stepsDescription}

**Variables (inputs):**
${variablesDescription}

**Existing Analysis:**
${workflow.existingAnalysis ? JSON.stringify(workflow.existingAnalysis.workflowUnderstanding, null, 2) : 'None'}

**Learned Skill:**
${workflow.learnedSkill ? JSON.stringify({
  whatItDoes: workflow.learnedSkill.whatItDoes,
  canonicalAction: workflow.learnedSkill.canonicalAction,
  exampleQueries: workflow.learnedSkill.exampleQueries,
}, null, 2) : 'None'}

## Current Memory (to enhance)
${JSON.stringify(currentMemory, null, 2)}

## Your Task

Enhance the memory to be more human-like. Think about how a person would remember this task:

1. **Identity**: Is the purpose clear and concise? Improve it.
2. **Understanding**:
   - Write a better "elevator" pitch (one-liner)
   - Make sure phases are logical chunks (how humans think about steps)
   - Add relevant entities
3. **Inputs**:
   - Add better descriptions for each input field
   - Add extraction hints (words that help find this value in user input)
   - Add example values
4. **Triggers**:
   - Add more natural phrases users might say to invoke this
   - Add verb/object synonyms
5. **Pattern**:
   - Is this truly repeatable? (can handle "add Alice, Bob, Carol")
   - For data entry, what's the target strategy?
6. **Success**:
   - What specifically indicates success?
   - What indicates failure?

## Response Format

Return ONLY valid JSON with these fields (only include fields you want to change):

{
  "identity": {
    "purpose": "improved purpose",
    "domain": "improved domain if needed"
  },
  "understanding": {
    "elevator": "improved one-liner",
    "phases": [...],  // Only if you want to change phases
    "entities": ["entity1", "entity2"]
  },
  "inputs": {
    "required": [
      {
        "name": "Field Name",
        "description": "Better description",
        "extractionHints": ["hint1", "hint2"],
        "exampleValues": ["example1", "example2"]
      }
    ]
  },
  "triggers": {
    "phrases": ["phrase1", "phrase2", ...],
    "verbSynonyms": ["verb1", "verb2"],
    "objectSynonyms": ["obj1", "obj2"]
  },
  "pattern": {
    "type": "repeatable|single_entry|etc",
    "repetition": {
      "supportsMultiple": true,
      "separators": ["and", ","]
    },
    "dataEntry": {  // Only for data entry workflows
      "targetStrategy": "first_empty_row|fixed_location",
      "preservesExisting": true
    }
  },
  "success": {
    "indicators": [
      {
        "type": "toast_appears|text_appears|url_changes|...",
        "description": "What happens",
        "pattern": "regex or text to match",
        "priority": "primary|secondary|fallback"
      }
    ],
    "failureIndicators": ["indicator1", "indicator2"],
    "endState": "What the page looks like when done"
  }
}

Think carefully about what a human would naturally say when asking to run this workflow.`;
}

function parseEnhancedMemory(responseText: string, currentMemory: CurrentMemory): any {
  try {
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Deep merge the enhancements into current memory
    return deepMerge(currentMemory, parsed);
  } catch (error) {
    console.error('[GenerateMemory] Failed to parse response:', error);
    console.error('[GenerateMemory] Raw response:', responseText.substring(0, 500));
    return currentMemory; // Return unchanged on parse error
  }
}

function deepMerge(target: any, source: any): any {
  if (!source) return target;

  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;

    if (Array.isArray(source[key])) {
      // For arrays, replace entirely (don't merge)
      result[key] = source[key];
    } else if (typeof source[key] === 'object') {
      // For objects, deep merge
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      // For primitives, replace
      result[key] = source[key];
    }
  }

  return result;
}
