/**
 * Memory Adapter
 *
 * Converts WorkflowMemory + WorkflowAnalysis into VisionExecutionContext
 * This bridges the recording output to the vision execution system.
 *
 * The adapter ensures ALL intelligence gathered during recording
 * is available to the vision AI during execution.
 */

import type { SavedWorkflow, WorkflowStep, WorkflowStepPayload } from '../../../types/workflow';
import type { WorkflowMemory, WorkflowPhase } from '../../workflow-memory/types';
import type { WorkflowAnalysis, StepExecutionGuidance as AnalysisStepGuidance } from '../../post-recording-analyzer';
import type { VisionExecutionContext, StepGuidance, ActionRecord } from '../types';

/**
 * Create a rich VisionExecutionContext from a SavedWorkflow
 *
 * This extracts ALL intelligence from:
 * - WorkflowMemory (phases, success criteria, adaptability)
 * - WorkflowAnalysis (step guidance, patterns, strategies)
 * - LearnedSkill (Q&A knowledge)
 * - Clarifications (user rules)
 */
export function createVisionExecutionContext(
  workflow: SavedWorkflow,
  currentPhaseIndex: number,
  variables: Record<string, string>,
  history: ActionRecord[]
): VisionExecutionContext {
  const memory = workflow.memory;
  const analysis = workflow.aiAnalysis;
  const currentPhase = memory?.understanding?.phases?.[currentPhaseIndex];

  return {
    // ─────────────────────────────────────────────────────────────
    // Task Identity
    // ─────────────────────────────────────────────────────────────
    task: {
      name: memory?.identity?.name || workflow.name,
      description: memory?.identity?.purpose || workflow.description || '',
      domain: memory?.identity?.domain || 'Web Application',
      goal: analysis?.workflowUnderstanding?.primaryGoal || memory?.identity?.purpose || workflow.description || '',
    },

    // ─────────────────────────────────────────────────────────────
    // Current Phase with Full Guidance
    // ─────────────────────────────────────────────────────────────
    currentPhase: {
      name: currentPhase?.name || `Phase ${currentPhaseIndex + 1}`,
      intent: currentPhase?.purpose || '',
      stepIndices: currentPhase?.stepIndices || [],
      stepGuidance: extractStepGuidanceForPhase(
        analysis?.stepGuidance,
        currentPhase?.stepIndices,
        workflow.steps
      ),
    },

    // ─────────────────────────────────────────────────────────────
    // User-Taught Knowledge
    // ─────────────────────────────────────────────────────────────
    knowledge: extractKnowledge(workflow),

    // ─────────────────────────────────────────────────────────────
    // Success/Failure Criteria
    // ─────────────────────────────────────────────────────────────
    successCriteria: {
      indicators: (memory?.success?.indicators || []).map((ind) => ({
        type: ind.type,
        description: ind.description,
        pattern: ind.pattern,
        priority: ind.priority,
      })),
      failureIndicators: memory?.success?.failureIndicators || [],
      endState: memory?.success?.endState || 'Task completed successfully',
    },

    // ─────────────────────────────────────────────────────────────
    // Adaptation Strategies
    // ─────────────────────────────────────────────────────────────
    adaptations: extractAdaptations(memory, analysis),

    // ─────────────────────────────────────────────────────────────
    // Demonstration Reference
    // ─────────────────────────────────────────────────────────────
    demonstration: workflow.steps.map((step, i) => {
      const payload = step.payload as WorkflowStepPayload;
      return {
        stepIndex: i,
        action: step.type,
        target: payload?.label || payload?.elementText || step.description || '',
        value: payload?.value,
        context: payload?.pageModelContext?.pageContext?.regionName ||
          payload?.context?.container?.text ||
          payload?.aiWidgetContext?.widgetTitle,
        // Include recorded screenshot as visual reference for the AI
        // Prefer elementSnippet (smaller, more focused) over full viewport
        referenceScreenshot: payload?.visualSnapshot?.elementSnippet ? {
          elementSnippet: payload.visualSnapshot.elementSnippet,
          // Only include viewport if no element snippet available
          viewport: !payload.visualSnapshot.elementSnippet ? payload.visualSnapshot.viewport : undefined,
        } : undefined,
      };
    }),

    // ─────────────────────────────────────────────────────────────
    // Past Experience
    // ─────────────────────────────────────────────────────────────
    experience: {
      timesExecuted: memory?.experience?.timesExecuted || workflow.executionStats?.totalRuns || 0,
      successRate: memory?.experience?.successRate ||
        (workflow.executionStats?.totalRuns
          ? workflow.executionStats.successfulRuns / workflow.executionStats.totalRuns
          : 0),
      commonIssues: memory?.experience?.troubleSpots?.map((t) => t.issue) || [],
      provenFixes: memory?.experience?.provenStrategies?.map((s) => s.strategy) || [],
    },

    // ─────────────────────────────────────────────────────────────
    // Current Execution State
    // ─────────────────────────────────────────────────────────────
    variables,
    phaseIndex: currentPhaseIndex,
    totalPhases: memory?.understanding?.phases?.length || 1,
    recentHistory: history.slice(-5).map((h) => ({
      action: h.decision.action.type,
      reasoning: h.decision.reasoning,
      success: h.verification.success,
    })),
  };
}

/**
 * Extract step guidance for a specific phase
 */
function extractStepGuidanceForPhase(
  allGuidance: AnalysisStepGuidance[] | undefined,
  stepIndices: number[] | undefined,
  steps: WorkflowStep[]
): StepGuidance[] {
  const result: StepGuidance[] = [];

  // If we have analysis-generated guidance, use it
  if (allGuidance && stepIndices) {
    for (const stepIndex of stepIndices) {
      const guidance = allGuidance.find((g) => g.stepIndex === stepIndex);
      if (guidance) {
        result.push({
          stepIndex: guidance.stepIndex,
          intent: guidance.intent || '',
          whyThisElement: guidance.whyThisElement || '',
          elementFindingStrategy: {
            lookingFor: guidance.elementFindingStrategy?.lookingFor || '',
            searchContext: guidance.elementFindingStrategy?.searchContext || '',
            distinguishers: guidance.elementFindingStrategy?.distinguishers || [],
            textPatterns: guidance.elementFindingStrategy?.textPatterns || [],
            elementType: guidance.elementFindingStrategy?.elementType || 'element',
          },
          preconditions: guidance.preconditions || [],
          expectedOutcome: guidance.expectedOutcome || '',
          alternatives: guidance.alternatives || [],
          criticality: guidance.criticality,
        });
      }
    }
  }

  // If no guidance from analysis, create basic guidance from steps
  if (result.length === 0 && stepIndices) {
    for (const stepIndex of stepIndices) {
      const step = steps[stepIndex];
      if (step) {
        const payload = step.payload as WorkflowStepPayload;
        result.push({
          stepIndex,
          intent: step.description || step.naturalLanguage?.intent || `${step.type} action`,
          whyThisElement: payload?.label || payload?.elementText || '',
          elementFindingStrategy: {
            lookingFor: payload?.label || payload?.elementText || payload?.selector || '',
            searchContext: payload?.context?.container?.text || '',
            distinguishers: [],
            textPatterns: payload?.label ? [payload.label] : [],
            elementType: getElementType(step.type, payload),
          },
          preconditions: step.naturalLanguage?.precondition ? [step.naturalLanguage.precondition] : [],
          expectedOutcome: step.naturalLanguage?.expectedOutcome || '',
          alternatives: step.naturalLanguage?.alternateDescriptions || [],
        });
      }
    }
  }

  return result;
}

/**
 * Map step type to element type
 */
function getElementType(stepType: string, payload: WorkflowStepPayload): string {
  if (stepType === 'INPUT') {
    return payload?.inputDetails?.type || 'text-field';
  }
  if (stepType === 'CLICK') {
    if (payload?.elementRole === 'button' || payload?.elementText?.toLowerCase().includes('button')) {
      return 'button';
    }
    if (payload?.elementRole === 'link' || payload?.selector?.includes('a[')) {
      return 'link';
    }
    return 'clickable element';
  }
  return 'element';
}

/**
 * Extract knowledge from workflow (Q&A, clarifications, learned skill)
 */
function extractKnowledge(workflow: SavedWorkflow): VisionExecutionContext['knowledge'] {
  const rules: string[] = [];
  const tips: string[] = [];
  const warnings: string[] = [];

  // Extract from Q&A clarifications in memory
  const clarifications = workflow.memory?.clarifications?.items || [];
  for (const c of clarifications) {
    if (c.answerText || c.customAnswer) {
      rules.push(`${c.question} → ${c.customAnswer || c.answerText}`);
    }
  }

  // Extract from learned skill constants
  if (workflow.learnedSkill?.constants) {
    for (const constant of workflow.learnedSkill.constants) {
      if (constant.overridable) {
        rules.push(`${constant.name}: Use "${constant.value}" unless user specifies otherwise`);
      } else {
        rules.push(`${constant.name}: Always use "${constant.value}"`);
      }
    }
  }

  // Extract from learned skill extractable variables (patterns)
  if (workflow.learnedSkill?.extractableVariables) {
    for (const v of workflow.learnedSkill.extractableVariables) {
      tips.push(`For ${v.name}, look for patterns like: ${v.patterns.join(', ')}`);
    }
  }

  // Extract from adaptability fallbacks as tips
  const fallbacks = workflow.memory?.adaptability?.fallbacks || [];
  for (const fb of fallbacks) {
    tips.push(`If ${fb.when}, then ${fb.then}`);
  }

  // Extract from handled variations
  const variations = workflow.memory?.adaptability?.handledVariations || [];
  for (const variation of variations) {
    tips.push(`Can handle: ${variation}`);
  }

  // Extract trouble spots as warnings
  const troubleSpots = workflow.memory?.experience?.troubleSpots || [];
  for (const spot of troubleSpots) {
    warnings.push(`Step ${spot.stepIndex}: ${spot.issue} - Solution: ${spot.solution}`);
  }

  return { rules, tips, warnings };
}

/**
 * Extract adaptation strategies from memory and analysis
 */
function extractAdaptations(
  memory: WorkflowMemory | undefined,
  analysis: WorkflowAnalysis | undefined
): VisionExecutionContext['adaptations'] {
  const adaptations: VisionExecutionContext['adaptations'] = [];

  // From memory fallbacks
  const fallbacks = memory?.adaptability?.fallbacks || [];
  for (const fb of fallbacks) {
    adaptations.push({
      scenario: fb.when,
      howToAdapt: fb.then,
      affectedSteps: fb.forStep !== undefined ? [fb.forStep] : [],
    });
  }

  // From analysis adaptation strategies
  const strategies = analysis?.adaptationStrategies || [];
  for (const strategy of strategies) {
    adaptations.push({
      scenario: strategy.scenario || '',
      howToAdapt: strategy.howToAdapt || '',
      affectedSteps: strategy.affectedSteps || [],
    });
  }

  return adaptations;
}

/**
 * Get the total number of phases in a workflow
 */
export function getPhaseCount(workflow: SavedWorkflow): number {
  return workflow.memory?.understanding?.phases?.length || 1;
}

/**
 * Get phase by index
 */
export function getPhase(workflow: SavedWorkflow, index: number): WorkflowPhase | undefined {
  return workflow.memory?.understanding?.phases?.[index];
}

/**
 * Check if workflow has rich memory (Phase 2 analysis completed)
 */
export function hasRichMemory(workflow: SavedWorkflow): boolean {
  return !!(workflow.memory && workflow.memory.understanding?.phases?.length > 0);
}

/**
 * Get a summary for logging/debugging
 */
export function summarizeContext(context: VisionExecutionContext): string {
  return `Task: ${context.task.name}
Phase: ${context.currentPhase.name} (${context.phaseIndex + 1}/${context.totalPhases})
Steps in phase: ${context.currentPhase.stepGuidance.length}
Variables: ${Object.keys(context.variables).join(', ')}
Rules: ${context.knowledge.rules.length}
Success indicators: ${context.successCriteria.indicators.length}
Experience: ${context.experience.timesExecuted} runs, ${(context.experience.successRate * 100).toFixed(0)}% success`;
}
