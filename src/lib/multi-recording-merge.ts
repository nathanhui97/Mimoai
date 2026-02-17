/**
 * Multi-Recording Merge (Phase E)
 *
 * When a user records the same workflow multiple times with different scenarios,
 * this module merges the recordings into a single enriched skill model.
 *
 * Benefits:
 * - Fields filled in ALL recordings → definitely required
 * - Fields filled in SOME recordings → conditionally required
 * - Fields filled in NONE → truly optional
 * - Different values across recordings → known variations
 * - Error handling from failed recordings → recovery knowledge
 */

import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import type { SkillModel, PageSkill, FieldKnowledge } from './skill-model/types';

// ============================================================================
// Types
// ============================================================================

export interface MultiRecordingMerge {
  /** How many recordings were merged */
  recordingCount: number;
  /** When the merge was performed */
  mergedAt: number;
  /** IDs of the merged recordings */
  sourceWorkflowIds: string[];
  /** Field-level confidence from cross-recording analysis */
  fieldConfidence: Record<string, FieldMergeResult>;
  /** Path variations discovered across recordings */
  pathVariations: PathVariation[];
}

export interface FieldMergeResult {
  /** Field name */
  fieldName: string;
  /** How many recordings filled this field */
  filledCount: number;
  /** Total recordings analyzed */
  totalRecordings: number;
  /** Is this field required based on cross-recording evidence? */
  inferredRequired: boolean;
  /** Confidence in the required inference (0-1) */
  confidence: number;
  /** Different values used across recordings */
  variations: string[];
  /** Was this field skipped in any recording? */
  wasEverSkipped: boolean;
  /** Most common fill strategy */
  preferredStrategy: string;
}

export interface PathVariation {
  /** Human-readable description of the variation */
  description: string;
  /** Which recording this came from */
  sourceWorkflowId: string;
  /** Step indices that differ from the "base" recording */
  differingSteps: number[];
  /** What makes this path different */
  trigger?: string;
}

export interface MergeCandidate {
  /** The existing workflow that could be merged with */
  workflow: SavedWorkflow;
  /** Similarity score (0-1) */
  similarity: number;
  /** Why this is a match */
  reason: string;
}

// ============================================================================
// Detection: Find Merge Candidates
// ============================================================================

/**
 * Find existing workflows that the new recording could be merged with.
 * Matches based on:
 * 1. Same domain/URL patterns
 * 2. Similar step sequences
 * 3. Similar workflow names/goals
 */
export function findMergeCandidates(
  newWorkflow: SavedWorkflow,
  existingWorkflows: SavedWorkflow[],
  threshold: number = 0.5
): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  const newUrls = extractUrlPatterns(newWorkflow.steps);
  const newFieldNames = extractFieldNames(newWorkflow.steps);

  for (const existing of existingWorkflows) {
    if (existing.id === newWorkflow.id) continue;

    let similarity = 0;
    const reasons: string[] = [];

    // 1. URL pattern overlap
    const existingUrls = extractUrlPatterns(existing.steps);
    const urlOverlap = calculateSetOverlap(newUrls, existingUrls);
    if (urlOverlap > 0.5) {
      similarity += urlOverlap * 0.4; // 40% weight for URL match
      reasons.push(`Same pages (${Math.round(urlOverlap * 100)}% overlap)`);
    }

    // 2. Field name overlap
    const existingFieldNames = extractFieldNames(existing.steps);
    const fieldOverlap = calculateSetOverlap(newFieldNames, existingFieldNames);
    if (fieldOverlap > 0.3) {
      similarity += fieldOverlap * 0.3; // 30% weight for field match
      reasons.push(`Similar fields (${Math.round(fieldOverlap * 100)}% overlap)`);
    }

    // 3. Step count similarity
    const stepRatio = Math.min(newWorkflow.steps.length, existing.steps.length) /
                      Math.max(newWorkflow.steps.length, existing.steps.length);
    if (stepRatio > 0.5) {
      similarity += stepRatio * 0.15; // 15% weight
      reasons.push(`Similar length (${existing.steps.length} vs ${newWorkflow.steps.length} steps)`);
    }

    // 4. Name/goal similarity
    const nameSimilarity = calculateStringSimilarity(
      newWorkflow.name.toLowerCase(),
      existing.name.toLowerCase()
    );
    if (nameSimilarity > 0.3) {
      similarity += nameSimilarity * 0.15; // 15% weight
      reasons.push(`Similar name`);
    }

    if (similarity >= threshold) {
      candidates.push({
        workflow: existing,
        similarity,
        reason: reasons.join(', '),
      });
    }
  }

  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}

// ============================================================================
// Merge: Combine Recordings into Enriched Skill Model
// ============================================================================

/**
 * Merge multiple recordings into an enriched SkillModel.
 * The base workflow is the primary recording; additional recordings
 * provide supplementary evidence for field requirements and variations.
 */
export function mergeRecordings(
  baseWorkflow: SavedWorkflow,
  additionalWorkflows: SavedWorkflow[]
): MultiRecordingMerge {
  const allWorkflows = [baseWorkflow, ...additionalWorkflows];
  const fieldData: Map<string, FieldMergeAccumulator> = new Map();
  const pathVariations: PathVariation[] = [];

  // Analyze each recording's fields
  for (const workflow of allWorkflows) {
    const filledFields = extractFilledFields(workflow.steps);
    const allFormFields = extractAllFormFields(workflow);

    // Track which fields were filled in this recording
    for (const field of filledFields) {
      const key = normalizeFieldName(field.name);
      const acc = fieldData.get(key) || createFieldAccumulator(field.name);
      acc.filledCount++;
      if (field.value && !acc.values.includes(field.value)) {
        acc.values.push(field.value);
      }
      if (field.strategy) {
        acc.strategies.push(field.strategy);
      }
      fieldData.set(key, acc);
    }

    // Track which fields were available but NOT filled
    for (const formField of allFormFields) {
      const key = normalizeFieldName(formField.name);
      const acc = fieldData.get(key) || createFieldAccumulator(formField.name);
      acc.totalRecordings++;
      if (!filledFields.find(f => normalizeFieldName(f.name) === key)) {
        acc.skippedCount++;
      }
      fieldData.set(key, acc);
    }
  }

  // Ensure all accumulators have correct totalRecordings
  for (const acc of fieldData.values()) {
    if (acc.totalRecordings < allWorkflows.length) {
      acc.totalRecordings = allWorkflows.length;
    }
  }

  // Detect path variations (steps that differ between recordings)
  if (additionalWorkflows.length > 0) {
    const baseStepSignatures = getStepSignatures(baseWorkflow.steps);

    for (const additional of additionalWorkflows) {
      const additionalSignatures = getStepSignatures(additional.steps);
      const differingSteps: number[] = [];

      for (let i = 0; i < additionalSignatures.length; i++) {
        if (!baseStepSignatures.includes(additionalSignatures[i])) {
          differingSteps.push(i);
        }
      }

      if (differingSteps.length > 0) {
        pathVariations.push({
          description: `Recording "${additional.name}" has ${differingSteps.length} different steps`,
          sourceWorkflowId: additional.id,
          differingSteps,
        });
      }
    }
  }

  // Build final field confidence map
  const fieldConfidence: Record<string, FieldMergeResult> = {};
  for (const [key, acc] of fieldData) {
    const fillRate = acc.filledCount / acc.totalRecordings;
    fieldConfidence[key] = {
      fieldName: acc.fieldName,
      filledCount: acc.filledCount,
      totalRecordings: acc.totalRecordings,
      inferredRequired: fillRate >= 0.8, // Filled in 80%+ of recordings
      confidence: fillRate,
      variations: acc.values,
      wasEverSkipped: acc.skippedCount > 0,
      preferredStrategy: getMostCommon(acc.strategies) || 'type',
    };
  }

  return {
    recordingCount: allWorkflows.length,
    mergedAt: Date.now(),
    sourceWorkflowIds: allWorkflows.map(w => w.id),
    fieldConfidence,
    pathVariations,
  };
}

/**
 * Apply merge results to update a workflow's SkillModel.
 * Updates field requirements, fill rates, and example values.
 */
export function applyMergeToSkillModel(
  skillModel: SkillModel,
  merge: MultiRecordingMerge
): SkillModel {
  const updatedPages = skillModel.pages.map(page => ({
    ...page,
    fields: page.fields.map(field => {
      const key = normalizeFieldName(field.fieldName);
      const mergeResult = merge.fieldConfidence[key];

      if (!mergeResult) return field;

      const updated: FieldKnowledge = {
        ...field,
        required: mergeResult.inferredRequired,
        requiredConfidence: mergeResult.confidence,
        requiredSource: mergeResult.confidence >= 0.9 ? 'never_skipped' : 'inferred',
        fillRate: mergeResult.filledCount / mergeResult.totalRecordings,
        wasEverSkipped: mergeResult.wasEverSkipped,
        exampleValues: [
          ...new Set([...field.exampleValues, ...mergeResult.variations]),
        ].slice(0, 10), // Keep up to 10 examples
      };

      if (mergeResult.wasEverSkipped && !mergeResult.inferredRequired) {
        updated.skipReason = 'optional';
      }

      return updated;
    }),
  }));

  return {
    ...skillModel,
    pages: updatedPages,
    executionCount: merge.recordingCount,
    generatedAt: Date.now(),
  };
}

// ============================================================================
// Helpers
// ============================================================================

interface FieldMergeAccumulator {
  fieldName: string;
  filledCount: number;
  skippedCount: number;
  totalRecordings: number;
  values: string[];
  strategies: string[];
}

function createFieldAccumulator(fieldName: string): FieldMergeAccumulator {
  return {
    fieldName,
    filledCount: 0,
    skippedCount: 0,
    totalRecordings: 0,
    values: [],
    strategies: [],
  };
}

function extractUrlPatterns(steps: WorkflowStep[]): Set<string> {
  const urls = new Set<string>();
  for (const step of steps) {
    if (step.type === 'NAVIGATION' && step.payload && 'url' in step.payload) {
      const url = (step.payload as any).url as string;
      try {
        const parsed = new URL(url);
        // Normalize: remove query params, replace numeric IDs
        const pattern = `${parsed.hostname}${parsed.pathname.replace(/\/\d+/g, '/*')}`;
        urls.add(pattern);
      } catch {
        // skip invalid URLs
      }
    }
  }
  return urls;
}

function extractFieldNames(steps: WorkflowStep[]): Set<string> {
  const fields = new Set<string>();
  for (const step of steps) {
    if (step.type === 'INPUT' && step.payload) {
      const label = (step.payload as any).label || (step.payload as any).fieldName || '';
      if (label) fields.add(normalizeFieldName(label));
    }
  }
  return fields;
}

interface FilledField {
  name: string;
  value: string;
  strategy?: string;
}

function extractFilledFields(steps: WorkflowStep[]): FilledField[] {
  const fields: FilledField[] = [];
  for (const step of steps) {
    if (step.type === 'INPUT' && step.payload) {
      const p = step.payload as any;
      const name = p.label || p.fieldName || p.ariaLabel || '';
      if (name) {
        fields.push({
          name,
          value: p.value || '',
          strategy: p.inputType || 'type',
        });
      }
    }
  }
  return fields;
}

function extractAllFormFields(workflow: SavedWorkflow): Array<{ name: string }> {
  const fields: Array<{ name: string }> = [];

  // Extract from form audits attached to steps
  for (const step of workflow.steps) {
    const payload = step.payload as any;
    if (payload?.formAudit?.fields) {
      for (const f of payload.formAudit.fields) {
        const name = f.label || f.name || '';
        if (name && !fields.find(existing => existing.name === name)) {
          fields.push({ name });
        }
      }
    }
  }

  // Fallback: use skill model if available
  if (fields.length === 0 && workflow.skillModel) {
    for (const page of workflow.skillModel.pages) {
      for (const field of page.fields) {
        fields.push({ name: field.fieldName });
      }
    }
  }

  // Fallback: use filled fields
  if (fields.length === 0) {
    return extractFilledFields(workflow.steps).map(f => ({ name: f.name }));
  }

  return fields;
}

function getStepSignatures(steps: WorkflowStep[]): string[] {
  return steps.map(step => {
    const p = step.payload as any;
    const type = step.type;
    const target = p?.label || p?.elementText || p?.ariaLabel || p?.url || '';
    return `${type}:${target}`.toLowerCase();
  });
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
}

function calculateSetOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

function calculateStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Simple word overlap similarity
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  return calculateSetOverlap(wordsA, wordsB);
}

function getMostCommon(arr: string[]): string | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let maxCount = 0;
  let maxItem = arr[0];
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxItem = item;
    }
  }
  return maxItem;
}
