/**
 * Supabase Edge Function: classify_page_type
 * Analyzes page screenshots to classify page type and identify visual regions/landmarks
 * Uses Gemini Vision API for human-like visual understanding
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface ClassifyPageTypeRequest {
  screenshot: string; // Base64 full page screenshot
  url: string;
  title: string;
}

interface PageType {
  type: string;
  confidence: number;
  subType?: string;
  characteristics: string[];
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageRegions {
  header?: BoundingBox;
  sidebar?: BoundingBox;
  mainContent?: BoundingBox;
  footer?: BoundingBox;
  navigation?: BoundingBox;
  actionBar?: BoundingBox;
  formArea?: BoundingBox;
  tableArea?: BoundingBox;
}

interface VisualLandmark {
  type: string;
  position: BoundingBox;
  description: string;
  text?: string;
  color?: string;
  confidence: number;
}

interface ClassifyPageTypeResponse {
  pageType: PageType;
  regions: PageRegions;
  landmarks: VisualLandmark[];
  confidence: number;
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
    const payload: ClassifyPageTypeRequest = await req.json();

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    if (!payload.screenshot) {
      throw new Error('Screenshot is required');
    }

    // Check cache first
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const cacheKey = generateCacheKey(payload);
    const cached = await checkCache(supabase, cacheKey);
    
    if (cached) {
      console.log('Cache hit for page type classification:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build prompt for page classification
    const prompt = buildClassificationPrompt(payload);

    // Build Gemini API request with image
    const screenshotBase64 = extractBase64Data(payload.screenshot);
    const geminiRequest = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: screenshotBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.2, // Lower temperature for more consistent classification
        maxOutputTokens: 2048,
      }
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
    const result = parseGeminiResponse(geminiData);

    // Cache the result (5 minute TTL for page type)
    await saveToCache(supabase, cacheKey, result, 5 * 60);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in classify_page_type:', error);
    return new Response(
      JSON.stringify({
        pageType: {
          type: 'unknown',
          confidence: 0,
          characteristics: [],
        },
        regions: {},
        landmarks: [],
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
 * Build prompt for page classification
 */
function buildClassificationPrompt(payload: ClassifyPageTypeRequest): string {
  return `Analyze this webpage screenshot and classify it. The page URL is: ${payload.url}
Title: "${payload.title}"

Classify the page type and identify visual regions and landmarks.

TASK 1: Page Type Classification
Classify the page as one of these types:
- form: Page with input fields for data entry
- dashboard: Page with multiple widgets/cards showing data
- data_table: Page primarily showing tabular data
- wizard: Multi-step form or process
- modal: Popup dialog (may overlay another page)
- list: Page showing a list of items
- settings: Configuration/settings page
- login: Login or authentication page
- search: Search results page
- article: Content/article page
- unknown: Cannot determine

TASK 2: Region Detection
Identify approximate bounding boxes (in percentage of viewport) for these regions if visible:
- header: Top navigation/header area
- sidebar: Side navigation or panel
- mainContent: Main content area
- footer: Bottom footer area
- navigation: Primary navigation
- actionBar: Toolbar with action buttons
- formArea: Area containing form inputs
- tableArea: Area containing data table

TASK 3: Landmark Detection
Identify up to 10 visual landmarks (important interactive elements):
- buttons (especially submit, save, cancel)
- key input fields
- navigation elements
- logos
- user menus
- search bars
- modal dialogs
- dropdown triggers

Return JSON with this structure:
{
  "pageType": {
    "type": "<page type>",
    "confidence": <0-1>,
    "subType": "<more specific type if applicable>",
    "characteristics": ["<key visual characteristic 1>", "<key visual characteristic 2>", ...]
  },
  "regions": {
    "header": {"x": <0-100>, "y": <0-100>, "width": <0-100>, "height": <0-100>},
    "sidebar": {...},
    "mainContent": {...},
    ...
  },
  "landmarks": [
    {
      "type": "<button|input|navigation|logo|user_menu|search_bar|modal|dropdown|table|card|icon|tab>",
      "position": {"x": <0-100>, "y": <0-100>, "width": <0-100>, "height": <0-100>},
      "description": "<human-readable description>",
      "text": "<visible text if any>",
      "color": "<dominant color if notable>",
      "confidence": <0-1>
    },
    ...
  ],
  "confidence": <overall classification confidence 0-1>
}

IMPORTANT:
- All coordinates are percentages (0-100) of viewport dimensions
- Only include regions that are clearly visible
- Focus on the most important landmarks (max 10)
- Be specific in descriptions (e.g., "Blue submit button" not just "button")`;
}

/**
 * Generate cache key
 */
function generateCacheKey(payload: ClassifyPageTypeRequest): string {
  // Use URL and screenshot hash for cache key
  const screenshotSample = payload.screenshot.substring(0, 500);
  const keyData = {
    type: 'page_classification',
    url: payload.url,
    title: payload.title,
    screenshotSample,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `page_type_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<ClassifyPageTypeResponse | null> {
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
      await supabase.from('ai_cache').delete().eq('cache_key', cacheKey);
      return null;
    }

    return data.response_data as ClassifyPageTypeResponse;
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
  result: ClassifyPageTypeResponse,
  ttlSeconds: number = 300
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
 * Parse Gemini API response
 */
function parseGeminiResponse(geminiData: any): ClassifyPageTypeResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and normalize page type
    const validTypes = ['form', 'dashboard', 'data_table', 'wizard', 'modal', 'list', 'settings', 'login', 'search', 'article', 'unknown'];
    const pageType: PageType = {
      type: validTypes.includes(parsed.pageType?.type) ? parsed.pageType.type : 'unknown',
      confidence: typeof parsed.pageType?.confidence === 'number' ? parsed.pageType.confidence : 0.5,
      subType: parsed.pageType?.subType,
      characteristics: Array.isArray(parsed.pageType?.characteristics) ? parsed.pageType.characteristics : [],
    };

    // Convert percentage coordinates to pixel-like values (will be converted back on client)
    const regions: PageRegions = {};
    if (parsed.regions) {
      for (const [key, value] of Object.entries(parsed.regions)) {
        if (value && typeof value === 'object') {
          const box = value as any;
          regions[key as keyof PageRegions] = {
            x: typeof box.x === 'number' ? box.x : 0,
            y: typeof box.y === 'number' ? box.y : 0,
            width: typeof box.width === 'number' ? box.width : 0,
            height: typeof box.height === 'number' ? box.height : 0,
          };
        }
      }
    }

    // Parse landmarks
    const landmarks: VisualLandmark[] = [];
    if (Array.isArray(parsed.landmarks)) {
      for (const landmark of parsed.landmarks.slice(0, 10)) {
        if (landmark && landmark.position) {
          landmarks.push({
            type: landmark.type || 'unknown',
            position: {
              x: typeof landmark.position.x === 'number' ? landmark.position.x : 0,
              y: typeof landmark.position.y === 'number' ? landmark.position.y : 0,
              width: typeof landmark.position.width === 'number' ? landmark.position.width : 0,
              height: typeof landmark.position.height === 'number' ? landmark.position.height : 0,
            },
            description: landmark.description || '',
            text: landmark.text,
            color: landmark.color,
            confidence: typeof landmark.confidence === 'number' ? landmark.confidence : 0.5,
          });
        }
      }
    }

    return {
      pageType,
      regions,
      landmarks,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : pageType.confidence,
    };
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      pageType: {
        type: 'unknown',
        confidence: 0,
        characteristics: [],
      },
      regions: {},
      landmarks: [],
      confidence: 0,
    };
  }
}










