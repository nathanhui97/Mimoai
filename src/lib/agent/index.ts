/**
 * Agent Module - Public API
 *
 * This module provides all AI agent functionality for workflow execution.
 * Import from this file to access agent components.
 */

// Types
export * from './types';

// Core components
export { CandidateFinder, candidateFinder } from './candidate-finder';
export { HintExtractor, hintExtractor } from './hint-extractor';

// Extracted modules (Phase 1 decomposition)
export { Observer } from './observer';
export { GoalChecker } from './goal-checker';

// Phase 2: Milestone tracking
export { MilestoneTracker } from './milestone-tracker';

// Phase 3: Adaptive step execution
export { StepAnalyzer } from './step-analyzer';
export { PreFlightChecker } from './pre-flight-checker';

// Phase 5: Knows when to ask
export { ConfidenceAssessor } from './confidence-assessor';
export { HelpRequestBuilder } from './help-request-builder';

// Phase B: Per-page planning
export { PagePlanner } from './page-planner';
export { PlanExecutor } from './plan-executor';
