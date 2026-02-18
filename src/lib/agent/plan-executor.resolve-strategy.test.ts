import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanExecutor } from './plan-executor';

// ============================================================================
// resolveStrategy — Strategy Detection
// ============================================================================

describe('resolveStrategy', () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // Helper to call private resolveStrategy
  function resolve(element: Element, plannedStrategy: string): string {
    return (executor as any).resolveStrategy(element, plannedStrategy);
  }

  // ── select elements ──────────────────────────────────────────────

  describe('select elements', () => {
    it('<select> + planned checkbox → returns select', () => {
      const el = document.createElement('select');
      expect(resolve(el, 'checkbox')).toBe('select');
    });

    it('<select> + planned type → returns select', () => {
      const el = document.createElement('select');
      expect(resolve(el, 'type')).toBe('select');
    });

    it('<select> + planned click → returns select', () => {
      const el = document.createElement('select');
      expect(resolve(el, 'click')).toBe('select');
    });

    it('<select> + planned select → returns select (no mismatch)', () => {
      const el = document.createElement('select');
      expect(resolve(el, 'select')).toBe('select');
    });

    it('<select multiple> + planned checkbox → returns select', () => {
      const el = document.createElement('select');
      el.setAttribute('multiple', '');
      expect(resolve(el, 'checkbox')).toBe('select');
    });
  });

  // ── radio inputs ─────────────────────────────────────────────────

  describe('radio inputs', () => {
    it('<input type="radio"> + planned checkbox → returns radio', () => {
      const el = document.createElement('input');
      el.type = 'radio';
      expect(resolve(el, 'checkbox')).toBe('radio');
    });

    it('<input type="radio"> + planned type → returns radio', () => {
      const el = document.createElement('input');
      el.type = 'radio';
      expect(resolve(el, 'type')).toBe('radio');
    });

    it('<input type="radio"> + planned click → returns radio (mismatch)', () => {
      const el = document.createElement('input');
      el.type = 'radio';
      expect(resolve(el, 'click')).toBe('radio');
    });
  });

  // ── checkbox inputs ──────────────────────────────────────────────

  describe('checkbox inputs', () => {
    it('<input type="checkbox"> + planned checkbox → returns checkbox (match)', () => {
      const el = document.createElement('input');
      el.type = 'checkbox';
      expect(resolve(el, 'checkbox')).toBe('checkbox');
    });

    it('<input type="checkbox"> + planned type → returns checkbox', () => {
      const el = document.createElement('input');
      el.type = 'checkbox';
      expect(resolve(el, 'type')).toBe('checkbox');
    });

    it('<input type="checkbox"> + planned click → returns checkbox', () => {
      const el = document.createElement('input');
      el.type = 'checkbox';
      expect(resolve(el, 'click')).toBe('checkbox');
    });
  });

  // ── text-like inputs ─────────────────────────────────────────────

  describe('text-like inputs', () => {
    it('<input type="text"> + planned checkbox → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'text';
      expect(resolve(el, 'checkbox')).toBe('type');
    });

    it('<input type="text"> + planned radio → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'text';
      expect(resolve(el, 'radio')).toBe('type');
    });

    it('<input type="text"> + planned typeahead → preserved (valid for text)', () => {
      const el = document.createElement('input');
      el.type = 'text';
      expect(resolve(el, 'typeahead')).toBe('typeahead');
    });

    it('<input type="text"> + planned date_picker → preserved', () => {
      const el = document.createElement('input');
      el.type = 'text';
      expect(resolve(el, 'date_picker')).toBe('date_picker');
    });

    it('<input type="email"> + planned checkbox → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'email';
      expect(resolve(el, 'checkbox')).toBe('type');
    });

    it('<input type="tel"> + planned radio → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'tel';
      expect(resolve(el, 'radio')).toBe('type');
    });

    it('<input type="number"> + planned checkbox → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'number';
      expect(resolve(el, 'checkbox')).toBe('type');
    });

    it('<input type="password"> + planned checkbox → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'password';
      expect(resolve(el, 'checkbox')).toBe('type');
    });

    it('<input type="search"> + planned radio → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'search';
      expect(resolve(el, 'radio')).toBe('type');
    });

    it('<input type="url"> + planned radio → corrected to type', () => {
      const el = document.createElement('input');
      el.type = 'url';
      expect(resolve(el, 'radio')).toBe('type');
    });
  });

  // ── textarea ─────────────────────────────────────────────────────

  describe('textarea', () => {
    it('<textarea> + planned select → corrected to type', () => {
      const el = document.createElement('textarea');
      expect(resolve(el, 'select')).toBe('type');
    });

    it('<textarea> + planned checkbox → corrected to type', () => {
      const el = document.createElement('textarea');
      expect(resolve(el, 'checkbox')).toBe('type');
    });

    it('<textarea> + planned type → returns type (match)', () => {
      const el = document.createElement('textarea');
      expect(resolve(el, 'type')).toBe('type');
    });
  });

  // ── other elements — passthrough ─────────────────────────────────

  describe('other elements — passthrough', () => {
    it('<div role="button"> + planned click → click (passthrough)', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'button');
      expect(resolve(el, 'click')).toBe('click');
    });

    it('<span> + planned inline_edit → inline_edit (passthrough)', () => {
      const el = document.createElement('span');
      expect(resolve(el, 'inline_edit')).toBe('inline_edit');
    });

    it('<a> + planned click → click (passthrough)', () => {
      const el = document.createElement('a');
      expect(resolve(el, 'click')).toBe('click');
    });
  });
});
