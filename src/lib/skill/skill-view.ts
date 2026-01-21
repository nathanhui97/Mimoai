/**
 * Skill View
 *
 * Extracts a unified Skill view from a SavedWorkflow.
 * This is the bridge between the storage format (SavedWorkflow)
 * and the execution format (Skill).
 */

import type { SavedWorkflow, WorkflowStep } from '../../types/workflow';
import type { WorkflowMemory, ClarificationItem } from '../workflow-memory/types';
import type {
  Skill,
  SkillGoal,
  SkillKnowledge,
  SkillInputs,
  SkillInput,
  SkillSuccessCriteria,
  SuccessCheck,
  SkillMilestone,
  SkillDemonstration,
  DemoStepSummary,
  ElementHints,
  SkillTriggers,
  SkillExperience,
  SkillMetadata,
  SkillSummary,
  KnowledgeRule,
} from './types';

// ============================================================================
// Main Function
// ============================================================================

/**
 * Extract a unified Skill view from a SavedWorkflow
 *
 * @param workflow - The saved workflow to extract skill from
 * @returns Complete Skill object for execution
 */
export function getSkill(workflow: SavedWorkflow): Skill {
  const memory = workflow.memory;

  return {
    id: workflow.id,
    name: workflow.name,
    learnedAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,

    goal: extractGoal(workflow, memory),
    knowledge: extractKnowledge(workflow, memory),
    inputs: extractInputs(workflow, memory),
    successCriteria: extractSuccessCriteria(workflow, memory),
    milestones: extractMilestones(workflow, memory),
    demonstration: extractDemonstration(workflow),
    triggers: extractTriggers(workflow, memory),
    experience: extractExperience(workflow, memory),
    metadata: extractMetadata(workflow, memory),
  };
}

/**
 * Get a lightweight summary of a skill (for lists and matching)
 */
export function getSkillSummary(workflow: SavedWorkflow): SkillSummary {
  const memory = workflow.memory;

  return {
    id: workflow.id,
    name: workflow.name,
    goalSummary: memory?.identity?.purpose ||
                 workflow.description ||
                 workflow.inferredIntent?.primaryGoal ||
                 'Execute workflow',
    domain: memory?.identity?.domain || 'General',
    triggers: memory?.triggers?.phrases || [],
    inputNames: [
      ...(memory?.inputs?.required || []).map(i => i.name),
      ...(memory?.inputs?.optional || []).map(i => i.name),
    ],
    successRate: memory?.experience?.successRate ||
                 (workflow.executionStats
                   ? workflow.executionStats.successfulRuns / workflow.executionStats.totalRuns
                   : 0),
    lastExecuted: memory?.experience?.lastExecuted || workflow.executionStats?.lastRun,
    isReady: calculateReadiness(workflow, memory),
  };
}

// ============================================================================
// Extraction Functions
// ============================================================================

function extractGoal(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillGoal {
  // Try multiple sources for goal information
  const description = memory?.identity?.purpose ||
                     workflow.description ||
                     workflow.inferredIntent?.primaryGoal ||
                     `Execute ${workflow.name}`;

  const summary = memory?.understanding?.elevator ||
                 workflow.learnedSkill?.whatItDoes ||
                 description;

  const domain = memory?.identity?.domain ||
                'General';

  // Infer entity from workflow name or memory
  const entity = inferEntity(workflow.name, memory);

  // Infer action type from memory category or workflow analysis
  const action = inferActionType(memory?.identity?.category, workflow);

  return {
    description,
    summary,
    domain,
    entity,
    action,
  };
}

function extractKnowledge(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillKnowledge {
  const rules: KnowledgeRule[] = [];
  const tips: string[] = [];
  const warnings: string[] = [];
  const variations: string[] = [];

  // Extract rules from Q&A clarifications
  if (memory?.clarifications?.items) {
    for (const item of memory.clarifications.items) {
      const rule = clarificationToRule(item);
      if (rule) {
        rules.push(rule);
      }
    }
  }

  // Extract from learned skill constants
  if (workflow.learnedSkill?.constants) {
    for (const constant of workflow.learnedSkill.constants) {
      rules.push({
        rule: `${constant.name} should always be "${constant.value}"`,
        source: 'analysis',
        appliesTo: constant.name,
        confidence: 0.9,
      });
    }
  }

  // Extract tips from adaptability strategies
  if (memory?.adaptability?.fallbacks) {
    for (const fallback of memory.adaptability.fallbacks) {
      tips.push(`If ${fallback.when}, then ${fallback.then}`);
    }
  }

  // Extract warnings from trouble spots
  if (memory?.experience?.troubleSpots) {
    for (const spot of memory.experience.troubleSpots) {
      warnings.push(`${spot.issue} - Solution: ${spot.solution}`);
    }
  }

  // Extract variations from adaptability
  if (memory?.adaptability?.handledVariations) {
    variations.push(...memory.adaptability.handledVariations);
  }

  return { rules, tips, warnings, variations };
}

function extractInputs(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillInputs {
  const required: SkillInput[] = [];
  const optional: SkillInput[] = [];

  // Primary source: memory inputs
  if (memory?.inputs) {
    for (const input of memory.inputs.required || []) {
      required.push(convertMemoryInput(input, true));
    }
    for (const input of memory.inputs.optional || []) {
      optional.push(convertMemoryInput(input, false));
    }
  }

  // Fallback: workflow variables
  if (required.length === 0 && optional.length === 0 && workflow.variables?.variables) {
    for (const variable of workflow.variables.variables) {
      const input: SkillInput = {
        name: variable.fieldName,
        variableName: variable.variableName,
        description: `Input for ${variable.fieldName}`,
        type: inferInputType(variable.inputType || 'text'),
        examples: variable.defaultValue ? [variable.defaultValue] : [],
        extractionHints: [],
        defaultValue: variable.defaultValue,
        supportsArray: false,
        arraySeparators: ['and', ','],
      };

      // Determine if required based on having a default
      if (variable.defaultValue) {
        optional.push(input);
      } else {
        required.push(input);
      }
    }
  }

  return { required, optional };
}

function extractSuccessCriteria(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillSuccessCriteria {
  const primary: SuccessCheck = {
    type: 'text_appears',
    description: 'Task completes successfully',
  };

  const secondary: SuccessCheck[] = [];
  const failureIndicators: string[] = [];

  // Extract from memory success criteria
  if (memory?.success) {
    // Find primary indicator
    const primaryIndicator = memory.success.indicators.find(i => i.priority === 'primary');
    if (primaryIndicator) {
      primary.type = mapSuccessType(primaryIndicator.type);
      primary.description = primaryIndicator.description;
      primary.pattern = primaryIndicator.pattern;
    }

    // Find secondary indicators
    for (const indicator of memory.success.indicators) {
      if (indicator.priority !== 'primary') {
        secondary.push({
          type: mapSuccessType(indicator.type),
          description: indicator.description,
          pattern: indicator.pattern,
        });
      }
    }

    failureIndicators.push(...memory.success.failureIndicators);
  }

  // Fallback: extract from AI analysis
  if (workflow.aiAnalysis?.workflowUnderstanding) {
    if (failureIndicators.length === 0) {
      failureIndicators.push(...(workflow.aiAnalysis.workflowUnderstanding.failureIndicators || []));
    }
  }

  return {
    primary,
    secondary,
    failureIndicators: failureIndicators.length > 0 ? failureIndicators : ['Error message appears'],
    endState: memory?.success?.endState || 'Task completed',
    timeout: memory?.success?.verificationTimeout || 5000,
  };
}

function extractMilestones(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillMilestone[] {
  const milestones: SkillMilestone[] = [];

  // Primary source: memory phases/blocks
  if (memory?.understanding?.phases) {
    for (let i = 0; i < memory.understanding.phases.length; i++) {
      const phase = memory.understanding.phases[i];
      milestones.push({
        id: `milestone_${i}`,
        name: phase.name,
        description: phase.purpose,
        stepIndices: phase.stepIndices,
        criticality: phase.criticality,
        order: i,
      });
    }
  }

  // If no milestones from memory, create basic ones from workflow structure
  if (milestones.length === 0 && workflow.steps.length > 0) {
    // Create simple start/middle/end milestones
    const stepCount = workflow.steps.length;

    milestones.push({
      id: 'milestone_0',
      name: 'Start',
      description: 'Begin the task',
      stepIndices: [0],
      criticality: 'critical',
      order: 0,
    });

    if (stepCount > 2) {
      milestones.push({
        id: 'milestone_1',
        name: 'Main Actions',
        description: 'Perform the main task actions',
        stepIndices: Array.from({ length: stepCount - 2 }, (_, i) => i + 1),
        criticality: 'critical',
        order: 1,
      });
    }

    milestones.push({
      id: `milestone_${milestones.length}`,
      name: 'Complete',
      description: 'Finish and verify',
      stepIndices: [stepCount - 1],
      criticality: 'critical',
      order: milestones.length,
    });
  }

  return milestones;
}

function extractDemonstration(workflow: SavedWorkflow): SkillDemonstration {
  const steps: DemoStepSummary[] = workflow.steps.map((step, index) => {
    const payload = step.payload as any;
    return {
      index,
      action: mapStepAction(step.type),
      what: extractStepWhat(step),
      why: extractStepWhy(step, workflow),
      value: step.type === 'INPUT' ? payload.value : undefined,
      isCritical: true, // Could be enhanced with AI analysis
      elementHints: extractElementHints(step),
    };
  });

  // Extract starting URL
  const navigateStep = workflow.steps.find(s => s.type === 'NAVIGATION');
  const startUrl = navigateStep ? (navigateStep.payload as any)?.url : undefined;

  // Extract unique pages visited
  const pagesVisitedSet = new Set(
    workflow.steps
      .filter(s => s.type === 'NAVIGATION')
      .map(s => {
        const payload = s.payload as any;
        try {
          return new URL(payload.url).hostname + new URL(payload.url).pathname;
        } catch {
          return payload.url;
        }
      })
  );
  const pagesVisited = Array.from(pagesVisitedSet);

  return {
    workflowId: workflow.id,
    totalSteps: workflow.steps.length,
    steps,
    startUrl,
    pagesVisited: pagesVisited.length > 0 ? pagesVisited : undefined,
  };
}

function extractTriggers(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillTriggers {
  // Primary source: memory triggers
  if (memory?.triggers) {
    return {
      phrases: memory.triggers.phrases || [],
      verbSynonyms: memory.triggers.verbSynonyms || [],
      objectSynonyms: memory.triggers.objectSynonyms || [],
      contextTerms: extractContextTerms(workflow, memory),
      exclusions: memory.triggers.notWhen || [],
    };
  }

  // Fallback: extract from learned skill
  if (workflow.learnedSkill) {
    return {
      phrases: workflow.learnedSkill.exampleQueries || [],
      verbSynonyms: workflow.learnedSkill.canonicalAction
        ? [workflow.learnedSkill.canonicalAction.verb]
        : [],
      objectSynonyms: workflow.learnedSkill.canonicalAction
        ? [workflow.learnedSkill.canonicalAction.object]
        : [],
      contextTerms: extractContextTerms(workflow, memory),
      exclusions: [],
    };
  }

  // Last resort: generate from workflow name
  const nameParts = workflow.name.toLowerCase().split(' ');
  return {
    phrases: [workflow.name.toLowerCase()],
    verbSynonyms: nameParts.length > 0 ? [nameParts[0]] : [],
    objectSynonyms: nameParts.length > 1 ? [nameParts.slice(1).join(' ')] : [],
    contextTerms: [],
    exclusions: [],
  };
}

function extractExperience(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillExperience {
  // Primary source: memory experience
  if (memory?.experience) {
    return {
      timesExecuted: memory.experience.timesExecuted,
      successfulExecutions: memory.experience.successfulExecutions,
      successRate: memory.experience.successRate,
      lastExecuted: memory.experience.lastExecuted,
      averageDuration: memory.experience.averageDuration,
      commonIssues: memory.experience.troubleSpots?.map(t => t.issue) || [],
      provenStrategies: memory.experience.provenStrategies?.map(s => s.strategy) || [],
      corrections: (memory.experience.userCorrections || []).map(c => ({
        correction: c.correction,
        timestamp: c.timestamp,
      })),
    };
  }

  // Fallback: workflow execution stats
  if (workflow.executionStats) {
    return {
      timesExecuted: workflow.executionStats.totalRuns,
      successfulExecutions: workflow.executionStats.successfulRuns,
      successRate: workflow.executionStats.totalRuns > 0
        ? workflow.executionStats.successfulRuns / workflow.executionStats.totalRuns
        : 0,
      lastExecuted: workflow.executionStats.lastRun,
      averageDuration: workflow.executionStats.averageDurationMs,
      commonIssues: [],
      provenStrategies: [],
      corrections: [],
    };
  }

  // Default: no experience
  return {
    timesExecuted: 0,
    successfulExecutions: 0,
    successRate: 0,
    commonIssues: [],
    provenStrategies: [],
    corrections: [],
  };
}

function extractMetadata(workflow: SavedWorkflow, memory?: WorkflowMemory): SkillMetadata {
  // Calculate overall confidence
  const confidence = calculateConfidence(workflow, memory);

  // Determine if ready for use
  const isReady = calculateReadiness(workflow, memory);

  // Extract tags
  const tags = memory?.identity?.tags || [];

  // Extract application
  const application = memory?.triggers?.pageContext?.applications?.[0] ||
                     memory?.identity?.domain;

  // Extract URL patterns
  const urlPatterns = memory?.triggers?.pageContext?.urlPatterns;

  return {
    confidence,
    isReady,
    tags,
    application,
    urlPatterns,
    version: '1.0',
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function clarificationToRule(item: ClarificationItem): KnowledgeRule | null {
  // Convert Q&A answer to actionable rule
  const answer = item.customAnswer || item.answerText;

  if (!answer || answer.toLowerCase() === 'skip' || answer.toLowerCase() === 'optional') {
    return null;
  }

  return {
    rule: `${item.question} → ${answer}`,
    source: 'qa_answer',
    appliesTo: item.category,
    confidence: 0.95, // High confidence since user explicitly answered
  };
}

function convertMemoryInput(input: any, _isRequired: boolean): SkillInput {
  return {
    name: input.name,
    variableName: input.variableName || input.name.toLowerCase().replace(/\s+/g, '_'),
    description: input.description || `Input for ${input.name}`,
    type: inferInputType(input.type),
    examples: input.exampleValues || [],
    extractionHints: input.extractionHints || [],
    defaultValue: input.defaultValue,
    supportsArray: input.isArray || false,
    arraySeparators: input.arraySeparators || ['and', ','],
  };
}

function inferInputType(type: string): SkillInput['type'] {
  const typeMap: Record<string, SkillInput['type']> = {
    'text': 'text',
    'person_name': 'person_name',
    'company_name': 'company_name',
    'email': 'email',
    'phone': 'phone',
    'number': 'number',
    'currency': 'currency',
    'date': 'date',
    'url': 'url',
    'select': 'select',
    'boolean': 'boolean',
  };

  return typeMap[type] || 'text';
}

function mapSuccessType(type: string): SuccessCheck['type'] {
  const typeMap: Record<string, SuccessCheck['type']> = {
    'toast_appears': 'toast_appears',
    'text_appears': 'text_appears',
    'text_disappears': 'text_disappears',
    'url_changes': 'url_changes',
    'element_appears': 'element_appears',
    'element_disappears': 'element_disappears',
    'modal_closes': 'modal_closes',
    'form_clears': 'form_clears',
    'navigation_complete': 'navigation_complete',
  };

  return typeMap[type] || 'text_appears';
}

function mapStepAction(type: string): DemoStepSummary['action'] {
  const actionMap: Record<string, DemoStepSummary['action']> = {
    'CLICK': 'click',
    'INPUT': 'type',
    'NAVIGATION': 'navigate',
    'SCROLL': 'scroll',
    'KEYBOARD': 'other',
    'TAB_SWITCH': 'other',
    'COPY': 'other',
    'PASTE': 'other',
  };

  return actionMap[type] || 'other';
}

function extractStepWhat(step: WorkflowStep): string {
  // Use 'any' to safely access payload properties that may not exist on all step types
  const payload = step.payload as any;

  // Try to get a human-readable description of what was targeted
  if (payload.label) {
    return payload.label;
  }

  if (payload.elementText) {
    return `"${payload.elementText}" ${payload.elementRole || 'element'}`;
  }

  if (payload.elementRole) {
    return payload.elementRole;
  }

  if (step.type === 'NAVIGATION' && payload.url) {
    try {
      const url = new URL(payload.url);
      return `${url.hostname}${url.pathname}`;
    } catch {
      return payload.url;
    }
  }

  return 'element';
}

function extractStepWhy(step: WorkflowStep, workflow: SavedWorkflow): string {
  // Use 'any' to safely access payload properties
  const payload = step.payload as any;

  // Try to get intent from AI analysis
  const stepIndex = workflow.steps.indexOf(step);
  const guidance = workflow.aiAnalysis?.stepGuidance?.find(g => g.stepIndex === stepIndex);

  if (guidance?.intent) {
    return guidance.intent;
  }

  // Fallback: generate from step type and description
  if (step.type === 'CLICK') {
    return `Click on ${extractStepWhat(step)}`;
  }
  if (step.type === 'INPUT') {
    return `Enter value in ${payload.label || 'field'}`;
  }
  if (step.type === 'NAVIGATION') {
    return 'Navigate to page';
  }
  if (step.type === 'KEYBOARD') {
    return 'Press keyboard key';
  }

  return step.description || 'Perform action';
}

function extractElementHints(step: WorkflowStep): ElementHints {
  // Use 'any' to safely access payload properties
  const payload = step.payload as any;

  return {
    role: payload.elementRole,
    text: payload.elementText,
    name: payload.label,
    label: payload.label,
    testId: payload.context?.testId,
    placeholder: payload.context?.placeholder,
    selector: payload.selector,
  };
}

function extractContextTerms(_workflow: SavedWorkflow, memory?: WorkflowMemory): string[] {
  const terms: string[] = [];

  // Add domain
  if (memory?.identity?.domain) {
    terms.push(memory.identity.domain);
  }

  // Add application
  if (memory?.triggers?.pageContext?.applications) {
    terms.push(...memory.triggers.pageContext.applications);
  }

  // Add entities
  if (memory?.understanding?.entities) {
    terms.push(...memory.understanding.entities);
  }

  // Remove duplicates using Array.from(new Set())
  return Array.from(new Set(terms));
}

function inferEntity(name: string, memory?: WorkflowMemory): string | undefined {
  // Try memory entities
  if (memory?.understanding?.entities?.length) {
    return memory.understanding.entities[0];
  }

  // Infer from name
  const nameLower = name.toLowerCase();
  const entityPatterns = [
    /add\s+(\w+)/i,
    /create\s+(\w+)/i,
    /new\s+(\w+)/i,
    /(\w+)\s+entry/i,
  ];

  for (const pattern of entityPatterns) {
    const match = nameLower.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function inferActionType(
  category: string | undefined,
  workflow: SavedWorkflow
): SkillGoal['action'] {
  if (category) {
    const categoryMap: Record<string, SkillGoal['action']> = {
      'data_entry': 'create',
      'navigation': 'navigate',
      'lookup': 'read',
      'modification': 'update',
      'deletion': 'delete',
      'export': 'export',
    };

    if (categoryMap[category]) {
      return categoryMap[category];
    }
  }

  // Infer from workflow name
  const nameLower = workflow.name.toLowerCase();
  if (nameLower.includes('add') || nameLower.includes('create') || nameLower.includes('new')) {
    return 'create';
  }
  if (nameLower.includes('edit') || nameLower.includes('update') || nameLower.includes('modify')) {
    return 'update';
  }
  if (nameLower.includes('delete') || nameLower.includes('remove')) {
    return 'delete';
  }
  if (nameLower.includes('find') || nameLower.includes('search') || nameLower.includes('look')) {
    return 'read';
  }
  if (nameLower.includes('go') || nameLower.includes('navigate') || nameLower.includes('open')) {
    return 'navigate';
  }
  if (nameLower.includes('export') || nameLower.includes('download')) {
    return 'export';
  }

  return 'other';
}

function calculateConfidence(_workflow: SavedWorkflow, memory?: WorkflowMemory): number {
  let score = 0;
  let checks = 0;

  // Has memory
  checks++;
  if (memory) score += 0.3;

  // Has triggers
  checks++;
  if (memory?.triggers?.phrases?.length) score += 0.2;

  // Has success criteria
  checks++;
  if (memory?.success?.indicators?.length) score += 0.2;

  // Has clarifications (Q&A completed)
  checks++;
  if (memory?.clarifications?.items?.length) score += 0.15;

  // Has milestones/phases
  checks++;
  if (memory?.understanding?.phases?.length) score += 0.15;

  return Math.min(score, 1);
}

function calculateReadiness(workflow: SavedWorkflow, memory?: WorkflowMemory): boolean {
  // Minimum requirements for a skill to be "ready"
  const hasSteps = workflow.steps.length > 0;
  const hasGoal = !!(memory?.identity?.purpose || workflow.description);
  // Note: Could add hasInputs check for stricter readiness in the future
  return hasSteps && hasGoal;
}
