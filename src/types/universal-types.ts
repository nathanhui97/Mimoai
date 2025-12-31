/**
 * Universal Execution Engine Types
 * 
 * Comprehensive type definitions for the universal execution system
 * that handles all edge cases: wrapper divs, shadow DOM, iframes,
 * component libraries, and various UI patterns.
 */

// ============================================================================
// Element Identification
// ============================================================================

/**
 * Identity-based signals (most stable, highest priority)
 */
export interface IdentitySignals {
  /** data-testid attribute */
  testId?: string;
  /** aria-label attribute */
  ariaLabel?: string;
  /** ARIA role */
  role?: string;
  /** Accessible name (computed) */
  accessibleName?: string;
  /** id attribute (if stable, not generated) */
  id?: string;
  /** name attribute (for form elements) */
  name?: string;
}

/**
 * Text-based signals
 */
export interface TextSignals {
  /** Exact text content (trimmed) */
  exact?: string;
  /** Normalized text (lowercase, trimmed) */
  normalized?: string;
  /** Key words contained in text */
  contains?: string[];
  /** Placeholder text (for inputs) */
  placeholder?: string;
}

/**
 * Structural signals (DOM position)
 */
export interface StructuralSignals {
  /** Element tag name */
  tagName: string;
  /** Path of tag names from root (e.g., "FORM > DIV > BUTTON") */
  tagPath?: string;
  /** Position among same-type siblings (1-indexed) */
  nthOfType?: number;
  /** Total count of same-type siblings */
  totalOfType?: number;
  /** Sibling context for disambiguation */
  siblingContext?: {
    previousText?: string;
    nextText?: string;
  };
}

/**
 * Visual/spatial signals
 */
export interface VisualSignals {
  /** Nearby landmark (e.g., "Inside 'Order Summary' section") */
  landmark?: string;
  /** Form context if inside a form */
  formContext?: string;
  /** Nearby label text */
  nearbyLabels?: string[];
  /** General position description */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  /** Section heading this element is under */
  sectionHeading?: string;
}

/**
 * CSS selector signals (fallback, least stable)
 */
export interface SelectorSignals {
  /** Best stable selector (data-testid, aria-label, etc.) */
  ideal?: string;
  /** Stable structural selector */
  stable?: string;
  /** Specific selector (may include dynamic parts) */
  specific?: string;
  /** XPath expression */
  xpath?: string;
}

/**
 * Information about the original click target (for wrapper div handling)
 */
export interface ClickTargetInfo {
  /** Whether original click was on a descendant */
  wasDescendant: boolean;
  /** Tag name of clicked descendant */
  descendantTag?: string;
  /** Text of clicked descendant */
  descendantText?: string;
  /** Selector to find the descendant */
  descendantSelector?: string;
  /** Offset from element center where click occurred */
  offsetFromCenter?: { x: number; y: number };
}

/**
 * Complete element signature with all signals
 */
export interface ElementSignature {
  /** Identity-based signals (highest priority) */
  identity: IdentitySignals;
  /** Text-based signals */
  text: TextSignals;
  /** Structural signals */
  structure: StructuralSignals;
  /** Visual/spatial signals */
  visual: VisualSignals;
  /** CSS selector signals (fallback) */
  selectors: SelectorSignals;
  /** Original click target info (for wrapper divs) */
  clickTarget?: ClickTargetInfo;
  /** Element bounds at record time */
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ============================================================================
// DOM Boundary Handling (Shadow DOM, Iframes)
// ============================================================================

/**
 * Step in a DOM path through shadow roots and iframes
 */
export type DOMPathStep =
  | { type: 'document' }
  | { type: 'shadow-host'; selector: string }
  | { type: 'shadow-root' }
  | { type: 'iframe'; selector: string; src?: string }
  | { type: 'element'; signature: ElementSignature };

/**
 * Complete path through DOM boundaries to reach an element
 */
export interface DOMPath {
  /** Type of boundary crossing */
  boundaryType: 'none' | 'shadow' | 'iframe' | 'mixed';
  /** Steps to reach the element */
  steps: DOMPathStep[];
}

// ============================================================================
// Component Pattern Detection
// ============================================================================

/**
 * Types of component patterns we can detect and handle specially
 */
export type ComponentPatternType =
  | 'SIMPLE_CLICK'        // Regular button, link, checkbox
  | 'DROPDOWN_SELECT'     // Single-select dropdown
  | 'MULTI_SELECT'        // Multi-select dropdown
  | 'AUTOCOMPLETE'        // Type-to-search + select
  | 'TEXT_INPUT'          // Text input, textarea
  | 'DATE_PICKER'         // Date selection widget
  | 'TAB_SELECT'          // Tab panel switching
  | 'TOGGLE'              // Toggle/switch control
  | 'MENU_NAVIGATION'     // Nested menu navigation
  | 'ACCORDION'           // Expand/collapse sections
  | 'MODAL_TRIGGER'       // Opens a modal
  | 'INLINE_EDIT'         // Click-to-edit text
  | 'SLIDER'              // Range slider
  | 'FILE_UPLOAD'         // File input
  | 'SCROLL';             // Scroll action (page or container)

/**
 * Detected component library
 */
export type ComponentLibrary =
  | 'native'        // Native HTML elements
  | 'mui'           // Material UI
  | 'radix'         // Radix UI
  | 'antd'          // Ant Design
  | 'chakra'        // Chakra UI
  | 'headless-ui'   // Headless UI
  | 'react-select'  // React Select
  | 'bootstrap'     // Bootstrap
  | 'custom';       // Unknown/custom

/**
 * Dropdown-specific pattern data
 */
export interface DropdownPatternData {
  /** Trigger element signature */
  trigger: ElementSignature;
  /** Current value before interaction */
  currentValue?: string;
  /** aria-expanded state */
  ariaExpanded?: string;
  /** Selected option info */
  selection: {
    optionText: string;
    optionValue?: string;
    optionIndex?: number;
  };
  /** Menu appearance info */
  menu?: {
    appearsWhere: 'below-trigger' | 'above-trigger' | 'portal' | 'modal';
    menuRole?: string;
    optionRole?: string;
    menuSelector?: string;
  };
  /** Expected outcome after selection */
  expectedOutcome?: {
    triggerText?: string;
    ariaExpanded?: string;
  };
}

/**
 * Autocomplete-specific pattern data
 */
export interface AutocompletePatternData {
  /** Input element signature */
  input: ElementSignature;
  /** Value typed to trigger suggestions */
  typedValue: string;
  /** Selected suggestion */
  suggestion: {
    selectedText: string;
    selectedValue?: string;
    matchMethod: 'exact' | 'contains' | 'startsWith';
  };
  /** Expected input value after selection */
  expectedValue?: string;
}

/**
 * Multi-select specific pattern data
 */
export interface MultiSelectPatternData {
  /** Trigger element signature */
  trigger: ElementSignature;
  /** Selections made */
  selections: Array<{
    optionText: string;
    action: 'add' | 'remove';
  }>;
  /** How the dropdown was closed */
  closeMethod: 'click-outside' | 'escape' | 'done-button' | 'auto';
  /** Expected final state */
  expectedOutcome?: {
    selectedCount: number;
    displayText?: string;
  };
}

/**
 * Menu navigation pattern data (nested menus)
 */
export interface MenuNavigationPatternData {
  /** Path through menu levels */
  path: Array<{
    level: number;
    menuTrigger: ElementSignature;
    itemText: string;
  }>;
  /** Expected outcome */
  expectedOutcome?: {
    actionTriggered: boolean;
    allMenusClosed: boolean;
  };
}

/**
 * Simple click pattern data
 */
export interface SimpleClickPatternData {
  /** Target element signature */
  target: ElementSignature;
  /** Expected change after click */
  expectedChange?: {
    type: 'navigation' | 'state-change' | 'modal-open' | 'form-submit' | 'unknown';
    details?: string;
  };
}

/**
 * Text input pattern data
 */
export interface TextInputPatternData {
  /** Input element signature */
  input: ElementSignature;
  /** Value to enter */
  value: string;
  /** Whether to clear first */
  clearFirst: boolean;
  /** Input type */
  inputType: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search' | 'contenteditable' | 'other';
}

/**
 * Detected component pattern with associated data
 */
export type ComponentPattern =
  | { type: 'SIMPLE_CLICK'; data: SimpleClickPatternData }
  | { type: 'DROPDOWN_SELECT'; data: DropdownPatternData }
  | { type: 'MULTI_SELECT'; data: MultiSelectPatternData }
  | { type: 'AUTOCOMPLETE'; data: AutocompletePatternData }
  | { type: 'MENU_NAVIGATION'; data: MenuNavigationPatternData }
  | { type: 'TEXT_INPUT'; data: TextInputPatternData }
  | { type: 'TOGGLE'; data: SimpleClickPatternData }
  | { type: 'TAB_SELECT'; data: SimpleClickPatternData }
  | { type: 'MODAL_TRIGGER'; data: SimpleClickPatternData }
  | { type: 'SCROLL'; data: any }; // Scroll pattern with viewport info

// ============================================================================
// Interactability
// ============================================================================

/**
 * Result of interactability check
 */
export interface InteractabilityResult {
  /** Whether element is interactable */
  ok: boolean;
  /** Reason if not interactable */
  reason?: string;
  /** Suggested fix if available */
  suggestion?: string;
  /** Element that is blocking (if obscured) */
  blockingElement?: Element;
}

/**
 * Visibility check details
 */
export interface VisibilityDetails {
  isDisplayed: boolean;
  isVisible: boolean;
  hasOpacity: boolean;
  hasDimensions: boolean;
  isInViewport: boolean;
  computedDisplay?: string;
  computedVisibility?: string;
  computedOpacity?: string;
}

// ============================================================================
// Execution Strategies
// ============================================================================

/**
 * Strategy for executing an action
 */
export interface ExecutionStrategy {
  /** Strategy name for logging */
  name: string;
  /** Strategy priority (lower = try first) */
  priority: number;
  /** Execute the strategy */
  execute: () => Promise<boolean>;
}

/**
 * Result of a single strategy attempt
 */
export interface StrategyResult {
  /** Strategy name */
  strategy: string;
  /** Whether it succeeded */
  success: boolean;
  /** Time taken in ms */
  elapsedMs: number;
  /** Error if failed */
  error?: string;
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Expected outcome condition types
 */
export type ExpectedOutcome =
  | { type: 'element_visible'; selector: string }
  | { type: 'element_gone'; selector: string }
  | { type: 'element_has_text'; selector: string; text: string }
  | { type: 'text_appears'; text: string }
  | { type: 'text_gone'; text: string }
  | { type: 'attribute_equals'; selector: string; attr: string; value: string }
  | { type: 'attribute_contains'; selector: string; attr: string; value: string }
  | { type: 'url_contains'; value: string }
  | { type: 'url_changed' }
  | { type: 'input_value'; selector: string; value: string }
  | { type: 'dropdown_closed' }
  | { type: 'dropdown_value'; triggerSelector: string; value: string }
  | { type: 'any_state_change' };

/**
 * Captured element state for change detection
 */
export interface CapturedElementState {
  className: string;
  ariaExpanded?: string;
  ariaChecked?: string;
  ariaPressed?: string;
  ariaSelected?: string;
  ariaDisabled?: string;
  disabled: boolean;
  checked?: boolean;
  value?: string;
  textContent: string;
  childCount: number;
  visible: boolean;
}

// ============================================================================
// Resolution Results
// ============================================================================

/**
 * Confidence score for a resolution candidate
 */
export interface ResolutionCandidate {
  /** The element */
  element: Element;
  /** Confidence score (0-1) */
  confidence: number;
  /** Which method found it */
  method: string;
  /** Individual signal scores */
  signalScores?: Record<string, number>;
}

/**
 * Result of element resolution
 */
export type ResolutionResult =
  | { status: 'found'; element: Element; confidence: number; method: string }
  | { status: 'ambiguous'; candidates: ResolutionCandidate[]; topScore: number }
  | { status: 'not_found'; triedMethods: string[]; lastError?: string };

// ============================================================================
// Action Results
// ============================================================================

/**
 * Result of executing a single action
 */
export interface ActionResult {
  /** Whether action succeeded */
  success: boolean;
  /** Action type that was executed */
  actionType: string;
  /** Time taken in ms */
  elapsedMs: number;
  /** Strategy that worked (if success) */
  successfulStrategy?: string;
  /** Strategies tried */
  strategiesTried: string[];
  /** Error message if failed */
  error?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * AI recovery information
 */
export interface AIRecoveryInfo {
  /** Whether AI was used */
  used: boolean;
  /** Method that worked */
  method?: 'ai-visual' | 'ai-semantic' | 'ai-structural' | 'learned-pattern' | 'coordinate-enhanced';
  /** Confidence of AI match */
  confidence?: number;
  /** AI reasoning */
  reasoning?: string;
  /** Suggested fix for future runs */
  suggestedFix?: {
    type: 'selector' | 'coordinate' | 'wait' | 'scroll' | 'workflow';
    description: string;
    newValue?: string;
  };
}

/**
 * Result of executing a workflow step
 */
export interface StepResult {
  /** Step index (0-based) */
  stepIndex: number;
  /** Whether step succeeded */
  success: boolean;
  /** Component pattern type */
  patternType: ComponentPatternType;
  /** Resolution result */
  resolution?: ResolutionResult;
  /** Action result */
  action?: ActionResult;
  /** Time taken in ms */
  elapsedMs: number;
  /** Error message if failed */
  error?: string;
  /** AI recovery information */
  aiRecovery?: AIRecoveryInfo;
}

/**
 * Result of executing a complete workflow
 */
export interface WorkflowResult {
  /** Whether all steps succeeded */
  success: boolean;
  /** Number of steps completed */
  stepsCompleted: number;
  /** Total steps */
  totalSteps: number;
  /** Individual step results */
  stepResults: StepResult[];
  /** Total time taken in ms */
  totalElapsedMs: number;
  /** Failure summary if failed */
  failureSummary?: string;
  /** AI-suggested workflow adjustments */
  suggestedAdjustments?: WorkflowAdjustment[];
}

/**
 * Suggested workflow adjustment from AI
 */
export interface WorkflowAdjustment {
  /** Step index this adjustment applies to */
  stepIndex: number;
  /** Type of adjustment */
  type: 'update-selector' | 'add-wait' | 'update-coordinates' | 'add-scroll';
  /** Description of the adjustment */
  description: string;
  /** New value to apply */
  newValue?: string;
  /** Whether this was auto-applied */
  autoApplied: boolean;
  /** Confidence in this adjustment */
  confidence: number;
}

// ============================================================================
// Universal Step (combines all info)
// ============================================================================

/**
 * Universal workflow step with all execution information
 */
export interface UniversalStep {
  /** Step type (for backwards compatibility) */
  type: string;
  /** Human-readable description */
  description?: string;
  /** Component pattern detected */
  pattern: ComponentPattern;
  /** Path through DOM boundaries */
  domPath: DOMPath;
  /** Expected outcomes for verification */
  expectedOutcomes?: ExpectedOutcome[];
  /** Metadata */
  metadata: {
    timestamp: number;
    url: string;
    viewport?: { width: number; height: number };
    /** Recorded click coordinates for fallback */
    coordinates?: { x: number; y: number };
    /** Element bounds for fallback */
    elementBounds?: { x: number; y: number; width: number; height: number };
    /** Visual snapshot with optional annotations for AI Visual Click */
    visualSnapshot?: {
      viewport?: string;
      elementSnippet?: string;
      timestamp: number;
      viewportSize: { width: number; height: number };
      elementBounds?: { x: number; y: number; width: number; height: number };
      /** Annotated viewport with visual markers (red circle, crosshair) */
      annotated?: string;
      /** Annotated element snippet */
      annotatedSnippet?: string;
      /** Click point coordinates */
      clickPoint?: { x: number; y: number };
      /** Action type for marker styling */
      actionType?: 'click' | 'double-click' | 'type' | 'select' | 'scroll';
    };
    /** Element analysis for execution strategy optimization */
    elementAnalysis?: {
      executionStrategy: 'SIMPLE' | 'AI_RECOMMENDED' | 'AI_REQUIRED';
      confidence: number;
      reasons: string[];
      bestSelector?: string;
      fallbackSelectors?: string[];
    };
  };
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Options for element resolution
 */
export interface ResolutionOptions {
  /** Maximum time to wait for element (ms) */
  timeout?: number;
  /** Minimum confidence score required */
  minConfidence?: number;
  /** Whether to auto-pick best candidate when ambiguous */
  autoPickBest?: boolean;
  /** Document or container to search within */
  searchContext?: Document | Element;
}

/**
 * Options for action execution
 */
export interface ActionOptions {
  /** Maximum time for action to complete (ms) */
  timeout?: number;
  /** Expected outcomes to verify */
  expectedOutcomes?: ExpectedOutcome[];
  /** Whether to retry on failure */
  retry?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
}

/**
 * Options for workflow execution
 */
export interface WorkflowOptions {
  /** Stop on first failure */
  stopOnFailure?: boolean;
  /** Maximum time per step (ms) */
  stepTimeout?: number;
  /** Callback for step progress */
  onStepProgress?: (stepIndex: number, status: 'starting' | 'completed' | 'failed') => void;
  /** Callback for step error */
  onStepError?: (stepIndex: number, error: string) => void;
  /** Variable values for substitution */
  variableValues?: Record<string, string>;
  /** Enable AI self-healing (auto-recovery when elements not found) */
  enableAISelfHealing?: boolean;
  /** Auto-apply AI-suggested adjustments to workflow */
  autoApplyAdjustments?: boolean;
  /** Callback for AI suggestions */
  onAISuggestion?: (stepIndex: number, suggestion: WorkflowAdjustment) => void;
}

