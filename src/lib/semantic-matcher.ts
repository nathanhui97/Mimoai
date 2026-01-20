/**
 * Semantic Workflow Matcher (Phase 1)
 *
 * Handles LLM-powered semantic matching of user queries to workflows.
 * Implements decision thresholds and clarification logic.
 */

import type { SavedWorkflow } from '../types/workflow';
import { aiConfig } from './ai-config';
import type { WorkflowMemory } from './workflow-memory';

// ============================================================================
// Types
// ============================================================================

export interface SemanticMatchResult {
  workflowId: string;
  workflow: SavedWorkflow;
  confidence: number;
  reasoning: string;
  confidenceBreakdown: {
    intentAlignment: number;
    verbObjectMatch: number;
    exampleSimilarity: number;
    domainRelevance: number;
  };
  extractedVariables?: Record<string, string>;
}

export interface MatchDecision {
  action: 'AUTO_EXECUTE' | 'SHOW_PICKER' | 'CLARIFY' | 'OFFER_TEACH' | 'NO_MATCH';
  workflow?: SavedWorkflow;
  matches?: SemanticMatchResult[];
  clarification?: {
    question: string;
    options: Array<{
      workflowId: string;
      label: string;
      description: string;
    }>;
  };
  message?: string;
  extractedVariables?: Record<string, string>;
}

export interface ClarificationQuestion {
  question: string;
  options: Array<{
    workflowId: string;
    label: string;
    description: string;
  }>;
  allowOther: boolean;
}

// ============================================================================
// Decision Thresholds
// ============================================================================

export const MATCH_THRESHOLDS = {
  AUTO_EXECUTE: 0.85,    // Single match, high confidence → run immediately
  SHOW_PICKER: 0.5,      // Multiple matches → show picker with reasoning
  ASK_CLARIFICATION: 0.3, // Ambiguous → ask clarifying question
  TIE_MARGIN: 0.1,       // If top 2 are within this margin, ask clarification
};

// ============================================================================
// Semantic Matcher
// ============================================================================

export class SemanticMatcher {
  /**
   * Match a user query to workflows using semantic understanding
   */
  static async matchQuery(
    query: string,
    workflows: SavedWorkflow[],
    pageContext?: { url: string; title: string }
  ): Promise<SemanticMatchResult[]> {
    console.log('[SemanticMatcher] 🔍 matchQuery called');
    console.log('[SemanticMatcher] Query:', query);
    console.log('[SemanticMatcher] Workflows count:', workflows?.length || 0);

    if (!workflows || workflows.length === 0) {
      console.log('[SemanticMatcher] No workflows to match against');
      return [];
    }

    console.log('[SemanticMatcher] Available workflows:', workflows.map(w => ({
      id: w.id,
      name: w.name,
      hasAiAnalysis: !!w.aiAnalysis,
      hasLearnedSkill: !!w.learnedSkill,
    })));

    const config = aiConfig.getConfig();
    const url = `${config.supabaseUrl}/functions/v1/semantic_match_workflow`;

    try {
      // Prepare workflow data for the API - use memory if available for unified understanding
      const workflowData = workflows.map(w => {
        // If workflow has memory, use it (unified, human-like understanding)
        if (w.memory) {
          return buildWorkflowDataFromMemory(w.id, w.memory);
        }

        // Fall back to scattered data
        return {
          id: w.id,
          name: w.name,
          description: w.description,
          primaryGoal: w.inferredIntent?.primaryGoal || w.aiAnalysis?.workflowUnderstanding?.primaryGoal,
          learnedSkill: w.learnedSkill,
          // Include user-renamed variables for pattern understanding
          // e.g., ["Name", "Email", "Phone"] instead of ["A13", "B13", "C13"]
          variableFields: w.variables?.variables?.map(v => v.fieldName) || [],
        };
      });

      console.log('[SemanticMatcher] Calling API:', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          userQuery: query,
          workflows: workflowData,
          pageContext,
        }),
      });

      console.log('[SemanticMatcher] API response status:', response.status);

      if (!response.ok) {
        console.error('[SemanticMatcher] API error:', response.status);
        const errorText = await response.text();
        console.error('[SemanticMatcher] API error body:', errorText);
        // Fall back to local matching
        console.log('[SemanticMatcher] Falling back to local matching');
        return this.localMatch(query, workflows);
      }

      const result = await response.json();
      console.log('[SemanticMatcher] API result:', JSON.stringify(result, null, 2));

      if (result.error) {
        console.warn('[SemanticMatcher] API returned error:', result.error);
        return this.localMatch(query, workflows);
      }

      // Enrich matches with full workflow data
      const enrichedMatches: SemanticMatchResult[] = result.matches
        .map((m: any) => {
          const workflow = workflows.find(w => w.id === m.workflowId);
          if (!workflow) return null;

          return {
            workflowId: m.workflowId,
            workflow,
            confidence: m.confidence,
            reasoning: m.reasoning,
            confidenceBreakdown: m.confidenceBreakdown,
            extractedVariables: m.extractedVariables,
          };
        })
        .filter(Boolean) as SemanticMatchResult[];

      console.log('[SemanticMatcher] Enriched matches:', enrichedMatches.length);
      return enrichedMatches;
    } catch (error) {
      console.error('[SemanticMatcher] Error:', error);
      // Fall back to local matching
      console.log('[SemanticMatcher] Falling back to local matching due to error');
      return this.localMatch(query, workflows);
    }
  }

  /**
   * Local fallback matching (when API is unavailable)
   * Uses memory-based scoring if available, falls back to keyword matching
   */
  private static localMatch(query: string, workflows: SavedWorkflow[]): SemanticMatchResult[] {
    console.log('[SemanticMatcher] Local matching for:', query);

    // First, try memory-based matching for workflows that have memory
    const memoryMatches: SemanticMatchResult[] = [];
    const noMemoryWorkflows: SavedWorkflow[] = [];

    for (const workflow of workflows) {
      if (workflow.memory) {
        const { score, reasons, breakdown } = scoreWorkflowWithMemory(query, workflow.memory);
        if (score >= MATCH_THRESHOLDS.ASK_CLARIFICATION) {
          memoryMatches.push({
            workflowId: workflow.id,
            workflow,
            confidence: score,
            reasoning: `Memory match: ${reasons.slice(0, 3).join(', ')}`,
            confidenceBreakdown: {
              ...breakdown,
              domainRelevance: 0,
            },
          });
        }
      } else {
        noMemoryWorkflows.push(workflow);
      }
    }

    // If we have good memory matches, return them
    if (memoryMatches.length > 0) {
      console.log('[SemanticMatcher] Found', memoryMatches.length, 'memory-based matches');
      // Also check non-memory workflows with fallback method
      const fallbackMatches = this.localMatchFallback(query, noMemoryWorkflows);
      return [...memoryMatches, ...fallbackMatches]
        .sort((a, b) => b.confidence - a.confidence);
    }

    // Fall back to keyword matching for all workflows
    return this.localMatchFallback(query, workflows);
  }

  /**
   * Fallback keyword-based matching (original local matching logic)
   */
  private static localMatchFallback(query: string, workflows: SavedWorkflow[]): SemanticMatchResult[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    // Common synonyms for better matching
    const synonymMap: Record<string, string[]> = {
      'fill': ['enter', 'input', 'type', 'write', 'populate', 'add'],
      'spreadsheet': ['sheet', 'excel', 'cells', 'google sheet', 'table'],
      'create': ['make', 'add', 'new'],
      'update': ['edit', 'change', 'modify'],
      'delete': ['remove', 'clear'],
    };

    // Expand query words with synonyms
    const expandedQueryWords = new Set(queryWords);
    for (const word of queryWords) {
      if (synonymMap[word]) {
        synonymMap[word].forEach(syn => expandedQueryWords.add(syn));
      }
      // Also check if word matches a synonym
      for (const [key, syns] of Object.entries(synonymMap)) {
        if (syns.includes(word)) {
          expandedQueryWords.add(key);
        }
      }
    }

    console.log('[SemanticMatcher] Expanded query words:', Array.from(expandedQueryWords));

    return workflows
      .map(workflow => {
        let score = 0;
        let intentAlignment = 0;
        let verbObjectMatch = 0;
        let exampleSimilarity = 0;
        const reasons: string[] = [];

        const nameLower = workflow.name.toLowerCase();

        // Name contains query
        if (nameLower.includes(queryLower)) {
          score += 0.3;
          intentAlignment = 0.3;
          reasons.push('name match');
        }

        // Word matching in name
        for (const word of expandedQueryWords) {
          if (nameLower.includes(word)) {
            score += 0.1;
            intentAlignment += 0.05;
            reasons.push(`name contains "${word}"`);
          }
        }

        // AI Analysis matching (NEW)
        if (workflow.aiAnalysis?.workflowUnderstanding) {
          const understanding = workflow.aiAnalysis.workflowUnderstanding;
          const searchText = [
            understanding.summary,
            understanding.primaryGoal,
            ...(understanding.subGoals || []),
            understanding.domain,
          ].filter(Boolean).join(' ').toLowerCase();

          for (const word of expandedQueryWords) {
            if (searchText.includes(word)) {
              score += 0.15;
              intentAlignment += 0.1;
              reasons.push(`AI analysis contains "${word}"`);
            }
          }
        }

        // Description matching (NEW)
        if (workflow.description) {
          const descLower = workflow.description.toLowerCase();
          for (const word of expandedQueryWords) {
            if (descLower.includes(word)) {
              score += 0.1;
              intentAlignment += 0.05;
              reasons.push(`description contains "${word}"`);
            }
          }
        }

        // Learned skill matching
        if (workflow.learnedSkill) {
          const skill = workflow.learnedSkill;

          // Verb matching
          if (queryLower.includes(skill.canonicalAction.verb.toLowerCase())) {
            score += 0.15;
            verbObjectMatch += 0.15;
            reasons.push('verb match');
          }

          // Verb synonyms
          for (const syn of skill.canonicalAction.verbSynonyms) {
            if (queryLower.includes(syn.toLowerCase())) {
              score += 0.1;
              verbObjectMatch += 0.1;
              reasons.push(`verb synonym "${syn}"`);
              break;
            }
          }

          // Object matching
          if (queryLower.includes(skill.canonicalAction.object.toLowerCase())) {
            score += 0.15;
            verbObjectMatch += 0.15;
            reasons.push('object match');
          }

          // Object synonyms
          for (const syn of skill.canonicalAction.objectSynonyms) {
            if (queryLower.includes(syn.toLowerCase())) {
              score += 0.1;
              verbObjectMatch += 0.1;
              reasons.push(`object synonym "${syn}"`);
              break;
            }
          }

          // What it does matching
          if (skill.whatItDoes) {
            const whatItDoesLower = skill.whatItDoes.toLowerCase();
            for (const word of expandedQueryWords) {
              if (whatItDoesLower.includes(word)) {
                score += 0.1;
                intentAlignment += 0.05;
                reasons.push(`whatItDoes contains "${word}"`);
              }
            }
          }

          // Example query matching
          for (const example of skill.exampleQueries) {
            const exampleLower = example.toLowerCase();
            const similarity = this.stringSimilarity(queryLower, exampleLower);
            if (similarity > 0.5) {
              score += 0.2 * similarity;
              exampleSimilarity = Math.max(exampleSimilarity, 0.2 * similarity);
              reasons.push(`similar to example "${example}"`);
            }
          }
        }

        // Cap at 1.0
        score = Math.min(1.0, score);

        console.log(`[SemanticMatcher] Workflow "${workflow.name}": score=${score.toFixed(2)}, reasons=[${reasons.join(', ')}]`);

        return {
          workflowId: workflow.id,
          workflow,
          confidence: score,
          reasoning: `Local matching: ${reasons.slice(0, 3).join(', ')} (score ${score.toFixed(2)})`,
          confidenceBreakdown: {
            intentAlignment: Math.min(0.4, intentAlignment),
            verbObjectMatch: Math.min(0.3, verbObjectMatch),
            exampleSimilarity: Math.min(0.2, exampleSimilarity),
            domainRelevance: 0,
          },
        };
      })
      .filter(m => m.confidence >= MATCH_THRESHOLDS.ASK_CLARIFICATION)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Simple string similarity (Jaccard index on words)
   */
  private static stringSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\s+/));
    const setB = new Set(b.split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  /**
   * Make a decision based on match results
   */
  static makeDecision(query: string, matches: SemanticMatchResult[]): MatchDecision {
    console.log('[SemanticMatcher] makeDecision called');
    console.log('[SemanticMatcher] Query:', query);
    console.log('[SemanticMatcher] Matches count:', matches.length);
    console.log('[SemanticMatcher] Thresholds:', MATCH_THRESHOLDS);

    if (matches.length > 0) {
      console.log('[SemanticMatcher] Top match:', {
        workflowId: matches[0].workflowId,
        name: matches[0].workflow.name,
        confidence: matches[0].confidence,
        reasoning: matches[0].reasoning,
      });
    }

    // No matches
    if (matches.length === 0 || matches[0].confidence < MATCH_THRESHOLDS.ASK_CLARIFICATION) {
      console.log('[SemanticMatcher] Decision: OFFER_TEACH (no matches or confidence too low)');
      console.log('[SemanticMatcher] ASK_CLARIFICATION threshold:', MATCH_THRESHOLDS.ASK_CLARIFICATION);
      if (matches.length > 0) {
        console.log('[SemanticMatcher] Top confidence:', matches[0].confidence);
      }
      return {
        action: 'OFFER_TEACH',
        message: "I don't know how to do that yet. Would you like to teach me?",
      };
    }

    // Single high-confidence match
    if (matches.length === 1 && matches[0].confidence >= MATCH_THRESHOLDS.AUTO_EXECUTE) {
      return {
        action: 'AUTO_EXECUTE',
        workflow: matches[0].workflow,
        extractedVariables: matches[0].extractedVariables,
      };
    }

    // Check if top match is high enough for auto-execute
    if (matches[0].confidence >= MATCH_THRESHOLDS.AUTO_EXECUTE) {
      // But check for close second match (tie)
      if (matches.length >= 2 &&
          matches[0].confidence - matches[1].confidence < MATCH_THRESHOLDS.TIE_MARGIN) {
        // Tie - ask clarification
        return {
          action: 'CLARIFY',
          matches: matches.slice(0, 3),
          clarification: buildClarifyingQuestion(query, matches.slice(0, 3)),
        };
      }

      // Clear winner
      return {
        action: 'AUTO_EXECUTE',
        workflow: matches[0].workflow,
        extractedVariables: matches[0].extractedVariables,
      };
    }

    // Multiple decent matches - check for tie
    if (matches.length >= 2 &&
        matches[0].confidence - matches[1].confidence < MATCH_THRESHOLDS.TIE_MARGIN) {
      return {
        action: 'CLARIFY',
        matches: matches.slice(0, 3),
        clarification: buildClarifyingQuestion(query, matches.slice(0, 3)),
      };
    }

    // Show picker for multiple matches, but auto-execute if only one match
    if (matches[0].confidence >= MATCH_THRESHOLDS.SHOW_PICKER) {
      // If only one match with decent confidence, just execute it
      if (matches.length === 1) {
        console.log('[SemanticMatcher] Decision: AUTO_EXECUTE (single match above SHOW_PICKER threshold)');
        return {
          action: 'AUTO_EXECUTE',
          workflow: matches[0].workflow,
          matches: [matches[0]],
          extractedVariables: matches[0].extractedVariables,
        };
      }
      return {
        action: 'SHOW_PICKER',
        matches: matches.slice(0, 5),
      };
    }

    // Low confidence matches - clarify
    return {
      action: 'CLARIFY',
      matches: matches.slice(0, 3),
      clarification: buildClarifyingQuestion(query, matches.slice(0, 3)),
    };
  }

  /**
   * Full matching flow: match + decide
   */
  static async matchAndDecide(
    query: string,
    workflows: SavedWorkflow[],
    pageContext?: { url: string; title: string }
  ): Promise<MatchDecision> {
    const matches = await this.matchQuery(query, workflows, pageContext);
    return this.makeDecision(query, matches);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a clarifying question for ambiguous matches
 */
function buildClarifyingQuestion(query: string, matches: SemanticMatchResult[]): ClarificationQuestion {
  return {
    question: `I found ${matches.length} tasks that might match "${query}". Which did you mean?`,
    options: matches.map(m => ({
      workflowId: m.workflow.id,
      label: m.workflow.name,
      description: m.workflow.aiAnalysis?.workflowUnderstanding?.summary ||
                   m.workflow.description ||
                   m.reasoning,
    })),
    allowOther: true,
  };
}

/**
 * Format match reasoning for display
 */
export function formatMatchReasoning(match: SemanticMatchResult): string {
  const { confidenceBreakdown } = match;
  const parts: string[] = [];

  if (confidenceBreakdown.intentAlignment > 0.2) {
    parts.push('intent matches');
  }
  if (confidenceBreakdown.verbObjectMatch > 0.15) {
    parts.push('similar action');
  }
  if (confidenceBreakdown.exampleSimilarity > 0.1) {
    parts.push('matches examples');
  }
  if (confidenceBreakdown.domainRelevance > 0.05) {
    parts.push('relevant to page');
  }

  if (parts.length === 0) {
    return match.reasoning;
  }

  return `${Math.round(match.confidence * 100)}% match: ${parts.join(', ')}`;
}

export const semanticMatcher = SemanticMatcher;

// ============================================================================
// Memory-Based Matching Helpers
// ============================================================================

/**
 * Build workflow data for API from unified memory
 * This provides much richer context than scattered fields
 */
function buildWorkflowDataFromMemory(workflowId: string, memory: WorkflowMemory): object {
  return {
    id: workflowId,
    name: memory.identity.name,
    description: memory.identity.purpose,
    primaryGoal: memory.understanding.elevator,
    category: memory.identity.category,
    domain: memory.identity.domain,

    // Triggers are the key for matching
    triggerPhrases: memory.triggers.phrases,
    verbSynonyms: memory.triggers.verbSynonyms,
    objectSynonyms: memory.triggers.objectSynonyms,

    // Input fields for variable extraction
    variableFields: memory.inputs.required.map(i => i.name),
    inputDescriptions: memory.inputs.required.map(i => ({
      name: i.name,
      description: i.description,
      type: i.type,
      extractionHints: i.extractionHints,
    })),

    // Pattern info for understanding capabilities
    patternType: memory.pattern.type,
    supportsMultiple: memory.pattern.repetition?.supportsMultiple || false,

    // Exclusions for disambiguation
    notWhen: memory.triggers.notWhen,
  };
}

/**
 * Score a workflow against a query using its memory
 * More accurate than scattered field matching
 */
function scoreWorkflowWithMemory(query: string, memory: WorkflowMemory): {
  score: number;
  reasons: string[];
  breakdown: { intentAlignment: number; verbObjectMatch: number; exampleSimilarity: number; };
} {
  const queryLower = query.toLowerCase();
  const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));

  let score = 0;
  let intentAlignment = 0;
  let verbObjectMatch = 0;
  let exampleSimilarity = 0;
  const reasons: string[] = [];

  // 1. Check trigger phrases (most important - these are designed for matching)
  for (const phrase of memory.triggers.phrases) {
    const phraseLower = phrase.toLowerCase();
    if (queryLower.includes(phraseLower)) {
      score += 0.4;
      intentAlignment += 0.3;
      reasons.push(`trigger phrase "${phrase}"`);
      break; // Only count once
    }

    // Partial phrase match (all words from phrase appear in query)
    const phraseWords = phraseLower.split(/\s+/);
    const allWordsMatch = phraseWords.every(w => queryLower.includes(w));
    if (allWordsMatch && phraseWords.length >= 2) {
      score += 0.25;
      intentAlignment += 0.2;
      reasons.push(`partial trigger "${phrase}"`);
    }
  }

  // 2. Check verb synonyms
  if (memory.triggers.verbSynonyms) {
    for (const verb of memory.triggers.verbSynonyms) {
      if (queryLower.includes(verb.toLowerCase())) {
        score += 0.15;
        verbObjectMatch += 0.15;
        reasons.push(`verb "${verb}"`);
        break;
      }
    }
  }

  // 3. Check object synonyms
  if (memory.triggers.objectSynonyms) {
    for (const obj of memory.triggers.objectSynonyms) {
      if (queryLower.includes(obj.toLowerCase())) {
        score += 0.15;
        verbObjectMatch += 0.15;
        reasons.push(`object "${obj}"`);
        break;
      }
    }
  }

  // 4. Check elevator pitch / purpose
  const elevatorLower = memory.understanding.elevator.toLowerCase();
  for (const word of queryWords) {
    if (elevatorLower.includes(word)) {
      score += 0.05;
      intentAlignment += 0.03;
    }
  }

  // 5. Check input field names (for data entry workflows)
  for (const input of memory.inputs.required) {
    const nameLower = input.name.toLowerCase();
    if (queryLower.includes(nameLower)) {
      score += 0.1;
      reasons.push(`input field "${input.name}"`);
    }
  }

  // 6. Check for exclusions (reduce score if matches notWhen)
  if (memory.triggers.notWhen) {
    for (const exclusion of memory.triggers.notWhen) {
      if (queryLower.includes(exclusion.toLowerCase())) {
        score *= 0.5; // Halve score if matches exclusion
        reasons.push(`(excluded: "${exclusion}")`);
      }
    }
  }

  // Cap at 1.0
  score = Math.min(1.0, score);

  return {
    score,
    reasons,
    breakdown: {
      intentAlignment: Math.min(0.4, intentAlignment),
      verbObjectMatch: Math.min(0.3, verbObjectMatch),
      exampleSimilarity: Math.min(0.2, exampleSimilarity),
    },
  };
}
