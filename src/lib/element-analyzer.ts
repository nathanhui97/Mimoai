/**
 * Element Analyzer - Determines the best execution strategy during recording
 * 
 * Analyzes elements based on 8 stability signals to classify as:
 * - SIMPLE: Fast DOM-only execution (~50ms)
 * - AI_RECOMMENDED: Try DOM first, fallback to AI (~500ms-2s)
 * - AI_REQUIRED: Skip DOM, use AI directly (~2-3s)
 */

export type ExecutionStrategy = 'SIMPLE' | 'AI_RECOMMENDED' | 'AI_REQUIRED';

export interface ElementAnalysis {
  executionStrategy: ExecutionStrategy;
  confidence: number; // 0-100
  reasons: string[];
  bestSelector?: string;
  fallbackSelectors?: string[];
  signals: {
    stableIdentifiers: StableIdentifiersSignal;
    selectorUniqueness: SelectorUniquenessSignal;
    elementType: ElementTypeSignal;
    domContext: DOMContextSignal;
    dynamicClasses: DynamicClassesSignal;
    textStability: TextStabilitySignal;
    platform: PlatformSignal;
    renderPattern: RenderPatternSignal;
  };
}

interface StableIdentifiersSignal {
  hasTestId: boolean;
  hasAriaLabel: boolean;
  hasStableId: boolean;
  hasName: boolean;
  hasTitle: boolean;
}

interface SelectorUniquenessSignal {
  hasUniqueSelector: boolean;
  matchCount: number;
  uniqueSelectors: string[];
}

interface ElementTypeSignal {
  isNativeInteractive: boolean;
  hasAriaRole: boolean;
  isCustomComponent: boolean;
  isListItem: boolean;
  tagName: string;
}

interface DOMContextSignal {
  inShadowDOM: boolean;
  inIframe: boolean;
  inModal: boolean;
  depth: number;
}

interface DynamicClassesSignal {
  hasDynamicClasses: boolean;
  classCount: number;
  dynamicPatterns: string[];
}

interface TextStabilitySignal {
  hasStableText: boolean;
  textIsUnique: boolean;
  textContainsDynamic: boolean;
  text: string;
}

interface PlatformSignal {
  isSalesforce: boolean;
  isOffice365: boolean;
  isGmail: boolean;
  isNotion: boolean;
  isAirtable: boolean;
  isGeneric: boolean;
}

interface RenderPatternSignal {
  isVirtualList: boolean;
  isCanvasChild: boolean;
  isLazyLoaded: boolean;
  hasDynamicParent: boolean;
}

export class ElementAnalyzer {
  /**
   * Main analysis function - analyzes an element and returns execution strategy
   */
  static analyze(element: Element): ElementAnalysis {
    const signals = {
      stableIdentifiers: this.checkStableIdentifiers(element),
      selectorUniqueness: this.checkSelectorUniqueness(element),
      elementType: this.checkElementType(element),
      domContext: this.checkDOMContext(element),
      dynamicClasses: this.checkDynamicClasses(element),
      textStability: this.checkTextStability(element),
      platform: this.checkPlatform(),
      renderPattern: this.checkRenderPattern(element),
    };

    const { score, reasons } = this.calculateScore(signals);
    const strategy = this.determineStrategy(score);
    const selectors = this.generateSelectors(element, signals);

    return {
      executionStrategy: strategy,
      confidence: Math.max(0, Math.min(100, score)),
      reasons,
      bestSelector: selectors[0],
      fallbackSelectors: selectors.slice(1),
      signals,
    };
  }

  /**
   * Signal 1: Check for stable identifiers (testId, aria-label, etc.)
   */
  private static checkStableIdentifiers(element: Element): StableIdentifiersSignal {
    const id = element.id;
    const hasStableId = !!(id && !id.match(/\d{5,}|[a-f0-9]{8,}|^ember\d+|^react-|^:r/));

    return {
      hasTestId: !!element.getAttribute('data-testid'),
      hasAriaLabel: !!element.getAttribute('aria-label'),
      hasStableId,
      hasName: !!element.getAttribute('name'),
      hasTitle: !!element.getAttribute('title'),
    };
  }

  /**
   * Signal 2: Check selector uniqueness
   */
  private static checkSelectorUniqueness(element: Element): SelectorUniquenessSignal {
    const selectors = this.generateAllPossibleSelectors(element);
    const results = selectors.map(sel => {
      try {
        const matches = document.querySelectorAll(sel).length;
        return { selector: sel, matches, isUnique: matches === 1 };
      } catch {
        return { selector: sel, matches: 999, isUnique: false };
      }
    });

    const uniqueSelectors = results.filter(r => r.isUnique).map(r => r.selector);
    const minMatches = Math.min(...results.map(r => r.matches));

    return {
      hasUniqueSelector: uniqueSelectors.length > 0,
      matchCount: minMatches,
      uniqueSelectors,
    };
  }

  /**
   * Signal 3: Check element type
   */
  private static checkElementType(element: Element): ElementTypeSignal {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    return {
      isNativeInteractive: ['button', 'a', 'input', 'select', 'textarea'].includes(tag),
      hasAriaRole: !!role,
      isCustomComponent: tag.includes('-'),
      isListItem: role === 'option' || role === 'menuitem' || role === 'listitem',
      tagName: tag,
    };
  }

  /**
   * Signal 4: Check DOM context
   */
  private static checkDOMContext(element: Element): DOMContextSignal {
    const rootNode = element.getRootNode();
    const inShadowDOM = rootNode !== document && !!(rootNode as ShadowRoot).host;

    return {
      inShadowDOM,
      inIframe: window !== window.top,
      inModal: !!element.closest('[role="dialog"], .modal, [aria-modal="true"]'),
      depth: this.getElementDepth(element),
    };
  }

  /**
   * Signal 5: Check for dynamic classes (CSS modules, emotion, styled-components)
   */
  private static checkDynamicClasses(element: Element): DynamicClassesSignal {
    const classes = element.className.toString();
    const dynamicPatterns = [
      /[a-z]+-[a-zA-Z0-9]{5,}/, // CSS modules: Button-abc123
      /css-[a-z0-9]+/,          // Emotion: css-1abc23
      /sc-[a-zA-Z]+/,           // styled-components
      /[a-z]+__[a-z]+--[a-z0-9]+/, // BEM with hash
    ];

    const matchedPatterns = dynamicPatterns
      .map((p, i) => p.test(classes) ? `pattern${i}` : null)
      .filter(Boolean) as string[];

    return {
      hasDynamicClasses: matchedPatterns.length > 0,
      classCount: classes.split(/\s+/).filter(Boolean).length,
      dynamicPatterns: matchedPatterns,
    };
  }

  /**
   * Signal 6: Check text stability
   */
  private static checkTextStability(element: Element): TextStabilitySignal {
    const text = this.getVisibleText(element);
    
    let textIsUnique = false;
    if (text && text.length > 0) {
      try {
        const xpath = `//*[normalize-space(text())="${text}"]`;
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        textIsUnique = result.snapshotLength === 1;
      } catch {
        textIsUnique = false;
      }
    }

    return {
      hasStableText: text.length > 0 && text.length < 100,
      textIsUnique,
      textContainsDynamic: /\d{4,}|today|now|\$\d+|ago|minutes?|hours?|days?/i.test(text),
      text,
    };
  }

  /**
   * Signal 7: Check platform
   */
  private static checkPlatform(): PlatformSignal {
    const url = window.location.hostname;

    const isSalesforce = url.includes('force.com') || url.includes('salesforce.com');
    const isOffice365 = url.includes('office.com') || url.includes('sharepoint.com');
    const isGmail = url.includes('mail.google.com');
    const isNotion = url.includes('notion.so');
    const isAirtable = url.includes('airtable.com');

    return {
      isSalesforce,
      isOffice365,
      isGmail,
      isNotion,
      isAirtable,
      isGeneric: !(isSalesforce || isOffice365 || isGmail || isNotion || isAirtable),
    };
  }

  /**
   * Signal 8: Check render pattern
   */
  private static checkRenderPattern(element: Element): RenderPatternSignal {
    return {
      isVirtualList: !!element.closest('[data-virtualized], .virtual-list, [class*="virtual"]'),
      isCanvasChild: !!element.closest('canvas'),
      isLazyLoaded: element.getAttribute('loading') === 'lazy',
      hasDynamicParent: !!element.closest('[data-reactroot], [ng-app], [data-vue-app]'),
    };
  }

  /**
   * Calculate score based on all signals
   */
  private static calculateScore(signals: ElementAnalysis['signals']): { score: number; reasons: string[] } {
    let score = 50; // Start neutral
    const reasons: string[] = [];

    // Positive signals (toward SIMPLE)
    if (signals.stableIdentifiers.hasTestId) {
      score += 30;
      reasons.push('✓ has data-testid (+30)');
    }
    if (signals.stableIdentifiers.hasAriaLabel) {
      score += 25;
      reasons.push('✓ has aria-label (+25)');
    }
    if (signals.stableIdentifiers.hasStableId) {
      score += 20;
      reasons.push('✓ has stable ID (+20)');
    }
    if (signals.stableIdentifiers.hasName) {
      score += 15;
      reasons.push('✓ has name attribute (+15)');
    }

    if (signals.selectorUniqueness.hasUniqueSelector) {
      score += 20;
      reasons.push('✓ unique selector exists (+20)');
    } else {
      score -= 20;
      reasons.push(`✗ no unique selector (${signals.selectorUniqueness.matchCount} matches) (-20)`);
    }

    if (signals.elementType.isNativeInteractive) {
      score += 15;
      reasons.push('✓ native interactive element (+15)');
    }
    if (signals.elementType.isListItem) {
      // REDUCED PENALTY: List items with stable text are actually quite reliable
      // when we have proper container scoping. The old -25 was too harsh.
      // Items with role="option" or role="menuitem" are well-structured
      // and can be reliably identified by text within their container.
      if (signals.textStability.hasStableText && signals.textStability.textIsUnique) {
        // List item with unique, stable text - actually fairly reliable
        score -= 5;
        reasons.push('⚠ list item with unique text (-5)');
      } else if (signals.textStability.hasStableText) {
        // List item with stable text but not unique - needs container scoping
        score -= 10;
        reasons.push('⚠ list item with stable text (-10)');
      } else {
        // List item without stable text - less reliable
        score -= 15;
        reasons.push('✗ list item without stable text (-15)');
      }
    }
    if (signals.elementType.isCustomComponent) {
      score -= 10;
      reasons.push('⚠ custom web component (-10)');
    }

    if (signals.textStability.hasStableText) {
      score += 10;
      reasons.push('✓ has stable text (+10)');
    }
    if (signals.textStability.textIsUnique) {
      score += 15;
      reasons.push('✓ text is unique (+15)');
    }
    if (signals.textStability.textContainsDynamic) {
      score -= 15;
      reasons.push('✗ text contains dynamic content (-15)');
    }

    // Negative signals (toward AI_REQUIRED)
    if (signals.domContext.inShadowDOM) {
      score -= 15;
      reasons.push('⚠ in shadow DOM (-15)');
    }
    if (signals.domContext.inIframe) {
      score -= 15;
      reasons.push('⚠ in iframe (-15)');
    }
    if (signals.domContext.inModal) {
      score -= 10;
      reasons.push('⚠ in modal (-10)');
    }

    if (signals.dynamicClasses.hasDynamicClasses) {
      score -= 20;
      reasons.push('✗ has dynamic classes (-20)');
    }

    if (signals.platform.isSalesforce) {
      score -= 15;
      reasons.push('⚠ Salesforce platform (-15)');
    }
    if (signals.platform.isOffice365) {
      score -= 10;
      reasons.push('⚠ Office 365 platform (-10)');
    }

    if (signals.renderPattern.isVirtualList) {
      score -= 40;
      reasons.push('✗✗ virtual list element (-40)');
    }
    if (signals.renderPattern.isCanvasChild) {
      score -= 50;
      reasons.push('✗✗ canvas element (-50)');
    }
    if (signals.renderPattern.hasDynamicParent) {
      score -= 10;
      reasons.push('⚠ dynamic framework parent (-10)');
    }

    return { score, reasons };
  }

  /**
   * Determine execution strategy based on score
   */
  private static determineStrategy(score: number): ExecutionStrategy {
    if (score >= 70) return 'SIMPLE';
    if (score >= 40) return 'AI_RECOMMENDED';
    return 'AI_REQUIRED';
  }

  /**
   * Generate selectors in priority order
   */
  private static generateSelectors(element: Element, signals: ElementAnalysis['signals']): string[] {
    const selectors: string[] = [];

    // Priority 1: testId
    if (signals.stableIdentifiers.hasTestId) {
      selectors.push(`[data-testid="${element.getAttribute('data-testid')}"]`);
    }

    // Priority 2: aria-label
    if (signals.stableIdentifiers.hasAriaLabel) {
      selectors.push(`[aria-label="${element.getAttribute('aria-label')}"]`);
    }

    // Priority 3: stable ID
    if (signals.stableIdentifiers.hasStableId) {
      selectors.push(`#${element.id}`);
    }

    // Priority 4: name
    if (signals.stableIdentifiers.hasName) {
      selectors.push(`[name="${element.getAttribute('name')}"]`);
    }

    // Priority 5: role + text
    if (signals.elementType.hasAriaRole && signals.textStability.hasStableText) {
      const role = element.getAttribute('role');
      const text = signals.textStability.text;
      selectors.push(`[role="${role}"][aria-label*="${text}"]`);
    }

    // Priority 6: tag + text (if unique)
    if (signals.textStability.textIsUnique) {
      const tag = signals.elementType.tagName;
      const text = signals.textStability.text;
      selectors.push(`${tag}:contains("${text}")`); // Note: pseudo-selector, needs custom impl
    }

    // Priority 7: XPath with text
    if (signals.textStability.hasStableText) {
      const text = signals.textStability.text;
      selectors.push(`xpath=//*[normalize-space(text())="${text}"]`);
    }

    return selectors.filter(Boolean);
  }

  /**
   * Generate all possible selectors for uniqueness check
   */
  private static generateAllPossibleSelectors(element: Element): string[] {
    const selectors: string[] = [];

    if (element.id) selectors.push(`#${element.id}`);
    if (element.getAttribute('data-testid')) {
      selectors.push(`[data-testid="${element.getAttribute('data-testid')}"]`);
    }
    if (element.getAttribute('aria-label')) {
      selectors.push(`[aria-label="${element.getAttribute('aria-label')}"]`);
    }
    if (element.getAttribute('name')) {
      selectors.push(`[name="${element.getAttribute('name')}"]`);
    }
    if (element.className) {
      const classes = element.className.toString().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        selectors.push(`.${classes.join('.')}`);
      }
    }

    return selectors;
  }

  /**
   * Get visible text from element (only direct text, not children)
   */
  private static getVisibleText(element: Element): string {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let text = '';
    let node;
    let depth = 0;
    const maxDepth = 2; // Only go 2 levels deep

    while ((node = walker.nextNode()) && depth < maxDepth) {
      if (node.nodeValue) {
        text += node.nodeValue;
      }
      depth++;
    }

    return text.trim().replace(/\s+/g, ' ').substring(0, 100);
  }

  /**
   * Get element depth in DOM tree
   */
  private static getElementDepth(element: Element): number {
    let depth = 0;
    let current: Element | null = element;
    while (current.parentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  /**
   * Pretty print analysis for logging
   */
  static formatAnalysis(analysis: ElementAnalysis): string {
    const { executionStrategy, confidence, reasons } = analysis;
    
    let emoji = '✅';
    if (executionStrategy === 'AI_RECOMMENDED') emoji = '⚠️';
    if (executionStrategy === 'AI_REQUIRED') emoji = '🤖';

    const lines = [
      `${emoji} ${executionStrategy} (Confidence: ${confidence}/100)`,
      '',
      'Reasons:',
      ...reasons.map(r => `  ${r}`),
      '',
      `Best Selector: ${analysis.bestSelector || 'none'}`,
    ];

    if (analysis.fallbackSelectors && analysis.fallbackSelectors.length > 0) {
      lines.push(`Fallback Selectors: ${analysis.fallbackSelectors.length} available`);
    }

    return lines.join('\n');
  }
}





