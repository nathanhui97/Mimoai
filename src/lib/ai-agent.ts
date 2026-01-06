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
 */

import { aiConfig } from './ai-config';
import { VisualSnapshotService } from '../content/visual-snapshot';
import { generateDOMMap, domMapToText, type DOMMap, type DOMMapElement } from '../content/dom-map';
import { FeatureFlags } from './feature-flags';
import { Tier1Executor, type Tier1ExecutionResult, type RejectionCode } from './tier1-executor';
import { SpreadsheetExecutor } from './spreadsheet-executor';
import { SheetStateExtractor } from '../content/sheet-state-extractor';
import { VisionAssist } from './tier3-vision-assist';
import { RecoveryEngine } from '../content/recovery-engine';
import type { WorkflowStepPayload, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

// ============================================================================
// Types
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
  actionType: 'click' | 'type' | 'navigate' | 'scroll' | 'other';
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
  iframeContext?: import('../types/workflow').IframeContext;
  
  // TAB_SWITCH context
  stepType?: 'TAB_SWITCH' | 'CLICK' | 'INPUT' | 'SCROLL' | 'KEYBOARD' | 'NAVIGATION';
  recordedPayload?: any; // Full recorded payload for TAB_SWITCH steps
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
  memory?: Record<string, string | boolean | number>; // NEW: Store values read during execution
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

/** Progress callback */
export type AgentProgressCallback = (
  stepNumber: number,
  action: AgentAction,
  status: 'thinking' | 'acting' | 'completed' | 'failed'
) => void;

// ============================================================================
// AI Agent Class
// ============================================================================

export class AIAgent {
  private state: AgentState;
  private maxSteps: number;
  // @ts-ignore - stepTimeout is stored for potential future use in API timeout
  private stepTimeout: number;
  private onProgress?: AgentProgressCallback;

  constructor(options: {
    maxSteps?: number;
    stepTimeout?: number;
    onProgress?: AgentProgressCallback;
  } = {}) {
    this.maxSteps = options.maxSteps ?? 50;
    this.stepTimeout = options.stepTimeout ?? 30000; // Used for API timeout
    this.onProgress = options.onProgress;
    
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
  async run(workflow: SavedWorkflow, variableValues?: Record<string, string>): Promise<AgentResult> {
    console.log('[AIAgent] Starting workflow execution');
    console.log(`[AIAgent] 🆔 Workflow ID: ${workflow.id}`);
    console.log(`[AIAgent] 📝 Workflow Name: ${workflow.name || 'Unnamed'}`);
    console.log(`[AIAgent] 📅 Created: ${workflow.createdAt ? new Date(workflow.createdAt).toLocaleString() : 'Unknown'}`);
    console.log(`[AIAgent] 📊 Total steps: ${workflow.steps.length}`);
    
    // Clear any existing TabManager state from previous workflows
    try {
      const { TabManager } = await import('../content/universal-execution/tab-manager');
      await TabManager.clearStorage();
      console.log('[AIAgent] 🧹 Cleared previous tab manager state');
    } catch (error) {
      console.warn('[AIAgent] Could not clear tab manager state:', error);
    }
    
    // Initialize state
    this.state = {
      workflowId: workflow.id,
      goal: this.inferGoal(workflow),
      hints: this.extractHints(workflow, variableValues),
      history: [],
      currentHintIndex: 0,
      status: 'running',
      startTime: Date.now(),
      variableValues,
      memory: {}, // NEW: Initialize agent memory
    };

    console.log(`[AIAgent] Goal: ${this.state.goal}`);
    console.log(`[AIAgent] Hints: ${this.state.hints.length} steps`);
    
    return this.continueExecution();
  }
  
  /**
   * Resume execution from saved state
   */
  async resume(savedState: AgentState): Promise<AgentResult> {
    console.log('[AIAgent] Resuming from saved state');
    this.state = savedState;
    this.state.status = 'running';
    
    // Check if this is a tab transfer (not a navigation)
    const isTabTransfer = (savedState as any).transferredToTab !== undefined;
    
    if (isTabTransfer) {
      console.log('[AIAgent] 🔄 Resuming after tab switch - NOT incrementing hint index');
      console.log(`[AIAgent] Will continue from hint ${this.state.currentHintIndex}`);
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
        
        // FAST PATH DISABLED FOR AI AGENT
        // The agent needs to observe state at each step and make decisions
        // Fast-type would skip observation and blindly execute based on recorded selectors
        // This causes issues like:
        // - Typing in field that closes an open dropdown before clicking the option
        // - Not adapting to current page state
        // 
        // Fast-type is only useful for "replay mode" (selector-based execution)
        // For AI Agent mode, we always observe → decide → act

        // 1. Observe
        const observation = await this.observe();
        console.log(`[AIAgent] Observed: ${observation.url}`);
        
        // 1.5 Check if current hint's expected outcome is already satisfied
        if (currentHint?.naturalLanguage?.expectedOutcome) {
          const skipReason = this.checkIfOutcomeAlreadySatisfied(currentHint, observation);
          if (skipReason) {
            console.log(`[AIAgent] ⏭️ SKIPPING STEP: ${skipReason}`);
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            // Log the skip
            this.state.history.push({
              stepNumber: currentHint.stepNumber,
              action: { type: 'skip', params: { reason: skipReason }, reasoning: 'Outcome already satisfied', confidence: 1.0 },
              observation,
              result: 'success',
              timestamp: Date.now(),
            });
            continue; // Move to next iteration of the loop
          }
        }

        // 1.5 Handle TAB_SWITCH hints deterministically (bypass LLM)
        if (currentHint?.stepType === 'TAB_SWITCH') {
          console.log(`[AIAgent] 🔄 Executing TAB_SWITCH hint deterministically`);
          
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
          
          // Record result
          this.state.history.push({
            stepNumber: currentHint.stepNumber,
            action: tabSwitchAction,
            observation,
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

        // 1.6 Handle SCROLL hints deterministically (bypass LLM)
        if (currentHint?.actionType === 'scroll') {
          console.log(`[AIAgent] 📜 Executing SCROLL hint deterministically`);
          
          // Use recorded scroll amount, direction, and container (critical for lazy-loaded widgets!)
          const direction = currentHint.scrollDirection || 'down';
          const amount = currentHint.scrollAmount || 300;
          const containerSelector = currentHint.scrollContainer;
          
          if (containerSelector) {
            console.log(`[AIAgent] 📜 Scroll: ${direction} by ${amount}px in "${containerSelector}" (recorded)`);
          } else {
            console.log(`[AIAgent] 📜 Scroll: ${direction} by ${amount}px on window (${currentHint.scrollAmount ? 'recorded' : 'default'})`);
          }
          
          const scrollAction: AgentAction = {
            type: 'scroll',
            params: {
              direction,
              amount,
              scrollContainerSelector: containerSelector,
              description: currentHint.description,
            },
            reasoning: `Executing recorded scroll action: ${direction} ${amount}px${containerSelector ? ` in ${containerSelector}` : ''}`,
            confidence: 1.0,
            hintStepIndex: this.state.currentHintIndex,
          };
          
          // Execute scroll
          this.onProgress?.(this.state.currentHintIndex, scrollAction, 'acting');
          const scrollResult = await this.act(scrollAction);
          
          // Record result
          this.state.history.push({
            stepNumber: currentHint.stepNumber,
            action: scrollAction,
            observation,
            result: scrollResult.success ? 'success' : 'failed',
            error: scrollResult.error,
            timestamp: Date.now(),
          });
          
          if (scrollResult.success) {
            // Mark as completed and advance
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.hints[this.state.currentHintIndex].failureCount = 0;
            this.state.currentHintIndex++;
            console.log(`[AIAgent] ✅ Scroll completed, advanced to hint ${this.state.currentHintIndex}`);
            
            // 🎯 CRITICAL: Wait for lazy-loaded content to render after scroll
            // Check if the NEXT hint requires a specific widget/container
            const nextHint = this.state.hints[this.state.currentHintIndex];
            if (nextHint?.recordedScopeHint) {
              console.log(`[AIAgent] ⏳ Waiting for widget "${nextHint.recordedScopeHint}" to become visible...`);
              
              const maxWaitMs = 5000; // Wait up to 5 seconds
              const checkIntervalMs = 500;
              const startWait = Date.now();
              let widgetFound = false;
              
              while (Date.now() - startWait < maxWaitMs) {
                // Check if the widget is now visible in the DOM
                const { resolveScopeContainer } = await import('../types/scope');
                const widgetElement = resolveScopeContainer({
                  kind: 'WIDGET',
                  title: nextHint.recordedScopeHint,
                }, document);
                
                if (widgetElement) {
                  console.log(`[AIAgent] ✅ Widget "${nextHint.recordedScopeHint}" is now visible (waited ${Date.now() - startWait}ms)`);
                  widgetFound = true;
                  break;
                }
                
                await this.sleep(checkIntervalMs);
              }
              
              if (!widgetFound) {
                console.warn(`[AIAgent] ⚠️ Widget "${nextHint.recordedScopeHint}" not found after ${maxWaitMs}ms - continuing anyway`);
              }
            } else {
              // No specific widget required, just wait for general page stability (optimized from 500ms)
              await this.sleep(200);
            }
          } else {
            // Scroll failed - increment failure count
            this.state.hints[this.state.currentHintIndex].failureCount = 
              (this.state.hints[this.state.currentHintIndex].failureCount || 0) + 1;
            
            if (this.state.hints[this.state.currentHintIndex].failureCount! >= 3) {
              console.warn(`[AIAgent] Scroll failed 3 times, skipping...`);
              this.state.hints[this.state.currentHintIndex].skipped = true;
              this.state.currentHintIndex++;
            }
          }
          
          continue; // Move to next iteration of the loop
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
          
          // Extract cell reference from hint
          let recordedCellRef: string | undefined;
          
          // Try recordedAriaLabel first (e.g., "A2", "B3")
          if (currentHint.recordedAriaLabel) {
            const match = currentHint.recordedAriaLabel.match(/^([A-Z]+\d+)$/i);
            if (match) {
              recordedCellRef = match[1].toUpperCase();
            }
          }
          
          // Try fallback selectors (e.g., [aria-label="A2"])
          if (!recordedCellRef && currentHint.recordedFallbackSelectors) {
            for (const selector of currentHint.recordedFallbackSelectors) {
              const ariaMatch = selector.match(/\[aria-label=["']([A-Z]+\d+)["']\]/i);
              if (ariaMatch) {
                recordedCellRef = ariaMatch[1].toUpperCase();
                break;
              }
            }
          }
          
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
          let cellRef: string | undefined;
          
          // Try recordedAriaLabel
          if (currentHint.recordedAriaLabel) {
            const match = currentHint.recordedAriaLabel.match(/^([A-Z]+\d+)$/i);
            if (match) {
              cellRef = match[1].toUpperCase();
            }
          }
          
          // Try fallback selectors
          if (!cellRef && currentHint.recordedFallbackSelectors) {
            for (const selector of currentHint.recordedFallbackSelectors) {
              const ariaMatch = selector.match(/\[aria-label=["']([A-Z]+\d+)["']\]/i);
              if (ariaMatch) {
                cellRef = ariaMatch[1].toUpperCase();
                break;
              }
            }
          }
          
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
        // 🚀 CONFIDENCE-BASED HYBRID EXECUTION
        // DOM finds candidates and calculates confidence
        // Route based on confidence: 95%+ = instant, 80-94% = fast, <80% = LLM
        // This saves ~500-1500ms per step for high-confidence actions
        // ============================================================================
        if (currentHint && (currentHint.actionType === 'click' || currentHint.actionType === 'type')) {
          const hybridResult = await this.tryFastPathExecute(currentHint);
          
          if (hybridResult.executed && hybridResult.success) {
            const confidence = hybridResult.confidence || 95;
            const confidenceLabel = confidence >= 95 ? 'HIGH' : 'MEDIUM-HIGH';
            console.log(`[Hybrid] ⚡ ${confidenceLabel} CONFIDENCE (${confidence}%) - ${currentHint.actionType.toUpperCase()} executed instantly, skipping LLM`);
            
            // Mark as completed and advance
            this.state.hints[this.state.currentHintIndex].completed = true;
            this.state.currentHintIndex++;
            
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
            
            // Brief pause then continue
            await this.sleep(150);
            continue;
          } else if (hybridResult.confidence !== undefined && hybridResult.confidence >= 60) {
            console.log(`[Hybrid] 🧠 MEDIUM CONFIDENCE (${hybridResult.confidence}%) - Using LLM for disambiguation`);
            // Fall through to LLM call below
          } else if (hybridResult.confidence !== undefined) {
            console.log(`[Hybrid] 🔧 LOW CONFIDENCE (${hybridResult.confidence}%) - Using LLM for recovery`);
            // Fall through to LLM call below
          }
        }
        
        // 2. Think (use AI) - only if fast-path didn't work
        this.onProgress?.(this.state.currentHintIndex, { type: 'wait', params: {}, reasoning: 'Thinking...', confidence: 0 }, 'thinking');
        const action = await this.think(observation);
        console.log(`[AIAgent] Action: ${action.type}`, action.params);
        console.log(`[AIAgent] Reasoning: ${action.reasoning}`);

        // 3. Check if done
        if (action.type === 'done') {
          console.log('[AIAgent] Goal achieved!');
          this.state.status = 'completed';
          break;
        }

        if (action.type === 'fail') {
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
        const result = await this.act(action);

        // 5. Record history
        const historyEntry: ActionHistoryEntry = {
          stepNumber: this.state.history.length + 1,
          action,
          observation,
          result: result.success ? 'success' : 'failed',
          error: result.error,
          timestamp: Date.now(),
        };
        this.state.history.push(historyEntry);

        // 6. Update hint progress
        // ALWAYS mark currentHintIndex as completed, not hintStepIndex from LLM
        // (LLM might get confused about step numbers, but we know which step we're on)
        if (result.success) {
          const completedIndex = this.state.currentHintIndex;
          if (completedIndex >= 0 && completedIndex < this.state.hints.length) {
            this.state.hints[completedIndex].completed = true;
            this.state.hints[completedIndex].failureCount = 0;  // Reset failure count
            
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
                  
                  // Check if we have interactive elements with matching text
                  const hasMatchingElements = currentMap.interactiveElements.some(el => {
                    const targetText = nextHint.targetText?.toLowerCase() || '';
                    const elName = (el.name || '').toLowerCase();
                    const elText = (el.text || '').toLowerCase();
                    return elName.includes(targetText) || elText.includes(targetText) || targetText.includes(elName);
                  });
                  
                  if (hasMatchingElements) {
                    console.log(`[AIAgent] ✅ Content ready - found matching elements (waited ${Date.now() - startWait}ms)`);
                    contentReady = true;
                    break;
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
          // Track failures for currentHintIndex - skip hint after 3 consecutive failures
          const failedIndex = this.state.currentHintIndex;
          if (failedIndex >= 0 && failedIndex < this.state.hints.length) {
            const hint = this.state.hints[failedIndex];
            hint.failureCount = (hint.failureCount || 0) + 1;
            
            if (hint.failureCount >= 3) {
              console.warn(`[AIAgent] ⏭️ Skipping hint ${failedIndex} after ${hint.failureCount} failures: ${hint.description}`);
              hint.skipped = true;
              
              // Find next incomplete hint
              let nextIndex = failedIndex + 1;
              while (nextIndex < this.state.hints.length && 
                     (this.state.hints[nextIndex].completed || this.state.hints[nextIndex].skipped)) {
                nextIndex++;
              }
              
              if (nextIndex < this.state.hints.length) {
                this.state.currentHintIndex = nextIndex;
                console.log(`[AIAgent] 📍 Advanced to next incomplete hint: ${nextIndex}`);
              } else {
                // No more hints - check if we completed enough to consider it a success
                const completedCount = this.state.hints.filter(h => h.completed).length;
                const skippedCount = this.state.hints.filter(h => h.skipped).length;
                const totalCount = this.state.hints.length;
                
                console.log(`[AIAgent] 📍 No more incomplete hints (${completedCount} completed, ${skippedCount} skipped, ${totalCount} total)`);
                
                // If we completed at least 70% of hints, consider it a success
                if (completedCount >= totalCount * 0.7) {
                  console.log(`[AIAgent] ✅ Completed ${completedCount}/${totalCount} hints (>70%), marking as success`);
                  this.state.status = 'completed';
                } else {
                  console.log(`[AIAgent] ❌ Only completed ${completedCount}/${totalCount} hints (<70%), marking as failed`);
                  this.state.status = 'failed';
                }
                break; // Exit the loop!
              }
            } else {
              console.log(`[AIAgent] ⚠️ Hint ${failedIndex} failed (${hint.failureCount}/3 failures)`);
            }
          }
        }

        this.onProgress?.(
          this.state.currentHintIndex,
          action,
          result.success ? 'completed' : 'failed'
        );

        // Brief pause between actions (optimized from 500ms)
        await this.sleep(150);
      }
    } catch (error) {
      console.error('[AIAgent] Error:', error);
      this.state.status = 'failed';
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
   */
  private async observe(): Promise<AgentObservation> {
    console.log('[AIAgent] 🔍 Observing page state...');
    
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
      const capture = await VisualSnapshotService.captureFullPage(0.8);
      screenshot = capture?.screenshot;
    }
    
    return {
      url: window.location.href,
      title: document.title,
      
      // DOM map (primary source)
      domMapText,
      
      // Modal context
      hasModal: !!domMap.activeModal,
      modalTitle: domMap.activeModal?.title,
      
      // CRITICAL: Dropdown context
      hasOpenDropdown: !!domMap.activeDropdown,
      dropdownOptions: domMap.activeDropdown?.options.map(o => o.name || o.text || '(unnamed)'),
      
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
    try {
      // Only attempt fast-path for click and type actions
      if (hint.actionType !== 'click' && hint.actionType !== 'type') {
        return { executed: false };
      }

      // Check if a dropdown is currently open
      const { generateDOMMap } = await import('../content/dom-map');
      const domMap = generateDOMMap();
      const dropdownIsOpen = !!domMap.activeDropdown;
      
      // If dropdown is open and hint text matches a dropdown option, ONLY consider dropdown menu items
      if (dropdownIsOpen && hint.targetText && hint.actionType === 'click') {
        const hintTextLower = hint.targetText.toLowerCase();
        const dropdownOptions = domMap.activeDropdown?.options || [];
        const matchesDropdownOption = dropdownOptions.some(opt => 
          (opt.text || opt.name || '').toLowerCase().includes(hintTextLower) ||
          hintTextLower.includes((opt.text || opt.name || '').toLowerCase())
        );
        
        if (matchesDropdownOption) {
          console.log('[Hybrid] ⚡ Confidence-based skip: Dropdown is open (let LLM select option)');
          return { executed: false, confidence: 50 };
        }
      }

      // Need recorded selectors for fast-path
      const selectors = [
        hint.recordedSelector,
        ...(hint.recordedFallbackSelectors || []),
      ].filter(Boolean) as string[];
      
      if (selectors.length === 0) {
        console.log('[Hybrid] ⚡ Confidence-based skip: No recorded selectors');
        return { executed: false, confidence: 0 };
      }

      // DEBUG: Log selectors being tried
      console.log(`[Hybrid] 🔍 DEBUG: Trying ${selectors.length} selectors:`, selectors.map(s => s.substring(0, 80)));

      // Find ALL matching candidates
      const candidates: HTMLElement[] = [];
      
      for (const selector of selectors) {
        try {
          let found: NodeListOf<Element> | Element[] = [];
          
          // Handle XPath selectors using document.evaluate
          if (selector.startsWith('/')) {
            console.log(`[Hybrid] 🔍 DEBUG: Trying XPath selector: ${selector.substring(0, 80)}`);
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
              console.log(`[Hybrid] 🔍 DEBUG: XPath found ${found.length} elements`);
            } catch (xpathError) {
              console.log(`[Hybrid] 🔍 DEBUG: XPath evaluation failed:`, xpathError);
              continue;
            }
          } else {
            // CSS selector
            found = document.querySelectorAll(selector);
            console.log(`[Hybrid] 🔍 DEBUG: CSS selector "${selector.substring(0, 80)}" found ${found.length} elements`);
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
          
          console.log(`[Hybrid] 🔍 DEBUG: ${visibleCount} of ${found.length} passed visibility+size checks`);
          
          // If we found a match with this selector, stop trying others
          // This is the KEY: we only try the FIRST selector that matches!
          if (candidates.length > 0) {
            console.log(`[Hybrid] 🔍 DEBUG: Stopping selector search - found ${candidates.length} candidates with first matching selector`);
            break;
          }
        } catch (err) {
          console.log(`[Hybrid] 🔍 DEBUG: Selector failed:`, err);
          // Invalid selector, try next
        }
      }
      
      // DEBUG: Log actual candidate count to diagnose "unique match" bug
      console.log(`[Hybrid] 🔍 DEBUG: Found ${candidates.length} candidates matching selectors`);
      if (candidates.length > 0) {
        console.log(`[Hybrid] 🔍 DEBUG: First 3 candidates:`, candidates.slice(0, 3).map(c => ({
          tag: c.tagName,
          text: c.textContent?.substring(0, 30),
          ariaLabel: c.getAttribute('aria-label'),
          parent: c.parentElement?.tagName,
        })));
      }
      
      // Calculate confidence score
      const confidenceAnalysis = this.calculateExecutionConfidence(hint, candidates);
      
      console.log(`[Hybrid] Confidence: ${confidenceAnalysis.confidence}% - ${confidenceAnalysis.reason}`);
      
      // ============================================================================
      // CONFIDENCE-BASED ROUTING
      // ============================================================================
      
      // HIGH CONFIDENCE (95-100%): Execute immediately
      if (confidenceAnalysis.confidence >= 95 && confidenceAnalysis.bestCandidate) {
        console.log('[Hybrid] ⚡ HIGH CONFIDENCE (95%+) - Instant execution');
        return await this.instantExecute(hint, confidenceAnalysis.bestCandidate, confidenceAnalysis.confidence);
      }
      
      // MEDIUM-HIGH CONFIDENCE (80-94%): Execute with caution
      // Still fast, but we're slightly less certain
      if (confidenceAnalysis.confidence >= 80 && confidenceAnalysis.bestCandidate) {
        console.log('[Hybrid] ⚡ MEDIUM-HIGH CONFIDENCE (80-94%) - Fast execution with logging');
        return await this.instantExecute(hint, confidenceAnalysis.bestCandidate, confidenceAnalysis.confidence);
      }
      
      // MEDIUM CONFIDENCE (60-79%): Let LLM disambiguate
      // DOM found candidates, but LLM should pick the right one
      if (confidenceAnalysis.confidence >= 60) {
        console.log('[Hybrid] 🧠 MEDIUM CONFIDENCE (60-79%) - Let LLM pick from candidates');
        return { executed: false, confidence: confidenceAnalysis.confidence };
      }
      
      // LOW CONFIDENCE (<60%): Full LLM recovery
      console.log('[Hybrid] 🔧 LOW CONFIDENCE (<60%) - Full LLM recovery needed');
      return { executed: false, confidence: confidenceAnalysis.confidence };
      
    } catch (error) {
      console.log('[Hybrid] ⚡ Error in confidence-based routing, falling back to LLM:', error);
      return { executed: false, confidence: 0 };
    }
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

      // Scroll into view and focus
      htmlElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      await this.sleep(50);
      htmlElement.focus();
      
      // Execute action
      if (hint.actionType === 'click') {
        htmlElement.click();
      } else if (hint.actionType === 'type' && hint.value) {
        // For type actions, use Tier1Executor for robust typing
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
      
      // Wait for stability
      const { StateWaitEngine } = await import('../content/state-wait-engine');
      await StateWaitEngine.waitForStability({ maxWaitMs: 2000 });
      
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
    
    // Find and rank candidates for the current hint
    let currentCandidates: Array<DOMMapElement & { index: number; score: number }> = [];
    if (nextIncompleteHint) {
      currentCandidates = this.findAndRankCandidates(nextIncompleteHint, domMap);
      console.log(`[AIAgent] Found ${currentCandidates.length} ranked candidates for hint ${nextIncompleteHint.stepNumber}`);
      if (currentCandidates.length > 0) {
        console.log(`[AIAgent] Top candidate: [${currentCandidates[0].role}] "${currentCandidates[0].name}" (score: ${currentCandidates[0].score})`);
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
      
      // Goal and hints
      goal: this.state.goal,
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
      
      // NEW: Spreadsheet context (extracted fresh during replay)
      spreadsheetContext,
      
      // Only include screenshot if VisionClicker is enabled
      screenshot: observation.screenshot,
    };

    try {
      console.log('[AIAgent] 🧠 Calling dom_agent Edge Function...');
      console.log('[AIAgent] 📤 Sending: currentHintIndex =', payload.currentHintIndex, ', nextIncomplete =', nextIncompleteHint?.stepNumber);
      console.log('[AIAgent] 📤 Hints status:', payload.hints.map((h: any, i: number) => `${i}:${h.completed?'✅':'⬜'}`).join(' '));
      
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
            // CRITICAL: Include scope hint from candidate for disambiguation!
            scopeHint: chosenCandidate.widgetTitle || chosenCandidate.scopePath?.[0],
          };
        }
      } else if (typeof candidateIndex === 'number') {
        console.warn(`[AIAgent] ⚠️ Candidate index ${candidateIndex} out of range (have ${currentCandidates.length} candidates)`);
      }
      
      // Build action with semantic target (not coordinates)
      // CRITICAL: Include fallback selectors from the hint for reliable disambiguation!
      const fallbackSelectorsFromHint = nextIncompleteHint?.recordedFallbackSelectors;
      const scopeHintFromHint = nextIncompleteHint?.recordedScopeHint;
      
      // Log scope hint usage for debugging
      if (scopeHintFromHint) {
        console.log(`[AIAgent] 📌 Using RECORDED scope hint: "${scopeHintFromHint}"`);
        if (resolvedTarget?.scopeHint && resolvedTarget.scopeHint !== scopeHintFromHint) {
          console.warn(`[AIAgent] ⚠️ AI picked wrong widget "${resolvedTarget.scopeHint}" - overriding with recorded: "${scopeHintFromHint}"`);
        }
      }
      
      const action: AgentAction = {
        type: result.action || 'fail',
        params: {
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
        
        return { success: true };
      }
      
      // Action was rejected - start recovery loop
      console.warn(`[AIAgent] ⚠️ Tier 1 rejected: ${result.code}`, result.details);
      
      // On last attempt, give up
      if (attempt === maxRecoveryAttempts) {
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
        return {
          success: false,
          error: `Recovery gave up: ${recoveryDecision.reasoning}`,
        };
      }
      
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
    strategy: 'RETRY_WITH_VISION' | 'RETRY_LOOSER' | 'SCROLL_AND_RETRY' | 'DISMISS_POPUP' | 'GIVE_UP';
    refinedTarget?: SemanticTarget;
    reasoning: string;
  }> {
    console.log('[AIAgent] 🧠 Thinking about recovery...');
    
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/dom_agent`;
    
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
   * Returns max 8 candidates sorted by score
   */
  private findAndRankCandidates(hint: AgentHint, domMap: DOMMap): Array<DOMMapElement & { index: number; score: number }> {
    // Infer expected role from hint description if not explicit
    const expectedRole = this.inferRoleFromHint(hint);
    
    // 🚨 DROPDOWN PRIORITY: If a dropdown is open, prioritize dropdown options
    const dropdownIsOpen = !!domMap.activeDropdown;
    
    // Score ALL interactive elements (don't filter first - let scoring decide)
    const allElements = [...domMap.interactiveElements, ...domMap.formFields];
    
    // 🎯 PRE-FILTER: If we have a recorded scope hint, only consider elements in that widget
    // CRITICAL: If dropdown is open, ONLY include dropdown options (ignore scope filtering entirely)
    let candidatePool = allElements;
    if (dropdownIsOpen) {
      // DROPDOWN OPEN: Only consider dropdown options, ignore everything else!
      const isDropdownOption = (el: DOMMapElement) => 
        el.role === 'option' || el.role === 'menuitem' || el.role === 'menuitemradio' || el.role === 'menuitemcheckbox';
      
      candidatePool = allElements.filter(isDropdownOption);
      console.log(`[AIAgent] 🔽 Dropdown is open - filtered to ${candidatePool.length} dropdown options ONLY (ignoring ${allElements.length - candidatePool.length} non-dropdown elements)`);
    } else if (hint.recordedScopeHint) {
      // Normal scope filtering when no dropdown
      const scopeHint = hint.recordedScopeHint.toLowerCase();
      const inScope = allElements.filter(el => {
        // Check widgetTitle (exact match or contains)
        if (el.widgetTitle && el.widgetTitle.toLowerCase().includes(scopeHint)) {
          return true;
        }
        // Check scopePath (element's container hierarchy)
        if (el.scopePath?.some(s => s.toLowerCase().includes(scopeHint))) {
          return true;
        }
        // Fuzzy match for titles with dynamic numbers (e.g., "STORE...119" vs "STORE...")
        if (el.widgetTitle) {
          const baseScope = scopeHint.replace(/\d+$/g, '').trim();
          const baseWidget = el.widgetTitle.toLowerCase().replace(/\d+$/g, '').trim();
          if (baseScope.length > 10 && baseWidget.includes(baseScope)) {
            return true;
          }
        }
        return false;
      });
      
      if (inScope.length > 0) {
        candidatePool = inScope;
        console.log(`[AIAgent] 🎯 Pre-filtered to ${inScope.length} elements in recorded scope "${hint.recordedScopeHint}" (from ${allElements.length} total)`);
      } else {
        console.warn(`[AIAgent] ⚠️ No elements found in recorded scope "${hint.recordedScopeHint}" - element may not be visible yet. Using all ${allElements.length} elements as fallback.`);
      }
    }
    
    // DEBUG: Log hint details
    console.log(`[AIAgent] 🔍 Scoring ${candidatePool.length} elements for hint:`, {
      targetText: hint.targetText,
      targetRole: hint.targetRole,
      recordedAriaLabel: hint.recordedAriaLabel,
      recordedScopeHint: hint.recordedScopeHint,
      expectedRole,
    });
    
    const scored = candidatePool.map(el => ({
      ...el,
      score: this.computeCandidateScore(el, hint, expectedRole, dropdownIsOpen),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    // Take top 15 candidates (increased from 8 to give LLM more options)
    // Don't filter by score - let the LLM decide even if scores are low
    const topCandidates = scored.slice(0, 15);
    
    console.log(`[AIAgent] Found ${topCandidates.length} candidates, top 3 scores: [${topCandidates.slice(0, 3).map(c => c.score).join(', ')}]`);
    
    // DEBUG: If all scores are 0, log first 3 candidates to diagnose
    if (topCandidates.length > 0 && topCandidates[0].score === 0) {
      console.warn('[AIAgent] ⚠️ All candidates scored 0! First 3 candidates:', topCandidates.slice(0, 3).map(c => ({
        role: c.role,
        name: c.name,
        text: c.text,
        widgetTitle: c.widgetTitle,
        scopePath: c.scopePath,
      })));
    }
    
    return topCandidates.map((s, i) => ({
      ...s,
      index: i,
    }));
  }
  
  /**
   * Infer expected role from hint description
   */
  private inferRoleFromHint(hint: AgentHint): string | null {
    // If explicit role, use it
    if (hint.targetRole) return hint.targetRole;
    
    const desc = (hint.description || '').toLowerCase();
    const text = (hint.targetText || '').toLowerCase();
    
    // Infer from description keywords
    if (desc.includes('dropdown') || desc.includes('select') || text.includes('select')) {
      return 'combobox';
    }
    if (desc.includes('button') || desc.includes('click') && (desc.includes('submit') || desc.includes('continue') || desc.includes('save'))) {
      return 'button';
    }
    if (desc.includes('enter') || desc.includes('type') || hint.actionType === 'type') {
      return 'textbox'; // or spinbutton, searchbox
    }
    if (desc.includes('link')) {
      return 'link';
    }
    if (desc.includes('checkbox')) {
      return 'checkbox';
    }
    
    return null;
  }
  
  
  /**
   * Compute score for a candidate element
   * Higher score = better match
   */
  private computeCandidateScore(el: DOMMapElement, hint: AgentHint, expectedRole: string | null, dropdownIsOpen: boolean = false): number {
    let score = 0;
    
    // ============================================================
    // DROPDOWN CONTEXT: If dropdown is open, massively boost options
    // ============================================================
    const isDropdownOption = el.role === 'option' || el.role === 'menuitem' || el.role === 'menuitemradio';
    if (dropdownIsOpen && isDropdownOption) {
      score += 150; // Massive boost for dropdown options when dropdown is open!
      console.log(`[AIAgent] 🔽 Boosting dropdown option: "${el.text || el.name}" (+150 points)`);
    }
    
    // ============================================================
    // ROLE MATCHING (Critical - 50 points)
    // ============================================================
    const roleAliases: Record<string, string[]> = {
      'combobox': ['combobox', 'listbox', 'select'],
      'textbox': ['textbox', 'searchbox', 'spinbutton', 'input'],
      'button': ['button', 'link', 'menuitem', 'option'], // ← Add 'option' for dropdown clicks recorded as button
      'link': ['link', 'button'],
      'checkbox': ['checkbox', 'switch'],
    };
    
    if (expectedRole) {
      const validRoles = roleAliases[expectedRole] || [expectedRole];
      if (validRoles.includes(el.role)) {
        score += 50; // Role match!
      } else if (dropdownIsOpen && isDropdownOption) {
        // Don't penalize options when dropdown is open, even if hint expects button
        score += 0; // Neutral (already got +150 boost above)
      } else {
        // Role mismatch - significant penalty
        score -= 20;
      }
    }
    
    // ============================================================
    // testId exact match (highest priority - 100 points)
    // ============================================================
    if (hint.recordedTestId && el.attrs?.testId === hint.recordedTestId) {
      score += 100;
    }
    
    // ============================================================
    // ARIA-LABEL exact match (highest priority - 100 points)
    // ============================================================
    // aria-label is one of the most reliable identifiers
    // It's used for accessibility and is usually stable
    if (hint.recordedAriaLabel) {
      const recordedAriaLabel = hint.recordedAriaLabel.toLowerCase().trim();
      const elAriaLabel = el.name?.toLowerCase().trim(); // name comes from computeAccessibleName which uses aria-label
      
      if (elAriaLabel === recordedAriaLabel) {
        score += 100; // Exact aria-label match - highest priority!
        console.log(`[AIAgent] 🎯 Exact aria-label match: "${hint.recordedAriaLabel}" (+100 points)`);
      } else if (elAriaLabel && elAriaLabel.includes(recordedAriaLabel)) {
        score += 50; // Partial match (aria-label contains recorded value)
      } else if (recordedAriaLabel.includes(elAriaLabel || '')) {
        score += 30; // Reverse partial match
      }
    }
    
    // ============================================================
    // NAME/TEXT MATCHING (30 points for match, -10 for empty)
    // ============================================================
    const hintText = (hint.targetText || '').toLowerCase();
    const elName = (el.name || '').toLowerCase();
    const elText = (el.text || '').toLowerCase();
    const placeholder = (el.attrs?.placeholder || '').toLowerCase();
    
    if (hintText) {
      // Check for meaningful matches (not empty strings!)
      if (elName && elName.length > 0 && (elName.includes(hintText) || hintText.includes(elName))) {
        score += 30;
      } else if (elText && elText.length > 0 && (elText.includes(hintText) || hintText.includes(elText))) {
        score += 30;
      } else if (placeholder && placeholder.length > 0 && placeholder.includes(hintText)) {
        score += 25;
      }
    }
    
    // Unlabeled elements get a small bonus if they match the role
    // (they might be the only element of that type)
    if ((!elName || elName === '(unlabeled)') && expectedRole) {
      const validRoles = roleAliases[expectedRole] || [expectedRole];
      if (validRoles.includes(el.role)) {
        score += 10; // Small bonus for matching role even when unlabeled
      }
    }
    
    // ============================================================
    // CONTEXT MATCHING (Secondary signals)
    // ============================================================
    
    // rowKey match (40 points) - critical for table rows
    if (hint.recordedRowKey && el.rowKey === hint.recordedRowKey) {
      score += 40;
    }
    
    // scopePath match to recordedScopeHint (30 points)
    if (hint.recordedScopeHint && el.scopePath) {
      const scopeMatch = el.scopePath.some(s => 
        s.toLowerCase().includes(hint.recordedScopeHint!.toLowerCase())
      );
      if (scopeMatch) {
        score += 30;
      }
    }
    
    // widgetTitle match (20 points)
    if (hint.recordedScopeHint && el.widgetTitle) {
      if (el.widgetTitle.toLowerCase().includes(hint.recordedScopeHint.toLowerCase())) {
        score += 20;
      }
    }
    
    // nearbyText overlap (10 points per match)
    if (hint.nearbyText && el.scopePath) {
      const overlap = hint.nearbyText.filter(t => 
        el.scopePath?.some(s => s.toLowerCase().includes(t.toLowerCase()))
      ).length;
      score += overlap * 10;
    }
    
    // Text match quality (up to 15 points)
    if (hint.targetText && (el.name || el.text)) {
      const hintText = hint.targetText.toLowerCase();
      const elText = ((el.name || el.text) || '').toLowerCase();
      
      if (elText === hintText) {
        // Exact match
        score += 15;
      } else if (elText.includes(hintText) || hintText.includes(elText)) {
        // Partial match
        score += 8;
      }
    }
    
    // Placeholder match (10 points)
    if (hint.targetPlaceholder && el.attrs?.placeholder) {
      if (el.attrs.placeholder.toLowerCase().includes(hint.targetPlaceholder.toLowerCase())) {
        score += 10;
      }
    }
    
    return score;
  }

  /**
   * Infer the goal from workflow
   */
  private inferGoal(workflow: SavedWorkflow): string {
    // Prefer workflow name + description for richer context
    if (workflow.name && workflow.description) {
      return `${workflow.name} - ${workflow.description}`;
    }
    
    // Use workflow name as primary goal
    if (workflow.name) {
      return workflow.name;
    }

    // Try to infer from step descriptions
    const descriptions = workflow.steps
      .map(s => s.description)
      .filter(Boolean)
      .join(' → ');
    
    if (descriptions) {
      return `Complete workflow: ${descriptions}`;
    }

    return 'Complete the recorded workflow';
  }

  /**
   * Extract hints from workflow steps
   * 
   * Hints are "suggestions" not commands - they tell the AI what was recorded,
   * but the AI should adapt based on current page state and variable overrides.
   */
  private extractHints(workflow: SavedWorkflow, variableValues?: Record<string, string>): AgentHint[] {
    // ⚠️ CRITICAL: For AI Agent, ALWAYS use original steps, never optimized
    // The optimizer removes "redundant" clicks (like opening menus, waiting for page loads)
    // but these are ESSENTIAL for AI agent to execute in the correct sequence
    // 
    // Example: Optimizer removes "Click Accounts" → "Click New" and just keeps "Navigate to /new"
    // But AI needs to click through the UI, not navigate directly to URLs
    // 
    // LESSON LEARNED: Optimization breaks workflows that require sequential UI interactions
    let steps = workflow.steps; // ALWAYS use original steps
    
    if (workflow.optimizedSteps) {
      console.warn(`[AIAgent] ⚠️ Ignoring ${workflow.optimizedSteps.length} optimized steps - AI Agent requires original ${workflow.steps.length} steps for reliable execution`);
      console.warn(`[AIAgent] ⚠️ Optimizer removed ${workflow.steps.length - workflow.optimizedSteps.length} steps which may be essential for sequential UI interactions`);
    }
    
    const originalSteps = workflow.steps; // Keep reference to original steps for elementText lookup
    
    // ============================================================================
    // 📊 VARIABLE SUBSTITUTION: Build step→variable mapping
    // Variables are detected at recording time and stored in workflow.variables
    // User provides values in variableValues with keys matching variableName
    // ============================================================================
    const stepToVariable: Map<number, { variableName: string; fieldName: string }> = new Map();
    if (workflow.variables?.variables) {
      for (const variable of workflow.variables.variables) {
        stepToVariable.set(variable.stepIndex, {
          variableName: variable.variableName,
          fieldName: variable.fieldName,
        });
        console.log(`[AIAgent] 📝 Variable mapping: step ${variable.stepIndex} → "${variable.variableName}" (${variable.fieldName})`);
      }
    }
    
    return steps.map((step, index) => {
      // Handle TAB_SWITCH steps specially
      if (step.type === 'TAB_SWITCH') {
        const tabSwitchPayload = step.payload;
        const toTitle = (tabSwitchPayload as any).toTitle;
        const toUrl = (tabSwitchPayload as any).toUrl;
        
        return {
          stepNumber: index + 1,
          description: step.description || `Switch to tab: ${toTitle || toUrl}`,
          actionType: 'other',
          completed: false,
          stepType: 'TAB_SWITCH',
          recordedPayload: tabSwitchPayload,
        } as AgentHint;
      }
      
      const payload = step.payload as WorkflowStepPayload;
      
      // If this is an optimized NAVIGATION step, try to find the original step's elementText
      // The optimizer may have replaced multiple clicks with a single "Navigate directly to [URL]" step
      let originalElementText = payload.elementText;
      if (step.type === 'NAVIGATION' && !originalElementText && workflow.optimizationMetadata) {
        // Find the original steps that were optimized into this step
        const mapEntry = workflow.optimizationMetadata.optimizationMap.find(
          entry => entry.optimizedIndex === index
        );
        if (mapEntry && mapEntry.originalIndices.length > 0) {
          // Get elementText from the last original step (usually the one that triggered navigation)
          const lastOriginalIndex = mapEntry.originalIndices[mapEntry.originalIndices.length - 1];
          const originalStep = originalSteps[lastOriginalIndex];
          if (originalStep && isWorkflowStepPayload(originalStep.payload)) {
            originalElementText = originalStep.payload.elementText;
            console.log(`[AIAgent] Found original elementText "${originalElementText}" from step ${lastOriginalIndex}`);
          }
        }
      }
      
      // Determine action type
      let actionType: AgentHint['actionType'] = 'other';
      if (step.type === 'CLICK') actionType = 'click';
      else if (step.type === 'INPUT') actionType = 'type';
      else if (step.type === 'NAVIGATION') {
        // ALWAYS convert NAVIGATION to click - never use direct URL navigation
        // This prevents the agent from navigating to stale/wrong URLs
        // (e.g., navigating to Account/001ABC when user is on Account/001XYZ)
        // The agent should always click through the UI to navigate naturally
        actionType = 'click';
        console.log(`[AIAgent] Converting NAVIGATION step to 'click' (always click-through)`);
      }
      else if (step.type === 'SCROLL') actionType = 'scroll';

      // Substitute variables in value
      let value = payload.value;
      let originalValue = payload.value; // Keep for reference
      
      // ============================================================================
      // 📊 VARIABLE SUBSTITUTION: Use user-provided values
      // 1. Check if this step has a detected variable → use variableValues[variableName]
      // 2. Fallback: Replace {{varName}} patterns (legacy support)
      // ============================================================================
      const stepVariable = stepToVariable.get(index);
      if (stepVariable && variableValues && variableValues[stepVariable.variableName] !== undefined) {
        const userValue = variableValues[stepVariable.variableName];
        console.log(`[AIAgent] 📝 Variable substitution: step ${index} "${originalValue}" → "${userValue}" (${stepVariable.fieldName})`);
        value = userValue;
      } else if (value && variableValues) {
        // Fallback: Replace {{varName}} patterns
        value = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
          return variableValues[varName] ?? match;
        });
      }

      // Extract placeholder from context if available
      const placeholder = payload.context?.uniqueAttributes?.placeholder || 
                          payload.context?.formCoordinates?.label;
      
      // Build flexible description
      // Instead of: "Enter 1000 in Budget Amount"
      // Use: "Enter value in Budget Amount (recorded: 1000)"
      // This tells AI the intent, but allows flexibility
      let description = step.description;
      
      // For NAVIGATION steps, ALWAYS use elementText, not URL
      // This is critical because optimized workflows may have "Navigate directly to [URL]" descriptions
      // which confuse the AI into trying to navigate instead of clicking
      if (step.type === 'NAVIGATION') {
        // Use originalElementText if we found it from the original steps
        const elementTextToUse = originalElementText || payload.elementText;
        
        if (elementTextToUse) {
          description = `Click on "${elementTextToUse}"`;
          console.log(`[AIAgent] NAVIGATION hint: Using elementText "${elementTextToUse}" instead of URL`);
        } else if (payload.url) {
          // If no elementText but we have a URL, try to extract meaningful text from the URL
          // or use a generic description that encourages clicking through UI
          const urlPath = payload.url.split('/').pop() || '';
          description = `Navigate to ${urlPath} (click through UI, do not use direct URL navigation)`;
          console.log(`[AIAgent] NAVIGATION hint: No elementText, using URL path "${urlPath}"`);
        } else {
          // Fallback: generic description that emphasizes clicking
          description = `Click to navigate (do not use direct URL navigation)`;
          console.log(`[AIAgent] NAVIGATION hint: No elementText or URL, using generic click description`);
        }
      } else if (step.type === 'INPUT' && originalValue && originalValue !== value) {
        // User changed the value
        const fieldName = placeholder || payload.elementText || 'field';
        description = `Enter "${value}" in ${fieldName} (originally: "${originalValue}")`;
      } else if (step.type === 'INPUT' && value) {
        const fieldName = placeholder || payload.elementText || 'field';
        description = `Enter "${value}" in ${fieldName}`;
      } else {
        description = step.description || `${step.type} on ${payload.elementText || payload.selector}`;
      }

      // Extract recorded locator data for candidate matching
      const recordedSelector = payload.selector;
      
      // CRITICAL: Extract fallback selectors - these contain container-scoped XPaths!
      // e.g., "//div[descendant::*[contains(normalize-space(.), 'Widget Title')]]//button"
      // These are THE KEY to reliably finding the right element among duplicates!
      const recordedFallbackSelectors = payload.fallbackSelectors || [];
      
      const recordedTestId = payload.context?.uniqueAttributes?.['data-testid'] || 
                            payload.context?.uniqueAttributes?.['data-test-id'];
      
      // Extract aria-label from semantic anchors (critical for exact matching)
      const recordedAriaLabel = payload.aiEvidence?.semanticAnchors?.ariaLabel ||
                                payload.context?.uniqueAttributes?.['aria-label'];
      
      // Extract scope hint from context (e.g., widget/container title)
      // 🎯 PRIORITY ORDER:
      // 1. payload.scope (from locatorBundle - MOST RELIABLE)
      //    - WIDGET: use scope.title
      //    - NEAREST_SECTION: use scope.headingText
      //    - TABLE_ROW: use scope.anchorText
      //    - MODAL: no specific hint needed
      // 2. payload.context?.container?.text (legacy DOM-based detection)
      // 3. DO NOT USE semanticAnchors.textLabel (that's the element's OWN text!)
      let recordedScopeHint: string | undefined;
      
      if (payload.scope) {
        switch (payload.scope.kind) {
          case 'WIDGET':
            recordedScopeHint = (payload.scope as any).title;
            break;
          case 'NEAREST_SECTION':
            recordedScopeHint = (payload.scope as any).headingText;
            break;
          case 'TABLE_ROW':
            recordedScopeHint = (payload.scope as any).anchorText;
            break;
          case 'MODAL':
            // Modal scope doesn't need a specific hint (modal detection is automatic)
            recordedScopeHint = undefined;
            break;
          default:
            recordedScopeHint = undefined;
        }
      }
      
      // Fallback: legacy container.text
      if (!recordedScopeHint) {
        recordedScopeHint = payload.context?.container?.text;
      }
      
      // DO NOT use aiEvidence.semanticAnchors.textLabel as fallback!
      // That's the element's own text, not the container!
      
      // AI widget context available for future use when it's more reliable
      const aiWidgetTitle = payload.aiWidgetContext?.widgetTitle;
      const aiWidgetConfidence = payload.aiWidgetContext?.confidence || 0;
      
      if (recordedScopeHint) {
        console.log(`[AIAgent] 📍 Using DOM-detected scope: "${recordedScopeHint}"`);
        if (aiWidgetTitle && aiWidgetTitle !== recordedScopeHint) {
          console.log(`[AIAgent] ℹ️ AI suggested "${aiWidgetTitle}" (confidence: ${aiWidgetConfidence.toFixed(2)}) but using DOM result`);
        }
      }
      
      // Extract row key if element was in a table
      const recordedRowKey = payload.context?.gridCoordinates?.rowHeader || 
                            payload.context?.gridCoordinates?.cellReference;
      
      // Extract nearby anchor text for disambiguation
      const nearbyText = payload.aiEvidence?.semanticAnchors?.nearbyText || 
                        payload.context?.siblings?.before || 
                        [];

      // Extract natural language context if available (from workflow-translator)
      const stepWithNL = step as any;
      const naturalLanguage = stepWithNL.naturalLanguage ? {
        intent: stepWithNL.naturalLanguage.intent,
        precondition: stepWithNL.naturalLanguage.precondition,
        expectedOutcome: stepWithNL.naturalLanguage.expectedOutcome,
        dependencies: stepWithNL.naturalLanguage.dependencies || [],
      } : undefined;
      
      // Extract scroll amount for SCROLL actions
      let scrollAmount: number | undefined = undefined;
      let scrollDirection: 'up' | 'down' | 'left' | 'right' | undefined = undefined;
      let scrollContainer: string | undefined = undefined;
      if (step.type === 'SCROLL') {
        // Extract scroll container selector (critical for apps like Gainsight!)
        // ALWAYS extract this, even if scroll amount is unknown
        scrollContainer = (payload as any).elementScrollContainer?.selector ||
                         (payload as any).scrollContainer?.selector;
        
        // Get viewport info which contains scroll delta
        const viewport = payload.viewport;
        const elementScrollContainer = viewport?.elementScrollContainer;
        
        // Debug: Show FULL payload to see what we're working with
        console.log(`[AIAgent] 📜 SCROLL step payload:`, JSON.stringify({
          viewport: viewport ? {
            scrollDeltaX: viewport.scrollDeltaX,
            scrollDeltaY: viewport.scrollDeltaY,
            scrollX: viewport.scrollX,
            scrollY: viewport.scrollY,
            elementScrollContainer,
          } : null,
          // Legacy fields
          deltaY: (payload as any).deltaY,
          scrollAmount: (payload as any).scrollAmount,
        }, null, 2));
        
        // 🎯 NEW: Extract scroll delta from viewport (recorded by new scroll capture)
        // Priority: viewport.scrollDeltaY > container.scrollDeltaY > legacy deltaY > legacy scrollAmount
        let scrollDelta: number | undefined = undefined;
        
        // Check container scroll delta first (for container scrolls)
        if (elementScrollContainer?.scrollDeltaY !== undefined) {
          scrollDelta = elementScrollContainer.scrollDeltaY;
          console.log(`[AIAgent] ✅ Found container scrollDeltaY: ${scrollDelta}px`);
        }
        // Check viewport scroll delta (for window scrolls)
        else if (viewport?.scrollDeltaY !== undefined) {
          scrollDelta = viewport.scrollDeltaY;
          console.log(`[AIAgent] ✅ Found viewport scrollDeltaY: ${scrollDelta}px`);
        }
        // Legacy: check old deltaY field
        else if ((payload as any).deltaY !== undefined) {
          scrollDelta = (payload as any).deltaY;
          console.log(`[AIAgent] ✅ Found legacy deltaY: ${scrollDelta}px`);
        }
        // Legacy: check scrollAmount field
        else if ((payload as any).scrollAmount !== undefined) {
          scrollDelta = (payload as any).scrollAmount;
          console.log(`[AIAgent] ✅ Found legacy scrollAmount: ${scrollDelta}px`);
        }
        
        // If we have a delta, use it
        if (typeof scrollDelta === 'number' && scrollDelta !== 0) {
          scrollAmount = Math.abs(Math.round(scrollDelta));
          scrollDirection = scrollDelta > 0 ? 'down' : 'up';
          console.log(`[AIAgent] ✅ Using scroll delta: ${scrollAmount}px ${scrollDirection} in "${scrollContainer || 'window'}"`);
        } else {
          // Fallback: use a reasonable default scroll amount
          console.log(`[AIAgent] ⚠️ No scroll delta in payload, using default 400px in "${scrollContainer || 'window'}"`);
          const desc = description.toLowerCase();
          scrollDirection = desc.includes('up') ? 'up' : 
                           desc.includes('left') ? 'left' :
                           desc.includes('right') ? 'right' : 'down';
          scrollAmount = 400; // Reasonable default for scrolling in dashboards
        }
        
        // CRITICAL: Always log the scroll container so we can debug
        if (scrollContainer) {
          console.log(`[AIAgent] ✅ Found scroll container: "${scrollContainer}"`);
        } else {
          console.warn('[AIAgent] ⚠️ No scroll container recorded - will scroll window');
        }
      }

      return {
        stepNumber: index + 1,
        description,
        actionType,
        // For NAVIGATION steps, prefer originalElementText if we found it
        targetText: (step.type === 'NAVIGATION' && originalElementText) ? originalElementText : payload.elementText,
        targetRole: payload.elementRole,
        targetPlaceholder: placeholder,
        targetSelector: payload.selector,
        value,
        completed: false,
        referenceScreenshot: payload.visualSnapshot?.annotated || payload.visualSnapshot?.viewport,
        clickPoint: payload.visualSnapshot?.clickPoint,
        
        // New fields for candidate matching
        recordedSelector,
        recordedFallbackSelectors: recordedFallbackSelectors.length > 0 ? recordedFallbackSelectors : undefined,
        recordedTestId,
        recordedAriaLabel,
        recordedScopeHint,
        recordedRowKey,
        nearbyText: nearbyText.length > 0 ? nearbyText : undefined,
        
        // For SCROLL actions
        scrollAmount,
        scrollDirection,
        scrollContainer,
        
        // Natural language context
        naturalLanguage,
        
        // Iframe context - for cross-frame execution
        iframeContext: payload.iframeContext,
      };
    });
  }

  /**
   * Check if the current hint's expected outcome is already satisfied
   * Returns a skip reason if satisfied, null otherwise
   */
  private checkIfOutcomeAlreadySatisfied(
    hint: AgentHint,
    observation: AgentObservation
  ): string | null {
    if (!hint.naturalLanguage?.expectedOutcome) {
      return null;
    }
    
    const outcome = hint.naturalLanguage.expectedOutcome.toLowerCase();
    
    // Parse the observation's domMapText to check current state
    const domMapText = observation.domMapText.toLowerCase();
    
    // Check if dropdown-related outcome is satisfied
    // BUT: Don't skip if this is an OPTION CLICK (selecting from an open dropdown)
    if ((outcome.includes('dropdown') || outcome.includes('menu')) && 
        (outcome.includes('open') || outcome.includes('appear') || outcome.includes('show'))) {
      // If the hint is clicking an option/menuitem role, DON'T skip even if dropdown is open
      // because we need to SELECT from the dropdown, not just open it
      const isOptionClick = hint.targetRole === 'option' || hint.targetRole === 'menuitem' || 
                           hint.actionType === 'click' && (hint.targetText || '').length > 0;
      
      if (!isOptionClick && (domMapText.includes('dropdown is open') || domMapText.includes('active dropdown'))) {
        return 'Dropdown is already open';
      }
    }
    
    // Check if modal-related outcome is satisfied
    if ((outcome.includes('modal') || outcome.includes('dialog') || outcome.includes('popup') || outcome.includes('form')) && 
        (outcome.includes('open') || outcome.includes('appear') || outcome.includes('show'))) {
      if (domMapText.includes('modal is open') || domMapText.includes('active modal')) {
        return 'Modal/dialog is already open';
      }
    }
    
    // Check if field value is already set
    if (hint.actionType === 'type' && hint.value) {
      // Look for the field in the DOM map text
      const targetText = (hint.targetText || hint.targetPlaceholder || '').toLowerCase();
      if (targetText) {
        // Regex to find the field and its current value
        const fieldPattern = new RegExp(`\\[(?:textbox|spinbutton)\\][^\\n]*(?:${targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[^\\n]*value\\s*=\\s*["']?${hint.value}["']?`, 'i');
        if (fieldPattern.test(observation.domMapText)) {
          return `Field already has value "${hint.value}"`;
        }
      }
    }
    
    return null;
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton for easy access
export const aiAgent = new AIAgent();

