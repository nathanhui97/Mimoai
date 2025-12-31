/**
 * Supabase Edge Function: visual_agent
 * 
 * The AI brain for the agent architecture.
 * Receives the current page state and decides what action to take.
 * 
 * This is the single point of AI decision-making.
 * The extension just executes whatever action this returns.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v2.0.0-true-vision';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

console.log('visual_agent Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'navigate' | 'other';
  targetText?: string;
  targetPlaceholder?: string; // For input fields
  targetSelector?: string; // CSS selector
  value?: string;
  completed: boolean;
}

interface HistoryEntry {
  stepNumber: number;
  action: string;
  params: Record<string, unknown>;
  result: 'success' | 'failed' | 'pending';
}

interface AgentRequest {
  screenshot: string;
  goal: string;
  hints: AgentHint[];
  currentHintIndex: number;
  history: HistoryEntry[];
  pageContext: {
    url: string;
    title: string;
    viewportSize: { width: number; height: number };
  };
  referenceScreenshot?: string;
  referenceClickPoint?: { x: number; y: number };
}

interface SemanticTarget {
  // Text matching
  text?: string;
  textMatch?: 'exact' | 'contains' | 'startsWith' | 'endsWith' | 'fuzzy';
  
  // Element identity
  role?: string;
  tagName?: string;
  ariaLabel?: string;
  testId?: string;
  title?: string;
  placeholder?: string;
  name?: string;
  
  // Context
  nearbyText?: string[];
  region?: string;
  parentText?: string;
  
  // Disambiguation
  index?: number;
  className?: string;
  
  // Timing
  waitTimeout?: number;
  
  // Canvas/Grid fallback (for Excel, Airtable)
  fallbackCoordinates?: { x: number; y: number };
}

interface AgentResponse {
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';
  params: {
    // For TRUE VISION click (pixel coordinates)
    x?: number;
    y?: number;
    description?: string; // What AI saw (for logging)
    // For type
    text?: string;
    // For scroll
    direction?: string;
    amount?: number;
    // For navigate
    url?: string;
    // For wait
    duration?: number;
    // For fail
    reason?: string;
  };
  reasoning: string;
  confidence: number;
  hintStepIndex?: number;
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
    console.log('visual_agent', VERSION, 'received request');
    const payload: AgentRequest = await req.json();
    
    console.log('Goal:', payload.goal);
    console.log('Current hint index:', payload.currentHintIndex);
    console.log('History length:', payload.history.length);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build prompt
    const prompt = buildAgentPrompt(payload);
    
    // Build Gemini request
    const geminiRequest = buildGeminiRequest(prompt, payload);

    // Call Gemini API
    console.log('Calling Gemini API...');
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    console.log('Gemini response status:', geminiResponse.status);

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const responseText = await geminiResponse.text();
    console.log('Raw Gemini response length:', responseText.length);
    console.log('Raw Gemini response preview:', responseText.substring(0, 200));
    
    const geminiData = JSON.parse(responseText);
    const result = parseAgentResponse(geminiData, payload);

    console.log('Agent decision:', result.action, result.params);
    console.log('Reasoning:', result.reasoning);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in visual_agent:', error);
    return new Response(
      JSON.stringify({
        action: 'fail',
        params: { reason: error instanceof Error ? error.message : 'Unknown error' },
        reasoning: 'Error occurred in agent',
        confidence: 0,
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
// Prompt Building
// ============================================================================

function buildAgentPrompt(payload: AgentRequest): string {
  const { goal, hints, currentHintIndex, history, pageContext, referenceClickPoint } = payload;
  const parts: string[] = [];

  // Header
  parts.push('# AI Web Automation Agent');
  parts.push('');
  parts.push('You are an AI agent automating a web workflow. You observe the current page and decide what action to take next.');
  parts.push('');

  // Goal
  parts.push('## Your Goal');
  parts.push(goal);
  parts.push('');

  // Hints from recording
  parts.push('## Workflow Hints (from recording)');
  parts.push('These are the steps recorded by the user. Use them as guidance, but adapt if the page looks different.');
  parts.push('');
  
  hints.forEach((hint, i) => {
    const status = hint.completed ? '✓' : (i === currentHintIndex ? '→' : '○');
    const isCurrent = i === currentHintIndex ? ' **<-- CURRENT**' : '';
    parts.push(`${status} Step ${hint.stepNumber}: ${hint.description}${isCurrent}`);
    
    // Show target info for the current step
    if (i === currentHintIndex) {
      if (hint.targetPlaceholder) {
        parts.push(`   → Use placeholder: "${hint.targetPlaceholder}" to find this input`);
      }
      if (hint.targetText && !hint.targetPlaceholder) {
        parts.push(`   → Look for text: "${hint.targetText}"`);
      }
    }
    
    if (hint.actionType === 'type' && hint.value) {
      parts.push(`   Value to type: "${hint.value}"`);
    }
  });
  parts.push('');

  // Action history
  if (history.length > 0) {
    parts.push('## Recent Actions Taken');
    history.slice(-5).forEach(h => {
      const resultIcon = h.result === 'success' ? '✓' : '✗';
      parts.push(`${resultIcon} ${h.action}(${JSON.stringify(h.params)}) - ${h.result}`);
    });
    parts.push('');
  }

  // Current page context
  parts.push('## Current Page');
  parts.push(`- URL: ${pageContext.url}`);
  parts.push(`- Title: ${pageContext.title}`);
  parts.push(`- Viewport: ${pageContext.viewportSize.width}x${pageContext.viewportSize.height}`);
  parts.push('');

  // Reference click point if available
  if (referenceClickPoint) {
    parts.push('## Reference Information');
    parts.push(`The recorded click was at approximately (${referenceClickPoint.x}, ${referenceClickPoint.y}).`);
    parts.push('Use this as a hint, but find the actual element in the current screenshot.');
    parts.push('');
  }

  // Instructions
  parts.push('## Available Actions');
  parts.push('- `click(target)`: Click an element by describing it semantically');
  parts.push('- `type(text)`: Type text into the focused input field');
  parts.push('- `scroll(direction, amount)`: Scroll the page (direction: up/down/left/right)');
  parts.push('- `navigate(url)`: Navigate to a specific URL');
  parts.push('- `wait(duration)`: Wait for specified milliseconds');
  parts.push('- `done()`: Workflow is complete');
  parts.push('- `fail(reason)`: Cannot continue (explain why)');
  parts.push('');

  // Decision process
  parts.push('## Your Task');
  parts.push('');
  parts.push('1. Look at the current screenshot (IMAGE 1)');
  if (payload.referenceScreenshot) {
    parts.push('2. Compare with reference screenshot (IMAGE 2) which shows what the user saw during recording');
  }
  parts.push('3. Identify what action to take based on the current hint');
  parts.push('4. If the hint is a CLICK: Look at the screenshot and return EXACT PIXEL COORDINATES where you see the element');
  parts.push('5. If the hint is TYPE: Click at the input field coordinates first, then type the text');
  parts.push('6. If all hints are completed: Return done()');
  parts.push('7. If stuck or element not visible: Return wait() or scroll() to reveal it');
  parts.push('');

  // Special guidance
  parts.push('## Important Notes - TRUE VISION MODE');
  parts.push('- You are clicking like a HUMAN - look at the screenshot and tell me WHERE to click');
  parts.push('- Return EXACT PIXEL COORDINATES: {"x": 749, "y": 525}');
  parts.push('- The top-left corner of the screenshot is (0, 0)');
  parts.push('- X increases going RIGHT, Y increases going DOWN');
  parts.push('- Click in the CENTER of buttons/elements for best results');
  parts.push('- For INPUT FIELDS: Return coordinates of the input box, then we will type');
  parts.push('- If a modal or popup blocks the target, handle it first');
  parts.push('- Salesforce/Lightning apps may have loading spinners - wait if page is loading');
  parts.push('');
  parts.push('## CRITICAL: Do Not Skip Steps');
  parts.push('- ALWAYS follow the workflow hints IN ORDER. Do NOT skip steps.');
  parts.push('- If an element from the current hint is NOT visible on screen:');
  parts.push('  1. FIRST: Try scrolling down with {"action":"scroll","params":{"direction":"down","amount":300}}');
  parts.push('  2. SECOND: Try scrolling up if you might have scrolled past it');
  parts.push('  3. ONLY after scrolling multiple times and still not finding it, then fail()');
  parts.push('- NEVER skip to a later step (like clicking Continue) just because the current element is not visible');
  parts.push('- The recorded steps are the user\'s exact workflow. Execute them in order.');
  parts.push('');

  // Response format
  parts.push('## Response Format - PIXEL COORDINATES');
  parts.push('Return ONLY valid JSON. For CLICK actions, return pixel coordinates:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "click",');
  parts.push('  "params": {');
  parts.push('    "x": 749,');
  parts.push('    "y": 525,');
  parts.push('    "description": "BOGO button in dropdown"');
  parts.push('  },');
  parts.push('  "reasoning": "I see the BOGO button in the dropdown at these coordinates",');
  parts.push('  "confidence": 0.95,');
  parts.push('  "hintStepIndex": 1');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For clicking an INPUT field before typing:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "click",');
  parts.push('  "params": {');
  parts.push('    "x": 362,');
  parts.push('    "y": 486,');
  parts.push('    "description": "Budget Amount input field"');
  parts.push('  },');
  parts.push('  "reasoning": "Clicking the budget input field to focus it before typing",');
  parts.push('  "confidence": 0.9,');
  parts.push('  "hintStepIndex": 2');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For type action (after clicking input):');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "type",');
  parts.push('  "params": { "text": "1000" },');
  parts.push('  "reasoning": "Typing budget amount into focused field",');
  parts.push('  "confidence": 0.9,');
  parts.push('  "hintStepIndex": 3');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For navigate action:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "navigate",');
  parts.push('  "params": { "url": "https://example.com/page" },');
  parts.push('  "reasoning": "Navigating directly to the target page",');
  parts.push('  "confidence": 1.0,');
  parts.push('  "hintStepIndex": 0');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('For done action (all steps complete):');
  parts.push('```json');
  parts.push('{');
  parts.push('  "action": "done",');
  parts.push('  "params": {},');
  parts.push('  "reasoning": "All workflow steps have been completed successfully",');
  parts.push('  "confidence": 1.0');
  parts.push('}');
  parts.push('```');

  return parts.join('\n');
}

// ============================================================================
// Gemini Request Building
// ============================================================================

function buildGeminiRequest(prompt: string, payload: AgentRequest): any {
  const parts: any[] = [{ text: prompt }];

  // Add current screenshot
  parts.push({
    text: '\n--- IMAGE 1: CURRENT PAGE STATE ---\n'
  });
  
  const screenshotBase64 = extractBase64Data(payload.screenshot);
  const mimeType = detectMimeType(payload.screenshot);
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: screenshotBase64
    }
  });

  // Add reference screenshot if provided
  if (payload.referenceScreenshot) {
    parts.push({
      text: '\n--- IMAGE 2: REFERENCE FROM RECORDING ---\n'
    });
    parts.push({
      text: 'This shows what the page looked like during recording. Use it to identify the target element.\n'
    });
    
    const refBase64 = extractBase64Data(payload.referenceScreenshot);
    const refMime = detectMimeType(payload.referenceScreenshot);
    parts.push({
      inline_data: {
        mime_type: refMime,
        data: refBase64
      }
    });
  }

  return {
    contents: [{
      parts,
      role: 'user'
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['click', 'type', 'scroll', 'navigate', 'wait', 'done', 'fail']
          },
          params: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              description: { type: 'string' },
              text: { type: 'string' },
              direction: { type: 'string' },
              amount: { type: 'number' },
              url: { type: 'string' },
              duration: { type: 'number' },
              reason: { type: 'string' }
            }
          },
          reasoning: { type: 'string' },
          confidence: { type: 'number' },
          hintStepIndex: { type: 'number' }
        },
        required: ['action', 'params', 'reasoning', 'confidence']
      }
    },
    systemInstruction: {
      parts: [{
        text: `You are a web automation AI agent with TRUE VISION. You must ALWAYS respond with valid JSON only.

CRITICAL: Your response must be ONLY a JSON object. No markdown, no code blocks, no explanations.

For CLICK actions, return EXACT PIXEL COORDINATES where you see the element in the screenshot.
Top-left corner is (0, 0). X increases going right, Y increases going down.
Click in the CENTER of buttons/elements.

Required JSON format:
{
  "action": "click" | "type" | "scroll" | "navigate" | "wait" | "done" | "fail",
  "params": { "x": number, "y": number, "description": string } for clicks,
  "reasoning": "string",
  "confidence": 0.0-1.0,
  "hintStepIndex": number
}

Examples:
{"action":"click","params":{"x":749,"y":525,"description":"BOGO button"},"reasoning":"I see BOGO button at these coordinates","confidence":0.9,"hintStepIndex":1}
{"action":"type","params":{"text":"Hello"},"reasoning":"Typing into focused field","confidence":0.85,"hintStepIndex":2}
{"action":"scroll","params":{"direction":"down","amount":300},"reasoning":"Element below fold","confidence":0.9,"hintStepIndex":3}
{"action":"done","params":{},"reasoning":"All steps complete","confidence":1.0}`
      }]
    }
  };
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseAgentResponse(geminiData: any, payload: AgentRequest): AgentResponse {
  try {
    // Check if Gemini returned an error
    if (geminiData.error) {
      console.error('Gemini API error:', geminiData.error);
      return createFailResponse(`Gemini error: ${geminiData.error.message || 'Unknown error'}`);
    }

    // Log the full geminiData structure for debugging
    console.log('Full geminiData structure:', JSON.stringify(geminiData, null, 2).substring(0, 1000));
    
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Extracted text length:', text.length);
    console.log('Extracted text preview:', text.substring(0, 500));

    if (!text) {
      console.error('Empty response from Gemini');
      return createFailResponse('Empty response from AI');
    }

    // Extract JSON
    let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      jsonMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    }
    if (!jsonMatch) {
      jsonMatch = text.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      console.error('No JSON found in response. Full text:', text);
      return createFailResponse('No valid JSON in AI response. AI returned plain text instead of JSON.');
    }

    let jsonStr = jsonMatch[1] || jsonMatch[0];
    console.log('Extracted JSON string (raw):', jsonStr);
    console.log('Extracted JSON length:', jsonStr.length);
    
    // Fix incomplete JSON from Gemini
    if (!jsonStr.trim().endsWith('}')) {
      console.log('JSON appears incomplete, attempting to fix...');
      
      // Count braces
      const openBraces = (jsonStr.match(/\{/g) || []).length;
      const closeBraces = (jsonStr.match(/\}/g) || []).length;
      
      // If reasoning field is incomplete, truncate and add defaults
      const reasoningMatch = jsonStr.match(/"reasoning":"([^"]*)/);
      if (reasoningMatch && !jsonStr.match(/"reasoning":"[^"]*"/)) {
        // Reasoning started but no closing quote
        const beforeReasoning = jsonStr.substring(0, jsonStr.lastIndexOf('"reasoning":'));
        jsonStr = beforeReasoning + '"reasoning":"Executing workflow step","confidence":0.8,"hintStepIndex":0}';
        console.log('Fixed incomplete reasoning field');
      } else if (openBraces > closeBraces) {
        // Just missing closing braces
        jsonStr += '}'.repeat(openBraces - closeBraces);
        console.log('Added', openBraces - closeBraces, 'closing braces');
      }
    }
    
    console.log('Fixed JSON:', jsonStr);
    
    const parsed = JSON.parse(jsonStr);
    console.log('Parsed action:', parsed.action);

    // Validate action
    const validActions = ['click', 'type', 'scroll', 'navigate', 'wait', 'done', 'fail'];
    if (!validActions.includes(parsed.action)) {
      console.error('Invalid action:', parsed.action);
      return createFailResponse(`Invalid action: ${parsed.action}`);
    }

    // Validate click action has coordinates (TRUE VISION mode)
    if (parsed.action === 'click') {
      const x = parsed.params?.x;
      const y = parsed.params?.y;
      
      if (typeof x !== 'number' || typeof y !== 'number') {
        console.error('Invalid click action - TRUE VISION requires pixel coordinates:', parsed.params);
        return createFailResponse('Click action missing x, y coordinates');
      }
      
      console.log(`Click action validated: coordinates (${x}, ${y})`);
    }

    // Validate type text
    if (parsed.action === 'type') {
      const text = parsed.params?.text;
      if (typeof text !== 'string') {
        console.error('Invalid type text:', text);
        return createFailResponse('Type action missing text parameter');
      }
    }

    return {
      action: parsed.action,
      params: parsed.params || {},
      reasoning: parsed.reasoning || 'AI decision',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      hintStepIndex: parsed.hintStepIndex,
    };
  } catch (error) {
    console.error('Error parsing response:', error);
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    // Try to log what we were trying to parse
    try {
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.error('Gemini raw text that failed to parse:', text);
    } catch (e) {
      console.error('Could not extract raw text for debugging');
    }
    return createFailResponse(`Failed to parse AI response: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function createFailResponse(reason: string): AgentResponse {
  return {
    action: 'fail',
    params: { reason },
    reasoning: reason,
    confidence: 0,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function extractBase64Data(dataUrl: string): string {
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  return base64Match ? base64Match[1] : dataUrl;
}

function detectMimeType(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'image/png';
  if (dataUrl.includes('image/jpeg')) return 'image/jpeg';
  if (dataUrl.includes('image/webp')) return 'image/webp';
  return 'image/png';
}

