import { describe, it, expect } from 'vitest';
import { getElementLabel, getAllLabels, getCleanLabelForMatching, getLabelForDisplay } from './label-utils';

describe('getElementLabel', () => {
  it('returns ariaLabel when present (highest priority)', () => {
    const result = getElementLabel(
      { semanticAnchors: { ariaLabel: 'Submit', textLabel: 'Submit Button' } },
      'Submit Form'
    );
    expect(result).toBe('Submit');
  });

  it('returns textLabel when ariaLabel is missing', () => {
    const result = getElementLabel(
      { semanticAnchors: { textLabel: '*Account Name' } }
    );
    expect(result).toBe('*Account Name');
  });

  it('returns payloadLabel when semanticAnchors has no labels', () => {
    const result = getElementLabel(
      { semanticAnchors: {} },
      'Field Label'
    );
    expect(result).toBe('Field Label');
  });

  it('returns aria-label attribute as last resort', () => {
    const result = getElementLabel(
      undefined,
      undefined,
      { 'aria-label': 'Close dialog' }
    );
    expect(result).toBe('Close dialog');
  });

  it('returns undefined when no labels available', () => {
    const result = getElementLabel(undefined, undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('returns undefined when aiEvidence exists but has no semanticAnchors', () => {
    const result = getElementLabel({});
    expect(result).toBeUndefined();
  });

  it('returns undefined when semanticAnchors exists but all label fields are empty', () => {
    const result = getElementLabel(
      { semanticAnchors: { nearbyText: ['some text'] } }
    );
    expect(result).toBeUndefined();
  });

  it('prefers ariaLabel over payloadLabel even when both present', () => {
    const result = getElementLabel(
      { semanticAnchors: { ariaLabel: 'Aria Label' } },
      'Payload Label'
    );
    expect(result).toBe('Aria Label');
  });

  it('prefers textLabel over payloadLabel when both present', () => {
    const result = getElementLabel(
      { semanticAnchors: { textLabel: 'Text Label' } },
      'Payload Label'
    );
    expect(result).toBe('Text Label');
  });

  it('handles real Salesforce INPUT field case (textLabel only)', () => {
    const result = getElementLabel(
      { 
        semanticAnchors: { 
          textLabel: '*Account Name',
          nearbyText: []
        } 
      },
      'Account Name'
    );
    expect(result).toBe('*Account Name');
  });

  it('handles real Salesforce combobox case (ariaLabel only)', () => {
    const result = getElementLabel(
      { 
        semanticAnchors: { 
          ariaLabel: 'Account Status',
          nearbyText: []
        } 
      }
    );
    expect(result).toBe('Account Status');
  });

  it('returns formCoordinates.label when other sources missing', () => {
    const result = getElementLabel(
      undefined,
      undefined,
      undefined,
      { label: 'Form Field Label' }
    );
    expect(result).toBe('Form Field Label');
  });

  it('returns placeholder when all other sources missing', () => {
    const result = getElementLabel(
      undefined,
      undefined,
      undefined,
      undefined,
      'Enter your name...'
    );
    expect(result).toBe('Enter your name...');
  });

  it('prefers ariaLabel over formCoordinates.label', () => {
    const result = getElementLabel(
      { semanticAnchors: { ariaLabel: 'Aria Label' } },
      undefined,
      undefined,
      { label: 'Form Label' }
    );
    expect(result).toBe('Aria Label');
  });

  it('uses formCoordinates.label when uniqueAttributes has no aria-label', () => {
    const result = getElementLabel(
      undefined,
      undefined,
      { 'data-testid': 'test-field' },
      { label: 'Form Field' }
    );
    expect(result).toBe('Form Field');
  });
});

describe('getAllLabels', () => {
  it('returns all available labels from all sources', () => {
    const result = getAllLabels(
      { 
        semanticAnchors: { 
          ariaLabel: 'Aria Label',
          textLabel: 'Text Label'
        } 
      },
      'Payload Label',
      { 'aria-label': 'Attr Label' }
    );

    expect(result).toEqual({
      ariaLabel: 'Aria Label',
      textLabel: 'Text Label',
      payloadLabel: 'Payload Label',
      attrLabel: 'Attr Label',
    });
  });

  it('returns undefined for missing labels', () => {
    const result = getAllLabels(
      { semanticAnchors: { textLabel: 'Text Label' } },
      undefined,
      undefined
    );

    expect(result).toEqual({
      ariaLabel: undefined,
      textLabel: 'Text Label',
      payloadLabel: undefined,
      attrLabel: undefined,
    });
  });

  it('returns all undefined when no labels present', () => {
    const result = getAllLabels(undefined, undefined, undefined);

    expect(result).toEqual({
      ariaLabel: undefined,
      textLabel: undefined,
      payloadLabel: undefined,
      attrLabel: undefined,
    });
  });

  it('can be used for debugging label priority issues', () => {
    const result = getAllLabels(
      { 
        semanticAnchors: { 
          ariaLabel: 'Primary',
          textLabel: 'Secondary'
        } 
      },
      'Tertiary'
    );

    // Verify we can see all sources even though getElementLabel would only return 'Primary'
    expect(result.ariaLabel).toBe('Primary');
    expect(result.textLabel).toBe('Secondary');
    expect(result.payloadLabel).toBe('Tertiary');
  });
});

describe('getCleanLabelForMatching', () => {
  it('returns ariaLabel as first priority', () => {
    const result = getCleanLabelForMatching(
      { semanticAnchors: { ariaLabel: 'Account Name', textLabel: 'Dirty Label' } },
      'Payload Label',
      { 'aria-label': 'Attr Label' }
    );
    expect(result).toBe('Account Name');
  });

  it('returns uniqueAttributes aria-label as second priority', () => {
    const result = getCleanLabelForMatching(
      { semanticAnchors: { textLabel: 'Dirty Label' } },
      undefined,
      { 'aria-label': 'Attr Label' }
    );
    expect(result).toBe('Attr Label');
  });

  it('returns payloadLabel as third priority', () => {
    const result = getCleanLabelForMatching(
      { semanticAnchors: { textLabel: 'Dirty Label' } },
      'Clean Payload Label',
      {}
    );
    expect(result).toBe('Clean Payload Label');
  });

  it('NEVER returns textLabel (critical for avoiding dirty labels)', () => {
    // This is the critical test - textLabel can contain dirty content
    const result = getCleanLabelForMatching(
      { semanticAnchors: { textLabel: '*Account NameAccount NameComplete this field.' } },
      undefined,
      {}
    );
    // Should be undefined because we explicitly skip textLabel
    expect(result).toBeUndefined();
  });

  it('returns undefined when only dirty textLabel available', () => {
    const result = getCleanLabelForMatching(
      { semanticAnchors: { textLabel: 'Only dirty label available' } }
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when no clean sources available', () => {
    const result = getCleanLabelForMatching(undefined, undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('handles Salesforce dirty textLabel case correctly', () => {
    // Real Salesforce scenario: textLabel is dirty but payloadLabel is clean
    const result = getCleanLabelForMatching(
      { 
        semanticAnchors: { 
          textLabel: '*Account NameAccount NameComplete this field.',
          nearbyText: []
        } 
      },
      'Account Name',  // Clean label from LabelFinder
      {}
    );
    // Should return the clean payloadLabel, NOT the dirty textLabel
    expect(result).toBe('Account Name');
  });
});

describe('getLabelForDisplay', () => {
  it('returns ariaLabel as first priority', () => {
    const result = getLabelForDisplay(
      { semanticAnchors: { ariaLabel: 'Aria Label', textLabel: 'Text Label' } },
      'Payload Label'
    );
    expect(result).toBe('Aria Label');
  });

  it('returns payloadLabel as second priority (for display)', () => {
    const result = getLabelForDisplay(
      { semanticAnchors: { textLabel: 'Text Label' } },
      'Payload Label'
    );
    expect(result).toBe('Payload Label');
  });

  it('returns textLabel as third priority (acceptable for display)', () => {
    // For display purposes, textLabel is acceptable
    const result = getLabelForDisplay(
      { semanticAnchors: { textLabel: 'Some Text Label' } }
    );
    expect(result).toBe('Some Text Label');
  });

  it('returns undefined when no labels available', () => {
    const result = getLabelForDisplay(undefined, undefined);
    expect(result).toBeUndefined();
  });
});
