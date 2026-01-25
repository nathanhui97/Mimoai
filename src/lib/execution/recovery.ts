/**
 * Unified Recovery Module - Progressive Recovery Strategies
 *
 * This module provides a unified recovery interface for the ExecutionCoordinator,
 * combining multiple recovery strategies in a cascading approach:
 *
 * 1. Wait + Retry (0.5s, 1s, 2s exponential backoff)
 * 2. Scroll element into view
 * 3. Alternative selectors (from locator bundle)
 * 4. AI vision (only after 3 DOM failures)
 * 5. User disambiguation (last resort)
 *
 * The goal is to recover from 90%+ of failures without user intervention.
 */

import type { WorkflowStep } from '../../types/workflow';
import type { AgentAction, SemanticTarget } from '../ai-agent';
import type { RejectionCode, Tier1ExecutionResult } from '../tier1-executor';
import { isWorkflowStepPayload } from '../../types/workflow';

// ============================================================================
// Types
// ============================================================================

/** Recovery attempt context */
export interface RecoveryAttemptContext {
  /** The step being executed */
  step: WorkflowStep;
  /** The action that was attempted */
  action: AgentAction;
  /** The failure code from Tier1Executor */
  failureCode: RejectionCode;
  /** Number of previous recovery attempts */
  attemptCount: number;
  /** Failure details */
  failureDetails?: Tier1ExecutionResult['details'];
}

/** Recovery result */
export interface RecoveryResult {
  /** Whether recovery was successful */
  recovered: boolean;
  /** What recovery strategy worked */
  strategy?: RecoveryStrategy;
  /** Time taken for recovery */
  elapsedMs: number;
  /** Error message if recovery failed */
  error?: string;
  /** Whether to escalate to user */
  needsUserHelp?: boolean;
  /** User help context if needed */
  userHelpContext?: {
    stepDescription: string;
    whatWasTried: string[];
    suggestion: string;
  };
}

/** Recovery strategy types */
export type RecoveryStrategy =
  | 'wait_retry'
  | 'scroll_into_view'
  | 'alternative_selectors'
  | 'vision_fallback'
  | 'user_disambiguation';

/** Recovery options */
export interface RecoveryOptions {
  /** Maximum recovery attempts */
  maxAttempts?: number;
  /** Initial wait time in ms for backoff */
  initialWaitMs?: number;
  /** Maximum wait time in ms for backoff */
  maxWaitMs?: number;
  /** Enable vision fallback */
  enableVision?: boolean;
  /** Enable user disambiguation */
  enableUserHelp?: boolean;
  /** Callback for user help */
  onAskUser?: (context: RecoveryResult['userHelpContext']) => Promise<boolean>;
}

// ============================================================================
// Recovery Engine
// ============================================================================

export class UnifiedRecoveryEngine {
  private options: Required<Omit<RecoveryOptions, 'onAskUser'>> & Pick<RecoveryOptions, 'onAskUser'>;

  constructor(options: RecoveryOptions = {}) {
    this.options = {
      maxAttempts: options.maxAttempts ?? 5,
      initialWaitMs: options.initialWaitMs ?? 500,
      maxWaitMs: options.maxWaitMs ?? 3000,
      enableVision: options.enableVision ?? true,
      enableUserHelp: options.enableUserHelp ?? true,
      onAskUser: options.onAskUser,
    };
  }

  /**
   * Attempt recovery using cascading strategies
   */
  async recover(context: RecoveryAttemptContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    const strategies = this.getStrategiesForFailure(context.failureCode);
    const attemptedStrategies: RecoveryStrategy[] = [];

    console.log(`[Recovery] Attempting recovery for ${context.failureCode}`);
    console.log(`[Recovery] Strategies to try: ${strategies.join(', ')}`);

    for (const strategy of strategies) {
      // Don't exceed max attempts
      if (attemptedStrategies.length >= this.options.maxAttempts) {
        break;
      }

      attemptedStrategies.push(strategy);
      console.log(`[Recovery] Trying strategy: ${strategy}`);

      const result = await this.executeStrategy(strategy, context);

      if (result.recovered) {
        console.log(`[Recovery] Success with strategy: ${strategy}`);
        return {
          recovered: true,
          strategy,
          elapsedMs: Date.now() - startTime,
        };
      }
    }

    // All strategies failed
    console.log('[Recovery] All strategies exhausted');

    // Check if we should ask user
    if (this.options.enableUserHelp && this.options.onAskUser) {
      const userContext = this.buildUserHelpContext(context, attemptedStrategies);
      return {
        recovered: false,
        elapsedMs: Date.now() - startTime,
        needsUserHelp: true,
        userHelpContext: userContext,
      };
    }

    return {
      recovered: false,
      elapsedMs: Date.now() - startTime,
      error: `Recovery failed after ${attemptedStrategies.length} attempts`,
    };
  }

  /**
   * Get recovery strategies based on failure code
   */
  private getStrategiesForFailure(failureCode: RejectionCode): RecoveryStrategy[] {
    switch (failureCode) {
      case 'NOT_FOUND':
        // Element not found - try scrolling, alternatives, then vision
        return ['wait_retry', 'scroll_into_view', 'alternative_selectors', 'vision_fallback'];

      case 'AMBIGUOUS':
        // Multiple matches - need disambiguation
        return ['wait_retry', 'alternative_selectors', 'user_disambiguation'];

      case 'NOT_INTERACTABLE':
        // Element exists but not clickable - wait for animations, scroll
        return ['wait_retry', 'scroll_into_view', 'wait_retry'];

      case 'SCOPE_FAILED':
        // Container not found - similar to NOT_FOUND
        return ['wait_retry', 'scroll_into_view', 'alternative_selectors'];

      case 'OUTCOME_FAILED':
        // Action completed but verification failed - just wait and retry
        return ['wait_retry', 'wait_retry'];

      default:
        return ['wait_retry'];
    }
  }

  /**
   * Execute a single recovery strategy
   */
  private async executeStrategy(
    strategy: RecoveryStrategy,
    context: RecoveryAttemptContext
  ): Promise<{ recovered: boolean }> {
    try {
      switch (strategy) {
        case 'wait_retry':
          return await this.waitAndRetry(context);

        case 'scroll_into_view':
          return await this.scrollAndRetry(context);

        case 'alternative_selectors':
          return await this.tryAlternativeSelectors(context);

        case 'vision_fallback':
          if (this.options.enableVision) {
            return await this.visionFallback(context);
          }
          return { recovered: false };

        case 'user_disambiguation':
          // This is handled separately
          return { recovered: false };

        default:
          return { recovered: false };
      }
    } catch (error) {
      console.warn(`[Recovery] Strategy ${strategy} threw error:`, error);
      return { recovered: false };
    }
  }

  /**
   * Wait with exponential backoff and retry
   */
  private async waitAndRetry(context: RecoveryAttemptContext): Promise<{ recovered: boolean }> {
    const { waitForDOMStability } = await import('./fast-path');

    // Calculate wait time with exponential backoff
    const waitMs = Math.min(
      this.options.initialWaitMs * Math.pow(2, context.attemptCount),
      this.options.maxWaitMs
    );

    console.log(`[Recovery] Waiting ${waitMs}ms before retry...`);
    await waitForDOMStability({ maxWait: waitMs });

    // Retry the action
    const { Tier1Executor } = await import('../tier1-executor');
    const result = await Tier1Executor.execute(context.action);

    return { recovered: result.status === 'success' };
  }

  /**
   * Scroll element into view and retry
   */
  private async scrollAndRetry(context: RecoveryAttemptContext): Promise<{ recovered: boolean }> {
    const { RecoveryEngine } = await import('../../content/recovery-engine');

    // Try to find a selector to scroll to
    let selector = '';

    if (context.action.params.target) {
      const target = context.action.params.target;
      if (target.testId) {
        selector = `[data-testid="${target.testId}"]`;
      } else if (target.name) {
        selector = `[aria-label="${target.name}"], button:contains("${target.name}")`;
      }
    }

    if (!selector && isWorkflowStepPayload(context.step.payload)) {
      selector = context.step.payload.selector;
    }

    if (!selector) {
      console.log('[Recovery] No selector available for scroll');
      return { recovered: false };
    }

    // Execute scroll recovery
    const scrollResult = await RecoveryEngine.executeRecovery(
      { kind: 'SCROLL_INTO_VIEW', target: selector },
      { attemptNumber: context.attemptCount }
    );

    if (!scrollResult.success) {
      return { recovered: false };
    }

    // Wait for stability after scroll
    await new Promise(resolve => setTimeout(resolve, 200));

    // Retry the action
    const { Tier1Executor } = await import('../tier1-executor');
    const result = await Tier1Executor.execute(context.action);

    return { recovered: result.status === 'success' };
  }

  /**
   * Try alternative selectors from the locator bundle
   */
  private async tryAlternativeSelectors(context: RecoveryAttemptContext): Promise<{ recovered: boolean }> {
    if (!isWorkflowStepPayload(context.step.payload)) {
      return { recovered: false };
    }

    const payload = context.step.payload;
    const selectors: string[] = [];

    // Gather all available selectors
    if (payload.fallbackSelectors) {
      selectors.push(...payload.fallbackSelectors);
    }

    if (payload.locatorBundle?.strategies) {
      for (const strategy of payload.locatorBundle.strategies) {
        if (strategy.type === 'css' || strategy.type === 'xpath') {
          selectors.push(strategy.value);
        }
      }
    }

    if (selectors.length === 0) {
      console.log('[Recovery] No alternative selectors available');
      return { recovered: false };
    }

    console.log(`[Recovery] Trying ${selectors.length} alternative selectors...`);

    // Try each selector
    for (const selector of selectors) {
      try {
        let element: Element | null = null;

        if (selector.startsWith('//')) {
          // XPath
          const result = document.evaluate(
            selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          element = result.singleNodeValue as Element;
        } else {
          // CSS
          element = document.querySelector(selector);
        }

        if (element && this.isElementInteractable(element)) {
          console.log(`[Recovery] Found element with selector: ${selector.substring(0, 50)}...`);

          // Build updated action with this element's position
          const updatedAction = { ...context.action };

          // Execute action
          const { Tier1Executor } = await import('../tier1-executor');
          const result = await Tier1Executor.execute(updatedAction);

          if (result.status === 'success') {
            return { recovered: true };
          }
        }
      } catch {
        // This selector didn't work, try next
      }
    }

    return { recovered: false };
  }

  /**
   * Vision-based fallback using AI
   */
  private async visionFallback(context: RecoveryAttemptContext): Promise<{ recovered: boolean }> {
    console.log('[Recovery] Attempting vision-based recovery...');

    try {
      const { VisionAssist } = await import('../tier3-vision-assist');
      const { VisualSnapshotService } = await import('../../content/visual-snapshot');
      const { generateDOMMap, domMapToText } = await import('../../content/dom-map');

      // Capture screenshot
      const fullPageResult = await VisualSnapshotService.captureFullPage(0.7, true);
      if (!fullPageResult) {
        console.log('[Recovery] Failed to capture screenshot');
        return { recovered: false };
      }
      const screenshot = fullPageResult.screenshot;

      // Get DOM map
      const domMap = generateDOMMap();
      const domMapText = domMapToText(domMap);

      // Build target from action
      const target: SemanticTarget = context.action.params.target || {
        name: context.action.params.description,
      };

      // Get vision hint
      const hint = await VisionAssist.getHint(screenshot, target, domMapText);

      if (hint.confidence < 0.5) {
        console.log('[Recovery] Vision hint confidence too low:', hint.confidence);
        return { recovered: false };
      }

      // Update target with vision hints and retry
      const updatedAction = {
        ...context.action,
        params: {
          ...context.action.params,
          target: hint.refinedTarget || target,
        },
      };

      const { Tier1Executor } = await import('../tier1-executor');
      const result = await Tier1Executor.execute(updatedAction);

      return { recovered: result.status === 'success' };

    } catch (error) {
      console.warn('[Recovery] Vision fallback error:', error);
      return { recovered: false };
    }
  }

  /**
   * Check if element is interactable
   */
  private isElementInteractable(element: Element): boolean {
    if (!element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    if ((element as HTMLInputElement).disabled) return false;

    return true;
  }

  /**
   * Build user help context
   */
  private buildUserHelpContext(
    context: RecoveryAttemptContext,
    attemptedStrategies: RecoveryStrategy[]
  ): RecoveryResult['userHelpContext'] {
    const stepDesc = context.step.description ||
      `${context.action.type}: ${context.action.params.target?.name || 'element'}`;

    const whatWasTried = attemptedStrategies.map(s => {
      switch (s) {
        case 'wait_retry': return 'Waited for page to stabilize';
        case 'scroll_into_view': return 'Scrolled to find element';
        case 'alternative_selectors': return 'Tried alternative element identifiers';
        case 'vision_fallback': return 'Used AI vision to locate element';
        default: return s;
      }
    });

    let suggestion = 'Please help locate the element or skip this step.';
    if (context.failureCode === 'AMBIGUOUS') {
      suggestion = 'Multiple elements match. Please click the correct one.';
    } else if (context.failureCode === 'NOT_FOUND') {
      suggestion = 'Element not found. It may have a different appearance or location.';
    }

    return {
      stepDescription: stepDesc,
      whatWasTried,
      suggestion,
    };
  }
}

// ============================================================================
// Module Exports
// ============================================================================

export default UnifiedRecoveryEngine;
