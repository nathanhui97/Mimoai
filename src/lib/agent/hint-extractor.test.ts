import { describe, it, expect } from 'vitest';
import { HintExtractor } from './hint-extractor';
import type { SavedWorkflow } from '../../types/workflow';

describe('HintExtractor - Label Extraction Integration', () => {
  const extractor = new HintExtractor();

  describe('INPUT fields (textLabel)', () => {
    it('extracts textLabel from Salesforce Account Name field', () => {
    const workflow: SavedWorkflow = {
      id: 'test-sfdc-input',
      name: 'Test SFDC Input',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [{
          type: 'INPUT',
          description: 'Type into Account Name',
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
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints).toHaveLength(1);
      expect(hints[0].recordedAriaLabel).toBe('*Account Name');
      expect(hints[0].recordedScopeHint).toBe('Account Information');
      expect(hints[0].actionType).toBe('type');
      expect(hints[0].value).toBe('test');
    });

    it('extracts label when only payload.label is available (no aiEvidence)', () => {
      const workflow: SavedWorkflow = {
        id: 'test-legacy',
        name: 'Test Legacy',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'INPUT',
          description: 'Enter email',
          payload: {
            label: 'Email Address',
            value: 'user@example.com'
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints[0].recordedAriaLabel).toBe('Email Address');
    });

    it('handles INPUT with both textLabel and ariaLabel (prefers ariaLabel)', () => {
      const workflow: SavedWorkflow = {
        id: 'test-both',
        name: 'Test Both',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'INPUT',
          payload: {
            label: 'Name',
            aiEvidence: {
              semanticAnchors: {
                ariaLabel: 'Full Name',
                textLabel: 'Name'
              }
            }
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      // Should prefer ariaLabel over textLabel
      expect(hints[0].recordedAriaLabel).toBe('Full Name');
    });
  });

  describe('Combobox fields (ariaLabel)', () => {
    it('extracts ariaLabel from Salesforce Account Status combobox', () => {
      const workflow: SavedWorkflow = {
        id: 'test-combobox',
        name: 'Test Combobox',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'CLICK',
          payload: {
            elementRole: 'combobox',
            elementText: 'Account Status',
            aiEvidence: {
              semanticAnchors: {
                ariaLabel: 'Account Status'
              }
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            },
            interactionType: {
              kind: 'BUTTON_CLICK'
            }
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints[0].recordedAriaLabel).toBe('Account Status');
      expect(hints[0].targetRole).toBe('combobox');
      expect(hints[0].recordedScopeHint).toBe('Account Information');
    });
  });

  describe('Dropdown selections (DROPDOWN_SELECTION interactionType)', () => {
    it('extracts option text and converts to SELECT action', () => {
      const workflow: SavedWorkflow = {
        id: 'test-dropdown',
        name: 'Test Dropdown',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'CLICK',
          payload: {
            elementText: 'Inactive',
            aiEvidence: {
              semanticAnchors: {
                textLabel: 'Inactive'
              }
            },
            interactionType: {
              kind: 'DROPDOWN_SELECTION',
              dropdown: {
                selectedOption: 'Inactive',
                options: ['--None--', 'Active', 'Inactive']
              }
            },
            scope: {
              kind: 'WIDGET',
              title: 'Account Information'
            }
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      // Should convert to SELECT action due to DROPDOWN_SELECTION
      expect(hints[0].actionType).toBe('select');
      expect(hints[0].targetText).toBe('Inactive');
      expect(hints[0].recordedAriaLabel).toBe('Inactive');
    });
  });

  describe('Real Salesforce workflow simulation', () => {
    it('processes complete SFDC account creation form steps', () => {
      const workflow: SavedWorkflow = {
        id: 'sfdc-complete',
        name: 'Create SFDC Account',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [
          // Step 5: INPUT - Account Name (textLabel)
          {
            type: 'INPUT',
            description: 'Type into Account Name',
            payload: {
              label: 'Account Name',
              value: 'test',
              aiEvidence: {
                semanticAnchors: { textLabel: '*Account Name' }
              },
              scope: {
                kind: 'WIDGET',
                title: 'Account Information'
              }
            } as any
          },
          // Step 7: CLICK - Account Status combobox (ariaLabel)
          {
            type: 'CLICK',
            payload: {
              elementRole: 'combobox',
              elementText: 'Account Status',
              aiEvidence: {
                semanticAnchors: { ariaLabel: 'Account Status' }
              },
              scope: {
                kind: 'WIDGET',
                title: 'Account Information'
              },
              interactionType: {
                kind: 'BUTTON_CLICK'
              }
            } as any
          },
          // Step 8: CLICK - Select Inactive (DROPDOWN_SELECTION)
          {
            type: 'CLICK',
            payload: {
              elementText: 'Inactive',
              aiEvidence: {
                semanticAnchors: { textLabel: 'Inactive' }
              },
              interactionType: {
                kind: 'DROPDOWN_SELECTION',
                dropdown: {
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
      
      expect(hints).toHaveLength(3);
      
      // Step 5: Account Name INPUT
      expect(hints[0].actionType).toBe('type');
      expect(hints[0].recordedAriaLabel).toBe('*Account Name');
      expect(hints[0].recordedScopeHint).toBe('Account Information');
      expect(hints[0].value).toBe('test');
      
      // Step 7: Account Status combobox
      expect(hints[1].actionType).toBe('click');
      expect(hints[1].recordedAriaLabel).toBe('Account Status');
      expect(hints[1].targetRole).toBe('combobox');
      
      // Step 8: Dropdown selection
      expect(hints[2].actionType).toBe('select');
      expect(hints[2].recordedAriaLabel).toBe('Inactive');
      expect(hints[2].targetText).toBe('Inactive');
    });
  });

  describe('Edge cases and fallbacks', () => {
    it('handles missing aiEvidence gracefully', () => {
      const workflow: SavedWorkflow = {
        id: 'test-no-ai',
        name: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'INPUT',
          payload: {
            label: 'Field Name',
            value: 'test'
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints[0].recordedAriaLabel).toBe('Field Name');
    });

    it('handles missing semanticAnchors gracefully', () => {
      const workflow: SavedWorkflow = {
        id: 'test-no-anchors',
        name: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'INPUT',
          payload: {
            label: 'Username',
            aiEvidence: {
              contextSnapshot: '<some html>'
            }
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints[0].recordedAriaLabel).toBe('Username');
    });

    it('returns undefined when no label sources available', () => {
      const workflow: SavedWorkflow = {
        id: 'test-no-label',
        name: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [{
          type: 'CLICK',
          payload: {
            elementText: 'Click Me'
          } as any
        }]
      };

      const hints = extractor.extractHints(workflow);
      
      expect(hints[0].recordedAriaLabel).toBeUndefined();
      // Should still have targetText from elementText
      expect(hints[0].targetText).toBe('Click Me');
    });
  });
});
