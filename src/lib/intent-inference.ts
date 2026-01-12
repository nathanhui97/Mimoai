/**
 * IntentInference - Infer machine-readable intent from DOM events
 * 
 * Analyzes element context to determine the semantic intent of user actions.
 */

import type { Intent, StepGoal } from '../types/intent';
import { 
  createClickIntent, 
  createTypeIntent, 
  createSelectDropdownIntent,
  createOpenRowActionsIntent,
  createSubmitFormIntent,
  createToggleCheckboxIntent,
  createNavigateIntent,
  createPressKeyIntent,
  describeIntent,
} from '../types/intent';
import type { SuggestedCondition } from '../types/conditions';
import { 
  elementVisible, 
  domStable, 
  noLoaders,
  all,
  conditionTemplates,
} from '../types/conditions';

/**
 * Infer intent from a click action
 */
export function inferClickIntent(element: Element): Intent {
  const role = element.getAttribute('role');
  const ariaHaspopup = element.getAttribute('aria-haspopup');
  const type = (element as HTMLButtonElement).type;
  
  // CRITICAL FIX: Distinguish between dropdown option selection vs. trigger click
  // Check if this is an OPTION being selected (not the trigger)
  if (role === 'option' || role === 'menuitem') {
    const optionText = element.textContent?.trim() || '';
    console.log('[IntentInference] Detected dropdown OPTION selection:', optionText);
    return createSelectDropdownIntent(optionText);
  }
  
  // Dropdown trigger (combobox) - this just opens the dropdown, not a selection
  // Return regular CLICK intent (the subsequent option click will have the selection intent)
  if (ariaHaspopup === 'true' || 
      ariaHaspopup === 'listbox' || 
      ariaHaspopup === 'menu' ||
      role === 'combobox') {
    console.log('[IntentInference] Detected dropdown TRIGGER (will open menu)');
    return createClickIntent();
  }
  
  // Row actions button
  if (isInTableRow(element) && isActionsButton(element)) {
    const rowKey = getRowKey(element);
    return createOpenRowActionsIntent(rowKey);
  }
  
  // Submit button
  if (type === 'submit' || isSubmitButton(element)) {
    return createSubmitFormIntent();
  }
  
  // Checkbox
  if ((element as HTMLInputElement).type === 'checkbox' || role === 'checkbox') {
    const isChecked = (element as HTMLInputElement).checked || 
                      element.getAttribute('aria-checked') === 'true';
    return createToggleCheckboxIntent(!isChecked);
  }
  
  // Link that navigates
  if (element.tagName.toLowerCase() === 'a' && (element as HTMLAnchorElement).href) {
    const href = (element as HTMLAnchorElement).href;
    if (!href.startsWith('javascript:') && !href.startsWith('#')) {
      return createNavigateIntent(href);
    }
  }
  
  // Default click
  return createClickIntent();
}

/**
 * Infer intent from an input action
 */
export function inferInputIntent(_element: Element, value: string): Intent {
  return createTypeIntent(value);
}

/**
 * Infer intent from a keyboard action
 */
export function inferKeyboardIntent(key: string, modifiers?: Record<string, boolean>): Intent {
  return createPressKeyIntent(key, modifiers as any);
}

/**
 * Infer success condition based on intent and context
 */
export function inferSuccessCondition(
  intent: Intent,
  element: Element
): SuggestedCondition {
  switch (intent.kind) {
    case 'SELECT_DROPDOWN_OPTION':
      // When selecting an option, wait for DOM to stabilize (dropdown may close)
      return {
        condition: domStable(500),
        confidence: 'high',
        reason: 'Selecting dropdown option should stabilize DOM',
      };
      
    case 'OPEN_ROW_ACTIONS':
      return {
        condition: elementVisible('[role="menu"], [role="listbox"]', 3000),
        confidence: 'high',
        reason: 'Opening row actions should show menu',
      };
      
    case 'SUBMIT_FORM':
      return {
        condition: conditionTemplates.formSubmitted(),
        confidence: 'medium',
        reason: 'Submitting form should show success or navigate',
      };
      
    case 'TOGGLE_CHECKBOX': {
      const selector = buildElementSelector(element);
      const expectedState = intent.expectedState;
      return {
        condition: {
          type: expectedState ? 'element_checked' : 'element_unchecked',
          target: selector,
          timeout: 2000,
        } as any,
        confidence: 'high',
        reason: `Toggling checkbox should ${expectedState ? 'check' : 'uncheck'} it`,
      };
    }
      
    case 'NAVIGATE':
      return {
        condition: conditionTemplates.pageNavigated(intent.urlVar),
        confidence: 'high',
        reason: 'Navigation link should change URL',
      };
      
    case 'TYPE':
      return {
        condition: domStable(500),
        confidence: 'low',
        reason: 'Input should stabilize after typing',
      };
      
    case 'CLICK':
    default:
      // Check if this is a dropdown trigger (combobox)
      const role = element.getAttribute('role');
      const ariaHaspopup = element.getAttribute('aria-haspopup');
      
      if (ariaHaspopup === 'true' || 
          ariaHaspopup === 'listbox' || 
          ariaHaspopup === 'menu' ||
          role === 'combobox') {
        return {
          condition: conditionTemplates.dropdownOpened(),
          confidence: 'high',
          reason: 'Clicking dropdown trigger should open menu',
        };
      }
      
      // Analyze context for better condition
      if (isInModal(element)) {
        return {
          condition: conditionTemplates.loadingComplete(),
          confidence: 'medium',
          reason: 'Click in modal should complete loading',
        };
      }
      
      if (hasLoadingIndicator(element)) {
        return {
          condition: all(noLoaders(5000), domStable(1000)),
          confidence: 'medium',
          reason: 'Button with loading indicator should complete',
        };
      }
      
      return {
        condition: domStable(1000),
        confidence: 'low',
        reason: 'Click should stabilize DOM',
      };
  }
}

/**
 * Build a complete StepGoal
 */
export function buildStepGoal(
  intent: Intent,
  element: Element,
  customDescription?: string
): StepGoal {
  const description = customDescription || buildDescription(intent, element);
  const expectedOutcome = buildExpectedOutcome(intent);
  
  return {
    intent,
    description,
    expectedOutcome,
  };
}

// ============ Helper functions ============

function isInTableRow(element: Element): boolean {
  return !!element.closest('tr, [role="row"]');
}

function isActionsButton(element: Element): boolean {
  const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
  const text = element.textContent?.toLowerCase() || '';
  
  return ariaLabel.includes('action') ||
         ariaLabel.includes('menu') ||
         ariaLabel.includes('more') ||
         text.includes('action') ||
         text.includes('...') ||
         text === '⋮';
}

function getRowKey(element: Element): string {
  const row = element.closest('tr, [role="row"]');
  if (!row) return '';
  
  const firstCell = row.querySelector('td:first-child, [role="cell"]:first-child');
  return firstCell?.textContent?.trim() || '';
}

function isSubmitButton(element: Element): boolean {
  const text = element.textContent?.toLowerCase() || '';
  return text.includes('submit') ||
         text.includes('save') ||
         text.includes('send') ||
         text.includes('create') ||
         text.includes('add');
}

function isInModal(element: Element): boolean {
  return !!element.closest('[role="dialog"], .modal, [class*="modal"]');
}

function hasLoadingIndicator(element: Element): boolean {
  const hasSpinner = !!element.querySelector('.spinner, .loading, [class*="spinner"]');
  const hasAriaLoading = element.getAttribute('aria-busy') === 'true';
  return hasSpinner || hasAriaLoading;
}

function buildElementSelector(element: Element): string {
  if (element.id) {
    return `#${element.id}`;
  }
  
  const role = element.getAttribute('role');
  if (role) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return `[role="${role}"][aria-label="${ariaLabel}"]`;
    }
    return `[role="${role}"]`;
  }
  
  return element.tagName.toLowerCase();
}

function buildDescription(intent: Intent, element: Element): string {
  const text = element.textContent?.trim().slice(0, 30) || '';
  const ariaLabel = element.getAttribute('aria-label') || '';
  const label = ariaLabel || text;
  
  switch (intent.kind) {
    case 'CLICK':
      return label ? `Click "${label}"` : 'Click element';
    case 'TYPE':
      return `Type "${intent.valueVar}"`;
    case 'SELECT_DROPDOWN_OPTION':
      return `Select "${intent.optionVar}" from dropdown`;
    case 'OPEN_ROW_ACTIONS':
      return `Open actions for "${intent.rowKeyVar}"`;
    case 'SUBMIT_FORM':
      return label ? `Submit form: ${label}` : 'Submit form';
    case 'TOGGLE_CHECKBOX':
      return intent.expectedState ? `Check "${label}"` : `Uncheck "${label}"`;
    case 'NAVIGATE':
      return intent.urlVar ? `Navigate to ${intent.urlVar}` : 'Navigate';
    case 'PRESS_KEY':
      return `Press ${intent.key}`;
    default:
      return describeIntent(intent);
  }
}

function buildExpectedOutcome(intent: Intent): string {
  switch (intent.kind) {
    case 'CLICK':
      return 'action completed';
    case 'TYPE':
      return 'value entered';
    case 'SELECT_DROPDOWN_OPTION':
      return 'option selected';
    case 'OPEN_ROW_ACTIONS':
      return 'menu visible';
    case 'SUBMIT_FORM':
      return 'form submitted';
    case 'TOGGLE_CHECKBOX':
      return intent.expectedState ? 'checkbox checked' : 'checkbox unchecked';
    case 'NAVIGATE':
      return 'page navigated';
    case 'PRESS_KEY':
      return 'key action completed';
    default:
      return 'action completed';
  }
}

