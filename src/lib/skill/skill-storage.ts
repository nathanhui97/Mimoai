/**
 * Skill Storage
 *
 * Provides CRUD operations for Skills using the existing WorkflowStorage.
 * Skills are views on top of SavedWorkflows, so this is a thin wrapper
 * that handles the conversion.
 */

import { WorkflowStorage } from '../storage';
import type { SavedWorkflow } from '../../types/workflow';
import type { Skill, SkillSummary, SkillIndex } from './types';
import { getSkill, getSkillSummary } from './skill-view';
import { buildSkillIndex } from './skill-index';

// ============================================================================
// Skill Storage Class
// ============================================================================

export class SkillStorage {
  /**
   * Get all skills
   */
  static async getAllSkills(): Promise<Skill[]> {
    const workflows = await WorkflowStorage.loadWorkflows();
    return workflows.map(getSkill);
  }

  /**
   * Get all skill summaries (lightweight, for lists)
   */
  static async getAllSkillSummaries(): Promise<SkillSummary[]> {
    const workflows = await WorkflowStorage.loadWorkflows();
    return workflows.map(getSkillSummary);
  }

  /**
   * Get a skill by ID
   */
  static async getSkillById(id: string): Promise<Skill | null> {
    const workflow = await WorkflowStorage.loadWorkflow(id);
    if (!workflow) return null;
    return getSkill(workflow);
  }

  /**
   * Get a skill summary by ID
   */
  static async getSkillSummaryById(id: string): Promise<SkillSummary | null> {
    const workflow = await WorkflowStorage.loadWorkflow(id);
    if (!workflow) return null;
    return getSkillSummary(workflow);
  }

  /**
   * Get skills by domain
   */
  static async getSkillsByDomain(domain: string): Promise<Skill[]> {
    const skills = await this.getAllSkills();
    return skills.filter(s =>
      s.goal.domain.toLowerCase() === domain.toLowerCase()
    );
  }

  /**
   * Get skills by application
   */
  static async getSkillsByApplication(application: string): Promise<Skill[]> {
    const skills = await this.getAllSkills();
    return skills.filter(s =>
      s.metadata.application?.toLowerCase() === application.toLowerCase()
    );
  }

  /**
   * Search skills by query (matches triggers, name, goal)
   */
  static async searchSkills(query: string): Promise<Skill[]> {
    const queryLower = query.toLowerCase();
    const skills = await this.getAllSkills();

    return skills.filter(skill => {
      // Match name
      if (skill.name.toLowerCase().includes(queryLower)) return true;

      // Match goal
      if (skill.goal.description.toLowerCase().includes(queryLower)) return true;
      if (skill.goal.summary.toLowerCase().includes(queryLower)) return true;

      // Match triggers
      for (const phrase of skill.triggers.phrases) {
        if (phrase.toLowerCase().includes(queryLower)) return true;
      }

      // Match verb synonyms
      for (const verb of skill.triggers.verbSynonyms) {
        if (verb.toLowerCase().includes(queryLower)) return true;
      }

      // Match object synonyms
      for (const obj of skill.triggers.objectSynonyms) {
        if (obj.toLowerCase().includes(queryLower)) return true;
      }

      return false;
    });
  }

  /**
   * Get or build the skill index
   */
  static async getSkillIndex(): Promise<SkillIndex> {
    const skills = await this.getAllSkills();
    return buildSkillIndex(skills);
  }

  /**
   * Update skill experience after execution
   */
  static async updateSkillExperience(
    skillId: string,
    executionResult: {
      success: boolean;
      durationMs: number;
      issues?: string[];
      strategies?: string[];
    }
  ): Promise<void> {
    const workflow = await WorkflowStorage.loadWorkflow(skillId);
    if (!workflow) return;

    // Update execution stats
    const stats = workflow.executionStats || {
      totalRuns: 0,
      successfulRuns: 0,
      lastRun: 0,
      averageDurationMs: 0,
      commonFailurePoints: [],
    };

    stats.totalRuns++;
    if (executionResult.success) {
      stats.successfulRuns++;
    }
    stats.lastRun = Date.now();
    stats.averageDurationMs = (
      (stats.averageDurationMs * (stats.totalRuns - 1)) + executionResult.durationMs
    ) / stats.totalRuns;

    // Update memory experience if available
    if (workflow.memory?.experience) {
      workflow.memory.experience.timesExecuted = stats.totalRuns;
      workflow.memory.experience.successfulExecutions = stats.successfulRuns;
      workflow.memory.experience.successRate = stats.totalRuns > 0
        ? stats.successfulRuns / stats.totalRuns
        : 0;
      workflow.memory.experience.lastExecuted = stats.lastRun;
      workflow.memory.experience.averageDuration = stats.averageDurationMs;

      // Add new issues
      if (executionResult.issues?.length) {
        const existingIssues = workflow.memory.experience.troubleSpots?.map(t => t.issue) || [];
        for (const issue of executionResult.issues) {
          if (!existingIssues.includes(issue)) {
            workflow.memory.experience.troubleSpots = workflow.memory.experience.troubleSpots || [];
            workflow.memory.experience.troubleSpots.push({
              stepIndex: -1, // Unknown
              issue,
              solution: 'To be determined',
              frequency: 0.1,
            });
          }
        }
      }

      // Add proven strategies
      if (executionResult.strategies?.length && executionResult.success) {
        const existingStrategies = workflow.memory.experience.provenStrategies?.map(s => s.strategy) || [];
        for (const strategy of executionResult.strategies) {
          if (!existingStrategies.includes(strategy)) {
            workflow.memory.experience.provenStrategies = workflow.memory.experience.provenStrategies || [];
            workflow.memory.experience.provenStrategies.push({
              situation: 'General',
              strategy,
              effectiveness: 0.8,
            });
          }
        }
      }
    }

    // Save updated workflow
    workflow.executionStats = stats;
    workflow.updatedAt = Date.now();
    await WorkflowStorage.saveWorkflow(workflow, { skipMemoryGeneration: true });
  }

  /**
   * Add a correction to a skill
   */
  static async addSkillCorrection(
    skillId: string,
    correction: {
      correction: string;
      learning?: string;
    }
  ): Promise<void> {
    const workflow = await WorkflowStorage.loadWorkflow(skillId);
    if (!workflow || !workflow.memory) return;

    // Add correction to memory
    workflow.memory.experience = workflow.memory.experience || {
      timesExecuted: 0,
      successfulExecutions: 0,
      successRate: 0,
      troubleSpots: [],
      provenStrategies: [],
    };

    workflow.memory.experience.userCorrections = workflow.memory.experience.userCorrections || [];
    workflow.memory.experience.userCorrections.push({
      correction: correction.correction,
      timestamp: Date.now(),
    });

    // Save updated workflow
    workflow.updatedAt = Date.now();
    await WorkflowStorage.saveWorkflow(workflow, { skipMemoryGeneration: true });
  }

  /**
   * Delete a skill (deletes underlying workflow)
   */
  static async deleteSkill(skillId: string): Promise<void> {
    await WorkflowStorage.deleteWorkflow(skillId);
  }

  /**
   * Check if a skill exists
   */
  static async skillExists(skillId: string): Promise<boolean> {
    const workflow = await WorkflowStorage.loadWorkflow(skillId);
    return workflow !== null;
  }

  /**
   * Get skills that match a URL pattern
   */
  static async getSkillsForUrl(url: string): Promise<Skill[]> {
    const skills = await this.getAllSkills();

    return skills.filter(skill => {
      if (!skill.metadata.urlPatterns?.length) return false;

      for (const pattern of skill.metadata.urlPatterns) {
        try {
          // Simple pattern matching (supports * wildcard)
          const regex = new RegExp(
            pattern.replace(/\*/g, '.*').replace(/\//g, '\\/')
          );
          if (regex.test(url)) return true;
        } catch {
          // Invalid pattern, try simple includes
          if (url.includes(pattern.replace(/\*/g, ''))) return true;
        }
      }

      return false;
    });
  }

  /**
   * Get ready skills (skills that are complete enough to execute)
   */
  static async getReadySkills(): Promise<Skill[]> {
    const skills = await this.getAllSkills();
    return skills.filter(s => s.metadata.isReady);
  }

  /**
   * Get skill count
   */
  static async getSkillCount(): Promise<number> {
    const workflows = await WorkflowStorage.loadWorkflows();
    return workflows.length;
  }

  /**
   * Get skill statistics
   */
  static async getSkillStats(): Promise<{
    total: number;
    ready: number;
    byDomain: Record<string, number>;
    totalExecutions: number;
    averageSuccessRate: number;
  }> {
    const skills = await this.getAllSkills();

    const byDomain: Record<string, number> = {};
    let totalExecutions = 0;
    let totalSuccessRate = 0;
    let skillsWithExecutions = 0;

    for (const skill of skills) {
      // Count by domain
      const domain = skill.goal.domain || 'General';
      byDomain[domain] = (byDomain[domain] || 0) + 1;

      // Aggregate execution stats
      totalExecutions += skill.experience.timesExecuted;
      if (skill.experience.timesExecuted > 0) {
        totalSuccessRate += skill.experience.successRate;
        skillsWithExecutions++;
      }
    }

    return {
      total: skills.length,
      ready: skills.filter(s => s.metadata.isReady).length,
      byDomain,
      totalExecutions,
      averageSuccessRate: skillsWithExecutions > 0
        ? totalSuccessRate / skillsWithExecutions
        : 0,
    };
  }
}
