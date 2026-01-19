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
import { isRealModal, isNavigationContext, isSaaSAppContainer, detectModalWithFormHeuristic, detectPersistentPanel } from './modal-detector';

// ============================================================================
// DOM Map Cache (OPTIMIZATION)
// ============================================================================

interface DOMMapCache {
  map: DOMMap | null;
  hash: string;
  timestamp: number;
}

// Cache for DOM map with 200ms TTL
const domMapCache: DOMMapCache = {
  map: null,
  hash: '',
  timestamp: 0,
};

// Cache TTL in milliseconds - DOM maps are valid for a short time
const CACHE_TTL_MS = 200;

/**
 * Generate a quick hash of the current DOM state for cache invalidation
 * This is much faster than generating the full DOM map
 */
function computeDOMHash(): string {
  // Quick hash based on:
  // 1. URL (page changes)
  // 2. Count of interactive elements (rough DOM change detection)
  // 3. Active element (focus changes)
  // 4. Any visible modal/dropdown
  const url = window.location.href;
  const interactiveCount = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"]').length;
  const activeElementTag = document.activeElement?.tagName || 'none';
  const hasModal = document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
  const hasDropdown = document.querySelector('[role="listbox"], [role="menu"]') !== null;
  
  return `${url}|${interactiveCount}|${activeElementTag}|${hasModal}|${hasDropdown}`;
}

/**
 * Invalidate the DOM map cache (call after actions that modify DOM)
 */
export function invalidateDOMMapCache(): void {
  domMapCache.map = null;
  domMapCache.hash = '';
  domMapCache.timestamp = 0;
}

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
    /** If true, this is a persistent UI panel (always visible), not a blocking popup */
    isPersistentPanel?: boolean;
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
 * OPTIMIZATION: Uses caching to avoid repeated full DOM scans
 */
export function generateDOMMap(): DOMMap {
  const startTime = performance.now();
  
  // Check cache first (OPTIMIZATION)
  const currentHash = computeDOMHash();
  const now = Date.now();
  
  if (domMapCache.map && 
      domMapCache.hash === currentHash && 
      (now - domMapCache.timestamp) < CACHE_TTL_MS) {
    console.log(`[DOMMap] ⚡ Cache hit (${now - domMapCache.timestamp}ms old) - skipping full scan`);
    return domMapCache.map;
  }
  
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
  
  // CRITICAL: Check for dropdown FIRST, before modal
  // Dropdowns (like navigation menus) should take precedence over modals
  // This prevents search modals from blocking navigation menu interactions
  const dropdown = findActiveDropdown();
  
  // Check for active modal (only if no dropdown found)
  let modal: Element | null = null;
  if (!dropdown) {
    modal = findActiveModalWithStructuralDetection();
  } else {
    console.log('[DOMMap] ⏭️ Skipping modal detection - dropdown takes priority');
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
      // Check if this is actually a persistent panel (not a blocking modal)
      const rect = modal.getBoundingClientRect();
      const style = window.getComputedStyle(modal);
      const isPersistentPanel = detectPersistentPanel(modal, rect, style);
      
      map.activeModal = {
        title: getModalTitle(modal),
        elements: modalInteractiveElements,
        isPersistentPanel: isPersistentPanel, // Let LLM know this is always visible, not blocking
      };
      
      if (isPersistentPanel) {
        console.log('[DOMMap] ⚠️ Detected "modal" is actually a persistent panel - LLM will be informed');
      }
      
      // CRITICAL FIX: Show BOTH modal AND page content
      // The old logic hid page elements when a modal was detected, which prevented
      // the LLM from seeing target elements (like "More Options" buttons) that are
      // actually accessible on the page.
      // 
      // Now we show both so the LLM can decide:
      // - If modal is blocking → interact with modal first
      // - If target element is visible/accessible → click it directly
      
      // Get page content first
      map.regions = getPageRegions();
      const pageInteractiveElements = getInteractiveElements(document.body);
      const pageFormFields = getFormFields(document.body);
      
      // Combine modal + page elements (modal elements first for priority)
      map.formFields = [...modalFormFields, ...pageFormFields];
      map.interactiveElements = [...modalInteractiveElements, ...pageInteractiveElements];
      
      console.log('[DOMMap] 🔔 Active modal detected:', map.activeModal.title, 'with', modalInteractiveElements.length, 'interactive elements and', modalFormFields.length, 'form fields');
      console.log('[DOMMap] 📄 Also showing', pageInteractiveElements.length, 'page elements (target may be accessible)');
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
  
  // Set active dropdown if found (already detected earlier, before modal check)
  // Skip if UI transition just happened (old dropdown is stale)
  if (dropdown && !uiTransitionDetected) {
    map.activeDropdown = dropdown;
    console.log('[DOMMap] 🔽 Active dropdown detected with', dropdown.options.length, 'options:', 
      dropdown.options.map(o => o.name || o.text).join(', '));
  } else if (uiTransitionDetected) {
    console.log('[DOMMap] ⏭️ Skipping dropdown detection due to UI transition');
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
  
  // Cache the result (OPTIMIZATION)
  domMapCache.map = map;
  domMapCache.hash = currentHash;
  domMapCache.timestamp = Date.now();
  
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
    // CRITICAL: If this is a persistent panel, inform LLM it's NOT a blocking modal
    if (map.activeModal.isPersistentPanel) {
      lines.push(`=== PERSISTENT UI PANEL: ${map.activeModal.title || 'Panel'} ===`);
      lines.push('⚠️ NOTE: This is a persistent UI panel (always visible on the page), NOT a blocking modal/popup.');
      lines.push('✅ You can interact with page elements directly - this panel does not block interaction.');
      lines.push('');
    } else {
      lines.push(`=== ACTIVE MODAL: ${map.activeModal.title || 'Dialog'} ===`);
      
      // CRITICAL FIX: Don't force modal interaction - let LLM decide
      // The old prompt said "MUST interact with it first" which forced the LLM to click Close
      // even when the target element (e.g., "More Options") was visible and accessible.
      // 
      // Now we show both modal AND page elements, so the LLM can:
      // - Click the target directly if it's visible/accessible
      // - Close the modal first if it's actually blocking
      lines.push('ℹ️ A modal/popup is open. Target elements are shown below - click them directly if accessible, or close the modal first if it blocks your target.');
      lines.push('');
    }
    
    // Show modal interactive elements first (for priority)
    lines.push('## Modal Actions');
    for (const el of map.activeModal.elements) {
      lines.push(formatElement(el));
    }
    lines.push('');
    lines.push('💡 TIP: Look for buttons to close modal, confirm action, or navigate within modal');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Page Elements (shown below - may be accessible even with modal open)');
    lines.push('');
    // Continue to show page elements below - DON'T return early!
    // This allows LLM to see both modal AND page elements, so it can click target directly if accessible
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

/**
 * Find active modal using universal structural detection
 * Works across all websites (Salesforce, Gainsight, etc.)
 */
function findActiveModalWithStructuralDetection(): Element | null {
  // Look for potential modal candidates
  const candidates = document.querySelectorAll([
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    '.modal',
    '.dialog',
    '[data-modal]',
    '[class*="Modal"]',
    '[class*="popup"]',
    '[class*="Popup"]',
    '[class*="MuiDialog"]',
    '[class*="Dialog-root"]',
    '[class*="BaseModal"]',
    '[data-baseweb="modal"]',
    '[class*="slds-modal"]',
    '[class*="forceModal"]',
    '[class*="overlay"]',
  ].join(', '));
  
  // Also check for form-heavy containers as potential modals
  const formContainers = document.querySelectorAll('[class*="container"], [class*="form"], [class*="panel"], section, main');
  const allCandidates = [...Array.from(candidates), ...Array.from(formContainers)];
  
  let bestModal: Element | null = null;
  let bestScore = 0;
  
  for (const candidate of allCandidates) {
    if (!isVisible(candidate)) continue;
    
    // Use universal structural detection
    const modalResult = isRealModal(candidate);
    
    if (modalResult.isModal && modalResult.score > bestScore) {
      // Double-check: not a navigation context or SaaS app container
      if (!isNavigationContext(candidate) && !isSaaSAppContainer(candidate)) {
        bestModal = candidate;
        bestScore = modalResult.score;
        console.log(`[DOMMap] 🔔 Modal candidate (score ${modalResult.score}):`, modalResult.reasons);
      } else {
        console.log(`[DOMMap] ⚠️ Rejected modal candidate (score ${modalResult.score}): Navigation context or SaaS app container detected`);
      }
    }
  }
  
  // If no clear winner, try form field heuristic as fallback
  if (!bestModal) {
    const allFormFields = document.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]');
    if (allFormFields.length >= 15) {
      for (const container of formContainers) {
        if (!isVisible(container)) continue;
        
        const fieldsInContainer = container.querySelectorAll('input, textarea, select, [role="combobox"], [role="textbox"]');
        const formFieldCount = fieldsInContainer.length;
        
        // If this container has 80%+ of all fields, check with structural + form heuristic
        if (formFieldCount >= allFormFields.length * 0.8) {
          const result = detectModalWithFormHeuristic(container, formFieldCount);
          if (result.isModal) {
            console.log('[DOMMap] 🔔 Modal detected via form heuristic tiebreaker:', result.reason);
            bestModal = container;
            break;
          }
        }
      }
    }
  }
  
  if (bestModal) {
    console.log(`[DOMMap] ✅ Final modal selected with score ${bestScore}`);
  }
  
  return bestModal;
}

// Note: Old findActiveModal implementation replaced with findActiveModalWithStructuralDetection
// The new implementation uses universal structural signals instead of fragile heuristics

/**
 * Check if an element is a dual listbox (multi-select picklist)
 * Dual listboxes have two sibling listboxes (Available/Chosen) and are permanent form fields,
 * NOT temporary dropdowns that need immediate interaction.
 * 
 * Salesforce Lightning dual listboxes have structure like:
 * - Parent container with "Available" and "Chosen" labels
 * - Two [role="listbox"] elements side by side
 * - Arrow buttons to move items between lists
 */
function isDualListbox(element: Element): boolean {
  // Check 1: Is this inside a dueling-picklist or multi-select container?
  const dualListboxSelectors = [
    '[class*="dueling-picklist"]',
    '[class*="dual-listbox"]',
    '[class*="multi-select"]',
    '[class*="picklist"]',
    '.slds-dueling-list',
    'lightning-dual-listbox',
  ];
  
  for (const selector of dualListboxSelectors) {
    if (element.closest(selector)) {
      return true;
    }
  }
  
  // Check 2: Does this listbox have a sibling listbox? (Available + Chosen pattern)
  const parent = element.parentElement;
  if (parent) {
    const siblingListboxes = parent.querySelectorAll('[role="listbox"]');
    if (siblingListboxes.length >= 2) {
      // Multiple listboxes in same parent = dual listbox pattern
      return true;
    }
    
    // Check grandparent too (Salesforce wraps things deeply)
    const grandparent = parent.parentElement;
    if (grandparent) {
      const grandparentListboxes = grandparent.querySelectorAll('[role="listbox"]');
      if (grandparentListboxes.length >= 2) {
        return true;
      }
    }
  }
  
  // Check 3: Look for "Available" and "Chosen" text nearby
  const containerText = element.closest('div, fieldset, section')?.textContent || '';
  if (containerText.includes('Available') && containerText.includes('Chosen')) {
    return true;
  }
  
  // Check 4: Has arrow buttons (move left/right) nearby - common in dual listboxes
  const nearbyArrows = element.closest('div')?.querySelectorAll('button[class*="move"], [class*="arrow"], [title*="Move"]');
  if (nearbyArrows && nearbyArrows.length >= 1) {
    return true;
  }
  
  return false;
}

/**
 * Find an active/open dropdown listbox
 * CRITICAL: When a dropdown is open, the AI MUST interact with it first
 * before doing any other action (like typing) which would close it
 */
function findActiveDropdown(): { triggerName?: string; options: DOMMapElement[] } | null {
  // Use comprehensive selector list for synchronous menu finding
  const menuSelectors = [
    '[role="menu"]',
    '[role="listbox"]',
    '.cdk-overlay-pane',
    '.mat-menu-panel',
    '[class*="slds-dropdown"]',
    '[class*="slds-listbox"]',
    '.MuiMenu-paper',
    '[data-radix-menu-content]',
    '.ant-dropdown',
    '.dropdown-menu',
  ];
  
  let menu: Element | null = null;
  for (const selector of menuSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isVisible(el)) {
          // CRITICAL: Skip dual listboxes (multi-select picklists)
          // These are permanent form fields, NOT temporary dropdowns
          // Dual listboxes have a parent container with two sibling listboxes (Available/Chosen)
          if (isDualListbox(el)) {
            console.log('[DOMMap] ⏭️ Skipping dual listbox (multi-select picklist) - not a temporary dropdown');
            continue;
          }
          
          // Check if has options
          const hasOptions = el.querySelector('[role="menuitem"], [role="option"], li');
          if (hasOptions) {
            menu = el;
            break;
          }
        }
      }
      if (menu) break;
    } catch (e) {
      continue;
    }
  }
  
  if (!menu) return null;
  
  // SAFEGUARD: Skip Google Sheets toolbar elements
  const isGoogleSheets = window.location.hostname.includes('docs.google.com') && 
                          window.location.href.includes('/spreadsheets');
  
  if (isGoogleSheets) {
    // Skip if element is inside the toolbar (not a popup)
    const isInToolbar = menu.closest('[role="toolbar"]') || 
                        menu.closest('.docs-titlebar') ||
                        menu.closest('.docs-material-menu-button-caption') ||
                        menu.closest('#docs-chrome');
    if (isInToolbar) return null;
    
    // Skip if it's one of the known toolbar dropdown triggers (not actual menus)
    const ariaLabel = menu.getAttribute('aria-label') || '';
    if (ariaLabel.includes('Font list') || 
        ariaLabel.includes('Font size list') ||
        ariaLabel.includes('Zoom list')) {
      return null;
    }
  }
  
  // Check if this is truly a floating/popup element (has high z-index or is in a portal)
  const style = window.getComputedStyle(menu as HTMLElement);
  const zIndex = parseInt(style.zIndex || '0', 10);
  const position = style.position;
  
  // CRITICAL FIX: Always try to verify dropdown is actually OPEN using ARIA attributes
  // Even positioned elements need verification - Salesforce Lightning has permanent nav menus
  // that are positioned but NOT actual open dropdowns
  const menuId = menu.getAttribute('id');
  const menuAriaControls = menu.getAttribute('aria-controls');
  
  // Method 1: Check if menu itself has aria-expanded (some frameworks put it on the menu)
  const menuExpanded = menu.getAttribute('aria-expanded');
  if (menuExpanded === 'false') {
    return null; // Menu explicitly says it's closed
  }
  
  // Method 2: Check for a trigger that's expanded and controls this menu
  const triggerId = menuAriaControls || menuId;
  if (triggerId) {
    const trigger = document.querySelector(`[aria-controls="${triggerId}"][aria-expanded="true"]`);
    if (!trigger) {
      // No expanded trigger - check if it's truly a floating overlay
      // Only trust positioned elements with very high z-index AND recent appearance
      if (position === 'static' || zIndex < 1000) {
        return null; // Likely a permanent nav menu, not a dropdown
      }
    }
  } else if (position === 'static' && zIndex < 100) {
    // No trigger ID and low z-index static element - definitely not a dropdown
    return null;
  }
  
  // Method 3: For Salesforce Lightning specifically, check for popover/dropdown classes
  const isSalesforceNavMenu = menu.closest('.slds-global-header') || 
                               menu.closest('.tabBarContainer') ||
                               menu.closest('[class*="navItem"]') ||
                               menu.closest('[class*="appLauncher"]');
  if (isSalesforceNavMenu && !menu.closest('.slds-is-open')) {
    console.log('[DOMMap] ⏭️ Skipping Salesforce nav menu (not .slds-is-open)');
    return null;
  }
  
  // Extract menu items using universal selectors
  const menuItems = menu.querySelectorAll('[role="menuitem"], [role="option"], .mat-menu-item, .slds-listbox__option, .MuiMenuItem-root, .ant-dropdown-menu-item, li');
  
  const visibleOptions: DOMMapElement[] = [];
  for (const opt of menuItems) {
    if (!isVisible(opt)) continue;
    
    const mapEl = elementToMapElement(opt);
    // Only include if it has meaningful content
    if (mapEl.name || mapEl.text) {
      visibleOptions.push(mapEl);
    }
  }
  
  if (visibleOptions.length === 0) return null;
  
  // Try to find the trigger element (combobox/button that opened it)
  let triggerName: string | undefined;
  // Note: menuId already declared above
  if (menuId) {
    const trigger = document.querySelector(`[aria-controls="${menuId}"], [aria-owns="${menuId}"]`);
    if (trigger) {
      triggerName = computeAccessibleName(trigger) || undefined;
    }
  }
  
  return { triggerName, options: visibleOptions };
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

/**
 * Get page regions based on standard landmark roles
 * Exported for use by PageModel signal aggregation
 */
export function getPageRegions(): DOMMapRegion[] {
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
  
  // DEBUG: Log when aria-label exists but name is empty
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && !name && role === 'button') {
    console.warn(`[DOMMap] ⚠️ Button has aria-label="${ariaLabel}" but computeAccessibleName returned empty!`);
  }
  
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
  // CRITICAL: Put widget title FIRST for prominence when LLM is disambiguating
  let line = '';
  
  if (el.widgetTitle) {
    line = `📍 IN WIDGET "${el.widgetTitle}" → `;
  }
  
  line += `[${el.role}] "${el.name || el.text || '(unlabeled)'}"`;
  
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

/**
 * Generate DOM map with iframe content included
 * This function scans the main frame and all accessible iframes
 */
export async function generateDOMMapWithIframes(): Promise<DOMMap> {
  const mainMap = generateDOMMap();
  
  // Find all iframes in the main frame
  const iframes = document.querySelectorAll('iframe');
  
  if (iframes.length === 0) {
    // No iframes, return main map as-is
    return mainMap;
  }
  
  console.log(`[DOMMap] Found ${iframes.length} iframes, attempting to scan content`);
  
  let iframesScanned = 0;
  let iframeElementsAdded = 0;
  
  for (let i = 0; i < iframes.length && iframesScanned < 3; i++) {
    const iframe = iframes[i];
    
    try {
      // Try same-origin access first
      if (iframe.contentDocument && iframe.contentDocument.body) {
        console.log(`[DOMMap] Scanning same-origin iframe ${i}`);
        
        // Get the iframe's frameId (we'll need to request it)
        // For now, use index as approximation
        const iframeFrameId = i + 1;
        
        // Scan iframe content
        const iframeInteractiveElements = getInteractiveElements(iframe.contentDocument.body);
        const iframeFormFields = getFormFields(iframe.contentDocument.body);
        
        // Tag all elements with the iframe's frameId
        iframeInteractiveElements.forEach(el => {
          el.frameId = iframeFrameId;
        });
        iframeFormFields.forEach(el => {
          el.frameId = iframeFrameId;
        });
        
        // Merge into main map
        mainMap.interactiveElements.push(...iframeInteractiveElements);
        mainMap.formFields.push(...iframeFormFields);
        
        iframeElementsAdded += iframeInteractiveElements.length + iframeFormFields.length;
        iframesScanned++;
        
        console.log(`[DOMMap] Added ${iframeInteractiveElements.length} interactive + ${iframeFormFields.length} form fields from iframe ${i}`);
      }
    } catch (e) {
      // Cross-origin or access denied - try messaging approach
      console.log(`[DOMMap] Iframe ${i} is cross-origin, requesting via message`);
      
      try {
        // Request DOM map from iframe via messaging
        const iframeDOMMap = await requestIframeDOMMap(i + 1);
        
        if (iframeDOMMap) {
          // Merge the iframe's DOM map into main map
          mainMap.interactiveElements.push(...iframeDOMMap.interactiveElements);
          mainMap.formFields.push(...iframeDOMMap.formFields);
          
          iframeElementsAdded += iframeDOMMap.interactiveElements.length + iframeDOMMap.formFields.length;
          iframesScanned++;
          
          console.log(`[DOMMap] Added ${iframeDOMMap.interactiveElements.length} interactive + ${iframeDOMMap.formFields.length} form fields from cross-origin iframe ${i}`);
        }
      } catch (messageError) {
        console.warn(`[DOMMap] Failed to get DOM map from iframe ${i} via messaging:`, messageError);
      }
    }
  }
  
  console.log(`[DOMMap] Scanned ${iframesScanned} iframes, added ${iframeElementsAdded} total elements`);
  
  return mainMap;
}

/**
 * Request DOM map from an iframe via messaging
 * @param frameId The Chrome frame ID of the iframe
 * @returns Promise that resolves with the iframe's DOM map
 */
async function requestIframeDOMMap(frameId: number): Promise<DOMMap | null> {
  return new Promise((resolve) => {
    // Set up listener for response
    const listener = (message: any) => {
      if (message.type === 'IFRAME_DOM_MAP_RESPONSE' && message.payload?.frameId === frameId) {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message.payload.domMap);
      }
    };
    
    chrome.runtime.onMessage.addListener(listener);
    
    // Send request via runtime (will be routed by service worker)
    chrome.runtime.sendMessage({
      type: 'GET_IFRAME_DOM_MAP',
      payload: { frameId },
    }).catch((error) => {
      console.warn(`[DOMMap] Failed to request DOM map from iframe ${frameId}:`, error);
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    });
    
    // Timeout after 2 seconds
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    }, 2000);
  });
}

