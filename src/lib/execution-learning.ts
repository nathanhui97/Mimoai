import type { ExecutionExperience, TroubleSpot, ProvenStrategy, StepReliabilityRecord } from './workflow-memory/types';
import type { ExecutionEvent } from './execution-telemetry';
import { WorkflowStorage } from './storage';

const DEFAULT_EXPERIENCE: ExecutionExperience = {
  timesExecuted: 0,
  successfulExecutions: 0,
  successRate: 0,
  troubleSpots: [],
  provenStrategies: [],
};

/** Per-step resolution details collected during execution */
export interface StepResolutionDetail {
  stepIndex: number;
  success: boolean;
  /** How the element was found */
  foundBy: 'selector' | 'role+name' | 'text' | 'vision' | 'recovery' | 'fast-path' | 'llm';
  /** Selector that actually worked (if any) */
  workingSelector?: string;
  /** Time to resolve this step (ms) */
  resolutionMs: number;
  /** Number of recovery attempts before success */
  recoveryAttempts: number;
  /** Whether fast-path was used successfully */
  fastPathUsed: boolean;
  /** Strategy that resolved the step (if recovery was needed) */
  resolutionStrategy?: string;
}

export class ExecutionLearning {
  /**
   * Single entry point called after every execution completes.
   * Updates success rate, duration, trouble spots, and proven strategies
   * in WorkflowMemory.experience — the one source of truth.
   */
  static async recordExecutionComplete(
    workflowId: string,
    event: ExecutionEvent,
    stepDetails?: StepResolutionDetail[]
  ): Promise<void> {
    try {
      const experience = await this.loadExperience(workflowId);

      // 1. Update execution counts and success rate
      const timesExecuted = experience.timesExecuted + 1;
      const successfulExecutions = experience.successfulExecutions + (event.success ? 1 : 0);
      const successRate = successfulExecutions / timesExecuted;

      // 2. Update average duration (rolling average)
      const averageDuration = experience.averageDuration
        ? Math.round((experience.averageDuration * (timesExecuted - 1) + event.durationMs) / timesExecuted)
        : event.durationMs;

      // 3. Update trouble spots from failed steps
      let troubleSpots = [...experience.troubleSpots];
      for (const step of event.stepResults) {
        if (!step.success) {
          troubleSpots = this.upsertTroubleSpot(troubleSpots, {
            stepIndex: step.index,
            issue: `Step ${step.index} failed during execution`,
            solution: 'Use recovery strategies or verify selectors',
            frequency: 0,
          });
        }
      }

      // Decay trouble spot frequency for steps that succeeded this time
      troubleSpots = troubleSpots.map(spot => {
        const stepResult = event.stepResults.find(s => s.index === spot.stepIndex);
        if (stepResult?.success) {
          // Step succeeded — decay frequency toward 0
          return { ...spot, frequency: Math.max(0, spot.frequency - 0.15) };
        }
        return spot;
      });

      // Remove stale trouble spots (frequency near zero after multiple successes)
      troubleSpots = troubleSpots.filter(spot => spot.frequency > 0.05);

      // 4. Build proven strategies from step details
      let provenStrategies = [...experience.provenStrategies];
      if (stepDetails) {
        for (const detail of stepDetails) {
          if (detail.success && detail.recoveryAttempts > 0 && detail.resolutionStrategy) {
            provenStrategies = this.upsertProvenStrategy(provenStrategies, {
              situation: `Step ${detail.stepIndex} needed recovery (found by ${detail.foundBy})`,
              strategy: detail.resolutionStrategy,
              effectiveness: 0.7,
            });
          }

          // If fast-path consistently works, record it as a strategy
          if (detail.success && detail.fastPathUsed) {
            provenStrategies = this.upsertProvenStrategy(provenStrategies, {
              situation: `Step ${detail.stepIndex} element resolution`,
              strategy: `fast-path:${detail.foundBy}${detail.workingSelector ? `:${detail.workingSelector}` : ''}`,
              effectiveness: 0.9,
            });
          }
        }
      }

      // Cap strategy list to prevent unbounded growth
      if (provenStrategies.length > 50) {
        provenStrategies = provenStrategies
          .sort((a, b) => b.effectiveness - a.effectiveness)
          .slice(0, 50);
      }

      // 5. Update per-step reliability records
      let stepReliability = [...(experience.stepReliability || [])];
      if (stepDetails) {
        stepReliability = this.updateStepReliability(stepReliability, stepDetails);
      }

      // 6. Persist everything in one write
      await WorkflowStorage.updateWorkflowExperience(workflowId, {
        timesExecuted,
        successfulExecutions,
        successRate,
        lastExecuted: Date.now(),
        averageDuration,
        troubleSpots,
        provenStrategies,
        stepReliability,
      });

      console.log(
        `[ExecutionLearning] ✅ Recorded execution #${timesExecuted} for ${workflowId}` +
        ` (success=${event.success}, rate=${(successRate * 100).toFixed(0)}%,` +
        ` ${troubleSpots.length} trouble spots, ${provenStrategies.length} strategies)`
      );
    } catch (error) {
      console.warn('[ExecutionLearning] Failed to record execution:', error);
    }
  }

  /**
   * Get proven strategies for a specific step.
   * Used by applyProactiveStrategies to know what worked before.
   */
  static async getStepStrategies(
    workflowId: string,
    stepIndex: number
  ): Promise<ProvenStrategy[]> {
    const experience = await this.loadExperience(workflowId);
    return experience.provenStrategies.filter(
      s => s.situation.includes(`Step ${stepIndex}`) && s.effectiveness > 0.5
    );
  }

  static async recordRecoverySuccess(
    workflowId: string,
    stepIndex: number,
    issue: string,
    solution: string
  ): Promise<void> {
    const experience = await this.loadExperience(workflowId);
    const updatedTroubleSpots = this.upsertTroubleSpot(experience.troubleSpots, {
      stepIndex,
      issue,
      solution,
      frequency: 0.5,
    });
    const updatedStrategies = this.upsertProvenStrategy(experience.provenStrategies, {
      situation: issue,
      strategy: solution,
      effectiveness: 0.7,
    });

    await WorkflowStorage.updateWorkflowExperience(workflowId, {
      troubleSpots: updatedTroubleSpots,
      provenStrategies: updatedStrategies,
    });
  }

  static async recordStepFailure(
    workflowId: string,
    stepIndex: number,
    error: string
  ): Promise<void> {
    const experience = await this.loadExperience(workflowId);
    const updatedTroubleSpots = this.upsertTroubleSpot(experience.troubleSpots, {
      stepIndex,
      issue: error,
      solution: 'Use recovery strategies or verify selectors',
      frequency: 0.4,
    });

    await WorkflowStorage.updateWorkflowExperience(workflowId, {
      troubleSpots: updatedTroubleSpots,
    });
  }

  /**
   * Get step reliability data for a specific step.
   * Used by fast-path router to decide whether to attempt fast-path or skip to LLM.
   */
  static getStepReliability(
    experience: ExecutionExperience | undefined,
    stepIndex: number,
  ): StepReliabilityRecord | null {
    if (!experience?.stepReliability) return null;
    return experience.stepReliability.find(r => r.stepIndex === stepIndex) ?? null;
  }

  /**
   * Enrich hints with learned corrections from past executions.
   * Called during hint extraction to merge experience data into hints.
   * After 3+ runs, steps that consistently needed recovery get their
   * corrections baked in so they're found faster.
   */
  static enrichHintsWithLearnings(
    hints: Array<{ learnedCorrections?: Array<{ strategy: string; actualElement: { foundBy: string; selector?: string; role?: string; name?: string } }> }>,
    experience: ExecutionExperience | undefined,
  ): void {
    if (!experience || experience.timesExecuted < 2) return;

    const reliability = experience.stepReliability || [];
    const strategies = experience.provenStrategies || [];

    for (const record of reliability) {
      const hint = hints[record.stepIndex];
      if (!hint) continue;

      // Only enrich if we have 3+ data points and step needed recovery
      if (record.attempts < 3) continue;

      const corrections: Array<{ strategy: string; actualElement: { foundBy: string; selector?: string; role?: string; name?: string } }> = [];

      // If fast-path consistently works and we have a reliable selector, record it
      if (record.fastPathSuccesses / record.attempts > 0.7 && record.reliableSelector) {
        corrections.push({
          strategy: `fast-path with ${record.bestMethod}`,
          actualElement: {
            foundBy: 'selector',
            selector: record.reliableSelector,
          },
        });
      }

      // Check proven strategies for this step
      const stepStrategies = strategies.filter(
        s => s.situation.includes(`Step ${record.stepIndex}`) && s.effectiveness > 0.6
      );
      for (const strat of stepStrategies) {
        // Parse fast-path strategy: "fast-path:selector:/path/to/element"
        const fastPathMatch = strat.strategy.match(/^fast-path:(\w+):?(.*)$/);
        if (fastPathMatch) {
          corrections.push({
            strategy: strat.strategy,
            actualElement: {
              foundBy: fastPathMatch[1],
              selector: fastPathMatch[2] || undefined,
            },
          });
        }
      }

      if (corrections.length > 0) {
        hint.learnedCorrections = corrections;
      }
    }
  }

  /**
   * Determine optimal resolution strategy for a step based on historical data.
   * Returns: 'fast-path' (try fast-path first), 'llm' (skip to LLM), or 'default' (normal flow).
   */
  static getOptimalStrategy(
    experience: ExecutionExperience | undefined,
    stepIndex: number,
  ): 'fast-path' | 'llm' | 'default' {
    const record = this.getStepReliability(experience, stepIndex);
    if (!record || record.attempts < 3) return 'default';

    const fastPathRate = record.fastPathSuccesses / record.attempts;
    const llmRate = record.llmNeeded / record.attempts;

    // 80%+ fast-path success → definitely use fast-path (higher confidence)
    if (fastPathRate > 0.8) return 'fast-path';

    // 70%+ LLM needed → skip fast-path to save time
    if (llmRate > 0.7) return 'llm';

    return 'default';
  }

  // ── Step Reliability ─────────────────────────────────────────────

  private static updateStepReliability(
    records: StepReliabilityRecord[],
    stepDetails: StepResolutionDetail[],
  ): StepReliabilityRecord[] {
    const updated = [...records];

    for (const detail of stepDetails) {
      let existingIndex = updated.findIndex(r => r.stepIndex === detail.stepIndex);

      if (existingIndex === -1) {
        // New step — create record
        updated.push({
          stepIndex: detail.stepIndex,
          attempts: 0,
          fastPathSuccesses: 0,
          llmNeeded: 0,
          recoveryNeeded: 0,
          bestMethod: 'fast-path',
        });
        existingIndex = updated.length - 1;
      }

      const record = { ...updated[existingIndex] };
      record.attempts++;

      if (detail.fastPathUsed && detail.success) {
        record.fastPathSuccesses++;
      }
      if (detail.foundBy === 'llm') {
        record.llmNeeded++;
      }
      if (detail.foundBy === 'recovery' || detail.recoveryAttempts > 0) {
        record.recoveryNeeded++;
      }

      // Track reliable selector
      if (detail.success && detail.workingSelector) {
        record.reliableSelector = detail.workingSelector;
      }

      // Determine best method
      const rates = {
        'fast-path': record.fastPathSuccesses / record.attempts,
        'llm': record.llmNeeded / record.attempts,
        'recovery': record.recoveryNeeded / record.attempts,
        'vision': 0,
      };
      record.bestMethod = (Object.entries(rates).sort((a, b) => b[1] - a[1])[0][0]) as StepReliabilityRecord['bestMethod'];

      updated[existingIndex] = record;
    }

    return updated;
  }

  private static async loadExperience(workflowId: string): Promise<ExecutionExperience> {
    const workflow = await WorkflowStorage.loadWorkflow(workflowId);
    return workflow?.memory?.experience
      ? { ...DEFAULT_EXPERIENCE, ...workflow.memory.experience }
      : { ...DEFAULT_EXPERIENCE };
  }

  private static upsertTroubleSpot(
    spots: TroubleSpot[],
    update: TroubleSpot
  ): TroubleSpot[] {
    const existingIndex = spots.findIndex(
      spot => spot.stepIndex === update.stepIndex && spot.issue === update.issue
    );
    if (existingIndex === -1) {
      return [...spots, update];
    }

    const existing = spots[existingIndex];
    const next: TroubleSpot = {
      ...existing,
      solution: update.solution || existing.solution,
      frequency: Math.min(1, existing.frequency + 0.1),
    };

    return spots.map((spot, index) => index === existingIndex ? next : spot);
  }

  private static upsertProvenStrategy(
    strategies: ProvenStrategy[],
    update: ProvenStrategy
  ): ProvenStrategy[] {
    const existingIndex = strategies.findIndex(
      strategy => strategy.situation === update.situation && strategy.strategy === update.strategy
    );
    if (existingIndex === -1) {
      return [...strategies, update];
    }

    const existing = strategies[existingIndex];
    const next: ProvenStrategy = {
      ...existing,
      effectiveness: Math.min(1, existing.effectiveness + 0.1),
    };

    return strategies.map((strategy, index) => index === existingIndex ? next : strategy);
  }
}
