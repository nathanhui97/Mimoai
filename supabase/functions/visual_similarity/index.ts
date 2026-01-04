/**
 * Supabase Edge Function: visual_similarity
 * Compares visual appearance of elements to find matches
 * Uses Gemini Vision API for human-like visual matching
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualCandidate {
  selector: string;
  screenshot: string; // Base64 cropped image
  visualDescription?: string;
  boundingBox: BoundingBox;
}

interface PageType {
  type: string;
  confidence: number;
}

interface VisualMatchRequest {
  targetScreenshot: string; // Base64 image of target element
  targetDescription?: string;
  candidates: VisualCandidate[];
  pageType?: PageType;
  pageScreenshot?: string;
}

interface VisualSimilarity {
  colorSimilarity: number;
  shapeSimilarity: number;
  sizeSimilarity: number;
  layoutSimilarity: number;
  textSimilarity: number;
  iconSimilarity: number;
  overallVisualMatch: number;
}

interface VisualSimilarityResponse {
  matches: Array<{
    candidateIndex: number;
    similarity: VisualSimilarity;
    confidence: number;
  }>;
  bestMatch: {
    index: number;
    selector?: string;
    reasoning: string;
  };
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
    const payload: VisualMatchRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.targetScreenshot || !payload.candidates?.length) {
      throw new Error('Target screenshot and candidates are required');
    }

    // Limit candidates to prevent token explosion
    const maxCandidates = 5;
    const candidates = payload.candidates.slice(0, maxCandidates);

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload, candidates.length);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for visual similarity:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build prompt
    const prompt = buildSimilarityPrompt(payload, candidates);

    // Build Gemini API request with images
    const geminiRequest = buildGeminiRequest(prompt, payload.targetScreenshot, candidates);

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
    const result = parseGeminiResponse(geminiData, candidates);

    // Cache the result (10 minute TTL)
    await saveToCache(supabase, cacheKey, result, 10 * 60);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in visual_similarity:', error);
    return new Response(
      JSON.stringify({
        matches: [],
        bestMatch: {
          index: 0,
          reasoning: error instanceof Error ? error.message : 'Unknown error',
        },
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
 * Build similarity comparison prompt
 */
function buildSimilarityPrompt(payload: VisualMatchRequest, candidates: VisualCandidate[]): string {
  let prompt = `Compare the visual appearance of elements to find the best match.

TARGET ELEMENT:
${payload.targetDescription ? `Description: "${payload.targetDescription}"` : 'See first image (target)'}

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. ${c.visualDescription || 'Element ' + (i + 1)} (selector: ${c.selector.substring(0, 50)}...)`).join('\n')}

${payload.pageType ? `Page Type: ${payload.pageType.type} (confidence: ${payload.pageType.confidence})` : ''}

IMAGES PROVIDED:
- Image 1: Target element (what we're looking for)
- Images 2-${candidates.length + 1}: Candidate elements

Compare each candidate to the target based on:
1. COLOR SIMILARITY - Background color, text color, border color
2. SHAPE SIMILARITY - Button/input shape, corners, borders
3. SIZE SIMILARITY - Relative size comparison
4. LAYOUT SIMILARITY - Position of text, icons within element
5. TEXT SIMILARITY - Font style, text content similarity
6. ICON SIMILARITY - Similar icons or images within element

Return JSON with this structure:
{
  "matches": [
    {
      "candidateIndex": <0-based index>,
      "similarity": {
        "colorSimilarity": <0-1>,
        "shapeSimilarity": <0-1>,
        "sizeSimilarity": <0-1>,
        "layoutSimilarity": <0-1>,
        "textSimilarity": <0-1>,
        "iconSimilarity": <0-1>,
        "overallVisualMatch": <0-1 weighted average>
      },
      "confidence": <0-1>
    },
    ...
  ],
  "bestMatch": {
    "index": <0-based index of best match>,
    "reasoning": "<explanation of why this is the best visual match>"
  }
}

IMPORTANT:
- Compare VISUAL APPEARANCE, not just text content
- Consider how a human would visually match elements
- If no good match exists, choose the closest one but with low confidence
- Explain your reasoning for the best match`;

  return prompt;
}

/**
 * Build Gemini request with multiple images
 */
function buildGeminiRequest(
  prompt: string, 
  targetScreenshot: string, 
  candidates: VisualCandidate[]
): any {
  const parts: any[] = [{ text: prompt }];

  // Add target image
  const targetBase64 = extractBase64Data(targetScreenshot);
  parts.push({
    inline_data: {
      mime_type: 'image/jpeg',
      data: targetBase64
    }
  });

  // Add candidate images (limit to prevent token overflow)
  for (const candidate of candidates) {
    const candidateBase64 = extractBase64Data(candidate.screenshot);
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: candidateBase64
      }
    });
  }

  return {
    contents: [{
      parts
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    }
  };
}

/**
 * Generate cache key
 */
function generateCacheKey(payload: VisualMatchRequest, candidateCount: number): string {
  const keyData = {
    type: 'visual_similarity',
    targetHash: payload.targetScreenshot.substring(0, 200),
    targetDesc: payload.targetDescription?.substring(0, 50),
    candidateCount,
    pageType: payload.pageType?.type,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `visual_sim_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<VisualSimilarityResponse | null> {
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

    return data.response_data as VisualSimilarityResponse;
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
  result: VisualSimilarityResponse,
  ttlSeconds: number = 600
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
function parseGeminiResponse(geminiData: any, candidates: VisualCandidate[]): VisualSimilarityResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Parse matches
    const matches: VisualSimilarityResponse['matches'] = [];
    if (Array.isArray(parsed.matches)) {
      for (const match of parsed.matches) {
        const candidateIndex = typeof match.candidateIndex === 'number' ? match.candidateIndex : 0;
        if (candidateIndex >= 0 && candidateIndex < candidates.length) {
          matches.push({
            candidateIndex,
            similarity: {
              colorSimilarity: parseFloat(match.similarity?.colorSimilarity) || 0,
              shapeSimilarity: parseFloat(match.similarity?.shapeSimilarity) || 0,
              sizeSimilarity: parseFloat(match.similarity?.sizeSimilarity) || 0,
              layoutSimilarity: parseFloat(match.similarity?.layoutSimilarity) || 0,
              textSimilarity: parseFloat(match.similarity?.textSimilarity) || 0,
              iconSimilarity: parseFloat(match.similarity?.iconSimilarity) || 0,
              overallVisualMatch: parseFloat(match.similarity?.overallVisualMatch) || 0,
            },
            confidence: parseFloat(match.confidence) || 0,
          });
        }
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    // Parse best match
    const bestMatchIndex = typeof parsed.bestMatch?.index === 'number' ? parsed.bestMatch.index : 0;
    const bestMatch = {
      index: bestMatchIndex,
      selector: candidates[bestMatchIndex]?.selector,
      reasoning: parsed.bestMatch?.reasoning || 'Visual comparison completed',
    };

    return {
      matches,
      bestMatch,
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    
    // Return fallback with first candidate
    return {
      matches: candidates.map((_, i) => ({
        candidateIndex: i,
        similarity: {
          colorSimilarity: 0,
          shapeSimilarity: 0,
          sizeSimilarity: 0,
          layoutSimilarity: 0,
          textSimilarity: 0,
          iconSimilarity: 0,
          overallVisualMatch: 0,
        },
        confidence: 0,
      })),
      bestMatch: {
        index: 0,
        selector: candidates[0]?.selector,
        reasoning: 'Failed to parse visual comparison',
      },
    };
  }
}










