/**
 * AI Analysis Types - Optimized payload structures for LLM consumption
 */

export interface UserContext {
  identity: string;
  focus: string;
}

/**
 * Semantic context extracted from step (prioritized for AI understanding)
 */
export interface SemanticContext {
  // Grid/Spreadsheet context (highest priority for spreadsheet workflows)
  gridCoordinates?: {
    cellReference?: string; // "A1", "B2"
    columnHeader?: string; // "Price", "Product Name"
    rowHeader?: string;
    rowIndex?: number;
    columnIndex?: number;
    isHeader?: boolean;
  };
  
  // Form context (highest priority for form workflows)
  formCoordinates?: {
    label?: string; // "Client Name"
    fieldOrder?: number;
    fieldset?: string;
    section?: string;
  };
  
  // Table context
  tableCoordinates?: {
    rowIndex?: number;
    columnIndex?: number;
    headerRow?: number;
    headerColumn?: number;
  };
  
  // Decision space (dropdowns, lists, radio buttons, checkboxes)
  decisionSpace?: {
    type: 'LIST_SELECTION' | 'RADIO_GROUP' | 'CHECKBOX_GROUP';
    options: string[]; // All available options
    selectedIndex: number; // For LIST_SELECTION and RADIO_GROUP
    selectedText: string; // The selected/checked option text
    selectedIndices?: number[]; // For CHECKBOX_GROUP (multiple selections)
    containerSelector?: string;
    groupLabel?: string; // Label for the group (e.g., "Gender:", "Choose applicable options:")
  };
  
  // Button context (Interactive Section Anchoring - for generic div buttons in Salesforce/React)
  buttonContext?: {
    section?: string; // Section header (e.g., "Account Information")
    label?: string; // Button text or aria-label
    role?: string; // ARIA role if present
  };
}

/**
 * Element context (simplified for AI)
 */
export interface ElementContext {
  text?: string; // Element text content
  label?: string; // Associated label
  value?: string; // Input value
  role?: string; // ARIA role
  container?: {
    type?: string; // "dashboard", "widget", "table"
    text?: string; // Container title
  };
  position?: {
    index: number;
    total: number;
    type: string;
  };
  surroundingText?: string; // Nearby text for context
}

/**
 * Page context (simplified - coordinates removed)
 */
export interface PageContext {
  title: string;
  url: string;
  // scrollPosition removed - coordinates are meaningless to text models
  // viewport removed - dimensions are meaningless without visual context
}

/**
 * Flow context (previous action, pattern detection)
 */
export interface FlowContext {
  previousAction?: string; // Previous action type
  pattern?: {
    type: 'repetitive' | 'sequential' | 'template' | 'unique';
    confidence: number;
  };
}

/**
 * AI-optimized step analysis payload
 * Prioritizes semantic understanding over technical details
 * Token-optimized: Removed CSS selectors, coordinates, timing, HTML
 * 
 * EXPLICITLY EXCLUDED FIELDS (to prevent token explosion):
 * ✂️ fallbackSelectors: CSS selectors are noise for LLMs
 * ✂️ ancestors: Full DOM tree burns tokens (~500+ per step)
 * ✂️ eventDetails: Coordinates (x, y) are meaningless to text models
 * ✂️ elementBounds: Bounding box coordinates are meaningless without visual context
 * ✂️ timing: Performance data (timestamp, delayAfter) not needed for intent
 * ✂️ html/outerHTML: Raw HTML causes context window overflow
 * ✂️ scrollPosition & viewport: Coordinates meaningless without visual context
 */
export interface AIAnalysisPayload {
  // Action metadata (minimal)
  action: {
    type: 'CLICK' | 'INPUT' | 'SCROLL' | 'KEYBOARD' | 'NAVIGATION';
    url: string;
  };
  
  // Semantic context (HIGHEST PRIORITY - what AI cares about most)
  semanticContext?: SemanticContext;
  
  // Element understanding (simplified - NO ancestors, NO html, NO coordinates)
  elementContext?: ElementContext;
  
  // Page context (simplified - NO coordinates)
  pageContext: PageContext;
  
  // Flow context (optional)
  flowContext?: FlowContext;
  
  // Visual snapshot (Phase 2 - for AI vision)
  // CRITICAL: This provides spatial context that coordinates cannot
  visualSnapshot?: {
    viewport?: string; // Base64 data URL of viewport
    elementSnippet?: string; // Base64 data URL of element + context (cropped)
  };
  
  // Phase 4: Human-like Visual Understanding
  // Page type classification
  pageType?: {
    type: string; // 'form', 'dashboard', 'data_table', etc.
    confidence: number;
    subType?: string;
  };
  
  // Visual importance (simplified - only overall score)
  visualImportance?: {
    overallImportance: number; // 0-1 score
  };
  
  // Visual context (simplified)
  visualContext?: {
    visualPattern?: string; // 'form_layout', 'card_grid', 'data_table', etc.
    regionType?: string; // 'header', 'sidebar', 'main_content', etc.
  };
  
  // NOTE: CSS selectors, ancestors, eventDetails, elementBounds, timing, html are
  // intentionally excluded. AI should rely on semantic anchors (gridCoordinates, label, visualSnapshot) instead.
}

/**
 * AI-optimized workflow analysis payload
 */
export interface AIWorkflowPayload {
  workflow: {
    id: string;
    name: string;
    stepCount: number;
  };
  
  steps: AIAnalysisPayload[];
  
  // Pattern detection (if available)
  pattern?: {
    type: 'repetitive' | 'sequential' | 'template' | 'unique';
    sequenceType?: 'row' | 'column' | 'grid' | 'none';
    confidence: number;
  };
  
  // Key screenshots for vision-based summary generation
  keyScreenshots?: {
    first?: string;  // Optimized base64 viewport screenshot (1280px, 75% quality)
    last?: string;   // Optimized base64 viewport screenshot
  };
}

// ============================================================================
// Computer Use / Safety Decision Types
// ============================================================================

/**
 * Safety decision from Gemini Computer Use model
 * The model flags potentially risky actions for user confirmation
 */
export interface SafetyDecision {
  /** Decision type */
  decision: 'allowed' | 'require_confirmation' | 'blocked';
  /** Explanation of why this action was flagged */
  explanation: string;
}

/**
 * Safety acknowledgement to send back after user confirms
 */
export interface SafetyAcknowledgement {
  /** Whether user confirmed the action */
  acknowledged: boolean;
  /** Timestamp of acknowledgement */
  timestamp: number;
}

/**
 * Computer Use response with safety decision
 */
export interface ComputerUseResponse {
  /** Action to perform */
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';
  /** Action parameters */
  params: {
    x?: number;
    y?: number;
    text?: string;
    direction?: string;
    amount?: number;
    url?: string;
    duration?: number;
    reason?: string;
    description?: string;
    pressEnter?: boolean;
    clearBeforeTyping?: boolean;
  };
  /** AI reasoning for this action */
  reasoning: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Hint step index (for agent mode) */
  hintStepIndex?: number;
  /** Safety decision from model (if flagged) */
  safetyDecision?: SafetyDecision;
}

/**
 * Computer Use find element response (replaces visual_click)
 */
export interface ComputerUseFindElementResponse {
  /** Coordinates of found element */
  coordinates: { x: number; y: number };
  /** Bounding box if available */
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Confidence score (0-1) */
  confidence: number;
  /** AI reasoning */
  reasoning: string;
  /** Safety decision if flagged */
  safetyDecision?: SafetyDecision;
  /** Alternative candidates if multiple matches */
  alternativeCandidates?: Array<{
    coordinates: { x: number; y: number };
    confidence: number;
    reasoning: string;
  }>;
}

