/**
 * Smart Input Handler Edge Function
 * 
 * Combines Parametric Replay and Data Transformation into a single AI call.
 * 
 * Receives:
 * - step: The workflow step being executed
 * - originalValue: The value recorded during recording
 * - newValue: The new variable value (or original if no variable)
 * 
 * Returns:
 * - transformedValue: The formatted value to use
 * - interactionMethod: How to interact (type, select, click, auto)
 * - confidence: Confidence score
 * - reasoning: Explanation of changes
 * - needsTransformation: Whether transformation was needed
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

serve(async (req) => {
  try {
    const { step, originalValue, newValue } = await req.json();

    if (!step || newValue === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: step, newValue' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If new value equals original value, no transformation needed
    if (newValue === originalValue) {
      return new Response(
        JSON.stringify({
          transformedValue: newValue,
          interactionMethod: 'type',
          confidence: 1,
          reasoning: 'No change from original value',
          needsTransformation: false,
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build prompt for AI
    const prompt = buildPrompt(step, originalValue, newValue);

    // Call Gemini API
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse AI response
    const result = parseAIResponse(aiResponse, newValue);

    return new Response(
      JSON.stringify(result),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Smart input handler error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        transformedValue: newValue || '',
        interactionMethod: 'type',
        confidence: 0,
        reasoning: 'AI processing failed',
        needsTransformation: false,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

function buildPrompt(step: any, originalValue: string, newValue: string): string {
  const fieldType = step.payload?.inputDetails?.type || 'text';
  const label = step.payload?.label || 'field';
  const elementText = step.payload?.elementText || '';
  const hasVisualSnapshot = !!step.payload?.visualSnapshot?.elementSnippet;

  return `You are a smart input handler that processes form field values for automation.

Context:
- Field Type: ${fieldType}
- Field Label: ${label}
- Element Text: ${elementText || 'N/A'}
- Original Value: "${originalValue}"
- New Value: "${newValue}"
${hasVisualSnapshot ? '- Visual snapshot available (element context)' : ''}

Tasks:
1. Determine if the interaction method needs to change (e.g., dropdown → typing, typing → dropdown)
2. Transform the data format if needed (e.g., "John Smith" → split into first/last name, date format conversion)

Return JSON only:
{
  "transformedValue": "the formatted value to use",
  "interactionMethod": "type|select|click|auto",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "needsTransformation": true/false
}

Examples:
- If newValue is a dropdown option that exists: interactionMethod="select", transformedValue=newValue
- If newValue needs date format conversion: transformedValue="12/12/2025" (from "Dec 12, 2025")
- If newValue needs name splitting: transformedValue="John" (for first name field)
- If no transformation needed: needsTransformation=false, transformedValue=newValue

Respond with JSON only, no markdown.`;
}

function parseAIResponse(aiResponse: string, fallbackValue: string): any {
  try {
    // Try to extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        transformedValue: parsed.transformedValue || fallbackValue,
        interactionMethod: ['type', 'select', 'click', 'auto'].includes(parsed.interactionMethod)
          ? parsed.interactionMethod
          : 'auto',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: parsed.reasoning || '',
        needsTransformation: parsed.needsTransformation !== false,
      };
    }
  } catch (error) {
    console.warn('Failed to parse AI response:', error);
  }

  // Fallback
  return {
    transformedValue: fallbackValue,
    interactionMethod: 'type',
    confidence: 0.3,
    reasoning: 'AI response parsing failed',
    needsTransformation: false,
  };
}




