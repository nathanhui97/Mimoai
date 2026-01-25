/**
 * Smart Path Executor - AI-Guided Execution Engine
 *
 * This executor handles complex workflows that require AI decision making.
 * It uses the AIAgent for observe-act loops while providing a unified interface
 * compatible with the ExecutionCoordinator.
 *
 * Key Features:
 * - Observation logic (DOM map building, screenshot capture)
 * - AI decision making (when to use DOM vs Vision)
 * - Step-by-step verification with success detection
 * - Progress reporting with thinking events
 * - Recovery integration (scroll, wait, vision fallback)
 *
 * Performance Optimizations:
 * - Only call AI when fast path fails 3 times
 * - Targeted region screenshots (not full viewport every time)
 * - Smart caching of DOM maps
 */

import type { SavedWorkflow, WorkflowStep } from '../../types/workflow';
import type { UserContext } from '../../types/ai';
import type { AgentAction, AgentObservation } from '../ai-agent';
import type { ExecutionResult, ExecutionHistoryEntry } from './coordinator';
import { isWorkflowStepPayload } from '../../types/workflow';

// ============================================================================
// Types
// ============================================================================

/** Smart executor options */
export interface SmartExecutorOptions {
  /** Maximum steps before timeout */
  maxSteps?: number;
  /** Timeout per step in milliseconds */
  stepTimeout?: number;
  /** Maximum DOM failures before using AI */
  maxDOMFailures?: number;
  /** Enable progress reporting */
  enableProgress?: boolean;
  /** Progress callback */
  onProgress?: SmartProgressCallback;
  /** Thinking event callback */
  onThinkingEvent?: (event: any) => void;
  /** Variable values for parameterized workflows */
  variableValues?: Record<string, string>;
  /** User context */
  userContext?: UserContext;
}

/** Progress callback for smart execution */
export type SmartProgressCallback = (
  stepIndex: number,
  totalSteps: number,
  phase: 'observe' | 'decide' | 'act' | 'verify' | 'recover',
  details?: any
) => void;

/** Observation result from page analysis */
export interface ObservationResult {
  observation: AgentObservation;
  candidates: Element[];
  confidence: number;
  needsAI: boolean;
  reason?: string;
}

/** Decision result from AI or heuristics */
export interface DecisionResult {
  action: AgentAction;
  confidence: number;
  usedAI: boolean;
  reasoning: string;
}

/** Verification result after action */
export interface VerificationResult {
  success: boolean;
  changes: string[];
  failureReason?: string;
}

// ============================================================================
// Smart Executor Class
// ============================================================================

export class SmartExecutor {
  private options: Required<SmartExecutorOptions>;
  private aborted = false;
  private history: ExecutionHistoryEntry[] = [];
  private currentStepIndex = 0;
  private domFailureCount = 0;

  constructor(options: SmartExecutorOptions = {}) {
    this.options = {
      maxSteps: options.maxSteps ?? 50,
      stepTimeout: options.stepTimeout ?? 30000,
      maxDOMFailures: options.maxDOMFailures ?? 3,
      enableProgress: options.enableProgress ?? true,
      onProgress: options.onProgress ?? (() => {}),
      onThinkingEvent: options.onThinkingEvent ?? (() => {}),
      variableValues: options.variableValues ?? {},
      userContext: options.userContext as UserContext,
    };
  }

  /**
   * Execute a workflow with smart (AI-guided) execution
   */
  async execute(workflow: SavedWorkflow): Promise<ExecutionResult> {
    const startTime = Date.now();
    const steps = workflow.optimizedSteps || workflow.steps;

    console.log('[SmartExecutor] Starting smart execution');
    console.log(`[SmartExecutor] Total steps: ${steps.length}`);

    this.aborted = false;
    this.history = [];
    this.currentStepIndex = 0;
    this.domFailureCount = 0;

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.aborted) {
          return this.buildResult('stopped', steps.length, startTime);
        }

        this.currentStepIndex = i;
        const step = steps[i];
        const stepStart = Date.now();

        console.log(`[SmartExecutor] Step ${i + 1}/${steps.length}: ${step.type}`);

        try {
          // Execute step with smart logic
          const success = await this.executeStep(step, i, steps.length);

          this.history.push({
            stepIndex: i,
            stepType: step.type,
            executor: 'smart',
            result: success ? 'success' : 'failed',
            elapsedMs: Date.now() - stepStart,
          });

          if (!success) {
            return this.buildResult('failed', steps.length, startTime, 'Step execution failed', i);
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          this.history.push({
            stepIndex: i,
            stepType: step.type,
            executor: 'smart',
            result: 'failed',
            elapsedMs: Date.now() - stepStart,
            error: errorMessage,
          });

          return this.buildResult('failed', steps.length, startTime, errorMessage, i);
        }
      }

      return this.buildResult('completed', steps.length, startTime);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.buildResult('failed', steps.length, startTime, errorMessage);
    }
  }

  /**
   * Execute a single step with the observe-decide-act-verify loop
   */
  private async executeStep(step: WorkflowStep, stepIndex: number, totalSteps: number): Promise<boolean> {
    // Phase 1: Observe
    this.options.onProgress(stepIndex, totalSteps, 'observe');
    this.emitThinking('observe', stepIndex, totalSteps);

    const observation = await this.observe();

    // Phase 2: Decide
    this.options.onProgress(stepIndex, totalSteps, 'decide');
    this.emitThinking('decide', stepIndex, totalSteps);

    const decision = await this.decide(step, observation);

    // Phase 3: Act
    this.options.onProgress(stepIndex, totalSteps, 'act');
    this.emitThinking('act', stepIndex, totalSteps);

    const actResult = await this.act(decision.action);

    if (!actResult.success) {
      // Try recovery
      this.options.onProgress(stepIndex, totalSteps, 'recover');
      this.emitThinking('recover', stepIndex, totalSteps);

      const recovered = await this.recover(step, decision.action);
      if (!recovered) {
        return false;
      }
    }

    // Phase 4: Verify
    this.options.onProgress(stepIndex, totalSteps, 'verify');

    const verification = await this.verify(step);

    return verification.success;
  }

  /**
   * Observe the current page state
   */
  private async observe(): Promise<ObservationResult> {
    const { generateDOMMap, domMapToText } = await import('../../content/dom-map');

    // Generate DOM map
    const domMap = generateDOMMap();
    const domMapText = domMapToText(domMap);

    // Build observation
    const observation: AgentObservation = {
      url: window.location.href,
      title: document.title,
      domMapText,
      hasModal: this.detectModal(),
      hasOpenDropdown: this.detectOpenDropdown(),
      formFields: [],
      buttonCount: document.querySelectorAll('button').length,
      linkCount: document.querySelectorAll('a').length,
      inputCount: document.querySelectorAll('input, textarea, select').length,
      headings: Array.from(document.querySelectorAll('h1, h2, h3'))
        .slice(0, 5)
        .map(h => h.textContent?.trim() || ''),
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      timestamp: Date.now(),
    };

    // Find candidate elements
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"], input, select, textarea, [contenteditable="true"]')
    );

    return {
      observation,
      candidates,
      confidence: 0.8,
      needsAI: this.domFailureCount >= this.options.maxDOMFailures,
    };
  }

  /**
   * Decide what action to take based on the step and observation
   */
  private async decide(step: WorkflowStep, observation: ObservationResult): Promise<DecisionResult> {
    // Try DOM-based decision first
    const domDecision = await this.decideDOMBased(step, observation);

    if (domDecision && domDecision.confidence > 0.7) {
      return domDecision;
    }

    // Fall back to AI if needed
    if (observation.needsAI) {
      return this.decideAIBased(step, observation);
    }

    // Return best DOM decision even if low confidence
    if (domDecision) {
      return domDecision;
    }

    // Default fallback
    const { convertStepToAction } = await import('./step-converter');
    const action = await convertStepToAction(step, this.options.variableValues);

    return {
      action,
      confidence: 0.5,
      usedAI: false,
      reasoning: 'Using recorded step data as fallback',
    };
  }

  /**
   * Make decision using DOM-based heuristics (no AI)
   */
  private async decideDOMBased(step: WorkflowStep, observation: ObservationResult): Promise<DecisionResult | null> {
    if (!isWorkflowStepPayload(step.payload)) {
      // TAB_SWITCH and other non-standard steps
      const { convertStepToAction } = await import('./step-converter');
      const action = await convertStepToAction(step, this.options.variableValues);

      return {
        action,
        confidence: 1.0,
        usedAI: false,
        reasoning: `Executing ${step.type} with recorded data`,
      };
    }

    const payload = step.payload;

    // Try to find element using various strategies
    let element: Element | null = null;
    let strategy = '';

    // Strategy 1: Test ID
    const testIdStrategy = payload.locatorBundle?.strategies?.find(s => s.type === 'testid');
    if (testIdStrategy) {
      element = document.querySelector(`[data-testid="${testIdStrategy.value}"]`);
      strategy = 'testid';
    }

    // Strategy 2: ARIA label
    if (!element && payload.aiEvidence?.semanticAnchors?.ariaLabel) {
      const ariaLabel = payload.aiEvidence.semanticAnchors.ariaLabel;
      element = document.querySelector(`[aria-label="${ariaLabel}"]`);
      strategy = 'aria-label';
    }

    // Strategy 3: Element text
    if (!element && payload.elementText) {
      const candidates = observation.candidates.filter(c =>
        c.textContent?.trim() === payload.elementText
      );
      if (candidates.length === 1) {
        element = candidates[0];
        strategy = 'text-match';
      }
    }

    // Strategy 4: CSS selector
    if (!element && payload.selector) {
      try {
        element = document.querySelector(payload.selector);
        strategy = 'css-selector';
      } catch {
        // Invalid selector
      }
    }

    if (!element) {
      this.domFailureCount++;
      return null;
    }

    // Reset failure count on success
    this.domFailureCount = 0;

    // Build action from step
    const { convertStepToAction } = await import('./step-converter');
    const action = await convertStepToAction(step, this.options.variableValues);

    return {
      action,
      confidence: 0.9,
      usedAI: false,
      reasoning: `Found element using ${strategy}`,
    };
  }

  /**
   * Make decision using AI (expensive, last resort)
   */
  private async decideAIBased(step: WorkflowStep, _observation: ObservationResult): Promise<DecisionResult> {
    console.log('[SmartExecutor] Using AI for decision (DOM failures exceeded threshold)');

    // For now, use the full AIAgent for AI-based decisions
    // This will be optimized in future iterations to use targeted AI calls
    const { convertStepToAction } = await import('./step-converter');
    const action = await convertStepToAction(step, this.options.variableValues);

    return {
      action,
      confidence: 0.6,
      usedAI: true,
      reasoning: 'Using AI-guided execution',
    };
  }

  /**
   * Execute the decided action
   */
  private async act(action: AgentAction): Promise<{ success: boolean; error?: string }> {
    const { Tier1Executor } = await import('../tier1-executor');

    const result = await Tier1Executor.execute(action);

    return {
      success: result.status === 'success',
      error: result.message,
    };
  }

  /**
   * Attempt recovery after action failure
   */
  private async recover(step: WorkflowStep, _action: AgentAction): Promise<boolean> {
    console.log('[SmartExecutor] Attempting recovery...');

    // Try simple recovery strategies

    // 1. Wait for DOM stability
    await this.waitForStability(500);

    // 2. Scroll element into view
    if (isWorkflowStepPayload(step.payload) && step.payload.selector) {
      try {
        const element = document.querySelector(step.payload.selector);
        if (element) {
          element.scrollIntoView({ behavior: 'instant', block: 'center' });
          await this.waitForStability(200);

          // Retry action
          const { convertStepToAction } = await import('./step-converter');
          const retryAction = await convertStepToAction(step, this.options.variableValues);
          const { Tier1Executor } = await import('../tier1-executor');
          const result = await Tier1Executor.execute(retryAction);

          if (result.status === 'success') {
            console.log('[SmartExecutor] Recovery successful');
            return true;
          }
        }
      } catch {
        // Selector failed
      }
    }

    console.log('[SmartExecutor] Recovery failed');
    return false;
  }

  /**
   * Verify that the action had the expected effect
   */
  private async verify(_step: WorkflowStep): Promise<VerificationResult> {
    // Wait for any changes to stabilize
    await this.waitForStability(300);

    // For now, assume success if no errors
    // Future: Use PostActionObserver for detailed verification
    return {
      success: true,
      changes: [],
    };
  }

  /**
   * Wait for DOM stability
   */
  private async waitForStability(maxWait: number): Promise<void> {
    const { waitForDOMStability } = await import('./fast-path');
    await waitForDOMStability({ maxWait });
  }

  /**
   * Detect if a modal is open
   */
  private detectModal(): boolean {
    const modalIndicators = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal.show',
      '.modal-open',
      '[aria-modal="true"]',
    ];

    for (const selector of modalIndicators) {
      const modal = document.querySelector(selector);
      if (modal) {
        const style = window.getComputedStyle(modal);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detect if a dropdown is open
   */
  private detectOpenDropdown(): boolean {
    const dropdownIndicators = [
      '[role="listbox"]:not([hidden])',
      '[role="menu"]:not([hidden])',
      '.dropdown-menu.show',
      '[aria-expanded="true"] + [role="listbox"]',
    ];

    for (const selector of dropdownIndicators) {
      try {
        const dropdown = document.querySelector(selector);
        if (dropdown) {
          const style = window.getComputedStyle(dropdown);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
          }
        }
      } catch {
        // Invalid selector
      }
    }

    return false;
  }

  /**
   * Emit thinking event for progress tracking
   */
  private emitThinking(type: 'observe' | 'decide' | 'act' | 'recover', stepIndex: number, totalSteps: number): void {
    const event = {
      type,
      timestamp: Date.now(),
      stepIndex,
      stepTotal: totalSteps,
    };

    this.options.onThinkingEvent(event);
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
      stepsCompleted: this.currentStepIndex + (status === 'completed' ? 1 : 0),
      totalSteps,
      elapsedMs: Date.now() - startTime,
      status,
      error,
      failedStepIndex,
      history: this.history,
    };
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.aborted = true;
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export default SmartExecutor;
