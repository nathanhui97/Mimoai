/**
 * Intent Types - Machine-readable goals for the state-machine replayer
 * 
 * Different intents trigger different resolution strategies.
 * For example, OPEN_ROW_ACTIONS knows to find the row first, then the button within it.
 */

/**
 * Machine-readable intent that drives resolution strategy
 */
export type Intent =
  | { kind: 'CLICK' }
  | { kind: 'TYPE'; valueVar: string }
  | { kind: 'OPEN_ROW_ACTIONS'; rowKeyVar: string }
  | { kind: 'SELECT_DROPDOWN_OPTION'; optionVar: string }
  | { kind: 'NAVIGATE'; urlVar?: string }
  | { kind: 'SUBMIT_FORM' }
  | { kind: 'TOGGLE_CHECKBOX'; expectedState?: boolean }
  | { kind: 'SCROLL_TO'; target: string }
  | { kind: 'HOVER' }
  | { kind: 'FOCUS' }
  | { kind: 'PRESS_KEY'; key: string; modifiers?: KeyModifiers }
  | { kind: 'READ'; attribute?: string }
  | { kind: 'ASSERT' };

/**
 * Key modifiers for keyboard actions
 */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/**
 * StepGoal combines machine-readable intent with human-readable descriptions
 */
export interface StepGoal {
  /** Machine-readable intent that drives resolution strategy */
  intent: Intent;
  /** Human-readable description for logs and UI */
  description: string;
  /** Expected outcome after action completes (e.g., "menu visible", "page navigated") */
  expectedOutcome: string;
}

/**
 * Type guard to check if an object is a valid Intent
 */
export function isIntent(obj: unknown): obj is Intent {
  if (typeof obj !== 'object' || obj === null) return false;
  const intent = obj as { kind?: string };
  if (typeof intent.kind !== 'string') return false;
  
  const validKinds = [
    'CLICK', 'TYPE', 'OPEN_ROW_ACTIONS', 'SELECT_DROPDOWN_OPTION',
    'NAVIGATE', 'SUBMIT_FORM', 'TOGGLE_CHECKBOX', 'SCROLL_TO',
    'HOVER', 'FOCUS', 'PRESS_KEY', 'READ', 'ASSERT'
  ];
  
  return validKinds.includes(intent.kind);
}

/**
 * Create a simple click intent
 */
export function createClickIntent(): Intent {
  return { kind: 'CLICK' };
}

/**
 * Create a type/input intent
 */
export function createTypeIntent(valueVar: string): Intent {
  return { kind: 'TYPE', valueVar };
}

/**
 * Create an intent to open row actions menu
 */
export function createOpenRowActionsIntent(rowKeyVar: string): Intent {
  return { kind: 'OPEN_ROW_ACTIONS', rowKeyVar };
}

/**
 * Create an intent to select a dropdown option
 */
export function createSelectDropdownIntent(optionVar: string): Intent {
  return { kind: 'SELECT_DROPDOWN_OPTION', optionVar };
}

/**
 * Create a navigation intent
 */
export function createNavigateIntent(urlVar?: string): Intent {
  return { kind: 'NAVIGATE', urlVar };
}

/**
 * Create a form submission intent
 */
export function createSubmitFormIntent(): Intent {
  return { kind: 'SUBMIT_FORM' };
}

/**
 * Create a checkbox toggle intent
 */
export function createToggleCheckboxIntent(expectedState?: boolean): Intent {
  return { kind: 'TOGGLE_CHECKBOX', expectedState };
}

/**
 * Create a keyboard press intent
 */
export function createPressKeyIntent(key: string, modifiers?: KeyModifiers): Intent {
  return { kind: 'PRESS_KEY', key, modifiers };
}

/**
 * Get a human-readable description for an intent
 */
export function describeIntent(intent: Intent): string {
  switch (intent.kind) {
    case 'CLICK':
      return 'Click element';
    case 'TYPE':
      return `Type value "${intent.valueVar}"`;
    case 'OPEN_ROW_ACTIONS':
      return `Open actions menu for row "${intent.rowKeyVar}"`;
    case 'SELECT_DROPDOWN_OPTION':
      return `Select dropdown option "${intent.optionVar}"`;
    case 'NAVIGATE':
      return intent.urlVar ? `Navigate to "${intent.urlVar}"` : 'Navigate';
    case 'SUBMIT_FORM':
      return 'Submit form';
    case 'TOGGLE_CHECKBOX':
      return intent.expectedState !== undefined 
        ? `Set checkbox to ${intent.expectedState ? 'checked' : 'unchecked'}`
        : 'Toggle checkbox';
    case 'SCROLL_TO':
      return `Scroll to "${intent.target}"`;
    case 'HOVER':
      return 'Hover over element';
    case 'FOCUS':
      return 'Focus element';
    case 'PRESS_KEY':
      const modStr = intent.modifiers 
        ? Object.entries(intent.modifiers)
            .filter(([_, v]) => v)
            .map(([k]) => k)
            .join('+') + '+'
        : '';
      return `Press ${modStr}${intent.key}`;
    case 'READ':
      return intent.attribute ? `Read ${intent.attribute} from element` : 'Read element value';
    case 'ASSERT':
      return 'Assert condition';
    default:
      return 'Unknown intent';
  }
}







