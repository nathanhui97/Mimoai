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

  /**
   * Search workflows by query string
   * Returns workflows ranked by relevance
   */
  static async searchWorkflows(query: string): Promise<SavedWorkflow[]> {
    try {
      const workflows = await this.loadWorkflows();
      const q = query.toLowerCase().trim();
      
      if (!q) {
        return workflows;
      }
      
      return workflows
        .map(w => ({
          workflow: w,
          score: this.calculateMatchScore(w, q)
        }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(r => r.workflow);
    } catch (error) {
      console.error('Error searching workflows:', error);
      return [];
    }
  }

  /**
   * Calculate relevance score for a workflow against a query
   */
  private static calculateMatchScore(w: SavedWorkflow, query: string): number {
    let score = 0;
    const nameLower = w.name.toLowerCase();
    const descLower = w.description?.toLowerCase() || '';
    const goalLower = w.analyzedIntent?.primaryGoal?.toLowerCase() || '';
    
    // Exact name match = 100
    if (nameLower === query) {
      score += 100;
    }
    // Name starts with query = 75
    else if (nameLower.startsWith(query)) {
      score += 75;
    }
    // Name contains query = 50
    else if (nameLower.includes(query)) {
      score += 50;
    }
    
    // Description contains query = 30
    if (descLower.includes(query)) {
      score += 30;
    }
    
    // Intent goal contains query = 20
    if (goalLower.includes(query)) {
      score += 20;
    }
    
    // Boost for word boundary matches
    const queryWords = query.split(/\s+/);
    const nameWords = nameLower.split(/\s+/);
    const matchingWords = queryWords.filter(qw => 
      nameWords.some(nw => nw.includes(qw))
    );
    score += matchingWords.length * 10;
    
    // Enhanced matching using learned skill data
    if (w.learnedSkill) {
      const skill = w.learnedSkill;
      
      // Check verb synonyms (e.g., "download" matches "export", "get", "fetch")
      const verbMatch = skill.canonicalAction.verb.toLowerCase() === query ||
        skill.canonicalAction.verbSynonyms.some(v => query.includes(v.toLowerCase()));
      if (verbMatch) {
        score += 40;
      }
      
      // Check object synonyms (e.g., "dashboard" matches "report", "data")
      const objectMatch = skill.canonicalAction.object.toLowerCase() === query ||
        query.includes(skill.canonicalAction.object.toLowerCase()) ||
        skill.canonicalAction.objectSynonyms.some(o => query.includes(o.toLowerCase()));
      if (objectMatch) {
        score += 40;
      }
      
      // Check example queries (highest priority - direct match with how user might ask)
      for (const example of skill.exampleQueries) {
        const exampleLower = example.toLowerCase();
        // Fuzzy match - check if query words appear in example
        const queryWordsInExample = queryWords.filter(qw => exampleLower.includes(qw));
        if (queryWordsInExample.length >= Math.min(2, queryWords.length)) {
          score += 60;
          break;
        }
        // Also check if example words appear in query
        const exampleWords = exampleLower.split(/\s+/);
        const exampleWordsInQuery = exampleWords.filter(ew => query.includes(ew));
        if (exampleWordsInQuery.length >= Math.min(2, exampleWords.length)) {
          score += 50;
          break;
        }
      }
      
      // Check original user description
      const originalDescLower = skill.originalIntent.userDescription.toLowerCase();
      if (query.includes(originalDescLower) || originalDescLower.includes(query)) {
        score += 35;
      }
    }
    
    return score;
  }
}














