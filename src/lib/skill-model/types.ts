/**
 * Skill Model Types
 *
 * A Skill Model captures field-level procedural knowledge for a workflow.
 * It's the bridge between recording data and execution planning —
 * telling the PagePlanner exactly what fields to fill, in what order,
 * with what strategies.
 *
 * Built from: WorkflowMemory + FormAudit + FormCompletionDiff + recording steps.
 * Refined after each execution with learned field mappings.
 */

// ============================================================================
// Core Skill Model
// ============================================================================

/**
 * Complete field-level knowledge for a workflow
 */
export interface SkillModel {
  /** Workflow this skill belongs to */
  workflowId: string;

  /** When this skill was generated/last updated */
  generatedAt: number;

  /** Version for migrations */
  version: '1.0';

  /** Grouped by page URL pattern */
  pages: PageSkill[];

  /** Cross-page field dependencies (e.g. value from page 1 used on page 2) */
  crossPageDependencies: CrossPageDependency[];

  /** How many executions contributed to this model */
  executionCount: number;
}

/**
 * Field-level knowledge for a single page in the workflow
 */
export interface PageSkill {
  /** URL pattern for this page (supports wildcards) */
  urlPattern: string;

  /** Page type classification */
  pageType: 'form' | 'list' | 'detail' | 'confirmation' | 'error' | 'navigation' | 'other';

  /** All known fields on this page */
  fields: FieldKnowledge[];

  /** Navigation actions on this page (buttons, links) */
  actions: ActionKnowledge[];

  /** Submission action (save/submit button) */
  submitAction?: ActionKnowledge;

  /** How to verify this page was completed successfully */
  successCheck?: {
    type: 'toast' | 'url_change' | 'element_appears' | 'text_visible';
    pattern: string;
  };

  /** Which workflow phase this page belongs to */
  phaseIndex?: number;
}

// ============================================================================
// Field Knowledge
// ============================================================================

/**
 * Everything known about a single form field
 */
export interface FieldKnowledge {
  /** Semantic field name (human-readable) */
  fieldName: string;

  /** Internal variable name (from recording) */
  variableName?: string;

  /** Field type */
  fieldType: 'text' | 'email' | 'phone' | 'date' | 'select' | 'checkbox' | 'radio' |
             'textarea' | 'number' | 'password' | 'url' | 'search' | 'typeahead' | 'other';

  /** Is this field required? */
  required: boolean;

  /** Confidence in required status (0-1, higher after more data) */
  requiredConfidence: number;

  /** How the requirement was determined */
  requiredSource: 'html_attribute' | 'aria_attribute' | 'label_asterisk' | 'form_audit' |
                  'always_filled' | 'never_skipped' | 'user_correction' | 'inferred';

  /** For select/radio: known options */
  options?: string[];

  /** Default value (from form audit, if pre-filled) */
  defaultValue?: string;

  /** Whether the user typically keeps the default */
  keepsDefault: boolean;

  /** Example values from recordings */
  exampleValues: string[];

  /** Validation pattern (from HTML pattern attribute or inferred) */
  validationPattern?: string;

  /** Placeholder text */
  placeholder?: string;

  /** Position in form order */
  fieldOrder: number;

  /** Section/fieldset this field belongs to */
  section?: string;

  /** Best known selectors for this field (ordered by reliability) */
  selectors: FieldSelector[];

  /** Fill strategy */
  strategy: 'type' | 'select' | 'click' | 'checkbox' | 'typeahead' | 'date_picker' | 'inline_edit';

  /** Whether to clear existing value before typing */
  clearFirst: boolean;

  /** Field dependencies (e.g. City depends on State) */
  dependsOn?: string[];

  /** Which recording step(s) interact with this field */
  stepIndices: number[];

  /** Historical fill rate: how often this field was filled across recordings */
  fillRate: number;

  /** Whether the user ever skipped this field */
  wasEverSkipped: boolean;

  /** Inferred skip reason (if applicable) */
  skipReason?: 'optional' | 'had_default' | 'not_applicable' | 'hidden';
}

/**
 * A known selector for a field, with reliability data
 */
export interface FieldSelector {
  /** CSS or XPath selector */
  selector: string;

  /** Selector type */
  type: 'id' | 'name' | 'data-testid' | 'aria-label' | 'css' | 'xpath' | 'nth-of-type';

  /** How reliable this selector has been (0-1) */
  reliability: number;

  /** How many times this selector found the correct element */
  successCount: number;

  /** How many times this selector was tried */
  attemptCount: number;

  /** Last time this selector was used successfully */
  lastSuccessAt?: number;
}

// ============================================================================
// Action Knowledge
// ============================================================================

/**
 * Knowledge about a clickable action (button, link, etc.)
 */
export interface ActionKnowledge {
  /** Human-readable description */
  description: string;

  /** Button/link text */
  text: string;

  /** Best known selector */
  selector: string;

  /** ARIA role */
  role?: string;

  /** Does this action cause navigation? */
  causesNavigation: boolean;

  /** Does this action open a modal? */
  causesModal: boolean;

  /** Wait time after clicking (ms) */
  waitAfterMs: number;

  /** Which recording step this corresponds to */
  stepIndex: number;
}

// ============================================================================
// Cross-Page Dependencies
// ============================================================================

/**
 * When a value from one page is used on another
 */
export interface CrossPageDependency {
  /** Source page URL pattern */
  sourcePageUrl: string;

  /** Source field or element */
  sourceField: string;

  /** Target page URL pattern */
  targetPageUrl: string;

  /** Target field */
  targetField: string;

  /** How the value transfers */
  transferType: 'url_param' | 'form_value' | 'display_text' | 'hidden_field';
}
