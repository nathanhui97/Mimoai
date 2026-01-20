/**
 * Semantic Workflow Matching Edge Function (Phase 1)
 *
 * Matches user queries to workflows using LLM-powered semantic understanding.
 * Handles:
 * - "log my expenses" → "Create expense report in QuickBooks"
 * - "create opportunity for Acme" → extracts company name as variable
 * - Ambiguous queries → returns clarifying questions
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { SYSTEM_PROMPT_SHORT, getSystemPromptForTask } from '../_shared/system-prompt.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 3.0 Flash for text-based reasoning
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// ============================================================================
// Types
// ============================================================================

interface SemanticMatchRequest {
  userQuery: string;
  workflows: Array<{
    id: string;
    name: string;
    description?: string;
    primaryGoal?: string;

    // Legacy fields (from scattered workflow data)
    learnedSkill?: {
      whatItDoes: string;
      canonicalAction: {
        verb: string;
        object: string;
        verbSynonyms: string[];
        objectSynonyms: string[];
      };
      exampleQueries: string[];
    };
    variableFields?: string[];

    // New memory-based fields (unified understanding)
    category?: string;           // Task category (data_entry, navigation, etc.)
    domain?: string;             // Application domain (Salesforce, Google Sheets, etc.)
    triggerPhrases?: string[];   // Designed trigger phrases for matching
    verbSynonyms?: string[];     // Verb synonyms from memory
    objectSynonyms?: string[];   // Object synonyms from memory
    inputDescriptions?: Array<{  // Rich input field descriptions
      name: string;
      description: string;
      type: string;
      extractionHints: string[];
    }>;
    patternType?: string;        // single_entry, repeatable, etc.
    supportsMultiple?: boolean;  // Can handle "add Alice, Bob, Carol"
    notWhen?: string[];          // Exclusion conditions for disambiguation
  }>;
  pageContext?: {
    url: string;
    title: string;
  };
}

interface WorkflowMatch {
  workflowId: string;
  confidence: number;
  reasoning: string;
  confidenceBreakdown: {
    intentAlignment: number;
    verbObjectMatch: number;
    exampleSimilarity: number;
    domainRelevance: number;
  };
  extractedVariables?: Record<string, string>;
}

interface SemanticMatchResponse {
  matches: WorkflowMatch[];
  clarificationNeeded?: {
    reason: string;
    suggestedQuestion: string;
  };
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
    const payload: SemanticMatchRequest = await req.json();
    const { userQuery, workflows, pageContext } = payload;

    if (!userQuery || !workflows || workflows.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing userQuery or workflows', matches: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`[SemanticMatch] Query: "${userQuery}", Workflows: ${workflows.length}`);

    // Build the matching prompt
    const prompt = buildMatchingPrompt(userQuery, workflows, pageContext);

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
        maxOutputTokens: 2048,
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
      console.error('[SemanticMatch] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();

    // Parse response
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const result = parseMatchResponse(responseText, workflows);

    const duration = Date.now() - startTime;
    console.log(`[SemanticMatch] Completed in ${duration}ms, ${result.matches.length} matches found`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[SemanticMatch] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        matches: [],
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// ============================================================================
// Prompt Building
// ============================================================================

function buildMatchingPrompt(
  userQuery: string,
  workflows: SemanticMatchRequest['workflows'],
  pageContext?: SemanticMatchRequest['pageContext']
): string {
  // Build workflow descriptions - use memory-based fields when available
  const workflowDescriptions = workflows.map((w, i) => {
    const parts = [`${i + 1}. ID: "${w.id}"\n   Name: "${w.name}"`];

    // Check if this workflow has memory-based fields (triggerPhrases is a key indicator)
    const hasMemory = w.triggerPhrases && w.triggerPhrases.length > 0;

    if (hasMemory) {
      // Use rich memory-based data
      if (w.description) {
        parts.push(`   Purpose: ${w.description}`);
      }

      if (w.primaryGoal) {
        parts.push(`   Summary: ${w.primaryGoal}`);
      }

      if (w.category) {
        parts.push(`   Category: ${w.category}`);
      }

      if (w.domain) {
        parts.push(`   Domain: ${w.domain}`);
      }

      // Trigger phrases are crucial for matching
      if (w.triggerPhrases.length > 0) {
        parts.push(`   Trigger phrases: "${w.triggerPhrases.join('", "')}"`);
      }

      // Synonyms for semantic matching
      if (w.verbSynonyms && w.verbSynonyms.length > 0) {
        parts.push(`   Verb synonyms: ${w.verbSynonyms.join(', ')}`);
      }

      if (w.objectSynonyms && w.objectSynonyms.length > 0) {
        parts.push(`   Object synonyms: ${w.objectSynonyms.join(', ')}`);
      }

      // Input fields with extraction hints
      if (w.inputDescriptions && w.inputDescriptions.length > 0) {
        const inputsStr = w.inputDescriptions.map(inp =>
          `${inp.name} (${inp.type}): ${inp.description} [hints: ${inp.extractionHints.slice(0, 3).join(', ')}]`
        ).join('; ');
        parts.push(`   Required inputs: ${inputsStr}`);
      }

      // Pattern info
      if (w.patternType) {
        parts.push(`   Pattern: ${w.patternType}${w.supportsMultiple ? ' (supports multiple items)' : ''}`);
      }

      // Exclusions for disambiguation
      if (w.notWhen && w.notWhen.length > 0) {
        parts.push(`   NOT for: ${w.notWhen.join(', ')}`);
      }
    } else {
      // Fall back to legacy scattered data
      if (w.description) {
        parts.push(`   Description: ${w.description}`);
      }

      if (w.primaryGoal) {
        parts.push(`   Goal: ${w.primaryGoal}`);
      }

      if (w.learnedSkill) {
        parts.push(`   What it does: ${w.learnedSkill.whatItDoes}`);
        parts.push(`   Action: ${w.learnedSkill.canonicalAction.verb} ${w.learnedSkill.canonicalAction.object}`);

        if (w.learnedSkill.canonicalAction.verbSynonyms.length > 0) {
          parts.push(`   Verb synonyms: ${w.learnedSkill.canonicalAction.verbSynonyms.join(', ')}`);
        }

        if (w.learnedSkill.canonicalAction.objectSynonyms.length > 0) {
          parts.push(`   Object synonyms: ${w.learnedSkill.canonicalAction.objectSynonyms.join(', ')}`);
        }

        if (w.learnedSkill.exampleQueries.length > 0) {
          parts.push(`   Example queries: "${w.learnedSkill.exampleQueries.join('", "')}"`);
        }
      }

      // Include user-renamed variable fields (e.g., Name, Email, Phone for spreadsheet workflows)
      if (w.variableFields && w.variableFields.length > 0) {
        parts.push(`   Variables/Fields: ${w.variableFields.join(', ')}`);
      }
    }

    return parts.join('\n');
  }).join('\n\n');

  const systemContext = getSystemPromptForTask('match_workflow');

  return `${systemContext}

You are a semantic workflow matcher. Your job is to match a user's natural language query to the most relevant workflow(s).

## User Query
"${userQuery}"

${pageContext ? `## Current Page Context
URL: ${pageContext.url}
Title: ${pageContext.title}
` : ''}

## Available Workflows
${workflowDescriptions}

## Your Task

For EACH workflow, compute a confidence score (0.0 to 1.0) based on:

1. **Intent Alignment (0-0.4)**: Does the query's goal match the workflow's purpose?
   - Direct match: 0.35-0.4
   - Similar intent: 0.2-0.35
   - Loosely related: 0.1-0.2
   - Unrelated: 0-0.1

2. **Verb/Object Match (0-0.3)**: Semantic similarity of action verbs and objects
   - Exact or synonym match: 0.25-0.3
   - Related verbs/objects: 0.15-0.25
   - Weak relation: 0.05-0.15
   - No match: 0-0.05

3. **Example Similarity (0-0.2)**: How similar is the query to the workflow's example queries?
   - Very similar to examples: 0.15-0.2
   - Moderately similar: 0.08-0.15
   - Slightly similar: 0.02-0.08
   - Not similar: 0-0.02

4. **Domain Relevance (0-0.1)**: Is the workflow relevant to the current page context?
   - Same domain/app: 0.08-0.1
   - Related domain: 0.04-0.08
   - Generic/universal: 0.02-0.04
   - Unrelated: 0-0.02

**Total confidence = sum of all components (max 1.0)**

## Special Rules

1. If the top 2 matches are within 0.1 confidence of each other, set clarificationNeeded
2. Extract any obvious variable values from the query (company names, amounts, dates)
3. Return workflows sorted by confidence (highest first)
4. Only return workflows with confidence >= 0.3

## Response Format

Respond with ONLY valid JSON (no markdown, no explanation):

{
  "matches": [
    {
      "workflowId": "workflow-id-here",
      "confidence": 0.85,
      "reasoning": "Brief explanation of why this matches",
      "confidenceBreakdown": {
        "intentAlignment": 0.35,
        "verbObjectMatch": 0.25,
        "exampleSimilarity": 0.15,
        "domainRelevance": 0.1
      },
      "extractedVariables": {
        "company": "Acme Corp",
        "amount": "$50k"
      }
    }
  ],
  "clarificationNeeded": {
    "reason": "Top 2 matches are very close",
    "suggestedQuestion": "Did you mean X or Y?"
  }
}

If no workflows match (all confidence < 0.3), return:
{
  "matches": [],
  "clarificationNeeded": {
    "reason": "No matching workflows found",
    "suggestedQuestion": "I don't know how to do that. Would you like to teach me?"
  }
}`;
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseMatchResponse(
  responseText: string,
  workflows: SemanticMatchRequest['workflows']
): SemanticMatchResponse {
  try {
    // Try to extract JSON from response
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and normalize matches
    const matches: WorkflowMatch[] = (parsed.matches || [])
      .filter((m: any) => {
        // Verify workflow ID exists
        return m.workflowId && workflows.some(w => w.id === m.workflowId);
      })
      .map((m: any) => ({
        workflowId: m.workflowId,
        confidence: Math.min(1, Math.max(0, m.confidence || 0)),
        reasoning: m.reasoning || 'No reasoning provided',
        confidenceBreakdown: {
          intentAlignment: m.confidenceBreakdown?.intentAlignment || 0,
          verbObjectMatch: m.confidenceBreakdown?.verbObjectMatch || 0,
          exampleSimilarity: m.confidenceBreakdown?.exampleSimilarity || 0,
          domainRelevance: m.confidenceBreakdown?.domainRelevance || 0,
        },
        extractedVariables: m.extractedVariables || undefined,
      }))
      .sort((a: WorkflowMatch, b: WorkflowMatch) => b.confidence - a.confidence);

    return {
      matches,
      clarificationNeeded: parsed.clarificationNeeded,
    };
  } catch (error) {
    console.error('[SemanticMatch] Failed to parse response:', error);
    console.error('[SemanticMatch] Raw response:', responseText.substring(0, 500));

    // Return empty matches on parse error
    return {
      matches: [],
      clarificationNeeded: {
        reason: 'Failed to parse matching results',
        suggestedQuestion: 'Could you rephrase your request?',
      },
    };
  }
}
