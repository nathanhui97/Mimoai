/**
 * Post-Recording AI Analyzer
 *
 * Analyzes recorded workflows immediately after recording stops to produce
 * rich execution guidance that helps the AI agent understand:
 * - WHAT the user was trying to accomplish (overall and per-step)
 * - WHY each element was chosen (not just the selector)
 * - HOW to find elements when things change
 * - WHAT success looks like
 *
 * This analysis transforms recorded steps from "replay this exactly" to
 * "understand and accomplish this goal".
 */

import type { WorkflowStep, WorkflowStepPayload, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

// ============================================================================
// Analysis Result Types
// ============================================================================

/**
 * Complete analysis result for a workflow
 */
export interface WorkflowAnalysis {
  // Metadata
  analyzedAt: number;
  analysisVersion: string;
  confidence: number;

  // Overall workflow understanding
  workflowUnderstanding: WorkflowUnderstanding;

  // Per-step execution guidance
  stepGuidance: StepExecutionGuidance[];

  // Detected patterns that affect execution
  patterns: DetectedPattern[];

  // Suggested adaptations for common scenarios
  adaptationStrategies: AdaptationStrategy[];
}

/**
 * Overall understanding of what the workflow accomplishes
 */
export interface WorkflowUnderstanding {
  // One-sentence summary of what this workflow does
  summary: string;

  // The primary goal the user is trying to achieve
  primaryGoal: string;

  // Sub-goals or milestones within the workflow
  subGoals: string[];

  // Domain/context (e.g., "CRM data entry", "E-commerce checkout", "Report generation")
  domain: string;

  // Key entities involved (e.g., "customer", "order", "product")
  entities: string[];

  // Is this a one-time task or repeatable?
  repeatability: 'one-time' | 'repeatable' | 'parameterized';

  // What indicates the workflow succeeded?
  successIndicators: string[];

  // What would indicate failure?
  failureIndicators: string[];
}

/**
 * Execution guidance for a single step
 */
export interface StepExecutionGuidance {
  stepIndex: number;

  // What the user is trying to do (semantic intent)
  intent: string;

  // WHY this specific element was chosen
  whyThisElement: string;

  // How to find this element if the selector fails
  elementFindingStrategy: ElementFindingStrategy;

  // What must be true before this step can execute
  preconditions: string[];

  // What should happen after this step succeeds
  expectedOutcome: string;

  // Steps this depends on
  dependencies: number[];

  // Is this step critical or can it be skipped?
  criticality: 'critical' | 'important' | 'optional';

  // Can this step be retried with variations?
  retryStrategy: RetryStrategy;

  // Alternative ways to accomplish the same thing
  alternatives: string[];
}

/**
 * Strategy for finding an element when primary selectors fail
 */
export interface ElementFindingStrategy {
  // Semantic description of what to look for
  lookingFor: string;

  // Where to look (region, container)
  searchContext: string;

  // Distinguishing characteristics
  distinguishers: string[];

  // Related elements that help locate this one
  relatedElements: Array<{
    description: string;
    relationship: 'near' | 'inside' | 'labeled-by' | 'after' | 'before';
  }>;

  // Text patterns that identify this element
  textPatterns: string[];

  // Role/type hints
  elementType: string;
}

/**
 * How to retry if initial attempt fails
 */
export interface RetryStrategy {
  // Can we try different approaches?
  canRetry: boolean;

  // What to try
  approaches: string[];

  // Maximum retries before escalating
  maxRetries: number;

  // Should we wait for something before retrying?
  waitBefore?: string;
}

/**
 * Detected pattern that affects execution
 */
export interface DetectedPattern {
  type: 'search-and-select' | 'form-fill' | 'navigation-sequence' | 'data-entry' | 'bulk-action' | 'verification';
  description: string;
  stepIndices: number[];
  executionHint: string;
}

/**
 * Strategy for adapting to common changes
 */
export interface AdaptationStrategy {
  scenario: string;
  howToAdapt: string;
  affectedSteps: number[];
}

// ============================================================================
// Analyzer Implementation
// ============================================================================

/**
 * Analyze a workflow to produce execution guidance
 *
 * Two modes:
 * - Fast mode (useAI=false): Build from PageModel context captured during recording (instant, no cost)
 * - Full mode (useAI=true): Also call AI for patterns and adaptation strategies (3-5 sec, costs money)
 */
export async function analyzeWorkflowWithAI(
  steps: WorkflowStep[],
  options: {
    workflowName?: string;
    onProgress?: (status: string) => void;
    useAI?: boolean; // Default: true - call AI for richer analysis
  } = {}
): Promise<WorkflowAnalysis> {
  const { onProgress, useAI = true } = options;

  onProgress?.('Building execution guidance from recorded context...');

  // STEP 1: Build step guidance from PageModel context (instant, no AI needed)
  const stepGuidance = steps.map((step, index) => buildStepGuidanceFromContext(step, index, steps));

  // STEP 2: Detect patterns locally (instant, no AI needed)
  const patterns = detectPatternsLocally(steps);

  // STEP 3: Build basic workflow understanding locally
  const workflowUnderstanding = buildWorkflowUnderstandingLocally(steps);

  // STEP 4: If AI is enabled, enhance with AI analysis
  if (useAI) {
    onProgress?.('Analyzing workflow with AI...');

    try {
      const prompt = buildAnalysisPrompt(steps, options.workflowName);
      const analysisResult = await callAIService(prompt);

      onProgress?.('Processing AI analysis...');

      // Parse AI result and merge with local analysis
      const aiAnalysis = parseAnalysisResult(analysisResult, steps);

      // Merge AI insights with local analysis
      return {
        analyzedAt: Date.now(),
        analysisVersion: '1.0.0',
        confidence: aiAnalysis.confidence,
        workflowUnderstanding: aiAnalysis.workflowUnderstanding.summary !== 'Recorded workflow'
          ? aiAnalysis.workflowUnderstanding
          : workflowUnderstanding,
        stepGuidance: mergeStepGuidance(stepGuidance, aiAnalysis.stepGuidance),
        patterns: aiAnalysis.patterns.length > 0 ? aiAnalysis.patterns : patterns,
        adaptationStrategies: aiAnalysis.adaptationStrategies,
      };
    } catch (error) {
      console.warn('[PostRecordingAnalyzer] AI analysis failed, using local analysis:', error);
      // Fall back to local-only analysis
    }
  }

  // Return local-only analysis
  onProgress?.('Analysis complete');
  return {
    analyzedAt: Date.now(),
    analysisVersion: '1.0.0',
    confidence: 0.6, // Lower confidence without AI
    workflowUnderstanding,
    stepGuidance,
    patterns,
    adaptationStrategies: buildBasicAdaptationStrategies(steps),
  };
}

/**
 * Build step guidance from PageModel context (no AI needed)
 */
function buildStepGuidanceFromContext(
  step: WorkflowStep,
  index: number,
  allSteps: WorkflowStep[]
): StepExecutionGuidance {
  const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;

  return {
    stepIndex: index,
    intent: buildDefaultIntent(step),
    whyThisElement: buildDefaultWhyThisElement(payload),
    elementFindingStrategy: buildDefaultFindingStrategy(payload),
    preconditions: buildDefaultPreconditions(step, index, allSteps),
    expectedOutcome: buildDefaultExpectedOutcome(step),
    dependencies: inferDependencies(index, allSteps),
    criticality: inferCriticality(step),
    retryStrategy: {
      canRetry: true,
      approaches: ['Wait and retry', 'Try fallback selectors', 'Use visual matching'],
      maxRetries: 3,
    },
    alternatives: [],
  };
}

/**
 * Detect patterns locally without AI
 */
function detectPatternsLocally(steps: WorkflowStep[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Detect form-fill pattern
  const inputSteps = steps.filter(s => s.type === 'INPUT');
  if (inputSteps.length >= 2) {
    const inputIndices = steps.map((s, i) => s.type === 'INPUT' ? i : -1).filter(i => i >= 0);
    patterns.push({
      type: 'form-fill',
      description: `Fill form with ${inputSteps.length} fields`,
      stepIndices: inputIndices,
      executionHint: 'Fill all required fields before submitting',
    });
  }

  // Detect search-and-select pattern (dropdown interaction)
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const nextStep = steps[i + 1];
    if (isWorkflowStepPayload(step.payload) && isWorkflowStepPayload(nextStep.payload)) {
      const isDropdownTrigger = step.payload.elementRole === 'combobox' ||
        step.payload.elementRole === 'listbox' ||
        step.payload.pageModelContext?.expectations?.primary?.type === 'dropdown_opens';
      const isSelection = nextStep.payload.elementRole === 'option' ||
        nextStep.payload.elementRole === 'menuitem';

      if (isDropdownTrigger && isSelection) {
        patterns.push({
          type: 'search-and-select',
          description: `Select from dropdown: "${nextStep.payload.elementText || 'option'}"`,
          stepIndices: [i, i + 1],
          executionHint: 'Wait for dropdown to open before selecting',
        });
      }
    }
  }

  // Detect navigation-sequence pattern
  const navSteps = steps.filter(s => s.type === 'NAVIGATION');
  if (navSteps.length >= 1) {
    const navIndices = steps.map((s, i) => s.type === 'NAVIGATION' ? i : -1).filter(i => i >= 0);
    patterns.push({
      type: 'navigation-sequence',
      description: 'Navigate to target page(s)',
      stepIndices: navIndices,
      executionHint: 'Wait for page load after navigation',
    });
  }

  return patterns;
}

/**
 * Build workflow understanding locally without AI
 */
function buildWorkflowUnderstandingLocally(steps: WorkflowStep[]): WorkflowUnderstanding {
  const inputCount = steps.filter(s => s.type === 'INPUT').length;
  const clickCount = steps.filter(s => s.type === 'CLICK').length;
  const navCount = steps.filter(s => s.type === 'NAVIGATION').length;

  // Infer domain and goal from step patterns
  let domain = 'General';
  let summary = 'Recorded workflow';
  let primaryGoal = 'Complete the recorded task';

  // Check for spreadsheet context
  const hasSpreadsheet = steps.some(s =>
    isWorkflowStepPayload(s.payload) &&
    (s.payload.context?.gridCoordinates || s.payload.pageModelContext?.pageContext.pageType === 'spreadsheet')
  );

  if (hasSpreadsheet) {
    domain = 'Spreadsheet';
    summary = 'Enter data into spreadsheet';
    primaryGoal = 'Fill spreadsheet cells with data';
  } else if (inputCount >= 2) {
    domain = 'Form Entry';
    summary = `Fill form with ${inputCount} fields`;
    primaryGoal = 'Complete form submission';
  } else if (navCount >= 2) {
    domain = 'Navigation';
    summary = 'Navigate through website';
    primaryGoal = 'Reach target page and perform action';
  } else if (clickCount >= 3) {
    domain = 'Click Sequence';
    summary = 'Perform click sequence';
    primaryGoal = 'Complete interaction flow';
  }

  // Extract entities from input steps
  const entities: string[] = [];
  steps.forEach(step => {
    if (isWorkflowStepPayload(step.payload) && step.payload.label) {
      entities.push(step.payload.label);
    }
  });

  return {
    summary,
    primaryGoal,
    subGoals: [],
    domain,
    entities: [...new Set(entities)].slice(0, 5),
    repeatability: inputCount > 0 ? 'parameterized' : 'repeatable',
    successIndicators: ['All steps complete successfully'],
    failureIndicators: ['Element not found', 'Unexpected page state', 'Timeout'],
  };
}

/**
 * Build basic adaptation strategies without AI
 */
function buildBasicAdaptationStrategies(steps: WorkflowStep[]): AdaptationStrategy[] {
  const strategies: AdaptationStrategy[] = [];

  // Add universal adaptation strategies
  strategies.push({
    scenario: 'Button text changed (e.g., "Add" → "Include")',
    howToAdapt: 'Match by semantic intent (action verb + context) rather than exact text',
    affectedSteps: steps.map((_, i) => i).filter(i =>
      isWorkflowStepPayload(steps[i].payload) && steps[i].payload.elementRole === 'button'
    ),
  });

  strategies.push({
    scenario: 'Page layout changed',
    howToAdapt: 'Use semantic anchors (labels, containers, regions) to locate elements',
    affectedSteps: steps.map((_, i) => i),
  });

  strategies.push({
    scenario: 'Dropdown options changed',
    howToAdapt: 'Match by closest text similarity if exact match not found',
    affectedSteps: steps.map((_, i) => i).filter(i =>
      isWorkflowStepPayload(steps[i].payload) &&
      (steps[i].payload.elementRole === 'option' || steps[i].payload.elementRole === 'menuitem')
    ),
  });

  return strategies;
}

/**
 * Merge AI step guidance with local step guidance
 */
function mergeStepGuidance(
  local: StepExecutionGuidance[],
  ai: StepExecutionGuidance[]
): StepExecutionGuidance[] {
  return local.map((localGuidance, index) => {
    const aiGuidance = ai.find(g => g.stepIndex === index);
    if (!aiGuidance) return localGuidance;

    // AI guidance takes precedence, but keep local data as fallback
    return {
      ...localGuidance,
      intent: aiGuidance.intent || localGuidance.intent,
      whyThisElement: aiGuidance.whyThisElement || localGuidance.whyThisElement,
      elementFindingStrategy: {
        ...localGuidance.elementFindingStrategy,
        ...aiGuidance.elementFindingStrategy,
        // Merge arrays
        distinguishers: [
          ...new Set([
            ...localGuidance.elementFindingStrategy.distinguishers,
            ...aiGuidance.elementFindingStrategy.distinguishers,
          ]),
        ],
        relatedElements: [
          ...localGuidance.elementFindingStrategy.relatedElements,
          ...aiGuidance.elementFindingStrategy.relatedElements,
        ],
      },
      preconditions: aiGuidance.preconditions.length > 0
        ? aiGuidance.preconditions
        : localGuidance.preconditions,
      expectedOutcome: aiGuidance.expectedOutcome || localGuidance.expectedOutcome,
      alternatives: [
        ...new Set([...localGuidance.alternatives, ...aiGuidance.alternatives]),
      ],
    };
  });
}

/**
 * Build the prompt for AI analysis
 */
function buildAnalysisPrompt(steps: WorkflowStep[], workflowName?: string): string {
  // Extract relevant data from each step
  const stepSummaries = steps.map((step, index) => {
    if (!isWorkflowStepPayload(step.payload)) {
      return {
        index,
        type: step.type,
        description: step.description || 'Tab switch',
      };
    }

    const payload = step.payload;
    return {
      index,
      type: step.type,
      url: payload.url,
      selector: payload.selector,
      elementText: payload.elementText,
      elementRole: payload.elementRole,
      label: payload.label,
      value: payload.value,
      // Include PageModel context if available
      pageContext: payload.pageModelContext ? {
        pageType: payload.pageModelContext.pageContext.pageType,
        activeContext: payload.pageModelContext.pageContext.activeContext,
        hasModal: payload.pageModelContext.pageContext.uiStateSnapshot.hasModal,
        hasDropdown: payload.pageModelContext.pageContext.uiStateSnapshot.hasOpenDropdown,
        region: payload.pageModelContext.pageContext.regionName,
      } : undefined,
      // Include relationships if available
      relationships: payload.pageModelContext?.elementRelationships ? {
        labeledBy: payload.pageModelContext.elementRelationships.labeledBy?.text,
        triggers: payload.pageModelContext.elementRelationships.triggers?.description,
        containedBy: payload.pageModelContext.elementRelationships.containedBy?.description,
      } : undefined,
      // Include alternatives info
      alternatives: payload.pageModelContext?.alternatives ? {
        uniquenessScore: payload.pageModelContext.alternatives.uniquenessScore,
        selectionReason: payload.pageModelContext.alternatives.selectionReason,
        disambiguators: payload.pageModelContext.alternatives.disambiguators,
        similarCount: payload.pageModelContext.alternatives.similarElements.length,
      } : undefined,
      // Include expected outcome
      expectedOutcome: payload.pageModelContext?.expectations?.primary ? {
        type: payload.pageModelContext.expectations.primary.type,
        description: payload.pageModelContext.expectations.primary.description,
      } : undefined,
      // Include intent if available
      intent: payload.intent,
      stepGoal: payload.stepGoal,
      // Include form context
      formContext: payload.context?.formContext ? {
        formId: payload.context.formContext.formId,
        fieldset: payload.context.formContext.fieldset,
        section: payload.context.formContext.section,
      } : undefined,
      // Include grid context
      gridContext: payload.context?.gridCoordinates ? {
        rowIndex: payload.context.gridCoordinates.rowIndex,
        columnIndex: payload.context.gridCoordinates.columnIndex,
        cellReference: payload.context.gridCoordinates.cellReference,
        columnHeader: payload.context.gridCoordinates.columnHeader,
      } : undefined,
      // Include container context
      container: payload.context?.container,
      // Include scope
      scope: payload.scope,
    };
  });

  const prompt = `You are an expert workflow analyzer. Analyze this recorded browser automation workflow and produce detailed execution guidance.

${workflowName ? `Workflow Name: "${workflowName}"` : ''}

## Recorded Steps

${JSON.stringify(stepSummaries, null, 2)}

## Your Task

Analyze this workflow to understand:
1. WHAT the user was trying to accomplish (the goal, not just the actions)
2. WHY each element was chosen (semantic meaning, not just selector)
3. HOW to find elements when things change (text changes, layout changes)
4. WHAT success looks like for each step and overall

## Output Format

Respond with a JSON object matching this structure:

{
  "workflowUnderstanding": {
    "summary": "One sentence describing what this workflow does",
    "primaryGoal": "The main thing the user is trying to accomplish",
    "subGoals": ["Milestone 1", "Milestone 2"],
    "domain": "Domain/context (e.g., CRM, E-commerce, Spreadsheet)",
    "entities": ["Key entities involved"],
    "repeatability": "one-time" | "repeatable" | "parameterized",
    "successIndicators": ["What indicates success"],
    "failureIndicators": ["What indicates failure"]
  },
  "stepGuidance": [
    {
      "stepIndex": 0,
      "intent": "What the user is trying to do with this step",
      "whyThisElement": "Why THIS element was chosen over alternatives",
      "elementFindingStrategy": {
        "lookingFor": "Semantic description of what to find",
        "searchContext": "Where to look (region, container)",
        "distinguishers": ["What makes this element unique"],
        "relatedElements": [{"description": "related element", "relationship": "near|inside|labeled-by|after|before"}],
        "textPatterns": ["Text patterns that identify this element"],
        "elementType": "button|input|link|dropdown|etc"
      },
      "preconditions": ["What must be true before this step"],
      "expectedOutcome": "What should happen after this step",
      "dependencies": [indices of dependent steps],
      "criticality": "critical|important|optional",
      "retryStrategy": {
        "canRetry": true,
        "approaches": ["Alternative approaches to try"],
        "maxRetries": 3,
        "waitBefore": "What to wait for before retrying"
      },
      "alternatives": ["Alternative ways to accomplish this"]
    }
  ],
  "patterns": [
    {
      "type": "search-and-select|form-fill|navigation-sequence|data-entry|bulk-action|verification",
      "description": "What this pattern does",
      "stepIndices": [0, 1, 2],
      "executionHint": "How to handle this pattern"
    }
  ],
  "adaptationStrategies": [
    {
      "scenario": "What might change (e.g., button text changed)",
      "howToAdapt": "How to handle this change",
      "affectedSteps": [0]
    }
  ]
}

## Guidelines

1. **Intent over Selectors**: Focus on WHAT the user wants, not HOW it was recorded
2. **Semantic Anchors**: Identify text, labels, and relationships that are more stable than selectors
3. **Adaptation**: Consider how text might change, layouts might differ, elements might move
4. **Patterns**: Recognize common patterns like "search for X then select it" or "fill form fields"
5. **Dependencies**: Identify which steps depend on previous steps (e.g., can't select from dropdown until it's open)
6. **Criticality**: Some steps are critical (submit), others are optional (scrolling)

Respond ONLY with valid JSON, no markdown formatting.`;

  return prompt;
}

/**
 * Call the AI service to analyze the workflow
 * Uses the existing Supabase edge function infrastructure
 */
async function callAIService(prompt: string): Promise<string> {
  try {
    // Import AI config to check if enabled
    const { aiConfig } = await import('./ai-config');

    if (!aiConfig.isEnabled()) {
      console.log('[PostRecordingAnalyzer] AI disabled, using fallback analysis');
      return JSON.stringify(createFallbackAnalysis());
    }

    // Use the existing Supabase AI infrastructure
    const supabaseUrl = aiConfig.getSupabaseUrl();
    const anonKey = aiConfig.getSupabaseAnonKey();

    if (!supabaseUrl || !anonKey) {
      console.warn('[PostRecordingAnalyzer] Supabase not configured, using fallback');
      return JSON.stringify(createFallbackAnalysis());
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/analyze_workflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      throw new Error(`AI service returned ${response.status}`);
    }

    const result = await response.json();
    return result.analysis || JSON.stringify(createFallbackAnalysis());
  } catch (error) {
    console.error('[PostRecordingAnalyzer] AI service call failed:', error);
    // Return a fallback analysis structure
    return JSON.stringify(createFallbackAnalysis());
  }
}

/**
 * Parse the AI response into a structured analysis
 */
function parseAnalysisResult(result: string, steps: WorkflowStep[]): WorkflowAnalysis {
  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = result;
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and normalize the structure
    return {
      analyzedAt: Date.now(),
      analysisVersion: '1.0.0',
      confidence: calculateConfidence(parsed, steps),
      workflowUnderstanding: normalizeWorkflowUnderstanding(parsed.workflowUnderstanding),
      stepGuidance: normalizeStepGuidance(parsed.stepGuidance, steps),
      patterns: parsed.patterns || [],
      adaptationStrategies: parsed.adaptationStrategies || [],
    };
  } catch (error) {
    console.error('[PostRecordingAnalyzer] Failed to parse AI response:', error);
    return createFallbackAnalysis(steps);
  }
}

/**
 * Calculate confidence based on completeness of analysis
 */
function calculateConfidence(parsed: Record<string, unknown>, steps: WorkflowStep[]): number {
  let score = 0;
  let checks = 0;

  // Check workflow understanding
  checks++;
  if (parsed.workflowUnderstanding) score++;

  // Check step guidance coverage
  checks++;
  const guidance = parsed.stepGuidance as Array<Record<string, unknown>> | undefined;
  if (guidance && guidance.length >= steps.length * 0.8) score++;

  // Check patterns detected
  checks++;
  if (parsed.patterns && (parsed.patterns as unknown[]).length > 0) score++;

  // Check adaptation strategies
  checks++;
  if (parsed.adaptationStrategies && (parsed.adaptationStrategies as unknown[]).length > 0) score++;

  return score / checks;
}

/**
 * Normalize workflow understanding with defaults
 */
function normalizeWorkflowUnderstanding(understanding: Partial<WorkflowUnderstanding> | undefined): WorkflowUnderstanding {
  return {
    summary: understanding?.summary || 'Recorded workflow',
    primaryGoal: understanding?.primaryGoal || 'Complete the recorded task',
    subGoals: understanding?.subGoals || [],
    domain: understanding?.domain || 'General',
    entities: understanding?.entities || [],
    repeatability: understanding?.repeatability || 'one-time',
    successIndicators: understanding?.successIndicators || ['All steps complete successfully'],
    failureIndicators: understanding?.failureIndicators || ['Element not found', 'Unexpected error'],
  };
}

/**
 * Normalize step guidance with defaults
 */
function normalizeStepGuidance(guidance: Partial<StepExecutionGuidance>[] | undefined, steps: WorkflowStep[]): StepExecutionGuidance[] {
  return steps.map((step, index) => {
    const existing = guidance?.find(g => g.stepIndex === index);

    // Build default from step data
    const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;

    return {
      stepIndex: index,
      intent: existing?.intent || buildDefaultIntent(step),
      whyThisElement: existing?.whyThisElement || buildDefaultWhyThisElement(payload),
      elementFindingStrategy: existing?.elementFindingStrategy || buildDefaultFindingStrategy(payload),
      preconditions: existing?.preconditions || buildDefaultPreconditions(step, index, steps),
      expectedOutcome: existing?.expectedOutcome || buildDefaultExpectedOutcome(step),
      dependencies: existing?.dependencies || inferDependencies(index, steps),
      criticality: existing?.criticality || inferCriticality(step),
      retryStrategy: existing?.retryStrategy || {
        canRetry: true,
        approaches: ['Wait and retry', 'Try fallback selectors'],
        maxRetries: 3,
      },
      alternatives: existing?.alternatives || [],
    };
  });
}

/**
 * Build default intent from step data
 */
function buildDefaultIntent(step: WorkflowStep): string {
  if (!isWorkflowStepPayload(step.payload)) {
    return `Switch to tab`;
  }

  const payload = step.payload;

  // Use existing intent if available
  if (payload.intent) {
    return formatIntent(payload.intent);
  }

  // Use step goal if available
  if (payload.stepGoal?.description) {
    return payload.stepGoal.description;
  }

  // Build from step type and element info
  switch (step.type) {
    case 'CLICK':
      if (payload.elementText) {
        return `Click on "${payload.elementText}"`;
      }
      if (payload.elementRole) {
        return `Click ${payload.elementRole}`;
      }
      return 'Click element';

    case 'INPUT':
      if (payload.label) {
        return `Enter value in "${payload.label}" field`;
      }
      return `Enter "${payload.value || 'value'}"`;

    case 'NAVIGATION':
      return `Navigate to ${new URL(payload.url).hostname}`;

    case 'KEYBOARD':
      return `Press keyboard key`;

    default:
      return `${step.type} action`;
  }
}

/**
 * Format intent object to string
 */
function formatIntent(intent: WorkflowStepPayload['intent']): string {
  if (!intent) return 'Perform action';

  switch (intent.kind) {
    case 'CLICK':
      return 'Click element';
    case 'TYPE':
      return `Enter value`;
    case 'OPEN_ROW_ACTIONS':
      return 'Open row actions menu';
    case 'SELECT_DROPDOWN_OPTION':
      return 'Select dropdown option';
    case 'NAVIGATE':
      return 'Navigate to page';
    case 'SUBMIT_FORM':
      return 'Submit form';
    case 'TOGGLE_CHECKBOX':
      return 'Toggle checkbox';
    case 'SCROLL_TO':
      return 'Scroll to element';
    case 'HOVER':
      return 'Hover over element';
    case 'FOCUS':
      return 'Focus element';
    case 'PRESS_KEY':
      return `Press key`;
    case 'READ':
      return 'Read/copy value';
    case 'ASSERT':
      return 'Verify element state';
    default:
      return 'Perform action';
  }
}

/**
 * Build default "why this element" explanation
 */
function buildDefaultWhyThisElement(payload: WorkflowStepPayload | null): string {
  if (!payload) return 'Tab operation';

  // Use PageModel context if available
  if (payload.pageModelContext?.alternatives) {
    const alt = payload.pageModelContext.alternatives;
    if (alt.selectionReason) {
      return alt.selectionReason;
    }
    if (alt.disambiguators.length > 0) {
      return `Identified by: ${alt.disambiguators.join(', ')}`;
    }
  }

  // Use relationships
  if (payload.pageModelContext?.elementRelationships?.labeledBy) {
    return `Labeled "${payload.pageModelContext.elementRelationships.labeledBy.text}"`;
  }

  // Use element text
  if (payload.elementText) {
    return `Has text "${payload.elementText}"`;
  }

  // Use aria-label
  if (payload.label) {
    return `Labeled "${payload.label}"`;
  }

  return 'Matched by selector';
}

/**
 * Build default element finding strategy
 */
function buildDefaultFindingStrategy(payload: WorkflowStepPayload | null): ElementFindingStrategy {
  if (!payload) {
    return {
      lookingFor: 'Tab',
      searchContext: 'Browser tabs',
      distinguishers: [],
      relatedElements: [],
      textPatterns: [],
      elementType: 'tab',
    };
  }

  const strategy: ElementFindingStrategy = {
    lookingFor: payload.elementText || payload.label || payload.elementRole || 'element',
    searchContext: 'Page',
    distinguishers: [],
    relatedElements: [],
    textPatterns: [],
    elementType: payload.elementRole || 'element',
  };

  // Add PageModel context
  if (payload.pageModelContext) {
    const ctx = payload.pageModelContext;

    // Search context from region
    if (ctx.pageContext.regionName) {
      strategy.searchContext = `In ${ctx.pageContext.regionName} area`;
    }

    // Distinguishers from alternatives
    if (ctx.alternatives?.disambiguators) {
      strategy.distinguishers = ctx.alternatives.disambiguators;
    }

    // Related elements from relationships
    if (ctx.elementRelationships?.labeledBy) {
      strategy.relatedElements.push({
        description: ctx.elementRelationships.labeledBy.text,
        relationship: 'labeled-by',
      });
    }
    if (ctx.elementRelationships?.containedBy) {
      strategy.relatedElements.push({
        description: ctx.elementRelationships.containedBy.description,
        relationship: 'inside',
      });
    }
  }

  // Text patterns
  if (payload.elementText) {
    strategy.textPatterns.push(payload.elementText);
  }

  // Container context
  if (payload.context?.container?.text) {
    strategy.searchContext = `Inside "${payload.context.container.text}" section`;
  }

  // Scope context
  if (payload.scope) {
    if (payload.scope.kind === 'MODAL') {
      strategy.searchContext = `Inside modal "${payload.scope.selector || 'dialog'}"`;
    } else if (payload.scope.kind === 'WIDGET') {
      strategy.searchContext = `Inside widget "${payload.scope.title}"`;
    } else if (payload.scope.kind === 'CONTAINER') {
      strategy.searchContext = `Inside container "${payload.scope.selector}"`;
    } else if (payload.scope.kind === 'NEAREST_SECTION') {
      strategy.searchContext = `Inside section "${payload.scope.headingText}"`;
    }
  }

  return strategy;
}

/**
 * Build default preconditions
 */
function buildDefaultPreconditions(step: WorkflowStep, index: number, steps: WorkflowStep[]): string[] {
  const preconditions: string[] = [];

  if (!isWorkflowStepPayload(step.payload)) {
    return ['Tab exists'];
  }

  const payload = step.payload;

  // Page must be loaded
  if (index === 0 || step.type === 'NAVIGATION') {
    preconditions.push('Page fully loaded');
  }

  // Check for modal context
  if (payload.pageModelContext?.pageContext.uiStateSnapshot.hasModal) {
    preconditions.push('Modal is open');
  }

  // Check for dropdown context
  if (payload.pageModelContext?.pageContext.uiStateSnapshot.hasOpenDropdown) {
    preconditions.push('Dropdown is open');
  }

  // Check for previous dropdown trigger
  if (index > 0) {
    const prevStep = steps[index - 1];
    if (isWorkflowStepPayload(prevStep.payload)) {
      const prevPayload = prevStep.payload;
      if (prevPayload.elementRole === 'combobox' || prevPayload.elementRole === 'listbox') {
        preconditions.push('Dropdown menu is visible');
      }
    }
  }

  // Element must be visible
  preconditions.push('Target element is visible and enabled');

  return preconditions;
}

/**
 * Build default expected outcome
 */
function buildDefaultExpectedOutcome(step: WorkflowStep): string {
  if (!isWorkflowStepPayload(step.payload)) {
    return 'Tab is active';
  }

  const payload = step.payload;

  // Use PageModel expectation if available
  if (payload.pageModelContext?.expectations?.primary) {
    return payload.pageModelContext.expectations.primary.description;
  }

  // Use step goal expected outcome
  if (payload.stepGoal?.expectedOutcome) {
    return payload.stepGoal.expectedOutcome;
  }

  // Build from step type
  switch (step.type) {
    case 'CLICK':
      if (payload.elementRole === 'combobox' || payload.elementRole === 'listbox') {
        return 'Dropdown opens';
      }
      if (payload.elementRole === 'option' || payload.elementRole === 'menuitem') {
        return 'Option selected, dropdown closes';
      }
      if (payload.elementRole === 'button') {
        const text = (payload.elementText || '').toLowerCase();
        if (text.includes('submit') || text.includes('save')) {
          return 'Form submitted, loading indicator or success message';
        }
        if (text.includes('close') || text.includes('cancel')) {
          return 'Dialog closes';
        }
      }
      return 'Element clicked, page may update';

    case 'INPUT':
      return 'Value entered in field';

    case 'NAVIGATION':
      return 'Page navigates to new URL';

    default:
      return 'Action completes';
  }
}

/**
 * Infer step dependencies
 */
function inferDependencies(index: number, steps: WorkflowStep[]): number[] {
  const deps: number[] = [];

  if (index === 0) return deps;

  const step = steps[index];
  if (!isWorkflowStepPayload(step.payload)) {
    return deps;
  }

  const payload = step.payload;

  // Check if this is a dropdown option (depends on previous dropdown trigger)
  if (payload.elementRole === 'option' || payload.elementRole === 'menuitem') {
    // Find the most recent dropdown trigger
    for (let i = index - 1; i >= 0; i--) {
      const prevStep = steps[i];
      if (isWorkflowStepPayload(prevStep.payload)) {
        const prevPayload = prevStep.payload;
        if (prevPayload.elementRole === 'combobox' || prevPayload.elementRole === 'listbox' ||
            prevPayload.elementRole === 'button') {
          deps.push(i);
          break;
        }
      }
    }
  }

  // Form submissions typically depend on input steps
  if (step.type === 'CLICK' && payload.elementRole === 'button') {
    const text = (payload.elementText || '').toLowerCase();
    if (text.includes('submit') || text.includes('save') || text.includes('create')) {
      // Depend on recent INPUT steps
      for (let i = index - 1; i >= Math.max(0, index - 10); i--) {
        if (steps[i].type === 'INPUT') {
          deps.push(i);
        }
      }
    }
  }

  return deps;
}

/**
 * Infer step criticality
 */
function inferCriticality(step: WorkflowStep): 'critical' | 'important' | 'optional' {
  if (!isWorkflowStepPayload(step.payload)) {
    return 'important';
  }

  const payload = step.payload;

  // Submit/save buttons are critical
  if (step.type === 'CLICK' && payload.elementRole === 'button') {
    const text = (payload.elementText || '').toLowerCase();
    if (text.includes('submit') || text.includes('save') || text.includes('confirm')) {
      return 'critical';
    }
  }

  // Navigation is critical
  if (step.type === 'NAVIGATION') {
    return 'critical';
  }

  // Input to required fields is critical
  if (step.type === 'INPUT' && payload.inputDetails?.required) {
    return 'critical';
  }

  // Scrolling is optional
  if (step.type === 'SCROLL') {
    return 'optional';
  }

  return 'important';
}

/**
 * Create fallback analysis when AI fails
 */
function createFallbackAnalysis(steps?: WorkflowStep[]): WorkflowAnalysis {
  return {
    analyzedAt: Date.now(),
    analysisVersion: '1.0.0',
    confidence: 0.3,
    workflowUnderstanding: {
      summary: 'Recorded browser automation workflow',
      primaryGoal: 'Complete the recorded task sequence',
      subGoals: [],
      domain: 'General',
      entities: [],
      repeatability: 'one-time',
      successIndicators: ['All steps complete without errors'],
      failureIndicators: ['Element not found', 'Unexpected page state'],
    },
    stepGuidance: steps ? normalizeStepGuidance(undefined, steps) : [],
    patterns: [],
    adaptationStrategies: [],
  };
}

// ============================================================================
// Integration with SavedWorkflow
// ============================================================================

/**
 * Analyze and enrich a SavedWorkflow with AI analysis
 */
export async function analyzeAndEnrichWorkflow(
  workflow: SavedWorkflow,
  onProgress?: (status: string) => void
): Promise<SavedWorkflow> {
  try {
    const analysis = await analyzeWorkflowWithAI(workflow.steps, {
      workflowName: workflow.name,
      onProgress,
    });

    // Enrich the workflow with analysis
    return {
      ...workflow,
      // Add AI analysis
      aiAnalysis: analysis,
      // Update description if not set
      description: workflow.description || analysis.workflowUnderstanding.summary,
      // Update inferred intent
      inferredIntent: {
        primaryGoal: analysis.workflowUnderstanding.primaryGoal,
        subGoals: analysis.workflowUnderstanding.subGoals,
        suggestedName: workflow.name,
        confidence: analysis.confidence,
        analyzedAt: analysis.analyzedAt,
      },
      // Enrich steps with natural language context
      steps: workflow.steps.map((step, index) => {
        const guidance = analysis.stepGuidance[index];
        if (!guidance) return step;

        return {
          ...step,
          naturalLanguage: {
            intent: guidance.intent,
            precondition: guidance.preconditions.join('. '),
            expectedOutcome: guidance.expectedOutcome,
            dependencies: guidance.dependencies,
            alternateDescriptions: guidance.alternatives,
          },
          // Also update description
          description: step.description || guidance.intent,
        };
      }),
    };
  } catch (error) {
    console.error('[PostRecordingAnalyzer] Failed to analyze workflow:', error);
    // Return original workflow if analysis fails
    return workflow;
  }
}
