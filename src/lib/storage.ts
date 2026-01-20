/**
 * Storage utility for managing saved workflows in chrome.storage.local
 */

import type { SavedWorkflow } from '../types/workflow';
import { generateWorkflowMemory, consolidateExistingData } from './workflow-memory';

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
   * Automatically generates/updates workflow memory
   */
  static async saveWorkflow(workflow: SavedWorkflow, options?: { skipMemoryGeneration?: boolean }): Promise<void> {
    try {
      const workflows = await this.loadWorkflows();
      const existingIndex = workflows.findIndex((w) => w.id === workflow.id);

      // Generate memory if not present or if workflow changed significantly
      let workflowWithMemory = workflow;
      if (!options?.skipMemoryGeneration) {
        workflowWithMemory = await this.ensureMemory(workflow);
      }

      if (existingIndex >= 0) {
        // Update existing workflow
        workflows[existingIndex] = {
          ...workflowWithMemory,
          updatedAt: Date.now(),
        };
      } else {
        // Add new workflow
        workflows.push(workflowWithMemory);
      }

      await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
    } catch (error) {
      console.error('Error saving workflow:', error);
      throw new Error(`Failed to save workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure workflow has a memory, generate if missing
   * Uses local consolidation first (instant), then enhances with AI (background)
   */
  private static async ensureMemory(workflow: SavedWorkflow): Promise<SavedWorkflow> {
    // Skip if workflow has minimal data
    if (!workflow.steps || workflow.steps.length === 0) {
      return workflow;
    }

    // Check if memory exists and is recent
    if (workflow.memory && workflow.memory.generatedAt) {
      // Memory exists - check if workflow has been updated since memory was generated
      if (workflow.memory.generatedAt >= (workflow.updatedAt || workflow.createdAt)) {
        return workflow; // Memory is up to date
      }
    }

    console.log('[Storage] Generating memory for workflow:', workflow.name);

    try {
      // Step 1: Quick local consolidation (instant)
      const localMemory = consolidateExistingData(workflow);
      workflow = { ...workflow, memory: localMemory };

      // Step 2: Try to enhance with AI (async, non-blocking)
      // This runs in the background and updates storage when complete
      this.enhanceMemoryInBackground(workflow.id).catch(err => {
        console.warn('[Storage] Background memory enhancement failed:', err);
      });

      return workflow;
    } catch (error) {
      console.warn('[Storage] Memory generation failed:', error);
      return workflow; // Return workflow without memory
    }
  }

  /**
   * Enhance workflow memory with AI in the background
   */
  private static async enhanceMemoryInBackground(workflowId: string): Promise<void> {
    try {
      // Small delay to let the initial save complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      const workflow = await this.loadWorkflow(workflowId);
      if (!workflow) return;

      // Generate full memory with AI enhancement
      const enhancedMemory = await generateWorkflowMemory(workflow, { useAI: true });

      // Update workflow with enhanced memory
      const updatedWorkflow = { ...workflow, memory: enhancedMemory };

      // Save without re-generating memory (to avoid infinite loop)
      const workflows = await this.loadWorkflows();
      const index = workflows.findIndex(w => w.id === workflowId);
      if (index >= 0) {
        workflows[index] = updatedWorkflow;
        await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
        console.log('[Storage] Enhanced memory for workflow:', workflow.name);
      }
    } catch (error) {
      console.warn('[Storage] Background memory enhancement failed:', error);
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

  // ============================================================================
  // Phase 4: Execution Feedback Storage
  // ============================================================================

  /**
   * Get the storage key for execution feedback
   */
  static getFeedbackKey(workflowId: string): string {
    return `feedback-${workflowId}`;
  }

  /**
   * Store execution feedback for a workflow
   * Keeps last 10 executions for learning
   */
  static async storeExecutionFeedback(feedback: import('./execution-feedback').ExecutionFeedback): Promise<void> {
    const key = this.getFeedbackKey(feedback.workflowId);

    try {
      const existing = await this.getExecutionFeedback(feedback.workflowId);
      existing.push(feedback);

      // Keep last 10 executions
      while (existing.length > 10) {
        existing.shift();
      }

      await chrome.storage.local.set({ [key]: existing });
      console.log(`[Storage] Stored execution feedback for workflow ${feedback.workflowId} (${existing.length} total)`);
    } catch (error) {
      console.error('Error storing execution feedback:', error);
    }
  }

  /**
   * Get execution feedback history for a workflow
   */
  static async getExecutionFeedback(workflowId: string): Promise<import('./execution-feedback').ExecutionFeedback[]> {
    const key = this.getFeedbackKey(workflowId);

    try {
      const result = await chrome.storage.local.get(key);
      const feedback = result[key];
      if (Array.isArray(feedback)) {
        return feedback;
      }
      return [];
    } catch (error) {
      console.error('Error getting execution feedback:', error);
      return [];
    }
  }

  /**
   * Get learned corrections for a workflow based on feedback history
   */
  static async getLearnedCorrections(workflowId: string): Promise<import('./execution-feedback').StepCorrections> {
    const { aggregateFeedback } = await import('./execution-feedback');
    const feedback = await this.getExecutionFeedback(workflowId);
    return aggregateFeedback(feedback);
  }

  /**
   * Get feedback analysis/patterns for a workflow
   */
  static async getFeedbackAnalysis(workflowId: string): Promise<{
    overallSuccessRate: number;
    commonFailureSteps: number[];
    effectiveRecoveryStrategies: string[];
    averageExecutionTime: number;
  }> {
    const { analyzeFeedbackPatterns } = await import('./execution-feedback');
    const feedback = await this.getExecutionFeedback(workflowId);
    return analyzeFeedbackPatterns(feedback);
  }

  /**
   * Clear execution feedback for a workflow
   */
  static async clearExecutionFeedback(workflowId: string): Promise<void> {
    const key = this.getFeedbackKey(workflowId);

    try {
      await chrome.storage.local.remove(key);
      console.log(`[Storage] Cleared execution feedback for workflow ${workflowId}`);
    } catch (error) {
      console.error('Error clearing execution feedback:', error);
    }
  }
}














