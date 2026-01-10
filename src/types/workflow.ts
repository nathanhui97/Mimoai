/**
 * Workflow types for GhostWriter Extension
 */

import type { ShadowPath } from '../content/shadow-dom-utils';
import type { 
  PageType, 
  VisualImportance, 
  VisualFlow, 
  VisualContext as VisualCtx,
  WorkflowIntent as VisualWorkflowIntent 
} from './visual';
import type { WorkflowVariables } from '../lib/variable-detector';
// Reliable Replayer types
import type { LocatorBundle } from './locator';
import type { Intent, StepGoal } from './intent';
import type { Scope } from './scope';
import type { SuggestedCondition } from './conditions';

export type WorkflowStepType = 'CLICK' | 'INPUT' | 'NAVIGATION' | 'KEYBOARD' | 'SCROLL' | 'TAB_SWITCH';

export interface ElementState {
  visible: boolean;
  enabled: boolean;
  readonly?: boolean;
  checked?: boolean;
}

export interface WaitCondition {
  type: 'element' | 'text' | 'url' | 'time';
  selector?: string; // For 'element' type
  text?: string; // For 'text' type
  url?: string; // For 'url' type (can be pattern)
  timeout?: number; // Max wait time in ms
}

export interface EventDetails {
  mouseButton?: 'left' | 'right' | 'middle';
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }; // Only included if at least one modifier is true
  coordinates?: { x: number; y: number }; // Click coordinates
  eventSequence?: ('mousedown' | 'focus' | 'mouseup' | 'click')[];
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX?: number; // Only included if non-zero
  scrollY?: number; // Only included if non-zero
  // 🎯 Scroll delta for exact replay (how much user actually scrolled)
  scrollDeltaX?: number; // Positive = right, Negative = left
  scrollDeltaY?: number; // Positive = down, Negative = up
  elementScrollContainer?: {
    selector: string;
    scrollTop?: number; // Only included if non-zero
    scrollLeft?: number; // Only included if non-zero
    // 🎯 Scroll delta for container scrolls
    scrollDeltaX?: number;
    scrollDeltaY?: number;
  };
}

export interface InputDetails {
  type: string; // 'text', 'number', 'email', 'date', etc.
  required?: boolean;
  min?: number | string;
  max?: number | string;
  pattern?: string; // regex pattern
  step?: number; // for number inputs
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  // top, left, right, bottom removed - can be computed from x, y, width, height
  // top = y, left = x, right = x + width, bottom = y + height
}

export interface IframeContext {
  selector: string;
  src?: string;
  name?: string;
  index?: number; // if multiple iframes
  frameId?: number; // Chrome's internal frame ID - used for cross-frame execution
}

export interface TimingInfo {
  delayAfter?: number; // ms to wait after this step
  animationWait?: boolean; // wait for CSS animations
  networkWait?: boolean; // wait for network requests
}

export interface KeyboardDetails {
  key: string; // 'Enter', 'Tab', 'Escape', etc.
  code: string; // 'Enter', 'TabLeft', etc.
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

export interface RetryStrategy {
  maxRetries?: number;
  retryDelay?: number;
  // retrySelectors removed - replayer uses fallbackSelectors directly
}

export interface NetworkConditions {
  waitForRequests?: boolean;
  requestPatterns?: string[]; // URL patterns to wait for
  timeout?: number;
}

export interface PageState {
  readyState: 'loading' | 'interactive' | 'complete';
  loadTime?: number; // time since page load
}

export interface FocusEvents {
  needsFocus?: boolean;
  needsBlur?: boolean;
}

export interface TabSwitchPayload {
  fromUrl: string;
  toUrl: string;
  fromTitle?: string;
  toTitle?: string;
  fromTabIndex?: number; // Logical index (Tab 0, Tab 1, etc.)
  toTabIndex?: number; // Logical index
  isNewTab?: boolean; // Was this a new tab creation (true) or switch to existing tab (false)?
  timestamp: number;
}

export interface AIEvidence {
  /** Simplified/distilled DOM structure for AI context understanding */
  contextSnapshot?: string;
  
  /** Metadata about clipboard operations (copy/paste) */
  clipboardMetadata?: {
    sourceSelector?: string; // Where the data was copied from
    copiedValue?: string; // The value that was copied
    timestamp: number; // When the copy occurred
  };
  
  /** Semantic anchors for element identification */
  semanticAnchors?: {
    textLabel?: string; // Human-readable label
    nearbyText?: string[]; // Array of nearby text content
    ariaLabel?: string; // ARIA label if present
  };
}

/**
 * AI-identified widget context captured during recording
 * This is much more reliable than CSS heuristics for widget identification
 */
export interface AIWidgetContext {
  /** Exact title/heading of the widget as identified by AI Vision */
  widgetTitle: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Description of the widget for debugging */
  widgetDescription?: string;
  /** Visual position description (e.g., "top-left", "center") */
  visualPosition?: string;
  /** Unique visual features for additional matching */
  uniqueFeatures?: string[];
  /** If no widget container was identified */
  noWidgetFound?: boolean;
  /** How the context was identified: ai-vision or fallback-dom */
  identifiedBy: 'ai-vision' | 'fallback-dom';
  /** Timestamp when identified */
  identifiedAt: number;
}

export interface WorkflowStepPayload {
  selector: string; // The best stable selector
  // Legacy fields - kept for backward compatibility, replaced by locatorBundle
  fallbackSelectors?: string[]; // Deprecated: use locatorBundle.strategies
  xpath?: string; // Deprecated: use locatorBundle.strategies (xpath type)
  label?: string; // "Client Name"
  value?: string; // "Acme Corp"
  timestamp: number;
  url: string;
  tabUrl?: string; // Tab URL where this step was recorded (stable identifier, not tabId)
  tabTitle?: string; // Tab title for additional context
  tabInfo?: { url: string; title: string }; // Tab context (URL-based, not ID-based)
  tabIndex?: number; // Logical tab index for multi-tab workflows (Tab 0, Tab 1, etc.)
  shadowPath?: ShadowPath[]; // Path through shadow boundaries
  elementState?: ElementState; // Element state at time of recording
  elementText?: string; // Exact text content of the element (for buttons, links, labels)
  // Legacy: waitConditions removed - StateWaitEngine handles waits dynamically at execution
  // Phase 1: Critical fixes
  eventDetails?: EventDetails; // Event sequence and details
  viewport?: ViewportInfo; // Viewport dimensions and scroll position
  // Phase 2: Important fixes
  inputDetails?: InputDetails; // Input type and validation (for INPUT steps)
  elementBounds?: ElementBounds; // Element bounding box
  iframeContext?: IframeContext; // Iframe information
  timing?: TimingInfo; // Timing and delay information
  keyboardDetails?: KeyboardDetails; // Keyboard event details (for KEYBOARD steps)
  // Phase 2: Visual snapshots for AI reliability
  visualSnapshot?: {
    viewport?: string; // Base64 data URL of viewport
    elementSnippet?: string; // Base64 data URL of element + context (cropped)
    timestamp: number; // When snapshot was taken
    viewportSize: { width: number; height: number }; // Viewport dimensions
    elementBounds?: ElementBounds; // Element position in viewport
    // Phase 7: Visual annotations for AI Visual Click
    annotated?: string; // Base64 data URL of viewport with visual markers (red circle, crosshair, etc.)
    annotatedSnippet?: string; // Base64 data URL of element snippet with visual markers
    clickPoint?: { x: number; y: number }; // Where user clicked (viewport coordinates)
    actionType?: 'click' | 'double-click' | 'type' | 'select' | 'scroll'; // Type of action for marker styling
  };
  // Phase 4: Human-like visual understanding
  pageType?: PageType; // Page classification (form, dashboard, table, etc.)
  visualImportance?: VisualImportance; // Visual prominence scores
  visualFlow?: VisualFlow; // Before/after state tracking
  visualContext?: VisualCtx; // Nearby elements and landmarks
  // Phase 3: Minor enhancements
  elementRole?: string; // Element's own role attribute
  retryStrategy?: RetryStrategy; // Retry configuration
  networkConditions?: NetworkConditions; // Network request monitoring
  pageState?: PageState; // Page load state
  focusEvents?: FocusEvents; // Focus/blur requirements
  context?: {
    siblings?: { before?: string[]; after?: string[] }; // Optional arrays - only included if they have content
    parent?: {
      selector: string;
      text?: string;
      attributes?: Record<string, string>;
      index?: number; // Position among similar parents
      state?: {
        expanded?: boolean;
        visible?: boolean;
        enabled?: boolean;
      };
    };
    ancestors?: Array<{
      selector: string;
      text?: string;
      role?: string; // e.g., "dashboard", "widget", "container"
    }>;
    container?: {
      // For menu buttons, identify which dashboard/widget contains it
      selector: string; // e.g., "gridster-item#w26"
      text?: string; // e.g., "STORE LIST - PORTFOLIO"
      type?: string; // e.g., "dashboard", "widget", "table"
      index?: number; // Which dashboard (1st, 2nd, etc.)
    };
    position?: { index: number; total: number; type: string };
    surroundingText?: string;
    uniqueAttributes?: Record<string, string>;
    formContext?: {
      formId?: string;
      fieldset?: string;
      section?: string;
      isValid?: boolean;
      isSubmitting?: boolean;
    };
    // Semantic coordinates for AI interpretation
    gridCoordinates?: {
      rowIndex?: number;
      columnIndex?: number;
      cellReference?: string; // "A1", "B2"
      columnHeader?: string; // "Price", "Product Name"
      rowHeader?: string; // If row has header
      isHeader?: boolean;
    };
    formCoordinates?: {
      label?: string;
      fieldOrder?: number;
      fieldset?: string;
      section?: string;
    };
    tableCoordinates?: {
      rowIndex?: number;
      columnIndex?: number;
      headerRow?: number;
      headerColumn?: number;
    };
    // Decision space for list items/options (AI context)
    decisionSpace?: {
      type: 'LIST_SELECTION';
      options: string[]; // All available options in the container
      selectedIndex: number; // 0-indexed position of selected option
      selectedText: string; // Text of the selected option
      containerSelector?: string; // Selector for the container (dropdown, list, etc.)
    };
    // Button context (Interactive Section Anchoring - for generic div buttons in Salesforce/React)
    buttonContext?: {
      section?: string; // Section header (e.g., "Account Information")
      label?: string; // Button text or aria-label
      role?: string; // ARIA role if present
    };
  };
  similarity?: {
    similarCount: number; // How many similar elements exist
    uniquenessScore: number; // 0-1 score of how unique this element is
    disambiguation: string[]; // Attributes/text that make it unique
  };
  // Phase 6: AI Evidence capture
  aiEvidence?: AIEvidence; // AI context for better understanding and replay
  
  // Phase 8: AI-powered widget identification (captured during recording)
  aiWidgetContext?: AIWidgetContext; // AI-identified widget/container context for reliable execution
  
  // Reliable Replayer enhancements
  locatorBundle?: LocatorBundle;           // Multiple strategies with runtime-scorable features
  intent?: Intent;                         // Machine-readable goal (CLICK, OPEN_ROW_ACTIONS, etc.)
  stepGoal?: StepGoal;                     // Complete goal description with expected outcome
  scope?: Scope;                           // Container scope (modal, table row, widget, etc.)
  suggestedCondition?: SuggestedCondition; // Auto-detected success condition
  disambiguators?: string[];               // Nearby text for filtering ambiguous matches
  expectedOutcomes?: import('../types/universal-types').ExpectedOutcome[]; // Auto-generated outcomes from before/after diffing
  
  // Locator quality metadata
  locatorQuality?: {
    hasStableAttributes: boolean;    // Uses data-testid, aria-label, name, id
    hasUniqueMatch: boolean;         // Selector matched exactly one element at record time
    hasDynamicParts: boolean;        // Selector contains generated IDs or dynamic parts
    strategiesAvailable: number;      // How many locator strategies were found
    confidenceScore: number;          // 0-1 overall confidence in element finding
  };
  
  // Element analysis for execution strategy optimization
  elementAnalysis?: {
    executionStrategy: 'SIMPLE' | 'AI_RECOMMENDED' | 'AI_REQUIRED';
    confidence: number; // 0-100
    reasons: string[];
    bestSelector?: string;
    fallbackSelectors?: string[];
  };
  
  // NEW: Spreadsheet context for AI comprehension (only present on sheet domains)
  // NOTE: Stores minimal intent data only. Full sheet state is extracted fresh during replay.
  spreadsheetContext?: {
    recordedIntent: {
      cellRef: string;
      columnHeader?: string;
      wasEmpty: boolean;
      wasAppendPosition: boolean;
      reasoning: string;
      // Minimal column info for intent verification
      column: string;
      columnDataType?: 'text' | 'number' | 'date' | 'mixed' | 'empty';
      lastDataRow?: number;
      firstEmptyRow?: number;
    };
  };
  
  // Unified Interaction Type Detection
  // Detected once during recording to eliminate fragmented detection logic
  interactionType?: import('../content/interaction-detector').InteractionType;
}

export interface Pattern {
  type: 'repetitive' | 'sequential' | 'template' | 'unique';
  sequenceType?: 'row' | 'column' | 'grid' | 'none';
  stepCount: number;
  dataVariation: string[];
  confidence: number; // 0-1
}

export interface ExecutionPolicy {
  strategy: 'DYNAMIC_LOCATOR' | 'EXACT_REPLAY' | 'HYBRID';
  tool: string; // Tool name from standard library (e.g., "find_grid_cell", "find_next_empty_row")
  params: Record<string, any>; // Tool-specific parameters
}

export interface WorkflowIntent {
  intent: string; // Human-readable description
  pattern: 'repetitive' | 'sequential' | 'template' | 'unique';
  mode: 'exact' | 'adaptive' | 'hybrid';
  confidence: number; // 0-1
  policy?: ExecutionPolicy; // Tool-use pattern for adaptive execution
}

/** Natural language context for better AI agent understanding */
export interface NaturalLanguageContext {
  /** What the user is trying to accomplish with this step */
  intent: string;
  /** What must be true before this step can execute */
  precondition: string;
  /** What should happen after this step succeeds */
  expectedOutcome: string;
  /** Indices of steps this depends on (e.g., [0, 1] means depends on steps 0 and 1) */
  dependencies: number[];
  /** Alternative ways to describe this step for matching */
  alternateDescriptions?: string[];
  /** Flag indicating the user manually edited this instruction */
  userEdited?: boolean;
}

export interface WorkflowStep {
  type: WorkflowStepType;
  payload: WorkflowStepPayload | TabSwitchPayload; // TabSwitchPayload for TAB_SWITCH steps
  description?: string; // AI-generated natural language description
  /** Natural language translation for AI agent (added after recording stops) */
  naturalLanguage?: NaturalLanguageContext;
}

/**
 * Type guard to check if payload is WorkflowStepPayload (not TabSwitchPayload)
 */
export function isWorkflowStepPayload(payload: WorkflowStepPayload | TabSwitchPayload): payload is WorkflowStepPayload {
  return 'selector' in payload && 'url' in payload;
}

/**
 * Metadata about an optimization decision
 */
export interface OptimizationMapEntry {
  /** Indices of original steps that were optimized */
  originalIndices: number[];
  /** Index in the optimized workflow (-1 if removed entirely) */
  optimizedIndex: number;
  /** Reason for the optimization */
  reason: string;
  /** How the decision was made */
  decisionMethod: 'rule-based' | 'ai-powered' | 'hybrid';
  /** AI confidence if AI was used */
  aiConfidence?: number;
}

/**
 * Metadata about the optimization process
 */
export interface OptimizationMetadata {
  /** When the analysis was performed */
  analyzedAt: number;
  /** Number of navigation sequences found */
  sequencesFound: number;
  /** Number of sequences that were optimized */
  sequencesOptimized: number;
  /** Total number of steps removed */
  stepsRemoved: number;
  /** Whether AI analysis was used */
  aiAnalysisUsed: boolean;
  /** Average AI confidence (if AI was used) */
  aiConfidenceAvg?: number;
  /** Detailed optimization map */
  optimizationMap: OptimizationMapEntry[];
}

export interface SavedWorkflow {
  id: string; // Unique identifier (timestamp or UUID)
  name: string; // User-provided name
  description?: string; // AI-generated task summary explaining what the workflow does
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  steps: WorkflowStep[]; // Array of recorded steps
  // Phase 4: Human-like visual understanding
  analyzedIntent?: VisualWorkflowIntent; // AI-inferred workflow intent
  pageTypeHistory?: PageType[]; // Page types encountered during recording
  // Phase 5: Variable detection and parameterization
  variables?: WorkflowVariables; // Detected variables for parameterized execution
  // Navigation optimization
  optimizedSteps?: WorkflowStep[]; // Optimized version of workflow steps for playback
  optimizationMetadata?: OptimizationMetadata; // Metadata about the optimization process
}

