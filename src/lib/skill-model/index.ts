/**
 * Skill Model Module - Public API
 *
 * Provides field-level procedural knowledge for workflow execution.
 * The Skill Model is the bridge between recording and planning:
 *
 *   Recording → SkillExtractor → SkillModel → PagePlanner → PlanExecutor
 *
 * Import from this file to access skill model components.
 */

// Types
export type {
  SkillModel,
  PageSkill,
  FieldKnowledge,
  ActionKnowledge,
  FieldSelector,
  CrossPageDependency,
} from './types';

// Extractor
export { SkillExtractor } from './extractor';
