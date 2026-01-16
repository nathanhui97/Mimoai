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
  TeachableSkill,
  SkillExample,
  SkillVariable,
  SkillPrerequisite,
} from '../types/skill';
import { aiConfig } from './ai-config';

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

// ============================================================================
// TeachableSkill Library (for AI Orchestration)
// ============================================================================

const TEACHABLE_SKILLS_KEY = 'ghostwriter-teachable-skills';
const SKILLS_SYNC_KEY = 'ghostwriter-skills-last-sync';

/**
 * TeachableSkill Library - manages user-taught skills
 * Uses Chrome storage for fast local access + Supabase for cloud persistence
 */
export class TeachableSkillLibrary {
  private static readonly EDGE_FUNCTION = 'skill_library';

  // ========== Local Storage Operations ==========

  /**
   * Save skill to local Chrome storage
   */
  static async saveSkillLocally(skill: TeachableSkill): Promise<void> {
    const skills = await this.loadSkillsLocally();
    const existingIndex = skills.findIndex(s => s.id === skill.id);

    if (existingIndex >= 0) {
      skills[existingIndex] = skill;
    } else {
      skills.push(skill);
    }

    await chrome.storage.local.set({ [TEACHABLE_SKILLS_KEY]: skills });
  }

  /**
   * Load all skills from local Chrome storage
   */
  static async loadSkillsLocally(): Promise<TeachableSkill[]> {
    const result = await chrome.storage.local.get(TEACHABLE_SKILLS_KEY);
    const skills = result[TEACHABLE_SKILLS_KEY];
    return Array.isArray(skills) ? skills : [];
  }

  /**
   * Delete skill from local storage
   */
  static async deleteSkillLocally(id: string): Promise<boolean> {
    const skills = await this.loadSkillsLocally();
    const index = skills.findIndex(s => s.id === id);

    if (index < 0) return false;

    skills.splice(index, 1);
    await chrome.storage.local.set({ [TEACHABLE_SKILLS_KEY]: skills });
    return true;
  }

  // ========== Supabase Cloud Operations ==========

  /**
   * Save skill to Supabase (cloud persistence)
   */
  static async saveSkillToCloud(skill: TeachableSkill): Promise<{ success: boolean; error?: string }> {
    const config = aiConfig.getConfig();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const url = `${config.supabaseUrl}/functions/v1/${this.EDGE_FUNCTION}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          action: 'save',
          skill: this.serializeSkillForCloud(skill),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Load all skills from Supabase
   */
  static async loadSkillsFromCloud(): Promise<{ skills: TeachableSkill[]; error?: string }> {
    const config = aiConfig.getConfig();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return { skills: [], error: 'Supabase not configured' };
    }

    try {
      const url = `${config.supabaseUrl}/functions/v1/${this.EDGE_FUNCTION}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ action: 'list' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { skills: [], error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json();
      const skills = (data.skills || []).map((s: unknown) => this.deserializeSkillFromCloud(s));
      return { skills };
    } catch (error) {
      return { skills: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Delete skill from Supabase
   */
  static async deleteSkillFromCloud(id: string): Promise<{ success: boolean; error?: string }> {
    const config = aiConfig.getConfig();

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const url = `${config.supabaseUrl}/functions/v1/${this.EDGE_FUNCTION}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ action: 'delete', skillId: id }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ========== Unified Operations (Local + Cloud) ==========

  /**
   * Save skill to both local storage and cloud
   * Local save is immediate, cloud save is async
   */
  static async saveSkill(skill: TeachableSkill): Promise<void> {
    // Always save locally first (fast)
    await this.saveSkillLocally(skill);

    // Then sync to cloud (async, don't block)
    this.saveSkillToCloud(skill).then(result => {
      if (!result.success) {
        console.warn('[SkillLibrary] Cloud save failed:', result.error);
      }
    });
  }

  /**
   * Get all skills (local first, then merge with cloud if available)
   */
  static async getSkills(): Promise<TeachableSkill[]> {
    // Return local skills immediately
    return await this.loadSkillsLocally();
  }

  /**
   * Sync skills with cloud (pull from cloud, merge with local)
   */
  static async syncWithCloud(): Promise<{ success: boolean; merged: number; error?: string }> {
    const cloudResult = await this.loadSkillsFromCloud();

    if (cloudResult.error) {
      return { success: false, merged: 0, error: cloudResult.error };
    }

    const localSkills = await this.loadSkillsLocally();
    const cloudSkills = cloudResult.skills;

    // Merge: cloud skills override local if newer, local skills added if not in cloud
    const merged = this.mergeSkills(localSkills, cloudSkills);

    await chrome.storage.local.set({ [TEACHABLE_SKILLS_KEY]: merged });
    await chrome.storage.local.set({ [SKILLS_SYNC_KEY]: Date.now() });

    return { success: true, merged: merged.length };
  }

  /**
   * Delete skill from both local and cloud
   */
  static async deleteSkill(id: string): Promise<boolean> {
    const localDeleted = await this.deleteSkillLocally(id);

    // Delete from cloud async
    this.deleteSkillFromCloud(id).then(result => {
      if (!result.success) {
        console.warn('[SkillLibrary] Cloud delete failed:', result.error);
      }
    });

    return localDeleted;
  }

  // ========== Search and Matching ==========

  /**
   * Find skills by intent (for AI orchestrator matching)
   * Uses fuzzy matching on name, description, synonyms, and examples
   */
  static async findSkillsByIntent(intent: string): Promise<TeachableSkill[]> {
    const skills = await this.getSkills();
    const intentLower = intent.toLowerCase();
    const words = intentLower.split(/\s+/).filter(w => w.length > 2);

    // Score each skill
    const scored = skills.map(skill => {
      let score = 0;

      // Name match (highest weight)
      if (skill.name.toLowerCase().includes(intentLower)) {
        score += 10;
      } else {
        for (const word of words) {
          if (skill.name.toLowerCase().includes(word)) score += 3;
        }
      }

      // Description match
      for (const word of words) {
        if (skill.description.toLowerCase().includes(word)) score += 1;
      }

      // Synonym match
      for (const synonym of skill.synonyms) {
        if (synonym.toLowerCase().includes(intentLower)) {
          score += 8;
        } else {
          for (const word of words) {
            if (synonym.toLowerCase().includes(word)) score += 2;
          }
        }
      }

      // Example match (from successful executions)
      for (const example of skill.examples) {
        if (example.userRequest.toLowerCase().includes(intentLower)) {
          score += 6;
        } else {
          for (const word of words) {
            if (example.userRequest.toLowerCase().includes(word)) score += 1;
          }
        }
      }

      // Usage context match
      for (const word of words) {
        if (skill.usageContext.toLowerCase().includes(word)) score += 1;
      }

      return { skill, score };
    });

    // Return skills with score > 0, sorted by score descending
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.skill);
  }

  /**
   * Find skills that match required context (page URL, elements present)
   */
  static async findSkillsForContext(
    pageUrl: string,
    _availableElements?: string[]  // Reserved for future element-based context matching
  ): Promise<TeachableSkill[]> {
    const skills = await this.getSkills();

    return skills.filter(skill => {
      // Check URL patterns in required context
      for (const context of skill.requiredContext) {
        // Simple glob-like matching (supports * wildcard)
        const pattern = context.replace(/\*/g, '.*');
        if (new RegExp(pattern, 'i').test(pageUrl)) {
          return true;
        }
      }

      // If no context requirements, skill is available everywhere
      return skill.requiredContext.length === 0;
    });
  }

  // ========== Execution Tracking ==========

  /**
   * Record a skill execution result (for learning)
   */
  static async recordExecution(
    skillId: string,
    success: boolean,
    example?: SkillExample
  ): Promise<void> {
    const skills = await this.loadSkillsLocally();
    const skill = skills.find(s => s.id === skillId);

    if (!skill) return;

    // Update counts
    if (success) {
      skill.successCount++;
    } else {
      skill.failureCount++;
    }

    // Update last used
    skill.lastUsed = Date.now();

    // Add example if provided (limit to last 20 examples)
    if (example) {
      skill.examples = [...skill.examples, example].slice(-20);
    }

    // Save updated skill
    await this.saveSkill(skill);
  }

  // ========== Helper Methods ==========

  /**
   * Merge local and cloud skills (cloud wins if newer)
   */
  private static mergeSkills(
    local: TeachableSkill[],
    cloud: TeachableSkill[]
  ): TeachableSkill[] {
    const merged = new Map<string, TeachableSkill>();

    // Add all local skills
    for (const skill of local) {
      merged.set(skill.id, skill);
    }

    // Override with cloud skills if newer
    for (const cloudSkill of cloud) {
      const localSkill = merged.get(cloudSkill.id);

      if (!localSkill) {
        // New skill from cloud
        merged.set(cloudSkill.id, cloudSkill);
      } else if (cloudSkill.lastUsed && localSkill.lastUsed) {
        // Take the more recently used version
        if (cloudSkill.lastUsed > localSkill.lastUsed) {
          merged.set(cloudSkill.id, cloudSkill);
        }
      } else if (cloudSkill.createdAt > localSkill.createdAt) {
        // Fall back to creation date
        merged.set(cloudSkill.id, cloudSkill);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Serialize skill for cloud storage (convert to JSON-safe format)
   */
  private static serializeSkillForCloud(skill: TeachableSkill): Record<string, unknown> {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      usage_context: skill.usageContext,
      steps: skill.steps,
      variables: skill.variables,
      synonyms: skill.synonyms,
      required_context: skill.requiredContext,
      prerequisites: skill.prerequisites,
      provides: skill.provides,
      user_id: skill.userId,
      created_at: skill.createdAt,
      last_used: skill.lastUsed,
      success_count: skill.successCount,
      failure_count: skill.failureCount,
      examples: skill.examples,
    };
  }

  /**
   * Deserialize skill from cloud storage
   */
  private static deserializeSkillFromCloud(data: unknown): TeachableSkill {
    const d = data as Record<string, unknown>;
    return {
      id: d.id as string,
      name: d.name as string,
      description: d.description as string || '',
      usageContext: d.usage_context as string || '',
      steps: d.steps as TeachableSkill['steps'] || [],
      variables: d.variables as SkillVariable[] || [],
      synonyms: d.synonyms as string[] || [],
      requiredContext: d.required_context as string[] || [],
      prerequisites: d.prerequisites as SkillPrerequisite[] || [],
      provides: d.provides as string[] || [],
      userId: d.user_id as string | undefined,
      createdAt: d.created_at as number || Date.now(),
      lastUsed: d.last_used as number | undefined,
      successCount: d.success_count as number || 0,
      failureCount: d.failure_count as number || 0,
      examples: d.examples as SkillExample[] || [],
    };
  }

  /**
   * Create a new empty skill template
   */
  static createEmptySkill(name: string, description: string): TeachableSkill {
    return {
      id: generateSkillId(),
      name,
      description,
      usageContext: '',
      steps: [],
      variables: [],
      synonyms: [],
      requiredContext: [],
      prerequisites: [],
      provides: [],
      createdAt: Date.now(),
      successCount: 0,
      failureCount: 0,
      examples: [],
    };
  }
}
