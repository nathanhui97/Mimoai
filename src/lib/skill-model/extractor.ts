/**
 * Skill Model Extractor
 *
 * Builds a SkillModel from recording data:
 * - WorkflowMemory (AI-generated understanding)
 * - FormAudit (full form field snapshot)
 * - FormCompletionDiff (what was filled vs skipped)
 * - Recording steps (raw WorkflowStep[])
 *
 * The extracted model provides field-level knowledge for the PagePlanner.
 */

import type { SkillModel, PageSkill, FieldKnowledge, ActionKnowledge, FieldSelector } from './types';
import type { WorkflowMemory, InputField } from '../workflow-memory/types';
import type { FormAudit, FormCompletionDiff, FormFieldSnapshot } from '../../content/recording/form-auditor';
import type { WorkflowStep, WorkflowStepPayload } from '../../types/workflow';
import { isWorkflowStepPayload } from '../../types/workflow';

// ============================================================================
// SkillExtractor
// ============================================================================

export class SkillExtractor {
  /**
   * Extract a SkillModel from recording data.
   */
  static extract(params: {
    workflowId: string;
    steps: WorkflowStep[];
    memory?: WorkflowMemory;
    formAudits?: FormAudit[];
    completionDiffs?: FormCompletionDiff[];
  }): SkillModel {
    const { workflowId, steps, memory, formAudits, completionDiffs } = params;

    // Group steps by page URL
    const pageGroups = SkillExtractor.groupStepsByPage(steps);

    // Build PageSkill for each page
    const pages: PageSkill[] = [];

    for (const [url, pageSteps] of pageGroups.entries()) {
      // Find form audit for this page
      const audit = formAudits?.find(a => a.url === url);
      // Find completion diff for this page
      const diff = completionDiffs?.find(d => {
        // Match diff to audit by looking at the same form
        return audit !== undefined;
      });

      const pageSkill = SkillExtractor.buildPageSkill(
        url, pageSteps, memory, audit, diff
      );
      pages.push(pageSkill);
    }

    return {
      workflowId,
      generatedAt: Date.now(),
      version: '1.0',
      pages,
      crossPageDependencies: [], // TODO: Detect cross-page value transfers
      executionCount: memory?.experience?.timesExecuted || 0,
    };
  }

  /**
   * Update an existing SkillModel with execution results.
   * Called after each execution to refine field mappings.
   */
  static refineFromExecution(
    skill: SkillModel,
    executionResults: Array<{
      stepIndex: number;
      success: boolean;
      selectorUsed?: string;
      method: string;
    }>,
  ): SkillModel {
    const updated = { ...skill, generatedAt: Date.now(), executionCount: skill.executionCount + 1 };

    for (const result of executionResults) {
      // Find the field that matches this step
      for (const page of updated.pages) {
        const field = page.fields.find(f => f.stepIndices.includes(result.stepIndex));
        if (field && result.selectorUsed) {
          // Update selector reliability
          const existing = field.selectors.find(s => s.selector === result.selectorUsed);
          if (existing) {
            existing.attemptCount++;
            if (result.success) {
              existing.successCount++;
              existing.lastSuccessAt = Date.now();
            }
            existing.reliability = existing.successCount / existing.attemptCount;
          } else {
            // New selector discovered during execution
            field.selectors.push({
              selector: result.selectorUsed,
              type: SkillExtractor.classifySelectorType(result.selectorUsed),
              reliability: result.success ? 1.0 : 0.0,
              successCount: result.success ? 1 : 0,
              attemptCount: 1,
              lastSuccessAt: result.success ? Date.now() : undefined,
            });
          }

          // Re-sort selectors by reliability
          field.selectors.sort((a, b) => b.reliability - a.reliability);
        }
      }
    }

    return updated;
  }

  // ── Private: Page Grouping ─────────────────────────────────────

  private static groupStepsByPage(steps: WorkflowStep[]): Map<string, Array<{ step: WorkflowStep; index: number }>> {
    const groups = new Map<string, Array<{ step: WorkflowStep; index: number }>>();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!isWorkflowStepPayload(step.payload)) continue;

      const url = step.payload.url || 'unknown';
      // Normalize URL: strip query params and hash for grouping
      const normalizedUrl = url.split('?')[0].split('#')[0];

      if (!groups.has(normalizedUrl)) {
        groups.set(normalizedUrl, []);
      }
      groups.get(normalizedUrl)!.push({ step, index: i });
    }

    return groups;
  }

  // ── Private: Page Skill Building ───────────────────────────────

  private static buildPageSkill(
    url: string,
    pageSteps: Array<{ step: WorkflowStep; index: number }>,
    memory?: WorkflowMemory,
    audit?: FormAudit,
    diff?: FormCompletionDiff,
  ): PageSkill {
    const fields: FieldKnowledge[] = [];
    const actions: ActionKnowledge[] = [];
    let submitAction: ActionKnowledge | undefined;

    // 1. Build fields from form audit (complete picture)
    if (audit) {
      for (const auditField of audit.fields) {
        if (auditField.type === 'hidden' || !auditField.isEnabled) continue;

        const field = SkillExtractor.buildFieldFromAudit(
          auditField, pageSteps, memory, diff
        );
        fields.push(field);
      }
    }

    // 2. Build fields from recording steps (for pages without form audit)
    if (fields.length === 0) {
      for (const { step, index } of pageSteps) {
        if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload)) {
          const field = SkillExtractor.buildFieldFromStep(step.payload, index, memory);
          // Avoid duplicates (same field name)
          if (!fields.find(f => f.fieldName === field.fieldName)) {
            fields.push(field);
          }
        }
      }
    }

    // 3. Build navigation and submit actions from CLICK steps
    for (const { step, index } of pageSteps) {
      if (step.type === 'CLICK' && isWorkflowStepPayload(step.payload)) {
        const payload = step.payload;
        const isSubmit = payload.intent?.kind === 'SUBMIT_FORM' ||
          (payload.elementText || '').toLowerCase().match(/\b(submit|save|create|send|confirm|apply|done)\b/);

        const action: ActionKnowledge = {
          description: payload.stepGoal?.description || `Click ${payload.elementText || 'element'}`,
          text: payload.elementText || '',
          selector: payload.selector,
          role: payload.elementRole,
          causesNavigation: step.type === 'NAVIGATION' || !!payload.intent?.kind?.includes('NAVIGATE'),
          causesModal: false, // Hard to know from recording data alone
          waitAfterMs: isSubmit ? 1000 : 200,
          stepIndex: index,
        };

        if (isSubmit) {
          submitAction = action;
        } else {
          actions.push(action);
        }
      }
    }

    // 4. Determine page type
    const pageType = SkillExtractor.classifyPageType(fields, actions, pageSteps);

    return {
      urlPattern: SkillExtractor.toUrlPattern(url),
      pageType,
      fields,
      actions,
      submitAction,
      phaseIndex: SkillExtractor.findPhaseForUrl(url, memory),
    };
  }

  // ── Private: Field Building ────────────────────────────────────

  private static buildFieldFromAudit(
    auditField: FormFieldSnapshot,
    pageSteps: Array<{ step: WorkflowStep; index: number }>,
    memory?: WorkflowMemory,
    diff?: FormCompletionDiff,
  ): FieldKnowledge {
    // Find matching recording step
    const matchingStep = pageSteps.find(({ step }) => {
      if (step.type !== 'INPUT' || !isWorkflowStepPayload(step.payload)) return false;
      const payload = step.payload;
      // Match by selector, label, or name
      return payload.selector === auditField.selector ||
             payload.label === auditField.label ||
             (payload.context?.formCoordinates?.label === auditField.label);
    });

    // Find matching input field from memory
    const memoryInput = memory?.inputs
      ? [...memory.inputs.required, ...memory.inputs.optional]
          .find(input => input.name.toLowerCase() === auditField.label.toLowerCase())
      : undefined;

    // Check diff for skip info
    const diffFilled = diff?.filledFields.find(f => f.selector === auditField.selector);
    const diffSkipped = diff?.skippedFields.find(f => f.selector === auditField.selector);

    // Determine required status
    let required = auditField.required;
    let requiredConfidence = auditField.required ? 0.9 : 0.5;
    let requiredSource: FieldKnowledge['requiredSource'] = 'html_attribute';

    if (auditField.required) {
      requiredSource = 'html_attribute';
      requiredConfidence = 0.95;
    } else if (diffFilled) {
      // User filled it — might be required
      requiredSource = 'always_filled';
      requiredConfidence = 0.6;
      required = true; // Tentatively required since user filled it
    } else if (diffSkipped?.inferredReason === 'optional') {
      requiredSource = 'inferred';
      requiredConfidence = 0.7;
      required = false;
    }

    // Build selectors
    const selectors: FieldSelector[] = [];
    if (auditField.selector) {
      selectors.push({
        selector: auditField.selector,
        type: SkillExtractor.classifySelectorType(auditField.selector),
        reliability: 0.8, // Default for form audit selectors
        successCount: 0,
        attemptCount: 0,
      });
    }
    if (matchingStep && isWorkflowStepPayload(matchingStep.step.payload)) {
      const payload = matchingStep.step.payload;
      if (payload.selector && payload.selector !== auditField.selector) {
        selectors.push({
          selector: payload.selector,
          type: SkillExtractor.classifySelectorType(payload.selector),
          reliability: 0.7,
          successCount: 0,
          attemptCount: 0,
        });
      }
    }

    return {
      fieldName: auditField.label || auditField.name || 'Unknown',
      variableName: memoryInput?.variableName,
      fieldType: auditField.type,
      required,
      requiredConfidence,
      requiredSource,
      options: auditField.options,
      defaultValue: auditField.isEmpty ? undefined : auditField.currentValue,
      keepsDefault: !auditField.isEmpty && !diffFilled,
      exampleValues: matchingStep && isWorkflowStepPayload(matchingStep.step.payload)
        ? [matchingStep.step.payload.value || ''].filter(Boolean)
        : [],
      validationPattern: auditField.pattern,
      placeholder: auditField.placeholder,
      fieldOrder: auditField.fieldOrder,
      section: auditField.section,
      selectors,
      strategy: SkillExtractor.inferStrategy(auditField.type),
      clearFirst: false,
      stepIndices: matchingStep ? [matchingStep.index] : [],
      fillRate: diffFilled ? 1.0 : (diffSkipped ? 0.0 : 0.5),
      wasEverSkipped: !!diffSkipped,
      skipReason: diffSkipped?.inferredReason,
    };
  }

  private static buildFieldFromStep(
    payload: WorkflowStepPayload,
    stepIndex: number,
    memory?: WorkflowMemory,
  ): FieldKnowledge {
    const label = payload.label || payload.context?.formCoordinates?.label || '';

    const memoryInput = memory?.inputs
      ? [...memory.inputs.required, ...memory.inputs.optional]
          .find(input => input.name.toLowerCase() === label.toLowerCase())
      : undefined;

    const selectors: FieldSelector[] = [];
    if (payload.selector) {
      selectors.push({
        selector: payload.selector,
        type: SkillExtractor.classifySelectorType(payload.selector),
        reliability: 0.7,
        successCount: 0,
        attemptCount: 0,
      });
    }

    return {
      fieldName: label || 'Unknown Field',
      variableName: memoryInput?.variableName,
      fieldType: SkillExtractor.inferFieldType(payload),
      required: memoryInput ? memory!.inputs.required.includes(memoryInput) : false,
      requiredConfidence: 0.5,
      requiredSource: 'inferred',
      options: payload.context?.decisionSpace?.options,
      defaultValue: undefined,
      keepsDefault: false,
      exampleValues: payload.value ? [payload.value] : [],
      placeholder: undefined,
      fieldOrder: stepIndex,
      selectors,
      strategy: SkillExtractor.inferStrategyFromPayload(payload),
      clearFirst: false,
      stepIndices: [stepIndex],
      fillRate: 1.0,
      wasEverSkipped: false,
    };
  }

  // ── Private: Classification Helpers ────────────────────────────

  private static classifySelectorType(selector: string): FieldSelector['type'] {
    if (selector.startsWith('#')) return 'id';
    if (selector.includes('[name=')) return 'name';
    if (selector.includes('[data-testid')) return 'data-testid';
    if (selector.includes('[aria-label')) return 'aria-label';
    if (selector.startsWith('//') || selector.startsWith('.//')) return 'xpath';
    if (selector.includes(':nth-of-type')) return 'nth-of-type';
    return 'css';
  }

  private static inferStrategy(fieldType: FormFieldSnapshot['type']): FieldKnowledge['strategy'] {
    switch (fieldType) {
      case 'select': return 'select';
      case 'checkbox': return 'checkbox';
      case 'radio': return 'click';
      case 'date': return 'date_picker';
      default: return 'type';
    }
  }

  private static inferStrategyFromPayload(payload: WorkflowStepPayload): FieldKnowledge['strategy'] {
    if (payload.interactionType?.dropdownType) return 'select';
    if (payload.inputDetails?.type === 'checkbox') return 'checkbox';
    if (payload.inputDetails?.type === 'radio') return 'click';
    if (payload.inputDetails?.type === 'date') return 'date_picker';
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') return 'select';
    return 'type';
  }

  private static inferFieldType(payload: WorkflowStepPayload): FieldKnowledge['fieldType'] {
    const type = payload.inputDetails?.type?.toLowerCase();
    if (type === 'email') return 'email';
    if (type === 'tel') return 'phone';
    if (type === 'number') return 'number';
    if (type === 'date' || type === 'datetime-local') return 'date';
    if (type === 'url') return 'url';
    if (type === 'password') return 'password';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'search') return 'search';
    if (payload.context?.decisionSpace) return 'select';
    return 'text';
  }

  private static classifyPageType(
    fields: FieldKnowledge[],
    actions: ActionKnowledge[],
    pageSteps: Array<{ step: WorkflowStep; index: number }>,
  ): PageSkill['pageType'] {
    if (fields.length >= 2) return 'form';
    if (actions.some(a => a.causesNavigation)) return 'navigation';
    const hasListIndicators = pageSteps.some(({ step }) =>
      isWorkflowStepPayload(step.payload) &&
      step.payload.elementRole === 'row'
    );
    if (hasListIndicators) return 'list';
    if (fields.length === 0 && actions.length <= 1) return 'detail';
    return 'other';
  }

  private static toUrlPattern(url: string): string {
    // Convert specific URL to a pattern
    // Replace numeric IDs with wildcards
    return url.replace(/\/\d+/g, '/*').replace(/=[^&]+/g, '=*');
  }

  private static findPhaseForUrl(url: string, memory?: WorkflowMemory): number | undefined {
    if (!memory?.understanding?.phases) return undefined;

    // This is a rough heuristic — phases map to step indices, not URLs directly
    // We'd need to know which steps are on which URL
    return undefined;
  }
}
