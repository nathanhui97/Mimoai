/**
 * Runtime patch types for selector updates during execution
 */

/**
 * Selector patch created when AI successfully recovers an element
 */
export interface SelectorPatch {
  stepId: string;
  originalSelector: string;
  newSelector: string;
  timestamp: number;
  confidence: number;
  stepIndex?: number; // For reference
}

/**
 * Collection of patches applied during execution
 */
export interface PatchCollection {
  patches: SelectorPatch[];
  createdAt: number;
  workflowId?: string;
}









