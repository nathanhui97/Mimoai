/**
 * Shared test fixtures for agent execution accuracy tests.
 *
 * Form builders return raw HTML strings.
 * Object factories return typed objects with sensible defaults.
 * DOM helpers read/write document.body for assertions.
 */

import type {
  AgentHint,
  AgentObservation,
  PlannedFieldAction,
  PlannedNavigationAction,
  PlannedSubmitAction,
} from '../types';

// ============================================================================
// Form Builders
// ============================================================================

/** play2.automationcamp.ir form — text inputs, radios, selects, checkboxes */
export function buildPlay2Form(): string {
  return `
    <form id="play2-form">
      <label for="firstName">First name</label>
      <input id="firstName" name="firstName" type="text" />

      <label for="lastName">Last name</label>
      <input id="lastName" name="lastName" type="text" />

      <label for="email">Email</label>
      <input id="email" name="email" type="email" />

      <label for="phone">Phone</label>
      <input id="phone" name="phone" type="tel" />

      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="">Select country</option>
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
        <option value="ca">Canada</option>
      </select>

      <label for="language">Language</label>
      <select id="language" name="language" multiple>
        <option value="en">English</option>
        <option value="fr">French</option>
        <option value="es">Spanish</option>
      </select>

      <fieldset>
        <legend>Gender</legend>
        <label><input type="radio" name="gender" value="male" /> Male</label>
        <label><input type="radio" name="gender" value="female" /> Female</label>
        <label><input type="radio" name="gender" value="other" /> Other</label>
      </fieldset>

      <label><input type="checkbox" name="terms" /> I agree to terms</label>
      <label><input type="checkbox" name="newsletter" /> Subscribe to newsletter</label>

      <button type="submit" id="play2-submit">Submit</button>
    </form>
  `;
}

/** Custom dropdown with role="combobox" trigger + role="listbox" + role="option" */
export function buildCustomDropdownForm(): string {
  return `
    <div class="custom-dropdown">
      <button role="combobox" aria-haspopup="listbox" aria-expanded="false" id="dropdown-trigger">
        Select an option
      </button>
      <ul role="listbox" id="dropdown-listbox">
        <li role="option" data-value="opt1">Option 1</li>
        <li role="option" data-value="opt2">Option 2</li>
        <li role="option" data-value="opt3">Option 3</li>
      </ul>
    </div>
  `;
}

/** Input with autocomplete suggestions container */
export function buildTypeaheadForm(): string {
  return `
    <div class="typeahead-wrapper">
      <label for="search">Search</label>
      <input id="search" type="text" autocomplete="off" />
      <ul class="suggestions" id="suggestion-list">
        <li class="suggestion-item" data-value="Apple">Apple</li>
        <li class="suggestion-item" data-value="Banana">Banana</li>
        <li class="suggestion-item" data-value="Cherry">Cherry</li>
      </ul>
    </div>
  `;
}

/** Display text that reveals an input on click (inline edit pattern) */
export function buildInlineEditForm(): string {
  return `
    <div id="inline-edit-wrapper">
      <span class="display-text">Current Value</span>
      <input type="text" class="edit-input" value="Current Value" />
    </div>
  `;
}

/** Form behind a button that opens a role="dialog" modal */
export function buildModalForm(): string {
  return `
    <button id="open-modal-btn">Open Modal</button>
    <div role="dialog" aria-modal="true" id="test-modal">
      <h2>Modal Form</h2>
      <label for="modal-name">Name</label>
      <input id="modal-name" name="modalName" type="text" />
      <label for="modal-email">Email</label>
      <input id="modal-email" name="modalEmail" type="email" />
      <button id="modal-submit" type="submit">Save</button>
    </div>
  `;
}

/** Multi-select with checkboxes inside a dropdown panel */
export function buildMultiSelectForm(): string {
  return `
    <div class="multi-select">
      <button id="multi-trigger" role="combobox">Select items</button>
      <div class="dropdown-menu" id="multi-panel">
        <label class="dropdown-item"><input type="checkbox" name="item1" value="item1" /> Item 1</label>
        <label class="dropdown-item"><input type="checkbox" name="item2" value="item2" /> Item 2</label>
        <label class="dropdown-item"><input type="checkbox" name="item3" value="item3" /> Item 3</label>
      </div>
    </div>
  `;
}

/** Large multi-section SaaS settings page */
export function buildComplexPageForm(): string {
  return `
    <form id="settings-form">
      <fieldset id="personal-section">
        <legend>Personal Information</legend>
        <label for="personal-name">Name</label>
        <input id="personal-name" name="personalName" type="text" />
        <label for="personal-email">Email</label>
        <input id="personal-email" name="personalEmail" type="email" />
        <label><input type="radio" name="personalGender" value="male" /> Male</label>
        <label><input type="radio" name="personalGender" value="female" /> Female</label>
      </fieldset>

      <fieldset id="address-section">
        <legend>Address</legend>
        <label for="address-street">Street</label>
        <input id="address-street" name="addressStreet" type="text" />
        <label for="address-city">City</label>
        <input id="address-city" name="addressCity" type="text" />
        <select id="address-state" name="addressState">
          <option value="">Select state</option>
          <option value="CA">California</option>
          <option value="NY">New York</option>
          <option value="TX">Texas</option>
        </select>
      </fieldset>

      <fieldset id="preferences-section">
        <legend>Preferences</legend>
        <label><input type="checkbox" name="prefNotifications" /> Email notifications</label>
        <label><input type="checkbox" name="prefNewsletter" /> Newsletter</label>
        <select id="pref-theme" name="prefTheme">
          <option value="">Select theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </fieldset>

      <fieldset id="company-section">
        <legend>Company</legend>
        <label for="company-name">Name</label>
        <input id="company-name" name="companyName" type="text" />
        <label for="company-role">Role</label>
        <input id="company-role" name="companyRole" type="text" />
      </fieldset>

      <button type="submit" id="settings-submit">Save Settings</button>
    </form>
  `;
}

/** Portal pattern — listbox renders outside trigger's parent */
export function buildPortalDropdownForm(): string {
  return `
    <div class="form-container">
      <button role="combobox" id="portal-trigger" aria-haspopup="listbox">Select</button>
    </div>
    <div class="portal-container">
      <ul role="listbox" id="portal-listbox">
        <li role="option">Portal Option 1</li>
        <li role="option">Portal Option 2</li>
        <li role="option">Portal Option 3</li>
      </ul>
    </div>
  `;
}

// ============================================================================
// Object Factories
// ============================================================================

export function makeHint(overrides?: Partial<AgentHint>): AgentHint {
  return {
    stepNumber: 1,
    description: 'Test step',
    actionType: 'type',
    completed: false,
    ...overrides,
  } as AgentHint;
}

export function makeObservation(overrides?: Partial<AgentObservation>): AgentObservation {
  return {
    url: 'http://localhost:3000',
    title: 'Test Page',
    domMapText: '<div>test</div>',
    hasModal: false,
    hasOpenDropdown: false,
    formFields: [],
    buttonCount: 1,
    linkCount: 0,
    inputCount: 2,
    headings: [],
    viewportSize: { width: 1920, height: 1080 },
    timestamp: Date.now(),
    ...overrides,
  } as AgentObservation;
}

export function makeFieldAction(overrides?: Partial<PlannedFieldAction>): PlannedFieldAction {
  return {
    fieldName: 'Test Field',
    value: 'test value',
    elementIndex: 0,
    selector: '#test-field',
    strategy: 'type',
    required: true,
    hintIndex: 0,
    ...overrides,
  };
}

export function makeNavAction(overrides?: Partial<PlannedNavigationAction>): PlannedNavigationAction {
  return {
    description: 'Click button',
    elementIndex: 0,
    selector: '#nav-btn',
    expectsNavigation: false,
    expectsModal: false,
    hintIndex: 0,
    ...overrides,
  };
}

export function makeSubmitAction(overrides?: Partial<PlannedSubmitAction>): PlannedSubmitAction {
  return {
    elementIndex: 0,
    selector: '#submit-btn',
    waitAfterMs: 0,
    hintIndex: 0,
    ...overrides,
  };
}

// ============================================================================
// DOM Helpers
// ============================================================================

/**
 * Get the body element that's actually in the document tree.
 * test-setup.ts replaces document.body with a detached mock via Object.defineProperty,
 * so document.querySelector can't find elements set via document.body.innerHTML.
 * This helper finds the real, in-tree <body> element.
 */
function getTreeBody(): HTMLElement {
  return document.querySelector('body') ?? document.body;
}

/** Read all current field values from a container element */
export function getFormValues(container: HTMLElement): Record<string, string | boolean> {
  const values: Record<string, string | boolean> = {};

  // Text-like inputs
  container.querySelectorAll<HTMLInputElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input[type="search"], input[type="password"], input:not([type])',
  ).forEach(input => {
    const key = input.name || input.id;
    if (key) values[key] = input.value;
  });

  // Checkboxes
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    const key = input.name || input.id;
    if (key) values[key] = input.checked;
  });

  // Radio groups — value of selected radio per group
  const radioGroups = new Set<string>();
  container.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(input => {
    radioGroups.add(input.name);
  });
  radioGroups.forEach(groupName => {
    const checked = container.querySelector<HTMLInputElement>(
      `input[type="radio"][name="${groupName}"]:checked`,
    );
    values[groupName] = checked?.value ?? '';
  });

  // Selects
  container.querySelectorAll<HTMLSelectElement>('select').forEach(select => {
    const key = select.name || select.id;
    if (key) values[key] = select.value;
  });

  // Textareas
  container.querySelectorAll<HTMLTextAreaElement>('textarea').forEach(textarea => {
    const key = textarea.name || textarea.id;
    if (key) values[key] = textarea.value;
  });

  return values;
}

/** Set the in-tree body's innerHTML and return it */
export function setupForm(html: string): HTMLElement {
  const body = getTreeBody();
  body.innerHTML = html;
  return body;
}

/** Clear the in-tree body */
export function cleanupForm(): void {
  getTreeBody().innerHTML = '';
}
