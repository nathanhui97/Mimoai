/**
 * Page Planner Module
 *
 * Makes a SINGLE LLM call per page to map all remaining hints to DOM elements.
 * Returns a PagePlan that the PlanExecutor can run deterministically.
 *
 * Core principle: "AI thinks once per page, code executes per step."
 *
 * Phase F: Plan Caching — after 3+ successful uses of the same plan,
 * it's cached persistently and reused without any LLM call.
 */

import type {
  PagePlan,
  PlannedFieldAction,
  PlannedNavigationAction,
  PlannedSubmitAction,
  AgentHint,
  AgentObservation,
} from './types';
import { aiConfig } from '../ai-config';

// ============================================================================
// Plan Cache Types
// ============================================================================

interface CachedPlan {
  /** The cached plan (without URL-specific data) */
  plan: PagePlan;
  /** URL pattern this plan was generated for */
  urlPattern: string;
  /** Workflow ID this plan belongs to */
  workflowId: string;
  /** How many times this plan was used successfully */
  successCount: number;
  /** How many times this plan failed (element not found, etc.) */
  failureCount: number;
  /** When this was last used */
  lastUsedAt: number;
  /** When this was first created */
  createdAt: number;
  /** Is this plan "mastered" (5+ successes, 0 recent failures)? */
  mastered: boolean;
}

const PLAN_CACHE_KEY = 'ghostwriter-plan-cache';
const MASTERY_THRESHOLD = 3; // Successful uses before marking as mastered

// ============================================================================
// PagePlanner
// ============================================================================

export class PagePlanner {
  /** Cached plan for the current page (in-memory, per-execution) */
  private currentPlan: PagePlan | null = null;
  /** URL when plan was generated (invalidate on change) */
  private planUrl: string = '';
  /** Hash of DOM map text (detect significant DOM changes) */
  private planDomHash: number = 0;
  /** Workflow ID for plan caching */
  private workflowId: string = '';

  /**
   * Set the workflow ID for plan caching.
   */
  setWorkflowId(id: string): void {
    this.workflowId = id;
  }

  /**
   * Generate a PagePlan for the current page.
   * Tries: 1) in-memory cache, 2) persistent cache, 3) LLM call.
   */
  async plan(
    observation: AgentObservation,
    hints: AgentHint[],
    currentHintIndex: number,
    variableValues?: Record<string, string>,
    goal?: string,
  ): Promise<PagePlan | null> {
    // 1. Check if in-memory cached plan is still valid
    if (this.currentPlan && this.isPlanValid(observation)) {
      console.log('[PagePlanner] Using in-memory cached plan for', observation.url);
      return this.currentPlan;
    }

    // Get remaining hints for this page
    const remainingHints = hints
      .map((h, i) => ({ ...h, originalIndex: i }))
      .filter((h, i) => i >= currentHintIndex && !h.completed && !h.skipped);

    if (remainingHints.length === 0) {
      console.log('[PagePlanner] No remaining hints — skipping plan');
      return null;
    }

    // Group hints that are likely on this page
    const pageHints = this.getHintsForCurrentPage(remainingHints);
    if (pageHints.length === 0) {
      console.log('[PagePlanner] No hints applicable to current page');
      return null;
    }

    // 2. Try persistent plan cache
    const urlPattern = this.toUrlPattern(observation.url);
    const cachedPlan = await this.loadCachedPlan(urlPattern);
    if (cachedPlan) {
      // Re-map hint indices to current hints (they may have shifted)
      const remappedPlan = this.remapPlanToCurrentHints(cachedPlan.plan, pageHints);
      if (remappedPlan) {
        this.currentPlan = remappedPlan;
        this.planUrl = observation.url;
        this.planDomHash = this.hashDomMap(observation.domMapText);
        console.log(
          `[PagePlanner] 📦 Using CACHED plan for ${urlPattern} ` +
          `(${cachedPlan.successCount} successes, mastered: ${cachedPlan.mastered})`
        );
        return remappedPlan;
      }
    }

    // 3. Generate new plan via LLM
    console.log(`[PagePlanner] Planning for ${pageHints.length} hints on ${observation.url}`);

    try {
      const plan = await this.callPlanner(observation, pageHints, variableValues, goal);
      if (plan) {
        this.currentPlan = plan;
        this.planUrl = observation.url;
        this.planDomHash = this.hashDomMap(observation.domMapText);
        console.log(
          `[PagePlanner] Plan generated: ${plan.fieldActions.length} fields, ` +
          `${plan.navigationActions.length} nav, type=${plan.pageType}, confidence=${plan.confidence}`
        );
      }
      return plan;
    } catch (error) {
      console.error('[PagePlanner] Failed to generate plan:', error);
      return null;
    }
  }

  /**
   * Get the action for a specific hint index from the current plan.
   */
  getActionForHint(hintIndex: number): PlannedFieldAction | PlannedNavigationAction | PlannedSubmitAction | null {
    if (!this.currentPlan) return null;

    const fieldAction = this.currentPlan.fieldActions.find(a => a.hintIndex === hintIndex);
    if (fieldAction) return fieldAction;

    const navAction = this.currentPlan.navigationActions.find(a => a.hintIndex === hintIndex);
    if (navAction) return navAction;

    if (this.currentPlan.submitAction?.hintIndex === hintIndex) {
      return this.currentPlan.submitAction;
    }

    return null;
  }

  /**
   * Report that a planned action succeeded — updates cache reliability.
   */
  async reportSuccess(): Promise<void> {
    if (!this.currentPlan || !this.workflowId) return;

    const urlPattern = this.toUrlPattern(this.currentPlan.url);
    await this.updateCacheEntry(urlPattern, true);
  }

  /**
   * Report that a planned action failed — updates cache reliability.
   */
  async reportFailure(): Promise<void> {
    if (!this.currentPlan || !this.workflowId) return;

    const urlPattern = this.toUrlPattern(this.currentPlan.url);
    await this.updateCacheEntry(urlPattern, false);
  }

  /**
   * Invalidate the in-memory cached plan (on navigation, modal, etc.)
   */
  invalidate(): void {
    this.currentPlan = null;
    this.planUrl = '';
    this.planDomHash = 0;
    console.log('[PagePlanner] Plan invalidated');
  }

  /**
   * Get the current plan (if any).
   */
  getPlan(): PagePlan | null {
    return this.currentPlan;
  }

  // ── Private: Plan Validation ─────────────────────────────────────

  private isPlanValid(observation: AgentObservation): boolean {
    if (observation.url !== this.planUrl) return false;
    const newHash = this.hashDomMap(observation.domMapText);
    if (newHash !== this.planDomHash) return false;
    return true;
  }

  private hashDomMap(domMapText: string): number {
    let hash = 0;
    const sample = domMapText.substring(0, 2000);
    for (let i = 0; i < sample.length; i++) {
      const char = sample.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }

  private toUrlPattern(url: string): string {
    return url.split('?')[0].split('#')[0].replace(/\/\d+/g, '/*');
  }

  private getHintsForCurrentPage(
    hints: Array<AgentHint & { originalIndex: number }>
  ): Array<AgentHint & { originalIndex: number }> {
    const pageHints: Array<AgentHint & { originalIndex: number }> = [];
    for (const hint of hints) {
      pageHints.push(hint);
      if (hint.actionType === 'navigate' || hint.naturalLanguage?.expectedOutcome?.toLowerCase().includes('navigat')) {
        break;
      }
    }
    return pageHints;
  }

  // ── Private: Plan Caching ────────────────────────────────────────

  private async loadCachedPlan(urlPattern: string): Promise<CachedPlan | null> {
    if (!this.workflowId) return null;

    try {
      const result = await chrome.storage.local.get(PLAN_CACHE_KEY);
      const cache: Record<string, CachedPlan> = result[PLAN_CACHE_KEY] || {};
      const key = `${this.workflowId}:${urlPattern}`;
      const entry = cache[key];

      if (!entry) return null;

      // Only use cached plans with at least 1 success and no recent failures
      if (entry.successCount > 0 && entry.failureCount < entry.successCount) {
        return entry;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async updateCacheEntry(urlPattern: string, success: boolean): Promise<void> {
    if (!this.workflowId || !this.currentPlan) return;

    try {
      const result = await chrome.storage.local.get(PLAN_CACHE_KEY);
      const cache: Record<string, CachedPlan> = result[PLAN_CACHE_KEY] || {};
      const key = `${this.workflowId}:${urlPattern}`;

      const existing = cache[key];

      if (existing) {
        if (success) {
          existing.successCount++;
          existing.lastUsedAt = Date.now();
          existing.mastered = existing.successCount >= MASTERY_THRESHOLD &&
                              existing.failureCount === 0;
        } else {
          existing.failureCount++;
          existing.mastered = false;
        }
        // Update the plan with latest version on success
        if (success) {
          existing.plan = this.currentPlan;
        }
      } else {
        // New entry
        cache[key] = {
          plan: this.currentPlan,
          urlPattern,
          workflowId: this.workflowId,
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          mastered: false,
        };
      }

      await chrome.storage.local.set({ [PLAN_CACHE_KEY]: cache });

      const entry = cache[key];
      console.log(
        `[PagePlanner] Cache updated for ${urlPattern}: ` +
        `${entry.successCount} successes, ${entry.failureCount} failures, ` +
        `mastered: ${entry.mastered}`
      );
    } catch (error) {
      console.warn('[PagePlanner] Failed to update cache:', error);
    }
  }

  /**
   * Remap a cached plan's hint indices to match the current execution's hints.
   * Returns null if the plan can't be remapped (different number of actions).
   */
  private remapPlanToCurrentHints(
    cachedPlan: PagePlan,
    currentHints: Array<AgentHint & { originalIndex: number }>,
  ): PagePlan | null {
    // Simple remapping: match by position
    // Cached plan has hint indices from a previous run; we need to update them
    // to match the current run's hint indices.

    const totalCachedActions = cachedPlan.fieldActions.length +
      cachedPlan.navigationActions.length +
      (cachedPlan.submitAction ? 1 : 0);

    if (totalCachedActions === 0) return null;
    if (currentHints.length < totalCachedActions) return null;

    // Build a mapping: old hint index → field name/description → new hint index
    const remapped: PagePlan = {
      ...cachedPlan,
      generatedAt: Date.now(),
      fieldActions: cachedPlan.fieldActions.map(action => {
        // Find current hint that matches this field by description or target
        const matchingHint = currentHints.find(h =>
          h.targetText === action.fieldName ||
          h.targetPlaceholder === action.fieldName ||
          h.description.includes(action.fieldName)
        );
        return {
          ...action,
          hintIndex: matchingHint?.originalIndex ?? action.hintIndex,
        };
      }),
      navigationActions: cachedPlan.navigationActions.map(action => {
        const matchingHint = currentHints.find(h =>
          h.description.includes(action.text || action.description)
        );
        return {
          ...action,
          hintIndex: matchingHint?.originalIndex ?? action.hintIndex,
        };
      }),
      submitAction: cachedPlan.submitAction ? {
        ...cachedPlan.submitAction,
        hintIndex: currentHints[currentHints.length - 1]?.originalIndex ?? cachedPlan.submitAction.hintIndex,
      } : undefined,
    };

    // Update covered indices
    remapped.coveredHintIndices = [
      ...remapped.fieldActions.map(a => a.hintIndex),
      ...remapped.navigationActions.map(a => a.hintIndex),
      ...(remapped.submitAction ? [remapped.submitAction.hintIndex] : []),
    ];

    return remapped;
  }

  // ── Private: LLM Call ────────────────────────────────────────────

  private async callPlanner(
    observation: AgentObservation,
    hints: Array<AgentHint & { originalIndex: number }>,
    variableValues?: Record<string, string>,
    goal?: string,
  ): Promise<PagePlan | null> {
    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/page_planner`;

    const payload = {
      domMap: observation.domMapText,
      pageContext: {
        url: observation.url,
        title: observation.title,
        hasModal: observation.hasModal,
        modalTitle: observation.modalTitle,
        formFields: observation.formFields,
        buttonCount: observation.buttonCount,
        linkCount: observation.linkCount,
        inputCount: observation.inputCount,
        headings: observation.headings,
      },
      hints: hints.map(h => ({
        index: h.originalIndex,
        stepNumber: h.stepNumber,
        description: h.description,
        actionType: h.actionType,
        targetText: h.targetText,
        targetRole: h.targetRole,
        targetPlaceholder: h.targetPlaceholder,
        value: h.value,
        recordedSelector: h.recordedSelector,
        recordedAriaLabel: h.recordedAriaLabel,
        nearbyText: h.nearbyText,
        naturalLanguage: h.naturalLanguage,
        decisionSpace: h.decisionSpace,
      })),
      variableValues,
      goal,
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
      const text = await response.text();
      console.error(`[PagePlanner] Edge function error: ${response.status} ${text}`);
      return null;
    }

    const result = await response.json();

    if (!result || !result.plan) {
      console.warn('[PagePlanner] Empty or invalid plan response');
      return null;
    }

    const plan = this.parsePlanResponse(result.plan, observation.url, hints);

    // Save to persistent cache after successful generation
    if (plan && this.workflowId) {
      const urlPattern = this.toUrlPattern(observation.url);
      await this.updateCacheEntry(urlPattern, true);
    }

    return plan;
  }

  private parsePlanResponse(
    raw: any,
    url: string,
    hints: Array<AgentHint & { originalIndex: number }>,
  ): PagePlan {
    const fieldActions: PlannedFieldAction[] = (raw.fieldActions || []).map((a: any) => ({
      fieldName: a.fieldName || '',
      value: a.value || '',
      elementIndex: a.elementIndex ?? -1,
      selector: a.selector || '',
      strategy: a.strategy || 'type',
      required: a.required ?? false,
      hintIndex: a.hintIndex ?? -1,
      optionText: a.optionText,
      clearFirst: a.clearFirst,
    }));

    const navigationActions: PlannedNavigationAction[] = (raw.navigationActions || []).map((a: any) => ({
      description: a.description || '',
      elementIndex: a.elementIndex ?? -1,
      selector: a.selector || '',
      expectsNavigation: a.expectsNavigation ?? false,
      expectsModal: a.expectsModal ?? false,
      hintIndex: a.hintIndex ?? -1,
    }));

    let submitAction: PlannedSubmitAction | undefined;
    if (raw.submitAction) {
      submitAction = {
        elementIndex: raw.submitAction.elementIndex ?? -1,
        selector: raw.submitAction.selector || '',
        waitAfterMs: raw.submitAction.waitAfterMs ?? 1000,
        hintIndex: raw.submitAction.hintIndex ?? -1,
      };
    }

    const coveredHintIndices = [
      ...fieldActions.map(a => a.hintIndex),
      ...navigationActions.map(a => a.hintIndex),
      ...(submitAction ? [submitAction.hintIndex] : []),
    ];

    return {
      pageType: raw.pageType || 'other',
      url,
      generatedAt: Date.now(),
      fieldActions,
      navigationActions,
      submitAction,
      successCheck: raw.successCheck,
      coveredHintIndices,
      confidence: raw.confidence ?? 0.5,
      reasoning: raw.reasoning || '',
    };
  }
}
