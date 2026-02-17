/**
 * Supabase Edge Function: page_planner
 *
 * Takes a DOM map + batch of remaining hints and produces a PagePlan
 * that maps each hint to its target DOM element with an execution strategy.
 *
 * This is called ONCE per page (not per step), dramatically reducing LLM calls.
 * The resulting plan is executed deterministically by the PlanExecutor.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v1.0.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

console.log('page_planner Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface PlannerHint {
  index: number;
  stepNumber: number;
  description: string;
  actionType: string;
  targetText?: string;
  targetRole?: string;
  targetPlaceholder?: string;
  value?: string;
  recordedSelector?: string;
  recordedAriaLabel?: string;
  nearbyText?: string[];
  naturalLanguage?: {
    intent: string;
    precondition: string;
    expectedOutcome: string;
    dependencies: number[];
  };
  decisionSpace?: {
    type?: string;
    selectedText?: string;
    options?: string[];
  };
}

interface PageContext {
  url: string;
  title: string;
  hasModal: boolean;
  modalTitle?: string;
  formFields: Array<{ name: string; value?: string; type: string }>;
  buttonCount: number;
  linkCount: number;
  inputCount: number;
  headings: string[];
}

interface PlannerRequest {
  domMap: string;
  pageContext: PageContext;
  hints: PlannerHint[];
  variableValues?: Record<string, string>;
  goal?: string;
}

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPrompt(req: PlannerRequest): string {
  const { domMap, pageContext, hints, variableValues, goal } = req;

  // Build hints section
  const hintsSection = hints.map(h => {
    let line = `  Step ${h.stepNumber} (index: ${h.index}): ${h.description}`;
    if (h.actionType === 'type' && h.value) {
      const resolvedValue = variableValues?.[h.value] || h.value;
      line += ` → value: "${resolvedValue}"`;
    }
    if (h.targetText) line += ` [target text: "${h.targetText}"]`;
    if (h.targetRole) line += ` [role: ${h.targetRole}]`;
    if (h.targetPlaceholder) line += ` [placeholder: "${h.targetPlaceholder}"]`;
    if (h.recordedAriaLabel) line += ` [aria-label: "${h.recordedAriaLabel}"]`;
    if (h.recordedSelector) line += ` [recorded selector: ${h.recordedSelector}]`;
    if (h.decisionSpace?.options) line += ` [options: ${h.decisionSpace.options.join(', ')}]`;
    if (h.naturalLanguage?.intent) line += `\n    Intent: ${h.naturalLanguage.intent}`;
    return line;
  }).join('\n');

  // Variable values section
  const variablesSection = variableValues && Object.keys(variableValues).length > 0
    ? `\nVariable Values (use these instead of recorded values):\n${Object.entries(variableValues).map(([k, v]) => `  ${k} = "${v}"`).join('\n')}`
    : '';

  return `You are a page planner for a browser automation tool. Your job is to analyze the current page DOM and map a batch of workflow steps to specific DOM elements.

## Context
${goal ? `Workflow Goal: ${goal}` : ''}
Current URL: ${pageContext.url}
Page Title: ${pageContext.title}
${pageContext.hasModal ? `Active Modal: ${pageContext.modalTitle || 'unnamed'}` : ''}
Interactive Elements: ${pageContext.inputCount} inputs, ${pageContext.buttonCount} buttons, ${pageContext.linkCount} links
Headings: ${pageContext.headings.join(' > ') || 'none'}

## Steps to Plan
${hintsSection}
${variablesSection}

## Current DOM Map
${domMap}

## Instructions

Analyze the DOM map and create an execution plan that maps each step to the correct DOM element.

For each step, determine:
1. Which element in the DOM map corresponds to this step
2. The best CSS selector to find it
3. The execution strategy (type, select, click, checkbox, typeahead, inline_edit, date_picker)
4. Whether the value needs to be resolved from variables

Classify the page as: form, list, detail, confirmation, error, navigation, or other.

## Response Format

Respond with ONLY valid JSON (no markdown, no explanation outside JSON):

{
  "pageType": "form",
  "confidence": 0.85,
  "reasoning": "Form page with 5 input fields matching the recording steps",
  "fieldActions": [
    {
      "fieldName": "First Name",
      "value": "John",
      "elementIndex": 3,
      "selector": "#firstName",
      "strategy": "type",
      "required": true,
      "hintIndex": 2,
      "clearFirst": false
    }
  ],
  "navigationActions": [
    {
      "description": "Click New button",
      "elementIndex": 0,
      "selector": "button.new-btn",
      "expectsNavigation": true,
      "expectsModal": false,
      "hintIndex": 0
    }
  ],
  "submitAction": {
    "elementIndex": 10,
    "selector": "button[type=submit]",
    "waitAfterMs": 1000,
    "hintIndex": 7
  },
  "successCheck": {
    "type": "url_change",
    "pattern": "/contacts/"
  }
}

IMPORTANT:
- Use the element's INDEX from the DOM map for elementIndex
- Use the most reliable selector (prefer data-testid, id, aria-label, name over positional)
- For select/dropdown strategy, include optionText with the exact option to select
- If a step doesn't map to any element on this page, OMIT it from the plan
- For type actions with variable values, use the resolved variable value
- Set clearFirst: true only if the field has an existing value that should be replaced
- confidence should reflect how well you could map the steps (1.0 = all mapped, 0.5 = some unclear)`;
}

// ============================================================================
// Handler
// ============================================================================

serve(async (req: Request) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const body: PlannerRequest = await req.json();

    if (!body.domMap || !body.hints || body.hints.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing domMap or hints' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const prompt = buildPrompt(body);

    console.log(`[page_planner] Planning for ${body.hints.length} hints on ${body.pageContext?.url}`);

    // Call Gemini
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.1,  // Low temperature for consistent planning
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`[page_planner] Gemini API error: ${geminiResponse.status}`, errorText);
      return new Response(JSON.stringify({ error: `Gemini API error: ${geminiResponse.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const geminiResult = await geminiResponse.json();

    // Extract response text
    const responseText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      console.error('[page_planner] Empty response from Gemini');
      return new Response(JSON.stringify({ error: 'Empty response from AI' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Parse JSON response
    let plan;
    try {
      // Strip markdown code fences if present
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      plan = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('[page_planner] Failed to parse plan JSON:', responseText.substring(0, 200));
      return new Response(JSON.stringify({ error: 'Failed to parse AI response as JSON' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    console.log(`[page_planner] Plan generated: ${plan.fieldActions?.length || 0} fields, ${plan.navigationActions?.length || 0} nav, type=${plan.pageType}`);

    return new Response(JSON.stringify({ plan, version: VERSION }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('[page_planner] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
