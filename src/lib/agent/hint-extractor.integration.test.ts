import { describe, it, expect } from 'vitest';
import { HintExtractor } from './hint-extractor';
import type { SavedWorkflow } from '../../types/workflow';

describe('HintExtractor - Real Salesforce Workflow Integration', () => {
  const extractor = new HintExtractor();

  it('processes complete SFDC Account creation form (steps 5-8)', () => {
    // This simulates the EXACT structure from the real workflow:
    // ghostwriter-Click--Show-Navigation-Menu--1768059385981.json
    const workflow: SavedWorkflow = {
      id: 'sfdc-account-real',
      name: 'Create SFDC Account',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        // Step 5: Type 'tes' into Account Name
        {
          type: 'INPUT',
          description: 'Type \'tes\' into the Account Name input field.',
          payload: {
            label: 'Account Name',
            value: 'tes',
            selector: 'div#field-section-content-920 > slot > flexipage-column2.column.flex-width',
            aiEvidence: {
              semanticAnchors: {
                textLabel: '*Account Name'  // ← KEY: INPUT fields have textLabel
              }
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            },
            inputDetails: {
              required: false,
              type: 'text'
            }
          } as any
        },
        // Step 6: Continue typing 'test' (duplicate keystroke)
        {
          type: 'INPUT',
          payload: {
            label: 'Account Name',
            value: 'test',
            aiEvidence: {
              semanticAnchors: {
                textLabel: '*Account Name'
              }
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            }
          } as any
        },
        // Step 7: Click Account Status combobox
        {
          type: 'CLICK',
          payload: {
            elementRole: 'combobox',
            elementText: 'Account Status',
            selector: '#combobox-button-1185',
            aiEvidence: {
              semanticAnchors: {
                ariaLabel: 'Account Status'  // ← KEY: Comboboxes have ariaLabel
              }
            },
            interactionType: {
              kind: 'BUTTON_CLICK',
              confidence: 0.85
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            },
            fallbackSelectors: [
              '//*[@role=\'combobox\'][contains(normalize-space(.), \'Prospect\')]',
              '#combobox-button-1185'
            ]
          } as any
        },
        // Step 8: Select 'Inactive' option
        {
          type: 'CLICK',
          payload: {
            elementText: 'Inactive',
            selector: '//*[@role=\'option\'][contains(normalize-space(.), \'Inactive\')]',
            aiEvidence: {
              semanticAnchors: {
                textLabel: 'Inactive'
              }
            },
            interactionType: {
              kind: 'DROPDOWN_SELECTION',
              confidence: 0.7,
              dropdown: {
                containerSelector: '#dropdown-element-1185',
                options: ['--None--', 'Active', 'Inactive', 'Onboarding', 'Prospect'],
                selectedIndex: 2,
                selectedOption: 'Inactive'
              }
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            }
          } as any
        }
      ]
    };

    const hints = extractor.extractHints(workflow);
    
    expect(hints).toHaveLength(4);
    
    // CRITICAL: Verify step 5 & 6 (INPUT) have labels extracted
    expect(hints[0].recordedAriaLabel).toBe('*Account Name');
    expect(hints[0].actionType).toBe('type');
    expect(hints[0].value).toBe('tes');
    expect(hints[0].recordedScopeHint).toBe('Account Information');
    
    expect(hints[1].recordedAriaLabel).toBe('*Account Name');
    expect(hints[1].actionType).toBe('type');
    expect(hints[1].value).toBe('test');
    
    // CRITICAL: Verify step 7 (combobox) has label extracted
    expect(hints[2].recordedAriaLabel).toBe('Account Status');
    expect(hints[2].actionType).toBe('click');
    expect(hints[2].targetRole).toBe('combobox');
    expect(hints[2].recordedScopeHint).toBe('Account Information');
    
    // CRITICAL: Verify step 8 (dropdown selection) converted to SELECT
    expect(hints[3].actionType).toBe('select');
    expect(hints[3].targetText).toBe('Inactive');
    expect(hints[3].recordedAriaLabel).toBe('Inactive');
  });

  it('handles variable substitution while preserving label extraction', () => {
      const workflow: SavedWorkflow = {
        id: 'test-vars',
        name: 'Test Variables',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        variables: {
          detectedAt: Date.now(),
          analysisCount: 1,
          variables: [
            {
              variableName: 'accountName',
              fieldName: 'Account Name',
              stepIndex: 0,
              stepId: 'step-1',
              defaultValue: 'test',
              isVariable: true,
              confidence: 0.9
            }
          ]
        },
      steps: [{
        type: 'INPUT',
        payload: {
          label: 'Account Name',
          value: 'test',
          aiEvidence: {
            semanticAnchors: {
              textLabel: '*Account Name'
            }
          }
        } as any
      }]
    };

    const variableValues = {
      accountName: 'Production Company'
    };

    const hints = extractor.extractHints(workflow, variableValues);
    
    // Label should still be extracted even with variable substitution
    expect(hints[0].recordedAriaLabel).toBe('*Account Name');
    // Value should be substituted
    expect(hints[0].value).toBe('Production Company');
  });

  it('handles dropdown variable substitution with label extraction', () => {
      const workflow: SavedWorkflow = {
        id: 'test-dropdown-var',
        name: 'Test Dropdown Var',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        variables: {
          detectedAt: Date.now(),
          analysisCount: 1,
          variables: [{
            variableName: 'status',
            fieldName: 'Account Status',
            stepIndex: 0,
            stepId: 'step-1',
            defaultValue: 'Inactive',
            isVariable: true,
            confidence: 0.8
          }]
        },
      steps: [{
        type: 'CLICK',
        payload: {
          elementText: 'Inactive',
          aiEvidence: {
            semanticAnchors: {
              ariaLabel: 'Account Status'
            }
          },
          interactionType: {
            kind: 'DROPDOWN_SELECTION',
            dropdown: {
              selectedOption: 'Inactive'
            }
          }
        } as any
      }]
    };

    const variableValues = { status: 'Active' };
    const hints = extractor.extractHints(workflow, variableValues);
    
    // Should be SELECT action
    expect(hints[0].actionType).toBe('select');
    // Label should be extracted
    expect(hints[0].recordedAriaLabel).toBe('Account Status');
    // Value should be substituted AND used as targetText
    expect(hints[0].value).toBe('Active');
    expect(hints[0].targetText).toBe('Active');
  });
});
