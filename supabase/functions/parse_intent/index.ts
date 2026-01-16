/**
 * Supabase Edge Function: parse_intent
 * Parses natural language user requests to extract intent for skill matching
 * Used by the AI Orchestrator to understand what the user wants to do
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  variables: string[];
}

interface ParseIntentRequest {
  userRequest: string;
  availableSkills: SkillInfo[];
  pageContext?: {
    url?: string;
    title?: string;
  };
}

interface ParsedIntent {
  action: string;
  objects: string[];
  parameters: Record<string, string>;
  context: string[];
  selectionMode?: 'first' | 'all' | 'matching' | 'count';
  count?: number;
  matchedSkillIds?: string[];
  confidence: number;
  isOffTopic?: boolean;
  offTopicReason?: string;
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
    const payload: ParseIntentRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.userRequest) {
      throw new Error('userRequest is required');
    }

    // Build prompt
    const prompt = buildParseIntentPrompt(payload);

    // Call Gemini API
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
    }

    const geminiData = await geminiResponse.json();
    const result = parseGeminiResponse(geminiData, payload.availableSkills);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in parse_intent:', error);
    return new Response(
      JSON.stringify({
        action: 'perform',
        objects: [],
        parameters: {},
        context: [],
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
 * Build the prompt for intent parsing
 */
function buildParseIntentPrompt(payload: ParseIntentRequest): string {
  const { userRequest, availableSkills, pageContext } = payload;

  let skillList = 'No skills available';
  if (availableSkills.length > 0) {
    skillList = availableSkills.map((s, i) =>
      `${i + 1}. "${s.name}" (id: ${s.id})
   Description: ${s.description}
   Variables: ${s.variables.join(', ') || 'none'}`
    ).join('\n');
  }

  return `You are an intent parser for a BROWSER AUTOMATION assistant. Your ONLY job is to parse requests for automating browser tasks.

USER REQUEST: "${userRequest}"

${pageContext?.url ? `CURRENT PAGE: ${pageContext.url}` : ''}
${pageContext?.title ? `PAGE TITLE: ${pageContext.title}` : ''}

AVAILABLE SKILLS (browser automation tasks I can perform):
${skillList}

═══════════════════════════════════════════════════════════════
IMPORTANT: SCOPE RESTRICTION
═══════════════════════════════════════════════════════════════

This assistant ONLY handles browser automation tasks like:
✓ Clicking buttons, links, elements
✓ Filling forms and input fields
✓ Selecting dropdown options
✓ Navigating to pages
✓ Submitting forms
✓ Creating/editing/deleting items in web apps
✓ Any task that involves interacting with a webpage

This assistant does NOT handle:
✗ General knowledge questions ("What is the capital of France?")
✗ Coding help ("Write me a Python script")
✗ Math problems ("What is 2+2?")
✗ Conversations ("Hello, how are you?")
✗ Explanations ("Explain quantum physics")
✗ Advice ("Should I buy a car?")
✗ Any non-browser-automation request

═══════════════════════════════════════════════════════════════

FIRST: Determine if this is a browser automation request.

If OFF-TOPIC (not browser automation), return:
{
  "isOffTopic": true,
  "offTopicReason": "<brief reason why this isn't a browser task>",
  "action": "",
  "objects": [],
  "parameters": {},
  "matchedSkillIds": [],
  "context": [],
  "confidence": 0
}

If VALID browser automation request, extract:

1. **action**: The browser action (click, fill, type, select, submit, create, add, delete, open, navigate, etc.)

2. **objects**: What UI elements they're acting on (button, form, field, dropdown, link, item, etc.)

3. **parameters**: Specific values mentioned. Map to skill variable names when possible.
   Examples:
   - "add honey mustard" → { "itemName": "honey mustard" }
   - "create BOGO for hot dogs" → { "promotionType": "BOGO", "item": "hot dogs" }
   - "fill name with John" → { "name": "John" }

4. **selectionMode**: How to handle multiple matches:
   - "first" - Select the first match (default)
   - "all" - Select ALL matching items (user says "all", "every", "each")
   - "matching" - Select items matching specific criteria
   - "count" - Select a specific number (user says "3 items", "5 products")

5. **count**: If selectionMode is "count", extract the number

6. **matchedSkillIds**: Which skill IDs from the list match this request?

7. **context**: Inferred context (page type needed, etc.)

RETURN JSON for valid requests:
{
  "isOffTopic": false,
  "action": "<browser action verb>",
  "objects": ["<UI element>"],
  "parameters": { "<var>": "<value>" },
  "selectionMode": "<first|all|matching|count or null>",
  "count": <number or null>,
  "matchedSkillIds": ["<skillId>"],
  "context": ["<context>"],
  "confidence": <0.0-1.0>
}`;
}

/**
 * Parse Gemini response into ParsedIntent
 */
function parseGeminiResponse(geminiData: any, availableSkills: SkillInfo[]): ParsedIntent {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Check if off-topic
    if (parsed.isOffTopic === true) {
      return {
        action: '',
        objects: [],
        parameters: {},
        context: [],
        confidence: 0,
        isOffTopic: true,
        offTopicReason: parsed.offTopicReason || 'This request is not related to browser automation.',
      };
    }

    // Validate matchedSkillIds
    const validSkillIds = availableSkills.map(s => s.id);
    const matchedSkillIds = Array.isArray(parsed.matchedSkillIds)
      ? parsed.matchedSkillIds.filter((id: string) => validSkillIds.includes(id))
      : [];

    return {
      action: typeof parsed.action === 'string' ? parsed.action : 'perform',
      objects: Array.isArray(parsed.objects) ? parsed.objects : [],
      parameters: typeof parsed.parameters === 'object' && parsed.parameters !== null
        ? parsed.parameters
        : {},
      context: Array.isArray(parsed.context) ? parsed.context : [],
      selectionMode: ['first', 'all', 'matching', 'count'].includes(parsed.selectionMode)
        ? parsed.selectionMode
        : undefined,
      count: typeof parsed.count === 'number' ? parsed.count : undefined,
      matchedSkillIds,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      isOffTopic: false,
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      action: 'perform',
      objects: [],
      parameters: {},
      context: [],
      confidence: 0,
      isOffTopic: false,
    };
  }
}
