/**
 * Execution Coordinator - Unified Entry Point for All Workflow Execution
 *
 * This module serves as the single entry point for executing workflows, routing
 * to the appropriate executor based on workflow complexity and step types.
 *
 * Architecture:
 * - Fast Path (Tier1Executor): DOM-based execution for simple, deterministic steps
 * - Smart Path (AIAgent): AI-guided execution for complex interactions
 * - Recovery Engine: Handles failures with progressive fallback strategies
 *
 * Benefits:
 * - Single point of coordination for all execution types
 * - Intelligent routing based on step complexity
 * - Unified progress/state management
 * - Clean separation of concerns
 */

import type { SavedWorkflow, WorkflowStep, WorkflowStepPayload } from '../../types/workflow';
import type { UserContext } from '../../types/ai';
import { isWorkflowStepPayload } from '../../types/workflow';

// ============================================================================
// Types
// ============================================================================

/** Execution options for the coordinator */
export interface ExecutionOptions {
  /** Variable values for parameterized workflows */
  variableValues?: Record<string, string>;
  /** User context for AI execution */
  userContext?: UserContext;
  /** Maximum steps before timeout */
  maxSteps?: number;
  /** Timeout per step in milliseconds */
  stepTimeout?: number;
  /** Progress callback */
  onProgress?: ExecutionProgressCallback;
  /** Thinking event callback (for AI execution) */
  onThinkingEvent?: (event: any) => void;
  /** Force a specific execution mode */
  forceMode?: ExecutionMode;
}

/** Execution mode */
export type ExecutionMode = 'fast' | 'smart' | 'auto';

/** Step complexity classification */
export type StepComplexity = 'simple' | 'moderate' | 'complex';

/** Workflow complexity classification */
export interface WorkflowComplexity {
  overall: StepComplexity;
  simpleSteps: number;
  moderateSteps: number;
  complexSteps: number;
  recommendedMode: ExecutionMode;
  reasons: string[];
}

/** Execution result */
export interface ExecutionResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  elapsedMs: number;
  status: 'completed' | 'failed' | 'paused' | 'stopped';
  error?: string;
  failedStepIndex?: number;
  history?: ExecutionHistoryEntry[];
}

/** Execution history entry */
export interface ExecutionHistoryEntry {
  stepIndex: number;
  stepType: string;
  executor: 'fast' | 'smart' | 'recovery';
  result: 'success' | 'failed' | 'skipped';
  elapsedMs: number;
  error?: string;
  retryCount?: number;
  recoveryStrategy?: string;
}

/** Execution progress callback */
export type ExecutionProgressCallback = (
  stepIndex: number,
  totalSteps: number,
  status: 'starting' | 'in_progress' | 'completed' | 'failed' | 'recovering'
) => void;

/** Execution state for pause/resume support */
export interface ExecutionState {
  workflowId: string;
  currentStepIndex: number;
  status: 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  variableValues?: Record<string, string>;
  history: ExecutionHistoryEntry[];
  startTime: number;
  pauseReason?: 'user' | 'agent_needs_help' | 'confirmation_needed';
}

// ============================================================================
// Complexity Analysis
// ============================================================================

/**
 * Analyze workflow complexity to determine optimal execution strategy
 */
export function analyzeWorkflowComplexity(workflow: SavedWorkflow): WorkflowComplexity {
  const steps = workflow.optimizedSteps || workflow.steps;
  let simpleSteps = 0;
  let moderateSteps = 0;
  let complexSteps = 0;
  const reasons: string[] = [];

  for (const step of steps) {
    const complexity = analyzeStepComplexity(step);
    switch (complexity) {
      case 'simple':
        simpleSteps++;
        break;
      case 'moderate':
        moderateSteps++;
        break;
      case 'complex':
        complexSteps++;
        break;
    }
  }

  // Determine overall complexity
  let overall: StepComplexity;
  let recommendedMode: ExecutionMode;

  if (complexSteps > 0) {
    overall = 'complex';
    recommendedMode = 'smart';
    reasons.push(`${complexSteps} complex step(s) require AI guidance`);
  } else if (moderateSteps > steps.length * 0.3) {
    overall = 'moderate';
    recommendedMode = 'auto';
    reasons.push(`${moderateSteps} moderate step(s) may need recovery`);
  } else {
    overall = 'simple';
    recommendedMode = 'fast';
    reasons.push(`All ${simpleSteps} steps are simple and deterministic`);
  }

  // Additional complexity factors
  if (steps.some(s => s.type === 'TAB_SWITCH')) {
    reasons.push('Multi-tab workflow detected');
  }
  if (hasSpreadsheetSteps(steps)) {
    reasons.push('Spreadsheet operations detected');
  }
  if (hasDynamicSelectors(steps)) {
    recommendedMode = 'smart';
    reasons.push('Dynamic selectors may need AI assistance');
  }

  return {
    overall,
    simpleSteps,
    moderateSteps,
    complexSteps,
    recommendedMode,
    reasons,
  };
}

/**
 * Analyze complexity of a single step
 */
function analyzeStepComplexity(step: WorkflowStep): StepComplexity {
  const { type, payload } = step;

  // TAB_SWITCH is always simple - deterministic tab switching
  if (type === 'TAB_SWITCH') {
    return 'simple';
  }

  // Non-standard payloads are handled by the type guard
  if (!isWorkflowStepPayload(payload)) {
    return 'simple';
  }

  // NAVIGATION is simple - just navigate to URL
  if (type === 'NAVIGATION') {
    return 'simple';
  }

  // SCROLL is simple if it has specific scroll data
  if (type === 'SCROLL') {
    return 'simple';
  }

  // KEYBOARD is simple if it's a specific key press
  if (type === 'KEYBOARD' && payload.keyboardDetails) {
    return 'simple';
  }

  // COPY/PASTE are simple if they have clipboard details
  if ((type === 'COPY' || type === 'PASTE') && payload.clipboardDetails) {
    return 'simple';
  }

  // Check for reliable selectors
  const hasStableSelector = hasStableLocator(payload);
  const hasTestId = !!payload.locatorBundle?.strategies?.some(s => s.type === 'testid');
  const hasAriaLabel = !!payload.aiEvidence?.semanticAnchors?.ariaLabel;

  if (hasTestId || (hasStableSelector && hasAriaLabel)) {
    return 'simple';
  }

  // Check for dynamic/unreliable elements
  const hasDynamicParts = payload.locatorQuality?.hasDynamicParts;
  const lowConfidence = (payload.locatorQuality?.confidenceScore || 0) < 0.7;
  const needsAI = payload.elementAnalysis?.executionStrategy === 'AI_REQUIRED';

  if (needsAI || (hasDynamicParts && lowConfidence)) {
    return 'complex';
  }

  // Default to moderate for clicks/inputs that need element resolution
  if (type === 'CLICK' || type === 'INPUT') {
    return 'moderate';
  }

  return 'simple';
}

/**
 * Check if step has a stable locator
 */
function hasStableLocator(payload: WorkflowStepPayload): boolean {
  const bundle = payload.locatorBundle;
  if (!bundle) return false;

  return bundle.strategies?.some(s =>
    s.type === 'testid' ||
    s.type === 'aria' ||
    (s.type === 'css' && !hasDynamicParts(s.value))
  ) || false;
}

/**
 * Check if selector has dynamic parts (generated IDs, timestamps, etc.)
 */
function hasDynamicParts(selector: string): boolean {
  // Common patterns for dynamic selectors
  const dynamicPatterns = [
    /\d{10,}/, // Timestamps
    /[a-f0-9]{8}-[a-f0-9]{4}/, // UUIDs
    /[:]\d+[:]/,  // Random numbers in paths
    /ember\d+/, // Ember.js IDs
    /react-\w+-\d+/, // React generated IDs
    /ng-\w+-\d+/, // Angular generated IDs
  ];

  return dynamicPatterns.some(pattern => pattern.test(selector));
}

/**
 * Check if workflow has spreadsheet steps
 */
function hasSpreadsheetSteps(steps: WorkflowStep[]): boolean {
  return steps.some(step => {
    if (!isWorkflowStepPayload(step.payload)) return false;
    return !!step.payload.spreadsheetContext;
  });
}

/**
 * Check if workflow has steps with dynamic selectors
 */
function hasDynamicSelectors(steps: WorkflowStep[]): boolean {
  return steps.some(step => {
    if (!isWorkflowStepPayload(step.payload)) return false;
    return step.payload.locatorQuality?.hasDynamicParts || false;
  });
}

// ============================================================================
// Timeout Helper
// ============================================================================

/**
 * Execute a promise with timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} (timeout: ${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

// ============================================================================
// Execution Coordinator Class
// ============================================================================

/**
 * ExecutionCoordinator - Single entry point for all workflow execution
 */
export class ExecutionCoordinator {
  private state: ExecutionState | null = null;
  private aborted: boolean = false;
  private options: ExecutionOptions;

  constructor(options: ExecutionOptions = {}) {
    this.options = {
      maxSteps: options.maxSteps ?? 50,
      stepTimeout: options.stepTimeout ?? 30000,
      ...options,
    };
  }

  /**
   * Execute a workflow with automatic mode detection
   */
  async execute(workflow: SavedWorkflow, options?: ExecutionOptions): Promise<ExecutionResult> {
    const mergedOptions = { ...this.options, ...options };
    const startTime = Date.now();

    // Analyze complexity
    const complexity = analyzeWorkflowComplexity(workflow);
    const mode = mergedOptions.forceMode || complexity.recommendedMode;

    console.log('[Coordinator] Workflow complexity analysis:', {
      overall: complexity.overall,
      simple: complexity.simpleSteps,
      moderate: complexity.moderateSteps,
      complex: complexity.complexSteps,
      mode,
      reasons: complexity.reasons,
    });

    // Initialize state
    this.state = {
      workflowId: workflow.id,
      currentStepIndex: 0,
      status: 'running',
      variableValues: mergedOptions.variableValues,
      history: [],
      startTime,
    };

    this.aborted = false;

    try {
      // Route to appropriate executor
      if (mode === 'fast' || (mode === 'auto' && complexity.overall === 'simple')) {
        return await this.executeFastPath(workflow, mergedOptions);
      } else {
        return await this.executeSmartPath(workflow, mergedOptions);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Coordinator] Execution error:', error);

      return {
        success: false,
        stepsCompleted: this.state?.currentStepIndex || 0,
        totalSteps: workflow.steps.length,
        elapsedMs: Date.now() - startTime,
        status: 'failed',
        error: errorMessage,
        history: this.state?.history || [],
      };
    }
  }

  /**
   * Execute using Fast Path (Tier1Executor) - for simple, deterministic workflows
   */
  private async executeFastPath(
    workflow: SavedWorkflow,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    console.log('[Coordinator] Using Fast Path execution');

    // Dynamic import to avoid circular dependencies
    const { Tier1Executor } = await import('../tier1-executor');
    const { convertStepToAction } = await import('./step-converter');

    const steps = workflow.optimizedSteps || workflow.steps;
    const startTime = this.state!.startTime;

    for (let i = 0; i < steps.length; i++) {
      if (this.aborted) {
        return this.buildResult('stopped', steps.length, startTime);
      }

      const step = steps[i];
      this.state!.currentStepIndex = i;
      options.onProgress?.(i, steps.length, 'starting');

      const stepStart = Date.now();

      try {
        // Convert workflow step to agent action
        const action = await convertStepToAction(step, options.variableValues || {});

        // Execute with Tier1 (with timeout protection)
        const stepTimeout = options.stepTimeout || 30000;
        const result = await withTimeout(
          Tier1Executor.execute(action),
          stepTimeout,
          `Step ${i + 1} execution timed out`
        );

        const entry: ExecutionHistoryEntry = {
          stepIndex: i,
          stepType: step.type,
          executor: 'fast',
          result: result.status === 'success' ? 'success' : 'failed',
          elapsedMs: Date.now() - stepStart,
          error: result.message,
        };

        this.state!.history.push(entry);

        if (result.status !== 'success') {
          // Try smart path recovery for this step
          console.log(`[Coordinator] Fast path failed at step ${i}, attempting recovery...`);
          const recovered = await this.attemptRecovery(step, action, options);

          if (!recovered) {
            options.onProgress?.(i, steps.length, 'failed');
            return this.buildResult('failed', steps.length, startTime, result.message, i);
          }
        }

        options.onProgress?.(i, steps.length, 'completed');

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        this.state!.history.push({
          stepIndex: i,
          stepType: step.type,
          executor: 'fast',
          result: 'failed',
          elapsedMs: Date.now() - stepStart,
          error: errorMessage,
        });

        options.onProgress?.(i, steps.length, 'failed');
        return this.buildResult('failed', steps.length, startTime, errorMessage, i);
      }
    }

    return this.buildResult('completed', steps.length, startTime);
  }

  /**
   * Execute using Smart Path (AIAgent) - for complex, AI-guided workflows
   */
  private async executeSmartPath(
    workflow: SavedWorkflow,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    console.log('[Coordinator] Using Smart Path (AI Agent) execution');

    // Dynamic import to avoid circular dependencies
    const { AIAgent } = await import('../ai-agent');

    const agent = new AIAgent({
      maxSteps: options.maxSteps,
      stepTimeout: options.stepTimeout,
      onProgress: (stepNumber, _action, status) => {
        options.onProgress?.(stepNumber, workflow.steps.length,
          status === 'completed' ? 'completed' :
          status === 'failed' ? 'failed' : 'in_progress'
        );
      },
      onThinkingEvent: options.onThinkingEvent,
    });

    const result = await agent.run(workflow, options.variableValues, options.userContext);

    return {
      success: result.success,
      stepsCompleted: result.stepsCompleted,
      totalSteps: result.totalSteps,
      elapsedMs: result.elapsedMs,
      status: result.finalStatus === 'completed' ? 'completed' :
              result.finalStatus === 'failed' ? 'failed' :
              result.finalStatus === 'paused' ? 'paused' : 'stopped',
      error: result.error,
      history: this.state?.history,
    };
  }

  /**
   * Attempt recovery when fast path fails
   *
   * Recovery cascade:
   * 1. Wait for DOM stability + retry
   * 2. Scroll element into view
   * 3. Try alternative selectors from locator bundle
   * 4. Use AI vision as last resort
   * 5. Ask user for help (if enabled)
   */
  private async attemptRecovery(
    step: WorkflowStep,
    action: any,
    _options: ExecutionOptions
  ): Promise<boolean> {
    console.log('[Coordinator] Attempting recovery for failed step');

    try {
      // Dynamic import to avoid circular dependencies
      const { UnifiedRecoveryEngine } = await import('./recovery');
      const { Tier1Executor } = await import('../tier1-executor');

      // Create recovery engine with appropriate options
      const recoveryEngine = new UnifiedRecoveryEngine({
        maxAttempts: 5,
        initialWaitMs: 500,
        maxWaitMs: 3000,
        enableVision: true,
        enableUserHelp: false, // Don't prompt user during automated recovery
      });

      // Determine failure code from the last execution
      // For now, default to NOT_FOUND as it's the most common
      const failureCode = 'NOT_FOUND' as const;

      // Attempt recovery
      const result = await recoveryEngine.recover({
        step,
        action,
        failureCode,
        attemptCount: 0,
      });

      if (result.recovered) {
        console.log(`[Coordinator] Recovery succeeded with strategy: ${result.strategy}`);

        // Update history with recovery info
        if (this.state && this.state.history.length > 0) {
          const lastEntry = this.state.history[this.state.history.length - 1];
          lastEntry.recoveryStrategy = result.strategy;
          lastEntry.result = 'success';
        }

        return true;
      }

      // If recovery failed but we have vision fallback available,
      // fall back to smart path which has more sophisticated AI handling
      if (result.needsUserHelp) {
        console.log('[Coordinator] Recovery exhausted, escalating to smart path');
      }

      return false;

    } catch (error) {
      console.warn('[Coordinator] Recovery attempt threw error:', error);
      return false;
    }
  }

  /**
   * Build execution result
   */
  private buildResult(
    status: ExecutionResult['status'],
    totalSteps: number,
    startTime: number,
    error?: string,
    failedStepIndex?: number
  ): ExecutionResult {
    return {
      success: status === 'completed',
      stepsCompleted: this.state?.currentStepIndex || 0,
      totalSteps,
      elapsedMs: Date.now() - startTime,
      status,
      error,
      failedStepIndex,
      history: this.state?.history,
    };
  }

  // ============================================================================
  // Control Methods
  // ============================================================================

  /**
   * Pause execution
   */
  pause(reason?: ExecutionState['pauseReason']): void {
    if (this.state && this.state.status === 'running') {
      this.state.status = 'paused';
      this.state.pauseReason = reason;
      console.log('[Coordinator] Execution paused:', reason);
    }
  }

  /**
   * Resume execution
   */
  resume(): void {
    if (this.state && this.state.status === 'paused') {
      this.state.status = 'running';
      this.state.pauseReason = undefined;
      console.log('[Coordinator] Execution resumed');
    }
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.aborted = true;
    if (this.state) {
      this.state.status = 'stopped';
      console.log('[Coordinator] Execution stopped');
    }
  }

  /**
   * Get current execution progress
   */
  getProgress(): { stepIndex: number; totalSteps: number; status: string } | null {
    if (!this.state) return null;

    return {
      stepIndex: this.state.currentStepIndex,
      totalSteps: this.state.history.length,
      status: this.state.status,
    };
  }

  /**
   * Get execution state (for save/restore)
   */
  getState(): ExecutionState | null {
    return this.state;
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export default ExecutionCoordinator;
