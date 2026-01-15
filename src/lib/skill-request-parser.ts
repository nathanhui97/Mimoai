/**
 * Skill Request Parser
 *
 * Parses user requests and matches them to available skills.
 * Uses LLM for intelligent matching with variable extraction and repetition inference.
 */

import type {
  SkillDefinition,
  SkillMatch,
} from '../types/skill';
import type { ParsedSkillRequest } from '../types/skill';
import { SkillStorage } from './skill-storage';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: ParsedSkillRequest;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Parse a user request and match it to available skills
 */
export async function parseSkillRequest(
  request: string
): Promise<ParsedSkillRequest> {
  // 1. Check cache
  const cacheKey = generateCacheKey(request);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // 2. Load skills
  const skills = await SkillStorage.loadSkills();

  if (skills.length === 0) {
    return {
      matches: [],
      executionOrder: [],
      overallConfidence: 0,
      fromCache: false,
    };
  }

  // 3. Try fast-path for exact matches first
  const fastMatch = tryFastMatch(request, skills);
  if (fastMatch) {
    saveToCache(cacheKey, fastMatch);
    return { ...fastMatch, fromCache: false };
  }

  // 4. Use LLM for intelligent matching
  try {
    const result = await matchWithLLM(request, skills);
    saveToCache(cacheKey, result);
    return { ...result, fromCache: false };
  } catch (error) {
    console.warn('[SkillRequestParser] LLM matching failed:', error);
    // Fallback to fuzzy matching
    return fuzzyMatch(request, skills);
  }
}

/**
 * Try fast-path matching for exact or near-exact requests
 * e.g., "run Add Item" or "execute Add Item skill"
 */
function tryFastMatch(
  request: string,
  skills: SkillDefinition[]
): ParsedSkillRequest | null {
  const requestLower = request.toLowerCase();

  // Check for direct skill name reference
  for (const skill of skills) {
    const skillNameLower = skill.name.toLowerCase();

    // Exact name match with common prefixes
    const patterns = [
      `run ${skillNameLower}`,
      `execute ${skillNameLower}`,
      `do ${skillNameLower}`,
      skillNameLower,
    ];

    for (const pattern of patterns) {
      if (requestLower === pattern || requestLower.startsWith(`${pattern} `)) {
        return {
          matches: [
            {
              skillId: skill.id,
              matchConfidence: 1.0,
              variables: {},
              repeatCount: 1,
              reasoning: 'Exact skill name match',
            },
          ],
          executionOrder: [skill.id],
          overallConfidence: 1.0,
          fromCache: false,
        };
      }
    }
  }

  return null;
}

/**
 * Match request using LLM
 * Note: LLM matching via edge function not yet implemented, uses fuzzy matching
 */
async function matchWithLLM(
  request: string,
  skills: SkillDefinition[]
): Promise<ParsedSkillRequest> {
  // For now, use fuzzy matching
  // TODO: Add edge function call when parse_skill_request function is created
  console.log('[SkillRequestParser] Using fuzzy matching (LLM edge function not yet available)');
  return fuzzyMatch(request, skills);
}

/**
 * Fuzzy matching fallback (no LLM)
 */
function fuzzyMatch(
  request: string,
  skills: SkillDefinition[]
): ParsedSkillRequest {
  const requestWords = request.toLowerCase().split(/\s+/);
  const matches: SkillMatch[] = [];

  for (const skill of skills) {
    let score = 0;

    // Check verb matches
    const verbMatches =
      requestWords.some(w => w === skill.canonicalAction.verb.toLowerCase()) ||
      requestWords.some(w =>
        skill.canonicalAction.verbSynonyms.some(
          s => s.toLowerCase() === w
        )
      );
    if (verbMatches) score += 0.4;

    // Check object matches
    const objectMatches =
      requestWords.some(
        w => w === skill.canonicalAction.object.toLowerCase()
      ) ||
      requestWords.some(w =>
        skill.canonicalAction.objectSynonyms.some(
          s => s.toLowerCase() === w
        )
      );
    if (objectMatches) score += 0.4;

    // Check name matches
    const nameWords = skill.name.toLowerCase().split(/\s+/);
    const nameMatches = nameWords.some(nw => requestWords.includes(nw));
    if (nameMatches) score += 0.2;

    if (score > 0.3) {
      matches.push({
        skillId: skill.id,
        matchConfidence: score,
        variables: {},
        repeatCount: 1,
        reasoning: `Fuzzy match: verb=${verbMatches}, object=${objectMatches}, name=${nameMatches}`,
      });
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.matchConfidence - a.matchConfidence);

  // Take top matches
  const topMatches = matches.slice(0, 3);

  return {
    matches: topMatches,
    executionOrder: topMatches.map(m => m.skillId),
    overallConfidence: topMatches.length > 0 ? topMatches[0].matchConfidence : 0,
    fromCache: false,
  };
}

/**
 * Resolve execution order respecting dependencies
 * Will be used when LLM matching returns multiple skills with dependencies
 */
export function resolveExecutionOrder(
  matches: SkillMatch[],
  skills: SkillDefinition[]
): string[] {
  const skillMap = new Map(skills.map(s => [s.id, s]));
  const matchedIds = new Set(matches.map(m => m.skillId));

  // Build dependency graph
  const graph = new Map<string, Set<string>>();
  for (const match of matches) {
    const skill = skillMap.get(match.skillId);
    if (skill) {
      // Only include dependencies that are also matched
      const deps = new Set(
        skill.dependencies.requires.filter(id => matchedIds.has(id))
      );
      graph.set(skill.id, deps);
    }
  }

  // Topological sort
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(skillId: string): boolean {
    if (visiting.has(skillId)) return false; // Cycle detected
    if (visited.has(skillId)) return true;

    visiting.add(skillId);
    const deps = graph.get(skillId) || new Set();
    for (const dep of deps) {
      if (!visit(dep)) return false;
    }
    visiting.delete(skillId);
    visited.add(skillId);
    order.push(skillId);
    return true;
  }

  for (const match of matches) {
    visit(match.skillId);
  }

  return order;
}

/**
 * Calculate overall confidence from matches
 * Will be used when LLM matching is implemented
 */
export function calculateOverallConfidence(matches: SkillMatch[]): number {
  if (matches.length === 0) return 0;
  const sum = matches.reduce((acc, m) => acc + m.matchConfidence, 0);
  return sum / matches.length;
}

/**
 * Generate cache key from request
 */
function generateCacheKey(request: string): string {
  return request.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Get from cache if not expired
 */
function getFromCache(key: string): ParsedSkillRequest | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.result;
}

/**
 * Save to cache
 */
function saveToCache(key: string, result: ParsedSkillRequest): void {
  cache.set(key, {
    result,
    timestamp: Date.now(),
  });

  // Clean old entries periodically
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.timestamp > CACHE_TTL) {
        cache.delete(k);
      }
    }
  }
}

/**
 * Clear the cache
 */
export function clearSkillRequestCache(): void {
  cache.clear();
}

/**
 * Get cached result (for debugging)
 */
export function getCachedRequest(
  request: string
): ParsedSkillRequest | null {
  return getFromCache(generateCacheKey(request));
}
