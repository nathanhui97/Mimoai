/**
 * Step Analyzer Module
 *
 * Builds a step dependency graph from hints and workflow memory.
 * Provides intelligent step progression:
 * - canSkipStep(): outcome already achieved or step is optional
 * - getNextExecutableStep(): skip to next runnable step (respects dependencies)
 * - isStepBlocked(): dependency not met
 *
 * Replaces simple `currentHintIndex++` with flexible step progression.
 */

import type { AgentHint, AgentObservation } from './types';
import type { WorkflowMemory, OptionalStep } from '../workflow-memory/types';

// ============================================================================
// Types
// ============================================================================

export interface StepDependency {
  stepIndex: number;
  dependsOn: number[];       // Steps that must complete first
  isOptional: boolean;
  skipCondition?: string;    // From adaptability.optionalSteps
  criticality: 'critical' | 'important' | 'optional';
}

export interface StepSkipResult {
  canSkip: boolean;
  reason?: string;
}

export interface NextStepResult {
  stepIndex: number | null;   // null = no more executable steps
  skippedSteps: number[];     // Steps that were skipped to get here
  skipReasons: Map<number, string>;
}

// ============================================================================
// Step Analyzer
// ============================================================================

export class StepAnalyzer {
  private dependencies: StepDependency[];
  private optionalStepMap: Map<number, OptionalStep>;
  private totalSteps: number;

  constructor(hints: AgentHint[], memory?: WorkflowMemory) {
    this.totalSteps = hints.length;
    this.optionalStepMap = new Map();

    // Index optional steps from memory
    const optionalSteps = memory?.adaptability?.optionalSteps || [];
    for (const opt of optionalSteps) {
      this.optionalStepMap.set(opt.stepIndex, opt);
    }

    // Build dependency graph
    this.dependencies = hints.map((hint, index) => {
      // Extract dependencies from naturalLanguage.dependencies if available
      const declaredDeps = hint.naturalLanguage?.dependencies || [];

      // Filter out self-references and out-of-range dependencies
      const validDeps = declaredDeps.filter(
        d => d !== index && d >= 0 && d < hints.length
      );

      const isOptional = this.optionalStepMap.has(index);
      const criticality = hint.aiAnalysisContext?.criticality || (isOptional ? 'optional' : 'important');

      return {
        stepIndex: index,
        dependsOn: validDeps,
        isOptional,
        skipCondition: this.optionalStepMap.get(index)?.skipCondition,
        criticality,
      };
    });
  }

  /**
   * Check if a step can be skipped (outcome already achieved or optional).
   * Does NOT check pre-flight (field already filled) — that's PreFlightChecker's job.
   */
  canSkipStep(
    stepIndex: number,
    hints: AgentHint[],
  ): StepSkipResult {
    if (stepIndex < 0 || stepIndex >= this.totalSteps) {
      return { canSkip: false };
    }

    const hint = hints[stepIndex];
    if (!hint) return { canSkip: false };

    // Already completed or skipped
    if (hint.completed) {
      return { canSkip: true, reason: 'Already completed' };
    }
    if (hint.skipped) {
      return { canSkip: true, reason: 'Previously skipped (failed 3+ times)' };
    }

    return { canSkip: false };
  }

  /**
   * Check if a step is blocked by unmet dependencies.
   */
  isStepBlocked(stepIndex: number, hints: AgentHint[]): { blocked: boolean; blockedBy: number[] } {
    const dep = this.dependencies[stepIndex];
    if (!dep) return { blocked: false, blockedBy: [] };

    const blockedBy = dep.dependsOn.filter(depIdx => {
      const depHint = hints[depIdx];
      return depHint && !depHint.completed && !depHint.skipped;
    });

    return { blocked: blockedBy.length > 0, blockedBy };
  }

  /**
   * Get the next executable step starting from `fromIndex`.
   * Skips completed, skipped, and blocked steps.
   * Respects optional step conditions when available.
   */
  getNextExecutableStep(
    fromIndex: number,
    hints: AgentHint[],
  ): NextStepResult {
    const skippedSteps: number[] = [];
    const skipReasons = new Map<string | number, string>();

    for (let i = fromIndex; i < this.totalSteps; i++) {
      const hint = hints[i];
      if (!hint) continue;

      // Already done
      if (hint.completed || hint.skipped) {
        skippedSteps.push(i);
        skipReasons.set(i, hint.completed ? 'completed' : 'skipped');
        continue;
      }

      // Check dependencies
      const { blocked, blockedBy } = this.isStepBlocked(i, hints);
      if (blocked) {
        // If this step is optional and blocked, skip it
        const dep = this.dependencies[i];
        if (dep?.isOptional) {
          skippedSteps.push(i);
          skipReasons.set(i, `Optional step blocked by steps ${blockedBy.join(', ')}`);
          continue;
        }
        // Critical/important step is blocked — but dependencies might be ahead
        // (shouldn't happen in well-ordered workflows, but handle gracefully)
        // Continue scanning for non-blocked steps
        skippedSteps.push(i);
        skipReasons.set(i, `Blocked by steps ${blockedBy.join(', ')}`);
        continue;
      }

      // This step is executable
      return {
        stepIndex: i,
        skippedSteps,
        skipReasons: skipReasons as Map<number, string>,
      };
    }

    // No more executable steps
    return {
      stepIndex: null,
      skippedSteps,
      skipReasons: skipReasons as Map<number, string>,
    };
  }

  /**
   * Check whether a failed step should block subsequent steps or allow continuation.
   * Critical steps block everything; optional/important steps only block dependents.
   */
  canContinueAfterFailure(
    failedStepIndex: number,
    hints: AgentHint[],
  ): { canContinue: boolean; reason: string; nextStep: number | null } {
    const dep = this.dependencies[failedStepIndex];
    if (!dep) {
      return { canContinue: true, reason: 'Unknown step', nextStep: failedStepIndex + 1 };
    }

    // Optional steps never block continuation
    if (dep.isOptional) {
      const next = this.getNextExecutableStep(failedStepIndex + 1, hints);
      return {
        canContinue: true,
        reason: `Optional step ${failedStepIndex} failed — continuing`,
        nextStep: next.stepIndex,
      };
    }

    // For non-optional steps: check if any remaining steps depend on this one
    const dependentSteps = this.getDependentSteps(failedStepIndex);
    const hasUnblockedRemaining = this.hasExecutableStepsAfter(
      failedStepIndex,
      hints,
      new Set([failedStepIndex, ...dependentSteps]),
    );

    if (hasUnblockedRemaining) {
      const next = this.getNextExecutableStep(failedStepIndex + 1, hints);
      return {
        canContinue: true,
        reason: `Step ${failedStepIndex} failed but independent steps remain`,
        nextStep: next.stepIndex,
      };
    }

    return {
      canContinue: false,
      reason: `Step ${failedStepIndex} failed and all remaining steps depend on it`,
      nextStep: null,
    };
  }

  /**
   * Get the dependency info for a specific step.
   */
  getStepDependency(stepIndex: number): StepDependency | null {
    return this.dependencies[stepIndex] ?? null;
  }

  // ── Private ──────────────────────────────────────────────────────

  /** Get all steps that depend on a given step (direct and transitive). */
  private getDependentSteps(stepIndex: number): number[] {
    const dependents: Set<number> = new Set();
    const queue = [stepIndex];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of this.dependencies) {
        if (dep.dependsOn.includes(current) && !dependents.has(dep.stepIndex)) {
          dependents.add(dep.stepIndex);
          queue.push(dep.stepIndex);
        }
      }
    }

    return [...dependents];
  }

  /** Check if there are executable steps after a given index, excluding blocked ones. */
  private hasExecutableStepsAfter(
    afterIndex: number,
    hints: AgentHint[],
    excludeSteps: Set<number>,
  ): boolean {
    for (let i = afterIndex + 1; i < this.totalSteps; i++) {
      if (excludeSteps.has(i)) continue;
      const hint = hints[i];
      if (!hint || hint.completed || hint.skipped) continue;
      const { blocked } = this.isStepBlocked(i, hints);
      if (!blocked) return true;
    }
    return false;
  }
}
