/**
 * Relationship Graph - Tracks semantic relationships between DOM elements
 *
 * This module detects and maintains a graph of element relationships:
 * - label -> input (via for/aria-labelledby)
 * - button -> dropdown (via aria-controls/aria-expanded)
 * - form -> fieldset -> inputs (parent-child hierarchy)
 * - tab -> tabpanel (via aria-controls)
 *
 * These relationships help with:
 * - Better element resolution (boost score when element has matching relationship)
 * - Understanding context (what elements are related)
 * - Predictive expectations (clicking tab should show panel)
 */

import type {
  RelationshipGraph,
  ElementRelationship,
  RelationshipType,
  ElementIdentifier,
  PageModelConfig,
} from './types';
import type { DOMMap, DOMMapElement } from '../../content/dom-map';

// ============================================================================
// Relationship Graph Builder
// ============================================================================

export class RelationshipGraphBuilder {
  private config: PageModelConfig;

  constructor(config: PageModelConfig) {
    this.config = config;
  }

  /**
   * Build relationship graph from DOM
   * This traverses the DOM once and extracts all relationships
   */
  build(): RelationshipGraph {
    const startTime = performance.now();
    const relationships: ElementRelationship[] = [];

    // 1. Find label relationships
    this.findLabelRelationships(relationships);

    // 2. Find aria-controls relationships
    this.findAriaControlsRelationships(relationships);

    // 3. Find aria-describedby relationships
    this.findAriaDescribedByRelationships(relationships);

    // 4. Find trigger relationships (buttons with aria-haspopup)
    this.findTriggerRelationships(relationships);

    // 5. Find tab-panel relationships
    this.findTabPanelRelationships(relationships);

    // 6. Find form-fieldset-input hierarchy
    this.findFormHierarchy(relationships);

    // 7. Find aria-owns relationships
    this.findAriaOwnsRelationships(relationships);

    // Build lookup maps
    const graph = this.buildGraph(relationships);

    const elapsed = performance.now() - startTime;
    if (this.config.logLevel === 'debug') {
      console.log(`[RelationshipGraph] Built ${relationships.length} relationships in ${elapsed.toFixed(1)}ms`);
    }

    return graph;
  }

  /**
   * Build relationship graph from DOMMap (faster, uses cached data)
   */
  buildFromDOMMap(domMap: DOMMap): RelationshipGraph {
    const startTime = performance.now();
    const relationships: ElementRelationship[] = [];

    // Process form fields
    for (const field of domMap.formFields || []) {
      // Find labels for this field
      if (field.attrs?.id) {
        this.findLabelForField(field, relationships);
      }

      // Check for aria-describedby
      this.checkAriaDescribedBy(field, relationships);
    }

    // Process interactive elements for triggers and controls
    for (const el of domMap.interactiveElements || []) {
      // Check for trigger relationships (buttons with haspopup)
      if (el.role === 'button' || el.tag === 'button') {
        this.checkTriggerRelationship(el, relationships);
      }

      // Check for tab-panel relationships
      if (el.role === 'tab') {
        this.checkTabPanelRelationship(el, relationships);
      }

      // Check for combobox-listbox relationships
      if (el.role === 'combobox') {
        this.checkComboboxRelationship(el, relationships);
      }
    }

    // Build lookup maps
    const graph = this.buildGraph(relationships);

    const elapsed = performance.now() - startTime;
    if (this.config.logLevel === 'debug') {
      console.log(`[RelationshipGraph] Built from DOMMap: ${relationships.length} relationships in ${elapsed.toFixed(1)}ms`);
    }

    return graph;
  }

  // ============================================================================
  // Direct DOM Relationship Detection
  // ============================================================================

  /**
   * Find label -> input relationships
   */
  private findLabelRelationships(relationships: ElementRelationship[]): void {
    // Find labels with 'for' attribute
    const labels = document.querySelectorAll('label[for]');

    for (const label of labels) {
      const forId = label.getAttribute('for');
      if (!forId) continue;

      const target = document.getElementById(forId);
      if (!target) continue;

      relationships.push({
        source: this.elementToIdentifier(label),
        target: this.elementToIdentifier(target),
        relationship: 'labels',
        confidence: 1.0,
        metadata: {
          labelText: label.textContent?.trim(),
        },
      });
    }

    // Find implicit label relationships (input inside label)
    const labelsWithInputs = document.querySelectorAll('label:has(input, select, textarea)');

    for (const label of labelsWithInputs) {
      const input = label.querySelector('input, select, textarea');
      if (!input) continue;

      // Skip if already has explicit 'for'
      if (label.hasAttribute('for')) continue;

      relationships.push({
        source: this.elementToIdentifier(label),
        target: this.elementToIdentifier(input),
        relationship: 'labels',
        confidence: 0.9,
        metadata: {
          labelText: label.textContent?.replace(input.textContent || '', '').trim(),
        },
      });
    }

    // Find aria-labelledby relationships
    const labelledElements = document.querySelectorAll('[aria-labelledby]');

    for (const element of labelledElements) {
      const labelIds = element.getAttribute('aria-labelledby')?.split(/\s+/) || [];

      for (const labelId of labelIds) {
        const label = document.getElementById(labelId);
        if (!label) continue;

        relationships.push({
          source: this.elementToIdentifier(label),
          target: this.elementToIdentifier(element),
          relationship: 'labels',
          confidence: 1.0,
          metadata: {
            labelText: label.textContent?.trim(),
          },
        });
      }
    }
  }

  /**
   * Find aria-controls relationships
   */
  private findAriaControlsRelationships(relationships: ElementRelationship[]): void {
    const controllers = document.querySelectorAll('[aria-controls]');

    for (const controller of controllers) {
      const controlsId = controller.getAttribute('aria-controls');
      if (!controlsId) continue;

      const controlled = document.getElementById(controlsId);
      if (!controlled) continue;

      relationships.push({
        source: this.elementToIdentifier(controller),
        target: this.elementToIdentifier(controlled),
        relationship: 'controls',
        confidence: 1.0,
        metadata: {
          controlsId,
        },
      });
    }
  }

  /**
   * Find aria-describedby relationships
   */
  private findAriaDescribedByRelationships(relationships: ElementRelationship[]): void {
    const describedElements = document.querySelectorAll('[aria-describedby]');

    for (const element of describedElements) {
      const descIds = element.getAttribute('aria-describedby')?.split(/\s+/) || [];

      for (const descId of descIds) {
        const description = document.getElementById(descId);
        if (!description) continue;

        relationships.push({
          source: this.elementToIdentifier(description),
          target: this.elementToIdentifier(element),
          relationship: 'describes',
          confidence: 1.0,
        });
      }
    }
  }

  /**
   * Find trigger relationships (buttons that open menus/dialogs)
   */
  private findTriggerRelationships(relationships: ElementRelationship[]): void {
    const triggers = document.querySelectorAll(
      '[aria-haspopup], [aria-expanded]'
    );

    for (const trigger of triggers) {
      // Get what this trigger controls
      const controlsId = trigger.getAttribute('aria-controls');
      const ownsId = trigger.getAttribute('aria-owns');
      const targetId = controlsId || ownsId;

      let target: Element | null = null;

      if (targetId) {
        target = document.getElementById(targetId);
      } else {
        // Try to find adjacent menu/dropdown
        target = trigger.nextElementSibling;
        if (target && !this.isPopupElement(target)) {
          target = null;
        }
      }

      if (target) {
        relationships.push({
          source: this.elementToIdentifier(trigger),
          target: this.elementToIdentifier(target),
          relationship: 'triggers',
          confidence: targetId ? 1.0 : 0.7,
        });
      }
    }
  }

  /**
   * Find tab-panel relationships
   */
  private findTabPanelRelationships(relationships: ElementRelationship[]): void {
    const tabs = document.querySelectorAll('[role="tab"]');

    for (const tab of tabs) {
      const controlsId = tab.getAttribute('aria-controls');
      if (!controlsId) continue;

      const panel = document.getElementById(controlsId);
      if (!panel) continue;

      if (panel.getAttribute('role') === 'tabpanel') {
        relationships.push({
          source: this.elementToIdentifier(tab),
          target: this.elementToIdentifier(panel),
          relationship: 'controls',
          confidence: 1.0,
          metadata: {
            controlsId,
          },
        });
      }
    }
  }

  /**
   * Find form hierarchy relationships
   */
  private findFormHierarchy(relationships: ElementRelationship[]): void {
    const forms = document.querySelectorAll('form');

    for (const form of forms) {
      // Form contains fieldsets
      const fieldsets = form.querySelectorAll('fieldset');
      for (const fieldset of fieldsets) {
        relationships.push({
          source: this.elementToIdentifier(form),
          target: this.elementToIdentifier(fieldset),
          relationship: 'contains',
          confidence: 1.0,
        });

        // Fieldset groups inputs
        const inputs = fieldset.querySelectorAll('input, select, textarea');
        for (const input of inputs) {
          relationships.push({
            source: this.elementToIdentifier(fieldset),
            target: this.elementToIdentifier(input),
            relationship: 'groups',
            confidence: 1.0,
          });
        }
      }

      // Form contains direct inputs
      const directInputs = form.querySelectorAll(':scope > input, :scope > select, :scope > textarea');
      for (const input of directInputs) {
        relationships.push({
          source: this.elementToIdentifier(form),
          target: this.elementToIdentifier(input),
          relationship: 'contains',
          confidence: 1.0,
        });
      }
    }
  }

  /**
   * Find aria-owns relationships
   */
  private findAriaOwnsRelationships(relationships: ElementRelationship[]): void {
    const owners = document.querySelectorAll('[aria-owns]');

    for (const owner of owners) {
      const ownsIds = owner.getAttribute('aria-owns')?.split(/\s+/) || [];

      for (const ownedId of ownsIds) {
        const owned = document.getElementById(ownedId);
        if (!owned) continue;

        relationships.push({
          source: this.elementToIdentifier(owner),
          target: this.elementToIdentifier(owned),
          relationship: 'owns',
          confidence: 1.0,
        });
      }
    }
  }

  // ============================================================================
  // DOMMap-based Relationship Detection
  // ============================================================================

  /**
   * Find label for a form field (using DOMMap element)
   */
  private findLabelForField(field: DOMMapElement, relationships: ElementRelationship[]): void {
    if (!field.attrs?.id) return;

    // Query DOM for label
    const label = document.querySelector(`label[for="${field.attrs.id}"]`);
    if (label) {
      relationships.push({
        source: {
          role: 'label',
          name: label.textContent?.trim(),
          selector: `label[for="${field.attrs.id}"]`,
        },
        target: {
          role: field.role,
          name: field.name,
          id: field.attrs.id,
          testId: field.attrs.testId,
        },
        relationship: 'labels',
        confidence: 1.0,
        metadata: {
          labelText: label.textContent?.trim(),
        },
      });
    }
  }

  /**
   * Check for aria-describedby on a DOMMap element
   */
  private checkAriaDescribedBy(field: DOMMapElement, relationships: ElementRelationship[]): void {
    if (!field.attrs?.id) return;

    // Query DOM for the actual element
    const element = document.getElementById(field.attrs.id);
    if (!element) return;

    const descIds = element.getAttribute('aria-describedby')?.split(/\s+/) || [];

    for (const descId of descIds) {
      const description = document.getElementById(descId);
      if (!description) continue;

      relationships.push({
        source: {
          id: descId,
          name: description.textContent?.trim(),
        },
        target: {
          role: field.role,
          name: field.name,
          id: field.attrs.id,
        },
        relationship: 'describes',
        confidence: 1.0,
      });
    }
  }

  /**
   * Check for trigger relationships on a button
   */
  private checkTriggerRelationship(el: DOMMapElement, relationships: ElementRelationship[]): void {
    if (!el.attrs?.id) return;

    const element = document.getElementById(el.attrs.id);
    if (!element) return;

    const hasPopup = element.getAttribute('aria-haspopup');
    const isExpanded = element.getAttribute('aria-expanded');
    const controlsId = element.getAttribute('aria-controls');

    if ((hasPopup || isExpanded !== null) && controlsId) {
      const controlled = document.getElementById(controlsId);
      if (controlled) {
        relationships.push({
          source: {
            role: el.role,
            name: el.name,
            id: el.attrs.id,
            testId: el.attrs.testId,
          },
          target: this.elementToIdentifier(controlled),
          relationship: 'triggers',
          confidence: 1.0,
        });
      }
    }
  }

  /**
   * Check for tab-panel relationships
   */
  private checkTabPanelRelationship(el: DOMMapElement, relationships: ElementRelationship[]): void {
    if (!el.attrs?.id) return;

    const tab = document.getElementById(el.attrs.id);
    if (!tab) return;

    const controlsId = tab.getAttribute('aria-controls');
    if (!controlsId) return;

    const panel = document.getElementById(controlsId);
    if (!panel || panel.getAttribute('role') !== 'tabpanel') return;

    relationships.push({
      source: {
        role: el.role,
        name: el.name,
        id: el.attrs.id,
      },
      target: this.elementToIdentifier(panel),
      relationship: 'controls',
      confidence: 1.0,
      metadata: {
        controlsId,
      },
    });
  }

  /**
   * Check for combobox-listbox relationships
   */
  private checkComboboxRelationship(el: DOMMapElement, relationships: ElementRelationship[]): void {
    if (!el.attrs?.id) return;

    const combobox = document.getElementById(el.attrs.id);
    if (!combobox) return;

    const controlsId = combobox.getAttribute('aria-controls') || combobox.getAttribute('aria-owns');
    if (!controlsId) return;

    const listbox = document.getElementById(controlsId);
    if (!listbox) return;

    relationships.push({
      source: {
        role: el.role,
        name: el.name,
        id: el.attrs.id,
      },
      target: this.elementToIdentifier(listbox),
      relationship: 'triggers',
      confidence: 1.0,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Convert DOM element to ElementIdentifier
   */
  private elementToIdentifier(element: Element): ElementIdentifier {
    const role = element.getAttribute('role') || this.inferRole(element);
    const name = element.getAttribute('aria-label') ||
      (element as HTMLElement).innerText?.trim().substring(0, 100);
    const id = element.id || undefined;
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id') || undefined;

    // Build selector
    let selector: string | undefined;
    if (id) {
      selector = `#${id}`;
    } else if (testId) {
      selector = `[data-testid="${testId}"]`;
    }

    return {
      role,
      name,
      id,
      testId,
      selector,
    };
  }

  /**
   * Infer role from element tag
   */
  private inferRole(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const roleMap: Record<string, string> = {
      'button': 'button',
      'a': 'link',
      'input': 'textbox',
      'select': 'combobox',
      'textarea': 'textbox',
      'label': 'label',
      'form': 'form',
      'fieldset': 'group',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
    };
    return roleMap[tag] || tag;
  }

  /**
   * Check if element is a popup (menu, listbox, dialog)
   */
  private isPopupElement(element: Element): boolean {
    const role = element.getAttribute('role');
    return role === 'menu' || role === 'listbox' || role === 'dialog' ||
      role === 'alertdialog' || role === 'tooltip';
  }

  /**
   * Build graph with lookup maps
   */
  private buildGraph(relationships: ElementRelationship[]): RelationshipGraph {
    const bySourceSelector = new Map<string, ElementRelationship[]>();
    const byTargetSelector = new Map<string, ElementRelationship[]>();
    const byType = new Map<RelationshipType, ElementRelationship[]>();

    for (const rel of relationships) {
      // By source
      const sourceKey = rel.source.selector || rel.source.id || rel.source.name || '';
      if (sourceKey) {
        const existing = bySourceSelector.get(sourceKey) || [];
        if (existing.length < this.config.maxRelationshipsPerElement) {
          existing.push(rel);
          bySourceSelector.set(sourceKey, existing);
        }
      }

      // By target
      const targetKey = rel.target.selector || rel.target.id || rel.target.name || '';
      if (targetKey) {
        const existing = byTargetSelector.get(targetKey) || [];
        if (existing.length < this.config.maxRelationshipsPerElement) {
          existing.push(rel);
          byTargetSelector.set(targetKey, existing);
        }
      }

      // By type
      const typeExisting = byType.get(rel.relationship) || [];
      typeExisting.push(rel);
      byType.set(rel.relationship, typeExisting);
    }

    return {
      relationships,
      bySourceSelector,
      byTargetSelector,
      byType,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Build a relationship graph from the current DOM
 */
export function buildRelationshipGraph(config: PageModelConfig): RelationshipGraph {
  const builder = new RelationshipGraphBuilder(config);
  return builder.build();
}

/**
 * Build a relationship graph from a DOMMap (faster)
 */
export function buildRelationshipGraphFromDOMMap(
  domMap: DOMMap,
  config: PageModelConfig
): RelationshipGraph {
  const builder = new RelationshipGraphBuilder(config);
  return builder.buildFromDOMMap(domMap);
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all relationships for an element (as source or target)
 */
export function getRelationshipsFor(
  graph: RelationshipGraph,
  identifier: ElementIdentifier
): ElementRelationship[] {
  const key = identifier.selector || identifier.id || identifier.name;
  if (!key) return [];

  const asSource = graph.bySourceSelector.get(key) || [];
  const asTarget = graph.byTargetSelector.get(key) || [];

  return [...asSource, ...asTarget];
}

/**
 * Get the label text for an element
 */
export function getLabelFor(
  graph: RelationshipGraph,
  identifier: ElementIdentifier
): string | undefined {
  const key = identifier.selector || identifier.id || identifier.name;
  if (!key) return undefined;

  const asTarget = graph.byTargetSelector.get(key) || [];
  const labelRel = asTarget.find(r => r.relationship === 'labels');

  return labelRel?.metadata?.labelText;
}

/**
 * Check if an element is labeled by a specific text
 */
export function isLabeledBy(
  graph: RelationshipGraph,
  elementIdentifier: ElementIdentifier,
  labelText: string
): boolean {
  const label = getLabelFor(graph, elementIdentifier);
  if (!label) return false;

  return label.toLowerCase().includes(labelText.toLowerCase()) ||
    labelText.toLowerCase().includes(label.toLowerCase());
}

/**
 * Get what an element controls (aria-controls target)
 */
export function getControlledElement(
  graph: RelationshipGraph,
  controllerIdentifier: ElementIdentifier
): ElementIdentifier | undefined {
  const key = controllerIdentifier.selector || controllerIdentifier.id || controllerIdentifier.name;
  if (!key) return undefined;

  const asSource = graph.bySourceSelector.get(key) || [];
  const controlsRel = asSource.find(r => r.relationship === 'controls' || r.relationship === 'triggers');

  return controlsRel?.target;
}
