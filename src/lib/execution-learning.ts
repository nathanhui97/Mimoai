import type { ExecutionExperience, TroubleSpot, ProvenStrategy } from './workflow-memory/types';
import { WorkflowStorage } from './storage';

const DEFAULT_EXPERIENCE: ExecutionExperience = {
  timesExecuted: 0,
  successfulExecutions: 0,
  successRate: 0,
  troubleSpots: [],
  provenStrategies: [],
};

export class ExecutionLearning {
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

  static async updateSuccessRate(
    workflowId: string,
    success: boolean
  ): Promise<void> {
    const experience = await this.loadExperience(workflowId);
    const timesExecuted = experience.timesExecuted + 1;
    const successfulExecutions = experience.successfulExecutions + (success ? 1 : 0);
    const successRate = timesExecuted > 0
      ? successfulExecutions / timesExecuted
      : experience.successRate;

    await WorkflowStorage.updateWorkflowExperience(workflowId, {
      timesExecuted,
      successfulExecutions,
      successRate,
      lastExecuted: Date.now(),
    });
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
