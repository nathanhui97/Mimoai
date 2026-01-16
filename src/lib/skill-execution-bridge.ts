/**
 * Skill Execution Bridge
 *
 * Connects TeachableSkills to the existing execution infrastructure:
 * - Tier1Executor: Fast, DOM-based execution (static methods)
 * - VisionAssist (Tier3): Vision-based fallback (static methods)
 * - PostActionObserver: Page state change detection (static methods)
 *
 * This bridge converts skill steps to hints and orchestrates execution
 * across the appropriate executors.
 */

import type { TeachableSkill, SkillVariable, ExecutionPlan } from '../types/skill';
import type { SavedWorkflow } from '../types/workflow';
import { Tier1Executor, type Tier1ExecutionResult } from './tier1-executor';
import { PostActionObserver, type PageChanges } from './post-action-observer';
import { HintExtractor } from './agent/hint-extractor';
import type { AgentHint } from './agent/types';
import type { AgentAction } from './ai-agent';
import { VisionAssist } from './tier3-vision-assist';

// ============================================================================
// Types
// ============================================================================

export interface SkillExecutionConfig {
  /** Maximum time to wait for page changes after an action (ms) */
  postActionTimeout?: number;
  /** Whether to use vision fallback when Tier1 fails */
  enableVisionFallback?: boolean;
  /** Callback for progress updates */
  onProgress?: (current: number, total: number, description: string) => void;
  /** Callback for errors */
  onError?: (error: string, step: number) => void;
  /** Callback when a step completes */
  onStepComplete?: (step: number, success: boolean) => void;
}

export interface SkillExecutionResult {
  success: boolean;
  error?: string;
  failedAtStep?: number;
  stepsCompleted: number;
  totalSteps: number;
  durationMs: number;
  details?: {
    tier1Successes: number;
    tier3Successes: number;
    rejections: number;
  };
}

export interface StepResult {
  success: boolean;
  error?: string;
  executor: 'tier1' | 'tier3' | 'none';
  pageChanges?: PageChanges;
}

// ============================================================================
// Skill Execution Bridge
// ============================================================================

export class SkillExecutionBridge {
  private hintExtractor: HintExtractor;
  private config: Required<SkillExecutionConfig>;

  constructor(config: SkillExecutionConfig = {}) {
    this.hintExtractor = new HintExtractor();
    this.config = {
      postActionTimeout: config.postActionTimeout ?? 2000,
      enableVisionFallback: config.enableVisionFallback ?? true,
      onProgress: config.onProgress ?? (() => {}),
      onError: config.onError ?? (() => {}),
      onStepComplete: config.onStepComplete ?? (() => {}),
    };
  }

  /**
   * Execute a teachable skill with the given variables
   */
  async executeSkill(
    skill: TeachableSkill,
    variables: Record<string, string>
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    console.log(`[SkillBridge] Executing skill: ${skill.name}`);
    console.log(`[SkillBridge] Variables:`, variables);

    // Track execution stats
    const stats = {
      tier1Successes: 0,
      tier3Successes: 0,
      rejections: 0,
    };

    // Convert skill to workflow format for HintExtractor
    // Note: We pass variables separately to extractHints, not in the workflow structure
    const pseudoWorkflow: SavedWorkflow = {
      id: skill.id,
      name: skill.name,
      steps: skill.steps,
      createdAt: skill.createdAt,
      updatedAt: skill.createdAt,
      // Variables are passed directly to extractHints, not through workflow.variables
      // This avoids type compatibility issues with WorkflowVariables
    };

    // Extract hints from steps with variable substitution
    const hints = this.hintExtractor.extractHints(pseudoWorkflow, variables);
    console.log(`[SkillBridge] Extracted ${hints.length} hints from ${skill.steps.length} steps`);

    // Execute each hint
    for (let i = 0; i < hints.length; i++) {
      const hint = hints[i];
      this.config.onProgress(i + 1, hints.length, `Step ${i + 1}: ${hint.description || hint.actionType}`);

      try {
        const result = await this.executeHint(hint, i);

        if (!result.success) {
          stats.rejections++;
          console.error(`[SkillBridge] Step ${i + 1} failed:`, result.error);
          this.config.onError(result.error || 'Unknown error', i);

          return {
            success: false,
            error: result.error,
            failedAtStep: i,
            stepsCompleted: i,
            totalSteps: hints.length,
            durationMs: Date.now() - startTime,
            details: stats,
          };
        }

        // Track which executor succeeded
        if (result.executor === 'tier1') {
          stats.tier1Successes++;
        } else if (result.executor === 'tier3') {
          stats.tier3Successes++;
        }

        this.config.onStepComplete(i, true);

        // Wait for page changes to settle
        if (result.pageChanges?.hasSignificantChange) {
          await this.waitForPageStable();
        }
      } catch (error) {
        console.error(`[SkillBridge] Step ${i + 1} threw error:`, error);
        this.config.onError(error instanceof Error ? error.message : String(error), i);

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          failedAtStep: i,
          stepsCompleted: i,
          totalSteps: hints.length,
          durationMs: Date.now() - startTime,
          details: stats,
        };
      }
    }

    console.log(`[SkillBridge] Skill completed successfully in ${Date.now() - startTime}ms`);

    return {
      success: true,
      stepsCompleted: hints.length,
      totalSteps: hints.length,
      durationMs: Date.now() - startTime,
      details: stats,
    };
  }

  /**
   * Execute a single hint using Tier1, falling back to Tier3 if needed
   */
  private async executeHint(
    hint: AgentHint,
    hintIndex: number
  ): Promise<StepResult> {
    console.log(`[SkillBridge] Executing hint ${hintIndex + 1}:`, hint);

    // Capture state before action (may be null if capture fails)
    const stateBefore = PostActionObserver.captureQuickState();

    try {
      // Try Tier1 execution first (fast, deterministic)
      const tier1Result = await this.executeTier1(hint);

      if (tier1Result.status === 'success') {
        // Capture state after action and detect changes
        const stateAfter = PostActionObserver.captureQuickState();
        const pageChanges = stateBefore && stateAfter
          ? PostActionObserver.detectChanges(stateBefore, stateAfter)
          : null;

        return {
          success: true,
          executor: 'tier1',
          pageChanges: pageChanges ?? undefined,
        };
      }

      // Tier1 rejected - try Tier3 vision fallback if enabled
      if (this.config.enableVisionFallback && tier1Result.status === 'rejected') {
        console.log(`[SkillBridge] Tier1 rejected (${tier1Result.code}), trying Tier3`);

        const tier3Result = await this.executeTier3(hint);

        if (tier3Result.success) {
          // Capture state after action and detect changes
          const stateAfter = PostActionObserver.captureQuickState();
          const pageChanges = stateBefore && stateAfter
            ? PostActionObserver.detectChanges(stateBefore, stateAfter)
            : null;

          return {
            success: true,
            executor: 'tier3',
            pageChanges: pageChanges ?? undefined,
          };
        }

        return {
          success: false,
          error: tier3Result.error || `Tier1: ${tier1Result.code}, Tier3: failed`,
          executor: 'none',
        };
      }

      // No fallback or Tier1 failed without rejection
      return {
        success: false,
        error: `Tier1 rejected: ${tier1Result.code}`,
        executor: 'none',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executor: 'none',
      };
    }
  }

  /**
   * Execute a hint using Tier1Executor
   */
  private async executeTier1(hint: AgentHint): Promise<Tier1ExecutionResult> {
    // Build action from hint
    const action = this.hintToAction(hint);

    if (!action) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: { triedStrategies: ['Could not build action from hint'] },
      };
    }

    return Tier1Executor.execute(action);
  }

  /**
   * Execute a hint using Tier3 Vision Assist
   */
  private async executeTier3(
    hint: AgentHint
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Vision assist needs a screenshot and target info
      // For now, we'll get a hint and try to use it for recovery
      const screenshot = hint.referenceScreenshot;

      if (!screenshot) {
        return {
          success: false,
          error: 'No reference screenshot available for vision fallback',
        };
      }

      // Build semantic target from hint
      const target = {
        name: hint.targetText || hint.recordedAriaLabel,
        role: hint.targetRole,
        text: hint.targetText,
      };

      // Get vision hint for refined targeting
      const visionHint = await VisionAssist.getHint(
        screenshot,
        target,
        '' // domMap - we could generate this if needed
      );

      if (visionHint.confidence < 0.5) {
        return {
          success: false,
          error: `Vision confidence too low: ${visionHint.confidence}`,
        };
      }

      // Try to click using the vision-refined coordinates (if available)
      if (visionHint.coordinatesIfNeeded) {
        const result = await VisionAssist.clickWithValidation(
          visionHint.coordinatesIfNeeded.x,
          visionHint.coordinatesIfNeeded.y,
          target
        );

        return {
          success: result.success,
          error: result.error,
        };
      }

      // Try with refined target from vision hint
      if (visionHint.refinedTarget) {
        const refinedAction = this.hintToAction({
          ...hint,
          targetText: visionHint.refinedTarget.name || hint.targetText,
          targetRole: visionHint.refinedTarget.role || hint.targetRole,
        });

        if (refinedAction) {
          const result = await Tier1Executor.execute(refinedAction);
          return {
            success: result.status === 'success',
            error: result.status !== 'success' ? 'Refined target execution failed' : undefined,
          };
        }
      }

      return {
        success: false,
        error: 'Vision assist could not find a valid target',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert a hint to a Tier1 executable action
   */
  private hintToAction(hint: AgentHint): AgentAction | null {
    // Map hint action types to Tier1 action types
    let actionType: AgentAction['type'];

    switch (hint.actionType) {
      case 'click':
        actionType = 'click';
        break;
      case 'type':
        actionType = 'type';
        break;
      case 'select':
        actionType = 'select';
        break;
      case 'scroll':
        actionType = 'scroll';
        break;
      default:
        // Handle special step types
        if (hint.stepType === 'COPY') {
          actionType = 'copy';
        } else if (hint.stepType === 'PASTE') {
          actionType = 'paste';
        } else if (hint.stepType === 'NAVIGATION') {
          actionType = 'click'; // Navigation is handled as click
        } else {
          console.warn(`[SkillBridge] Unknown action type: ${hint.actionType}`);
          return null;
        }
    }

    // Build semantic target
    const target = {
      name: hint.targetText || hint.recordedAriaLabel,
      role: hint.targetRole,
      text: hint.targetText,
      placeholder: hint.targetPlaceholder,
      recordedScopeHint: hint.recordedScopeHint,
      nearbyText: hint.nearbyText,
      recordedSelector: hint.recordedSelector,
      recordedFallbackSelectors: hint.recordedFallbackSelectors,
      recordedTestId: hint.recordedTestId,
    };

    return {
      type: actionType,
      params: {
        target,
        text: hint.value, // For type actions
        fieldTarget: actionType === 'type' ? target : undefined,
        option: actionType === 'select' ? hint.value : undefined,
        direction: hint.scrollDirection,
        amount: hint.scrollAmount,
        scrollContainerSelector: hint.scrollContainer,
        decisionSpace: hint.decisionSpace,
        description: hint.description,
      },
      reasoning: `Executing skill step ${hint.stepNumber}: ${hint.description}`,
      confidence: 1.0,
      hintStepIndex: hint.stepNumber - 1,
    };
  }

  /**
   * Wait for the page to stabilize after an action
   */
  private async waitForPageStable(timeout: number = 1000): Promise<void> {
    return new Promise((resolve) => {
      let lastMutationTime = Date.now();
      let resolved = false;

      const observer = new MutationObserver(() => {
        lastMutationTime = Date.now();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      const checkStable = () => {
        if (resolved) return;

        const timeSinceLastMutation = Date.now() - lastMutationTime;

        if (timeSinceLastMutation >= 200) {
          // No mutations for 200ms - page is stable
          resolved = true;
          observer.disconnect();
          resolve();
        } else if (Date.now() - lastMutationTime > timeout) {
          // Timeout reached
          resolved = true;
          observer.disconnect();
          resolve();
        } else {
          setTimeout(checkStable, 100);
        }
      };

      setTimeout(checkStable, 100);
    });
  }

  /**
   * Execute an entire execution plan (single skill or chain)
   */
  async executePlan(plan: ExecutionPlan): Promise<SkillExecutionResult> {
    console.log(`[SkillBridge] Executing plan:`, plan.type);

    if (plan.type === 'single' && plan.skill) {
      return this.executeSkill(plan.skill, plan.variables);
    }

    if (plan.type === 'chain' && plan.skills) {
      const startTime = Date.now();
      let totalStepsCompleted = 0;
      let totalSteps = 0;

      // Count total steps
      for (const { skill } of plan.skills) {
        totalSteps += skill.steps.length;
      }

      // Execute each skill in the chain
      for (let i = 0; i < plan.skills.length; i++) {
        const { skill, variables } = plan.skills[i];
        const mergedVariables = { ...plan.variables, ...variables };

        console.log(`[SkillBridge] Chain step ${i + 1}/${plan.skills.length}: ${skill.name}`);

        const result = await this.executeSkill(skill, mergedVariables);
        totalStepsCompleted += result.stepsCompleted;

        if (!result.success) {
          return {
            success: false,
            error: `Chain failed at skill "${skill.name}": ${result.error}`,
            failedAtStep: totalStepsCompleted,
            stepsCompleted: totalStepsCompleted,
            totalSteps,
            durationMs: Date.now() - startTime,
          };
        }

        // Handle repetition if specified
        if (plan.repetition && 'count' in plan.repetition) {
          const repeatCount = plan.repetition.count;
          for (let r = 1; r < repeatCount; r++) {
            console.log(`[SkillBridge] Repeat ${r + 1}/${repeatCount} for skill ${skill.name}`);
            const repeatResult = await this.executeSkill(skill, mergedVariables);
            totalStepsCompleted += repeatResult.stepsCompleted;

            if (!repeatResult.success) {
              return {
                success: false,
                error: `Repeat ${r + 1} failed for skill "${skill.name}": ${repeatResult.error}`,
                failedAtStep: totalStepsCompleted,
                stepsCompleted: totalStepsCompleted,
                totalSteps: totalSteps * repeatCount,
                durationMs: Date.now() - startTime,
              };
            }
          }
        }
      }

      return {
        success: true,
        stepsCompleted: totalStepsCompleted,
        totalSteps,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      success: false,
      error: 'Invalid execution plan',
      stepsCompleted: 0,
      totalSteps: 0,
      durationMs: 0,
    };
  }
}

// ============================================================================
// Variable Resolution Utilities
// ============================================================================

/**
 * Resolve variables in a skill's steps
 * Supports selection modes (first, all, matching, count)
 */
export function resolveSkillVariables(
  skill: TeachableSkill,
  values: Record<string, string>
): TeachableSkill {
  const resolvedSteps = skill.steps.map(step => {
    const resolvedStep = { ...step };
    const payload = step.payload as any;

    // Resolve text values in payload
    if (payload?.value) {
      payload.value = substituteVariables(payload.value, values);
    }

    // Resolve target text
    if (payload?.elementText) {
      payload.elementText = substituteVariables(payload.elementText, values);
    }

    return resolvedStep;
  });

  return {
    ...skill,
    steps: resolvedSteps,
  };
}

/**
 * Substitute ${variable} placeholders in text
 */
function substituteVariables(text: string, values: Record<string, string>): string {
  return text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    return values[varName.trim()] ?? match;
  });
}

/**
 * Get selection mode for a variable
 */
export function getSelectionMode(
  variable: SkillVariable
): 'first' | 'all' | 'matching' | 'count' {
  return variable.selectionMode || 'first';
}
