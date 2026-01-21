/**
 * Skill Module
 *
 * Exports all skill-related types and functions.
 */

// Types
export type {
  Skill,
  SkillGoal,
  SkillKnowledge,
  KnowledgeRule,
  SkillInputs,
  SkillInput,
  SkillInputType,
  SkillSuccessCriteria,
  SuccessCheck,
  SuccessCheckType,
  SkillMilestone,
  SkillDemonstration,
  DemoStepSummary,
  ElementHints,
  SkillTriggers,
  SkillExperience,
  SkillCorrection,
  SkillMetadata,
  SkillSummary,
  SkillIndex,
  SkillExecutionContext,
  ExecutionAction,
} from './types';

// Skill View (getSkill)
export { getSkill, getSkillSummary } from './skill-view';

// Skill Storage
export { SkillStorage } from './skill-storage';

// Skill Index
export {
  buildSkillIndex,
  findSkillsForQuery,
  findBestSkillForQuery,
  getSkillsForDomain,
  getSkillsForApplication,
  getDomainStats,
  getApplicationStats,
  serializeIndex,
  deserializeIndex,
} from './skill-index';

export type { SkillMatch } from './skill-index';
