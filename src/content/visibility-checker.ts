/**
 * VisibilityChecker - Centralized visibility and interactability checks
 * 
 * Used by MenuDetector, CandidateFinder, scope.ts, and other modules
 * to avoid code duplication and ensure consistent visibility logic.
 */

export class VisibilityChecker {
  /**
   * Check if element is visible
   * 
   * Special handling for CDK overlay containers which may have width=0
   * but contain visible menus inside.
   */
  static isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    
    // Standard visibility checks
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    
    // CRITICAL: CDK overlay containers (wrappers) may have width=0
    // They are just positioning containers - the menu inside is what matters
    const isCdkOverlay = element.classList.contains('cdk-overlay-pane') || 
                         element.classList.contains('cdk-overlay-container') ||
                         element.classList.contains('cdk-overlay-connected-position-bounding-box');
    
    if (isCdkOverlay) {
      return true; // For CDK overlays, only check display/visibility (not size/opacity)
    }
    
    // Full checks for non-wrapper elements
    if (style.opacity === '0') {
      return false;
    }
    
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if element is interactable (clickable)
   * 
   * Verifies element is visible AND not obscured by other elements
   */
  static isInteractable(element: Element): boolean {
    if (!this.isVisible(element)) {
      return false;
    }
    
    // Check if element is obscured by other elements
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    
    if (!elementAtPoint) {
      return false;
    }
    
    // Element is interactable if it's the element at that point
    // OR if the element at that point is a child of our element
    return elementAtPoint === element || element.contains(elementAtPoint);
  }
}


