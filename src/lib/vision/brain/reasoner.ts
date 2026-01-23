/**
 * Brain Reasoner
 *
 * Makes decisions about what action to take based on:
 * - Current screen state (what we see)
 * - Task knowledge (what we're trying to do)
 * - Variables (user-provided data)
 * - History (what we've done so far)
 */

import type {
  ScreenUnderstanding,
  ActionIntent,
  Decision,
  ActionRecord,
  VisionExecutionContext,
} from '../types';
import { extractBase64 } from '../eyes/screenshot';
import type { Screenshot } from '../types';

/**
 * Semantic Task Model - output of recording phase
 */
export interface TaskPhase {
  name: string;
  description: string;
  intent: string;
  expectedState?: {
    pageContains?: string[];
    formFields?: string[];
    pageType?: string;
  };
  successIndicators?: {
    pageChanges?: boolean;
    urlContains?: string;
    textAppears?: string[];
    elementAppears?: string;
  };
}

export interface SemanticTaskModel {
  name: string;
  description: string;
  phases: TaskPhase[];
  variables: Array<{
    name: string;
    fieldContext: string;
    type?: string;
  }>;
}

/**
 * Configuration for the vision API
 */
interface VisionConfig {
  apiUrl: string;
  apiKey?: string;
}

let visionConfig: VisionConfig | null = null;

/**
 * Initialize vision API configuration
 */
export function initReasonerConfig(config: VisionConfig): void {
  visionConfig = config;
}

/**
 * Get the current vision config
 */
async function getVisionConfig(): Promise<VisionConfig> {
  if (visionConfig) {
    return visionConfig;
  }

  const stored = await chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey']);
  if (stored.supabaseUrl) {
    return {
      apiUrl: `${stored.supabaseUrl as string}/functions/v1/vision_analyze`,
      apiKey: stored.supabaseAnonKey as string | undefined,
    };
  }

  throw new Error('Vision API not configured');
}

/**
 * Decide the next action based on current state and task knowledge
 */
export async function decideNextAction(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  taskModel: SemanticTaskModel,
  currentPhaseIndex: number,
  variables: Record<string, string>,
  history: ActionRecord[]
): Promise<Decision> {
  const config = await getVisionConfig();
  const currentPhase = taskModel.phases[currentPhaseIndex];

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'decide_action',
      screenshot: extractBase64(screenshot),
      context: {
        // What we see
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          components: screenState.components.slice(0, 20), // Limit for token count
          formState: screenState.formState,
          state: screenState.state,
        },

        // What we're trying to do
        task: {
          name: taskModel.name,
          description: taskModel.description,
          currentPhase: currentPhase,
          phaseIndex: currentPhaseIndex,
          totalPhases: taskModel.phases.length,
        },

        // Data to use
        variables,

        // What we've done
        recentHistory: history.slice(-5).map((h) => ({
          action: h.decision.action,
          reasoning: h.decision.reasoning,
          success: h.verification.success,
        })),
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    // Return a "stuck" decision
    return {
      action: { type: 'stuck' },
      reasoning: result.error || 'Failed to decide next action',
      confidence: 0,
      expectedOutcome: 'Unable to proceed',
    };
  }

  return result.result as Decision;
}

/**
 * Decide the next action using RICH execution context
 *
 * This is the preferred method - it passes all intelligence from
 * WorkflowMemory to the vision AI for better decision making.
 */
export async function decideNextActionWithContext(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  executionContext: VisionExecutionContext
): Promise<Decision> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'decide_action_rich',
      screenshot: extractBase64(screenshot),
      context: {
        // What we see
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          components: screenState.components.slice(0, 20), // Limit for token count
          formState: screenState.formState,
          state: screenState.state,
        },

        // FULL task context
        task: executionContext.task,

        // Current phase with step guidance
        currentPhase: executionContext.currentPhase,

        // User-taught rules (from Q&A)
        knowledge: executionContext.knowledge,

        // Success criteria
        successCriteria: executionContext.successCriteria,

        // Adaptation strategies
        adaptations: executionContext.adaptations,

        // How user demonstrated it
        demonstration: executionContext.demonstration,

        // Past experience
        experience: executionContext.experience,

        // Data to use
        variables: executionContext.variables,

        // Progress
        phaseIndex: executionContext.phaseIndex,
        totalPhases: executionContext.totalPhases,

        // What we've done
        recentHistory: executionContext.recentHistory,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      action: { type: 'stuck' },
      reasoning: result.error || 'Failed to decide next action',
      confidence: 0,
      expectedOutcome: 'Unable to proceed',
    };
  }

  return result.result as Decision;
}

/**
 * Check if current phase is complete (with rich context)
 */
export async function isPhaseCompleteWithContext(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  executionContext: VisionExecutionContext
): Promise<{ complete: boolean; confidence: number; reason: string }> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'check_phase_complete_rich',
      screenshot: extractBase64(screenshot),
      context: {
        // Current phase info
        currentPhase: {
          name: executionContext.currentPhase.name,
          intent: executionContext.currentPhase.intent,
          stepGuidance: executionContext.currentPhase.stepGuidance,
        },

        // Success criteria to check
        successCriteria: executionContext.successCriteria,

        // Screen state
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          state: screenState.state,
        },

        // Progress
        phaseIndex: executionContext.phaseIndex,
        totalPhases: executionContext.totalPhases,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      complete: false,
      confidence: 0,
      reason: 'Failed to check phase completion',
    };
  }

  return result.result;
}

/**
 * Check if entire task is complete (with rich context)
 */
export async function isTaskCompleteWithContext(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  executionContext: VisionExecutionContext
): Promise<{ complete: boolean; confidence: number; reason: string }> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'check_task_complete_rich',
      screenshot: extractBase64(screenshot),
      context: {
        // Task info
        task: executionContext.task,

        // Success criteria
        successCriteria: executionContext.successCriteria,

        // Screen state
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          state: screenState.state,
        },

        // Progress
        phaseIndex: executionContext.phaseIndex,
        totalPhases: executionContext.totalPhases,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      complete: false,
      confidence: 0,
      reason: 'Failed to check task completion',
    };
  }

  return result.result;
}

/**
 * Get recovery suggestions with rich context
 */
export async function getRecoverySuggestionsWithContext(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  executionContext: VisionExecutionContext,
  stuckReason: string
): Promise<{
  suggestions: string[];
  alternativeActions: ActionIntent[];
}> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'get_recovery_rich',
      screenshot: extractBase64(screenshot),
      context: {
        stuckReason,
        task: executionContext.task,
        currentPhase: executionContext.currentPhase,
        knowledge: executionContext.knowledge,
        adaptations: executionContext.adaptations,
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
        },
        recentHistory: executionContext.recentHistory,
      },
    }),
  });

  if (!response.ok) {
    return {
      suggestions: ['Unable to get recovery suggestions'],
      alternativeActions: [],
    };
  }

  const result = await response.json();
  return result.result || { suggestions: [], alternativeActions: [] };
}

/**
 * Check if current phase is complete
 */
export async function isPhaseComplete(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  phase: TaskPhase
): Promise<{ complete: boolean; confidence: number; reason: string }> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'check_phase_complete',
      screenshot: extractBase64(screenshot),
      context: {
        phase: {
          name: phase.name,
          intent: phase.intent,
          successIndicators: phase.successIndicators,
        },
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          state: screenState.state,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      complete: false,
      confidence: 0,
      reason: 'Failed to check phase completion',
    };
  }

  return result.result;
}

/**
 * Check if entire task is complete
 */
export async function isTaskComplete(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  taskModel: SemanticTaskModel
): Promise<{ complete: boolean; confidence: number; reason: string }> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'check_task_complete',
      screenshot: extractBase64(screenshot),
      context: {
        task: {
          name: taskModel.name,
          description: taskModel.description,
          phases: taskModel.phases.map((p) => ({
            name: p.name,
            intent: p.intent,
          })),
        },
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          state: screenState.state,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return {
      complete: false,
      confidence: 0,
      reason: 'Failed to check task completion',
    };
  }

  return result.result;
}

/**
 * Detect if we're stuck (repeated failures, loops, etc.)
 */
export function detectStuckState(history: ActionRecord[]): {
  isStuck: boolean;
  reason?: string;
} {
  if (history.length < 3) {
    return { isStuck: false };
  }

  const recent = history.slice(-5);

  // Check for repeated failures
  const failureCount = recent.filter((h) => !h.verification.success).length;
  if (failureCount >= 3) {
    return {
      isStuck: true,
      reason: 'Multiple consecutive failures',
    };
  }

  // Check for action loops (same action repeated)
  const recentActions = recent.map((h) => JSON.stringify(h.decision.action));
  const uniqueActions = new Set(recentActions);
  if (recentActions.length >= 4 && uniqueActions.size <= 2) {
    return {
      isStuck: true,
      reason: 'Repeating same actions without progress',
    };
  }

  // Check for low confidence repeatedly
  const lowConfidenceCount = recent.filter((h) => h.decision.confidence < 0.3).length;
  if (lowConfidenceCount >= 3) {
    return {
      isStuck: true,
      reason: 'Consistently low confidence in decisions',
    };
  }

  return { isStuck: false };
}

/**
 * Get recovery suggestions when stuck
 */
export async function getRecoverySuggestions(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  taskModel: SemanticTaskModel,
  history: ActionRecord[],
  stuckReason: string
): Promise<{
  suggestions: string[];
  alternativeActions: ActionIntent[];
}> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'get_recovery',
      screenshot: extractBase64(screenshot),
      context: {
        stuckReason,
        task: {
          name: taskModel.name,
          description: taskModel.description,
        },
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
        },
        recentHistory: history.slice(-5).map((h) => ({
          action: h.decision.action,
          result: h.verification.success,
        })),
      },
    }),
  });

  if (!response.ok) {
    return {
      suggestions: ['Unable to get recovery suggestions'],
      alternativeActions: [],
    };
  }

  const result = await response.json();
  return result.result || { suggestions: [], alternativeActions: [] };
}

/**
 * Map a variable to the appropriate field based on context
 */
export function matchVariableToField(
  variableName: string,
  _variableValue: string,  // Reserved for future use (e.g., type inference)
  screenState: ScreenUnderstanding
): { fieldLabel: string; confidence: number } | null {
  if (!screenState.formState?.fields) {
    return null;
  }

  // Common mappings
  const mappings: Record<string, string[]> = {
    email: ['email', 'e-mail', 'email address'],
    password: ['password', 'pass', 'pwd'],
    firstName: ['first name', 'firstname', 'first', 'given name'],
    lastName: ['last name', 'lastname', 'last', 'surname', 'family name'],
    name: ['name', 'full name', 'your name'],
    phone: ['phone', 'telephone', 'mobile', 'cell'],
    address: ['address', 'street', 'location'],
    city: ['city', 'town'],
    state: ['state', 'province', 'region'],
    zip: ['zip', 'postal', 'postcode', 'zip code'],
    country: ['country', 'nation'],
    date: ['date', 'birthday', 'dob'],
    company: ['company', 'organization', 'employer'],
  };

  const possibleLabels = mappings[variableName.toLowerCase()] || [variableName];

  for (const field of screenState.formState.fields) {
    const fieldLabelLower = field.label.toLowerCase();
    for (const label of possibleLabels) {
      if (fieldLabelLower.includes(label)) {
        return { fieldLabel: field.label, confidence: 0.9 };
      }
    }
  }

  // Fuzzy match - if variable name appears in field label
  for (const field of screenState.formState.fields) {
    if (field.label.toLowerCase().includes(variableName.toLowerCase())) {
      return { fieldLabel: field.label, confidence: 0.7 };
    }
  }

  return null;
}
