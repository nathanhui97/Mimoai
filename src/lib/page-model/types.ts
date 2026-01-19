/**
 * Page Model Types - Shared interfaces for the Unified Page Understanding System
 *
 * This module defines the core types for:
 * - PageModel: The unified view of the current page state
 * - Signal aggregation: Merging perception signals from multiple sources
 * - Element relationships: Semantic relationships between DOM elements
 * - Expectations: Predictive verification based on page type + action
 * - UI State: Modal, dropdown, loading, error states
 */

import type { BoundingBox, PageRegions as VisualPageRegions } from '../../types/visual';
import type { DOMMap, DOMMapElement } from '../../content/dom-map';

// Re-export BoundingBox for consumers
export type { BoundingBox };

// ============================================================================
// Core Page Model Types
// ============================================================================

/**
 * Page type classification
 * Identifies the type of page to inform execution strategies
 */
export type PageTypeEnum =
  | 'form'           // Form-heavy page (inputs, dropdowns, submit buttons)
  | 'dashboard'      // Dashboard with widgets, cards, charts
  | 'data_table'     // Data table/grid with rows and columns
  | 'wizard'         // Multi-step wizard/flow
  | 'modal'          // Modal dialog (overlays main content)
  | 'list'           // List view (vertical list of items)
  | 'settings'       // Settings/configuration page
  | 'login'          // Login/authentication page
  | 'search'         // Search results page
  | 'article'        // Article/content page
  | 'navigation'     // Navigation/menu page
  | 'spreadsheet'    // Spreadsheet (Google Sheets, Excel Online)
  | 'unknown';       // Unable to classify

/**
 * Page type with confidence and characteristics
 */
export interface PageType {
  type: PageTypeEnum;
  confidence: number;           // 0-1, how confident we are in this classification
  subType?: string;             // More specific (e.g., "invoice_form", "user_dashboard")
  characteristics: string[];    // Key signals that led to this classification
}

/**
 * Unified page regions - merged from DOM and visual analysis
 */
export interface UnifiedRegions {
  header?: RegionInfo;
  sidebar?: RegionInfo;
  mainContent?: RegionInfo;
  footer?: RegionInfo;
  navigation?: RegionInfo;
  actionBar?: RegionInfo;
  formArea?: RegionInfo;
  tableArea?: RegionInfo;
  modal?: RegionInfo;           // Currently active modal
  dropdown?: RegionInfo;        // Currently open dropdown
}

/**
 * Information about a detected page region
 */
export interface RegionInfo {
  bounds: BoundingBox;
  source: 'dom' | 'visual' | 'merged';  // Where this region was detected from
  confidence: number;                    // 0-1
  elements?: DOMMapElement[];            // Interactive elements in this region
  role?: string;                         // Semantic role (banner, main, etc.)
  name?: string;                         // Accessible name or heading
}

// ============================================================================
// UI State Types
// ============================================================================

/**
 * Current UI state - tracks transient states like modals, dropdowns, loading
 */
export interface UIState {
  // Modal/Dialog state
  hasModal: boolean;
  modalInfo?: {
    title?: string;
    type: 'dialog' | 'alert' | 'confirm' | 'drawer' | 'popup';
    isPersistentPanel: boolean;  // True if always visible (not a blocking popup)
    bounds?: BoundingBox;
    elements: DOMMapElement[];
  };

  // Dropdown state
  hasOpenDropdown: boolean;
  dropdownInfo?: {
    triggerName?: string;
    triggerElement?: ElementIdentifier;
    options: DOMMapElement[];
    bounds?: BoundingBox;
    optionTexts: string[];      // Plain text list for quick matching
  };

  // Loading state
  isLoading: boolean;
  loadingIndicators: Array<{
    type: 'spinner' | 'skeleton' | 'progress' | 'overlay';
    bounds?: BoundingBox;
  }>;

  // Error state
  hasError: boolean;
  errorInfo?: {
    message: string;
    type: 'validation' | 'network' | 'permission' | 'unknown';
    bounds?: BoundingBox;
  };

  // Focus state
  focusedElement?: ElementIdentifier;

  // Toast/notification state
  hasToast: boolean;
  toastInfo?: {
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    bounds?: BoundingBox;
  };
}

/**
 * Minimal element identifier for tracking focus, triggers, etc.
 */
export interface ElementIdentifier {
  selector?: string;
  role?: string;
  name?: string;
  testId?: string;
  id?: string;
}

// ============================================================================
// Element Relationship Types
// ============================================================================

/**
 * Relationship type between two elements
 */
export type RelationshipType =
  | 'labels'          // label -> input (label[for], aria-labelledby)
  | 'triggers'        // button -> dropdown/modal
  | 'contains'        // form -> fieldset -> inputs (parent-child)
  | 'controls'        // tab -> tabpanel (aria-controls)
  | 'describes'       // help text -> input (aria-describedby)
  | 'filters'         // search box -> list
  | 'groups'          // fieldset groups related inputs
  | 'owns';           // aria-owns relationship

/**
 * A single relationship between two elements
 */
export interface ElementRelationship {
  source: ElementIdentifier;
  target: ElementIdentifier;
  relationship: RelationshipType;
  confidence: number;           // 0-1, how confident we are in this relationship
  metadata?: {
    labelText?: string;         // For labels relationship
    controlsId?: string;        // For controls relationship
  };
}

/**
 * Graph of element relationships
 */
export interface RelationshipGraph {
  relationships: ElementRelationship[];

  // Quick lookup maps
  bySourceSelector: Map<string, ElementRelationship[]>;
  byTargetSelector: Map<string, ElementRelationship[]>;
  byType: Map<RelationshipType, ElementRelationship[]>;
}

// ============================================================================
// Expectation Types
// ============================================================================

/**
 * Predicted transition after an action
 */
export interface PredictedTransition {
  trigger: {
    actionType: string;         // 'click', 'type', 'select', etc.
    targetRole?: string;        // Role of target element
    targetText?: string;        // Text of target element
  };
  expectedOutcome: ExpectedOutcome;
  confidence: number;           // 0-1
  timeoutMs: number;            // How long to wait for this outcome
}

/**
 * Expected outcome after an action
 */
export interface ExpectedOutcome {
  type: ExpectedOutcomeType;
  details?: {
    // For modal outcomes
    modalOpens?: boolean;
    modalCloses?: boolean;

    // For dropdown outcomes
    dropdownOpens?: boolean;
    dropdownCloses?: boolean;

    // For navigation outcomes
    urlContains?: string;
    urlChanges?: boolean;

    // For content outcomes
    textAppears?: string;
    textDisappears?: string;
    elementAppears?: string;      // Selector or description
    elementDisappears?: string;

    // For value outcomes
    valueUpdates?: boolean;
    valueEquals?: string;

    // For loading outcomes
    loadingStarts?: boolean;
    loadingEnds?: boolean;
  };
}

export type ExpectedOutcomeType =
  | 'modal_opens'
  | 'modal_closes'
  | 'dropdown_opens'
  | 'dropdown_closes'
  | 'value_updates'
  | 'navigation'
  | 'loading_starts'
  | 'loading_ends'
  | 'content_appears'
  | 'content_disappears'
  | 'error_appears'
  | 'success_message'
  | 'page_stable'
  | 'custom';

// ============================================================================
// Expectation Rules (Page Type + Action -> Expected Outcome)
// ============================================================================

/**
 * Rule for generating expectations based on page type and action
 */
export interface ExpectationRule {
  pageTypes: PageTypeEnum[];    // Which page types this rule applies to
  actionType: string;           // Which action type triggers this rule
  targetRole?: string;          // Optional: only for specific target roles
  targetTextPattern?: RegExp;   // Optional: only when target text matches

  // What to expect
  expectedOutcome: ExpectedOutcome;

  // Timing
  minWaitMs: number;            // Minimum wait before checking
  maxWaitMs: number;            // Maximum wait for outcome

  // Priority (higher = checked first)
  priority: number;
}

// ============================================================================
// Page Model (Main Interface)
// ============================================================================

/**
 * The unified PageModel - single source of truth for page understanding
 */
export interface PageModel {
  // Core state
  pageType: PageType;
  regions: UnifiedRegions;
  uiState: UIState;
  elementRelationships: RelationshipGraph;

  // Derived understanding
  activeContext: 'form' | 'table' | 'modal' | 'navigation' | 'content' | 'dropdown';
  primaryActionZone?: BoundingBox;  // Where user is likely to interact

  // Proactive intelligence
  pendingTransitions: PredictedTransition[];

  // Raw data (for debugging/fallback)
  rawDOMMap?: DOMMap;
  rawVisualRegions?: VisualPageRegions;

  // Metadata
  confidence: number;           // 0-1, overall confidence in this model
  lastUpdated: number;          // Timestamp
  staleness: 'fresh' | 'recent' | 'stale';
  generationTimeMs: number;     // How long it took to generate this model
}

// ============================================================================
// Events (for Continuous Observer)
// ============================================================================

/**
 * Events emitted by the continuous observer
 */
export type PageModelEvent =
  | { type: 'modal:appeared'; modal: UIState['modalInfo'] }
  | { type: 'modal:closed' }
  | { type: 'dropdown:opened'; dropdown: UIState['dropdownInfo'] }
  | { type: 'dropdown:closed' }
  | { type: 'loading:started' }
  | { type: 'loading:finished' }
  | { type: 'error:appeared'; error: UIState['errorInfo'] }
  | { type: 'error:cleared' }
  | { type: 'toast:appeared'; toast: UIState['toastInfo'] }
  | { type: 'toast:closed' }
  | { type: 'focus:changed'; element: ElementIdentifier }
  | { type: 'page:navigated'; url: string }
  | { type: 'dom:significant_change' }
  | { type: 'page_type:changed'; from: PageTypeEnum; to: PageTypeEnum };

/**
 * Listener for page model events
 */
export type PageModelEventListener = (event: PageModelEvent) => void;

// ============================================================================
// Signal Aggregation Types
// ============================================================================

/**
 * Raw signals from different perception sources
 */
export interface PerceptionSignals {
  domMap: DOMMap;
  visualRegions?: VisualPageRegions;
  timestamp: number;
}

/**
 * Configuration for the PageModel system
 */
export interface PageModelConfig {
  // Cache settings
  cacheTTLMs: number;           // How long to cache the model (default: 200ms)

  // Feature flags
  enableContinuousObserver: boolean;
  enableRelationshipGraph: boolean;
  enableExpectationEngine: boolean;

  // Performance settings
  observerThrottleMs: number;   // Throttle for continuous observer (default: 100ms)
  maxRelationshipsPerElement: number;  // Limit relationship graph size

  // Debug settings
  logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Default configuration
 */
export const DEFAULT_PAGE_MODEL_CONFIG: PageModelConfig = {
  cacheTTLMs: 200,
  enableContinuousObserver: true,
  enableRelationshipGraph: true,
  enableExpectationEngine: true,
  observerThrottleMs: 100,
  maxRelationshipsPerElement: 10,
  logLevel: 'warn',
};

// ============================================================================
// Recording Context Types
// ============================================================================

/**
 * PageModel context captured during recording
 * This enriches recorded steps with understanding of WHY this element was chosen
 */
export interface RecordedPageModelContext {
  // Level 2: Page Context
  pageType: PageTypeEnum;
  pageTypeConfidence: number;
  activeContext: 'form' | 'table' | 'modal' | 'navigation' | 'content' | 'dropdown';

  // UI State at recording time
  uiStateSnapshot: {
    hasModal: boolean;
    modalTitle?: string;
    hasOpenDropdown: boolean;
    dropdownTriggerName?: string;
    isLoading: boolean;
    hasError: boolean;
  };

  // Region where element was found
  regionName?: 'header' | 'sidebar' | 'mainContent' | 'footer' | 'navigation' | 'actionBar' | 'formArea' | 'tableArea' | 'modal' | 'dropdown';
  regionConfidence?: number;
}

/**
 * Element relationships captured during recording
 * Helps understand HOW this element relates to others
 */
export interface RecordedElementRelationships {
  // What labels this element
  labeledBy?: {
    text: string;
    selector?: string;
    relationship: 'label_for' | 'aria_labelledby' | 'aria_describedby' | 'visual_proximity';
  };

  // What this element triggers/controls
  triggers?: {
    description: string;      // "Opens dropdown menu", "Submits form"
    targetSelector?: string;
    relationship: 'aria_controls' | 'triggers_dropdown' | 'triggers_modal' | 'submits_form';
  };

  // Container hierarchy
  containedBy?: {
    description: string;      // "Inside 'Account Information' section"
    selector?: string;
    containerType: 'form' | 'fieldset' | 'section' | 'modal' | 'widget' | 'table' | 'row';
  };

  // Sibling relationships
  groupedWith?: {
    description: string;      // "Part of radio group 'Payment Method'"
    siblingCount: number;
    groupSelector?: string;
  };
}

/**
 * Alternative elements that could have matched
 * Helps replay adapt when exact element not found
 */
export interface RecordedAlternatives {
  // Similar elements that exist on the page
  similarElements: Array<{
    selector: string;
    text?: string;
    role?: string;
    similarityScore: number;    // 0-1, how similar to chosen element
    differentiator: string;     // What makes chosen element different
  }>;

  // Why THIS element was chosen over alternatives
  selectionReason: string;        // "Exact text match 'Submit'", "Only visible button in modal"

  // How unique is this element
  uniquenessScore: number;        // 0-1, 1 = completely unique

  // Disambiguation hints
  disambiguators: string[];       // ["labeled 'First Name'", "inside 'Contact Info' section"]
}

/**
 * Expected outcomes captured during recording
 * Based on page type + action + element role
 */
export interface RecordedExpectations {
  // Primary expected outcome
  primary: {
    type: ExpectedOutcomeType;
    description: string;          // Human-readable: "Dropdown should open"
    confidence: number;           // 0-1
    timeoutMs: number;            // How long to wait
  };

  // Alternative acceptable outcomes
  alternatives?: Array<{
    type: ExpectedOutcomeType;
    description: string;
    confidence: number;
  }>;

  // What would indicate failure
  failureIndicators?: Array<{
    type: 'error_message' | 'element_disappeared' | 'unexpected_navigation' | 'timeout';
    pattern?: string;             // Regex or text to match
    description: string;
  }>;
}

/**
 * Complete recording context from PageModel
 * This is the full "intent" captured during recording
 */
export interface PageModelRecordingContext {
  // Metadata
  capturedAt: number;
  pageModelConfidence: number;

  // Level 2: Context (WHERE and WHEN)
  pageContext: RecordedPageModelContext;

  // Level 3: Intent (WHY this element)
  elementRelationships: RecordedElementRelationships;
  alternatives: RecordedAlternatives;

  // Level 4: Expectation (WHAT should happen)
  expectations: RecordedExpectations;
}
