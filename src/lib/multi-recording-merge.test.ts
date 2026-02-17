import { describe, it, expect } from 'vitest';
import {
  findMergeCandidates,
  mergeRecordings,
  applyMergeToSkillModel,
} from './multi-recording-merge';
import type { SavedWorkflow } from '../types/workflow';
import type { SkillModel } from './skill-model/types';

// ============================================================================
// Helpers
// ============================================================================

function makeWorkflow(overrides: Partial<SavedWorkflow> & { id: string; name: string }): SavedWorkflow {
  return {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [],
    ...overrides,
  } as SavedWorkflow;
}

function makeInputStep(label: string, value: string, url: string = 'https://app.example.com/contacts/new') {
  return {
    type: 'INPUT' as const,
    description: `Type "${value}" in ${label}`,
    payload: {
      label,
      value,
      selector: `#field-${label.toLowerCase().replace(/\s+/g, '-')}`,
      url,
    } as any,
  };
}

function makeClickStep(text: string, url: string = 'https://app.example.com/contacts') {
  return {
    type: 'CLICK' as const,
    description: `Click ${text}`,
    payload: {
      elementText: text,
      selector: `button.${text.toLowerCase()}`,
      url,
    } as any,
  };
}

function makeNavStep(url: string) {
  return {
    type: 'NAVIGATION' as const,
    description: `Navigate to ${url}`,
    payload: { url } as any,
  };
}

// ============================================================================
// findMergeCandidates
// ============================================================================

describe('findMergeCandidates', () => {
  it('returns empty array when no existing workflows', () => {
    const newWorkflow = makeWorkflow({ id: 'new', name: 'Create Contact', steps: [] });
    const candidates = findMergeCandidates(newWorkflow, []);
    expect(candidates).toEqual([]);
  });

  it('does not match workflow against itself', () => {
    const workflow = makeWorkflow({
      id: 'w1',
      name: 'Create Contact',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Name', 'John'),
      ],
    });
    const candidates = findMergeCandidates(workflow, [workflow]);
    expect(candidates).toEqual([]);
  });

  it('matches workflows with same URL patterns', () => {
    const existing = makeWorkflow({
      id: 'w1',
      name: 'Create Contact',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Name', 'John', 'https://app.example.com/contacts/new'),
        makeInputStep('Email', 'john@test.com', 'https://app.example.com/contacts/new'),
      ],
    });

    const newWorkflow = makeWorkflow({
      id: 'w2',
      name: 'Add Contact',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Name', 'Jane', 'https://app.example.com/contacts/new'),
        makeInputStep('Phone', '555-1234', 'https://app.example.com/contacts/new'),
      ],
    });

    const candidates = findMergeCandidates(newWorkflow, [existing]);
    expect(candidates.length).toBe(1);
    expect(candidates[0].workflow.id).toBe('w1');
    expect(candidates[0].similarity).toBeGreaterThan(0.5);
  });

  it('does not match workflows with completely different URLs', () => {
    const existing = makeWorkflow({
      id: 'w1',
      name: 'Send Email',
      steps: [
        makeNavStep('https://mail.example.com/inbox'),
        makeInputStep('Subject', 'Hello'),
      ],
    });

    const newWorkflow = makeWorkflow({
      id: 'w2',
      name: 'Create Contact',
      steps: [
        makeNavStep('https://crm.example.com/contacts'),
        makeInputStep('Name', 'John'),
      ],
    });

    const candidates = findMergeCandidates(newWorkflow, [existing]);
    expect(candidates).toEqual([]);
  });

  it('matches workflows with same field names and URL', () => {
    const existing = makeWorkflow({
      id: 'w1',
      name: 'New Contact Full',
      steps: [
        makeNavStep('https://app.example.com/contacts/new'),
        makeInputStep('First Name', 'John'),
        makeInputStep('Last Name', 'Doe'),
        makeInputStep('Email', 'john@test.com'),
        makeInputStep('Phone', '555-1234'),
      ],
    });

    const newWorkflow = makeWorkflow({
      id: 'w2',
      name: 'New Contact Quick',
      steps: [
        makeNavStep('https://app.example.com/contacts/new'),
        makeInputStep('First Name', 'Jane'),
        makeInputStep('Last Name', 'Smith'),
        makeInputStep('Email', 'jane@test.com'),
      ],
    });

    const candidates = findMergeCandidates(newWorkflow, [existing]);
    expect(candidates.length).toBe(1);
    expect(candidates[0].similarity).toBeGreaterThan(0.5);
  });

  it('ranks candidates by similarity descending', () => {
    const highMatch = makeWorkflow({
      id: 'high',
      name: 'Create Contact',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Name', 'Alice'),
        makeInputStep('Email', 'alice@test.com'),
      ],
    });

    const lowMatch = makeWorkflow({
      id: 'low',
      name: 'Different Task',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Notes', 'Some notes'),
      ],
    });

    const newWorkflow = makeWorkflow({
      id: 'new',
      name: 'Create Contact',
      steps: [
        makeNavStep('https://app.example.com/contacts'),
        makeInputStep('Name', 'Bob'),
        makeInputStep('Email', 'bob@test.com'),
      ],
    });

    const candidates = findMergeCandidates(newWorkflow, [lowMatch, highMatch]);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    if (candidates.length >= 2) {
      expect(candidates[0].similarity).toBeGreaterThanOrEqual(candidates[1].similarity);
    }
  });
});

// ============================================================================
// mergeRecordings
// ============================================================================

describe('mergeRecordings', () => {
  it('merges two recordings and tracks field fill counts', () => {
    const base = makeWorkflow({
      id: 'base',
      name: 'Create Contact',
      steps: [
        makeInputStep('Name', 'John'),
        makeInputStep('Email', 'john@test.com'),
        makeInputStep('Phone', '555-1234'),
      ],
    });

    const additional = makeWorkflow({
      id: 'additional',
      name: 'Create Contact v2',
      steps: [
        makeInputStep('Name', 'Jane'),
        makeInputStep('Email', 'jane@test.com'),
        // Phone is NOT filled in this recording
      ],
    });

    const result = mergeRecordings(base, [additional]);

    expect(result.recordingCount).toBe(2);
    expect(result.sourceWorkflowIds).toEqual(['base', 'additional']);

    // Name and Email filled in both recordings
    const nameResult = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Name');
    expect(nameResult).toBeDefined();
    expect(nameResult!.filledCount).toBe(2);

    const emailResult = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Email');
    expect(emailResult).toBeDefined();
    expect(emailResult!.filledCount).toBe(2);

    // Phone only filled in one recording
    const phoneResult = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Phone');
    expect(phoneResult).toBeDefined();
    expect(phoneResult!.filledCount).toBe(1);
  });

  it('marks fields as required when filled in 80%+ of recordings', () => {
    const recordings = [
      makeWorkflow({
        id: 'r1', name: 'v1',
        steps: [makeInputStep('Name', 'A'), makeInputStep('Email', 'a@t.com'), makeInputStep('Phone', '111')],
      }),
      makeWorkflow({
        id: 'r2', name: 'v2',
        steps: [makeInputStep('Name', 'B'), makeInputStep('Email', 'b@t.com'), makeInputStep('Phone', '222')],
      }),
      makeWorkflow({
        id: 'r3', name: 'v3',
        steps: [makeInputStep('Name', 'C'), makeInputStep('Email', 'c@t.com')],
        // No Phone
      }),
      makeWorkflow({
        id: 'r4', name: 'v4',
        steps: [makeInputStep('Name', 'D'), makeInputStep('Email', 'd@t.com')],
        // No Phone
      }),
      makeWorkflow({
        id: 'r5', name: 'v5',
        steps: [makeInputStep('Name', 'E'), makeInputStep('Email', 'e@t.com')],
        // No Phone
      }),
    ];

    const result = mergeRecordings(recordings[0], recordings.slice(1));

    // Name and Email filled in all 5 → required
    const name = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Name');
    expect(name!.inferredRequired).toBe(true);
    expect(name!.confidence).toBe(1.0);

    // Phone filled in 2/5 = 40% → NOT required
    const phone = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Phone');
    expect(phone!.inferredRequired).toBe(false);
  });

  it('collects value variations across recordings', () => {
    const base = makeWorkflow({
      id: 'r1', name: 'v1',
      steps: [makeInputStep('Status', 'Active')],
    });

    const additional = makeWorkflow({
      id: 'r2', name: 'v2',
      steps: [makeInputStep('Status', 'Inactive')],
    });

    const result = mergeRecordings(base, [additional]);

    const status = Object.values(result.fieldConfidence).find(f => f.fieldName === 'Status');
    expect(status!.variations).toContain('Active');
    expect(status!.variations).toContain('Inactive');
  });

  it('detects path variations between recordings', () => {
    const base = makeWorkflow({
      id: 'base', name: 'base',
      steps: [
        makeClickStep('New'),
        makeInputStep('Name', 'John'),
        makeClickStep('Save'),
      ],
    });

    const additional = makeWorkflow({
      id: 'extra', name: 'with error',
      steps: [
        makeClickStep('New'),
        makeInputStep('Name', 'Jane'),
        makeClickStep('Save'),
        makeClickStep('Fix Error'), // Extra step
      ],
    });

    const result = mergeRecordings(base, [additional]);
    expect(result.pathVariations.length).toBe(1);
    expect(result.pathVariations[0].sourceWorkflowId).toBe('extra');
    expect(result.pathVariations[0].differingSteps.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// applyMergeToSkillModel
// ============================================================================

describe('applyMergeToSkillModel', () => {
  const baseSkillModel: SkillModel = {
    workflowId: 'w1',
    generatedAt: Date.now(),
    version: '1.0',
    pages: [{
      urlPattern: 'app.example.com/contacts/new',
      pageType: 'form',
      fields: [
        {
          fieldName: 'Name',
          fieldType: 'text',
          required: true,
          requiredConfidence: 0.5,
          requiredSource: 'inferred',
          keepsDefault: false,
          exampleValues: ['John'],
          selectors: [],
          strategy: 'type',
          clearFirst: false,
          stepIndices: [0],
          fillRate: 1.0,
          wasEverSkipped: false,
          fieldOrder: 0,
        },
        {
          fieldName: 'Phone',
          fieldType: 'phone',
          required: true,
          requiredConfidence: 0.5,
          requiredSource: 'inferred',
          keepsDefault: false,
          exampleValues: ['555-1234'],
          selectors: [],
          strategy: 'type',
          clearFirst: false,
          stepIndices: [2],
          fillRate: 1.0,
          wasEverSkipped: false,
          fieldOrder: 2,
        },
      ],
      actions: [],
    }],
    crossPageDependencies: [],
    executionCount: 1,
  };

  it('updates field requirements based on merge data', () => {
    const merge = {
      recordingCount: 3,
      mergedAt: Date.now(),
      sourceWorkflowIds: ['w1', 'w2', 'w3'],
      fieldConfidence: {
        name: {
          fieldName: 'Name',
          filledCount: 3,
          totalRecordings: 3,
          inferredRequired: true,
          confidence: 1.0,
          variations: ['John', 'Jane', 'Bob'],
          wasEverSkipped: false,
          preferredStrategy: 'type',
        },
        phone: {
          fieldName: 'Phone',
          filledCount: 1,
          totalRecordings: 3,
          inferredRequired: false,
          confidence: 0.33,
          variations: ['555-1234'],
          wasEverSkipped: true,
          preferredStrategy: 'type',
        },
      },
      pathVariations: [],
    };

    const updated = applyMergeToSkillModel(baseSkillModel, merge);

    // Name should remain required with high confidence
    const nameField = updated.pages[0].fields.find(f => f.fieldName === 'Name');
    expect(nameField!.required).toBe(true);
    expect(nameField!.requiredConfidence).toBe(1.0);
    expect(nameField!.exampleValues).toContain('Jane');
    expect(nameField!.exampleValues).toContain('Bob');

    // Phone should become optional
    const phoneField = updated.pages[0].fields.find(f => f.fieldName === 'Phone');
    expect(phoneField!.required).toBe(false);
    expect(phoneField!.wasEverSkipped).toBe(true);
    expect(phoneField!.skipReason).toBe('optional');

    // Execution count should match merge
    expect(updated.executionCount).toBe(3);
  });

  it('caps example values at 10', () => {
    const merge = {
      recordingCount: 12,
      mergedAt: Date.now(),
      sourceWorkflowIds: [],
      fieldConfidence: {
        name: {
          fieldName: 'Name',
          filledCount: 12,
          totalRecordings: 12,
          inferredRequired: true,
          confidence: 1.0,
          variations: Array.from({ length: 15 }, (_, i) => `Person ${i}`),
          wasEverSkipped: false,
          preferredStrategy: 'type',
        },
      },
      pathVariations: [],
    };

    const updated = applyMergeToSkillModel(baseSkillModel, merge);
    const nameField = updated.pages[0].fields.find(f => f.fieldName === 'Name');
    expect(nameField!.exampleValues.length).toBeLessThanOrEqual(10);
  });
});
