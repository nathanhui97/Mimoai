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
import { VisionAssist } from './tier3-vision-assist';
import { RecoveryEngine } from '../content/recovery-engine';
import type { WorkflowStepPayload, SavedWorkflow } from '../types/workflow';

// ============================================================================
// Types
// ============================================================================

/** Actions the agent can take */
export type AgentActionType = 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'wait' | 'assert' | 'done' | 'fail' | 'skip';

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
  
  // For navigate
  url?: string;
  
  // For wait
  duration?: number;
  waitFor?: string;         // Text or element to wait for
  
  // For assert
  assertion?: string;       // What to check
  
  // For fail
  reason?: string;
  
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
  recordedTestId?: string;        // data-testid if captured
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
    
    // Move to next hint after navigation
    if (this.state.currentHintIndex < this.state.hints.length - 1) {
      this.state.currentHintIndex++;
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

        // 1.6 Handle SCROLL hints deterministically (bypass LLM)
        if (currentHint?.actionType === 'scroll') {
          console.log(`[AIAgent] 📜 Executing SCROLL hint deterministically`);
          
          // Create scroll action based on hint description
          // Extract direction from description (e.g., "Scroll down to the 'Continue' button")
          const description = currentHint.description.toLowerCase();
          const direction = description.includes('down') ? 'down' : 
                           description.includes('up') ? 'up' : 'down'; // Default down
          const amount = 300; // Standard scroll amount
          
          const scrollAction: AgentAction = {
            type: 'scroll',
            params: {
              direction,
              amount,
              description: currentHint.description,
            },
            reasoning: `Executing recorded scroll action: ${currentHint.description}`,
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
            await this.sleep(500); // Wait for scroll to complete
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
        
        // NOTE: NAVIGATION hints are now always converted to 'click' in extractHints()
        // This ensures the agent always clicks through the UI instead of navigating to URLs
        // which could be stale or point to wrong records (e.g., different account IDs)

        // 2. Think (use AI)
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
          // Continue loop without executing
          await this.sleep(200);
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
                // No more hints - might be done or stuck
                console.log(`[AIAgent] 📍 No more incomplete hints`);
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

        // Brief pause between actions
        await this.sleep(500);
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
    
    // Generate DOM map (fast, structured, cheap for LLM)
    const domMap = generateDOMMap();
    const domMapText = domMapToText(domMap);
    
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
      
      // Only include screenshot if VisionClicker is enabled
      screenshot: observation.screenshot,
    };

    try {
      console.log('[AIAgent] 🧠 Calling dom_agent Edge Function...');
      console.log('[AIAgent] 📤 Sending: currentHintIndex =', payload.currentHintIndex, ', nextIncomplete =', nextIncompleteHint?.stepNumber);
      console.log('[AIAgent] 📤 Hints status:', payload.hints.map((h: any, i: number) => `${i}:${h.completed?'✅':'⬜'}`).join(' '));
      console.log('[AIAgent] 📤 Candidates:', (payload as any).currentCandidates?.length || 0, 'sent to LLM');
      if ((payload as any).currentCandidates?.length > 0) {
        console.log('[AIAgent] 📤 Top 3 candidates:', (payload as any).currentCandidates.slice(0, 3).map((c: any) => `[${c.role}] "${c.name}" id="${c.id || 'none'}"`));
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
      
      // Build action with semantic target (not coordinates)
      const action: AgentAction = {
        type: result.action || 'fail',
        params: {
          // Semantic target for element identification
          target: result.target ? {
            role: result.target.role,
            name: result.target.name,
            text: result.target.text,
            testId: result.target.testId,
            id: result.target.id,
            placeholder: result.target.placeholder,
            scopeHint: result.target.scopeHint,
            nearbyText: result.target.nearbyText,
            index: result.target.index,
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
    
    for (let attempt = 1; attempt <= maxRecoveryAttempts; attempt++) {
      console.log(`[AIAgent] 🎯 Attempt ${attempt}/${maxRecoveryAttempts}`);
      
      // Tier 1: Execute with deterministic executor
      const result: Tier1ExecutionResult = await Tier1Executor.execute(currentAction);
      
      if (result.status === 'success') {
        console.log('[AIAgent] ✅ Action succeeded');
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
    
    const scored = allElements.map(el => ({
      ...el,
      score: this.computeCandidateScore(el, hint, expectedRole, dropdownIsOpen),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    // Take top 15 candidates (increased from 8 to give LLM more options)
    // Don't filter by score - let the LLM decide even if scores are low
    const topCandidates = scored.slice(0, 15);
    
    console.log(`[AIAgent] Found ${topCandidates.length} candidates, top 3 scores: [${topCandidates.slice(0, 3).map(c => c.score).join(', ')}]`);
    
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
    if (dropdownIsOpen && el.role === 'option') {
      score += 100; // Massive boost for dropdown options when dropdown is open!
      console.log(`[AIAgent] 🔽 Boosting dropdown option: "${el.text || el.name}" (+100 points)`);
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
      } else if (dropdownIsOpen && el.role === 'option') {
        // Don't penalize options when dropdown is open, even if hint expects button
        score += 0; // Neutral (already got +100 boost above)
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
    const steps = workflow.optimizedSteps || workflow.steps;
    
    return steps.map((step, index) => {
      const payload = step.payload as WorkflowStepPayload;
      
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
      
      if (value && variableValues) {
        // Replace {{varName}} with user-provided values
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
      if (step.type === 'NAVIGATION' && payload.elementText) {
        description = `Click on "${payload.elementText}"`;
        console.log(`[AIAgent] NAVIGATION hint: Using elementText "${payload.elementText}" instead of URL`);
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
      const recordedTestId = payload.context?.uniqueAttributes?.['data-testid'] || 
                            payload.context?.uniqueAttributes?.['data-test-id'];
      
      // Extract scope hint from context (e.g., widget/container title)
      const recordedScopeHint = payload.context?.container?.text || 
                               payload.aiEvidence?.semanticAnchors?.textLabel;
      
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

      return {
        stepNumber: index + 1,
        description,
        actionType,
        targetText: payload.elementText,
        targetRole: payload.elementRole,
        targetPlaceholder: placeholder,
        targetSelector: payload.selector,
        value,
        completed: false,
        referenceScreenshot: payload.visualSnapshot?.annotated || payload.visualSnapshot?.viewport,
        clickPoint: payload.visualSnapshot?.clickPoint,
        
        // New fields for candidate matching
        recordedSelector,
        recordedTestId,
        recordedScopeHint,
        recordedRowKey,
        nearbyText: nearbyText.length > 0 ? nearbyText : undefined,
        
        // Natural language context
        naturalLanguage,
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

