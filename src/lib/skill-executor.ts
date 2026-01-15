/**
 * Skill Executor
 *
 * Executes skills with:
 * - Variable substitution
 * - Repetition support
 * - Dependency ordering
 * - Progress tracking
 */

import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type {
  SkillDefinition,
  SkillMatch,
  SkillExecutionState,
  SkillExecutionResult,
} from '../types/skill';
import { SkillStorage } from './skill-storage';
import { parseSkillRequest } from './skill-request-parser';

// ============================================================================
// Types
// ============================================================================

export interface SkillExecutionOptions {
  /** Callback when execution state changes */
  onProgress?: (state: SkillExecutionState) => void;
  /** Callback when a skill completes */
  onSkillComplete?: (result: SkillExecutionResult) => void;
  /** Delay between steps in ms */
  stepDelay?: number;
  /** Delay between iterations in ms */
  iterationDelay?: number;
  /** Max iterations for "until done" skills */
  maxIterations?: number;
  /** Tab ID to execute in */
  tabId?: number;
}

export interface ExecuteSkillsRequest {
  request: string;
  options?: SkillExecutionOptions;
}

export interface ExecuteSkillsResult {
  success: boolean;
  skillResults: SkillExecutionResult[];
  totalDurationMs: number;
  error?: string;
}

// ============================================================================
// Skill Executor Class
// ============================================================================

export class SkillExecutor {
  private currentState: SkillExecutionState | null = null;
  private aborted = false;

  /**
   * Execute skills based on a user request
   */
  async executeRequest(
    req: ExecuteSkillsRequest
  ): Promise<ExecuteSkillsResult> {
    const startTime = Date.now();
    const skillResults: SkillExecutionResult[] = [];

    try {
      // Parse the request to find matching skills
      const parsed = await parseSkillRequest(req.request);

      if (parsed.matches.length === 0) {
        return {
          success: false,
          skillResults: [],
          totalDurationMs: Date.now() - startTime,
          error: 'No matching skills found for this request',
        };
      }

      // Execute skills in order
      for (const skillId of parsed.executionOrder) {
        if (this.aborted) break;

        const match = parsed.matches.find(m => m.skillId === skillId);
        if (!match) continue;

        const skill = await SkillStorage.loadSkill(skillId);
        if (!skill) continue;

        const result = await this.executeSkill(skill, match, req.options);
        skillResults.push(result);

        if (!result.success && !req.options?.onSkillComplete) {
          // Stop on failure unless there's a handler
          break;
        }
      }

      return {
        success: skillResults.every(r => r.success),
        skillResults,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        skillResults,
        totalDurationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a single skill with its matched variables and repeat count
   */
  async executeSkill(
    skill: SkillDefinition,
    match: SkillMatch,
    options?: SkillExecutionOptions
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const stepResults: Array<{ stepIndex: number; success: boolean; error?: string }> = [];

    const iterations = match.repeatCount || 1;
    const stepDelay = options?.stepDelay || 300;
    const iterationDelay = options?.iterationDelay || 500;

    let completedIterations = 0;

    try {
      for (let iter = 0; iter < iterations; iter++) {
        if (this.aborted) break;

        // Update state
        this.currentState = {
          skillId: skill.id,
          skillName: skill.name,
          currentIteration: iter + 1,
          totalIterations: iterations,
          currentStepIndex: 0,
          totalSteps: skill.steps.length,
          variables: match.variables,
          status: 'running',
          startedAt: startTime,
        };
        options?.onProgress?.(this.currentState);

        // Execute each step in the skill
        for (let stepIdx = 0; stepIdx < skill.steps.length; stepIdx++) {
          if (this.aborted) break;

          const step = skill.steps[stepIdx];

          // Update progress
          this.currentState = {
            ...this.currentState!,
            currentStepIndex: stepIdx,
            status: 'running',
          };
          options?.onProgress?.(this.currentState);

          try {
            // Substitute variables and execute
            const substitutedStep = substituteVariables(step, match.variables);
            await this.executeStep(substitutedStep, options);

            stepResults.push({ stepIndex: stepIdx, success: true });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Step failed';
            stepResults.push({ stepIndex: stepIdx, success: false, error: errorMsg });

            // Update state with error
            this.currentState = {
              ...this.currentState!,
              status: 'failed',
              error: errorMsg,
            };
            options?.onProgress?.(this.currentState);

            throw error; // Re-throw to stop execution
          }

          // Wait between steps
          if (stepIdx < skill.steps.length - 1) {
            await sleep(stepDelay);
          }
        }

        completedIterations++;

        // Wait between iterations
        if (iter < iterations - 1) {
          await sleep(iterationDelay);
        }
      }

      // Success
      const result: SkillExecutionResult = {
        skillId: skill.id,
        success: true,
        iterationsCompleted: completedIterations,
        durationMs: Date.now() - startTime,
        stepResults,
      };

      this.currentState = {
        ...this.currentState!,
        status: 'completed',
      };
      options?.onProgress?.(this.currentState);
      options?.onSkillComplete?.(result);

      return result;
    } catch (error) {
      const result: SkillExecutionResult = {
        skillId: skill.id,
        success: false,
        iterationsCompleted: completedIterations,
        durationMs: Date.now() - startTime,
        stepResults,
        error: error instanceof Error ? error.message : 'Skill execution failed',
      };

      options?.onSkillComplete?.(result);
      return result;
    }
  }

  /**
   * Execute a single step
   * This should be overridden or integrated with the actual execution engine
   */
  private async executeStep(
    step: WorkflowStep,
    _options?: SkillExecutionOptions
  ): Promise<void> {
    // Send message to content script / service worker to execute
    // This integrates with the existing execution infrastructure

    const payload = step.payload;
    if (!isWorkflowStepPayload(payload)) {
      // Handle tab switch
      console.log('[SkillExecutor] Tab switch step - not implemented in skill executor');
      return;
    }

    // Build execution message
    const message = {
      type: 'EXECUTE_STEP' as const,
      payload: {
        step,
        index: 0,
      },
    };

    // Send to service worker for execution
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response?.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Step execution failed'));
        }
      });
    });
  }

  /**
   * Stop current execution
   */
  abort(): void {
    this.aborted = true;
    if (this.currentState) {
      this.currentState.status = 'paused';
    }
  }

  /**
   * Get current execution state
   */
  getState(): SkillExecutionState | null {
    return this.currentState;
  }

  /**
   * Reset executor for new execution
   */
  reset(): void {
    this.aborted = false;
    this.currentState = null;
  }
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Substitute variables in a workflow step
 */
function substituteVariables(
  step: WorkflowStep,
  variables: Record<string, string>
): WorkflowStep {
  if (Object.keys(variables).length === 0) {
    return step;
  }

  const payload = step.payload;
  if (!isWorkflowStepPayload(payload)) {
    return step;
  }

  // Clone the step
  const newStep: WorkflowStep = JSON.parse(JSON.stringify(step));
  const newPayload = newStep.payload as typeof payload;

  // Substitute in value field
  if (newPayload.value) {
    newPayload.value = substituteString(newPayload.value, variables);
  }

  // Substitute in label field (for matching)
  if (newPayload.label) {
    newPayload.label = substituteString(newPayload.label, variables);
  }

  // Substitute in element text
  if (newPayload.elementText) {
    newPayload.elementText = substituteString(newPayload.elementText, variables);
  }

  return newStep;
}

/**
 * Substitute variables in a string
 * Supports formats: ${varName}, {{varName}}, {varName}
 */
function substituteString(
  str: string,
  variables: Record<string, string>
): string {
  let result = str;

  for (const [name, value] of Object.entries(variables)) {
    // Normalize the variable name for matching
    const normalizedName = name.toLowerCase().replace(/\s+/g, '');

    // Try different formats
    const patterns = [
      new RegExp(`\\$\\{${escapeRegex(name)}\\}`, 'gi'),
      new RegExp(`\\{\\{${escapeRegex(name)}\\}\\}`, 'gi'),
      new RegExp(`\\{${escapeRegex(name)}\\}`, 'gi'),
      new RegExp(`\\$\\{${escapeRegex(normalizedName)}\\}`, 'gi'),
      new RegExp(`\\{\\{${escapeRegex(normalizedName)}\\}\\}`, 'gi'),
      new RegExp(`\\{${escapeRegex(normalizedName)}\\}`, 'gi'),
    ];

    for (const pattern of patterns) {
      result = result.replace(pattern, value);
    }
  }

  // Also do direct replacement if the entire string matches a variable name
  const lowerStr = str.toLowerCase().replace(/\s+/g, '');
  for (const [name, value] of Object.entries(variables)) {
    const normalizedName = name.toLowerCase().replace(/\s+/g, '');
    if (lowerStr === normalizedName) {
      return value;
    }
  }

  return result;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Singleton Export
// ============================================================================

export const skillExecutor = new SkillExecutor();
