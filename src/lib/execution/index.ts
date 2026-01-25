/**
 * Unified Execution Module
 *
 * This module provides a clean, unified interface for workflow execution,
 * replacing the scattered execution logic across multiple files.
 *
 * Usage:
 * ```typescript
 * import { ExecutionCoordinator } from './lib/execution';
 *
 * const coordinator = new ExecutionCoordinator();
 * const result = await coordinator.execute(workflow, {
 *   variableValues: { name: 'John' },
 *   onProgress: (step, total, status) => console.log(`Step ${step}/${total}: ${status}`),
 * });
 * ```
 */

// Core coordinator
export {
  ExecutionCoordinator,
  analyzeWorkflowComplexity,
  type ExecutionOptions,
  type ExecutionResult,
  type ExecutionState,
  type ExecutionHistoryEntry,
  type ExecutionProgressCallback,
  type ExecutionMode,
  type StepComplexity,
  type WorkflowComplexity,
} from './coordinator';

// Step conversion utilities
export { convertStepToAction } from './step-converter';

// Fast path executor with optimizations
export {
  FastPathExecutor,
  waitForDOMStability,
  type FastPathOptions,
} from './fast-path';

// Smart path executor (AI-guided)
export {
  SmartExecutor,
  type SmartExecutorOptions,
  type SmartProgressCallback,
  type ObservationResult,
  type DecisionResult,
  type VerificationResult,
} from './smart-executor';

// Unified recovery engine
export {
  UnifiedRecoveryEngine,
  type RecoveryAttemptContext,
  type RecoveryResult,
  type RecoveryStrategy,
  type RecoveryOptions,
} from './recovery';

// Unified action executor
export {
  ActionExecutor,
  type ActionResult,
  type ActionExecutorOptions,
} from './action-executor';
