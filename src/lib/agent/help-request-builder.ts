/**
 * Help Request Builder Module
 *
 * Generates context-rich help requests when the agent needs human assistance.
 * Replaces the crude `generateHelpGuidance()` with detailed, actionable messages
 * that include:
 * - Milestone position (where we are in the workflow)
 * - What was tried and why it failed
 * - Confidence breakdown
 * - Specific, actionable instruction for the human
 */

import type { AgentHint } from './types';
import type { ConfidenceAssessment } from './confidence-assessor';
import type { MilestoneContext } from './milestone-tracker';

// ============================================================================
// Types
// ============================================================================

export interface HelpRequest {
  /** Short title for the help request */
  title: string;
  /** Detailed description of what's happening */
  description: string;
  /** What the user should do */
  userAction: string;
  /** Confidence details (optional, for advanced users) */
  confidenceDetails?: string;
  /** Position in workflow */
  milestonePosition?: string;
}

// ============================================================================
// Help Request Builder
// ============================================================================

export class HelpRequestBuilder {
  /**
   * Build a context-rich help request.
   */
  static build(params: {
    hint: AgentHint;
    stepIndex: number;
    totalSteps: number;
    assessment?: ConfidenceAssessment;
    milestoneContext?: MilestoneContext | null;
    whatWasTried?: string[];
    lastError?: string;
  }): HelpRequest {
    const { hint, stepIndex, totalSteps, assessment, milestoneContext, whatWasTried, lastError } = params;

    const title = this.buildTitle(hint, assessment);
    const description = this.buildDescription(hint, whatWasTried, lastError);
    const userAction = this.buildUserAction(hint);
    const confidenceDetails = assessment ? this.buildConfidenceDetails(assessment) : undefined;
    const milestonePosition = milestoneContext
      ? `${milestoneContext.currentPhaseLabel} | ${milestoneContext.phaseProgress} | Step ${stepIndex + 1}/${totalSteps}`
      : `Step ${stepIndex + 1}/${totalSteps}`;

    return { title, description, userAction, confidenceDetails, milestonePosition };
  }

  // ── Private builders ────────────────────────────────────────────

  private static buildTitle(hint: AgentHint, assessment?: ConfidenceAssessment): string {
    if (assessment?.level === 'critical') {
      return `Cannot proceed — step "${hint.description?.slice(0, 50)}" needs help`;
    }
    if (assessment?.level === 'low') {
      return `Unsure about step: "${hint.description?.slice(0, 50)}"`;
    }
    return `Help needed: ${hint.description?.slice(0, 60) || 'Unknown step'}`;
  }

  private static buildDescription(
    hint: AgentHint,
    whatWasTried?: string[],
    lastError?: string,
  ): string {
    const parts: string[] = [];

    // What we're trying to do
    parts.push(`I'm trying to ${this.describeAction(hint)}.`);

    // What was tried
    if (whatWasTried?.length) {
      parts.push(`I tried: ${whatWasTried.join(', ')}.`);
    }

    // Error details
    if (lastError) {
      parts.push(`Last error: ${lastError}`);
    }

    // AI context if available
    if (hint.aiAnalysisContext) {
      parts.push(`Intent: ${hint.aiAnalysisContext.intent}`);
      if (hint.aiAnalysisContext.alternatives?.length) {
        parts.push(`Possible alternatives: ${hint.aiAnalysisContext.alternatives.join(', ')}`);
      }
    }

    return parts.join('\n');
  }

  private static buildUserAction(hint: AgentHint): string {
    const target = hint.targetText || hint.targetPlaceholder || hint.targetRole || 'the element';

    switch (hint.actionType) {
      case 'click':
        return `Please click on "${target}" manually, then click Continue.`;
      case 'type': {
        const value = hint.value || '[the required value]';
        return `Please type "${value}" into "${target}" manually, then click Continue.`;
      }
      case 'select':
        return `Please select the correct option from "${target}" dropdown, then click Continue.`;
      case 'scroll':
        return `Please scroll to make the target element visible, then click Continue.`;
      case 'navigate':
        return `Please navigate to the correct page manually, then click Continue.`;
      default:
        return `Please complete this step manually ("${hint.description?.slice(0, 80)}"), then click Continue.`;
    }
  }

  private static buildConfidenceDetails(assessment: ConfidenceAssessment): string {
    const lines = [`Overall confidence: ${(assessment.overall * 100).toFixed(0)}% (${assessment.level})`];
    for (const signal of assessment.signals) {
      lines.push(`  ${signal.source}: ${(signal.score * 100).toFixed(0)}% — ${signal.reason}`);
    }
    return lines.join('\n');
  }

  private static describeAction(hint: AgentHint): string {
    const target = hint.targetText || hint.targetPlaceholder || hint.targetRole || 'an element';
    switch (hint.actionType) {
      case 'click': return `click "${target}"`;
      case 'type': return `type "${hint.value || '...'}" into "${target}"`;
      case 'select': return `select an option from "${target}"`;
      case 'scroll': return `scroll to find "${target}"`;
      case 'navigate': return `navigate to the next page`;
      default: return `perform "${hint.description?.slice(0, 60) || 'an action'}"`;
    }
  }
}
