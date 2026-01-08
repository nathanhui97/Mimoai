/**
 * Universal Execution Engine
 * 
 * A complete reimplementation of the execution system that:
 * - Handles wrapper divs and semantic targets
 * - Uses multi-signal element resolution
 * - Treats dropdowns as atomic actions
 * - Provides clear failure diagnostics
 * - Uses state-based verification instead of timeouts
 */

// Types
export type {
  ElementSignature,
  IdentitySignals,
  TextSignals,
  StructuralSignals,
  VisualSignals,
  SelectorSignals,
  ClickTargetInfo,
  DOMPath,
  DOMPathStep,
  ComponentPatternType,
  ComponentLibrary,
  ComponentPattern,
  DropdownPatternData,
  SimpleClickPatternData,
  TextInputPatternData,
  AutocompletePatternData,
  MultiSelectPatternData,
  MenuNavigationPatternData,
  InteractabilityResult,
  VisibilityDetails,
  ExecutionStrategy,
  StrategyResult,
  ExpectedOutcome,
  CapturedElementState,
  ResolutionCandidate,
  ResolutionResult,
  ActionResult,
  StepResult,
  WorkflowResult,
  UniversalStep,
  ResolutionOptions,
  ActionOptions,
  WorkflowOptions,
} from '../../types/universal-types';

// Element Signature
export {
  buildElementSignature,
  buildElementSignatureExact,
  findSemanticTarget,
  isSemanticInteractive,
  captureDOMPath,
} from './element-signature';

// Element Resolver
export {
  resolveElement,
  resolveAcrossBoundaries,
  waitForElement,
} from './element-resolver';

// Interactability Gate
export {
  checkInteractability,
  checkVisibility,
  waitForInteractable,
  findClickableAncestor,
} from './interactability-gate';

// Component Detector
export {
  detectComponentPattern,
  detectComponentLibrary,
  isDropdownTrigger,
  isAutocompleteInput,
  isToggle,
  isTabControl,
  isModalTrigger,
  isInputElement,
  isDropdownPattern,
  isSimpleClickPattern,
  isTextInputPattern,
} from './component-detector';

// State Verifier
export {
  verifyOutcome,
  captureElementState,
  hasStateChanged,
  detectAnyStateChange,
  waitForCondition,
  waitForDOMStable,
  waitForElement as waitForElementAppear,
  waitForElementGone,
  waitForDropdownMenu,
  verifyDropdownSelection,
  verifyDropdownClosed,
} from './state-verifier';

// Action Primitives
export { executeClick } from './action-primitives/simple-click';
export { executeHumanClick } from './action-primitives/human-click';
export { executeDropdownSelect } from './action-primitives/dropdown-select';
export { executeTextInput } from './action-primitives/text-input';
export {
  executeKeyboardAction,
  pressKey,
  pressKeySequence,
  pressEnter,
  pressEscape,
  pressTab,
  pressArrow,
} from './action-primitives/keyboard-action';

// Orchestrator
export {
  executeWorkflow,
  convertLegacyStep,
} from './orchestrator';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { executeWorkflow, convertLegacyStep } from './universal-execution';
 * 
 * // Convert legacy steps to universal format
 * const universalSteps = legacyWorkflow.steps.map(convertLegacyStep);
 * 
 * // Execute
 * const result = await executeWorkflow(universalSteps, {
 *   stopOnFailure: true,
 *   variableValues: { email: 'test@example.com' },
 *   onStepProgress: (index, status) => {
 *     console.log(`Step ${index}: ${status}`);
 *   },
 * });
 * 
 * if (result.success) {
 *   console.log('Workflow completed!');
 * } else {
 *   console.error('Failed:', result.failureSummary);
 * }
 * ```
 */

