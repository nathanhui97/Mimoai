/**
 * InteractionDetector - Universal interaction type detection
 * 
 * This module provides centralized detection of user interaction types
 * (dropdown selections, text inputs, checkboxes, etc.) to eliminate
 * fragmented detection logic across multiple modules.
 * 
 * Detection is performed ONCE during recording and the result is stored
 * in the payload for all downstream modules to read.
 */

import { MenuDetector } from './menu-detector';

// ============================================================================
// Types
// ============================================================================

export type InteractionKind = 
  | 'TEXT_INPUT'
  | 'DROPDOWN_SELECTION'
  | 'CHECKBOX_TOGGLE'
  | 'RADIO_SELECTION'
  | 'BUTTON_CLICK'
  | 'LINK_CLICK'
  | 'MENU_ITEM_CLICK'
  | 'UNKNOWN';

export interface DropdownMetadata {
  triggerSelector?: string;
  containerSelector?: string;
  options: string[];
  selectedOption: string;
  selectedIndex: number;
}

export interface TextInputMetadata {
  fieldLabel: string;
  fieldType: string;
  value: string;
}

export interface InteractionType {
  kind: InteractionKind;
  dropdown?: DropdownMetadata;
  textInput?: TextInputMetadata;
  confidence: number;
  detectionMethod: string;
}

// ============================================================================
// InteractionDetector
// ============================================================================

export class InteractionDetector {
  /**
   * Detect the interaction type for an element
   * Uses a strategy chain with confidence scoring
   * 
   * @param element - The DOM element to detect
   * @param event - Optional event that triggered the interaction
   * @param providedOptions - Pre-scanned dropdown options (if available)
   * @param capturedInputDetails - Input details captured during recording (for Shadow DOM inputs)
   */
  static detect(
    element: Element, 
    event?: Event, 
    providedOptions?: string[],
    capturedInputDetails?: { type: string; required?: boolean }
  ): InteractionType {
    // SPECIAL CASE: If we have capturedInputDetails, this is likely a Shadow DOM input wrapper
    // Use the captured input type to detect, even if the element itself isn't an <input>
    if (capturedInputDetails) {
      const inputType = capturedInputDetails.type?.toLowerCase();
      if (inputType === 'text' || inputType === 'email' || inputType === 'number' || inputType === 'tel') {
        console.log('[InteractionDetector] Detected via captured inputDetails (Shadow DOM):', inputType);
        return {
          kind: 'TEXT_INPUT',
          confidence: 0.9,
          detectionMethod: `captured-input-details: type="${inputType}" (Shadow DOM wrapper)`,
        };
      }
      if (inputType === 'checkbox') {
        return {
          kind: 'CHECKBOX_TOGGLE',
          confidence: 0.9,
          detectionMethod: 'captured-input-details: type="checkbox" (Shadow DOM wrapper)',
        };
      }
      if (inputType === 'radio') {
        return {
          kind: 'RADIO_SELECTION',
          confidence: 0.9,
          detectionMethod: 'captured-input-details: type="radio" (Shadow DOM wrapper)',
        };
      }
    }
    
    // Strategy 1: ARIA roles (most reliable, W3C standard)
    const ariaType = this.detectByAriaRoles(element, providedOptions);
    if (ariaType.confidence >= 0.8) {
      console.log('[InteractionDetector] Detected via ARIA roles:', ariaType);
      return ariaType;
    }
    
    // Strategy 2: Semantic HTML elements
    const htmlType = this.detectByHTMLSemantics(element, providedOptions);
    if (htmlType.confidence >= 0.7) {
      console.log('[InteractionDetector] Detected via HTML semantics:', htmlType);
      return htmlType;
    }
    
    // Strategy 3: Container context (element inside a known container)
    const containerType = this.detectByContainerContext(element, providedOptions);
    if (containerType.confidence >= 0.6) {
      console.log('[InteractionDetector] Detected via container context:', containerType);
      return containerType;
    }
    
    // Strategy 4: Class name patterns (fallback, lower confidence)
    const classType = this.detectByClassPatterns(element, providedOptions);
    if (classType.confidence >= 0.5) {
      console.log('[InteractionDetector] Detected via class patterns:', classType);
      return classType;
    }
    
    // Strategy 5: Behavioral heuristics (event types, state changes)
    const behaviorType = this.detectByBehavior(element, event, providedOptions);
    if (behaviorType.confidence >= 0.4) {
      console.log('[InteractionDetector] Detected via behavior:', behaviorType);
      return behaviorType;
    }
    
    // Fallback: Unknown
    console.log('[InteractionDetector] Could not determine interaction type');
    return {
      kind: 'UNKNOWN',
      confidence: 0,
      detectionMethod: 'none',
    };
  }

  // ==========================================================================
  // Detection Strategies
  // ==========================================================================

  /**
   * Strategy 1: Detect by ARIA roles (W3C standard)
   * Most reliable - works on any well-built website
   */
  private static detectByAriaRoles(element: Element, providedOptions?: string[]): InteractionType {
    const role = element.getAttribute('role')?.toLowerCase();
    
    // Dropdown option selection
    if (role === 'option' || role === 'menuitem' || role === 'menuitemradio') {
      const options = providedOptions || this.scanDropdownOptions(element);
      const selectedOption = element.textContent?.trim() || '';
      
      return {
        kind: 'DROPDOWN_SELECTION',
        dropdown: {
          options,
          selectedOption,
          selectedIndex: options.indexOf(selectedOption),
          containerSelector: this.findDropdownContainer(element),
        },
        confidence: 0.95,
        detectionMethod: `aria-role: element has role="${role}"`,
      };
    }
    
    // Checkbox
    if (role === 'checkbox' || role === 'switch') {
      return {
        kind: 'CHECKBOX_TOGGLE',
        confidence: 0.9,
        detectionMethod: `aria-role: element has role="${role}"`,
      };
    }
    
    // Radio button
    if (role === 'radio') {
      return {
        kind: 'RADIO_SELECTION',
        confidence: 0.9,
        detectionMethod: `aria-role: element has role="radio"`,
      };
    }
    
    // Button
    if (role === 'button') {
      return {
        kind: 'BUTTON_CLICK',
        confidence: 0.85,
        detectionMethod: `aria-role: element has role="button"`,
      };
    }
    
    // Link
    if (role === 'link') {
      return {
        kind: 'LINK_CLICK',
        confidence: 0.85,
        detectionMethod: `aria-role: element has role="link"`,
      };
    }
    
    // List item (could be dropdown or menu)
    if (role === 'listitem') {
      // Check if inside a listbox or menu
      const container = element.closest('[role="listbox"], [role="menu"]');
      if (container) {
        const options = providedOptions || this.scanDropdownOptions(element);
        return {
          kind: 'DROPDOWN_SELECTION',
          dropdown: {
            options,
            selectedOption: element.textContent?.trim() || '',
            selectedIndex: options.indexOf(element.textContent?.trim() || ''),
            containerSelector: this.findDropdownContainer(element),
          },
          confidence: 0.8,
          detectionMethod: 'aria-role: listitem inside listbox/menu',
        };
      }
    }
    
    return { kind: 'UNKNOWN', confidence: 0, detectionMethod: 'aria-roles-no-match' };
  }

  /**
   * Strategy 2: Detect by semantic HTML elements
   * Works for standard HTML form elements
   */
  private static detectByHTMLSemantics(element: Element, providedOptions?: string[]): InteractionType {
    const tagName = element.tagName.toLowerCase();
    
    // <option> element (inside <select>)
    if (tagName === 'option') {
      const selectElement = element.closest('select');
      const options = providedOptions || (selectElement ? 
        Array.from(selectElement.querySelectorAll('option')).map(opt => opt.textContent?.trim() || '') :
        []);
      
      return {
        kind: 'DROPDOWN_SELECTION',
        dropdown: {
          options,
          selectedOption: element.textContent?.trim() || '',
          selectedIndex: options.indexOf(element.textContent?.trim() || ''),
          triggerSelector: selectElement ? this.generateSelector(selectElement) : undefined,
        },
        confidence: 0.95,
        detectionMethod: 'semantic-html: <option> element',
      };
    }
    
    // <input> element
    if (tagName === 'input') {
      const inputType = (element as HTMLInputElement).type?.toLowerCase();
      
      if (inputType === 'checkbox') {
        return {
          kind: 'CHECKBOX_TOGGLE',
          confidence: 0.9,
          detectionMethod: 'semantic-html: <input type="checkbox">',
        };
      }
      
      if (inputType === 'radio') {
        return {
          kind: 'RADIO_SELECTION',
          confidence: 0.9,
          detectionMethod: 'semantic-html: <input type="radio">',
        };
      }
      
      if (inputType === 'text' || inputType === 'email' || inputType === 'number' || inputType === 'tel') {
        return {
          kind: 'TEXT_INPUT',
          confidence: 0.9,
          detectionMethod: `semantic-html: <input type="${inputType}">`,
        };
      }
    }
    
    // <button> element
    if (tagName === 'button') {
      return {
        kind: 'BUTTON_CLICK',
        confidence: 0.85,
        detectionMethod: 'semantic-html: <button> element',
      };
    }
    
    // <a> element
    if (tagName === 'a') {
      return {
        kind: 'LINK_CLICK',
        confidence: 0.85,
        detectionMethod: 'semantic-html: <a> element',
      };
    }
    
    // <li> element (could be dropdown option)
    if (tagName === 'li') {
      const container = element.closest('ul[role="listbox"], ul[role="menu"], ol[role="listbox"], ol[role="menu"]');
      if (container) {
        const options = providedOptions || this.scanDropdownOptions(element);
        return {
          kind: 'DROPDOWN_SELECTION',
          dropdown: {
            options,
            selectedOption: element.textContent?.trim() || '',
            selectedIndex: options.indexOf(element.textContent?.trim() || ''),
            containerSelector: this.findDropdownContainer(element),
          },
          confidence: 0.75,
          detectionMethod: 'semantic-html: <li> inside listbox/menu',
        };
      }
    }
    
    return { kind: 'UNKNOWN', confidence: 0, detectionMethod: 'html-semantics-no-match' };
  }

  /**
   * Strategy 3: Detect by container context
   * Element is inside a known container type
   */
  private static detectByContainerContext(element: Element, providedOptions?: string[]): InteractionType {
    // Check if inside a dropdown/listbox/menu container
    const dropdownContainer = element.closest('[role="listbox"], [role="menu"], select, ul, ol');
    if (dropdownContainer && element !== dropdownContainer) {
      // Verify this isn't just a regular list
      const hasDropdownIndicators = 
        dropdownContainer.getAttribute('role') === 'listbox' ||
        dropdownContainer.getAttribute('role') === 'menu' ||
        dropdownContainer.tagName.toLowerCase() === 'select' ||
        dropdownContainer.getAttribute('aria-haspopup') !== null;
      
      if (hasDropdownIndicators) {
        // CRITICAL: Distinguish between NAVIGATION menus and SELECTION dropdowns
        const isNavigationMenu = this.isNavigationMenu(dropdownContainer, element);
        
        if (isNavigationMenu) {
          // This is a navigation menu (links to pages), not a dropdown for selections
          return {
            kind: 'MENU_ITEM_CLICK',
            confidence: 0.75,
            detectionMethod: 'container-context: navigation menu item',
          };
        }
        
        // This is a selection dropdown (options to choose from)
        const options = providedOptions || this.scanDropdownOptions(element);
        return {
          kind: 'DROPDOWN_SELECTION',
          dropdown: {
            options,
            selectedOption: element.textContent?.trim() || '',
            selectedIndex: options.indexOf(element.textContent?.trim() || ''),
            containerSelector: this.findDropdownContainer(element),
          },
          confidence: 0.7,
          detectionMethod: 'container-context: inside dropdown container',
        };
      }
    }
    
    // Check if inside a form
    const formElement = element.closest('form');
    if (formElement && (element.tagName.toLowerCase() === 'input' || element.tagName.toLowerCase() === 'textarea')) {
      return {
        kind: 'TEXT_INPUT',
        confidence: 0.6,
        detectionMethod: 'container-context: input inside form',
      };
    }
    
    return { kind: 'UNKNOWN', confidence: 0, detectionMethod: 'container-context-no-match' };
  }

  /**
   * Strategy 4: Detect by class name patterns
   * Fallback for custom implementations without proper ARIA
   */
  private static detectByClassPatterns(element: Element, providedOptions?: string[]): InteractionType {
    const className = element.className?.toString().toLowerCase() || '';
    
    // Dropdown option patterns
    if (className.includes('option') || 
        className.includes('dropdown-item') ||
        className.includes('select-option') ||
        className.includes('menu-item') ||
        className.includes('list-item')) {
      
      // Additional validation: check if parent looks like a dropdown
      const parent = element.parentElement;
      const parentClass = parent?.className?.toString().toLowerCase() || '';
      const parentRole = parent?.getAttribute('role');
      
      if (parentClass.includes('dropdown') || 
          parentClass.includes('menu') || 
          parentClass.includes('listbox') ||
          parentRole === 'listbox' ||
          parentRole === 'menu') {
        
        const options = providedOptions || this.scanDropdownOptions(element);
        return {
          kind: 'DROPDOWN_SELECTION',
          dropdown: {
            options,
            selectedOption: element.textContent?.trim() || '',
            selectedIndex: options.indexOf(element.textContent?.trim() || ''),
            containerSelector: this.findDropdownContainer(element),
          },
          confidence: 0.6,
          detectionMethod: 'class-pattern: dropdown-related class name',
        };
      }
    }
    
    // Button patterns
    if (className.includes('button') || className.includes('btn')) {
      return {
        kind: 'BUTTON_CLICK',
        confidence: 0.5,
        detectionMethod: 'class-pattern: button class name',
      };
    }
    
    return { kind: 'UNKNOWN', confidence: 0, detectionMethod: 'class-pattern-no-match' };
  }

  /**
   * Strategy 5: Detect by behavioral heuristics
   * Check element state, attributes, and event types
   */
  private static detectByBehavior(element: Element, _event?: Event, providedOptions?: string[]): InteractionType {
    // Check for dropdown trigger behavior
    const hasPopup = element.getAttribute('aria-haspopup');
    const hasExpanded = element.getAttribute('aria-expanded') !== null;
    const hasControls = element.getAttribute('aria-controls') !== null;
    
    if (hasPopup || hasExpanded || hasControls) {
      // This is likely a dropdown trigger, not the selection itself
      // But we still want to detect it for context
      return {
        kind: 'BUTTON_CLICK', // Treat dropdown triggers as button clicks
        confidence: 0.5,
        detectionMethod: 'behavior: dropdown trigger attributes',
      };
    }
    
    // Check if element changes aria-selected or aria-checked
    const isSelectable = element.getAttribute('aria-selected') !== null || 
                         element.getAttribute('aria-checked') !== null;
    
    if (isSelectable) {
      // Try to determine if it's inside a dropdown
      const container = MenuDetector.findParentMenu(element);
      if (container) {
        const options = providedOptions || this.scanDropdownOptions(element);
        return {
          kind: 'DROPDOWN_SELECTION',
          dropdown: {
            options,
            selectedOption: element.textContent?.trim() || '',
            selectedIndex: options.indexOf(element.textContent?.trim() || ''),
            containerSelector: this.findDropdownContainer(element),
          },
          confidence: 0.5,
          detectionMethod: 'behavior: aria-selected/checked inside menu',
        };
      }
    }
    
    return { kind: 'UNKNOWN', confidence: 0, detectionMethod: 'behavior-no-match' };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Check if a menu is a navigation menu (links to pages) vs a selection dropdown
   */
  private static isNavigationMenu(container: Element, item: Element): boolean {
    // Check 1: Container has navigation keywords in aria-label or class
    const containerLabel = container.getAttribute('aria-label')?.toLowerCase() || '';
    const containerClass = container.className?.toString().toLowerCase() || '';
    const containerText = container.getAttribute('data-text')?.toLowerCase() || '';
    
    const navKeywords = ['navigation', 'nav', 'sidebar', 'main menu', 'app launcher'];
    const hasNavKeyword = navKeywords.some(keyword => 
      containerLabel.includes(keyword) || 
      containerClass.includes(keyword) ||
      containerText.includes(keyword)
    );
    
    if (hasNavKeyword) {
      console.log('[InteractionDetector] Navigation menu detected via keywords:', { containerLabel, containerClass });
      return true;
    }
    
    // Check 2: Item or its children are links (<a> tags with href)
    const isLink = item.tagName.toLowerCase() === 'a' && item.hasAttribute('href');
    const hasLinkChild = item.querySelector('a[href]') !== null;
    
    if (isLink || hasLinkChild) {
      console.log('[InteractionDetector] Navigation menu detected via link elements');
      return true;
    }
    
    // Check 3: Items in the menu are predominantly links
    const allItems = container.querySelectorAll('[role="menuitem"], li, a');
    const linkItems = container.querySelectorAll('a[href]');
    
    if (allItems.length > 0 && linkItems.length / allItems.length > 0.5) {
      console.log('[InteractionDetector] Navigation menu detected via link ratio:', {
        links: linkItems.length,
        total: allItems.length,
      });
      return true;
    }
    
    // Check 4: Container is positioned like a sidebar (fixed position, left/right edge)
    const containerStyles = window.getComputedStyle(container);
    const isFixedPosition = containerStyles.position === 'fixed' || containerStyles.position === 'absolute';
    const rect = container.getBoundingClientRect();
    const isAtEdge = rect.left === 0 || rect.right === window.innerWidth;
    
    if (isFixedPosition && isAtEdge && rect.height > window.innerHeight * 0.5) {
      console.log('[InteractionDetector] Navigation menu detected via sidebar positioning');
      return true;
    }
    
    return false;
  }

  /**
   * Scan for dropdown options from an element
   */
  private static scanDropdownOptions(element: Element): string[] {
    const container = MenuDetector.findParentMenu(element);
    if (!container) {
      return [];
    }
    
    const options: string[] = [];
    const optionElements = container.querySelectorAll('[role="option"], [role="menuitem"], li, option');
    
    optionElements.forEach(opt => {
      const text = opt.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        options.push(text);
      }
    });
    
    return Array.from(new Set(options)); // Deduplicate
  }

  /**
   * Find the dropdown container selector for an element
   */
  private static findDropdownContainer(element: Element): string | undefined {
    const container = MenuDetector.findParentMenu(element);
    if (!container) {
      return undefined;
    }
    
    // Try to generate a stable selector
    return this.generateSelector(container);
  }

  /**
   * Generate a simple selector for an element
   */
  private static generateSelector(element: Element): string {
    // Prefer ID
    if (element.id) {
      return `#${element.id}`;
    }
    
    // Fallback to role + aria-label
    const role = element.getAttribute('role');
    const ariaLabel = element.getAttribute('aria-label');
    if (role && ariaLabel) {
      return `[role="${role}"][aria-label="${ariaLabel}"]`;
    }
    
    // Fallback to role only
    if (role) {
      return `[role="${role}"]`;
    }
    
    // Fallback to tag name + class
    const tagName = element.tagName.toLowerCase();
    const firstClass = element.className?.toString().split(' ')[0];
    if (firstClass) {
      return `${tagName}.${firstClass}`;
    }
    
    return tagName;
  }
}
