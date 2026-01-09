/**
 * @protected DO NOT MODIFY without running full regression suite
 * 
 * This module is used by: MenuDetector, CandidateFinder, DOMMap, ScopeResolver
 * Changes here affect ALL workflows including:
 * - Element visibility detection
 * - Interaction checks for buttons and links
 * - Menu item filtering
 * - Widget detection
 * 
 * Before modifying, run: npm run test:integration
 * 
 * VisibilityChecker - Centralized visibility and interactability checks
 */

/**
 * Centralized utility for checking element visibility and interactability
 * 
 * Replaces duplicate implementations across MenuDetector, CandidateFinder, and DOMMap.
 * Provides consistent visibility logic with special handling for edge cases like
 * CDK overlays (which may have width=0 but still contain visible content).
 */
export class VisibilityChecker {
  /**
   * Check if an element is visible to the user
   * 
   * An element is considered visible if:
   * - It's not hidden via CSS (display: none, visibility: hidden, opacity: 0)
   * - It has non-zero dimensions (width > 0, height > 0)
   * - Special case: CDK overlay containers are considered visible even with zero dimensions
   * 
   * @param element - The element to check
   * @returns true if element is visible, false otherwise
   */
  static isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    // Check CSS visibility properties
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    // CRITICAL: Special handling for CDK overlay containers
    // These are Angular Material components that act as portals for menus/dialogs
    // They may have width=0 or height=0 but contain visible children
    const isCdkOverlay = 
      element.classList.contains('cdk-overlay-pane') || 
      element.classList.contains('cdk-overlay-container');
    
    if (isCdkOverlay) {
      return true; // CDK containers are always considered visible
    }

    // Check opacity
    if (style.opacity === '0') {
      return false;
    }

    // Check dimensions
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return true;
  }

  /**
   * Check if an element is interactable (visible AND not disabled)
   * 
   * @param element - The element to check
   * @returns true if element can be interacted with, false otherwise
   */
  static isInteractable(element: Element): boolean {
    if (!this.isVisible(element)) {
      return false;
    }

    // Check if disabled
    if (element instanceof HTMLButtonElement || 
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) {
      if (element.disabled) {
        return false;
      }
    }

    // Check aria-disabled
    if (element.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    return true;
  }

  /**
   * Check if an element is in the viewport
   * 
   * @param element - The element to check
   * @returns true if element is in viewport, false otherwise
   */
  static isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
}
