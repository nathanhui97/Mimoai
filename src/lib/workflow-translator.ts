/**
 * Workflow Translator
 * 
 * Translates raw workflow steps into natural language with context.
 * This helps the AI agent understand the intent behind each step,
 * rather than just following raw JSON instructions.
 */

import type { WorkflowStep, NaturalLanguageContext } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { aiConfig } from './ai-config';
import { getElementLabel } from './label-utils';
import { UserContextStorage } from './user-context-storage';

// Re-export for convenience
export type { NaturalLanguageContext };

// EnhancedWorkflowStep is just WorkflowStep with naturalLanguage filled in
export type EnhancedWorkflowStep = WorkflowStep & { naturalLanguage?: NaturalLanguageContext };

// ============================================================================
// Translation Service
// ============================================================================

/** Progress callback for translation */
export type TranslationProgressCallback = (current: number, total: number) => void;

/**
 * Translate all steps in a workflow to include natural language context
 */
export async function translateWorkflow(
  steps: WorkflowStep[],
  onProgress?: TranslationProgressCallback
): Promise<EnhancedWorkflowStep[]> {
  console.log(`[WorkflowTranslator] Translating ${steps.length} steps to natural language...`);
  
  const enhancedSteps: EnhancedWorkflowStep[] = [];
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const previousSteps = enhancedSteps.slice(0, i);
    const remainingSteps = steps.slice(i + 1);
    
    // Report progress
    onProgress?.(i, steps.length);
    
    try {
      const naturalLanguage = await translateStepWithAI(step, i, previousSteps, remainingSteps);
      enhancedSteps.push({
        ...step,
        naturalLanguage,
      });
      console.log(`[WorkflowTranslator] Step ${i + 1}/${steps.length} translated: "${naturalLanguage.intent}"`);
    } catch (error) {
      console.error(`[WorkflowTranslator] Failed to translate step ${i + 1}:`, error);
      // Fall back to basic translation
      enhancedSteps.push({
        ...step,
        naturalLanguage: createBasicTranslation(step, i),
      });
    }
    
    // Report completion of this step
    onProgress?.(i + 1, steps.length);
  }
  
  console.log(`[WorkflowTranslator] Translation complete!`);
  return enhancedSteps;
}

/**
 * Translate a single step using AI
 */
async function translateStepWithAI(
  step: WorkflowStep,
  stepIndex: number,
  previousSteps: EnhancedWorkflowStep[],
  remainingSteps: WorkflowStep[]
): Promise<NaturalLanguageContext> {
  const config = aiConfig.getConfig();
  
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.warn('[WorkflowTranslator] Supabase not configured, using basic translation');
    return createBasicTranslation(step, stepIndex);
  }
  
  const url = `${config.supabaseUrl}/functions/v1/translate_step`;
  
  const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;
  const userContext = await UserContextStorage.getUserContext();
  
  // Extract the ACTUAL element info from context, not just the (potentially incorrect) description
  const parentText = payload?.context?.parent?.text;
  const nearbyText = payload?.aiEvidence?.semanticAnchors?.nearbyText || 
                     payload?.context?.siblings?.before || 
                     payload?.context?.siblings?.after || [];
  const disambiguators = payload?.disambiguators || [];
  const ariaLabel = payload?.context?.parent?.selector?.match(/aria-label="([^"]+)"/)?.[1];
  
  // Use ACTUAL element text, not the potentially incorrect description
  const actualElementText = payload?.elementText || parentText || ariaLabel;
  
  const request = {
    step: {
      index: stepIndex,
      type: step.type,
      // Use description as fallback only if we have no better info
      description: actualElementText ? `${step.type} on "${actualElementText}"` : step.description,
      elementText: actualElementText,
      elementRole: payload?.elementRole || payload?.context?.parent?.attributes?.role,
      value: payload?.value,
      url: payload?.url,
      selector: payload?.selector,
      placeholder: payload?.context?.uniqueAttributes?.placeholder,
      containerText: payload?.context?.container?.text,
      // NEW: Send more context for accurate translation
      parentText,
      nearbyText: Array.isArray(nearbyText) ? nearbyText.slice(0, 3) : [],
      disambiguators: disambiguators.slice(0, 3),
      ariaLabel,
    },
    previousSteps: previousSteps.map((s, i) => ({
      index: i,
      type: s.type,
      description: s.description,
      intent: s.naturalLanguage?.intent,
    })),
    remainingSteps: remainingSteps.slice(0, 3).map((s, i) => ({
      index: stepIndex + 1 + i,
      type: s.type,
      description: s.description,
    })),
    totalSteps: previousSteps.length + 1 + remainingSteps.length,
    userContext: userContext || undefined,
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result = await response.json();
    
    return {
      intent: result.intent || step.description || 'Unknown intent',
      precondition: result.precondition || 'Page must be loaded',
      expectedOutcome: result.expectedOutcome || 'Action completes successfully',
      dependencies: result.dependencies || [],
      alternateDescriptions: result.alternateDescriptions,
    };
  } catch (error) {
    console.error('[WorkflowTranslator] AI translation failed:', error);
    return createBasicTranslation(step, stepIndex);
  }
}

/**
 * Create a basic translation without AI (fallback)
 */
function createBasicTranslation(step: WorkflowStep, stepIndex: number): NaturalLanguageContext {
  const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;
  
  // Get the ACTUAL element text from various sources
  const actualElementText = payload?.elementText || 
                           payload?.context?.parent?.text || 
                           getElementLabel(
                             payload?.aiEvidence, 
                             payload?.label,
                             payload?.context?.uniqueAttributes,
                             payload?.context?.formCoordinates,
                             payload?.context?.uniqueAttributes?.placeholder
                           );
  
  let intent = 'Perform action';
  let precondition = 'Page must be loaded';
  let expectedOutcome = 'Action completes successfully';
  const dependencies: number[] = [];
  
  // Get element role from context if not directly available
  const elementRole = payload?.elementRole || 
                     payload?.context?.parent?.attributes?.role;
  
  // Infer based on step type
  switch (step.type) {
    case 'CLICK':
      if (elementRole === 'combobox' || elementRole === 'listbox') {
        intent = `Open the ${actualElementText || 'dropdown'} selector`;
        expectedOutcome = 'A dropdown menu appears with options';
      } else if (elementRole === 'option' || elementRole === 'menuitem') {
        intent = `Select "${actualElementText}" from the dropdown/menu`;
        expectedOutcome = 'The option is selected and dropdown closes';
        // Depends on previous step (opening dropdown)
        if (stepIndex > 0) dependencies.push(stepIndex - 1);
      } else if (elementRole === 'button') {
        intent = `Click the "${actualElementText || 'button'}" button`;
        expectedOutcome = 'Button action is triggered';
      } else if (actualElementText) {
        intent = `Click on "${actualElementText}"`;
      } else {
        intent = `Click on element`;
      }
      break;
      
    case 'INPUT':
      intent = `Enter "${payload?.value}" into the ${actualElementText || payload?.context?.uniqueAttributes?.placeholder || 'field'}`;
      precondition = 'The input field must be visible and editable';
      expectedOutcome = `Field contains the value "${payload?.value}"`;
      break;
      
    case 'NAVIGATION':
      // NAVIGATION steps are now click-based, use actual element text
      if (actualElementText) {
        intent = `Click on "${actualElementText}" to navigate`;
        expectedOutcome = 'Navigation occurs and new page/content loads';
      } else {
        intent = `Navigate to the next page`;
        expectedOutcome = 'Page loads successfully';
      }
      break;
      
    case 'SCROLL':
      intent = 'Scroll the page to reveal more content';
      expectedOutcome = 'New content becomes visible';
      break;
      
    default:
      intent = `Perform ${step.type} action`;
  }
  
  return {
    intent,
    precondition,
    expectedOutcome,
    dependencies,
  };
}

/**
 * Check if a step's expected outcome is already satisfied
 */
export function isOutcomeAlreadySatisfied(
  step: EnhancedWorkflowStep,
  currentPageState: {
    hasOpenDropdown: boolean;
    dropdownOptions?: string[];
    hasModal: boolean;
    modalTitle?: string;
    formFields?: Array<{ name: string; value?: string }>;
    visibleText?: string[];
  }
): boolean {
  if (!step.naturalLanguage) return false;
  
  const outcome = step.naturalLanguage.expectedOutcome.toLowerCase();
  const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;
  
  // Check if dropdown-related outcome is satisfied
  if (outcome.includes('dropdown') && outcome.includes('appear')) {
    if (currentPageState.hasOpenDropdown) {
      console.log(`[WorkflowTranslator] Outcome already satisfied: dropdown is open`);
      return true;
    }
  }
  
  // Check if modal-related outcome is satisfied
  if (outcome.includes('modal') || outcome.includes('dialog') || outcome.includes('popup')) {
    if (currentPageState.hasModal) {
      console.log(`[WorkflowTranslator] Outcome already satisfied: modal is open`);
      return true;
    }
  }
  
  // Check if field value is already set
  if (step.type === 'INPUT' && payload?.value) {
    const targetField = currentPageState.formFields?.find(f => {
      const fieldName = f.name.toLowerCase();
      const targetName = (payload.elementText || '').toLowerCase();
      return fieldName.includes(targetName) || targetName.includes(fieldName);
    });
    
    if (targetField?.value === payload.value) {
      console.log(`[WorkflowTranslator] Outcome already satisfied: field already has value "${payload.value}"`);
      return true;
    }
  }
  
  return false;
}

