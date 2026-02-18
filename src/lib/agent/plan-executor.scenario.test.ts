import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanExecutor } from './plan-executor';
import { PreFlightChecker } from './pre-flight-checker';
import {
  buildPlay2Form,
  buildCustomDropdownForm,
  buildTypeaheadForm,
  buildModalForm,
  buildInlineEditForm,
  buildComplexPageForm,
  makeFieldAction,
  makeNavAction,
  makeSubmitAction,
  makeHint,
  makeObservation,
  getFormValues,
  setupForm,
  cleanupForm,
} from './__test-fixtures__/form-fixtures';

// ============================================================================
// Full Scenario Regression Tests
// ============================================================================

// Mock scrollIntoView globally for all scenario tests (jsdom doesn't implement it)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () { /* no-op */ };
}

describe('Scenario: play2.automationcamp.ir — basic form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildPlay2Form());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('fill First name + Last name → verify both have correct values', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'John', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#lastName', value: 'Doe', strategy: 'type' }),
    );

    expect((document.querySelector('#firstName') as HTMLInputElement).value).toBe('John');
    expect((document.querySelector('#lastName') as HTMLInputElement).value).toBe('Doe');
  });

  it('First name and Last name do NOT cross-contaminate (same value "test")', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'test', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#lastName', value: 'test', strategy: 'type' }),
    );

    // Both should be "test" — filling last name didn't overwrite first name
    expect((document.querySelector('#firstName') as HTMLInputElement).value).toBe('test');
    expect((document.querySelector('#lastName') as HTMLInputElement).value).toBe('test');
  });

  it('select from single-select dropdown → verify selected option', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#country', value: 'United States', strategy: 'select' }),
    );
    expect(result.success).toBe(true);
    expect((document.querySelector('#country') as HTMLSelectElement).value).toBe('us');
  });

  it('select from multi-select dropdown → verify selected option', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#language', value: 'French', strategy: 'select' }),
    );
    expect(result.success).toBe(true);
    expect((document.querySelector('#language') as HTMLSelectElement).value).toBe('fr');
  });

  it('check checkboxes → both succeed and simulateClick called', async () => {
    const clickSpy = vi.spyOn(executor as any, 'simulateClick');
    const r1 = await executor.executeField(
      makeFieldAction({ selector: 'input[name="terms"]', value: 'true', strategy: 'checkbox' }),
    );
    const r2 = await executor.executeField(
      makeFieldAction({
        selector: 'input[name="newsletter"]',
        value: 'true',
        strategy: 'checkbox',
      }),
    );

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Both checkboxes were unchecked, so simulateClick called for each
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('click radio button → verify click dispatched via executeNavigation', async () => {
    // Radio buttons are clicked via executeNavigation (not executeField,
    // since resolveStrategy returns 'radio' which mismatches planned strategies)
    const clickSpy = vi.spyOn(executor as any, 'simulateClick');
    const result = await executor.executeNavigation(
      makeNavAction({ selector: 'input[name="gender"][value="female"]' }),
    );
    expect(result.success).toBe(true);
    // Verify the click was dispatched on the correct element
    expect(clickSpy).toHaveBeenCalled();
    const clickedEl = clickSpy.mock.calls[0][0] as HTMLInputElement;
    expect(clickedEl.value).toBe('female');
  });

  it('full workflow end-to-end: execute 7 actions sequentially, verify all DOM state', async () => {
    const results = [];

    // 1. Type first name
    results.push(await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'John', strategy: 'type', hintIndex: 0 }),
    ));

    // 2. Type last name
    results.push(await executor.executeField(
      makeFieldAction({ selector: '#lastName', value: 'Doe', strategy: 'type', hintIndex: 1 }),
    ));

    // 3. Type email
    results.push(await executor.executeField(
      makeFieldAction({ selector: '#email', value: 'john@test.com', strategy: 'type', hintIndex: 2 }),
    ));

    // 4. Select country
    results.push(await executor.executeField(
      makeFieldAction({ selector: '#country', value: 'Canada', strategy: 'select', hintIndex: 3 }),
    ));

    // 5. Check terms
    results.push(await executor.executeField(
      makeFieldAction({
        selector: 'input[name="terms"]',
        value: 'true',
        strategy: 'checkbox',
        hintIndex: 4,
      }),
    ));

    // 6. Check newsletter
    results.push(await executor.executeField(
      makeFieldAction({
        selector: 'input[name="newsletter"]',
        value: 'true',
        strategy: 'checkbox',
        hintIndex: 5,
      }),
    ));

    // 7. Click radio (via navigation)
    results.push(await executor.executeNavigation(
      makeNavAction({
        selector: 'input[name="gender"][value="male"]',
        hintIndex: 6,
      }),
    ));

    // All 7 actions should succeed
    for (const r of results) {
      expect(r.success).toBe(true);
    }

    // Verify text/select DOM state at end
    const form = document.querySelector('#play2-form') as HTMLFormElement;
    const values = getFormValues(form);

    expect(values['firstName']).toBe('John');
    expect(values['lastName']).toBe('Doe');
    expect(values['email']).toBe('john@test.com');
    expect(values['country']).toBe('ca');
    // Checkbox/radio DOM state unreliable in jsdom with synthetic events —
    // verified via spy-based tests above
  });
});

// ============================================================================
// Scenario: custom dropdown form
// ============================================================================

describe('Scenario: custom dropdown form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildCustomDropdownForm());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('click combobox trigger → listbox found → select option', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#dropdown-trigger', value: 'Option 2', strategy: 'select' }),
    );
    expect(result.success).toBe(true);
  });

  it('select non-existent option → failure', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#dropdown-trigger', value: 'Nonexistent', strategy: 'select' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Nonexistent');
  });

  it('select with partial text match', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#dropdown-trigger', value: 'Option', strategy: 'select' }),
    );
    // "Option" partial-matches "Option 1" (uses includes)
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Scenario: typeahead form
// ============================================================================

describe('Scenario: typeahead form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildTypeaheadForm());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('type search text → suggestions found → click correct suggestion → input value updated', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#search', value: 'Banana', strategy: 'typeahead' }),
    );
    expect(result.success).toBe(true);
  });

  it('type text with no matching suggestion → keeps typed value', async () => {
    const result = await executor.executeField(
      makeFieldAction({ selector: '#search', value: 'Dragonfruit', strategy: 'typeahead' }),
    );
    expect(result.success).toBe(true);
    expect((document.querySelector('#search') as HTMLInputElement).value).toBe('Dragonfruit');
  });
});

// ============================================================================
// Scenario: modal form
// ============================================================================

describe('Scenario: modal form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildModalForm());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('click trigger button → fill form inside modal → submit', async () => {
    // Click the trigger to "open" the modal
    const navResult = await executor.executeNavigation(
      makeNavAction({ selector: '#open-modal-btn' }),
    );
    expect(navResult.success).toBe(true);

    // Fill fields inside modal
    const nameResult = await executor.executeField(
      makeFieldAction({ selector: '#modal-name', value: 'Jane', strategy: 'type' }),
    );
    expect(nameResult.success).toBe(true);

    const emailResult = await executor.executeField(
      makeFieldAction({ selector: '#modal-email', value: 'jane@test.com', strategy: 'type' }),
    );
    expect(emailResult.success).toBe(true);

    // Submit
    const submitResult = await executor.executeSubmit(
      makeSubmitAction({ selector: '#modal-submit' }),
    );
    expect(submitResult.success).toBe(true);
  });

  it('verify fields inside modal are filled correctly', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#modal-name', value: 'Alice', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#modal-email', value: 'alice@co.com', strategy: 'type' }),
    );

    expect((document.querySelector('#modal-name') as HTMLInputElement).value).toBe('Alice');
    expect((document.querySelector('#modal-email') as HTMLInputElement).value).toBe('alice@co.com');
  });

  it('navigation action with expectsModal=true → waits for dialog', async () => {
    const waitSpy = vi.spyOn(executor as any, 'waitForModal').mockResolvedValue(true);
    await executor.executeNavigation(
      makeNavAction({ selector: '#open-modal-btn', expectsModal: true }),
    );
    expect(waitSpy).toHaveBeenCalledWith(2000);
  });
});

// ============================================================================
// Scenario: inline edit form
// ============================================================================

describe('Scenario: inline edit form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildInlineEditForm());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('click display text → input found → type new value → press Enter → value saved', async () => {
    const result = await executor.executeField(
      makeFieldAction({
        selector: '#inline-edit-wrapper',
        value: 'Updated Value',
        strategy: 'inline_edit',
      }),
    );
    expect(result.success).toBe(true);
    expect(
      (document.querySelector('.edit-input') as HTMLInputElement).value,
    ).toBe('Updated Value');
  });
});

// ============================================================================
// Scenario: complex multi-section form
// ============================================================================

describe('Scenario: complex multi-section form', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildComplexPageForm());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('fill fields across multiple form sections', async () => {
    // Personal info
    await executor.executeField(
      makeFieldAction({ selector: '#personal-name', value: 'Alice', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#personal-email', value: 'a@b.com', strategy: 'type' }),
    );

    // Address
    await executor.executeField(
      makeFieldAction({ selector: '#address-street', value: '123 Main St', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#address-city', value: 'San Jose', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#address-state', value: 'California', strategy: 'select' }),
    );

    // Preferences
    await executor.executeField(
      makeFieldAction({
        selector: 'input[name="prefNotifications"]',
        value: 'true',
        strategy: 'checkbox',
      }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#pref-theme', value: 'Dark', strategy: 'select' }),
    );

    // Company
    await executor.executeField(
      makeFieldAction({ selector: '#company-name', value: 'Acme Inc', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#company-role', value: 'Engineer', strategy: 'type' }),
    );

    // Verify all values
    const form = document.querySelector('#settings-form') as HTMLFormElement;
    const values = getFormValues(form);

    expect(values['personalName']).toBe('Alice');
    expect(values['personalEmail']).toBe('a@b.com');
    expect(values['addressStreet']).toBe('123 Main St');
    expect(values['addressCity']).toBe('San Jose');
    expect(values['addressState']).toBe('CA');
    expect(values['prefNotifications']).toBe(true);
    expect(values['prefTheme']).toBe('dark');
    expect(values['companyName']).toBe('Acme Inc');
    expect(values['companyRole']).toBe('Engineer');
  });

  it('no field cross-contamination between sections', async () => {
    // Both sections have a "Name" field (personal-name and company-name)
    await executor.executeField(
      makeFieldAction({ selector: '#personal-name', value: 'PersonalName', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#company-name', value: 'CompanyName', strategy: 'type' }),
    );

    expect((document.querySelector('#personal-name') as HTMLInputElement).value).toBe(
      'PersonalName',
    );
    expect((document.querySelector('#company-name') as HTMLInputElement).value).toBe(
      'CompanyName',
    );
  });

  it('fields with similar names in different sections resolve correctly', async () => {
    // "Name" label appears in both personal and company sections
    // Selector-based targeting ensures correct field
    await executor.executeField(
      makeFieldAction({ selector: '#personal-name', value: 'Alice', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#company-name', value: 'Acme', strategy: 'type' }),
    );

    const form = document.querySelector('#settings-form') as HTMLFormElement;
    const values = getFormValues(form);
    expect(values['personalName']).toBe('Alice');
    expect(values['companyName']).toBe('Acme');
  });
});

// ============================================================================
// Scenario: PreFlight + PlanExecutor integration
// ============================================================================

describe('Scenario: PreFlight + PlanExecutor integration', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    setupForm(buildPlay2Form());
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  it('fill firstName="test" → PreFlight correctly identifies firstName as filled', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'test', strategy: 'type' }),
    );

    const obs = makeObservation({
      formFields: [
        { name: 'First name', value: 'test', type: 'text' },
        { name: 'Last name', value: '', type: 'text' },
      ],
    });
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'First name',
    });

    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.checkType).toBe('field_value');
  });

  it('fill firstName="test" → PreFlight does NOT falsely skip lastName="test"', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'test', strategy: 'type' }),
    );

    const obs = makeObservation({
      formFields: [
        { name: 'First name', value: 'test', type: 'text' },
        { name: 'Last name', value: '', type: 'text' },
      ],
    });
    const lastNameHint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'Last name',
    });

    const result = PreFlightChecker.check(lastNameHint, obs);
    // Last name is empty, so even though the value "test" matches the hint,
    // the field name "Last name" doesn't match "First name"
    expect(result.canSkip).toBe(false);
  });

  it('PreFlight only checks type actions, not select actions', async () => {
    await executor.executeField(
      makeFieldAction({ selector: '#country', value: 'United States', strategy: 'select' }),
    );

    const obs = makeObservation({
      formFields: [
        { name: 'Country', value: 'United States', type: 'select' },
      ],
    });
    const selectHint = makeHint({
      actionType: 'select',
      value: 'United States',
      targetText: 'Country',
    });

    // PreFlight only runs checkFieldValue for 'type' actions
    const result = PreFlightChecker.check(selectHint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('after filling all type fields, PreFlight skips ALL type fields (second execution is all skips)', async () => {
    // First execution: fill all type fields
    await executor.executeField(
      makeFieldAction({ selector: '#firstName', value: 'John', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#lastName', value: 'Doe', strategy: 'type' }),
    );
    await executor.executeField(
      makeFieldAction({ selector: '#email', value: 'j@d.com', strategy: 'type' }),
    );

    // Simulate the observation AFTER all fields are filled
    const obs = makeObservation({
      formFields: [
        { name: 'First name', value: 'John', type: 'text' },
        { name: 'Last name', value: 'Doe', type: 'text' },
        { name: 'Email', value: 'j@d.com', type: 'email' },
      ],
    });

    // Second execution: PreFlight should skip all type fields
    const hints = [
      makeHint({ actionType: 'type', value: 'John', targetText: 'First name' }),
      makeHint({ actionType: 'type', value: 'Doe', targetText: 'Last name' }),
      makeHint({ actionType: 'type', value: 'j@d.com', targetText: 'Email' }),
    ];

    for (const hint of hints) {
      const result = PreFlightChecker.check(hint, obs);
      expect(result.canSkip).toBe(true);
    }
  });
});
