import { describe, it, expect } from 'vitest';
import { PreFlightChecker } from './pre-flight-checker';
import { makeHint, makeObservation } from './__test-fixtures__/form-fixtures';

// ============================================================================
// checkFieldValue — name matching
// ============================================================================

describe('checkFieldValue — name matching', () => {
  it('exact match: "First name" = "First name" → skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.checkType).toBe('field_value');
  });

  it('normalized match: "First name:" (colon) matches "First name" → skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: 'First name:',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('REGRESSION: "First name" ≠ "Last name" (similarity ~0.7, below 0.9) → no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Last name', value: 'test', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('REGRESSION: "Email" ≠ "Name" → no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'Email',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Name', value: 'test', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('REGRESSION: "Company Name" ≠ "Contact Name" → no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'Acme',
      targetText: 'Company Name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Contact Name', value: 'Acme', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('case insensitive values: "JOHN" matches "john" → skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'JOHN',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'john', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('multiple fields with same value: only correctly named field triggers skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [
        { name: 'Last name', value: 'test', type: 'text' },
        { name: 'First name', value: 'test', type: 'text' },
        { name: 'Email', value: 'test', type: 'text' },
      ],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.reason).toContain('First name');
  });

  it('empty formFields → no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: 'First name',
    });
    const obs = makeObservation({ formFields: [] });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('no hint value → no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: undefined,
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('fallback to targetPlaceholder when targetText is empty', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: undefined,
      targetPlaceholder: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('fallback to description when both targetText and targetPlaceholder are empty', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: undefined,
      targetPlaceholder: undefined,
      description: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('whitespace normalization: "  John  " matches "John"', () => {
    const hint = makeHint({
      actionType: 'type',
      value: '  John  ',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('field with special characters: "Prénom" matches "Prénom"', () => {
    // normalizeFieldName strips non a-z0-9, so "Prénom" → "prnom"
    // Both sides normalize the same way, so they match
    const hint = makeHint({
      actionType: 'type',
      value: 'Jean',
      targetText: 'Prénom',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Prénom', value: 'Jean', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });
});

// ============================================================================
// checkExpectedOutcome — disabled
// ============================================================================

describe('checkExpectedOutcome — disabled', () => {
  it('always returns canSkip=false regardless of matching keywords in DOM text', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'Name',
      naturalLanguage: {
        intent: 'Type the name',
        precondition: 'Page loaded',
        expectedOutcome: 'The text "test" is visible in the name field',
        dependencies: [],
      },
    });
    const obs = makeObservation({
      domMapText: '<div>test is visible in the name field</div>',
      formFields: [],
    });

    // Even though the DOM text contains keywords from expectedOutcome,
    // checkExpectedOutcome is disabled (text matching was unreliable)
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('documents WHY it is disabled (text-based matching unreliable)', () => {
    // This test exists as documentation:
    // Keywords like "test", "name", "box" appear across ALL fields in DOM,
    // so an expectedOutcome like "test visible in first name box" would
    // match unrelated fields too — causing false skips.
    const hint = makeHint({
      actionType: 'click',
      targetText: 'Submit',
      naturalLanguage: {
        intent: 'Submit the form',
        precondition: 'Fields filled',
        expectedOutcome: 'Form submitted successfully with toast message',
        dependencies: [],
      },
    });
    const obs = makeObservation({
      domMapText: '<div>Form submitted successfully</div><div class="toast">Success</div>',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });
});

// ============================================================================
// checkNavigation — URL matching
// ============================================================================

describe('checkNavigation — URL matching', () => {
  it('exact URL match → skip', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/dashboard',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.checkType).toBe('url_match');
    expect(result.confidence).toBe(0.95);
  });

  it('URL prefix match (base URL + query params) → skip', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/dashboard',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard?tab=overview&sort=date',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('different URL → no skip', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/settings',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('trailing slash normalization → skip', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/dashboard/',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('no URL in description → no skip', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Go to the dashboard page',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('case insensitive URL comparison (domain + path)', () => {
    // Note: the regex requires lowercase "https://" protocol prefix,
    // but domain and path comparison is case-insensitive
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://APP.EXAMPLE.COM/Dashboard',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });
});

// ============================================================================
// check — dispatch routing
// ============================================================================

describe('check — dispatch routing', () => {
  it("'type' action → runs field value check", () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'John',
      targetText: 'Name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.checkType).toBe('field_value');
  });

  it("'click' action → does NOT run field value check", () => {
    const hint = makeHint({
      actionType: 'click',
      value: 'John',
      targetText: 'Name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Name', value: 'John', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it("'select' action → does NOT run field value check", () => {
    const hint = makeHint({
      actionType: 'select',
      value: 'Option 1',
      targetText: 'Dropdown',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Dropdown', value: 'Option 1', type: 'select' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it("'navigate' action → runs navigation check", () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://example.com/page',
    });
    const obs = makeObservation({
      url: 'https://example.com/page',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
    expect(result.checkType).toBe('url_match');
  });

  it("'scroll' action → returns canSkip=false", () => {
    const hint = makeHint({
      actionType: 'scroll',
      description: 'Scroll down',
    });
    const obs = makeObservation();
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });
});

// ============================================================================
// Accuracy Edge Cases — Falsy field values
// ============================================================================

describe('checkFieldValue — falsy value edge cases', () => {
  it('field value "0" is truthy in JS — correctly detected as filled', () => {
    // In JavaScript, "0" is a truthy string (only "" is falsy).
    // So `if (!field.value) continue;` does NOT skip "0" — it works correctly.
    const hint = makeHint({
      actionType: 'type',
      value: '0',
      targetText: 'Quantity',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Quantity', value: '0', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('ACCURACY: empty string field value is skipped by !field.value check', () => {
    const hint = makeHint({
      actionType: 'type',
      value: '',
      targetText: 'Notes',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Notes', value: '', type: 'text' }],
    });
    // hint.value is "" which is falsy → `if (hint.actionType === 'type' && hint.value)`
    // fails at the dispatch level — check 2 is never entered
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('field value with only whitespace treated as empty after trim', () => {
    const hint = makeHint({
      actionType: 'type',
      value: '   ',
      targetText: 'Name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Name', value: '   ', type: 'text' }],
    });
    // hint.value is "   " which is truthy, but after trim → "" which matches
    // field.value "   ".trim() → ""
    // Both empty after trim → match
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });
});

// ============================================================================
// Accuracy Edge Cases — URL matching
// ============================================================================

describe('checkNavigation — URL accuracy edge cases', () => {
  it('ACCURACY: URL prefix too permissive — "/dash" matches "/dashboard"', () => {
    // currentUrl.startsWith(targetUrl) means a shorter target URL
    // incorrectly matches longer paths that merely start with it
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/dash',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    // Documents the bug: "/dash" is a prefix of "/dashboard", so startsWith passes
    expect(result.canSkip).toBe(true);
  });

  it('ACCURACY: URL with hash fragments — different fragments still match', () => {
    // The URL regex captures everything after https:// including the hash
    // but hash is not stripped, so different hashes cause mismatch
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/docs#section1',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/docs#section2',
    });
    const result = PreFlightChecker.check(hint, obs);
    // Different hashes: "...docs#section1" !== "...docs#section2"
    // and "...docs#section2".startsWith("...docs#section1") is false
    expect(result.canSkip).toBe(false);
  });

  it('URL with hash matches when hash is same', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/docs#intro',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/docs#intro',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('URL without hash matches URL with hash (via startsWith)', () => {
    // target: "example.com/docs", current: "example.com/docs#section1"
    // current.startsWith(target) → true because hash is an extension
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/docs',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/docs#section1',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('URL with port number matches', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://localhost:3000/dashboard',
    });
    const obs = makeObservation({
      url: 'https://localhost:3000/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('ACCURACY: different ports do not match', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://localhost:3000/dashboard',
    });
    const obs = makeObservation({
      url: 'https://localhost:8080/dashboard',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('URL with query params in target still matches via equality', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/search?q=test',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/search?q=test',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });

  it('ACCURACY: different query params — target has params, current does not', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to https://app.example.com/search?q=test',
    });
    const obs = makeObservation({
      url: 'https://app.example.com/search',
    });
    const result = PreFlightChecker.check(hint, obs);
    // current "...search" does NOT startsWith "...search?q=test" → no skip
    expect(result.canSkip).toBe(false);
  });

  it('http URL is handled (not just https)', () => {
    const hint = makeHint({
      actionType: 'navigate',
      description: 'Navigate to http://localhost/page',
    });
    const obs = makeObservation({
      url: 'http://localhost/page',
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });
});

// ============================================================================
// Accuracy Edge Cases — Levenshtein boundary
// ============================================================================

describe('checkFieldValue — Levenshtein boundary cases', () => {
  it('"First name" vs "First names" (plural) — similarity ~0.95 → skip (passes threshold)', () => {
    // "first name" (10 chars) vs "first names" (11 chars) → distance=1, similarity=1-1/11≈0.91
    // After normalization: "first name" vs "first names"
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'First name',
    });
    const obs = makeObservation({
      formFields: [{ name: 'First names', value: 'test', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    // Similarity ≈ 0.91 > 0.9 → passes threshold → skip
    // This documents a potential false positive with plural forms
    expect(result.canSkip).toBe(true);
  });

  it('"Email" vs "Emails" — similarity ~0.83 → no skip', () => {
    // "email" (5 chars) vs "emails" (6 chars) → distance=1, similarity=1-1/6≈0.83
    const hint = makeHint({
      actionType: 'type',
      value: 'test',
      targetText: 'Email',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Emails', value: 'test', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    // 0.83 < 0.9 → does not pass
    expect(result.canSkip).toBe(false);
  });

  it('"Phone" vs "Phone number" — very different lengths → no skip', () => {
    // "phone" vs "phone number" → distance=7, maxLen=12, similarity≈0.42
    const hint = makeHint({
      actionType: 'type',
      value: '555-1234',
      targetText: 'Phone',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Phone number', value: '555-1234', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('"Street" vs "Street address" — no skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: '123 Main',
      targetText: 'Street',
    });
    const obs = makeObservation({
      formFields: [{ name: 'Street address', value: '123 Main', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('single character names: "A" vs "B" → no skip', () => {
    // distance=1, maxLen=1, similarity=0
    const hint = makeHint({
      actionType: 'type',
      value: 'x',
      targetText: 'A',
    });
    const obs = makeObservation({
      formFields: [{ name: 'B', value: 'x', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(false);
  });

  it('identical single character names: "A" vs "A" → skip', () => {
    const hint = makeHint({
      actionType: 'type',
      value: 'x',
      targetText: 'A',
    });
    const obs = makeObservation({
      formFields: [{ name: 'A', value: 'x', type: 'text' }],
    });
    const result = PreFlightChecker.check(hint, obs);
    expect(result.canSkip).toBe(true);
  });
});
