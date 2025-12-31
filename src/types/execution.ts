/**
 * Execution Types for GhostWriter Extension
 * 
 * These types support the Smart Iterator feature and context overrides
 * for looping through list/table items during workflow execution.
 */

/**
 * Context for step execution that allows overriding the target element
 * Used by SmartIterator to hijack execution and target specific elements
 */
export interface ExecutionContext {
  /** Override element for iteration - bypasses normal element finding */
  targetElement?: HTMLElement;
  
  /** Current iteration index (0, 1, 2...) for tracking progress */
  iterationIndex?: number;
  
  /** Flag indicating if we're in iteration mode */
  isIterating?: boolean;
}

/**
 * Result from executing a single workflow step
 * Provides success status, timing, and error information
 */
export interface ExecutionResult {
  /** Whether the step executed successfully */
  success: boolean;
  
  /** Error message if execution failed */
  error?: string;
  
  /** The element that was acted upon (for debugging/chaining) */
  element?: Element;
  
  /** Execution time in milliseconds */
  elapsedMs?: number;
}







