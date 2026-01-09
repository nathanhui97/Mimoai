/**
 * Compilation Tests - Verify core modules compile and export correctly
 * 
 * These tests ensure that the protected core modules are properly structured
 * and can be imported without errors. They serve as:
 * 1. Compilation verification
 * 2. Import path validation
 * 3. Type checking for public APIs
 */

import { describe, test, expect } from 'vitest';
import { ShadowDOMUtils } from '../../core/shadow-dom-utils';
import { VisibilityChecker } from '../../core/visibility-checker';
import { TextMatcher } from '../../core/text-matcher';
import { MenuDetector } from '../menu-detector';
import { CandidateFinder } from '../candidate-finder';

describe('Core Module Compilation', () => {
  test('ShadowDOMUtils exports all required methods', () => {
    expect(typeof ShadowDOMUtils.queryDeep).toBe('function');
    expect(typeof ShadowDOMUtils.queryDeepFirst).toBe('function');
    expect(typeof ShadowDOMUtils.traverseShadowDOM).toBe('function');
    expect(typeof ShadowDOMUtils.closestAcrossShadow).toBe('function');
    expect(typeof ShadowDOMUtils.isInShadowDOM).toBe('function');
  });

  test('VisibilityChecker exports all required methods', () => {
    expect(typeof VisibilityChecker.isVisible).toBe('function');
    expect(typeof VisibilityChecker.isInteractable).toBe('function');
    expect(typeof VisibilityChecker.isInViewport).toBe('function');
  });

  test('TextMatcher exports all required methods', () => {
    expect(typeof TextMatcher.fuzzyMatch).toBe('function');
    expect(typeof TextMatcher.partialMatch).toBe('function');
    expect(typeof TextMatcher.similarityScore).toBe('function');
    expect(typeof TextMatcher.normalize).toBe('function');
  });

  test('MenuDetector exports required methods', () => {
    expect(typeof MenuDetector.findVisibleMenu).toBe('function');
    expect(typeof MenuDetector.extractMenuItems).toBe('function');
  });

  test('CandidateFinder exports required methods', () => {
    expect(typeof CandidateFinder.findCandidates).toBe('function');
  });
});

describe('Backward Compatibility Re-exports', () => {
  test('ShadowDOMUtils can be imported from old path', async () => {
    const { ShadowDOMUtils: OldPathImport } = await import('../shadow-dom-utils');
    expect(typeof OldPathImport.queryDeep).toBe('function');
  });

  test('VisibilityChecker can be imported from old path', async () => {
    const { VisibilityChecker: OldPathImport } = await import('../visibility-checker');
    expect(typeof OldPathImport.isVisible).toBe('function');
  });

  test('TextMatcher can be imported from old path', async () => {
    const { TextMatcher: OldPathImport } = await import('../text-matcher');
    expect(typeof OldPathImport.fuzzyMatch).toBe('function');
  });
});

describe('TextMatcher Utility Functions', () => {
  test('normalize handles various whitespace', () => {
    expect(TextMatcher.normalize('  Hello   World  ')).toBe('hello world');
    expect(TextMatcher.normalize('Hello\nWorld')).toBe('hello world');
    expect(TextMatcher.normalize('Hello\u00A0World')).toBe('hello world'); // &nbsp;
  });

  test('fuzzyMatch detects similar strings', () => {
    expect(TextMatcher.fuzzyMatch('Download Data', 'Download Data')).toBe(true);
    expect(TextMatcher.fuzzyMatch('STORE 119', 'STORE 120')).toBe(false); // Numbers differ
  });

  test('similarityScore returns 1 for identical strings', () => {
    expect(TextMatcher.similarityScore('test', 'test')).toBe(1.0);
  });
});

describe('VisibilityChecker Edge Cases', () => {
  test('isVisible returns false for non-HTMLElement', () => {
    const textNode = document.createTextNode('text');
    expect(VisibilityChecker.isVisible(textNode as any)).toBe(false);
  });

  test('isVisible detects display:none', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    
    expect(VisibilityChecker.isVisible(div)).toBe(false);
    
    document.body.removeChild(div);
  });

  test('isVisible detects visibility:hidden', () => {
    const div = document.createElement('div');
    div.style.visibility = 'hidden';
    document.body.appendChild(div);
    
    expect(VisibilityChecker.isVisible(div)).toBe(false);
    
    document.body.removeChild(div);
  });
});
