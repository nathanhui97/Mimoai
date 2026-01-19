/**
 * Expectation Engine - Predictive verification based on page type + action
 *
 * This module provides:
 * - Rules for predicting outcomes based on page type and action
 * - Methods to generate expectations before action execution
 * - Verification of expected outcomes after action execution
 *
 * Key insight: Different page types have different expected behaviors.
 * A click on a combobox on a form page should open a dropdown.
 * A click on a submit button should trigger loading or success.
 */

import type {
  PageTypeEnum,
  PredictedTransition,
  ExpectationRule,
  PageModel,
  PageModelConfig,
} from './types';
import type { AgentAction } from '../ai-agent';

// ============================================================================
// Expectation Rules
// ============================================================================

/**
 * Predefined rules for generating expectations
 * These are based on common UI patterns across web applications
 */
const EXPECTATION_RULES: ExpectationRule[] = [
  // ============================================
  // FORM PAGE RULES
  // ============================================

  // Click on combobox -> dropdown opens
  {
    pageTypes: ['form', 'wizard', 'settings', 'modal'],
    actionType: 'click',
    targetRole: 'combobox',
    expectedOutcome: {
      type: 'dropdown_opens',
      details: { dropdownOpens: true },
    },
    minWaitMs: 100,
    maxWaitMs: 2000,
    priority: 100,
  },

  // Click on dropdown option -> dropdown closes
  {
    pageTypes: ['form', 'wizard', 'settings', 'modal'],
    actionType: 'click',
    targetRole: 'option',
    expectedOutcome: {
      type: 'dropdown_closes',
      details: { dropdownCloses: true },
    },
    minWaitMs: 50,
    maxWaitMs: 1000,
    priority: 100,
  },

  // Type in textbox -> value updates
  {
    pageTypes: ['form', 'wizard', 'settings', 'modal', 'search', 'login'],
    actionType: 'type',
    targetRole: 'textbox',
    expectedOutcome: {
      type: 'value_updates',
      details: { valueUpdates: true },
    },
    minWaitMs: 0,
    maxWaitMs: 500,
    priority: 80,
  },

  // Click submit/save button -> loading or success
  {
    pageTypes: ['form', 'wizard', 'settings', 'modal', 'login'],
    actionType: 'click',
    targetRole: 'button',
    targetTextPattern: /submit|save|create|update|confirm|continue|next|send|ok/i,
    expectedOutcome: {
      type: 'loading_starts',
      details: { loadingStarts: true },
    },
    minWaitMs: 100,
    maxWaitMs: 5000,
    priority: 90,
  },

  // ============================================
  // MODAL RULES
  // ============================================

  // Click close button in modal -> modal closes
  {
    pageTypes: ['modal', 'form', 'dashboard'],
    actionType: 'click',
    targetRole: 'button',
    targetTextPattern: /close|cancel|dismiss|×|x/i,
    expectedOutcome: {
      type: 'modal_closes',
      details: { modalCloses: true },
    },
    minWaitMs: 100,
    maxWaitMs: 2000,
    priority: 95,
  },

  // Click outside modal -> modal might close
  {
    pageTypes: ['modal'],
    actionType: 'click',
    expectedOutcome: {
      type: 'modal_closes',
      details: { modalCloses: true },
    },
    minWaitMs: 100,
    maxWaitMs: 1000,
    priority: 30, // Low priority - only if no better match
  },

  // ============================================
  // DASHBOARD RULES
  // ============================================

  // Click on widget -> might expand or navigate
  {
    pageTypes: ['dashboard'],
    actionType: 'click',
    targetRole: 'button',
    expectedOutcome: {
      type: 'content_appears',
    },
    minWaitMs: 100,
    maxWaitMs: 3000,
    priority: 50,
  },

  // ============================================
  // DATA TABLE RULES
  // ============================================

  // Click on table row -> row selected or detail opens
  {
    pageTypes: ['data_table', 'list'],
    actionType: 'click',
    targetRole: 'row',
    expectedOutcome: {
      type: 'content_appears',
    },
    minWaitMs: 100,
    maxWaitMs: 2000,
    priority: 60,
  },

  // Click checkbox in table -> row selection changes
  {
    pageTypes: ['data_table', 'list'],
    actionType: 'click',
    targetRole: 'checkbox',
    expectedOutcome: {
      type: 'value_updates',
      details: { valueUpdates: true },
    },
    minWaitMs: 0,
    maxWaitMs: 500,
    priority: 80,
  },

  // ============================================
  // NAVIGATION RULES
  // ============================================

  // Click on link -> navigation
  {
    pageTypes: ['navigation', 'article', 'list', 'search', 'dashboard'],
    actionType: 'click',
    targetRole: 'link',
    expectedOutcome: {
      type: 'navigation',
      details: { urlChanges: true },
    },
    minWaitMs: 100,
    maxWaitMs: 5000,
    priority: 70,
  },

  // Click on tab -> tabpanel changes
  {
    pageTypes: ['form', 'settings', 'dashboard', 'modal'],
    actionType: 'click',
    targetRole: 'tab',
    expectedOutcome: {
      type: 'content_appears',
    },
    minWaitMs: 50,
    maxWaitMs: 1000,
    priority: 85,
  },

  // ============================================
  // MENU RULES
  // ============================================

  // Click on menu button -> menu opens
  {
    pageTypes: ['form', 'dashboard', 'data_table', 'list', 'settings', 'navigation'],
    actionType: 'click',
    targetRole: 'button',
    targetTextPattern: /menu|more|options|actions|\.\.\./i,
    expectedOutcome: {
      type: 'dropdown_opens',
      details: { dropdownOpens: true },
    },
    minWaitMs: 100,
    maxWaitMs: 1500,
    priority: 85,
  },

  // Click on menuitem -> menu closes and action happens
  {
    pageTypes: ['form', 'dashboard', 'data_table', 'list', 'settings'],
    actionType: 'click',
    targetRole: 'menuitem',
    expectedOutcome: {
      type: 'dropdown_closes',
      details: { dropdownCloses: true },
    },
    minWaitMs: 50,
    maxWaitMs: 1000,
    priority: 90,
  },

  // ============================================
  // GENERAL RULES
  // ============================================

  // Type in search -> results update
  {
    pageTypes: ['search', 'list', 'data_table'],
    actionType: 'type',
    targetRole: 'searchbox',
    expectedOutcome: {
      type: 'content_appears',
    },
    minWaitMs: 200,
    maxWaitMs: 3000,
    priority: 75,
  },

  // Hover on element with tooltip -> tooltip appears
  {
    pageTypes: ['form', 'dashboard', 'data_table', 'settings'],
    actionType: 'hover',
    expectedOutcome: {
      type: 'content_appears',
    },
    minWaitMs: 300,
    maxWaitMs: 1000,
    priority: 40,
  },
];

// ============================================================================
// Expectation Engine Class
// ============================================================================

export class ExpectationEngine {
  // Config stored for future extensibility (logging, custom timeouts, etc.)
  // @ts-expect-error - Config is stored for future use
  private _config: PageModelConfig;
  private rules: ExpectationRule[];

  constructor(config: PageModelConfig, customRules?: ExpectationRule[]) {
    this._config = config;
    this.rules = customRules ? [...EXPECTATION_RULES, ...customRules] : EXPECTATION_RULES;
  }

  // ============================================================================
  // Generate Expectations
  // ============================================================================

  /**
   * Generate expectations for an action based on page model
   */
  generate(action: AgentAction, pageModel: PageModel): PredictedTransition[] {
    const transitions: PredictedTransition[] = [];

    // Find matching rules
    const matchingRules = this.findMatchingRules(action, pageModel);

    // Convert rules to transitions
    for (const rule of matchingRules) {
      transitions.push({
        trigger: {
          actionType: action.type,
          targetRole: action.params.target?.role,
          targetText: action.params.target?.name || action.params.target?.text,
        },
        expectedOutcome: rule.expectedOutcome,
        confidence: this.calculateConfidence(rule, action, pageModel),
        timeoutMs: rule.maxWaitMs,
      });
    }

    // Add context-specific expectations
    const contextExpectations = this.generateContextExpectations(action, pageModel);
    transitions.push(...contextExpectations);

    // Sort by confidence
    transitions.sort((a, b) => b.confidence - a.confidence);

    // Limit to top 3
    return transitions.slice(0, 3);
  }

  /**
   * Find rules that match the action and page type
   */
  private findMatchingRules(action: AgentAction, pageModel: PageModel): ExpectationRule[] {
    const pageType = pageModel.pageType.type;
    const targetRole = action.params.target?.role;
    const targetText = action.params.target?.name || action.params.target?.text || '';

    return this.rules
      .filter(rule => {
        // Check page type
        if (!rule.pageTypes.includes(pageType) && !rule.pageTypes.includes('unknown' as PageTypeEnum)) {
          return false;
        }

        // Check action type
        if (rule.actionType !== action.type) {
          return false;
        }

        // Check target role (if specified in rule)
        if (rule.targetRole && targetRole !== rule.targetRole) {
          return false;
        }

        // Check target text pattern (if specified in rule)
        if (rule.targetTextPattern && !rule.targetTextPattern.test(targetText)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Calculate confidence for a rule match
   */
  private calculateConfidence(
    rule: ExpectationRule,
    action: AgentAction,
    pageModel: PageModel
  ): number {
    let confidence = 0.5; // Base confidence

    // Boost for page type confidence
    confidence += pageModel.pageType.confidence * 0.2;

    // Boost for specific role match
    if (rule.targetRole && action.params.target?.role === rule.targetRole) {
      confidence += 0.15;
    }

    // Boost for text pattern match
    if (rule.targetTextPattern) {
      const text = action.params.target?.name || action.params.target?.text || '';
      if (rule.targetTextPattern.test(text)) {
        confidence += 0.15;
      }
    }

    // Boost for high priority rules
    if (rule.priority >= 90) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate expectations based on current UI context
   */
  private generateContextExpectations(
    action: AgentAction,
    pageModel: PageModel
  ): PredictedTransition[] {
    const transitions: PredictedTransition[] = [];

    // If dropdown is open and clicking option, expect it to close
    if (pageModel.uiState.hasOpenDropdown) {
      if (action.type === 'click' &&
        (action.params.target?.role === 'option' || action.params.target?.role === 'menuitem')) {
        transitions.push({
          trigger: {
            actionType: 'click',
            targetRole: action.params.target?.role,
            targetText: action.params.target?.name,
          },
          expectedOutcome: {
            type: 'dropdown_closes',
            details: { dropdownCloses: true },
          },
          confidence: 0.95, // High confidence when dropdown is open
          timeoutMs: 1000,
        });
      }
    }

    // If modal is open and clicking close, expect it to close
    if (pageModel.uiState.hasModal && !pageModel.uiState.modalInfo?.isPersistentPanel) {
      const targetText = (action.params.target?.name || action.params.target?.text || '').toLowerCase();
      if (action.type === 'click' &&
        (targetText.includes('close') || targetText.includes('cancel') || targetText === 'x')) {
        transitions.push({
          trigger: {
            actionType: 'click',
            targetRole: 'button',
            targetText: action.params.target?.name,
          },
          expectedOutcome: {
            type: 'modal_closes',
            details: { modalCloses: true },
          },
          confidence: 0.9,
          timeoutMs: 2000,
        });
      }
    }

    return transitions;
  }

  // ============================================================================
  // Verify Expectations
  // ============================================================================

  /**
   * Wait for expected outcomes after an action
   * Returns when the first expectation is met or all timeouts
   */
  async waitForExpectations(
    expectations: PredictedTransition[],
    options: { maxWaitMs?: number } = {}
  ): Promise<{
    matched: PredictedTransition | null;
    unmatched: PredictedTransition[];
    timedOut: boolean;
  }> {
    const maxWait = options.maxWaitMs ?? Math.max(...expectations.map(e => e.timeoutMs), 3000);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check each expectation
      for (const expectation of expectations) {
        if (await this.checkExpectation(expectation)) {
          return {
            matched: expectation,
            unmatched: expectations.filter(e => e !== expectation),
            timedOut: false,
          };
        }
      }

      // Wait a bit before checking again
      await this.sleep(100);
    }

    return {
      matched: null,
      unmatched: expectations,
      timedOut: true,
    };
  }

  /**
   * Check if a single expectation is met
   */
  async checkExpectation(expectation: PredictedTransition): Promise<boolean> {
    const outcome = expectation.expectedOutcome;

    switch (outcome.type) {
      case 'dropdown_opens':
        return this.checkDropdownOpened();

      case 'dropdown_closes':
        return this.checkDropdownClosed();

      case 'modal_opens':
        return this.checkModalOpened();

      case 'modal_closes':
        return this.checkModalClosed();

      case 'value_updates':
        // Hard to verify without before/after comparison
        return true; // Assume success

      case 'loading_starts':
        return this.checkLoadingStarted();

      case 'loading_ends':
        return this.checkLoadingEnded();

      case 'navigation':
        return this.checkNavigated(outcome.details?.urlContains);

      case 'content_appears':
        return this.checkContentAppeared(outcome.details?.textAppears);

      case 'content_disappears':
        return this.checkContentDisappeared(outcome.details?.textDisappears);

      case 'page_stable':
        return this.checkPageStable();

      default:
        return true; // Unknown type, assume success
    }
  }

  // ============================================================================
  // Individual Outcome Checks
  // ============================================================================

  private checkDropdownOpened(): boolean {
    // Check for visible dropdown/menu
    const dropdowns = document.querySelectorAll(
      '[role="listbox"]:not([aria-hidden="true"]), ' +
      '[role="menu"]:not([aria-hidden="true"]), ' +
      '[aria-expanded="true"] + [role="listbox"], ' +
      '[aria-expanded="true"] + [role="menu"]'
    );

    for (const dropdown of dropdowns) {
      if (this.isVisible(dropdown)) {
        return true;
      }
    }

    return false;
  }

  private checkDropdownClosed(): boolean {
    return !this.checkDropdownOpened();
  }

  private checkModalOpened(): boolean {
    const modals = document.querySelectorAll(
      '[role="dialog"]:not([aria-hidden="true"]), ' +
      '[role="alertdialog"]:not([aria-hidden="true"]), ' +
      '[aria-modal="true"]:not([aria-hidden="true"])'
    );

    for (const modal of modals) {
      if (this.isVisible(modal)) {
        return true;
      }
    }

    return false;
  }

  private checkModalClosed(): boolean {
    return !this.checkModalOpened();
  }

  private checkLoadingStarted(): boolean {
    const loadingIndicators = document.querySelectorAll(
      '[role="progressbar"], ' +
      '[aria-busy="true"], ' +
      '.loading, ' +
      '[class*="loading"], ' +
      '[class*="spinner"]'
    );

    for (const indicator of loadingIndicators) {
      if (this.isVisible(indicator)) {
        return true;
      }
    }

    return false;
  }

  private checkLoadingEnded(): boolean {
    return !this.checkLoadingStarted();
  }

  private checkNavigated(urlContains?: string): boolean {
    if (!urlContains) {
      // Just check if URL changed (would need to track previous URL)
      return true;
    }

    return window.location.href.includes(urlContains);
  }

  private checkContentAppeared(text?: string): boolean {
    if (!text) return true;

    return document.body.textContent?.includes(text) || false;
  }

  private checkContentDisappeared(text?: string): boolean {
    if (!text) return true;

    return !document.body.textContent?.includes(text);
  }

  private checkPageStable(): boolean {
    // Simple heuristic: no loading indicators and no recent DOM changes
    return !this.checkLoadingStarted();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0') {
      return false;
    }

    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an expectation engine
 */
export function createExpectationEngine(
  config: PageModelConfig,
  customRules?: ExpectationRule[]
): ExpectationEngine {
  return new ExpectationEngine(config, customRules);
}

/**
 * Quick method to generate expectations for an action
 */
export function generateExpectations(
  action: AgentAction,
  pageModel: PageModel,
  config?: PageModelConfig
): PredictedTransition[] {
  const engine = new ExpectationEngine(config || {
    cacheTTLMs: 200,
    enableContinuousObserver: true,
    enableRelationshipGraph: true,
    enableExpectationEngine: true,
    observerThrottleMs: 100,
    maxRelationshipsPerElement: 10,
    logLevel: 'warn',
  });

  return engine.generate(action, pageModel);
}

// Export the default rules for customization
export { EXPECTATION_RULES };
