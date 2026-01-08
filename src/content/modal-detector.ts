/**
 * Modal Detector - Universal structural modal detection
 * 
 * Detects REAL modals across all websites using structural signals
 * instead of fragile heuristics like form field counts.
 */

export interface ModalScore {
  isModal: boolean;
  score: number;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detect if an element is a real modal using structural signals
 * Works universally across all websites (Salesforce, Gainsight, etc.)
 */
export function isRealModal(element: Element): ModalScore {
  const reasons: string[] = [];
  let score = 0;
  
  // ============================================================================
  // CRITICAL: Check for Persistent UI Panels FIRST (before any scoring)
  // ============================================================================
  // Persistent panels/sidebars are always visible, not popups
  // They're part of the page layout, not blocking modals
  // If detected, immediately reject as modal (don't even calculate score)
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const isPersistentPanel = detectPersistentPanel(element, rect, style);
  if (isPersistentPanel) {
    console.log('[ModalDetector] 🚫 Persistent panel detected - REJECTING as modal (not a popup)');
    return { 
      isModal: false, 
      score: -20, // Negative score to ensure it's never considered
      reasons: ['Persistent UI panel detected (always visible, not a popup) - REJECTED'],
      confidence: 'high' 
    };
  }
  
  // ============================================================================
  // Signal 1: ARIA Role (Most Reliable - Authoritative)
  // ============================================================================
  const role = element.getAttribute('role');
  if (role === 'dialog' || role === 'alertdialog') {
    score += 5;
    reasons.push(`ARIA role="${role}" (authoritative)`);
  }
  
  // ============================================================================
  // Signal 2: Z-Index (Modals float above everything)
  // ============================================================================
  const zIndex = parseInt(window.getComputedStyle(element).zIndex || '0');
  if (zIndex > 1000) {
    score += 3;
    reasons.push(`High z-index: ${zIndex}`);
  } else if (zIndex > 100) {
    score += 1;
    reasons.push(`Moderate z-index: ${zIndex}`);
  }
  
  // ============================================================================
  // Signal 3: Backdrop/Overlay Detection
  // ============================================================================
  const hasBackdrop = detectBackdrop();
  if (hasBackdrop) {
    score += 3;
    reasons.push('Backdrop/overlay detected');
  }
  
  // ============================================================================
  // Signal 4: Positioning (Fixed or Absolute)
  // ============================================================================
  // Note: style already computed above for persistent panel check
  const isFloating = style.position === 'fixed' || style.position === 'absolute';
  if (isFloating) {
    score += 2;
    reasons.push(`Floating position: ${style.position}`);
  }
  
  // ============================================================================
  // Signal 5: Size Constraints (Modals don't fill entire screen)
  // ============================================================================
  // Note: rect already computed above for persistent panel check
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = rect.width * rect.height;
  const screenCoverage = elementArea / viewportArea;
  
  if (screenCoverage < 0.8 && screenCoverage > 0.1) {
    // Modal-sized (between 10% and 80% of screen)
    score += 2;
    reasons.push(`Modal-sized: ${Math.round(screenCoverage * 100)}% of screen`);
  } else if (screenCoverage >= 0.9) {
    // Full-screen (90%+) - VERY likely app container, not modal
    // Real modals almost never cover more than 90% of the viewport
    score -= 5;
    reasons.push(`Full-screen: ${Math.round(screenCoverage * 100)}% of screen (heavy penalty: -5)`);
  } else if (screenCoverage >= 0.8) {
    // Large element (80-90%) - suspicious, penalize
    score -= 2;
    reasons.push(`Large element: ${Math.round(screenCoverage * 100)}% of screen (penalty: -2)`);
  }
  
  // ============================================================================
  // Signal 6: Close Button Detection
  // ============================================================================
  const hasCloseButton = detectCloseButton(element);
  if (hasCloseButton) {
    score += 2;
    reasons.push('Close button detected');
  }
  
  // ============================================================================
  // Signal 7: Modal Keywords in Attributes
  // ============================================================================
  const hasModalAttributes = detectModalAttributes(element);
  if (hasModalAttributes) {
    score += 1;
    reasons.push('Modal-related attributes found');
  }
  
  // ============================================================================
  // Signal 8: Centered Positioning
  // ============================================================================
  const isCentered = detectCenteredPositioning(element, rect);
  if (isCentered) {
    score += 1;
    reasons.push('Centered in viewport');
  }
  
  // ============================================================================
  // Penalty: Too Many Interactive Elements (App Container Detection)
  // ============================================================================
  const interactiveElements = element.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]'
  );
  const interactiveCount = interactiveElements.length;
  
  if (interactiveCount > 100) {
    // Real modals rarely have >100 interactive elements
    // This is likely an app container (Salesforce, Gainsight, etc.)
    score -= 10;
    reasons.push(`Too many interactive elements: ${interactiveCount} (likely app container, penalty: -10)`);
  } else if (interactiveCount > 50) {
    score -= 3;
    reasons.push(`Many interactive elements: ${interactiveCount} (penalty: -3)`);
  }
  
  // ============================================================================
  // Determine Confidence
  // ============================================================================
  let confidence: 'high' | 'medium' | 'low';
  if (score >= 10) {
    confidence = 'high';
  } else if (score >= 8) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Require score of 8+ to be considered a modal (raised from 5 to reduce false positives)
  const isModal = score >= 8;
  
  if (isModal) {
    console.log(`[ModalDetector] ✅ Real modal detected (score: ${score}, confidence: ${confidence})`);
    console.log(`[ModalDetector] Reasons:`, reasons);
  }
  
  return { isModal, score, reasons, confidence };
}

/**
 * Detect if there's a backdrop/overlay element
 */
function detectBackdrop(): boolean {
  // Look for common backdrop patterns
  const backdropSelectors = [
    '[class*="backdrop"]',
    '[class*="overlay"]',
    '[class*="modal-backdrop"]',
    '[class*="slds-backdrop"]', // Salesforce
    '[class*="MuiBackdrop"]', // Material-UI
    '[class*="chakra-modal__overlay"]', // Chakra UI
  ];
  
  for (const selector of backdropSelectors) {
    const backdrop = document.querySelector(selector);
    if (backdrop && isVisible(backdrop)) {
      return true;
    }
  }
  
  // Look for semi-transparent overlays by style
  const allDivs = document.querySelectorAll('div');
  for (const div of allDivs) {
    const style = window.getComputedStyle(div);
    const bg = style.backgroundColor;
    
    // Check for semi-transparent background
    if (bg.includes('rgba') && bg.match(/rgba\([^)]+,\s*0\.[0-9]+\)/)) {
      const zIndex = parseInt(style.zIndex || '0');
      if (zIndex > 100 && isVisible(div)) {
        const rect = div.getBoundingClientRect();
        // Backdrop typically covers most of screen
        const coverage = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
        if (coverage > 0.8) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Detect close button
 */
function detectCloseButton(element: Element): boolean {
  // Look for close button patterns
  const closeSelectors = [
    '[aria-label*="close" i]',
    '[title*="close" i]',
    '[class*="close"]',
    'button[class*="close"]',
    '[data-dismiss="modal"]',
  ];
  
  for (const selector of closeSelectors) {
    if (element.querySelector(selector)) {
      return true;
    }
  }
  
  // Look for × or ✕ characters
  const text = element.textContent || '';
  if (text.includes('×') || text.includes('✕')) {
    return true;
  }
  
  // Look for buttons with "Cancel", "Dismiss", etc.
  const buttons = element.querySelectorAll('button');
  for (const button of buttons) {
    const btnText = button.textContent?.toLowerCase() || '';
    if (btnText.match(/^(cancel|dismiss|close)$/)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect modal-related attributes
 */
function detectModalAttributes(element: Element): boolean {
  const className = element.className.toString().toLowerCase();
  const id = element.id.toLowerCase();
  
  const modalKeywords = [
    'modal',
    'dialog',
    'popup',
    'popover',
    'lightbox',
  ];
  
  for (const keyword of modalKeywords) {
    if (className.includes(keyword) || id.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect if element is centered in viewport
 */
function detectCenteredPositioning(_element: Element, rect: DOMRect): boolean {
  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  
  const elementCenterX = rect.left + rect.width / 2;
  const elementCenterY = rect.top + rect.height / 2;
  
  // Allow 20% tolerance
  const toleranceX = window.innerWidth * 0.2;
  const toleranceY = window.innerHeight * 0.2;
  
  const isCenteredX = Math.abs(elementCenterX - viewportCenterX) < toleranceX;
  const isCenteredY = Math.abs(elementCenterY - viewportCenterY) < toleranceY;
  
  return isCenteredX && isCenteredY;
}

/**
 * Detect if element is a persistent UI panel (always visible, not a popup modal)
 * EXPORTED for use in DOM map generation
 * 
 * Persistent panels are:
 * - Always visible on the page (not dynamically appearing)
 * - Part of the page layout (sidebars, toolbars, panels)
 * - Not blocking interaction with the page
 * - Often positioned at edges (left, right, top, bottom)
 * 
 * Examples:
 * - Gainsight "Share Dashboard" sidebar (always visible)
 * - Salesforce sidebar panels
 * - Navigation drawers that are always open
 */
export function detectPersistentPanel(element: Element, rect: DOMRect, style: CSSStyleDeclaration): boolean {
  // Signal 1: Positioned at edge of screen (sidebar/panel pattern)
  const isAtLeftEdge = rect.left < 50; // Within 50px of left edge
  const isAtRightEdge = rect.right > window.innerWidth - 50; // Within 50px of right edge
  const isAtTopEdge = rect.top < 50; // Within 50px of top edge
  const isAtBottomEdge = rect.bottom > window.innerHeight - 50; // Within 50px of bottom edge
  const isAtEdge = isAtLeftEdge || isAtRightEdge || isAtTopEdge || isAtBottomEdge;
  
  // Signal 2: Not centered (panels are at edges, modals are centered)
  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  const elementCenterX = rect.left + rect.width / 2;
  const elementCenterY = rect.top + rect.height / 2;
  const distanceFromCenterX = Math.abs(elementCenterX - viewportCenterX);
  const distanceFromCenterY = Math.abs(elementCenterY - viewportCenterY);
  const isFarFromCenter = distanceFromCenterX > window.innerWidth * 0.3 || 
                          distanceFromCenterY > window.innerHeight * 0.3;
  
  // Signal 3: Narrow width (sidebars are typically narrow)
  const widthRatio = rect.width / window.innerWidth;
  const isNarrow = widthRatio < 0.4; // Less than 40% of viewport width
  
  // Signal 4: Full height or tall (panels span vertically)
  const heightRatio = rect.height / window.innerHeight;
  const isTall = heightRatio > 0.7; // More than 70% of viewport height
  
  // Signal 5: Static or relative positioning (not floating above page)
  const isStaticOrRelative = style.position === 'static' || style.position === 'relative';
  
  // Signal 6: Check for backdrop - persistent panels typically don't have full-page backdrops
  // But some might have a backdrop element, so we check if it's actually blocking
  const hasBackdrop = detectBackdrop();
  
  // Signal 7: Contains "share", "panel", "sidebar", "drawer" in class/id/title
  const className = element.className.toString().toLowerCase();
  const id = element.id.toLowerCase();
  const title = element.getAttribute('title')?.toLowerCase() || '';
  const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
  const hasPanelKeywords = className.includes('share') || 
                           className.includes('panel') || 
                           className.includes('sidebar') || 
                           className.includes('drawer') ||
                           id.includes('share') ||
                           id.includes('panel') ||
                           id.includes('sidebar') ||
                           title.includes('share') ||
                           ariaLabel.includes('share');
  
  // Signal 8: Check if element text contains "share" (like "Share Dashboard")
  const elementText = element.textContent?.toLowerCase() || '';
  const hasShareText = elementText.includes('share') && elementText.includes('dashboard');
  
  // CRITICAL: If element has "share" keyword AND is at edge → definitely persistent panel
  // This catches Gainsight "Share Dashboard" panels that are always visible
  if ((hasPanelKeywords || hasShareText) && isAtEdge) {
    console.log('[ModalDetector] 🎯 Persistent panel detected: Has "share" keyword and is at edge');
    return true;
  }
  
  // Combination: If at edge AND (narrow OR tall) AND no backdrop → likely persistent panel
  if (isAtEdge && (isNarrow || isTall) && !hasBackdrop) {
    return true;
  }
  
  // Combination: If at edge AND static/relative positioning → likely persistent panel
  if (isAtEdge && isStaticOrRelative) {
    return true;
  }
  
  // Combination: If far from center AND has panel keywords → likely persistent panel
  if (isFarFromCenter && hasPanelKeywords) {
    return true;
  }
  
  // Combination: If narrow AND tall AND at edge → sidebar pattern
  if (isNarrow && isTall && isAtEdge) {
    return true;
  }
  
  // Combination: If has "share" text AND not centered → likely persistent panel
  if (hasShareText && isFarFromCenter) {
    return true;
  }
  
  return false;
}

/**
 * Check if element is visible
 */
function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         style.opacity !== '0';
}

/**
 * Detect if we're in a navigation context (not a modal)
 */
export function isNavigationContext(element: Element): boolean {
  const className = element.className.toString().toLowerCase();
  const id = element.id.toLowerCase();
  
  // Check for navigation indicators
  const hasNav = 
    element.closest('[role="navigation"]') ||
    element.querySelector('[role="navigation"]') ||
    className.includes('nav') ||
    className.includes('menu') ||
    id.includes('nav');
  
  // Check for app-level indicators (main containers, not modals)
  const isAppContainer = 
    className.includes('appcontainer') ||
    className.includes('onemain') ||
    className.includes('workspace') ||
    element.tagName === 'MAIN' ||
    (className.includes('app') && (className.includes('container') || className.includes('layout')));
  
  // Check for header/toolbar indicators
  const isHeader = 
    element.tagName === 'HEADER' ||
    className.includes('header') ||
    className.includes('toolbar') ||
    className.includes('topbar');
  
  // Check for Salesforce-specific app containers
  const isSalesforceApp = 
    className.includes('slds-context-bar') ||
    className.includes('slds-global-header') ||
    className.includes('forcecommunity') ||
    element.querySelector('[class*="slds-context-bar"]') !== null;
  
  // Check for Gainsight-specific containers
  const isGainsightApp = 
    className.includes('gs-') ||
    element.tagName.toLowerCase().startsWith('gs-');
  
  // Check if contains many tabs (strong signal of navigation, not modal)
  const tabCount = element.querySelectorAll('[role="tab"], [role="tablist"]').length;
  const hasManyTabs = tabCount >= 3;
  
  return !!(hasNav || isAppContainer || isHeader || isSalesforceApp || isGainsightApp || hasManyTabs);
}

/**
 * Check if element is likely a SaaS app container (Salesforce, Gainsight, etc.)
 */
export function isSaaSAppContainer(element: Element): boolean {
  const className = element.className.toString().toLowerCase();
  const id = element.id.toLowerCase();
  
  // Salesforce Lightning patterns
  const isSalesforce = 
    className.includes('onemain') ||
    className.includes('appcontainer') ||
    className.includes('slds-context-bar') ||
    className.includes('slds-global-header') ||
    className.includes('forcecommunity') ||
    className.includes('lightning') ||
    id.includes('oneapp');
  
  // Gainsight patterns
  const isGainsight = 
    className.includes('gs-') ||
    element.tagName.toLowerCase().includes('gs-') ||
    className.includes('gainsight');
  
  // Zendesk patterns
  const isZendesk = 
    className.includes('zendesk') ||
    className.includes('zd-');
  
  // HubSpot patterns
  const isHubSpot = 
    className.includes('hubspot') ||
    className.includes('hs-');
  
  // Generic SaaS patterns
  const isGenericSaaS = 
    className.includes('workspace') ||
    className.includes('dashboard') ||
    (className.includes('app') && (className.includes('container') || className.includes('layout'))) ||
    element.tagName === 'MAIN';
  
  // Check for many interactive elements (strong signal of app container)
  const interactiveCount = element.querySelectorAll('button, a, input, [role="button"]').length;
  const hasManyInteractives = interactiveCount > 50;
  
  return isSalesforce || isGainsight || isZendesk || isHubSpot || (isGenericSaaS && hasManyInteractives);
}

/**
 * Enhanced modal detection with form field heuristic as tiebreaker
 */
export function detectModalWithFormHeuristic(
  element: Element, 
  formFieldCount: number
): { isModal: boolean; reason: string } {
  // First, try structural detection
  const structuralResult = isRealModal(element);
  
  if (structuralResult.isModal) {
    return { 
      isModal: true, 
      reason: `Structural detection (score: ${structuralResult.score})` 
    };
  }
  
  // If navigation context, definitely not a modal
  if (isNavigationContext(element)) {
    return { 
      isModal: false, 
      reason: 'Navigation context detected' 
    };
  }
  
  // If SaaS app container, not a modal
  if (isSaaSAppContainer(element)) {
    return { 
      isModal: false, 
      reason: 'SaaS app container detected' 
    };
  }
  
  // If structural score is ambiguous (3-4), use form field count as tiebreaker
  if (structuralResult.score >= 3 && structuralResult.score < 5 && formFieldCount >= 20) {
    // Check for modal action keywords
    const text = element.textContent?.toLowerCase() || '';
    const hasModalKeywords = text.match(/submit|confirm|cancel|save|close|ok/i);
    
    if (hasModalKeywords) {
      return { 
        isModal: true, 
        reason: `Form heuristic tiebreaker (${formFieldCount} fields + modal keywords)` 
      };
    }
  }
  
  return { 
    isModal: false, 
    reason: `Insufficient signals (score: ${structuralResult.score})` 
  };
}

