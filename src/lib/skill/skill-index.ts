/**
 * Skill Index
 *
 * Provides fast lookup of skills by triggers, domain, application, etc.
 * The index is built from all skills and cached for quick matching.
 */

import type { Skill, SkillIndex, SkillSummary } from './types';
import { getSkillSummary } from './skill-view';

// ============================================================================
// Index Building
// ============================================================================

/**
 * Build a complete skill index from a list of skills
 */
export function buildSkillIndex(skills: Skill[]): SkillIndex {
  const phraseMap: Record<string, string[]> = {};
  const domainMap: Record<string, string[]> = {};
  const applicationMap: Record<string, string[]> = {};
  const summaries: SkillSummary[] = [];

  for (const skill of skills) {
    // Add to phrase map
    for (const phrase of skill.triggers.phrases) {
      const normalized = normalizePhrase(phrase);
      if (!phraseMap[normalized]) {
        phraseMap[normalized] = [];
      }
      if (!phraseMap[normalized].includes(skill.id)) {
        phraseMap[normalized].push(skill.id);
      }
    }

    // Add verb + object combinations to phrase map
    for (const verb of skill.triggers.verbSynonyms) {
      for (const obj of skill.triggers.objectSynonyms) {
        const phrase = normalizePhrase(`${verb} ${obj}`);
        if (!phraseMap[phrase]) {
          phraseMap[phrase] = [];
        }
        if (!phraseMap[phrase].includes(skill.id)) {
          phraseMap[phrase].push(skill.id);
        }
      }
    }

    // Add to domain map
    const domain = skill.goal.domain || 'General';
    if (!domainMap[domain]) {
      domainMap[domain] = [];
    }
    if (!domainMap[domain].includes(skill.id)) {
      domainMap[domain].push(skill.id);
    }

    // Add to application map
    if (skill.metadata.application) {
      const app = skill.metadata.application;
      if (!applicationMap[app]) {
        applicationMap[app] = [];
      }
      if (!applicationMap[app].includes(skill.id)) {
        applicationMap[app].push(skill.id);
      }
    }

    // Add summary
    summaries.push({
      id: skill.id,
      name: skill.name,
      goalSummary: skill.goal.summary,
      domain: skill.goal.domain,
      triggers: skill.triggers.phrases,
      inputNames: [
        ...skill.inputs.required.map(i => i.name),
        ...skill.inputs.optional.map(i => i.name),
      ],
      successRate: skill.experience.successRate,
      lastExecuted: skill.experience.lastExecuted,
      isReady: skill.metadata.isReady,
    });
  }

  return {
    phraseMap,
    domainMap,
    applicationMap,
    summaries,
    updatedAt: Date.now(),
  };
}

// ============================================================================
// Index Searching
// ============================================================================

/**
 * Match result with confidence score
 */
export interface SkillMatch {
  skillId: string;
  confidence: number;
  matchReason: string;
}

/**
 * Find skills matching a natural language query
 */
export function findSkillsForQuery(
  query: string,
  index: SkillIndex,
  options?: {
    maxResults?: number;
    minConfidence?: number;
    domain?: string;
    application?: string;
  }
): SkillMatch[] {
  const {
    maxResults = 5,
    minConfidence = 0.3,
    domain,
    application,
  } = options || {};

  const matches: SkillMatch[] = [];
  const queryNormalized = normalizePhrase(query);
  const queryWords = queryNormalized.split(/\s+/);

  // Get candidate skill IDs (filter by domain/application if specified)
  const candidateIdSet = new Set<string>();
  for (const summary of index.summaries) {
    if (domain && summary.domain !== domain) continue;
    if (application) {
      const skillApp = index.summaries.find(s => s.id === summary.id);
      // Skip if application doesn't match
    }
    candidateIdSet.add(summary.id);
  }
  const candidateIds = Array.from(candidateIdSet);

  // Score each candidate
  for (const skillId of candidateIds) {
    const summary = index.summaries.find(s => s.id === skillId);
    if (!summary) continue;

    let confidence = 0;
    let matchReason = '';

    // Exact phrase match (highest confidence)
    if (index.phraseMap[queryNormalized]?.includes(skillId)) {
      confidence = 0.95;
      matchReason = 'Exact phrase match';
    } else {
      // Partial phrase match
      for (const [phrase, skillIds] of Object.entries(index.phraseMap)) {
        if (skillIds.includes(skillId)) {
          if (queryNormalized.includes(phrase)) {
            confidence = Math.max(confidence, 0.8);
            matchReason = `Query contains "${phrase}"`;
          } else if (phrase.includes(queryNormalized)) {
            confidence = Math.max(confidence, 0.7);
            matchReason = `"${phrase}" contains query`;
          }
        }
      }

      // Word overlap scoring
      if (confidence < 0.5) {
        const triggerWords = new Set<string>();
        for (const trigger of summary.triggers) {
          for (const word of normalizePhrase(trigger).split(/\s+/)) {
            triggerWords.add(word);
          }
        }

        // Add name words
        for (const word of normalizePhrase(summary.name).split(/\s+/)) {
          triggerWords.add(word);
        }

        // Calculate overlap (convert Set to Array for iteration)
        const triggerWordsArray = Array.from(triggerWords);
        const overlap = queryWords.filter(w => triggerWordsArray.includes(w)).length;
        const overlapScore = overlap / Math.max(queryWords.length, 1);

        if (overlapScore > confidence) {
          confidence = overlapScore * 0.6; // Cap at 0.6 for word overlap
          matchReason = `${overlap} word(s) overlap`;
        }
      }

      // Name similarity
      const nameSimilarity = calculateSimilarity(queryNormalized, normalizePhrase(summary.name));
      if (nameSimilarity > confidence) {
        confidence = nameSimilarity * 0.7;
        matchReason = `Similar to skill name "${summary.name}"`;
      }

      // Goal similarity
      const goalSimilarity = calculateSimilarity(queryNormalized, normalizePhrase(summary.goalSummary));
      if (goalSimilarity * 0.5 > confidence) {
        confidence = goalSimilarity * 0.5;
        matchReason = 'Similar to skill goal';
      }
    }

    // Apply domain/application boost
    if (domain && summary.domain === domain) {
      confidence *= 1.2;
    }

    // Cap confidence at 1.0
    confidence = Math.min(confidence, 1.0);

    if (confidence >= minConfidence) {
      matches.push({ skillId, confidence, matchReason });
    }
  }

  // Sort by confidence and return top results
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, maxResults);
}

/**
 * Find the best matching skill for a query
 */
export function findBestSkillForQuery(
  query: string,
  index: SkillIndex,
  options?: {
    minConfidence?: number;
    domain?: string;
    application?: string;
  }
): SkillMatch | null {
  const matches = findSkillsForQuery(query, index, { ...options, maxResults: 1 });
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Get skills for a specific domain
 */
export function getSkillsForDomain(domain: string, index: SkillIndex): string[] {
  return index.domainMap[domain] || [];
}

/**
 * Get skills for a specific application
 */
export function getSkillsForApplication(application: string, index: SkillIndex): string[] {
  return index.applicationMap[application] || [];
}

/**
 * Get all domains with skill counts
 */
export function getDomainStats(index: SkillIndex): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [domain, skillIds] of Object.entries(index.domainMap)) {
    stats[domain] = skillIds.length;
  }
  return stats;
}

/**
 * Get all applications with skill counts
 */
export function getApplicationStats(index: SkillIndex): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [app, skillIds] of Object.entries(index.applicationMap)) {
    stats[app] = skillIds.length;
  }
  return stats;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize a phrase for matching
 */
function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Jaccard similarity on words
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  const intersection = wordsA.filter(x => setB.has(x));
  const union = Array.from(new Set([...wordsA, ...wordsB]));

  return intersection.length / union.length;
}

// ============================================================================
// Index Serialization
// ============================================================================

/**
 * Serialize index to JSON for storage
 */
export function serializeIndex(index: SkillIndex): string {
  return JSON.stringify(index);
}

/**
 * Deserialize index from JSON
 */
export function deserializeIndex(json: string): SkillIndex {
  return JSON.parse(json);
}

// Note: SkillIndex and SkillMatch are exported from their definitions above
