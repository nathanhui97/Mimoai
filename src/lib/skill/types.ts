/**
 * Skill Types
 *
 * A Skill is the unified, execution-focused view of a learned task.
 * It combines data from SavedWorkflow and WorkflowMemory into a structure
 * optimized for goal-oriented execution.
 *
 * Key difference from SavedWorkflow:
 * - SavedWorkflow = storage format (raw recording + scattered analysis)
 * - Skill = execution format (unified knowledge for AI reasoning)
 */

// ============================================================================
// Core Skill Interface
// ============================================================================

/**
 * A learned skill - everything the AI needs to execute a task
 */
export interface Skill {
  /**
   * Unique identifier (same as workflow ID)
   */
  id: string;

  /**
   * Human-readable name
   * @example "Add Contact"
   */
  name: string;

  /**
   * When this skill was learned
   */
  learnedAt: number;

  /**
   * When this skill was last updated
   */
  updatedAt: number;

  // -------------------------------------------------------------------------
  // GOAL - What am I trying to accomplish?
  // -------------------------------------------------------------------------

  goal: SkillGoal;

  // -------------------------------------------------------------------------
  // KNOWLEDGE - What did I learn? (from Q&A + analysis)
  // -------------------------------------------------------------------------

  knowledge: SkillKnowledge;

  // -------------------------------------------------------------------------
  // INPUTS - What do I need from the user?
  // -------------------------------------------------------------------------

  inputs: SkillInputs;

  // -------------------------------------------------------------------------
  // SUCCESS - How do I know I achieved the goal?
  // -------------------------------------------------------------------------

  successCriteria: SkillSuccessCriteria;

  // -------------------------------------------------------------------------
  // MILESTONES - What are the logical phases?
  // -------------------------------------------------------------------------

  milestones: SkillMilestone[];

  // -------------------------------------------------------------------------
  // DEMONSTRATION - What did the user show me? (reference, not script)
  // -------------------------------------------------------------------------

  demonstration: SkillDemonstration;

  // -------------------------------------------------------------------------
  // TRIGGERS - How would user ask for this?
  // -------------------------------------------------------------------------

  triggers: SkillTriggers;

  // -------------------------------------------------------------------------
  // EXPERIENCE - What have I learned from past executions?
  // -------------------------------------------------------------------------

  experience: SkillExperience;

  // -------------------------------------------------------------------------
  // METADATA - Additional context
  // -------------------------------------------------------------------------

  metadata: SkillMetadata;
}

// ============================================================================
// Goal
// ============================================================================

export interface SkillGoal {
  /**
   * Clear description of what this skill accomplishes
   * @example "Create a new contact in the CRM"
   */
  description: string;

  /**
   * One-liner for quick matching
   * @example "Adds a new contact to Salesforce with name, email, and phone"
   */
  summary: string;

  /**
   * Domain/application area
   * @example "CRM", "Spreadsheet", "E-commerce"
   */
  domain: string;

  /**
   * What entity is being created/modified
   * @example "contact", "invoice", "order"
   */
  entity?: string;

  /**
   * Primary action type
   */
  action: 'create' | 'read' | 'update' | 'delete' | 'navigate' | 'export' | 'other';
}

// ============================================================================
// Knowledge (from Q&A + Analysis)
// ============================================================================

export interface SkillKnowledge {
  /**
   * Rules to always follow
   * Derived from Q&A answers and analysis
   * @example ["Lead Source should always be 'Web'", "Phone is optional"]
   */
  rules: KnowledgeRule[];

  /**
   * Tips for successful execution
   * @example ["Wait for dropdown to load before clicking"]
   */
  tips: string[];

  /**
   * Warnings about what NOT to do
   * @example ["Don't click Save twice", "Don't close modal before confirmation"]
   */
  warnings: string[];

  /**
   * Things that can vary between executions
   * @example ["Company field may or may not be present"]
   */
  variations: string[];
}

export interface KnowledgeRule {
  /**
   * The rule itself
   * @example "Lead Source should always be 'Web'"
   */
  rule: string;

  /**
   * Where this rule came from
   */
  source: 'qa_answer' | 'analysis' | 'user_correction' | 'learned';

  /**
   * Which step/field this applies to
   */
  appliesTo?: string;

  /**
   * Confidence in this rule (0-1)
   */
  confidence: number;
}

// ============================================================================
// Inputs
// ============================================================================

export interface SkillInputs {
  /**
   * Required inputs - must have to execute
   */
  required: SkillInput[];

  /**
   * Optional inputs - use defaults if not provided
   */
  optional: SkillInput[];
}

export interface SkillInput {
  /**
   * User-facing field name
   * @example "Name", "Email", "Phone Number"
   */
  name: string;

  /**
   * Internal variable name
   * @example "contact_name", "step_3_value"
   */
  variableName: string;

  /**
   * What this input is for
   * @example "The contact's full name as it should appear"
   */
  description: string;

  /**
   * Data type for validation
   */
  type: SkillInputType;

  /**
   * Example values for understanding format
   * @example ["John Smith", "Jane Doe"]
   */
  examples: string[];

  /**
   * Phrases that help extract this from user input
   * @example ["named", "called", "for"]
   */
  extractionHints: string[];

  /**
   * Default value if not provided
   */
  defaultValue?: string;

  /**
   * Can this accept multiple values?
   * @example true for "add Alice, Bob, Carol"
   */
  supportsArray?: boolean;

  /**
   * Separators for array parsing
   * @example ["and", ",", ";"]
   */
  arraySeparators?: string[];
}

export type SkillInputType =
  | 'text'
  | 'person_name'
  | 'company_name'
  | 'email'
  | 'phone'
  | 'number'
  | 'currency'
  | 'date'
  | 'url'
  | 'select'
  | 'boolean';

// ============================================================================
// Success Criteria
// ============================================================================

export interface SkillSuccessCriteria {
  /**
   * Primary success indicator
   */
  primary: SuccessCheck;

  /**
   * Additional success indicators
   */
  secondary: SuccessCheck[];

  /**
   * What failure looks like
   * @example ["Error message appears", "Form shows validation errors"]
   */
  failureIndicators: string[];

  /**
   * Expected state when done
   * @example "Form is closed, contact appears in list"
   */
  endState: string;

  /**
   * How long to wait for success indicators (ms)
   * @default 5000
   */
  timeout: number;
}

export interface SuccessCheck {
  /**
   * Type of check
   */
  type: SuccessCheckType;

  /**
   * Human-readable description
   * @example "'Contact Created' toast appears"
   */
  description: string;

  /**
   * Pattern to match (for text-based checks)
   * @example "Contact.*created|saved successfully"
   */
  pattern?: string;
}

export type SuccessCheckType =
  | 'toast_appears'
  | 'text_appears'
  | 'text_disappears'
  | 'url_changes'
  | 'element_appears'
  | 'element_disappears'
  | 'modal_closes'
  | 'form_clears'
  | 'navigation_complete';

// ============================================================================
// Milestones
// ============================================================================

export interface SkillMilestone {
  /**
   * Unique identifier
   */
  id: string;

  /**
   * Human-readable name
   * @example "Form Open", "Fields Filled", "Saved"
   */
  name: string;

  /**
   * What this milestone represents
   * @example "All required fields have been filled in"
   */
  description: string;

  /**
   * Which demo steps belong to this milestone
   */
  stepIndices: number[];

  /**
   * How to verify this milestone is reached
   */
  verification?: string;

  /**
   * Is this milestone critical, important, or optional?
   */
  criticality: 'critical' | 'important' | 'optional';

  /**
   * Order in the sequence (0-based)
   */
  order: number;
}

// ============================================================================
// Demonstration (Reference, not Script)
// ============================================================================

export interface SkillDemonstration {
  /**
   * Reference to the original workflow
   */
  workflowId: string;

  /**
   * Total number of steps in the recording
   */
  totalSteps: number;

  /**
   * Summarized steps for AI reference
   */
  steps: DemoStepSummary[];

  /**
   * Starting URL
   */
  startUrl?: string;

  /**
   * Pages visited during demonstration
   */
  pagesVisited?: string[];
}

export interface DemoStepSummary {
  /**
   * Step index (0-based)
   */
  index: number;

  /**
   * Action type
   */
  action: 'click' | 'type' | 'select' | 'navigate' | 'scroll' | 'wait' | 'other';

  /**
   * What element was targeted
   * @example "New Contact button", "Name field", "Save button"
   */
  what: string;

  /**
   * Why this action was performed (intent)
   * @example "Open the contact form", "Enter the contact's name"
   */
  why: string;

  /**
   * Value entered (for type/select actions)
   */
  value?: string;

  /**
   * Is this step critical?
   */
  isCritical: boolean;

  /**
   * Hints for finding this element
   */
  elementHints: ElementHints;
}

export interface ElementHints {
  /**
   * Element role
   * @example "button", "textbox", "link"
   */
  role?: string;

  /**
   * Visible text
   */
  text?: string;

  /**
   * Accessible name
   */
  name?: string;

  /**
   * Label text (for form fields)
   */
  label?: string;

  /**
   * Test ID if available
   */
  testId?: string;

  /**
   * Placeholder text
   */
  placeholder?: string;

  /**
   * CSS selector (fallback)
   */
  selector?: string;
}

// ============================================================================
// Triggers
// ============================================================================

export interface SkillTriggers {
  /**
   * Natural language phrases that should trigger this skill
   * @example ["add contact", "new customer", "create contact"]
   */
  phrases: string[];

  /**
   * Synonyms for the main action verb
   * @example ["add", "create", "new", "insert"]
   */
  verbSynonyms: string[];

  /**
   * Synonyms for the main object
   * @example ["contact", "customer", "person", "client"]
   */
  objectSynonyms: string[];

  /**
   * Domain-specific terms that increase match confidence
   * @example ["CRM", "Salesforce", "contacts page"]
   */
  contextTerms: string[];

  /**
   * When NOT to use this skill
   * @example ["when editing existing contact"]
   */
  exclusions: string[];
}

// ============================================================================
// Experience (Learning from Execution)
// ============================================================================

export interface SkillExperience {
  /**
   * Total times executed
   */
  timesExecuted: number;

  /**
   * Successful executions
   */
  successfulExecutions: number;

  /**
   * Success rate (0-1)
   */
  successRate: number;

  /**
   * Last execution timestamp
   */
  lastExecuted?: number;

  /**
   * Average execution time (ms)
   */
  averageDuration?: number;

  /**
   * Common issues encountered
   * @example ["Dropdown takes time to load"]
   */
  commonIssues: string[];

  /**
   * Strategies that have worked
   * @example ["Wait 500ms after clicking dropdown"]
   */
  provenStrategies: string[];

  /**
   * User corrections made
   */
  corrections: SkillCorrection[];
}

export interface SkillCorrection {
  /**
   * What was corrected
   */
  correction: string;

  /**
   * When
   */
  timestamp: number;

  /**
   * What was learned from this
   */
  learning?: string;
}

// ============================================================================
// Metadata
// ============================================================================

export interface SkillMetadata {
  /**
   * Overall confidence in this skill (0-1)
   */
  confidence: number;

  /**
   * Is this skill ready for production use?
   */
  isReady: boolean;

  /**
   * Tags for categorization
   * @example ["salesforce", "contacts", "data-entry"]
   */
  tags: string[];

  /**
   * Application this skill works with
   * @example "Salesforce", "Google Sheets", "HubSpot"
   */
  application?: string;

  /**
   * URL patterns where this skill applies
   */
  urlPatterns?: string[];

  /**
   * Version of the skill structure
   */
  version: '1.0';
}

// ============================================================================
// Skill Summary (for lists and matching)
// ============================================================================

/**
 * Lightweight summary for skill lists and quick matching
 */
export interface SkillSummary {
  id: string;
  name: string;
  goalSummary: string;
  domain: string;
  triggers: string[];
  inputNames: string[];
  successRate: number;
  lastExecuted?: number;
  isReady: boolean;
}

// ============================================================================
// Skill Index (for fast lookup)
// ============================================================================

/**
 * Index structure for fast skill lookup
 */
export interface SkillIndex {
  /**
   * Phrase → Skill IDs mapping
   * @example { "add contact": ["skill_123"], "new customer": ["skill_123", "skill_456"] }
   */
  phraseMap: Record<string, string[]>;

  /**
   * Domain → Skill IDs mapping
   * @example { "CRM": ["skill_123"], "Spreadsheet": ["skill_456"] }
   */
  domainMap: Record<string, string[]>;

  /**
   * Application → Skill IDs mapping
   * @example { "Salesforce": ["skill_123"], "Google Sheets": ["skill_456"] }
   */
  applicationMap: Record<string, string[]>;

  /**
   * All skill summaries for quick access
   */
  summaries: SkillSummary[];

  /**
   * When the index was last updated
   */
  updatedAt: number;
}

// ============================================================================
// Execution Context (what AI receives during execution)
// ============================================================================

/**
 * Context sent to AI during goal-oriented execution
 */
export interface SkillExecutionContext {
  /**
   * The skill being executed
   */
  skill: Skill;

  /**
   * User-provided input values
   */
  inputs: Record<string, string>;

  /**
   * Current progress
   */
  progress: {
    currentMilestone: SkillMilestone | null;
    completedMilestones: SkillMilestone[];
    remainingMilestones: SkillMilestone[];
    summary: string;
  };

  /**
   * History of actions taken
   */
  history: ExecutionAction[];

  /**
   * Is this a batch execution?
   */
  batch?: {
    currentItem: string;
    currentIndex: number;
    totalItems: number;
    completedItems: string[];
  };
}

export interface ExecutionAction {
  /**
   * When this action was taken
   */
  timestamp: number;

  /**
   * What the AI decided to do
   */
  action: string;

  /**
   * Why (reasoning)
   */
  reasoning: string;

  /**
   * What happened
   */
  outcome: string;

  /**
   * Did this move us toward the goal?
   */
  movedTowardGoal: boolean;
}
