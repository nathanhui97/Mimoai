/**
 * Storage Interface — abstracts workflow persistence for future swap to Supabase.
 *
 * Local-first: `LocalWorkflowStore` delegates to `WorkflowStorage` static methods.
 * Swap the singleton via `setWorkflowStore()` for cloud-backed implementations.
 */

import type { SavedWorkflow } from '../types/workflow';
import type { ExecutionExperience, TeachingCorrection } from './workflow-memory/types';
import type { ExecutionFeedback, StepCorrections } from './execution-feedback';

// ============================================================================
// Interface
// ============================================================================

export interface IWorkflowStore {
  // Core CRUD
  saveWorkflow(workflow: SavedWorkflow, options?: { skipMemoryGeneration?: boolean }): Promise<void>;
  loadWorkflows(): Promise<SavedWorkflow[]>;
  loadWorkflow(id: string): Promise<SavedWorkflow | null>;
  deleteWorkflow(id: string): Promise<void>;
  searchWorkflows(query: string): Promise<SavedWorkflow[]>;

  // Experience
  updateWorkflowExperience(workflowId: string, update: Partial<ExecutionExperience>): Promise<void>;

  // Execution feedback
  storeExecutionFeedback(feedback: ExecutionFeedback): Promise<void>;
  getExecutionFeedback(workflowId: string): Promise<ExecutionFeedback[]>;
  getLearnedCorrections(workflowId: string): Promise<StepCorrections>;
  clearExecutionFeedback(workflowId: string): Promise<void>;

  // Teaching
  applyTeachingCorrections(workflowId: string, corrections: TeachingCorrection[]): Promise<void>;
}

// ============================================================================
// Local implementation (delegates to WorkflowStorage)
// ============================================================================

export class LocalWorkflowStore implements IWorkflowStore {
  async saveWorkflow(workflow: SavedWorkflow, options?: { skipMemoryGeneration?: boolean }): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.saveWorkflow(workflow, options);
  }

  async loadWorkflows(): Promise<SavedWorkflow[]> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.loadWorkflows();
  }

  async loadWorkflow(id: string): Promise<SavedWorkflow | null> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.loadWorkflow(id);
  }

  async deleteWorkflow(id: string): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.deleteWorkflow(id);
  }

  async searchWorkflows(query: string): Promise<SavedWorkflow[]> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.searchWorkflows(query);
  }

  async updateWorkflowExperience(workflowId: string, update: Partial<ExecutionExperience>): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.updateWorkflowExperience(workflowId, update);
  }

  async storeExecutionFeedback(feedback: ExecutionFeedback): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.storeExecutionFeedback(feedback);
  }

  async getExecutionFeedback(workflowId: string): Promise<ExecutionFeedback[]> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.getExecutionFeedback(workflowId);
  }

  async getLearnedCorrections(workflowId: string): Promise<StepCorrections> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.getLearnedCorrections(workflowId);
  }

  async clearExecutionFeedback(workflowId: string): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.clearExecutionFeedback(workflowId);
  }

  async applyTeachingCorrections(workflowId: string, corrections: TeachingCorrection[]): Promise<void> {
    const { WorkflowStorage } = await import('./storage');
    return WorkflowStorage.applyTeachingCorrections(workflowId, corrections);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _store: IWorkflowStore = new LocalWorkflowStore();

export function getWorkflowStore(): IWorkflowStore {
  return _store;
}

export function setWorkflowStore(store: IWorkflowStore): void {
  _store = store;
}
