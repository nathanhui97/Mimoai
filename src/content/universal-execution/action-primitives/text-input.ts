/**
 * Text Input Primitive
 * 
 * Handles text input across different input types:
 * native inputs, textareas, contenteditable, React controlled.
 * 
 * Uses FAST typing by default (direct value set + events).
 * Character-by-character typing only when HUMAN_TYPING_DEFAULT flag is enabled.
 */

import type {
  ActionResult,
  ActionOptions,
} from '../../../types/universal-types';
import { checkInteractability } from '../interactability-gate';

// ============================================================================
// Main Input Execution
// ============================================================================

/**
 * Execute text input on an element
 */
export async function executeTextInput(
  element: Element,
  value: string,
  options: ActionOptions & { clearFirst?: boolean } = {}
): Promise<ActionResult> {
  const startTime = Date.now();
  const strategiesTried: string[] = [];
  const { clearFirst = true } = options;

  // Check interactability
  const interactability = checkInteractability(element);
  if (!interactability.ok) {
    return {
      success: false,
      actionType: 'text-input',
      elapsedMs: Date.now() - startTime,
      strategiesTried: [],
      error: `Input not interactable: ${interactability.reason}`,
    };
  }

  // Detect input type
  const inputType = detectInputType(element);
  strategiesTried.push(`type:${inputType}`);

  try {
    // Focus element
    if (element instanceof HTMLElement) {
      element.focus();
      await sleep(50);
    }

    // Clear if requested
    if (clearFirst) {
      await clearInput(element, inputType);
      strategiesTried.push('clear');
    }

    // Set value based on type (result is verified later via getInputValue)
    switch (inputType) {
      case 'native-input':
      case 'native-textarea':
        await setNativeInputValue(element as HTMLInputElement | HTMLTextAreaElement, value);
        strategiesTried.push('native-setter');
        break;
      
      case 'native-select':
        await setSelectValue(element as HTMLSelectElement, value);
        strategiesTried.push('select-setter');
        break;
      
      case 'contenteditable':
        await setContentEditableValue(element as HTMLElement, value);
        strategiesTried.push('contenteditable');
        break;
      
      case 'react-controlled':
        await setReactInputValue(element as HTMLInputElement, value);
        strategiesTried.push('react-setter');
        break;
      
      default:
        await setGenericInputValue(element, value);
        strategiesTried.push('generic');
    }

    // Verify
    const actualValue = getInputValue(element);
    const valueMatches = actualValue === value;
    const hasContent = actualValue.length > 0;

    if (valueMatches) {
      return {
        success: true,
        actionType: 'text-input',
        elapsedMs: Date.now() - startTime,
        successfulStrategy: strategiesTried[strategiesTried.length - 1],
        strategiesTried,
      };
    }

    if (hasContent) {
      // Value was transformed (e.g., phone formatting)
      return {
        success: true,
        actionType: 'text-input',
        elapsedMs: Date.now() - startTime,
        successfulStrategy: strategiesTried[strategiesTried.length - 1],
        strategiesTried,
        details: { note: 'Value was transformed by input', actualValue },
      };
    }

    return {
      success: false,
      actionType: 'text-input',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: 'Value did not persist in input',
    };

  } catch (error) {
    return {
      success: false,
      actionType: 'text-input',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Input Type Detection
// ============================================================================

type InputType = 'native-input' | 'native-textarea' | 'native-select' | 'contenteditable' | 'react-controlled' | 'generic';

/**
 * Detect the type of input element
 */
function detectInputType(element: Element): InputType {
  if (element.tagName === 'INPUT') {
    // Check for React controlled input
    if (isReactControlled(element)) {
      return 'react-controlled';
    }
    return 'native-input';
  }
  
  if (element.tagName === 'TEXTAREA') {
    return 'native-textarea';
  }
  
  if (element.tagName === 'SELECT') {
    return 'native-select';
  }
  
  if ((element as HTMLElement).isContentEditable) {
    return 'contenteditable';
  }
  
  // Check role
  const role = element.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox') {
    if ((element as HTMLElement).isContentEditable) {
      return 'contenteditable';
    }
  }
  
  return 'generic';
}

/**
 * Check if input is React controlled
 */
function isReactControlled(element: Element): boolean {
  // React controlled inputs have special properties
  const keys = Object.keys(element);
  for (const key of keys) {
    if (key.startsWith('__reactFiber') || key.startsWith('__reactProps')) {
      const props = (element as any)[key];
      if (props?.onChange || props?.onInput) {
        return true;
      }
      if (props?.memoizedProps?.onChange || props?.memoizedProps?.onInput) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// Clear Input
// ============================================================================

/**
 * Clear existing input value
 */
async function clearInput(element: Element, inputType: InputType): Promise<void> {
  switch (inputType) {
    case 'native-input':
    case 'native-textarea':
    case 'react-controlled': {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      
      // Select all
      input.select();
      await sleep(10);
      
      // Delete
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      break;
    }
    
    case 'contenteditable': {
      const el = element as HTMLElement;
      
      // Select all using execCommand
      document.execCommand('selectAll', false, undefined);
      await sleep(10);
      
      // Delete
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward',
      }));
      break;
    }
    
    case 'native-select':
      // Don't clear selects
      break;
    
    default:
      // Try generic approach
      if ('value' in element) {
        (element as any).value = '';
      }
  }
}

// ============================================================================
// Set Value by Type
// ============================================================================

/**
 * Set value for native input/textarea
 */
async function setNativeInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<boolean> {
  input.value = value;
  
  // Dispatch events
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Also dispatch keyup for frameworks that listen to it
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  
  await sleep(50);
  return input.value === value;
}

/**
 * Set value for React controlled input
 */
async function setReactInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<boolean> {
  // React uses a special native setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  
  const setter = input.tagName === 'TEXTAREA' 
    ? nativeTextAreaValueSetter 
    : nativeInputValueSetter;
  
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  
  // Dispatch events that React listens to
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  await sleep(50);
  return input.value === value;
}

/**
 * Set value for contenteditable element
 */
async function setContentEditableValue(
  element: HTMLElement,
  value: string
): Promise<boolean> {
  // Focus first
  element.focus();
  await sleep(20);
  
  // Try execCommand first (works in most browsers)
  document.execCommand('selectAll', false, undefined);
  document.execCommand('insertText', false, value);
  
  await sleep(20);
  
  // Check if it worked
  if (element.textContent?.trim() === value) {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
    return true;
  }
  
  // Fallback: Set textContent directly
  element.textContent = value;
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: value,
  }));
  
  await sleep(20);
  return element.textContent?.trim() === value;
}

/**
 * Set value for select element
 */
async function setSelectValue(
  select: HTMLSelectElement,
  value: string
): Promise<boolean> {
  // Try to find option by value or text
  for (const option of select.options) {
    if (option.value === value || option.textContent?.trim() === value) {
      option.selected = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(20);
      return true;
    }
  }
  
  return false;
}

/**
 * Set value for generic element
 */
async function setGenericInputValue(
  element: Element,
  value: string
): Promise<boolean> {
  if ('value' in element) {
    (element as any).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(20);
    return (element as any).value === value;
  }
  
  if ((element as HTMLElement).isContentEditable) {
    (element as HTMLElement).textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await sleep(20);
    return element.textContent?.trim() === value;
  }
  
  return false;
}

// ============================================================================
// Get Value
// ============================================================================

/**
 * Get current value from input element
 */
function getInputValue(element: Element): string {
  if (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  
  if (element instanceof HTMLSelectElement) {
    return element.value;
  }
  
  if ((element as HTMLElement).isContentEditable) {
    return element.textContent?.trim() || '';
  }
  
  if ('value' in element) {
    return String((element as any).value);
  }
  
  return element.textContent?.trim() || '';
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

