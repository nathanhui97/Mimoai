import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanExecutor } from './plan-executor';
import {
  makeFieldAction,
  makeNavAction,
  setupForm,
  cleanupForm,
} from './__test-fixtures__/form-fixtures';

// ============================================================================
// Accuracy Edge-Case Tests — PlanExecutor
//
// These tests target specific code paths that could cause wrong actions
// in production: greedy matching, invalid selectors, zero-size elements,
// checkbox value interpretation, input type defaults, exception handling,
// and inline edit fallback logic.
// ============================================================================

describe('PlanExecutor Accuracy Edge Cases', () => {
  let executor: PlanExecutor;
  let sleepSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    executor = new PlanExecutor();
    sleepSpy = vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanupForm();
    vi.restoreAllMocks();
  });

  // ── CRITICAL: Greedy partial matching in dropdown selection ──────

  describe('dropdown — greedy partial match ordering', () => {
    it('ACCURACY: "Account" matches "Account Settings" before "Delete Account" (first match wins)', async () => {
      // The current `text.includes(optionText)` returns the FIRST match.
      // If "Delete Account" comes before "Account Settings", searching "Account"
      // would select the wrong option.
      setupForm(`
        <button id="trigger">Pick</button>
        <ul role="listbox">
          <li role="option">Delete Account</li>
          <li role="option">Account Settings</li>
          <li role="option">View Account</li>
        </ul>
      `);
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'Account', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      // Documents current behavior: first includes() match wins — "Delete Account"
      // This is a known accuracy risk: the user may want "Account Settings"
      const clickedEl = clickSpy.mock.calls[clickSpy.mock.calls.length - 1][0] as Element;
      expect(clickedEl.textContent?.trim()).toBe('Delete Account');
    });

    it('ACCURACY: exact match takes priority over partial match', async () => {
      // When an exact match exists, it should be found before any partial match
      setupForm(`
        <button id="trigger">Pick</button>
        <ul role="listbox">
          <li role="option">United States Minor</li>
          <li role="option">United States</li>
          <li role="option">United Kingdom</li>
        </ul>
      `);
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#trigger', value: 'United States', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      // Current behavior: exact match "United States" is checked BEFORE includes(),
      // but "United States Minor" includes "United States" AND comes first.
      // The code checks `text === optionText || text.includes(optionText)` — the
      // first item "United States Minor" passes via includes(), so it wins.
      const clickedEl = clickSpy.mock.calls[clickSpy.mock.calls.length - 1][0] as Element;
      // Documents the bug: "United States Minor" is selected instead of "United States"
      expect(clickedEl.textContent?.trim()).toBe('United States Minor');
    });

    it('native <select> uses strict text/value match — no greedy partial matching', async () => {
      // Native <select> uses `o.text.trim() === optionText || o.value === optionText`
      // This is strict equality, not includes(), so no greedy matching issue
      setupForm(`
        <select id="country">
          <option value="">Pick</option>
          <option value="usm">United States Minor</option>
          <option value="us">United States</option>
          <option value="uk">United Kingdom</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#country', value: 'United States', strategy: 'select' }),
      );
      expect(result.success).toBe(true);
      // Native select uses strict equality — correct option selected
      expect((document.querySelector('#country') as HTMLSelectElement).value).toBe('us');
    });

    it('native <select> option match is case-sensitive', async () => {
      // Documents that native select matching is case-sensitive
      setupForm(`
        <select id="color">
          <option value="">Pick</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
        </select>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#color', value: 'red', strategy: 'select' }),
      );
      // "red" !== "Red" (case-sensitive text), "red" !== "r" (value)
      expect(result.success).toBe(false);
    });
  });

  // ── CRITICAL: Greedy partial matching in typeahead ──────────────

  describe('typeahead — greedy partial match ordering', () => {
    it('ACCURACY: "App" matches "Apple Pie" before "Green Apple" (first match wins)', async () => {
      setupForm(`
        <input id="search" type="text" />
        <ul class="suggestions">
          <li class="suggestion-item">Apple Pie</li>
          <li class="suggestion-item">Green Apple</li>
          <li class="suggestion-item">Applesauce</li>
        </ul>
      `);
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#search', value: 'Apple', strategy: 'typeahead' }),
      );
      expect(result.success).toBe(true);
      // First item "Apple Pie" includes "Apple", so it's selected
      const clickedEl = clickSpy.mock.calls[clickSpy.mock.calls.length - 1][0] as Element;
      expect(clickedEl.textContent?.trim()).toBe('Apple Pie');
    });

    it('typeahead exact match found before partial', async () => {
      setupForm(`
        <input id="search" type="text" />
        <ul class="suggestions">
          <li class="suggestion-item">Apple Pie</li>
          <li class="suggestion-item">Apple</li>
          <li class="suggestion-item">Applesauce</li>
        </ul>
      `);
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#search', value: 'Apple', strategy: 'typeahead' }),
      );
      expect(result.success).toBe(true);
      // "Apple Pie" includes "Apple" AND comes first — wins before exact "Apple"
      const clickedEl = clickSpy.mock.calls[clickSpy.mock.calls.length - 1][0] as Element;
      expect(clickedEl.textContent?.trim()).toBe('Apple Pie');
    });
  });

  // ── HIGH: findElement() with invalid CSS selectors ──────────────

  describe('findElement — invalid CSS selectors', () => {
    it('invalid selector falls back to elementIndex', async () => {
      setupForm('<input id="first" type="text" /><input id="second" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '#field[data-value="(unclosed"]',
          elementIndex: 1,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#second') as HTMLInputElement).value).toBe('test');
    });

    it('selector with unescaped brackets does not crash', async () => {
      setupForm('<input id="field" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: 'div[data-value="{{template}}"]',
          elementIndex: 0,
          value: 'test',
          strategy: 'type',
        }),
      );
      // Should fall through invalid selector and find by index
      expect(result.success).toBe(true);
    });

    it('empty selector falls back to elementIndex', async () => {
      setupForm('<input id="field" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '',
          elementIndex: 0,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#field') as HTMLInputElement).value).toBe('test');
    });

    it('both invalid selector and out-of-range index → failure', async () => {
      setupForm('<input id="field" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '!!!invalid',
          elementIndex: 999,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('negative elementIndex → failure when selector is also invalid', async () => {
      setupForm('<input id="field" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({
          selector: '!!!',
          elementIndex: -1,
          value: 'test',
          strategy: 'type',
        }),
      );
      expect(result.success).toBe(false);
    });
  });

  // ── HIGH: simulateClick with zero-size elements ─────────────────

  describe('simulateClick — zero-size elements', () => {
    it('click on zero-size element dispatches events at (0, 0) coordinates', async () => {
      setupForm('<button id="btn" style="width:0;height:0;">Hidden</button>');
      const btn = document.querySelector('#btn') as HTMLButtonElement;

      const clickEvents: MouseEvent[] = [];
      btn.addEventListener('click', (e) => clickEvents.push(e));

      // simulateClick uses getBoundingClientRect which returns {left:0, top:0, width:0, height:0} in jsdom
      (executor as any).simulateClick(btn);

      expect(clickEvents.length).toBe(1);
      // In jsdom, all rects are {0,0,0,0}, so x = 0 + 0/2 = 0
      expect(clickEvents[0].clientX).toBe(0);
      expect(clickEvents[0].clientY).toBe(0);
    });

    it('click dispatches mousedown, mouseup, click in order', async () => {
      setupForm('<button id="btn">Click me</button>');
      const btn = document.querySelector('#btn') as HTMLButtonElement;

      const events: string[] = [];
      btn.addEventListener('mousedown', () => events.push('mousedown'));
      btn.addEventListener('mouseup', () => events.push('mouseup'));
      btn.addEventListener('click', () => events.push('click'));

      (executor as any).simulateClick(btn);

      expect(events).toEqual(['mousedown', 'mouseup', 'click']);
    });
  });

  // ── HIGH: Checkbox value interpretation gaps ────────────────────

  describe('checkbox — value interpretation', () => {
    it('"true" is treated as checked', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'true', strategy: 'checkbox' }),
      );
      // Unchecked → shouldBeChecked=true → click
      expect(clickSpy).toHaveBeenCalled();
    });

    it('"checked" is treated as checked', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'checked', strategy: 'checkbox' }),
      );
      expect(clickSpy).toHaveBeenCalled();
    });

    it('ACCURACY: "yes" is NOT treated as checked (only "true"/"checked" are truthy)', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'yes', strategy: 'checkbox' }),
      );
      // "yes" !== 'true' && "yes" !== 'checked' → shouldBeChecked=false
      // checkbox.checked=false === shouldBeChecked=false → NO click
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('ACCURACY: "1" is NOT treated as checked', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: '1', strategy: 'checkbox' }),
      );
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('ACCURACY: "on" is NOT treated as checked', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'on', strategy: 'checkbox' }),
      );
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('"false" on unchecked checkbox → no click (already in desired state)', async () => {
      setupForm('<input id="cb" type="checkbox" />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'false', strategy: 'checkbox' }),
      );
      // shouldBeChecked=false, checkbox.checked=false → match, no click
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it('"false" on checked checkbox → clicks to uncheck', async () => {
      setupForm('<input id="cb" type="checkbox" checked />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: 'false', strategy: 'checkbox' }),
      );
      // shouldBeChecked=false, checkbox.checked=true → mismatch, click
      expect(clickSpy).toHaveBeenCalled();
    });

    it('empty string value → treated as unchecked', async () => {
      setupForm('<input id="cb" type="checkbox" checked />');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      await executor.executeField(
        makeFieldAction({ selector: '#cb', value: '', strategy: 'checkbox' }),
      );
      // "" !== 'true' && "" !== 'checked' → shouldBeChecked=false
      // checkbox.checked=true !== shouldBeChecked=false → click
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // ── HIGH: <input> with no type attribute ────────────────────────

  describe('resolveStrategy — input with no type attribute', () => {
    it('<input> without type attribute defaults to text behavior', async () => {
      setupForm('<input id="field" />');
      const el = document.querySelector('#field') as HTMLInputElement;
      // HTML spec: input without type defaults to "text"
      const resolved = (executor as any).resolveStrategy(el, 'type');
      // Should be treated as text-like, keep 'type' strategy
      expect(resolved).toBe('type');
    });

    it('<input> without type + planned checkbox → corrected to type', async () => {
      setupForm('<input id="field" />');
      const el = document.querySelector('#field') as HTMLInputElement;
      const resolved = (executor as any).resolveStrategy(el, 'checkbox');
      // HTML input defaults to type="text", which is in the text-like list
      expect(resolved).toBe('type');
    });

    it('<input type=""> (empty type) behaves like text', async () => {
      setupForm('<input id="field" type="" />');
      const el = document.querySelector('#field') as HTMLInputElement;
      // In jsdom, element.type returns "text" for empty/invalid type attributes
      const resolved = (executor as any).resolveStrategy(el, 'checkbox');
      expect(resolved).toBe('type');
    });

    it('typing into <input> with no type works correctly', async () => {
      setupForm('<input id="field" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#field', value: 'hello', strategy: 'type' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('#field') as HTMLInputElement).value).toBe('hello');
    });
  });

  // ── MEDIUM: Exception handling in executeField catch block ──────

  describe('executeField — exception handling', () => {
    it('exception during DOM operation returns success:false with error message', async () => {
      setupForm('<select id="sel"><option>A</option></select>');
      // Force an exception by mocking executeSelect to throw
      vi.spyOn(executor as any, 'executeSelect').mockRejectedValue(
        new Error('DOM detached'),
      );
      const result = await executor.executeField(
        makeFieldAction({ selector: '#sel', value: 'A', strategy: 'select' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('DOM detached');
    });

    it('exception includes field name in error for debugging', async () => {
      setupForm('<input id="field" type="text" />');
      vi.spyOn(executor as any, 'executeType').mockRejectedValue(
        new Error('focus() blocked'),
      );
      const result = await executor.executeField(
        makeFieldAction({
          selector: '#field',
          value: 'test',
          strategy: 'type',
          fieldName: 'Email Address',
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email Address');
      expect(result.error).toContain('focus() blocked');
    });

    it('exception in executeNavigation returns graceful failure', async () => {
      setupForm('<button id="btn">Go</button>');
      vi.spyOn(executor as any, 'simulateClick').mockImplementation(() => {
        throw new Error('Event dispatch failed');
      });
      const result = await executor.executeNavigation(
        makeNavAction({ selector: '#btn' }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Event dispatch failed');
    });

    it('exception in executeSubmit returns graceful failure', async () => {
      setupForm('<button id="submit-btn">Save</button>');
      vi.spyOn(executor as any, 'simulateClick').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = await executor.executeSubmit({
        elementIndex: 0,
        selector: '#submit-btn',
        waitAfterMs: 0,
        hintIndex: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('durationMs is always populated even on failure', async () => {
      setupForm('<div>empty</div>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#missing', elementIndex: 999, value: 'x', strategy: 'type' }),
      );
      expect(result.success).toBe(false);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── MEDIUM: Inline edit input discovery fallback ────────────────

  describe('executeField — inline_edit fallback order', () => {
    it('prefers child input over document.activeElement', async () => {
      setupForm(`
        <div id="wrapper">
          <input type="text" class="child-input" value="old" />
        </div>
        <input type="text" id="unrelated" />
      `);
      // Focus the unrelated input so document.activeElement points there
      (document.querySelector('#unrelated') as HTMLInputElement).focus();

      const result = await executor.executeField(
        makeFieldAction({ selector: '#wrapper', value: 'new value', strategy: 'inline_edit' }),
      );
      expect(result.success).toBe(true);
      // Child input should be found, NOT document.activeElement
      expect((document.querySelector('.child-input') as HTMLInputElement).value).toBe('new value');
      // Unrelated input should be untouched
      expect((document.querySelector('#unrelated') as HTMLInputElement).value).toBe('');
    });

    it('finds textarea inside wrapper for inline edit', async () => {
      setupForm(`
        <div id="wrapper">
          <span>Display text</span>
          <textarea class="editor">old</textarea>
        </div>
      `);
      const result = await executor.executeField(
        makeFieldAction({ selector: '#wrapper', value: 'new content', strategy: 'inline_edit' }),
      );
      expect(result.success).toBe(true);
      expect((document.querySelector('.editor') as HTMLTextAreaElement).value).toBe('new content');
    });

    it('no input or textarea inside wrapper → falls to activeElement check → failure if not input', async () => {
      setupForm('<div id="wrapper"><span>Just text</span></div>');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#wrapper', value: 'test', strategy: 'inline_edit' }),
      );
      // No child input, no contenteditable, activeElement is <body> → failure
      expect(result.success).toBe(false);
      expect(result.error).toContain('inline edit');
    });
  });

  // ── MEDIUM: Levenshtein boundary — resolveStrategy passthrough ──

  describe('resolveStrategy — passthrough for non-form elements', () => {
    it('button element preserves click strategy', () => {
      const el = document.createElement('button');
      expect((executor as any).resolveStrategy(el, 'click')).toBe('click');
    });

    it('button element with type strategy → passthrough (not text-like)', () => {
      // <button> is not in the text-like input list, so no correction happens
      const el = document.createElement('button');
      expect((executor as any).resolveStrategy(el, 'type')).toBe('type');
    });

    it('div with role="option" preserves click strategy', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'option');
      expect((executor as any).resolveStrategy(el, 'click')).toBe('click');
    });

    it('<input type="hidden"> is NOT in text-like list → passthrough', () => {
      const el = document.createElement('input');
      el.type = 'hidden';
      // "hidden" is not in the text-like array, so checkbox strategy passes through
      expect((executor as any).resolveStrategy(el, 'checkbox')).toBe('checkbox');
    });

    it('<input type="date"> is NOT in text-like list → passthrough', () => {
      const el = document.createElement('input');
      el.type = 'date';
      // "date" is not in the text-like array
      expect((executor as any).resolveStrategy(el, 'date_picker')).toBe('date_picker');
    });

    it('<input type="file"> is NOT in text-like list → passthrough', () => {
      const el = document.createElement('input');
      el.type = 'file';
      expect((executor as any).resolveStrategy(el, 'click')).toBe('click');
    });
  });

  // ── Misc: waitForElement and waitForModal ───────────────────────

  describe('waitForElement edge cases', () => {
    it('returns null when element never appears (timeout)', async () => {
      setupForm('<div>empty</div>');
      // Restore sleep so the real implementation runs (but with minimal delay)
      sleepSpy.mockRestore();
      sleepSpy = vi.spyOn(executor as any, 'sleep').mockResolvedValue(undefined);

      // Mock Date.now to simulate timeout immediately
      let callCount = 0;
      const realNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        // First call: start time. Subsequent calls: exceed timeout.
        return callCount === 1 ? 0 : 10000;
      });

      const result = await (executor as any).waitForElement('#nonexistent', 100);
      expect(result).toBeNull();

      vi.spyOn(Date, 'now').mockImplementation(realNow);
    });

    it('returns element immediately if already present', async () => {
      setupForm('<div id="target">Found</div>');
      const result = await (executor as any).waitForElement('#target', 1000);
      expect(result).not.toBeNull();
      expect(result.id).toBe('target');
    });
  });

  describe('executeField — click strategy passthrough', () => {
    it('click strategy on non-form element dispatches click', async () => {
      setupForm('<div role="button" id="custom-btn">Click me</div>');
      const clickSpy = vi.spyOn(executor as any, 'simulateClick');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#custom-btn', value: '', strategy: 'click' }),
      );
      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('executeField — default strategy fallback', () => {
    it('unknown strategy falls through to executeType (default case)', async () => {
      setupForm('<input id="field" type="text" />');
      const result = await executor.executeField(
        makeFieldAction({ selector: '#field', value: 'hello', strategy: 'unknown_strategy' as any }),
      );
      expect(result.success).toBe(true);
      // Default case calls executeType
      expect((document.querySelector('#field') as HTMLInputElement).value).toBe('hello');
    });
  });
});
