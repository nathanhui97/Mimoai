/**
 * Supabase Edge Function: visual_analysis
 * Multi-purpose visual analysis: importance scoring, context extraction, pattern recognition
 * Uses Gemini Vision API for human-like visual understanding
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 2.5 Computer Use model for screenshot-based analysis
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateContent';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualAnalysisRequest {
  screenshot: string; // Base64 image (element or page region)
  analysisType: 'importance' | 'context' | 'pattern' | 'description' | 'all';
  elementBounds?: BoundingBox;
  pageContext?: {
    url: string;
    title: string;
    pageType?: string;
  };
}

interface VisualImportance {
  sizeScore: number;
  colorScore: number;
  positionScore: number;
  iconScore: number;
  textStyleScore: number;
  interactiveScore: number;
  overallImportance: number;
}

interface NearbyElement {
  visualDescription: string;
  relationship: 'above' | 'below' | 'left' | 'right' | 'inside' | 'overlapping';
  distance: number;
  type: 'button' | 'input' | 'label' | 'icon' | 'text' | 'image' | 'container' | 'other';
}

interface VisualContext {
  nearbyElements: NearbyElement[];
  landmarks: Array<{
    type: string;
    description: string;
    position: string;
  }>;
  visualPattern: string;
  regionType?: string;
}

interface VisualAnalysisResponse {
  importance?: VisualImportance;
  context?: VisualContext;
  patterns?: Array<{
    pattern: string;
    confidence: number;
  }>;
  description?: string;
  error?: string;
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
    const payload: VisualAnalysisRequest = await req.json();

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
      console.log('Cache hit for visual analysis:', cacheKey);
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Build prompt based on analysis type
    const prompt = buildAnalysisPrompt(payload);

    // Build Gemini API request
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
        temperature: 0.3,
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
    const result = parseGeminiResponse(geminiData, payload.analysisType);

    // Cache the result (15 minute TTL)
    await saveToCache(supabase, cacheKey, result, 15 * 60);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in visual_analysis:', error);
    return new Response(
      JSON.stringify({
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
 * Build analysis prompt based on type
 */
function buildAnalysisPrompt(payload: VisualAnalysisRequest): string {
  const { analysisType, pageContext, elementBounds } = payload;

  let prompt = `Analyze this screenshot for visual understanding.\n\n`;

  if (pageContext) {
    prompt += `Page Context:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
${pageContext.pageType ? `- Page Type: ${pageContext.pageType}` : ''}

`;
  }

  if (elementBounds) {
    prompt += `Element bounds: x=${elementBounds.x}, y=${elementBounds.y}, w=${elementBounds.width}, h=${elementBounds.height}\n\n`;
  }

  switch (analysisType) {
    case 'importance':
      prompt += buildImportancePrompt();
      break;
    case 'context':
      prompt += buildContextPrompt();
      break;
    case 'pattern':
      prompt += buildPatternPrompt();
      break;
    case 'description':
      prompt += buildDescriptionPrompt();
      break;
    case 'all':
    default:
      prompt += buildFullAnalysisPrompt();
      break;
  }

  return prompt;
}

function buildImportancePrompt(): string {
  return `TASK: Analyze the VISUAL IMPORTANCE of the main element in this screenshot.

Score each factor from 0-1:

1. SIZE SCORE - How large is the element relative to the screenshot?
   - 0: Very small, hard to notice
   - 1: Large, dominant element

2. COLOR SCORE - How attention-grabbing is the color?
   - 0: Muted, blends with background
   - 1: Bright, high contrast, stands out

3. POSITION SCORE - Where is it positioned? (F-pattern: top-left is most important)
   - 0: Bottom-right, easy to miss
   - 1: Top-left, immediately visible

4. ICON SCORE - Does it have recognizable icons?
   - 0: No icons
   - 1: Clear, recognizable icons

5. TEXT STYLE SCORE - Is the text prominent?
   - 0: Small, regular weight
   - 1: Large, bold, prominent

6. INTERACTIVE SCORE - Does it look clickable/interactive?
   - 0: Looks like static content
   - 1: Clearly looks like a button/link

Return JSON:
{
  "importance": {
    "sizeScore": <0-1>,
    "colorScore": <0-1>,
    "positionScore": <0-1>,
    "iconScore": <0-1>,
    "textStyleScore": <0-1>,
    "interactiveScore": <0-1>,
    "overallImportance": <0-1 weighted average>
  }
}`;
}

function buildContextPrompt(): string {
  return `TASK: Analyze the VISUAL CONTEXT around the main element.

Identify:

1. NEARBY ELEMENTS - What's visually close to the main element?
   - Describe each nearby element
   - State its position (above, below, left, right)
   - Classify its type (button, input, label, icon, text, image)
   - Estimate distance in pixels

2. LANDMARKS - Notable visual landmarks nearby
   - Navigation menus
   - Search bars
   - User menus
   - Logos
   - Section headers

3. VISUAL PATTERN - What layout pattern is this part of?
   - form_layout: Input fields with labels
   - card_grid: Grid of cards
   - data_table: Tabular data
   - list_view: Vertical list
   - dashboard_widgets: Multiple widgets
   - navigation_menu: Nav links
   - modal_dialog: Popup
   - dropdown_menu: Menu list
   - unknown

4. REGION TYPE - Which page region is this in?
   - header, sidebar, main_content, footer, modal, dropdown

Return JSON:
{
  "context": {
    "nearbyElements": [
      {
        "visualDescription": "<description>",
        "relationship": "<above|below|left|right|inside|overlapping>",
        "distance": <pixels>,
        "type": "<button|input|label|icon|text|image|container|other>"
      }
    ],
    "landmarks": [
      {
        "type": "<type>",
        "description": "<description>",
        "position": "<relative position>"
      }
    ],
    "visualPattern": "<pattern type>",
    "regionType": "<region type>"
  }
}`;
}

function buildPatternPrompt(): string {
  return `TASK: Identify VISUAL PATTERNS in this screenshot.

Look for these patterns:
- form_layout: Labeled input fields, vertical arrangement
- card_grid: Grid of similar cards/containers
- data_table: Rows and columns of data
- dashboard_widgets: Multiple dashboard widgets
- list_view: Vertical list of items
- wizard_steps: Multi-step progress indicator
- tab_content: Tabbed interface
- modal_dialog: Popup dialog
- dropdown_menu: Dropdown/select menu
- navigation_menu: Navigation links
- search_results: Search results listing

For each pattern found, rate confidence 0-1.

Return JSON:
{
  "patterns": [
    {
      "pattern": "<pattern name>",
      "confidence": <0-1>
    }
  ]
}`;
}

function buildDescriptionPrompt(): string {
  return `TASK: Generate a human-readable DESCRIPTION of this element.

Describe what a human would see:
- What type of element is it? (button, input, link, etc.)
- What color is it?
- What text does it contain?
- What icon does it have?
- What is its purpose?

Keep the description concise (under 50 words) but specific enough to identify this element.

Example descriptions:
- "Blue submit button with 'Save Changes' text"
- "Search input field with magnifying glass icon"
- "Red delete button in the action toolbar"
- "Dropdown menu showing user profile options"

Return JSON:
{
  "description": "<human-readable description>"
}`;
}

function buildFullAnalysisPrompt(): string {
  return `TASK: Perform COMPLETE VISUAL ANALYSIS of this screenshot.

Analyze:

1. VISUAL IMPORTANCE (how prominent is the main element)
2. VISUAL CONTEXT (nearby elements, landmarks, patterns)
3. VISUAL PATTERNS (what UI patterns are present)
4. DESCRIPTION (human-readable description)

Return JSON with all sections:
{
  "importance": {
    "sizeScore": <0-1>,
    "colorScore": <0-1>,
    "positionScore": <0-1>,
    "iconScore": <0-1>,
    "textStyleScore": <0-1>,
    "interactiveScore": <0-1>,
    "overallImportance": <0-1>
  },
  "context": {
    "nearbyElements": [...],
    "landmarks": [...],
    "visualPattern": "<pattern>",
    "regionType": "<region>"
  },
  "patterns": [
    { "pattern": "<name>", "confidence": <0-1> }
  ],
  "description": "<human-readable description>"
}`;
}

/**
 * Generate cache key
 */
function generateCacheKey(payload: VisualAnalysisRequest): string {
  const keyData = {
    type: 'visual_analysis',
    analysisType: payload.analysisType,
    screenshotHash: payload.screenshot.substring(0, 300),
    pageType: payload.pageContext?.pageType,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `visual_analysis_${Math.abs(hash).toString(36)}`;
}

/**
 * Check cache
 */
async function checkCache(supabase: any, cacheKey: string): Promise<VisualAnalysisResponse | null> {
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

    return data.response_data as VisualAnalysisResponse;
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
  result: VisualAnalysisResponse,
  ttlSeconds: number = 900
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
function parseGeminiResponse(geminiData: any, analysisType: string): VisualAnalysisResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result: VisualAnalysisResponse = {};

    // Parse importance
    if (parsed.importance) {
      result.importance = {
        sizeScore: parseFloat(parsed.importance.sizeScore) || 0,
        colorScore: parseFloat(parsed.importance.colorScore) || 0,
        positionScore: parseFloat(parsed.importance.positionScore) || 0,
        iconScore: parseFloat(parsed.importance.iconScore) || 0,
        textStyleScore: parseFloat(parsed.importance.textStyleScore) || 0,
        interactiveScore: parseFloat(parsed.importance.interactiveScore) || 0,
        overallImportance: parseFloat(parsed.importance.overallImportance) || 0,
      };
    }

    // Parse context
    if (parsed.context) {
      result.context = {
        nearbyElements: Array.isArray(parsed.context.nearbyElements) 
          ? parsed.context.nearbyElements.map((el: any) => ({
              visualDescription: el.visualDescription || '',
              relationship: el.relationship || 'overlapping',
              distance: typeof el.distance === 'number' ? el.distance : 0,
              type: el.type || 'other',
            }))
          : [],
        landmarks: Array.isArray(parsed.context.landmarks)
          ? parsed.context.landmarks.map((l: any) => ({
              type: l.type || 'unknown',
              description: l.description || '',
              position: l.position || '',
            }))
          : [],
        visualPattern: parsed.context.visualPattern || 'unknown',
        regionType: parsed.context.regionType,
      };
    }

    // Parse patterns
    if (Array.isArray(parsed.patterns)) {
      result.patterns = parsed.patterns.map((p: any) => ({
        pattern: p.pattern || 'unknown',
        confidence: parseFloat(p.confidence) || 0,
      }));
    }

    // Parse description
    if (parsed.description) {
      result.description = String(parsed.description);
    }

    return result;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      error: 'Failed to parse visual analysis response',
    };
  }
}










