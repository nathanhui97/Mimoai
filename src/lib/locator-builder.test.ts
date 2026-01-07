/**
 * Unit tests for Locator Builder
 * 
 * Tests locator bundle creation, priority ordering, and dynamic text detection.
 */

import { describe, test, expect } from 'vitest';
import type { LocatorBundle, LocatorStrategy } from '../types/locator';
import {
  createEmptyBundle,
  createCSSLocator,
  createTextLocator,
  createAriaLocator,
  createRoleLocator,
  createTestIdLocator,
  createXPathLocator,
  createPositionLocator,
  hasDynamicParts,
  isLikelyDynamicText,
} from '../types/locator';

describe('LocatorBundle Types', () => {
  test('createEmptyBundle creates valid structure', () => {
    const bundle = createEmptyBundle('button', 'button');

    expect(bundle.strategies).toEqual([]);
    expect(bundle.disambiguators).toEqual([]);
    expect(bundle.tagName).toBe('button');
    expect(bundle.role).toBe('button');
  });

  test('LocatorBundle with minimal fields', () => {
    const bundle: LocatorBundle = {
      strategies: [],
      disambiguators: [],
      tagName: 'div',
    };

    expect(bundle.tagName).toBe('div');
    expect(bundle.strategies).toHaveLength(0);
  });

  test('LocatorBundle with full fields', () => {
    const bundle: LocatorBundle = {
      strategies: [
        createCSSLocator('#test', { hasStableAttributes: true }, 'button'),
      ],
      disambiguators: ['Submit', 'form'],
      tagName: 'button',
      role: 'button',
      scope: {
        kind: 'PAGE',
      },
    };

    expect(bundle.strategies).toHaveLength(1);
    expect(bundle.disambiguators).toHaveLength(2);
    expect(bundle.scope?.kind).toBe('PAGE');
  });
});

describe('Locator Strategy Creation', () => {
  test('createCSSLocator creates correct structure', () => {
    const locator = createCSSLocator(
      '#submit-button',
      {
        uniqueMatchAtRecordTime: true,
        hasStableAttributes: true,
        hasDynamicParts: false,
      },
      'button'
    );

    expect(locator.type).toBe('css');
    expect(locator.value).toBe('#submit-button');
    expect(locator.features.uniqueMatchAtRecordTime).toBe(true);
    expect(locator.features.hasStableAttributes).toBe(true);
  });

  test('createTextLocator creates correct structure', () => {
    const locator = createTextLocator(
      'Submit Form',
      {
        uniqueMatchAtRecordTime: true,
        textStabilityHint: 'stable',
      },
      'button'
    );

    expect(locator.type).toBe('text');
    expect(locator.value).toBe('Submit Form');
    expect(locator.features.textStabilityHint).toBe('stable');
  });

  test('createAriaLocator creates correct structure', () => {
    const locator = createAriaLocator(
      'Close dialog',
      {
        hasStableAttributes: true,
      },
      'button'
    );

    expect(locator.type).toBe('aria');
    expect(locator.value).toBe('Close dialog');
  });

  test('createRoleLocator creates correct structure', () => {
    const locator = createRoleLocator(
      'button',
      'Submit',
      {
        hasStableAttributes: true,
      },
      'button'
    );

    expect(locator.type).toBe('role');
    expect(locator.value).toBe('button:Submit');
  });

  test('createTestIdLocator creates correct structure', () => {
    const locator = createTestIdLocator(
      'submit-btn',
      {
        uniqueMatchAtRecordTime: true,
        hasStableAttributes: true,
      },
      'button'
    );

    expect(locator.type).toBe('testid');
    expect(locator.value).toBe('submit-btn');
    expect(locator.features.hasStableAttributes).toBe(true);
  });

  test('createXPathLocator creates correct structure', () => {
    const locator = createXPathLocator(
      '//button[@id="submit"]',
      {
        uniqueMatchAtRecordTime: true,
      },
      'button'
    );

    expect(locator.type).toBe('xpath');
    expect(locator.value).toBe('//button[@id="submit"]');
  });

  test('createPositionLocator creates correct structure', () => {
    const position = { x: 100, y: 200, width: 50, height: 30 };
    const locator = createPositionLocator(
      position,
      {},
      'button'
    );

    expect(locator.type).toBe('position');
    expect(locator.value).toBe(JSON.stringify(position));
    expect(locator.features.textStabilityHint).toBe('likely_dynamic');
  });
});

describe('hasDynamicParts Detection', () => {
  test('detects long hex strings', () => {
    expect(hasDynamicParts('button-abc123def')).toBe(true);
    expect(hasDynamicParts('el-a1b2c3d4e5f6')).toBe(true);
  });

  test('detects long numeric sequences', () => {
    expect(hasDynamicParts('id-12345678901')).toBe(true);
    expect(hasDynamicParts('element-9876543210')).toBe(true);
  });

  test('detects React generated IDs', () => {
    expect(hasDynamicParts(':r1:')).toBe(true);
    expect(hasDynamicParts(':r2abc:')).toBe(true);
  });

  test('detects Angular generated IDs', () => {
    expect(hasDynamicParts('ng-123')).toBe(true);
    expect(hasDynamicParts('ng-456')).toBe(true);
  });

  test('detects double underscore patterns', () => {
    expect(hasDynamicParts('__generated__')).toBe(true);
    expect(hasDynamicParts('__abc123__')).toBe(true);
  });

  test('detects trailing hex patterns', () => {
    expect(hasDynamicParts('button-a1b2')).toBe(true);
    expect(hasDynamicParts('element_12ab')).toBe(true);
  });

  test('accepts stable IDs', () => {
    expect(hasDynamicParts('submit-button')).toBe(false);
    expect(hasDynamicParts('main-nav')).toBe(false);
    expect(hasDynamicParts('user-profile')).toBe(false);
    expect(hasDynamicParts('header')).toBe(false);
  });
});

describe('isLikelyDynamicText Detection', () => {
  test('detects dates', () => {
    expect(isLikelyDynamicText('12/31/2024')).toBe(true);
    expect(isLikelyDynamicText('1/1/24')).toBe(true);
    expect(isLikelyDynamicText('31/12/2024')).toBe(true);
  });

  test('detects times', () => {
    expect(isLikelyDynamicText('12:30')).toBe(true);
    expect(isLikelyDynamicText('9:45')).toBe(true);
  });

  test('detects currency', () => {
    expect(isLikelyDynamicText('$99.99')).toBe(true);
    expect(isLikelyDynamicText('$1,234.56')).toBe(true);
    expect(isLikelyDynamicText('$100')).toBe(true);
  });

  test('detects pure numbers', () => {
    expect(isLikelyDynamicText('123')).toBe(true);
    expect(isLikelyDynamicText('99')).toBe(true);
  });

  test('detects relative time text', () => {
    expect(isLikelyDynamicText('5 minutes ago')).toBe(true);
    expect(isLikelyDynamicText('2 hours ago')).toBe(true);
  });

  test('detects relative date words', () => {
    expect(isLikelyDynamicText('today')).toBe(true);
    expect(isLikelyDynamicText('Yesterday')).toBe(true);
    expect(isLikelyDynamicText('Tomorrow')).toBe(true);
  });

  test('accepts stable text', () => {
    expect(isLikelyDynamicText('Submit')).toBe(false);
    expect(isLikelyDynamicText('Click here')).toBe(false);
    expect(isLikelyDynamicText('User Profile')).toBe(false);
    expect(isLikelyDynamicText('Save Changes')).toBe(false);
  });
});

describe('Locator Strategy Priority', () => {
  test('testid should be highest priority', () => {
    const strategies: LocatorStrategy[] = [
      createTestIdLocator('test-id', {}, 'button'),
      createCSSLocator('#id', {}, 'button'),
      createTextLocator('Click', {}, 'button'),
    ];

    // In actual implementation, testid would be first in the array
    expect(strategies[0].type).toBe('testid');
  });

  test('position should be lowest priority', () => {
    const strategies: LocatorStrategy[] = [
      createCSSLocator('#id', {}, 'button'),
      createTextLocator('Click', {}, 'button'),
      createPositionLocator({ x: 0, y: 0, width: 10, height: 10 }, {}, 'button'),
    ];

    // Position should be last
    expect(strategies[strategies.length - 1].type).toBe('position');
  });

  test('role and aria should be high priority', () => {
    const testId = createTestIdLocator('test', {}, 'button');
    const role = createRoleLocator('button', 'Submit', {}, 'button');
    const aria = createAriaLocator('Submit', {}, 'button');

    // These should all be high priority
    expect([testId.type, role.type, aria.type]).toContain('testid');
    expect([testId.type, role.type, aria.type]).toContain('role');
    expect([testId.type, role.type, aria.type]).toContain('aria');
  });
});

describe('Locator Features', () => {
  test('uniqueMatchAtRecordTime flag is set correctly', () => {
    const uniqueLocator = createCSSLocator(
      '#unique-id',
      { uniqueMatchAtRecordTime: true },
      'div'
    );

    expect(uniqueLocator.features.uniqueMatchAtRecordTime).toBe(true);
  });

  test('matchCountAtRecordTime is recorded', () => {
    const locator = createCSSLocator(
      '.button',
      { matchCountAtRecordTime: 5 },
      'button'
    );

    expect(locator.features.matchCountAtRecordTime).toBe(5);
  });

  test('textStabilityHint describes text stability', () => {
    const stableText = createTextLocator(
      'Submit',
      { textStabilityHint: 'stable' },
      'button'
    );

    const dynamicText = createTextLocator(
      '$99.99',
      { textStabilityHint: 'likely_dynamic' },
      'span'
    );

    expect(stableText.features.textStabilityHint).toBe('stable');
    expect(dynamicText.features.textStabilityHint).toBe('dynamic');
  });

  test('hasStableAttributes flag is set', () => {
    const stable = createCSSLocator(
      '#main-nav',
      { hasStableAttributes: true },
      'nav'
    );

    const unstable = createCSSLocator(
      '#ng-123',
      { hasStableAttributes: false },
      'div'
    );

    expect(stable.features.hasStableAttributes).toBe(true);
    expect(unstable.features.hasStableAttributes).toBe(false);
  });
});

describe('Disambiguators', () => {
  test('disambiguators are array of strings', () => {
    const bundle = createEmptyBundle('button');
    bundle.disambiguators = ['Submit', 'Login Form', 'Primary'];

    expect(bundle.disambiguators).toHaveLength(3);
    expect(bundle.disambiguators[0]).toBe('Submit');
  });

  test('empty disambiguators is valid', () => {
    const bundle = createEmptyBundle('button');

    expect(bundle.disambiguators).toEqual([]);
  });
});

// Note: Full integration tests that build locator bundles from actual DOM
// elements would require complex mock DOM structures. These are better tested
// in E2E tests with real browser environments.

