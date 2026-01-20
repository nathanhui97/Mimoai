/**
 * Workflow Memory Types
 *
 * A unified "memory" structure for workflows that mimics how humans
 * remember and execute learned skills.
 *
 * Instead of scattered data across multiple fields, this provides
 * a single coherent structure the agent can consult.
 */

// ============================================================================
// Core Memory Structure
// ============================================================================

/**
 * Complete memory for a workflow - everything the agent needs to know
 */
export interface WorkflowMemory {
  /**
   * Version for future migrations
   */
  version: '1.0';

  /**
   * When this memory was generated/updated
   */
  generatedAt: number;

  /**
   * IDENTITY - Who am I?
   * Basic identification and categorization
   */
  identity: WorkflowIdentity;

  /**
   * UNDERSTANDING - What do I do?
   * High-level understanding of the workflow's purpose and structure
   */
  understanding: WorkflowUnderstanding;

  /**
   * INPUTS - What do I need?
   * Variables and data required to execute
   */
  inputs: WorkflowInputs;

  /**
   * TRIGGERS - When should I be used?
   * Conditions and phrases that invoke this workflow
   */
  triggers: WorkflowTriggers;

  /**
   * PATTERN - What kind of task is this?
   * Execution pattern for handling variations
   */
  pattern: ExecutionPattern;

  /**
   * SUCCESS - How do I know I'm done?
   * Indicators of successful completion
   */
  success: SuccessCriteria;

  /**
   * ADAPTABILITY - How flexible am I?
   * How the workflow can adapt to variations
   */
  adaptability: Adaptability;

  /**
   * EXPERIENCE - What have I learned?
   * Knowledge gained from past executions
   */
  experience: ExecutionExperience;

  /**
   * CLARIFICATIONS - What did the user tell me?
   * Answers to AI's clarifying questions during teaching
   */
  clarifications?: WorkflowClarifications;
}

// ============================================================================
// Clarifications (from AI questions)
// ============================================================================

/**
 * Stores answers to AI's clarifying questions
 */
export interface WorkflowClarifications {
  /**
   * When clarifications were collected
   */
  collectedAt: number;

  /**
   * Array of questions and their answers
   */
  items: ClarificationItem[];
}

export interface ClarificationItem {
  /**
   * The question ID
   */
  questionId: string;

  /**
   * Question category
   */
  category: 'intent' | 'context' | 'scope' | 'triggers';

  /**
   * The question that was asked
   */
  question: string;

  /**
   * The selected answer value
   */
  answerValue: string;

  /**
   * Human-readable answer text
   */
  answerText: string;

  /**
   * If user typed a custom answer
   */
  customAnswer?: string;
}

// ============================================================================
// Identity
// ============================================================================

export interface WorkflowIdentity {
  /**
   * Human-readable name
   * @example "Add Contact to CRM"
   */
  name: string;

  /**
   * One-sentence description of purpose
   * @example "Creates a new contact record in the CRM system"
   */
  purpose: string;

  /**
   * Domain/application area
   * @example "CRM / Contact Management"
   */
  domain: string;

  /**
   * Category of task
   */
  category: TaskCategory;

  /**
   * Tags for additional classification
   * @example ["salesforce", "contacts", "data-entry"]
   */
  tags?: string[];
}

/**
 * High-level task categories
 */
export type TaskCategory =
  | 'data_entry'      // Fill forms, add records
  | 'navigation'      // Go somewhere
  | 'lookup'          // Find information
  | 'modification'    // Edit existing data
  | 'deletion'        // Remove something
  | 'export'          // Download/export data
  | 'import'          // Upload/import data
  | 'verification'    // Check/validate something
  | 'communication'   // Send message, email, etc.
  | 'configuration'   // Settings, preferences
  | 'other';          // Doesn't fit other categories

// ============================================================================
// Understanding
// ============================================================================

export interface WorkflowUnderstanding {
  /**
   * One-liner for quick understanding and matching
   * @example "Adds a new contact to Salesforce with name, email, and phone"
   */
  elevator: string;

  /**
   * High-level phases (how humans chunk procedures)
   * @example [{ name: "Open Form", ... }, { name: "Fill Details", ... }, { name: "Save", ... }]
   */
  phases: WorkflowPhase[];

  /**
   * Key entities/concepts involved
   * @example ["contact", "form", "CRM", "customer"]
   */
  entities: string[];

  /**
   * Prerequisites that must be true before starting
   * @example ["Must be logged into CRM", "Must have permission to create contacts"]
   */
  prerequisites?: string[];
}

export interface WorkflowPhase {
  /**
   * Human-readable phase name
   * @example "Fill Contact Form"
   */
  name: string;

  /**
   * What this phase accomplishes
   * @example "Enter the contact's personal information"
   */
  purpose: string;

  /**
   * Which steps (indices) belong to this phase
   * @example [2, 3, 4, 5] // Steps 2-5 are part of this phase
   */
  stepIndices: number[];

  /**
   * Is this phase critical or optional?
   */
  criticality: 'critical' | 'important' | 'optional';
}

// ============================================================================
// Inputs
// ============================================================================

export interface WorkflowInputs {
  /**
   * Required inputs - must have to execute
   */
  required: InputField[];

  /**
   * Optional inputs - use defaults if not provided
   */
  optional: InputField[];
}

export interface InputField {
  /**
   * Field name (user-facing)
   * @example "Name", "Email", "Phone Number"
   */
  name: string;

  /**
   * Internal variable name (from recording)
   * @example "step_3_value", "contact_email"
   */
  variableName: string;

  /**
   * Human description of what this field is for
   * @example "The contact's full name as it should appear in the system"
   */
  description: string;

  /**
   * Data type for validation and extraction
   */
  type: InputType;

  /**
   * Phrases that help extract this value from user input
   * @example ["named", "called", "name is", "for"]
   * "add contact named John" → extracts "John" for Name field
   */
  extractionHints: string[];

  /**
   * Example values for the LLM to understand format
   * @example ["John Smith", "Jane Doe", "Robert Johnson"]
   */
  exampleValues?: string[];

  /**
   * Default value if not provided
   */
  defaultValue?: string;

  /**
   * Validation rules
   * @example ["must be valid email format", "max 100 characters"]
   */
  validationRules?: string[];

  /**
   * For select/dropdown fields, the available options
   */
  options?: string[];

  /**
   * Which step index this input is used in
   */
  usedInSteps: number[];
}

export type InputType =
  | 'text'           // Generic text
  | 'person_name'    // Human name (special extraction rules)
  | 'company_name'   // Organization name
  | 'email'          // Email address
  | 'phone'          // Phone number
  | 'number'         // Numeric value
  | 'currency'       // Money amount ($50k, 1000, etc.)
  | 'date'           // Date value
  | 'time'           // Time value
  | 'datetime'       // Date and time
  | 'url'            // Web address
  | 'address'        // Physical address
  | 'select'         // Single selection from options
  | 'multiselect'    // Multiple selections
  | 'boolean'        // Yes/no, true/false
  | 'percentage';    // Percentage value

// ============================================================================
// Triggers
// ============================================================================

export interface WorkflowTriggers {
  /**
   * Natural language phrases that should trigger this workflow
   * @example ["add contact", "new customer", "create contact", "add person"]
   */
  phrases: string[];

  /**
   * Synonyms for the main action verb
   * @example ["add", "create", "new", "insert"]
   */
  verbSynonyms?: string[];

  /**
   * Synonyms for the main object
   * @example ["contact", "customer", "person", "client"]
   */
  objectSynonyms?: string[];

  /**
   * Page/context requirements for this workflow
   */
  pageContext?: PageContext;

  /**
   * Situations where this workflow should NOT be used
   * Helps with disambiguation
   * @example ["when editing existing contact", "when viewing contact list"]
   */
  notWhen?: string[];

  /**
   * Priority for disambiguation (higher = preferred)
   * @default 0
   */
  priority?: number;
}

export interface PageContext {
  /**
   * URL patterns where this workflow applies
   * @example ["/contacts/*", "/crm/customers"]
   */
  urlPatterns?: string[];

  /**
   * Page types where this workflow applies
   * @example ["contact_list", "crm_dashboard"]
   */
  pageTypes?: string[];

  /**
   * Application names
   * @example ["Salesforce", "HubSpot"]
   */
  applications?: string[];

  /**
   * Elements that must be present
   * @example ["Add Contact button", "New Customer link"]
   */
  requiredElements?: string[];
}

// ============================================================================
// Pattern
// ============================================================================

export interface ExecutionPattern {
  /**
   * Primary execution pattern type
   */
  type: PatternType;

  /**
   * Can this workflow be repeated for multiple items?
   * @example "add Alice, Bob, and Carol" = repeat 3 times
   */
  repetition?: RepetitionConfig;

  /**
   * For data entry workflows (especially spreadsheets)
   */
  dataEntry?: DataEntryConfig;

  /**
   * For workflows that create something
   */
  creation?: CreationConfig;
}

export type PatternType =
  | 'single_entry'    // One item at a time
  | 'repeatable'      // Can repeat for multiple items in sequence
  | 'batch'           // Handles multiple items in one execution
  | 'navigation'      // Getting somewhere
  | 'lookup'          // Finding/reading information
  | 'transformation'  // Modifying existing data
  | 'deletion'        // Removing data
  | 'export';         // Extracting/downloading data

export interface RepetitionConfig {
  /**
   * Supports multiple items in one request
   * @example true = "add Alice, Bob, Carol" works
   */
  supportsMultiple: boolean;

  /**
   * How to split multiple items
   * @example ["and", ",", "then", ";"]
   */
  separators?: string[];

  /**
   * Maximum items per invocation
   * @default unlimited
   */
  maxBatch?: number;

  /**
   * Pause between repetitions (ms)
   */
  delayBetween?: number;
}

export interface DataEntryConfig {
  /**
   * How to determine where to enter data
   */
  targetStrategy: DataEntryTargetStrategy;

  /**
   * For spreadsheets: how to detect row boundaries
   */
  rowDetection?: 'by_content' | 'by_format' | 'by_position' | 'by_formula';

  /**
   * Does this preserve existing data or overwrite?
   */
  preservesExisting: boolean;

  /**
   * Is this a spreadsheet workflow?
   */
  isSpreadsheet?: boolean;

  /**
   * For spreadsheets: column mapping
   * @example { "A": "Name", "B": "Email", "C": "Phone" }
   */
  columnMapping?: Record<string, string>;
}

export type DataEntryTargetStrategy =
  | 'fixed_location'   // Always use recorded location
  | 'first_empty_row'  // Find first empty row (spreadsheets)
  | 'last_row_plus_one' // Append after last row
  | 'specific_cell'    // Target specific cell reference
  | 'by_criteria';     // Find row matching criteria

export interface CreationConfig {
  /**
   * What entity is being created
   * @example "contact", "opportunity", "task"
   */
  entityType: string;

  /**
   * Is a unique identifier generated?
   */
  generatesId: boolean;

  /**
   * Where does the new entity appear?
   * @example "in contact list", "as new row"
   */
  appearsIn?: string;
}

// ============================================================================
// Success
// ============================================================================

export interface SuccessCriteria {
  /**
   * What indicates successful completion
   */
  indicators: SuccessIndicator[];

  /**
   * What indicates something went wrong
   * @example ["Error message appears", "Form validation failed"]
   */
  failureIndicators: string[];

  /**
   * Expected state after completion
   * @example "Contact appears in list, form is closed"
   */
  endState: string;

  /**
   * How long to wait for success indicators (ms)
   * @default 5000
   */
  verificationTimeout?: number;
}

export interface SuccessIndicator {
  /**
   * Type of success check
   */
  type: SuccessIndicatorType;

  /**
   * Human-readable description
   * @example "Success toast appears saying 'Contact created'"
   */
  description: string;

  /**
   * Pattern to match (for text-based indicators)
   * @example "Contact.*created|saved successfully"
   */
  pattern?: string;

  /**
   * Element to check (for element-based indicators)
   */
  element?: string;

  /**
   * Priority of this indicator
   * - primary: Main success signal
   * - secondary: Additional confirmation
   * - fallback: If primary not found
   */
  priority: 'primary' | 'secondary' | 'fallback';
}

export type SuccessIndicatorType =
  | 'text_appears'        // Specific text shows up
  | 'text_disappears'     // Specific text goes away
  | 'url_changes'         // URL changes to pattern
  | 'element_appears'     // Element becomes visible
  | 'element_disappears'  // Element is removed/hidden
  | 'element_enabled'     // Element becomes enabled
  | 'count_changes'       // List/table count changes
  | 'toast_appears'       // Toast/snackbar notification
  | 'modal_closes'        // Modal/dialog closes
  | 'form_clears'         // Form fields reset
  | 'navigation_complete'; // Page navigation finished

// ============================================================================
// Adaptability
// ============================================================================

export interface Adaptability {
  /**
   * Steps that can be skipped in certain conditions
   */
  optionalSteps: OptionalStep[];

  /**
   * Can phases be executed in different orders?
   */
  reorderablePhases: boolean;

  /**
   * Known variations this workflow can handle
   * @example ["with company name", "without phone", "with multiple emails"]
   */
  handledVariations: string[];

  /**
   * Fallback strategies when elements aren't found
   */
  fallbacks: FallbackStrategy[];

  /**
   * Alternative workflows that accomplish similar goals
   */
  alternatives?: string[];  // Workflow IDs
}

export interface OptionalStep {
  /**
   * Step index
   */
  stepIndex: number;

  /**
   * When this step can be skipped
   * @example "when phone number not provided"
   */
  skipCondition: string;
}

export interface FallbackStrategy {
  /**
   * When to use this fallback
   * @example "Email field not visible"
   */
  when: string;

  /**
   * What to do instead
   * @example "Look for 'Contact Email' or 'E-mail' label"
   */
  then: string;

  /**
   * Which step this applies to
   */
  forStep?: number;
}

// ============================================================================
// Experience (Learning from Execution)
// ============================================================================

export interface ExecutionExperience {
  /**
   * Total execution count
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
   * Average execution duration (ms)
   */
  averageDuration?: number;

  /**
   * Steps that frequently need recovery
   */
  troubleSpots: TroubleSpot[];

  /**
   * Strategies that have worked in the past
   */
  provenStrategies: ProvenStrategy[];

  /**
   * Common user corrections
   */
  userCorrections?: UserCorrection[];
}

export interface TroubleSpot {
  /**
   * Step index that often fails
   */
  stepIndex: number;

  /**
   * What typically goes wrong
   * @example "Dropdown takes time to populate"
   */
  issue: string;

  /**
   * How to handle it
   * @example "Wait for dropdown options before clicking"
   */
  solution: string;

  /**
   * How often this occurs (0-1)
   */
  frequency: number;
}

export interface ProvenStrategy {
  /**
   * When this strategy applies
   * @example "Save button is disabled"
   */
  situation: string;

  /**
   * What worked
   * @example "Check for and fill required fields marked with *"
   */
  strategy: string;

  /**
   * Success rate when using this strategy (0-1)
   */
  effectiveness: number;
}

export interface UserCorrection {
  /**
   * What the user corrected
   * @example "Changed field name from 'Contact Name' to 'Full Name'"
   */
  correction: string;

  /**
   * When the correction was made
   */
  timestamp: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Minimal memory for quick matching (used in workflow list)
 */
export interface WorkflowMemorySummary {
  name: string;
  purpose: string;
  elevator: string;
  category: TaskCategory;
  triggers: string[];
  inputNames: string[];
  patternType: PatternType;
}

/**
 * Extract summary from full memory
 */
export function summarizeMemory(memory: WorkflowMemory): WorkflowMemorySummary {
  return {
    name: memory.identity.name,
    purpose: memory.identity.purpose,
    elevator: memory.understanding.elevator,
    category: memory.identity.category,
    triggers: memory.triggers.phrases,
    inputNames: [...memory.inputs.required, ...memory.inputs.optional].map(i => i.name),
    patternType: memory.pattern.type,
  };
}

// ============================================================================
// Block-Based Workflow Types
// ============================================================================

/**
 * Block type classification
 * Determines how the block should be executed
 */
export type BlockType =
  | 'form_fill'        // Multiple INPUT steps filling a form
  | 'table_row'        // Add/edit table row
  | 'list_item'        // Add item to list
  | 'menu_navigation'  // Click through menus
  | 'one_time'         // Navigation, setup (non-repeatable)
  | 'submission';      // Form submit, save

/**
 * Condition for when a block should exit its loop
 */
export interface BlockExitCondition {
  /**
   * Type of exit condition
   */
  type: 'item_count' | 'success_indicator' | 'error_indicator' | 'manual';

  /**
   * Description of the exit condition
   * @example "After all items processed" or "When success toast appears"
   */
  description?: string;

  /**
   * Pattern to match for indicator-based exits
   */
  pattern?: string;
}

/**
 * Extended phase structure with block semantics
 * Builds on WorkflowPhase to add loop/iteration support
 */
export interface WorkflowBlock extends WorkflowPhase {
  /**
   * Unique block identifier
   */
  blockId: string;

  /**
   * Block classification
   */
  blockType: BlockType;

  /**
   * Can this block loop for multiple items?
   * @example true for "add contact" form, false for "click save"
   */
  isRepeatable: boolean;

  /**
   * Variable that drives repetition
   * When this variable contains an array, the block repeats for each item
   * @example "name" - when user says "add Alice, Bob, Carol", this block repeats 3x
   */
  iterationVariable?: string;

  /**
   * Delay between iterations (ms)
   * Useful for rate limiting or waiting for UI updates
   * @default 500
   */
  iterationDelayMs?: number;

  /**
   * When should the block stop iterating?
   */
  exitCondition?: BlockExitCondition;

  /**
   * For nested blocks, the parent block ID
   */
  parentBlockId?: string;

  /**
   * Blocks that must complete before this one
   */
  dependsOnBlocks?: string[];
}

/**
 * Result of executing a single block iteration
 */
export interface BlockIterationResult {
  /**
   * Which iteration (0-indexed)
   */
  iterationIndex: number;

  /**
   * The value used for this iteration
   * @example "Alice" from ["Alice", "Bob", "Carol"]
   */
  iterationValue: string;

  /**
   * Whether this iteration succeeded
   */
  success: boolean;

  /**
   * Steps executed in this iteration
   */
  stepsExecuted: number[];

  /**
   * Error if iteration failed
   */
  error?: string;

  /**
   * Time taken for this iteration (ms)
   */
  elapsedMs: number;
}

/**
 * Result of executing a complete block
 */
export interface BlockExecutionResult {
  /**
   * Block that was executed
   */
  blockId: string;

  /**
   * Overall success
   */
  success: boolean;

  /**
   * Number of iterations completed
   */
  iterationsCompleted: number;

  /**
   * Total iterations attempted
   */
  totalIterations: number;

  /**
   * Results for each iteration
   */
  iterationResults: BlockIterationResult[];

  /**
   * Total time for all iterations (ms)
   */
  totalElapsedMs: number;
}

/**
 * Loop context variables available during block execution
 */
export interface LoopContext {
  /**
   * Current item being processed
   * @example "Alice" when iterating ["Alice", "Bob"]
   */
  current_item: string;

  /**
   * 1-based index of current iteration
   * @example 1, 2, 3...
   */
  current_index: number;

  /**
   * Total number of items
   * @example 3 for ["Alice", "Bob", "Carol"]
   */
  total_items: number;

  /**
   * Is this the first iteration?
   */
  is_first: boolean;

  /**
   * Is this the last iteration?
   */
  is_last: boolean;
}

// ============================================================================
// Extended InputField for Array Support
// ============================================================================

/**
 * Extended input field with array support
 */
export interface InputFieldWithArraySupport extends InputField {
  /**
   * Can this field accept array values?
   * When true, values like "Alice, Bob, Carol" are parsed as arrays
   * @example true for "name" field in "add contacts" workflow
   */
  isArray?: boolean;

  /**
   * Which blocks should repeat when this field has array value
   * @example [1] means Block 1 repeats for each item
   */
  iteratesBlocks?: number[];

  /**
   * Separators to use when parsing array from text
   * @example ["and", ",", "then", ";"]
   */
  arraySeparators?: string[];

  /**
   * Mapping between this array and other arrays
   * For parallel iteration: names[0] goes with emails[0]
   * @example "email" - names and emails iterate together
   */
  parallelWith?: string;
}

// ============================================================================
// Array Extraction Result
// ============================================================================

/**
 * Result of extracting variables with array support
 */
export interface EnhancedExtractionResult {
  /**
   * Scalar values (single items)
   * @example { name: "Alice" }
   */
  scalar: Record<string, string>;

  /**
   * Array values (multiple items)
   * @example { names: ["Alice", "Bob", "Carol"] }
   */
  arrays: Record<string, string[]>;

  /**
   * Confidence scores for each extracted value
   */
  confidence: Record<string, number>;

  /**
   * Values that need user clarification
   */
  needsClarification: string[];

  /**
   * Reasoning for extraction decisions
   */
  reasoning?: string;
}

// ============================================================================
// Workflow with Blocks
// ============================================================================

/**
 * Extended workflow understanding with blocks
 */
export interface WorkflowUnderstandingWithBlocks extends WorkflowUnderstanding {
  /**
   * Block-based structure (extends phases)
   * If present, phases are interpreted as blocks
   */
  blocks?: WorkflowBlock[];
}

/**
 * Helper to convert legacy phases to blocks
 */
export function convertPhasesToBlocks(phases: WorkflowPhase[]): WorkflowBlock[] {
  return phases.map((phase, index) => ({
    ...phase,
    blockId: `block_${index}`,
    blockType: inferBlockType(phase),
    isRepeatable: inferRepeatability(phase),
  }));
}

/**
 * Infer block type from phase metadata
 */
function inferBlockType(phase: WorkflowPhase): BlockType {
  const name = phase.name.toLowerCase();
  const purpose = phase.purpose.toLowerCase();

  // Check for submission patterns
  if (name.includes('save') || name.includes('submit') ||
      purpose.includes('save') || purpose.includes('submit')) {
    return 'submission';
  }

  // Check for navigation/setup patterns
  if (name.includes('open') || name.includes('navigate') ||
      name.includes('setup') || name.includes('go to')) {
    return 'one_time';
  }

  // Check for table/row patterns
  if (name.includes('row') || name.includes('table') ||
      purpose.includes('row') || purpose.includes('table')) {
    return 'table_row';
  }

  // Check for list patterns
  if (name.includes('list') || name.includes('item') ||
      purpose.includes('add to') || purpose.includes('list')) {
    return 'list_item';
  }

  // Check for menu patterns
  if (name.includes('menu') || name.includes('dropdown') ||
      purpose.includes('select') || purpose.includes('menu')) {
    return 'menu_navigation';
  }

  // Default to form_fill for data entry
  if (name.includes('fill') || name.includes('enter') ||
      name.includes('input') || name.includes('form') ||
      purpose.includes('enter') || purpose.includes('fill')) {
    return 'form_fill';
  }

  // Generic default
  return 'one_time';
}

/**
 * Infer if a phase/block is repeatable
 */
function inferRepeatability(phase: WorkflowPhase): boolean {
  const blockType = inferBlockType(phase);

  // These block types are typically repeatable
  const repeatableTypes: BlockType[] = ['form_fill', 'table_row', 'list_item'];

  return repeatableTypes.includes(blockType);
}
