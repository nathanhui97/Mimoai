/**
 * Supabase Edge Function: validate_selector
 * Handles AI selector validation using Gemini API
 * Receives selector and element context, returns validation result with alternatives
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface SelectorValidationPayload {
  selector: string;
  elementContext: string;
  pageContext: {
    title: string;
    url: string;
  };
}

interface SelectorValidationResult {
  isStable: boolean;
  alternatives: string[];
  reasoning: string;
  confidence: number;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // Parse request
    const payload: SelectorValidationPayload = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build prompt from payload
    const prompt = buildPrompt(payload);

    // Build Gemini API request
    const geminiRequest: any = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }]
    };

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
    console.log('Gemini raw response:', JSON.stringify(geminiData, null, 2));
    const result = parseGeminiResponse(geminiData, payload);
    console.log('Parsed result:', JSON.stringify(result, null, 2));

    // Cache the result
    await saveToCache(supabase, cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in validate_selector:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isStable: true,
        alternatives: [],
        reasoning: 'Error occurred during selector validation',
        confidence: 0
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
 * Generate cache key from payload
 */
function generateCacheKey(payload: SelectorValidationPayload): string {
  const keyData = {
    type: 'selector_validation',
    selector: payload.selector,
    url: payload.pageContext.url,
    contextHash: payload.elementContext.substring(0, 200),
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `selector_validation_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<SelectorValidationResult | null> {
  try {
    const { data, error } = await supabase
      .from('ai_cache')
      .select('response_data, expires_at')
      .eq('cache_key', cacheKey)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      // Delete expired entry
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as SelectorValidationResult;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save to cache
 */
async function saveToCache(supabase: any, cacheKey: string, result: SelectorValidationResult): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days TTL

    await supabase
      .from('ai_cache')
      .upsert({
        cache_key: cacheKey,
        response_data: result,
        expires_at: expiresAt.toISOString(),
      });
  } catch (e) {
    console.error('Cache save error:', e);
    // Don't throw - caching is best effort
  }
}

/**
 * Build prompt from payload
 */
function buildPrompt(payload: SelectorValidationPayload): string {
  const isXPath = payload.selector.startsWith('//') || payload.selector.startsWith('/');
  const selectorType = isXPath ? 'XPath' : 'CSS';
  
  let prompt = `Analyze this ${selectorType} selector for stability and suggest better alternatives.\n\n`;
  prompt += `Selector: "${payload.selector}"\n`;
  prompt += `Page: "${payload.pageContext.title}" (${payload.pageContext.url})\n\n`;
  
  prompt += `Element Context:\n${payload.elementContext.substring(0, 1000)}\n\n`;
  
  prompt += `IMPORTANT: Consider these fragility factors:\n`;
  prompt += `- Text-based selectors (contains(), text content) are FRAGILE - text can change, be translated, or be updated\n`;
  prompt += `- Position-based selectors (:nth-child, :nth-of-type) are FRAGILE - layout changes break them\n`;
  prompt += `- Framework-generated classes (ng-*, react-*, vue-*) are FRAGILE - they change on rebuild\n`;
  prompt += `- Long CSS paths (>8 levels) are FRAGILE - DOM structure changes break them\n`;
  prompt += `- Dynamic IDs or classes with random hashes are FRAGILE\n\n`;
  
  prompt += `Questions:\n`;
  prompt += `1. Is this selector fragile? Will it break if the UI changes?\n`;
  prompt += `2. What specific fragility risks does it have?\n`;
  prompt += `3. Suggest 3-5 better alternative selectors that are more stable:\n`;
  prompt += `   - Attribute-based selectors (data-*, aria-*, role, stable IDs)\n`;
  prompt += `   - Role-based selectors (using ARIA roles like button, link, etc.)\n`;
  prompt += `   - Container-based selectors (using stable parent/ancestor context)\n`;
  prompt += `   - Combination selectors (mixing stable attributes with semantic context)\n`;
  prompt += `   - Avoid text-based selectors unless absolutely necessary\n\n`;
  
  prompt += `Return JSON with this exact structure:\n`;
  prompt += `{\n`;
  prompt += `  "isStable": boolean (true only if selector uses stable attributes like data-*, aria-*, or stable IDs),\n`;
  prompt += `  "alternatives": ["selector1", "selector2", ...] (always provide at least 2-3 alternatives),\n`;
  prompt += `  "reasoning": "detailed explanation of fragility risks and why alternatives are better",\n`;
  prompt += `  "confidence": 0.0-1.0\n`;
  prompt += `}\n\n`;
  prompt += `Note: Even if the selector seems "stable", provide alternatives for robustness. Only return valid JSON, no markdown formatting.`;

  return prompt;
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(geminiData: any, payload: SelectorValidationPayload): SelectorValidationResult {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    const result: SelectorValidationResult = {
      isStable: typeof parsed.isStable === 'boolean' ? parsed.isStable : true,
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.filter((a: any) => typeof a === 'string') : [],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI analysis completed',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    // If selector is marked stable but has text-based matching, it's actually fragile
    const hasTextMatching = payload.selector.includes('contains(') || 
                            payload.selector.includes('text()') ||
                            payload.selector.includes('normalize-space');
    
    if (hasTextMatching && result.isStable) {
      console.log('Warning: Text-based selector marked as stable, forcing fragile');
      result.isStable = false;
      if (result.alternatives.length === 0) {
        result.reasoning = 'Text-based selectors are fragile - text can change or be translated. ' + (result.reasoning || '');
      }
    }
    
    // Ensure at least 2 alternatives if selector is not stable
    if (!result.isStable && result.alternatives.length === 0) {
      result.reasoning += ' (No alternatives suggested - AI should provide alternatives for fragile selectors)';
    }

    return result;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    // Return fallback result
    return {
      isStable: true,
      alternatives: [],
      reasoning: 'Failed to parse AI response, assuming stable',
      confidence: 0,
    };
  }
}










