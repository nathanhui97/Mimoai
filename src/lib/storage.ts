/**
 * Storage utility for managing saved workflows in chrome.storage.local
 */

import type { SavedWorkflow } from '../types/workflow';

const WORKFLOWS_KEY = 'ghostwriter-workflows';

export class WorkflowStorage {
  /**
   * Get the storage key for workflows
   */
  static getWorkflowsKey(): string {
    return WORKFLOWS_KEY;
  }

  /**
   * Save a workflow to storage
   * Updates existing workflow if ID matches, otherwise appends
   */
  static async saveWorkflow(workflow: SavedWorkflow): Promise<void> {
    try {
      const workflows = await this.loadWorkflows();
      const existingIndex = workflows.findIndex((w) => w.id === workflow.id);

      if (existingIndex >= 0) {
        // Update existing workflow
        workflows[existingIndex] = {
          ...workflow,
          updatedAt: Date.now(),
        };
      } else {
        // Add new workflow
        workflows.push(workflow);
      }

      await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
    } catch (error) {
      console.error('Error saving workflow:', error);
      throw new Error(`Failed to save workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load all saved workflows from storage
   */
  static async loadWorkflows(): Promise<SavedWorkflow[]> {
    try {
      const result = await chrome.storage.local.get(WORKFLOWS_KEY);
      const workflows = result[WORKFLOWS_KEY];

      if (!workflows || !Array.isArray(workflows)) {
        return [];
      }

      return workflows as SavedWorkflow[];
    } catch (error) {
      console.error('Error loading workflows:', error);
      return [];
    }
  }

  /**
   * Load a specific workflow by ID
   */
  static async loadWorkflow(id: string): Promise<SavedWorkflow | null> {
    try {
      const workflows = await this.loadWorkflows();
      return workflows.find((w) => w.id === id) || null;
    } catch (error) {
      console.error('Error loading workflow:', error);
      return null;
    }
  }

  /**
   * Delete a workflow from storage
   */
  static async deleteWorkflow(id: string): Promise<void> {
    try {
      const workflows = await this.loadWorkflows();
      const filtered = workflows.filter((w) => w.id !== id);

      await chrome.storage.local.set({ [WORKFLOWS_KEY]: filtered });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      throw new Error(`Failed to delete workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}












