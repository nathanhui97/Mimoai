/**
 * Signal Aggregator - Fuses perception signals from multiple sources
 *
 * This module merges:
 * - DOMMap regions with Visual regions
 * - Multiple signals into a unified PageType classification
 * - UI state from DOM analysis
 *
 * The goal is to provide a single, coherent view of the page state
 * that combines the best of DOM analysis and visual understanding.
 */

import type { DOMMap, DOMMapElement, DOMMapRegion } from '../../content/dom-map';
import type { PageRegions as VisualPageRegions, BoundingBox } from '../../types/visual';
import type {
  PageType,
  PageTypeEnum,
  UnifiedRegions,
  RegionInfo,
  UIState,
  PerceptionSignals,
  PageModelConfig,
} from './types';

// ============================================================================
// Signal Aggregator Class
// ============================================================================

export class SignalAggregator {
  private config: PageModelConfig;

  constructor(config: PageModelConfig) {
    this.config = config;
  }

  /**
   * Aggregate all perception signals into unified structures
   */
  aggregate(signals: PerceptionSignals): {
    pageType: PageType;
    regions: UnifiedRegions;
    uiState: UIState;
    activeContext: 'form' | 'table' | 'modal' | 'navigation' | 'content' | 'dropdown';
    primaryActionZone?: BoundingBox;
  } {
    const startTime = performance.now();

    // 1. Classify page type from DOM signals
    const pageType = this.classifyPageType(signals.domMap);

    // 2. Merge regions from DOM and visual sources
    const regions = this.mergeRegions(signals.domMap, signals.visualRegions);

    // 3. Extract UI state from DOM map
    const uiState = this.extractUIState(signals.domMap);

    // 4. Determine active context
    const activeContext = this.determineActiveContext(pageType, uiState, signals.domMap);

    // 5. Compute primary action zone
    const primaryActionZone = this.computePrimaryActionZone(regions, activeContext, uiState);

    const elapsed = performance.now() - startTime;
    if (this.config.logLevel === 'debug') {
      console.log(`[SignalAggregator] Aggregated signals in ${elapsed.toFixed(1)}ms`);
    }

    return {
      pageType,
      regions,
      uiState,
      activeContext,
      primaryActionZone,
    };
  }

  // ============================================================================
  // Page Type Classification
  // ============================================================================

  /**
   * Classify the page type based on DOM signals
   */
  private classifyPageType(domMap: DOMMap): PageType {
    const characteristics: string[] = [];
    const scores: Record<PageTypeEnum, number> = {
      form: 0,
      dashboard: 0,
      data_table: 0,
      wizard: 0,
      modal: 0,
      list: 0,
      settings: 0,
      login: 0,
      search: 0,
      article: 0,
      navigation: 0,
      spreadsheet: 0,
      unknown: 0,
    };

    // Count elements by type
    const formFieldCount = domMap.formFields?.length || 0;
    const tableCount = domMap.tables?.length || 0;
    const headingCount = domMap.headings?.length || 0;
    const buttonCount = domMap.interactiveElements?.filter(e => e.role === 'button').length || 0;
    const linkCount = domMap.interactiveElements?.filter(e => e.role === 'link').length || 0;

    // Check URL patterns
    const url = domMap.url.toLowerCase();
    const isSpreadsheet = url.includes('docs.google.com/spreadsheets') ||
      url.includes('excel.office.com') ||
      url.includes('onedrive.live.com/excel');

    // Spreadsheet detection
    if (isSpreadsheet) {
      scores.spreadsheet += 100;
      characteristics.push('spreadsheet_url');
    }

    // Form detection
    if (formFieldCount >= 5) {
      scores.form += 50;
      characteristics.push(`${formFieldCount}_form_fields`);
    }
    if (formFieldCount >= 10) {
      scores.form += 30;
      characteristics.push('many_form_fields');
    }

    // Look for submit/save buttons
    const hasSubmitButton = domMap.interactiveElements?.some(e => {
      const text = (e.name || e.text || '').toLowerCase();
      return text.includes('submit') || text.includes('save') || text.includes('create') || text.includes('update');
    });
    if (hasSubmitButton) {
      scores.form += 20;
      characteristics.push('has_submit_button');
    }

    // Data table detection
    if (tableCount > 0) {
      const largeTable = domMap.tables?.some(t => t.rows > 5 && t.cols > 3);
      if (largeTable) {
        scores.data_table += 70;
        characteristics.push('large_data_table');
      } else {
        scores.data_table += 30;
        characteristics.push(`${tableCount}_tables`);
      }
    }

    // Check for grid roles
    const hasGrid = domMap.interactiveElements?.some(e => e.role === 'grid' || e.role === 'treegrid');
    if (hasGrid) {
      scores.data_table += 40;
      characteristics.push('has_grid_role');
    }

    // Dashboard detection
    const hasMultipleRegions = domMap.regions?.length >= 3;
    if (hasMultipleRegions) {
      scores.dashboard += 30;
      characteristics.push('multiple_regions');
    }

    // Check for card/widget patterns in class names or structure
    const hasWidgets = domMap.headings?.some(h =>
      h.text.toLowerCase().includes('widget') ||
      h.text.toLowerCase().includes('chart') ||
      h.text.toLowerCase().includes('overview')
    );
    if (hasWidgets) {
      scores.dashboard += 40;
      characteristics.push('has_widgets');
    }

    // Modal detection
    if (domMap.activeModal) {
      scores.modal += 80;
      characteristics.push('active_modal');
    }

    // Login detection
    const hasPasswordField = domMap.formFields?.some(f =>
      f.attrs?.type === 'password' ||
      (f.name || '').toLowerCase().includes('password')
    );
    const hasLoginText = domMap.headings?.some(h =>
      h.text.toLowerCase().includes('login') ||
      h.text.toLowerCase().includes('sign in') ||
      h.text.toLowerCase().includes('sign up')
    );
    if (hasPasswordField) {
      scores.login += 50;
      characteristics.push('has_password_field');
    }
    if (hasLoginText) {
      scores.login += 30;
      characteristics.push('has_login_heading');
    }

    // Search detection
    const hasSearchBox = domMap.formFields?.some(f =>
      f.role === 'searchbox' ||
      (f.attrs?.type === 'search') ||
      (f.name || '').toLowerCase().includes('search')
    );
    const hasSearchResults = domMap.headings?.some(h =>
      h.text.toLowerCase().includes('result') ||
      h.text.toLowerCase().includes('found')
    );
    if (hasSearchBox && hasSearchResults) {
      scores.search += 60;
      characteristics.push('search_with_results');
    }

    // List detection
    const hasListRole = domMap.interactiveElements?.some(e => e.role === 'list' || e.role === 'listbox');
    if (hasListRole && linkCount > 10) {
      scores.list += 50;
      characteristics.push('list_with_many_links');
    }

    // Settings detection
    const hasSettingsText = domMap.headings?.some(h =>
      h.text.toLowerCase().includes('settings') ||
      h.text.toLowerCase().includes('preferences') ||
      h.text.toLowerCase().includes('configuration')
    );
    if (hasSettingsText) {
      scores.settings += 60;
      characteristics.push('settings_heading');
    }

    // Article detection (content-heavy, few interactive elements)
    if (headingCount > 5 && formFieldCount < 3 && buttonCount < 5) {
      scores.article += 40;
      characteristics.push('content_heavy');
    }

    // Navigation detection (many links, few inputs)
    if (linkCount > 15 && formFieldCount < 3) {
      scores.navigation += 30;
      characteristics.push('link_heavy');
    }

    // Wizard detection (step indicators)
    const hasStepIndicator = domMap.headings?.some(h =>
      h.text.match(/step\s*\d/i) ||
      h.text.match(/\d\s*of\s*\d/i)
    );
    if (hasStepIndicator) {
      scores.wizard += 70;
      characteristics.push('has_step_indicator');
    }

    // Find the highest scoring type
    let maxScore = 0;
    let bestType: PageTypeEnum = 'unknown';
    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestType = type as PageTypeEnum;
      }
    }

    // Calculate confidence (normalize to 0-1)
    const confidence = Math.min(maxScore / 100, 1);

    return {
      type: bestType,
      confidence,
      characteristics,
      subType: this.inferSubType(bestType, domMap),
    };
  }

  /**
   * Infer a more specific subtype based on page content
   */
  private inferSubType(baseType: PageTypeEnum, domMap: DOMMap): string | undefined {
    const title = domMap.title.toLowerCase();
    const headings = domMap.headings?.map(h => h.text.toLowerCase()).join(' ') || '';
    const combined = `${title} ${headings}`;

    switch (baseType) {
      case 'form':
        if (combined.includes('invoice')) return 'invoice_form';
        if (combined.includes('contact')) return 'contact_form';
        if (combined.includes('profile')) return 'profile_form';
        if (combined.includes('account')) return 'account_form';
        if (combined.includes('registration')) return 'registration_form';
        break;
      case 'dashboard':
        if (combined.includes('sales')) return 'sales_dashboard';
        if (combined.includes('analytics')) return 'analytics_dashboard';
        if (combined.includes('admin')) return 'admin_dashboard';
        break;
      case 'data_table':
        if (combined.includes('user')) return 'user_table';
        if (combined.includes('order')) return 'order_table';
        if (combined.includes('product')) return 'product_table';
        break;
    }

    return undefined;
  }

  // ============================================================================
  // Region Merging
  // ============================================================================

  /**
   * Merge regions from DOM analysis and visual detection
   */
  private mergeRegions(domMap: DOMMap, visualRegions?: VisualPageRegions): UnifiedRegions {
    const regions: UnifiedRegions = {};

    // Get DOM-based regions
    const domRegions = this.extractDOMRegions(domMap);

    // If no visual regions, just use DOM regions
    if (!visualRegions) {
      return domRegions;
    }

    // Merge each region type - only those that exist in both interfaces
    const sharedRegionTypes: Array<keyof VisualPageRegions & keyof UnifiedRegions> = [
      'header', 'sidebar', 'mainContent', 'footer',
      'navigation', 'actionBar', 'formArea', 'tableArea',
    ];

    for (const regionType of sharedRegionTypes) {
      const domRegion = domRegions[regionType];
      const visualRegion = visualRegions[regionType as keyof VisualPageRegions];

      if (domRegion && visualRegion) {
        // Both sources have this region - merge them
        regions[regionType] = this.mergeRegionInfo(domRegion, visualRegion);
      } else if (domRegion) {
        regions[regionType] = domRegion;
      } else if (visualRegion) {
        regions[regionType] = {
          bounds: visualRegion,
          source: 'visual',
          confidence: 0.7,  // Visual-only regions have lower confidence
        };
      }
    }

    // Handle modal separately (comes from DOM analysis)
    if (domMap.activeModal) {
      regions.modal = {
        bounds: this.estimateModalBounds(domMap),
        source: 'dom',
        confidence: 0.9,
        elements: domMap.activeModal.elements,
        name: domMap.activeModal.title,
      };
    }

    // Handle dropdown separately
    if (domMap.activeDropdown) {
      regions.dropdown = {
        bounds: this.estimateDropdownBounds(domMap.activeDropdown.options),
        source: 'dom',
        confidence: 0.9,
        elements: domMap.activeDropdown.options,
        name: domMap.activeDropdown.triggerName,
      };
    }

    return regions;
  }

  /**
   * Extract regions from DOM map
   */
  private extractDOMRegions(domMap: DOMMap): UnifiedRegions {
    const regions: UnifiedRegions = {};

    for (const region of domMap.regions || []) {
      const bounds = this.estimateRegionBounds(region);
      if (!bounds) continue;

      const info: RegionInfo = {
        bounds,
        source: 'dom',
        confidence: 0.8,
        elements: region.elements,
        role: region.role,
        name: region.name,
      };

      // Map DOM region roles to unified region types
      switch (region.role) {
        case 'banner':
          regions.header = info;
          break;
        case 'navigation':
          regions.navigation = info;
          break;
        case 'main':
          regions.mainContent = info;
          break;
        case 'complementary':
          regions.sidebar = info;
          break;
        case 'contentinfo':
          regions.footer = info;
          break;
      }
    }

    return regions;
  }

  /**
   * Merge two region sources into one
   */
  private mergeRegionInfo(domRegion: RegionInfo, visualBounds: BoundingBox): RegionInfo {
    // Prefer DOM bounds if they're similar, otherwise use visual
    const boundsAreSimilar = this.boundsOverlap(domRegion.bounds, visualBounds) > 0.5;

    return {
      bounds: boundsAreSimilar ? domRegion.bounds : visualBounds,
      source: 'merged',
      confidence: Math.max(domRegion.confidence, 0.7) + 0.1, // Merged is more confident
      elements: domRegion.elements,
      role: domRegion.role,
      name: domRegion.name,
    };
  }

  /**
   * Calculate overlap percentage between two bounding boxes
   */
  private boundsOverlap(a: BoundingBox, b: BoundingBox): number {
    const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const overlapArea = xOverlap * yOverlap;
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;

    if (aArea === 0 || bArea === 0) return 0;
    return overlapArea / Math.min(aArea, bArea);
  }

  /**
   * Estimate bounds from a DOM region's elements
   */
  private estimateRegionBounds(region: DOMMapRegion): BoundingBox | undefined {
    // Try to find elements that can give us bounds
    // This is a heuristic - we'd ideally get actual element bounds
    if (!region.elements || region.elements.length === 0) {
      return undefined;
    }

    // For now, return a placeholder based on region role
    // In practice, this would query actual element bounds
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    switch (region.role) {
      case 'banner':
        return { x: 0, y: 0, width: viewportWidth, height: 60 };
      case 'navigation':
        return { x: 0, y: 0, width: 200, height: viewportHeight };
      case 'main':
        return { x: 200, y: 60, width: viewportWidth - 200, height: viewportHeight - 120 };
      case 'complementary':
        return { x: viewportWidth - 300, y: 60, width: 300, height: viewportHeight - 120 };
      case 'contentinfo':
        return { x: 0, y: viewportHeight - 60, width: viewportWidth, height: 60 };
      default:
        return undefined;
    }
  }

  /**
   * Estimate modal bounds from its elements
   */
  private estimateModalBounds(_domMap: DOMMap): BoundingBox {
    // Center modal estimate
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const modalWidth = Math.min(600, viewportWidth * 0.8);
    const modalHeight = Math.min(400, viewportHeight * 0.7);

    return {
      x: (viewportWidth - modalWidth) / 2,
      y: (viewportHeight - modalHeight) / 2,
      width: modalWidth,
      height: modalHeight,
    };
  }

  /**
   * Estimate dropdown bounds from options
   */
  private estimateDropdownBounds(options: DOMMapElement[]): BoundingBox {
    if (!options || options.length === 0) {
      return { x: 0, y: 0, width: 200, height: 100 };
    }

    // Estimate dropdown size based on option count
    const optionHeight = 36; // Typical option height
    const height = Math.min(options.length * optionHeight, 300);

    return {
      x: 100,  // Would ideally be near trigger element
      y: 100,
      width: 250,
      height,
    };
  }

  // ============================================================================
  // UI State Extraction
  // ============================================================================

  /**
   * Extract current UI state from DOM map
   */
  private extractUIState(domMap: DOMMap): UIState {
    const state: UIState = {
      hasModal: false,
      hasOpenDropdown: false,
      isLoading: false,
      loadingIndicators: [],
      hasError: false,
      hasToast: false,
    };

    // Modal state
    if (domMap.activeModal) {
      state.hasModal = true;
      state.modalInfo = {
        title: domMap.activeModal.title,
        type: 'dialog',
        isPersistentPanel: domMap.activeModal.isPersistentPanel || false,
        elements: domMap.activeModal.elements,
      };
    }

    // Dropdown state
    if (domMap.activeDropdown) {
      state.hasOpenDropdown = true;
      state.dropdownInfo = {
        triggerName: domMap.activeDropdown.triggerName,
        options: domMap.activeDropdown.options,
        optionTexts: domMap.activeDropdown.options
          .map(o => o.name || o.text || '')
          .filter(t => t.length > 0),
      };
    }

    // Focus state
    if (domMap.focusedElement) {
      state.focusedElement = {
        role: domMap.focusedElement.role,
        name: domMap.focusedElement.name,
        id: domMap.focusedElement.attrs?.id,
        testId: domMap.focusedElement.attrs?.testId,
      };
    }

    // Loading detection (check for common loading indicators)
    const loadingElements = domMap.interactiveElements?.filter(e => {
      const text = (e.name || e.text || '').toLowerCase();
      return text.includes('loading') || text.includes('please wait') ||
        e.role === 'progressbar' || e.role === 'status';
    }) || [];

    if (loadingElements.length > 0) {
      state.isLoading = true;
      state.loadingIndicators = loadingElements.map(() => ({
        type: 'spinner' as const,
      }));
    }

    // Error detection
    const errorElements = domMap.interactiveElements?.filter(e => {
      const text = (e.name || e.text || '').toLowerCase();
      return text.includes('error') || text.includes('invalid') ||
        e.role === 'alert' || e.role === 'alertdialog';
    }) || [];

    if (errorElements.length > 0) {
      state.hasError = true;
      state.errorInfo = {
        message: errorElements[0].name || errorElements[0].text || 'Unknown error',
        type: 'unknown',
      };
    }

    return state;
  }

  // ============================================================================
  // Active Context Determination
  // ============================================================================

  /**
   * Determine the active context (what the user is likely interacting with)
   */
  private determineActiveContext(
    pageType: PageType,
    uiState: UIState,
    _domMap: DOMMap
  ): 'form' | 'table' | 'modal' | 'navigation' | 'content' | 'dropdown' {
    // Dropdown takes highest priority (must select before other actions)
    if (uiState.hasOpenDropdown) {
      return 'dropdown';
    }

    // Modal takes second priority
    if (uiState.hasModal && !uiState.modalInfo?.isPersistentPanel) {
      return 'modal';
    }

    // Otherwise, use page type
    switch (pageType.type) {
      case 'form':
      case 'wizard':
      case 'login':
      case 'settings':
        return 'form';
      case 'data_table':
      case 'spreadsheet':
        return 'table';
      case 'navigation':
        return 'navigation';
      case 'article':
      case 'search':
        return 'content';
      default:
        return 'content';
    }
  }

  // ============================================================================
  // Primary Action Zone
  // ============================================================================

  /**
   * Compute the primary action zone (where user is likely to interact)
   */
  private computePrimaryActionZone(
    regions: UnifiedRegions,
    activeContext: 'form' | 'table' | 'modal' | 'navigation' | 'content' | 'dropdown',
    _uiState: UIState
  ): BoundingBox | undefined {
    // For dropdown, focus on the dropdown area
    if (activeContext === 'dropdown' && regions.dropdown) {
      return regions.dropdown.bounds;
    }

    // For modal, focus on the modal area
    if (activeContext === 'modal' && regions.modal) {
      return regions.modal.bounds;
    }

    // For form, focus on form area or main content
    if (activeContext === 'form') {
      return regions.formArea?.bounds || regions.mainContent?.bounds;
    }

    // For table, focus on table area
    if (activeContext === 'table') {
      return regions.tableArea?.bounds || regions.mainContent?.bounds;
    }

    // For navigation, focus on nav area
    if (activeContext === 'navigation') {
      return regions.navigation?.bounds || regions.sidebar?.bounds;
    }

    // Default to main content
    return regions.mainContent?.bounds;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let signalAggregatorInstance: SignalAggregator | null = null;

/**
 * Get or create the signal aggregator singleton
 */
export function getSignalAggregator(config?: PageModelConfig): SignalAggregator {
  if (!signalAggregatorInstance || config) {
    signalAggregatorInstance = new SignalAggregator(
      config || {
        cacheTTLMs: 200,
        enableContinuousObserver: true,
        enableRelationshipGraph: true,
        enableExpectationEngine: true,
        observerThrottleMs: 100,
        maxRelationshipsPerElement: 10,
        logLevel: 'warn',
      }
    );
  }
  return signalAggregatorInstance;
}
