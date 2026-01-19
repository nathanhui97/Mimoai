/**
 * PageModel - The Unified Page Understanding System
 *
 * This is the main entry point for the page model system. It provides:
 * - A singleton instance with caching for performance
 * - Unified view of page state from multiple perception sources
 * - Integration with continuous observer, relationship graph, and expectations
 *
 * Usage:
 *   const model = await PageModel.getInstance().getModel();
 *   console.log(model.pageType, model.uiState, model.activeContext);
 */

import { generateDOMMap, type DOMMap } from '../../content/dom-map';
import { VisualSnapshotService } from '../../content/visual-snapshot';
import type { PageRegions as VisualPageRegions } from '../../types/visual';
import { SignalAggregator, getSignalAggregator } from './signal-aggregator';
import type {
  PageModel as PageModelInterface,
  PageModelConfig,
  PageModelEvent,
  PageModelEventListener,
  PerceptionSignals,
  RelationshipGraph,
  ElementRelationship,
  PredictedTransition,
} from './types';

// ============================================================================
// PageModel Singleton Class
// ============================================================================

export class PageModelManager {
  private static instance: PageModelManager | null = null;

  private config: PageModelConfig;
  private signalAggregator: SignalAggregator;

  // Cache
  private cachedModel: PageModelInterface | null = null;
  private cacheTimestamp: number = 0;

  // Event listeners
  private eventListeners: Set<PageModelEventListener> = new Set();

  // Relationship graph (built once, updated incrementally)
  private relationshipGraph: RelationshipGraph | null = null;

  // Continuous observer reference (will be set by ContinuousObserver)
  private continuousObserver: any = null;

  // ============================================================================
  // Constructor & Singleton
  // ============================================================================

  private constructor(config?: Partial<PageModelConfig>) {
    this.config = {
      cacheTTLMs: 200,
      enableContinuousObserver: true,
      enableRelationshipGraph: true,
      enableExpectationEngine: true,
      observerThrottleMs: 100,
      maxRelationshipsPerElement: 10,
      logLevel: 'warn',
      ...config,
    };

    this.signalAggregator = getSignalAggregator(this.config);
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: Partial<PageModelConfig>): PageModelManager {
    if (!PageModelManager.instance) {
      PageModelManager.instance = new PageModelManager(config);
    }
    return PageModelManager.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static resetInstance(): void {
    if (PageModelManager.instance) {
      PageModelManager.instance.destroy();
      PageModelManager.instance = null;
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the current page model (cached if fresh)
   *
   * This is the main entry point for consumers.
   * Returns a cached model if it's still fresh (within TTL),
   * otherwise generates a new model.
   *
   * Performance target: <50ms for cached, <100ms for fresh
   */
  async getModel(): Promise<PageModelInterface> {
    const now = Date.now();

    // Check cache
    if (this.cachedModel &&
      (now - this.cacheTimestamp) < this.config.cacheTTLMs) {
      this.log('debug', `Cache hit (${now - this.cacheTimestamp}ms old)`);
      return {
        ...this.cachedModel,
        staleness: this.computeStaleness(now - this.cacheTimestamp),
      };
    }

    // Generate fresh model
    return this.refresh();
  }

  /**
   * Force refresh the page model (bypass cache)
   */
  async refresh(): Promise<PageModelInterface> {
    const startTime = performance.now();

    try {
      // 1. Collect perception signals
      const signals = await this.collectSignals();

      // 2. Aggregate signals into unified structures
      const {
        pageType,
        regions,
        uiState,
        activeContext,
        primaryActionZone,
      } = this.signalAggregator.aggregate(signals);

      // 3. Build/update relationship graph (if enabled)
      let elementRelationships = this.relationshipGraph;
      if (this.config.enableRelationshipGraph && signals.domMap) {
        elementRelationships = this.buildRelationshipGraph(signals.domMap);
        this.relationshipGraph = elementRelationships;
      }

      // 4. Generate expected transitions (if enabled)
      let pendingTransitions: PredictedTransition[] = [];
      if (this.config.enableExpectationEngine) {
        pendingTransitions = this.generateExpectedTransitions(pageType.type, uiState);
      }

      // 5. Build the model
      const generationTimeMs = performance.now() - startTime;
      const model: PageModelInterface = {
        pageType,
        regions,
        uiState,
        elementRelationships: elementRelationships || this.emptyRelationshipGraph(),
        activeContext,
        primaryActionZone,
        pendingTransitions,
        rawDOMMap: signals.domMap,
        rawVisualRegions: signals.visualRegions,
        confidence: this.computeOverallConfidence(pageType.confidence, regions, uiState),
        lastUpdated: Date.now(),
        staleness: 'fresh',
        generationTimeMs,
      };

      // 6. Update cache
      this.cachedModel = model;
      this.cacheTimestamp = Date.now();

      this.log('info', `Generated model in ${generationTimeMs.toFixed(1)}ms - ${pageType.type} (${(pageType.confidence * 100).toFixed(0)}%)`);

      return model;
    } catch (error) {
      this.log('error', 'Failed to generate model:', error);

      // Return a minimal model on error
      return this.createErrorModel(error);
    }
  }

  /**
   * Invalidate the cache (call after actions that modify DOM)
   */
  invalidateCache(): void {
    this.cachedModel = null;
    this.cacheTimestamp = 0;
    this.log('debug', 'Cache invalidated');
  }

  /**
   * Subscribe to page model events
   */
  subscribe(listener: PageModelEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Emit an event to all subscribers
   */
  emitEvent(event: PageModelEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        this.log('error', 'Event listener error:', error);
      }
    }
  }

  /**
   * Get relationships for a specific element
   */
  getRelationshipsFor(element: { selector?: string; id?: string; name?: string }): ElementRelationship[] {
    if (!this.relationshipGraph) return [];

    const key = element.selector || element.id || element.name;
    if (!key) return [];

    const asSource = this.relationshipGraph.bySourceSelector.get(key) || [];
    const asTarget = this.relationshipGraph.byTargetSelector.get(key) || [];

    return [...asSource, ...asTarget];
  }

  /**
   * Set the continuous observer reference
   */
  setContinuousObserver(observer: any): void {
    this.continuousObserver = observer;
  }

  /**
   * Destroy the page model (cleanup)
   */
  destroy(): void {
    this.eventListeners.clear();
    this.cachedModel = null;
    this.relationshipGraph = null;
    if (this.continuousObserver?.stop) {
      this.continuousObserver.stop();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Collect perception signals from all sources
   */
  private async collectSignals(): Promise<PerceptionSignals> {
    const startTime = performance.now();

    // Collect DOM map (always)
    const domMap = generateDOMMap();

    // Collect visual regions (optional, async)
    let visualRegions: VisualPageRegions | undefined;
    try {
      // Only collect visual regions if we're not in a performance-critical path
      // The capturePageRegions method is expensive
      if (this.config.logLevel === 'debug') {
        const result = await VisualSnapshotService.capturePageRegions();
        visualRegions = result?.regions;
      }
    } catch (error) {
      // Visual regions are optional
      this.log('debug', 'Visual regions unavailable:', error);
    }

    const elapsed = performance.now() - startTime;
    this.log('debug', `Collected signals in ${elapsed.toFixed(1)}ms`);

    return {
      domMap,
      visualRegions,
      timestamp: Date.now(),
    };
  }

  /**
   * Build the relationship graph from DOM map
   */
  private buildRelationshipGraph(domMap: DOMMap): RelationshipGraph {
    const relationships: ElementRelationship[] = [];
    const bySourceSelector = new Map<string, ElementRelationship[]>();
    const byTargetSelector = new Map<string, ElementRelationship[]>();
    const byType = new Map<string, ElementRelationship[]>();

    // Process form fields and their labels
    for (const field of domMap.formFields || []) {
      // Look for label relationships via id
      if (field.attrs?.id) {
        const labelRelation = this.findLabelRelationship(field, domMap);
        if (labelRelation) {
          relationships.push(labelRelation);
        }
      }

      // Look for aria-controls relationships
      if (field.role === 'combobox' || field.role === 'button') {
        const controlsRelation = this.findControlsRelationship(field);
        if (controlsRelation) {
          relationships.push(controlsRelation);
        }
      }
    }

    // Process interactive elements for trigger relationships
    for (const el of domMap.interactiveElements || []) {
      // Buttons that might trigger dropdowns/modals
      if (el.role === 'button' || el.tag === 'button') {
        const triggerRelation = this.findTriggerRelationship(el);
        if (triggerRelation) {
          relationships.push(triggerRelation);
        }
      }

      // Tabs that control panels
      if (el.role === 'tab') {
        const tabRelation = this.findTabPanelRelationship(el);
        if (tabRelation) {
          relationships.push(tabRelation);
        }
      }
    }

    // Build lookup maps
    for (const rel of relationships) {
      const sourceKey = rel.source.selector || rel.source.id || rel.source.name || '';
      const targetKey = rel.target.selector || rel.target.id || rel.target.name || '';

      if (sourceKey) {
        const existing = bySourceSelector.get(sourceKey) || [];
        existing.push(rel);
        bySourceSelector.set(sourceKey, existing);
      }

      if (targetKey) {
        const existing = byTargetSelector.get(targetKey) || [];
        existing.push(rel);
        byTargetSelector.set(targetKey, existing);
      }

      const typeExisting = byType.get(rel.relationship) || [];
      typeExisting.push(rel);
      byType.set(rel.relationship, typeExisting);
    }

    return {
      relationships,
      bySourceSelector,
      byTargetSelector,
      byType: byType as Map<any, ElementRelationship[]>,
    };
  }

  /**
   * Find label relationship for an input
   */
  private findLabelRelationship(field: any, domMap: DOMMap): ElementRelationship | null {
    // Look for label in DOM that references this field
    // This is a simplified version - actual implementation would query DOM
    if (!field.attrs?.id) return null;

    // Check if any interactive element might be a label
    const possibleLabel = domMap.interactiveElements?.find(el =>
      el.name && field.attrs?.id &&
      (el.attrs?.id === `${field.attrs.id}-label` ||
        el.name.toLowerCase().includes(field.name?.toLowerCase() || ''))
    );

    if (possibleLabel) {
      return {
        source: {
          role: 'label',
          name: possibleLabel.name,
          id: possibleLabel.attrs?.id,
        },
        target: {
          role: field.role,
          name: field.name,
          id: field.attrs?.id,
        },
        relationship: 'labels',
        confidence: 0.7,
        metadata: {
          labelText: possibleLabel.name || possibleLabel.text,
        },
      };
    }

    return null;
  }

  /**
   * Find aria-controls relationship
   */
  private findControlsRelationship(_element: any): ElementRelationship | null {
    // Would query element.getAttribute('aria-controls') in actual DOM
    // This is a placeholder
    return null;
  }

  /**
   * Find trigger relationship (button -> dropdown/modal)
   */
  private findTriggerRelationship(_element: any): ElementRelationship | null {
    // Would check for aria-haspopup, aria-expanded, etc.
    // This is a placeholder
    return null;
  }

  /**
   * Find tab-panel relationship
   */
  private findTabPanelRelationship(_element: any): ElementRelationship | null {
    // Would check for aria-controls pointing to tabpanel
    // This is a placeholder
    return null;
  }

  /**
   * Generate expected transitions based on current state
   */
  private generateExpectedTransitions(
    pageType: string,
    uiState: any
  ): PredictedTransition[] {
    const transitions: PredictedTransition[] = [];

    // If dropdown is open, expect selection
    if (uiState.hasOpenDropdown) {
      transitions.push({
        trigger: {
          actionType: 'click',
          targetRole: 'option',
        },
        expectedOutcome: {
          type: 'dropdown_closes',
          details: { dropdownCloses: true },
        },
        confidence: 0.9,
        timeoutMs: 1000,
      });
    }

    // If modal is open, expect close or submit
    if (uiState.hasModal && !uiState.modalInfo?.isPersistentPanel) {
      transitions.push({
        trigger: {
          actionType: 'click',
          targetRole: 'button',
          targetText: 'close',
        },
        expectedOutcome: {
          type: 'modal_closes',
          details: { modalCloses: true },
        },
        confidence: 0.85,
        timeoutMs: 2000,
      });
    }

    // Form page expectations
    if (pageType === 'form') {
      transitions.push({
        trigger: {
          actionType: 'click',
          targetRole: 'combobox',
        },
        expectedOutcome: {
          type: 'dropdown_opens',
          details: { dropdownOpens: true },
        },
        confidence: 0.8,
        timeoutMs: 1500,
      });

      transitions.push({
        trigger: {
          actionType: 'type',
          targetRole: 'textbox',
        },
        expectedOutcome: {
          type: 'value_updates',
          details: { valueUpdates: true },
        },
        confidence: 0.95,
        timeoutMs: 500,
      });
    }

    return transitions;
  }

  /**
   * Create an empty relationship graph
   */
  private emptyRelationshipGraph(): RelationshipGraph {
    return {
      relationships: [],
      bySourceSelector: new Map(),
      byTargetSelector: new Map(),
      byType: new Map(),
    };
  }

  /**
   * Compute staleness based on age
   */
  private computeStaleness(ageMs: number): 'fresh' | 'recent' | 'stale' {
    if (ageMs < 100) return 'fresh';
    if (ageMs < 500) return 'recent';
    return 'stale';
  }

  /**
   * Compute overall confidence from components
   */
  private computeOverallConfidence(
    pageTypeConfidence: number,
    regions: any,
    uiState: any
  ): number {
    let confidence = pageTypeConfidence * 0.4;

    // Boost if we have clear regions
    const regionCount = Object.keys(regions).filter(k => regions[k]).length;
    confidence += Math.min(regionCount / 5, 0.3);

    // Boost if UI state is clear (no ambiguous states)
    if (uiState.hasOpenDropdown || uiState.hasModal || !uiState.isLoading) {
      confidence += 0.2;
    }

    return Math.min(confidence + 0.1, 1);
  }

  /**
   * Create a minimal error model
   */
  private createErrorModel(error: any): PageModelInterface {
    return {
      pageType: {
        type: 'unknown',
        confidence: 0,
        characteristics: ['error_generating_model'],
      },
      regions: {},
      uiState: {
        hasModal: false,
        hasOpenDropdown: false,
        isLoading: false,
        loadingIndicators: [],
        hasError: true,
        errorInfo: {
          message: error?.message || 'Unknown error',
          type: 'unknown',
        },
        hasToast: false,
      },
      elementRelationships: this.emptyRelationshipGraph(),
      activeContext: 'content',
      pendingTransitions: [],
      confidence: 0,
      lastUpdated: Date.now(),
      staleness: 'stale',
      generationTimeMs: 0,
    };
  }

  /**
   * Log with level filtering
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    const levels = ['debug', 'info', 'warn', 'error', 'none'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel >= configLevel) {
      const prefix = '[PageModel]';
      switch (level) {
        case 'debug':
          console.log(prefix, message, ...args);
          break;
        case 'info':
          console.log(prefix, message, ...args);
          break;
        case 'warn':
          console.warn(prefix, message, ...args);
          break;
        case 'error':
          console.error(prefix, message, ...args);
          break;
      }
    }
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Get the PageModel singleton instance
 */
export function getPageModel(config?: Partial<PageModelConfig>): PageModelManager {
  return PageModelManager.getInstance(config);
}

/**
 * Quick access to current page model
 */
export async function getCurrentModel(): Promise<PageModelInterface> {
  return PageModelManager.getInstance().getModel();
}

/**
 * Force refresh and get fresh model
 */
export async function refreshModel(): Promise<PageModelInterface> {
  return PageModelManager.getInstance().refresh();
}

/**
 * Invalidate the page model cache
 */
export function invalidatePageModel(): void {
  PageModelManager.getInstance().invalidateCache();
}
