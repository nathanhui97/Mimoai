/**
 * Supabase Edge Function: visual_click
 * 
 * High-accuracy visual AI click system using Gemini Vision API.
 * Analyzes screenshots to find precise click coordinates for target elements.
 * 
 * Features:
 * - Multi-prompt strategy with enhanced context
 * - Coordinate extraction with bounding boxes
 * - Verification mode for element confirmation
 * - Comparison with recorded screenshots
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 'v2.1-correct-model';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using gemini-3-flash-preview - same model as recover_element function
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

console.log('visual_click Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface VisualClickRequest {
  /** Current screenshot of the page */
  screenshot: string;
  /** Custom prompt (optional, will be auto-generated if not provided) */
  prompt?: string;
  /** Target element description */
  target: {
    text?: string;
    role?: string;
    label?: string;
    description?: string;
    context?: string;
  };
  /** Hints to help locate the element */
  hints?: {
    approximateCoordinates?: { x: number; y: number };
    nearbyElements?: string[];
    excludeAreas?: Array<{ x: number; y: number; label?: string }>;
    recordedBounds?: { x: number; y: number; width: number; height: number };
    recordedClickPoint?: { x: number; y: number };
  };
  /** Screenshot from recording time (for comparison) */
  recordedScreenshot?: string;
  /** Whether the recorded screenshot has visual markers (red circle, crosshair) */
  hasAnnotatedReference?: boolean;
  /** Page context */
  pageContext?: {
    title: string;
    url: string;
    viewportSize: { width: number; height: number };
  };
  /** Workflow execution context */
  workflowContext?: {
    currentStepNumber: number;
    totalSteps: number;
    previousSteps: Array<{
      stepNumber: number;
      description: string;
      success: boolean;
      resultUrl?: string;
      resultPageTitle?: string;
    }>;
    workflowGoal?: string;
    isOptimized?: boolean;
  };
  /** Action type: 'find' (default) or 'verify' */
  action?: 'find' | 'verify';
  /** Element info for verification mode */
  elementInfo?: {
    tag: string;
    text: string;
    role?: string;
    ariaLabel?: string;
    coordinates: { x: number; y: number };
    bounds: { x: number; y: number; width: number; height: number };
  };
}

interface VisualClickResponse {
  coordinates: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  reasoning: string;
  alternativeCandidates?: Array<{
    coordinates: { x: number; y: number };
    confidence: number;
    reasoning: string;
  }>;
}

interface VerificationResponse {
  isCorrect: boolean;
  confidence: number;
  reasoning: string;
}

// ============================================================================
// Main Handler
// ============================================================================

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
    console.log('visual_click Edge Function', VERSION, 'received request');
    const payload: VisualClickRequest = await req.json();
    console.log('Payload target:', payload.target);
    console.log('Payload has screenshot:', !!payload.screenshot);

    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured!');
      throw new Error('GEMINI_API_KEY not configured');
    }
    
    console.log('GEMINI_API_KEY is set, proceeding...');

    // Route based on action type
    if (payload.action === 'verify') {
      const result = await handleVerification(payload);
      return jsonResponse(result);
    } else {
      const result = await handleFindElement(payload);
      return jsonResponse(result);
    }
  } catch (error) {
    console.error('Error in visual_click:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        coordinates: { x: 0, y: 0 },
        confidence: 0,
        reasoning: 'Error occurred during visual AI analysis'
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

// ============================================================================
// Find Element Handler
// ============================================================================

async function handleFindElement(payload: VisualClickRequest): Promise<VisualClickResponse> {
  // TEMPORARILY DISABLED: Server-side cache has bad responses
  // const supabase = createClient(
  //   Deno.env.get('SUPABASE_URL') ?? '',
  //   Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  // );
  // const cacheKey = generateCacheKey(payload);
  // const cached = await checkCache(supabase, cacheKey);
  // if (cached) {
  //   console.log('Cache hit for visual_click:', cacheKey);
  //   return cached;
  // }
  
  console.log('Server-side cache disabled - calling Gemini API fresh');

  // Build prompt
  const prompt = payload.prompt || buildFindElementPrompt(payload);

  // Build Gemini request with images
  console.log('Building Gemini request...');
  console.log('Has annotated reference:', payload.hasAnnotatedReference);
  const geminiRequest = buildGeminiRequest(
    prompt, 
    payload.screenshot, 
    payload.recordedScreenshot,
    payload.hasAnnotatedReference
  );
  console.log('Gemini request built, parts count:', geminiRequest.contents[0].parts.length);

  // Call Gemini API
  console.log('Calling Gemini API at:', GEMINI_API_URL);
  const geminiResponse = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geminiRequest),
  });

  console.log('Gemini API response status:', geminiResponse.status);
  
  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    console.error('Gemini API error response:', errorText);
    throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
  }

  const geminiData = await geminiResponse.json();
  console.log('Gemini API returned data, parsing...');
  const result = parseCoordinateResponse(geminiData, payload);

  // TEMPORARILY DISABLED: Skip caching until we verify responses are good
  // await saveToCache(supabase, cacheKey, result);
  console.log('Returning result (cache save disabled)');

  return result;
}

// ============================================================================
// Verification Handler
// ============================================================================

async function handleVerification(payload: VisualClickRequest): Promise<VerificationResponse> {
  const prompt = buildVerificationPrompt(payload);

  // Build Gemini request
  const geminiRequest = buildGeminiRequest(prompt, payload.screenshot);

  // Call Gemini API
  const geminiResponse = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(geminiRequest),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    throw new Error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
  }

  const geminiData = await geminiResponse.json();
  return parseVerificationResponse(geminiData);
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildFindElementPrompt(payload: VisualClickRequest): string {
  const { target, hints, pageContext, hasAnnotatedReference, workflowContext } = payload;
  const parts: string[] = [];

  // Header
  parts.push('# Visual Element Location Task');
  parts.push('');
  
  // Add workflow context if available
  if (workflowContext) {
    parts.push('## 🎬 WORKFLOW EXECUTION CONTEXT');
    parts.push('');
    parts.push(`You are executing **Step ${workflowContext.currentStepNumber} of ${workflowContext.totalSteps}** in a workflow.`);
    
    if (workflowContext.workflowGoal) {
      parts.push(`**Overall Goal**: ${workflowContext.workflowGoal}`);
    }
    
    if (workflowContext.isOptimized) {
      parts.push('**Note**: This is an optimized workflow - some navigation steps were replaced with direct page loads.');
    }
    
    if (workflowContext.previousSteps.length > 0) {
      parts.push('');
      parts.push('**Previous Steps Already Completed:**');
      workflowContext.previousSteps.forEach(step => {
        parts.push(`- ✓ Step ${step.stepNumber}: ${step.description}`);
        if (step.resultUrl) {
          parts.push(`  → Page after: ${step.resultUrl}`);
        }
      });
      
      const lastStep = workflowContext.previousSteps[workflowContext.previousSteps.length - 1];
      if (lastStep.resultUrl) {
        parts.push('');
        parts.push(`**Current Page State**: You are now on the page that resulted from Step ${lastStep.stepNumber}.`);
        parts.push(`The current screenshot (IMAGE 1) shows this page: ${lastStep.resultUrl}`);
      }
    }
    
    parts.push('');
    parts.push('**IMPORTANT**: The reference screenshot (IMAGE 2) was taken during RECORDING at a specific point.');
    parts.push('The current page (IMAGE 1) may be at a DIFFERENT point in the workflow due to optimization or previous steps.');
    parts.push('Focus on finding the TARGET ELEMENT in the CURRENT page, not matching page states.');
    parts.push('');
  }
  
  // If we have an annotated reference, emphasize this prominently
  if (hasAnnotatedReference) {
    parts.push('## 🎯 CRITICAL: TWO-IMAGE MATCHING TASK');
    parts.push('');
    parts.push('You will receive TWO screenshots:');
    parts.push('- **IMAGE 1 (Current Page)**: Where you need to find the element and return coordinates');
    parts.push('- **IMAGE 2 (Reference with RED CIRCLE)**: Shows WHAT element to look for');
    parts.push('');
    parts.push('## STEP-BY-STEP PROCESS:');
    parts.push('');
    parts.push('### STEP 1: Look at IMAGE 2 (Reference)');
    parts.push('- Find the RED HOLLOW CIRCLE with corner brackets');
    parts.push('- Look INSIDE the circle to see what element is marked');
    parts.push('- Note: The circle is HOLLOW so you can see the element underneath');
    parts.push('- Identify the element: What does it look like? What text does it have? What color/style?');
    parts.push('');
    parts.push('### STEP 2: Look at IMAGE 1 (Current Page)');
    parts.push('- Search for the SAME element you identified in STEP 1');
    parts.push('- Match by: text content, visual appearance, button style, position in layout');
    parts.push('- The element may have moved slightly - that\'s OK, match by appearance');
    parts.push('- If the element isn\'t visible in IMAGE 1, return confidence: 0');
    parts.push('');
    parts.push('### STEP 3: Return Coordinates');
    parts.push('- Measure the CENTER point of the element IN IMAGE 1 (not IMAGE 2!)');
    parts.push('- Return coordinates in IMAGE 1\'s coordinate space');
    parts.push('- Include bounding box if possible');
    parts.push('- Set confidence based on how certain you are it\'s the same element');
    parts.push('');
    parts.push('## IMPORTANT:');
    parts.push('- Coordinates MUST be from IMAGE 1 (current page), not IMAGE 2 (reference)');
    parts.push('- The red circle shows WHAT to look for, not WHERE to click in the current page');
    parts.push('- If element not visible in IMAGE 1, return: { "coordinates": { "x": 0, "y": 0 }, "confidence": 0, "reasoning": "Element not visible in current screenshot" }');
    parts.push('');
  } else {
    parts.push('Analyze this screenshot and find the EXACT center coordinates of the target element.');
    parts.push('');
  }

  // Target description
  parts.push('## Target Element');
  if (target.text) {
    parts.push(`- **Text content**: "${target.text}"`);
  }
  if (target.role) {
    parts.push(`- **Element type**: ${target.role}`);
  }
  if (target.label) {
    parts.push(`- **Label/ARIA-label**: "${target.label}"`);
  }
  if (target.description) {
    parts.push(`- **Description**: ${target.description}`);
  }
  if (target.context) {
    parts.push(`- **Context**: ${target.context}`);
  }
  parts.push('');

  // Location hints
  if (hints) {
    parts.push('## Location Hints');
    if (hints.approximateCoordinates) {
      parts.push(`- **Approximate location**: around (${hints.approximateCoordinates.x}, ${hints.approximateCoordinates.y})`);
    }
    if (hints.recordedBounds) {
      parts.push(`- **Expected size**: approximately ${hints.recordedBounds.width}x${hints.recordedBounds.height} pixels`);
    }
    if (hints.nearbyElements && hints.nearbyElements.length > 0) {
      parts.push(`- **Near these elements**: ${hints.nearbyElements.join(', ')}`);
    }
    if (hints.excludeAreas && hints.excludeAreas.length > 0) {
      parts.push('- **DO NOT select these locations (already tried)**:');
      hints.excludeAreas.forEach(area => {
        parts.push(`  - (${area.x}, ${area.y})${area.label ? `: ${area.label}` : ''}`);
      });
    }
    parts.push('');
  }

  // Page context
  if (pageContext) {
    parts.push('## Page Context');
    parts.push(`- **Title**: ${pageContext.title}`);
    parts.push(`- **URL**: ${pageContext.url}`);
    parts.push(`- **Viewport**: ${pageContext.viewportSize.width}x${pageContext.viewportSize.height}`);
    parts.push('');
  }

  // No separate Instructions section needed - already covered above
  if (!hasAnnotatedReference) {
    parts.push('## Instructions');
    parts.push('1. Look at the screenshot carefully');
    parts.push('2. Find the element that matches the target description');
    parts.push('3. The element must be VISIBLE and CLICKABLE (not covered by overlays or modals)');
    parts.push('4. Return the CENTER coordinates of the element');
    parts.push('5. If multiple matches exist, choose the one closest to the approximate location');
    parts.push('');
  }

  // Special handling
  if (!hasAnnotatedReference) {
    parts.push('## Special Cases');
    parts.push('- If the target is a button, look for button styling (borders, backgrounds, hover effects)');
    parts.push('- For dropdown options, they may appear in a popup/portal - look for floating menus');
    parts.push('- Small icons might be near text - consider the clickable area');
    parts.push('- For Salesforce/Enterprise apps, look for SLDS/Lightning styled components');
    parts.push('');
  } else {
    parts.push('## Common Mistakes to Avoid:');
    parts.push('- ❌ Returning coordinates from IMAGE 2 - they won\'t work in the current page!');
    parts.push('- ❌ Clicking the red circle itself - look INSIDE the circle to see the element');
    parts.push('- ❌ Ignoring visual appearance - text alone may not be enough');
    parts.push('- ✅ Match by: text + style + position in layout + visual appearance');
    parts.push('');
  }

  // Response format
  parts.push('## Response Format');
  parts.push('');
  parts.push('CRITICAL: You MUST respond with ONLY valid JSON in this EXACT format.');
  parts.push('');
  parts.push('### If Element Found:');
  parts.push('{');
  parts.push('  "coordinates": { "x": 561, "y": 636 },');
  parts.push('  "boundingBox": { "x": 540, "y": 620, "width": 42, "height": 32 },');
  parts.push('  "confidence": 0.95,');
  parts.push('  "reasoning": "Found blue New button in action bar"');
  parts.push('}');
  parts.push('');
  parts.push('### If Element NOT Found (not visible, in closed modal, etc.):');
  parts.push('{');
  parts.push('  "coordinates": { "x": 0, "y": 0 },');
  parts.push('  "confidence": 0,');
  parts.push('  "reasoning": "Element not visible - Next button is in closed modal"');
  parts.push('}');
  parts.push('');
  parts.push('### STRICT Rules:');
  parts.push('- ALWAYS include "coordinates" object with "x" and "y" as numbers (never null)');
  parts.push('- ALWAYS include "confidence" as number between 0 and 1');
  parts.push('- ALWAYS include "reasoning" as string');
  parts.push('- If element not visible, use: { "x": 0, "y": 0 }, "confidence": 0');
  parts.push('- DO NOT return: {"url": ...}, {"error": ...}, or {"x": null, "y": null}');
  parts.push('- DO NOT wrap in markdown code blocks');
  parts.push('- DO NOT add explanations outside the JSON');
  parts.push('- Coordinates must be within viewport bounds (0 to ' + (payload.pageContext?.viewportSize?.width || 1920) + ' x ' + (payload.pageContext?.viewportSize?.height || 1080) + ')');

  return parts.join('\n');
}

function buildVerificationPrompt(payload: VisualClickRequest): string {
  const { target, elementInfo } = payload;
  const parts: string[] = [];

  parts.push('# Element Verification Task');
  parts.push('');
  parts.push('Look at this screenshot of a single UI element and determine if it matches the target.');
  parts.push('');

  parts.push('## Target Element');
  if (target.text) {
    parts.push(`- **Expected text**: "${target.text}"`);
  }
  if (target.role) {
    parts.push(`- **Expected type**: ${target.role}`);
  }
  if (target.label) {
    parts.push(`- **Expected label**: "${target.label}"`);
  }
  if (target.description) {
    parts.push(`- **Description**: ${target.description}`);
  }
  parts.push('');

  if (elementInfo) {
    parts.push('## Element Details');
    parts.push(`- **Tag**: ${elementInfo.tag}`);
    parts.push(`- **Visible text**: "${elementInfo.text}"`);
    if (elementInfo.role) {
      parts.push(`- **Role**: ${elementInfo.role}`);
    }
    if (elementInfo.ariaLabel) {
      parts.push(`- **ARIA label**: "${elementInfo.ariaLabel}"`);
    }
    parts.push(`- **Position**: (${elementInfo.coordinates.x}, ${elementInfo.coordinates.y})`);
    parts.push(`- **Size**: ${elementInfo.bounds.width}x${elementInfo.bounds.height}`);
    parts.push('');
  }

  parts.push('## Response Format');
  parts.push('Return ONLY valid JSON:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "isCorrect": <boolean>,');
  parts.push('  "confidence": <number between 0 and 1>,');
  parts.push('  "reasoning": "<explanation>"');
  parts.push('}');
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Gemini API Helpers
// ============================================================================

function buildGeminiRequest(prompt: string, screenshot: string, recordedScreenshot?: string, hasAnnotatedReference?: boolean): any {
  const parts: any[] = [{ text: prompt }];

  // Add current screenshot (labeled as "Current State")
  parts.push({
    text: '\n--- IMAGE 1: CURRENT STATE (where to click) ---\n'
  });
  
  const screenshotBase64 = extractBase64Data(screenshot);
  const mimeType = detectMimeType(screenshot);
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: screenshotBase64
    }
  });

  // Add recorded screenshot for comparison if provided
  if (recordedScreenshot) {
    if (hasAnnotatedReference) {
      // Annotated reference - emphasize the visual markers
      parts.push({
        text: '\n--- IMAGE 2: REFERENCE FROM RECORDING (with RED CIRCLE showing click location) ---\n'
      });
      parts.push({
        text: '⬇️ LOOK FOR THE RED CIRCLE WITH CROSSHAIR - that marks EXACTLY where to click ⬇️\n'
      });
    } else {
      parts.push({
        text: '\n--- IMAGE 2: REFERENCE FROM RECORDING ---\n'
      });
    }
    
    const recordedBase64 = extractBase64Data(recordedScreenshot);
    const recordedMime = detectMimeType(recordedScreenshot);
    parts.push({
      inline_data: {
        mime_type: recordedMime,
        data: recordedBase64
      }
    });
    
    // Add context about the second image
    if (hasAnnotatedReference) {
      parts.push({
        text: '\n[The reference image has a RED CIRCLE with CROSSHAIR showing the EXACT click location. Find the same element in the current screenshot and return its coordinates.]'
      });
    } else {
      parts.push({
        text: '\n[The second image shows how the element looked at recording time - use it for visual comparison]'
      });
    }
  }

  return {
    contents: [{
      parts,
      role: 'user'
    }],
    generationConfig: {
      temperature: 0.1, // Low temperature for precise coordinate extraction
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json', // Force JSON response
    },
    systemInstruction: {
      parts: [{
        text: 'You are a precise visual element locator. You MUST ALWAYS respond with valid JSON in this exact format: {"coordinates": {"x": number, "y": number}, "confidence": number, "reasoning": string}. If element not found, return {"coordinates": {"x": 0, "y": 0}, "confidence": 0, "reasoning": "explanation"}. NEVER return null values. NEVER return other JSON formats like {"url": ...} or {"error": ...}.'
      }]
    }
  };
}

function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

function detectMimeType(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'image/png';
  if (dataUrl.includes('image/jpeg')) return 'image/jpeg';
  if (dataUrl.includes('image/webp')) return 'image/webp';
  return 'image/png'; // Default
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseCoordinateResponse(geminiData: any, payload: VisualClickRequest): VisualClickResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('=== GEMINI RAW RESPONSE ===');
    console.log('Full response text:', text);
    console.log('Response length:', text.length);
    console.log('===========================');

    // Try to extract JSON from response (handle markdown code blocks too)
    let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      jsonMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    }
    if (!jsonMatch) {
      jsonMatch = text.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      console.error('No JSON found in Gemini response. Response text:', text);
      throw new Error('No JSON found in Gemini response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    console.log('Extracted JSON string:', jsonStr);
    
    const parsed = JSON.parse(jsonStr);
    console.log('Parsed object:', JSON.stringify(parsed, null, 2));

    // Handle case where AI says element is not visible (confidence: 0 without coordinates)
    if (parsed.confidence === 0 || parsed.confidence === '0') {
      console.log('AI reports element not visible, returning confidence: 0');
      return {
        coordinates: { x: 0, y: 0 },
        confidence: 0,
        reasoning: parsed.reasoning || 'Element not visible in current screenshot',
      };
    }
    
    // Validate coordinates - handle both direct and nested formats
    let coords = parsed.coordinates;
    
    // Handle case where x,y are at root level
    if (!coords && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      coords = { x: parsed.x, y: parsed.y };
      console.log('Found coordinates at root level:', coords);
    }
    
    // Handle case where x,y are null or not found (element not visible)
    if (!coords || parsed.x === null || parsed.y === null) {
      console.log('Coordinates are null - element not found');
      return {
        coordinates: { x: 0, y: 0 },
        confidence: 0,
        reasoning: parsed.reasoning || 'Element not found in current screenshot',
      };
    }
    
    // Handle case where coordinates are strings
    if (coords && (typeof coords.x === 'string' || typeof coords.y === 'string')) {
      coords = {
        x: parseInt(coords.x, 10),
        y: parseInt(coords.y, 10),
      };
      console.log('Converted string coordinates to numbers:', coords);
    }
    
    if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' || 
        isNaN(coords.x) || isNaN(coords.y)) {
      console.error('Invalid coordinates:', coords);
      console.error('Parsed object:', parsed);
      
      // Fallback: Try to extract coordinates from text using regex
      const textCoordMatch = text.match(/\(?\s*(\d+)\s*,\s*(\d+)\s*\)?/);
      if (textCoordMatch) {
        coords = {
          x: parseInt(textCoordMatch[1], 10),
          y: parseInt(textCoordMatch[2], 10),
        };
        console.log('Extracted coordinates from text using regex:', coords);
      } else {
        // Element truly not found - return confidence: 0
        console.log('No valid coordinates found - returning confidence: 0');
        return {
          coordinates: { x: 0, y: 0 },
          confidence: 0,
          reasoning: parsed.reasoning || 'Element not found - invalid coordinate format',
        };
      }
    }

    // Clamp coordinates to viewport bounds
    const viewportWidth = payload.pageContext?.viewportSize?.width || 1920;
    const viewportHeight = payload.pageContext?.viewportSize?.height || 1080;
    
    const result: VisualClickResponse = {
      coordinates: {
        x: Math.round(Math.max(0, Math.min(coords.x, viewportWidth))),
        y: Math.round(Math.max(0, Math.min(coords.y, viewportHeight))),
      },
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'AI analysis completed',
    };

    // Add bounding box if provided
    if (parsed.boundingBox && typeof parsed.boundingBox === 'object') {
      result.boundingBox = {
        x: Math.round(parsed.boundingBox.x || 0),
        y: Math.round(parsed.boundingBox.y || 0),
        width: Math.round(parsed.boundingBox.width || 0),
        height: Math.round(parsed.boundingBox.height || 0),
      };
    }

    // Add alternatives if provided
    if (Array.isArray(parsed.alternativeCandidates)) {
      result.alternativeCandidates = parsed.alternativeCandidates
        .filter((alt: any) => alt.coordinates && typeof alt.coordinates.x === 'number')
        .slice(0, 3)
        .map((alt: any) => ({
          coordinates: {
            x: Math.round(alt.coordinates.x),
            y: Math.round(alt.coordinates.y),
          },
          confidence: alt.confidence || 0,
          reasoning: alt.reasoning || '',
        }));
    }

    return result;
  } catch (error) {
    console.error('Error parsing coordinate response:', error);
    console.error('Full geminiData:', JSON.stringify(geminiData, null, 2));
    
    // Return detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response text';
    
    return {
      coordinates: { x: 0, y: 0 },
      confidence: 0,
      reasoning: `Parse error: ${errorMessage}. Raw response: ${responseText.substring(0, 200)}`,
    };
  }
}

function parseVerificationResponse(geminiData: any): VerificationResponse {
  try {
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in verification response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      isCorrect: typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : false,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Verification complete',
    };
  } catch (error) {
    console.error('Error parsing verification response:', error);
    return {
      isCorrect: false,
      confidence: 0,
      reasoning: 'Failed to parse verification response',
    };
  }
}

// ============================================================================
// Caching
// ============================================================================

function generateCacheKey(payload: VisualClickRequest): string {
  const keyData = {
    targetText: payload.target.text,
    targetRole: payload.target.role,
    targetLabel: payload.target.label,
    url: payload.pageContext?.url,
    hasScreenshot: !!payload.screenshot,
    excludeCount: payload.hints?.excludeAreas?.length || 0,
  };
  
  const str = JSON.stringify(keyData);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `visual_click_${Math.abs(hash).toString(36)}`;
}

async function checkCache(supabase: any, cacheKey: string): Promise<VisualClickResponse | null> {
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

    return data.response_data as VisualClickResponse;
  } catch (e) {
    console.error('Cache check error:', e);
    return null;
  }
}

async function saveToCache(supabase: any, cacheKey: string, result: VisualClickResponse): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour TTL for visual click

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

// ============================================================================
// Utilities
// ============================================================================

function jsonResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}


