/**
 * Confidence Assessor Module
 *
 * Aggregates confidence from multiple signals to determine whether the agent
 * should proceed, flag a warning, pause for help, or stop.
 *
 * Signal sources:
 * - Step-level: fast-path score, LLM score, candidate match quality
 * - Phase-level: are previous steps in this phase succeeding?
 * - Workflow-level: historical success rate from ExecutionExperience
 * - Page-level: expected URL? expected layout? unexpected elements?
 *
 * Thresholds:
 * - >0.8  → proceed normally
 * - 0.5-0.8 → proceed but flag concern
 * - 0.3-0.5 → pause and ask for help
 * - <0.3 → stop and explain
 */

import type { AgentHint, AgentObservation } from './types';
import type { ExecutionExperience } from '../workflow-memory/types';
import type { MilestoneContext } from './milestone-tracker';

// ============================================================================
// Types
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'critical';

export interface ConfidenceAssessment {
  /** Overall confidence (0-1) */
  overall: number;
  /** Confidence level bucket */
  level: ConfidenceLevel;
  /** Recommended action */
  action: 'proceed' | 'proceed_flagged' | 'pause_ask' | 'stop';
  /** Breakdown of signals that contributed to the score */
  signals: ConfidenceSignal[];
  /** Human-readable summary */
  summary: string;
}

export interface ConfidenceSignal {
  source: 'step' | 'phase' | 'workflow' | 'page';
  score: number;       // 0-1
  weight: number;      // How much this signal matters (0-1)
  reason: string;
}

// ============================================================================
// Confidence Assessor
// ============================================================================

export class ConfidenceAssessor {
  /**
   * Assess overall confidence for executing the current step.
   */
  static assess(params: {
    hint: AgentHint;
    observation: AgentObservation;
    hints: AgentHint[];
    currentStepIndex: number;
    experience?: ExecutionExperience;
    milestoneContext?: MilestoneContext | null;
    candidateCount?: number;
    fastPathConfidence?: number;
  }): ConfidenceAssessment {
    const signals: ConfidenceSignal[] = [];

    // 1. Step-level confidence
    signals.push(this.assessStepConfidence(params));

    // 2. Phase-level confidence
    signals.push(this.assessPhaseConfidence(params));

    // 3. Workflow-level confidence
    signals.push(this.assessWorkflowConfidence(params));

    // 4. Page-level confidence
    signals.push(this.assessPageConfidence(params));

    // Compute weighted average
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const overall = totalWeight > 0
      ? signals.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight
      : 0.5;

    const level = this.scoreToLevel(overall);
    const action = this.levelToAction(level);
    const summary = this.buildSummary(level, signals);

    return { overall, level, action, signals, summary };
  }

  // ── Signal Assessors ────────────────────────────────────────────

  private static assessStepConfidence(params: {
    hint: AgentHint;
    candidateCount?: number;
    fastPathConfidence?: number;
  }): ConfidenceSignal {
    const { hint, candidateCount, fastPathConfidence } = params;
    let score = 0.5; // default neutral

    // If we have fast-path confidence, use it
    if (fastPathConfidence !== undefined) {
      score = fastPathConfidence / 100;
    } else if (candidateCount !== undefined) {
      // More candidates = more options = potentially lower confidence
      if (candidateCount === 0) score = 0.1;
      else if (candidateCount === 1) score = 0.9;
      else if (candidateCount <= 3) score = 0.7;
      else score = 0.5;
    }

    // Boost from learned corrections
    if (hint.learnedCorrections?.length) {
      score = Math.min(1, score + 0.15);
    }

    // Decrease for multiple failures
    if (hint.failureCount && hint.failureCount > 0) {
      score *= Math.max(0.3, 1 - hint.failureCount * 0.2);
    }

    return {
      source: 'step',
      score,
      weight: 0.4,
      reason: fastPathConfidence !== undefined
        ? `Fast-path confidence: ${fastPathConfidence}%`
        : `${candidateCount ?? '?'} candidates found`,
    };
  }

  private static assessPhaseConfidence(params: {
    hints: AgentHint[];
    currentStepIndex: number;
    milestoneContext?: MilestoneContext | null;
  }): ConfidenceSignal {
    const { hints, currentStepIndex, milestoneContext } = params;

    if (!milestoneContext) {
      return { source: 'phase', score: 0.5, weight: 0.15, reason: 'No phase context' };
    }

    // Look at recent step successes in this phase
    const recentSteps = hints.slice(Math.max(0, currentStepIndex - 3), currentStepIndex);
    const recentSuccesses = recentSteps.filter(h => h.completed && !h.skipped).length;
    const recentTotal = recentSteps.length;

    if (recentTotal === 0) {
      return { source: 'phase', score: 0.6, weight: 0.15, reason: 'First step in phase' };
    }

    const recentRate = recentSuccesses / recentTotal;
    return {
      source: 'phase',
      score: recentRate,
      weight: 0.15,
      reason: `${recentSuccesses}/${recentTotal} recent steps succeeded`,
    };
  }

  private static assessWorkflowConfidence(params: {
    experience?: ExecutionExperience;
  }): ConfidenceSignal {
    const { experience } = params;

    if (!experience || experience.timesExecuted === 0) {
      return { source: 'workflow', score: 0.5, weight: 0.2, reason: 'First execution' };
    }

    return {
      source: 'workflow',
      score: experience.successRate,
      weight: 0.2,
      reason: `Historical: ${(experience.successRate * 100).toFixed(0)}% success over ${experience.timesExecuted} runs`,
    };
  }

  private static assessPageConfidence(params: {
    hint: AgentHint;
    observation: AgentObservation;
  }): ConfidenceSignal {
    const { hint, observation } = params;
    let score = 0.7; // default: page looks normal

    // Check for modals that might be unexpected
    if (observation.hasModal) {
      // If hint doesn't mention a modal, this might be unexpected
      const hintMentionsModal = (hint.description || '').toLowerCase().includes('modal') ||
        (hint.description || '').toLowerCase().includes('dialog') ||
        (hint.description || '').toLowerCase().includes('popup');
      if (!hintMentionsModal) {
        score -= 0.2;
      }
    }

    // Very few interactive elements might indicate wrong page/loading
    if (observation.buttonCount + observation.linkCount + observation.inputCount < 3) {
      score -= 0.2;
    }

    // Open dropdown when we're not expecting one
    if (observation.hasOpenDropdown && hint.actionType !== 'select') {
      score -= 0.1;
    }

    return {
      source: 'page',
      score: Math.max(0, Math.min(1, score)),
      weight: 0.25,
      reason: score >= 0.6 ? 'Page state looks normal' : 'Page state may be unexpected',
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private static scoreToLevel(score: number): ConfidenceLevel {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    if (score >= 0.3) return 'low';
    return 'critical';
  }

  private static levelToAction(level: ConfidenceLevel): ConfidenceAssessment['action'] {
    switch (level) {
      case 'high': return 'proceed';
      case 'medium': return 'proceed_flagged';
      case 'low': return 'pause_ask';
      case 'critical': return 'stop';
    }
  }

  private static buildSummary(level: ConfidenceLevel, signals: ConfidenceSignal[]): string {
    const lowest = signals.reduce((min, s) => s.score < min.score ? s : min, signals[0]);
    switch (level) {
      case 'high':
        return 'Confident — proceeding normally';
      case 'medium':
        return `Proceeding with caution — ${lowest.reason}`;
      case 'low':
        return `Low confidence — ${lowest.reason}. Consider asking for help.`;
      case 'critical':
        return `Very low confidence — ${lowest.reason}. Stopping to prevent errors.`;
    }
  }
}
