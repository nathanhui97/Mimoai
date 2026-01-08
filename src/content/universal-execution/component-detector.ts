/**
 * Component Detector
 * 
 * Detects component patterns and UI library types to enable
 * specialized handling for dropdowns, autocompletes, etc.
 */

import type {
  ComponentLibrary,
  ComponentPattern,
  DropdownPatternData,
  SimpleClickPatternData,
  TextInputPatternData,
  ElementSignature,
} from '../../types/universal-types';
import { buildElementSignature } from './element-signature';

// ============================================================================
// Component Library Detection
// ============================================================================

/**
 * Detect which component library is being used on the page
 */
export function detectComponentLibrary(element: Element): ComponentLibrary {
  // Check element and ancestors for library-specific markers
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    const classes = current.className || '';
    const classStr = typeof classes === 'string' ? classes : '';
    
    // Material UI (MUI)
    if (classStr.includes('Mui') || classStr.includes('MuiButton') ||
        current.classList.contains('MuiButtonBase-root')) {
      return 'mui';
    }
    
    // Radix UI
    if (current.hasAttribute('data-radix-collection-item') ||
        current.hasAttribute('data-radix-select-trigger') ||
        current.hasAttribute('data-state')) {
      return 'radix';
    }
    
    // Ant Design
    if (classStr.includes('ant-') || current.classList.contains('ant-btn')) {
      return 'antd';
    }
    
    // Chakra UI
    if (classStr.includes('chakra-') || current.hasAttribute('data-chakra-component')) {
      return 'chakra';
    }
    
    // Headless UI
    if (current.hasAttribute('data-headlessui-state')) {
      return 'headless-ui';
    }
    
    // React Select
    if (classStr.includes('react-select') || classStr.includes('__control')) {
      return 'react-select';
    }
    
    // Bootstrap
    if (current.classList.contains('btn') && current.classList.contains('btn-primary') ||
        classStr.includes('bootstrap')) {
      return 'bootstrap';
    }
    
    current = current.parentElement;
  }
  
  // Check for native HTML elements
  if (['SELECT', 'INPUT', 'BUTTON', 'A'].includes(element.tagName)) {
    return 'native';
  }
  
  return 'custom';
}

// Removed: getLibraryMenuSelectors and getLibraryOptionSelectors
// These functions have been replaced by MenuDetector's universal selector system
// which works across all frameworks without framework-specific detection.

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Detect if element is a dropdown trigger
 */
export function isDropdownTrigger(element: Element): boolean {
  // Role-based detection
  const role = element.getAttribute('role');
  if (role === 'combobox' || role === 'listbox') {
    return true;
  }
  
  // Aria attributes
  const ariaHasPopup = element.getAttribute('aria-haspopup');
  if (ariaHasPopup === 'listbox' || ariaHasPopup === 'menu' || ariaHasPopup === 'true') {
    return true;
  }
  
  const ariaExpanded = element.getAttribute('aria-expanded');
  if (ariaExpanded !== null) {
    return true;
  }
  
  // Native select
  if (element.tagName === 'SELECT') {
    return true;
  }
  
  // Class-based detection
  const classes = element.className || '';
  const classStr = typeof classes === 'string' ? classes.toLowerCase() : '';
  if (classStr.includes('select') || 
      classStr.includes('dropdown') || 
      classStr.includes('combobox')) {
    return true;
  }
  
  // Library-specific markers
  if (element.hasAttribute('data-radix-select-trigger') ||
      element.classList.contains('MuiSelect-select') ||
      element.classList.contains('ant-select-selector')) {
    return true;
  }
  
  // Check for dropdown icon inside button
  const hasDropdownIcon = element.querySelector(
    'svg[class*="dropdown"], svg[class*="chevron"], svg[class*="arrow"], ' +
    '[class*="dropdown-icon"], [class*="select-icon"], [class*="caret"]'
  );
  if (hasDropdownIcon) {
    return true;
  }
  
  return false;
}

/**
 * Detect if element is an autocomplete input
 */
export function isAutocompleteInput(element: Element): boolean {
  // Check autocomplete attribute
  const autocomplete = element.getAttribute('autocomplete');
  if (autocomplete && autocomplete !== 'off') {
    // This is HTML autocomplete, not a custom autocomplete widget
    // Check for custom widget markers
  }
  
  // Role-based
  const role = element.getAttribute('role');
  if (role === 'combobox' || role === 'searchbox') {
    const hasPopup = element.getAttribute('aria-haspopup');
    if (hasPopup === 'listbox') {
      return true;
    }
  }
  
  // Check for autocomplete-specific classes
  const classes = element.className || '';
  const classStr = typeof classes === 'string' ? classes.toLowerCase() : '';
  if (classStr.includes('autocomplete') || 
      classStr.includes('typeahead') ||
      classStr.includes('autosuggest')) {
    return true;
  }
  
  // Library-specific
  if (element.closest('.MuiAutocomplete-root') ||
      element.closest('[class*="react-select"]') ||
      element.closest('[data-radix-combobox-input]')) {
    return true;
  }
  
  return false;
}

/**
 * Detect if element is a toggle/switch
 */
export function isToggle(element: Element): boolean {
  const role = element.getAttribute('role');
  if (role === 'switch' || role === 'checkbox') {
    return true;
  }
  
  if (element.tagName === 'INPUT' && 
      (element as HTMLInputElement).type === 'checkbox') {
    return true;
  }
  
  const classes = element.className || '';
  const classStr = typeof classes === 'string' ? classes.toLowerCase() : '';
  if (classStr.includes('switch') || 
      classStr.includes('toggle') ||
      classStr.includes('checkbox')) {
    return true;
  }
  
  return false;
}

/**
 * Detect if element is a tab control
 */
export function isTabControl(element: Element): boolean {
  const role = element.getAttribute('role');
  if (role === 'tab') {
    return true;
  }
  
  if (element.closest('[role="tablist"]')) {
    return true;
  }
  
  const classes = element.className || '';
  const classStr = typeof classes === 'string' ? classes.toLowerCase() : '';
  if (classStr.includes('tab') && !classStr.includes('table')) {
    return true;
  }
  
  return false;
}

/**
 * Detect if element is a modal trigger
 */
export function isModalTrigger(element: Element): boolean {
  const ariaHasPopup = element.getAttribute('aria-haspopup');
  if (ariaHasPopup === 'dialog') {
    return true;
  }
  
  // Data attributes commonly used for modals
  if (element.hasAttribute('data-toggle') && 
      element.getAttribute('data-toggle') === 'modal') {
    return true;
  }
  
  if (element.hasAttribute('data-bs-toggle') && 
      element.getAttribute('data-bs-toggle') === 'modal') {
    return true;
  }
  
  return false;
}

/**
 * Detect if element is an input field
 */
export function isInputElement(element: Element): boolean {
  if (element.tagName === 'INPUT' || 
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT') {
    return true;
  }
  
  const role = element.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') {
    return true;
  }
  
  if ((element as HTMLElement).isContentEditable) {
    return true;
  }
  
  return false;
}

// ============================================================================
// Main Pattern Detection
// ============================================================================

/**
 * Detect the component pattern for an element interaction
 */
export function detectComponentPattern(
  element: Element,
  event?: MouseEvent
): ComponentPattern {
  const signature = buildElementSignature(element, event);
  
  // Check for dropdown first (most complex)
  if (isDropdownTrigger(element)) {
    return {
      type: 'DROPDOWN_SELECT',
      data: buildDropdownPatternData(element, signature),
    };
  }
  
  // Check for autocomplete
  if (isAutocompleteInput(element)) {
    return {
      type: 'AUTOCOMPLETE',
      data: {
        input: signature,
        typedValue: '',
        suggestion: {
          selectedText: '',
          matchMethod: 'contains',
        },
      },
    };
  }
  
  // Check for toggle
  if (isToggle(element)) {
    return {
      type: 'TOGGLE',
      data: buildSimpleClickData(element, signature),
    };
  }
  
  // Check for tab
  if (isTabControl(element)) {
    return {
      type: 'TAB_SELECT',
      data: buildSimpleClickData(element, signature),
    };
  }
  
  // Check for modal trigger
  if (isModalTrigger(element)) {
    return {
      type: 'MODAL_TRIGGER',
      data: buildSimpleClickData(element, signature),
    };
  }
  
  // Check for input
  if (isInputElement(element)) {
    return {
      type: 'TEXT_INPUT',
      data: buildTextInputData(element, signature),
    };
  }
  
  // Default: simple click
  return {
    type: 'SIMPLE_CLICK',
    data: buildSimpleClickData(element, signature),
  };
}

/**
 * Build dropdown pattern data
 */
function buildDropdownPatternData(
  element: Element,
  signature: ElementSignature
): DropdownPatternData {
  const library = detectComponentLibrary(element);
  
  // Get current value
  let currentValue: string | undefined;
  
  if (element.tagName === 'SELECT') {
    currentValue = (element as HTMLSelectElement).value;
  } else {
    // Try to get displayed value from common patterns
    const valueDisplay = element.querySelector(
      '.MuiSelect-select, .ant-select-selection-item, ' +
      '[class*="selected"], [class*="value"], [class*="placeholder"]'
    );
    currentValue = valueDisplay?.textContent?.trim() || element.textContent?.trim();
  }
  
  return {
    trigger: signature,
    currentValue,
    ariaExpanded: element.getAttribute('aria-expanded') || undefined,
    selection: {
      optionText: '', // Will be filled when option is clicked
    },
    menu: {
      appearsWhere: library === 'mui' || library === 'radix' ? 'portal' : 'below-trigger',
      menuRole: 'listbox',
      optionRole: 'option',
      menuSelector: '[role="menu"]', // Universal fallback - MenuDetector handles framework-specific detection
    },
  };
}

/**
 * Build simple click pattern data
 */
function buildSimpleClickData(
  element: Element,
  signature: ElementSignature
): SimpleClickPatternData {
  // Try to determine expected change
  let expectedChange: SimpleClickPatternData['expectedChange'];
  
  // Check for navigation
  if (element.tagName === 'A') {
    const href = element.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      expectedChange = { type: 'navigation', details: href };
    }
  }
  
  // Check for form submit
  if (element.tagName === 'BUTTON') {
    const type = (element as HTMLButtonElement).type;
    if (type === 'submit') {
      expectedChange = { type: 'form-submit' };
    }
  }
  
  // Check for modal
  if (isModalTrigger(element)) {
    expectedChange = { type: 'modal-open' };
  }
  
  // Check for toggle/state change
  if (isToggle(element)) {
    expectedChange = { type: 'state-change', details: 'toggle' };
  }
  
  return {
    target: signature,
    expectedChange: expectedChange || { type: 'unknown' },
  };
}

/**
 * Build text input pattern data
 */
function buildTextInputData(
  element: Element,
  signature: ElementSignature
): TextInputPatternData {
  let inputType: TextInputPatternData['inputType'] = 'text';
  
  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type;
    if (['password', 'email', 'number', 'tel', 'url', 'search'].includes(type)) {
      inputType = type as TextInputPatternData['inputType'];
    }
  } else if (element.tagName === 'TEXTAREA') {
    inputType = 'text';
  } else if ((element as HTMLElement).isContentEditable) {
    inputType = 'contenteditable';
  }
  
  return {
    input: signature,
    value: '',
    clearFirst: true,
    inputType,
  };
}

// ============================================================================
// Exports for Pattern Type Checking
// ============================================================================

export function isDropdownPattern(pattern: ComponentPattern): pattern is { type: 'DROPDOWN_SELECT'; data: DropdownPatternData } {
  return pattern.type === 'DROPDOWN_SELECT';
}

export function isSimpleClickPattern(pattern: ComponentPattern): pattern is { type: 'SIMPLE_CLICK'; data: SimpleClickPatternData } {
  return pattern.type === 'SIMPLE_CLICK';
}

export function isTextInputPattern(pattern: ComponentPattern): pattern is { type: 'TEXT_INPUT'; data: TextInputPatternData } {
  return pattern.type === 'TEXT_INPUT';
}

