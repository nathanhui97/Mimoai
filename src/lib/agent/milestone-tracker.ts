/**
 * Milestone Tracker Module
 *
 * Consumes WorkflowMemory.understanding.phases to provide milestone-based
 * goal execution. The agent knows "I'm filling the form" not "I'm on step 5."
 *
 * Responsibilities:
 * - Track currentPhase, completedPhases, nextMilestone
 * - Detect when a phase's purpose is already achieved → skip remaining steps
 * - Provide phase context for the LLM ("Phase 2/3: Fill Contact Details")
 * - Log phase transitions
 */

import type { WorkflowPhase, WorkflowMemory } from '../workflow-memory/types';
import type { AgentHint } from './types';

// ============================================================================
// Types
// ============================================================================

export interface PhaseStatus {
  phase: WorkflowPhase;
  phaseIndex: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  stepsCompleted: number;
  totalSteps: number;
  startedAt?: number;
  completedAt?: number;
}

export interface MilestoneContext {
  /** "Phase 2/3: Fill Contact Details" */
  currentPhaseLabel: string;
  /** Purpose of the current phase */
  phasePurpose: string;
  /** "3/5 fields filled" */
  phaseProgress: string;
  /** "Next milestone: Save Contact" */
  nextMilestone: string;
  /** Overall phase progress */
  completedPhases: number;
  totalPhases: number;
  /** Current phase criticality */
  criticality: WorkflowPhase['criticality'];
}

// ============================================================================
// Milestone Tracker
// ============================================================================

export class MilestoneTracker {
  private phases: PhaseStatus[];
  private currentPhaseIndex: number = 0;

  constructor(memory?: WorkflowMemory) {
    const rawPhases = memory?.understanding?.phases || [];
    this.phases = rawPhases.map((phase, index) => ({
      phase,
      phaseIndex: index,
      status: 'pending' as const,
      stepsCompleted: 0,
      totalSteps: phase.stepIndices.length,
    }));

    if (this.phases.length > 0) {
      this.phases[0].status = 'in_progress';
      this.phases[0].startedAt = Date.now();
    }
  }

  /** Whether this tracker has any phases to track */
  get hasPhases(): boolean {
    return this.phases.length > 0;
  }

  /** Get current phase or null if no phases */
  get currentPhase(): PhaseStatus | null {
    return this.phases[this.currentPhaseIndex] ?? null;
  }

  /** Get all phase statuses */
  get allPhases(): readonly PhaseStatus[] {
    return this.phases;
  }

  /**
   * Called after each step completes. Updates phase tracking and detects
   * phase transitions.
   *
   * @returns Phase transition info if a phase just completed, null otherwise
   */
  onStepCompleted(
    stepIndex: number,
    hints: AgentHint[],
  ): { phaseCompleted: boolean; transitionMessage?: string } | null {
    if (!this.hasPhases) return null;

    const current = this.currentPhase;
    if (!current) return null;

    // Check if this step belongs to the current phase
    if (current.phase.stepIndices.includes(stepIndex)) {
      current.stepsCompleted++;
    }

    // Check if current phase is fully completed
    const allPhaseStepsDone = current.phase.stepIndices.every(idx => {
      const hint = hints[idx];
      return hint?.completed || hint?.skipped;
    });

    if (allPhaseStepsDone) {
      return this.completeCurrentPhase();
    }

    return { phaseCompleted: false };
  }

  /**
   * Check if current phase's purpose is already achieved (skip remaining steps).
   * Call this before executing each step in a phase.
   *
   * @returns Steps that can be skipped (empty if none)
   */
  checkPhasePurposeAchieved(hints: AgentHint[]): number[] {
    if (!this.hasPhases) return [];

    const current = this.currentPhase;
    if (!current || current.phase.criticality === 'critical') return [];

    // Check if there are remaining steps in the current phase
    const remainingSteps = current.phase.stepIndices.filter(idx => {
      const hint = hints[idx];
      return hint && !hint.completed && !hint.skipped;
    });

    if (remainingSteps.length === 0) return [];

    // For now, we don't skip steps — this will be enhanced when
    // we have richer success indicators per phase. The framework
    // is here for Phase 3 (Adaptive Steps) to plug into.
    return [];
  }

  /**
   * Get the LLM-friendly milestone context for the current execution state.
   * This is added to dom_agent requests so the LLM knows where we are.
   */
  getMilestoneContext(): MilestoneContext | null {
    if (!this.hasPhases) return null;

    const current = this.currentPhase;
    if (!current) return null;

    const completedPhases = this.phases.filter(p => p.status === 'completed').length;
    const totalPhases = this.phases.length;
    const nextPhase = this.phases[this.currentPhaseIndex + 1];

    return {
      currentPhaseLabel: `Phase ${this.currentPhaseIndex + 1}/${totalPhases}: ${current.phase.name}`,
      phasePurpose: current.phase.purpose,
      phaseProgress: `${current.stepsCompleted}/${current.totalSteps} steps completed`,
      nextMilestone: nextPhase
        ? `Next: ${nextPhase.phase.name}`
        : 'Final phase — complete the workflow',
      completedPhases,
      totalPhases,
      criticality: current.phase.criticality,
    };
  }

  /**
   * Get which phase a given step belongs to.
   */
  getPhaseForStep(stepIndex: number): PhaseStatus | null {
    return this.phases.find(p => p.phase.stepIndices.includes(stepIndex)) ?? null;
  }

  /**
   * Called when execution enters a new step — detect if we've moved to a new phase.
   */
  onStepStarting(stepIndex: number): void {
    if (!this.hasPhases) return;

    const phaseForStep = this.getPhaseForStep(stepIndex);
    if (!phaseForStep) return;

    // If this step belongs to a different (later) phase, advance
    if (phaseForStep.phaseIndex > this.currentPhaseIndex) {
      // Complete any in-between phases that were implicitly skipped
      for (let i = this.currentPhaseIndex; i < phaseForStep.phaseIndex; i++) {
        if (this.phases[i].status === 'in_progress') {
          this.phases[i].status = 'completed';
          this.phases[i].completedAt = Date.now();
          console.log(`[MilestoneTracker] Phase ${i + 1} implicitly completed (${this.phases[i].phase.name})`);
        }
      }

      this.currentPhaseIndex = phaseForStep.phaseIndex;
      phaseForStep.status = 'in_progress';
      phaseForStep.startedAt = Date.now();
      console.log(
        `[MilestoneTracker] 📍 Entered Phase ${phaseForStep.phaseIndex + 1}/${this.phases.length}: ` +
        `${phaseForStep.phase.name} (${phaseForStep.phase.purpose})`
      );
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  private completeCurrentPhase(): { phaseCompleted: boolean; transitionMessage: string } {
    const current = this.currentPhase!;
    current.status = 'completed';
    current.completedAt = Date.now();

    const duration = current.startedAt
      ? ((current.completedAt - current.startedAt) / 1000).toFixed(1)
      : '?';

    const message =
      `Phase ${this.currentPhaseIndex + 1}/${this.phases.length} complete: ` +
      `${current.phase.name} (${duration}s)`;

    console.log(`[MilestoneTracker] ✅ ${message}`);

    // Advance to next phase
    const nextIndex = this.currentPhaseIndex + 1;
    if (nextIndex < this.phases.length) {
      this.currentPhaseIndex = nextIndex;
      this.phases[nextIndex].status = 'in_progress';
      this.phases[nextIndex].startedAt = Date.now();
      console.log(
        `[MilestoneTracker] 📍 Starting Phase ${nextIndex + 1}/${this.phases.length}: ` +
        `${this.phases[nextIndex].phase.name}`
      );
    }

    return { phaseCompleted: true, transitionMessage: message };
  }
}
