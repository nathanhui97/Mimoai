/**
 * Generate Workflow Memory Edge Function (Unified)
 *
 * This is the SINGLE AI endpoint for workflow analysis.
 * It produces both:
 * 1. WorkflowAnalysis (step guidance, patterns, adaptation strategies)
 * 2. WorkflowMemory (identity, triggers, inputs, blocks, etc.)
 *
 * This consolidates what were previously two separate AI calls.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSystemPromptForTask } from '../_shared/system-prompt.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
// Using Gemini 3.0 Flash for text-based reasoning
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkflowStep {
  type: string;
  description?: string;
  payload?: {
    url?: string;
    selector?: string;
    elementText?: string;
    elementRole?: string;
    label?: string;
    value?: string;
    pageModelContext?: any;
    context?: any;
    spreadsheetContext?: any;
    intent?: any;
    stepGoal?: any;
    scope?: any;
  };
}

interface WorkflowData {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  variables?: any[];
  existingAnalysis?: any;
  learnedSkill?: any;
}

interface CurrentMemory {
  identity: any;
  understanding: any;
  inputs: any;
  triggers: any;
  pattern: any;
  success: any;
  adaptability: any;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { workflow, currentMemory, includeAnalysis = true } = body as {
      workflow: WorkflowData;
      currentMemory?: CurrentMemory;
      includeAnalysis?: boolean;
    };

    console.log(`[GenerateMemory] Unified analysis for: ${workflow.name}, includeAnalysis: ${includeAnalysis}`);

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build the unified prompt
    const prompt = buildUnifiedPrompt(workflow, currentMemory, includeAnalysis);

    const geminiRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,  // Larger for combined output
        responseMimeType: 'application/json',
      },
    };

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequest),
    });

    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      console.error('[GenerateMemory] Gemini API error:', error);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiResult = await geminiResponse.json();
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse the unified response
    const result = parseUnifiedResponse(responseText, currentMemory, workflow.steps.length);

    const duration = Date.now() - startTime;
    console.log(`[GenerateMemory] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[GenerateMemory] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function buildUnifiedPrompt(workflow: WorkflowData, currentMemory: CurrentMemory | undefined, includeAnalysis: boolean): string {
  const systemContext = getSystemPromptForTask('generate_memory');

  // Build detailed step descriptions with context
  const stepsDescription = workflow.steps.map((s, i) => {
    const parts: string[] = [`${i + 1}. [${s.type}]`];

    if (s.description) parts.push(s.description);

    if (s.payload) {
      if (s.payload.label) parts.push(`Label: "${s.payload.label}"`);
      if (s.payload.elementText) parts.push(`Text: "${s.payload.elementText}"`);
      if (s.payload.elementRole) parts.push(`Role: ${s.payload.elementRole}`);
      if (s.payload.value) parts.push(`Value: "${s.payload.value}"`);
      if (s.payload.url) {
        try {
          const url = new URL(s.payload.url);
          parts.push(`URL: ${url.hostname}${url.pathname}`);
        } catch {
          parts.push(`URL: ${s.payload.url}`);
        }
      }
      // Include context hints
      if (s.payload.pageModelContext?.pageContext?.regionName) {
        parts.push(`Region: ${s.payload.pageModelContext.pageContext.regionName}`);
      }
      if (s.payload.context?.gridCoordinates?.columnHeader) {
        parts.push(`Column: ${s.payload.context.gridCoordinates.columnHeader}`);
      }
    }

    return parts.join(' | ');
  }).join('\n');

  const variablesDescription = (workflow.variables || []).map(v =>
    `- ${v.fieldName} (${v.variableName}): ${v.inputType || 'text'}${v.defaultValue ? `, default: "${v.defaultValue}"` : ''}`
  ).join('\n') || 'No variables detected';

  // Build the analysis section only if needed
  const analysisInstructions = includeAnalysis ? `

## Step-by-Step Analysis Instructions

For EACH step, provide execution guidance:
1. **Intent**: What is the user trying to accomplish? (semantic, not mechanical)
2. **Why This Element**: Why was THIS element chosen over alternatives?
3. **Element Finding**: How to find this element if selectors change
4. **Preconditions**: What must be true before this step?
5. **Expected Outcome**: What should happen after this step?
6. **Criticality**: Is this step critical, important, or optional?

Also identify:
- **Patterns**: Form fills, search-and-select, navigation sequences
- **Adaptation Strategies**: How to handle common changes (text changed, layout shifted)

` : '';

  const analysisOutputFormat = includeAnalysis ? `
  "analysis": {
    "workflowUnderstanding": {
      "summary": "One sentence describing what this workflow does",
      "primaryGoal": "The main thing the user is trying to accomplish",
      "subGoals": ["Milestone 1", "Milestone 2"],
      "domain": "Domain/context (e.g., CRM, Spreadsheet, E-commerce)",
      "entities": ["Key entities involved"],
      "repeatability": "one-time|repeatable|parameterized",
      "successIndicators": ["What indicates success"],
      "failureIndicators": ["What indicates failure"]
    },
    "stepGuidance": [
      {
        "stepIndex": 0,
        "intent": "What the user is trying to do with this step",
        "whyThisElement": "Why THIS element was chosen",
        "elementFindingStrategy": {
          "lookingFor": "Semantic description",
          "searchContext": "Where to look",
          "distinguishers": ["What makes it unique"],
          "relatedElements": [],
          "textPatterns": ["Text patterns"],
          "elementType": "button|input|link|etc"
        },
        "preconditions": ["What must be true"],
        "expectedOutcome": "What should happen",
        "dependencies": [],
        "criticality": "critical|important|optional",
        "alternatives": ["Alternative approaches"]
      }
    ],
    "patterns": [
      {
        "type": "form-fill|search-and-select|navigation-sequence|data-entry",
        "description": "What this pattern does",
        "stepIndices": [0, 1, 2],
        "executionHint": "How to handle"
      }
    ],
    "adaptationStrategies": [
      {
        "scenario": "What might change",
        "howToAdapt": "How to handle",
        "affectedSteps": [0]
      }
    ]
  },` : '';

  return `${systemContext}

You are an AI that analyzes automation workflows to produce:
1. Human-like "memory" of the workflow (triggers, blocks, inputs)
2. Detailed execution guidance for each step

## Current Workflow

**Name:** ${workflow.name}
**Description:** ${workflow.description || 'Not provided'}

**Steps:**
${stepsDescription}

**Variables (inputs):**
${variablesDescription}

**Existing Data:**
${workflow.learnedSkill ? `Learned Skill: ${JSON.stringify({
  whatItDoes: workflow.learnedSkill.whatItDoes,
  canonicalAction: workflow.learnedSkill.canonicalAction,
}, null, 2)}` : 'None'}

${currentMemory ? `**Current Memory (to enhance):**
${JSON.stringify(currentMemory, null, 2)}` : ''}
${analysisInstructions}
## Milestone (Phase) Detection Guidelines

Identify PHASES - high-level stages humans naturally think in when performing a task.

**CRITICAL: Phase names must be TASK-SPECIFIC, not generic!**

**BAD phase names (DO NOT USE):**
- "Interaction" - too vague
- "Data Entry" - describes step type, not purpose
- "Navigation" - generic
- "Click Button" - describes action, not goal
- "Enter Information" - meaningless

**GOOD phase names (USE THESE PATTERNS):**
- "Select Restaurant" - specific to the task
- "Configure BOGO Discount" - describes what's being accomplished
- "Set Promotion Dates" - task-specific detail
- "Review & Submit" - meaningful milestone

**Phase Rules:**
1. Names must describe WHAT is being accomplished, not HOW (not "click" or "type")
2. Names must be SPECIFIC to this workflow (not generic like "Data Entry")
3. Each phase should contain 1-5 related steps
4. Phases should match how a human would describe the task verbally
5. At least one phase must be marked "critical"

**Example - BOGO Promotion Setup (8 steps):**
- Phase 1: "Open Promotions Tool" (step 0) - critical
- Phase 2: "Select Restaurant" (step 1) - critical
- Phase 3: "Choose BOGO Type" (steps 2-3) - critical
- Phase 4: "Configure Discount" (steps 4-5) - critical
- Phase 5: "Submit Promotion" (steps 6-7) - critical

**Example - Add Contact (4 steps):**
- Phase 1: "Open Contact Form" (step 0) - critical
- Phase 2: "Enter Contact Details" (steps 1-2) - critical
- Phase 3: "Save Contact" (step 3) - critical

**Think:** If someone asked "what are you doing?", would your phase name be a good answer?
- "I'm doing Data Entry" ❌ - meaningless
- "I'm configuring the discount amount" ✅ - specific and clear

## Block Detection Guidelines

Identify BLOCKS - execution-level groupings for repeat/loop logic:

**Block Boundaries** (signals that a new block starts):
- URL changes between steps
- Modal/dialog opens or closes
- Form submission (save, submit, create buttons)
- Significant pause in workflow
- Navigation steps

**Block Types**:
- \`form_fill\`: Multiple INPUT steps filling a form (usually REPEATABLE)
- \`table_row\`: Adding/editing a table row (usually REPEATABLE)
- \`list_item\`: Adding item to a list (usually REPEATABLE)
- \`menu_navigation\`: Clicking through menus (NOT repeatable)
- \`one_time\`: Navigation, setup, opening forms (NOT repeatable)
- \`submission\`: Save/submit buttons (NOT repeatable)

**Repeatability**:
- Blocks with variable inputs are repeatable
- \`form_fill\`, \`table_row\`, \`list_item\` blocks are repeatable if they have variables
- \`one_time\`, \`submission\` are NOT repeatable

**Iteration Variable**: Which variable drives repetition?
- Example: "add Alice, Bob, Carol" → the "name" variable drives iteration

## Response Format

Return ONLY valid JSON:

{${analysisOutputFormat}
  "memory": {
    "identity": {
      "purpose": "Clear, concise purpose statement",
      "domain": "Application domain"
    },
    "understanding": {
      "elevator": "One-liner description",
      "phases": [
        {
          "name": "TASK-SPECIFIC name (e.g., 'Select Restaurant', 'Configure Discount', NOT 'Interaction' or 'Data Entry')",
          "purpose": "Specific description of what this accomplishes (NOT 'Interact with the page')",
          "stepIndices": [0, 1],
          "criticality": "critical|important|optional"
        }
      ],
      "blocks": [
        {
          "blockId": "block_0",
          "name": "TASK-SPECIFIC name (e.g., 'Enter Contact Info', NOT 'Data Entry' or 'Interaction')",
          "purpose": "Specific purpose (e.g., 'Fill in customer name and email', NOT 'Enter the required information')",
          "stepIndices": [0, 1],
          "criticality": "critical|important|optional",
          "blockType": "form_fill|table_row|list_item|menu_navigation|one_time|submission",
          "isRepeatable": true,
          "iterationVariable": "variableName",
          "iterationDelayMs": 500
        }
      ],
      "entities": ["entity1", "entity2"]
    },
    "inputs": {
      "required": [
        {
          "name": "Field Name",
          "description": "Clear description",
          "extractionHints": ["hint1", "hint2"],
          "exampleValues": ["example1"],
          "isArray": true,
          "arraySeparators": ["and", ","],
          "iteratesBlocks": [1]
        }
      ]
    },
    "triggers": {
      "phrases": ["natural phrase 1", "natural phrase 2"],
      "verbSynonyms": ["add", "create", "insert"],
      "objectSynonyms": ["contact", "person", "entry"]
    },
    "pattern": {
      "type": "repeatable|single_entry|navigation",
      "repetition": {
        "supportsMultiple": true,
        "separators": ["and", ","]
      }
    },
    "success": {
      "indicators": [
        {
          "type": "toast_appears|text_appears|url_changes|modal_closes|element_appears",
          "description": "What happens on success",
          "pattern": "text to match",
          "priority": "primary|secondary|fallback"
        }
      ],
      "failureIndicators": ["Error patterns"],
      "endState": "What the page looks like when done"
    }
  }
}

Think about:
1. What would a human naturally say to trigger this workflow?
2. Which steps logically group together?
3. Which parts should repeat for multi-item operations?
4. How to find elements when the UI changes?`;
}

function parseUnifiedResponse(responseText: string, currentMemory: CurrentMemory | undefined, stepCount: number): any {
  try {
    let jsonStr = responseText.trim();

    // Handle markdown code blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Build the result
    const result: any = {};

    // Extract and normalize analysis if present
    if (parsed.analysis) {
      result.analysis = {
        analyzedAt: Date.now(),
        analysisVersion: '2.0.0',  // New unified version
        confidence: calculateConfidence(parsed.analysis, stepCount),
        workflowUnderstanding: parsed.analysis.workflowUnderstanding || createDefaultUnderstanding(),
        stepGuidance: normalizeStepGuidance(parsed.analysis.stepGuidance, stepCount),
        patterns: parsed.analysis.patterns || [],
        adaptationStrategies: parsed.analysis.adaptationStrategies || [],
      };
    }

    // Extract and merge memory
    if (parsed.memory) {
      if (currentMemory) {
        result.memory = deepMerge(currentMemory, parsed.memory);
      } else {
        result.memory = parsed.memory;
      }
    } else if (currentMemory) {
      // If no memory in response but we had current memory, return it enhanced
      result.memory = currentMemory;
    }

    // Ensure phases exist in understanding (fallback to blocks if needed)
    if (result.memory?.understanding) {
      result.memory.understanding = ensurePhasesExist(result.memory.understanding, stepCount);
    }

    return result;
  } catch (error) {
    console.error('[GenerateMemory] Failed to parse response:', error);
    console.error('[GenerateMemory] Raw response:', responseText.substring(0, 1000));

    // Return safe defaults
    return {
      memory: currentMemory || {},
      analysis: createDefaultAnalysis(stepCount),
    };
  }
}

function calculateConfidence(analysis: any, stepCount: number): number {
  let score = 0;
  let checks = 0;

  checks++;
  if (analysis.workflowUnderstanding?.summary) score++;

  checks++;
  const guidance = analysis.stepGuidance;
  if (guidance && guidance.length >= stepCount * 0.8) score++;

  checks++;
  if (analysis.patterns && analysis.patterns.length > 0) score++;

  checks++;
  if (analysis.adaptationStrategies && analysis.adaptationStrategies.length > 0) score++;

  return checks > 0 ? score / checks : 0.5;
}

function createDefaultUnderstanding(): any {
  return {
    summary: 'Recorded browser automation workflow',
    primaryGoal: 'Complete the recorded task sequence',
    subGoals: [],
    domain: 'General',
    entities: [],
    repeatability: 'one-time',
    successIndicators: ['All steps complete without errors'],
    failureIndicators: ['Element not found', 'Unexpected page state'],
  };
}

function normalizeStepGuidance(guidance: any[] | undefined, stepCount: number): any[] {
  if (!guidance) return [];

  // Ensure we have guidance for all steps
  const result: any[] = [];
  for (let i = 0; i < stepCount; i++) {
    const existing = guidance.find(g => g.stepIndex === i);
    if (existing) {
      result.push({
        ...existing,
        elementFindingStrategy: existing.elementFindingStrategy || {
          lookingFor: 'element',
          searchContext: 'Page',
          distinguishers: [],
          relatedElements: [],
          textPatterns: [],
          elementType: 'element',
        },
      });
    } else {
      result.push({
        stepIndex: i,
        intent: 'Perform action',
        whyThisElement: 'Matched by selector',
        elementFindingStrategy: {
          lookingFor: 'element',
          searchContext: 'Page',
          distinguishers: [],
          relatedElements: [],
          textPatterns: [],
          elementType: 'element',
        },
        preconditions: ['Element is visible'],
        expectedOutcome: 'Action completes',
        dependencies: [],
        criticality: 'important',
        alternatives: [],
      });
    }
  }
  return result;
}

function createDefaultAnalysis(stepCount: number): any {
  return {
    analyzedAt: Date.now(),
    analysisVersion: '2.0.0',
    confidence: 0.3,
    workflowUnderstanding: createDefaultUnderstanding(),
    stepGuidance: normalizeStepGuidance(undefined, stepCount),
    patterns: [],
    adaptationStrategies: [],
  };
}

function deepMerge(target: any, source: any): any {
  if (!source) return target;

  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;

    if (Array.isArray(source[key])) {
      result[key] = source[key];
    } else if (typeof source[key] === 'object') {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Ensure phases exist in understanding.
 * If phases are missing but blocks exist, convert blocks to phases.
 * If both are missing, synthesize basic phases from step count.
 */
function ensurePhasesExist(understanding: any, stepCount: number): any {
  // If phases already exist and are valid, return as-is
  if (understanding.phases && Array.isArray(understanding.phases) && understanding.phases.length > 0) {
    // Normalize phases to ensure they have required fields
    understanding.phases = understanding.phases.map((phase: any, index: number) => ({
      name: phase.name || `Phase ${index + 1}`,
      purpose: phase.purpose || phase.name || 'Complete this phase',
      stepIndices: phase.stepIndices || [],
      criticality: phase.criticality || 'important',
    }));
    return understanding;
  }

  // If we have blocks, convert them to phases
  if (understanding.blocks && Array.isArray(understanding.blocks) && understanding.blocks.length > 0) {
    console.log('[GenerateMemory] Converting blocks to phases');
    understanding.phases = understanding.blocks.map((block: any, index: number) => ({
      name: block.name || `Phase ${index + 1}`,
      purpose: block.purpose || block.name || 'Complete this phase',
      stepIndices: block.stepIndices || [],
      criticality: block.criticality || 'important',
    }));
    return understanding;
  }

  // No phases or blocks - synthesize basic phases from step count
  console.log('[GenerateMemory] Synthesizing default phases for', stepCount, 'steps');

  if (stepCount <= 1) {
    understanding.phases = [{
      name: 'Complete Task',
      purpose: 'Execute the recorded action',
      stepIndices: [0],
      criticality: 'critical',
    }];
  } else if (stepCount <= 3) {
    // Small workflow: single phase
    understanding.phases = [{
      name: 'Execute Task',
      purpose: 'Complete all recorded steps',
      stepIndices: Array.from({ length: stepCount }, (_, i) => i),
      criticality: 'critical',
    }];
  } else {
    // Larger workflow: synthesize 3 phases (Setup, Main Work, Finish)
    const setupEnd = Math.max(0, Math.floor(stepCount * 0.2));
    const mainEnd = Math.max(setupEnd + 1, Math.floor(stepCount * 0.8));

    understanding.phases = [
      {
        name: 'Setup',
        purpose: 'Navigate and prepare for the task',
        stepIndices: Array.from({ length: setupEnd + 1 }, (_, i) => i),
        criticality: 'important',
      },
      {
        name: 'Main Task',
        purpose: 'Perform the core actions',
        stepIndices: Array.from({ length: mainEnd - setupEnd }, (_, i) => setupEnd + 1 + i),
        criticality: 'critical',
      },
      {
        name: 'Complete',
        purpose: 'Finalize and save the work',
        stepIndices: Array.from({ length: stepCount - mainEnd }, (_, i) => mainEnd + i),
        criticality: 'critical',
      },
    ].filter(p => p.stepIndices.length > 0);
  }

  return understanding;
}
