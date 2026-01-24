/**
 * Vision Agent
 *
 * The main execution loop that orchestrates Eyes, Brain, and Hands.
 * Implements the OTAR loop: Observe-Think-Act-Reflect
 */

import type {
  ScreenUnderstanding,
  Decision,
  ActionRecord,
  AgentProgress,
  AgentResult,
  AgentStatus,
  ActionResult,
  Point,
} from '../types';

import type { SavedWorkflow } from '../../../types/workflow';

// Eyes
import {
  captureScreenshot,
  captureScreenshotCDP,
  analyzeScreen,
  findElement,
  getClickCoordinates,
  createBasicScreenUnderstanding,
} from '../eyes';

// Brain
import {
  decideNextAction,
  decideNextActionWithContext,
  isPhaseComplete,
  isPhaseCompleteWithContext,
  isTaskComplete,
  isTaskCompleteWithContext,
  detectStuckState,
  getRecoverySuggestions,
  getRecoverySuggestionsWithContext,
  waitAndVerify,
} from '../brain';
import type { SemanticTaskModel } from '../brain';

// Adapters
import {
  createVisionExecutionContext,
  getPhaseCount,
  hasRichMemory,
  summarizeContext,
} from '../adapters';

// Hands
import {
  attachDebugger,
  detachDebugger,
  mouseClick,
  mouseDoubleClick,
  mouseRightClick,
  typeText,
  clearAndType,
  pressKey,
  pressHotkey,
  scrollDown,
  scrollUp,
  mouseHover,
} from '../hands';

/**
 * Agent configuration
 */
export interface VisionAgentConfig {
  /** Maximum actions before stopping */
  maxActions: number;

  /** Timeout for entire task in ms */
  taskTimeout: number;

  /** Delay between actions in ms */
  actionDelay: number;

  /** Whether to pause on errors */
  pauseOnError: boolean;

  /** Callback for progress updates */
  onProgress?: (progress: AgentProgress) => void;

  /** Callback for each action */
  onAction?: (action: ActionRecord) => void;

  /** Whether to capture screenshots for history */
  captureHistory: boolean;
}

const DEFAULT_CONFIG: VisionAgentConfig = {
  maxActions: 50,
  taskTimeout: 300000, // 5 minutes
  actionDelay: 500,
  pauseOnError: false,
  captureHistory: true,
};

/**
 * Vision Agent class
 */
export class VisionAgent {
  private config: VisionAgentConfig;
  private status: AgentStatus = 'idle';
  private history: ActionRecord[] = [];
  private startTime: number = 0;
  private actionsExecuted: number = 0;
  private currentPhaseIndex: number = 0;
  private isPaused: boolean = false;
  private shouldStop: boolean = false;
  private tabId: number = 0; // Store tabId for screenshot capture

  constructor(config: Partial<VisionAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a task
   */
  async execute(
    tabId: number,
    taskModel: SemanticTaskModel,
    variables: Record<string, string>
  ): Promise<AgentResult> {
    this.tabId = tabId; // Store tabId for screenshot capture
    this.history = [];
    this.startTime = Date.now();
    this.actionsExecuted = 0;
    this.currentPhaseIndex = 0;
    this.isPaused = false;
    this.shouldStop = false;
    this.status = 'running';

    try {
      // Attach debugger for CDP access
      await attachDebugger(tabId);

      // Run the OTAR loop
      const result = await this.runOTARLoop(taskModel, variables);

      return result;
    } catch (error) {
      this.status = 'failed';
      return this.createFailedResult(error);
    } finally {
      // Clean up
      await this.cleanup();
    }
  }

  /**
   * Main OTAR loop: Observe-Think-Act-Reflect
   */
  private async runOTARLoop(
    taskModel: SemanticTaskModel,
    variables: Record<string, string>
  ): Promise<AgentResult> {
    while (!this.shouldStop) {
      // Check limits
      if (this.actionsExecuted >= this.config.maxActions) {
        this.status = 'failed';
        return this.createResult(false, 'Maximum actions reached');
      }

      if (Date.now() - this.startTime > this.config.taskTimeout) {
        this.status = 'failed';
        return this.createResult(false, 'Task timeout');
      }

      // Handle pause
      if (this.isPaused) {
        this.status = 'paused';
        await this.waitForResume();
        this.status = 'running';
      }

      try {
        // === OBSERVE ===
        this.updateProgress('Observing screen...');
        const screenshot = await captureScreenshot();
        let screenState: ScreenUnderstanding;

        try {
          screenState = await analyzeScreen(screenshot);
        } catch {
          // Fallback to basic understanding
          screenState = createBasicScreenUnderstanding(screenshot);
        }

        // === CHECK COMPLETION ===
        const currentPhase = taskModel.phases[this.currentPhaseIndex];

        // Check if current phase is complete
        const phaseCheck = await isPhaseComplete(screenshot, screenState, currentPhase);
        if (phaseCheck.complete && phaseCheck.confidence > 0.7) {
          this.currentPhaseIndex++;

          // Check if all phases complete
          if (this.currentPhaseIndex >= taskModel.phases.length) {
            // Verify task completion
            const taskCheck = await isTaskComplete(screenshot, screenState, taskModel);
            if (taskCheck.complete && taskCheck.confidence > 0.6) {
              this.status = 'completed';
              return this.createResult(true, 'Task completed successfully');
            }
          }

          // Continue to next phase
          continue;
        }

        // === THINK ===
        this.updateProgress(`Thinking... (Phase: ${currentPhase.name})`);
        const decision = await decideNextAction(
          screenshot,
          screenState,
          taskModel,
          this.currentPhaseIndex,
          variables,
          this.history
        );

        // Check for stuck state
        if (decision.action.type === 'stuck' || decision.confidence < 0.2) {
          const stuckState = detectStuckState(this.history);
          if (stuckState.isStuck) {
            const recovery = await getRecoverySuggestions(
              screenshot,
              screenState,
              taskModel,
              this.history,
              stuckState.reason || 'Unknown'
            );

            this.status = 'stuck';
            return this.createResult(
              false,
              `Stuck: ${stuckState.reason}`,
              recovery.suggestions.join(', ')
            );
          }
        }

        // Check if done
        if (decision.action.type === 'done') {
          this.status = 'completed';
          return this.createResult(true, 'Agent determined task is complete');
        }

        // === ACT ===
        this.updateProgress(`Acting: ${decision.reasoning}`);
        const beforeScreenshot = screenshot;

        // Find target element if needed
        let coordinates: Point | null = null;
        if (decision.action.targetDescription) {
          const location = await findElement(screenshot, decision.action.targetDescription);
          if (!location.found) {
            // Can't find target - record failure and continue
            this.recordAction(
              decision,
              null,
              { success: false, error: 'Target not found', durationMs: 0 },
              screenState,
              screenState,
              {
                success: false,
                confidence: 0.9,
                explanation: `Could not find: ${decision.action.targetDescription}`,
                stateChanged: false,
                progressMade: false,
                goalAchieved: false,
              }
            );
            continue;
          }
          coordinates = getClickCoordinates(location);
        }

        // Execute the action
        const actionResult = await this.executeAction(decision, coordinates);

        // === REFLECT ===
        this.updateProgress('Verifying action...');
        await this.delay(this.config.actionDelay);

        const verification = await waitAndVerify(
          captureScreenshot,
          decision.action,
          decision.expectedOutcome,
          beforeScreenshot,
          2,
          300
        );

        // Capture after state
        const afterScreenshot = await captureScreenshot();
        let afterState: ScreenUnderstanding;
        try {
          afterState = await analyzeScreen(afterScreenshot);
        } catch {
          afterState = createBasicScreenUnderstanding(afterScreenshot);
        }

        // Record the action
        this.recordAction(
          decision,
          coordinates ? { found: true, boundingBox: { x: coordinates.x, y: coordinates.y, width: 10, height: 10, centerX: coordinates.x, centerY: coordinates.y }, confidence: 0.8, description: decision.action.targetDescription || '' } : null,
          actionResult,
          screenState,
          afterState,
          verification
        );

        this.actionsExecuted++;

        // Check if action failed
        if (!verification.success && this.config.pauseOnError) {
          this.isPaused = true;
        }

        // Check if goal achieved
        if (verification.goalAchieved) {
          this.status = 'completed';
          return this.createResult(true, 'Goal achieved');
        }

      } catch (error) {
        console.error('OTAR loop error:', error);
        // Continue trying unless it's a critical error
        if (this.actionsExecuted === 0) {
          throw error; // Critical startup error
        }
      }
    }

    // Stopped by user
    this.status = 'paused';
    return this.createResult(false, 'Execution stopped by user');
  }

  /**
   * Execute a single action via CDP
   */
  private async executeAction(
    decision: Decision,
    coordinates: Point | null
  ): Promise<ActionResult> {
    const startTime = Date.now();

    try {
      switch (decision.action.type) {
        case 'click':
          if (!coordinates) throw new Error('No coordinates for click');
          await mouseClick(coordinates.x, coordinates.y);
          break;

        case 'double-click':
          if (!coordinates) throw new Error('No coordinates for double-click');
          await mouseDoubleClick(coordinates.x, coordinates.y);
          break;

        case 'right-click':
          if (!coordinates) throw new Error('No coordinates for right-click');
          await mouseRightClick(coordinates.x, coordinates.y);
          break;

        case 'type':
          if (!decision.action.value) throw new Error('No value to type');
          // Click to focus the element first if coordinates provided
          if (coordinates) {
            console.log(`[VisionAgent] Clicking to focus before typing at (${coordinates.x}, ${coordinates.y})`);
            await mouseClick(coordinates.x, coordinates.y);
            await this.delay(100); // Brief delay to ensure focus
          }
          console.log(`[VisionAgent] Typing: "${decision.action.value}"`);
          await typeText(decision.action.value);
          break;

        case 'clear-and-type':
          if (!decision.action.value) throw new Error('No value to type');
          // Click to focus the element first if coordinates provided
          if (coordinates) {
            console.log(`[VisionAgent] Clicking to focus before clear-and-type at (${coordinates.x}, ${coordinates.y})`);
            await mouseClick(coordinates.x, coordinates.y);
            await this.delay(100); // Brief delay to ensure focus
          }
          console.log(`[VisionAgent] Clear and typing: "${decision.action.value}"`);
          await clearAndType(decision.action.value);
          break;

        case 'press-key':
          if (!decision.action.key) throw new Error('No key to press');
          await pressKey(decision.action.key);
          break;

        case 'hotkey':
          if (!decision.action.keys) throw new Error('No keys for hotkey');
          await pressHotkey(decision.action.keys);
          break;

        case 'scroll-down':
          await scrollDown(decision.action.scrollAmount || 300);
          break;

        case 'scroll-up':
          await scrollUp(decision.action.scrollAmount || 300);
          break;

        case 'hover':
          if (!coordinates) throw new Error('No coordinates for hover');
          await mouseHover(coordinates.x, coordinates.y);
          break;

        case 'drag':
          // Drag requires start and end coordinates
          // For now, just log that we can't do this without more info
          throw new Error('Drag action requires additional implementation');

        case 'wait':
          await this.delay(decision.action.waitMs || 1000);
          break;

        case 'verify':
        case 'done':
        case 'stuck':
          // These are not actual actions
          break;

        default:
          throw new Error(`Unknown action type: ${decision.action.type}`);
      }

      return {
        success: true,
        durationMs: Date.now() - startTime,
        coordinates: coordinates || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
        coordinates: coordinates || undefined,
      };
    }
  }

  /**
   * Record an action in history
   */
  private recordAction(
    decision: Decision,
    targetLocation: { found: boolean; boundingBox?: { x: number; y: number; width: number; height: number; centerX: number; centerY: number }; confidence: number; description: string } | null,
    result: ActionResult,
    beforeState: ScreenUnderstanding,
    afterState: ScreenUnderstanding,
    verification: { success: boolean; confidence: number; explanation: string; stateChanged: boolean; progressMade: boolean; goalAchieved: boolean; newErrors?: string[]; successIndicators?: string[] }
  ): void {
    const record: ActionRecord = {
      timestamp: Date.now(),
      decision,
      targetLocation: targetLocation || undefined,
      result,
      beforeState,
      afterState,
      verification,
    };

    this.history.push(record);

    if (this.config.onAction) {
      this.config.onAction(record);
    }
  }

  /**
   * Update progress
   */
  private updateProgress(currentAction: string): void {
    if (this.config.onProgress) {
      this.config.onProgress({
        status: this.status,
        actionsExecuted: this.actionsExecuted,
        currentPhase: `Phase ${this.currentPhaseIndex + 1}`,
        percentComplete: Math.min(
          100,
          Math.round((this.actionsExecuted / this.config.maxActions) * 100)
        ),
        currentAction,
        lastReasoning: this.history[this.history.length - 1]?.decision.reasoning,
        elapsedMs: Date.now() - this.startTime,
      });
    }
  }

  /**
   * Create result object
   */
  private createResult(
    success: boolean,
    message: string,
    helpNeeded?: string
  ): AgentResult {
    return {
      success,
      goalAchieved: success,
      actionsExecuted: this.actionsExecuted,
      durationMs: Date.now() - this.startTime,
      history: this.history,
      finalState:
        this.history[this.history.length - 1]?.afterState ||
        createBasicScreenUnderstanding({
          data: '',
          timestamp: Date.now(),
          viewport: { width: 1920, height: 1080 },
          url: '',
          title: '',
          format: 'png',
        }),
      error: success ? undefined : message,
      helpNeeded,
    };
  }

  /**
   * Create failed result from error
   */
  private createFailedResult(error: unknown): AgentResult {
    return this.createResult(
      false,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      await detachDebugger();
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Pause execution
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume execution
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.shouldStop = true;
    this.isPaused = false;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get action history
   */
  getHistory(): ActionRecord[] {
    return [...this.history];
  }

  /**
   * Execute a task using a SavedWorkflow (RICH CONTEXT)
   *
   * This is the preferred method for execution.
   * It extracts all intelligence from WorkflowMemory and passes it to the AI.
   */
  async executeWithWorkflow(
    tabId: number,
    workflow: SavedWorkflow,
    variables: Record<string, string>
  ): Promise<AgentResult> {
    console.log('[VisionAgent] executeWithWorkflow called with tabId:', tabId);
    this.tabId = tabId; // Store tabId for screenshot capture
    this.history = [];
    this.startTime = Date.now();
    this.actionsExecuted = 0;
    this.currentPhaseIndex = 0;
    this.isPaused = false;
    this.shouldStop = false;
    this.status = 'running';

    try {
      // Attach debugger for CDP access
      console.log('[VisionAgent] Attaching debugger to tab:', tabId);
      await attachDebugger(tabId);
      console.log('[VisionAgent] Debugger attached successfully');

      // Check if workflow has rich memory
      if (hasRichMemory(workflow)) {
        console.log('[VisionAgent] Using rich context execution');
        const totalPhases = getPhaseCount(workflow);
        console.log(`[VisionAgent] Task: ${workflow.name}, Phases: ${totalPhases}`);

        // Run the OTAR loop with rich context
        return await this.runOTARLoopWithContext(workflow, variables);
      } else {
        console.log('[VisionAgent] No rich memory, falling back to basic execution');
        // Fall back to basic execution by creating a minimal task model
        const taskModel = this.createBasicTaskModel(workflow);
        return await this.runOTARLoop(taskModel, variables);
      }
    } catch (error) {
      this.status = 'failed';
      return this.createFailedResult(error);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * OTAR loop with rich VisionExecutionContext
   */
  private async runOTARLoopWithContext(
    workflow: SavedWorkflow,
    variables: Record<string, string>
  ): Promise<AgentResult> {
    const totalPhases = getPhaseCount(workflow);

    while (!this.shouldStop) {
      // Check limits
      if (this.actionsExecuted >= this.config.maxActions) {
        this.status = 'failed';
        return this.createResult(false, 'Maximum actions reached');
      }

      if (Date.now() - this.startTime > this.config.taskTimeout) {
        this.status = 'failed';
        return this.createResult(false, 'Task timeout');
      }

      // Handle pause
      if (this.isPaused) {
        this.status = 'paused';
        await this.waitForResume();
        this.status = 'running';
      }

      try {
        // Create rich execution context for current phase
        const executionContext = createVisionExecutionContext(
          workflow,
          this.currentPhaseIndex,
          variables,
          this.history
        );

        console.log('[VisionAgent] Context:', summarizeContext(executionContext));

        // === OBSERVE ===
        this.updateProgress('Observing screen...');
        console.log('[VisionAgent] Capturing screenshot via CDP for tab:', this.tabId);
        const screenshot = await captureScreenshotCDP(this.tabId);
        console.log('[VisionAgent] Screenshot captured');

        // Skip expensive screen analysis - use basic understanding for speed
        // We have rich step guidance so we don't need full AI analysis
        const screenState = createBasicScreenUnderstanding(screenshot);

        // === CHECK COMPLETION ===
        // Only check phase completion every few actions to reduce API calls
        const shouldCheckCompletion = this.actionsExecuted > 0 && this.actionsExecuted % 3 === 0;

        if (shouldCheckCompletion) {
          console.log('[VisionAgent] Checking phase completion (periodic check)...');
          try {
            const phaseCheck = await isPhaseCompleteWithContext(
              screenshot,
              screenState,
              executionContext
            );

            if (phaseCheck.complete && phaseCheck.confidence > 0.7) {
              console.log(`[VisionAgent] Phase ${this.currentPhaseIndex + 1} complete: ${phaseCheck.reason}`);
              this.currentPhaseIndex++;

              // Check if all phases complete
              if (this.currentPhaseIndex >= totalPhases) {
                // Verify task completion
                try {
                  const taskCheck = await isTaskCompleteWithContext(
                    screenshot,
                    screenState,
                    executionContext
                  );

                  if (taskCheck.complete && taskCheck.confidence > 0.6) {
                    this.status = 'completed';
                    return this.createResult(true, 'Task completed successfully');
                  }
                } catch (taskCheckError) {
                  console.error('[VisionAgent] Task completion check failed:', taskCheckError);
                  // Assume task is complete if all phases are done and check fails
                  this.status = 'completed';
                  return this.createResult(true, 'Task completed (phases done)');
                }
              }

              // Continue to next phase
              continue;
            }
          } catch (phaseCheckError) {
            console.error('[VisionAgent] Phase completion check failed:', phaseCheckError);
            // Skip phase check and continue with actions
            console.log('[VisionAgent] Skipping phase check, continuing with actions...');
          }
        }

        // === THINK ===
        const phaseName = executionContext.currentPhase.name;
        this.updateProgress(`Thinking... (Phase: ${phaseName})`);

        let decision;
        try {
          decision = await decideNextActionWithContext(
            screenshot,
            screenState,
            executionContext
          );
          console.log(`[VisionAgent] Decision: ${decision.action.type} - ${decision.reasoning}`);
        } catch (thinkError) {
          console.error('[VisionAgent] Decision API call failed:', thinkError);
          // On timeout/error, try to continue with a wait action
          if (this.actionsExecuted > 0) {
            console.log('[VisionAgent] Retrying after brief wait...');
            await this.delay(2000); // Wait 2 seconds before retrying
            continue; // Retry the loop
          }
          throw thinkError; // Rethrow if it's the first action
        }

        // Check for stuck state
        if (decision.action.type === 'stuck' || decision.confidence < 0.2) {
          const stuckState = detectStuckState(this.history);
          if (stuckState.isStuck) {
            const recovery = await getRecoverySuggestionsWithContext(
              screenshot,
              screenState,
              executionContext,
              stuckState.reason || 'Unknown'
            );

            this.status = 'stuck';
            return this.createResult(
              false,
              `Stuck: ${stuckState.reason}`,
              recovery.suggestions.join(', ')
            );
          }
        }

        // Check if done
        if (decision.action.type === 'done') {
          this.status = 'completed';
          return this.createResult(true, 'Agent determined task is complete');
        }

        // === ACT ===
        this.updateProgress(`Acting: ${decision.reasoning}`);

        // Find target element if needed
        let coordinates: Point | null = null;
        if (decision.action.targetDescription) {
          console.log(`[VisionAgent] Finding element: "${decision.action.targetDescription}"`);
          const location = await findElement(screenshot, decision.action.targetDescription);
          console.log(`[VisionAgent] Element location:`, JSON.stringify({
            found: location.found,
            boundingBox: location.boundingBox,
            confidence: location.confidence
          }));
          if (!location.found) {
            console.log(`[VisionAgent] Element NOT found, recording failure`);
            // Can't find target - record failure and continue
            this.recordAction(
              decision,
              null,
              { success: false, error: 'Target not found', durationMs: 0 },
              screenState,
              screenState,
              {
                success: false,
                confidence: 0.9,
                explanation: `Could not find: ${decision.action.targetDescription}`,
                stateChanged: false,
                progressMade: false,
                goalAchieved: false,
              }
            );
            continue;
          }
          coordinates = getClickCoordinates(location);
          console.log(`[VisionAgent] Click coordinates: x=${coordinates?.x}, y=${coordinates?.y}`);
        }

        // Execute the action
        console.log(`[VisionAgent] Executing action: ${decision.action.type} at (${coordinates?.x}, ${coordinates?.y})`);
        const actionResult = await this.executeAction(decision, coordinates);
        console.log(`[VisionAgent] Action result: success=${actionResult.success}, error=${actionResult.error || 'none'}`);

        // === REFLECT ===
        // Use fast local verification instead of API calls for speed
        this.updateProgress('Verifying action...');
        await this.delay(this.config.actionDelay);

        // Capture after state
        const afterScreenshot = await captureScreenshotCDP(this.tabId);
        const afterState = createBasicScreenUnderstanding(afterScreenshot);

        // Use local verification (no API call) - assume action succeeded if no error
        // This is much faster than calling the vision API
        const verification = {
          success: actionResult.success,
          confidence: actionResult.success ? 0.7 : 0.3,
          explanation: actionResult.success
            ? `${decision.action.type} executed at (${coordinates?.x}, ${coordinates?.y})`
            : actionResult.error || 'Action failed',
          stateChanged: true, // Assume state changed
          progressMade: actionResult.success,
          goalAchieved: false, // Can't determine locally
        };
        console.log(`[VisionAgent] Local verification: ${verification.success ? 'OK' : 'FAIL'}`)

        // Record the action
        this.recordAction(
          decision,
          coordinates
            ? {
                found: true,
                boundingBox: {
                  x: coordinates.x,
                  y: coordinates.y,
                  width: 10,
                  height: 10,
                  centerX: coordinates.x,
                  centerY: coordinates.y,
                },
                confidence: 0.8,
                description: decision.action.targetDescription || '',
              }
            : null,
          actionResult,
          screenState,
          afterState,
          verification
        );

        this.actionsExecuted++;

        // Check if action failed
        if (!verification.success && this.config.pauseOnError) {
          this.isPaused = true;
        }

        // Check if goal achieved
        if (verification.goalAchieved) {
          this.status = 'completed';
          return this.createResult(true, 'Goal achieved');
        }
      } catch (error) {
        console.error('[VisionAgent] OTAR loop error:', error);
        if (this.actionsExecuted === 0) {
          throw error;
        }
      }
    }

    // Stopped by user
    this.status = 'paused';
    return this.createResult(false, 'Execution stopped by user');
  }

  /**
   * Create a basic task model from workflow (fallback)
   */
  private createBasicTaskModel(workflow: SavedWorkflow): SemanticTaskModel {
    return {
      name: workflow.name,
      description: workflow.description || '',
      phases: [
        {
          name: 'Execute',
          description: workflow.description || 'Execute the workflow',
          intent: workflow.inferredIntent?.primaryGoal || 'Complete the task',
        },
      ],
      variables: Object.keys(workflow.variables || {}).map((key) => ({
        name: key,
        fieldContext: key,
      })),
    };
  }

  /**
   * Wait for resume when paused
   */
  private async waitForResume(): Promise<void> {
    while (this.isPaused && !this.shouldStop) {
      await this.delay(100);
    }
  }

  /**
   * Utility delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create and run a vision agent
 */
export async function runVisionAgent(
  tabId: number,
  taskModel: SemanticTaskModel,
  variables: Record<string, string>,
  config?: Partial<VisionAgentConfig>
): Promise<AgentResult> {
  const agent = new VisionAgent(config);
  return agent.execute(tabId, taskModel, variables);
}
