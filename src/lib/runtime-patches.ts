/**
 * Runtime Patch System
 * 
 * Manages selector patches created during workflow execution when AI recovers elements.
 * Patches are stored in-memory and can be optionally saved to the workflow after execution.
 */

import type { SelectorPatch, PatchCollection } from '../types/patches';
import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

export class RuntimePatches {
  private static patches: Map<string, SelectorPatch> = new Map();
  private static currentWorkflowId: string | undefined;

  /**
   * Initialize patch collection for a workflow execution
   */
  static initialize(workflowId?: string): void {
    this.patches.clear();
    this.currentWorkflowId = workflowId;
  }

  /**
   * Add a patch for a recovered selector
   */
  static addPatch(patch: SelectorPatch): void {
    // Use stepId as key to avoid duplicates
    this.patches.set(patch.stepId, patch);
    console.log(`[RuntimePatches] Added patch for step ${patch.stepId}: ${patch.originalSelector} -> ${patch.newSelector}`);
  }

  /**
   * Get all patches
   */
  static getPatches(): SelectorPatch[] {
    return Array.from(this.patches.values());
  }

  /**
   * Get patch count
   */
  static getPatchCount(): number {
    return this.patches.size;
  }

  /**
   * Check if there are any patches
   */
  static hasPatches(): boolean {
    return this.patches.size > 0;
  }

  /**
   * Get patch collection for saving
   */
  static getCollection(): PatchCollection {
    return {
      patches: this.getPatches(),
      createdAt: Date.now(),
      workflowId: this.currentWorkflowId,
    };
  }

  /**
   * Apply patches to workflow steps
   * Updates selectors in-place
   */
  static applyPatchesToWorkflow(steps: WorkflowStep[]): number {
    let appliedCount = 0;

    for (const patch of this.patches.values()) {
      const step = steps.find(s => {
        if (isWorkflowStepPayload(s.payload)) {
          return String(s.payload.timestamp) === patch.stepId;
        }
        return false;
      });

      if (step && isWorkflowStepPayload(step.payload)) {
        // Update the primary selector
        step.payload.selector = patch.newSelector;
        
        // Add original selector to fallback selectors if not already there
        if (!step.payload.fallbackSelectors) {
          step.payload.fallbackSelectors = [];
        }
        if (!step.payload.fallbackSelectors.includes(patch.originalSelector)) {
          step.payload.fallbackSelectors.unshift(patch.originalSelector);
        }

        appliedCount++;
        console.log(`[RuntimePatches] Applied patch to step ${patch.stepId}`);
      }
    }

    return appliedCount;
  }

  /**
   * Clear all patches (discard without saving)
   */
  static clear(): void {
    this.patches.clear();
    this.currentWorkflowId = undefined;
  }
}







