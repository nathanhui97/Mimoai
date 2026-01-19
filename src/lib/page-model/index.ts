/**
 * Page Model - Unified Page Understanding System
 *
 * This module provides a unified view of the current page state by:
 * - Aggregating signals from DOM analysis and visual detection
 * - Tracking element relationships (labels, triggers, controls)
 * - Monitoring UI state changes (modals, dropdowns, loading)
 * - Generating predictive expectations based on page type + action
 *
 * Main Entry Points:
 * - getPageModel(): Get the PageModel singleton
 * - getCurrentModel(): Get current page model (cached if fresh)
 * - refreshModel(): Force refresh the page model
 * - invalidatePageModel(): Invalidate the cache after actions
 *
 * Usage:
 *   import { getCurrentModel, PageModel } from '../lib/page-model';
 *
 *   // Quick access to current page state
 *   const model = await getCurrentModel();
 *   console.log(model.pageType, model.uiState, model.activeContext);
 *
 *   // Subscribe to state changes
 *   const unsubscribe = getPageModel().subscribe((event) => {
 *     if (event.type === 'modal:appeared') {
 *       console.log('Modal opened:', event.modal);
 *     }
 *   });
 */

// ============================================================================
// Core PageModel
// ============================================================================

export {
  PageModelManager,
  getPageModel,
  getCurrentModel,
  refreshModel,
  invalidatePageModel,
} from './page-model';

// ============================================================================
// Signal Aggregation
// ============================================================================

export {
  SignalAggregator,
  getSignalAggregator,
} from './signal-aggregator';

// ============================================================================
// Continuous Observer
// ============================================================================

export {
  ContinuousObserver,
  createContinuousObserver,
} from './continuous-observer';

// ============================================================================
// Relationship Graph
// ============================================================================

export {
  RelationshipGraphBuilder,
  buildRelationshipGraph,
  buildRelationshipGraphFromDOMMap,
  getRelationshipsFor,
  getLabelFor,
  isLabeledBy,
  getControlledElement,
} from './relationship-graph';

// ============================================================================
// Expectation Engine
// ============================================================================

export {
  ExpectationEngine,
  createExpectationEngine,
  generateExpectations,
  EXPECTATION_RULES,
} from './expectation-engine';

// ============================================================================
// Recording Integration
// ============================================================================

export {
  captureRecordingContext,
  captureMinimalContext,
} from './recording-integration';

// ============================================================================
// Types
// ============================================================================

export type {
  // Core model types
  PageModel,
  PageType,
  PageTypeEnum,
  UnifiedRegions,
  RegionInfo,

  // UI state types
  UIState,
  ElementIdentifier,

  // Relationship types
  RelationshipGraph,
  ElementRelationship,
  RelationshipType,

  // Expectation types
  PredictedTransition,
  ExpectedOutcome,
  ExpectedOutcomeType,
  ExpectationRule,

  // Event types
  PageModelEvent,
  PageModelEventListener,

  // Signal types
  PerceptionSignals,

  // Config types
  PageModelConfig,

  // Recording context types
  PageModelRecordingContext,
  RecordedPageModelContext,
  RecordedElementRelationships,
  RecordedAlternatives,
  RecordedExpectations,
} from './types';

export { DEFAULT_PAGE_MODEL_CONFIG } from './types';
