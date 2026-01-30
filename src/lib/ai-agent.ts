/**
 * AI Agent Controller
 * 
 * The brain of the automation system. Uses an observe-act loop where:
 * 1. Agent observes the current page state (screenshot + metadata)
 * 2. Agent thinks about what action to take based on goal and hints
 * 3. Agent instructs the extension to execute the action
 * 4. Agent observes the result and repeats
 * 
 * The extension is just a "tool" - the AI makes all decisions.
 * 
 * This file delegates to specialized modules:
 * - CandidateFinder: Finds and ranks DOM elements matching hints
 * - HintExtractor: Converts workflow steps to hints with variable substitution
 */

import { aiConfig, debugLog } from './ai-config';
import { VisualSnapshotService } from '../content/visual-snapshot';
import { generateDOMMap, domMapToText, invalidateDOMMapCache, type DOMMap, type DOMMapElement } from '../content/dom-map';
import { FeatureFlags, isFeatureEnabled } from './feature-flags';
import { Tier1Executor, type Tier1ExecutionResult, type RejectionCode } from './tier1-executor';
import { PostActionObserver, type PageChanges } from './post-action-observer';
import { capturePageState, verifyStepSuccess } from './success-verifier';
import { SpreadsheetExecutor } from './spreadsheet-executor';
import { SheetStateExtractor } from '../content/sheet-state-extractor';
import { SpreadsheetHelpers } from './spreadsheet-helpers';
import { VisionAssist } from './tier3-vision-assist';
import { RecoveryEngine } from '../content/recovery-engine';
import type { SavedWorkflow } from '../types/workflow';
import type { UserContext } from '../types/ai';
import { ExecutionTelemetry } from './execution-telemetry';
import { StateWaitEngine } from '../content/state-wait-engine';
import { ExecutionLearning } from './execution-learning';
import type { WorkflowMemory } from './workflow-memory/types';

// Extracted agent modules
import { CandidateFinder } from './agent/candidate-finder';
import { HintExtractor } from './agent/hint-extractor';
import { StuckDetector, type StuckContext } from './stuck-detector';
import { StrategicReasoner, type ExecutionPlan } from './agent/strategic-reasoner';

// ============================================================================
// Types
// ============================================================================

/** Actions the agent can take */
export type AgentActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'select'
  | 'multi_select' // Multi-select operations (checkboxes, list items)
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
  | 'copy'      // Copy text to clipboard
  | 'paste'     // Paste text from clipboard
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
  recordedScopeHint?: string;  // Scope from recording (widget title, section, etc.)
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
  decisionSpace?: {         // Available options from recording time (for validation/fallback)
    type?: string;
    selectedText?: string;
    selectedIndex?: number;
    options?: string[];
  };

  // For multi-select operations (checkboxes, list items)
  selectionMode?: 'first' | 'all' | 'matching' | 'count';  // How to select items
  matchPattern?: 'exact' | 'contains' | 'startsWith' | 'regex';  // For matching mode
  selectCount?: number;     // For count mode: how many items to select
  
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
  attribute?: 'value' | 'text' | 'checked' | 'selected' | 'count' | 'disabled' | 'visible';
  storeAs?: string;            // Optional: store in agent memory
  
  // For keyboard - Tab, Enter, Escape, shortcuts
  key?: 'Tab' | 'Enter' | 'Escape' | 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | string;
  modifiers?: Array<'ctrl' | 'shift' | 'alt' | 'meta'>;
  repeat?: number;             // Press key N times
  
  // For hover - reveal menus
  hoverDuration?: number;      // How long to hover (ms)
  waitForMenu?: boolean;        // Wait for menu to appear

  // For copy - select and copy text
  selectAll?: boolean;           // Select all content (default true)
  selectionRange?: { start: number; end: number }; // Select specific range

  // For paste - linked copy/paste flow
  linkedCopyStepId?: string;     // Links to source COPY step (data transfer intent)

  // For spreadsheet actions
  cellRef?: string;            // Cell reference like "B5", "A10"
  column?: string;             // Column letter like "A", "B"
  headerText?: string;         // Column header text
  rowOffset?: number;          // Row offset from header
  cells?: Array<{ cellRef: string; text: string }>;  // For batch operations
  
  // Expected outcome (for verification)
  expectedOutcome?: ExpectedOutcome;
  
  // Coordinate-based execution (from Computer Use or vision fallback)
  x?: number;
  y?: number;
}

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
  
  // 🚀 OPTIMIZATION: Pre-scroll to recorded position before element detection
  // This skips the slow "AI figuring out where to scroll" loop
  recordedScrollY?: number;   // Window scroll position when element was interacted with
  recordedScrollX?: number;   // Window scroll position X (for horizontal scrolling)
  
  // NEW: Spreadsheet context (minimal - full state extracted during replay)
  spreadsheetContext?: {
    recordedIntent: {
      cellRef?: string;
      columnHeader?: string;
      semanticField?: string;  // Same as columnHeader, for pattern understanding
      wasEmpty?: boolean;
      wasAppendPosition?: boolean;
      reasoning?: string;
      column?: string;
      columnDataType?: 'text' | 'number' | 'date' | 'mixed' | 'empty';
      lastDataRow?: number;
      firstEmptyRow?: number;
    };
  };
  
  // Iframe context - for cross-frame execution
  iframeContext?: import('../types/workflow').IframeContext;
  
  // Step type context (for fast-path execution of deterministic steps)
  stepType?: 'TAB_SWITCH' | 'CLICK' | 'INPUT' | 'SCROLL' | 'KEYBOARD' | 'NAVIGATION' | 'COPY' | 'PASTE';
  recordedPayload?: any; // Full recorded payload for TAB_SWITCH, COPY, PASTE steps
  
  // Decision space from recording (for dropdown validation/fallback)
  decisionSpace?: {
    type?: string;
    selectedText?: string;
    selectedIndex?: number;
    options?: string[];
  };

  // Phase 3: AI Analysis context for intelligent execution
  aiAnalysisContext?: {
    intent: string;
    whyThisElement: string;
    elementFindingStrategy: {
      lookingFor: string;
      searchContext: string;
      distinguishers: string[];
      textPatterns: string[];
      elementType: string;
    };
    preconditions: string[];
    expectedOutcome: string;
    criticality: 'critical' | 'important' | 'optional';
    alternatives: string[];
    successCriteria?: {
      type: 'modal_appears' | 'text_appears' | 'text_disappears' | 'url_changes' |
            'element_appears' | 'element_disappears' | 'input_cleared' |
            'toast_appears' | 'count_changes' | 'dom_stabilizes';
      params: Record<string, any>;
      fallback?: string;
    };
  };

  // Phase 4: Learned corrections from past executions
  learnedCorrections?: Array<{
    strategy: string;
    actualElement: {
      foundBy: 'selector' | 'role+name' | 'text' | 'vision' | 'recovery';
      selector?: string;
      role?: string;
      name?: string;
    };
  }>;
}

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

/** A single entry in action history */
export interface ActionHistoryEntry {
  stepNumber: number;
  action: AgentAction;
  observation: AgentObservation;
  result: 'success' | 'failed' | 'pending';
  error?: string;
  timestamp: number;
  pageChanges?: PageChanges;  // Post-action observation - what changed after this action
}

/** Agent state during execution */
/** Context for when agent needs human help */
export interface HumanHelpContext {
  stepDescription: string;
  whatAgentTried: string;
  whatHumanShouldDo: string;
  errorDetails?: string;
}

export interface AgentState {
  workflowId?: string;
  goal: string;
  analyzedIntent?: import('./intent-analyzer').AnalyzedIntent;
  workflowMemory?: WorkflowMemory;
  hints: AgentHint[];
  history: ActionHistoryEntry[];
  currentHintIndex: number;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'stopped';
  startTime: number;
  variableValues?: Record<string, string>;
  userContext?: UserContext;
  memory?: Record<string, string | boolean | number>; // Store values read during execution
  // Strategic reasoning
  executionPlan?: ExecutionPlan;
  currentIteration?: number;
  // Cooperative pausing support
  pauseRequested?: boolean;
  pauseReason?: 'user' | 'agent_needs_help' | 'confirmation_needed';
  helpContext?: HumanHelpContext;
  userStopped?: boolean; // Flag to indicate user-initiated stop (prevents hint index increment on resume)
}

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

/**
 * Execution context passed to LLM when fast-path falls through
 * This gives the LLM information about what was already tried
 */
export interface ExecutionContext {
  // Fast-path attempt details
  fastPathAttempted: boolean;
  fastPathConfidence?: number;  // 0-100
  fastPathReason?: 'NO_SELECTORS' | 'LOW_CONFIDENCE' | 'AMBIGUOUS' | 'NOT_FOUND' | 'ELEMENT_NOT_INTERACTABLE' | 'DROPDOWN_OPEN';

  // What strategies were tried
  strategiesTried: string[];  // ['recorded_selector', 'scope_filter', 'text_match', 'xpath', 'shadow_piercing']

  // Scroll attempts
  scrollAttempted: boolean;
  scrollDirection?: 'up' | 'down';
  scrollAttempts?: number;

  // Why LLM is being called
  callReason: 'DISAMBIGUATION' | 'NOT_FOUND' | 'RECOVERY' | 'LOW_CONFIDENCE' | 'INITIAL';

  // Current step context
  currentStepFailures: number;  // How many times this step has failed
  previousStepAction?: string;  // What the last successful action was

  // Candidate details (what was found)
  candidatesFound: number;
  topCandidateScore?: number;
}

/** Progress callback */
export type AgentProgressCallback = (
  stepNumber: number,
  action: AgentAction,
  status: 'thinking' | 'acting' | 'completed' | 'failed'
) => void;

export type ThinkingEventCallback = (event: import('../types/messages').ThinkingEvent) => void;

// ============================================================================
// AI Agent Class
// ============================================================================

export class AIAgent {
  private state: AgentState;
  private maxSteps: number;
  // @ts-ignore - stepTimeout is stored for potential future use in API timeout
  private stepTimeout: number;
  private onProgress?: AgentProgressCallback;
  private onThinkingEvent?: ThinkingEventCallback;
  private aborted: boolean = false;

  // Execution context for LLM - tracks what was tried before calling LLM
  private executionContext: ExecutionContext = {
    fastPathAttempted: false,
    strategiesTried: [],
    scrollAttempted: false,
    callReason: 'INITIAL',
    currentStepFailures: 0,
    candidatesFound: 0,
  };

  // Extracted modules
  private readonly candidateFinder: CandidateFinder;
  private readonly hintExtractor: HintExtractor;
  private readonly stuckDetector: StuckDetector;

  // Flag to prevent infinite loop when called from ExecutionCoordinator
  private skipUnifiedExecution: boolean;

  constructor(options: {
    maxSteps?: number;
    stepTimeout?: number;
    onProgress?: AgentProgressCallback;
    onThinkingEvent?: ThinkingEventCallback;
    /** Set to true when called from ExecutionCoordinator to prevent infinite loop */
    skipUnifiedExecution?: boolean;
  } = {}) {
    this.maxSteps = options.maxSteps ?? 50;
    this.stepTimeout = options.stepTimeout ?? 30000; // Used for API timeout
    this.onProgress = options.onProgress;
    this.onThinkingEvent = options.onThinkingEvent;
    this.skipUnifiedExecution = options.skipUnifiedExecution ?? false;
    
    // Initialize extracted modules
    this.candidateFinder = new CandidateFinder();
    this.hintExtractor = new HintExtractor();
    this.stuckDetector = new StuckDetector({
      maxAttempts: 3,
      delayBetweenAttempts: 300,  // Reduced from 1500ms to keep scrolling fast
      onStuck: (context: StuckContext) => this.handleStuck(context),
    });
    
    this.state = {
      goal: '',
      hints: [],
      history: [],
      currentHintIndex: 0,
      status: 'paused',
      startTime: 0,
    };
  }

  /**
   * Run the agent to complete a workflow
   */
  async run(
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>,
    userContext?: UserContext
  ): Promise<AgentResult> {
    console.log('[AIAgent] Starting workflow execution');
    console.log(`[AIAgent] 🆔 Workflow ID: ${workflow.id}`);
    console.log(`[AIAgent] 📝 Workflow Name: ${workflow.name || 'Unnamed'}`);
    console.log(`[AIAgent] 📅 Created: ${workflow.createdAt ? new Date(workflow.createdAt).toLocaleString() : 'Unknown'}`);
    console.log(`[AIAgent] 📊 Total steps: ${workflow.steps.length}`);

    // Check if unified execution is enabled (but not if we're already called from coordinator)
    const config = aiConfig.getConfig();
    if (config.useUnifiedExecution && !this.skipUnifiedExecution) {
      console.log('[AIAgent] 🚀 Using Unified Execution Architecture');
      return this.runWithUnifiedExecution(workflow, variableValues, userContext);
    }

    // Clear any existing TabManager state from previous workflows
    try {
      const { TabManager } = await import('../content/universal-execution/tab-manager');
      await TabManager.clearStorage();
      console.log('[AIAgent] 🧹 Cleared previous tab manager state');
    } catch (error) {
      console.warn('[AIAgent] Could not clear tab manager state:', error);
    }

    // =====================================================================
    // STRATEGIC REASONING PHASE
    // Think about WHAT we're trying to accomplish before HOW to do it
    // =====================================================================
    console.log('[AIAgent] 🧠 Strategic Reasoning Phase...');
    const executionPlan = StrategicReasoner.createExecutionPlan(
      workflow,
      variableValues || {},
      undefined // userQuery - could be added later
    );
    StrategicReasoner.logPlan(executionPlan);

    // Check if we need to iterate for multiple items
    if (executionPlan.iterations.length > 1) {
      console.log(`[AIAgent] 🔄 Multi-item execution: ${executionPlan.iterations.length} iterations`);
      return this.runWithIterations(workflow, executionPlan, userContext);
    }

    // Single execution - use first (and only) iteration's variable values
    const effectiveVariables = executionPlan.iterations[0]?.variableValues || variableValues || {};

    // Initialize state
    this.state = {
      workflowId: workflow.id,
      goal: this.inferGoal(workflow),
      analyzedIntent: workflow.analyzedIntent,
      workflowMemory: workflow.memory,
      hints: this.extractHints(workflow, effectiveVariables),
      history: [],
      currentHintIndex: 0,
      status: 'running',
      startTime: Date.now(),
      variableValues: effectiveVariables,
      userContext,
      memory: {},
      executionPlan,
      currentIteration: 0,
    };

    console.log(`[AIAgent] Goal: ${this.state.goal}`);
    console.log(`[AIAgent] Hints: ${this.state.hints.length} steps`);

    // Log intent analysis if available
    if (this.state.analyzedIntent) {
      console.log('[AIAgent] 🧠 Workflow Intent Available:');
      console.log(`  - Primary Goal: ${this.state.analyzedIntent.primaryGoal}`);
      console.log(`  - Expected Outcome: ${this.state.analyzedIntent.expectedOutcome}`);
      console.log(`  - Confidence: ${(this.state.analyzedIntent.confidence * 100).toFixed(0)}%`);
      console.log(`  - Sub-Goals: ${this.state.analyzedIntent.subGoals?.length || 0}`);
      console.log(`  - Failure Patterns: ${this.state.analyzedIntent.failurePatterns?.length || 0}`);
      console.log(`  - Step Translations: ${this.state.analyzedIntent.stepTranslations?.length || 0}`);
    } else {
      console.log('[AIAgent] ⚠️ No analyzedIntent available (workflow may be older)');
    }

    // Log variable values for debugging
    if (effectiveVariables && Object.keys(effectiveVariables).length > 0) {
      console.log(`[AIAgent] 📝 Variable values received:`, effectiveVariables);
      console.log(`[AIAgent] 📝 Variable keys:`, Object.keys(effectiveVariables));
      console.log(`[AIAgent] 📝 Variable entries:`, Object.entries(effectiveVariables).map(([k, v]) => `${k}="${v}"`).join(', '));
    } else {
      console.log(`[AIAgent] ⚠️ No variable values provided!`);
    }

    return this.continueExecution();
  }

  /**
   * Run workflow using the new Unified Execution Architecture
   * This delegates to ExecutionCoordinator for cleaner, faster execution
   */
  private async runWithUnifiedExecution(
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>,
    userContext?: UserContext
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Dynamic import to avoid circular dependencies
      const { ExecutionCoordinator } = await import('./execution');

      const coordinator = new ExecutionCoordinator({
        maxSteps: this.maxSteps,
        stepTimeout: 30000, // Use the stored stepTimeout
        onProgress: (stepIndex, totalSteps, status) => {
          this.onProgress?.(stepIndex, {
            type: status === 'in_progress' ? 'wait' : 'done',
            params: {},
            reasoning: `Step ${stepIndex + 1}/${totalSteps}: ${status}`,
            confidence: 1.0,
          }, status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'acting');
        },
        onThinkingEvent: this.onThinkingEvent,
      });

      const result = await coordinator.execute(workflow, {
        variableValues,
        userContext,
      });

      // Convert ExecutionResult to AgentResult
      return {
        success: result.success,
        stepsCompleted: result.stepsCompleted,
        totalSteps: result.totalSteps,
        history: [], // Unified execution tracks history differently
        elapsedMs: result.elapsedMs,
        finalStatus: result.status === 'completed' ? 'completed' :
                     result.status === 'failed' ? 'failed' :
                     result.status === 'paused' ? 'paused' : 'stopped',
        error: result.error,
      };

    } catch (error) {
      console.error('[AIAgent] Unified execution error:', error);
      return {
        success: false,
        stepsCompleted: 0,
        totalSteps: workflow.steps.length,
        history: [],
        elapsedMs: Date.now() - startTime,
        finalStatus: 'failed',
        error: error instanceof Error ? error.message : 'Unified execution failed',
      };
    }
  }

  /**
   * Run workflow with multiple iterations (for multi-item execution)
   * This is the strategic execution loop that handles "add Alice, Bob, Carol"
   */
  private async runWithIterations(
    workflow: SavedWorkflow,
    plan: ExecutionPlan,
    userContext?: UserContext
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const allHistory: ActionHistoryEntry[] = [];
    let totalStepsCompleted = 0;
    let lastError: string | undefined;

    console.log(`[AIAgent] 🔄 Starting ${plan.iterations.length} iterations`);

    for (let i = 0; i < plan.iterations.length; i++) {
      const iteration = plan.iterations[i];
      console.log(`\n[AIAgent] ========== ITERATION ${i + 1}/${plan.iterations.length} ==========`);
      console.log(`[AIAgent] ${iteration.description}`);
      console.log(`[AIAgent] Variables:`, iteration.variableValues);

      // Notify progress callback about iteration
      this.onProgress?.(0, {
        type: 'wait',
        params: {},
        reasoning: `Starting iteration ${i + 1}/${plan.iterations.length}: ${iteration.description}`,
        confidence: 1.0,
      }, 'thinking');

      // Reset state for this iteration
      this.aborted = false;
      this.state = {
        workflowId: workflow.id,
        goal: this.inferGoal(workflow),
        analyzedIntent: workflow.analyzedIntent,
        workflowMemory: workflow.memory,
        hints: this.extractHints(workflow, iteration.variableValues),
        history: [],
        currentHintIndex: 0,
        status: 'running',
        startTime: Date.now(),
        variableValues: iteration.variableValues,
        userContext,
        memory: {},
        executionPlan: plan,
        currentIteration: i,
      };

      // Execute this iteration
      const result = await this.continueExecution();

      // Collect results
      allHistory.push(...result.history);
      totalStepsCompleted += result.stepsCompleted;

      if (!result.success) {
        lastError = result.error;
        console.log(`[AIAgent] ❌ Iteration ${i + 1} failed: ${result.error}`);
        // Continue with next iteration unless aborted
        if (this.aborted) {
          break;
        }
      } else {
        console.log(`[AIAgent] ✅ Iteration ${i + 1} completed successfully`);
      }

      // Delay between iterations (if not last)
      if (i < plan.iterations.length - 1) {
        const delayMs = 1000; // 1 second between iterations
        console.log(`[AIAgent] ⏳ Waiting ${delayMs}ms before next iteration...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const elapsedMs = Date.now() - startTime;
    const success = !lastError && !this.aborted;

    console.log(`\n[AIAgent] ========== ALL ITERATIONS COMPLETE ==========`);
    console.log(`[AIAgent] Success: ${success}`);
    console.log(`[AIAgent] Total steps completed: ${totalStepsCompleted}`);
    console.log(`[AIAgent] Total time: ${elapsedMs}ms`);

    return {
      success,
      stepsCompleted: totalStepsCompleted,
      totalSteps: workflow.steps.length * plan.iterations.length,
      history: allHistory,
      elapsedMs,
      finalStatus: success ? 'completed' : 'failed',
      error: lastError,
    };
  }
  
  /**
   * Resume execution from saved state
   */
  async resume(savedState: AgentState): Promise<AgentResult> {
    console.log('[AIAgent] Resuming from saved state');
    this.aborted = false; // Reset abort flag
    this.state = savedState;
    this.state.status = 'running';
    
    // Check if this is a tab transfer (not a navigation)
    const isTabTransfer = (savedState as any).transferredToTab !== undefined;
    const isUserStopped = (savedState as any).userStopped === true;
    
    if (isTabTransfer || isUserStopped) {
      // Don't increment - continue from current hint
      console.log('[AIAgent] 🔄 Resuming from current hint (tab transfer or user stop)');
      console.log(`[AIAgent] Will continue from hint ${this.state.currentHintIndex}`);
      // Clear the userStopped flag after resuming
      if (isUserStopped) {
        delete (this.state as any).userStopped;
      }
    } else {
      // Move to next hint after navigation (page reload)
      console.log('[AIAgent] 🔄 Resuming after navigation - incrementing hint index');
      if (this.state.currentHintIndex < this.state.hints.length - 1) {
        this.state.currentHintIndex++;
      }
    }
    
    return this.continueExecution();
  }
  
  /**
   * Stop execution and return current state for resume
   */
  stop(): AgentState {
    console.log('[AIAgent] Stop requested by user');
    this.aborted = true;
    this.state.status = 'stopped';
    this.state.userStopped = true; // Mark as user-stopped to prevent hint index increment on resume
    return { ...this.state };
  }
  
  /**
   * Request human help and pause execution
   * This allows the agent to ask for manual intervention when it gets stuck
   */
  requestHumanHelp(context: HumanHelpContext): void {
    console.log('[AIAgent] Requesting human help:', context.stepDescription);
    this.state.pauseRequested = true;
    this.state.pauseReason = 'agent_needs_help';
    this.state.helpContext = context;
    
    // Notify service worker to update session state
    chrome.runtime.sendMessage({
      type: 'EXECUTION_CONTROL',
      payload: {
        action: 'pause',
        reason: 'agent_needs_help',
        helpContext: context,
      },
    }).catch(err => {
      console.error('[AIAgent] Failed to notify service worker of help request:', err);
    });
  }
  
  /**
   * Handle stuck detection callback from StuckDetector
   */
  private handleStuck(context: StuckContext): void {
    console.log('[AIAgent] 🚨 Agent stuck - requesting human help');
    console.log('[AIAgent] Stuck context:', {
      stepIndex: context.stepIndex,
      stepDescription: context.stepDescription,
      attemptsMade: context.attemptsMade,
      lastError: context.lastError,
    });
    
    const hint = this.state.hints[context.stepIndex];
    if (!hint) {
      console.error('[AIAgent] Cannot request help - hint not found');
      return;
    }
    
    // Build help context
    const helpContext: HumanHelpContext = {
      stepDescription: context.stepDescription,
      whatAgentTried: context.whatAgentTried.join('\n'),
      whatHumanShouldDo: this.generateHelpGuidance(hint),
      errorDetails: context.lastError,
    };
    
    console.log('[AIAgent] Help context created:', helpContext);
    this.requestHumanHelp(helpContext);
  }
  
  /**
   * Generate guidance for what the user should do manually
   */
  private generateHelpGuidance(hint: AgentHint): string {
    const actionType = hint.actionType || 'action';
    const target = hint.targetText || hint.targetRole || 'the element';
    
    switch (actionType) {
      case 'click':
        return `Please click on "${target}" manually, then click Continue.`;
      case 'type':
        const value = hint.value || '[value]';
        return `Please type "${value}" into the "${target}" field manually, then click Continue.`;
      case 'select':
        return `Please select an option from the "${target}" dropdown manually, then click Continue.`;
      case 'scroll':
        return `Please scroll the page to find "${target}", then click Continue.`;
      default:
        return `Please complete this step manually: ${hint.description}, then click Continue.`;
    }
  }
  
  /**
   * Handle user's choice after manual intervention
   * Called when user clicks Continue, Skip, or Retry
   * PUBLIC: Called from content script when resuming after human help
   */
  async handleResumeWithChoice(choice: 'completed' | 'skipped' | 'retry'): Promise<void> {
    const currentHint = this.state.hints[this.state.currentHintIndex];
    if (!currentHint) {
      console.warn('[AIAgent] Cannot handle resume choice - no current hint');
      return;
    }
    
    console.log(`[AIAgent] User chose: ${choice} for step ${this.state.currentHintIndex}`);
    
    switch (choice) {
      case 'completed':
        // User manually completed the step
        currentHint.completed = true;
        currentHint.failureCount = 0;
        this.state.currentHintIndex++;
        console.log(`[AIAgent] ✅ Step marked complete, advancing to ${this.state.currentHintIndex}`);
        break;
        
      case 'skipped':
        // User chose to skip this step
        currentHint.skipped = true;
        currentHint.failureCount = 0;
        this.state.currentHintIndex++;
        console.log(`[AIAgent] ⏭️ Step marked skipped, advancing to ${this.state.currentHintIndex}`);
        break;
        
      case 'retry':
        // User wants agent to try again
        currentHint.failureCount = 0;
        this.stuckDetector.reset();
        console.log(`[AIAgent] 🔄 Resetting failure count, will retry step ${this.state.currentHintIndex}`);
        break;
    }
    
    // Clear pause state
    this.state.pauseRequested = false;
    this.state.pauseReason = undefined;
    this.state.helpContext = undefined;
    
    // Notify progress
    this.notifyProgress();
  }
  
  /**
   * Check if pause has been requested (by user or agent itself)
   * Returns true if execution should pause
   */
  private async checkPauseRequested(): Promise<boolean> {
    // Check local flags first (fast)
    if (this.aborted || this.state.pauseRequested) {
      return true;
    }
    
    // Check with service worker for external pause requests
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_EXECUTION_STATE',
      });
      
      if (response.success && response.data?.session) {
        const session = response.data.session;
        // Check if service worker requested pause
        if (session.status === 'paused' || session.status === 'stopped' || session.status === 'waiting_for_human') {
          console.log('[AIAgent] Pause requested by service worker, status:', session.status);
          this.state.pauseRequested = true;
          return true;
        }
      }
    } catch (error) {
      // Service worker might not be available, continue
      console.warn('[AIAgent] Failed to check pause status with service worker:', error);
    }
    
    return false;
  }
  
  /**
   * Create a paused result when execution is interrupted
   */
  private createPausedResult(): AgentResult {
    // Use appropriate status based on why we paused
    let finalStatus: AgentState['status'] = 'stopped';
    if (this.state.pauseReason === 'agent_needs_help') {
      finalStatus = 'paused'; // Mark as paused, not stopped, so UI shows help panel
    }
    
    return {
      success: false,
      stepsCompleted: this.state.currentHintIndex,
      totalSteps: this.state.hints.length,
      history: this.state.history,
      elapsedMs: Date.now() - this.state.startTime,
      finalStatus,
    };
  }
  
  /**
   * Notify service worker of execution progress
   * Fire-and-forget to avoid blocking execution
   */
  private notifyProgress(): void {
    chrome.runtime.sendMessage({
      type: 'EXECUTION_PROGRESS',
      payload: {
        stepIndex: this.state.currentHintIndex,
        agentState: { ...this.state },
      },
    }).catch(() => {
      // Silently ignore failures - this is just for UI updates
    });
  }
  
  /**
   * Continue execution loop
   */
  private async continueExecution(): Promise<AgentResult> {
    console.log('[AIAgent] 🤖 Continuing DOM-first execution');

    try {
      // Only pre-attach VisionClicker debugger if it's enabled as fallback
      if (FeatureFlags.VISION_CLICKER) {
        const { VisionClicker } = await import('./vision-clicker');
        if (!VisionClicker.isDebuggerReady()) {
          console.log('[AIAgent] 👁️ Pre-attaching debugger for VisionClicker fallback...');
          await VisionClicker.preAttachDebugger();
          await new Promise(resolve => setTimeout(resolve, 300));
          console.log('[AIAgent] ✅ VisionClicker fallback ready');
        }
      } else {
        console.log('[AIAgent] 📄 DOM-first mode (VisionClicker disabled)');
      }

      // Main observe-act loop
      while (this.state.status === 'running') {
        // Check for pause requests (user or agent-initiated)
        if (await this.checkPauseRequested()) {
          console.log('[AIAgent] Pause requested, stopping execution');
          this.state.status = 'stopped';
          return this.createPausedResult();
        }
        
        // Check for user-requested stop (backward compatibility)
        if (this.aborted) {
          console.log('[AIAgent] Execution stopped by user');
          this.state.status = 'stopped';
          break;
        }
        
        // Safety check
        if (this.state.history.length >= this.maxSteps) {
          console.warn('[AIAgent] Max steps reached');
          this.state.status = 'failed';
          break;
        }

        // Get current hint
        const currentHint = this.state.hints[this.state.currentHintIndex];
        console.log(`[AIAgent] 📍 Current hint index: ${this.state.currentHintIndex}, Completed hints: ${this.state.hints.filter(h => h.completed).map(h => h.stepNumber).join(', ')}`);
        
        // Check if all hints are completed or if we're past the last hint
        if (!currentHint || this.state.currentHintIndex >= this.state.hints.length) {
          const completedCount = this.state.hints.filter(h => h.completed).length;
          const totalCount = this.state.hints.length;
          console.log(`[AIAgent] ✅ All hints completed (${completedCount}/${totalCount}) or reached end of workflow`);
          this.state.status = 'completed';
          
          // Emit completion event
          this.onThinkingEvent?.({
            type: 'complete',
            timestamp: Date.now(),
            stepIndex: totalCount,
            stepTotal: totalCount,
            result: {
              success: true,
              duration: Date.now() - this.state.startTime,
            },
          });
          
          // Verify workflow outcome if available
          if (this.state.analyzedIntent?.expectedOutcome) {
            const verification = await this.verifyWorkflowOutcome();
            console.log(`[AIAgent] Outcome verification: ${verification.achieved ? '✅' : '⚠️'} ${verification.reason}`);
          }
          
          break;
        }
        
        if (currentHint) {
          console.log(`[AIAgent] 📍 Current hint: "${currentHint.description}", completed: ${currentHint.completed}`);
          
          // Safety check: Skip if this hint is already marked as skipped or completed
          if (currentHint.skipped) {
            console.warn(`[AIAgent] ⏭️ Current hint ${this.state.currentHintIndex} is already skipped, moving to next`);
            this.state.currentHintIndex++;
            continue;
          }
          if (currentHint.completed) {
            console.warn(`[AIAgent] ⏭️ Current hint ${this.state.currentHintIndex} is already completed, moving to next`);
            this.state.currentHintIndex++;
            continue;
          }
        }
        
        // ============================================================================
        // 🚀 FAST DETERMINISTIC ACTIONS (NO OBSERVE NEEDED)
        // SCROLL and TAB_SWITCH don't need DOM observation - execute immediately!
        // This makes scrolling fast again by skipping the expensive observe() call.
        // ============================================================================
        
        // 1.0 Handle SCROLL hints FIRST (before observe) - FAST PATH!
        if (currentHint?.actionType === 'scroll') {
          console.log(`[AIAgent] 📜 FAST SCROLL: Executing deterministically (no observe needed)`);
          
          const direction = currentHint.scrollDirection || 'down';
          const amount = currentHint.scrollAmount || 300;
          const containerSelector = currentHint.scrollContainer;
          
          if (containerSelector) {
            console.log(`[AIAgent] 📜 Scroll: ${direction} by ${amount}px in "${containerSelector}"`);
          } else {
            console.log(`[AIAgent] 📜 Scroll: ${direction} by ${amount}px on window`);
          }
          
          const scrollAction: AgentAction = {
            type: 'scroll',
            params: {
              direction,
              amount,
              scrollContainerSelector: containerSelector,
              description: currentHint.description,
            },
            reasoning: `Fast scroll: ${direction} ${amount}px`,
            confidence: 1.0,
            hintStepIndex: this.state.currentHintIndex,
          };
          
          this.onProgress?.(this.state.currentHintIndex, scrollAction, 'acting');
          const scrollResult = await this.act(scrollAction);
          
          if (scrollResult.success) {
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.hints[this.state.currentHintIndex].failureCount = 0;
            this.state.currentHintIndex++;
            this.notifyProgress();
            console.log(`[AIAgent] ✅ Fast scroll completed, advanced to hint ${this.state.currentHintIndex}`);
            
            // Brief stability wait (reduced from complex widget waiting)
            await this.sleep(100);
          } else {
            this.state.hints[this.state.currentHintIndex].failureCount = 
              (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
            if (this.state.hints[this.state.currentHintIndex].failureCount! >= 3) {
              console.warn(`[AIAgent] Scroll failed 3 times, skipping...`);
              this.state.hints[this.state.currentHintIndex].skipped = true;
              this.state.currentHintIndex++;
            }
          }
          
          continue; // Next iteration - fast!
        }

        // 1.1 Handle TAB_SWITCH hints BEFORE observe - FAST PATH!
        if (currentHint?.stepType === 'TAB_SWITCH') {
          console.log(`[AIAgent] 🔄 FAST TAB_SWITCH: Executing deterministically (no observe needed)`);
          
          const tabSwitchPayload = currentHint.recordedPayload;
          const toTabIndex = tabSwitchPayload?.toTabIndex;
          const toUrl = tabSwitchPayload?.toUrl;
          const toTitle = tabSwitchPayload?.toTitle;
          const isNewTab = tabSwitchPayload?.isNewTab; // Whether this was a new tab creation or switch
          
          if (toTabIndex === undefined || !toUrl) {
            console.error('[AIAgent] ❌ TAB_SWITCH hint missing required data');
            this.state.hints[this.state.currentHintIndex].failureCount = (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
            this.state.currentHintIndex++;
            continue;
          }
          
          const switchType = isNewTab === true ? '(new tab)' : isNewTab === false ? '(existing tab)' : '(legacy)';
          console.log(`[AIAgent] 🔄 Switching to tab ${toTabIndex}: ${toTitle || toUrl} ${switchType}`);
          
          const tabSwitchAction: AgentAction = {
            type: 'tab_switch',
            params: {
              toTabIndex,
              toUrl,
              toTitle,
              isNewTab, // Pass through the isNewTab indicator
              description: currentHint.description,
            },
            reasoning: `Switching to tab ${toTabIndex}: ${toTitle || toUrl}`,
            confidence: 1.0,
            hintStepIndex: this.state.currentHintIndex,
          };
          
          // STEP 1: Mark as completed and advance FIRST
          this.state.hints[this.state.currentHintIndex].completed = true;
          this.state.hints[this.state.currentHintIndex].failureCount = 0;
          this.state.currentHintIndex++;
          this.notifyProgress();
          console.log(`[AIAgent] ✅ TAB_SWITCH marked complete, advanced to hint ${this.state.currentHintIndex}`);
          
          // STEP 1.5: Clear spreadsheet cache when switching tabs
          // Each sheet may have different data/empty rows!
          if (this.state.memory?.spreadsheetTargetRow) {
            console.log(`[AIAgent] 🧹 Clearing spreadsheet target row cache (was: ${this.state.memory.spreadsheetTargetRow})`);
            delete this.state.memory.spreadsheetTargetRow;
          }
          
          // STEP 2: Save state for new tab to resume
          const stateToSave = {
            ...this.state,
            status: 'running' as const,
            transferredToTab: true,
          };
          
          console.log(`[AIAgent] 💾 Saving state BEFORE tab switch:`, {
            currentHintIndex: stateToSave.currentHintIndex,
            totalHints: stateToSave.hints.length,
            nextHint: stateToSave.hints[stateToSave.currentHintIndex]?.description,
          });
          
          await chrome.storage.local.set({ agentState: stateToSave });
          
          // Wait for storage to commit
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify
          const verification = await chrome.storage.local.get(['agentState']);
          if (verification.agentState) {
            console.log(`[AIAgent] ✅ State saved and verified!`);
          } else {
            console.error(`[AIAgent] ❌ State save verification failed!`);
          }
          
          // STEP 3: Now execute the actual tab switch
          this.onProgress?.(this.state.currentHintIndex - 1, tabSwitchAction, 'acting');
          const tabSwitchResult = await this.act(tabSwitchAction);
          
          // Record result (no observation for fast-path TAB_SWITCH)
          this.state.history.push({
            stepNumber: currentHint.stepNumber,
            action: tabSwitchAction,
            observation: { url: window.location.href, title: document.title } as any,
            result: tabSwitchResult.success ? 'success' : 'failed',
            error: tabSwitchResult.error,
            timestamp: Date.now(),
          });
          
          if (tabSwitchResult.success) {
            console.log(`[AIAgent] 🔄 Tab switched successfully, stopping execution in this tab`);
            return {
              success: true,
              stepsCompleted: this.state.currentHintIndex,
              totalSteps: this.state.hints.length,
              history: this.state.history,
              elapsedMs: Date.now() - this.state.startTime,
              finalStatus: 'running' as const,
            };
          } else {
            console.error(`[AIAgent] ❌ Tab switch failed: ${tabSwitchResult.error}`);
            this.state.hints[this.state.currentHintIndex].failureCount = (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
            continue;
          }
        }

        // 1.2 Handle COPY hints - FAST PATH (deterministic execution)
        if (currentHint?.stepType === 'COPY') {
          console.log(`[AIAgent] 📋 FAST COPY: Executing deterministically`);

          const copyPayload = currentHint.recordedPayload;
          const copyAction: AgentAction = {
            type: 'copy',
            params: {
              target: {
                // Use recorded selectors as fallback selectors for reliable matching
                recordedFallbackSelectors: [
                  copyPayload?.selector,
                  ...(copyPayload?.fallbackSelectors || []),
                ].filter(Boolean),
              },
              text: copyPayload?.clipboardDetails?.text,
              selectAll: copyPayload?.clipboardDetails?.selectAll,
              selectionRange: copyPayload?.clipboardDetails?.selectionRange,
              cellRef: copyPayload?.clipboardDetails?.cellRef, // For spreadsheet COPY
              description: currentHint.description,
            },
            reasoning: `Copying text: "${(copyPayload?.clipboardDetails?.text || '').substring(0, 30)}..."`,
            confidence: 1.0,
            hintStepIndex: this.state.currentHintIndex,
          };

          this.onProgress?.(this.state.currentHintIndex, copyAction, 'acting');
          const copyResult = await this.act(copyAction);

          this.state.history.push({
            stepNumber: currentHint.stepNumber,
            action: copyAction,
            observation: { url: window.location.href, title: document.title } as any,
            result: copyResult.success ? 'success' : 'failed',
            error: copyResult.error,
            timestamp: Date.now(),
          });

          if (copyResult.success) {
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            this.notifyProgress();
            console.log(`[AIAgent] ✅ COPY completed, advanced to hint ${this.state.currentHintIndex}`);
          } else {
            console.error(`[AIAgent] ❌ COPY failed: ${copyResult.error}`);
            this.state.hints[this.state.currentHintIndex].failureCount = (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
          }
          continue;
        }

        // 1.3 Handle PASTE hints - FAST PATH (deterministic execution)
        if (currentHint?.stepType === 'PASTE') {
          console.log(`[AIAgent] 📋 FAST PASTE: Executing deterministically`);

          const pastePayload = currentHint.recordedPayload;
          const pasteAction: AgentAction = {
            type: 'paste',
            params: {
              target: {
                // Use recorded selectors as fallback selectors for reliable matching
                recordedFallbackSelectors: [
                  pastePayload?.selector,
                  ...(pastePayload?.fallbackSelectors || []),
                ].filter(Boolean),
              },
              text: pastePayload?.clipboardDetails?.text,
              linkedCopyStepId: pastePayload?.clipboardDetails?.linkedCopyStepId, // For data transfer intent
              description: currentHint.description,
            },
            reasoning: `Pasting text: "${(pastePayload?.clipboardDetails?.text || '').substring(0, 30)}..."`,
            confidence: 1.0,
            hintStepIndex: this.state.currentHintIndex,
          };

          this.onProgress?.(this.state.currentHintIndex, pasteAction, 'acting');
          const pasteResult = await this.act(pasteAction);

          this.state.history.push({
            stepNumber: currentHint.stepNumber,
            action: pasteAction,
            observation: { url: window.location.href, title: document.title } as any,
            result: pasteResult.success ? 'success' : 'failed',
            error: pasteResult.error,
            timestamp: Date.now(),
          });

          if (pasteResult.success) {
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            this.notifyProgress();
            console.log(`[AIAgent] ✅ PASTE completed, advanced to hint ${this.state.currentHintIndex}`);
          } else {
            console.error(`[AIAgent] ❌ PASTE failed: ${pasteResult.error}`);
            this.state.hints[this.state.currentHintIndex].failureCount = (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
          }
          continue;
        }

        // ============================================================================
        // 2. OBSERVE (for all non-fast-path hints)
        // SCROLL, TAB_SWITCH, COPY, PASTE skip this via continue above
        // ============================================================================
        const observation = await this.observe();
        console.log(`[AIAgent] Observed: ${observation.url}`);
        
        // Emit observation event
        this.onThinkingEvent?.({
          type: 'observe',
          timestamp: Date.now(),
          stepIndex: this.state.currentHintIndex,
          stepTotal: this.state.hints.length,
          observation: {
            url: observation.url,
            pageTitle: observation.title,
            hasModal: observation.hasModal,
            hasDropdown: observation.hasOpenDropdown,
            elementsFound: observation.buttonCount + observation.linkCount + observation.inputCount,
          },
        });
        
        // 2.5 Check if current hint's expected outcome is already satisfied
        if (currentHint?.naturalLanguage?.expectedOutcome) {
          const skipReason = this.checkIfOutcomeAlreadySatisfied(currentHint, observation);
          if (skipReason) {
            console.log(`[AIAgent] ⏭️ SKIPPING STEP: ${skipReason}`);
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            this.notifyProgress();
            this.state.history.push({
              stepNumber: currentHint.stepNumber,
              action: { type: 'skip', params: { reason: skipReason }, reasoning: 'Outcome already satisfied', confidence: 1.0 },
              observation,
              result: 'success',
              timestamp: Date.now(),
            });
            continue;
          }
        }
        
        // ============================================================================
        // 📊 SPREADSHEET INTELLIGENT APPEND ENGINE
        // When on a spreadsheet with type hints:
        // 1. Extract column from recorded cell (A2 → column A)
        // 2. Find the first EMPTY row for that column (intelligent append)
        // 3. Use the same row for all columns (one row per workflow run)
        // This ensures we APPEND new data instead of overwriting
        // ============================================================================
        if (SheetStateExtractor.isSpreadsheetDomain() && currentHint?.actionType === 'type' && currentHint?.value) {
          console.log(`[AIAgent] 📊 SPREADSHEET TYPE HINT detected: "${currentHint.value}"`);
          
          // Extract cell reference from hint using centralized helper
          const recordedCellRef = SpreadsheetHelpers.extractCellReference(currentHint);
          
          if (recordedCellRef) {
            // Extract column letter from recorded cell (A2 → A, B10 → B)
            const columnMatch = recordedCellRef.match(/^([A-Z]+)/i);
            const column = columnMatch ? columnMatch[1].toUpperCase() : 'A';
            
            // ============================================================================
            // INTELLIGENT APPEND: Find the target row
            // We use a shared "targetRow" for the entire workflow run
            // This is stored in agent memory so all columns use the same row
            // ============================================================================
            let targetRow: number;
            
            // Check if we already determined the target row for this workflow run
            if (this.state.memory?.spreadsheetTargetRow) {
              targetRow = this.state.memory.spreadsheetTargetRow as number;
              console.log(`[AIAgent] 📊 Using cached target row: ${targetRow}`);
            } else {
              // First time - find the next empty row using keyboard navigation
              // This is fast (~300ms) and reliable - uses Google's native Ctrl+Down
              console.log(`[AIAgent] 📊 Finding first empty row via keyboard navigation...`);
              targetRow = await SheetStateExtractor.findFirstEmptyRowViaKeyboard();
              console.log(`[AIAgent] 📊 INTELLIGENT APPEND: Using row ${targetRow} (found via Ctrl+Down)`);
              
              // Cache the target row for subsequent steps
              if (!this.state.memory) this.state.memory = {};
              this.state.memory.spreadsheetTargetRow = targetRow;
            }
            
            // Build the actual cell reference
            const actualCellRef = `${column}${targetRow}`;
            
            console.log(`[AIAgent] 📊 Executing SPREADSHEET TYPE: ${actualCellRef} = "${currentHint.value}" (recorded: ${recordedCellRef}, intelligent append)`);
            
            try {
              const result = await SpreadsheetExecutor.execute({
                action: 'type_in_cell',
                cellRef: actualCellRef,
                text: currentHint.value,
                clearFirst: true,
              });
              
              // Record result
              const spreadsheetAction: AgentAction = {
                type: 'type_in_cell',
                params: { cellRef: actualCellRef, text: currentHint.value },
                reasoning: `Intelligent append: type "${currentHint.value}" in ${actualCellRef} (recorded: ${recordedCellRef})`,
                confidence: 1.0,
                hintStepIndex: this.state.currentHintIndex,
              };
              
              this.state.history.push({
                stepNumber: currentHint.stepNumber,
                action: spreadsheetAction,
                observation,
                result: result.success ? 'success' : 'failed',
                error: result.error,
                timestamp: Date.now(),
              });
              
              if (result.success) {
                console.log(`[AIAgent] ✅ Spreadsheet type completed: ${actualCellRef} = "${currentHint.value}"`);
                this.state.hints[this.state.currentHintIndex].completed = true;
                this.state.currentHintIndex++;
                this.notifyProgress();
                this.onProgress?.(this.state.currentHintIndex - 1, spreadsheetAction, 'completed');
              } else {
                console.error(`[AIAgent] ❌ Spreadsheet type failed: ${result.error}`);
                this.state.hints[this.state.currentHintIndex].failureCount = 
                  (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
              }
              
              continue; // Move to next hint
            } catch (error) {
              console.error(`[AIAgent] ❌ Spreadsheet type error:`, error);
            }
          } else {
            console.warn(`[AIAgent] ⚠️ Could not extract cell reference for spreadsheet type hint`);
          }
        }
        
        // ============================================================================
        // 📊 SPREADSHEET CLICK HINTS - BYPASS AI ENTIRELY
        // If on spreadsheet + click hint + cell reference → execute directly
        // ============================================================================
        if (SheetStateExtractor.isSpreadsheetDomain() && currentHint?.actionType === 'click') {
          // Extract cell reference from hint using centralized helper
          const cellRef = SpreadsheetHelpers.extractCellReference(currentHint);
          
          if (cellRef) {
            console.log(`[AIAgent] 📊 Executing SPREADSHEET CLICK: ${cellRef} (NO AI)`);
            
            try {
              const result = await SpreadsheetExecutor.execute({
                action: 'click_cell',
                cellRef: cellRef,
              });
              
              const spreadsheetAction: AgentAction = {
                type: 'click_cell',
                params: { cellRef },
                reasoning: `Direct spreadsheet execution: click cell ${cellRef}`,
                confidence: 1.0,
                hintStepIndex: this.state.currentHintIndex,
              };
              
              this.state.history.push({
                stepNumber: currentHint.stepNumber,
                action: spreadsheetAction,
                observation,
                result: result.success ? 'success' : 'failed',
                error: result.error,
                timestamp: Date.now(),
              });
              
              if (result.success) {
                console.log(`[AIAgent] ✅ Spreadsheet click completed: ${cellRef}`);
                this.state.hints[this.state.currentHintIndex].completed = true;
                this.state.currentHintIndex++;
                this.notifyProgress();
                this.onProgress?.(this.state.currentHintIndex - 1, spreadsheetAction, 'completed');
              } else {
                console.error(`[AIAgent] ❌ Spreadsheet click failed: ${result.error}`);
              }
              
              continue; // Move to next hint
            } catch (error) {
              console.error(`[AIAgent] ❌ Spreadsheet click error:`, error);
            }
          }
          // If no cell reference found, fall through to normal AI flow
        }
        
        // NOTE: NAVIGATION hints are now always converted to 'click' in extractHints()
        // This ensures the agent always clicks through the UI instead of navigating to URLs
        // which could be stale or point to wrong records (e.g., different account IDs)

        // ============================================================================
        // 🚀 CONFIDENCE-BASED HYBRID EXECUTION (OPTIMIZED)
        // DOM finds candidates and calculates confidence
        // Route based on confidence: 95%+ = instant, 70-94% = fast, <70% = LLM
        // OPTIMIZATION: Lowered threshold from 80% to 70% to skip more LLM calls
        // This saves ~500-1500ms per step for high-confidence actions
        // ============================================================================
        if (currentHint) {
          await this.applyProactiveStrategies(currentHint);
        }

        // Include 'select' for native SELECT elements (fast-path can handle them efficiently)
        if (currentHint && (currentHint.actionType === 'click' || currentHint.actionType === 'type' || currentHint.actionType === 'select')) {
          const hybridResult = await this.tryFastPathExecute(currentHint);
          
          if (hybridResult.executed && hybridResult.success) {
            const confidence = hybridResult.confidence || 95;
            const confidenceLabel = confidence >= 95 ? 'HIGH' : 'MEDIUM-HIGH';
            console.log(`[Hybrid] ⚡ ${confidenceLabel} CONFIDENCE (${confidence}%) - ${currentHint.actionType.toUpperCase()} executed instantly, skipping LLM`);
            console.log(`[Hybrid] ✅ MARKING STEP ${this.state.currentHintIndex} (${currentHint.description?.slice(0, 40)}) AS COMPLETE`);
            
            // Mark as completed and advance
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            this.notifyProgress();
            
            // Log to history
            this.state.history.push({
              stepNumber: currentHint.stepNumber,
              action: { 
                type: currentHint.actionType, 
                params: { 
                  description: currentHint.description,
                  ...(currentHint.actionType === 'type' && { text: currentHint.value })
                }, 
                reasoning: `Confidence-based execution: ${hybridResult.confidence}% confidence`, 
                confidence: (hybridResult.confidence || 95) / 100
              },
              observation,
              result: 'success',
              timestamp: Date.now(),
            });
            
            // Brief pause then continue (OPTIMIZED from 150ms)
            await this.sleep(50);
            continue;
          } else if (hybridResult.confidence !== undefined && hybridResult.confidence >= 50) {
            console.log(`[Hybrid] 🧠 MEDIUM CONFIDENCE (${hybridResult.confidence}%) - Using LLM for disambiguation`);
            // Fall through to LLM call below
          } else if (hybridResult.confidence !== undefined) {
            console.log(`[Hybrid] 🔧 LOW CONFIDENCE (${hybridResult.confidence}%) - Using LLM for recovery`);
            // Fall through to LLM call below
          }

          // 🔄 MODAL-AWARE SCROLL: Try scrolling to find the element if not found
          // Triggers when:
          // 1. SMART_HYBRID_MODE is enabled
          // 2. Action is click, type, or select (not just click)
          // 3. Element not found AND confidence is low/absent (not medium+ where candidates exist)
          const shouldTryScroll = isFeatureEnabled('SMART_HYBRID_MODE') &&
            (currentHint.actionType === 'click' || currentHint.actionType === 'type' || currentHint.actionType === 'select') &&
            (!hybridResult.executed && (hybridResult.confidence === undefined || hybridResult.confidence < 50));
          
          if (shouldTryScroll) {
            console.log(`[AIAgent] 🔄 Element not found or low confidence - trying modal-aware scroll to find it`);
            const scrollResult = await this.smartScrollToFind(currentHint);
            if (scrollResult.found) {
              continue;
            }
          }
        }

        if (currentHint && currentHint.actionType === 'select' && isFeatureEnabled('SMART_HYBRID_MODE')) {
          const dropdownResult = await this.executeDropdownWithVision(currentHint);
          if (dropdownResult.success) {
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            this.notifyProgress();

            this.state.history.push({
              stepNumber: currentHint.stepNumber,
              action: {
                type: 'select',
                params: {
                  option: currentHint.value || currentHint.targetText,
                  description: currentHint.description,
                },
                reasoning: 'Dropdown handled by vision flow',
                confidence: 0.9,
              },
              observation,
              result: 'success',
              timestamp: Date.now(),
            });

            await this.sleep(50);
            continue;
          }
        }
        
        // 2. Think (use AI) - only if fast-path didn't work
        this.onProgress?.(this.state.currentHintIndex, { type: 'wait', params: {}, reasoning: 'Thinking...', confidence: 0 }, 'thinking');
        const action = await this.think(observation);
        console.log(`[AIAgent] Action: ${action.type}`, action.params);
        console.log(`[AIAgent] Reasoning: ${action.reasoning}`);
        
        // Emit decision event
        this.onThinkingEvent?.({
          type: 'decide',
          timestamp: Date.now(),
          stepIndex: this.state.currentHintIndex,
          stepTotal: this.state.hints.length,
          decision: {
            action: action.type,
            targetDescription: action.params.target?.name || action.params.target?.text || action.params.description || '',
            reasoning: action.reasoning,
            confidence: action.confidence,
          },
        });

        // 3. Check if done
        if (action.type === 'done') {
          console.log('[AIAgent] Goal achieved!');
          this.state.status = 'completed';
          
          // Verify workflow outcome if available
          if (this.state.analyzedIntent?.expectedOutcome) {
            const verification = await this.verifyWorkflowOutcome();
            console.log(`[AIAgent] Outcome verification: ${verification.achieved ? '✅' : '⚠️'} ${verification.reason}`);
          }
          
          break;
        }

        if (action.type === 'fail') {
          // Retry once on LLM parse failures before giving up
          if (action.reasoning?.includes('Could not extract JSON') && (currentHint.failureCount || 0) < 2) {
            currentHint.failureCount = (currentHint.failureCount || 0) + 1;
            console.warn(`[AIAgent] ⚠️ LLM parse failure (attempt ${currentHint.failureCount}/2), retrying...`);
            await this.sleep(500);
            continue;
          }
          console.error('[AIAgent] Agent decided to fail:', action.params.reason);
          this.state.status = 'failed';
          break;
        }
        
        if (action.type === 'skip') {
          console.log(`[AIAgent] Skipping current hint: ${action.params.reason}`);
          if (action.hintStepIndex !== undefined && action.hintStepIndex < this.state.hints.length) {
            this.state.hints[action.hintStepIndex].skipped = true;
            // Move to next incomplete hint
            const nextHintIndex = this.state.hints.findIndex((h, i) => 
              i > action.hintStepIndex! && !h.completed && !h.skipped
            );
            this.state.currentHintIndex = nextHintIndex !== -1 ? nextHintIndex : this.state.currentHintIndex + 1;
            console.log(`[AIAgent] Advanced to hint ${this.state.currentHintIndex}`);
          }
          // Continue loop without executing (optimized from 200ms)
          await this.sleep(50);
          continue;
        }
        
        // 4. Handle navigation specially
        if (action.type === 'navigate') {
          console.log('[AIAgent] Saving state before navigation');
          await this.saveStateBeforeNavigation();
          
          // Execute navigation
          this.onProgress?.(this.state.currentHintIndex, action, 'acting');
          await this.act(action);
          
          // Navigation will reload page, so return early
          // The agent will resume after reload
          return {
            success: true,
            stepsCompleted: this.state.history.filter(h => h.result === 'success').length,
            totalSteps: this.state.hints.length,
            history: this.state.history,
            elapsedMs: Date.now() - this.state.startTime,
            finalStatus: 'running',
          };
        }

        // 4. Act (non-navigation actions)
        this.onProgress?.(this.state.currentHintIndex, action, 'acting');
        const actionStartTime = Date.now();
        
        // 4.1 Capture pre-action state for post-action observation
        const preActionState = isFeatureEnabled('POST_ACTION_OBSERVER')
          ? PostActionObserver.captureQuickState()
          : null;
        
        const shouldVerifyWithMemory = Boolean(
          isFeatureEnabled('SMART_HYBRID_MODE') &&
          (this.state.workflowMemory?.success?.indicators?.length ||
            this.state.workflowMemory?.success?.failureIndicators?.length)
        );
        const preVerificationState = shouldVerifyWithMemory ? capturePageState() : null;
        const result = await this.act(action);
        let finalResult = result;
        
        // 4.2 Post-action observation - detect what changed
        let pageChanges: PageChanges | null = null;
        if (preActionState && isFeatureEnabled('POST_ACTION_OBSERVER')) {
          try {
            const postActionState = PostActionObserver.captureQuickState();
            if (postActionState) {
              pageChanges = PostActionObserver.detectChanges(preActionState, postActionState);
              
              if (pageChanges?.hasSignificantChange) {
                console.log('[AIAgent] 🔍 Post-action changes detected:', {
                  interpretation: pageChanges.interpretation,
                  changes: pageChanges.changes.map(c => c.description),
                });
                
                // Log specific important changes with context
                pageChanges.changes.forEach(change => {
                  if (change.context) {
                    console.log(`[AIAgent]   - ${change.description}: ${change.context}`);
                  }
                });
              }
            }
          } catch (error) {
            // Observer failed - continue execution normally (non-fatal)
            console.warn('[PostActionObserver] Error (non-fatal, execution continues):', error);
          }
        }
        
        if (shouldVerifyWithMemory && preVerificationState) {
          const postVerificationState = capturePageState();
          const verification = await verifyStepSuccess(
            this.state.workflowMemory,
            this.state.hints[this.state.currentHintIndex]?.stepNumber ?? this.state.currentHintIndex,
            preVerificationState,
            postVerificationState
          );
          if (!verification.success) {
            finalResult = {
              success: false,
              error: `Verification failed: ${verification.reason}`,
            };
            console.warn('[AIAgent] Step verification failed:', verification.reason);
          }
        }

        // Emit action result event
        this.onThinkingEvent?.({
          type: 'act',
          timestamp: Date.now(),
          stepIndex: this.state.currentHintIndex,
          stepTotal: this.state.hints.length,
          result: {
            success: finalResult.success,
            error: finalResult.error,
            duration: Date.now() - actionStartTime,
          },
        });

        // 5. Record history (including page changes if detected)
        const historyEntry: ActionHistoryEntry = {
          stepNumber: this.state.history.length + 1,
          action,
          observation,
          result: finalResult.success ? 'success' : 'failed',
          error: finalResult.error,
          timestamp: Date.now(),
          pageChanges: pageChanges || undefined,  // Add observed changes
        };
        this.state.history.push(historyEntry);

        // 5.5 Check for pause request after action (allows pausing between steps)
        if (await this.checkPauseRequested()) {
          console.log('[AIAgent] Pause requested after action, stopping execution');
          this.state.status = 'stopped';
          return this.createPausedResult();
        }

        // 6. Update hint progress
        // ALWAYS mark currentHintIndex as completed, not hintStepIndex from LLM
        // (LLM might get confused about step numbers, but we know which step we're on)
        if (finalResult.success) {
          const completedIndex = this.state.currentHintIndex;
          if (completedIndex >= 0 && completedIndex < this.state.hints.length) {
            const currentHint = this.state.hints[completedIndex];
            
            // 🚨 CRITICAL: Check if this was an INTERMEDIATE action or the GOAL action
            // Example: Hint says "CLICK on BOGO" but AI clicked combobox to open dropdown
            // Solution: Check if action achieved hint's goal, or was just a preparation step
            const isIntermediateAction = this.detectIntermediateAction(currentHint, action, observation);
            
            if (isIntermediateAction) {
              // ⚠️ Action was intermediate (e.g., opening dropdown) - DON'T mark hint complete yet
              console.log(`[AIAgent] ⏸️  Intermediate action detected - hint ${completedIndex} NOT marked complete yet`);
              console.log(`[AIAgent] 💡 Hint goal: "${currentHint.description}"`);
              console.log(`[AIAgent] 💡 Action taken: ${action.type} "${action.params.target?.name || action.params.target?.text || ''}"`);
              console.log(`[AIAgent] 💡 Need to complete the actual goal in next iteration`);
              
              // 🚨 LOOP DETECTION: Check if we've repeated the same intermediate action too many times
              const actionSignature = `${action.type}:${action.params.target?.name || action.params.target?.text || ''}`;
              const recentSameActions = this.state.history
                .slice(-5) // Check last 5 actions
                .filter(h => {
                  const hAction = h.action;
                  const hSignature = `${hAction.type}:${hAction.params.target?.name || hAction.params.target?.text || ''}`;
                  return hSignature === actionSignature;
                }).length;
              
              if (recentSameActions >= 3) {
                console.error(`[AIAgent] 🔴 LOOP DETECTED: Same intermediate action repeated ${recentSameActions} times!`);
                console.error(`[AIAgent] 🔴 Action: ${actionSignature}`);
                console.error(`[AIAgent] 🔴 Breaking loop by marking hint as failed and skipping modal`);
                
                // Mark hint as failed to break the loop
                currentHint.failureCount = 999; // High number to trigger skip
                currentHint.completed = false;
                
                // Skip to next hint to avoid infinite loop
                let nextIndex = completedIndex + 1;
                while (nextIndex < this.state.hints.length && 
                       (this.state.hints[nextIndex].completed || this.state.hints[nextIndex].skipped)) {
                  nextIndex++;
                }
                this.state.currentHintIndex = nextIndex;
                
                console.warn(`[AIAgent] ⚠️ Skipped hint ${completedIndex} due to loop, advanced to hint ${nextIndex}`);
                continue; // Skip to next iteration
              }
              
              // DON'T advance currentHintIndex - stay on same hint
              // Reset failure count since action succeeded (just not the goal yet)
              currentHint.failureCount = 0;
            } else {
              // ✅ Action achieved the hint's goal - mark complete and advance
              this.state.hints[completedIndex].completed = true;
              this.state.hints[completedIndex].failureCount = 0;  // Reset failure count
              this.stuckDetector.recordSuccess(completedIndex);  // Reset stuck detector
              
              // Find next incomplete hint (skip over already completed/skipped ones)
              let nextIndex = completedIndex + 1;
              while (nextIndex < this.state.hints.length && 
                     (this.state.hints[nextIndex].completed || this.state.hints[nextIndex].skipped)) {
                nextIndex++;
              }
              // If nextIndex is at or past the end, keep it there so we can detect completion
              this.state.currentHintIndex = nextIndex;
              
              console.log(`[AIAgent] ✅ Marked hint ${completedIndex} as completed, advanced to hint ${this.state.currentHintIndex}`);
              console.log(`[AIAgent] Completed hints: ${this.state.hints.filter(h => h.completed).length}/${this.state.hints.length}`);
              
              // Notify UI of progress
              this.notifyProgress();
            }
            
            // 🎯 CRITICAL: If we just clicked something that likely navigated/changed the page,
            // wait for the new content to load before continuing
            const completedHint = this.state.hints[completedIndex];
            const wasNavigationClick = action.type === 'click' && 
              (completedHint?.actionType === 'click' || completedHint?.description?.toLowerCase().includes('navigate'));
            
            if (wasNavigationClick && this.state.currentHintIndex < this.state.hints.length) {
              const nextHint = this.state.hints[this.state.currentHintIndex];
              console.log(`[AIAgent] ⏳ Navigation click detected, waiting for new content to load...`);
              
              // Wait for page stability (optimized from 800ms to 300ms)
              await this.sleep(300); // Initial wait for navigation to start
              
              // If next hint has a scope, wait for that widget to appear
              if (nextHint?.recordedScopeHint) {
                console.log(`[AIAgent] ⏳ Waiting for widget/content "${nextHint.recordedScopeHint}" to become visible...`);
                const maxWaitMs = 5000;
                const checkIntervalMs = 500;
                const startWait = Date.now();
                let contentReady = false;
                
                while (Date.now() - startWait < maxWaitMs) {
                  // Re-generate DOM map to check if content is ready
                  const { generateDOMMap } = await import('../content/dom-map');
                  const currentMap = generateDOMMap();
                  
                  // Check if we have interactive elements with EXACT or near-exact matching text
                  // CRITICAL FIX: Be more strict - don't match "New" to "New Account" breadcrumb
                  // Only match if the element's PRIMARY text is the target
                  const targetText = nextHint.targetText?.toLowerCase().trim() || '';
                  const hasMatchingElements = currentMap.interactiveElements.some(el => {
                    const elName = (el.name || '').toLowerCase().trim();
                    const elText = (el.text || '').toLowerCase().trim();
                    
                    // Must be an exact match
                    // (e.g., "New" matches "New" button, not "New Account" link)
                    const isExactMatch = elName === targetText || elText === targetText;
                    
                    // For buttons specifically, check if it's a clickable element with the right text
                    const isButton = el.role === 'button';
                    const buttonWithText = isButton && (elName === targetText || elText === targetText);
                    
                    return isExactMatch || buttonWithText;
                  });

                  if (hasMatchingElements) {
                    console.log(`[AIAgent] ✅ Content ready - found EXACT matching elements for "${targetText}" (waited ${Date.now() - startWait}ms)`);
                    contentReady = true;
                    break;
                  }
                  
                  // Also check DOM element count - if it's very low, page is still loading
                  if (currentMap.interactiveElements.length < 30) {
                    console.log(`[AIAgent] ⏳ Only ${currentMap.interactiveElements.length} elements - page still loading...`);
                  }
                  
                  await this.sleep(checkIntervalMs);
                }
                
                if (!contentReady) {
                  console.warn(`[AIAgent] ⚠️ Content not ready after ${maxWaitMs}ms - continuing anyway`);
                }
              }
            }
          }
        } else if (!result.success) {
          // Track failures using StuckDetector
          const failedIndex = this.state.currentHintIndex;
          if (failedIndex >= 0 && failedIndex < this.state.hints.length) {
            const hint = this.state.hints[failedIndex];
            hint.failureCount = (hint.failureCount || 0) + 1;
            
            // Use StuckDetector to handle retries with delays
            const shouldPauseForHelp = await this.stuckDetector.recordFailure(
              failedIndex,
              hint.description,
              result.error || 'Unknown error'
            );
            
            if (shouldPauseForHelp) {
              // Agent is stuck - handleStuck was already called by StuckDetector
              // which set pauseRequested, pauseReason, and helpContext
              console.warn(`[AIAgent] 🚨 Agent stuck on step ${failedIndex} - pausing for help`);
              console.log(`[AIAgent] Help context set:`, this.state.helpContext);
              console.log(`[AIAgent] Pause reason:`, this.state.pauseReason);
              
              // CRITICAL: Cleanup any open dropdown/modal before pausing
              await this.cleanupUIState(hint);
              
              // Set status to paused (not stopped) so it can be resumed
              this.state.status = 'paused';
              
              // Return paused result - user will resume via Continue/Skip/Retry
              return this.createPausedResult();
            } else {
              // StuckDetector will have applied delay, just continue to retry
              console.log(`[AIAgent] ⚠️ Step ${failedIndex} failed, will retry after delay`);
            }
          }
        }

        this.onProgress?.(
          this.state.currentHintIndex,
          action,
          result.success ? 'completed' : 'failed'
        );

        // Brief pause between actions (OPTIMIZED from 150ms)
        await this.sleep(50);
      }
    } catch (error) {
      console.error('[AIAgent] Error:', error);
      this.state.status = 'failed';
    }

    // Record execution telemetry (async, non-blocking)
    if (this.state.workflowId) {
      const success = this.state.status === 'completed';
      const durationMs = Date.now() - this.state.startTime;
      const stepsCompleted = this.state.history.filter(h => h.result === 'success').length;
      const failedStepIndex = this.state.history.findIndex(h => h.result === 'failed');
      
      // Collect step results for learning
      const stepResults = this.state.history
        .filter(h => h.action?.type !== 'skip' && h.action?.type !== 'tab_switch')
        .map((h, index) => ({
          index,
          selector: '', // Would need to extract from action params
          success: h.result === 'success',
          resolutionMs: 0, // Would need timing data
          recoveryAttempts: 0,
        }));
      
      const executionEvent = {
        workflowId: this.state.workflowId,
        timestamp: Date.now(),
        success,
        durationMs,
        stepsCompleted,
        totalSteps: this.state.hints.length,
        failedStepIndex: failedStepIndex >= 0 ? failedStepIndex : undefined,
        failureReason: success ? undefined : this.state.history[this.state.history.length - 1]?.error,
        siteUrl: window.location.href,
        stepResults,
      };
      
      ExecutionTelemetry.recordExecution(executionEvent).catch(err => {
        console.warn('Failed to record execution telemetry:', err);
      });
      
      ExecutionTelemetry.updateWorkflowStats(this.state.workflowId, executionEvent).catch(err => {
        console.warn('Failed to update workflow stats:', err);
      });
    }

    return {
      success: this.state.status === 'completed',
      stepsCompleted: this.state.history.filter(h => h.result === 'success').length,
      totalSteps: this.state.hints.length,
      history: this.state.history,
      elapsedMs: Date.now() - this.state.startTime,
      finalStatus: this.state.status,
      error: this.state.status === 'failed' 
        ? this.state.history[this.state.history.length - 1]?.error 
        : undefined,
    };
  }
  
  /**
   * Save state before navigation
   */
  private async saveStateBeforeNavigation(): Promise<void> {
    const stateToSave = {
      workflowId: this.state.workflowId,
      goal: this.state.goal,
      hints: this.state.hints,
      history: this.state.history,
      currentHintIndex: this.state.currentHintIndex,
      status: 'running' as const,
      startTime: this.state.startTime,
      variableValues: this.state.variableValues,
    };
    
    await chrome.storage.local.set({ agentState: stateToSave });
    console.log('[AIAgent] State saved for resumption after navigation');
  }


  /**
   * Observe the current page state using DOM map (primary) + screenshot (optional)
   * Enhanced with PageModel for unified page understanding
   */
  private async observe(): Promise<AgentObservation> {
    console.log('[AIAgent] 🔍 Observing page state...');

    // Try to get PageModel for enhanced observation (async, cached)
    let pageModel: import('./page-model/types').PageModel | undefined;
    try {
      const { getCurrentModel } = await import('./page-model');
      pageModel = await getCurrentModel();
      console.log(`[AIAgent] 📊 PageModel: ${pageModel.pageType.type} page (${(pageModel.pageType.confidence * 100).toFixed(0)}% confidence), context: ${pageModel.activeContext}`);
    } catch (error) {
      // PageModel is optional enhancement
      console.log('[AIAgent] PageModel unavailable, using standard observation');
    }

    // Generate DOM map with iframe content (fast, structured, cheap for LLM)
    // This will scan iframes if we're in the main frame
    const { getCurrentFrameId } = await import('../content/content-script');
    const currentFrameId = getCurrentFrameId();
    
    let domMap;
    if (currentFrameId === 0) {
      // Main frame - scan with iframes
      const { generateDOMMapWithIframes } = await import('../content/dom-map');
      domMap = await generateDOMMapWithIframes();
      console.log('[AIAgent] 🖼️ Generated DOM map with iframe content');
    } else {
      // We're in an iframe - just scan this frame
      const { generateDOMMap } = await import('../content/dom-map');
      domMap = generateDOMMap();
      console.log(`[AIAgent] Generated DOM map for iframe (frameId: ${currentFrameId})`);
    }
    
    let domMapText = domMapToText(domMap);
    
    // NEW: If on a spreadsheet, extract and append spreadsheet state
    if (SheetStateExtractor.isSpreadsheetDomain()) {
      try {
        const sheetState = await SheetStateExtractor.extract();
        if (sheetState) {
          console.log(`[AIAgent] 📊 Extracted spreadsheet state: ${sheetState.columns.length} columns`);
          
          // Append spreadsheet context to DOM map
          const sheetContext = this.formatSheetStateForLLM(sheetState);
          domMapText += `\n\n${sheetContext}`;
        }
      } catch (error) {
        console.warn('[AIAgent] Failed to extract sheet state:', error);
      }
    }
    
    console.log(`[AIAgent] DOM map: ${domMap.interactiveElements.length} interactive elements, ${domMap.formFields.length} form fields`);
    
    // CRITICAL: Log dropdown state prominently
    if (domMap.activeDropdown) {
      console.log(`[AIAgent] 🔽 DROPDOWN IS OPEN with ${domMap.activeDropdown.options.length} options:`, 
        domMap.activeDropdown.options.map(o => o.name || o.text).slice(0, 5));
    }
    
    // Only capture screenshot if VisionClicker is enabled as fallback
    let screenshot: string | undefined;
    if (FeatureFlags.VISION_CLICKER) {
      // skipZoom=true to avoid zoom flashing during execution on spreadsheets
      const capture = await VisualSnapshotService.captureFullPage(0.8, true);
      screenshot = capture?.screenshot;
    }
    
    // Build enhanced observation with PageModel context
    const observation: AgentObservation = {
      url: window.location.href,
      title: document.title,

      // DOM map (primary source)
      domMapText,

      // Modal context - use PageModel if available (more accurate)
      hasModal: pageModel?.uiState.hasModal ?? !!domMap.activeModal,
      modalTitle: pageModel?.uiState.modalInfo?.title ?? domMap.activeModal?.title,

      // CRITICAL: Dropdown context - use PageModel if available
      hasOpenDropdown: pageModel?.uiState.hasOpenDropdown ?? !!domMap.activeDropdown,
      dropdownOptions: pageModel?.uiState.dropdownInfo?.optionTexts ??
        domMap.activeDropdown?.options.map(o => o.name || o.text || '(unnamed)'),

      // Form fields for context
      formFields: domMap.formFields.map(f => ({
        name: f.name,
        value: f.attrs?.value,
        type: f.attrs?.type || 'text',
      })),

      // Counts for quick reference
      buttonCount: domMap.interactiveElements.filter(e => e.role === 'button').length,
      linkCount: domMap.interactiveElements.filter(e => e.role === 'link').length,
      inputCount: domMap.formFields.length,

      // Headings for page structure
      headings: domMap.headings.map(h => h.text),

      // Optional screenshot (only if VisionClicker fallback enabled)
      screenshot,

      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      timestamp: Date.now(),
    };

    // Store PageModel for use by candidateFinder (if available)
    (observation as any)._pageModel = pageModel;
    (observation as any)._domMap = domMap;

    return observation;
  }

  /**
   * Format spreadsheet state for LLM understanding
   */
  private formatSheetStateForLLM(sheetState: import('../content/sheet-state-extractor').SheetState): string {
    const lines: string[] = [];
    
    lines.push('## 📊 SPREADSHEET DETECTED (Google Sheets / Excel Online)');
    lines.push('');
    lines.push(`Sheet: "${sheetState.sheetName}"`);
    lines.push(`Active Cell: ${sheetState.activeCell.reference} (${sheetState.activeCell.isEmpty ? 'empty' : `value: "${sheetState.activeCell.value}"`})`);
    lines.push('');
    
    if (sheetState.headers.length > 0) {
      lines.push('**Column Headers**:');
      lines.push(sheetState.headers.map(h => `  ${h.column}: "${h.text}"`).join('\n'));
      lines.push('');
    }
    
    if (sheetState.columns.length > 0) {
      lines.push('**Column Data**:');
      for (const col of sheetState.columns.slice(0, 10)) { // Limit to 10 columns
        lines.push(`  Column ${col.letter} ("${col.header}"):`);
        lines.push(`    - Data type: ${col.dataType}`);
        lines.push(`    - Last data row: ${col.lastDataRow}`);
        lines.push(`    - Next empty row: ${col.firstEmptyRow}`);
        if (col.sampleValues.length > 0) {
          lines.push(`    - Sample values: ${col.sampleValues.slice(0, 2).join(', ')}`);
        }
      }
      lines.push('');
    }
    
    lines.push('**📊 SPREADSHEET ACTIONS AVAILABLE**:');
    lines.push('When you need to type in a spreadsheet cell, use these specialized actions instead of regular "type":');
    lines.push('');
    lines.push('1. **type_in_cell**: Type directly into a specific cell');
    lines.push('   Example: {"action": "type_in_cell", "cellRef": "B5", "text": "Hello World"}');
    lines.push('');
    lines.push('2. **type_in_header_column**: Type in cell by finding column header');
    lines.push('   Example: {"action": "type_in_header_column", "headerText": "Email", "rowOffset": 1, "text": "john@test.com"}');
    lines.push('   Note: rowOffset 1 = first data row (row 2 if headers in row 1)');
    lines.push('');
    lines.push('3. **type_in_next_empty**: Type in next empty cell of a column');
    lines.push('   Example: {"action": "type_in_next_empty", "column": "A", "text": "New entry"}');
    lines.push('');
    lines.push('4. **read_cell**: Read value from a cell');
    lines.push('   Example: {"action": "read_cell", "cellRef": "C5"}');
    lines.push('');
    lines.push('⚠️ IMPORTANT: When working with spreadsheets, prefer these actions over regular click+type!');
    lines.push('These actions handle cell navigation, verification, and retries automatically.');
    
    return lines.join('\n');
  }

  /**
   * 🚀 FAST-PATH: Try to execute action deterministically without AI
   * This saves ~500-1500ms per step by avoiding the LLM network call
   * 
   * IMPORTANT: This actually EXECUTES the action directly (not just returning an action)
   * because passing the element to Tier1 for re-resolution causes failures.
   * 
   * Returns: { executed: true, success: boolean } if fast-path executed
   *          { executed: false } if should fall back to AI
   */
  private async tryFastPathExecute(hint: AgentHint): Promise<{ executed: boolean; success?: boolean; error?: string; confidence?: number }> {
    // Reset execution context at start of each fast-path attempt
    this.executionContext = {
      fastPathAttempted: true,
      strategiesTried: [],
      scrollAttempted: false,
      callReason: 'INITIAL',
      currentStepFailures: hint.failureCount || 0,
      candidatesFound: 0,
      previousStepAction: this.state.history.length > 0
        ? this.state.history[this.state.history.length - 1].action.type
        : undefined,
    };

    try {
      // Only attempt fast-path for click and type actions
      if (hint.actionType !== 'click' && hint.actionType !== 'type' && hint.actionType !== 'select') {
        this.executionContext.fastPathAttempted = false;
        this.executionContext.callReason = 'INITIAL';
        return { executed: false };
      }

      // 🚀 OPTIMIZATION: Pre-scroll to recorded position BEFORE element detection
      // This skips the slow "AI figuring out where to scroll" loop
      // MODAL-AWARE: Check if we're in a modal and scroll within it
      if (hint.recordedScrollY !== undefined && hint.recordedScrollY > 0) {
        const modalContainer = this.findModalScrollContainer();
        
        if (modalContainer) {
          // We're in a modal - scroll within the modal, not the window
          const currentScrollTop = modalContainer.scrollTop;
          const scrollDiff = Math.abs(hint.recordedScrollY - currentScrollTop);
          
          if (scrollDiff > 100) {
            console.log(`[Hybrid] 🚀 Pre-scrolling MODAL to recorded position: ${hint.recordedScrollY}px (current: ${currentScrollTop}px)`);
            modalContainer.scrollTo({
              top: hint.recordedScrollY,
              behavior: 'instant',
            });
            await this.sleep(50);
          }
        } else {
          // No modal - scroll the window
          const currentScrollY = window.scrollY || window.pageYOffset;
          const scrollDiff = Math.abs(hint.recordedScrollY - currentScrollY);
          
          if (scrollDiff > 100) {
            console.log(`[Hybrid] 🚀 Pre-scrolling WINDOW to recorded position: ${hint.recordedScrollY}px (current: ${currentScrollY}px)`);
            window.scrollTo({
              top: hint.recordedScrollY,
              behavior: 'instant',
            });
            await this.sleep(50);
          }
        }
      }

      // Check if a dropdown is currently open
      const { generateDOMMap } = await import('../content/dom-map');
      const domMap = generateDOMMap();
      const dropdownIsOpen = !!domMap.activeDropdown;
      
      // If dropdown is open and hint text EXACTLY matches a dropdown option, let LLM handle selection
      // CRITICAL FIX: Use EXACT match only - loose "includes" matching was causing "New" button
      // to be skipped because options like "New Account" or "Renew" contain "new"
      if (dropdownIsOpen && hint.targetText && hint.actionType === 'click') {
        const hintTextLower = hint.targetText.toLowerCase().trim();
        const dropdownOptions = domMap.activeDropdown?.options || [];

        // EXACT match only - the hint text must EQUAL an option text (normalized)
        const matchesDropdownOption = dropdownOptions.some(opt => {
          const optText = (opt.text || opt.name || '').toLowerCase().trim();
          // Only match if texts are equal or very close (within 3 char difference for typos)
          return optText === hintTextLower ||
                 (optText.length > 5 && hintTextLower.length > 5 &&
                  Math.abs(optText.length - hintTextLower.length) <= 3 &&
                  (optText.startsWith(hintTextLower) || hintTextLower.startsWith(optText)));
        });

        if (matchesDropdownOption) {
          console.log(`[Hybrid] ⚡ Confidence-based skip: Dropdown option EXACTLY matches "${hint.targetText}" (let LLM select)`);
          this.executionContext.fastPathReason = 'DROPDOWN_OPEN';
          this.executionContext.callReason = 'DISAMBIGUATION';
          this.executionContext.candidatesFound = dropdownOptions.length;
          return { executed: false, confidence: 50 };
        } else {
          console.log(`[Hybrid] 📋 Dropdown is open but "${hint.targetText}" doesn't exactly match any option - continuing hybrid path`);
        }
      }

      // Need recorded selectors for fast-path
      // CRITICAL: When there's a scope hint, PRIORITIZE selectors with scope/widget context!
      // These are usually XPath selectors like: //widget[contains(., "Widget Title")]//button
      let selectors = [
        hint.recordedSelector,
        ...(hint.recordedFallbackSelectors || []),
      ].filter(Boolean) as string[];
      
      if (selectors.length === 0) {
        console.log('[Hybrid] ⚡ Confidence-based skip: No recorded selectors');
        this.executionContext.fastPathReason = 'NO_SELECTORS';
        this.executionContext.callReason = 'RECOVERY';
        return { executed: false, confidence: 0 };
      }

      // CRITICAL: Sort selectors to prioritize widget-scoped ones when there's a scope hint
      if (hint.recordedScopeHint && selectors.length > 1) {
        selectors = selectors.sort((a, b) => {
          // Score selectors by specificity
          const scoreSelector = (sel: string): number => {
            // HIGHEST priority: Shadow-piercing selectors with widget host
            // These find ALL buttons across ALL widgets, perfect for scope filtering
            if (sel.includes(' >> ')) {
              if (sel.toLowerCase().includes('widget') || sel.toLowerCase().includes('report')) {
                return 120; // Highest - finds across all widgets!
              }
              return 95; // Shadow-piercing but generic host
            }
            
            // High priority: XPath with widget/scope context
            // BUT: XPath can't traverse shadow DOM, so lower than shadow-piercing
            if (sel.includes('descendant') && sel.includes('contains(') && hint.recordedScopeHint) {
              const scopeWords = hint.recordedScopeHint.toLowerCase().split(' ');
              const hasWidgetContext = scopeWords.some(word => word.length > 3 && sel.toLowerCase().includes(word));
              if (hasWidgetContext) return 80; // Good but can't see shadow DOM
            }
            
            // XPath with any context
            if (sel.startsWith('//') && sel.includes('[')) return 60;
            
            // Generic attribute selectors - LOWEST priority when there's scope
            if (sel.includes('[aria-label=')) return 30;
            
            // Class-based selectors
            return 20;
          };
          return scoreSelector(b) - scoreSelector(a); // Higher score first
        });
        debugLog('Hybrid', `🔍 Reordered selectors (scope-aware), trying highest priority first: ${selectors[0].substring(0, 80)}`);
      }

      // DEBUG: Log selectors being tried (only in debug mode)
      debugLog('Hybrid', `🔍 Trying ${selectors.length} selectors`, selectors.map(s => s.substring(0, 80)));

      // Track that we're trying recorded selectors
      this.executionContext.strategiesTried.push('recorded_selector');

      // Find ALL matching candidates
      const candidates: HTMLElement[] = [];

      for (const selector of selectors) {
        try {
          let found: NodeListOf<Element> | Element[] = [];

          // Handle XPath selectors using document.evaluate
          if (selector.startsWith('/')) {
            if (!this.executionContext.strategiesTried.includes('xpath')) {
              this.executionContext.strategiesTried.push('xpath');
            }
            debugLog('Hybrid', `🔍 Trying XPath selector: ${selector.substring(0, 80)}`);
            try {
              const xpathResult = document.evaluate(
                selector,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
              );
              
              const xpathElements: Element[] = [];
              for (let i = 0; i < xpathResult.snapshotLength; i++) {
                const node = xpathResult.snapshotItem(i);
                if (node instanceof Element) {
                  xpathElements.push(node);
                }
              }
              found = xpathElements;
              debugLog('Hybrid', `🔍 XPath found ${found.length} elements`);
            } catch (xpathError) {
              debugLog('Hybrid', `🔍 XPath evaluation failed`, xpathError);
              continue;
            }
          } else if (selector.includes(' >> ')) {
            // Handle shadow-piercing selectors (e.g., "gs-report-widget-element >> [aria-label='More Options']")
            if (!this.executionContext.strategiesTried.includes('shadow_piercing')) {
              this.executionContext.strategiesTried.push('shadow_piercing');
            }
            debugLog('Hybrid', `🔍 Trying shadow-piercing selector: ${selector.substring(0, 80)}`);
            const parts = selector.split(' >> ');
            if (parts.length === 2) {
              let [hostSelector, innerSelector] = parts;
              
              // CRITICAL: Normalize host selector - remove dynamic framework classes
              // This handles selectors like "gs-report-widget-element.ng-star-inserted"
              // that were recorded but may not match during replay
              hostSelector = this.normalizeShadowHostSelector(hostSelector);
              debugLog('Hybrid', `🔍 Normalized host selector: "${hostSelector}"`);
              
              // Find all shadow hosts matching the first part
              let hosts: NodeListOf<Element>;
              try {
                hosts = document.querySelectorAll(hostSelector);
              } catch (selectorError) {
                debugLog('Hybrid', `🔍 Host selector invalid after normalization, trying tag-only fallback`);
                // Extract just the tag name as last resort
                const tagMatch = hostSelector.match(/^([a-z][-a-z0-9]*)/i);
                if (tagMatch) {
                  hosts = document.querySelectorAll(tagMatch[1]);
                } else {
                  continue;
                }
              }
              debugLog('Hybrid', `🔍 Found ${hosts.length} shadow hosts for "${hostSelector}"`);
              
              const shadowElements: Element[] = [];
              for (const host of Array.from(hosts)) {
                if (host.shadowRoot) {
                  try {
                    const innerElements = host.shadowRoot.querySelectorAll(innerSelector);
                    shadowElements.push(...Array.from(innerElements));
                    debugLog('Hybrid', `🔍 Found ${innerElements.length} elements in shadow root`);
                  } catch (innerError) {
                    debugLog('Hybrid', `🔍 Inner selector failed`, innerError);
                  }
                }
              }
              found = shadowElements;
              debugLog('Hybrid', `🔍 Shadow-piercing found ${found.length} total elements`);
            } else {
              debugLog('Hybrid', `🔍 Invalid shadow-piercing selector format`);
              continue;
            }
          } else {
            // CSS selector
            if (!this.executionContext.strategiesTried.includes('css_selector')) {
              this.executionContext.strategiesTried.push('css_selector');
            }
            found = document.querySelectorAll(selector);
            debugLog('Hybrid', `🔍 CSS selector "${selector.substring(0, 80)}" found ${found.length} elements`);
          }
          
          let visibleCount = 0;
          for (const el of Array.from(found)) {
            const htmlEl = el as HTMLElement;
            if (htmlEl.offsetParent !== null) { // Check if visible
              const rect = htmlEl.getBoundingClientRect();
              const maxWidth = hint.actionType === 'type' ? 800 : 500;
              if (rect.width > 0 && rect.height > 0 && rect.width < maxWidth && rect.height < 200) {
                candidates.push(htmlEl);
                visibleCount++;
              }
            }
          }
          
          debugLog('Hybrid', `🔍 ${visibleCount} of ${found.length} passed visibility+size checks`);
          
          // If we found a match with this selector, stop trying others
          // With selector prioritization, we try widget-scoped selectors first, so if they match, we're done!
          if (candidates.length > 0) {
            debugLog('Hybrid', `🔍 Stopping selector search - found ${candidates.length} candidates with first matching selector`);
            break;
          }
        } catch (err) {
          debugLog('Hybrid', `🔍 Selector failed`, err);
          // Invalid selector, try next
        }
      }
      
      // DEBUG: Log actual candidate count to diagnose "unique match" bug
      debugLog('Hybrid', `🔍 Found ${candidates.length} candidates matching selectors`);
      if (candidates.length > 0) {
        debugLog('Hybrid', `🔍 First 3 candidates`, candidates.slice(0, 3).map(c => ({
          tag: c.tagName,
          text: c.textContent?.substring(0, 30),
          ariaLabel: c.getAttribute('aria-label'),
          parent: c.parentElement?.tagName,
        })));
      }
      
      // CRITICAL: If there's a scope hint and multiple candidates, filter by scope FIRST
      if (hint.recordedScopeHint && candidates.length > 1) {
        console.log(`[Hybrid] 🔍 Filtering ${candidates.length} candidates by scope: "${hint.recordedScopeHint}"`);
        this.executionContext.strategiesTried.push('scope_filter');

        // Import scope utilities
        const { resolveScopeContainer } = await import('../types/scope');
        const widgetElement = resolveScopeContainer({
          kind: 'WIDGET',
          title: hint.recordedScopeHint,
        }, document);
        
        // For shadow DOM elements, check widget title directly instead of distance
        const filtered: HTMLElement[] = [];
        
        // CRITICAL: Get hint's target text for text-match override
        const hintTargetText = (hint.targetText || '').toLowerCase().trim();
        
        for (const c of candidates) {
          // CRITICAL FIX: If candidate's text matches hint's targetText, ALWAYS include it
          // This prevents filtering out buttons like "New" that are in the action bar
          // (outside the scope widget) but are clearly what we're looking for
          const candidateText = (c.textContent?.trim() || '').toLowerCase();
          const candidateAriaLabel = (c.getAttribute('aria-label') || '').toLowerCase();
          
          if (hintTargetText.length > 0 && (
            candidateText === hintTargetText ||
            candidateText.includes(hintTargetText) ||
            candidateAriaLabel === hintTargetText ||
            candidateAriaLabel.includes(hintTargetText)
          )) {
            console.log(`[Hybrid] ✅ Candidate "${candidateText.substring(0, 30)}" matches hint targetText "${hintTargetText}" - including regardless of scope`);
            filtered.push(c);
            continue;
          }
          
          // Check if element is in a shadow root
          const rootNode = c.getRootNode();
          if (rootNode instanceof ShadowRoot) {
            const host = rootNode.host;
            
            // Get widget title from shadow root
            let widgetTitle = '';
            if (host.shadowRoot) {
              const titleEl = host.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"]');
              widgetTitle = titleEl?.textContent?.trim() || '';
            }
            
            // Fuzzy match with recorded scope hint
            if (widgetTitle) {
              const titleLower = widgetTitle.toLowerCase();
              const scopeLower = hint.recordedScopeHint.toLowerCase();
              const titleStripped = titleLower.replace(/\d+$/g, '').trim();
              const scopeStripped = scopeLower.replace(/\d+$/g, '').trim();
              
              const matches = titleLower.includes(scopeStripped) || 
                             scopeLower.includes(titleStripped) ||
                             titleStripped.includes(scopeStripped) ||
                             scopeStripped.includes(titleStripped);
              
              if (matches) {
                console.log(`[Hybrid] ✅ Candidate in widget "${widgetTitle.substring(0, 50)}" matches scope "${hint.recordedScopeHint}"`);
                filtered.push(c);
                continue;
              } else {
                console.log(`[Hybrid] ⚠️ Candidate in widget "${widgetTitle.substring(0, 50)}" does NOT match scope "${hint.recordedScopeHint}"`);
                continue;
              }
            }
          }
          
          // For non-shadow elements, fall back to distance-based filtering
          if (widgetElement) {
            const widgetRect = widgetElement.getBoundingClientRect();
            const candidateRect = c.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(candidateRect.left + candidateRect.width/2 - (widgetRect.left + widgetRect.width/2), 2) +
              Math.pow(candidateRect.top + candidateRect.height/2 - (widgetRect.top + widgetRect.height/2), 2)
            );
            if (distance < 500) {
              filtered.push(c);
            }
          }
        }
        
        if (filtered.length > 0) {
          console.log(`[Hybrid] ✅ Scope filter: ${candidates.length} → ${filtered.length} candidates within widget "${hint.recordedScopeHint}"`);
          candidates.length = 0;
          candidates.push(...filtered);
        } else {
          console.warn(`[Hybrid] ⚠️ Scope filter found no candidates within widget - keeping all ${candidates.length}`);
        }
      }
      
      // CRITICAL FIX: If 0 candidates found, wait for page to load and retry
      // This handles dynamic pages like Salesforce Pipeline Inspection that load content async
      if (candidates.length === 0 && hint.targetText) {
        console.log(`[Hybrid] ⚠️ 0 candidates found for "${hint.targetText}" - page may still be loading, waiting...`);
        
        // Wait up to 3 seconds for the element to appear
        const maxRetries = 6;
        const retryDelay = 500;
        
        for (let retry = 1; retry <= maxRetries; retry++) {
          await this.sleep(retryDelay);
          
          // Regenerate DOM map
          const { generateDOMMap: refreshDOMMap } = await import('../content/dom-map');
          const freshDomMap = refreshDOMMap();
          console.log(`[Hybrid] 🔄 Retry ${retry}/${maxRetries}: DOM map has ${freshDomMap.interactiveElements.length} elements`);
          
          // Try to find by targetText directly in the fresh DOM map
          const targetTextLower = hint.targetText.toLowerCase().trim();
          for (const el of freshDomMap.interactiveElements) {
            const elText = (el.text || el.name || '').toLowerCase().trim();
            if (elText === targetTextLower || elText.includes(targetTextLower)) {
              // Found a matching element - try to get the actual DOM element
              // Use a simple query to find it
              const possibleElements = document.querySelectorAll('button, a, [role="button"], div[title]');
              for (const possibleEl of Array.from(possibleElements)) {
                const possibleText = (possibleEl.textContent || '').trim().toLowerCase();
                const possibleTitle = (possibleEl.getAttribute('title') || '').toLowerCase();
                if (possibleText === targetTextLower || possibleTitle === targetTextLower) {
                  console.log(`[Hybrid] ✅ Found "${hint.targetText}" after ${retry * retryDelay}ms wait`);
                  candidates.push(possibleEl as HTMLElement);
                  break;
                }
              }
              if (candidates.length > 0) break;
            }
          }
          
          if (candidates.length > 0) {
            console.log(`[Hybrid] ✅ Retry successful: found ${candidates.length} candidates`);
            break;
          }
        }
        
        if (candidates.length === 0) {
          console.log(`[Hybrid] ⚠️ Still 0 candidates after ${maxRetries * retryDelay}ms - element may not exist on this page`);
        }
      }
      
      // Calculate confidence score
      const confidenceAnalysis = this.calculateExecutionConfidence(hint, candidates);

      // Update execution context with confidence analysis results
      this.executionContext.candidatesFound = candidates.length;
      this.executionContext.fastPathConfidence = confidenceAnalysis.confidence;
      this.executionContext.topCandidateScore = confidenceAnalysis.bestCandidate ? confidenceAnalysis.confidence : undefined;

      console.log(`[Hybrid] Confidence: ${confidenceAnalysis.confidence}% - ${confidenceAnalysis.reason}`);

      // ============================================================================
      // CONFIDENCE-BASED ROUTING
      // ============================================================================

      // HIGH CONFIDENCE (95-100%): Execute immediately
      if (confidenceAnalysis.confidence >= 95 && confidenceAnalysis.bestCandidate) {
        console.log('[Hybrid] ⚡ HIGH CONFIDENCE (95%+) - Instant execution');
        return await this.instantExecute(hint, confidenceAnalysis.bestCandidate, confidenceAnalysis.confidence);
      }

      // MEDIUM-HIGH CONFIDENCE (70-94%): Execute with caution (OPTIMIZED from 80%)
      // Lowered threshold to skip more LLM calls - saves ~500-1500ms per step
      if (confidenceAnalysis.confidence >= 70 && confidenceAnalysis.bestCandidate) {
        console.log('[Hybrid] ⚡ MEDIUM-HIGH CONFIDENCE (70-94%) - Fast execution');
        return await this.instantExecute(hint, confidenceAnalysis.bestCandidate, confidenceAnalysis.confidence);
      }

      // MEDIUM CONFIDENCE (50-69%): Let LLM disambiguate (OPTIMIZED from 60%)
      // DOM found candidates, but LLM should pick the right one
      if (confidenceAnalysis.confidence >= 50) {
        console.log('[Hybrid] 🧠 MEDIUM CONFIDENCE (50-69%) - Let LLM pick from candidates');
        this.executionContext.fastPathReason = candidates.length > 1 ? 'AMBIGUOUS' : 'LOW_CONFIDENCE';
        this.executionContext.callReason = 'DISAMBIGUATION';
        return { executed: false, confidence: confidenceAnalysis.confidence };
      }

      // LOW CONFIDENCE (<50%): Full LLM recovery (OPTIMIZED from 60%)
      console.log('[Hybrid] 🔧 LOW CONFIDENCE (<50%) - Full LLM recovery needed');
      this.executionContext.fastPathReason = candidates.length === 0 ? 'NOT_FOUND' : 'LOW_CONFIDENCE';
      this.executionContext.callReason = candidates.length === 0 ? 'NOT_FOUND' : 'LOW_CONFIDENCE';
      return { executed: false, confidence: confidenceAnalysis.confidence };

    } catch (error) {
      console.log('[Hybrid] ⚡ Error in confidence-based routing, falling back to LLM:', error);
      this.executionContext.fastPathReason = 'NOT_FOUND';
      this.executionContext.callReason = 'RECOVERY';
      return { executed: false, confidence: 0 };
    }
  }

  private async applyProactiveStrategies(hint: AgentHint): Promise<void> {
    if (!isFeatureEnabled('SMART_HYBRID_MODE')) return;
    const memory = this.state.workflowMemory;
    const troubleSpots = memory?.experience?.troubleSpots || [];
    if (!troubleSpots.length) return;

    const stepIndex = hint.stepNumber ?? this.state.currentHintIndex;
    const relevantSpots = troubleSpots.filter(spot => spot.stepIndex === stepIndex && spot.frequency > 0.3);
    if (!relevantSpots.length) return;

    for (const spot of relevantSpots) {
      console.log(`[AIAgent] Proactive: Applying known fix for "${spot.issue}"`);
      const issue = spot.issue.toLowerCase();

      if (issue.includes('dropdown') || issue.includes('load')) {
        await this.sleep(500);
      }

      if (issue.includes('scroll') || issue.includes('not visible')) {
        await this.ensureElementVisible(hint);
      }

      if (issue.includes('modal') || issue.includes('overlay')) {
        await this.sleep(300);
      }
    }
  }

  private async ensureElementVisible(hint: AgentHint): Promise<boolean> {
    const selector = hint.targetSelector;
    let element: Element | null = null;

    if (selector) {
      try {
        element = document.querySelector(selector);
      } catch (error) {
        console.warn('[AIAgent] Invalid selector in hint:', selector, error);
      }
    }

    if (!element && hint.targetText) {
      const targetText = hint.targetText.toLowerCase().trim();
      const candidates = Array.from(document.querySelectorAll(
        'button, a, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"]'
      ));
      element = candidates.find(candidate => {
        const html = candidate as HTMLElement;
        const ariaLabel = (html.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (html.getAttribute('placeholder') || '').toLowerCase();
        const text = (html.innerText || html.textContent || '').toLowerCase().trim();
        return ariaLabel === targetText || placeholder === targetText || text === targetText;
      }) || null;
    }

    if (element && element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      await this.sleep(50);
      return true;
    }

    return false;
  }

  private async smartScrollToFind(hint: AgentHint): Promise<{ found: boolean; attempts: number }> {
    if (!isFeatureEnabled('SMART_HYBRID_MODE')) {
      return { found: false, attempts: 0 };
    }
    const config = aiConfig.getConfig();
    if (!config.enabled) {
      // Even if AI is disabled, try simple modal scroll as fallback
      return this.fallbackModalScroll(hint);
    }

    // FIRST: Check if there's a modal open - if so, try scrolling within it proactively
    const modalContainer = this.findModalScrollContainer();
    if (modalContainer) {
      console.log('[AIAgent] 🔍 Modal detected - will scroll within modal to find element');
    }

    const maxScrollAttempts = 3;
    // Track scroll attempts in execution context
    this.executionContext.scrollAttempted = true;
    this.executionContext.scrollAttempts = 0;

    for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
      this.executionContext.scrollAttempts = attempt + 1;
      const captureResult = await VisualSnapshotService.captureFullPage(0.7, true);
      if (!captureResult?.screenshot) {
        // If screenshot fails but modal exists, try fallback scroll
        if (modalContainer) {
          return this.fallbackModalScroll(hint, modalContainer);
        }
        return { found: false, attempts: attempt + 1 };
      }

      const payload = {
        mode: 'agent' as const,
        screenshot: captureResult.screenshot,
        goal: `Find "${hint.targetText || hint.description}" on the page. ${modalContainer ? 'A modal/popup is open - look within it and scroll within the modal if needed.' : 'If not visible, scroll to find it.'}`,
        hints: [{
          stepNumber: hint.stepNumber,
          description: hint.description,
          actionType: hint.actionType === 'type' ? 'type' : hint.actionType === 'select' ? 'select' : 'click',
          targetText: hint.targetText,
          targetPlaceholder: hint.targetPlaceholder,
          targetSelector: hint.targetSelector,
          value: hint.value,
          completed: false,
        }],
        currentHintIndex: 0,
        history: [],
        pageContext: {
          url: window.location.href,
          title: document.title,
          viewportSize: { width: window.innerWidth, height: window.innerHeight },
          hasModal: !!modalContainer, // Let AI know there's a modal
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      let response: Response;
      try {
        response = await fetch(`${config.supabaseUrl}/functions/v1/computer_use`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        console.warn('[AIAgent] smartScrollToFind fetch failed:', error);
        // Try fallback modal scroll if modal exists
        if (modalContainer) {
          return this.fallbackModalScroll(hint, modalContainer);
        }
        return { found: false, attempts: attempt + 1 };
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[AIAgent] smartScrollToFind response error:', response.status);
        // Try fallback modal scroll if modal exists
        if (modalContainer) {
          return this.fallbackModalScroll(hint, modalContainer);
        }
        return { found: false, attempts: attempt + 1 };
      }

      const result = await response.json();
      if (result.action === 'click' && result.params?.x !== undefined) {
        return { found: true, attempts: attempt + 1 };
      }
      
      // If AI returns 'type' action (found the element), consider it found
      if (result.action === 'type' && result.params) {
        return { found: true, attempts: attempt + 1 };
      }

      if (result.action === 'scroll') {
        const direction = result.params?.direction || 'down';
        const amount = result.params?.amount || 300;

        // Track scroll direction in execution context
        this.executionContext.scrollDirection = direction as 'up' | 'down';

        // MODAL-AWARE SCROLLING: Always prefer modal container if one exists
        const scrollTarget = modalContainer || this.findModalScrollContainer();
        if (scrollTarget) {
          console.log(`[AIAgent] 📜 Scrolling within modal container (attempt ${attempt + 1})`);
          scrollTarget.scrollBy({
            top: direction === 'down' ? amount : -amount,
            behavior: 'smooth',
          });
        } else {
          console.log(`[AIAgent] 📜 Scrolling window (attempt ${attempt + 1})`);
          window.scrollBy(0, direction === 'down' ? amount : -amount);
        }
        await this.sleep(200);
        continue;
      }

      if (result.action === 'wait') {
        await this.sleep(result.params?.duration || 300);
        continue;
      }
      
      // AI returned something else (done, fail, unknown) - try one fallback scroll if modal exists
      if (modalContainer && attempt === 0) {
        console.log('[AIAgent] 📜 AI uncertain - attempting fallback modal scroll');
        modalContainer.scrollBy({ top: 300, behavior: 'smooth' });
        await this.sleep(200);
        continue;
      }

      return { found: false, attempts: attempt + 1 };
    }

    return { found: false, attempts: maxScrollAttempts };
  }
  
  /**
   * Fallback modal scroll when AI is unavailable or fails
   * Tries scrolling down within the modal to find the element
   */
  private async fallbackModalScroll(hint: AgentHint, existingModal?: Element | null): Promise<{ found: boolean; attempts: number }> {
    const modalContainer = existingModal || this.findModalScrollContainer();
    if (!modalContainer) {
      console.log('[AIAgent] 📜 No modal found for fallback scroll');
      return { found: false, attempts: 0 };
    }
    
    console.log(`[AIAgent] 📜 Fallback modal scroll: looking for "${hint.targetText || hint.description}"`);
    
    const maxAttempts = 3;
    const scrollAmount = 300;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Try to find the element after scrolling
      const element = this.tryFindElementInModal(hint, modalContainer);
      if (element) {
        console.log('[AIAgent] ✅ Element found in modal after fallback scroll');
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await this.sleep(100);
        return { found: true, attempts: attempt + 1 };
      }
      
      // Scroll down within modal
      const beforeScroll = modalContainer.scrollTop;
      modalContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      await this.sleep(200);
      
      // Check if we've hit the bottom
      if (modalContainer.scrollTop === beforeScroll) {
        console.log('[AIAgent] 📜 Reached bottom of modal - element not found');
        break;
      }
      
      console.log(`[AIAgent] 📜 Modal scroll attempt ${attempt + 1}/${maxAttempts}`);
    }
    
    return { found: false, attempts: maxAttempts };
  }
  
  /**
   * Try to find element within a modal container
   */
  private tryFindElementInModal(hint: AgentHint, modal: Element): Element | null {
    const targetText = (hint.targetText || hint.description || '').toLowerCase().trim();
    if (!targetText) return null;
    
    // Search within the modal only
    const allElements = modal.querySelectorAll('button, input, a, [role="button"], [role="option"], [role="menuitem"], [class*="btn"], label, span, div[tabindex]');
    
    for (const el of Array.from(allElements)) {
      const text = (el.textContent || '').toLowerCase().trim();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase().trim();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase().trim();
      
      if (text.includes(targetText) || targetText.includes(text) ||
          ariaLabel.includes(targetText) || targetText.includes(ariaLabel) ||
          placeholder.includes(targetText) || targetText.includes(placeholder)) {
        // Check if element is visible
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return el;
        }
      }
    }
    
    return null;
  }

  /**
   * Find scrollable container within an active modal/popup
   * Returns the scrollable element if a modal is open, null otherwise
   */
  private findModalScrollContainer(): Element | null {
    // Comprehensive list of modal/popup selectors for different frameworks
    const modalSelectors = [
      // Semantic/ARIA
      '[role="dialog"]',
      '[aria-modal="true"]',
      
      // Generic class patterns
      '.modal',
      '[class*="Modal"]',
      '[class*="modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
      '[class*="popup"]',
      '[class*="Popup"]',
      '[class*="overlay"]',
      '[class*="Overlay"]',
      '[class*="drawer"]',
      '[class*="Drawer"]',
      '[class*="sheet"]',
      '[class*="Sheet"]',
      '[class*="panel"]',
      '[class*="Panel"]',
      '[class*="sidebar"]',
      '[class*="Sidebar"]',
      '[class*="pane"]',
      '[class*="Pane"]',
      '[class*="lightbox"]',
      '[class*="Lightbox"]',
      
      // Framework-specific
      '.MuiDialog-root',        // Material-UI
      '.MuiDrawer-root',        // Material-UI
      '.MuiModal-root',         // Material-UI
      '.ant-modal',             // Ant Design
      '.ant-drawer',            // Ant Design
      '.chakra-modal__content', // Chakra UI
      '.bp3-dialog',            // Blueprint
      '.bp4-dialog',            // Blueprint
      '.slds-modal',            // Salesforce Lightning
      '.gs-modal',              // Gainsight
      '[data-testid*="modal"]',
      '[data-testid*="dialog"]',
      '[data-testid*="drawer"]',
    ];

    for (const selector of modalSelectors) {
      try {
        const modals = Array.from(document.querySelectorAll(selector));
        for (const modal of modals) {
          const style = window.getComputedStyle(modal);
          const isVisible = style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           style.opacity !== '0';
          
          // Check z-index - use 0 as minimum to catch positioned elements
          // Some modals might have lower z-index but still be the active overlay
          const zIndex = parseInt(style.zIndex) || 0;
          const isPositioned = style.position === 'fixed' || style.position === 'absolute';
          
          // Modal is valid if:
          // 1. It's visible AND
          // 2. Either has high z-index (>50) OR is fixed/absolute positioned
          if (isVisible && (zIndex > 50 || isPositioned)) {
            // Check if the modal has enough content to need scrolling
            const rect = modal.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100) {
              // Found an active modal - look for scrollable container within it
              const scrollableContainer = this.findScrollableInElement(modal);
              if (scrollableContainer) {
                console.log(`[AIAgent] 🎯 Found modal scroll container via selector: ${selector}`);
                return scrollableContainer;
              }
              // If modal itself might be scrollable, return it
              if (modal.scrollHeight > modal.clientHeight) {
                console.log(`[AIAgent] 🎯 Modal itself is scrollable: ${selector}`);
                return modal;
              }
            }
          }
        }
      } catch {
        // Invalid selector, skip
      }
    }

    return null;
  }

  /**
   * Find scrollable element within a container (used for modal scrolling)
   */
  private findScrollableInElement(element: Element): Element | null {
    // Check if element itself is scrollable
    const style = window.getComputedStyle(element);
    const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                        style.overflowY === 'auto' || style.overflowY === 'scroll';
    
    if (isScrollable && element.scrollHeight > element.clientHeight) {
      return element;
    }
    
    // Look for scrollable children
    const children = Array.from(element.querySelectorAll('*'));
    for (const child of children) {
      const childStyle = window.getComputedStyle(child);
      const isChildScrollable = childStyle.overflow === 'auto' || childStyle.overflow === 'scroll' || 
                               childStyle.overflowY === 'auto' || childStyle.overflowY === 'scroll';
      
      if (isChildScrollable && child.scrollHeight > child.clientHeight) {
        return child;
      }
    }
    
    return null;
  }

  private async callComputerUseFindElement(
    screenshot: string,
    target: { text?: string; role?: string; label?: string; description?: string }
  ): Promise<{ coordinates: { x: number; y: number }; confidence: number; reasoning?: string } | null> {
    const config = aiConfig.getConfig();
    if (!config.enabled) {
      return null;
    }

    const payload = {
      mode: 'find_element' as const,
      screenshot,
      target,
      pageContext: {
        url: window.location.href,
        title: document.title,
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(`${config.supabaseUrl}/functions/v1/computer_use`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      console.warn('[AIAgent] callComputerUseFindElement fetch failed:', error);
      return null;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn('[AIAgent] callComputerUseFindElement response error:', response.status);
      return null;
    }

    const result = await response.json();
    if (!result?.coordinates || typeof result.coordinates.x !== 'number') {
      return null;
    }

    return {
      coordinates: result.coordinates,
      confidence: result.confidence || 0,
      reasoning: result.reasoning,
    };
  }

  private async executeDropdownWithVision(hint: AgentHint): Promise<{ success: boolean; error?: string }> {
    const config = aiConfig.getConfig();
    if (!config.enabled) {
      return { success: false, error: 'AI features are disabled' };
    }

    const captureResult1 = await VisualSnapshotService.captureFullPage(0.7, true);
    if (!captureResult1?.screenshot) {
      return { success: false, error: 'Failed to capture screenshot for dropdown trigger' };
    }

    const triggerResult = await this.callComputerUseFindElement(captureResult1.screenshot, {
      text: hint.targetText,
      role: 'combobox',
      description: 'dropdown trigger to open',
    });

    if (!triggerResult || triggerResult.confidence < 0.5) {
      return { success: false, error: 'Could not find dropdown trigger' };
    }

    const { VisionClicker } = await import('./vision-clicker');
    await VisionClicker.clickAt(
      triggerResult.coordinates.x,
      triggerResult.coordinates.y,
      'Open dropdown'
    );

    await this.sleep(300);

    const captureResult2 = await VisualSnapshotService.captureFullPage(0.7, true);
    if (!captureResult2?.screenshot) {
      return { success: false, error: 'Failed to capture screenshot for dropdown options' };
    }

    const optionText = hint.value || hint.targetText || '';
    const optionResult = await this.callComputerUseFindElement(captureResult2.screenshot, {
      text: optionText,
      role: 'option',
      description: `option to select: "${optionText}"`,
    });

    if (!optionResult || optionResult.confidence < 0.5) {
      return { success: false, error: `Could not find option "${optionText}"` };
    }

    await VisionClicker.clickAt(
      optionResult.coordinates.x,
      optionResult.coordinates.y,
      `Select option "${optionText}"`
    );

    return { success: true };
  }

  private async attemptMemoryBasedRecovery(
    hint: AgentHint,
    error: string
  ): Promise<{ recovered: boolean; strategy?: string }> {
    if (!isFeatureEnabled('SMART_HYBRID_MODE')) {
      return { recovered: false };
    }
    const fallbacks = this.state.workflowMemory?.adaptability?.fallbacks || [];
    if (!fallbacks.length) {
      return { recovered: false };
    }

    const lowerError = error.toLowerCase();
    const matchingFallback = fallbacks.find(fallback => {
      if (fallback.forStep !== undefined && fallback.forStep !== hint.stepNumber) {
        return false;
      }
      const when = fallback.when.toLowerCase();
      return lowerError.includes(when) || (when.includes('not found') && lowerError.includes('not found'));
    });

    if (!matchingFallback) {
      return { recovered: false };
    }

    const alternativeTarget = this.extractAlternativeTarget(matchingFallback.then);
    const modifiedHint: AgentHint = {
      ...hint,
      targetText: alternativeTarget || hint.targetText,
    };

    console.log(`[AIAgent] Applying memory fallback: "${matchingFallback.then}"`);
    const recoveryResult = await this.tryFastPathExecute(modifiedHint);
    return {
      recovered: Boolean(recoveryResult.executed && recoveryResult.success),
      strategy: matchingFallback.then,
    };
  }

  private extractAlternativeTarget(text: string): string | null {
    const match = text.match(/["']([^"']+)["']/);
    return match ? match[1].trim() : null;
  }
  
  /**
   * Normalize a shadow host selector by removing dynamic framework classes
   * Handles selectors like "gs-report-widget-element.ng-star-inserted" -> "gs-report-widget-element"
   */
  private normalizeShadowHostSelector(selector: string): string {
    // Dynamic class patterns that should be stripped
    const dynamicPatterns = [
      /\.ng-[a-z-]+/gi,          // Angular: .ng-star-inserted, .ng-scope, etc.
      /\.react-[a-z0-9-]+/gi,    // React
      /\.v-[a-z0-9-]+/gi,        // Vue: .v-leave, .v-enter, etc.
      /\.vue-[a-z0-9-]+/gi,      // Vue
      /\.css-[a-z0-9]+/gi,       // CSS-in-JS
      /\._css-[a-z0-9]+/gi,      // CSS Modules
      /\.sc-[a-z0-9]+/gi,        // styled-components
      /\.emotion-[a-z0-9]+/gi,   // Emotion
      /\.jss\d+-[a-z0-9]+/gi,    // JSS
      /\.Mui[A-Z][a-zA-Z0-9-]+/g, // Material-UI
      /\.[a-z]+-[a-z0-9]{6,}/gi, // Generic random hash classes
    ];
    
    let normalized = selector;
    for (const pattern of dynamicPatterns) {
      normalized = normalized.replace(pattern, '');
    }
    
    // Clean up any trailing dots or malformed selectors
    normalized = normalized.replace(/\.+/g, '.').replace(/\.$/, '');
    
    // If we stripped everything except the tag, that's fine
    // e.g., "gs-report-widget-element" is still valid
    
    return normalized;
  }

  /**
   * Execute action instantly with high confidence
   * Used when confidence >= 80%
   */
  private async instantExecute(
    hint: AgentHint,
    element: Element,
    confidence: number
  ): Promise<{ executed: boolean; success: boolean; error?: string; confidence: number }> {
    try {
      // Cast to HTMLElement for execution
      const htmlElement = element as HTMLElement;
      
      console.log(`[Hybrid] ⚡ Executing ${hint.actionType} with ${confidence}% confidence`, {
        tag: htmlElement.tagName,
        text: htmlElement.textContent?.slice(0, 50),
      });

      // CRITICAL: Check if element is in a shadow root
      // Elements inside shadow roots should NEVER trigger page scrolls!
      const rect = htmlElement.getBoundingClientRect();
      const isInShadowDOM = htmlElement.getRootNode() instanceof ShadowRoot;
      
      // Check if element is in viewport
      const isInViewport = (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth
      );
      
      // Only scroll if:
      // 1. NOT in shadow DOM (buttons inside widgets should never scroll the page!)
      // 2. NOT already in viewport
      if (!isInShadowDOM && !isInViewport) {
        console.log('[Hybrid] Element not in viewport, scrolling into view');
        htmlElement.scrollIntoView({ block: 'center', behavior: 'instant' });
        await this.sleep(50);
      } else if (isInShadowDOM) {
        console.log('[Hybrid] ⚠️ Element in shadow DOM - NEVER scroll page (widget already visible)');
      } else {
        console.log('[Hybrid] Element already in viewport, skipping scroll');
      }
      
      htmlElement.focus();
      
      // Execute action
      if (hint.actionType === 'click') {
        // For NAVIGATION steps, capture URL before click to verify navigation happened
        const isNavigationStep = hint.description?.toLowerCase().includes('navigate') ||
                                 hint.description?.toLowerCase().includes('go to') ||
                                 hint.stepType === 'NAVIGATION';
        const urlBefore = isNavigationStep ? window.location.href : null;
        
        htmlElement.click();
        
        // For NAVIGATION steps, verify something changed (URL or modal appeared)
        if (isNavigationStep) {
          await this.sleep(500); // Wait for navigation to start
          const urlAfter = window.location.href;
          const modalAppeared = document.querySelector('[role="dialog"], .modal, .slds-modal, [aria-modal="true"]');
          
          if (urlAfter === urlBefore && !modalAppeared) {
            console.warn(`[Hybrid] ⚠️ NAVIGATION step clicked but no URL change or modal detected`);
            console.warn(`[Hybrid] ⚠️ URL before: ${urlBefore}`);
            console.warn(`[Hybrid] ⚠️ URL after: ${urlAfter}`);
            console.warn(`[Hybrid] ⚠️ Falling back to LLM for better element selection`);
            return { executed: false, success: false, error: 'Navigation click had no effect', confidence };
          }
        }
      } else if ((hint.actionType === 'type' || hint.actionType === 'select') && hint.value) {
        // Check if element is a SELECT dropdown - needs special handling
        if (htmlElement.tagName === 'SELECT') {
          console.log('[Hybrid] ⚡ Element is SELECT dropdown, setting value directly');
          const selectEl = htmlElement as HTMLSelectElement;
          const targetValue = hint.value.trim();
          const targetLower = targetValue.toLowerCase();

          // Find matching option with priority: exact match > starts with > contains
          let matchedOption: HTMLOptionElement | null = null;
          let matchType = '';

          const options = Array.from(selectEl.options);

          // Priority 1: Exact match (case-insensitive) on text or value
          for (const option of options) {
            const optText = option.textContent?.trim() || '';
            const optValue = option.value;
            if (optText.toLowerCase() === targetLower || optValue.toLowerCase() === targetLower) {
              matchedOption = option;
              matchType = 'exact';
              break;
            }
          }

          // Priority 2: Starts with match (for partial input like "Opt" matching "Option 2")
          if (!matchedOption) {
            for (const option of options) {
              const optText = option.textContent?.trim().toLowerCase() || '';
              if (optText.startsWith(targetLower) || targetLower.startsWith(optText)) {
                matchedOption = option;
                matchType = 'startsWith';
                break;
              }
            }
          }

          // Priority 3: Contains match (last resort)
          if (!matchedOption) {
            for (const option of options) {
              const optText = option.textContent?.trim().toLowerCase() || '';
              // Only match if target is a significant substring (at least 3 chars and >50% of option text)
              if (targetLower.length >= 3 && optText.includes(targetLower) &&
                  targetLower.length > optText.length * 0.5) {
                matchedOption = option;
                matchType = 'contains';
                break;
              }
            }
          }

          if (matchedOption) {
            selectEl.value = matchedOption.value;
            // Dispatch change event to trigger any listeners
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`[Hybrid] ⚡ Selected option: "${matchedOption.textContent?.trim()}" (${matchType} match)`);
          } else {
            console.log(`[Hybrid] ⚡ No matching option found for "${targetValue}" in ${options.length} options, falling back to LLM`);
            console.log(`[Hybrid] Available options:`, options.map(o => o.textContent?.trim()).join(', '));
            return { executed: false, success: false, confidence };
          }
        } else if (hint.actionType === 'select') {
          // actionType is 'select' but element is not a SELECT - fall back to LLM
          console.log('[Hybrid] ⚡ Hint says select but element is not SELECT, falling back to LLM');
          return { executed: false, success: false, confidence };
        } else {
          // For text inputs, type directly into the element
          console.log('[Hybrid] ⚡ Typing directly into element');

          // Clear first if needed
          if ('value' in htmlElement) {
            (htmlElement as HTMLInputElement).value = '';
          }

          // Focus and type
          htmlElement.focus();

          // Use execCommand for better compatibility, fallback to direct value set
          const inputEl = htmlElement as HTMLInputElement | HTMLTextAreaElement;
          if ('value' in inputEl) {
            inputEl.value = hint.value;
            // Dispatch input event to trigger validation/listeners
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // Fallback to Tier1Executor
            const { Tier1Executor } = await import('./tier1-executor');
            const typeAction: AgentAction = {
              type: 'type',
              params: {
                text: hint.value,
                clearFirst: true,
              },
              reasoning: `Confidence-based execution (${confidence}%)`,
              confidence: confidence / 100,
            };

            const result = await Tier1Executor.execute(typeAction);
            if (result.status !== 'success') {
              console.log('[Hybrid] ⚡ Type execution failed, falling back to LLM');
              return { executed: false, success: false, confidence };
            }
          }
        }
      }
      
      // Invalidate DOM map cache after action (OPTIMIZATION)
      invalidateDOMMapCache();
      
      // Wait for stability (OPTIMIZED from 2000ms)
      const { StateWaitEngine } = await import('../content/state-wait-engine');
      await StateWaitEngine.waitForStability({ maxWaitMs: 1000 });
      
      console.log(`[Hybrid] ⚡ ${hint.actionType} executed successfully (${confidence}% confidence)`);
      return { executed: true, success: true, confidence };
      
    } catch (executeError) {
      console.log(`[Hybrid] ⚡ Execution failed, falling back to LLM:`, executeError);
      return { executed: false, success: false, error: executeError instanceof Error ? executeError.message : 'Unknown', confidence };
    }
  }

  /**
   * Calculate confidence score for executing a hint without LLM
   * Returns: 0-100 score indicating how confident we are about direct execution
   * 
   * Confidence factors:
   * - Selector quality (40 points): testId > aria-label > name > ID > generic
   * - Candidate count (30 points): 1 = high, 2-3 = medium, 4+ = low
   * - Scope clarity (20 points): no scope > scoped with 1 match > scoped with multiple
   * - Element state (10 points): visible + enabled
   */
  private calculateExecutionConfidence(
    hint: AgentHint,
    candidates: Element[]
  ): { confidence: number; reason: string; bestCandidate?: Element } {
    let score = 0;
    const reasons: string[] = [];
    
    // DEBUG: Log what we received
    console.log(`[Hybrid] 🔍 calculateExecutionConfidence called with ${candidates.length} candidates`);
    console.log(`[Hybrid] 🔍 Hint has scope: ${hint.recordedScopeHint ? `"${hint.recordedScopeHint}"` : 'NO'}`);
    
    // Factor 1: Number of candidates (30 points)
    if (candidates.length === 0) {
      return { confidence: 0, reason: 'No candidates found' };
    } else if (candidates.length === 1) {
      score += 30;
      reasons.push('unique match (+30)');
      console.log(`[Hybrid] 🔍 Factor 1: UNIQUE MATCH - 1 candidate found`);
    } else if (candidates.length === 2) {
      score += 15;
      reasons.push('2 candidates (+15)');
      console.log(`[Hybrid] 🔍 Factor 1: 2 candidates`);
    } else if (candidates.length === 3) {
      score += 10;
      reasons.push('3 candidates (+10)');
      console.log(`[Hybrid] 🔍 Factor 1: 3 candidates`);
    } else {
      reasons.push(`${candidates.length} candidates (0)`);
      console.log(`[Hybrid] 🔍 Factor 1: ${candidates.length} candidates (LOW CONFIDENCE)`);
    }
    
    // Factor 2: Selector quality (40 points)
    if (hint.recordedTestId) {
      score += 40;
      reasons.push('testId (+40)');
    } else if (hint.recordedAriaLabel) {
      score += 35;
      reasons.push('aria-label (+35)');
    } else if (hint.recordedSelector?.includes('[name=') || hint.recordedSelector?.includes('name="')) {
      score += 30;
      reasons.push('name attr (+30)');
    } else if (hint.recordedSelector?.startsWith('#')) {
      score += 20;
      reasons.push('ID selector (+20)');
    } else if (hint.recordedSelector?.includes('[aria-label=')) {
      score += 35;
      reasons.push('aria-label in selector (+35)');
    } else {
      score += 10;
      reasons.push('generic selector (+10)');
    }
    
    // Factor 3: Scope/context clarity (20 points)
    // UNIVERSAL PRINCIPLE: If selector finds EXACTLY 1 element globally, it's unambiguous!
    // Scope is context from recording, but if selector is globally unique, we can execute safely.
    // Only worry about scope when there are MULTIPLE matches that need disambiguation.
    if (!hint.recordedScopeHint) {
      // No scope = page-level element
      score += 20;
      reasons.push('no scope ambiguity (+20)');
      console.log(`[Hybrid] 🔍 Factor 3: No scope - page-level element`);
    } else if (candidates.length === 1) {
      // Has scope BUT selector is globally unique!
      // This means the selector itself is strong enough (e.g., unique aria-label)
      // Safe to execute - the scope was just for context during recording
      score += 18;
      reasons.push('globally unique despite scope (+18)');
      console.log(`[Hybrid] 🔍 Factor 3: Scope "${hint.recordedScopeHint}" but GLOBALLY UNIQUE (1 match) - safe to execute`);
    } else if (candidates.length <= 3) {
      // Has scope + few candidates = moderate ambiguity
      // LLM should verify which one is in the correct scope
      score += 5;
      reasons.push('scope + few candidates, need verification (+5)');
      console.log(`[Hybrid] 🔍 Factor 3: ${candidates.length} candidates in scope "${hint.recordedScopeHint}" - LLM should verify`);
    } else {
      // Has scope + many candidates = high ambiguity
      // Definitely need LLM for disambiguation
      score += 0;
      reasons.push(`scope + ${candidates.length} candidates, need LLM (0)`);
      console.log(`[Hybrid] 🔍 Factor 3: ${candidates.length} candidates + scope - MUST use LLM`);
    }
    
    // Factor 4: Element state (10 points)
    const bestCandidate = candidates[0];
    if (bestCandidate && bestCandidate instanceof HTMLElement) {
      const isVisible = bestCandidate.offsetParent !== null;
      const rect = bestCandidate.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;
      const isEnabled = !bestCandidate.hasAttribute('disabled');
      
      if (isVisible && hasSize && isEnabled) {
        score += 10;
        reasons.push('interactable (+10)');
      } else {
        reasons.push('not fully interactable (0)');
      }
    }
    
    // Factor 5: Text match quality (15 points)
    // When multiple candidates exist, boost confidence if the top candidate's text matches the hint target
    if (bestCandidate && hint.targetText && candidates.length > 1) {
      const hintText = hint.targetText.trim().toLowerCase();

      // Get text from element (handles buttons, links, labels, spans, etc.)
      let elementText = (bestCandidate.textContent || '').trim().toLowerCase();

      // For input elements (checkboxes, radios), check the associated label
      if (bestCandidate instanceof HTMLInputElement && bestCandidate.id) {
        const label = bestCandidate.ownerDocument?.querySelector(`label[for="${CSS.escape(bestCandidate.id)}"]`);
        if (label) {
          elementText = (label.textContent || '').trim().toLowerCase();
        }
      }

      // Also check aria-label
      const ariaLabel = (bestCandidate.getAttribute('aria-label') || '').trim().toLowerCase();

      if (elementText === hintText || ariaLabel === hintText) {
        score += 15;
        reasons.push('text match (+15)');
      }
    }

    const finalScore = Math.min(score, 100);
    const reason = reasons.join(', ');

    console.log(`[Hybrid] Confidence: ${finalScore}% - ${reason}`);

    return {
      confidence: finalScore,
      reason,
      bestCandidate: bestCandidate || undefined,
    };
  }

  /**
   * Think about what action to take (DOM-first approach)
   */
  private async think(observation: AgentObservation): Promise<AgentAction> {
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/dom_agent`;  // New endpoint for DOM-based agent

    // Find current hint to focus on
    const nextIncompleteHint = this.state.hints.find(h => !h.completed);
    
    // Generate FRESH DOM map for candidate finding AND sending to LLM
    // This ensures we use the current modal/dropdown state, not stale observation
    const domMap = generateDOMMap();
    const freshDomMapText = domMapToText(domMap);

    // Try to get PageModel for enhanced candidate scoring
    let pageModel: import('./page-model/types').PageModel | undefined;
    try {
      const { getCurrentModel } = await import('./page-model');
      pageModel = await getCurrentModel();
    } catch {
      // PageModel is optional
    }

    // Find and rank candidates for the current hint (with PageModel for enhanced scoring)
    let currentCandidates: Array<DOMMapElement & { index: number; score: number }> = [];
    if (nextIncompleteHint) {
      currentCandidates = this.findAndRankCandidates(nextIncompleteHint, domMap, pageModel);
      console.log(`[AIAgent] Found ${currentCandidates.length} ranked candidates for hint ${nextIncompleteHint.stepNumber}`);
      if (currentCandidates.length > 0) {
        console.log(`[AIAgent] Top candidate: [${currentCandidates[0].role}] "${currentCandidates[0].name}" (score: ${currentCandidates[0].score})`);
      }
    }

    // Extract all unique widget titles from candidates for LLM context
    const availableWidgets = new Set<string>();
    currentCandidates.forEach(c => {
      if (c.widgetTitle) {
        availableWidgets.add(c.widgetTitle);
      }
    });
    // Also check DOM map for all widgets on the page
    domMap.interactiveElements.forEach(el => {
      if (el.widgetTitle) {
        availableWidgets.add(el.widgetTitle);
      }
    });

    // CRITICAL: Inherit widget scope from previous step for menu items
    // This fixes cases where menu items have wrong scope (e.g., "Row Height" instead of widget name)
    // SIMPLE RULE: If previous step was in a widget AND current step is a menu item → use previous step's widget
    let inheritedScopeHint: string | undefined;
    const previousStep = this.state.hints[this.state.currentHintIndex - 1];
    const isMenuItem = nextIncompleteHint?.targetRole === 'menuitem' || 
                       nextIncompleteHint?.targetRole === 'option' ||
                       nextIncompleteHint?.description?.toLowerCase().includes('from menu') ||
                       nextIncompleteHint?.description?.toLowerCase().includes('from dropdown');
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai-agent.ts:1884',message:'SCOPE_INHERITANCE_CHECK',data:{hintIndex:this.state.currentHintIndex,isMenuItem,recordedScopeHint:nextIncompleteHint?.recordedScopeHint,previousScopeHint:previousStep?.recordedScopeHint,targetRole:nextIncompleteHint?.targetRole,description:nextIncompleteHint?.description?.substring(0,80)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (isMenuItem && previousStep?.recordedScopeHint) {
      // Check if previous step's scope matches a widget
      const { resolveScopeContainer } = await import('../types/scope');
      const prevScopeContainer = resolveScopeContainer({
        kind: 'WIDGET',
        title: previousStep.recordedScopeHint,
      }, document);
      
      if (prevScopeContainer) {
        inheritedScopeHint = previousStep.recordedScopeHint;
        console.log(`[AIAgent] 🔄 Inheriting widget scope from previous step: "${inheritedScopeHint}" (menu item should be in same widget as trigger)`);
      }
    } else if (nextIncompleteHint?.recordedScopeHint) {
      // For non-menu items, check if recorded scope matches a widget
      const { resolveScopeContainer } = await import('../types/scope');
      const scopeContainer = resolveScopeContainer({
        kind: 'WIDGET',
        title: nextIncompleteHint.recordedScopeHint,
      }, document);
      
      if (!scopeContainer && previousStep?.recordedScopeHint) {
        // Recorded scope doesn't match any widget - try to inherit from previous step
        const prevScopeContainer = resolveScopeContainer({
          kind: 'WIDGET',
          title: previousStep.recordedScopeHint,
        }, document);
        
        if (prevScopeContainer) {
          inheritedScopeHint = previousStep.recordedScopeHint;
          console.log(`[AIAgent] 🔄 Inheriting widget scope from previous step: "${inheritedScopeHint}" (recorded scope "${nextIncompleteHint.recordedScopeHint}" doesn't match any widget)`);
        }
      }
    }

    // NEW: Extract fresh spreadsheet context if on a spreadsheet domain
    // Extract ALWAYS when on spreadsheet, not just when hint has spreadsheetContext
    let spreadsheetContext: any = undefined;
    if (SheetStateExtractor.isSpreadsheetDomain()) {
      try {
        console.log('[AIAgent] 📊 Extracting fresh spreadsheet state for AI decision...');
        const freshSheetState = await SheetStateExtractor.extract();
        
        if (freshSheetState) {
          spreadsheetContext = {
            isSpreadsheet: true,
            sheetState: freshSheetState,
            recordedIntent: nextIncompleteHint?.spreadsheetContext?.recordedIntent || {
              cellRef: 'unknown',
              column: 'unknown',
              columnHeader: 'unknown',
              wasEmpty: true,
              wasAppendPosition: false,
              reasoning: 'Spreadsheet detected during execution',
            },
          };
          console.log('[AIAgent] 📊 Spreadsheet context ready:', {
            columns: freshSheetState.columns.length,
            activeCell: freshSheetState.activeCell.reference,
            headers: freshSheetState.headers.map(h => `${h.column}:${h.text}`).join(', '),
          });
        }
      } catch (error) {
        console.error('[AIAgent] 📊 Error extracting spreadsheet context:', error);
      }
    }

    // Build request payload - DOM-first approach
    const payload = {
      // Mode: 'dom' for DOM-based actions, 'vision' for coordinate-based (deprecated)
      mode: 'dom',
      
      // DOM map - use FRESH map (not stale observation)
      domMap: freshDomMapText,
      
      // Page context (use FRESH domMap, not stale observation)
      pageContext: {
        url: observation.url,
        title: observation.title,
        hasModal: !!domMap.activeModal,
        modalTitle: domMap.activeModal?.title,
        // CRITICAL: Dropdown state from FRESH domMap (not stale observation)
        hasOpenDropdown: !!domMap.activeDropdown,
        dropdownOptions: domMap.activeDropdown?.options.map(o => o.name || o.text || '(unnamed)'),
        formFields: observation.formFields,
        buttonCount: domMap.interactiveElements.filter(e => e.role === 'button').length,
        linkCount: domMap.interactiveElements.filter(e => e.role === 'link').length,
        inputCount: domMap.formFields.length,
        headings: domMap.headings.map(h => h.text),
      },
      
      // Goal and analyzed intent
      goal: this.state.goal,
      analyzedIntent: this.state.analyzedIntent,
      hints: this.state.hints.map(h => ({
        stepNumber: h.stepNumber,
        description: h.description,
        actionType: h.actionType,
        targetText: h.targetText,
        targetPlaceholder: h.targetPlaceholder,
        targetRole: h.targetRole,
        value: h.value,
        completed: h.completed,
        skipped: h.skipped,
        failureCount: h.failureCount,
        // Include recorded context for better matching (CRITICAL for disambiguation!)
        recordedSelector: h.recordedSelector,
        recordedTestId: h.recordedTestId,
        recordedAriaLabel: h.recordedAriaLabel,
        recordedScopeHint: h.recordedScopeHint,  // ⭐ KEY for widget/container disambiguation
        recordedRowKey: h.recordedRowKey,
        nearbyText: h.nearbyText,
        // Include natural language context if available
        naturalLanguage: h.naturalLanguage,
      })),
      // Use the actual current hint index, not nextIncomplete
      // (nextIncomplete would find the first uncompleted hint from 0, causing loops)
      currentHintIndex: this.state.currentHintIndex,
      
      // FLEXIBILITY: Pass variable values so AI can adapt
      // Example: User changed "Budget Amount" from 1000 → 2000
      // AI should use 2000 instead of the recorded 1000
      variableValues: this.state.variableValues,

      // Optional user context (role + focus)
      userContext: this.state.userContext,

      // Learnings from past executions (trouble spots, proven strategies)
      workflowLearnings: this.state.workflowMemory?.experience,
        
      // Action history
      history: this.state.history.slice(-5).map(h => ({
        stepNumber: h.stepNumber,
        action: h.action.type,
        target: h.action.params.target,
        result: h.result,
        error: h.error,
      })),
      
      // Reference screenshot from recording (for visual context)
      // Only send for current hint to reduce payload size
      referenceScreenshot: nextIncompleteHint?.referenceScreenshot,
      
      // Ranked candidates for LLM selection (max 8)
      currentCandidates: currentCandidates.map(c => ({
        index: c.index,
        role: c.role,
        name: c.name,
        text: c.text,
        testId: c.attrs?.testId,
        id: c.attrs?.id,  // Include ID attribute!
        placeholder: c.attrs?.placeholder,
        scopePath: c.scopePath,
        rowKey: c.rowKey,
        widgetTitle: c.widgetTitle,
        frameId: c.frameId,
        score: c.score,
      })),
      
      // Available widgets on the page (for LLM to choose from)
      availableWidgets: Array.from(availableWidgets),
      
      // Inherited scope hint (if recorded scope was wrong)
      inheritedScopeHint: inheritedScopeHint,
      
      // NEW: Spreadsheet context (extracted fresh during replay)
      spreadsheetContext,

      // Only include screenshot if VisionClicker is enabled
      screenshot: observation.screenshot,

      // NEW: Execution context from fast-path attempt (Phase 1 of Intelligent Agent Upgrade)
      // This tells the LLM what was already tried before calling it
      // Only include if feature flag is enabled
      // Phase 2A: Allow LLM to return scroll/wait/skip instead of just picking candidates
      allowFlexibleResponses: isFeatureEnabled('INTELLIGENT_AGENT_FLEXIBLE'),
      goalOriented: isFeatureEnabled('INTELLIGENT_AGENT_GOAL'),

      executionContext: (isFeatureEnabled('INTELLIGENT_AGENT_CONTEXT') && this.executionContext.fastPathAttempted) ? {
        fastPathAttempted: this.executionContext.fastPathAttempted,
        fastPathConfidence: this.executionContext.fastPathConfidence,
        fastPathReason: this.executionContext.fastPathReason,
        strategiesTried: this.executionContext.strategiesTried,
        scrollAttempted: this.executionContext.scrollAttempted,
        callReason: this.executionContext.callReason,
        currentStepFailures: this.executionContext.currentStepFailures,
        candidatesFound: this.executionContext.candidatesFound,
        topCandidateScore: this.executionContext.topCandidateScore,
      } : undefined,
    };

    try {
      console.log('[AIAgent] 🧠 Calling dom_agent Edge Function...');
      console.log('[AIAgent] 📤 Sending: currentHintIndex =', payload.currentHintIndex, ', nextIncomplete =', nextIncompleteHint?.stepNumber);
      console.log('[AIAgent] 📤 Hints status:', payload.hints.map((h: any, i: number) => `${i}:${h.completed?'✅':'⬜'}`).join(' '));
      
      // Log intent data being sent
      if (payload.analyzedIntent) {
        console.log('[AIAgent] 📤 Including analyzedIntent:', {
          primaryGoal: payload.analyzedIntent.primaryGoal,
          expectedOutcome: payload.analyzedIntent.expectedOutcome,
          confidence: payload.analyzedIntent.confidence,
        });
      } else {
        console.log('[AIAgent] 📤 No analyzedIntent in payload');
      }

      // Log execution context (Phase 1 Intelligent Agent)
      if ((payload as any).executionContext) {
        console.log('[AIAgent] 📤 Including executionContext:', {
          fastPathConfidence: (payload as any).executionContext.fastPathConfidence,
          fastPathReason: (payload as any).executionContext.fastPathReason,
          strategiesTried: (payload as any).executionContext.strategiesTried,
          callReason: (payload as any).executionContext.callReason,
          candidatesFound: (payload as any).executionContext.candidatesFound,
        });
      }
      
      // DEBUG: Show current hint details
      const currentHintData = payload.hints[payload.currentHintIndex];
      if (currentHintData) {
        console.log('[AIAgent] 📤 CURRENT HINT DETAILS:', {
          description: currentHintData.description,
          targetText: currentHintData.targetText,
          targetRole: currentHintData.targetRole,
          recordedSelector: currentHintData.recordedSelector?.substring(0, 80),
          recordedAriaLabel: currentHintData.recordedAriaLabel,
          recordedScopeHint: currentHintData.recordedScopeHint,
        });
      }
      
      console.log('[AIAgent] 📤 Candidates:', (payload as any).currentCandidates?.length || 0, 'sent to LLM');
      if ((payload as any).currentCandidates?.length > 0) {
        console.log('[AIAgent] 📤 Top 3 candidates:', (payload as any).currentCandidates.slice(0, 3).map((c: any, i: number) => 
          `${i}: [${c.role}] "${c.name}" widget="${c.widgetTitle || 'none'}" (score: ${c.score})`
        ));
      }
      console.log('[AIAgent] DOM map preview (FRESH):', freshDomMapText.substring(0, 300) + '...');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      console.log('[AIAgent] Response status:', response.status);

      if (!response.ok) {
        const error = await response.text();
        console.error('[AIAgent] API error:', response.status, error);
        return {
          type: 'fail',
          params: { reason: `API error: ${response.status}` },
          reasoning: error,
          confidence: 0,
        };
      }

      const responseText = await response.text();
      console.log('[AIAgent] Raw response:', responseText.substring(0, 500));
      
      let result;
      try {
        result = JSON.parse(responseText);
        console.log('[AIAgent] Parsed result:', result);
        console.log('[AIAgent] 📥 AI returned hintStepIndex:', result.hintStepIndex, '(expected:', payload.currentHintIndex, ')');

        // Phase 2A: Log when LLM chooses a flexible action instead of picking a candidate
        if (isFeatureEnabled('INTELLIGENT_AGENT_FLEXIBLE') &&
            ['scroll', 'wait', 'skip'].includes(result.action) &&
            currentCandidates.length > 0) {
          console.log(`[AIAgent] 🔄 Phase 2A: LLM chose "${result.action}" instead of picking from ${currentCandidates.length} candidates`);
        }

        // CRITICAL: Ensure SELECT actions have the option parameter set from hint
        const currentHint = this.state.hints[payload.currentHintIndex];
        
        // Case 1: Override AI's 'click' to 'select' when hint specified dropdown
        if (currentHint?.actionType === 'select' && result.action === 'click') {
          console.log('[AIAgent] 📋 Overriding AI action "click" → "select" (hint specified dropdown selection)');
          result.action = 'select';
        }
        
        // Case 2: Ensure option is set for ALL select actions (whether AI returned select or we overrode)
        // This handles: 
        //   - AI returns 'click' but hint says 'select' (overridden above)
        //   - AI returns 'select' but doesn't include option param
        //   - AI returns 'select' with option, but we want to use hint's value (variable substitution)
        if (result.action === 'select' && currentHint?.actionType === 'select') {
          const optionToSelect = currentHint.value || currentHint.targetText;
          if (optionToSelect && !result.option) {
            result.option = optionToSelect;
            console.log('[AIAgent] 📋 Setting option parameter from hint:', result.option);
          } else if (optionToSelect && result.option !== optionToSelect) {
            // If AI returned a different option, prefer hint's value (for variable substitution)
            console.log('[AIAgent] 📋 Overriding AI option with hint value:', optionToSelect, '(AI had:', result.option, ')');
            result.option = optionToSelect;
          } else if (!optionToSelect) {
            console.warn('[AIAgent] ⚠️ No option value found in hint (value or targetText missing)');
          }
        }
      } catch (parseError) {
        console.error('[AIAgent] JSON parse error:', parseError);
        console.error('[AIAgent] Response was:', responseText);
        return {
          type: 'fail',
          params: { reason: 'Failed to parse AI response' },
          reasoning: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`,
          confidence: 0,
        };
      }
      
      // CRITICAL: If AI returned chooseCandidateIndex, convert to target
      let resolvedTarget = result.target;
      let candidateIndex: number | undefined = undefined;
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai-agent.ts:2116',message:'LLM_RESPONSE',data:{action:result.action,chooseCandidateIndex:result.chooseCandidateIndex,targetRole:result.target?.role,targetName:result.target?.name?.substring(0,50),candidateCount:currentCandidates.length,reasoning:result.reasoning?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Method 1: AI returned chooseCandidateIndex directly
      if (typeof result.chooseCandidateIndex === 'number' && result.chooseCandidateIndex >= 0) {
        candidateIndex = result.chooseCandidateIndex;
        console.log(`[AIAgent] 🎯 AI returned chooseCandidateIndex: ${candidateIndex}`);
      }
      // Method 2: FALLBACK - Parse candidate index from reasoning (AI often says "Candidate X" in reasoning)
      else if (result.reasoning && currentCandidates.length > 0) {
        // Look for "I will choose candidate X" or "choose candidate X" (the final decision)
        let match = result.reasoning.match(/(?:I will choose|choose)\s+[Cc]andidate\s*(\d+)/);
        if (!match) {
          // Fallback: Find last occurrence of "Candidate X" in reasoning
          const allMatches = Array.from(result.reasoning.matchAll(/[Cc]andidate\s*(\d+)/g));
          if (allMatches.length > 0) {
            match = allMatches[allMatches.length - 1]; // Use LAST mention, not first!
          }
        }
        if (match) {
          candidateIndex = parseInt(match[1], 10);
          console.log(`[AIAgent] 🔍 Extracted candidate index ${candidateIndex} from reasoning (last mention)`);
        }
      }
      
      // If we have a candidate index (from either method), resolve it
      if (typeof candidateIndex === 'number' && candidateIndex >= 0 && candidateIndex < currentCandidates.length) {
        const chosenCandidate = currentCandidates[candidateIndex];
        if (chosenCandidate) {
          console.log(`[AIAgent] 🎯 Using candidate ${candidateIndex}: [${chosenCandidate.role}] "${chosenCandidate.name}" widget="${chosenCandidate.widgetTitle || 'none'}"`);
          resolvedTarget = {
            role: chosenCandidate.role,
            name: chosenCandidate.name,
            text: chosenCandidate.text,
            testId: chosenCandidate.attrs?.testId,
            id: chosenCandidate.attrs?.id,
            placeholder: chosenCandidate.attrs?.placeholder,
            // CRITICAL: For menu items, the candidate's widgetTitle is often wrong (e.g., "Row Height")
            // Override with inherited scope hint if available, otherwise use candidate's widget title
            scopeHint: inheritedScopeHint || chosenCandidate.widgetTitle || chosenCandidate.scopePath?.[0],
          };
        }
      } else if (typeof candidateIndex === 'number') {
        console.warn(`[AIAgent] ⚠️ Candidate index ${candidateIndex} out of range (have ${currentCandidates.length} candidates)`);
      }
      
      // Build action with semantic target (not coordinates)
      // CRITICAL: Include fallback selectors from the hint for reliable disambiguation!
      const fallbackSelectorsFromHint = nextIncompleteHint?.recordedFallbackSelectors;
      
      // Use inherited scope hint if available (from previous step), otherwise use recorded scope hint
      // This fixes cases where menu items have wrong scope (e.g., "Row Height" instead of widget name)
      // SIMPLE RULE: If we computed an inherited scope hint earlier, use it; otherwise use recorded
      const scopeHintFromHint = inheritedScopeHint || nextIncompleteHint?.recordedScopeHint;
      
      // Log scope hint usage for debugging
      if (scopeHintFromHint) {
        console.log(`[AIAgent] 📌 Using scope hint: "${scopeHintFromHint}"`);
        if (resolvedTarget?.scopeHint && resolvedTarget.scopeHint !== scopeHintFromHint) {
          console.warn(`[AIAgent] ⚠️ AI picked wrong widget "${resolvedTarget.scopeHint}" - overriding with scope hint: "${scopeHintFromHint}"`);
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ai-agent.ts:2177',message:'FINAL_SCOPE_USED',data:{finalScope:scopeHintFromHint,inheritedScopeHint,recordedScope:nextIncompleteHint?.recordedScopeHint,candidateWidget:resolvedTarget?.scopeHint,candidateIndex,targetRole:resolvedTarget?.role,targetName:resolvedTarget?.name?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      // Check if we overrode the action to 'select'
      const finalActionType = result.action || 'fail';
      
      // Get decision space from hint for dropdown validation/fallback
      const decisionSpaceFromHint = nextIncompleteHint?.decisionSpace;
      if (decisionSpaceFromHint?.options?.length) {
        console.log(`[AIAgent] 📋 Including decision space with ${decisionSpaceFromHint.options.length} options for dropdown validation`);
      }
      
      const action: AgentAction = {
        type: finalActionType,
        params: {
          // For SELECT actions, include the option parameter and decision space
          ...(finalActionType === 'select' && result.option ? { option: result.option } : {}),
          ...(finalActionType === 'select' && decisionSpaceFromHint ? { decisionSpace: decisionSpaceFromHint } : {}),
          // Semantic target for element identification
          target: resolvedTarget ? {
            role: resolvedTarget.role,
            name: resolvedTarget.name,
            text: resolvedTarget.text,
            testId: resolvedTarget.testId,
            id: resolvedTarget.id,
            placeholder: resolvedTarget.placeholder,
            // CRITICAL: ALWAYS use recorded scope hint over candidate's widget!
            // The recorded scope hint is what the user actually clicked on during recording.
            // The candidate's widget could be wrong if AI picked wrong candidate.
            scopeHint: scopeHintFromHint || resolvedTarget.scopeHint,
            nearbyText: resolvedTarget.nearbyText,
            index: resolvedTarget.index,
            // CRITICAL: Include recorded fallback selectors for reliable disambiguation!
            recordedFallbackSelectors: resolvedTarget.recordedFallbackSelectors || fallbackSelectorsFromHint,
          } : undefined,
          description: result.description,
          
          // For type actions
          text: result.text || result.value,
          fieldTarget: result.fieldTarget,
          
          // For select actions
          option: result.option,
          decisionSpace: decisionSpaceFromHint,
          
          // Expected outcome for verification
          expectedOutcome: result.expectedOutcome,
          
          // Legacy: only used if DOM resolution fails
          x: result.x,
          y: result.y,
          
          // Other params
          url: result.url,
          direction: result.direction,
          amount: result.amount,
          duration: result.duration,
          reason: result.reason,
          
          // For read action
          attribute: result.attribute,
          storeAs: result.storeAs,
          
          // For keyboard action
          key: result.key,
          modifiers: result.modifiers,
          repeat: result.repeat,
          
          // For hover action
          hoverDuration: result.hoverDuration,
          waitForMenu: result.waitForMenu,
          
          // For spreadsheet actions
          cellRef: result.cellRef,
          column: result.column,
          headerText: result.headerText,
          rowOffset: result.rowOffset,
          cells: result.cells,
          clearFirst: result.clearFirst,
        },
        reasoning: result.reasoning || 'No reasoning provided',
        confidence: result.confidence || 0,
        hintStepIndex: result.hintStepIndex,
      };
      
      console.log('[AIAgent] 🎯 Action:', action.type, 'Target:', action.params.target);
      if (action.type === 'type') {
        console.log('[AIAgent] 📝 Type action - fieldTarget:', action.params.fieldTarget ? 
          `${action.params.fieldTarget.role}:${action.params.fieldTarget.name}` : 'NOT SET (will use activeElement!)');
      }
      
      // ============================================================================
      // 🚀 SPREADSHEET INTERCEPTION - DISABLED
      // After extensive testing, spreadsheet interception causes more problems:
      // 1. Confuses Name Box workflows (converts Name Box clicks to cell clicks)
      // 2. AI skips steps thinking cells are already filled
      // 3. Duplicate clicks on same cell
      // 4. Complex logic prone to edge cases
      //
      // SOLUTION: Users should record with Tab navigation:
      //   - Click A2 → type → Tab → type → Tab → type → Enter
      //   - Simple, reliable, works in Google Sheets and Excel
      //   - No special handling needed - just replays keyboard events
      //
      // Future: Re-enable with better workflow type detection
      // ============================================================================
      if (false && SheetStateExtractor.isSpreadsheetDomain()) {
        // Interception code disabled
      }
      
      return action;
    } catch (error) {
      console.error('[AIAgent] Think error:', error);
      return {
        type: 'fail',
        params: { reason: error instanceof Error ? error.message : 'Unknown error' },
        reasoning: 'Failed to communicate with AI',
        confidence: 0,
      };
    }
  }

  /**
   * Execute an action with 3-tier architecture and recovery loop
   * Tier 1: Deterministic execution with explicit rejection codes
   * Tier 2: LLM recovery decisions
   * Tier 3: Vision assist for persistent failures
   */
  private async act(action: AgentAction): Promise<{ success: boolean; error?: string }> {
    const maxRecoveryAttempts = 3;
    let currentAction = action;
    const workflowId = this.state.workflowId;
    const stepIndex = this.state.hints[this.state.currentHintIndex]?.stepNumber ?? this.state.currentHintIndex;
    let recoveryContext: { issue: string; solution?: string } | null = null;
    
    // ============================================================================
    // 🖼️ FRAME ROUTING: Check if action needs to execute in an iframe
    // ============================================================================
    const currentHint = this.state.hints[this.state.currentHintIndex];
    if (currentHint?.iframeContext?.frameId) {
      const targetFrameId = currentHint.iframeContext.frameId;
      const { getCurrentFrameId } = await import('../content/content-script');
      const currentFrameId = getCurrentFrameId();
      
      if (targetFrameId !== currentFrameId) {
        console.log(`[AIAgent] 🖼️ Action requires execution in frame ${targetFrameId} (current frame: ${currentFrameId})`);
        console.log(`[AIAgent] 🖼️ Iframe context:`, currentHint.iframeContext);
        
        try {
          // Route through service worker for reliable cross-frame execution
          // Service worker has the correct tab context
          const frameResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
            // Set up listener for response BEFORE sending request
            const listener = (message: any) => {
              if (message.type === 'FRAME_ACTION_COMPLETED' && message.payload?.frameId === targetFrameId) {
                chrome.runtime.onMessage.removeListener(listener);
                resolve({
                  success: message.payload.success,
                  error: message.payload.error,
                });
              }
            };
            chrome.runtime.onMessage.addListener(listener);
            
            // Send request via runtime (service worker will route to correct frame)
            chrome.runtime.sendMessage({
              type: 'EXECUTE_IN_FRAME',
              payload: { 
                action: currentAction, 
                targetFrameId: targetFrameId 
              },
            }).catch((error) => {
              console.error('[AIAgent] 🖼️ Failed to send EXECUTE_IN_FRAME message:', error);
              chrome.runtime.onMessage.removeListener(listener);
              resolve({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to send cross-frame message',
              });
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
              chrome.runtime.onMessage.removeListener(listener);
              resolve({ success: false, error: 'Iframe execution timeout' });
            }, 10000);
          });
          
          console.log(`[AIAgent] 🖼️ Iframe execution result:`, frameResult);
          return frameResult;
        } catch (error) {
          console.error('[AIAgent] 🖼️ Cross-frame execution failed:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Cross-frame execution failed',
          };
        }
      }
    }
    
    // NOTE: Spreadsheet handling is now done BEFORE AI call in continueExecution()
    // See "SPREADSHEET TYPE HINTS - BYPASS AI ENTIRELY" section
    
    for (let attempt = 1; attempt <= maxRecoveryAttempts; attempt++) {
      console.log(`[AIAgent] 🎯 Attempt ${attempt}/${maxRecoveryAttempts}`);
      
      // Handle explicit spreadsheet actions (click_cell, type_in_cell, etc.)
      // These are routed to SpreadsheetExecutor if on a spreadsheet domain
      const spreadsheetActions = [
        'click_cell', 
        'find_and_click_empty', 
        'find_by_header',
        'type_in_cell',
        'type_in_header_column',
        'type_in_next_empty',
        'read_cell',
        'batch_type',
      ];
      if (spreadsheetActions.includes(currentAction.type) && SheetStateExtractor.isSpreadsheetDomain()) {
        console.log(`[AIAgent] 📊 Routing to SpreadsheetExecutor: ${currentAction.type}`);
        
        try {
          const spreadsheetResult = await SpreadsheetExecutor.execute({
            action: currentAction.type as any,
            cellRef: (currentAction.params as any).cellRef,
            column: (currentAction.params as any).column,
            headerText: (currentAction.params as any).headerText,
            rowOffset: (currentAction.params as any).rowOffset,
            text: (currentAction.params as any).text || currentAction.params.text,
            cells: (currentAction.params as any).cells,
            clearFirst: (currentAction.params as any).clearFirst,
          });
          
          if (spreadsheetResult.success) {
            console.log(`[AIAgent] ✅ Spreadsheet action succeeded: ${spreadsheetResult.message}`);
            return { success: true };
          } else {
            console.error(`[AIAgent] ❌ Spreadsheet action failed: ${spreadsheetResult.error}`);
            return {
              success: false,
              error: spreadsheetResult.error || 'Spreadsheet action failed',
            };
          }
        } catch (error) {
          console.error('[AIAgent] ❌ Spreadsheet executor threw error:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Spreadsheet executor error',
          };
        }
      }
      
      // Handle tab_switch action (not supported by Tier1Executor)
      if (currentAction.type === 'tab_switch') {
        console.log(`[AIAgent] 🔄 Executing tab_switch action`);
        
        try {
          const { TabManager } = await import('../content/universal-execution/tab-manager');
          
          const toTabIndex = (currentAction.params as any).toTabIndex;
          const toUrl = (currentAction.params as any).toUrl;
          const isNewTab = (currentAction.params as any).isNewTab;
          
          // Get or create TabManager instance (singleton pattern)
          let tabManager: typeof TabManager.prototype;
          if (!(window as any).__ghostwriter_tab_manager) {
            // Get current tab ID from service worker
            // chrome.tabs.getCurrent() doesn't work in content scripts!
            const tabIdResponse = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_ID' });
            const currentTabId = tabIdResponse?.data?.tabId || 0;
            console.log(`[AIAgent] Got current tab ID from service worker: ${currentTabId}`);
            
            // Create and initialize TabManager
            const newTabManager = new TabManager(currentTabId);
            await newTabManager.initialize();
            (window as any).__ghostwriter_tab_manager = newTabManager;
          }
          tabManager = (window as any).__ghostwriter_tab_manager;
          
          // Decide whether to create new tab or switch to existing based on recording
          if (isNewTab === true) {
            // Recording shows this was a NEW tab creation
            console.log(`[AIAgent] 🆕 Creating new tab ${toTabIndex} at ${toUrl} (recorded as new)`);
            const newTabId = await tabManager.openNewTab(toTabIndex, toUrl);
            if (!newTabId) {
              console.error(`[AIAgent] ❌ Failed to create new tab`);
              return {
                success: false,
                error: `Failed to create new tab at ${toUrl}`,
              };
            }
          } else if (isNewTab === false) {
            // Recording shows this was a SWITCH to existing tab
            console.log(`[AIAgent] 🔄 Switching to existing tab ${toTabIndex} (recorded as existing)`);
            
            // If tab doesn't exist yet, create it (first time switching to it in replay)
            if (!tabManager.hasTab(toTabIndex)) {
              console.log(`[AIAgent] 🆕 Tab ${toTabIndex} not yet created, creating it now`);
              const newTabId = await tabManager.openNewTab(toTabIndex, toUrl);
              if (!newTabId) {
                console.error(`[AIAgent] ❌ Failed to create tab`);
                return {
                  success: false,
                  error: `Failed to create tab ${toTabIndex}`,
                };
              }
            } else {
              // Tab already exists, just switch to it
              const switchSuccess = await tabManager.switchToTab(toTabIndex);
              if (!switchSuccess) {
                console.error(`[AIAgent] ❌ Tab switch failed`);
                return {
                  success: false,
                  error: `Failed to switch to tab ${toTabIndex}`,
                };
              }
            }
          } else {
            // Legacy: isNewTab not set (old recordings)
            // Fall back to old behavior: check if tab exists
            console.log(`[AIAgent] ⚠️ Legacy TAB_SWITCH (no isNewTab field), using fallback logic`);
            if (tabManager.hasTab(toTabIndex)) {
              console.log(`[AIAgent] 🔄 Switching to existing tab ${toTabIndex}`);
              const switchSuccess = await tabManager.switchToTab(toTabIndex);
              if (!switchSuccess) {
                return {
                  success: false,
                  error: `Failed to switch to tab ${toTabIndex}`,
                };
              }
            } else {
              console.log(`[AIAgent] 🔄 Opening new tab ${toTabIndex} at ${toUrl}`);
              const newTabId = await tabManager.openNewTab(toTabIndex, toUrl);
              if (!newTabId) {
                return {
                  success: false,
                  error: `Failed to open new tab at ${toUrl}`,
                };
              }
            }
          }
          
          console.log(`[AIAgent] ✅ Tab switch succeeded`);
          return { success: true };
        } catch (error) {
          console.error('[AIAgent] ❌ Tab switch error:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Tab switch error',
          };
        }
      }
      
      // Handle open_tab action - open a new tab and navigate to URL
      if (currentAction.type === 'open_tab') {
        console.log(`[AIAgent] 🆕 Executing open_tab action`);
        
        try {
          const url = currentAction.params.url;
          
          if (!url) {
            return {
              success: false,
              error: 'open_tab action requires a URL',
            };
          }
          
          console.log(`[AIAgent] 🆕 Opening new tab at: ${url}`);
          
          // Request service worker to create a new tab
          const response = await chrome.runtime.sendMessage({
            type: 'CREATE_TAB',
            payload: { url },
          });

          if (response?.success && response.data?.tabId) {
            const newTabId = response.data.tabId;
            console.log(`[AIAgent] ✅ Created new tab ${newTabId}`);
            
            // Wait for tab to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return { success: true };
          } else {
            console.error(`[AIAgent] ❌ Failed to create tab:`, response?.error);
            return {
              success: false,
              error: response?.error || 'Failed to create tab',
            };
          }
        } catch (error) {
          console.error('[AIAgent] ❌ Open tab error:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Open tab error',
          };
        }
      }
      
      // Tier 1: Execute with deterministic executor (non-spreadsheet actions)
      const result: Tier1ExecutionResult = await Tier1Executor.execute(currentAction);
      
      if (result.status === 'success') {
        console.log('[AIAgent] ✅ Action succeeded');
        
        // If this was a read action, store the value in memory
        if (currentAction.type === 'read' && currentAction.params.storeAs && result.details?.value !== undefined) {
          if (!this.state.memory) {
            this.state.memory = {};
          }
          this.state.memory[currentAction.params.storeAs] = result.details.value;
          console.log(`[AIAgent] 💾 Stored value in memory: ${currentAction.params.storeAs} = ${result.details.value}`);
        }
        
        if (recoveryContext && workflowId) {
          await ExecutionLearning.recordRecoverySuccess(
            workflowId,
            stepIndex,
            recoveryContext.issue,
            recoveryContext.solution || 'Recovered with fallback'
          );
        }

        return { success: true };
      }
      
      // Action was rejected - start recovery loop
      console.warn(`[AIAgent] ⚠️ Tier 1 rejected: ${result.code}`, result.details);
      if (!recoveryContext) {
        recoveryContext = {
          issue: result.message || result.code || 'Execution rejected',
        };
      }

      const currentHint = this.state.hints[this.state.currentHintIndex];
      if (currentHint && (currentHint.actionType === 'click' || currentHint.actionType === 'type')) {
        const memoryRecovery = await this.attemptMemoryBasedRecovery(
          currentHint,
          result.message || result.code || 'Execution rejected'
        );
        if (memoryRecovery.recovered) {
          if (workflowId) {
            await ExecutionLearning.recordRecoverySuccess(
              workflowId,
              stepIndex,
              recoveryContext.issue,
              memoryRecovery.strategy || 'Recovered using memory fallback'
            );
          }
          return { success: true };
        }
      }
      
      // On last attempt, give up
      if (attempt === maxRecoveryAttempts) {
        if (workflowId) {
          await ExecutionLearning.recordStepFailure(
            workflowId,
            stepIndex,
            `Failed after ${maxRecoveryAttempts} attempts: ${result.message || result.code || 'Unknown error'}`
          );
        }
        return {
          success: false,
          error: `Failed after ${maxRecoveryAttempts} attempts: ${result.message || result.code}`,
        };
      }
      
      // Tier 2: Ask LLM for recovery strategy
      const observation = this.state.history[this.state.history.length - 1]?.observation || await this.observe();
      
      const recoveryDecision = await this.thinkRecovery(
        result.code!,
        result.details,
        currentAction,
        observation,
        attempt
      );
      
      console.log(`[AIAgent] 🧠 Recovery strategy: ${recoveryDecision.strategy}`);
      
      // Execute recovery strategy
      if (recoveryDecision.strategy === 'GIVE_UP') {
        if (workflowId) {
          await ExecutionLearning.recordStepFailure(
            workflowId,
            stepIndex,
            `Recovery gave up: ${recoveryDecision.reasoning}`
          );
        }
        return {
          success: false,
          error: `Recovery gave up: ${recoveryDecision.reasoning}`,
        };
      }

      recoveryContext = {
        issue: recoveryContext?.issue || result.message || result.code || 'Execution rejected',
        solution: `${recoveryDecision.strategy}: ${recoveryDecision.reasoning}`,
      };
      
      if (recoveryDecision.strategy === 'RETRY_WITH_VISION') {
        // Tier 3: Get vision hint
        if (!observation.screenshot || !FeatureFlags.VISION_CLICKER) {
          console.warn('[AIAgent] Vision hint requested but not available');
          continue;
        }
        
        const hint = await VisionAssist.getHint(
          observation.screenshot,
          currentAction.params.target!,
          observation.domMapText
        );
        
        console.log(`[AIAgent] 👁️ Vision hint: ${hint.description}`);
        
        // Refine action with hint
        currentAction = {
          ...currentAction,
          params: {
            ...currentAction.params,
            target: {
              ...currentAction.params.target,
              ...hint.refinedTarget,
            },
          },
          reasoning: `${currentAction.reasoning} (refined with vision: ${hint.description})`,
        };
        
        continue;
      }
      
      if (recoveryDecision.strategy === 'RETRY_LOOSER') {
        // Use LLM's refined target if provided, otherwise loosen manually
        let newTarget = recoveryDecision.refinedTarget;
        
        if (!newTarget && currentAction.params.target) {
          // Manually loosen: remove name requirement for unlabeled elements
          const currentTarget = currentAction.params.target;
          const isUnlabeled = !currentTarget.name || 
                             currentTarget.name === '(unlabeled)' ||
                             currentTarget.name.trim() === '';
          
          if (isUnlabeled && currentTarget.role) {
            // Keep role and text (if available), drop the name requirement
            newTarget = {
              role: currentTarget.role,
              text: currentTarget.text,  // Keep text for matching
              scopeHint: currentTarget.scopeHint,
            };
            console.log('[AIAgent] Manually loosened target: using role + text, dropped name requirement');
          } else {
            // Remove name and just use text
            newTarget = {
              role: currentTarget.role,
              text: currentTarget.text,
              scopeHint: currentTarget.scopeHint,
            };
            console.log('[AIAgent] Manually loosened target: keeping role + text only');
          }
        }
        
        currentAction = {
          ...currentAction,
          params: {
            ...currentAction.params,
            target: newTarget || currentAction.params.target,
          },
          reasoning: `${currentAction.reasoning} (loosened match criteria)`,
        };
        
        continue;
      }
      
      if (recoveryDecision.strategy === 'SCROLL_AND_RETRY') {
        // Execute scroll recovery
        await RecoveryEngine.executeRecovery(
          { kind: 'SCROLL_INTO_VIEW', target: '' },
          {
            attemptNumber: attempt,
            lastError: result.message,
          }
        );
        
        continue;
      }
      
      if (recoveryDecision.strategy === 'DISMISS_POPUP') {
        // Execute dismiss popup recovery with structured directive
        const dismissDirective: import('../content/recovery-engine').DismissRecoveryDirective = {
          kind: 'DISMISS_POPUP',
          dismissMethod: 'escape', // Default to escape (safest)
        };
        
        await RecoveryEngine.executeRecovery(
          dismissDirective,
          {
            attemptNumber: attempt,
            lastError: result.message,
          }
        );
        
        continue;
      }
      
      if (recoveryDecision.strategy === 'CLICK_BY_COORDINATES') {
        // Tier 3: Visual coordinate-based clicking as last resort
        if (!recoveryDecision.coordinates || !FeatureFlags.VISION_CLICKER) {
          console.warn('[AIAgent] Coordinate click requested but not available');
          continue;
        }
        
        const { VisionClicker } = await import('./vision-clicker');
        const { x, y } = recoveryDecision.coordinates;
        
        console.log(`[AIAgent] 👁️ Attempting coordinate click at (${x}, ${y})`);
        
        // Validate coordinates are within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        if (x < 0 || x > viewportWidth || y < 0 || y > viewportHeight) {
          console.warn(`[AIAgent] ⚠️ Coordinates (${x}, ${y}) outside viewport (${viewportWidth}x${viewportHeight})`);
          continue;
        }
        
        const clickResult = await VisionClicker.clickAt(x, y, currentAction.reasoning);
        
        if (clickResult.success) {
          console.log('[AIAgent] ✅ Coordinate click succeeded');
          // Wait for stability after click (OPTIMIZED from 2000ms)
          await StateWaitEngine.waitForStability({ maxWaitMs: 1000 });
          return { success: true };
        }
        
        console.warn('[AIAgent] ❌ Coordinate click failed:', clickResult.error);
        continue;
      }
      
      // Unknown strategy - retry as-is
      console.warn('[AIAgent] Unknown recovery strategy, retrying...');
    }
    
    return {
      success: false,
      error: `Failed after ${maxRecoveryAttempts} recovery attempts`,
    };
  }
  
  /**
   * Tier 2: Ask LLM for recovery strategy when Tier 1 rejects
   */
  private async thinkRecovery(
    rejectionCode: RejectionCode,
    rejectionDetails: any,
    failedAction: AgentAction,
    observation: AgentObservation,
    attemptNumber: number
  ): Promise<{
    strategy: 'RETRY_WITH_VISION' | 'RETRY_LOOSER' | 'SCROLL_AND_RETRY' | 'DISMISS_POPUP' | 'GIVE_UP' | 'CLICK_BY_COORDINATES';
    refinedTarget?: SemanticTarget;
    coordinates?: { x: number; y: number };
    reasoning: string;
  }> {
    console.log('[AIAgent] 🧠 Thinking about recovery...');
    
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/dom_agent`;

    // Get current hint for AI analysis context
    const currentHint = this.state.hints[this.state.currentHintIndex];
    const completedSteps = this.state.hints
      .map((h, i) => h.completed ? i : -1)
      .filter(i => i >= 0);

    // Build execution state context for smarter recovery
    const executionState = {
      currentStep: this.state.currentHintIndex,
      totalSteps: this.state.hints.length,
      completedSteps,
      overallGoal: this.state.goal,
      progressSummary: this.buildProgressSummary(this.state.currentHintIndex, this.state.hints.length, completedSteps),
    };

    console.log(`[AIAgent] 🔄 Recovery with execution context:`, {
      progress: executionState.progressSummary,
      hasAIContext: !!currentHint?.aiAnalysisContext,
      aiIntent: currentHint?.aiAnalysisContext?.intent?.substring(0, 40),
    });

    try {
      const payload = {
        mode: 'recover',

        // Rejection context
        rejectionCode,
        rejectionDetails: {
          matchCount: rejectionDetails.matchCount,
          candidates: rejectionDetails.candidates?.slice(0, 5), // Limit to 5
          triedStrategies: rejectionDetails.triedStrategies,
          interactabilityIssue: rejectionDetails.interactabilityIssue,
          scopeStatus: rejectionDetails.scopeStatus,
        },

        // Failed action
        failedAction: {
          type: failedAction.type,
          target: failedAction.params.target,
          description: failedAction.params.description,
        },

        // Current context
        pageContext: {
          url: observation.url,
          title: observation.title,
          hasModal: observation.hasModal,
          domMap: observation.domMapText.substring(0, 2000), // Truncate for cost
        },

        // Attempt number
        attemptNumber,

        // Goal for context
        goal: this.state.goal,

        // Optional user context
        userContext: this.state.userContext,

        // NEW: Execution state context (Phase 3)
        executionState,

        // NEW: AI analysis context from current hint (Phase 3)
        aiAnalysisContext: currentHint?.aiAnalysisContext ? {
          intent: currentHint.aiAnalysisContext.intent,
          whyThisElement: currentHint.aiAnalysisContext.whyThisElement,
          elementFindingStrategy: currentHint.aiAnalysisContext.elementFindingStrategy,
          preconditions: currentHint.aiAnalysisContext.preconditions,
          expectedOutcome: currentHint.aiAnalysisContext.expectedOutcome,
          criticality: currentHint.aiAnalysisContext.criticality,
          alternatives: currentHint.aiAnalysisContext.alternatives,
        } : undefined,

        // NEW: Hint's step guidance for recovery context
        stepGuidance: currentHint?.aiAnalysisContext?.elementFindingStrategy ? {
          lookingFor: currentHint.aiAnalysisContext.elementFindingStrategy.lookingFor,
          searchContext: currentHint.aiAnalysisContext.elementFindingStrategy.searchContext,
          distinguishers: currentHint.aiAnalysisContext.elementFindingStrategy.distinguishers,
          textPatterns: currentHint.aiAnalysisContext.elementFindingStrategy.textPatterns,
        } : undefined,
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        console.error('[AIAgent] Recovery decision API error:', response.status);
        // Default fallback: scroll and retry on first attempt, give up later
        return {
          strategy: attemptNumber < 2 ? 'SCROLL_AND_RETRY' : 'GIVE_UP',
          reasoning: 'API error, using fallback strategy',
        };
      }
      
      const result = await response.json();
      
      return {
        strategy: result.strategy || 'GIVE_UP',
        refinedTarget: result.refinedTarget,
        reasoning: result.reasoning || 'No reasoning provided',
      };
    } catch (error) {
      console.error('[AIAgent] Recovery decision error:', error);
      // Default fallback
      return {
        strategy: attemptNumber < 2 ? 'SCROLL_AND_RETRY' : 'GIVE_UP',
        reasoning: 'Error in recovery decision, using fallback',
      };
    }
  }

  /**
   * Fast path for TYPE actions - DISABLED FOR AI AGENT
   * This was causing issues where typing would close dropdowns before selecting options
   * Returns success if we found the element and typed into it
   */
  // @ts-ignore - Kept for potential future use
  private async tryFastType(hint: AgentHint): Promise<{ success: boolean; error?: string }> {
    console.log('[AIAgent] ⚡ Trying fast type for:', hint.description);
    
    if (!hint.value) {
      return { success: false, error: 'No value to type' };
    }
    
    // Strategy 1: Try the recorded selector
    let element: Element | null = null;
    
    if (hint.targetSelector) {
      try {
        // Handle various selector formats
        if (hint.targetSelector.startsWith('#') || hint.targetSelector.startsWith('.') || hint.targetSelector.startsWith('[')) {
          element = document.querySelector(hint.targetSelector);
        } else if (hint.targetSelector.startsWith('//') || hint.targetSelector.startsWith('xpath=')) {
          // XPath selector
          const xpath = hint.targetSelector.replace('xpath=', '');
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          element = result.singleNodeValue as Element;
        }
        
        if (element) {
          console.log('[AIAgent] ⚡ Found element via selector:', hint.targetSelector);
        }
      } catch (e) {
        console.log('[AIAgent] Selector failed:', e);
      }
    }
    
    // Strategy 2: Try placeholder
    if (!element && hint.targetPlaceholder) {
      element = document.querySelector(`[placeholder="${hint.targetPlaceholder}"]`) ||
                document.querySelector(`[placeholder*="${hint.targetPlaceholder}"]`);
      if (element) {
        console.log('[AIAgent] ⚡ Found element via placeholder:', hint.targetPlaceholder);
      }
    }
    
    // Strategy 3: Try to find by label text
    if (!element && hint.targetText) {
      // Look for label with matching text and find its input
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.includes(hint.targetText)) {
          const forId = label.getAttribute('for');
          if (forId) {
            element = document.getElementById(forId);
            if (element) {
              console.log('[AIAgent] ⚡ Found element via label for:', forId);
              break;
            }
          }
          // Check for input inside label
          const input = label.querySelector('input, textarea, select');
          if (input) {
            element = input;
            console.log('[AIAgent] ⚡ Found element inside label');
            break;
          }
        }
      }
    }
    
    // If we found an element, type into it
    if (element && element instanceof HTMLElement) {
      try {
        // Focus the element
        element.focus();
        await this.sleep(50);
        
        // Clear existing value if it's an input/textarea
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Type character by character for better compatibility
        const text = hint.value;
        for (const char of text) {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            element.value += char;
          }
          element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        
        // Trigger change event
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        
        console.log(`[AIAgent] ⚡ Fast typed: "${text}"`);
        return { success: true };
      } catch (error) {
        console.error('[AIAgent] Fast type error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Type failed' };
      }
    }
    
    return { success: false, error: 'Element not found for fast type' };
  }

  /**
   * Find and rank candidates that match the current hint
   * Delegates to CandidateFinder module
   * Enhanced with PageModel for relationship-aware and context-aware scoring
   */
  private findAndRankCandidates(
    hint: AgentHint,
    domMap: DOMMap,
    pageModel?: import('./page-model/types').PageModel
  ): Array<DOMMapElement & { index: number; score: number }> {
    return this.candidateFinder.findAndRankCandidates(hint, domMap, pageModel);
  }
  
  /**
   * Infer the goal from workflow
   * Delegates to HintExtractor module
   */
  private inferGoal(workflow: SavedWorkflow): string {
    return this.hintExtractor.inferGoal(workflow);
  }

  /**
   * Extract hints from workflow steps
   * Delegates to HintExtractor module
   */
  private extractHints(workflow: SavedWorkflow, variableValues?: Record<string, string>): AgentHint[] {
    return this.hintExtractor.extractHints(workflow, variableValues);
  }

  /**
   * Check if the current hint's expected outcome is already satisfied
   * Delegates to HintExtractor module
   */
  private checkIfOutcomeAlreadySatisfied(
    hint: AgentHint,
    observation: AgentObservation
  ): string | null {
    return this.hintExtractor.checkIfOutcomeAlreadySatisfied(hint, observation);
  }

  /**
   * Get current state (for debugging/UI)
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Pause execution
   */
  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused';
    }
  }

  /**
   * Detect if the action was intermediate (preparation) vs goal (completion)
   * 
   * Example: Hint says "CLICK on BOGO" but AI clicked combobox to open dropdown.
   * This is an intermediate action - the goal (selecting BOGO) hasn't been achieved yet.
   * 
   * @returns true if action was intermediate, false if it achieved the hint's goal
   */
  private detectIntermediateAction(
    hint: AgentHint,
    action: AgentAction,
    observation: AgentObservation
  ): boolean {
    // Phase 2A: LLM-suggested scroll/wait are intermediate — the hint goal is NOT scroll
    // After scrolling, the loop re-observes DOM and retries finding the element
    if (isFeatureEnabled('INTELLIGENT_AGENT_FLEXIBLE') &&
        (action.type === 'scroll' || action.type === 'wait') &&
        hint.actionType !== 'scroll') {
      console.log(`[AIAgent] 🔄 Phase 2A: "${action.type}" is intermediate — hint goal is "${hint.actionType}", will retry after ${action.type}`);
      return true;
    }

    // Strategy 1: Dropdown selection detection
    // If hint mentions a specific option text (like "BOGO", "UberEats Growth")
    // AND the action was a click on combobox/listbox (NOT the option itself)
    // THEN it's intermediate (opening dropdown to reveal options)
    
    if (action.type === 'click' && hint.actionType === 'click') {
      const hintTargetText = (hint.targetText || '').toLowerCase().trim();
      const hintDescription = (hint.description || '').toLowerCase();
      const actionTargetRole = action.params.target?.role?.toLowerCase() || '';
      const actionTargetText = (action.params.target?.text || action.params.target?.name || '').toLowerCase().trim();
      
      // Check if hint is about selecting a specific option
      const hintMentionsSpecificOption = hintTargetText.length > 0 && 
        !hintDescription.includes('dropdown') && 
        !hintDescription.includes('menu') &&
        !hintDescription.includes('combobox');
      
      // Check if action clicked a combobox/listbox (opening it)
      const actionClickedDropdownTrigger = 
        actionTargetRole === 'combobox' || 
        actionTargetRole === 'listbox' ||
        actionTargetRole === 'button';  // Some dropdowns use buttons as triggers
      
      // Check if the action's target text matches the hint's target text
      const actionMatchesHintTarget = 
        actionTargetText.length > 0 && 
        hintTargetText.length > 0 &&
        (actionTargetText.includes(hintTargetText) || hintTargetText.includes(actionTargetText));
      
      if (hintMentionsSpecificOption && actionClickedDropdownTrigger && !actionMatchesHintTarget) {
        // Hint wanted specific option, but action clicked dropdown trigger
        // This is intermediate - need to select the actual option next
        console.log(`[AIAgent] 🔍 Intermediate action detected:`);
        console.log(`  - Hint target: "${hintTargetText}"`);
        console.log(`  - Action clicked: ${actionTargetRole} "${actionTargetText}"`);
        console.log(`  - Reason: Opened dropdown but didn't select option yet`);
        return true;
      }
      
      // Additional check: If dropdown just opened (observation shows it)
      // AND hint target text doesn't match action target
      // AND action didn't click an option
      // THEN it's intermediate
      const actionClickedOption = actionTargetRole === 'option' || actionTargetRole === 'menuitem';
      
      if (observation.hasOpenDropdown && hintMentionsSpecificOption && !actionMatchesHintTarget && !actionClickedOption) {
        console.log(`[AIAgent] 🔍 Intermediate action detected:`);
        console.log(`  - Hint target: "${hintTargetText}"`);
        console.log(`  - Dropdown opened: YES`);
        console.log(`  - Options available:`, observation.dropdownOptions);
        console.log(`  - Reason: Dropdown opened but option not selected yet`);
        return true;
      }
      
      // CRITICAL: If we clicked an option/menuitem, it's NEVER intermediate
      // (Even if dropdown is still open, the selection action completes the goal)
      if (actionClickedOption) {
        console.log(`[AIAgent] ✅ Option/menuitem clicked - this completes the goal, not intermediate`);
        return false;
      }
    }
    
    // Strategy 2: Modal/popup opening detection
    // If hint is about interacting with content INSIDE a modal
    // AND action opened the modal (but didn't interact with content yet)
    // THEN it's intermediate
    
    // For now, we'll focus on dropdown detection as that's the primary issue
    // Future: Add modal detection, "Show more" button detection, etc.
    
    // Default: Assume action achieved the goal
    return false;
  }

  /**
   * Cleanup UI state after a failed hint is skipped
   * Closes any open dropdowns, modals, or menus that might block subsequent actions
   */
  private async cleanupUIState(failedHint: AgentHint): Promise<void> {
    console.log(`[AIAgent] 🧹 Cleaning up UI state after failed ${failedHint.actionType} action...`);
    
    try {
      // Check if there's an open dropdown
      const openDropdownOptions = document.querySelectorAll('[role="option"]');
      const openListboxes = document.querySelectorAll('[role="listbox"]:not([hidden])');
      const openMenus = document.querySelectorAll('[role="menu"]:not([hidden])');
      
      const hasOpenDropdown = openDropdownOptions.length > 0 || openListboxes.length > 0 || openMenus.length > 0;
      
      if (hasOpenDropdown) {
        console.log(`[AIAgent] 🔽 Detected open dropdown (${openDropdownOptions.length} options, ${openListboxes.length} listboxes, ${openMenus.length} menus) - closing...`);
        
        // Method 1: Press Escape key
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        }));
        
        await this.sleep(50);
        
        // Method 2: Click on document body
        document.body.click();
        
        await this.sleep(100);
        
        // Method 3: Blur active element
        const activeEl = document.activeElement;
        if (activeEl && activeEl !== document.body) {
          (activeEl as HTMLElement).blur?.();
          activeEl.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
          }));
        }
        
        await this.sleep(100);
        
        // Verify cleanup
        const remainingOptions = document.querySelectorAll('[role="option"]').length;
        console.log(`[AIAgent] 🧹 Dropdown cleanup complete. Remaining options: ${remainingOptions}`);
      }
      
      // Also check for stuck modals/dialogs
      const openDialogs = document.querySelectorAll('[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])');
      if (openDialogs.length > 0) {
        console.log(`[AIAgent] 📦 Detected ${openDialogs.length} open dialogs - attempting to dismiss...`);
        
        // Try pressing Escape to close dialogs
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        }));
        
        await this.sleep(200);
      }
      
    } catch (error) {
      console.warn('[AIAgent] ⚠️ Error during UI cleanup:', error);
      // Don't throw - cleanup failures shouldn't block execution
    }
  }

  /**
   * Verify if the workflow's expected outcome has been achieved
   * This provides basic outcome checking based on URL and page content
   */
  private async verifyWorkflowOutcome(): Promise<{ achieved: boolean; reason: string }> {
    if (!this.state.analyzedIntent?.expectedOutcome) {
      return { achieved: false, reason: 'No expectedOutcome defined' };
    }

    const expectedOutcome = this.state.analyzedIntent.expectedOutcome.toLowerCase();
    
    // Check URL-based outcomes
    const currentUrl = window.location.href.toLowerCase();
    if (expectedOutcome.includes('confirmation') && currentUrl.includes('confirm')) {
      return { achieved: true, reason: 'URL indicates confirmation page' };
    }
    if (expectedOutcome.includes('success') && currentUrl.includes('success')) {
      return { achieved: true, reason: 'URL indicates success page' };
    }
    if (expectedOutcome.includes('thank you') && (currentUrl.includes('thankyou') || currentUrl.includes('thank-you'))) {
      return { achieved: true, reason: 'URL indicates thank you page' };
    }

    // Check for success indicators in DOM
    const successIndicators = ['success', 'confirmed', 'complete', 'saved', 'submitted', 'thank you'];
    const bodyText = document.body.innerText.toLowerCase();
    for (const indicator of successIndicators) {
      if (expectedOutcome.includes(indicator) && bodyText.includes(indicator)) {
        return { achieved: true, reason: `Found "${indicator}" on page` };
      }
    }

    // Check visual confirmation if provided
    if (this.state.analyzedIntent.visualConfirmation) {
      const visualConfirmation = this.state.analyzedIntent.visualConfirmation.toLowerCase();
      const visualIndicators = visualConfirmation.split(/,|\sand\s/).map(s => s.trim());
      for (const indicator of visualIndicators) {
        if (indicator && bodyText.includes(indicator)) {
          return { achieved: true, reason: `Found visual confirmation: "${indicator}"` };
        }
      }
    }

    return { achieved: false, reason: 'Outcome not yet verified' };
  }

  /**
   * Build a human-readable progress summary for recovery context
   * Helps the AI understand where we are in the workflow
   */
  private buildProgressSummary(currentStep: number, totalSteps: number, completedSteps: number[]): string {
    const percentComplete = Math.round((completedSteps.length / totalSteps) * 100);

    if (currentStep === 0) {
      return 'Just starting - this is the first step';
    }
    if (currentStep >= totalSteps - 1) {
      return `Almost done (${percentComplete}%) - this is the FINAL step, try harder!`;
    }
    if (percentComplete >= 80) {
      return `Near completion (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
    }
    if (percentComplete >= 50) {
      return `Halfway through (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
    }
    return `In progress (${percentComplete}%) - ${completedSteps.length} of ${totalSteps} steps done`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton for easy access
export const aiAgent = new AIAgent();

