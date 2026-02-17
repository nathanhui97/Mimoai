import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  LocalWorkflowStore,
  getWorkflowStore,
  setWorkflowStore,
  type IWorkflowStore,
} from './storage-interface';

// Mock WorkflowStorage
vi.mock('./storage', () => ({
  WorkflowStorage: {
    saveWorkflow: vi.fn(() => Promise.resolve()),
    loadWorkflows: vi.fn(() => Promise.resolve([])),
    loadWorkflow: vi.fn(() => Promise.resolve(null)),
    deleteWorkflow: vi.fn(() => Promise.resolve()),
    searchWorkflows: vi.fn(() => Promise.resolve([])),
    updateWorkflowExperience: vi.fn(() => Promise.resolve()),
    storeExecutionFeedback: vi.fn(() => Promise.resolve()),
    getExecutionFeedback: vi.fn(() => Promise.resolve([])),
    getLearnedCorrections: vi.fn(() => Promise.resolve({})),
    clearExecutionFeedback: vi.fn(() => Promise.resolve()),
    applyTeachingCorrections: vi.fn(() => Promise.resolve()),
  },
}));

describe('LocalWorkflowStore', () => {
  let store: LocalWorkflowStore;

  beforeEach(() => {
    store = new LocalWorkflowStore();
    vi.clearAllMocks();
  });

  test('saveWorkflow delegates to WorkflowStorage', async () => {
    const workflow = { id: 'wf-1', name: 'Test' } as any;
    await store.saveWorkflow(workflow);

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.saveWorkflow).toHaveBeenCalledWith(workflow, undefined);
  });

  test('loadWorkflows delegates to WorkflowStorage', async () => {
    await store.loadWorkflows();

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.loadWorkflows).toHaveBeenCalled();
  });

  test('loadWorkflow delegates to WorkflowStorage', async () => {
    await store.loadWorkflow('wf-1');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.loadWorkflow).toHaveBeenCalledWith('wf-1');
  });

  test('deleteWorkflow delegates to WorkflowStorage', async () => {
    await store.deleteWorkflow('wf-1');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.deleteWorkflow).toHaveBeenCalledWith('wf-1');
  });

  test('searchWorkflows delegates to WorkflowStorage', async () => {
    await store.searchWorkflows('test query');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.searchWorkflows).toHaveBeenCalledWith('test query');
  });

  test('updateWorkflowExperience delegates to WorkflowStorage', async () => {
    const update = { timesExecuted: 5 };
    await store.updateWorkflowExperience('wf-1', update);

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.updateWorkflowExperience).toHaveBeenCalledWith('wf-1', update);
  });

  test('storeExecutionFeedback delegates to WorkflowStorage', async () => {
    const feedback = { workflowId: 'wf-1' } as any;
    await store.storeExecutionFeedback(feedback);

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.storeExecutionFeedback).toHaveBeenCalledWith(feedback);
  });

  test('getExecutionFeedback delegates to WorkflowStorage', async () => {
    await store.getExecutionFeedback('wf-1');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.getExecutionFeedback).toHaveBeenCalledWith('wf-1');
  });

  test('getLearnedCorrections delegates to WorkflowStorage', async () => {
    await store.getLearnedCorrections('wf-1');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.getLearnedCorrections).toHaveBeenCalledWith('wf-1');
  });

  test('clearExecutionFeedback delegates to WorkflowStorage', async () => {
    await store.clearExecutionFeedback('wf-1');

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.clearExecutionFeedback).toHaveBeenCalledWith('wf-1');
  });

  test('applyTeachingCorrections delegates to WorkflowStorage', async () => {
    const corrections = [{ type: 'goal' as const, target: '', correction: 'New goal', confidence: 1.0 as const, timestamp: Date.now() }];
    await store.applyTeachingCorrections('wf-1', corrections);

    const { WorkflowStorage } = await import('./storage');
    expect(WorkflowStorage.applyTeachingCorrections).toHaveBeenCalledWith('wf-1', corrections);
  });
});

describe('Singleton', () => {
  test('getWorkflowStore returns default LocalWorkflowStore', () => {
    // Reset to default
    setWorkflowStore(new LocalWorkflowStore());
    const store = getWorkflowStore();
    expect(store).toBeInstanceOf(LocalWorkflowStore);
  });

  test('setWorkflowStore swaps the store', async () => {
    const mockStore: IWorkflowStore = {
      saveWorkflow: vi.fn(),
      loadWorkflows: vi.fn(() => Promise.resolve([{ id: 'mock' } as any])),
      loadWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      searchWorkflows: vi.fn(),
      updateWorkflowExperience: vi.fn(),
      storeExecutionFeedback: vi.fn(),
      getExecutionFeedback: vi.fn(),
      getLearnedCorrections: vi.fn(),
      clearExecutionFeedback: vi.fn(),
      applyTeachingCorrections: vi.fn(),
    };

    setWorkflowStore(mockStore);
    const store = getWorkflowStore();
    expect(store).toBe(mockStore);

    const workflows = await store.loadWorkflows();
    expect(mockStore.loadWorkflows).toHaveBeenCalled();
    expect(workflows).toEqual([{ id: 'mock' }]);

    // Reset to default
    setWorkflowStore(new LocalWorkflowStore());
  });
});
