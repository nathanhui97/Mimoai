import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const VERSION = 'v3.1-reference-screenshots';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// Model URLs
// Flash model for thinking/analysis - fast and cheap
const GEMINI_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
// Computer Use model for execution - returns normalized coordinates (0-999)
const GEMINI_COMPUTER_USE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-computer-use-preview-10-2025:generateContent';

console.log('vision_analyze Edge Function', VERSION, 'starting...');

/**
 * Vision Analyze Edge Function
 *
 * Dual-model architecture:
 * - Gemini Flash: For thinking/analysis tasks (fast, cheap)
 * - Gemini 2.5 Computer Use: For execution (returns coordinates, actions)
 *
 * Analysis Handlers (Gemini Flash):
 * - analyze_screen, describe_screen, detect_page_type
 * - check_phase_complete, check_task_complete
 * - detect_errors, detect_success, verify_field
 * - find_element, find_all_elements, verify_action, compare_screens
 *
 * Execution Handlers (Gemini Computer Use):
 * - execute_action: Get next action with normalized coordinates (0-999)
 * - execute_action_rich: Same but with full VisionExecutionContext
 *
 * Rich Context Analysis (Gemini Flash):
 * - decide_action_rich, check_phase_complete_rich, check_task_complete_rich, get_recovery_rich
 */

interface RequestBody {
  type: string;
  screenshot?: string;
  screenshots?: {
    before?: string;
    after?: string;
  };
  description?: string;
  context?: Record<string, unknown>;
  goal?: string; // For Computer Use execution
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    if (!GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not configured!');
      throw new Error('GEMINI_API_KEY not configured');
    }

    const body: RequestBody = await req.json();
    const { type, screenshot, screenshots, description, context, goal } = body;

    console.log('vision_analyze received request type:', type);

    let result: unknown;

    switch (type) {
      // ========================================
      // Analysis Handlers (Gemini Flash)
      // ========================================
      case "analyze_screen":
        result = await analyzeScreen(screenshot!, context);
        break;

      case "describe_screen":
        result = await describeScreen(screenshot!, context);
        break;

      case "detect_page_type":
        result = await detectPageType(screenshot!, context);
        break;

      case "find_element":
        result = await findElement(screenshot!, description!, context);
        break;

      case "find_all_elements":
        result = await findAllElements(screenshot!, description!, context);
        break;

      case "decide_action":
        result = await decideAction(screenshot!, context);
        break;

      case "verify_action":
        result = await verifyAction(
          screenshots!.before!,
          screenshots!.after!,
          context
        );
        break;

      case "compare_screens":
        result = await compareScreens(
          screenshots!.before!,
          screenshots!.after!
        );
        break;

      case "check_phase_complete":
        result = await checkPhaseComplete(screenshot!, context);
        break;

      case "check_task_complete":
        result = await checkTaskComplete(screenshot!, context);
        break;

      case "detect_errors":
        result = await detectErrors(screenshot!);
        break;

      case "detect_success":
        result = await detectSuccess(screenshot!, context);
        break;

      case "verify_field":
        result = await verifyField(screenshot!, context);
        break;

      case "get_recovery":
        result = await getRecovery(screenshot!, context);
        break;

      // ========================================
      // Rich Context Analysis (Gemini Flash)
      // ========================================

      case "decide_action_rich":
        result = await decideActionRich(screenshot!, context);
        break;

      case "check_phase_complete_rich":
        result = await checkPhaseCompleteRich(screenshot!, context);
        break;

      case "check_task_complete_rich":
        result = await checkTaskCompleteRich(screenshot!, context);
        break;

      case "get_recovery_rich":
        result = await getRecoveryRich(screenshot!, context);
        break;

      // ========================================
      // Execution Handlers (Gemini Computer Use)
      // Returns normalized coordinates (0-999)
      // ========================================

      case "execute_action":
        result = await executeAction(screenshot!, goal || '', context);
        break;

      case "execute_action_rich":
        result = await executeActionRich(screenshot!, context);
        break;

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown type: ${type}` }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Vision analyze error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});

// ============================================================================
// Gemini Flash API Helper (for thinking/analysis)
// ============================================================================

async function callGeminiFlash(
  prompt: string,
  screenshot?: string,
  screenshot2?: string,
  referenceScreenshot?: string
): Promise<string> {
  const parts: any[] = [{ text: prompt }];

  if (screenshot) {
    parts.push({ text: '\n--- CURRENT SCREEN ---\n' });
    const base64Data = extractBase64Data(screenshot);
    const mimeType = detectMimeType(screenshot);
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    });
  }

  if (referenceScreenshot) {
    parts.push({ text: '\n--- REFERENCE FROM RECORDING (what user saw when they recorded this step) ---\n' });
    const base64Data = extractBase64Data(referenceScreenshot);
    const mimeType = detectMimeType(referenceScreenshot);
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    });
  }

  if (screenshot2) {
    parts.push({ text: '\n--- SECOND IMAGE ---\n' });
    const base64Data = extractBase64Data(screenshot2);
    const mimeType = detectMimeType(screenshot2);
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: base64Data
      }
    });
  }

  const geminiRequest = {
    contents: [{
      parts,
      role: 'user'
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    }
  };

  const response = await fetch(`${GEMINI_FLASH_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini Flash API error:', errorText);
    throw new Error(`Gemini Flash API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================================================
// Gemini Computer Use API Helper (for execution)
// Returns function_call with normalized coordinates (0-999)
// ============================================================================

interface ComputerUseAction {
  name: string;
  args: Record<string, unknown>;
  safety_decision?: {
    decision: string;
    explanation: string;
  };
}

interface ComputerUseResponse {
  action: ComputerUseAction | null;
  thinking: string;
  done: boolean;
  raw_response?: unknown;
}

async function callGeminiComputerUse(
  screenshot: string,
  goal: string,
  conversationHistory?: any[],
  referenceScreenshot?: string
): Promise<ComputerUseResponse> {
  const base64Data = extractBase64Data(screenshot);
  const mimeType = detectMimeType(screenshot);

  // Build contents array
  const contents: any[] = conversationHistory || [];

  // Build parts array with goal and screenshots
  const parts: any[] = [];

  // Add goal text
  if (referenceScreenshot) {
    parts.push({
      text: `${goal}\n\n⚠️ NOTE: I'm showing you TWO images:\n1. CURRENT SCREEN (first image) - what you see now, where you need to act\n2. REFERENCE FROM RECORDING (second image) - what the user saw when they recorded this step\n\nUse the REFERENCE to help identify the correct element on the CURRENT screen. The UI may have changed slightly.`
    });
  } else {
    parts.push({ text: goal });
  }

  // Add current screenshot
  parts.push({
    inline_data: {
      mime_type: mimeType,
      data: base64Data
    }
  });

  // Add reference screenshot if available
  if (referenceScreenshot) {
    const refBase64 = extractBase64Data(referenceScreenshot);
    const refMimeType = detectMimeType(referenceScreenshot);
    parts.push({
      inline_data: {
        mime_type: refMimeType,
        data: refBase64
      }
    });
  }

  // Add current turn with screenshot(s)
  contents.push({
    role: 'user',
    parts
  });

  const geminiRequest = {
    contents,
    tools: [
      {
        // Computer Use tool configuration
        computer_use: {
          environment: 'ENVIRONMENT_BROWSER',
          // Optionally exclude certain actions
          // excluded_predefined_functions: ['drag_and_drop']
        }
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 8192,
    }
  };

  const response = await fetch(`${GEMINI_COMPUTER_USE_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini Computer Use API error:', errorText);
    throw new Error(`Gemini Computer Use API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  // Extract thinking and function calls
  let thinking = '';
  let action: ComputerUseAction | null = null;
  let done = false;

  for (const part of parts) {
    if (part.text) {
      thinking += part.text + '\n';
      // Check if model indicates task is complete
      if (part.text.toLowerCase().includes('task complete') ||
          part.text.toLowerCase().includes('finished') ||
          part.text.toLowerCase().includes('done')) {
        done = true;
      }
    }
    // Handle both snake_case and camelCase response formats
    const functionCall = part.function_call || part.functionCall;
    if (functionCall) {
      action = {
        name: functionCall.name,
        args: functionCall.args || {},
        safety_decision: functionCall.args?.safety_decision
      };
      // Remove safety_decision from args if present (it's metadata, not an action arg)
      if (action.args.safety_decision) {
        delete action.args.safety_decision;
      }
    }
  }

  // If no function call, task might be done
  if (!action) {
    done = true;
  }

  return {
    action,
    thinking: thinking.trim(),
    done,
    raw_response: data
  };
}

// ============================================================================
// Utility Functions
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

function parseJSON(text: string): unknown {
  let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    jsonMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  }
  if (!jsonMatch) {
    jsonMatch = text.match(/\{[\s\S]*\}/);
  }

  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const jsonStr = jsonMatch[1] || jsonMatch[0];
  return JSON.parse(jsonStr);
}

// ============================================================================
// Analysis Handlers (Gemini Flash)
// ============================================================================

async function analyzeScreen(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Analyze this screenshot and provide a structured understanding of the screen.

Context: ${JSON.stringify(context || {})}

Return a JSON object with this structure:
{
  "pageType": "form" | "list" | "detail" | "dashboard" | "login" | "search" | "other",
  "pageDescription": "Brief description of the page",
  "applicationName": "Name of the app/site if visible",
  "components": [
    {
      "type": "button" | "link" | "text-field" | "password-field" | "dropdown" | "checkbox" | "radio-group" | etc,
      "label": "Human-readable label",
      "description": "What this component does",
      "boundingBox": { "x": 0, "y": 0, "width": 100, "height": 30, "centerX": 50, "centerY": 15 },
      "state": "enabled" | "disabled" | "focused" | "selected" | "checked" | "error",
      "value": "current value if any",
      "interactable": true
    }
  ],
  "state": {
    "activeModal": null,
    "activeDropdown": null,
    "focusedElement": null,
    "visibleErrors": [],
    "visibleSuccess": [],
    "isLoading": false
  },
  "formState": null,
  "possibleActions": ["click button X", "fill field Y", etc]
}

Focus on interactive elements and their locations. Provide approximate bounding boxes based on the image.
Return ONLY valid JSON, no explanation.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function describeScreen(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<string> {
  const prompt = `Describe this screenshot in 1-2 sentences. What page is this? What are the main elements visible?
Context: ${JSON.stringify(context || {})}

Return JSON: {"description": "your description here"}`;

  const text = await callGeminiFlash(prompt, screenshot);
  const parsed = parseJSON(text) as any;
  return parsed.description || text;
}

async function detectPageType(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<string> {
  const prompt = `What type of page is this? Return JSON with ONLY one of: form, list, detail, dashboard, login, search, other
Context: ${JSON.stringify(context || {})}

Return JSON: {"pageType": "type_here"}`;

  const text = await callGeminiFlash(prompt, screenshot);
  const parsed = parseJSON(text) as any;
  const validTypes = ["form", "list", "detail", "dashboard", "login", "search", "other"];
  const pageType = (parsed.pageType || "other").toLowerCase().trim();
  return validTypes.includes(pageType) ? pageType : "other";
}

async function findElement(
  screenshot: string,
  description: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Find the element matching this description: "${description}"

Context: ${JSON.stringify(context || {})}

Return a JSON object:
{
  "found": true/false,
  "boundingBox": { "x": 0, "y": 0, "width": 100, "height": 30, "centerX": 50, "centerY": 15 },
  "confidence": 0.0-1.0,
  "description": "What you found",
  "reasoning": "Why you chose this location"
}

The bounding box coordinates should be in pixels relative to the top-left of the image.
Estimate the center point (centerX, centerY) where a user should click.
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function findAllElements(
  screenshot: string,
  description: string,
  context?: Record<string, unknown>
): Promise<unknown[]> {
  const prompt = `Find ALL elements matching this description: "${description}"

Context: ${JSON.stringify(context || {})}

Return a JSON array of objects:
[
  {
    "found": true,
    "boundingBox": { "x": 0, "y": 0, "width": 100, "height": 30, "centerX": 50, "centerY": 15 },
    "confidence": 0.0-1.0,
    "description": "What this specific element is"
  }
]

Return ONLY valid JSON array.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text) as unknown[];
}

async function decideAction(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `You are an AI agent executing a task. Based on the current screen and context, decide the next action.

Context:
${JSON.stringify(context || {}, null, 2)}

Return a JSON object with this structure:
{
  "action": {
    "type": "click" | "double-click" | "type" | "clear-and-type" | "press-key" | "hotkey" | "scroll-down" | "scroll-up" | "hover" | "wait" | "done" | "stuck",
    "targetDescription": "description of element to interact with (for click/type)",
    "value": "text to type (for type actions)",
    "key": "key name (for press-key)",
    "keys": ["array", "of", "keys"],
    "scrollAmount": 300,
    "waitMs": 1000
  },
  "reasoning": "Why this action is the right next step",
  "confidence": 0.0-1.0,
  "expectedOutcome": "What we expect to happen after this action",
  "alternatives": []
}

If the task appears complete, use type "done".
If you're stuck and can't proceed, use type "stuck".
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function verifyAction(
  beforeScreenshot: string,
  afterScreenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Verify if the action achieved its intended outcome.

Action context:
${JSON.stringify(context || {}, null, 2)}

FIRST IMAGE: Before the action
SECOND IMAGE: After the action

Return a JSON object:
{
  "success": true/false,
  "confidence": 0.0-1.0,
  "explanation": "What happened",
  "stateChanged": true/false,
  "progressMade": true/false,
  "goalAchieved": true/false,
  "newErrors": ["any new error messages"],
  "successIndicators": ["any success indicators"]
}

Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, beforeScreenshot, afterScreenshot);
  return parseJSON(text);
}

async function compareScreens(
  beforeScreenshot: string,
  afterScreenshot: string
): Promise<unknown> {
  const prompt = `Did the screen change between these two images?

FIRST IMAGE: Before
SECOND IMAGE: After

Return JSON:
{
  "changed": true/false,
  "description": "Brief description of what changed"
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, beforeScreenshot, afterScreenshot);
  return parseJSON(text);
}

async function checkPhaseComplete(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Check if this task phase is complete.

Phase details:
${JSON.stringify(context || {}, null, 2)}

Return JSON:
{
  "complete": true/false,
  "confidence": 0.0-1.0,
  "reason": "Why you think it is/isn't complete"
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function checkTaskComplete(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Check if this task is complete.

Task details:
${JSON.stringify(context || {}, null, 2)}

Return JSON:
{
  "complete": true/false,
  "confidence": 0.0-1.0,
  "reason": "Why you think the task is/isn't complete"
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function detectErrors(screenshot: string): Promise<unknown> {
  const prompt = `Look for any error messages, validation errors, or warning indicators on this screen.

Return JSON:
{
  "hasErrors": true/false,
  "errors": ["list of error messages found"]
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function detectSuccess(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Look for success indicators on this screen.

Expected indicators: ${JSON.stringify((context as any)?.expectedIndicators || [])}

Return JSON:
{
  "hasSuccess": true/false,
  "matchedIndicators": ["which expected indicators were found"]
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function verifyField(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `Verify if the field "${(context as any)?.fieldDescription}" contains the expected value "${(context as any)?.expectedValue}".

Return JSON:
{
  "filled": true/false,
  "actualValue": "what the field actually contains",
  "confidence": 0.0-1.0
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function getRecovery(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const prompt = `The automation is stuck. Suggest recovery actions.

Stuck reason: ${(context as any)?.stuckReason}
Task: ${JSON.stringify((context as any)?.task || {})}
Recent history: ${JSON.stringify((context as any)?.recentHistory || [])}

Return JSON:
{
  "suggestions": ["human-readable suggestions"],
  "alternativeActions": [
    {
      "type": "action type",
      "targetDescription": "what to interact with",
      "value": "value if needed"
    }
  ]
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

// ============================================================================
// Execution Handlers (Gemini Computer Use)
// Returns normalized coordinates (0-999) for actual execution
// ============================================================================

/**
 * Execute action using Computer Use model
 * Returns function_call with normalized coordinates (0-999)
 */
async function executeAction(
  screenshot: string,
  goal: string,
  context?: Record<string, unknown>
): Promise<ComputerUseResponse> {
  // Build goal from context if not provided
  let fullGoal = goal;
  if (context) {
    const task = context.task as Record<string, unknown> || {};
    const phase = context.currentPhase as Record<string, unknown> || {};
    fullGoal = `
Task: ${task.name || 'Unknown'}
Goal: ${task.goal || goal}
Current Phase: ${phase.name || 'Unknown'}
Phase Intent: ${phase.intent || 'Complete the current step'}

${goal}
`;
  }

  return await callGeminiComputerUse(screenshot, fullGoal);
}

/**
 * Execute action with rich context using Computer Use model
 * Uses full VisionExecutionContext for intelligent execution
 * Returns function_call with normalized coordinates (0-999)
 */
async function executeActionRich(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<ComputerUseResponse> {
  // Extract rich context
  const task = context?.task as Record<string, unknown> || {};
  const currentPhase = context?.currentPhase as Record<string, unknown> || {};
  const knowledge = context?.knowledge as Record<string, unknown> || {};
  const successCriteria = context?.successCriteria as Record<string, unknown> || {};
  const adaptations = (context?.adaptations as unknown[]) || [];
  const demonstration = (context?.demonstration as unknown[]) || [];
  const experience = context?.experience as Record<string, unknown> || {};
  const variables = context?.variables as Record<string, string> || {};
  const recentHistory = (context?.recentHistory as unknown[]) || [];

  // Get reference screenshot from current step guidance or demonstration
  const referenceScreenshot = extractReferenceScreenshot(currentPhase, demonstration);

  // Build rich goal for Computer Use model
  const goal = `You are a virtual employee executing a learned task.

## YOUR TASK
Name: ${task.name || 'Unknown'}
Goal: ${task.goal || task.description || 'Complete the task'}
Domain: ${task.domain || 'Web Application'}

## CURRENT PHASE: ${currentPhase.name || 'Unknown Phase'}
Intent: ${currentPhase.intent || 'Execute the current phase'}

## WHAT USER TAUGHT YOU (Step Guidance)
${formatStepGuidance(currentPhase.stepGuidance as unknown[])}

## RULES YOU MUST FOLLOW (from user training)
${formatRules(knowledge.rules as string[])}

## SUCCESS CRITERIA
${formatSuccessCriteria(successCriteria)}

## IF THINGS GO WRONG (Adaptation Strategies)
${formatAdaptations(adaptations)}

## HOW USER DEMONSTRATED THIS
${formatDemonstration(demonstration)}

## PAST EXPERIENCE
- Executed: ${experience.timesExecuted || 0} times
- Success rate: ${formatPercent(experience.successRate as number)}
${formatExperience(experience)}

## CURRENT DATA (Variables)
${formatVariables(variables)}

## RECENT ACTIONS
${formatHistory(recentHistory)}

Based on your training and what you see on the screen, execute the next action.
Use your step guidance and rules to decide what to do. Don't just guess.`;

  return await callGeminiComputerUse(screenshot, goal, undefined, referenceScreenshot);
}

// ============================================================================
// Rich Context Analysis Handlers (Gemini Flash)
// ============================================================================

async function decideActionRich(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const task = context?.task as Record<string, unknown> || {};
  const currentPhase = context?.currentPhase as Record<string, unknown> || {};
  const knowledge = context?.knowledge as Record<string, unknown> || {};
  const successCriteria = context?.successCriteria as Record<string, unknown> || {};
  const adaptations = (context?.adaptations as unknown[]) || [];
  const demonstration = (context?.demonstration as unknown[]) || [];
  const experience = context?.experience as Record<string, unknown> || {};
  const variables = context?.variables as Record<string, string> || {};
  const screenState = context?.screenState as Record<string, unknown> || {};
  const recentHistory = (context?.recentHistory as unknown[]) || [];

  // Get reference screenshot from current step guidance or demonstration
  const referenceScreenshot = extractReferenceScreenshot(currentPhase, demonstration);
  const hasReference = !!referenceScreenshot;

  const prompt = `You are a virtual employee executing a learned task.
${hasReference ? '\n⚠️ IMPORTANT: I am showing you TWO images:\n1. CURRENT SCREEN - what you see now\n2. REFERENCE FROM RECORDING - what the user saw when they recorded this step\n\nCompare these images to find the right element. The UI may have changed slightly, but look for similar elements.\n' : ''}

## YOUR TASK
Name: ${task.name || 'Unknown'}
Goal: ${task.goal || task.description || 'Complete the task'}
Domain: ${task.domain || 'Web Application'}

## CURRENT PHASE: ${currentPhase.name || 'Unknown Phase'}
Intent: ${currentPhase.intent || 'Execute the current phase'}

## WHAT USER TAUGHT YOU (Step Guidance)
${formatStepGuidance(currentPhase.stepGuidance as unknown[])}

## RULES YOU MUST FOLLOW (from user training)
${formatRules(knowledge.rules as string[])}

## SUCCESS CRITERIA
${formatSuccessCriteria(successCriteria)}

## IF THINGS GO WRONG (Adaptation Strategies)
${formatAdaptations(adaptations)}

## HOW USER DEMONSTRATED THIS
${formatDemonstration(demonstration)}

## PAST EXPERIENCE
- Executed: ${experience.timesExecuted || 0} times
- Success rate: ${formatPercent(experience.successRate as number)}
${formatExperience(experience)}

## CURRENT DATA (Variables)
${formatVariables(variables)}

## WHAT YOU SEE NOW
Page Type: ${screenState.pageType || 'unknown'}
${screenState.pageDescription || 'No description available'}

## RECENT ACTIONS
${formatHistory(recentHistory)}

Based on your training and what you see, decide the next action.

Return a JSON object:
{
  "action": {
    "type": "click" | "double-click" | "type" | "clear-and-type" | "press-key" | "hotkey" | "scroll-down" | "scroll-up" | "hover" | "wait" | "done" | "stuck",
    "targetDescription": "description of element (use guidance hints!)",
    "value": "text to type",
    "key": "key name",
    "keys": ["keys for hotkey"],
    "scrollAmount": 300,
    "waitMs": 1000
  },
  "reasoning": "Why this action, referencing your training",
  "confidence": 0.0-1.0,
  "expectedOutcome": "What should happen",
  "alternatives": []
}

IMPORTANT: Use your step guidance and rules to decide. Don't just guess.
${hasReference ? 'Use the REFERENCE image to help identify the correct element on the CURRENT screen.' : ''}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot, undefined, referenceScreenshot);
  return parseJSON(text);
}

async function checkPhaseCompleteRich(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const currentPhase = context?.currentPhase as Record<string, unknown> || {};
  const successCriteria = context?.successCriteria as Record<string, unknown> || {};
  const screenState = context?.screenState as Record<string, unknown> || {};

  const prompt = `Check if this task phase is complete.

## PHASE: ${currentPhase.name || 'Unknown'}
Intent: ${currentPhase.intent || 'Unknown'}

## SUCCESS CRITERIA TO CHECK
${formatSuccessCriteria(successCriteria)}

## STEP GUIDANCE (what should have happened)
${formatStepGuidance(currentPhase.stepGuidance as unknown[])}

## CURRENT SCREEN STATE
${screenState.pageDescription || 'No description'}

Return JSON:
{
  "complete": true/false,
  "confidence": 0.0-1.0,
  "reason": "Why you think phase is/isn't complete",
  "matchedCriteria": ["which success criteria were matched"]
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function checkTaskCompleteRich(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const task = context?.task as Record<string, unknown> || {};
  const successCriteria = context?.successCriteria as Record<string, unknown> || {};
  const screenState = context?.screenState as Record<string, unknown> || {};

  const prompt = `Check if this entire task is complete.

## TASK: ${task.name || 'Unknown'}
Goal: ${task.goal || task.description || 'Unknown'}

## SUCCESS CRITERIA
${formatSuccessCriteria(successCriteria)}

## EXPECTED END STATE
${successCriteria.endState || 'Task completed'}

## CURRENT SCREEN
${screenState.pageDescription || 'No description'}

Return JSON:
{
  "complete": true/false,
  "confidence": 0.0-1.0,
  "reason": "Why task is/isn't complete",
  "matchedIndicators": ["which success indicators were found"]
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

async function getRecoveryRich(
  screenshot: string,
  context?: Record<string, unknown>
): Promise<unknown> {
  const task = context?.task as Record<string, unknown> || {};
  const currentPhase = context?.currentPhase as Record<string, unknown> || {};
  const knowledge = context?.knowledge as Record<string, unknown> || {};
  const adaptations = (context?.adaptations as unknown[]) || [];
  const screenState = context?.screenState as Record<string, unknown> || {};
  const recentHistory = (context?.recentHistory as unknown[]) || [];
  const stuckReason = context?.stuckReason || 'Unknown reason';

  const prompt = `The automation is stuck. Help me recover.

## STUCK REASON
${stuckReason}

## TASK: ${task.name || 'Unknown'}
Goal: ${task.goal || 'Unknown'}

## CURRENT PHASE: ${currentPhase.name || 'Unknown'}
What I was trying to do: ${currentPhase.intent || 'Unknown'}

## KNOWN ADAPTATION STRATEGIES
${formatAdaptations(adaptations)}

## USER-TAUGHT TIPS
${formatTips(knowledge.tips as string[])}

## RECENT ACTIONS (what I tried)
${formatHistory(recentHistory)}

## CURRENT SCREEN
${screenState.pageDescription || 'No description'}

Based on my training and the adaptation strategies, suggest how to recover.

Return JSON:
{
  "suggestions": ["human-readable recovery suggestions"],
  "alternativeActions": [
    {
      "type": "action type",
      "targetDescription": "what to try",
      "value": "value if needed",
      "reasoning": "why this might work"
    }
  ],
  "shouldAskUser": true/false,
  "userQuestion": "question to ask user if shouldAskUser is true"
}
Return ONLY valid JSON.`;

  const text = await callGeminiFlash(prompt, screenshot);
  return parseJSON(text);
}

// ============================================================================
// Helper functions for formatting context
// ============================================================================

function formatStepGuidance(guidance: unknown[] | undefined): string {
  if (!guidance || guidance.length === 0) return "No specific guidance provided.";

  return guidance.map((g: unknown) => {
    const step = g as Record<string, unknown>;
    const strategy = step.elementFindingStrategy as Record<string, unknown> || {};
    return `• Step ${step.stepIndex}: ${step.intent || 'Unknown'}
  - Look for: ${strategy.lookingFor || 'Unknown'}
  - Where: ${strategy.searchContext || 'On screen'}
  - Distinguishers: ${(strategy.distinguishers as string[] || []).join(', ') || 'None'}
  - Expected outcome: ${step.expectedOutcome || 'Unknown'}
  - Alternatives: ${(step.alternatives as string[] || []).join(', ') || 'None'}`;
  }).join('\n');
}

function formatRules(rules: string[] | undefined): string {
  if (!rules || rules.length === 0) return "No specific rules.";
  return rules.map(r => `• ${r}`).join('\n');
}

function formatTips(tips: string[] | undefined): string {
  if (!tips || tips.length === 0) return "No specific tips.";
  return tips.map(t => `• ${t}`).join('\n');
}

function formatSuccessCriteria(criteria: Record<string, unknown>): string {
  const indicators = (criteria.indicators as unknown[]) || [];
  const failureIndicators = (criteria.failureIndicators as string[]) || [];

  let result = "Success indicators:\n";
  result += indicators.map((i: unknown) => {
    const ind = i as Record<string, unknown>;
    return `• ${ind.description || 'Unknown'} (${ind.priority || 'secondary'})`;
  }).join('\n') || "None specified";

  if (failureIndicators.length > 0) {
    result += "\n\nFailure indicators:\n";
    result += failureIndicators.map(f => `• ${f}`).join('\n');
  }

  return result;
}

function formatAdaptations(adaptations: unknown[]): string {
  if (!adaptations || adaptations.length === 0) return "No adaptation strategies.";

  return adaptations.map((a: unknown) => {
    const adapt = a as Record<string, unknown>;
    return `• If "${adapt.scenario}" → ${adapt.howToAdapt}`;
  }).join('\n');
}

function formatDemonstration(demo: unknown[]): string {
  if (!demo || demo.length === 0) return "No demonstration recorded.";

  return demo.slice(0, 10).map((d: unknown) => {
    const step = d as Record<string, unknown>;
    const value = step.value ? ` = "${step.value}"` : '';
    const ctx = step.context ? ` (in ${step.context})` : '';
    const ref = step.referenceScreenshot as Record<string, string> | undefined;
    const hasScreenshot = ref?.viewport || ref?.elementSnippet ? ' 📸' : '';
    return `${step.stepIndex}. ${step.action}: ${step.target}${value}${ctx}${hasScreenshot}`;
  }).join('\n');
}

function formatExperience(exp: Record<string, unknown>): string {
  const issues = (exp.commonIssues as string[]) || [];
  const fixes = (exp.provenFixes as string[]) || [];

  let result = '';
  if (issues.length > 0) {
    result += `- Common issues: ${issues.join(', ')}\n`;
  }
  if (fixes.length > 0) {
    result += `- What worked before: ${fixes.join(', ')}`;
  }
  return result || '- No prior experience data';
}

function formatVariables(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return "No variables provided.";
  return entries.map(([k, v]) => `• ${k}: "${v}"`).join('\n');
}

function formatHistory(history: unknown[]): string {
  if (!history || history.length === 0) return "No recent actions.";

  return history.map((h: unknown) => {
    const action = h as Record<string, unknown>;
    const status = action.success ? '✓' : '✗';
    return `${status} ${action.action} - ${action.reasoning || 'No reasoning'}`;
  }).join('\n');
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null) return '0%';
  return `${(value * 100).toFixed(0)}%`;
}

/**
 * Extract the most relevant reference screenshot for the current step
 * ALWAYS prefers elementSnippet (smaller ~20-50KB, more focused) over viewport (~200-500KB)
 * Looks in step guidance first, then falls back to demonstration
 */
function extractReferenceScreenshot(
  currentPhase: Record<string, unknown>,
  demonstration: unknown[]
): string | undefined {
  // First, try to get from step guidance (most specific)
  const stepGuidance = currentPhase?.stepGuidance as unknown[];
  if (stepGuidance && stepGuidance.length > 0) {
    // Get the first step in this phase that has a reference screenshot
    for (const guidance of stepGuidance) {
      const step = guidance as Record<string, unknown>;
      const ref = step.referenceScreenshot as Record<string, string> | undefined;
      // Always prefer elementSnippet - it's smaller and more focused
      if (ref?.elementSnippet) {
        console.log(`Using elementSnippet reference from step guidance (step ${step.stepIndex})`);
        return ref.elementSnippet;
      }
    }
    // Only fall back to viewport if no elementSnippet found anywhere
    for (const guidance of stepGuidance) {
      const step = guidance as Record<string, unknown>;
      const ref = step.referenceScreenshot as Record<string, string> | undefined;
      if (ref?.viewport) {
        console.log(`Fallback: Using viewport reference from step guidance (step ${step.stepIndex})`);
        return ref.viewport;
      }
    }
  }

  // Fall back to demonstration - same preference order
  if (demonstration && demonstration.length > 0) {
    const stepIndices = currentPhase?.stepIndices as number[] || [];

    // First pass: look for elementSnippet in current phase steps
    for (const stepIndex of stepIndices) {
      const demoStep = demonstration.find((d: unknown) => {
        const step = d as Record<string, unknown>;
        return step.stepIndex === stepIndex;
      }) as Record<string, unknown> | undefined;

      const ref = demoStep?.referenceScreenshot as Record<string, string> | undefined;
      if (ref?.elementSnippet) {
        console.log(`Using elementSnippet from demonstration (step ${stepIndex})`);
        return ref.elementSnippet;
      }
    }

    // Second pass: any elementSnippet from demonstration
    for (const d of demonstration) {
      const step = d as Record<string, unknown>;
      const ref = step.referenceScreenshot as Record<string, string> | undefined;
      if (ref?.elementSnippet) {
        console.log(`Using first available elementSnippet (step ${step.stepIndex})`);
        return ref.elementSnippet;
      }
    }

    // Last resort: viewport (but this should rarely happen)
    for (const stepIndex of stepIndices) {
      const demoStep = demonstration.find((d: unknown) => {
        const step = d as Record<string, unknown>;
        return step.stepIndex === stepIndex;
      }) as Record<string, unknown> | undefined;

      const ref = demoStep?.referenceScreenshot as Record<string, string> | undefined;
      if (ref?.viewport) {
        console.log(`Fallback: Using viewport from demonstration (step ${stepIndex})`);
        return ref.viewport;
      }
    }
  }

  console.log('No reference screenshot available');
  return undefined;
}
