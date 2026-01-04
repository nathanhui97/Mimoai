/**
 * Locator Types - Feature-based locator strategies for the state-machine replayer
 * 
 * Instead of storing confidence scores at record time (which are often wrong),
 * we store features and compute scores at runtime with current DOM context.
 */

import type { Scope } from './scope';

/**
 * Types of locator strategies
 */
export type LocatorType = 
  | 'css'       // CSS selector
  | 'xpath'     // XPath expression
  | 'text'      // Text content match
  | 'aria'      // aria-label match
  | 'role'      // Role + accessible name
  | 'testid'    // data-testid attribute
  | 'position'  // Position-based (last resort)
  | 'visual';   // Visual similarity (AI-based)

/**
 * Features recorded about a locator strategy
 * These are facts captured at record time, used to compute scores at runtime
 */
export interface LocatorFeatures {
  /** Whether this selector matched exactly one element at record time */
  uniqueMatchAtRecordTime: boolean;
  /** How many elements matched at record time */
  matchCountAtRecordTime: number;
  /** Whether the selector uses stable attributes (data-testid, aria-label, name, id) */
  hasStableAttributes: boolean;
  /** Hint about whether the text content is likely to change */
  textStabilityHint: 'stable' | 'likely_dynamic' | 'unknown';
  /** Whether the element is within a shadow DOM */
  isWithinShadowDOM: boolean;
  /** Tag name of the matched element */
  recordedTagName: string;
  /** Role attribute if present */
  recordedRole?: string;
  /** Recorded text content (for text-based strategies) */
  recordedText?: string;
  /** Whether the selector contains dynamic parts (e.g., generated IDs) */
  hasDynamicParts: boolean;
}

/**
 * A single locator strategy with its features
 */
export interface LocatorStrategy {
  /** Type of locator strategy */
  type: LocatorType;
  /** The locator value (selector, xpath, text, etc.) */
  value: string;
  /** Features recorded at capture time */
  features: LocatorFeatures;
}

/**
 * Bundle of all locator strategies for finding an element
 */
export interface LocatorBundle {
  /** All strategies, to be ranked at runtime */
  strategies: LocatorStrategy[];
  /** Nearby text that can disambiguate between multiple matches */
  disambiguators: string[];
  /** Scope to search within */
  scope?: Scope;
  /** Original element tag name for validation */
  tagName: string;
  /** Original element role for validation */
  role?: string;
  
  /**
   * Recorded fallback selectors WITH container context.
   * These are CSS/XPath selectors that include the container/widget text.
   * e.g., "//div[descendant::*[contains(normalize-space(.), 'Widget Title')]]//button"
   * 
   * CRITICAL: These should be tried FIRST as they provide the most reliable disambiguation!
   */
  recordedFallbackSelectors?: string[];
  
  /**
   * Scope hint text from recording (e.g., widget title, container text).
   * Used to filter candidates when fallback selectors don't work.
   */
  scopeHint?: string;
}

/**
 * Create default features for a locator
 */
export function createDefaultFeatures(tagName: string): LocatorFeatures {
  return {
    uniqueMatchAtRecordTime: false,
    matchCountAtRecordTime: 0,
    hasStableAttributes: false,
    textStabilityHint: 'unknown',
    isWithinShadowDOM: false,
    recordedTagName: tagName,
    hasDynamicParts: false,
  };
}

/**
 * Create a CSS locator strategy
 */
export function createCSSLocator(
  selector: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'css',
    value: selector,
    features: { ...createDefaultFeatures(tagName), ...features },
  };
}

/**
 * Create a text-based locator strategy
 */
export function createTextLocator(
  text: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'text',
    value: text,
    features: { 
      ...createDefaultFeatures(tagName), 
      ...features,
      recordedText: text,
    },
  };
}

/**
 * Create an aria-label locator strategy
 */
export function createAriaLocator(
  ariaLabel: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'aria',
    value: ariaLabel,
    features: { 
      ...createDefaultFeatures(tagName), 
      ...features,
      hasStableAttributes: true,
    },
  };
}

/**
 * Create a role-based locator strategy
 */
export function createRoleLocator(
  role: string,
  accessibleName: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'role',
    value: `${role}:${accessibleName}`,
    features: { 
      ...createDefaultFeatures(tagName), 
      ...features,
      recordedRole: role,
      recordedText: accessibleName,
    },
  };
}

/**
 * Create a data-testid locator strategy
 */
export function createTestIdLocator(
  testId: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'testid',
    value: testId,
    features: { 
      ...createDefaultFeatures(tagName), 
      ...features,
      hasStableAttributes: true,
      textStabilityHint: 'stable',
    },
  };
}

/**
 * Create an XPath locator strategy
 */
export function createXPathLocator(
  xpath: string,
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'xpath',
    value: xpath,
    features: { ...createDefaultFeatures(tagName), ...features },
  };
}

/**
 * Create a position-based locator strategy (last resort)
 */
export function createPositionLocator(
  position: { x: number; y: number; width: number; height: number },
  features: Partial<LocatorFeatures>,
  tagName: string
): LocatorStrategy {
  return {
    type: 'position',
    value: JSON.stringify(position),
    features: { 
      ...createDefaultFeatures(tagName), 
      ...features,
      textStabilityHint: 'likely_dynamic', // Position is least stable
    },
  };
}

/**
 * Create an empty locator bundle
 */
export function createEmptyBundle(tagName: string, role?: string): LocatorBundle {
  return {
    strategies: [],
    disambiguators: [],
    tagName,
    role,
  };
}

/**
 * Check if a locator has stable attributes
 */
export function hasStableLocator(bundle: LocatorBundle): boolean {
  return bundle.strategies.some(s => 
    s.features.hasStableAttributes && 
    s.features.uniqueMatchAtRecordTime
  );
}

/**
 * Get the best locator strategy based on features (heuristic ranking)
 * Actual runtime scoring is done by the Resolver
 */
export function getBestStrategy(bundle: LocatorBundle): LocatorStrategy | null {
  if (bundle.strategies.length === 0) return null;
  
  // Priority order: testid > aria > role > css (unique) > text > xpath > position
  const priority: LocatorType[] = ['testid', 'aria', 'role', 'css', 'text', 'xpath', 'position', 'visual'];
  
  // Sort by priority and stability
  const sorted = [...bundle.strategies].sort((a, b) => {
    const aPriority = priority.indexOf(a.type);
    const bPriority = priority.indexOf(b.type);
    
    // Prefer stable attributes
    if (a.features.hasStableAttributes !== b.features.hasStableAttributes) {
      return a.features.hasStableAttributes ? -1 : 1;
    }
    
    // Prefer unique matches
    if (a.features.uniqueMatchAtRecordTime !== b.features.uniqueMatchAtRecordTime) {
      return a.features.uniqueMatchAtRecordTime ? -1 : 1;
    }
    
    // Fall back to priority order
    return aPriority - bPriority;
  });
  
  return sorted[0];
}

/**
 * Detect if a selector contains dynamic parts (generated IDs, etc.)
 */
export function hasDynamicParts(selector: string): boolean {
  // Common patterns for generated IDs
  const dynamicPatterns = [
    /[a-f0-9]{8,}/i,      // Long hex strings
    /\d{10,}/,             // Long numeric sequences
    /:r[a-z0-9]+:/i,       // React generated IDs
    /ng-\d+/,              // Angular generated
    /__[a-z0-9]+__/i,      // Double underscore patterns
    /[_-][a-f0-9]{4,}$/i,  // Trailing hex
  ];
  
  return dynamicPatterns.some(pattern => pattern.test(selector));
}

/**
 * Detect if text is likely dynamic (dates, numbers, etc.)
 */
export function isLikelyDynamicText(text: string): boolean {
  // Patterns that suggest dynamic content
  const dynamicPatterns = [
    /\d{1,2}\/\d{1,2}\/\d{2,4}/,  // Dates
    /\d{1,2}:\d{2}/,              // Times
    /\$[\d,.]+/,                   // Currency
    /^\d+$/,                       // Pure numbers
    /ago$/i,                       // "X minutes ago"
    /today|yesterday|tomorrow/i,
  ];
  
  return dynamicPatterns.some(pattern => pattern.test(text));
}








