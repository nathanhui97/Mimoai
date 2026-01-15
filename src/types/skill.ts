/**
 * Skill Types for GhostWriter Extension
 *
 * Skills are reusable, composable units extracted from recorded workflows.
 * They can be repeated, parameterized, and chained together.
 */

import type { WorkflowStep } from './workflow';
import type { VariableDefinition } from '../lib/variable-detector';

// ============================================================================
// Annotation Types (for inline narration during recording)
// ============================================================================

/**
 * Pattern detected in user annotation text
 */
export interface AnnotationPattern {
  type: 'skill_start' | 'skill_end' | 'repeatable' | 'selection_all' | 'selection_first' | 'instruction' | 'edge_case';
  phrase: string;      // The phrase that triggered this pattern
  confidence: number;  // 0-1 confidence in detection
}

/**
 * Annotation attached to a workflow step (or workflow-level)
 */
export interface StepAnnotation {
  text: string;                              // Raw annotation text
  attachedToStepIndex: number;               // Step index (-1 for workflow-level)
  timestamp: number;                         // When annotation was added
  detectedPatterns: AnnotationPattern[];     // Patterns detected in the text
}

/**
 * Parsed result from annotation text
 */
export interface ParsedAnnotation {
  rawText: string;
  patterns: AnnotationPattern[];
  suggestedSkillName?: string;    // From "This is how we {create a promotion}"
  variables?: string[];           // Extracted from "for each {item}"
}

/**
 * Skill boundary detected from annotations
 */
export interface SkillBoundary {
  start: number;              // Start step index (inclusive)
  end: number;                // End step index (inclusive)
  suggestedName?: string;     // Name suggested from annotations
  confidence: number;         // Confidence in this boundary
  source: 'annotation' | 'ai-analysis' | 'user-adjusted';
}

// ============================================================================
// Skill Definition Types
// ============================================================================

/**
 * Canonical action for skill matching
 * Allows matching user requests like "add item" to "insert product"
 */
export interface CanonicalAction {
  verb: string;              // "add", "create", "submit"
  verbSynonyms: string[];    // ["insert", "make", "save"]
  object: string;            // "item", "promotion", "order"
  objectSynonyms: string[];  // ["product", "promo", "request"]
}

/**
 * Edge case handling instruction
 */
export interface EdgeCase {
  condition: string;   // "multiple matches from different stores"
  action: string;      // "select all of them"
}

/**
 * Skill dependencies for chaining
 */
export interface SkillDependencies {
  requires: string[];      // Skill IDs that MUST run before this skill
  optional: string[];      // Skills that SHOULD run before if available
  enables: string[];       // Skills that can run AFTER this skill
  position: 'start' | 'middle' | 'end' | 'any';  // Typical position in workflow
}

/**
 * A reusable, composable skill extracted from a workflow
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;

  // Action identification (for skill matching)
  canonicalAction: CanonicalAction;

  // Step data
  steps: WorkflowStep[];
  stepRange: { start: number; end: number };  // Original indices in source workflow

  // Parameterization
  variables: VariableDefinition[];
  constants: Array<{ name: string; value: string }>;

  // Behavior flags
  isRepeatable: boolean;
  repeatHint?: string;  // "for each item", "until list empty"
  selectionBehavior: 'first' | 'all' | 'ask' | null;

  // Instructions and edge cases
  instructions: string[];
  edgeCases: EdgeCase[];

  // Skill Chaining (Dependencies)
  dependencies: SkillDependencies;

  // Metadata
  sourceWorkflowId: string;
  sourceWorkflowName: string;
  extractedAt: number;
  confidence: number;  // Overall confidence in skill extraction
}

// ============================================================================
// Skill Request Parsing Types (Runtime)
// ============================================================================

/**
 * A matched skill from parsing a user request
 */
export interface SkillMatch {
  skillId: string;
  matchConfidence: number;
  variables: Record<string, string>;  // Variable name → value
  repeatCount: number;                // How many times to run
  reasoning: string;                  // Why this skill was matched
}

/**
 * Result of parsing a user request against available skills
 */
export interface ParsedSkillRequest {
  matches: SkillMatch[];
  executionOrder: string[];  // Skill IDs in execution sequence
  overallConfidence: number;
  fromCache: boolean;
}

// ============================================================================
// Skill Extraction Types (Post-Recording)
// ============================================================================

/**
 * AI-suggested skill from auto-analysis (for unannotated workflows)
 */
export interface SuggestedSkill {
  name: string;
  startStep: number;
  endStep: number;
  isRepeatable: boolean;
  repeatHint?: string;
  variables: string[];           // Variable names to parameterize
  selectionBehavior: 'first' | 'all' | 'ask' | null;
  confidence: number;
  reasoning: string;
}

/**
 * Response from AI skill analysis
 */
export interface SkillAnalysisResult {
  skills: SuggestedSkill[];
  overallConfidence: number;
  analysisMethod: 'annotation-based' | 'ai-auto' | 'hybrid';
}

// ============================================================================
// Skill Library Storage Types
// ============================================================================

/**
 * Summary of a skill for display in UI (lightweight)
 */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  verb: string;                    // From canonicalAction
  object: string;                  // From canonicalAction
  isRepeatable: boolean;
  variableCount: number;
  stepCount: number;
  sourceWorkflowName: string;
  extractedAt: number;
}

/**
 * Skill library metadata
 */
export interface SkillLibraryMetadata {
  totalSkills: number;
  lastUpdated: number;
  skillsByVerb: Record<string, number>;  // Verb → count
}

// ============================================================================
// Skill Execution Types (Runtime)
// ============================================================================

/**
 * State of a skill execution
 */
export interface SkillExecutionState {
  skillId: string;
  skillName: string;
  currentIteration: number;
  totalIterations: number;          // Infinity for "until done"
  currentStepIndex: number;
  totalSteps: number;
  variables: Record<string, string>;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: number;
  error?: string;
}

/**
 * Result of executing a skill
 */
export interface SkillExecutionResult {
  skillId: string;
  success: boolean;
  iterationsCompleted: number;
  durationMs: number;
  error?: string;
  stepResults: Array<{
    stepIndex: number;
    success: boolean;
    error?: string;
  }>;
}
