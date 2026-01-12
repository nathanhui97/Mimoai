/**
 * StuckDetector - Isolated module for detecting when the AI agent is stuck
 * 
 * Handles:
 * - Tracking retry attempts per step
 * - Enforcing delays between retries
 * - Triggering stuck callback after max failures
 */

export interface StuckContext {
  stepIndex: number;
  stepDescription: string;
  attemptsMade: number;
  lastError: string;
  whatAgentTried: string[];
}

export interface StuckDetectorConfig {
  maxAttempts: number;        // default: 3
  delayBetweenAttempts: number; // default: 1500ms (1.5s)
  onStuck: (context: StuckContext) => void;
}

interface StepAttemptState {
  stepIndex: number;
  attempts: number;
  errors: string[];
  lastAttemptTime: number;
}

/**
 * StuckDetector - Manages retry logic and stuck detection
 */
export class StuckDetector {
  private config: StuckDetectorConfig;
  private currentStepState: StepAttemptState | null = null;

  constructor(config: Partial<StuckDetectorConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      delayBetweenAttempts: config.delayBetweenAttempts ?? 1500,
      onStuck: config.onStuck ?? (() => {}),
    };
  }

  /**
   * Record a failed attempt for a step
   * Returns true if we should pause for human help, false if should retry
   */
  async recordFailure(
    stepIndex: number,
    stepDescription: string,
    error: string
  ): Promise<boolean> {
    // If this is a new step, reset state
    if (!this.currentStepState || this.currentStepState.stepIndex !== stepIndex) {
      this.currentStepState = {
        stepIndex,
        attempts: 0,
        errors: [],
        lastAttemptTime: 0,
      };
    }

    // Increment attempt count
    this.currentStepState.attempts++;
    this.currentStepState.errors.push(error);
    this.currentStepState.lastAttemptTime = Date.now();

    console.log(`[StuckDetector] Step ${stepIndex} failed (attempt ${this.currentStepState.attempts}/${this.config.maxAttempts})`);

    // Check if we've hit max attempts
    if (this.currentStepState.attempts >= this.config.maxAttempts) {
      console.warn(`[StuckDetector] 🚨 Agent stuck on step ${stepIndex} after ${this.currentStepState.attempts} attempts`);
      
      // Build context for human help
      const context: StuckContext = {
        stepIndex,
        stepDescription,
        attemptsMade: this.currentStepState.attempts,
        lastError: error,
        whatAgentTried: this.formatAttemptHistory(),
      };

      // Trigger stuck callback
      this.config.onStuck(context);
      
      // Reset state for this step (in case user retries)
      this.reset();
      
      return true; // Signal: pause for human help
    }

    // Wait before next retry
    console.log(`[StuckDetector] ⏳ Waiting ${this.config.delayBetweenAttempts}ms before retry...`);
    await this.sleep(this.config.delayBetweenAttempts);

    return false; // Signal: retry
  }

  /**
   * Record a successful step execution
   */
  recordSuccess(stepIndex: number): void {
    // Reset state when step succeeds
    if (this.currentStepState?.stepIndex === stepIndex) {
      console.log(`[StuckDetector] ✅ Step ${stepIndex} succeeded after ${this.currentStepState.attempts} attempt(s)`);
      this.reset();
    }
  }

  /**
   * Reset the current step state
   */
  reset(): void {
    this.currentStepState = null;
  }

  /**
   * Format attempt history for human-readable display
   */
  private formatAttemptHistory(): string[] {
    if (!this.currentStepState) {
      return [];
    }

    return this.currentStepState.errors.map((error, index) => {
      return `Attempt ${index + 1}: ${error}`;
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current attempt count for a step
   */
  getCurrentAttempts(stepIndex: number): number {
    if (this.currentStepState?.stepIndex === stepIndex) {
      return this.currentStepState.attempts;
    }
    return 0;
  }

  /**
   * Check if currently tracking a step
   */
  isTrackingStep(stepIndex: number): boolean {
    return this.currentStepState?.stepIndex === stepIndex;
  }
}
