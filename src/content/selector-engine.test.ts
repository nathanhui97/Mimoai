/**
 * Unit tests for SelectorEngine
 * 
 * Tests selector stability detection, ID validation, and fragility scoring.
 */

import { describe, test, expect } from 'vitest';
import { SelectorEngine } from './selector-engine';

describe('SelectorEngine.isUnsafeId', () => {
  describe('should reject unsafe IDs', () => {
    test('rejects long numeric IDs', () => {
      expect(SelectorEngine.isUnsafeId('12345')).toBe(true);
      expect(SelectorEngine.isUnsafeId('987654321')).toBe(true);
      expect(SelectorEngine.isUnsafeId('000')).toBe(true);
    });

    test('rejects IDs with hash suffixes', () => {
      expect(SelectorEngine.isUnsafeId('button-abc123')).toBe(true);
      expect(SelectorEngine.isUnsafeId('item-xyz789def')).toBe(true);
      expect(SelectorEngine.isUnsafeId('modal-a1b2c3d4e5')).toBe(true);
    });

    test('rejects single letter + number patterns (Gridster)', () => {
      expect(SelectorEngine.isUnsafeId('w5')).toBe(true);
      expect(SelectorEngine.isUnsafeId('w3')).toBe(true);
      expect(SelectorEngine.isUnsafeId('i1')).toBe(true);
      expect(SelectorEngine.isUnsafeId('W10')).toBe(true);
    });

    test('rejects Base UI patterns', () => {
      expect(SelectorEngine.isUnsafeId('bui123')).toBe(true);
      expect(SelectorEngine.isUnsafeId('bui456789')).toBe(true);
      expect(SelectorEngine.isUnsafeId('field-val-123')).toBe(true);
    });

    test('rejects empty or undefined IDs', () => {
      expect(SelectorEngine.isUnsafeId('')).toBe(true);
      expect(SelectorEngine.isUnsafeId(null as any)).toBe(true);
      expect(SelectorEngine.isUnsafeId(undefined as any)).toBe(true);
    });
  });

  describe('should accept stable IDs', () => {
    test('accepts semantic IDs with short suffixes', () => {
      expect(SelectorEngine.isUnsafeId('main-nav')).toBe(false); // 3 chars after hyphen
      expect(SelectorEngine.isUnsafeId('btn-ok')).toBe(false); // 2 chars after hyphen
      expect(SelectorEngine.isUnsafeId('nav-top')).toBe(false); // 3 chars after hyphen
    });

    test('accepts IDs with meaningful short numbers', () => {
      expect(SelectorEngine.isUnsafeId('tab-1')).toBe(false);
      expect(SelectorEngine.isUnsafeId('section-2')).toBe(false);
      expect(SelectorEngine.isUnsafeId('item-12')).toBe(false); // Under 3 digits
    });

    test('accepts descriptive IDs without suffixes', () => {
      expect(SelectorEngine.isUnsafeId('header')).toBe(false);
      expect(SelectorEngine.isUnsafeId('footer')).toBe(false);
      expect(SelectorEngine.isUnsafeId('loginForm')).toBe(false); // camelCase
    });
  });
});

describe('SelectorEngine.isPotentiallyFragile', () => {
  describe('should detect fragile selectors', () => {
    test('detects position-based selectors', () => {
      expect(SelectorEngine.isPotentiallyFragile('div:nth-child(3)')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('span:nth-of-type(2)')).toBe(true);
    });

    test('detects framework-generated patterns', () => {
      expect(SelectorEngine.isPotentiallyFragile('[class*="ng-scope"]')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('[id*="react-123"]')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('[id*="vue-component"]')).toBe(true);
    });

    test('detects UUID patterns', () => {
      const uuidSelector = '[id*="a1b2c3d4-e5f6-4789-0abc-def123456789"]';
      expect(SelectorEngine.isPotentiallyFragile(uuidSelector)).toBe(true);
    });

    test('detects random hash patterns', () => {
      expect(SelectorEngine.isPotentiallyFragile('[id*="abc123def"]')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('[id*="xyz789"]')).toBe(true);
    });

    test('detects multiple nth-* pseudo-classes', () => {
      expect(SelectorEngine.isPotentiallyFragile('div:nth-child(2) > span:nth-of-type(3)')).toBe(true);
    });

    test('detects overly long CSS paths', () => {
      const longPath = 'div > div > div > div > div > div > div > div > div';
      expect(SelectorEngine.isPotentiallyFragile(longPath)).toBe(true);
    });

    test('detects BEM patterns', () => {
      expect(SelectorEngine.isPotentiallyFragile('[class*="block__element"]')).toBe(true);
    });

    test('detects CSS modules patterns', () => {
      expect(SelectorEngine.isPotentiallyFragile('.css-hjUvyc')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('._css-fqUvxY')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('.sc-abc123')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('.styled-abcd')).toBe(true); // Need 4+ chars
      expect(SelectorEngine.isPotentiallyFragile('.emotion-abc1')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile('._abcd')).toBe(true);
    });

    test('rejects empty selectors', () => {
      expect(SelectorEngine.isPotentiallyFragile('')).toBe(true);
      expect(SelectorEngine.isPotentiallyFragile(null as any)).toBe(true);
    });
  });

  describe('should accept stable selectors', () => {
    test('accepts data-testid selectors', () => {
      expect(SelectorEngine.isPotentiallyFragile('[data-testid="submit-button"]')).toBe(false);
    });

    test('accepts role-based selectors', () => {
      expect(SelectorEngine.isPotentiallyFragile('[role="button"]')).toBe(false);
    });

    test('accepts semantic class selectors', () => {
      expect(SelectorEngine.isPotentiallyFragile('.submit-button')).toBe(false);
      expect(SelectorEngine.isPotentiallyFragile('.user-profile')).toBe(false);
    });

    test('accepts short CSS paths', () => {
      expect(SelectorEngine.isPotentiallyFragile('div > button')).toBe(false);
      expect(SelectorEngine.isPotentiallyFragile('form > input[type="text"]')).toBe(false);
    });
  });
});

describe('SelectorEngine.getSelectorStabilityScore', () => {
  test('returns 0 for empty selectors', () => {
    expect(SelectorEngine.getSelectorStabilityScore('')).toBe(0);
  });

  test('returns 1.0 for stable selectors', () => {
    expect(SelectorEngine.getSelectorStabilityScore('[data-testid="button"]')).toBe(1.0);
    expect(SelectorEngine.getSelectorStabilityScore('.submit-button')).toBe(1.0);
  });

  test('penalizes position-based selectors', () => {
    const score = SelectorEngine.getSelectorStabilityScore('div:nth-child(3)');
    expect(score).toBe(0.5); // 1.0 - 0.5
  });

  test('penalizes framework patterns', () => {
    const angularScore = SelectorEngine.getSelectorStabilityScore('[class*="ng-scope"]');
    expect(angularScore).toBe(0.7); // 1.0 - 0.3

    const reactScore = SelectorEngine.getSelectorStabilityScore('[id*="react-123"]');
    expect(reactScore).toBe(0.7); // 1.0 - 0.3
  });

  test('penalizes CSS modules heavily', () => {
    const score = SelectorEngine.getSelectorStabilityScore('.css-abc123');
    expect(score).toBe(0.6); // 1.0 - 0.4
  });

  test('penalizes UUID patterns', () => {
    const uuidSelector = '[id*="a1b2c3d4-e5f6-4789-0abc-def123456789"]';
    const score = SelectorEngine.getSelectorStabilityScore(uuidSelector);
    expect(score).toBe(0.6); // 1.0 - 0.4
  });

  test('compounds penalties for multiple issues', () => {
    // CSS module + nth-child
    const score = SelectorEngine.getSelectorStabilityScore('.css-abc123:nth-child(2)');
    expect(score).toBeLessThan(0.5);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('penalizes long CSS paths', () => {
    const longPath = 'div > div > div > div > div > div > div > div > div';
    const score = SelectorEngine.getSelectorStabilityScore(longPath);
    expect(score).toBeLessThan(1.0);
    expect(score).toBeLessThan(0.8); // Should be penalized
  });

  test('never returns negative scores', () => {
    // Extremely fragile selector with multiple issues
    const worstCase = '.css-abc:nth-child(1) > .emotion-xyz:nth-of-type(2) > [id*="react-"] > div > div > div > div > div > div';
    const score = SelectorEngine.getSelectorStabilityScore(worstCase);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

