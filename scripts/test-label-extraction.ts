#!/usr/bin/env tsx
/**
 * Quick test to verify label extraction works with your actual Salesforce workflow
 */

import { HintExtractor } from '../src/lib/agent/hint-extractor';
import { getAllLabels } from '../src/lib/label-utils';

// Simulate the EXACT structure from your Salesforce workflow
const testWorkflow = {
  id: 'test',
  name: 'Test SFDC',
  createdAt: Date.now(),
  steps: [
    // Step 5: INPUT with textLabel (the bug case!)
    {
      type: 'INPUT',
      description: 'Type \'tes\' into the Account Name input field.',
      payload: {
        label: 'Account Name',
        value: 'tes',
        aiEvidence: {
          semanticAnchors: {
            textLabel: '*Account Name'
          }
        },
        scope: {
          kind: 'WIDGET',
          title: 'Account Information'
        }
      }
    },
    // Step 7: CLICK combobox with ariaLabel
    {
      type: 'CLICK',
      payload: {
        elementRole: 'combobox',
        elementText: 'Account Status',
        aiEvidence: {
          semanticAnchors: {
            ariaLabel: 'Account Status'
          }
        },
        interactionType: {
          kind: 'BUTTON_CLICK'
        },
        scope: {
          kind: 'WIDGET',
          title: 'Account Information'
        }
      }
    },
    // Step 8: Dropdown selection
    {
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
            selectedOption: 'Inactive'
          }
        }
      }
    }
  ]
};

console.log('=== Testing Label Extraction with Real SFDC Workflow Structure ===\n');

const extractor = new HintExtractor();
const hints = extractor.extractHints(testWorkflow as any);

console.log('Total hints extracted:', hints.length);
console.log();

// Test each critical step
const tests = [
  {
    stepNum: 5,
    hintIndex: 0,
    name: 'Account Name INPUT',
    expectedLabel: '*Account Name',
    expectedType: 'type',
    expectedValue: 'tes'
  },
  {
    stepNum: 7,
    hintIndex: 1,
    name: 'Account Status combobox',
    expectedLabel: 'Account Status',
    expectedType: 'click',
    expectedRole: 'combobox'
  },
  {
    stepNum: 8,
    hintIndex: 2,
    name: 'Inactive dropdown option',
    expectedLabel: 'Inactive',
    expectedType: 'select',
    expectedTargetText: 'Inactive'
  }
];

let allPassed = true;

tests.forEach(test => {
  const hint = hints[test.hintIndex];
  const step = testWorkflow.steps[test.hintIndex];
  
  console.log(`--- Step ${test.stepNum}: ${test.name} ---`);
  
  // Show all available labels for debugging
  const allLabels = getAllLabels(
    (step.payload as any).aiEvidence,
    (step.payload as any).label,
    (step.payload as any).context?.uniqueAttributes
  );
  console.log('Available labels:', allLabels);
  
  // Check extracted label
  const labelMatch = hint.recordedAriaLabel === test.expectedLabel;
  console.log(`Label extracted: "${hint.recordedAriaLabel}" ${labelMatch ? '✅' : '❌ Expected: ' + test.expectedLabel}`);
  
  // Check action type
  const typeMatch = hint.actionType === test.expectedType;
  console.log(`Action type: "${hint.actionType}" ${typeMatch ? '✅' : '❌ Expected: ' + test.expectedType}`);
  
  // Additional checks
  if (test.expectedValue) {
    const valueMatch = hint.value === test.expectedValue;
    console.log(`Value: "${hint.value}" ${valueMatch ? '✅' : '❌ Expected: ' + test.expectedValue}`);
    allPassed = allPassed && valueMatch;
  }
  
  if (test.expectedRole) {
    const roleMatch = hint.targetRole === test.expectedRole;
    console.log(`Target role: "${hint.targetRole}" ${roleMatch ? '✅' : '❌ Expected: ' + test.expectedRole}`);
    allPassed = allPassed && roleMatch;
  }
  
  if (test.expectedTargetText) {
    const textMatch = hint.targetText === test.expectedTargetText;
    console.log(`Target text: "${hint.targetText}" ${textMatch ? '✅' : '❌ Expected: ' + test.expectedTargetText}`);
    allPassed = allPassed && textMatch;
  }
  
  console.log();
  
  allPassed = allPassed && labelMatch && typeMatch;
});

if (allPassed) {
  console.log('🎉 SUCCESS! The "phone book" works correctly!');
  console.log('✅ INPUT fields with textLabel: Extracted');
  console.log('✅ Comboboxes with ariaLabel: Extracted');
  console.log('✅ Dropdown selections: Converted to SELECT');
  process.exit(0);
} else {
  console.error('❌ Some tests failed!');
  process.exit(1);
}
