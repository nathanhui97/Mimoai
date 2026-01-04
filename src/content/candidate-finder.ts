/**
 * CandidateFinder - Find candidate elements for each locator strategy
 * 
 * Separated from ElementFinder for cleaner architecture.
 * This module ONLY finds candidates - the Resolver decides which one to use.
 */

import type { LocatorBundle, LocatorStrategy, LocatorType } from '../types/locator';
import { resolveScopeContainer } from '../types/scope';
import { TextMatcher } from './text-matcher';
import { FeatureFlags } from '../lib/feature-flags';
import { computeAccessibleName } from '../lib/accessible-name';
import { ShadowDOMUtils } from './shadow-dom-utils';

/**
 * Result from finding a candidate element
 */
export interface CandidateResult {
  /** The matched element */
  element: Element;
  /** Which strategy found this element */
  strategy: LocatorStrategy;
  /** Text that matched (for text-based strategies) */
  matchedText?: string;
  /** Similarity score for fuzzy matches (0-1) */
  matchScore?: number;
}

/**
 * CandidateFinder finds all candidate elements for each locator strategy
 */
export class CandidateFinder {
  /**
   * Shadow-aware querySelectorAll - searches both light DOM and shadow DOM
   */
  private static querySelectorAllDeep(container: Element, selector: string): Element[] {
    const results: Element[] = [];
    
    // Phase 1: Light DOM
    try {
      const lightDOMMatches = container.querySelectorAll(selector);
      results.push(...Array.from(lightDOMMatches));
    } catch (e) {
      // Invalid selector
    }
    
    // Phase 2: Shadow DOM
    let shadowDOMCount = 0;
    ShadowDOMUtils.traverseShadowDOM(container.ownerDocument || document, (el) => {
      // Only include elements that are descendants of the container
      // (either in light DOM or shadow DOM)
      const shadowHost = (el.getRootNode() as ShadowRoot).host;
      if (shadowHost && container.contains(shadowHost)) {
        if (el.matches(selector)) {
          // Deduplicate - check if already in results
          if (!results.includes(el)) {
            results.push(el);
            shadowDOMCount++;
          }
        }
      }
    });
    
    if (shadowDOMCount > 0) {
      console.log(`[CandidateFinder] Found ${shadowDOMCount} additional elements in shadow DOM`);
    }
    
    return results;
  }
  
  /**
   * Find all candidates for each strategy within scope
   * Returns a map of strategy type -> candidates found
   */
  static findCandidates(
    bundle: LocatorBundle,
    doc: Document = document
  ): Map<LocatorType, CandidateResult[]> {
    const results = new Map<LocatorType, CandidateResult[]>();
    
    // Resolve scope container
    // CRITICAL: If scope resolution fails, fall back to document-wide search
    // We'll use scope for disambiguation later if multiple candidates are found
    let scopeContainer = bundle.scope 
      ? resolveScopeContainer(bundle.scope, doc)
      : doc.body;
    
    if (!scopeContainer) {
      const scopeDesc = bundle.scope?.kind === 'WIDGET' 
        ? `${bundle.scope.kind}:${bundle.scope.title}`
        : bundle.scope?.kind || 'unknown';
      console.warn(`[CandidateFinder] ⚠️ Scope "${scopeDesc}" not found, falling back to document-wide search`);
      scopeContainer = doc.body; // Fall back to full document search
      // DON'T abort - continue with document-wide search and use scope for disambiguation later
    }
    
    // Find candidates for each strategy
    for (const strategy of bundle.strategies) {
      const candidates = this.findByStrategy(strategy, scopeContainer, doc);
      
      if (candidates.length > 0) {
        const existing = results.get(strategy.type) || [];
        results.set(strategy.type, [...existing, ...candidates]);
      }
    }
    
    // Special fallback: If no candidates found and we're looking for dropdown options,
    // search the entire document (for portals/overlays)
    if (results.size === 0 || Array.from(results.values()).every(arr => arr.length === 0)) {
      // Check if any strategy suggests we're looking for a dropdown option
      const isDropdownOption = bundle.strategies.some(s => 
        s.value.includes('option') || 
        s.value.includes('BOGO') || 
        s.value.includes('FLAT') ||
        s.value.includes('role') ||
        s.features.recordedTagName === 'li' ||
        bundle.role === 'option'
      );
      
      if (isDropdownOption) {
        console.log('CandidateFinder: No candidates found in scope, searching entire document for dropdown option...');
        // Search entire document body for dropdown options
        const allOptions = doc.querySelectorAll('[role="option"], li[role="option"], [role="listbox"] [role="option"], li');
        for (const option of Array.from(allOptions)) {
          if (this.isElementVisible(option)) {
            // Get text from the option (including nested children)
            let optionText = option.textContent?.trim() || '';
            
            // If no direct text, check nested children (for wrapper divs)
            if (!optionText || optionText.length === 0) {
              const childTextElements = option.querySelectorAll('div, span, p, label');
              for (const child of Array.from(childTextElements)) {
                const childText = child.textContent?.trim();
                if (childText && childText.length > 0) {
                  optionText = childText;
                  break;
                }
              }
            }
            
            if (!optionText) continue;
            
            // Check if any strategy text matches
            for (const strategy of bundle.strategies) {
              if (strategy.type === 'text' || strategy.type === 'role') {
                const targetText = strategy.value;
                // For role strategy, extract the name part (e.g., "option:BOGO" -> "BOGO")
                const textToMatch = strategy.type === 'role' && targetText.includes(':') 
                  ? targetText.split(':')[1] 
                  : targetText;
                
                if (textToMatch && !textToMatch.startsWith('//') && !textToMatch.startsWith('/')) {
                  const score = TextMatcher.similarityScore(textToMatch, optionText);
                  if (score >= 0.7) {
                    // For dropdown options with wrapper divs, try to find the clickable child
                    let clickableElement = option;
                    if (option.getAttribute('role') === 'option' || option.tagName === 'LI') {
                      const clickableChildren = option.querySelectorAll('div, span, button, a');
                      for (const child of Array.from(clickableChildren)) {
                        const childText = child.textContent?.trim();
                        if (childText && TextMatcher.similarityScore(textToMatch, childText) >= 0.7) {
                          if (child instanceof HTMLElement && this.isElementVisible(child)) {
                            clickableElement = child;
                            break;
                          }
                        }
                      }
                    }
                    
                    // Found a match - add to results
                    const existing = results.get(strategy.type) || [];
                    results.set(strategy.type, [...existing, {
                      element: clickableElement,
                      strategy,
                      matchedText: optionText,
                      matchScore: score,
                    }]);
                    console.log(`CandidateFinder: Found dropdown option in document: "${optionText}" (score: ${score.toFixed(2)})`);
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
    
    return results;
  }
  
  /**
   * Find candidates using a single strategy
   */
  static findByStrategy(
    strategy: LocatorStrategy,
    scopeContainer: Element,
    doc: Document = document
  ): CandidateResult[] {
    // Skip XPath if disabled via feature flag
    if (strategy.type === 'xpath' && !FeatureFlags.XPATH_FALLBACK) {
      console.log('[CandidateFinder] Skipping XPath strategy (XPATH_FALLBACK flag disabled)');
      return [];
    }
    
    switch (strategy.type) {
      case 'css':
        return this.findByCSS(strategy, scopeContainer);
      case 'xpath':
        return this.findByXPath(strategy, scopeContainer, doc);
      case 'text':
        return this.findByText(strategy, scopeContainer);
      case 'aria':
        return this.findByAria(strategy, scopeContainer);
      case 'role':
        return this.findByRole(strategy, scopeContainer);
      case 'testid':
        return this.findByTestId(strategy, scopeContainer);
      case 'position':
        return this.findByPosition(strategy, scopeContainer, doc);
      case 'visual':
        // Visual matching is async and handled separately
        return [];
      default:
        return [];
    }
  }
  
  /**
   * Find by CSS selector
   */
  private static findByCSS(
    strategy: LocatorStrategy,
    scopeContainer: Element
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    
    try {
      const elements = this.querySelectorAllDeep(scopeContainer, strategy.value);
      for (const element of elements) {
        if (this.isElementVisible(element)) {
          results.push({
            element,
            strategy,
            matchScore: 1.0, // Exact CSS match
          });
        }
      }
    } catch (e) {
      // Invalid selector
      console.warn('CandidateFinder: Invalid CSS selector:', strategy.value);
    }
    
    return results;
  }
  
  /**
   * Find by XPath
   */
  private static findByXPath(
    strategy: LocatorStrategy,
    scopeContainer: Element,
    doc: Document
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    
    try {
      // First try within scope
      let xpathResult = doc.evaluate(
        strategy.value,
        scopeContainer,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      
      // If no results and we're looking for dropdown options, try document-wide search
      if (xpathResult.snapshotLength === 0 && 
          (strategy.value.includes('option') || strategy.value.includes('role') || strategy.value.includes('listbox'))) {
        console.log('CandidateFinder: No XPath matches in scope, trying document-wide search...');
        xpathResult = doc.evaluate(
          strategy.value,
          doc,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
      }
      
      for (let i = 0; i < xpathResult.snapshotLength; i++) {
        const node = xpathResult.snapshotItem(i);
        if (node instanceof Element && this.isElementVisible(node)) {
          // For dropdown options, try to find clickable child if text is in a wrapper
          let clickableElement = node;
          
          // If XPath found a parent element but the actual clickable element is a child
          if (node.getAttribute('role') === 'option' || node.tagName === 'LI') {
            // Check if there's a more specific clickable child
            const clickableChildren = node.querySelectorAll('div, span, button, a');
            for (const child of Array.from(clickableChildren)) {
              if (child instanceof HTMLElement && this.isElementVisible(child)) {
                // Prefer child if it's more specific (has more attributes or is interactive)
                if (child.hasAttribute('onclick') || 
                    child.tagName === 'BUTTON' || 
                    child.tagName === 'A' ||
                    child.getAttribute('role') === 'button') {
                  clickableElement = child;
                  break;
                }
              }
            }
          }
          
          results.push({
            element: clickableElement,
            strategy,
            matchScore: 1.0,
          });
        }
      }
    } catch (e) {
      // Invalid XPath
      console.warn('CandidateFinder: Invalid XPath:', strategy.value, e);
    }
    
    return results;
  }
  
  /**
   * Find by text content (fuzzy matching)
   */
  private static findByText(
    strategy: LocatorStrategy,
    scopeContainer: Element
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    const targetText = strategy.value;
    
    // Safety check: skip empty or unlabeled text
    if (!targetText || targetText.trim() === '' || targetText === '(unlabeled)') {
      console.warn('CandidateFinder: findByText received empty or unlabeled value, skipping');
      return results;
    }
    
    // Safety check: if value looks like XPath, skip (should be handled by xpath strategy)
    if (targetText.startsWith('//') || targetText.startsWith('/')) {
      console.warn('CandidateFinder: findByText received XPath value, skipping:', targetText);
      return results;
    }
    
    const threshold = 0.7;
    
    // Get tag hints from recorded features
    const tagHints = this.getTagHints(strategy.features.recordedTagName);
    const selector = tagHints.length > 0 ? tagHints.join(', ') : '*';
    
    try {
      const candidates = scopeContainer.querySelectorAll(selector);
      
      for (const candidate of Array.from(candidates)) {
        if (!this.isElementVisible(candidate)) continue;
        
        // Get text from multiple sources (including nested children)
        let candidateText = 
          candidate.textContent?.trim() ||
          candidate.getAttribute('aria-label') ||
          candidate.getAttribute('title') ||
          '';
        
        // If no direct text, check for nested text in children (for wrapper divs)
        if (!candidateText || candidateText.length === 0) {
          // Look for direct child elements that might contain the text
          const childTextElements = candidate.querySelectorAll('div, span, p, label');
          for (const child of Array.from(childTextElements)) {
            const childText = child.textContent?.trim();
            if (childText && childText.length > 0) {
              candidateText = childText;
              break; // Use first non-empty child text
            }
          }
        }
        
        if (!candidateText) continue;
        
        // Calculate similarity
        const score = TextMatcher.similarityScore(targetText, candidateText);
        
        if (score >= threshold) {
          // For dropdown options with wrapper divs, try to find the clickable child
          let clickableElement = candidate;
          
          // If this is a dropdown option (li[role="option"]), check for clickable children
          if (candidate.getAttribute('role') === 'option' || candidate.tagName === 'LI') {
            // Look for a clickable child (div, span, or button) that contains the matching text
            const clickableChildren = candidate.querySelectorAll('div, span, button, a');
            for (const child of Array.from(clickableChildren)) {
              const childText = child.textContent?.trim();
              if (childText && TextMatcher.similarityScore(targetText, childText) >= threshold) {
                // Prefer the child if it's more specific
                if (child instanceof HTMLElement && this.isElementVisible(child)) {
                  clickableElement = child;
                  break;
                }
              }
            }
          }
          
          results.push({
            element: clickableElement,
            strategy,
            matchedText: candidateText,
            matchScore: score,
          });
        }
      }
    } catch (e) {
      // Invalid selector - return empty results
      console.warn('CandidateFinder: Invalid selector in findByText:', selector, e);
      return results;
    }
    
    // Sort by score descending
    results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    
    return results;
  }
  
  /**
   * Find by aria-label
   */
  private static findByAria(
    strategy: LocatorStrategy,
    scopeContainer: Element
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    const targetLabel = strategy.value.toLowerCase();
    
    // First try exact match
    const exactSelector = `[aria-label="${strategy.value}"]`;
    try {
      const exactMatches = this.querySelectorAllDeep(scopeContainer, exactSelector);
      for (const element of exactMatches) {
        if (this.isElementVisible(element)) {
          results.push({
            element,
            strategy,
            matchedText: strategy.value,
            matchScore: 1.0,
          });
        }
      }
    } catch (e) {
      // Selector might have special characters
    }
    
    // If no exact matches, try fuzzy
    if (results.length === 0) {
      const candidates = this.querySelectorAllDeep(scopeContainer, '[aria-label]');
      for (const candidate of candidates) {
        if (!this.isElementVisible(candidate)) continue;
        
        const ariaLabel = candidate.getAttribute('aria-label')?.toLowerCase() || '';
        const score = TextMatcher.similarityScore(targetLabel, ariaLabel);
        
        if (score >= 0.8) {
          results.push({
            element: candidate,
            strategy,
            matchedText: ariaLabel,
            matchScore: score,
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Find by role + accessible name
   */
  private static findByRole(
    strategy: LocatorStrategy,
    scopeContainer: Element
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    
    // Parse role:accessibleName format
    const [role, accessibleName] = strategy.value.split(':');
    if (!role) return results;
    
    const roleSelector = `[role="${role}"]`;
    
    try {
      const candidates = this.querySelectorAllDeep(scopeContainer, roleSelector);
      
      for (const candidate of candidates) {
        if (!this.isElementVisible(candidate)) continue;
        
        // Get accessible name properly (handles labels, aria-labelledby, etc.)
        const candidateName = computeAccessibleName(candidate) || '';
        
        if (accessibleName) {
          const score = TextMatcher.similarityScore(accessibleName, candidateName);
          if (score >= 0.7) {
            results.push({
              element: candidate,
              strategy,
              matchedText: candidateName,
              matchScore: score,
            });
          }
        } else {
          // No name filter, just role match
          results.push({
            element: candidate,
            strategy,
            matchScore: 0.8, // Lower score since no name match
          });
        }
      }
    } catch (e) {
      // Invalid selector
      console.warn('[CandidateFinder] Error in findByRole:', e);
    }
    
    return results;
  }
  
  /**
   * Find by data-testid
   */
  private static findByTestId(
    strategy: LocatorStrategy,
    scopeContainer: Element
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    
    // Try common test ID attributes
    const testIdAttrs = ['data-testid', 'data-test-id', 'data-test', 'data-cy'];
    
    for (const attr of testIdAttrs) {
      const selector = `[${attr}="${strategy.value}"]`;
      try {
        const elements = scopeContainer.querySelectorAll(selector);
        for (const element of Array.from(elements)) {
          if (this.isElementVisible(element)) {
            results.push({
              element,
              strategy,
              matchedText: strategy.value,
              matchScore: 1.0, // Test IDs are very reliable
            });
          }
        }
      } catch (e) {
        // Invalid selector
      }
    }
    
    return results;
  }
  
  /**
   * Find by position (last resort)
   */
  private static findByPosition(
    strategy: LocatorStrategy,
    scopeContainer: Element,
    _doc: Document
  ): CandidateResult[] {
    const results: CandidateResult[] = [];
    
    try {
      const position = JSON.parse(strategy.value) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      
      // Get tag hints
      const tagHints = this.getTagHints(strategy.features.recordedTagName);
      const selector = tagHints.length > 0 ? tagHints.join(', ') : '*';
      
      const candidates = scopeContainer.querySelectorAll(selector);
      
      for (const candidate of Array.from(candidates)) {
        if (!this.isElementVisible(candidate)) continue;
        
        const rect = candidate.getBoundingClientRect();
        
        // Calculate distance from recorded position
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const targetX = position.x + position.width / 2;
        const targetY = position.y + position.height / 2;
        
        const distance = Math.sqrt(
          Math.pow(centerX - targetX, 2) + Math.pow(centerY - targetY, 2)
        );
        
        // Accept if within 100px
        if (distance < 100) {
          const score = 1 - (distance / 100); // 0-1 score based on distance
          results.push({
            element: candidate,
            strategy,
            matchScore: score,
          });
        }
      }
      
      // Sort by distance (closest first)
      results.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
      
    } catch (e) {
      // Invalid position JSON
    }
    
    return results;
  }
  
  /**
   * Get tag hints based on recorded tag name
   */
  private static getTagHints(tagName: string): string[] {
    // Safety check: if tagName is empty, return empty array (will use '*' selector)
    if (!tagName || tagName.trim() === '') {
      return [];
    }
    
    const tag = tagName.toLowerCase();
    
    switch (tag) {
      case 'button':
        return ['button', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'];
      case 'a':
        return ['a', '[role="link"]'];
      case 'input':
        return ['input', 'textarea', '[contenteditable="true"]'];
      case 'select':
        return ['select', '[role="combobox"]', '[role="listbox"]'];
      case 'li':
        return ['li', '[role="option"]', '[role="menuitem"]', '[role="listitem"]'];
      case 'option':
        return ['[role="option"]', 'option', 'li'];
      default:
        return [tag];
    }
  }
  
  /**
   * Check if element is visible
   */
  private static isElementVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    return true;
  }
  
  /**
   * Filter candidates by nearby text (disambiguators)
   */
  static filterByDisambiguators(
    candidates: CandidateResult[],
    disambiguators: string[]
  ): CandidateResult[] {
    if (disambiguators.length === 0 || candidates.length <= 1) {
      return candidates;
    }
    
    const scored = candidates.map(candidate => {
      let disambiguatorScore = 0;
      
      // Get text from parent and siblings
      const parent = candidate.element.parentElement;
      if (parent) {
        const parentText = parent.textContent?.toLowerCase() || '';
        
        for (const disambiguator of disambiguators) {
          if (parentText.includes(disambiguator.toLowerCase())) {
            disambiguatorScore += 1;
          }
        }
      }
      
      return {
        candidate,
        disambiguatorScore: disambiguatorScore / disambiguators.length,
      };
    });
    
    // Sort by disambiguator match count
    scored.sort((a, b) => b.disambiguatorScore - a.disambiguatorScore);
    
    // If top candidate has significantly better disambiguator match, return just it
    if (scored.length > 1 && 
        scored[0].disambiguatorScore > 0 &&
        scored[0].disambiguatorScore > scored[1].disambiguatorScore + 0.3) {
      return [scored[0].candidate];
    }
    
    return scored.map(s => s.candidate);
  }
}

