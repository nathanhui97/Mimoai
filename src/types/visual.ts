/**
 * Visual Analysis Types - Types for human-like visual understanding
 * Used by visual analysis services and AI prompts
 */

/**
 * Page type classification result
 * Identifies the type of page to help AI understand context
 */
export interface PageType {
  type: 'form' | 'dashboard' | 'data_table' | 'wizard' | 'modal' | 'list' | 'settings' | 'login' | 'search' | 'article' | 'unknown';
  confidence: number; // 0-1
  subType?: string; // More specific classification (e.g., "invoice_form", "user_dashboard")
  characteristics: string[]; // Key visual characteristics that led to classification
}

/**
 * Page regions - identified areas of the page
 */
export interface PageRegions {
  header?: BoundingBox;
  sidebar?: BoundingBox;
  mainContent?: BoundingBox;
  footer?: BoundingBox;
  navigation?: BoundingBox;
  actionBar?: BoundingBox; // Toolbar with buttons
  formArea?: BoundingBox;
  tableArea?: BoundingBox;
}

/**
 * Bounding box for visual regions
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Visual landmark - recognizable UI element
 */
export interface VisualLandmark {
  type: 'button' | 'input' | 'table' | 'card' | 'icon' | 'logo' | 'navigation' | 'search_bar' | 'user_menu' | 'modal' | 'dropdown' | 'tab';
  position: BoundingBox;
  description: string; // Human-readable description (e.g., "Blue submit button")
  text?: string; // Text content if any
  color?: string; // Dominant color
  confidence: number; // 0-1
}

/**
 * Visual importance scoring - how prominent an element is
 * Based on human visual attention patterns (F-pattern, size, color)
 */
export interface VisualImportance {
  sizeScore: number; // 0-1, larger = more important
  colorScore: number; // 0-1, brighter/contrasted = more important
  positionScore: number; // 0-1, top-left (F-pattern) = more important
  iconScore: number; // 0-1, has recognizable icon = more important
  textStyleScore: number; // 0-1, bold/large text = more important
  interactiveScore: number; // 0-1, looks clickable = more important
  overallImportance: number; // 0-1, weighted combination
}

/**
 * Visual similarity scores - how similar two elements look
 */
export interface VisualSimilarity {
  colorSimilarity: number; // 0-1, RGB histogram comparison
  shapeSimilarity: number; // 0-1, contour/shape matching
  sizeSimilarity: number; // 0-1, similar dimensions
  layoutSimilarity: number; // 0-1, position relative to neighbors
  textSimilarity: number; // 0-1, similar text styling
  iconSimilarity: number; // 0-1, similar icons
  overallVisualMatch: number; // 0-1, weighted combination
}

/**
 * Visual context - nearby elements and spatial relationships
 */
export interface VisualContext {
  nearbyElements: NearbyElement[];
  landmarks: VisualLandmark[];
  visualPattern: VisualPattern;
  regionType?: 'header' | 'sidebar' | 'main_content' | 'footer' | 'modal' | 'dropdown';
}

/**
 * Nearby element with spatial relationship
 */
export interface NearbyElement {
  selector?: string;
  visualDescription: string; // "Blue button with 'Save' text"
  relationship: 'above' | 'below' | 'left' | 'right' | 'inside' | 'overlapping';
  distance: number; // Pixels from target element
  type: 'button' | 'input' | 'label' | 'icon' | 'text' | 'image' | 'container' | 'other';
}

/**
 * Visual pattern detected in the page region
 */
export type VisualPattern = 
  | 'form_layout' // Labeled inputs in vertical stack
  | 'card_grid' // Grid of cards
  | 'data_table' // Rows and columns of data
  | 'dashboard_widgets' // Multiple widget containers
  | 'list_view' // Vertical list of items
  | 'wizard_steps' // Multi-step form
  | 'tab_content' // Tabbed interface
  | 'modal_dialog' // Popup dialog
  | 'dropdown_menu' // Dropdown menu
  | 'navigation_menu' // Navigation links
  | 'unknown';

/**
 * Visual flow - tracks visual state changes across steps
 */
export interface VisualFlow {
  beforeSnapshot?: string; // Base64 full page screenshot before action
  afterSnapshot?: string; // Base64 full page screenshot after action
  changes: VisualChange[];
  expectedNextState?: string; // Description of what should happen next
}

/**
 * Visual change detected between before/after screenshots
 */
export interface VisualChange {
  type: 'appeared' | 'disappeared' | 'moved' | 'resized' | 'color_changed' | 'text_changed' | 'state_changed';
  region: BoundingBox;
  description: string; // Human-readable description
  elementType?: string; // Type of element that changed
  confidence: number; // 0-1
}

/**
 * Full page analysis result
 */
export interface PageAnalysis {
  pageType: PageType;
  regions: PageRegions;
  landmarks: VisualLandmark[];
  visualPatterns: Array<{
    pattern: VisualPattern;
    region: BoundingBox;
    confidence: number;
  }>;
  dominantColors: string[]; // Hex colors
  textDensity: 'low' | 'medium' | 'high';
  interactiveElementCount: number;
  timestamp: number;
}

/**
 * Visual element candidate for AI matching
 */
export interface VisualCandidate {
  selector: string;
  screenshot: string; // Base64 cropped image of element
  visualDescription: string; // AI-generated description
  importance: VisualImportance;
  context: VisualContext;
  boundingBox: BoundingBox;
}

/**
 * Visual matching request
 */
export interface VisualMatchRequest {
  targetScreenshot: string; // Base64 image of target element (from recording)
  targetDescription?: string; // Text description of target
  candidates: VisualCandidate[]; // Candidates to match against
  pageType?: PageType; // Current page classification
  pageScreenshot?: string; // Full page for context
}

/**
 * Visual matching result
 */
export interface VisualMatchResult {
  bestMatchIndex: number; // Index of best matching candidate
  bestMatchSelector?: string;
  confidence: number; // 0-1
  similarity: VisualSimilarity;
  reasoning: string; // AI explanation of match
  alternativeMatches: Array<{
    index: number;
    confidence: number;
    reasoning: string;
  }>;
}

/**
 * Visual wait condition - wait for visual state change
 */
export interface VisualWaitCondition {
  type: 'element_appears' | 'element_disappears' | 'color_change' | 'text_change' | 'animation_complete' | 'visual_stable';
  targetRegion?: BoundingBox; // Region to monitor
  targetDescription?: string; // What to look for
  expectedState?: string; // Base64 screenshot of expected state
  timeout: number; // Max wait time in ms
  pollInterval: number; // How often to check (ms)
  confidence: number; // Required confidence to consider condition met
}

/**
 * Visual state comparison result
 */
export interface VisualStateComparison {
  isSameState: boolean;
  similarity: number; // 0-1
  changes: VisualChange[];
  timestamp: number;
}

/**
 * Correction memory entry - stores user correction for learning
 */
export interface CorrectionEntry {
  id: string;
  timestamp: number;
  
  // Original context
  originalSelector: string;
  originalVisualContext?: string; // Base64 screenshot
  originalDescription?: string;
  
  // User correction
  correctedSelector: string;
  correctedElement?: {
    tag: string;
    text?: string;
    attributes: Record<string, string>;
  };
  
  // Page context
  pageUrl: string;
  pageType?: PageType;
  
  // Learning data
  learnedPattern?: LearnedPattern;
  successCount: number; // How many times this correction was reused successfully
  failureCount: number;
}

/**
 * Learned pattern from corrections
 */
export interface LearnedPattern {
  // Pattern identification
  patternType: 'selector_transform' | 'visual_match' | 'text_match' | 'position_based';
  
  // Conditions for applying this pattern
  conditions: {
    pageTypeMatch?: string[]; // Page types where this applies
    urlPattern?: string; // URL regex pattern
    elementTypeMatch?: string; // Element type (button, input, etc.)
    visualSimilarityThreshold?: number;
  };
  
  // The learned transformation/rule
  rule: {
    selectorTransform?: {
      from: string; // Regex pattern
      to: string; // Replacement pattern
    };
    preferredAttributes?: string[]; // Attributes to prefer
    visualFeatures?: string[]; // Visual features to match
  };
  
  confidence: number; // 0-1, based on success rate
}

/**
 * Workflow intent - inferred goal of the workflow
 */
export interface WorkflowIntent {
  primaryGoal: string; // "Fill out invoice form and submit"
  subGoals: string[]; // ["Enter client name", "Enter amount", "Click submit"]
  expectedOutcome: string; // "Invoice created successfully"
  visualConfirmation?: string; // Description of success state
  confidence: number; // 0-1
  
  // Failure handling
  failurePatterns?: Array<{
    description: string; // "Error message appears"
    visualIndicator?: string; // What failure looks like
    recovery?: string; // How to recover
  }>;
}

/**
 * Visual analysis API response types
 */
export interface ClassifyPageTypeResponse {
  pageType: PageType;
  regions: PageRegions;
  landmarks: VisualLandmark[];
  confidence: number;
}

export interface VisualSimilarityResponse {
  matches: Array<{
    candidateIndex: number;
    similarity: VisualSimilarity;
    confidence: number;
  }>;
  bestMatch: {
    index: number;
    selector?: string;
    reasoning: string;
  };
}

export interface VisualAnalysisResponse {
  importance?: VisualImportance;
  context?: VisualContext;
  patterns?: Array<{
    pattern: VisualPattern;
    confidence: number;
  }>;
  description?: string;
}

export interface AnalyzeIntentResponse {
  intent: WorkflowIntent;
  confidence: number;
  suggestions?: string[]; // Suggestions for improving the workflow
}








