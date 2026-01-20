/**
 * Supabase Edge Function: recover_element
 * Handles AI element recovery using Gemini API
 * Receives AIAnalysisPayload from client and returns element finding result
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

interface AIAnalysisPayload {
  action: {
    type: string;
    url: string;
  };
  semanticContext?: any;
  elementContext?: any;
  pageContext: {
    title: string;
    url: string;
  };
  flowContext?: any;
  visualSnapshot?: {
    viewport?: string;
    elementSnippet?: string;
  };
  failureSnapshot?: {
    targetDescription: string;
    targetText?: string;
    candidates: Array<{
      tag: string;
      text: string;
      role?: string;
      selector: string;
      distance?: number;
    }>;
    context: string;
  };
}

interface ElementFindingResult {
  candidateIndex?: number;
  selector?: string;
  confidence: number;
  reasoning: string;
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
    // Parse request
    const payload: AIAnalysisPayload = await req.json();

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

    // Build Gemini API request (multimodal: text + images)
    const geminiRequest: any = {
      contents: [{
        parts: [
          { text: prompt }
        ]
      }]
    };

    // Add images if available
    if (payload.visualSnapshot?.viewport) {
      const viewportBase64 = extractBase64Data(payload.visualSnapshot.viewport);
      geminiRequest.contents[0].parts.push({
        inline_data: {
          mime_type: 'image/png',
          data: viewportBase64
        }
      });
    }

    if (payload.visualSnapshot?.elementSnippet) {
      const snippetBase64 = extractBase64Data(payload.visualSnapshot.elementSnippet);
      geminiRequest.contents[0].parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: snippetBase64
        }
      });
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
    const result = parseGeminiResponse(geminiData, payload);

    // Cache the result
    await saveToCache(supabase, cacheKey, result);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in recover_element:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        confidence: 0,
        reasoning: 'Error occurred during AI recovery'
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
function generateCacheKey(payload: AIAnalysisPayload): string {
  const keyData = {
    action: payload.action.type,
    url: payload.action.url,
    target: payload.failureSnapshot?.targetDescription || payload.elementContext?.text,
    candidates: payload.failureSnapshot?.candidates.length || 0,
    hasVisual: !!payload.visualSnapshot,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `ai_cache_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<ElementFindingResult | null> {
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

    return data.response_data as ElementFindingResult;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

/**
 * Save to cache
 */
async function saveToCache(supabase: any, cacheKey: string, result: ElementFindingResult): Promise<void> {
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
function buildPrompt(payload: AIAnalysisPayload): string {
  const snapshot = payload.failureSnapshot;
  const elementContext = payload.elementContext;
  const semanticContext = payload.semanticContext;

  let prompt = `Find the element matching this description:\n`;
  prompt += `Target: "${snapshot?.targetDescription || elementContext?.text || 'target element'}"\n`;
  
  if (snapshot?.targetText) {
    prompt += `Target Text: "${snapshot.targetText}"\n`;
  }

  // Add semantic context if available
  if (semanticContext?.gridCoordinates) {
    prompt += `Grid Context: Cell ${semanticContext.gridCoordinates.cellReference || 'unknown'}\n`;
  }
  if (semanticContext?.formCoordinates) {
    prompt += `Form Context: Field "${semanticContext.formCoordinates.label || 'unknown'}"\n`;
  }

  // Add candidates
  if (snapshot?.candidates && snapshot.candidates.length > 0) {
    prompt += `\nCandidates (filtered by proximity to original location):\n`;
    snapshot.candidates.forEach((candidate, index) => {
      const distance = candidate.distance !== undefined ? ` [distance: ${Math.round(candidate.distance)}px]` : '';
      prompt += `${index + 1}. ${candidate.tag} - "${candidate.text}" (role: ${candidate.role || 'none'})${distance}\n`;
    });
  }

  // Add context
  if (snapshot?.context) {
    prompt += `\nContext: ${snapshot.context.substring(0, 500)}...\n`;
  }

  // Add visual context note
  if (payload.visualSnapshot) {
    prompt += `\nVisual Context:\n`;
    prompt += `- Viewport screenshot: [provided as first image]\n`;
    prompt += `- Element snippet: [provided as second image]\n`;
  }

  prompt += `\nWhich candidate matches the target in the screenshot? Return JSON with:\n`;
  prompt += `- candidateIndex (number) or selector (string)\n`;
  prompt += `- confidence (0-1)\n`;
  prompt += `- reasoning (string)\n`;

  return prompt;
}

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string {
  // Remove "data:image/png;base64," or "data:image/jpeg;base64," prefix
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

/**
 * Parse Gemini API response
 */
function parseGeminiResponse(geminiData: any, payload: AIAnalysisPayload): ElementFindingResult {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    const result: ElementFindingResult = {
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI analysis completed',
    };

    if (typeof parsed.candidateIndex === 'number') {
      result.candidateIndex = parsed.candidateIndex;
    }

    if (typeof parsed.selector === 'string') {
      result.selector = parsed.selector;
    }

    // If candidateIndex provided, also return the selector from candidates
    if (result.candidateIndex !== undefined && payload.failureSnapshot?.candidates) {
      const candidate = payload.failureSnapshot.candidates[result.candidateIndex];
      if (candidate && !result.selector) {
        result.selector = candidate.selector;
      }
    }

    return result;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    // Return fallback result
    return {
      confidence: 0,
      reasoning: 'Failed to parse AI response',
    };
  }
}



