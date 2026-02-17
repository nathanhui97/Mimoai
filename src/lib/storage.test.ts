import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowStorage } from './storage';
import type { TeachingCorrection, WorkflowMemory } from './workflow-memory/types';

// ============================================================================
// Setup
// ============================================================================

const WORKFLOWS_KEY = 'ghostwriter-workflows';

function makeMemory(overrides?: Partial<WorkflowMemory>): WorkflowMemory {
  return {
    version: '1.0',
    generatedAt: Date.now(),
    identity: {
      name: 'Test Workflow',
      purpose: 'Test purpose',
      domain: 'testing',
      category: 'data_entry',
    },
    understanding: {
      elevator: 'A test workflow',
      phases: [
        { name: 'Phase 1', purpose: 'Navigate', stepIndices: [0], criticality: 'critical' },
        { name: 'Phase 2', purpose: 'Fill form', stepIndices: [1, 2], criticality: 'important' },
        { name: 'Phase 3', purpose: 'Save', stepIndices: [3], criticality: 'critical' },
      ],
      entities: ['contact'],
    },
    inputs: {
      required: [
        {
          name: 'Name',
          variableName: 'name',
          description: 'Contact name',
          type: 'text',
          extractionHints: ['named'],
          usedInSteps: [1],
        },
        {
          name: 'Email',
          variableName: 'email',
          description: 'Contact email',
          type: 'email',
          extractionHints: ['email'],
          usedInSteps: [2],
        },
      ],
      optional: [
        {
          name: 'Phone',
          variableName: 'phone',
          description: 'Contact phone',
          type: 'phone',
          extractionHints: ['phone'],
          usedInSteps: [3],
        },
      ],
    },
    triggers: {
      phrases: ['create contact'],
    },
    pattern: {
      type: 'single_entry',
    },
    success: {
      indicators: [],
      failureIndicators: [],
      endState: 'Contact saved',
    },
    adaptability: {
      optionalSteps: [],
      reorderablePhases: false,
      handledVariations: [],
      fallbacks: [],
    },
    experience: {
      timesExecuted: 0,
      successfulExecutions: 0,
      successRate: 0,
      troubleSpots: [],
      provenStrategies: [],
    },
    ...overrides,
  };
}

function makeWorkflowWithMemory(id: string, memory: WorkflowMemory) {
  return {
    id,
    name: 'Test Workflow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [],
    memory,
  };
}

// ============================================================================
// applyTeachingCorrections
// ============================================================================

describe('WorkflowStorage.applyTeachingCorrections', () => {
  beforeEach(() => {
    vi.mocked(chrome.storage.local.get).mockReset();
    vi.mocked(chrome.storage.local.set).mockReset();
    vi.mocked(chrome.storage.local.set).mockResolvedValue();
  });

  it('does nothing with empty corrections', async () => {
    await WorkflowStorage.applyTeachingCorrections('w1', []);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('updates goal in memory identity', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'goal',
      target: 'primaryGoal',
      correction: 'Add a new contact to Salesforce',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const savedWorkflows = savedData[WORKFLOWS_KEY];
    expect(savedWorkflows[0].memory.identity.purpose).toBe('Add a new contact to Salesforce');
  });

  it('moves field from required to optional', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'field_optional',
      target: 'Email',
      correction: 'Email is optional',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    // Email should no longer be in required
    expect(updatedMemory.inputs.required.find((f: any) => f.name === 'Email')).toBeUndefined();
    // Email should now be in optional
    expect(updatedMemory.inputs.optional.find((f: any) => f.name === 'Email')).toBeDefined();
  });

  it('moves field from optional to required', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'field_required',
      target: 'Phone',
      correction: 'Phone is required',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    // Phone should now be in required
    expect(updatedMemory.inputs.required.find((f: any) => f.name === 'Phone')).toBeDefined();
    // Phone should no longer be in optional
    expect(updatedMemory.inputs.optional.find((f: any) => f.name === 'Phone')).toBeUndefined();
  });

  it('renames a field', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'field_name',
      target: 'Name',
      correction: 'Full Name',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    // Name should be renamed
    expect(updatedMemory.inputs.required.find((f: any) => f.name === 'Full Name')).toBeDefined();
    expect(updatedMemory.inputs.required.find((f: any) => f.name === 'Name')).toBeUndefined();
  });

  it('renames a phase', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'phase_name',
      target: 'Phase 2',
      correction: 'Enter Contact Details',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    const phase2 = updatedMemory.understanding.phases[1];
    expect(phase2.name).toBe('Enter Contact Details');
  });

  it('updates success criteria end state', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [{
      type: 'success_criteria',
      target: 'endState',
      correction: 'Contact detail page loads with success toast',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    expect(updatedMemory.success.endState).toBe('Contact detail page loads with success toast');
  });

  it('stores corrections in teachingCorrections array', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [
      {
        type: 'goal',
        target: 'primaryGoal',
        correction: 'New goal',
        confidence: 1.0,
        timestamp: Date.now(),
      },
      {
        type: 'field_optional',
        target: 'Email',
        correction: 'Email is optional',
        confidence: 1.0,
        timestamp: Date.now(),
      },
    ];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    expect(updatedMemory.teachingCorrections).toHaveLength(2);
    expect(updatedMemory.teachingCorrections[0].type).toBe('goal');
    expect(updatedMemory.teachingCorrections[1].type).toBe('field_optional');
  });

  it('appends to existing corrections', async () => {
    const memory = makeMemory({
      teachingCorrections: [{
        type: 'goal',
        target: 'primaryGoal',
        correction: 'Old correction',
        confidence: 1.0,
        timestamp: Date.now() - 10000,
      }],
    });
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const newCorrections: TeachingCorrection[] = [{
      type: 'phase_name',
      target: 'Phase 1',
      correction: 'Open Form',
      confidence: 1.0,
      timestamp: Date.now(),
    }];

    await WorkflowStorage.applyTeachingCorrections('w1', newCorrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const updatedMemory = savedData[WORKFLOWS_KEY][0].memory;

    expect(updatedMemory.teachingCorrections).toHaveLength(2);
  });

  it('does nothing if workflow not found', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [],
    });

    await WorkflowStorage.applyTeachingCorrections('nonexistent', [{
      type: 'goal',
      target: 'test',
      correction: 'test',
      confidence: 1.0,
      timestamp: Date.now(),
    }]);

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does nothing if workflow has no memory', async () => {
    const workflow = {
      id: 'w1',
      name: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [],
      // No memory
    };

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    await WorkflowStorage.applyTeachingCorrections('w1', [{
      type: 'goal',
      target: 'test',
      correction: 'test',
      confidence: 1.0,
      timestamp: Date.now(),
    }]);

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('applies multiple corrections in sequence', async () => {
    const memory = makeMemory();
    const workflow = makeWorkflowWithMemory('w1', memory);

    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      [WORKFLOWS_KEY]: [workflow],
    });

    const corrections: TeachingCorrection[] = [
      { type: 'goal', target: 'primaryGoal', correction: 'Updated goal', confidence: 1.0, timestamp: Date.now() },
      { type: 'field_optional', target: 'Email', correction: 'Email is optional', confidence: 1.0, timestamp: Date.now() },
      { type: 'field_required', target: 'Phone', correction: 'Phone is required', confidence: 1.0, timestamp: Date.now() },
      { type: 'phase_name', target: 'Phase 1', correction: 'Navigate to Form', confidence: 1.0, timestamp: Date.now() },
    ];

    await WorkflowStorage.applyTeachingCorrections('w1', corrections);

    const savedData = vi.mocked(chrome.storage.local.set).mock.calls[0][0];
    const m = savedData[WORKFLOWS_KEY][0].memory;

    expect(m.identity.purpose).toBe('Updated goal');
    expect(m.inputs.required.find((f: any) => f.name === 'Email')).toBeUndefined();
    expect(m.inputs.optional.find((f: any) => f.name === 'Email')).toBeDefined();
    expect(m.inputs.required.find((f: any) => f.name === 'Phone')).toBeDefined();
    expect(m.understanding.phases[0].name).toBe('Navigate to Form');
  });
});
