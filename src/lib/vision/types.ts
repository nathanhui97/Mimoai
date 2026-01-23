/**
 * Vision System Core Types
 *
 * Shared types used across Eyes, Brain, and Hands components.
 */

// ============================================================================
// Basic Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundingBoxWithCenter extends BoundingBox {
  centerX: number;
  centerY: number;
}

// ============================================================================
// Screenshot Types
// ============================================================================

export interface Screenshot {
  /** Base64 encoded image data */
  data: string;

  /** When the screenshot was taken */
  timestamp: number;

  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };

  /** Current page URL */
  url: string;

  /** Current page title */
  title: string;

  /** Format of the image */
  format: 'png' | 'jpeg' | 'webp';
}

// ============================================================================
// Screen Understanding Types
// ============================================================================

export type PageType = 'form' | 'list' | 'detail' | 'dashboard' | 'login' | 'search' | 'other';

export type ComponentType =
  | 'button'
  | 'link'
  | 'text-field'
  | 'textarea'
  | 'password-field'
  | 'email-field'
  | 'number-field'
  | 'date-picker'
  | 'time-picker'
  | 'datetime-picker'
  | 'dropdown'
  | 'multi-select'
  | 'checkbox'
  | 'checkbox-group'
  | 'radio-group'
  | 'toggle'
  | 'slider'
  | 'file-upload'
  | 'table'
  | 'list'
  | 'modal'
  | 'dialog'
  | 'menu'
  | 'tab'
  | 'accordion'
  | 'image'
  | 'icon'
  | 'label'
  | 'heading'
  | 'paragraph'
  | 'other';

export type ComponentState =
  | 'enabled'
  | 'disabled'
  | 'focused'
  | 'selected'
  | 'checked'
  | 'unchecked'
  | 'expanded'
  | 'collapsed'
  | 'error'
  | 'loading'
  | 'readonly';

export interface VisualComponent {
  /** Type of UI component */
  type: ComponentType;

  /** Human-readable label */
  label: string;

  /** Detailed description */
  description: string;

  /** Location on screen */
  boundingBox: BoundingBoxWithCenter;

  /** Current state */
  state: ComponentState;

  /** Current value (for inputs) */
  value?: string;

  /** Available options (for dropdowns, radio groups, etc.) */
  options?: string[];

  /** Whether this is interactable */
  interactable: boolean;

  /** Whether this is required (for form fields) */
  required?: boolean;

  /** Placeholder text */
  placeholder?: string;

  /** Error message if in error state */
  errorMessage?: string;
}

export interface FormFieldState {
  /** Field label/name */
  label: string;

  /** Field type */
  type: ComponentType;

  /** Current value */
  value: string;

  /** Is it filled? */
  isFilled: boolean;

  /** Is it required? */
  required: boolean;

  /** Has error? */
  hasError: boolean;

  /** Error message */
  errorMessage?: string;

  /** Bounding box for clicking */
  boundingBox: BoundingBoxWithCenter;
}

export interface ModalInfo {
  /** Modal title */
  title: string;

  /** Modal description/content summary */
  description: string;

  /** Available actions in modal */
  actions: string[];

  /** Bounding box */
  boundingBox: BoundingBox;

  /** Is it dismissable? */
  dismissable: boolean;
}

export interface DropdownInfo {
  /** What triggered the dropdown */
  triggerLabel: string;

  /** Available options */
  options: Array<{
    label: string;
    selected: boolean;
    boundingBox: BoundingBoxWithCenter;
  }>;

  /** Is it searchable? */
  searchable: boolean;

  /** Is it multi-select? */
  multiSelect: boolean;
}

export interface ScreenUnderstanding {
  /** Type of page */
  pageType: PageType;

  /** Natural language description of the page */
  pageDescription: string;

  /** Application/site name if detectable */
  applicationName?: string;

  /** All visible interactive components */
  components: VisualComponent[];

  /** Current UI state */
  state: {
    /** Active modal if any */
    activeModal: ModalInfo | null;

    /** Open dropdown if any */
    activeDropdown: DropdownInfo | null;

    /** Currently focused element description */
    focusedElement: string | null;

    /** Visible error messages */
    visibleErrors: string[];

    /** Visible success messages */
    visibleSuccess: string[];

    /** Loading indicators present */
    isLoading: boolean;
  };

  /** Form state if this is a form page */
  formState: {
    /** All form fields */
    fields: FormFieldState[];

    /** Can the form be submitted? */
    isSubmittable: boolean;

    /** Missing required fields */
    missingRequired: string[];

    /** Submit button info */
    submitButton?: {
      label: string;
      boundingBox: BoundingBoxWithCenter;
      enabled: boolean;
    };
  } | null;

  /** What actions are possible from current state */
  possibleActions: string[];
}

// ============================================================================
// Element Location Types
// ============================================================================

export interface ElementLocation {
  /** Was the element found? */
  found: boolean;

  /** Bounding box with click coordinates */
  boundingBox?: BoundingBoxWithCenter;

  /** Confidence in the location (0-1) */
  confidence: number;

  /** Description of what was found */
  description: string;

  /** Why this location was chosen */
  reasoning?: string;

  /** Alternative locations if multiple matches */
  alternatives?: Array<{
    boundingBox: BoundingBoxWithCenter;
    confidence: number;
    description: string;
  }>;
}

// ============================================================================
// Action Types
// ============================================================================

export type ActionType =
  | 'click'
  | 'double-click'
  | 'right-click'
  | 'type'
  | 'clear-and-type'
  | 'press-key'
  | 'hotkey'
  | 'scroll-up'
  | 'scroll-down'
  | 'scroll-to'
  | 'hover'
  | 'drag'
  | 'wait'
  | 'verify'
  | 'done'
  | 'stuck';

export interface ActionIntent {
  /** Type of action to perform */
  type: ActionType;

  /** Target element description (for click, type, etc.) */
  targetDescription?: string;

  /** Value to type or select */
  value?: string;

  /** Key to press (for press-key action) */
  key?: string;

  /** Keys for hotkey (e.g., ['Control', 'a']) */
  keys?: string[];

  /** Scroll amount in pixels */
  scrollAmount?: number;

  /** Duration for wait action */
  waitMs?: number;

  /** What to verify (for verify action) */
  verifyCondition?: string;
}

export interface ActionResult {
  /** Did the action succeed? */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** How long the action took */
  durationMs: number;

  /** Coordinates where action was performed */
  coordinates?: Point;
}

// ============================================================================
// Decision Types
// ============================================================================

export interface Decision {
  /** The action to take */
  action: ActionIntent;

  /** Human-readable reasoning */
  reasoning: string;

  /** Confidence in this decision (0-1) */
  confidence: number;

  /** What we expect to happen */
  expectedOutcome: string;

  /** Alternative actions if this fails */
  alternatives?: ActionIntent[];
}

export interface VerificationResult {
  /** Did the action achieve its intent? */
  success: boolean;

  /** Confidence in this assessment */
  confidence: number;

  /** Explanation of what happened */
  explanation: string;

  /** Did the screen state change? */
  stateChanged: boolean;

  /** Did we make progress toward the goal? */
  progressMade: boolean;

  /** Is the overall goal achieved? */
  goalAchieved: boolean;

  /** New errors that appeared */
  newErrors?: string[];

  /** Success indicators that appeared */
  successIndicators?: string[];
}

// ============================================================================
// History Types
// ============================================================================

export interface ActionRecord {
  /** When this action was taken */
  timestamp: number;

  /** The decision that led to this action */
  decision: Decision;

  /** Where we clicked/typed */
  targetLocation?: ElementLocation;

  /** Result of the action */
  result: ActionResult;

  /** Screen state before action */
  beforeState: ScreenUnderstanding;

  /** Screen state after action */
  afterState: ScreenUnderstanding;

  /** Verification result */
  verification: VerificationResult;
}

// ============================================================================
// Agent Types
// ============================================================================

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stuck'
  | 'waiting-for-user';

export interface AgentProgress {
  /** Current status */
  status: AgentStatus;

  /** Actions executed so far */
  actionsExecuted: number;

  /** Current phase/milestone */
  currentPhase?: string;

  /** Percentage complete (0-100) */
  percentComplete: number;

  /** What the agent is currently doing */
  currentAction?: string;

  /** Last reasoning */
  lastReasoning?: string;

  /** Time elapsed */
  elapsedMs: number;
}

export interface AgentResult {
  /** Did we achieve the goal? */
  success: boolean;

  /** Was the goal fully achieved? */
  goalAchieved: boolean;

  /** Total actions executed */
  actionsExecuted: number;

  /** Total duration */
  durationMs: number;

  /** Complete history of actions */
  history: ActionRecord[];

  /** Final screen state */
  finalState: ScreenUnderstanding;

  /** Error if failed */
  error?: string;

  /** If stuck, what help is needed */
  helpNeeded?: string;
}

// ============================================================================
// Vision Execution Context - Rich context for intelligent execution
// ============================================================================

/**
 * Step guidance from recording analysis
 * Tells the vision AI HOW to execute each step
 */
export interface StepGuidance {
  /** Step index in the workflow */
  stepIndex: number;

  /** What this step is trying to accomplish */
  intent: string;

  /** Why this specific element was chosen */
  whyThisElement: string;

  /** Strategy for finding this element visually */
  elementFindingStrategy: {
    /** What to look for */
    lookingFor: string;
    /** Where on the page to search */
    searchContext: string;
    /** Visual distinguishers (color, icon, position) */
    distinguishers: string[];
    /** Text patterns to match */
    textPatterns: string[];
    /** Type of element (button, input, link, etc.) */
    elementType: string;
  };

  /** Conditions that must be true before executing */
  preconditions: string[];

  /** What should happen after this step */
  expectedOutcome: string;

  /** Alternative approaches if primary fails */
  alternatives: string[];

  /** How critical is this step? */
  criticality?: 'critical' | 'important' | 'optional';
}

/**
 * Rich execution context - everything the vision AI needs to know
 * This bridges WorkflowMemory (recording output) to VisionAgent (execution)
 */
export interface VisionExecutionContext {
  // ─────────────────────────────────────────────────────────────
  // Task Identity
  // ─────────────────────────────────────────────────────────────

  /** Task identification */
  task: {
    /** Human-readable name */
    name: string;
    /** What this task accomplishes */
    description: string;
    /** Domain/application (e.g., "Salesforce CRM") */
    domain: string;
    /** Primary goal */
    goal: string;
  };

  // ─────────────────────────────────────────────────────────────
  // Current Phase with Full Guidance
  // ─────────────────────────────────────────────────────────────

  /** Current phase being executed */
  currentPhase: {
    /** Phase name */
    name: string;
    /** Phase intent/purpose */
    intent: string;
    /** Step indices in this phase */
    stepIndices: number[];
    /** Per-step guidance for this phase */
    stepGuidance: StepGuidance[];
  };

  // ─────────────────────────────────────────────────────────────
  // User-Taught Knowledge (from Q&A and clarifications)
  // ─────────────────────────────────────────────────────────────

  /** Knowledge from user teaching */
  knowledge: {
    /** Rules the user taught (e.g., "Lead Source should always be 'Web'") */
    rules: string[];
    /** Tips for execution */
    tips: string[];
    /** Things to avoid */
    warnings: string[];
  };

  // ─────────────────────────────────────────────────────────────
  // Success/Failure Criteria
  // ─────────────────────────────────────────────────────────────

  /** How to know if we succeeded */
  successCriteria: {
    /** Primary and secondary success indicators */
    indicators: Array<{
      type: string;
      description: string;
      pattern?: string;
      priority?: 'primary' | 'secondary' | 'fallback';
    }>;
    /** What indicates failure */
    failureIndicators: string[];
    /** Expected end state */
    endState: string;
  };

  // ─────────────────────────────────────────────────────────────
  // Adaptation Strategies
  // ─────────────────────────────────────────────────────────────

  /** How to adapt when things go wrong */
  adaptations: Array<{
    /** When to use this adaptation */
    scenario: string;
    /** What to do */
    howToAdapt: string;
    /** Which steps this applies to */
    affectedSteps: number[];
  }>;

  // ─────────────────────────────────────────────────────────────
  // Demonstration Reference (How user showed it)
  // ─────────────────────────────────────────────────────────────

  /** How the user demonstrated this task */
  demonstration: Array<{
    /** Step index */
    stepIndex: number;
    /** Action type (click, type, etc.) */
    action: string;
    /** Target description */
    target: string;
    /** Value if applicable */
    value?: string;
    /** UI context (e.g., "in the header", "Account Information section") */
    context?: string;
    /** Screenshot captured during recording (visual reference) */
    referenceScreenshot?: {
      /** Full viewport screenshot */
      viewport?: string;
      /** Cropped element snippet */
      elementSnippet?: string;
    };
  }>;

  // ─────────────────────────────────────────────────────────────
  // Past Experience (Learning from executions)
  // ─────────────────────────────────────────────────────────────

  /** Experience from past executions */
  experience: {
    /** How many times this has been executed */
    timesExecuted: number;
    /** Success rate (0-1) */
    successRate: number;
    /** Common issues encountered */
    commonIssues: string[];
    /** Strategies that worked */
    provenFixes: string[];
  };

  // ─────────────────────────────────────────────────────────────
  // Current Execution State
  // ─────────────────────────────────────────────────────────────

  /** User-provided variable values */
  variables: Record<string, string>;

  /** Current phase index (0-based) */
  phaseIndex: number;

  /** Total number of phases */
  totalPhases: number;

  /** Recent action history */
  recentHistory: Array<{
    action: string;
    reasoning: string;
    success: boolean;
  }>;
}
