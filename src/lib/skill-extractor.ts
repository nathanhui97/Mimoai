/**
 * Skill Extractor
 *
 * Extracts skills from recorded workflows.
 * Supports two modes:
 * 1. Annotation-based extraction (user provided narration)
 * 2. AI auto-analysis (fallback for unannotated workflows)
 */

import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type {
  SkillDefinition,
  StepAnnotation,
  SuggestedSkill,
  SkillAnalysisResult,
  CanonicalAction,
} from '../types/skill';
import type { VariableDefinition } from './variable-detector';
import {
  detectSkillBoundaries,
  extractRepeatability,
  extractSelectionBehavior,
} from './annotation-parser';
import { generateSkillId } from './skill-storage';

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract skills from a workflow
 *
 * @param workflow - The saved workflow to extract skills from
 * @param annotations - Optional array of step annotations (if user narrated)
 * @returns Analysis result with suggested skills
 */
export async function analyzeWorkflowForSkills(
  workflow: SavedWorkflow,
  annotations?: StepAnnotation[]
): Promise<SkillAnalysisResult> {
  const hasAnnotations = annotations && annotations.length > 0;

  if (hasAnnotations) {
    // Use annotation-based extraction
    const skills = extractSkillsFromAnnotations(workflow, annotations);
    return {
      skills,
      overallConfidence: averageConfidence(skills),
      analysisMethod: 'annotation-based',
    };
  } else {
    // Use AI auto-analysis
    const skills = await analyzeWorkflowWithAI(workflow);
    return {
      skills,
      overallConfidence: averageConfidence(skills),
      analysisMethod: 'ai-auto',
    };
  }
}

// ============================================================================
// Annotation-Based Extraction
// ============================================================================

/**
 * Extract skills from annotations
 */
function extractSkillsFromAnnotations(
  workflow: SavedWorkflow,
  annotations: StepAnnotation[]
): SuggestedSkill[] {
  const boundaries = detectSkillBoundaries(annotations);
  const skills: SuggestedSkill[] = [];

  // If no boundaries detected, treat entire workflow as one skill
  if (boundaries.length === 0) {
    const repeatInfo = extractRepeatability(annotations);
    skills.push({
      name: inferSkillName(workflow.steps),
      startStep: 0,
      endStep: workflow.steps.length - 1,
      isRepeatable: repeatInfo.isRepeatable,
      repeatHint: repeatInfo.repeatHint,
      variables: detectVariableNames(workflow.steps),
      selectionBehavior: extractSelectionBehavior(annotations),
      confidence: 0.5,
      reasoning: 'No clear skill boundaries detected in annotations',
    });
    return skills;
  }

  // Create skills from detected boundaries
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    const stepsInRange = workflow.steps.slice(
      boundary.start,
      boundary.end + 1
    );
    const annotationsInRange = annotations.filter(
      a =>
        a.attachedToStepIndex >= boundary.start &&
        a.attachedToStepIndex <= boundary.end
    );

    const repeatInfo = extractRepeatability(annotationsInRange);

    skills.push({
      name: boundary.suggestedName || inferSkillName(stepsInRange),
      startStep: boundary.start,
      endStep: boundary.end,
      isRepeatable: repeatInfo.isRepeatable,
      repeatHint: repeatInfo.repeatHint,
      variables: detectVariableNames(stepsInRange),
      selectionBehavior: extractSelectionBehavior(annotationsInRange),
      confidence: boundary.confidence,
      reasoning: `Extracted from annotations (${boundary.source})`,
    });
  }

  // Handle steps not covered by any boundary
  const coveredIndices = new Set<number>();
  for (const boundary of boundaries) {
    for (let i = boundary.start; i <= boundary.end; i++) {
      coveredIndices.add(i);
    }
  }

  const uncoveredRanges = findUncoveredRanges(
    workflow.steps.length,
    coveredIndices
  );

  // Add uncovered ranges as additional skills
  for (const range of uncoveredRanges) {
    const stepsInRange = workflow.steps.slice(range.start, range.end + 1);
    skills.push({
      name: inferSkillName(stepsInRange),
      startStep: range.start,
      endStep: range.end,
      isRepeatable: false,
      variables: detectVariableNames(stepsInRange),
      selectionBehavior: null,
      confidence: 0.4,
      reasoning: 'Steps not covered by explicit annotations',
    });
  }

  // Sort by start step
  skills.sort((a, b) => a.startStep - b.startStep);

  return skills;
}

// ============================================================================
// AI Auto-Analysis
// ============================================================================

/**
 * Analyze workflow with AI (for unannotated workflows)
 * Note: AI analysis via edge function not yet implemented, uses heuristics
 */
async function analyzeWorkflowWithAI(
  workflow: SavedWorkflow
): Promise<SuggestedSkill[]> {
  // For now, use heuristic extraction
  // TODO: Add edge function call when analyze_skills function is created
  console.log('[SkillExtractor] Using heuristic analysis (AI edge function not yet available)');
  return extractSkillsHeuristically(workflow);
}

/**
 * Fallback heuristic extraction (no AI)
 */
function extractSkillsHeuristically(workflow: SavedWorkflow): SuggestedSkill[] {
  const skills: SuggestedSkill[] = [];
  const steps = workflow.steps;

  // Simple heuristics:
  // 1. URL changes often indicate skill boundaries
  // 2. INPUT steps suggest variables
  // 3. Multiple similar CLICK steps suggest repeatability

  let currentStart = 0;
  let currentUrl: string | null = null;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const payload = step.payload;

    if (isWorkflowStepPayload(payload)) {
      const stepUrl = payload.url;

      // URL change = potential skill boundary
      if (currentUrl && stepUrl !== currentUrl && i > currentStart) {
        skills.push({
          name: inferSkillName(steps.slice(currentStart, i)),
          startStep: currentStart,
          endStep: i - 1,
          isRepeatable: detectRepeatablePattern(steps.slice(currentStart, i)),
          variables: detectVariableNames(steps.slice(currentStart, i)),
          selectionBehavior: null,
          confidence: 0.5,
          reasoning: 'Boundary detected at URL change',
        });
        currentStart = i;
      }

      currentUrl = stepUrl;
    }
  }

  // Add final skill
  if (currentStart < steps.length) {
    skills.push({
      name: inferSkillName(steps.slice(currentStart)),
      startStep: currentStart,
      endStep: steps.length - 1,
      isRepeatable: detectRepeatablePattern(steps.slice(currentStart)),
      variables: detectVariableNames(steps.slice(currentStart)),
      selectionBehavior: null,
      confidence: 0.5,
      reasoning: 'Final skill segment',
    });
  }

  return skills.length > 0 ? skills : [createDefaultSkill(workflow)];
}

// ============================================================================
// Skill Creation
// ============================================================================

/**
 * Create full SkillDefinition from SuggestedSkill
 */
export function createSkillDefinition(
  suggested: SuggestedSkill,
  workflow: SavedWorkflow,
  existingVariables?: VariableDefinition[]
): SkillDefinition {
  const steps = workflow.steps.slice(suggested.startStep, suggested.endStep + 1);

  // Get variables for steps in this skill
  const variables = existingVariables?.filter(
    v =>
      v.stepIndex >= suggested.startStep && v.stepIndex <= suggested.endStep
  ) || [];

  return {
    id: generateSkillId(),
    name: suggested.name,
    description: `Skill extracted from "${workflow.name}"`,
    canonicalAction: inferCanonicalAction(suggested.name, steps),
    steps,
    stepRange: { start: suggested.startStep, end: suggested.endStep },
    variables,
    constants: [],
    isRepeatable: suggested.isRepeatable,
    repeatHint: suggested.repeatHint,
    selectionBehavior: suggested.selectionBehavior,
    instructions: [],
    edgeCases: [],
    dependencies: {
      requires: [],
      optional: [],
      enables: [],
      position: 'any',
    },
    sourceWorkflowId: workflow.id,
    sourceWorkflowName: workflow.name,
    extractedAt: Date.now(),
    confidence: suggested.confidence,
  };
}

/**
 * Create full skill definitions from analysis and infer dependencies
 */
export function createSkillsWithDependencies(
  suggestedSkills: SuggestedSkill[],
  workflow: SavedWorkflow,
  existingVariables?: VariableDefinition[]
): SkillDefinition[] {
  // Create skill definitions
  const skills = suggestedSkills.map(s =>
    createSkillDefinition(s, workflow, existingVariables)
  );

  // Sort by step range for dependency inference
  skills.sort((a, b) => a.stepRange.start - b.stepRange.start);

  // Infer dependencies based on position
  inferDependencies(skills);

  return skills;
}

/**
 * Infer dependencies between skills based on position
 */
function inferDependencies(skills: SkillDefinition[]): void {
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];

    // Position based on index
    if (i === 0) {
      skill.dependencies.position = 'start';
      skill.dependencies.requires = [];
    } else if (i === skills.length - 1) {
      skill.dependencies.position = 'end';
      skill.dependencies.requires = [skills[0].id];
      skill.dependencies.optional = skills.slice(1, -1).map(s => s.id);
    } else {
      skill.dependencies.position = 'middle';
      skill.dependencies.requires = [skills[0].id];
    }

    // Enable next skills
    skill.dependencies.enables = skills.slice(i + 1).map(s => s.id);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Infer skill name from steps
 */
function inferSkillName(steps: WorkflowStep[]): string {
  // Find most descriptive step
  for (const step of steps) {
    if (step.description) {
      // Clean up description for use as name
      const desc = step.description
        .replace(/^(Click|Type|Navigate|Select|Scroll)\s*/i, '')
        .replace(/\s+on\s+.+$/, '')
        .trim();
      if (desc.length > 3 && desc.length < 50) {
        return capitalizeFirst(desc);
      }
    }
  }

  // Fallback based on step types
  const types = steps.map(s => s.type);
  if (types.includes('INPUT')) return 'Enter Data';
  if (types.includes('NAVIGATION')) return 'Navigate';
  if (types.filter(t => t === 'CLICK').length > 2) return 'Select Options';

  return 'Workflow Step';
}

/**
 * Describe a step for AI analysis
 * Will be used when AI edge function is implemented
 */
export function describeStep(step: WorkflowStep): string {
  if (step.description) return step.description;

  const payload = step.payload;
  if (isWorkflowStepPayload(payload)) {
    const label = payload.label || payload.elementText || 'element';
    const value = payload.value ? ` = "${payload.value}"` : '';

    switch (step.type) {
      case 'CLICK':
        return `CLICK "${label}"`;
      case 'INPUT':
        return `INPUT "${label}"${value}`;
      case 'NAVIGATION':
        return `NAVIGATE to ${payload.url}`;
      case 'KEYBOARD':
        return `KEYBOARD ${payload.keyboardDetails?.key || 'key'}`;
      case 'SCROLL':
        return `SCROLL`;
      default:
        return `${step.type} on "${label}"`;
    }
  }

  // TabSwitchPayload
  return `TAB_SWITCH from ${(payload as any).fromUrl} to ${(payload as any).toUrl}`;
}

/**
 * Detect variable names from steps
 */
function detectVariableNames(steps: WorkflowStep[]): string[] {
  const names: string[] = [];

  for (const step of steps) {
    if (step.type === 'INPUT') {
      const payload = step.payload;
      if (isWorkflowStepPayload(payload) && payload.label) {
        names.push(payload.label);
      }
    }
  }

  return names;
}

/**
 * Detect if a set of steps represents a repeatable pattern
 */
function detectRepeatablePattern(steps: WorkflowStep[]): boolean {
  // Patterns that suggest repeatability:
  // 1. Contains search/filter + selection
  // 2. Multiple similar CLICK steps
  // 3. Contains "add" or "create" in descriptions

  let hasSearch = false;
  let hasSelection = false;
  let clickCount = 0;

  for (const step of steps) {
    const desc = step.description?.toLowerCase() || '';

    if (desc.includes('search') || desc.includes('filter')) hasSearch = true;
    if (desc.includes('select') || desc.includes('choose')) hasSelection = true;
    if (desc.includes('add') || desc.includes('create')) return true;

    if (step.type === 'CLICK') clickCount++;
  }

  return (hasSearch && hasSelection) || clickCount >= 3;
}

/**
 * Infer canonical action from skill name and steps
 */
function inferCanonicalAction(
  name: string,
  steps: WorkflowStep[]
): CanonicalAction {
  const nameLower = name.toLowerCase();

  // Common verbs and their synonyms
  const verbMappings: Record<string, string[]> = {
    add: ['insert', 'create', 'new', 'include'],
    create: ['make', 'add', 'generate'],
    update: ['edit', 'modify', 'change'],
    delete: ['remove', 'clear', 'erase'],
    submit: ['save', 'confirm', 'send'],
    select: ['choose', 'pick', 'check'],
    search: ['find', 'look for', 'filter'],
    navigate: ['go to', 'open', 'visit'],
  };

  // Detect verb
  let verb = 'perform';
  let verbSynonyms: string[] = [];

  for (const [v, syns] of Object.entries(verbMappings)) {
    if (nameLower.includes(v) || syns.some(s => nameLower.includes(s))) {
      verb = v;
      verbSynonyms = syns;
      break;
    }
  }

  // Extract object (remove verb from name)
  let object = name
    .replace(new RegExp(verb, 'i'), '')
    .replace(new RegExp(verbSynonyms.join('|'), 'i'), '')
    .trim();

  if (object.length < 2) {
    // Try to get object from step descriptions
    for (const step of steps) {
      if (isWorkflowStepPayload(step.payload)) {
        const label = step.payload.label || step.payload.elementText;
        if (label && label.length > 2 && label.length < 30) {
          object = label;
          break;
        }
      }
    }
  }

  if (object.length < 2) {
    object = 'item';
  }

  return {
    verb,
    verbSynonyms,
    object,
    objectSynonyms: [],
  };
}

/**
 * Create default skill (entire workflow)
 */
function createDefaultSkill(workflow: SavedWorkflow): SuggestedSkill {
  return {
    name: workflow.name || 'Workflow',
    startStep: 0,
    endStep: workflow.steps.length - 1,
    isRepeatable: false,
    variables: detectVariableNames(workflow.steps),
    selectionBehavior: null,
    confidence: 0.3,
    reasoning: 'Default: entire workflow as single skill',
  };
}

/**
 * Find ranges not covered by boundaries
 */
function findUncoveredRanges(
  totalSteps: number,
  coveredIndices: Set<number>
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart: number | null = null;

  for (let i = 0; i < totalSteps; i++) {
    if (!coveredIndices.has(i)) {
      if (rangeStart === null) {
        rangeStart = i;
      }
    } else {
      if (rangeStart !== null) {
        ranges.push({ start: rangeStart, end: i - 1 });
        rangeStart = null;
      }
    }
  }

  // Handle trailing uncovered range
  if (rangeStart !== null) {
    ranges.push({ start: rangeStart, end: totalSteps - 1 });
  }

  return ranges;
}

/**
 * Calculate average confidence
 */
function averageConfidence(skills: SuggestedSkill[]): number {
  if (skills.length === 0) return 0;
  const sum = skills.reduce((acc, s) => acc + s.confidence, 0);
  return sum / skills.length;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
