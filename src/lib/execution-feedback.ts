/**
 * Execution Feedback System (Phase 4)
 *
 * Captures feedback from workflow executions to improve future runs.
 * Tracks what predictions were useful, what recovery strategies worked,
 * and what corrections were needed.
 */

import type { AgentHint, AgentAction } from './agent/types';

// ============================================================================
// Feedback Types
// ============================================================================

/**
 * Feedback for a single step execution
 */
export interface StepFeedback {
  stepIndex: number;

  // What we predicted
  predictedElement: {
    lookingFor: string;
    distinguishers: string[];
    textPatterns: string[];
  };

  // What actually worked
  actualElement: {
    foundBy: 'selector' | 'role+name' | 'text' | 'vision' | 'recovery';
    selector?: string;
    role?: string;
    name?: string;
    text?: string;
  };

  // Did our prediction help?
  predictionUseful: boolean;

  // Recovery info
  recoveryNeeded: boolean;
  recoveryStrategy?: string;
  recoverySuccess?: boolean;
  recoveryAttempts?: number;

  // Timing
  executionTimeMs: number;
  verificationResult?: {
    verified: boolean;
    confidence: number;
    details?: string;
  };
}

/**
 * Complete execution feedback for a workflow run
 */
export interface ExecutionFeedback {
  workflowId: string;
  workflowName: string;
  executedAt: number;
  executionDurationMs: number;

  // Step-by-step feedback
  stepFeedback: StepFeedback[];

  // Overall result
  success: boolean;
  failedAtStep?: number;
  failureReason?: string;

  // User intervention
  userCorrected: boolean;
  userCorrectionDetails?: string;

  // Environment context
  pageUrl: string;
  pageTitle: string;

  // Variables used (for pattern analysis)
  variableValues?: Record<string, string>;
}

/**
 * Learned correction from feedback analysis
 */
export interface LearnedCorrection {
  strategy: string;
  actualElement: {
    foundBy: 'selector' | 'role+name' | 'text' | 'vision' | 'recovery';
    selector?: string;
    role?: string;
    name?: string;
  };
  successCount: number;
  totalAttempts: number;
  lastUsed: number;
}

/**
 * Corrections aggregated per step
 */
export interface StepCorrections {
  [stepIndex: number]: LearnedCorrection[];
}

// ============================================================================
// Feedback Builder
// ============================================================================

/**
 * Build step feedback from execution data
 */
export function buildStepFeedback(
  stepIndex: number,
  hint: AgentHint,
  action: AgentAction,
  _result: { success: boolean; error?: string },
  executionTimeMs: number,
  recoveryInfo?: {
    needed: boolean;
    strategy?: string;
    success?: boolean;
    attempts?: number;
  },
  verificationResult?: {
    verified: boolean;
    confidence: number;
    details?: string;
  }
): StepFeedback {
  // Determine how the element was found
  let foundBy: StepFeedback['actualElement']['foundBy'] = 'selector';
  if (recoveryInfo?.needed && recoveryInfo?.success) {
    foundBy = 'recovery';
  } else if ((action.params as any)?.foundVia) {
    foundBy = (action.params as any).foundVia;
  } else if (action.type === 'click' && action.params?.target?.role) {
    foundBy = 'role+name';
  } else if (action.type === 'click' && action.params?.target?.text) {
    foundBy = 'text';
  }

  return {
    stepIndex,

    predictedElement: {
      lookingFor: (hint as any).aiAnalysisContext?.elementFindingStrategy?.lookingFor || hint.description,
      distinguishers: (hint as any).aiAnalysisContext?.elementFindingStrategy?.distinguishers || [],
      textPatterns: (hint as any).aiAnalysisContext?.elementFindingStrategy?.textPatterns || [],
    },

    actualElement: {
      foundBy,
      selector: (action.params?.target as any)?.selector || hint.targetSelector,
      role: action.params?.target?.role || hint.targetRole,
      name: action.params?.target?.name,
      text: action.params?.target?.text || hint.targetText,
    },

    predictionUseful: !recoveryInfo?.needed || recoveryInfo?.success === true,

    recoveryNeeded: recoveryInfo?.needed || false,
    recoveryStrategy: recoveryInfo?.strategy,
    recoverySuccess: recoveryInfo?.success,
    recoveryAttempts: recoveryInfo?.attempts,

    executionTimeMs,
    verificationResult,
  };
}

/**
 * Build complete execution feedback
 */
export function buildExecutionFeedback(
  workflowId: string,
  workflowName: string,
  stepFeedback: StepFeedback[],
  success: boolean,
  executionDurationMs: number,
  options?: {
    failedAtStep?: number;
    failureReason?: string;
    userCorrected?: boolean;
    userCorrectionDetails?: string;
    variableValues?: Record<string, string>;
  }
): ExecutionFeedback {
  return {
    workflowId,
    workflowName,
    executedAt: Date.now(),
    executionDurationMs,

    stepFeedback,

    success,
    failedAtStep: options?.failedAtStep,
    failureReason: options?.failureReason,

    userCorrected: options?.userCorrected || false,
    userCorrectionDetails: options?.userCorrectionDetails,

    pageUrl: window.location.href,
    pageTitle: document.title,

    variableValues: options?.variableValues,
  };
}

// ============================================================================
// Feedback Analysis
// ============================================================================

/**
 * Aggregate feedback into learned corrections
 */
export function aggregateFeedback(feedbackHistory: ExecutionFeedback[]): StepCorrections {
  const corrections: StepCorrections = {};

  for (const feedback of feedbackHistory) {
    for (const step of feedback.stepFeedback) {
      if (step.recoveryNeeded && step.recoverySuccess) {
        // This step needed recovery but succeeded → learn from it
        if (!corrections[step.stepIndex]) {
          corrections[step.stepIndex] = [];
        }

        // Find existing correction for this strategy
        const existingIdx = corrections[step.stepIndex].findIndex(
          c => c.strategy === step.recoveryStrategy
        );

        if (existingIdx >= 0) {
          // Update existing
          corrections[step.stepIndex][existingIdx].successCount++;
          corrections[step.stepIndex][existingIdx].totalAttempts++;
          corrections[step.stepIndex][existingIdx].lastUsed = feedback.executedAt;
        } else {
          // Add new correction
          corrections[step.stepIndex].push({
            strategy: step.recoveryStrategy || 'unknown',
            actualElement: step.actualElement,
            successCount: 1,
            totalAttempts: 1,
            lastUsed: feedback.executedAt,
          });
        }
      } else if (step.recoveryNeeded && !step.recoverySuccess) {
        // Recovery failed → track but don't count as success
        if (!corrections[step.stepIndex]) {
          corrections[step.stepIndex] = [];
        }

        const existingIdx = corrections[step.stepIndex].findIndex(
          c => c.strategy === step.recoveryStrategy
        );

        if (existingIdx >= 0) {
          corrections[step.stepIndex][existingIdx].totalAttempts++;
        }
      }
    }
  }

  // Sort corrections by success rate
  for (const stepIdx in corrections) {
    corrections[stepIdx].sort((a, b) => {
      const aRate = a.successCount / a.totalAttempts;
      const bRate = b.successCount / b.totalAttempts;
      return bRate - aRate;
    });
  }

  return corrections;
}

/**
 * Get the most effective corrections for a step
 */
export function getBestCorrections(
  corrections: StepCorrections,
  stepIndex: number,
  maxResults: number = 3
): LearnedCorrection[] {
  const stepCorrections = corrections[stepIndex];
  if (!stepCorrections || stepCorrections.length === 0) {
    return [];
  }

  // Filter to corrections with >50% success rate and at least 2 attempts
  const effective = stepCorrections.filter(c =>
    c.successCount / c.totalAttempts >= 0.5 && c.totalAttempts >= 1
  );

  return effective.slice(0, maxResults);
}

/**
 * Analyze feedback to identify patterns
 */
export function analyzeFeedbackPatterns(feedbackHistory: ExecutionFeedback[]): {
  overallSuccessRate: number;
  commonFailureSteps: number[];
  effectiveRecoveryStrategies: string[];
  averageExecutionTime: number;
} {
  if (feedbackHistory.length === 0) {
    return {
      overallSuccessRate: 0,
      commonFailureSteps: [],
      effectiveRecoveryStrategies: [],
      averageExecutionTime: 0,
    };
  }

  const successCount = feedbackHistory.filter(f => f.success).length;
  const overallSuccessRate = successCount / feedbackHistory.length;

  // Count failure steps
  const failureStepCounts: Record<number, number> = {};
  for (const feedback of feedbackHistory) {
    if (feedback.failedAtStep !== undefined) {
      failureStepCounts[feedback.failedAtStep] = (failureStepCounts[feedback.failedAtStep] || 0) + 1;
    }
  }

  // Get most common failure steps
  const commonFailureSteps = Object.entries(failureStepCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([step]) => parseInt(step, 10));

  // Count recovery strategy effectiveness
  const strategyStats: Record<string, { success: number; total: number }> = {};
  for (const feedback of feedbackHistory) {
    for (const step of feedback.stepFeedback) {
      if (step.recoveryStrategy) {
        if (!strategyStats[step.recoveryStrategy]) {
          strategyStats[step.recoveryStrategy] = { success: 0, total: 0 };
        }
        strategyStats[step.recoveryStrategy].total++;
        if (step.recoverySuccess) {
          strategyStats[step.recoveryStrategy].success++;
        }
      }
    }
  }

  // Get effective strategies (>60% success rate)
  const effectiveRecoveryStrategies = Object.entries(strategyStats)
    .filter(([_, stats]) => stats.success / stats.total >= 0.6)
    .sort((a, b) => (b[1].success / b[1].total) - (a[1].success / a[1].total))
    .map(([strategy]) => strategy);

  // Average execution time
  const totalTime = feedbackHistory.reduce((sum, f) => sum + f.executionDurationMs, 0);
  const averageExecutionTime = totalTime / feedbackHistory.length;

  return {
    overallSuccessRate,
    commonFailureSteps,
    effectiveRecoveryStrategies,
    averageExecutionTime,
  };
}

export const ExecutionFeedback = {
  buildStepFeedback,
  buildExecutionFeedback,
  aggregateFeedback,
  getBestCorrections,
  analyzeFeedbackPatterns,
};
