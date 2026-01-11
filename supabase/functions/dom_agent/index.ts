/**
 * Supabase Edge Function: dom_agent
 * 
 * DOM-first AI agent brain. Receives a structured DOM map (not screenshots)
 * and decides what semantic action to take.
 * 
 * Returns semantic targets (role, name, scope) that the executor uses
 * with the reliable locator/scope engine - NOT pixel coordinates.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const VERSION = 'v1.0.0-dom-first';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

console.log('dom_agent Edge Function', VERSION, 'starting...');

// ============================================================================
// Types
// ============================================================================

interface AgentHint {
  stepNumber: number;
  description: string;
  // Note: 'navigate' is deprecated - NAVIGATION steps are now converted to 'click'
  actionType: 'click' | 'type' | 'navigate' | 'scroll' | 'other';
  targetText?: string;
  targetPlaceholder?: string;
  targetRole?: string;
  value?: string;
  completed: boolean;
  
  // Context from recording for better matching
  recordedSelector?: string;      // Primary CSS/XPath selector from recording
  recordedTestId?: string;        // data-testid if captured
  recordedAriaLabel?: string;     // aria-label from recording (critical for exact matching)
  recordedScopeHint?: string;     // Scope from recording (e.g., "Accounts Table", "OFFERS EXPIRING IN NEXT 28 DAYS")
  recordedRowKey?: string;        // Row key if element was in a table row
  nearbyText?: string[];          // Nearby anchor text from recording
  
  // Natural language context (from AI translation)
  naturalLanguage?: {
    intent: string;           // "Open the promotion type dropdown"
    precondition: string;     // "Page must be on promotion tool"
    expectedOutcome: string;  // "Dropdown opens with BOGO, FLAT options"
    dependencies: number[];   // [0] (depends on step 0 being complete)
  };
  
  failureCount?: number;  // Track how many times this hint has failed
}

interface HistoryEntry {
  stepNumber: number;
  action: string;
  target?: SemanticTarget;
  result: 'success' | 'failed' | 'pending';
  error?: string;
}

interface PageContext {
  url: string;
  title: string;
  hasModal: boolean;
  modalTitle?: string;
  // CRITICAL: When dropdown is open, AI must click an option BEFORE any other action
  hasOpenDropdown?: boolean;
  dropdownOptions?: string[];
  formFields: Array<{ name: string; value?: string; type: string }>;
  buttonCount: number;
  linkCount: number;
  inputCount: number;
  headings: string[];
}

interface RankedCandidate {
  index: number;
  role: string;
  name: string;
  text?: string;
  testId?: string;
  id?: string;
  placeholder?: string;
  scopePath?: string[];
  rowKey?: string;
  widgetTitle?: string;
  frameId: number;
  score: number;
}

interface SheetState {
  domain: 'google-sheets' | 'excel-online' | null;
  sheetName: string;
  headers: Array<{ column: string; text: string }>;
  dataRange: {
    firstRow: number;
    lastRow: number;
    firstColumn: string;
    lastColumn: string;
  };
  columns: Array<{
    letter: string;
    header: string;
    dataType: 'text' | 'number' | 'date' | 'mixed' | 'empty';
    rowCount: number;
    lastDataRow: number;
    firstEmptyRow: number;
    sampleValues: string[];
  }>;
  activeCell: {
    reference: string;
    value: string | null;
    isEmpty: boolean;
  };
}

interface DOMAgentRequest {
  mode: 'dom' | 'recover';  // 'dom' for planning, 'recover' for recovery decisions
  domMap?: string;  // Text representation of the DOM
  pageContext?: PageContext;
  goal: string;
  analyzedIntent?: {
    primaryGoal: string;
    subGoals: string[];
    expectedOutcome: string;
    visualConfirmation?: string;
    confidence: number;
    failurePatterns?: Array<{
      description: string;
      visualIndicator?: string;
      recovery?: string;
    }>;
    stepTranslations?: Array<{
      stepIndex: number;
      intent: string;
      precondition: string;
      expectedOutcome: string;
      dependencies: number[];
    }>;
  };
  hints?: AgentHint[];
  currentHintIndex?: number;
  history?: HistoryEntry[];
  screenshot?: string;  // Optional, only if VisionClicker fallback enabled
  
  // Reference screenshot from recording - shows what user clicked on
  referenceScreenshot?: string;  // Base64 data URL of recorded element/viewport
  
  // FLEXIBILITY: Variable values that user can override
  // Example: {"Budget Amount": "2000"} overrides recorded value of "1000"
  variableValues?: Record<string, string>;
  
  // Ranked candidates for LLM selection (max 8)
  currentCandidates?: RankedCandidate[];
  
  // Available widgets on the page (for LLM to choose from when scope is ambiguous)
  availableWidgets?: string[];
  
  // Inherited scope hint (if recorded scope was wrong, use this instead)
  inheritedScopeHint?: string;
  
  // NEW: Spreadsheet context (only present on sheet domains)
  spreadsheetContext?: {
    isSpreadsheet: true;
    sheetState: SheetState;
    recordedIntent: {
      cellRef: string;           // 'B5'
      columnHeader?: string;     // 'Monthly Sales'
      wasEmpty: boolean;
      wasAppendPosition: boolean;
      reasoning: string;
    };
  };
  
  // For recovery mode
  rejectionCode?: 'NOT_FOUND' | 'AMBIGUOUS' | 'NOT_INTERACTABLE' | 'SCOPE_FAILED' | 'UNSAFE_ACTION' | 'OUTCOME_FAILED';
  rejectionDetails?: {
    matchCount?: number;
    candidates?: Array<{ role: string; name: string; text?: string }>;
    triedStrategies?: string[];
    interactabilityIssue?: string;
    scopeStatus?: string;
  };
  failedAction?: {
    type: string;
    target?: SemanticTarget;
    description?: string;
  };
  attemptNumber?: number;
}

interface SemanticTarget {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  placeholder?: string;
  scopeHint?: string;
  nearbyText?: string[];
  index?: number;
}

interface ExpectedOutcome {
  urlContains?: string;
  urlEquals?: string;
  textAppears?: string;
  textDisappears?: string;
  modalAppears?: boolean;
  modalCloses?: boolean;
  waitMs?: number;
}

interface DOMAgentResponse {
  // Note: 'navigate' is deprecated - all navigation should use 'click' on UI elements
  action?: 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'wait' | 'assert' | 'done' | 'fail' | 'skip' | 'read' | 'keyboard' | 'hover' | 'open_tab' | 'click_cell' | 'find_and_click_empty' | 'find_by_header';
  target?: SemanticTarget;
  description?: string;
  text?: string;
  value?: string;
  option?: string;
  fieldTarget?: SemanticTarget;
  expectedOutcome?: ExpectedOutcome;
  direction?: string;
  amount?: number;
  url?: string;
  duration?: number;
  reason?: string;
  reasoning: string;
  confidence: number;
  hintStepIndex?: number;
  
  // For read action
  attribute?: 'value' | 'text' | 'checked' | 'selected' | 'count';
  storeAs?: string;
  
  // For keyboard action
  key?: string;
  modifiers?: Array<'ctrl' | 'shift' | 'alt' | 'meta'>;
  repeat?: number;
  
  // For hover action
  hoverDuration?: number;
  waitForMenu?: boolean;
  
  // For spreadsheet actions
  cellRef?: string;           // 'B5'
  column?: string;            // 'B'
  headerText?: string;        // 'Monthly Sales'
  rowOffset?: number;         // 1 (first row after header)
  
  // For recovery mode
  strategy?: 'RETRY_WITH_VISION' | 'RETRY_LOOSER' | 'SCROLL_AND_RETRY' | 'DISMISS_POPUP' | 'GIVE_UP' | 'CLICK_BY_COORDINATES';
  refinedTarget?: SemanticTarget;
  
  // Visual fallback coordinates (optional, used when DOM resolution may fail)
  coordinates?: {
    x: number;
    y: number;
  };
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    console.log('dom_agent', VERSION, 'received request');
    const payload: DOMAgentRequest = await req.json();
    
    const mode = payload.mode || 'dom';
    console.log('Mode:', mode);
    console.log('Goal:', payload.goal);
    
    // Log analyzed intent if present
    if (payload.analyzedIntent) {
      console.log('✅ Analyzed Intent received:');
      console.log('  Primary Goal:', payload.analyzedIntent.primaryGoal);
      console.log('  Expected Outcome:', payload.analyzedIntent.expectedOutcome);
      console.log('  Confidence:', payload.analyzedIntent.confidence);
      console.log('  Sub-Goals:', payload.analyzedIntent.subGoals?.length);
      console.log('  Failure Patterns:', payload.analyzedIntent.failurePatterns?.length);
    } else {
      console.log('⚠️ No analyzedIntent in request');
    }
    
    if (mode === 'recover') {
      console.log('Rejection code:', payload.rejectionCode);
      console.log('Attempt number:', payload.attemptNumber);
    } else {
      console.log('Current hint index:', payload.currentHintIndex);
      console.log('DOM map length:', payload.domMap?.length);
      console.log('Has modal:', payload.pageContext?.hasModal);
      console.log('Candidates received:', payload.currentCandidates?.length || 0);
      if (payload.currentCandidates && payload.currentCandidates.length > 0) {
        console.log('Top 3 candidates:', payload.currentCandidates.slice(0, 3).map(c => 
          `[${c.role}] "${c.name}" id="${c.id || 'none'}"`
        ));
      }
    }

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build prompt based on mode
    const prompt = mode === 'recover' 
      ? buildRecoveryPrompt(payload)
      : buildAgentPrompt(payload);
    
    // Build Gemini request parts
    const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
      { text: prompt }
    ];
    
    // Add reference screenshot if available (visual context from recording)
    if (payload.referenceScreenshot) {
      const base64Data = extractBase64Data(payload.referenceScreenshot);
      if (base64Data) {
        const mimeType = detectMimeType(payload.referenceScreenshot);
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        });
        console.log('📷 Including reference screenshot in request (', mimeType, ', ', base64Data.length, 'chars)');
      }
    }
    
    // Add CURRENT page screenshot if available (live visual context)
    if (payload.screenshot) {
      const base64Data = extractBase64Data(payload.screenshot);
      if (base64Data) {
        const mimeType = detectMimeType(payload.screenshot);
        parts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        });
        console.log('👁️ Including CURRENT screenshot in request (', mimeType, ', ', base64Data.length, 'chars)');
      }
    }
    
    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: parts
      }],
      generationConfig: {
        temperature: mode === 'recover' ? 0.3 : 0.1, // Slightly higher temp for recovery creativity
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    };

    // Call Gemini API
    console.log('Calling Gemini API...');
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    console.log('Gemini response received');

    // Parse response
    const response = parseGeminiResponse(geminiResult, payload);
    console.log('Action:', response.action, 'Target:', response.target?.name || response.target?.text);

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('dom_agent error:', error);
    return new Response(JSON.stringify({
      action: 'fail',
      reason: error instanceof Error ? error.message : 'Unknown error',
      reasoning: 'Error processing request',
      confidence: 0,
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});

// ============================================================================
// Prompt Builder
// ============================================================================

function buildAgentPrompt(payload: DOMAgentRequest): string {
  const { goal, hints = [], currentHintIndex = 0, history = [], domMap = '', pageContext, variableValues, currentCandidates = [], referenceScreenshot, availableWidgets = [], inheritedScopeHint } = payload;
  
  // Find the current hint to focus on
  const currentHint = hints.find((h, i) => i >= currentHintIndex && !h.completed);
  
  // CRITICAL: Check if dropdown is open - this overrides everything
  const dropdownIsOpen = pageContext?.hasOpenDropdown || domMap.includes('DROPDOWN IS OPEN');
  const dropdownOptions = pageContext?.dropdownOptions || [];
  
  // Build priority section based on page state
  let prioritySection = '';
  if (dropdownIsOpen && dropdownOptions.length > 0) {
    prioritySection = `
🚨🚨🚨 CRITICAL: A DROPDOWN IS CURRENTLY OPEN 🚨🚨🚨
You MUST click one of these options IMMEDIATELY:
${dropdownOptions.map(opt => `  • "${opt}"`).join('\n')}

DO NOT:
- Type into any field (this closes the dropdown!)
- Follow the hints linearly
- Do anything except click an option

REQUIRED ACTION:
{"action": "click", "target": {"role": "option", "text": "<one of the options above>"}}

After clicking the option, new form fields will appear and you can continue.
`;
  } else if (pageContext?.hasModal) {
    prioritySection = `
⚠️ MODAL IS OPEN: "${pageContext.modalTitle || 'Dialog'}"
You MUST interact with the modal first before any other action.
`;
  }
  
  // Build variable override section
  let variableSection = '';
  if (variableValues && Object.keys(variableValues).length > 0) {
    variableSection = `
## 🎯 Variable Overrides (USE THESE VALUES)
The user has customized these values:
${Object.entries(variableValues).map(([key, value]) => `  • ${key}: "${value}"`).join('\n')}

IMPORTANT: When a hint says to enter a value, check if there's a variable override:
- Hint says: "Enter 1000 in Budget Amount"
- Variable override: "Budget Amount": "2000"
- YOU MUST USE: 2000 (not 1000!)

The hints show RECORDED values, but variable overrides are what the user WANTS NOW.
`;
  }
  
  // SAFEGUARD: Only inject spreadsheet prompts if spreadsheetContext exists
  let spreadsheetSection = '';
  if (payload.spreadsheetContext?.isSpreadsheet) {
    const ctx = payload.spreadsheetContext;
    spreadsheetSection = `
## 📊 SPREADSHEET MODE - MANDATORY CELLREF REQUIRED

You are working in a spreadsheet (Google Sheets / Excel).

### Current State
Active cell: ${ctx.sheetState.activeCell?.reference || 'unknown'}
Sheet: "${ctx.sheetState.sheetName}"

### 🚨 CRITICAL: YOU MUST RETURN cellRef AND text FOR ALL SPREADSHEET TYPE ACTIONS

When the hint says "Enter X" or "Type Y" on a spreadsheet:
1. **Extract the cell reference** from the hint's recordedAriaLabel (like "A2", "B3", "C5")
2. **Use the EXACT value from "Value to enter" field** as the text parameter
3. **Return both cellRef AND text** in your response

### RESPONSE FORMAT FOR SPREADSHEETS

For typing text into a cell:
{"action": "type", "cellRef": "A2", "text": "the value to type"}

CRITICAL: The "text" field MUST be the EXACT value from the hint's "Value to enter" field.
DO NOT extract the value from the description - use the "Value to enter" field!

For clicking a cell:
{"action": "click", "cellRef": "B3"}

### How to Find the Cell Reference and Value

Look at the current hint's information:
- recordedAriaLabel might say "A2" or "Cell B3" → Extract the cell reference
- "Value to enter" shows the EXACT text to type → Use this as the text parameter
- Check fallback selectors for patterns like [aria-label="C5"]
- Use the active cell if no cell reference in hint

### Example Workflow

Hint: "Enter 'nathan' in field", recordedAriaLabel: "A2", Value to enter: "nathan"
→ Response: {"action": "type", "cellRef": "A2", "text": "nathan"}
NOTE: The "text" value comes from "Value to enter", not from the description!

Hint: "Enter value", recordedAriaLabel: "B3", Value to enter: "john@example.com"
→ Response: {"action": "type", "cellRef": "B3", "text": "john@example.com"}
NOTE: Use the EXACT value from "Value to enter" field!

Hint: "CLICK on element", recordedAriaLabel: "B3"
→ Response: {"action": "click", "cellRef": "B3"}

### NEVER SKIP!
- Always execute the typing action
- Don't assume cells are already filled
- The hardcoded engine will handle the actual typing
- ALWAYS use the value from "Value to enter" field, not from the description
`;
  }

  // Extract task summary from goal if it contains a dash separator (name - description format)
  let taskSummarySection = '';
  if (goal.includes(' - ')) {
    const [taskName, taskDescription] = goal.split(' - ', 2);
    taskSummarySection = `
## 🎯 TASK SUMMARY
**Workflow:** ${taskName}
**Purpose:** ${taskDescription}

This context helps you understand the OVERALL INTENT of the workflow, especially important for spreadsheets and adaptive tasks where you need to make intelligent decisions about where to place data or how to handle changes in the page state.
`;
  }

  // Add workflow intent section (AI-analyzed understanding)
  let intentSection = '';
  if (payload.analyzedIntent) {
    const intent = payload.analyzedIntent;
    intentSection = `
## 🧠 WORKFLOW INTENT (AI-Analyzed)
**Primary Goal:** ${intent.primaryGoal}
**Expected Outcome:** ${intent.expectedOutcome}
**Confidence:** ${(intent.confidence * 100).toFixed(0)}%

**Checkpoints:**
${intent.subGoals.map((sg, i) => `${i + 1}. ${sg}`).join('\n')}

${intent.failurePatterns?.length ? `**Watch For:**
${intent.failurePatterns.map(fp => `- ${fp.description}${fp.visualIndicator ? ` (look for: ${fp.visualIndicator})` : ''}`).join('\n')}

` : ''}Use this understanding to make smarter decisions:
- Skip steps if expectedOutcome is already achieved
- Recognize failure patterns early and attempt recovery
- Prioritize actions that advance toward the primaryGoal
`;
  }

  const prompt = `You are an AI agent that automates web tasks. You analyze the current page state and decide what action to take next.

IMPORTANT: You must output semantic targets (role, name, text) - NOT pixel coordinates. The executor will use DOM-based element resolution.
${taskSummarySection}
${intentSection}
${prioritySection}
${variableSection}
${spreadsheetSection}
${referenceScreenshot ? `
## 📷 VISUAL REFERENCE (RECORDED SCREENSHOT)
An image is attached showing what the user clicked during recording.
USE THIS VISUAL to help identify the correct element:
- Look at the screenshot to understand WHAT the user clicked
- Match the visual appearance with elements in the DOM map below
- If the DOM map has multiple similar elements, use the visual to pick the right one
- The screenshot shows the EXACT element or dropdown that needs to be interacted with
` : ''}
${payload.screenshot ? `
## 👁️ CURRENT PAGE SCREENSHOT (LIVE STATE)
A screenshot of the CURRENT page is attached showing what the page looks like RIGHT NOW.
Use this to:
- Identify elements that may be poorly labeled in the DOM
- Verify the page state matches what you expect
- See the visual layout when DOM-based finding may be difficult
- Understand context (modals, overlays, form sections)

FALLBACK OPTION - When DOM resolution is likely to fail:
- If you're VERY confident about an element's location in the screenshot
- AND the element lacks good DOM identifiers (no role/name/testId)
- You MAY include "coordinates": {"x": <number>, "y": <number>} in your response
- Coordinates are in pixels from top-left of viewport
- This will be used as a LAST RESORT fallback if DOM-based finding fails

However, ALWAYS prefer semantic targets (role, name, text) when possible!
` : ''}
## Current Goal
${goal}

## Page State
URL: ${pageContext?.url || 'unknown'}
Title: ${pageContext?.title || 'unknown'}
${dropdownIsOpen ? `🔽 DROPDOWN OPEN with ${dropdownOptions.length} options` : ''}
${pageContext?.hasModal && !dropdownIsOpen ? `MODAL OPEN: "${pageContext.modalTitle || 'Dialog'}"` : ''}

### Available Elements (DOM Map)
${domMap}

### Form Fields (CHECK VALUES BEFORE TYPING!)
${pageContext?.formFields && pageContext.formFields.length > 0 
  ? pageContext.formFields.map(f => `- ${f.name}: ${f.value || '(empty)'} [${f.type}]${f.value ? ' ← ALREADY FILLED' : ''}`).join('\n')
  : '(no form fields)'}
  
⚠️ IMPORTANT: Check the value column above!
- If a field shows "value: 1000", it's ALREADY filled - don't type into it again
- Only type into fields that are "(empty)" or need a different value

## Steps to Complete
${hints.map((h, i) => {
  let status = '⬜';
  if (h.completed) status = '✅';
  else if (h.skipped) status = '⏭️ SKIPPED';
  else if (i === currentHintIndex) status = '👉 CURRENT';
  
  // Include natural language context if available
  const nlContext = h.naturalLanguage 
    ? `\n     Intent: "${h.naturalLanguage.intent}"\n     Expected outcome: "${h.naturalLanguage.expectedOutcome}"`
    : '';
  
  return `${status} Step ${h.stepNumber}: ${h.description}${h.value ? ` (value: "${h.value}")` : ''}${h.failureCount ? ` [failed ${h.failureCount}x]` : ''}${nlContext}`;
}).join('\n')}

## Current Focus
${currentHint 
  ? `⭐ WORK ON THIS NEXT: Step ${currentHint.stepNumber}
     Description: ${currentHint.description}
     Action type: ${currentHint.actionType}
     ${currentHint.targetText ? `Target text: "${currentHint.targetText}"` : ''}
     ${currentHint.targetRole ? `Target role: ${currentHint.targetRole}` : ''}
     ${currentHint.targetPlaceholder ? `Placeholder: "${currentHint.targetPlaceholder}"` : ''}
     ${currentHint.value ? `Value to enter: "${currentHint.value}"` : ''}
     ${inheritedScopeHint 
       ? `📍 LOOK IN WIDGET/SECTION: "${inheritedScopeHint}" ⚠️ CRITICAL - Using inherited scope from previous step (recorded scope "${currentHint.recordedScopeHint}" doesn't match any widget)`
       : currentHint.recordedScopeHint 
         ? `📍 LOOK IN WIDGET/SECTION: "${currentHint.recordedScopeHint}" ⚠️ CRITICAL - Element is in this container!`
         : ''}
     ${currentHint.recordedAriaLabel ? `🏷️ aria-label: "${currentHint.recordedAriaLabel}"` : ''}
     ${currentHint.nearbyText?.length > 0 ? `🔍 Nearby text: [${currentHint.nearbyText.join(', ')}]` : ''}
     ${currentHint.failureCount ? `⚠️ This hint has failed ${currentHint.failureCount} times already!` : ''}
     
     ${currentHint.naturalLanguage ? `
     🧠 NATURAL LANGUAGE CONTEXT:
     - Intent: "${currentHint.naturalLanguage.intent}"
     - Precondition: "${currentHint.naturalLanguage.precondition}"
     - Expected Outcome: "${currentHint.naturalLanguage.expectedOutcome}"
     ${currentHint.naturalLanguage.dependencies?.length > 0 
       ? `- Depends on steps: [${currentHint.naturalLanguage.dependencies.join(', ')}]` 
       : ''}
     ` : ''}
     
     ${dropdownIsOpen ? '⚠️ BUT A DROPDOWN IS OPEN - select an option first!' : ''}
     
     BEFORE ACTING - CHECK IF OUTCOME ALREADY ACHIEVED:
     1. Check if the expected outcome "${currentHint.naturalLanguage?.expectedOutcome || 'action complete'}" is already true
     2. If modal is expected to be open and it IS open → SKIP this step
     3. If dropdown is expected to be open and it IS open → SKIP this step  
     4. For TYPE actions: Compare the CURRENT field value with the TARGET value
        - Hint says "Enter 1000", DOM shows value="1000" → SKIP (already correct)
        - Hint says "Enter 1000", DOM shows value="" or value="500" → MUST TYPE
        - Hint says "Enter 1000", field not found in DOM → SKIP
     5. If the element doesn't exist at all → SKIP this step
     
     ⚠️ IMPORTANT: If the expected outcome is ALREADY satisfied, skip to the NEXT step!
     ⚠️ FOR TYPE ACTIONS: Never assume a field is filled just because you see its name - CHECK THE ACTUAL VALUE!
     
     YOU MUST: Return "hintStepIndex": ${hints.indexOf(currentHint)} in your response`
  : 'All steps completed - check if goal is achieved'}

${availableWidgets.length > 0 ? `
## 📊 Available Widgets on Page

The following widgets are visible on the page. Use this to help choose the correct element:
${availableWidgets.map((w, i) => `  ${i + 1}. "${w}"`).join('\n')}

💡 TIP: If the hint mentions a widget name or you just clicked "More Options" in a widget, look for candidates in that same widget!
` : ''}

${currentCandidates.length > 0 ? `
## 🎯 Candidates (YOU MUST CHOOSE ONE)

We found ${currentCandidates.length} elements matching the current hint. YOU MUST choose from these candidates:

${currentCandidates.map((c: any) => 
  `${c.index}: [${c.role}] "${c.name || c.text || '(unlabeled)'}"\n   ${c.id ? `id="${c.id}" ` : ''}${c.testId ? `testid="${c.testId}" ` : ''}${c.placeholder ? `placeholder="${c.placeholder}" ` : ''}${c.rowKey ? `rowKey="${c.rowKey}" ` : ''}${c.scopePath && c.scopePath.length > 0 ? `scope=[${c.scopePath.join(' > ')}] ` : ''}${c.widgetTitle ? `widget="${c.widgetTitle}" ` : ''}(score: ${c.score})`
).join('\n\n')}

🚨 CRITICAL INSTRUCTION 🚨
You MUST respond with "chooseCandidateIndex" selecting one of the candidates above (0-${currentCandidates.length - 1}).
DO NOT invent a new target. DO NOT return a target with role/name/text.
ONLY return chooseCandidateIndex.

✅ SEMANTIC MATCHING - Choose the BEST candidate by:
   1. FIRST: Match widget scope (HIGHEST PRIORITY!)
      - If hint shows "📍 LOOK IN WIDGET/SECTION: XYZ", find candidate with matching widget title
      - If inheritedScopeHint is provided, use that instead of recordedScopeHint
      - If you just clicked "More Options" in a widget, the next action (like "Download Data") should be in the SAME widget
      - Example: hint has "OFFERS EXPIRING", choose candidate with widget="OFFERS EXPIRING..."
      - Example: previous step was in "BRAND SALES OVERVIEW", current step should also be in "BRAND SALES OVERVIEW"
   2. SECOND: Match ROLE (combobox, button, textbox, menuitem, etc.)
   3. THIRD: Match NAME/PLACEHOLDER (partial or fuzzy match is OK)
   4. If only ONE candidate matches both scope AND role → select it even if unlabeled

❌ ONLY return chooseCandidateIndex: -1 if:
   - The page is in an error state
   - No candidates match the needed role at all
   - You need to scroll or navigate to reveal the element first
` : ''}

## Recent History
${history.length > 0 
  ? history.slice(-3).map(h => `Step ${h.stepNumber}: ${h.action} → ${h.result}${h.error ? ` (${h.error})` : ''}`).join('\n')
  : '(no actions yet)'}

## Your Task
Analyze the page and decide the next action. Look at the DOM map to find the element you need to interact with.

🧠 SEMANTIC MATCHING (CRITICAL):
- Hints describe INTENT, not exact element text. Match by MEANING, not literal text.
- When looking for an element:
  1. Match by ROLE first (combobox, button, textbox, etc.)
  2. Use context: scope path, widget title, nearby headings, placeholder
  3. "(unlabeled)" elements are valid targets if they match the role and context
  4. If there's only ONE element of the needed role, it's likely the target
- Examples of semantic matching:
  - Hint: "Click dropdown" → any combobox/select in the relevant section
  - Hint: "Enter value in Amount field" → textbox/spinbutton with "amount" in name/placeholder
  - Hint: "Click Submit" → button with text containing "submit", "save", "continue", etc.

🎯 SCOPE/CONTAINER MATCHING (CRITICAL FOR DASHBOARDS):
- If the hint shows "📍 LOOK IN WIDGET/SECTION:", you MUST find the element in that specific container!
- Example: "📍 LOOK IN WIDGET/SECTION: OFFERS EXPIRING IN NEXT 28 DAYS"
  → Look for a widget/card/section with this title in the DOM map
  → ONLY select elements within that section
  → If multiple "More Options" buttons exist, choose the one in the CORRECT widget
- When returning target, ALWAYS include "scopeHint" with the recorded scope value
- This is essential for pages with repeated elements (dashboards, tables, lists)

PRIORITY ORDER (follow strictly):
1. 🔽 DROPDOWN OPEN? → MUST click an option before anything else
   - Check the DOM Map for "DROPDOWN IS OPEN" section
   - Return: {"action": "click", "target": {"role": "option", "text": "<option>"}}
   - NEVER type while dropdown is open (it closes the dropdown!)
   
2. 📋 MODAL OPEN? → MUST interact with modal elements
   - Look at "Modal Actions" section in DOM map
   
3. 📝 FORM FIELDS → Check which fields need values
   - Look at Form Fields section - some may already have values!
   - CRITICAL: Compare CURRENT value with TARGET value from hint
   - Example: Hint says "Enter 1000", field shows value="500" → MUST TYPE "1000"
   - Example: Hint says "Enter 1000", field shows value="1000" → SKIP (already correct)
   - NEVER skip a TYPE hint unless the field value EXACTLY matches what needs to be entered
   - Match field by NAME/PLACEHOLDER, not just hint order

4. ADAPTIVE: The hints are a GUIDE, not strict commands
   - Skip hints that reference elements that don't exist  
   - Skip TYPE hints ONLY if field value exactly matches the target value
   - Adapt to current page state, don't blindly follow hint order

⚠️ FAIL ACTION: Use ONLY as last resort when:
   - The page shows an error or is completely empty
   - No interactive elements exist at all
   - Multiple recovery attempts have failed
   DO NOT fail just because element text doesn't exactly match the hint!

📜 AVAILABLE ACTIONS:
- **click**: Click a button/link/option
- **type**: Type text into an input field
  - ⚠️ CRITICAL: For TYPE actions, you MUST use the value from "Value to enter" field in the current hint
  - DO NOT extract the value from the description - use the "Value to enter" field exactly as shown
  - Example: If hint shows "Value to enter: john@example.com", your response must have "text": "john@example.com"
  - Example response: {"action": "type", "target": {...}, "text": "value from Value to enter field", ...}
- **select**: Select an option from a dropdown
- **scroll**: Scroll to reveal hidden elements (use when needed element isn't visible)
  - Use with "direction": "down" or "up" and "amount": pixels (e.g., 300)
  - Example: {"action": "scroll", "direction": "down", "amount": 300}
- **open_tab**: Open a new browser tab and navigate to a URL
  - Use when you need to access a different website or page in a new tab
  - Example: {"action": "open_tab", "url": "https://example.com/page"}
  - The system will open the tab and switch to it automatically
  - After opening, subsequent actions will execute in the new tab
- **read**: Query element values (check if field already filled, read text, etc.)
  - Use to verify state before acting
  - Example: {"action": "read", "target": {...}, "attribute": "value", "storeAs": "accountName"}
  - Attributes: "value", "text", "checked", "selected", "count"
- **keyboard**: Press keyboard keys (Tab, Enter, Escape, shortcuts)
  - Use for navigation or form submission via keyboard
  - Example: {"action": "keyboard", "key": "Tab", "repeat": 2}
  - Example: {"action": "keyboard", "key": "Enter"}
  - Example: {"action": "keyboard", "key": "s", "modifiers": ["ctrl"]}
- **hover**: Hover over element to reveal menus
  - Use for hover-activated dropdowns and menus
  - Example: {"action": "hover", "target": {...}, "hoverDuration": 500}
- **wait**: Wait for page to stabilize (rarely needed, executor auto-waits)
- **skip**: Skip current hint (element doesn't exist or already complete)
- **done**: All steps complete
- **fail**: Cannot proceed (LAST RESORT)

📊 SPREADSHEET ACTIONS (Google Sheets / Excel Online only):
These actions are automatically enabled when on sheets.google.com or excel.office.com domains.

- **type_in_cell**: Type text directly into a specific cell (atomic: navigate + type)
  - Example: {"action": "type_in_cell", "cellRef": "B5", "text": "Hello World"}
  - Example: {"action": "type_in_cell", "cellRef": "A1", "text": "Name", "clearFirst": true}
  - Use when user says: "Type X in cell Y", "Enter value in A5", "Put 'text' in cell B2"
  
- **type_in_header_column**: Type in a cell by finding column header
  - Example: {"action": "type_in_header_column", "headerText": "Email", "rowOffset": 1, "text": "john@test.com"}
  - Example: {"action": "type_in_header_column", "headerText": "Price", "rowOffset": 2, "text": "29.99"}
  - Use when user says: "In the Email column, row 2, type...", "Enter value in Name column"
  - rowOffset: 1 = first data row (row 2 if headers in row 1), 2 = second data row, etc.
  
- **type_in_next_empty**: Type in the next empty cell of a column
  - Example: {"action": "type_in_next_empty", "column": "A", "text": "New entry"}
  - Use when user says: "Add to next empty row", "Append to column A", "Add new item"
  
- **read_cell**: Read the value from a specific cell
  - Example: {"action": "read_cell", "cellRef": "C5"}
  - Use when user says: "Read cell B5", "What's in cell A1?", "Get value from C10"
  
- **batch_type**: Fill multiple cells at once (efficient for bulk data entry)
  - Example: {"action": "batch_type", "cells": [{"cellRef": "A2", "text": "John"}, {"cellRef": "B2", "text": "john@test.com"}]}
  - Use when user provides multiple cell values in one request
  
NOTE: For spreadsheets, prefer these specialized actions over generic click+type sequences.
They handle navigation, verification, and retries automatically.

Respond with a JSON object:
${currentCandidates.length > 0 ? `
⛔⛔⛔ CRITICAL: ${currentCandidates.length} CANDIDATES EXIST - YOU MUST USE chooseCandidateIndex ⛔⛔⛔

YOUR RESPONSE MUST LOOK EXACTLY LIKE THIS:
{
  "chooseCandidateIndex": 2,
  "action": "click",
  "reasoning": "Candidate 2 is in the correct widget",
  "confidence": 1.0,
  "hintStepIndex": ${currentHintIndex}
}

⚠️⚠️⚠️ FORBIDDEN - DO NOT DO THIS: ⚠️⚠️⚠️
{
  "target": {"role": "button", "name": "..."} ← WRONG! NEVER USE "target" WHEN CANDIDATES EXIST!
}

REQUIRED FIELDS:
- "chooseCandidateIndex": INTEGER from 0 to ${currentCandidates.length - 1} (REQUIRED!)
- "action": "click" | "type" | "select" | etc.
- "text": "EXACT value from 'Value to enter' field" (REQUIRED if action is type - use the exact value shown in the hint!)
- "reasoning": "why you chose this candidate"
- "confidence": 0.0-1.0
- "hintStepIndex": ${currentHintIndex}

THE "target" FIELD IS FORBIDDEN WHEN CANDIDATES EXIST. DO NOT INCLUDE IT.
` : `
WHEN NO CANDIDATES (free-form target):
{
  "action": "click" | "type" | "select" | "scroll" | "read" | "keyboard" | "hover" | "open_tab" | "wait" | "done" | "fail" | "skip",
  "target": {
    "testId": "test-id if shown in DOM map (MOST RELIABLE)",
    "role": "button" | "link" | "textbox" | "combobox" | "option" | etc.,
    "name": "accessible name or label",
    "text": "visible text content",
    "id": "id attribute if shown",
    "scopeHint": "USE THE recordedScopeHint FROM CURRENT HINT IF PROVIDED - this is critical for disambiguation!"
  },
  "text": "EXACT value from 'Value to enter' field (REQUIRED for type action - use the exact value shown in the current hint!)",
  "option": "option text (for select action)",
  "url": "https://example.com (for open_tab action)",
  "direction": "down" | "up" (for scroll action),
  "amount": 300 (for scroll action, pixels),
  "attribute": "value" | "text" | "checked" | "selected" | "count" (for read action),
  "storeAs": "variableName" (for read action, optional),
  "key": "Tab" | "Enter" | "Escape" | etc. (for keyboard action),
  "modifiers": ["ctrl", "shift", "alt", "meta"] (for keyboard action, optional),
  "repeat": 1 (for keyboard action, optional),
  "hoverDuration": 500 (for hover action, optional),
  "waitForMenu": true (for hover action, optional),
  "expectedOutcome": {
    "urlContains": "expected URL fragment",
    "textAppears": "expected text after action"
  },
  "reason": "why skipping (for skip action)",
  "reasoning": "why you chose this action",
  "confidence": 0.0-1.0,
  "hintStepIndex": ${currentHintIndex}
}

⛔ FORBIDDEN ACTIONS (WILL BE REJECTED):
- "navigate" - This action is DISABLED and will be AUTOMATICALLY REJECTED
- NEVER put URLs in target.text
- NEVER attempt to navigate directly to a URL
- If you need to go somewhere, find the button/link and CLICK it

⚠️ NEVER USE "navigate" ACTION:
- Do NOT navigate to URLs directly - URLs can be stale or wrong (e.g., different account IDs)
- Instead, CLICK the link/button/menu item that leads to the destination
- All navigation should be done through UI element clicks
- Find the element by text/role and click it
- The "navigate" action will be CONVERTED TO "click" or "fail"
`}

WHEN TO USE "skip":
- Current hint references an element that doesn't exist in the DOM map
- Current hint wants to fill a field that's already filled with the correct value
- Current hint is for a dropdown option that's not available
- After multiple failures on the same hint

WHEN TO USE "scroll":
- The hint mentions "scroll" explicitly
- A needed element (like Continue button) isn't in the DOM map but hint says it exists
- You're in a modal/dialog and need to reveal more content

IMPORTANT: If the DOM map shows testid="..." for an element, USE IT in your target - it's the most reliable identifier!

Respond with ONLY the JSON object, no other text.`;

  return prompt;
}

/**
 * Build recovery prompt for Tier 2 decision making
 */
function buildRecoveryPrompt(payload: DOMAgentRequest): string {
  const { rejectionCode, rejectionDetails, failedAction, pageContext, goal, attemptNumber } = payload;
  
  const prompt = `You are an AI agent recovery planner. An action failed and you must decide the best recovery strategy.

## Goal
${goal}

## Failed Action
Type: ${failedAction?.type}
Target: ${JSON.stringify(failedAction?.target, null, 2)}
Description: ${failedAction?.description || '(none)'}

## Rejection Code
${rejectionCode}

## Rejection Details
${rejectionDetails?.matchCount !== undefined ? `Match count: ${rejectionDetails.matchCount}` : ''}
${rejectionDetails?.candidates ? `Candidates: ${rejectionDetails.candidates.map(c => `[${c.role}] "${c.name}"`).join(', ')}` : ''}
${rejectionDetails?.triedStrategies ? `Tried strategies: ${rejectionDetails.triedStrategies.join(', ')}` : ''}
${rejectionDetails?.interactabilityIssue ? `Interactability issue: ${rejectionDetails.interactabilityIssue}` : ''}
${rejectionDetails?.scopeStatus ? `Scope status: ${rejectionDetails.scopeStatus}` : ''}

## Current Page Context
URL: ${pageContext?.url}
Title: ${pageContext?.title}
Has modal: ${pageContext?.hasModal}
${pageContext?.domMap ? `\nDOM Map (truncated):\n${pageContext.domMap}` : ''}

## Attempt Number
${attemptNumber || 1} of 3

## Available Recovery Strategies

1. **RETRY_WITH_VISION**: Request vision hint to refine target (use when NOT_FOUND and screenshot available)
2. **RETRY_LOOSER**: Loosen match criteria, add nearby text, broaden scope (use when AMBIGUOUS or NOT_FOUND)
3. **SCROLL_AND_RETRY**: Scroll page and retry (use when element might be off-screen)
4. **DISMISS_POPUP**: Dismiss popups/modals that might be blocking (use when modal is present)
${payload.screenshot ? `5. **CLICK_BY_COORDINATES**: Click at exact pixel coordinates from screenshot (LAST RESORT - use when DOM has no good identifiers and screenshot is available)` : ''}
${payload.screenshot ? '6' : '5'}. **GIVE_UP**: Cannot proceed (use on 3rd attempt or when fundamentally impossible)

## Decision Rules

- NOT_FOUND on attempt 1: Try SCROLL_AND_RETRY or RETRY_LOOSER
- NOT_FOUND on attempt 2: Try RETRY_WITH_VISION (if screenshot available)${payload.screenshot ? ' or CLICK_BY_COORDINATES if element has no good DOM identifiers' : ''}
- NOT_FOUND on attempt 3: ${payload.screenshot ? 'Try CLICK_BY_COORDINATES as last resort, or ' : ''}GIVE_UP
- AMBIGUOUS: Always try RETRY_LOOSER with disambiguation hints
- NOT_INTERACTABLE: Try DISMISS_POPUP or SCROLL_AND_RETRY
- UNSAFE_ACTION: GIVE_UP immediately (safety)
- SCOPE_FAILED: Try RETRY_LOOSER with broader scope${payload.screenshot ? ', or CLICK_BY_COORDINATES if you can see the element in screenshot' : ''}

Respond with JSON:

FOR SCROLL_AND_RETRY strategy:
{
  "strategy": "SCROLL_AND_RETRY",
  "directive": {
    "containerHint": "Accounts table" or "Main content",
    "untilTextVisible": "Pizza Depot" (text to search for),
    "maxScrolls": 12,
    "scrollDirection": "down" | "up",
    "pixelsPerScroll": 300
  },
  "reasoning": "why this strategy will help"
}

FOR DISMISS_POPUP strategy:
{
  "strategy": "DISMISS_POPUP",
  "directive": {
    "popupHint": "Cookie banner" or "Notification",
    "dismissMethod": "escape" | "click_outside" | "close_button"
  },
  "reasoning": "why this strategy will help"
}
${payload.screenshot ? `
FOR CLICK_BY_COORDINATES strategy (LAST RESORT):
{
  "strategy": "CLICK_BY_COORDINATES",
  "coordinates": {
    "x": 450,
    "y": 320
  },
  "reasoning": "Element visible in screenshot at these coordinates but has no good DOM identifiers"
}

IMPORTANT: Only use CLICK_BY_COORDINATES when:
- You can clearly see the element in the screenshot
- The element has no role, name, testId, or other good DOM identifiers
- Other strategies have already failed
- Coordinates are in pixels from top-left of viewport
` : ''}
FOR RETRY_LOOSER or RETRY_WITH_VISION:
{
  "strategy": "RETRY_LOOSER" | "RETRY_WITH_VISION",
  "refinedTarget": {
    "role": "button",
    "name": "Export",
    "nearbyText": ["Q4", "Report"],
    "scopeHint": "(broader scope if needed)"
  },
  "reasoning": "why this strategy will help"
}

FOR GIVE_UP:
{
  "strategy": "GIVE_UP",
  "reasoning": "why recovery is not possible"
}

Respond with ONLY the JSON object, no other text.`;

  return prompt;
}

// ============================================================================
// Response Parser
// ============================================================================

function parseGeminiResponse(geminiResult: any, payload: DOMAgentRequest): DOMAgentResponse {
  try {
    // Extract text from Gemini response
    const text = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Raw Gemini text:', text.substring(0, 500));
    
    // Parse JSON from response
    let parsed: any;
    
    // Try direct JSON parse first
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = text.match(/```json?\s*([\s\S]*?)\s*```/) || 
                       text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        parsed = JSON.parse(jsonStr);
      } else {
        throw new Error('Could not extract JSON from response');
      }
    }
    
    // Check if this is a recovery response
    if (payload.mode === 'recover' && parsed.strategy) {
      const recoveryResponse: DOMAgentResponse = {
        strategy: parsed.strategy,
        refinedTarget: parsed.refinedTarget,
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };
      
      // Add coordinates if provided for CLICK_BY_COORDINATES strategy
      if (parsed.coordinates && typeof parsed.coordinates.x === 'number' && typeof parsed.coordinates.y === 'number') {
        recoveryResponse.coordinates = {
          x: parsed.coordinates.x,
          y: parsed.coordinates.y,
        };
        console.log('[parseGeminiResponse] Recovery coordinates provided:', recoveryResponse.coordinates);
      }
      
      return recoveryResponse;
    }
    
    // CRITICAL: Enforce candidate selection when candidates were provided
    const currentCandidates = payload.currentCandidates || [];
    console.log('[parseGeminiResponse] Candidates in payload:', currentCandidates.length);
    console.log('[parseGeminiResponse] Parsed response has chooseCandidateIndex:', typeof parsed.chooseCandidateIndex);
    
    if (currentCandidates.length > 0) {
      // Candidates were provided, LLM MUST return chooseCandidateIndex
      if (typeof parsed.chooseCandidateIndex !== 'number') {
        console.error('LLM did not return chooseCandidateIndex when candidates were provided');
        console.error('Parsed response:', JSON.stringify(parsed, null, 2));
        throw new Error('LLM must return chooseCandidateIndex when candidates are provided');
      }
      
      // Validate index is in range
      if (parsed.chooseCandidateIndex < -1 || parsed.chooseCandidateIndex >= currentCandidates.length) {
        console.error(`Invalid chooseCandidateIndex: ${parsed.chooseCandidateIndex}, valid range: -1 to ${currentCandidates.length - 1}`);
        throw new Error(`Invalid chooseCandidateIndex: ${parsed.chooseCandidateIndex}`);
      }
      
      // If LLM chose -1, it means no candidate matches
      if (parsed.chooseCandidateIndex === -1) {
        console.log('LLM rejected all candidates (chooseCandidateIndex: -1)');
        // Return fail action with reason
        return {
          action: 'fail',
          reason: parsed.reasoning || 'No suitable candidate found',
          reasoning: parsed.reasoning || 'No suitable candidate found',
          confidence: 0,
          hintStepIndex: parsed.hintStepIndex ?? payload.currentHintIndex,
        };
      }
      
      // Map chosen candidate to target
      const chosen = currentCandidates[parsed.chooseCandidateIndex];
      console.log(`LLM chose candidate ${parsed.chooseCandidateIndex}: [${chosen.role}] "${chosen.name}"`);
      
      // Override target with the chosen candidate (include ALL identifiers)
      parsed.target = {
        role: chosen.role,
        name: chosen.name,
        text: chosen.text,
        testId: chosen.testId,
        id: chosen.id,  // Include ID attribute!
        placeholder: chosen.placeholder,
        scopePath: chosen.scopePath,
        rowKey: chosen.rowKey,
        widgetTitle: chosen.widgetTitle,
        frameId: chosen.frameId,
        _candidateIndex: parsed.chooseCandidateIndex,
      };
    }
    
    // Regular action response
    const validActions = ['click', 'type', 'select', 'scroll', 'navigate', 'wait', 'assert', 'done', 'fail', 'skip', 'read', 'keyboard', 'hover', 'open_tab', 'click_cell', 'find_and_click_empty', 'find_by_header'];
    const action = validActions.includes(parsed.action) ? parsed.action : 'fail';
    
    // Build response
    const response: DOMAgentResponse = {
      action,
      reasoning: parsed.reasoning || 'No reasoning provided',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      hintStepIndex: parsed.hintStepIndex ?? payload.currentHintIndex,
    };
    
    // BLOCK NAVIGATE ACTIONS - they are deprecated and should never be used
    if (action === 'navigate') {
      console.log('[dom_agent] ⛔ Rejecting navigate action - converting to click or fail');
      
      // If we have a target with text (not a URL), convert to click
      if (parsed.target?.text && !parsed.target.text.startsWith('http')) {
        response.action = 'click';
        response.target = parsed.target;
        response.reasoning = `Converted navigate to click: ${response.reasoning}`;
        console.log('[dom_agent] ✅ Converted navigate → click for target:', parsed.target.text);
      } else {
        // No valid target - fail this action
        response.action = 'fail';
        response.reason = 'Navigate actions are not supported. Find and click the UI element instead.';
        response.reasoning = 'Navigate actions are deprecated. Use click actions on UI elements.';
        response.confidence = 0;
        console.log('[dom_agent] ❌ Failed navigate action - no valid click target');
      }
    }
    
    // Add target for click/select actions
    if (parsed.target) {
      response.target = {
        role: parsed.target.role,
        name: parsed.target.name,
        text: parsed.target.text,
        testId: parsed.target.testId,
        placeholder: parsed.target.placeholder,
        scopeHint: parsed.target.scopeHint,
        nearbyText: parsed.target.nearbyText,
        index: parsed.target.index,
      };
    }
    
    // Add description
    if (parsed.description) {
      response.description = parsed.description;
    }
    
    // Add text for type actions
    if (parsed.text) {
      response.text = parsed.text;
    }
    if (parsed.value) {
      response.value = parsed.value;
    }
    
    // Add fieldTarget for type actions
    // CRITICAL: If action is "type" and target was provided (not fieldTarget),
    // map target → fieldTarget so executeType can resolve the correct field
    if (parsed.fieldTarget) {
      response.fieldTarget = parsed.fieldTarget;
    } else if (action === 'type' && parsed.target) {
      // LLM returned "target" but type action needs "fieldTarget"
      response.fieldTarget = parsed.target;
      console.log('[parseGeminiResponse] Mapped target → fieldTarget for type action');
    }
    
    // Add option for select actions
    if (parsed.option) {
      response.option = parsed.option;
    }
    
    // Add expected outcome
    if (parsed.expectedOutcome) {
      response.expectedOutcome = parsed.expectedOutcome;
    }
    
    // Add scroll params
    if (parsed.direction) {
      response.direction = parsed.direction;
    }
    if (parsed.amount) {
      response.amount = parsed.amount;
    }
    
    // Add navigate params
    if (parsed.url) {
      response.url = parsed.url;
    } else if (action === 'navigate' && parsed.target?.text && parsed.target.text.startsWith('http')) {
      // LLM put URL in target.text instead of url field - extract it
      response.url = parsed.target.text;
      console.log('[parseGeminiResponse] Extracted URL from target.text for navigate action:', response.url);
    }
    
    // Add wait params
    if (parsed.duration) {
      response.duration = parsed.duration;
    }
    
    // Add fail reason
    if (parsed.reason) {
      response.reason = parsed.reason;
    }
    
    // Add coordinates for visual fallback (if provided and valid)
    if (parsed.coordinates && typeof parsed.coordinates.x === 'number' && typeof parsed.coordinates.y === 'number') {
      response.coordinates = {
        x: parsed.coordinates.x,
        y: parsed.coordinates.y,
      };
      console.log('[parseGeminiResponse] Coordinates provided for visual fallback:', response.coordinates);
    }
    
    // Add read action params
    if (parsed.attribute) {
      response.attribute = parsed.attribute;
    }
    if (parsed.storeAs) {
      response.storeAs = parsed.storeAs;
    }
    
    // Add keyboard action params
    if (parsed.key) {
      response.key = parsed.key;
    }
    if (parsed.modifiers) {
      response.modifiers = parsed.modifiers;
    }
    if (parsed.repeat) {
      response.repeat = parsed.repeat;
    }
    
    // Add hover action params
    if (parsed.hoverDuration !== undefined) {
      response.hoverDuration = parsed.hoverDuration;
    }
    if (parsed.waitForMenu !== undefined) {
      response.waitForMenu = parsed.waitForMenu;
    }
    
    // Add spreadsheet action params
    if (parsed.cellRef) {
      response.cellRef = parsed.cellRef;
    }
    if (parsed.column) {
      response.column = parsed.column;
    }
    if (parsed.headerText) {
      response.headerText = parsed.headerText;
    }
    if (parsed.rowOffset !== undefined) {
      response.rowOffset = parsed.rowOffset;
    }
    
    return response;
  } catch (error) {
    console.error('Error parsing Gemini response:', error);
    return {
      action: 'fail',
      reason: 'Failed to parse AI response',
      reasoning: error instanceof Error ? error.message : 'Unknown parse error',
      confidence: 0,
    };
  }
}

// ============================================================================
// Image Helpers
// ============================================================================

/**
 * Extract base64 data from data URL
 */
function extractBase64Data(dataUrl: string): string | null {
  if (!dataUrl) return null;
  
  // Handle data URLs: "data:image/jpeg;base64,..."
  const base64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (base64Match) {
    return base64Match[1];
  }
  
  // If already base64 (no prefix), return as-is
  if (!dataUrl.includes(':') && dataUrl.length > 100) {
    return dataUrl;
  }
  
  return null;
}

/**
 * Detect MIME type from data URL
 */
function detectMimeType(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'image/png';
  if (dataUrl.includes('image/jpeg')) return 'image/jpeg';
  if (dataUrl.includes('image/webp')) return 'image/webp';
  return 'image/jpeg'; // Default
}

