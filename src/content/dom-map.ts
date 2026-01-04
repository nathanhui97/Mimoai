/**
 * DOM Map Generator
 * 
 * Creates a simplified, semantic view of the current page for the AI agent.
 * This is much cheaper than screenshots and gives the agent structured data
 * to work with.
 * 
 * The DOM map focuses on:
 * - Interactive elements (buttons, links, inputs)
 * - Structural elements (headings, regions, tables)
 * - Current context (modals, dialogs, focused areas)
 * - Shadow DOM traversal (for web components like Gainsight, Salesforce Lightning)
 */

import { computeAccessibleName } from '../lib/accessible-name';
import { ShadowDOMUtils } from './shadow-dom-utils';

// ============================================================================
// Types
// ============================================================================

export interface DOMMapElement {
  /** Element type/role */
  role: string;
  /** Accessible name (what screen readers say) */
  name: string;
  /** HTML tag */
  tag: string;
  /** Visible text content (truncated) */
  text?: string;
  /** Region/section this element is in */
  region?: string;
  /** Is this element interactive? */
  interactive: boolean;
  /** Element index for disambiguation */
  index?: number;
  /** Additional attributes that might help identify */
  attrs?: {
    id?: string;
    testId?: string;
    placeholder?: string;
    type?: string;
    href?: string;
    value?: string;
    checked?: boolean;
    disabled?: boolean;
  };
  /** Scope path for disambiguation - max 2-4 items: ["Accounts Table", "Row: Pizza Depot"] */
  scopePath?: string[];
  /** Row key - first 1-2 identifier cells for table rows */
  rowKey?: string;
  /** Widget title - closest heading/legend text */
  widgetTitle?: string;
  /** Frame ID - which frame this element is in (0 = main frame) */
  frameId: number;
  /** Is this element inside a Shadow DOM? (for web components) */
  inShadowDOM?: boolean;
  /** Shadow host element tag if in shadow DOM (e.g., "gs-report-widget-element") */
  shadowHost?: string;
}

export interface DOMMapRegion {
  /** Region name/label */
  name: string;
  /** Region role (banner, main, navigation, etc.) */
  role: string;
  /** Elements in this region */
  elements: DOMMapElement[];
}

export interface DOMMap {
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Current focused element (if any) */
  focusedElement?: DOMMapElement;
  /** Active modal/dialog (if any) */
  activeModal?: {
    title?: string;
    elements: DOMMapElement[];
  };
  /** Active dropdown/listbox (if any) - CRITICAL: must interact before other actions */
  activeDropdown?: {
    triggerName?: string;
    options: DOMMapElement[];
  };
  /** Page regions (header, main, sidebar, footer) */
  regions: DOMMapRegion[];
  /** All interactive elements (flattened for quick lookup) */
  interactiveElements: DOMMapElement[];
  /** Form fields */
  formFields: DOMMapElement[];
  /** Headings for page structure */
  headings: Array<{ level: number; text: string }>;
  /** Tables (with row/column counts) */
  tables: Array<{ caption?: string; rows: number; cols: number }>;
  /** Generation timestamp */
  timestamp: number;
  /** UI transition detected (major state change like modal appearing) */
  uiTransitionDetected?: boolean;
}

// Track previous state for transition detection
let previousFormFieldCount = 0;

// ============================================================================
// DOM Map Generator
// ============================================================================

/**
 * Generate a simplified DOM map of the current page
 */
export function generateDOMMap(): DOMMap {
  const startTime = performance.now();
  
  const map: DOMMap = {
    url: window.location.href,
    title: document.title,
    regions: [],
    interactiveElements: [],
    formFields: [],
    headings: [],
    tables: [],
    timestamp: Date.now(),
  };
  
  // Check for active modal first
  let modal = findActiveModal();
  
  // HEURISTIC: If no modal found by traditional means, but we have many form fields (15+),
  // try to infer a modal by looking for a container with lots of inputs
  if (!modal) {
    const allFormFields = document.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]');
    if (allFormFields.length >= 15) {
      // Find the closest common ancestor that contains most of these fields
      const containers = document.querySelectorAll('[class*="container"], [class*="form"], [class*="panel"], section, main');
      for (const container of containers) {
        if (!isVisible(container)) continue;
        
        const fieldsInContainer = container.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]');
        // If this container has 80%+ of all fields, it's likely a modal
        if (fieldsInContainer.length >= allFormFields.length * 0.8) {
          modal = container;
          console.log('[DOMMap] 🔔 Modal inferred by form field heuristic:', fieldsInContainer.length, 'fields');
          break;
        }
      }
    }
  }
  
  if (modal) {
    // Get modal form fields and interactive elements
    const modalFormFields = getFormFields(modal);
    const modalInteractiveElements = getInteractiveElements(modal);
    
    // CRITICAL: Ignore empty modals (false positives - likely hidden overlays/notifications)
    // A real modal that users need to interact with MUST have at least some interactive elements
    if (modalInteractiveElements.length === 0 && modalFormFields.length === 0) {
      console.log('[DOMMap] ⚠️ Ignoring detected modal - it has 0 interactive elements and 0 form fields (likely false positive)');
      modal = null; // Treat as no modal
    } else {
      map.activeModal = {
        title: getModalTitle(modal),
        elements: modalInteractiveElements,
      };
      
      // When modal is active, ONLY return modal content
      map.formFields = modalFormFields;
      map.interactiveElements = modalInteractiveElements;
      
      console.log('[DOMMap] 🔔 Active modal detected:', map.activeModal.title, 'with', modalInteractiveElements.length, 'interactive elements and', modalFormFields.length, 'form fields');
    }
  }
  
  if (!modal) {
    // No modal - get page content
    
    // Get regions
    map.regions = getPageRegions();
    
    // Get all interactive elements (for flat lookup)
    map.interactiveElements = getInteractiveElements(document.body);
    
    // Get form fields
    map.formFields = getFormFields(document.body);
  }
  
  // CRITICAL: Detect UI transitions (modal appearing, wizard step changing, etc.)
  const currentFormFieldCount = map.formFields.length;
  
  let uiTransitionDetected = false;
  if (previousFormFieldCount > 0) {
    // Check for major field count increase (modal/dialog appeared)
    const fieldIncrease = currentFormFieldCount - previousFormFieldCount;
    const percentIncrease = (fieldIncrease / previousFormFieldCount) * 100;
    
    // If fields increased by 5+ or doubled, likely a modal/drawer/wizard step appeared
    if (fieldIncrease >= 5 || percentIncrease > 100) {
      uiTransitionDetected = true;
      console.log(`[DOMMap] 🔄 UI transition detected: fields ${previousFormFieldCount} → ${currentFormFieldCount} (+${fieldIncrease})`);
    }
  }
  
  map.uiTransitionDetected = uiTransitionDetected;
  
  // Update state tracking
  previousFormFieldCount = currentFormFieldCount;
  
  // CRITICAL: Check for open dropdown/listbox AFTER getting interactive elements
  // Skip dropdown detection if:
  // 1. UI transition just happened (old dropdown is stale)
  // 2. Modal is active (dropdowns inside modal are scoped, not global)
  if (!uiTransitionDetected && !modal) {
    const dropdown = findActiveDropdown();
    if (dropdown) {
      map.activeDropdown = dropdown;
      console.log('[DOMMap] 🔽 Active dropdown detected with', dropdown.options.length, 'options:', 
        dropdown.options.map(o => o.name || o.text).join(', '));
    }
  } else if (uiTransitionDetected) {
    console.log('[DOMMap] ⏭️ Skipping dropdown detection due to UI transition');
  } else if (modal) {
    console.log('[DOMMap] ⏭️ Skipping dropdown detection due to active modal (dropdowns scoped to modal)');
  }
  
  // Get focused element
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    map.focusedElement = elementToMapElement(focused);
  }
  
  // Get headings
  map.headings = getHeadings(modal || document.body);
  
  // Get tables
  map.tables = getTables(modal || document.body);
  
  const elapsed = performance.now() - startTime;
  console.log(`[DOMMap] Generated in ${elapsed.toFixed(1)}ms:`, {
    regions: map.regions.length,
    interactive: map.interactiveElements.length,
    formFields: map.formFields.length,
    headings: map.headings.length,
    tables: map.tables.length,
    hasModal: !!map.activeModal,
    uiTransition: uiTransitionDetected,
  });
  
  return map;
}

/**
 * Generate a compact text representation of the DOM map for AI consumption
 * This is what gets sent to the LLM
 */
export function domMapToText(map: DOMMap): string {
  const lines: string[] = [];
  
  lines.push(`URL: ${map.url}`);
  lines.push(`Title: ${map.title}`);
  lines.push('');
  
  // HIGHEST PRIORITY: Active dropdown takes precedence over EVERYTHING
  // Typing into fields while dropdown is open will CLOSE it!
  if (map.activeDropdown) {
    lines.push('=== 🚨 DROPDOWN IS OPEN - MUST SELECT AN OPTION NOW 🚨 ===');
    lines.push('⚠️ DO NOT type into any field - it will close this dropdown!');
    lines.push('⚠️ You MUST click one of the options below FIRST');
    if (map.activeDropdown.triggerName) {
      lines.push(`Dropdown for: "${map.activeDropdown.triggerName}"`);
    }
    lines.push('');
    lines.push('## 👇 CLICK ONE OF THESE OPTIONS:');
    for (const opt of map.activeDropdown.options) {
      lines.push(`  [option] "${opt.name || opt.text}" ${opt.attrs?.testId ? `testid="${opt.attrs.testId}"` : ''}`);
    }
    lines.push('');
    lines.push('INSTRUCTION: Return {"action": "click", "target": {"role": "option", "text": "<option text>"}}');
    lines.push('');
    // Don't return early - still show other context but make dropdown priority clear
  }
  
  // Active modal takes next precedence
  if (map.activeModal) {
    lines.push(`=== ACTIVE MODAL: ${map.activeModal.title || 'Dialog'} ===`);
    lines.push('⚠️ A modal/popup is open - you MUST interact with it first!');
    lines.push('');
    
    // Show modal form fields first
    const modalFormFields = map.formFields; // These are already from modal since modal was detected
    if (modalFormFields.length > 0) {
      lines.push('## Form Fields in Modal');
      for (const field of modalFormFields.slice(0, 20)) {
        lines.push(formatElement(field));
      }
      lines.push('');
    }
    
    // Show modal interactive elements
    lines.push('## Modal Actions');
    for (const el of map.activeModal.elements) {
      lines.push(formatElement(el));
    }
    lines.push('');
    lines.push('💡 TIP: Look for buttons to close modal, confirm action, or navigate within modal');
    return lines.join('\n');
  }
  
  // Headings (page structure)
  if (map.headings.length > 0) {
    lines.push('## Page Structure');
    for (const h of map.headings.slice(0, 10)) {
      lines.push(`${'  '.repeat(h.level - 1)}H${h.level}: ${h.text}`);
    }
    lines.push('');
  }
  
  // Form fields
  if (map.formFields.length > 0) {
    lines.push('## Form Fields');
    for (const field of map.formFields.slice(0, 20)) {
      lines.push(formatElement(field));
    }
    lines.push('');
  }
  
  // Interactive elements (buttons, links)
  if (map.interactiveElements.length > 0) {
    lines.push('## Actions Available');
    // Deduplicate and limit
    const seen = new Set<string>();
    let count = 0;
    for (const el of map.interactiveElements) {
      if (count >= 30) break;
      const key = `${el.role}:${el.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(formatElement(el));
      count++;
    }
    lines.push('');
  }
  
  // Tables
  if (map.tables.length > 0) {
    lines.push('## Tables');
    for (const t of map.tables) {
      lines.push(`- Table${t.caption ? ` "${t.caption}"` : ''}: ${t.rows} rows × ${t.cols} cols`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

function findActiveModal(): Element | null {
  // EXCLUSION: Skip known non-modal patterns (app headers, nav bars, etc.)
  const excludePatterns = [
    '[class*="global-header"]',
    '[class*="header_container"]',
    '[class*="context-bar"]',
    '[class*="slds-global-header"]',
    '[class*="navigation"]',
    '[class*="navbar"]',
    '[class*="nav-bar"]',
    'header',
    'nav',
    '[role="banner"]',
    '[role="navigation"]',
  ];
  
  // Look for visible modals/dialogs
  const modals = document.querySelectorAll([
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '.modal',
    '.dialog',
    '[data-modal]',
    // Common modal class patterns
    '[class*="Modal"]',
    '[class*="popup"]',
    '[class*="overlay"]',
    '[class*="Popup"]',
    // MUI/React patterns
    '[class*="MuiDialog"]',
    '[class*="Dialog-root"]',
    // Base UI / React portals
    '[class*="BaseModal"]',
    '[data-baseweb="modal"]',
    // Salesforce patterns
    '[class*="slds-modal"]',
    '[class*="forceModal"]',
  ].join(', '));
  
  for (const modal of modals) {
    if (!isVisible(modal)) continue;
    
    // Skip if matches exclusion pattern
    let shouldExclude = false;
    for (const pattern of excludePatterns) {
      if (modal.matches(pattern) || modal.closest(pattern)) {
        console.log(`[DOMMap] ⏭️ Skipping modal candidate - matches exclusion pattern:`, pattern);
        shouldExclude = true;
        break;
      }
    }
    if (shouldExclude) continue;
    
    const style = window.getComputedStyle(modal);
    const zIndex = parseInt(style.zIndex) || 0;
    const position = style.position;
    
    // LENIENT criteria: Check multiple signals (not all required)
    let modalScore = 0;
    
    // Positioned (fixed/absolute) +30
    if (position === 'fixed' || position === 'absolute') modalScore += 30;
    
    // Z-index > 50 (lowered from 100) +30
    if (zIndex > 50) modalScore += 30;
    
    // Has backdrop/overlay sibling +20
    const hasBackdrop = !!document.querySelector('[class*="backdrop"], [class*="overlay"], [class*="Backdrop"]');
    if (hasBackdrop) modalScore += 20;
    
    // Has explicit role +40
    const role = modal.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') modalScore += 40;
    
    // Has aria-modal="true" +40
    if (modal.getAttribute('aria-modal') === 'true') modalScore += 40;
    
    // Contains many form fields (likely a form modal) +20
    const formFieldCount = modal.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]').length;
    if (formFieldCount >= 3) modalScore += 20;
    
    // Large size (covers >40% of viewport) +10
    const rect = modal.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const modalArea = rect.width * rect.height;
    const coverage = (modalArea / viewportArea) * 100;
    if (coverage > 40) modalScore += 10;
    
    // Require at least ONE strong signal for modal detection
    const hasStrongSignal = 
      role === 'dialog' ||
      role === 'alertdialog' ||
      modal.getAttribute('aria-modal') === 'true' ||
      zIndex > 100;
    
    // Decision: score >= 60 AND has strong signal means it's likely a modal
    // Increased threshold from 50 to 60 to reduce false positives
    if (modalScore >= 60 && hasStrongSignal) {
      console.log(`[DOMMap] 🔔 Modal detected with score ${modalScore}:`, {
        zIndex,
        position,
        role,
        formFields: formFieldCount,
        coverage: coverage.toFixed(1) + '%',
        hasStrongSignal,
      });
      return modal;
    }
  }
  
  return null;
}

/**
 * Find an active/open dropdown listbox
 * CRITICAL: When a dropdown is open, the AI MUST interact with it first
 * before doing any other action (like typing) which would close it
 */
function findActiveDropdown(): { triggerName?: string; options: DOMMapElement[] } | null {
  // Look for visible listbox, menu, or options
  const listboxSelectors = [
    '[role="listbox"]',
    '[role="menu"]',
    '[role="listbox"][aria-expanded="true"]',
    'ul[role="listbox"]',
    'div[role="listbox"]',
    // MUI/React patterns
    '[class*="MuiMenu-list"]',
    '[class*="MuiAutocomplete-listbox"]',
    '[class*="Dropdown-menu"]',
    '[class*="dropdown-menu"]',
    '[class*="select-menu"]',
    '[class*="listbox"]',
    // Ant Design
    '[class*="ant-select-dropdown"]',
    '[class*="ant-dropdown"]',
    // Salesforce navigation menu patterns
    '[class*="navMenu"]',
    '[class*="NavigationMenu"]',
    '[aria-label*="Navigation Menu"]',
    'ul[role="menu"][class*="slds-listbox"]',
    'ul[role="menu"][class*="slds-dropdown"]',
    '[id*="navMenuList"]',
    // Other common patterns
    '.dropdown-content:not([hidden])',
    '[data-popper-placement]', // Popper.js managed popups
  ];
  
  for (const selector of listboxSelectors) {
    const candidates = document.querySelectorAll(selector);
    for (const listbox of candidates) {
      if (!isVisible(listbox)) continue;
      
      // Find options within the listbox
      const optionElements = listbox.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], li'
      );
      
      const visibleOptions: DOMMapElement[] = [];
      for (const opt of optionElements) {
        if (!isVisible(opt)) continue;
        
        const mapEl = elementToMapElement(opt);
        // Only include if it has meaningful content
        if (mapEl.name || mapEl.text) {
          visibleOptions.push(mapEl);
        }
      }
      
      // If we found visible options, this is an active dropdown
      if (visibleOptions.length > 0) {
        // Try to find the trigger element (combobox/button that opened it)
        let triggerName: string | undefined;
        const ariaControls = listbox.getAttribute('id');
        if (ariaControls) {
          const trigger = document.querySelector(`[aria-controls="${ariaControls}"], [aria-owns="${ariaControls}"]`);
          if (trigger) {
            triggerName = computeAccessibleName(trigger) || undefined;
          }
        }
        
        return { triggerName, options: visibleOptions };
      }
    }
  }
  
  // Also check for aria-expanded comboboxes and their associated popups
  const expandedComboboxes = document.querySelectorAll('[role="combobox"][aria-expanded="true"]');
  for (const combobox of expandedComboboxes) {
    const listboxId = combobox.getAttribute('aria-controls') || combobox.getAttribute('aria-owns');
    if (listboxId) {
      const listbox = document.getElementById(listboxId);
      if (listbox && isVisible(listbox)) {
        const optionElements = listbox.querySelectorAll('[role="option"], li');
        const visibleOptions: DOMMapElement[] = [];
        
        for (const opt of optionElements) {
          if (!isVisible(opt)) continue;
          const mapEl = elementToMapElement(opt);
          if (mapEl.name || mapEl.text) {
            visibleOptions.push(mapEl);
          }
        }
        
        if (visibleOptions.length > 0) {
          return {
            triggerName: computeAccessibleName(combobox) || undefined,
            options: visibleOptions,
          };
        }
      }
    }
  }
  
  return null;
}

function getModalTitle(modal: Element): string | undefined {
  // Try aria-labelledby
  const labelledBy = modal.getAttribute('aria-labelledby');
  if (labelledBy) {
    const label = document.getElementById(labelledBy);
    if (label) return label.textContent?.trim();
  }
  
  // Try heading inside modal
  const heading = modal.querySelector('h1, h2, h3, [role="heading"]');
  if (heading) return heading.textContent?.trim();
  
  // Try aria-label
  return modal.getAttribute('aria-label') || undefined;
}

function getPageRegions(): DOMMapRegion[] {
  const regions: DOMMapRegion[] = [];
  
  // Standard landmark roles
  const landmarks = [
    { selector: 'header, [role="banner"]', name: 'Header', role: 'banner' },
    { selector: 'nav, [role="navigation"]', name: 'Navigation', role: 'navigation' },
    { selector: 'main, [role="main"]', name: 'Main Content', role: 'main' },
    { selector: 'aside, [role="complementary"]', name: 'Sidebar', role: 'complementary' },
    { selector: 'footer, [role="contentinfo"]', name: 'Footer', role: 'contentinfo' },
  ];
  
  for (const landmark of landmarks) {
    const elements = document.querySelectorAll(landmark.selector);
    for (const el of elements) {
      if (!isVisible(el)) continue;
      
      regions.push({
        name: el.getAttribute('aria-label') || landmark.name,
        role: landmark.role,
        elements: getInteractiveElements(el).slice(0, 10), // Limit per region
      });
    }
  }
  
  return regions;
}

/**
 * Query elements from both light DOM and shadow DOM
 * This is critical for web component-based apps (Gainsight, Salesforce Lightning, etc.)
 */
function querySelectorAllDeep(container: Element, selector: string): Element[] {
  const results: Element[] = [];
  const seen = new Set<Element>();
  
  // Phase 1: Get elements from light DOM
  const lightDOMElements = container.querySelectorAll(selector);
  for (const el of Array.from(lightDOMElements)) {
    results.push(el);
    seen.add(el);
  }
  
  // Phase 2: Traverse shadow DOM to find elements in web components
  // This automatically handles any app using shadow DOM - no app-specific code!
  ShadowDOMUtils.traverseShadowDOM(container.ownerDocument || document, (el) => {
    // Skip if not in our container's subtree
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      const host = rootNode.host;
      // Check if shadow host is within container
      if (!container.contains(host) && host !== container) return;
    } else if (!container.contains(el) && el !== container) {
      return;
    }
    
    // Check if element matches selector
    try {
      if (!el.matches(selector)) return;
    } catch {
      return;
    }
    
    // Skip if we already found this element (avoid duplicates)
    if (seen.has(el)) return;
    seen.add(el);
    
    results.push(el);
  });
  
  return results;
}

function getInteractiveElements(container: Element): DOMMapElement[] {
  const elements: DOMMapElement[] = [];
  const interactiveSelector = [
    'button', 'a[href]', '[role="button"]', '[role="link"]',
    '[role="menuitem"]', '[role="tab"]', '[role="option"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
    // Modal-specific selectors
    '[data-dismiss]', '[data-close]', '[aria-label*="close" i]', 
    '[aria-label*="cancel" i]', '[aria-label*="confirm" i]',
    '[aria-label*="submit" i]', '[aria-label*="save" i]',
    // Common class patterns for clickable elements
    '[class*="btn"]', '[class*="Button"]', 
  ].join(', ');
  
  // Use deep query to traverse shadow DOM automatically
  const candidates = querySelectorAllDeep(container, interactiveSelector);
  const indexMap = new Map<string, number>();
  
  // Check if we're in a modal (be less aggressive about skipping)
  const isModal = container.getAttribute('role') === 'dialog' ||
                 container.getAttribute('role') === 'alertdialog' ||
                 container.getAttribute('aria-modal') === 'true' ||
                 container.closest('[role="dialog"], [aria-modal="true"]');
  
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    if (isDisabled(el)) continue;
    
    const mapEl = elementToMapElement(el);
    
    // For modals, include more elements (even unlabeled ones)
    // Many modal buttons are icon-only (close X, navigation arrows, etc.)
    if (!isModal && !mapEl.name && !mapEl.text) {
      continue; // Skip unlabeled elements outside modals
    }
    
    // For unlabeled elements in modals, add descriptive info
    if (isModal && !mapEl.name && !mapEl.text) {
      // Try to describe by visual cues
      const className = el.className?.toString() || '';
      const hasCloseIcon = el.querySelector('svg') || 
                          className.toLowerCase().includes('close') || 
                          className.toLowerCase().includes('dismiss') ||
                          className.toLowerCase().includes('cancel') ||
                          el.getAttribute('aria-label')?.toLowerCase().includes('close');
      
      const hasConfirmIcon = className.toLowerCase().includes('confirm') ||
                            className.toLowerCase().includes('submit') ||
                            className.toLowerCase().includes('save') ||
                            className.toLowerCase().includes('ok');
      
      if (hasCloseIcon) {
        mapEl.name = 'Close/Cancel';
      } else if (hasConfirmIcon) {
        mapEl.name = 'Confirm/Submit';
      } else {
        // Check position in modal (close buttons often top-right)
        const rect = el.getBoundingClientRect();
        const modalRect = (container as Element).getBoundingClientRect();
        const isTopRight = rect.right > modalRect.right - 50 && 
                          rect.top < modalRect.top + 50;
        if (isTopRight) {
          mapEl.name = 'Close (top-right)';
        } else {
          // Include with role and position hint
          mapEl.name = `(${mapEl.role} button)`;
        }
      }
    }
    
    // Track index for disambiguation
    const key = `${mapEl.role}:${mapEl.name}`;
    const index = (indexMap.get(key) || 0) + 1;
    indexMap.set(key, index);
    if (index > 1) mapEl.index = index;
    
    elements.push(mapEl);
  }
  
  return elements;
}

function getFormFields(container: Element): DOMMapElement[] {
  const elements: DOMMapElement[] = [];
  const fieldSelector = 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"], [role="searchbox"], [role="spinbutton"]';
  
  // Use deep query to traverse shadow DOM automatically  
  const candidates = querySelectorAllDeep(container, fieldSelector);
  
  console.log(`[DOMMap] getFormFields found ${candidates.length} candidates in`, container.tagName || 'container');
  
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    
    if (!isVisible(el)) {
      // Skipping invisible field
      continue;
    }
    if (isDisabled(el)) {
      console.log(`[DOMMap] ⏭️ Skipping disabled field:`, tag, role);
      continue;
    }
    
    // Skip hidden inputs
    if (el instanceof HTMLInputElement && el.type === 'hidden') {
      console.log(`[DOMMap] ⏭️ Skipping hidden input`);
      continue;
    }
    
    const mapEl = elementToMapElement(el);
    elements.push(mapEl);
  }
  
  console.log(`[DOMMap] Returning ${elements.length} form fields`);
  return elements;
}

function getHeadings(container: Element): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  
  const candidates = container.querySelectorAll(headingSelector);
  
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    
    const text = el.textContent?.trim();
    if (!text) continue;
    
    let level = 1;
    if (el.tagName.match(/^H([1-6])$/)) {
      level = parseInt(el.tagName[1]);
    } else {
      level = parseInt(el.getAttribute('aria-level') || '2');
    }
    
    headings.push({ level, text: text.substring(0, 100) });
  }
  
  return headings;
}

function getTables(container: Element): Array<{ caption?: string; rows: number; cols: number }> {
  const tables: Array<{ caption?: string; rows: number; cols: number }> = [];
  
  const tableCandidates = container.querySelectorAll('table, [role="grid"], [role="table"]');
  
  for (const el of tableCandidates) {
    if (!isVisible(el)) continue;
    
    const caption = el.querySelector('caption')?.textContent?.trim() ||
                   el.getAttribute('aria-label') ||
                   undefined;
    
    const rows = el.querySelectorAll('tr, [role="row"]').length;
    const firstRow = el.querySelector('tr, [role="row"]');
    const cols = firstRow?.querySelectorAll('td, th, [role="cell"], [role="columnheader"]').length || 0;
    
    if (rows > 0) {
      tables.push({ caption, rows, cols });
    }
  }
  
  return tables;
}

function elementToMapElement(el: Element, frameId: number = 0): DOMMapElement {
  const tag = el.tagName.toLowerCase();
  const role = getRole(el);
  const name = computeAccessibleName(el) || '';
  const text = getVisibleText(el);
  
  const mapEl: DOMMapElement = {
    role,
    name,
    tag,
    text: text !== name ? text : undefined, // Don't duplicate
    interactive: isInteractive(el),
    frameId,
  };
  
  // Detect if element is inside Shadow DOM (for web components)
  const rootNode = el.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    mapEl.inShadowDOM = true;
    mapEl.shadowHost = rootNode.host.tagName.toLowerCase();
  }
  
  // Compute scope identity for disambiguation
  mapEl.scopePath = computeScopePath(el);
  mapEl.rowKey = computeRowKey(el);
  mapEl.widgetTitle = findWidgetTitle(el);
  
  // Add useful attributes
  const attrs: DOMMapElement['attrs'] = {};
  
  const id = el.getAttribute('id');
  if (id) attrs.id = id;
  
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
  if (testId) attrs.testId = testId;
  
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) attrs.placeholder = el.placeholder;
    if (el instanceof HTMLInputElement) {
      attrs.type = el.type;
      if (el.type === 'checkbox' || el.type === 'radio') {
        attrs.checked = el.checked;
      }
    }
    if (el.value) attrs.value = el.value.substring(0, 50);
  }
  
  if (el instanceof HTMLAnchorElement && el.href) {
    attrs.href = el.href;
  }
  
  if (isDisabled(el)) {
    attrs.disabled = true;
  }
  
  if (Object.keys(attrs).length > 0) {
    mapEl.attrs = attrs;
  }
  
  return mapEl;
}

function getRole(el: Element): string {
  // Explicit role
  const explicitRole = el.getAttribute('role');
  if (explicitRole) return explicitRole;
  
  // Implicit role from tag
  const tag = el.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    'a': 'link',
    'button': 'button',
    'input': getInputRole(el as HTMLInputElement),
    'textarea': 'textbox',
    'select': 'combobox',
    'img': 'img',
    'table': 'table',
    'tr': 'row',
    'td': 'cell',
    'th': 'columnheader',
    'ul': 'list',
    'ol': 'list',
    'li': 'listitem',
    'nav': 'navigation',
    'main': 'main',
    'header': 'banner',
    'footer': 'contentinfo',
    'aside': 'complementary',
    'form': 'form',
    'h1': 'heading',
    'h2': 'heading',
    'h3': 'heading',
    'h4': 'heading',
    'h5': 'heading',
    'h6': 'heading',
  };
  
  return roleMap[tag] || tag;
}

function getInputRole(el: HTMLInputElement): string {
  const type = (el.type || 'text').toLowerCase();
  const roleMap: Record<string, string> = {
    'text': 'textbox',
    'email': 'textbox',
    'password': 'textbox',
    'search': 'searchbox',
    'tel': 'textbox',
    'url': 'textbox',
    'number': 'spinbutton',
    'checkbox': 'checkbox',
    'radio': 'radio',
    'button': 'button',
    'submit': 'button',
    'reset': 'button',
    'range': 'slider',
    'date': 'textbox',
    'time': 'textbox',
    'datetime-local': 'textbox',
  };
  
  return roleMap[type] || 'textbox';
}

function getVisibleText(el: Element): string | undefined {
  // Get direct text content (not from children)
  let text = '';
  
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  
  text = text.trim();
  
  // If no direct text, try full textContent but truncate
  if (!text) {
    text = el.textContent?.trim() || '';
  }
  
  return text.substring(0, 100) || undefined;
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  
  return true;
}

function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const interactiveTags = ['a', 'button', 'input', 'textarea', 'select'];
  
  if (interactiveTags.includes(tag)) return true;
  if (el.getAttribute('onclick')) return true;
  if (el.getAttribute('role')?.match(/button|link|menuitem|tab|option/)) return true;
  
  const tabindex = el.getAttribute('tabindex');
  if (tabindex && tabindex !== '-1') return true;
  
  return false;
}

function isDisabled(el: Element): boolean {
  if (el.hasAttribute('disabled')) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

/**
 * Compute scope path for an element - only collect from semantic containers
 * Returns max 2-4 items to avoid token bloat
 */
function computeScopePath(element: Element): string[] {
  const path: string[] = [];
  let current = element.parentElement;
  
  // Only collect from these container types
  const containerRoles = ['region', 'dialog', 'tabpanel', 'main', 'complementary', 'navigation'];
  
  while (current && path.length < 4) {
    // Check if this is a meaningful container with a role
    const role = current.getAttribute('role');
    if (role && containerRoles.includes(role)) {
      const title = getContainerTitle(current);
      if (title && !path.includes(title)) {
        path.unshift(title);
      }
    }
    
    // Check for heading within container (direct child only to avoid noise)
    const heading = current.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
    if (heading?.textContent?.trim()) {
      const headingText = heading.textContent.trim().substring(0, 50);
      if (!path.includes(headingText)) {
        path.unshift(headingText);
      }
    }
    
    // Check for Salesforce/Gainsight specific containers
    const dataAuraClass = current.getAttribute('data-aura-class');
    if (dataAuraClass && (dataAuraClass.includes('container') || dataAuraClass.includes('panel'))) {
      const title = getContainerTitle(current);
      if (title && !path.includes(title)) {
        path.unshift(title);
      }
    }
    
    current = current.parentElement;
  }
  
  return path.slice(0, 4); // Hard limit
}

/**
 * Get title/label for a container element
 */
function getContainerTitle(container: Element): string | undefined {
  // Try aria-label
  const ariaLabel = container.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim().substring(0, 50);
  
  // Try aria-labelledby
  const labelledBy = container.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent?.trim()) {
      return labelEl.textContent.trim().substring(0, 50);
    }
  }
  
  // Try legend (for fieldsets)
  const legend = container.querySelector('legend');
  if (legend?.textContent?.trim()) {
    return legend.textContent.trim().substring(0, 50);
  }
  
  return undefined;
}

/**
 * Compute row key for elements in table rows - handles virtualized tables
 * Returns first 1-2 identifier cells (Name/Account, not icons or numbers)
 */
function computeRowKey(element: Element): string | undefined {
  // Find containing row (handles non-tr rows like Salesforce uses)
  const row = element.closest('[role="row"], tr, [data-row-id], [data-record-id]');
  if (!row) return undefined;
  
  // Prefer explicit row identifiers
  const dataRowId = row.getAttribute('data-row-id') || row.getAttribute('data-record-id');
  if (dataRowId && dataRowId.length > 0 && dataRowId.length < 50) {
    return dataRowId;
  }
  
  // Find identifier-like cells (first 2 non-empty, non-icon cells)
  const cells = row.querySelectorAll('[role="cell"], td, [role="gridcell"]');
  const identifierTexts: string[] = [];
  
  for (const cell of cells) {
    if (identifierTexts.length >= 2) break;
    
    const text = cell.textContent?.trim();
    if (!text || text.length < 2) continue;
    
    // Skip icon-only or status cells (has svg/img and short text)
    const hasIcon = cell.querySelector('svg, img, [class*="icon"]');
    if (hasIcon && text.length < 5) continue;
    
    // Skip numeric-only cells (IDs, counts, percents)
    if (/^[\d\s,.%$]+$/.test(text)) continue;
    
    // Skip common status words
    if (/^(active|inactive|enabled|disabled|yes|no|true|false)$/i.test(text)) continue;
    
    identifierTexts.push(text.substring(0, 30));
  }
  
  return identifierTexts.length > 0 ? identifierTexts.join(' | ') : undefined;
}

/**
 * Find the closest widget title (heading) for an element
 * MUST traverse Shadow DOM correctly!
 */
function findWidgetTitle(element: Element): string | undefined {
  let current: Element | null = element.parentElement;
  const maxDepth = 15; // Increased for shadow DOM depth
  let depth = 0;
  
  while (current && depth < maxDepth) {
    // Check shadowRoot FIRST (widget titles are often in shadow DOM!)
    if (current.shadowRoot) {
      const shadowHeading = current.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="title"], [class*="header"]');
      if (shadowHeading?.textContent?.trim()) {
        const title = shadowHeading.textContent.trim();
        // Return full title (don't truncate - we need it for fuzzy matching)
        return title.length > 100 ? title.substring(0, 100) : title;
      }
    }
    
    // Look for headings in light DOM
    const heading = current.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="title"], [class*="header"]');
    if (heading?.textContent?.trim()) {
      const title = heading.textContent.trim();
      return title.length > 100 ? title.substring(0, 100) : title;
    }
    
    // Check if this element itself has a title attribute or aria-label
    const title = current.getAttribute('title') || current.getAttribute('aria-label');
    if (title?.trim()) {
      return title.trim().substring(0, 100);
    }
    
    // Handle shadow DOM boundaries - traverse UP correctly!
    const rootNode = current.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      // Jump to shadow host
      current = rootNode.host;
    } else {
      // Normal DOM traversal
      current = current.parentElement;
    }
    depth++;
  }
  
  return undefined;
}

function formatElement(el: DOMMapElement): string {
  let line = `[${el.role}] "${el.name || el.text || '(unlabeled)'}"`;
  
  // Show testid first (most stable identifier)
  if (el.attrs?.testId) {
    line += ` testid="${el.attrs.testId}"`;
  }
  
  // Show scope identity for disambiguation
  if (el.rowKey) {
    line += ` rowKey="${el.rowKey}"`;
  }
  
  if (el.scopePath && el.scopePath.length > 0) {
    line += ` scope=[${el.scopePath.join(' > ')}]`;
  }
  
  if (el.widgetTitle) {
    line += ` widget="${el.widgetTitle}"`;
  }
  
  if (el.frameId !== 0) {
    line += ` frame=${el.frameId}`;
  }
  
  if (el.index) {
    line += ` (${el.index})`;
  }
  
  if (el.attrs?.id) {
    line += ` id="${el.attrs.id}"`;
  }
  
  if (el.attrs?.placeholder) {
    line += ` placeholder="${el.attrs.placeholder}"`;
  }
  
  if (el.attrs?.value && el.attrs.value !== '0') {
    line += ` value="${el.attrs.value}"`;
  }
  
  if (el.attrs?.checked !== undefined) {
    line += el.attrs.checked ? ' ✓checked' : ' ☐unchecked';
  }
  
  if (el.attrs?.disabled) {
    line += ' (disabled)';
  }
  
  return line;
}

