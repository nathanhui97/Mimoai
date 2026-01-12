/**
 * ElementState - Utilities for capturing element state information
 * 
 * IMPORTANT: This module handles visibility checks for all elements including
 * dropdown options and portal elements which may have special rendering behavior.
 */

import type { ElementState } from '../types/workflow';

export class ElementStateCapture {
  /**
   * Capture the current state of an element
   */
  static captureElementState(element: Element): ElementState {
    const htmlElement = element as HTMLElement;
    
    return {
      visible: this.isElementVisible(element),
      enabled: this.isElementEnabled(htmlElement),
      readonly: this.isElementReadonly(htmlElement),
      checked: this.isElementChecked(htmlElement),
    };
  }

  /**
   * Check if element is a dropdown option or menu item
   * These elements need special handling for visibility checks
   */
  private static isDropdownOptionOrMenuItem(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'listitem') {
      return true;
    }
    
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'li' || tagName === 'option') {
      return true;
    }
    
    // Check if inside a dropdown/listbox/menu container
    const container = element.closest('[role="listbox"], [role="menu"], [role="list"], select, ul, ol');
    if (container && element !== container) {
      return true;
    }
    
    // Check class names for common patterns
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('option') || 
        className.includes('menuitem') || 
        className.includes('dropdown-item')) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if element is visible in viewport
   * 
   * IMPORTANT: For dropdown options and portal elements, we use relaxed checks
   * because these elements may be rendered in overlay containers that have
   * different rendering behavior (e.g., position: fixed, portal rendering).
   */
  static isElementVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    
    // Check for explicit hiding via CSS
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    
    // Get bounding box
    const rect = element.getBoundingClientRect();
    
    // Zero-size elements are not visible (unless they're being animated)
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }

    // SPECIAL HANDLING: Dropdown options and menu items
    // These often render in portals/overlays which can have quirky positioning
    // If the element has dimensions and isn't explicitly hidden, consider it visible
    const isDropdownOption = this.isDropdownOptionOrMenuItem(element);
    if (isDropdownOption) {
      // For dropdown options: if they have size and aren't hidden, they're visible
      // Don't require them to be "in viewport" because they might be in a scrollable list
      // or rendered in a portal with absolute/fixed positioning
      if (rect.width > 0 && rect.height > 0) {
        return true;
      }
    }
    
    // RELAXED: Check offsetParent only for non-portal elements
    // Portal elements (fixed/absolute positioned) often have null offsetParent
    // but are still visible
    const isPortalElement = style.position === 'fixed' || style.position === 'absolute';
    if (!isPortalElement && element.offsetParent === null && element.tagName !== 'BODY') {
      // Could be a hidden element, but also could be a portal
      // Check if it's in an overlay container
      const inOverlay = element.closest('.cdk-overlay-pane, .cdk-overlay-container, [role="dialog"], [role="listbox"], [role="menu"]');
      if (!inOverlay) {
        return false;
      }
    }

    // Check if element is in viewport (at least partially)
    // Be more lenient for elements that might be scrollable
    const isInViewport = 
      rect.top < window.innerHeight + 100 && // Allow 100px tolerance
      rect.bottom > -100 &&
      rect.left < window.innerWidth + 100 &&
      rect.right > -100;

    return isInViewport;
  }
  
  /**
   * Check if element is visible - permissive version for dropdown options
   * This should be used when we KNOW we're dealing with a dropdown option
   * to avoid false negatives from portal rendering quirks
   */
  static isElementVisiblePermissive(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    
    // Only check for explicit hiding
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    
    // If element has dimensions, consider it visible
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Check if element is enabled (not disabled)
   */
  static isElementEnabled(element: HTMLElement): boolean {
    // Check disabled attribute
    if ('disabled' in element && (element as HTMLInputElement | HTMLButtonElement).disabled) {
      return false;
    }

    // Check pointer-events CSS
    const style = window.getComputedStyle(element);
    if (style.pointerEvents === 'none') {
      return false;
    }

    // Check if parent has disabled attribute (for form elements)
    let parent = element.parentElement;
    while (parent) {
      if (parent.hasAttribute('disabled')) {
        return false;
      }
      parent = parent.parentElement;
    }

    return true;
  }

  /**
   * Check if element is readonly (for inputs)
   */
  static isElementReadonly(element: HTMLElement): boolean | undefined {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.readOnly;
    }
    return undefined;
  }

  /**
   * Check if element is checked (for checkboxes/radios)
   */
  static isElementChecked(element: HTMLElement): boolean | undefined {
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if (inputType === 'checkbox' || inputType === 'radio') {
        return element.checked;
      }
    }
    return undefined;
  }
}
