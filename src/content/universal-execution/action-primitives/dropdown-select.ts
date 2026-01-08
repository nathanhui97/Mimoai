/**
 * Dropdown Select Primitive
 * 
 * Handles dropdown selection as ONE atomic action.
 * This is the key primitive that solves dropdown click issues.
 */

import type {
  ActionResult,
  DropdownPatternData,
  ComponentLibrary,
} from '../../../types/universal-types';
import { resolveElement } from '../element-resolver';
import { checkInteractability } from '../interactability-gate';
import { 
  detectComponentLibrary
} from '../component-detector';
import {
  waitForDropdownMenu,
  verifyDropdownSelection,
  verifyDropdownClosed,
} from '../state-verifier';

// ============================================================================
// Main Dropdown Select Execution
// ============================================================================

/**
 * Execute a complete dropdown selection as one atomic action
 */
export async function executeDropdownSelect(
  pattern: DropdownPatternData
): Promise<ActionResult> {
  const startTime = Date.now();
  const strategiesTried: string[] = [];

  // Step 1: Find and validate trigger
  const triggerResolution = await resolveElement(pattern.trigger, { timeout: 2000 });
  
  if (triggerResolution.status !== 'found') {
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried: [],
      error: `Dropdown trigger not found: ${triggerResolution.status === 'not_found' 
        ? triggerResolution.lastError 
        : 'Ambiguous match'}`,
    };
  }

  const trigger = triggerResolution.element;

  // Check interactability
  const interactability = checkInteractability(trigger);
  if (!interactability.ok) {
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried: [],
      error: `Trigger not interactable: ${interactability.reason}`,
    };
  }

  // Step 2: Detect dropdown type/library
  const library = detectComponentLibrary(trigger);
  console.log(`[DropdownSelect] Detected library: ${library}`);

  // Step 3: Handle native SELECT element specially
  if (trigger.tagName === 'SELECT') {
    const result = await handleNativeSelect(trigger as HTMLSelectElement, pattern.selection.optionText);
    return {
      ...result,
      elapsedMs: Date.now() - startTime,
    };
  }

  // Step 4: Open dropdown using multiple methods
  const openResult = await openDropdown(trigger, library, strategiesTried);
  if (!openResult.success) {
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: `Could not open dropdown: ${openResult.error}`,
    };
  }

  const menu = openResult.menu;
  if (!menu) {
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: 'Dropdown opened but menu element not found',
    };
  }
  console.log(`[DropdownSelect] Dropdown opened, menu found`);

  // Step 5: Find option in menu
  const option = await findOption(menu, pattern.selection.optionText);
  if (!option) {
    // List available options for debugging
    const availableOptions = await getAvailableOptions(menu);
    
    // Try to close dropdown before failing
    await closeDropdown(trigger);
    
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: `Option "${pattern.selection.optionText}" not found. Available: ${availableOptions.join(', ')}`,
      details: { availableOptions },
    };
  }

  console.log(`[DropdownSelect] Found option: ${option.textContent?.trim()}`);

  // Step 6: Select option
  const selectResult = await selectOption(option, library, strategiesTried);
  if (!selectResult.success) {
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: Date.now() - startTime,
      strategiesTried,
      error: `Could not select option: ${selectResult.error}`,
    };
  }

  // Step 7: Verify selection
  await sleep(100);
  
  const verified = await verifyDropdownSelection(trigger, pattern.selection.optionText, 1000);
  if (!verified) {
    // Selection may have worked but value shows differently
    // Check if dropdown at least closed
    const closed = await verifyDropdownClosed(500);
    if (!closed) {
      return {
        success: false,
        actionType: 'dropdown-select',
        elapsedMs: Date.now() - startTime,
        strategiesTried,
        error: 'Selection did not persist and dropdown did not close',
      };
    }
    // Dropdown closed, assume selection worked
  }

  return {
    success: true,
    actionType: 'dropdown-select',
    elapsedMs: Date.now() - startTime,
    successfulStrategy: strategiesTried[strategiesTried.length - 1],
    strategiesTried,
  };
}

// ============================================================================
// Open Dropdown
// ============================================================================

interface OpenResult {
  success: boolean;
  menu?: Element;
  error?: string;
}

/**
 * Open a dropdown using multiple methods
 */
async function openDropdown(
  trigger: Element,
  _library: ComponentLibrary,
  strategiesTried: string[]
): Promise<OpenResult> {
  // Check if already open
  const existingMenu = await waitForDropdownMenu(100);
  if (existingMenu) {
    return { success: true, menu: existingMenu };
  }

  // Define open strategies
  const strategies = [
    { name: 'click', fn: () => clickToOpen(trigger) },
    { name: 'focus-click', fn: () => focusAndClickToOpen(trigger) },
    { name: 'enter', fn: () => enterToOpen(trigger) },
    { name: 'space', fn: () => spaceToOpen(trigger) },
    { name: 'arrow-down', fn: () => arrowDownToOpen(trigger) },
    { name: 'pointer-sequence', fn: () => pointerSequenceToOpen(trigger) },
  ];

  for (const strategy of strategies) {
    strategiesTried.push(`open:${strategy.name}`);
    
    try {
      await strategy.fn();
      
      // Wait for menu to appear
      const menu = await waitForDropdownMenu(500);
      if (menu) {
        return { success: true, menu };
      }
    } catch (error) {
      console.debug(`Open strategy ${strategy.name} failed:`, error);
    }
  }

  return { 
    success: false, 
    error: `No method opened the dropdown. Tried: ${strategiesTried.filter(s => s.startsWith('open:')).join(', ')}` 
  };
}

/**
 * Click to open
 */
async function clickToOpen(trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(30);
    trigger.click();
  }
}

/**
 * Focus and click to open
 */
async function focusAndClickToOpen(trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(50);
    trigger.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await sleep(30);
    trigger.click();
  }
}

/**
 * Enter key to open
 */
async function enterToOpen(trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(30);
  }
  
  trigger.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
  }));
  await sleep(20);
  trigger.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
  }));
}

/**
 * Space key to open
 */
async function spaceToOpen(trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(30);
  }
  
  trigger.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: ' ',
    code: 'Space',
    keyCode: 32,
  }));
  await sleep(20);
  trigger.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key: ' ',
    code: 'Space',
    keyCode: 32,
  }));
}

/**
 * Arrow down to open
 */
async function arrowDownToOpen(trigger: Element): Promise<void> {
  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(30);
  }
  
  trigger.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'ArrowDown',
    code: 'ArrowDown',
    keyCode: 40,
  }));
  await sleep(20);
  trigger.dispatchEvent(new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key: 'ArrowDown',
    code: 'ArrowDown',
    keyCode: 40,
  }));
}

/**
 * Full pointer sequence to open
 */
async function pointerSequenceToOpen(trigger: Element): Promise<void> {
  const rect = trigger.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  if (trigger instanceof HTMLElement) {
    trigger.focus();
    await sleep(20);
  }

  trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(10);

  trigger.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: y,
  }));
  trigger.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  }));
  await sleep(20);

  trigger.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: x,
    clientY: y,
  }));
  trigger.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  }));
  await sleep(10);

  trigger.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  }));
}

// ============================================================================
// Find Option
// ============================================================================

/**
 * Find an option in the dropdown menu
 */
async function findOption(
  menu: Element,
  optionText: string
): Promise<Element | null> {
  // Use MenuDetector to get universal menu items
  const { MenuDetector } = await import('../../menu-detector');
  let options = MenuDetector.extractMenuItems(menu);
  
  // Also check menu children directly as fallback
  options.push(...Array.from(menu.children));
  
  // Deduplicate
  options = [...new Set(options)];
  
  // Try exact match first
  for (const option of options) {
    const text = getOptionText(option);
    if (text === optionText) {
      return option;
    }
  }
  
  // Try normalized match (case-insensitive, trimmed)
  const normalizedTarget = optionText.toLowerCase().trim();
  for (const option of options) {
    const text = getOptionText(option).toLowerCase().trim();
    if (text === normalizedTarget) {
      return option;
    }
  }
  
  // Try partial/contains match
  for (const option of options) {
    const text = getOptionText(option).toLowerCase();
    if (text.includes(normalizedTarget) || normalizedTarget.includes(text)) {
      return option;
    }
  }
  
  // Try scrolling to find option (for virtual lists)
  const { MENU_ITEM_SELECTORS } = await import('../../menu-detector');
  const scrolledOption = await scrollToFindOption(menu, optionText, MENU_ITEM_SELECTORS);
  if (scrolledOption) {
    return scrolledOption;
  }
  
  return null;
}

/**
 * Get text content of an option element
 */
function getOptionText(option: Element): string {
  // Try data-label first
  const dataLabel = option.getAttribute('data-label');
  if (dataLabel) return dataLabel;
  
  // Try aria-label
  const ariaLabel = option.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  
  // Try text content
  return option.textContent?.trim() || '';
}

/**
 * Scroll through menu to find option (for virtual lists)
 */
async function scrollToFindOption(
  menu: Element,
  optionText: string,
  optionSelectors: string[]
): Promise<Element | null> {
  const scrollContainer = menu;
  const maxScrollAttempts = 20;
  const normalizedTarget = optionText.toLowerCase().trim();
  
  // First scroll to top
  scrollContainer.scrollTop = 0;
  await sleep(100);
  
  for (let i = 0; i < maxScrollAttempts; i++) {
    // Check current options
    let options: Element[] = [];
    for (const selector of optionSelectors) {
      options.push(...Array.from(menu.querySelectorAll(selector)));
    }
    
    for (const option of options) {
      const text = getOptionText(option).toLowerCase().trim();
      if (text === normalizedTarget || text.includes(normalizedTarget)) {
        // CRITICAL: Only scroll if option is NOT in shadow DOM
        // Scrolling within dropdown is OK, but don't scroll the page
        const isInShadowDOM = option.getRootNode() instanceof ShadowRoot;
        if (!isInShadowDOM) {
          option.scrollIntoView({ block: 'center' });
        }
        return option;
      }
    }
    
    // Scroll down
    const beforeScroll = scrollContainer.scrollTop;
    scrollContainer.scrollTop += scrollContainer.clientHeight * 0.8;
    await sleep(100);
    
    // Check if we've reached bottom
    if (scrollContainer.scrollTop === beforeScroll) {
      break;
    }
  }
  
  return null;
}

/**
 * Get available options for error message
 */
async function getAvailableOptions(menu: Element): Promise<string[]> {
  const { MenuDetector } = await import('../../menu-detector');
  const elements = MenuDetector.extractMenuItems(menu);
  const options: string[] = [];
  
  for (const el of elements) {
    const text = getOptionText(el);
    if (text && !options.includes(text)) {
      options.push(text);
    }
  }
  
  return options.slice(0, 10); // Limit to first 10
}

// ============================================================================
// Select Option
// ============================================================================

interface SelectResult {
  success: boolean;
  error?: string;
}

/**
 * Select an option in the dropdown
 */
async function selectOption(
  option: Element,
  _library: ComponentLibrary,
  strategiesTried: string[]
): Promise<SelectResult> {
  const strategies = [
    { name: 'click', fn: () => clickOption(option) },
    { name: 'enter', fn: () => enterOnOption(option) },
    { name: 'space', fn: () => spaceOnOption(option) },
    { name: 'pointer', fn: () => pointerClickOption(option) },
  ];

  for (const strategy of strategies) {
    strategiesTried.push(`select:${strategy.name}`);
    
    try {
      await strategy.fn();
      await sleep(50);
      
      // Check if option is now selected or menu closed
      const ariaSelected = option.getAttribute('aria-selected');
      if (ariaSelected === 'true') {
        return { success: true };
      }
      
      // Check if menu closed (selection happened)
      await sleep(100);
      const menuClosed = await verifyDropdownClosed(200);
      if (menuClosed) {
        return { success: true };
      }
    } catch (error) {
      console.debug(`Select strategy ${strategy.name} failed:`, error);
    }
  }

  return { 
    success: false, 
    error: 'No method selected the option' 
  };
}

/**
 * Click option
 */
async function clickOption(option: Element): Promise<void> {
  if (option instanceof HTMLElement) {
    // CRITICAL: Only scroll if option is NOT in shadow DOM
    const isInShadowDOM = option.getRootNode() instanceof ShadowRoot;
    if (!isInShadowDOM) {
      option.scrollIntoView({ block: 'center' });
      await sleep(30);
    }
    option.click();
  }
}

/**
 * Enter key on option
 */
async function enterOnOption(option: Element): Promise<void> {
  if (option instanceof HTMLElement) {
    option.focus();
    await sleep(30);
  }
  
  option.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
  }));
}

/**
 * Space key on option
 */
async function spaceOnOption(option: Element): Promise<void> {
  if (option instanceof HTMLElement) {
    option.focus();
    await sleep(30);
  }
  
  option.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: ' ',
    code: 'Space',
    keyCode: 32,
  }));
}

/**
 * Pointer click on option
 */
async function pointerClickOption(option: Element): Promise<void> {
  const rect = option.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  option.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }));
  option.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }));
  await sleep(20);
  option.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }));
  option.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }));
  option.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  }));
}

// ============================================================================
// Native SELECT Handling
// ============================================================================

/**
 * Handle native HTML SELECT element
 */
async function handleNativeSelect(
  select: HTMLSelectElement,
  optionText: string
): Promise<ActionResult> {
  const strategiesTried = ['native-select'];

  // Find option by text
  let targetOption: HTMLOptionElement | null = null;
  
  for (const option of select.options) {
    if (option.textContent?.trim() === optionText) {
      targetOption = option;
      break;
    }
  }
  
  // Try partial match
  if (!targetOption) {
    const normalized = optionText.toLowerCase();
    for (const option of select.options) {
      if (option.textContent?.toLowerCase().includes(normalized)) {
        targetOption = option;
        break;
      }
    }
  }
  
  if (!targetOption) {
    const available = Array.from(select.options).map(o => o.textContent?.trim());
    return {
      success: false,
      actionType: 'dropdown-select',
      elapsedMs: 0,
      strategiesTried,
      error: `Option "${optionText}" not found. Available: ${available.join(', ')}`,
    };
  }
  
  // Select the option
  targetOption.selected = true;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Verify
  const verified = select.value === targetOption.value;
  
  return {
    success: verified,
    actionType: 'dropdown-select',
    elapsedMs: 0,
    successfulStrategy: 'native-select',
    strategiesTried,
    error: verified ? undefined : 'Selection did not persist',
  };
}

// ============================================================================
// Close Dropdown
// ============================================================================

/**
 * Try to close dropdown (for cleanup after errors)
 */
async function closeDropdown(_trigger: Element): Promise<void> {
  // Try escape key
  document.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
  }));
  await sleep(100);
  
  // Try clicking outside
  document.body.click();
  await sleep(100);
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

