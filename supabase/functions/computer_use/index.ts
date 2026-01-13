/**
 * Supabase Edge Function: computer_use
 * 
 * Unified vision endpoint using Gemini Computer Use model.
 * Replaces both visual_click and visual_agent with a specialized model
 * trained specifically for UI automation and coordinate detection.
 * 
 * Modes:
 * - "find_element": Find element coordinates (replaces visual_click)
 * - "agent": Decide next action in workflow (replaces visual_agent)
 * 
 * Features:
 * - Gemini Computer Use model (gemini-2.5-computer-use-preview)
 * - Normalized coordinate handling (0-999 grid)
 * - Built-in safety decision system
 * - Reference screenshot comparison
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v1.0.0-computer-use';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Use the specialized Computer Use model
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview:generateContent';

console.log('computer_use Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

// Request modes
type RequestMode = 'find_element' | 'agent';

// Common request fields
interface BaseRequest {
  mode: RequestMode;
  screenshot: string;
  pageContext: {
    url: string;
    title: string;
    viewportSize: { width: number; height: number };
  };
  referenceScreenshot?: string;
  hasAnnotatedReference?: boolean;
}

// Find element mode (replaces visual_click)
interface FindElementRequest extends BaseRequest {
  mode: 'find_element';
  target: {
    text?: string;
    role?: string;
    label?: string;
    description?: string;
    context?: string;
  };
  hints?: {
    approximateCoordinates?: { x: number; y: number };
    nearbyElements?: string[];
    excludeAreas?: Array<{ x: number; y: number; label?: string }>;
    recordedBounds?: { x: number; y: number; width: number; height: number };
    recordedClickPoint?: { x: number; y: number };
  };
  workflowContext?: WorkflowContext;
}

// Agent mode (replaces visual_agent)
interface AgentRequest extends BaseRequest {
  mode: 'agent';
  goal: string;
  hints: AgentHint[];
  currentHintIndex: number;
  history: HistoryEntry[];
  referenceClickPoint?: { x: number; y: number };
}

interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'navigate' | 'scroll' | 'other';
  targetText?: string;
  targetPlaceholder?: string;
  targetSelector?: string;
  value?: string;
  completed: boolean;
}

interface HistoryEntry {
  stepNumber: number;
  action: string;
  params: Record<string, unknown>;
  result: 'success' | 'failed' | 'pending';
}

interface WorkflowContext {
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
}

// Safety decision from Computer Use model
interface SafetyDecision {
  decision: 'allowed' | 'require_confirmation' | 'blocked';
  explanation: string;
}

// Find element response (backward compatible with visual_click)
interface FindElementResponse {
  coordinates: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  reasoning: string;
  safetyDecision?: SafetyDecision;
  alternativeCandidates?: Array<{
    coordinates: { x: number; y: number };
    confidence: number;
    reasoning: string;
  }>;
}

// Agent response (backward compatible with visual_agent)
interface AgentResponse {
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';
  params: {
    x?: number;
    y?: number;
    description?: string;
    text?: string;
    direction?: string;
    amount?: number;
    url?: string;
    duration?: number;
    reason?: string;
    pressEnter?: boolean;
    clearBeforeTyping?: boolean;
  };
  reasoning: string;
  confidence: number;
  hintStepIndex?: number;
  safetyDecision?: SafetyDecision;
}

type ComputerUseRequest = FindElementRequest | AgentRequest;

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
    console.log('computer_use Edge Function', VERSION, 'received request');
    const payload: ComputerUseRequest = await req.json();
    
    console.log('Mode:', payload.mode);
    console.log('Has screenshot:', !!payload.screenshot);
    console.log('Viewport:', payload.pageContext?.viewportSize);

    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured!');
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Route based on mode
    let result: FindElementResponse | AgentResponse;
    
    if (payload.mode === 'find_element') {
      result = await handleFindElement(payload as FindElementRequest);
    } else if (payload.mode === 'agent') {
      result = await handleAgent(payload as AgentRequest);
    } else {
      throw new Error(`Invalid mode: ${(payload as any).mode}`);
    }

    return jsonResponse(result);
  } catch (error) {
    console.error('Error in computer_use:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        coordinates: { x: 0, y: 0 },
        confidence: 0,
        reasoning: 'Error occurred during Computer Use analysis',
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
// Find Element Handler (replaces visual_click)
// ============================================================================

async function handleFindElement(payload: FindElementRequest): Promise<FindElementResponse> {
  console.log('handleFindElement - target:', payload.target);
  
  const prompt = buildFindElementPrompt(payload);
  const geminiRequest = buildGeminiComputerUseRequest(prompt, payload);
  
  console.log('Calling Gemini Computer Use API...');
  const geminiResponse = await callGeminiAPI(geminiRequest);
  
  return parseFindElementResponse(geminiResponse, payload.pageContext.viewportSize);
}

// ============================================================================
// Agent Handler (replaces visual_agent)
// ============================================================================

async function handleAgent(payload: AgentRequest): Promise<AgentResponse> {
  console.log('handleAgent - goal:', payload.goal);
  console.log('handleAgent - currentHintIndex:', payload.currentHintIndex);
  
  const prompt = buildAgentPrompt(payload);
  const geminiRequest = buildGeminiComputerUseRequest(prompt, payload);
  
  console.log('Calling Gemini Computer Use API...');
  const geminiResponse = await callGeminiAPI(geminiRequest);
  
  return parseAgentResponse(geminiResponse, payload.pageContext.viewportSize);
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildFindElementPrompt(payload: FindElementRequest): string {
  const { target, hints, pageContext, hasAnnotatedReference, workflowContext } = payload;
  const parts: string[] = [];

  parts.push('# Element Location Task');
  parts.push('');
  parts.push('Find the specified UI element in the screenshot and click on it.');
  parts.push('');

  // Workflow context
  if (workflowContext) {
    parts.push('## Workflow Context');
    parts.push(`Executing Step ${workflowContext.currentStepNumber} of ${workflowContext.totalSteps}.`);
    if (workflowContext.workflowGoal) {
      parts.push(`Goal: ${workflowContext.workflowGoal}`);
    }
    parts.push('');
  }

  // Reference image handling
  if (hasAnnotatedReference) {
    parts.push('## Reference Image');
    parts.push('A reference screenshot with a RED CIRCLE is provided showing the target element.');
    parts.push('Find the SAME element in the current screenshot and click on it.');
    parts.push('');
  }

  // Target description
  parts.push('## Target Element');
  if (target.text) {
    parts.push(`- Text: "${target.text}"`);
  }
  if (target.role) {
    parts.push(`- Type: ${target.role}`);
  }
  if (target.label) {
    parts.push(`- Label: "${target.label}"`);
  }
  if (target.description) {
    parts.push(`- Description: ${target.description}`);
  }
  if (target.context) {
    parts.push(`- Context: ${target.context}`);
  }
  parts.push('');

  // Location hints
  if (hints) {
    parts.push('## Hints');
    if (hints.approximateCoordinates) {
      parts.push(`- Approximate location: (${hints.approximateCoordinates.x}, ${hints.approximateCoordinates.y})`);
    }
    if (hints.recordedBounds) {
      parts.push(`- Expected size: ${hints.recordedBounds.width}x${hints.recordedBounds.height} pixels`);
    }
    if (hints.nearbyElements && hints.nearbyElements.length > 0) {
      parts.push(`- Nearby elements: ${hints.nearbyElements.join(', ')}`);
    }
    if (hints.excludeAreas && hints.excludeAreas.length > 0) {
      parts.push('- Exclude these locations (already tried):');
      hints.excludeAreas.forEach(area => {
        parts.push(`  - (${area.x}, ${area.y})${area.label ? `: ${area.label}` : ''}`);
      });
    }
    parts.push('');
  }

  // Page context
  parts.push('## Page Context');
  parts.push(`- URL: ${pageContext.url}`);
  parts.push(`- Title: ${pageContext.title}`);
  parts.push(`- Viewport: ${pageContext.viewportSize.width}x${pageContext.viewportSize.height}`);
  parts.push('');

  parts.push('## Instructions');
  parts.push('Click on the target element. If you cannot find it, do not click anywhere.');

  return parts.join('\n');
}

function buildAgentPrompt(payload: AgentRequest): string {
  const { goal, hints, currentHintIndex, history, pageContext, referenceClickPoint } = payload;
  const parts: string[] = [];

  parts.push('# Web Automation Agent');
  parts.push('');
  parts.push('You are automating a web workflow. Analyze the screenshot and decide the next action.');
  parts.push('');

  // Goal
  parts.push('## Goal');
  parts.push(goal);
  parts.push('');

  // Workflow hints
  parts.push('## Workflow Steps');
  hints.forEach((hint, i) => {
    const status = hint.completed ? '✓' : (i === currentHintIndex ? '→' : '○');
    const isCurrent = i === currentHintIndex ? ' **CURRENT**' : '';
    parts.push(`${status} Step ${hint.stepNumber}: ${hint.description}${isCurrent}`);
    
    if (i === currentHintIndex) {
      if (hint.targetPlaceholder) {
        parts.push(`   Target placeholder: "${hint.targetPlaceholder}"`);
      }
      if (hint.targetText) {
        parts.push(`   Target text: "${hint.targetText}"`);
      }
      if (hint.actionType === 'type' && hint.value) {
        parts.push(`   Value to type: "${hint.value}"`);
      }
    }
  });
  parts.push('');

  // Recent history
  if (history.length > 0) {
    parts.push('## Recent Actions');
    history.slice(-5).forEach(h => {
      const icon = h.result === 'success' ? '✓' : '✗';
      parts.push(`${icon} ${h.action}(${JSON.stringify(h.params)}) - ${h.result}`);
    });
    parts.push('');
  }

  // Page context
  parts.push('## Current Page');
  parts.push(`- URL: ${pageContext.url}`);
  parts.push(`- Title: ${pageContext.title}`);
  parts.push(`- Viewport: ${pageContext.viewportSize.width}x${pageContext.viewportSize.height}`);
  parts.push('');

  // Reference point
  if (referenceClickPoint) {
    parts.push('## Reference');
    parts.push(`Recorded click was at approximately (${referenceClickPoint.x}, ${referenceClickPoint.y}).`);
    parts.push('');
  }

  // Instructions
  parts.push('## Instructions');
  parts.push('- Execute steps IN ORDER. Do not skip steps.');
  parts.push('- For CLICK: Click on the target element.');
  parts.push('- For TYPE: First click on the input field, then type the text.');
  parts.push('- If element not visible: Scroll to find it.');
  parts.push('- If all steps complete: Return done().');
  parts.push('- If stuck: Return fail() with reason.');

  return parts.join('\n');
}

// ============================================================================
// Gemini Computer Use API
// ============================================================================

function buildGeminiComputerUseRequest(prompt: string, payload: ComputerUseRequest): any {
  const parts: any[] = [{ text: prompt }];

  // Add current screenshot
  parts.push({ text: '\n--- CURRENT SCREENSHOT ---\n' });
  const screenshotBase64 = extractBase64Data(payload.screenshot);
  const mimeType = detectMimeType(payload.screenshot);
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: screenshotBase64,
    },
  });

  // Add reference screenshot if provided
  if (payload.referenceScreenshot) {
    parts.push({ text: '\n--- REFERENCE SCREENSHOT ---\n' });
    if (payload.hasAnnotatedReference) {
      parts.push({ text: '(Contains RED CIRCLE marking the target element)\n' });
    }
    const refBase64 = extractBase64Data(payload.referenceScreenshot);
    const refMime = detectMimeType(payload.referenceScreenshot);
    parts.push({
      inline_data: {
        mime_type: refMime,
        data: refBase64,
      },
    });
  }

  return {
    contents: [{
      parts,
      role: 'user',
    }],
    tools: [{
      // Computer Use tool configuration
      computer_use: {
        environment: 'ENVIRONMENT_BROWSER',
        // Exclude actions we don't support yet
        excluded_predefined_functions: ['drag_and_drop'],
      },
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
    },
  };
}

async function callGeminiAPI(request: any): Promise<any> {
  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  console.log('Gemini API response status:', response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseFindElementResponse(
  geminiData: any,
  viewport: { width: number; height: number }
): FindElementResponse {
  try {
    const candidate = geminiData.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidate in response');
    }

    const content = candidate.content;
    const parts = content?.parts || [];

    // Look for function_call in parts
    let functionCall: any = null;
    let textReasoning = '';
    let safetyDecision: SafetyDecision | undefined;

    for (const part of parts) {
      if (part.function_call) {
        functionCall = part.function_call;
        // Check for safety_decision in args
        if (functionCall.args?.safety_decision) {
          safetyDecision = {
            decision: functionCall.args.safety_decision.decision || 'allowed',
            explanation: functionCall.args.safety_decision.explanation || '',
          };
        }
      }
      if (part.text) {
        textReasoning += part.text;
      }
    }

    if (!functionCall) {
      // No action suggested - element not found
      console.log('No function_call in response, element not found');
      return {
        coordinates: { x: 0, y: 0 },
        confidence: 0,
        reasoning: textReasoning || 'Element not found in screenshot',
        safetyDecision,
      };
    }

    const fname = functionCall.name;
    const args = functionCall.args || {};

    console.log('Function call:', fname, args);

    // Handle click_at action
    if (fname === 'click_at') {
      // Denormalize coordinates from 0-999 to actual pixels
      const coords = denormalizeCoordinates(
        args.x || args.y ? args : { x: 0, y: 0 },
        viewport
      );

      return {
        coordinates: coords,
        confidence: 0.9, // Computer Use model is specialized
        reasoning: textReasoning || `Click at (${coords.x}, ${coords.y})`,
        safetyDecision,
      };
    }

    // Handle type_text_at (also returns coordinates)
    if (fname === 'type_text_at') {
      const coords = denormalizeCoordinates(
        { x: args.x || 0, y: args.y || 0 },
        viewport
      );

      return {
        coordinates: coords,
        confidence: 0.9,
        reasoning: textReasoning || `Type at (${coords.x}, ${coords.y})`,
        safetyDecision,
      };
    }

    // Other actions - return no coordinates
    console.log('Unexpected action for find_element mode:', fname);
    return {
      coordinates: { x: 0, y: 0 },
      confidence: 0,
      reasoning: `Unexpected action: ${fname}`,
      safetyDecision,
    };
  } catch (error) {
    console.error('Error parsing find element response:', error);
    return {
      coordinates: { x: 0, y: 0 },
      confidence: 0,
      reasoning: `Parse error: ${error instanceof Error ? error.message : 'Unknown'}`,
    };
  }
}

function parseAgentResponse(
  geminiData: any,
  viewport: { width: number; height: number }
): AgentResponse {
  try {
    const candidate = geminiData.candidates?.[0];
    if (!candidate) {
      throw new Error('No candidate in response');
    }

    const content = candidate.content;
    const parts = content?.parts || [];

    let functionCall: any = null;
    let textReasoning = '';
    let safetyDecision: SafetyDecision | undefined;

    for (const part of parts) {
      if (part.function_call) {
        functionCall = part.function_call;
        if (functionCall.args?.safety_decision) {
          safetyDecision = {
            decision: functionCall.args.safety_decision.decision || 'allowed',
            explanation: functionCall.args.safety_decision.explanation || '',
          };
        }
      }
      if (part.text) {
        textReasoning += part.text;
      }
    }

    if (!functionCall) {
      // No action - check if workflow is done
      if (textReasoning.toLowerCase().includes('complete') || 
          textReasoning.toLowerCase().includes('done')) {
        return {
          action: 'done',
          params: {},
          reasoning: textReasoning || 'Workflow complete',
          confidence: 0.9,
          safetyDecision,
        };
      }
      
      return {
        action: 'fail',
        params: { reason: 'No action determined' },
        reasoning: textReasoning || 'Could not determine next action',
        confidence: 0,
        safetyDecision,
      };
    }

    const fname = functionCall.name;
    const args = functionCall.args || {};

    console.log('Agent function call:', fname, args);

    // Map Computer Use actions to our action format
    switch (fname) {
      case 'click_at': {
        const coords = denormalizeCoordinates({ x: args.x || 0, y: args.y || 0 }, viewport);
        return {
          action: 'click',
          params: {
            x: coords.x,
            y: coords.y,
            description: textReasoning.substring(0, 100),
          },
          reasoning: textReasoning || `Click at (${coords.x}, ${coords.y})`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'type_text_at': {
        const coords = denormalizeCoordinates({ x: args.x || 0, y: args.y || 0 }, viewport);
        return {
          action: 'type',
          params: {
            x: coords.x,
            y: coords.y,
            text: args.text || '',
            pressEnter: args.press_enter ?? false,
            clearBeforeTyping: args.clear_before_typing ?? true,
          },
          reasoning: textReasoning || `Type "${args.text}" at (${coords.x}, ${coords.y})`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'scroll_document': {
        return {
          action: 'scroll',
          params: {
            direction: args.direction || 'down',
          },
          reasoning: textReasoning || `Scroll ${args.direction}`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'scroll_at': {
        const coords = denormalizeCoordinates({ x: args.x || 500, y: args.y || 500 }, viewport);
        return {
          action: 'scroll',
          params: {
            x: coords.x,
            y: coords.y,
            direction: args.direction || 'down',
            amount: args.magnitude ? Math.round(args.magnitude / 1000 * viewport.height) : 300,
          },
          reasoning: textReasoning || `Scroll ${args.direction} at (${coords.x}, ${coords.y})`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'navigate': {
        return {
          action: 'navigate',
          params: {
            url: args.url || '',
          },
          reasoning: textReasoning || `Navigate to ${args.url}`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'wait_5_seconds': {
        return {
          action: 'wait',
          params: {
            duration: 5000,
          },
          reasoning: textReasoning || 'Wait for page to load',
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'go_back': {
        return {
          action: 'navigate',
          params: {
            url: 'javascript:history.back()',
          },
          reasoning: textReasoning || 'Go back',
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'go_forward': {
        return {
          action: 'navigate',
          params: {
            url: 'javascript:history.forward()',
          },
          reasoning: textReasoning || 'Go forward',
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'key_combination': {
        // Map to type action with special handling
        return {
          action: 'type',
          params: {
            text: '',
            description: `Key combination: ${args.keys}`,
          },
          reasoning: textReasoning || `Press ${args.keys}`,
          confidence: 0.9,
          safetyDecision,
        };
      }

      case 'hover_at': {
        const coords = denormalizeCoordinates({ x: args.x || 0, y: args.y || 0 }, viewport);
        return {
          action: 'click', // Treat hover as click for now
          params: {
            x: coords.x,
            y: coords.y,
            description: 'Hover action',
          },
          reasoning: textReasoning || `Hover at (${coords.x}, ${coords.y})`,
          confidence: 0.8,
          safetyDecision,
        };
      }

      default: {
        console.log('Unknown action:', fname);
        return {
          action: 'fail',
          params: { reason: `Unknown action: ${fname}` },
          reasoning: textReasoning || `Unknown action: ${fname}`,
          confidence: 0,
          safetyDecision,
        };
      }
    }
  } catch (error) {
    console.error('Error parsing agent response:', error);
    return {
      action: 'fail',
      params: { reason: error instanceof Error ? error.message : 'Parse error' },
      reasoning: `Parse error: ${error instanceof Error ? error.message : 'Unknown'}`,
      confidence: 0,
    };
  }
}

// ============================================================================
// Coordinate Handling
// ============================================================================

/**
 * Denormalize coordinates from 0-999 grid to actual pixel coordinates
 * Computer Use model returns coordinates in a 0-999 normalized space
 */
function denormalizeCoordinates(
  normalized: { x: number; y: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: Math.round((normalized.x / 1000) * viewport.width),
    y: Math.round((normalized.y / 1000) * viewport.height),
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

function jsonResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
