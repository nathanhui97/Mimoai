/**
 * AI Agent Types
 * 
 * All types used by the AI Agent system, extracted for reuse across modules.
 */

import type { IframeContext } from '../../types/workflow';

// ============================================================================
// Action Types
// ============================================================================

/** Actions the agent can take */
export type AgentActionType = 
  | 'click' 
  | 'type' 
  | 'select' 
  | 'scroll' 
  | 'navigate' 
  | 'wait' 
  | 'assert' 
  | 'done' 
  | 'fail' 
  | 'skip' 
  | 'read' 
  | 'keyboard' 
  | 'hover'
  | 'tab_switch' // Multi-tab workflow support (for recorded TAB_SWITCH steps)
  | 'open_tab' // Open a new tab and navigate to URL
  // Spreadsheet-specific actions
  | 'click_cell'
  | 'find_and_click_empty'
  | 'find_by_header'
  | 'type_in_cell'
  | 'type_in_header_column'
  | 'type_in_next_empty'
  | 'read_cell'
  | 'batch_type';

// ============================================================================
// Semantic Target
// ============================================================================

/** 
 * Semantic target for element identification (DOM-based, not coordinates)
 * The AI returns these targets, and the executor uses locator resolution
 */
export interface SemanticTarget {
  // Primary identifiers (in priority order)
  role?: string;           // 'button', 'link', 'textbox', 'combobox'
  name?: string;           // Accessible name (label, aria-label, button text)
  testId?: string;         // data-testid attribute
  id?: string;             // id attribute
  
  // Secondary identifiers
  text?: string;           // Visible text content
  placeholder?: string;    // For inputs
  
  // Scope/context hints
  scopeHint?: string;      // Region to look in: "Sales Overview", "Header", "Modal"
  nearbyText?: string[];   // Text near the element for disambiguation
  
  // Disambiguation
  index?: number;          // 1-based index if multiple matches
  
  // Text matching mode
  textMatch?: 'exact' | 'contains' | 'startsWith' | 'fuzzy';
  
  /**
   * Recorded fallback selectors WITH container context.
   * These are CSS/XPath selectors that include the container/widget text.
   * e.g., "//div[descendant::*[contains(normalize-space(.), 'Widget Title')]]//button"
   * 
   * CRITICAL: These should be tried FIRST as they provide the most reliable disambiguation!
   */
  recordedFallbackSelectors?: string[];
}

// ============================================================================
// Expected Outcome
// ============================================================================

/** Expected outcome after an action (for verification) */
export interface ExpectedOutcome {
  // URL changes
  urlContains?: string;
  urlEquals?: string;
  
  // Content changes
  textAppears?: string;
  textDisappears?: string;
  
  // Modal/dialog changes
  modalAppears?: boolean;
  modalCloses?: boolean;
  
  // Element state changes
  elementAppears?: string;   // Selector or description
  elementDisappears?: string;
  
  // General
  waitMs?: number;          // Time to wait before checking
}

// ============================================================================
// Action Parameters
// ============================================================================

/** Parameters for each action type (DOM-based) */
export interface AgentActionParams {
  // For click - semantic target (NOT coordinates)
  target?: SemanticTarget;
  description?: string;     // What AI intends to click (for logging)
  
  // For type
  text?: string;
  fieldTarget?: SemanticTarget; // Which field to type into
  clearFirst?: boolean;     // Clear existing value first
  
  // For select (dropdown)
  option?: string;          // Option text to select
  
  // For scroll
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  scrollTarget?: SemanticTarget; // Element to scroll within
  scrollContainerSelector?: string; // CSS selector for scroll container (e.g., ".main-content")
  
  // For navigate
  url?: string;
  
  // For wait
  duration?: number;
  waitFor?: string;         // Text or element to wait for
  
  // For assert
  assertion?: string;       // What to check
  
  // For fail
  reason?: string;
  
  // For tab_switch
  toTabIndex?: number;      // Logical tab index to switch to
  toUrl?: string;           // URL of the tab to switch to
  toTitle?: string;         // Title of the tab
  isNewTab?: boolean;       // Was this a new tab creation (true) or switch to existing (false)?
  
  // For read - query element values
  attribute?: 'value' | 'text' | 'checked' | 'selected' | 'count';
  storeAs?: string;            // Optional: store in agent memory
  
  // For keyboard - Tab, Enter, Escape, shortcuts
  key?: 'Tab' | 'Enter' | 'Escape' | 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | string;
  modifiers?: Array<'ctrl' | 'shift' | 'alt' | 'meta'>;
  repeat?: number;             // Press key N times
  
  // For hover - reveal menus
  hoverDuration?: number;      // How long to hover (ms)
  waitForMenu?: boolean;        // Wait for menu to appear
  
  // For spreadsheet actions
  cellRef?: string;            // Cell reference like "B5", "A10"
  column?: string;             // Column letter like "A", "B"
  headerText?: string;         // Column header text
  rowOffset?: number;          // Row offset from header
  cells?: Array<{ cellRef: string; text: string }>;  // For batch operations
  
  // Expected outcome (for verification)
  expectedOutcome?: ExpectedOutcome;
  
  // Legacy: coordinates fallback (only used if DOM resolution fails AND VisionClicker enabled)
  x?: number;
  y?: number;
}

// ============================================================================
// Agent Action & Hint
// ============================================================================

/** An action decided by the agent */
export interface AgentAction {
  type: AgentActionType;
  params: AgentActionParams;
  reasoning: string;
  confidence: number;
  /** Which hint step this action corresponds to (if any) */
  hintStepIndex?: number;
}

/** A hint derived from recorded workflow steps */
export interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'select' | 'navigate' | 'scroll' | 'other';
  targetText?: string;
  targetRole?: string;
  targetPlaceholder?: string; // For input fields
  targetSelector?: string; // CSS/XPath selector
  value?: string;
  completed: boolean;
  skipped?: boolean;  // Marked when hint fails 3+ times and AI moves on
  failureCount?: number;  // Track how many times this hint has failed
  /** Screenshot from recording time (with annotation) */
  referenceScreenshot?: string;
  /** Click coordinates from recording */
  clickPoint?: { x: number; y: number };
  
  // New fields for candidate matching
  recordedSelector?: string;      // Primary CSS/XPath selector from recording
  recordedFallbackSelectors?: string[];  // Fallback selectors WITH container context (XPaths like //div[contains(.,"Widget Title")]//button)
  recordedTestId?: string;        // data-testid if captured
  recordedAriaLabel?: string;     // aria-label from recording (critical for exact matching)
  recordedScopeHint?: string;     // Scope from recording (e.g., "Accounts Table")
  recordedRowKey?: string;        // Row key if element was in a table row
  nearbyText?: string[];          // Nearby anchor text from recording
  
  // Natural language context (from AI translation)
  naturalLanguage?: {
    intent: string;           // "Open the promotion type dropdown"
    precondition: string;     // "Page must be on promotion tool"
    expectedOutcome: string;  // "Dropdown opens with BOGO, FLAT options"
    dependencies: number[];   // [0] (depends on step 0 being complete)
  };
  
  // For SCROLL actions
  scrollAmount?: number;      // Recorded scroll distance in pixels
  scrollDirection?: 'up' | 'down' | 'left' | 'right';
  scrollContainer?: string;   // CSS selector for scroll container (e.g., ".main-content")
  
  // NEW: Spreadsheet context (minimal - full state extracted during replay)
  spreadsheetContext?: {
    recordedIntent: {
      cellRef: string;
      columnHeader?: string;
      wasEmpty: boolean;
      wasAppendPosition: boolean;
      reasoning: string;
      column: string;
      columnDataType?: 'text' | 'number' | 'date' | 'mixed' | 'empty';
      lastDataRow?: number;
      firstEmptyRow?: number;
    };
  };
  
  // Iframe context - for cross-frame execution
  iframeContext?: IframeContext;
  
  // TAB_SWITCH context
  stepType?: 'TAB_SWITCH' | 'CLICK' | 'INPUT' | 'SCROLL' | 'KEYBOARD' | 'NAVIGATION';
  recordedPayload?: any; // Full recorded payload for TAB_SWITCH steps
}

// ============================================================================
// Observation
// ============================================================================

/** Current observation of the page (DOM-first, screenshot optional) */
export interface AgentObservation {
  // Page identity
  url: string;
  title: string;
  
  // DOM map (primary source of truth)
  domMapText: string;       // Simplified text representation for LLM
  
  // Modal/dialog context
  hasModal: boolean;
  modalTitle?: string;
  
  // CRITICAL: Dropdown context - must interact with open dropdown before other actions
  hasOpenDropdown: boolean;
  dropdownOptions?: string[];  // Available option texts
  
  // Form state
  formFields: Array<{
    name: string;
    value?: string;
    type: string;
  }>;
  
  // Available actions summary
  buttonCount: number;
  linkCount: number;
  inputCount: number;
  
  // Headings for context
  headings: string[];
  
  // Optional screenshot (only when DOM map insufficient)
  screenshot?: string;
  
  // Metadata
  viewportSize: { width: number; height: number };
  timestamp: number;
}

// ============================================================================
// History & State
// ============================================================================

/** A single entry in action history */
export interface ActionHistoryEntry {
  stepNumber: number;
  action: AgentAction;
  observation: AgentObservation;
  result: 'success' | 'failed' | 'pending';
  error?: string;
  timestamp: number;
}

/** Agent state during execution */
export interface AgentState {
  workflowId?: string;
  goal: string;
  hints: AgentHint[];
  history: ActionHistoryEntry[];
  currentHintIndex: number;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startTime: number;
  variableValues?: Record<string, string>;
  memory?: Record<string, string | boolean | number>; // Store values read during execution
}

// ============================================================================
// Result & Callbacks
// ============================================================================

/** Result of agent execution */
export interface AgentResult {
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  history: ActionHistoryEntry[];
  elapsedMs: number;
  finalStatus: AgentState['status'];
  error?: string;
}

/** Progress callback */
export type AgentProgressCallback = (
  stepNumber: number,
  action: AgentAction,
  status: 'thinking' | 'acting' | 'completed' | 'failed'
) => void;

// ============================================================================
// Execution Types
// ============================================================================

/** Result from executing an action */
export interface ExecutionResult {
  success: boolean;
  error?: string;
  element?: Element;
  value?: string | boolean | number;
}

/** Confidence calculation result */
export interface ConfidenceResult {
  confidence: number;
  reason: string;
  bestCandidate?: Element;
}

/** Ranked candidate element from DOM matching */
export interface RankedCandidate {
  index: number;
  score: number;
  role: string;
  name?: string;
  text?: string;
  attrs?: Record<string, string>;
  widgetTitle?: string;
  scopePath?: string[];
}



