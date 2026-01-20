/**
 * Supabase Edge Function: extract_field_label
 * 
 * Uses Gemini Vision API to extract field labels from screenshots
 * when DOM-based label detection fails or has low confidence.
 * 
 * This is a fallback mechanism for complex web apps where:
 * - Labels are in Shadow DOM
 * - Custom components don't follow standard patterns
 * - Labels are positioned unusually
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 3.0 Flash for text-based reasoning
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

interface ExtractLabelRequest {
  screenshot: string; // Base64 encoded image
  elementBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  domLabelHint?: string; // Partial label from DOM (if any)
  inputType?: string; // Type of input (text, email, password, etc.)
  placeholderHint?: string; // Placeholder text if available
  context?: {
    pageTitle?: string;
    pageUrl?: string;
    nearbyText?: string[];
  };
}

interface ExtractLabelResponse {
  label: string;
  confidence: number;
  reasoning: string;
  alternativeLabels?: string[];
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
    const payload: ExtractLabelRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.screenshot) {
      throw new Error('Screenshot is required');
    }

    // Build the prompt for Gemini Vision
    const prompt = buildPrompt(payload);

    // Extract base64 data from data URL if needed
    const base64Data = extractBase64Data(payload.screenshot);

    // Call Gemini Vision API
    const geminiRequest = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64Data
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent results
        maxOutputTokens: 512,
      }
    };

    console.log('[extract_field_label] Calling Gemini Vision API');

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
      console.error('[extract_field_label] Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const result = parseGeminiResponse(geminiData, payload);

    console.log('[extract_field_label] Result:', result);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('[extract_field_label] Error:', error);
    return new Response(
      JSON.stringify({
        label: 'Unknown Field',
        confidence: 0,
        reasoning: error instanceof Error ? error.message : 'Unknown error',
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
 * Build prompt for Gemini Vision
 */
function buildPrompt(payload: ExtractLabelRequest): string {
  let prompt = `You are analyzing a screenshot of a web form to identify the label for an input field.

TASK: Find the label/name for the input field in this screenshot.

`;

  if (payload.elementBounds) {
    prompt += `The input field is located at approximately:
- Position: (${payload.elementBounds.x}, ${payload.elementBounds.y})
- Size: ${payload.elementBounds.width}x${payload.elementBounds.height} pixels

`;
  }

  if (payload.domLabelHint) {
    prompt += `DOM hint (may be partial/incorrect): "${payload.domLabelHint}"

`;
  }

  if (payload.placeholderHint) {
    prompt += `Placeholder text: "${payload.placeholderHint}"

`;
  }

  if (payload.inputType) {
    prompt += `Input type: ${payload.inputType}

`;
  }

  if (payload.context?.nearbyText?.length) {
    prompt += `Nearby text elements: ${payload.context.nearbyText.join(', ')}

`;
  }

  prompt += `INSTRUCTIONS:
1. Look at the screenshot and identify the focused/highlighted input field
2. Find the label for this field by looking at:
   - Text immediately ABOVE the input field
   - Text immediately to the LEFT of the input field
   - Any label element associated with the field
   - Placeholder text if no external label is visible
3. The label should be a human-readable field name (e.g., "Email Address", "Company Name", "Phone Number")
4. Do NOT use technical IDs or codes as the label

RESPOND WITH JSON ONLY:
{
  "label": "the field label you found",
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation of how you identified the label",
  "alternativeLabels": ["other possible labels if uncertain"]
}

IMPORTANT:
- If you see text like "Email", "Name", "Phone", "Address", etc. near the field, use that as the label
- If there's an asterisk (*) near the label, it indicates a required field - include just the label text without the asterisk
- If you cannot find a clear label, use the placeholder text or describe based on input type
- Confidence should be 0.9+ if you clearly see a label, 0.7-0.9 if inferring, <0.7 if uncertain`;

  return prompt;
}

/**
 * Parse Gemini response into ExtractLabelResponse
 */
function parseGeminiResponse(
  geminiData: any,
  payload: ExtractLabelRequest
): ExtractLabelResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    } else {
      // Try to find JSON object directly
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonText);

    return {
      label: parsed.label || payload.domLabelHint || 'Unknown Field',
      confidence: parseFloat(parsed.confidence) || 0.5,
      reasoning: parsed.reasoning || 'Extracted from screenshot',
      alternativeLabels: parsed.alternativeLabels,
    };

  } catch (error) {
    console.error('[extract_field_label] Error parsing Gemini response:', error);
    
    // Fallback to DOM hint if available
    if (payload.domLabelHint) {
      return {
        label: payload.domLabelHint,
        confidence: 0.4,
        reasoning: 'Using DOM hint as fallback due to parsing error',
      };
    }

    // Fallback to placeholder
    if (payload.placeholderHint) {
      return {
        label: payload.placeholderHint,
        confidence: 0.3,
        reasoning: 'Using placeholder as fallback due to parsing error',
      };
    }

    return {
      label: 'Unknown Field',
      confidence: 0,
      reasoning: 'Failed to extract label from screenshot',
    };
  }
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}
