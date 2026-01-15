/**
 * Skill Storage Service
 *
 * Manages skill library persistence in Chrome storage.
 * Provides CRUD operations and smart search for skills.
 */

import type {
  SkillDefinition,
  SkillSummary,
  SkillLibraryMetadata,
} from '../types/skill';

const STORAGE_KEY = 'ghostwriter-skills';
const METADATA_KEY = 'ghostwriter-skills-metadata';

/**
 * Skill Storage Service
 */
export class SkillStorage {
  /**
   * Save a skill to the library
   */
  static async saveSkill(skill: SkillDefinition): Promise<void> {
    const skills = await this.loadSkills();

    // Check for existing skill with same ID (update) or add new
    const existingIndex = skills.findIndex(s => s.id === skill.id);
    if (existingIndex >= 0) {
      skills[existingIndex] = skill;
    } else {
      skills.push(skill);
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: skills });
    await this.updateMetadata(skills);
  }

  /**
   * Save multiple skills at once (batch operation)
   */
  static async saveSkills(newSkills: SkillDefinition[]): Promise<void> {
    const skills = await this.loadSkills();

    for (const skill of newSkills) {
      const existingIndex = skills.findIndex(s => s.id === skill.id);
      if (existingIndex >= 0) {
        skills[existingIndex] = skill;
      } else {
        skills.push(skill);
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: skills });
    await this.updateMetadata(skills);
  }

  /**
   * Load all skills from the library
   */
  static async loadSkills(): Promise<SkillDefinition[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const skills = result[STORAGE_KEY];
    return Array.isArray(skills) ? skills : [];
  }

  /**
   * Load a single skill by ID
   */
  static async loadSkill(id: string): Promise<SkillDefinition | null> {
    const skills = await this.loadSkills();
    return skills.find(s => s.id === id) || null;
  }

  /**
   * Delete a skill by ID
   */
  static async deleteSkill(id: string): Promise<boolean> {
    const skills = await this.loadSkills();
    const index = skills.findIndex(s => s.id === id);

    if (index < 0) return false;

    skills.splice(index, 1);
    await chrome.storage.local.set({ [STORAGE_KEY]: skills });
    await this.updateMetadata(skills);
    return true;
  }

  /**
   * Delete multiple skills at once
   */
  static async deleteSkills(ids: string[]): Promise<number> {
    const skills = await this.loadSkills();
    const idSet = new Set(ids);
    const filtered = skills.filter(s => !idSet.has(s.id));
    const deletedCount = skills.length - filtered.length;

    if (deletedCount > 0) {
      await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
      await this.updateMetadata(filtered);
    }

    return deletedCount;
  }

  /**
   * Find skills by intent (verb + object matching with synonyms)
   */
  static async findSkillsByIntent(
    verb: string,
    object: string
  ): Promise<SkillDefinition[]> {
    const skills = await this.loadSkills();
    const verbLower = verb.toLowerCase();
    const objectLower = object.toLowerCase();

    return skills.filter(skill => {
      const { canonicalAction } = skill;

      // Check verb match
      const verbMatches =
        canonicalAction.verb.toLowerCase() === verbLower ||
        canonicalAction.verbSynonyms.some(s => s.toLowerCase() === verbLower);

      // Check object match
      const objectMatches =
        canonicalAction.object.toLowerCase() === objectLower ||
        canonicalAction.objectSynonyms.some(s => s.toLowerCase() === objectLower);

      return verbMatches && objectMatches;
    });
  }

  /**
   * Find skills by partial text match (search)
   */
  static async searchSkills(query: string): Promise<SkillDefinition[]> {
    const skills = await this.loadSkills();
    const queryLower = query.toLowerCase();

    return skills.filter(skill => {
      return (
        skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower) ||
        skill.canonicalAction.verb.toLowerCase().includes(queryLower) ||
        skill.canonicalAction.object.toLowerCase().includes(queryLower) ||
        skill.canonicalAction.verbSynonyms.some(s =>
          s.toLowerCase().includes(queryLower)
        ) ||
        skill.canonicalAction.objectSynonyms.some(s =>
          s.toLowerCase().includes(queryLower)
        )
      );
    });
  }

  /**
   * Get all repeatable skills
   */
  static async getRepeatableSkills(): Promise<SkillDefinition[]> {
    const skills = await this.loadSkills();
    return skills.filter(s => s.isRepeatable);
  }

  /**
   * Get skills from a specific source workflow
   */
  static async getSkillsByWorkflow(
    workflowId: string
  ): Promise<SkillDefinition[]> {
    const skills = await this.loadSkills();
    return skills.filter(s => s.sourceWorkflowId === workflowId);
  }

  /**
   * Get skill summaries (lightweight for UI lists)
   */
  static async getSkillSummaries(): Promise<SkillSummary[]> {
    const skills = await this.loadSkills();
    return skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      verb: skill.canonicalAction.verb,
      object: skill.canonicalAction.object,
      isRepeatable: skill.isRepeatable,
      variableCount: skill.variables.length,
      stepCount: skill.steps.length,
      sourceWorkflowName: skill.sourceWorkflowName,
      extractedAt: skill.extractedAt,
    }));
  }

  /**
   * Get library metadata
   */
  static async getMetadata(): Promise<SkillLibraryMetadata> {
    const result = await chrome.storage.local.get(METADATA_KEY);
    const metadata = result[METADATA_KEY];
    if (metadata && typeof metadata === 'object' && 'totalSkills' in metadata) {
      return metadata as SkillLibraryMetadata;
    }
    return {
      totalSkills: 0,
      lastUpdated: 0,
      skillsByVerb: {},
    };
  }

  /**
   * Update metadata after skill changes
   */
  private static async updateMetadata(
    skills: SkillDefinition[]
  ): Promise<void> {
    const skillsByVerb: Record<string, number> = {};

    for (const skill of skills) {
      const verb = skill.canonicalAction.verb.toLowerCase();
      skillsByVerb[verb] = (skillsByVerb[verb] || 0) + 1;
    }

    const metadata: SkillLibraryMetadata = {
      totalSkills: skills.length,
      lastUpdated: Date.now(),
      skillsByVerb,
    };

    await chrome.storage.local.set({ [METADATA_KEY]: metadata });
  }

  /**
   * Clear all skills (use with caution)
   */
  static async clearAll(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY, METADATA_KEY]);
  }

  /**
   * Export skills as JSON (for backup)
   */
  static async exportSkills(): Promise<string> {
    const skills = await this.loadSkills();
    return JSON.stringify(skills, null, 2);
  }

  /**
   * Import skills from JSON (for restore)
   */
  static async importSkills(json: string, merge = true): Promise<number> {
    const imported: SkillDefinition[] = JSON.parse(json);

    if (!Array.isArray(imported)) {
      throw new Error('Invalid skill data format');
    }

    if (merge) {
      await this.saveSkills(imported);
    } else {
      await chrome.storage.local.set({ [STORAGE_KEY]: imported });
      await this.updateMetadata(imported);
    }

    return imported.length;
  }
}

/**
 * Generate a unique skill ID
 */
export function generateSkillId(): string {
  return `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
