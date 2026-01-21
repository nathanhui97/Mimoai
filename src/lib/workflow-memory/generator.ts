/**
 * Workflow Memory Generator
 *
 * Generates WorkflowMemory from existing workflow data.
 * Consolidates scattered information into a unified memory structure.
 */

import type { SavedWorkflow, WorkflowStep, WorkflowStepPayload } from '../../types/workflow';
import { isWorkflowStepPayload } from '../../types/workflow';
import type {
  WorkflowMemory,
  WorkflowIdentity,
  WorkflowUnderstanding,
  WorkflowInputs,
  WorkflowTriggers,
  ExecutionPattern,
  SuccessCriteria,
  Adaptability,
  ExecutionExperience,
  InputField,
  InputType,
  TaskCategory,
  PatternType,
  WorkflowPhase,
  SuccessIndicator,
} from './types';
import { aiConfig } from '../ai-config';

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a complete WorkflowMemory from a SavedWorkflow
 *
 * This is a two-step process:
 * 1. Consolidate existing data (local, instant)
 * 2. Enhance with AI analysis (remote, async)
 */
export async function generateWorkflowMemory(
  workflow: SavedWorkflow,
  options?: GeneratorOptions
): Promise<WorkflowMemory> {
  // Step 1: Consolidate existing data
  const consolidated = consolidateExistingData(workflow);

  // Step 2: Enhance with AI if enabled
  if (options?.useAI !== false) {
    try {
      const enhanced = await enhanceWithAI(consolidated, workflow);
      return enhanced;
    } catch (error) {
      console.warn('[WorkflowMemory] AI enhancement failed, using consolidated data:', error);
      return consolidated;
    }
  }

  return consolidated;
}

export interface GeneratorOptions {
  /**
   * Whether to use AI for enhancement (default: true)
   */
  useAI?: boolean;

  /**
   * Include execution history in experience
   */
  includeExperience?: boolean;
}

// ============================================================================
// Step 1: Consolidate Existing Data
// ============================================================================

/**
 * Create memory from existing workflow data without AI calls
 */
function consolidateExistingData(workflow: SavedWorkflow): WorkflowMemory {
  return {
    version: '1.0',
    generatedAt: Date.now(),
    identity: buildIdentity(workflow),
    understanding: buildUnderstanding(workflow),
    inputs: buildInputs(workflow),
    triggers: buildTriggers(workflow),
    pattern: buildPattern(workflow),
    success: buildSuccessCriteria(workflow),
    adaptability: buildAdaptability(workflow),
    experience: buildExperience(workflow),
  };
}

function buildIdentity(workflow: SavedWorkflow): WorkflowIdentity {
  const skill = workflow.learnedSkill;
  const analysis = workflow.aiAnalysis?.workflowUnderstanding;
  const variables = workflow.variables?.variables || [];

  // Get field names for context (LLM will use these to generate smart purpose)
  const fieldNames = variables.map(v => v.fieldName).filter(Boolean);

  // Use existing analysis or skill description if available
  // Otherwise, create a placeholder that includes field names for LLM to enhance
  let purpose = analysis?.summary || skill?.whatItDoes || workflow.description;

  // If purpose is generic/missing, create a basic one with field names
  // The LLM enhancement will make this smarter
  if (!purpose || purpose.includes('specific columns') || purpose.includes('specific data')) {
    if (fieldNames.length > 0) {
      const fieldList = fieldNames.join(', ');
      purpose = `Data entry workflow with fields: ${fieldList}`;
    } else {
      purpose = workflow.description || `${workflow.name} workflow`;
    }
  }

  return {
    name: workflow.name,
    purpose,
    domain: analysis?.domain ||
            skill?.domain?.application ||
            detectDomain(workflow),
    category: detectCategory(workflow),
    tags: extractTags(workflow),
  };
}

function buildUnderstanding(workflow: SavedWorkflow): WorkflowUnderstanding {
  const analysis = workflow.aiAnalysis?.workflowUnderstanding;
  const skill = workflow.learnedSkill;
  const variables = workflow.variables?.variables || [];

  // Get field names - these will be passed to LLM for smart elevator generation
  const fieldNames = variables.map(v => v.fieldName).filter(Boolean);

  // Use existing analysis or skill description
  // If generic, create placeholder with field names for LLM to enhance
  let elevator = analysis?.summary || skill?.whatItDoes || workflow.description;

  // If generic or missing, include field names so LLM can generate smart description
  if (!elevator || elevator.includes('specific columns') || elevator.includes('specific data') || elevator.includes('combobox')) {
    if (fieldNames.length > 0) {
      const fieldList = fieldNames.join(', ');
      // This placeholder will be enhanced by LLM to something like:
      // "Add a contact to the spreadsheet" or "Log an inventory item"
      elevator = `Enter ${fieldList} into ${detectDomain(workflow)}`;
    } else {
      elevator = workflow.description || `${workflow.name} workflow`;
    }
  }

  return {
    elevator,
    phases: buildPhases(workflow),
    entities: [...(analysis?.entities || []), ...fieldNames],
    prerequisites: extractPrerequisites(workflow),
  };
}

function buildInputs(workflow: SavedWorkflow): WorkflowInputs {
  const variables = workflow.variables?.variables || [];
  const learnedVariables = workflow.learnedSkill?.extractableVariables || [];

  const required: InputField[] = [];
  const optional: InputField[] = [];

  for (const v of variables) {
    const learned = learnedVariables.find(lv =>
      lv.name.toLowerCase() === v.fieldName.toLowerCase()
    );

    const field: InputField = {
      name: v.fieldName,
      variableName: v.variableName,
      description: learned?.examples?.[0]
        ? `Example: ${learned.examples.join(', ')}`
        : `Value for ${v.fieldName}`,
      type: inferInputType(v.fieldName, v.inputType),
      extractionHints: learned?.patterns || generateExtractionHints(v.fieldName),
      exampleValues: learned?.examples || [v.defaultValue].filter(Boolean) as string[],
      defaultValue: v.defaultValue,
      usedInSteps: [v.stepIndex],
    };

    // Determine if required or optional based on having a default
    if (v.defaultValue) {
      optional.push(field);
    } else {
      required.push(field);
    }
  }

  return { required, optional };
}

function buildTriggers(workflow: SavedWorkflow): WorkflowTriggers {
  const skill = workflow.learnedSkill;

  // Start with learned skill data (from teaching conversation)
  const phrases: string[] = [...(skill?.exampleQueries || [])];

  // Add canonical action as a phrase
  if (skill?.canonicalAction) {
    const { verb, object } = skill.canonicalAction;
    phrases.push(`${verb} ${object}`);
  }

  // Add workflow name as a phrase (user chose this name for a reason)
  const nameWords = workflow.name.toLowerCase().split(/\s+/);
  if (nameWords.length >= 2) {
    phrases.push(nameWords.join(' '));
  }

  // NOTE: We intentionally DON'T hardcode trigger phrases here.
  // The AI enhancement (generate_workflow_memory edge function) will
  // analyze the field names and generate appropriate trigger phrases.
  // e.g., for "Name, Email, Phone" → "add contact"
  //       for "Product, Price, Qty" → "add product", "new inventory"

  // Build context from recording
  const firstStep = workflow.steps[0];
  const urls: string[] = [];
  if (firstStep && isWorkflowStepPayload(firstStep.payload)) {
    const url = (firstStep.payload as WorkflowStepPayload).url;
    if (url) {
      const urlPattern = url.replace(/https?:\/\/[^/]+/, '*');
      urls.push(urlPattern);
    }
  }

  return {
    phrases: [...new Set(phrases.filter(Boolean))],
    verbSynonyms: skill?.canonicalAction?.verbSynonyms,
    objectSynonyms: skill?.canonicalAction?.objectSynonyms,
    pageContext: urls.length > 0 ? {
      urlPatterns: urls,
      applications: skill?.domain?.application ? [skill.domain.application] : undefined,
    } : undefined,
  };
}

function buildPattern(workflow: SavedWorkflow): ExecutionPattern {
  const patternType = detectPatternType(workflow);
  const isSpreadsheet = detectIsSpreadsheet(workflow);

  const pattern: ExecutionPattern = {
    type: patternType,
  };

  // For data entry workflows, check if repeatable
  if (patternType === 'single_entry' || patternType === 'repeatable') {
    pattern.repetition = {
      supportsMultiple: patternType === 'repeatable' || isSpreadsheet,
      separators: ['and', ',', 'then', ';'],
    };
  }

  // For spreadsheet workflows, add data entry config
  if (isSpreadsheet) {
    pattern.dataEntry = {
      targetStrategy: 'first_empty_row', // Default to finding first empty row
      preservesExisting: true,
      isSpreadsheet: true,
      columnMapping: extractColumnMapping(workflow),
    };
  }

  return pattern;
}

function buildSuccessCriteria(workflow: SavedWorkflow): SuccessCriteria {
  const analysis = workflow.aiAnalysis?.workflowUnderstanding;
  const indicators: SuccessIndicator[] = [];

  // Build from AI analysis
  if (analysis?.successIndicators) {
    for (const indicator of analysis.successIndicators) {
      indicators.push({
        type: inferSuccessType(indicator),
        description: indicator,
        pattern: extractPattern(indicator),
        priority: indicators.length === 0 ? 'primary' : 'secondary',
      });
    }
  }

  // Add default fallback
  if (indicators.length === 0) {
    indicators.push({
      type: 'element_appears',
      description: 'Page state changes after final action',
      priority: 'fallback',
    });
  }

  return {
    indicators,
    failureIndicators: analysis?.failureIndicators || [
      'Error message appears',
      'Form validation fails',
      'Network request fails',
    ],
    endState: analysis?.summary
      ? `Completed: ${analysis.summary}`
      : 'Workflow completed successfully',
    verificationTimeout: 5000,
  };
}

function buildAdaptability(workflow: SavedWorkflow): Adaptability {
  const guidance = workflow.aiAnalysis?.stepGuidance || [];

  return {
    optionalSteps: guidance
      .filter(g => g.criticality === 'optional')
      .map(g => ({
        stepIndex: g.stepIndex,
        skipCondition: 'When the corresponding input is not provided',
      })),
    reorderablePhases: false, // Conservative default
    handledVariations: [],
    fallbacks: guidance
      .filter(g => g.alternatives && g.alternatives.length > 0)
      .map(g => ({
        when: `${g.intent} element not found`,
        then: g.alternatives?.[0] || 'Try alternative approach',
        forStep: g.stepIndex,
      })),
  };
}

function buildExperience(workflow: SavedWorkflow): ExecutionExperience {
  const stats = workflow.executionStats;

  return {
    timesExecuted: stats?.totalRuns || 0,
    successfulExecutions: stats?.successfulRuns || 0,
    successRate: stats ? (stats.successfulRuns / stats.totalRuns) : 0,
    lastExecuted: stats?.lastRun,
    averageDuration: stats?.averageDurationMs,
    troubleSpots: (stats?.commonFailurePoints || []).map(stepIndex => ({
      stepIndex,
      issue: 'Step frequently fails',
      solution: 'May need element verification or retry',
      frequency: 0.5,
    })),
    provenStrategies: [],
  };
}

// ============================================================================
// Step 2: AI Enhancement
// ============================================================================

async function enhanceWithAI(
  memory: WorkflowMemory,
  workflow: SavedWorkflow
): Promise<WorkflowMemory> {
  const config = aiConfig.getConfig();
  const url = `${config.supabaseUrl}/functions/v1/generate_workflow_memory`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.supabaseAnonKey}`,
    },
    body: JSON.stringify({
      workflow: {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps.map(simplifyStep),
        variables: workflow.variables?.variables,
        existingAnalysis: workflow.aiAnalysis,
        learnedSkill: workflow.learnedSkill,
      },
      currentMemory: memory,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI enhancement failed: ${response.status}`);
  }

  const enhanced = await response.json();

  // Edge function returns { memory: {...}, analysis: {...} }
  // We need to extract the memory object and merge it properly
  const enhancedMemory = enhanced.memory || enhanced;

  return {
    ...memory,
    ...enhancedMemory,
    // Ensure understanding is properly merged (not replaced)
    understanding: {
      ...memory.understanding,
      ...(enhancedMemory.understanding || {}),
    },
    generatedAt: Date.now(),
  };
}

function simplifyStep(step: WorkflowStep): object {
  const payload = step.payload;
  if (!isWorkflowStepPayload(payload)) {
    return { type: step.type, description: step.description };
  }

  return {
    type: step.type,
    description: step.description,
    label: payload.label,
    value: payload.value,
    elementText: payload.elementText,
    url: payload.url,
    context: payload.context ? {
      formCoordinates: payload.context.formCoordinates,
      gridCoordinates: payload.context.gridCoordinates,
    } : undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function detectDomain(workflow: SavedWorkflow): string {
  const firstStep = workflow.steps[0];
  if (!firstStep || !isWorkflowStepPayload(firstStep.payload)) {
    return 'General';
  }

  const url = (firstStep.payload as WorkflowStepPayload).url.toLowerCase();

  if (url.includes('salesforce') || url.includes('force.com')) return 'Salesforce CRM';
  if (url.includes('gainsight')) return 'Gainsight';
  if (url.includes('sheets.google') || url.includes('docs.google.com/spreadsheets')) return 'Google Sheets';
  if (url.includes('excel') || url.includes('office')) return 'Microsoft Excel';
  if (url.includes('hubspot')) return 'HubSpot';
  if (url.includes('zendesk')) return 'Zendesk';

  return 'Web Application';
}

function detectCategory(workflow: SavedWorkflow): TaskCategory {
  const skill = workflow.learnedSkill;
  const domain = workflow.aiAnalysis?.workflowUnderstanding?.domain?.toLowerCase() || '';

  // Check AI analysis domain
  if (domain.includes('data entry') || domain.includes('form')) return 'data_entry';
  if (domain.includes('export') || domain.includes('report')) return 'export';
  if (domain.includes('navigation')) return 'navigation';

  // Check learned skill category
  if (skill?.domain?.category) {
    const cat = skill.domain.category.toLowerCase();
    if (cat.includes('data') || cat.includes('entry')) return 'data_entry';
    if (cat.includes('report') || cat.includes('export')) return 'export';
    if (cat.includes('navigation')) return 'navigation';
  }

  // Check if it's data entry (has input steps)
  const hasInputs = workflow.steps.some(s => s.type === 'INPUT');
  const hasVariables = (workflow.variables?.variables?.length || 0) > 0;
  if (hasInputs && hasVariables) return 'data_entry';

  // Check for navigation-only workflows
  const onlyNavigation = workflow.steps.every(s =>
    s.type === 'NAVIGATION' || s.type === 'CLICK'
  );
  if (onlyNavigation && !hasInputs) return 'navigation';

  return 'other';
}

function extractTags(workflow: SavedWorkflow): string[] {
  const tags: string[] = [];

  // From domain
  const skill = workflow.learnedSkill;
  if (skill?.domain?.application) tags.push(skill.domain.application.toLowerCase());
  if (skill?.domain?.category) tags.push(skill.domain.category.toLowerCase());

  // From workflow name
  const words = workflow.name.toLowerCase().split(/\s+/);
  tags.push(...words.filter(w => w.length > 3));

  return [...new Set(tags)];
}

function buildPhases(_workflow: SavedWorkflow): WorkflowPhase[] {
  // Return empty array - let the AI edge function generate semantic phases
  // Previously this generated generic phases like "Interaction", "Data Entry"
  // which were not useful for progress tracking or user communication.
  // The edge function will generate task-specific phases like:
  // "Select Restaurant", "Configure BOGO Discount", "Submit Promotion"
  return [];
}

function extractPrerequisites(workflow: SavedWorkflow): string[] {
  const prereqs: string[] = [];

  // Check first step for login/auth requirements
  const firstStep = workflow.steps[0];
  if (firstStep && isWorkflowStepPayload(firstStep.payload)) {
    const url = (firstStep.payload as WorkflowStepPayload).url;
    if (url && !url.includes('login')) {
      prereqs.push('Must be logged into the application');
    }
  }

  return prereqs;
}

function inferInputType(fieldName: string, existingType?: string): InputType {
  const name = fieldName.toLowerCase();

  if (existingType === 'email' || name.includes('email')) return 'email';
  if (existingType === 'tel' || name.includes('phone') || name.includes('tel')) return 'phone';
  if (name.includes('name') && !name.includes('company')) return 'person_name';
  if (name.includes('company') || name.includes('org')) return 'company_name';
  if (name.includes('amount') || name.includes('price') || name.includes('cost')) return 'currency';
  if (name.includes('date')) return 'date';
  if (name.includes('address')) return 'address';
  if (existingType === 'number') return 'number';

  return 'text';
}

function generateExtractionHints(fieldName: string): string[] {
  const name = fieldName.toLowerCase();
  const hints: string[] = [];

  // Add field name variations
  hints.push(name);
  hints.push(`${name} is`);
  hints.push(`${name}:`);

  // Add contextual hints based on field type
  if (name.includes('name')) {
    hints.push('named', 'called', 'for');
  }
  if (name.includes('email')) {
    hints.push('email', 'at', '@');
  }
  if (name.includes('phone')) {
    hints.push('phone', 'number', 'call');
  }
  if (name.includes('amount') || name.includes('price')) {
    hints.push('worth', 'costs', 'for $', 'valued at');
  }

  return hints;
}

function detectPatternType(workflow: SavedWorkflow): PatternType {
  const hasInputs = workflow.steps.some(s => s.type === 'INPUT');
  const isSpreadsheet = detectIsSpreadsheet(workflow);

  if (isSpreadsheet || (hasInputs && workflow.variables?.variables?.length)) {
    return 'repeatable'; // Data entry is usually repeatable
  }

  const onlyNav = workflow.steps.every(s =>
    s.type === 'NAVIGATION' || s.type === 'CLICK'
  );
  if (onlyNav && !hasInputs) return 'navigation';

  return 'single_entry';
}

function detectIsSpreadsheet(workflow: SavedWorkflow): boolean {
  for (const step of workflow.steps) {
    if (!isWorkflowStepPayload(step.payload)) continue;
    const payload = step.payload as WorkflowStepPayload;

    // Check URL
    const url = payload.url.toLowerCase();
    if (url.includes('sheets.google') || url.includes('excel') || url.includes('spreadsheet')) {
      return true;
    }

    // Check spreadsheet context
    if (payload.spreadsheetContext) return true;

    // Check for cell references in context
    if (payload.context?.gridCoordinates?.cellReference) return true;
  }

  return false;
}

function extractColumnMapping(workflow: SavedWorkflow): Record<string, string> | undefined {
  const mapping: Record<string, string> = {};
  const variables = workflow.variables?.variables || [];

  for (const v of variables) {
    if (v.cellReference) {
      const col = v.cellReference.replace(/\d+/g, ''); // "A13" -> "A"
      mapping[col] = v.fieldName;
    }
  }

  return Object.keys(mapping).length > 0 ? mapping : undefined;
}

function inferSuccessType(indicator: string): SuccessIndicator['type'] {
  const lower = indicator.toLowerCase();

  if (lower.includes('toast') || lower.includes('notification') || lower.includes('snackbar')) {
    return 'toast_appears';
  }
  if (lower.includes('modal') || lower.includes('dialog') || lower.includes('closes')) {
    return 'modal_closes';
  }
  if (lower.includes('url') || lower.includes('redirect') || lower.includes('navigate')) {
    return 'url_changes';
  }
  if (lower.includes('appears') || lower.includes('shows') || lower.includes('visible')) {
    return 'text_appears';
  }
  if (lower.includes('disappears') || lower.includes('hidden') || lower.includes('removed')) {
    return 'text_disappears';
  }
  if (lower.includes('count') || lower.includes('number') || lower.includes('increases')) {
    return 'count_changes';
  }

  return 'text_appears';
}

function extractPattern(indicator: string): string | undefined {
  // Look for quoted text
  const quoted = indicator.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) return quoted[1] || quoted[2];

  // Look for keywords
  const keywords = ['success', 'saved', 'created', 'updated', 'completed', 'done'];
  for (const kw of keywords) {
    if (indicator.toLowerCase().includes(kw)) {
      return kw;
    }
  }

  return undefined;
}

// ============================================================================
// Exports
// ============================================================================

export { consolidateExistingData };
