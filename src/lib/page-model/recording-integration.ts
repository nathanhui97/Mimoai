/**
 * PageModel Recording Integration
 *
 * Captures rich context from PageModel during recording to enable:
 * - Level 2: Context (page type, region, UI state)
 * - Level 3: Intent (relationships, alternatives, selection reason)
 * - Level 4: Expectation (predicted outcomes based on action + element)
 *
 * This module bridges the gap between recording and intelligent replay.
 */

import type {
  PageModel,
  PageModelRecordingContext,
  RecordedPageModelContext,
  RecordedElementRelationships,
  RecordedAlternatives,
  RecordedExpectations,
  ExpectedOutcomeType,
  ElementRelationship,
  UnifiedRegions,
  BoundingBox,
  ElementIdentifier,
} from './types';
import { getRelationshipsFor, getLabelFor } from './relationship-graph';
import { SelectorEngine } from '../../content/selector-engine';
import { ElementSimilarity } from '../../content/element-similarity';

/**
 * Capture PageModel context for a recorded step
 *
 * @param element - The element that was interacted with
 * @param actionType - Type of action (click, input, etc.)
 * @param pageModel - Current PageModel (or null if not available)
 * @param value - Optional value for input actions
 * @returns PageModelRecordingContext or null if PageModel not available
 */
export function captureRecordingContext(
  element: Element,
  actionType: 'click' | 'input' | 'keyboard' | 'scroll',
  pageModel: PageModel | null,
  value?: string
): PageModelRecordingContext | null {
  if (!pageModel) {
    console.log('[PageModelRecording] PageModel not available, skipping context capture');
    return null;
  }

  const capturedAt = Date.now();

  try {
    // Level 2: Page Context
    const pageContext = capturePageContext(element, pageModel);

    // Level 3: Element Relationships & Alternatives
    const elementRelationships = captureElementRelationships(element, pageModel);
    const alternatives = captureAlternatives(element);

    // Level 4: Expectations
    const expectations = captureExpectations(element, actionType, pageModel, value);

    const context: PageModelRecordingContext = {
      capturedAt,
      pageModelConfidence: pageModel.confidence,
      pageContext,
      elementRelationships,
      alternatives,
      expectations,
    };

    console.log('[PageModelRecording] Context captured:', {
      pageType: pageContext.pageType,
      activeContext: pageContext.activeContext,
      hasRelationships: !!(elementRelationships.labeledBy || elementRelationships.triggers),
      alternativesCount: alternatives.similarElements.length,
      expectedOutcome: expectations.primary.type,
    });

    return context;
  } catch (error) {
    console.warn('[PageModelRecording] Error capturing context:', error);
    return null;
  }
}

/**
 * Capture Level 2: Page Context
 */
function capturePageContext(element: Element, pageModel: PageModel): RecordedPageModelContext {
  // Determine which region the element is in
  const regionName = findElementRegion(element, pageModel.regions);

  return {
    pageType: pageModel.pageType.type,
    pageTypeConfidence: pageModel.pageType.confidence,
    activeContext: pageModel.activeContext,
    uiStateSnapshot: {
      hasModal: pageModel.uiState.hasModal,
      modalTitle: pageModel.uiState.modalInfo?.title,
      hasOpenDropdown: pageModel.uiState.hasOpenDropdown,
      dropdownTriggerName: pageModel.uiState.dropdownInfo?.triggerName,
      isLoading: pageModel.uiState.isLoading,
      hasError: pageModel.uiState.hasError,
    },
    regionName,
    regionConfidence: regionName ? pageModel.regions[regionName]?.confidence : undefined,
  };
}

/**
 * Find which region an element belongs to
 */
function findElementRegion(
  element: Element,
  regions: UnifiedRegions
): RecordedPageModelContext['regionName'] | undefined {
  const rect = element.getBoundingClientRect();
  const elementCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };

  // Check each region
  const regionNames: Array<keyof UnifiedRegions> = [
    'modal', // Check modal first (highest priority)
    'dropdown',
    'formArea',
    'tableArea',
    'header',
    'sidebar',
    'navigation',
    'actionBar',
    'mainContent',
    'footer',
  ];

  for (const name of regionNames) {
    const region = regions[name];
    if (region?.bounds && isPointInBounds(elementCenter, region.bounds)) {
      return name;
    }
  }

  return undefined;
}

/**
 * Check if a point is within bounds
 */
function isPointInBounds(point: { x: number; y: number }, bounds: BoundingBox): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Capture Level 3: Element Relationships
 */
function captureElementRelationships(
  element: Element,
  pageModel: PageModel
): RecordedElementRelationships {
  const relationships: RecordedElementRelationships = {};
  const selector = SelectorEngine.generateSelectors(element).primary;

  // Build element identifier for relationship lookup
  const identifier: ElementIdentifier = {
    selector,
    role: element.getAttribute('role') || undefined,
    name: element.getAttribute('aria-label') || (element as HTMLElement).textContent?.trim().substring(0, 50) || undefined,
    id: element.id || undefined,
  };

  // Get relationships from the PageModel graph
  const graphRelationships = getRelationshipsFor(pageModel.elementRelationships, identifier);

  // Find label relationship
  const labelRel = graphRelationships.find((r) => r.relationship === 'labels');
  if (labelRel) {
    relationships.labeledBy = {
      text: labelRel.metadata?.labelText || '',
      selector: labelRel.source.selector,
      relationship: 'label_for',
    };
  } else {
    // Try to find label using getLabelFor helper (returns string or undefined)
    const labelText = getLabelFor(pageModel.elementRelationships, identifier);
    if (labelText) {
      relationships.labeledBy = {
        text: labelText,
        selector: undefined,
        relationship: 'label_for',
      };
    }
  }

  // Find triggers relationship
  const triggersRel = graphRelationships.find((r) => r.relationship === 'triggers');
  if (triggersRel) {
    relationships.triggers = {
      description: describeTrigger(element, triggersRel),
      targetSelector: triggersRel.target.selector,
      relationship: 'aria_controls',
    };
  } else {
    // Infer trigger relationship from element attributes
    const ariaControls = element.getAttribute('aria-controls');
    const ariaExpanded = element.getAttribute('aria-expanded');
    const role = element.getAttribute('role');

    if (ariaControls || ariaExpanded === 'true' || ariaExpanded === 'false') {
      relationships.triggers = {
        description: role === 'combobox' || role === 'listbox'
          ? 'Opens dropdown menu'
          : role === 'button' && ariaExpanded !== null
            ? 'Toggles expandable section'
            : 'Controls related element',
        targetSelector: ariaControls ? `#${ariaControls}` : undefined,
        relationship: ariaControls ? 'aria_controls' : 'triggers_dropdown',
      };
    }
  }

  // Find container relationship
  const containsRel = graphRelationships.find((r) => r.relationship === 'contains');
  if (containsRel) {
    relationships.containedBy = {
      description: `Inside '${containsRel.source.name || 'container'}'`,
      selector: containsRel.source.selector,
      containerType: inferContainerType(containsRel),
    };
  } else {
    // Find container by walking up the DOM
    const container = findSignificantContainer(element);
    if (container) {
      relationships.containedBy = container;
    }
  }

  // Find grouping relationship
  const groupsRel = graphRelationships.find((r) => r.relationship === 'groups');
  if (groupsRel) {
    const siblings = document.querySelectorAll(`${groupsRel.source.selector} input, ${groupsRel.source.selector} button`);
    relationships.groupedWith = {
      description: `Part of group '${groupsRel.source.name || 'field group'}'`,
      siblingCount: siblings.length,
      groupSelector: groupsRel.source.selector,
    };
  }

  return relationships;
}

/**
 * Describe what an element triggers
 */
function describeTrigger(element: Element, relationship: ElementRelationship): string {
  const role = element.getAttribute('role');
  const type = (element as HTMLInputElement).type;

  if (role === 'combobox' || role === 'listbox') {
    return 'Opens dropdown menu';
  }
  if (role === 'button' || element.tagName === 'BUTTON') {
    if (type === 'submit') {
      return 'Submits form';
    }
    const text = (element as HTMLElement).textContent?.trim().toLowerCase() || '';
    if (text.includes('open') || text.includes('show')) {
      return 'Opens dialog/panel';
    }
    if (text.includes('close') || text.includes('cancel')) {
      return 'Closes dialog/panel';
    }
  }

  return `Triggers ${relationship.target.name || 'related element'}`;
}

/**
 * Container types for element relationships
 */
type ContainerType = 'form' | 'fieldset' | 'section' | 'modal' | 'widget' | 'table' | 'row';

/**
 * Infer container type from relationship
 */
function inferContainerType(relationship: ElementRelationship): ContainerType {
  const sourceRole = relationship.source.role?.toLowerCase();
  const sourceName = relationship.source.name?.toLowerCase() || '';

  if (sourceRole === 'form' || sourceName.includes('form')) return 'form';
  if (sourceRole === 'group' || sourceName.includes('fieldset')) return 'fieldset';
  if (sourceRole === 'dialog') return 'modal';
  if (sourceRole === 'table' || sourceRole === 'grid') return 'table';
  if (sourceRole === 'row') return 'row';
  if (sourceName.includes('widget') || sourceName.includes('card')) return 'widget';

  return 'section';
}

/**
 * Find a significant container element walking up the DOM
 */
function findSignificantContainer(element: Element): RecordedElementRelationships['containedBy'] | undefined {
  let current = element.parentElement;
  let depth = 0;
  const maxDepth = 10;

  while (current && depth < maxDepth) {
    const role = current.getAttribute('role');
    const tagName = current.tagName.toLowerCase();
    const className = current.className?.toString()?.toLowerCase() || '';
    const id = current.id?.toLowerCase() || '';

    // Check for significant containers
    if (role === 'dialog' || role === 'alertdialog') {
      return {
        description: `Inside modal '${getContainerName(current)}'`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'modal',
      };
    }
    if (tagName === 'form' || role === 'form') {
      return {
        description: `Inside form '${getContainerName(current)}'`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'form',
      };
    }
    if (tagName === 'fieldset' || role === 'group') {
      return {
        description: `Inside fieldset '${getContainerName(current)}'`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'fieldset',
      };
    }
    if (tagName === 'table' || role === 'table' || role === 'grid') {
      return {
        description: `Inside table`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'table',
      };
    }
    if (role === 'row' || tagName === 'tr') {
      return {
        description: `Inside table row`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'row',
      };
    }
    if (
      className.includes('widget') ||
      className.includes('card') ||
      id.includes('widget') ||
      id.includes('card')
    ) {
      return {
        description: `Inside widget '${getContainerName(current)}'`,
        selector: SelectorEngine.generateSelectors(current).primary,
        containerType: 'widget',
      };
    }
    if (tagName === 'section' || className.includes('section')) {
      const name = getContainerName(current);
      if (name) {
        return {
          description: `Inside section '${name}'`,
          selector: SelectorEngine.generateSelectors(current).primary,
          containerType: 'section',
        };
      }
    }

    current = current.parentElement;
    depth++;
  }

  return undefined;
}

/**
 * Get a human-readable name for a container
 */
function getContainerName(container: Element): string {
  // Try aria-label first
  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Try aria-labelledby
  const labelledBy = container.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent) {
      return labelEl.textContent.trim().substring(0, 50);
    }
  }

  // Try finding a heading inside
  const heading = container.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
  if (heading?.textContent) {
    return heading.textContent.trim().substring(0, 50);
  }

  // Try the legend for fieldsets
  if (container.tagName === 'FIELDSET') {
    const legend = container.querySelector('legend');
    if (legend?.textContent) {
      return legend.textContent.trim().substring(0, 50);
    }
  }

  // Fallback to title or id
  const title = container.getAttribute('title');
  if (title) return title;

  const id = container.id;
  if (id) return id;

  return '';
}

/**
 * Capture Level 3: Alternative Elements
 */
function captureAlternatives(element: Element): RecordedAlternatives {
  // Find similar elements using existing ElementSimilarity
  const similarElements = ElementSimilarity.findSimilarElements(element);
  const uniquenessScore = ElementSimilarity.getUniquenessScore(element, similarElements);
  const disambiguationAttrs = ElementSimilarity.getDisambiguationAttributes(element, similarElements);

  // Build alternatives list
  const alternatives: RecordedAlternatives['similarElements'] = similarElements
    .slice(0, 5) // Limit to top 5
    .map((el) => {
      const elSelector = SelectorEngine.generateSelectors(el).primary;
      const elText = (el as HTMLElement).textContent?.trim().substring(0, 50);
      const elRole = el.getAttribute('role') || el.tagName.toLowerCase();

      // Calculate what makes the chosen element different
      const differentiator = findDifferentiator(element, el);

      return {
        selector: elSelector,
        text: elText,
        role: elRole,
        similarityScore: calculateSimilarity(element, el),
        differentiator,
      };
    });

  // Build selection reason
  const selectionReason = buildSelectionReason(element, similarElements, uniquenessScore);

  // Build disambiguators from attributes
  const disambiguators: string[] = [];
  for (const [attr, value] of Object.entries(disambiguationAttrs)) {
    if (attr === 'text') {
      disambiguators.push(`text '${value}'`);
    } else if (attr === 'aria-label') {
      disambiguators.push(`labeled '${value}'`);
    } else if (attr === 'id') {
      disambiguators.push(`id '${value}'`);
    } else if (attr === 'data-testid') {
      disambiguators.push(`test-id '${value}'`);
    } else {
      disambiguators.push(`${attr}='${value}'`);
    }
  }

  return {
    similarElements: alternatives,
    selectionReason,
    uniquenessScore,
    disambiguators,
  };
}

/**
 * Find what differentiates the chosen element from an alternative
 */
function findDifferentiator(chosen: Element, alternative: Element): string {
  // Compare text
  const chosenText = (chosen as HTMLElement).textContent?.trim() || '';
  const altText = (alternative as HTMLElement).textContent?.trim() || '';
  if (chosenText !== altText && chosenText) {
    return `Different text: '${chosenText.substring(0, 30)}' vs '${altText.substring(0, 30)}'`;
  }

  // Compare position
  const chosenRect = chosen.getBoundingClientRect();
  const altRect = alternative.getBoundingClientRect();
  if (Math.abs(chosenRect.top - altRect.top) > 50) {
    return chosenRect.top < altRect.top ? 'Higher on page' : 'Lower on page';
  }
  if (Math.abs(chosenRect.left - altRect.left) > 50) {
    return chosenRect.left < altRect.left ? 'More to the left' : 'More to the right';
  }

  // Compare attributes
  const chosenId = chosen.id;
  const altId = alternative.id;
  if (chosenId && chosenId !== altId) {
    return `Has id '${chosenId}'`;
  }

  const chosenLabel = chosen.getAttribute('aria-label');
  const altLabel = alternative.getAttribute('aria-label');
  if (chosenLabel && chosenLabel !== altLabel) {
    return `Has label '${chosenLabel}'`;
  }

  return 'More specific selector match';
}

/**
 * Calculate similarity between two elements (0-1)
 */
function calculateSimilarity(element1: Element, element2: Element): number {
  let score = 0;
  let checks = 0;

  // Same tag
  checks++;
  if (element1.tagName === element2.tagName) score++;

  // Same role
  checks++;
  if (element1.getAttribute('role') === element2.getAttribute('role')) score++;

  // Same type (for inputs)
  checks++;
  if ((element1 as HTMLInputElement).type === (element2 as HTMLInputElement).type) score++;

  // Similar class
  checks++;
  const classes1 = new Set(element1.className?.toString()?.split(/\s+/) || []);
  const classes2 = new Set(element2.className?.toString()?.split(/\s+/) || []);
  const intersection = [...classes1].filter((c) => classes2.has(c));
  if (intersection.length > 0) score++;

  return score / checks;
}

/**
 * Build a human-readable reason for why this element was selected
 */
function buildSelectionReason(
  element: Element,
  similarElements: Element[],
  uniquenessScore: number
): string {
  if (uniquenessScore === 1 || similarElements.length === 0) {
    return 'Only matching element on page';
  }

  const text = (element as HTMLElement).textContent?.trim();
  if (text) {
    return `Exact text match '${text.substring(0, 30)}'`;
  }

  const label = element.getAttribute('aria-label');
  if (label) {
    return `Exact label match '${label}'`;
  }

  const id = element.id;
  if (id) {
    return `Unique ID '${id}'`;
  }

  return `Best match among ${similarElements.length + 1} similar elements`;
}

/**
 * Capture Level 4: Expected Outcomes
 * Uses rule-based inference based on element type, role, and page context
 */
function captureExpectations(
  element: Element,
  _actionType: 'click' | 'input' | 'keyboard' | 'scroll',
  pageModel: PageModel,
  _value?: string
): RecordedExpectations {
  const role = element.getAttribute('role') || element.tagName.toLowerCase();
  const text = (element as HTMLElement).textContent?.trim().substring(0, 50) || '';
  const ariaExpanded = element.getAttribute('aria-expanded');
  const ariaHasPopup = element.getAttribute('aria-haspopup');
  const type = (element as HTMLInputElement).type;

  // Generate expectations based on element characteristics and page type
  const expectations = generateExpectationsForRecording(
    role,
    text,
    type,
    ariaExpanded,
    ariaHasPopup,
    pageModel.pageType.type
  );

  // Build primary expectation
  const primary = expectations[0] || {
    type: 'page_stable' as ExpectedOutcomeType,
    confidence: 0.5,
    timeoutMs: 3000,
  };

  const result: RecordedExpectations = {
    primary: {
      type: primary.type,
      description: describeExpectation(primary.type, primary.details),
      confidence: primary.confidence,
      timeoutMs: primary.timeoutMs,
    },
  };

  // Add alternative expectations
  if (expectations.length > 1) {
    result.alternatives = expectations.slice(1, 3).map((exp) => ({
      type: exp.type,
      description: describeExpectation(exp.type, exp.details),
      confidence: exp.confidence,
    }));
  }

  // Add failure indicators
  result.failureIndicators = inferFailureIndicators(_actionType, pageModel);

  return result;
}

/**
 * Simple expectation inference for recording (without full AgentAction)
 */
function generateExpectationsForRecording(
  role: string,
  text: string,
  inputType: string | undefined,
  ariaExpanded: string | null,
  ariaHasPopup: string | null,
  pageType: string
): Array<{ type: ExpectedOutcomeType; confidence: number; timeoutMs: number; details?: Record<string, unknown> }> {
  const expectations: Array<{ type: ExpectedOutcomeType; confidence: number; timeoutMs: number; details?: Record<string, unknown> }> = [];

  // Combobox/listbox -> dropdown opens
  if (role === 'combobox' || role === 'listbox' || ariaHasPopup === 'listbox') {
    expectations.push({
      type: 'dropdown_opens',
      confidence: 0.9,
      timeoutMs: 2000,
      details: { dropdownOpens: true },
    });
  }

  // Option/menuitem -> dropdown closes
  if (role === 'option' || role === 'menuitem') {
    expectations.push({
      type: 'dropdown_closes',
      confidence: 0.85,
      timeoutMs: 1000,
      details: { dropdownCloses: true },
    });
  }

  // Button with aria-expanded -> toggle state
  if ((role === 'button' || role === 'button') && ariaExpanded !== null) {
    if (ariaExpanded === 'false') {
      expectations.push({
        type: 'dropdown_opens',
        confidence: 0.8,
        timeoutMs: 1500,
      });
    } else {
      expectations.push({
        type: 'dropdown_closes',
        confidence: 0.8,
        timeoutMs: 1000,
      });
    }
  }

  // Submit/save/create buttons -> loading
  const submitPattern = /submit|save|create|update|confirm|continue|next|send|ok|done/i;
  if ((role === 'button' || inputType === 'submit') && submitPattern.test(text)) {
    expectations.push({
      type: 'loading_starts',
      confidence: 0.75,
      timeoutMs: 5000,
    });
  }

  // Close/cancel/dismiss buttons in modal context
  const closePattern = /close|cancel|dismiss|x|×/i;
  if ((role === 'button' || role === 'link') && closePattern.test(text) && pageType === 'modal') {
    expectations.push({
      type: 'modal_closes',
      confidence: 0.9,
      timeoutMs: 1500,
    });
  }

  // Menu button -> menu opens
  const menuPattern = /menu|more|options|actions|\.\.\./i;
  if (role === 'button' && menuPattern.test(text)) {
    expectations.push({
      type: 'dropdown_opens',
      confidence: 0.8,
      timeoutMs: 1500,
    });
  }

  // Textbox/input -> value updates
  if (role === 'textbox' || role === 'spinbutton' || inputType === 'text' || inputType === 'email' || inputType === 'number') {
    expectations.push({
      type: 'value_updates',
      confidence: 0.95,
      timeoutMs: 500,
    });
  }

  // Link -> navigation
  if (role === 'link') {
    expectations.push({
      type: 'navigation',
      confidence: 0.7,
      timeoutMs: 5000,
    });
  }

  // Default: page stable
  if (expectations.length === 0) {
    expectations.push({
      type: 'page_stable',
      confidence: 0.5,
      timeoutMs: 3000,
    });
  }

  // Sort by confidence
  expectations.sort((a, b) => b.confidence - a.confidence);

  return expectations;
}

/**
 * Describe an expected outcome in human-readable terms
 */
function describeExpectation(type: ExpectedOutcomeType, details?: Record<string, unknown>): string {
  switch (type) {
    case 'modal_opens':
      return 'Modal dialog should open';
    case 'modal_closes':
      return 'Modal dialog should close';
    case 'dropdown_opens':
      return 'Dropdown menu should open';
    case 'dropdown_closes':
      return 'Dropdown menu should close';
    case 'value_updates':
      return details?.valueEquals
        ? `Value should update to '${details.valueEquals}'`
        : 'Input value should update';
    case 'navigation':
      return details?.urlContains
        ? `Should navigate to URL containing '${details.urlContains}'`
        : 'Page should navigate';
    case 'loading_starts':
      return 'Loading indicator should appear';
    case 'loading_ends':
      return 'Loading should complete';
    case 'content_appears':
      return details?.textAppears
        ? `Text '${details.textAppears}' should appear`
        : 'New content should appear';
    case 'content_disappears':
      return details?.textDisappears
        ? `Text '${details.textDisappears}' should disappear`
        : 'Content should disappear';
    case 'error_appears':
      return 'Error message may appear';
    case 'success_message':
      return 'Success message should appear';
    case 'page_stable':
      return 'Page should remain stable';
    default:
      return 'Action should complete';
  }
}

/**
 * Infer common failure indicators for an action
 */
function inferFailureIndicators(
  actionType: string,
  pageModel: PageModel
): RecordedExpectations['failureIndicators'] {
  const indicators: RecordedExpectations['failureIndicators'] = [];

  // Common error patterns
  indicators.push({
    type: 'error_message',
    pattern: '(error|failed|invalid|required|cannot|unable)',
    description: 'Error message appears',
  });

  // For form pages, validation errors are common
  if (pageModel.pageType.type === 'form') {
    indicators.push({
      type: 'error_message',
      pattern: '(please enter|required field|invalid format)',
      description: 'Validation error appears',
    });
  }

  // Unexpected navigation (element click causing unwanted navigation)
  if (actionType === 'click') {
    indicators.push({
      type: 'unexpected_navigation',
      description: 'Page navigated unexpectedly',
    });
  }

  // Timeout is always a potential failure
  indicators.push({
    type: 'timeout',
    description: 'Action timed out',
  });

  return indicators;
}

/**
 * Quick helper to capture minimal context without full PageModel
 * Use this for fast recording when PageModel isn't available
 */
export function captureMinimalContext(
  element: Element,
  _actionType: 'click' | 'input' | 'keyboard' | 'scroll'
): Partial<PageModelRecordingContext> {
  const alternatives = captureAlternatives(element);

  return {
    capturedAt: Date.now(),
    pageModelConfidence: 0,
    alternatives,
  };
}
