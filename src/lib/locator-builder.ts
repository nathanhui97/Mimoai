/**
 * LocatorBuilder - Build LocatorBundle from DOM elements during recording
 * 
 * Captures all locator strategies with their features for reliable replay.
 */

import type { 
  LocatorBundle, 
  LocatorStrategy
} from '../types/locator';
import { 
  createEmptyBundle, 
  createCSSLocator, 
  createTextLocator, 
  createAriaLocator, 
  createRoleLocator,
  createTestIdLocator,
  createXPathLocator,
  createPositionLocator,
  hasDynamicParts,
  isLikelyDynamicText,
} from '../types/locator';
import { computeAccessibleName } from './accessible-name';
import { FeatureFlags } from './feature-flags';
import type { Scope } from '../types/scope';
import { 
  createPageScope, 
  createModalScope, 
  createTableRowScope, 
  createSectionScope,
  createWidgetScope,
} from '../types/scope';
import { ShadowDOMUtils } from '../content/shadow-dom-utils';

/**
 * Build a complete LocatorBundle from an element
 */
export function buildLocatorBundle(
  element: Element,
  doc: Document = document
): LocatorBundle {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role') || undefined;
  
  const bundle = createEmptyBundle(tagName, role);
  
  // Build all locator strategies in PRIORITY ORDER
  // 1. testid (highest priority)
  // 2. role + accessible name
  // 3. aria-label
  // 4. text content
  // 5. CSS selectors
  // 6. XPath (only if enabled)
  // 7. position (last resort)
  const positionLocator = buildPositionLocator(element);
  bundle.strategies = [
    ...buildTestIdLocators(element, doc),      // Priority 1
    ...buildRoleLocators(element),              // Priority 2 (uses full accessible name)
    ...buildAriaLocators(element),              // Priority 3
    ...buildTextLocators(element),              // Priority 4
    ...buildCSSLocators(element, doc),          // Priority 5
    ...(FeatureFlags.XPATH_FALLBACK ? buildXPathLocators(element, doc) : []),  // Priority 6 (gated)
    ...(positionLocator ? [positionLocator] : []),  // Priority 7 (last resort)
  ];
  
  // Build disambiguators from nearby text
  bundle.disambiguators = buildDisambiguators(element);
  
  // Detect scope
  bundle.scope = detectScope(element);
  
  return bundle;
}

/**
 * Build CSS selectors with features
 */
function buildCSSLocators(element: Element, doc: Document): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  // ID selector (most stable)
  if (element.id && !hasDynamicParts(element.id)) {
    const selector = `#${CSS.escape(element.id)}`;
    const matchCount = countMatches(selector, doc);
    
    strategies.push(createCSSLocator(
      selector,
      {
        uniqueMatchAtRecordTime: matchCount === 1,
        matchCountAtRecordTime: matchCount,
        hasStableAttributes: true,
        textStabilityHint: 'stable',
        hasDynamicParts: false,
      },
      tagName
    ));
  }
  
  // Class-based selector
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter(c => 
      c && !hasDynamicParts(c) && !c.startsWith('ng-') && !c.includes('_')
    );
    
    if (classes.length > 0) {
      const selector = `${tagName}.${classes.slice(0, 3).map(c => CSS.escape(c)).join('.')}`;
      const matchCount = countMatches(selector, doc);
      
      strategies.push(createCSSLocator(
        selector,
        {
          uniqueMatchAtRecordTime: matchCount === 1,
          matchCountAtRecordTime: matchCount,
          hasStableAttributes: false,
          textStabilityHint: 'unknown',
          hasDynamicParts: false,
        },
        tagName
      ));
    }
  }
  
  // Attribute-based selectors
  const stableAttrs = ['name', 'type', 'placeholder', 'title'];
  for (const attr of stableAttrs) {
    const value = element.getAttribute(attr);
    if (value && !hasDynamicParts(value)) {
      const selector = `${tagName}[${attr}="${CSS.escape(value)}"]`;
      const matchCount = countMatches(selector, doc);
      
      if (matchCount <= 5) {
        strategies.push(createCSSLocator(
          selector,
          {
            uniqueMatchAtRecordTime: matchCount === 1,
            matchCountAtRecordTime: matchCount,
            hasStableAttributes: true,
            textStabilityHint: 'stable',
            hasDynamicParts: false,
          },
          tagName
        ));
      }
    }
  }
  
  // Nth-child fallback
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(el => el.tagName === element.tagName);
    const index = siblings.indexOf(element) + 1;
    
    if (siblings.length > 1) {
      const parentSelector = buildSimpleSelector(parent);
      if (parentSelector) {
        const selector = `${parentSelector} > ${tagName}:nth-of-type(${index})`;
        const matchCount = countMatches(selector, doc);
        
        strategies.push(createCSSLocator(
          selector,
          {
            uniqueMatchAtRecordTime: matchCount === 1,
            matchCountAtRecordTime: matchCount,
            hasStableAttributes: false,
            textStabilityHint: 'unknown',
            hasDynamicParts: false,
          },
          tagName
        ));
      }
    }
  }
  
  return strategies;
}

/**
 * Build text-based locators
 */
function buildTextLocators(element: Element): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  // Get text content (direct text, not nested)
  const directText = getDirectTextContent(element);
  
  if (directText && directText.length > 0 && directText.length < 100) {
    strategies.push(createTextLocator(
      directText,
      {
        uniqueMatchAtRecordTime: true,
        matchCountAtRecordTime: 1,
        textStabilityHint: isLikelyDynamicText(directText) ? 'likely_dynamic' : 'stable',
      },
      tagName
    ));
  }
  
  return strategies;
}

/**
 * Build ARIA-based locators
 */
function buildAriaLocators(element: Element): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    strategies.push(createAriaLocator(
      ariaLabel,
      {
        uniqueMatchAtRecordTime: true,
        matchCountAtRecordTime: 1,
        hasStableAttributes: true,
        textStabilityHint: isLikelyDynamicText(ariaLabel) ? 'likely_dynamic' : 'stable',
      },
      tagName
    ));
  }
  
  return strategies;
}

/**
 * Build role-based locators
 * Uses full accessible name computation (aria-labelledby, aria-label, label[for], etc.)
 */
function buildRoleLocators(element: Element): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  const role = element.getAttribute('role');
  if (role) {
    // Use FULL accessible name computation (not just aria-label)
    const accessibleName = computeAccessibleName(element) || 
                           element.textContent?.trim().slice(0, 50) || 
                           '';
    
    strategies.push(createRoleLocator(
      role,
      accessibleName,
      {
        uniqueMatchAtRecordTime: false,
        matchCountAtRecordTime: 1,
        hasStableAttributes: true,
        recordedRole: role,
        recordedText: accessibleName,
      },
      tagName
    ));
  }
  
  return strategies;
}

/**
 * Build test-id locators
 */
function buildTestIdLocators(element: Element, doc: Document): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  const testIdAttrs = ['data-testid', 'data-test-id', 'data-test', 'data-cy'];
  
  for (const attr of testIdAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      const matchCount = countMatches(`[${attr}="${value}"]`, doc);
      
      strategies.push(createTestIdLocator(
        value,
        {
          uniqueMatchAtRecordTime: matchCount === 1,
          matchCountAtRecordTime: matchCount,
          hasStableAttributes: true,
          textStabilityHint: 'stable',
        },
        tagName
      ));
    }
  }
  
  return strategies;
}

/**
 * Build XPath locators
 */
function buildXPathLocators(element: Element, _doc: Document): LocatorStrategy[] {
  const strategies: LocatorStrategy[] = [];
  const tagName = element.tagName.toLowerCase();
  
  // Text-based XPath
  const text = element.textContent?.trim();
  if (text && text.length > 0 && text.length < 50) {
    const xpath = `//${tagName}[contains(text(), "${text.slice(0, 30)}")]`;
    
    strategies.push(createXPathLocator(
      xpath,
      {
        uniqueMatchAtRecordTime: false,
        matchCountAtRecordTime: 1,
        textStabilityHint: isLikelyDynamicText(text) ? 'likely_dynamic' : 'stable',
      },
      tagName
    ));
  }
  
  return strategies;
}

/**
 * Build position-based locator (last resort)
 */
function buildPositionLocator(element: Element): LocatorStrategy | null {
  const rect = element.getBoundingClientRect();
  
  if (rect.width === 0 || rect.height === 0) return null;
  
  return createPositionLocator(
    {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    {
      uniqueMatchAtRecordTime: false,
      matchCountAtRecordTime: 1,
      textStabilityHint: 'likely_dynamic',
    },
    element.tagName.toLowerCase()
  );
}

/**
 * Build disambiguators from nearby text
 */
function buildDisambiguators(element: Element): string[] {
  const disambiguators: string[] = [];
  
  // Parent text (excluding element's own text)
  const parent = element.parentElement;
  if (parent) {
    const parentText = parent.textContent?.trim() || '';
    const elementText = element.textContent?.trim() || '';
    const siblingText = parentText.replace(elementText, '').trim();
    
    if (siblingText && siblingText.length < 100) {
      disambiguators.push(siblingText.slice(0, 50));
    }
  }
  
  // Previous sibling text
  const prevSibling = element.previousElementSibling;
  if (prevSibling) {
    const text = prevSibling.textContent?.trim();
    if (text && text.length < 50) {
      disambiguators.push(text);
    }
  }
  
  // Heading context
  const section = element.closest('section, article, div[class*="section"]');
  if (section) {
    const heading = section.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      const headingText = heading.textContent?.trim();
      if (headingText) {
        disambiguators.push(headingText);
      }
    }
  }
  
  return disambiguators;
}

/**
 * Detect scope for the element
 */
function detectScope(element: Element): Scope | undefined {
  // CRITICAL: Check if element is IN shadow DOM first
  // If yes, we need to check the shadow host for widget context
  // element.closest() doesn't traverse shadow boundaries!
  let searchContext: Element = element;
  const rootNode = element.getRootNode();
  
  if (rootNode !== document && 'host' in rootNode) {
    // We're in a shadow root! Get the host element
    const shadowHost = (rootNode as ShadowRoot).host;
    console.log('[LocatorBuilder] 🌑 Element is in shadow DOM, host:', shadowHost.tagName);
    
    // Check if shadow host is a widget/web component
    const hostTag = shadowHost.tagName.toLowerCase();
    
    // Gainsight widgets: gs-report-widget-element, gs-*
    // Salesforce: lightning-*, c-*, force-*
    // Generic: *-widget, *-card, *-component
    if (hostTag.includes('widget') || 
        hostTag.includes('card') || 
        hostTag.startsWith('gs-') ||
        hostTag.startsWith('lightning-') ||
        hostTag.startsWith('c-') ||
        hostTag.includes('component')) {
      
      // Try to find widget title in shadow root
      let title: string | undefined;
      const shadowRoot = shadowHost.shadowRoot;
      
      if (shadowRoot) {
        // Search for title in shadow DOM
        const titleEl = shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
        title = titleEl?.textContent?.trim();
        
        // If no title in shadow, check for data attributes on host
        if (!title) {
          title = shadowHost.getAttribute('data-title') || 
                  shadowHost.getAttribute('title') || 
                  shadowHost.getAttribute('aria-label') ||
                  undefined;
        }
      }
      
      // Fallback: search in light DOM children of host
      if (!title) {
        const titleEl = shadowHost.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"]');
        title = titleEl?.textContent?.trim();
      }
      
      if (title) {
        console.log('[LocatorBuilder] ✅ Found widget title in shadow DOM:', title);
        return createWidgetScope(title);
      } else {
        console.log('[LocatorBuilder] ⚠️ Widget host found but no title detected');
        // Still return widget scope with host tag name
        return createWidgetScope(hostTag);
      }
    }
    
    // For non-widget shadow hosts, continue searching from the host in light DOM
    searchContext = shadowHost;
  }
  
  // Check if in modal (shadow-aware)
  const modal = ShadowDOMUtils.closestAcrossShadow(searchContext, '[role="dialog"], .modal, [class*="modal"]');
  if (modal) {
    return createModalScope();
  }
  
  // Check if in table row (shadow-aware)
  const row = ShadowDOMUtils.closestAcrossShadow(searchContext, 'tr, [role="row"]');
  if (row) {
    // Find anchor text in the row
    const firstCell = row.querySelector('td:first-child, [role="cell"]:first-child');
    const anchorText = firstCell?.textContent?.trim() || '';
    if (anchorText) {
      return createTableRowScope(anchorText);
    }
  }
  
  // Check if in widget/card (shadow-aware)
  // Include common web component patterns
  const widget = ShadowDOMUtils.closestAcrossShadow(searchContext, 
    '[class*="widget"], [class*="card"], gridster-item, gs-report-widget-element, ' +
    'lightning-card, c-card, [class*="dashboard-item"], [class*="tile"]');
  if (widget) {
    // For web components, check shadow root first
    let title: string | undefined;
    
    if (widget.shadowRoot) {
      const titleEl = widget.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
      title = titleEl?.textContent?.trim();
    }
    
    // Fallback: light DOM
    if (!title) {
      title = widget.querySelector('h1, h2, h3, h4, [class*="title"]')?.textContent?.trim();
    }
    
    // Fallback: check widget attributes
    if (!title) {
      title = widget.getAttribute('data-title') || 
              widget.getAttribute('title') ||
              widget.getAttribute('aria-label') ||
              undefined;
    }
    
    if (title) {
      console.log('[LocatorBuilder] ✅ Detected widget scope:', title.substring(0, 50));
      return createWidgetScope(title);
    }
  }
  
  // Check if in labeled section (shadow-aware)
  const section = ShadowDOMUtils.closestAcrossShadow(searchContext, 'section, article');
  if (section) {
    const heading = section.querySelector('h1, h2, h3, h4, h5, h6');
    const headingText = heading?.textContent?.trim();
    if (headingText) {
      return createSectionScope(headingText);
    }
  }
  
  // Default to page scope
  return createPageScope();
}

// ============ Helper functions ============

function countMatches(selector: string, doc: Document): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function buildSimpleSelector(element: Element): string | null {
  if (element.id && !hasDynamicParts(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }
  
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter(c => 
      c && !hasDynamicParts(c)
    );
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
  }
  
  return element.tagName.toLowerCase();
}

function getDirectTextContent(element: Element): string {
  let text = '';
  
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  
  return text.trim();
}

