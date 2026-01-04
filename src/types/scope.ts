/**
 * Scope Types - First-class container resolution for the state-machine replayer
 * 
 * Every locator resolution starts by finding the scope container, then searches within it.
 * This is essential for dashboards and complex UIs with multiple similar widgets.
 */

/**
 * Scope defines where to search for elements
 * Resolution always starts by finding the scope container first
 */
export type Scope =
  | { kind: 'PAGE' }
  | { kind: 'MODAL'; selector?: string }
  | { kind: 'IFRAME'; selector: string }
  | { kind: 'NEAREST_SECTION'; headingText: string }
  | { kind: 'TABLE_ROW'; anchorText: string; anchorColumn?: string }
  | { kind: 'CONTAINER'; selector: string; fallbackText?: string }
  | { kind: 'WIDGET'; title: string }
  | { kind: 'SHADOW_ROOT'; hostSelector: string };

/**
 * Type guard to check if an object is a valid Scope
 */
export function isScope(obj: unknown): obj is Scope {
  if (typeof obj !== 'object' || obj === null) return false;
  const scope = obj as { kind?: string };
  if (typeof scope.kind !== 'string') return false;
  
  const validKinds = [
    'PAGE', 'MODAL', 'IFRAME', 'NEAREST_SECTION',
    'TABLE_ROW', 'CONTAINER', 'WIDGET', 'SHADOW_ROOT'
  ];
  
  return validKinds.includes(scope.kind);
}

/**
 * Create a page-level scope (entire document)
 */
export function createPageScope(): Scope {
  return { kind: 'PAGE' };
}

/**
 * Create a modal scope
 */
export function createModalScope(selector?: string): Scope {
  return { kind: 'MODAL', selector };
}

/**
 * Create an iframe scope
 */
export function createIframeScope(selector: string): Scope {
  return { kind: 'IFRAME', selector };
}

/**
 * Create a scope for the nearest section with a specific heading
 */
export function createSectionScope(headingText: string): Scope {
  return { kind: 'NEAREST_SECTION', headingText };
}

/**
 * Create a scope for a table row identified by anchor text
 */
export function createTableRowScope(anchorText: string, anchorColumn?: string): Scope {
  return { kind: 'TABLE_ROW', anchorText, anchorColumn };
}

/**
 * Create a scope for a container with a selector and optional fallback text
 */
export function createContainerScope(selector: string, fallbackText?: string): Scope {
  return { kind: 'CONTAINER', selector, fallbackText };
}

/**
 * Create a scope for a widget/card with a title
 */
export function createWidgetScope(title: string): Scope {
  return { kind: 'WIDGET', title };
}

/**
 * Create a scope for a shadow DOM root
 */
export function createShadowRootScope(hostSelector: string): Scope {
  return { kind: 'SHADOW_ROOT', hostSelector };
}

/**
 * Get a human-readable description of a scope
 */
export function describeScope(scope: Scope): string {
  switch (scope.kind) {
    case 'PAGE':
      return 'entire page';
    case 'MODAL':
      return scope.selector ? `modal "${scope.selector}"` : 'current modal';
    case 'IFRAME':
      return `iframe "${scope.selector}"`;
    case 'NEAREST_SECTION':
      return `section with heading "${scope.headingText}"`;
    case 'TABLE_ROW':
      return scope.anchorColumn
        ? `row where "${scope.anchorColumn}" = "${scope.anchorText}"`
        : `row containing "${scope.anchorText}"`;
    case 'CONTAINER':
      return scope.fallbackText
        ? `container "${scope.selector}" (or containing "${scope.fallbackText}")`
        : `container "${scope.selector}"`;
    case 'WIDGET':
      return `widget titled "${scope.title}"`;
    case 'SHADOW_ROOT':
      return `shadow root of "${scope.hostSelector}"`;
    default:
      return 'unknown scope';
  }
}

/**
 * Resolve a scope to its container element
 * Returns null if scope container cannot be found
 */
export function resolveScopeContainer(scope: Scope, doc: Document = document): Element | null {
  switch (scope.kind) {
    case 'PAGE':
      return doc.body;
      
    case 'MODAL': {
      // Try common modal selectors
      const modalSelectors = scope.selector 
        ? [scope.selector]
        : [
            '[role="dialog"]',
            '.modal',
            '[class*="modal"]',
            '.MuiDialog-root',
            '[data-testid*="modal"]',
            '[aria-modal="true"]'
          ];
      
      for (const selector of modalSelectors) {
        try {
          const modal = doc.querySelector(selector);
          if (modal && isElementVisible(modal)) {
            return modal;
          }
        } catch (e) {
          // Invalid selector, continue
        }
      }
      return null;
    }
    
    case 'IFRAME': {
      try {
        const iframe = doc.querySelector(scope.selector) as HTMLIFrameElement;
        if (iframe?.contentDocument?.body) {
          return iframe.contentDocument.body;
        }
      } catch (e) {
        // Cross-origin or other access error
      }
      return null;
    }
    
    case 'NEAREST_SECTION': {
      // Find section by heading text
      const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
      for (const heading of Array.from(headings)) {
        const text = heading.textContent?.trim().toLowerCase() || '';
        if (text.includes(scope.headingText.toLowerCase())) {
          // Return the section containing this heading
          const section = heading.closest('section, article, div[class*="section"], div[class*="card"]');
          if (section) return section;
          // Fallback: return parent
          return heading.parentElement;
        }
      }
      return null;
    }
    
    case 'TABLE_ROW': {
      // Find row containing anchor text
      const rows = doc.querySelectorAll('tr, [role="row"]');
      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll('td, th, [role="cell"], [role="gridcell"]');
        for (const cell of Array.from(cells)) {
          const text = cell.textContent?.trim() || '';
          if (text.includes(scope.anchorText)) {
            return row;
          }
        }
      }
      return null;
    }
    
    case 'CONTAINER': {
      try {
        const container = doc.querySelector(scope.selector);
        if (container) return container;
      } catch (e) {
        // Invalid selector
      }
      
      // Try fallback text
      if (scope.fallbackText) {
        const candidates = doc.querySelectorAll('div, section, article');
        for (const candidate of Array.from(candidates)) {
          const text = candidate.textContent?.trim() || '';
          if (text.includes(scope.fallbackText)) {
            return candidate;
          }
        }
      }
      return null;
    }
    
    case 'WIDGET': {
      // Find widget by title - comprehensive search for various widget types
      const searchTitle = scope.title.toLowerCase();
      const searchTitleStripped = searchTitle.replace(/\d+$/g, '').trim(); // Remove trailing numbers
      
      console.log(`[Scope] 🔍 Searching for widget: "${scope.title}" (stripped: "${searchTitleStripped}")`);
      
      // Method 1: Search in common widget container types (generic patterns only!)
      const widgetSelectors = [
        // Web component patterns (check FIRST - most specific)
        'gs-report-widget-element',  // Gainsight (TEMPORARY for debugging)
        '*[class$="-widget-element"]',
        '*[class$="-report-element"]',
        '*[class$="-widget"]',
        // Generic patterns that work across different sites
        '[class*="widget"]',
        '[class*="card"]', 
        '[class*="panel"]',
        '[class*="report"]',
        '[class*="dashboard-item"]',
        '[class*="tile"]',
        '[class*="module"]',
        'gridster-item',
        '[data-widget-id]',
        '[data-widget]',
        '[data-report-id]',
        '[role="region"]',
      ];
      
      let widgetsChecked = 0;
      const uniqueTitles = new Set<string>();
      
      for (const selector of widgetSelectors) {
        try {
          const widgets = doc.querySelectorAll(selector);
          for (const widget of Array.from(widgets)) {
            widgetsChecked++;
            
            // Skip if widget is not visible
            const rect = widget.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            // Check title in heading elements (light DOM)
            let titleEl = widget.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [class*="heading"]');
            let title = titleEl?.textContent?.trim() || '';
            
            // If no title in light DOM, check shadow DOM!
            if (!title && widget.shadowRoot) {
              titleEl = widget.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [class*="heading"]');
              title = titleEl?.textContent?.trim() || '';
            }
            
            if (!title) continue;
            
            // Track unique titles for debugging
            const titleShort = title.substring(0, 60);
            if (!uniqueTitles.has(titleShort)) {
              uniqueTitles.add(titleShort);
              console.log(`[Scope] 🔍 Unique widget ${uniqueTitles.size}: "${titleShort}"`);
            }
            
            const titleLower = title.toLowerCase();
            const titleStripped = titleLower.replace(/\d+$/g, '').trim();
            
            // BIDIRECTIONAL fuzzy matching: handles dynamic numbers like "STORE107" vs "STORE"
            if (titleLower.includes(searchTitle) || searchTitle.includes(titleLower)) {
              console.log(`[Scope] ✅ Found widget "${title.substring(0, 60)}" (exact match)`);
              return widget;
            }
            
            // Strip trailing numbers for even more fuzzy matching
            if (titleStripped && searchTitleStripped && titleStripped.length > 10 && 
                (titleStripped.includes(searchTitleStripped) || searchTitleStripped.includes(titleStripped))) {
              console.log(`[Scope] ✅ Found widget "${title.substring(0, 60)}" (fuzzy match - stripped numbers)`);
              return widget;
            }
            
            // Also check aria-label on the widget itself
            const ariaLabel = widget.getAttribute('aria-label')?.toLowerCase() || '';
            if (ariaLabel && (ariaLabel.includes(searchTitle) || searchTitle.includes(ariaLabel))) {
              console.log(`[Scope] ✅ Found widget via aria-label`);
              return widget;
            }
          }
        } catch (e) {
          // Invalid selector, continue
        }
      }
      
      console.log(`[Scope] 🔍 Checked ${widgetsChecked} widgets (${uniqueTitles.size} unique titles), none matched`);
      console.log(`[Scope] 🔍 Unique titles found:`, Array.from(uniqueTitles).join(', '));
      
      // Method 2: Find heading with matching text and return its container
      const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
      for (const heading of Array.from(headings)) {
        const text = heading.textContent?.trim().toLowerCase() || '';
        // Bidirectional fuzzy matching
        if (text && (text.includes(searchTitle) || searchTitle.includes(text))) {
          // Walk up to find a reasonable container
          let container = heading.parentElement;
          for (let i = 0; i < 5 && container; i++) {
            // Stop if we hit something that looks like a widget container
            const className = container.className?.toLowerCase() || '';
            const tagName = container.tagName?.toLowerCase() || '';
            if (className.includes('widget') || className.includes('card') || 
                className.includes('panel') || className.includes('report') ||
                tagName.includes('widget') || tagName.includes('report')) {
              console.log(`[Scope] ✅ Found widget container via heading "${heading.textContent?.trim()}"`);
              return container;
            }
            container = container.parentElement;
          }
          // Fallback: return the parent of the heading
          console.log(`[Scope] ⚠️ Using heading parent as widget container for "${heading.textContent?.trim()}"`);
          return heading.parentElement;
        }
      }
      
      console.log(`[Scope] ❌ Widget with title "${scope.title}" not found`);
      return null;
    }
    
    case 'SHADOW_ROOT': {
      try {
        const host = doc.querySelector(scope.hostSelector);
        if (host?.shadowRoot) {
          // Return the shadow root's first element child or create a wrapper
          return host.shadowRoot.firstElementChild || host;
        }
      } catch (e) {
        // Error accessing shadow root
      }
      return null;
    }
    
    default:
      return null;
  }
}

/**
 * Helper to check if element is visible
 */
function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  
  return true;
}







