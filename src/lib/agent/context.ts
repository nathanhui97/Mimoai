/**
 * Shared Agent Context
 *
 * Provides a typed interface between the orchestrating AIAgent and its
 * sub-modules (observer, thinker, actor, fast-path-router, goal-checker,
 * execution-loop). Each module receives this context rather than holding
 * a back-reference to the full AIAgent class.
 */

import type { AgentState, AgentHint, AgentObservation, AgentAction, ExecutionContext } from './types';
import type { WorkflowMemory } from '../workflow-memory/types';
import type { StepResolutionDetail } from '../execution-learning';
import type { StuckDetector } from '../stuck-detector';
import type { CandidateFinder } from './candidate-finder';
import type { HintExtractor } from './hint-extractor';
import type { DOMMap } from '../../content/dom-map';

/**
 * Read-write access to the agent's runtime state.
 * Modules modify this directly — there is no event bus.
 */
export interface AgentContext {
  /** Mutable execution state */
  state: AgentState;

  /** Execution context for LLM (tracks what was tried before calling LLM) */
  executionContext: ExecutionContext;

  /** Step resolution tracking for learning loop */
  stepResolutionDetails: StepResolutionDetail[];

  /** Whether execution was aborted */
  aborted: boolean;

  /** Maximum steps allowed */
  maxSteps: number;

  // ── Extracted modules ──────────────────────────────────────────────

  candidateFinder: CandidateFinder;
  hintExtractor: HintExtractor;
  stuckDetector: StuckDetector;

  // ── Callbacks ──────────────────────────────────────────────────────

  onProgress?: (stepNumber: number, action: AgentAction, status: 'thinking' | 'acting' | 'completed' | 'failed') => void;
  onThinkingEvent?: (event: any) => void;

  // ── Utility methods (remain on AIAgent, shared via context) ────────

  sleep(ms: number): Promise<void>;
  notifyProgress(): void;
  recordStepResolution(
    stepIndex: number,
    success: boolean,
    foundBy: StepResolutionDetail['foundBy'],
    fastPathUsed: boolean,
    resolutionStrategy?: string
  ): void;
}
