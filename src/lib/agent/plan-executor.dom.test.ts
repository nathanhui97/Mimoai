import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanExecutor } from './plan-executor';
import {
  makeFieldAction,
  makeNavAction,
  makeSubmitAction,
  setupForm,
  cleanupForm,
} from './__test-fixtures__/form-fixtures';

// ============================================================================
// DOM Form Filling Tests
// ============================================================================

describe('PlanExecutor DOM', () => {
  let executor: PlanExecutor;
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    executor = new PlanExecutor();
    sleepSpy = vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    // jsdom doesn't implement scrollIntoView — mock it on the prototype
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  // ── executeField — type strategy ─────────────────────────────────

  describe('executeField — type strategy', () => {
    it('types value into text input by CSS selector', async () => {
      setupForm('<input id="name" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#name', value: 'John', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#name') as HTMLInputElement).value).toBe('John');
    });

    it('types value into text input by elementIndex fallback (when selector fails)', async () => {
      setupForm('<input id="first" type="text" /><input id="second" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '#nonexistent',
          elementIndex: 1,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#second') as HTMLInputElement).value).toBe('test');
    });

    it('clears existing value when clearFirst=true', async () => {
      setupForm('<input id="name" type="text" value="old" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#name', value: 'new', strategy: 'type', clearFirst: true }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#name') as HTMLInputElement).value).toBe('new');
    });

    it('auto-clears existing value even when clearFirst is not set', async () => {
      // The implementation clears whenever input.value is truthy (clearFirst || input.value)
      setupForm('<input id="name" type="text" value="old" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#name', value: 'new', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#name') as HTMLInputElement).value).toBe('new');
    });

    it('fires input, change, blur events (verified via listeners)', async () => {
      setupForm('<input id="name" type="text" />');
      const input = document.querySelector('#name') as HTMLInputElement;

      const inputFn = vi.fn();
      const changeFn = vi.fn();
      const blurFn = vi.fn();
      input.addEventListener('input', inputFn);
      input.addEventListener('change', changeFn);
      input.addEventListener('blur', blurFn);

      await executor.executeField(
        makeFieldAction({ selector: '#name', value: 'hi', strategy: 'type' }),
      );

      expect(inputFn).toHaveBeenCalled();
      expect(changeFn).toHaveBeenCalled();
      expect(blurFn).toHaveBeenCalled();
    });

    it('returns success:true on successful fill', async () => {
      setupForm('<input id="name" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#name', value: 'test', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect(result.hintIndex).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns success:false when element not found (bad selector + bad index)', async () => {
      setupForm('<div>no inputs</div>');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '#nonexistent',
          elementIndex: 999,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('types into <textarea> element', async () => {
      setupForm('<textarea id="bio"></textarea>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#bio', value: 'Hello world', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#bio') as HTMLTextAreaElement).value).toBe('Hello world');
    });

    it('types into <input type="email">', async () => {
      setupForm('<input id="email" type="email" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#email', value: 'a@b.com', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#email') as HTMLInputElement).value).toBe('a@b.com');
    });

    it('types into <input type="password">', async () => {
      setupForm('<input id="pw" type="password" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#pw', value: 'secret', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#pw') as HTMLInputElement).value).toBe('secret');
    });
  });

  // ── executeField — select strategy on native <select> ────────────

  describe('executeField — select strategy on native <select>', () => {
    it('selects option by text match', async () => {
      setupForm(`
        <select id="color">
          <option value="">Pick</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#color', value: 'Green', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#color') as HTMLSelectElement).value).toBe('g');
    });

    it('selects option by value match', async () => {
      setupForm(`
        <select id="color">
          <option value="">Pick</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#color', value: 'r', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#color') as HTMLSelectElement).value).toBe('r');
    });

    it('fires change event on selection', async () => {
      setupForm(`
        <select id="color">
          <option value="">Pick</option>
          <option value="r">Red</option>
        </select>
      `);
      const changeFn = vi.fn();
      document.querySelector('#color')!.addEventListener('change', changeFn);

      await executor.executeField(
        makeFieldAction({ selector: '#color', value: 'Red', strategy: 'select' }),
      );
      expect(changeFn).toHaveBeenCalledTimes(1);
    });

    it('returns failure when option text not found', async () => {
      setupForm(`
        <select id="color">
          <option value="">Pick</option>
          <option value="r">Red</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#color', value: 'Purple', strategy: 'select' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Purple');
    });

    it('handles <select> with optgroups', async () => {
      setupForm(`
        <select id="car">
          <optgroup label="Swedish">
            <option value="volvo">Volvo</option>
          </optgroup>
          <optgroup label="German">
            <option value="bmw">BMW</option>
            <option value="audi">Audi</option>
          </optgroup>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#car', value: 'BMW', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#car') as HTMLSelectElement).value).toBe('bmw');
    });

    it('handles <select multiple> — sets selected option', async () => {
      setupForm(`
        <select id="langs" multiple>
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#langs', value: 'French', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#langs') as HTMLSelectElement).value).toBe('fr');
    });
  });

  // ── executeField — select strategy on custom dropdown ────────────

  describe('executeField — select strategy on custom dropdown', () => {
    it('clicks trigger → finds listbox → clicks matching option', async () => {
      setupForm(`
        <div role="combobox" id="trigger">Pick</div>
        <ul role="listbox" id="listbox">
          <li role="option">Alpha</li>
          <li role="option">Beta</li>
          <li role="option">Gamma</li>
        </ul>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'Beta', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
    });

    it('handles [role="listbox"] with [role="option"] items', async () => {
      setupForm(`
        <button role="combobox" id="dd-trigger">Choose</button>
        <div role="listbox">
          <div role="option">Option A</div>
          <div role="option">Option B</div>
        </div>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#dd-trigger', value: 'Option A', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
    });

    it('handles .dropdown-menu with .dropdown-item items', async () => {
      setupForm(`
        <button id="menu-trigger">Menu</button>
        <div class="dropdown-menu">
          <div class="dropdown-item">Item 1</div>
          <div class="dropdown-item">Item 2</div>
        </div>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#menu-trigger', value: 'Item 2', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
    });

    it('returns failure when dropdown does not open (no listbox appears)', async () => {
      setupForm('<button id="trigger">Pick</button>');
      // Mock waitForElement to return null (no listbox found)
      vi.spyOn(executor as any, 'waitForElement').mockResolvedValue(null);

      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'Opt', strategy: 'select' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dropdown did not open');
    });

    it('returns failure when matching option not found in dropdown', async () => {
      setupForm(`
        <button id="trigger">Pick</button>
        <ul role="listbox">
          <li role="option">Alpha</li>
          <li role="option">Beta</li>
        </ul>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'Nonexistent', strategy: 'select' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nonexistent');
    });

    it('partial text match: "Option" matches "Option 1" (uses includes)', async () => {
      setupForm(`
        <button id="trigger">Pick</button>
        <ul role="listbox">
          <li role="option">Option 1</li>
          <li role="option">Something else</li>
        </ul>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'Option', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ── executeField — checkbox strategy ─────────────────────────────

  describe('executeField — checkbox strategy', () => {
    it('checks unchecked checkbox → calls simulateClick', async () => {
      setupForm('<input id="terms" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#terms', value: 'true', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(true);
      // Checkbox was unchecked, shouldBeChecked=true → click needed
      expect(clickSpy).toHaveBeenCalled();
    });

    it('does not toggle already-checked checkbox when value=true', async () => {
      setupForm('<input id="terms" type="checkbox" checked />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#terms', value: 'true', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(true);
      // Checkbox already checked, shouldBeChecked=true → no click needed
      expect(clickSpy).not.toHaveBeenCalled();
      expect((document.querySelector('#terms') as HTMLInputElement).checked).toBe(true);
    });

    it('unchecks checked checkbox when value=false → calls simulateClick', async () => {
      setupForm('<input id="terms" type="checkbox" checked />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#terms', value: 'false', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(true);
      // Checkbox was checked, shouldBeChecked=false → click needed
      expect(clickSpy).toHaveBeenCalled();
    });

    it('handles "checked" as truthy value (same as "true")', async () => {
      setupForm('<input id="terms" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#terms', value: 'checked', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // ── executeField — typeahead strategy ────────────────────────────

  describe('executeField — typeahead strategy', () => {
    it('types search text → waits for suggestions → clicks matching suggestion', async () => {
      setupForm(`
        <input id="search" type="text" />
        <ul class="suggestions">
          <li class="suggestion-item">Apple</li>
          <li class="suggestion-item">Banana</li>
        </ul>
      `);

      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#search', value: 'Apple', strategy: 'typeahead' }),
      );
      expect(result.success).toBe(true);
      // Should have clicked the matching suggestion
      expect(clickSpy).toHaveBeenCalled();
    });

    it('falls back to keeping typed value when no suggestions appear', async () => {
      setupForm('<input id="search" type="text" />');
      // No suggestions container in DOM; mock waitForElement to fail
      vi.spyOn(executor as any, 'waitForElement').mockResolvedValue(null);

      const result = await executor.executeField(
        makeFieldAction({ selector: '#search', value: 'query', strategy: 'typeahead' }),
      );
      expect(result.success).toBe(true);
      const input = document.querySelector('#search') as HTMLInputElement;
      expect(input.value).toBe('query');
    });

    it('falls back to keeping typed value when no matching suggestion found', async () => {
      setupForm(`
        <input id="search" type="text" />
        <ul class="suggestions">
          <li class="suggestion-item">Alpha</li>
          <li class="suggestion-item">Beta</li>
        </ul>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#search', value: 'Nonexistent', strategy: 'typeahead' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#search') as HTMLInputElement).value).toBe('Nonexistent');
    });

    it('matches using optionText when provided (separate from search value)', async () => {
      setupForm(`
        <input id="search" type="text" />
        <ul class="suggestions">
          <li class="suggestion-item">John Doe (john@example.com)</li>
          <li class="suggestion-item">Jane Smith (jane@example.com)</li>
        </ul>
      `);
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '#search',
          value: 'John',
          strategy: 'typeahead',
          optionText: 'John Doe',
        }),
      );
      expect(result.success).toBe(true);
      // Should click the suggestion matching optionText, not the typed value
      const clickedEl = clickSpy.mock.calls.find(
        call => (call[0] as Element).textContent?.includes('John Doe'),
      );
      expect(clickedEl).toBeTruthy();
    });
  });

  // ── executeField — inline_edit strategy ──────────────────────────

  describe('executeField — inline_edit strategy', () => {
    it('clicks element → finds child input → types value → presses Enter', async () => {
      setupForm(`
        <div id="edit-wrapper">
          <span class="display">Old text</span>
          <input type="text" class="editor" value="Old text" />
        </div>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#edit-wrapper', value: 'New text', strategy: 'inline_edit' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('.editor') as HTMLInputElement).value).toBe('New text');
    });

    it('returns failure when no input appears after click', async () => {
      setupForm('<div id="no-input"><span>Text only</span></div>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#no-input', value: 'test', strategy: 'inline_edit' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('inline edit');
    });
  });

  // ── executeField — date_picker strategy ──────────────────────────

  describe('executeField — date_picker strategy', () => {
    it('falls back to typing date string into input (clearFirst=true)', async () => {
      setupForm('<input id="date" type="text" value="2024-01-01" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#date', value: '2025-06-15', strategy: 'date_picker' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#date') as HTMLInputElement).value).toBe('2025-06-15');
    });
  });

  // ── executeField — strategy mismatch rejection ───────────────────

  describe('executeField — strategy mismatch rejection', () => {
    it('planned checkbox on <select> → returns success:false with "Strategy mismatch"', async () => {
      setupForm('<select id="sel"><option>A</option></select>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#sel', value: 'true', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Strategy mismatch');
    });

    it('planned type on <select> → returns success:false', async () => {
      setupForm('<select id="sel"><option>A</option></select>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#sel', value: 'text', strategy: 'type' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Strategy mismatch');
    });

    it('planned checkbox on <input type="radio"> → returns success:false', async () => {
      setupForm('<input id="rad" type="radio" name="g" value="a" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#rad', value: 'true', strategy: 'checkbox' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Strategy mismatch');
    });

    it('planned select on <textarea> → returns success:false', async () => {
      setupForm('<textarea id="ta"></textarea>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#ta', value: 'Option A', strategy: 'select' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Strategy mismatch');
    });
  });

  // ── executeNavigation ────────────────────────────────────────────

  describe('executeNavigation', () => {
    it('clicks target element by selector', async () => {
      setupForm('<button id="nav-btn">Go</button>');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeNavigation(
        makeNavAction({ selector: '#nav-btn' }),
      );
      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    });

    it('scrolls element into view before clicking', async () => {
      setupForm('<button id="nav-btn">Go</button>');
      const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
      await executor.executeNavigation(makeNavAction({ selector: '#nav-btn' }));
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'instant', block: 'center' });
    });

    it('waits 500ms if expectsNavigation=true', async () => {
      setupForm('<a id="link" href="/page">Page</a>');
      await executor.executeNavigation(
        makeNavAction({ selector: '#link', expectsNavigation: true }),
      );
      // sleep is called for: scroll wait (50ms), navigation wait (500ms)
      expect(sleepSpy).toHaveBeenCalledWith(500);
    });

    it('waits for modal if expectsModal=true', async () => {
      setupForm('<button id="btn">Open</button><div role="dialog">Modal</div>');
      const waitSpy = vi.spyOn(executor as any, 'waitForModal').mockResolvedValue(true);
      await executor.executeNavigation(
        makeNavAction({ selector: '#btn', expectsModal: true }),
      );
      expect(waitSpy).toHaveBeenCalledWith(2000);
    });

    it('returns failure when element not found', async () => {
      setupForm('<div>nothing</div>');
      const result = await executor.executeNavigation(
        makeNavAction({ selector: '#missing', elementIndex: 999 }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });
  });

  // ── executeSubmit ────────────────────────────────────────────────

  describe('executeSubmit', () => {
    it('clicks submit button', async () => {
      setupForm('<button id="submit-btn" type="submit">Save</button>');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeSubmit(
        makeSubmitAction({ selector: '#submit-btn' }),
      );
      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    });

    it('waits for configurable waitAfterMs', async () => {
      setupForm('<button id="submit-btn" type="submit">Save</button>');
      await executor.executeSubmit(
        makeSubmitAction({ selector: '#submit-btn', waitAfterMs: 1000 }),
      );
      expect(sleepSpy).toHaveBeenCalledWith(1000);
    });

    it('returns failure when button not found', async () => {
      setupForm('<div>no button</div>');
      const result = await executor.executeSubmit(
        makeSubmitAction({ selector: '#missing', elementIndex: 999 }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Submit button not found');
    });
  });
});
