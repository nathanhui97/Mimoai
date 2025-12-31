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
      // Find widget by title
      const widgets = doc.querySelectorAll(
        '[class*="widget"], [class*="card"], [class*="panel"], gridster-item'
      );
      for (const widget of Array.from(widgets)) {
        const titleEl = widget.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
        const title = titleEl?.textContent?.trim().toLowerCase() || '';
        if (title.includes(scope.title.toLowerCase())) {
          return widget;
        }
      }
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






