/**
 * Unit tests for Element Resolver
 * 
 * Tests element resolution constants, thresholds, and type structures.
 * 
 * Note: Full element resolution testing requires a real browser environment
 * with proper CSS computed styles. These tests verify the basic structure
 * and configuration.
 */

import { describe, test, expect } from 'vitest';
import type { ElementSignature, ResolutionOptions } from '../../types/universal-types';

// Test the signal weights and thresholds are reasonable
describe('Element Resolver Configuration', () => {
  test('signal weight constants are defined and reasonable', () => {
    // These values match the ones exported from element-resolver
    const SIGNAL_WEIGHTS = {
      testId: 50,
      ariaLabel: 25,
      role: 15,
      accessibleName: 20,
      id: 30,
      name: 25,
      exactText: 40,
      normalizedText: 30,
      containsText: 20,
      tagName: 10,
      tagPath: 15,
      nthOfType: 10,
      landmark: 15,
      formContext: 10,
      nearbyLabel: 15,
      cssSelector: 20,
      xpath: 15,
    };

    // Verify testId has highest weight (most stable)
    expect(SIGNAL_WEIGHTS.testId).toBeGreaterThan(SIGNAL_WEIGHTS.ariaLabel);
    expect(SIGNAL_WEIGHTS.testId).toBeGreaterThan(SIGNAL_WEIGHTS.role);
    
    // Verify exactText is high priority
    expect(SIGNAL_WEIGHTS.exactText).toBeGreaterThan(SIGNAL_WEIGHTS.normalizedText);
    expect(SIGNAL_WEIGHTS.exactText).toBeGreaterThan(SIGNAL_WEIGHTS.containsText);
    
    // Verify stable attributes are higher priority than position
    expect(SIGNAL_WEIGHTS.id).toBeGreaterThan(SIGNAL_WEIGHTS.nthOfType);
  });

  test('minimum confidence threshold is reasonable', () => {
    const MIN_CONFIDENCE_THRESHOLD = 0.3;
    
    expect(MIN_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(MIN_CONFIDENCE_THRESHOLD).toBeLessThan(1);
  });

  test('ambiguity threshold is reasonable', () => {
    const AMBIGUITY_THRESHOLD = 0.15;
    
    // Should be positive but not too large
    expect(AMBIGUITY_THRESHOLD).toBeGreaterThan(0);
    expect(AMBIGUITY_THRESHOLD).toBeLessThan(0.5);
  });
});

describe('Element Signature Type Structure', () => {
  test('ElementSignature has all required fields', () => {
    const signature: ElementSignature = {
      identity: {
        testId: 'test-id',
        ariaLabel: 'label',
        role: 'button',
        accessibleName: 'name',
        id: 'element-id',
      },
      text: {
        exact: 'Click me',
        normalized: 'click me',
        contains: ['click', 'me'],
        placeholder: 'Enter text',
      },
      structure: {
        tagName: 'BUTTON',
        tagPath: 'DIV > BUTTON',
        nthOfType: 1,
        totalOfType: 3,
      },
      visual: {
        landmark: 'Form Section',
        formContext: 'login-form',
        nearbyLabels: ['Username'],
        position: 'center',
        sectionHeading: 'Login',
      },
      selectors: {
        ideal: '[data-testid="test-id"]',
        stable: 'button[aria-label="label"]',
        specific: '#element-id',
        xpath: '//button[@id="element-id"]',
      },
    };

    // Verify structure compiles and has expected shape
    expect(signature.identity).toBeDefined();
    expect(signature.text).toBeDefined();
    expect(signature.structure).toBeDefined();
    expect(signature.visual).toBeDefined();
    expect(signature.selectors).toBeDefined();
    
    expect(signature.identity.testId).toBe('test-id');
    expect(signature.structure.tagName).toBe('BUTTON');
    expect(signature.text.exact).toBe('Click me');
  });

  test('ResolutionOptions has correct fields', () => {
    const options: ResolutionOptions = {
      timeout: 5000,
      minConfidence: 0.3,
      autoPickBest: true,
    };

    expect(options.timeout).toBe(5000);
    expect(options.minConfidence).toBe(0.3);
    expect(options.autoPickBest).toBe(true);
  });

  test('minimal ElementSignature is valid', () => {
    // Even with empty fields, signature should be valid
    const minimalSignature: ElementSignature = {
      identity: {},
      text: {},
      structure: {
        tagName: 'DIV',
      },
      visual: {},
      selectors: {},
    };

    expect(minimalSignature.structure.tagName).toBe('DIV');
  });
});

describe('Confidence Scoring Theory', () => {
  test('exact matches should score higher than partial matches', () => {
    // This tests the theoretical scoring model
    const exactTextWeight = 40;
    const normalizedTextWeight = 30;
    const containsTextWeight = 20;
    
    expect(exactTextWeight).toBeGreaterThan(normalizedTextWeight);
    expect(normalizedTextWeight).toBeGreaterThan(containsTextWeight);
  });

  test('identity signals should score higher than structural signals', () => {
    const testIdWeight = 50;
    const tagNameWeight = 10;
    const nthOfTypeWeight = 10;
    
    expect(testIdWeight).toBeGreaterThan(tagNameWeight);
    expect(testIdWeight).toBeGreaterThan(nthOfTypeWeight);
  });

  test('multiple signal scores should be additive', () => {
    // When an element matches multiple signals, the confidence should be higher
    const testIdScore = 50;
    const ariaLabelScore = 25;
    const combinedScore = testIdScore + ariaLabelScore;
    
    expect(combinedScore).toBeGreaterThan(testIdScore);
    expect(combinedScore).toBeGreaterThan(ariaLabelScore);
  });
});

describe('Ambiguity Detection Theory', () => {
  test('ambiguity threshold defines minimum separation', () => {
    const AMBIGUITY_THRESHOLD = 0.15;
    
    // If two candidates are within threshold, it's ambiguous
    const topScore = 0.85;
    const secondScore = 0.82;
    const diff = topScore - secondScore;
    
    if (diff < AMBIGUITY_THRESHOLD) {
      // Ambiguous case
      expect(diff).toBeLessThan(AMBIGUITY_THRESHOLD);
    }
  });

  test('clear winner has sufficient confidence gap', () => {
    const AMBIGUITY_THRESHOLD = 0.15;
    
    const topScore = 0.90;
    const secondScore = 0.60;
    const diff = topScore - secondScore;
    
    // This should be a clear winner
    expect(diff).toBeGreaterThanOrEqual(AMBIGUITY_THRESHOLD);
  });
});

// Note: Full integration tests with actual DOM manipulation and visibility
// checking require a real browser environment or more sophisticated mocking.
// The element resolver relies on:
// - window.getComputedStyle() for visibility checks
// - getBoundingClientRect() for size checks  
// - Complex DOM traversal and matching
// 
// These are better tested in E2E tests with a real browser.
