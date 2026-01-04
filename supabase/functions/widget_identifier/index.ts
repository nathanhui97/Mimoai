/**
 * Supabase Edge Function: widget_identifier
 * 
 * Uses AI vision to identify what widget/panel/card contains the clicked element.
 * Called during RECORDING to capture precise widget context for reliable execution.
 * 
 * This is much more reliable than CSS heuristics because AI can:
 * 1. See the visual structure of the page
 * 2. Read titles even in Shadow DOM
 * 3. Understand the semantic meaning of containers
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v1.0.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

console.log('widget_identifier Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface WidgetIdentifierRequest {
  /** Base64 screenshot of the viewport (or cropped area around the element) */
  screenshot: string;
  /** Description of the clicked element */
  elementDescription: string;
  /** Approximate position of the element in the screenshot (optional) */
  elementPosition?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Nearby HTML context (sanitized, optional) */
  htmlContext?: string;
  /** Page URL for context */
  pageUrl?: string;
}

interface WidgetIdentifierResponse {
  /** Exact title/heading of the widget as seen in the screenshot */
  widgetTitle: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Description of the widget for debugging */
  widgetDescription?: string;
  /** Visual position description (e.g., "top-left", "center") */
  visualPosition?: string;
  /** Unique visual features for additional matching */
  uniqueFeatures?: string[];
  /** If no widget container was identified */
  noWidgetFound?: boolean;
  /** Raw reasoning from AI */
  reasoning: string;
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
    console.log('widget_identifier', VERSION, 'received request');
    const payload: WidgetIdentifierRequest = await req.json();
    
    console.log('Element description:', payload.elementDescription);
    console.log('Has screenshot:', !!payload.screenshot);
    console.log('Screenshot length:', payload.screenshot?.length || 0);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.screenshot) {
      throw new Error('Screenshot is required');
    }

    // Build the prompt
    const prompt = buildPrompt(payload);
    
    // Extract base64 data
    const base64Data = extractBase64Data(payload.screenshot);
    if (!base64Data) {
      throw new Error('Invalid screenshot format');
    }
    
    const mimeType = detectMimeType(payload.screenshot);
    
    // Build Gemini request with vision
    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1, // Low temperature for consistency
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    };

    // Call Gemini API
    console.log('Calling Gemini Vision API...');
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
    console.log('Gemini response received');

    // Parse response
    const response = parseGeminiResponse(geminiResult);
    console.log('Widget identified:', response.widgetTitle, 'Confidence:', response.confidence);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('widget_identifier error:', error);
    return new Response(JSON.stringify({
      widgetTitle: '',
      confidence: 0,
      noWidgetFound: true,
      reasoning: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
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

function buildPrompt(payload: WidgetIdentifierRequest): string {
  const positionHint = payload.elementPosition 
    ? `The element is approximately at position (${payload.elementPosition.x}, ${payload.elementPosition.y}) with size ${payload.elementPosition.width}x${payload.elementPosition.height} pixels.`
    : '';

  return `You are analyzing a screenshot to identify which WIDGET, CARD, PANEL, or SECTION contains a specific element.

## Context
The user clicked on: ${payload.elementDescription}
${positionHint}
${payload.pageUrl ? `Page URL: ${payload.pageUrl}` : ''}

## Your Task
Look at the screenshot and identify the CONTAINER (widget/card/panel/section) that contains the clicked element.

Focus on finding:
1. **The TITLE or HEADING** of the container - this is the most important piece of information
2. Widget cards, dashboard panels, report sections, or data tables
3. Look for headings (H1-H6), bold text, or text at the top of a visually distinct box/container

## Rules
- Return the EXACT text of the title/heading as shown in the screenshot
- Include numbers if they're part of the title (e.g., "OFFERS EXPIRING IN NEXT 28 DAYS55" or "BRANDS WITH NO OUTREACH L30 DAYS48")
- Don't clean up or modify the title - return it EXACTLY as displayed
- If the element is NOT inside a distinct widget/card/panel, set noWidgetFound: true
- If there are multiple possible containers, choose the MOST SPECIFIC one (closest to the element)

## Response Format
Respond with a JSON object:
{
  "widgetTitle": "EXACT TITLE TEXT FROM SCREENSHOT",
  "confidence": 0.0-1.0,
  "widgetDescription": "Brief description of what this widget shows",
  "visualPosition": "top-left" | "top-right" | "center" | "bottom-left" | etc.,
  "uniqueFeatures": ["feature1", "feature2"],
  "noWidgetFound": false,
  "reasoning": "Why you identified this widget"
}

If no widget container is found:
{
  "widgetTitle": "",
  "confidence": 0,
  "noWidgetFound": true,
  "reasoning": "Element appears to be on the main page, not in a specific widget"
}

IMPORTANT: The widgetTitle must be the EXACT text visible in the screenshot. Do not paraphrase or summarize.

Respond with ONLY the JSON object, no other text.`;
}

// ============================================================================
// Response Parser
// ============================================================================

function parseGeminiResponse(geminiResult: any): WidgetIdentifierResponse {
  try {
    // Extract text from Gemini response
    const text = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Raw Gemini text:', text.substring(0, 300));
    
    // Parse JSON from response
    let parsed: any;
    
    // Try direct JSON parse first
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/) || 
                       text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        parsed = JSON.parse(jsonStr);
      } else {
        throw new Error('Could not extract JSON from response');
      }
    }
    
    return {
      widgetTitle: parsed.widgetTitle || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      widgetDescription: parsed.widgetDescription,
      visualPosition: parsed.visualPosition,
      uniqueFeatures: parsed.uniqueFeatures,
      noWidgetFound: parsed.noWidgetFound || false,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      widgetTitle: '',
      confidence: 0,
      noWidgetFound: true,
      reasoning: error instanceof Error ? error.message : 'Unknown parse error',
    };
  }
}

// ============================================================================
// Image Helpers
// ============================================================================

function extractBase64Data(dataUrl: string): string | null {
  if (!dataUrl) return null;
  
  // Handle data URLs: "data:image/jpeg;base64,..."
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (base64Match) {
    return base64Match[1];
  }
  
  // If already base64 (no prefix), return as-is
  if (!dataUrl.includes(':') && dataUrl.length > 100) {
    return dataUrl;
  }
  
  return null;
}

function detectMimeType(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'image/png';
  if (dataUrl.includes('image/jpeg')) return 'image/jpeg';
  if (dataUrl.includes('image/webp')) return 'image/webp';
  return 'image/jpeg'; // Default
}

