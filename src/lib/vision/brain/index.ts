/**
 * Brain Module
 *
 * The reasoning capabilities of the agent:
 * - Decision making (what action to take)
 * - Verification (did the action work)
 * - Progress tracking (are we done)
 */

// Decision making
export {
  // Original functions (for backward compatibility)
  decideNextAction,
  isPhaseComplete,
  isTaskComplete,
  detectStuckState,
  getRecoverySuggestions,
  matchVariableToField,
  initReasonerConfig,
  // New context-aware functions (preferred)
  decideNextActionWithContext,
  isPhaseCompleteWithContext,
  isTaskCompleteWithContext,
  getRecoverySuggestionsWithContext,
} from './reasoner';

export type { TaskPhase, SemanticTaskModel } from './reasoner';

// Verification
export {
  verifyAction,
  didScreenChange,
  detectErrors,
  detectSuccess,
  verifyFieldFilled,
  localVerification,
  waitAndVerify,
  initVerifierConfig,
} from './verifier';
