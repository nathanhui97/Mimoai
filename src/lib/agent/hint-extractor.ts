/**
 * HintExtractor - Extracts workflow hints and infers goals from workflows
 * 
 * Extracted from AIAgent to provide focused hint extraction logic.
 * Used to convert recorded workflow steps into agent hints.
 */

import type { SavedWorkflow, WorkflowStepPayload } from '../../types/workflow';
import { isWorkflowStepPayload } from '../../types/workflow';
import type { AgentHint, AgentObservation, AIAnalysisContext, StructuredSuccessCriteria } from './types';
import type { StepExecutionGuidance } from '../post-recording-analyzer';
import { getCleanLabelForMatching } from '../label-utils';

/**
 * HintExtractor converts workflow steps into agent hints with variable substitution
 */
export class HintExtractor {
  /**
   * Infer the goal from workflow
   */
  inferGoal(workflow: SavedWorkflow): string {
    let goal = '';
    
    // Prefer workflow name + description for richer context
    if (workflow.name && workflow.description) {
      goal = `${workflow.name} - ${workflow.description}`;
    } else if (workflow.name) {
      // Use workflow name as primary goal
      goal = workflow.name;
    } else {
      // Try to infer from step descriptions
      const descriptions = workflow.steps
        .map(s => s.description)
        .filter(Boolean)
        .join(' → ');
      
      if (descriptions) {
        goal = `Complete workflow: ${descriptions}`;
      } else {
        goal = 'Complete the recorded workflow';
      }
    }
    
    return goal;
  }

  /**
   * Extract hints from workflow steps
   *
   * Hints are "suggestions" not commands - they tell the AI what was recorded,
   * but the AI should adapt based on current page state and variable overrides.
   */
  extractHints(workflow: SavedWorkflow, variableValues?: Record<string, string>): AgentHint[] {
    // ⚠️ CRITICAL: For AI Agent, ALWAYS use original steps, never optimized
    // The optimizer removes "redundant" clicks (like opening menus, waiting for page loads)
    // but these are ESSENTIAL for AI agent to execute in the correct sequence
    const steps = workflow.steps;

    if (workflow.optimizedSteps) {
      console.warn(`[HintExtractor] ⚠️ Ignoring ${workflow.optimizedSteps.length} optimized steps - AI Agent requires original ${workflow.steps.length} steps for reliable execution`);
    }

    const originalSteps = workflow.steps;

    // Build step→variable mapping
    const stepToVariable = this.buildVariableMapping(workflow, variableValues);
    const stepIdToVariable = this.buildStepIdVariableMapping(workflow, variableValues);

    // Extract AI analysis step guidance for enriching hints
    const stepGuidance = workflow.aiAnalysis?.stepGuidance || [];
    
    return steps.map((step, index) => {
      // Handle TAB_SWITCH steps specially
      if (step.type === 'TAB_SWITCH') {
        const tabSwitchPayload = step.payload;
        const toTitle = (tabSwitchPayload as any).toTitle;
        const toUrl = (tabSwitchPayload as any).toUrl;

        return {
          stepNumber: index + 1,
          description: step.description || `Switch to tab: ${toTitle || toUrl}`,
          actionType: 'other',
          completed: false,
          stepType: 'TAB_SWITCH',
          recordedPayload: tabSwitchPayload,
        } as AgentHint;
      }

      // Handle COPY steps specially (deterministic execution)
      if (step.type === 'COPY') {
        const copyPayload = step.payload as WorkflowStepPayload;
        return {
          stepNumber: index + 1,
          description: step.description || `Copy text from element`,
          actionType: 'other',
          completed: false,
          stepType: 'COPY',
          recordedPayload: copyPayload,
          targetSelector: copyPayload.selector,
        } as AgentHint;
      }

      // Handle PASTE steps specially (deterministic execution)
      if (step.type === 'PASTE') {
        const pastePayload = step.payload as WorkflowStepPayload;
        return {
          stepNumber: index + 1,
          description: step.description || `Paste text to element`,
          actionType: 'other',
          completed: false,
          stepType: 'PASTE',
          recordedPayload: pastePayload,
          targetSelector: pastePayload.selector,
        } as AgentHint;
      }

      const payload = step.payload as WorkflowStepPayload;
      
      // Extract element text from original steps for optimized NAVIGATION steps
      let originalElementText = payload.elementText;
      if (step.type === 'NAVIGATION' && !originalElementText && workflow.optimizationMetadata) {
        const mapEntry = workflow.optimizationMetadata.optimizationMap.find(
          entry => entry.optimizedIndex === index
        );
        if (mapEntry && mapEntry.originalIndices.length > 0) {
          const lastOriginalIndex = mapEntry.originalIndices[mapEntry.originalIndices.length - 1];
          const originalStep = originalSteps[lastOriginalIndex];
          if (originalStep && isWorkflowStepPayload(originalStep.payload)) {
            originalElementText = originalStep.payload.elementText;
          }
        }
      }
      
      // Determine action type (pass payload to check for dropdown)
      const actionType = this.determineActionType(step.type, payload);
      
      // Substitute variables in value
      const { value, description } = this.processValueAndDescription(
        step, payload, index, originalElementText, 
        stepToVariable, stepIdToVariable, variableValues
      );
      
      // Extract locator and context data
      const locatorData = this.extractLocatorData(payload);
      
      // Extract scroll data for SCROLL actions
      const scrollData = this.extractScrollData(step.type, payload, step.description || '');
      
      // Extract targetText with fallback logic
      // For dropdown selections with variables, use the substituted value as targetText
      let targetText: string | undefined;
      if (actionType === 'select' && value) {
        // For SELECT actions (dropdowns), the value IS the option to select
        targetText = value;
        console.log(`[HintExtractor] Using substituted value as targetText for SELECT: "${targetText}"`);
      } else if (step.type === 'NAVIGATION' && originalElementText) {
        targetText = originalElementText;
      } else if (payload.elementText) {
        targetText = payload.elementText;
      } else if (payload.context?.decisionSpace?.selectedText) {
        // Fallback for dropdown options that didn't capture elementText
        targetText = payload.context.decisionSpace.selectedText;
        console.log(`[HintExtractor] Using decisionSpace.selectedText as targetText: "${targetText}"`);
      } else if (step.type === 'INPUT' && (payload.label || payload.context?.formCoordinates?.label || payload.context?.uniqueAttributes?.placeholder)) {
        // Fallback for INPUT fields that didn't capture elementText
        // Use label or placeholder as the text to match against
        targetText = payload.label || payload.context?.formCoordinates?.label || payload.context?.uniqueAttributes?.placeholder;
        console.log(`[HintExtractor] Using label/placeholder as targetText for INPUT: "${targetText}"`);
      }
      
      // 🚀 OPTIMIZATION: Extract recorded scroll position for pre-scrolling
      // This allows the executor to scroll to the right place BEFORE element detection
      const recordedScrollY = payload.viewport?.scrollY;
      const recordedScrollX = payload.viewport?.scrollX;
      
      // Extract decision space for dropdown validation/fallback
      const decisionSpace = payload.context?.decisionSpace ? {
        type: payload.context.decisionSpace.type,
        selectedText: payload.context.decisionSpace.selectedText,
        selectedIndex: payload.context.decisionSpace.selectedIndex,
        options: payload.context.decisionSpace.options,
      } : undefined;
      
      if (decisionSpace?.options?.length) {
        console.log(`[HintExtractor] 📋 Extracted decision space with ${decisionSpace.options.length} options for dropdown`);
      }
      
      // Build AI analysis context from step guidance
      const guidance = stepGuidance.find(g => g.stepIndex === index);
      const aiAnalysisContext = this.buildAIAnalysisContext(guidance);

      if (aiAnalysisContext) {
        console.log(`[HintExtractor] 🧠 Step ${index} AI context attached:`, {
          intent: aiAnalysisContext.intent?.substring(0, 50),
          lookingFor: aiAnalysisContext.elementFindingStrategy?.lookingFor,
          criticality: aiAnalysisContext.criticality,
          hasSuccessCriteria: !!aiAnalysisContext.successCriteria,
        });
      }

      return {
        stepNumber: index + 1,
        description,
        actionType,
        targetText,
        targetRole: payload.elementRole,
        targetPlaceholder: payload.context?.uniqueAttributes?.placeholder || payload.context?.formCoordinates?.label,
        targetSelector: payload.selector,
        value,
        completed: false,
        referenceScreenshot: payload.visualSnapshot?.annotated || payload.visualSnapshot?.viewport,
        clickPoint: payload.visualSnapshot?.clickPoint,
        ...locatorData,
        ...scrollData,
        naturalLanguage: this.extractNaturalLanguage(step),
        spreadsheetContext: payload.spreadsheetContext,
        iframeContext: payload.iframeContext,
        // 🚀 Pre-scroll optimization: store recorded scroll position
        recordedScrollY,
        recordedScrollX,
        // 📋 Decision space for dropdown validation/fallback
        decisionSpace,
        // Store original step type for outcome verification (NAVIGATION, CLICK, INPUT, etc.)
        stepType: step.type as AgentHint['stepType'],
        // 🧠 AI Analysis context for intelligent execution and recovery
        aiAnalysisContext,
      };
    });
  }

  /**
   * Check if the current hint's expected outcome is already satisfied
   */
  checkIfOutcomeAlreadySatisfied(hint: AgentHint, observation: AgentObservation): string | null {
    if (!hint.naturalLanguage?.expectedOutcome) {
      return null;
    }
    
    const outcome = hint.naturalLanguage.expectedOutcome.toLowerCase();
    const domMapText = observation.domMapText.toLowerCase();
    
    // Check dropdown-related outcomes
    if ((outcome.includes('dropdown') || outcome.includes('menu')) && 
        (outcome.includes('open') || outcome.includes('appear') || outcome.includes('show'))) {
      const isOptionClick = hint.targetRole === 'option' || hint.targetRole === 'menuitem' || 
                           hint.actionType === 'click' && (hint.targetText || '').length > 0;
      
      if (!isOptionClick && (domMapText.includes('dropdown is open') || domMapText.includes('active dropdown'))) {
        return 'Dropdown is already open';
      }
    }
    
    // Check modal-related outcomes
    if ((outcome.includes('modal') || outcome.includes('dialog') || outcome.includes('popup') || outcome.includes('form')) && 
        (outcome.includes('open') || outcome.includes('appear') || outcome.includes('show'))) {
      if (domMapText.includes('modal is open') || domMapText.includes('active modal')) {
        return 'Modal/dialog is already open';
      }
    }
    
    // Check field value outcomes
    if (hint.actionType === 'type' && hint.value) {
      const targetText = (hint.targetText || hint.targetPlaceholder || '').toLowerCase();
      if (targetText) {
        const fieldPattern = new RegExp(`\\[(?:textbox|spinbutton)\\][^\\n]*(?:${targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[^\\n]*value\\s*=\\s*["']?${hint.value}["']?`, 'i');
        if (fieldPattern.test(observation.domMapText)) {
          return `Field already has value "${hint.value}"`;
        }
      }
    }
    
    return null;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private buildVariableMapping(workflow: SavedWorkflow, _variableValues?: Record<string, string>): Map<number, { variableName: string; fieldName: string; stepId?: string }> {
    const stepToVariable = new Map<number, { variableName: string; fieldName: string; stepId?: string }>();
    
    if (workflow.variables?.variables) {
      for (const variable of workflow.variables.variables) {
        stepToVariable.set(variable.stepIndex, {
          variableName: variable.variableName,
          fieldName: variable.fieldName,
          stepId: variable.stepId,
        });
        console.log(`[HintExtractor] 📝 Variable mapping: step ${variable.stepIndex} → "${variable.variableName}"`);
      }
    }
    
    return stepToVariable;
  }

  private buildStepIdVariableMapping(workflow: SavedWorkflow, _variableValues?: Record<string, string>): Map<string, { variableName: string; fieldName: string; stepIndex: number }> {
    const stepIdToVariable = new Map<string, { variableName: string; fieldName: string; stepIndex: number }>();
    
    if (workflow.variables?.variables) {
      for (const variable of workflow.variables.variables) {
        if (variable.stepId) {
          stepIdToVariable.set(variable.stepId, {
            variableName: variable.variableName,
            fieldName: variable.fieldName,
            stepIndex: variable.stepIndex,
          });
        }
      }
    }
    
    return stepIdToVariable;
  }

  private determineActionType(stepType: string, payload?: any): AgentHint['actionType'] {
    // UNIFIED DETECTION: Check interactionType first (if available)
    if (payload?.interactionType) {
      const kind = payload.interactionType.kind;
      if (kind === 'DROPDOWN_SELECTION') {
        console.log('[HintExtractor] 📋 Converting to SELECT action via interactionType');
        return 'select';
      }
      if (kind === 'TEXT_INPUT') {
        console.log('[HintExtractor] Converting to TYPE action via interactionType');
        return 'type';
      }
      if (kind === 'MENU_ITEM_CLICK') {
        console.log('[HintExtractor] Converting to CLICK action via interactionType (navigation menu)');
        return 'click';
      }
      if (kind === 'BUTTON_CLICK' || kind === 'LINK_CLICK') {
        console.log('[HintExtractor] Converting to CLICK action via interactionType');
        return 'click';
      }
      if (kind === 'RADIO_SELECTION') {
        console.log('[HintExtractor] 🔘 Converting to CLICK action via interactionType (radio button)');
        return 'click';
      }
      if (kind === 'CHECKBOX_TOGGLE') {
        console.log('[HintExtractor] ☑️ Converting to CLICK action via interactionType (checkbox)');
        return 'click';
      }
      // For other kinds, fall through to legacy logic
    }

    // LEGACY DETECTION: Fallback for old workflows
    if (stepType === 'CLICK') {
      // Check if this is a dropdown selection (has decisionSpace with options)
      if (payload?.context?.decisionSpace?.options?.length > 0) {
        console.log('[HintExtractor] 📋 Converting dropdown CLICK to SELECT action (legacy)');
        return 'select';
      }
      return 'click';
    }
    if (stepType === 'INPUT') return 'type';
    if (stepType === 'NAVIGATION') return 'click'; // Always convert to click
    if (stepType === 'SCROLL') return 'scroll';
    return 'other';
  }

  private processValueAndDescription(
    step: any,
    payload: WorkflowStepPayload,
    index: number,
    originalElementText: string | undefined,
    stepToVariable: Map<number, { variableName: string; fieldName: string; stepId?: string }>,
    stepIdToVariable: Map<string, { variableName: string; fieldName: string; stepIndex: number }>,
    variableValues?: Record<string, string>
  ): { value: string | undefined; description: string } {
    let value = payload.value;
    const originalValue = payload.value;
    const placeholder = payload.context?.uniqueAttributes?.placeholder || payload.context?.formCoordinates?.label;
    
    // Find variable by index or stepId
    let stepVariable = stepToVariable.get(index);
    const stepId = `${payload.timestamp}`;
    
    if (!stepVariable && stepIdToVariable.has(stepId)) {
      const varByStepId = stepIdToVariable.get(stepId)!;
      stepVariable = {
        variableName: varByStepId.variableName,
        fieldName: varByStepId.fieldName,
        stepId: stepId,
      };
    }
    
    // Try to match by field name for INPUT steps
    if (!stepVariable && (step.type === 'INPUT' || step.type === 'KEYBOARD') && variableValues) {
      const payloadLabel = payload.label || payload.context?.formCoordinates?.label || '';
      
      for (const [, varInfo] of stepToVariable) {
        const fieldNameLower = varInfo.fieldName.toLowerCase().replace(/\s+/g, '');
        const labelLower = payloadLabel.toLowerCase().replace(/\s+/g, '');
        const ariaLabel = payload.context?.uniqueAttributes?.['aria-label'] || '';
        
        if (fieldNameLower && labelLower && (
          fieldNameLower === labelLower ||
          labelLower.includes(fieldNameLower) ||
          fieldNameLower.includes(labelLower) ||
          ariaLabel.toLowerCase().includes(fieldNameLower)
        )) {
          stepVariable = varInfo;
          break;
        }
      }
    }
    
    // Substitute variable value if found
    // FIX: Check stepId first, then variableName (stepId is unique, variableName may have collisions)
    if (stepVariable && variableValues) {
      // Try stepId first (unique identifier for each step)
      let userValue: string | undefined = undefined;
      if (stepVariable.stepId && variableValues[stepVariable.stepId] !== undefined) {
        userValue = variableValues[stepVariable.stepId];
        console.log(`[HintExtractor] 📝 Variable substitution via stepId: step ${index} "${originalValue}" → "${userValue}"`);
      } else if (variableValues[stepVariable.variableName] !== undefined) {
        // Fall back to variableName (legacy)
        userValue = variableValues[stepVariable.variableName];
        console.log(`[HintExtractor] 📝 Variable substitution via variableName: step ${index} "${originalValue}" → "${userValue}"`);
      }
      
      if (userValue !== undefined) {
        value = userValue;
        
        // CRITICAL: For dropdown selections (CLICK steps), also update the description
        if (step.type === 'CLICK' && originalValue !== userValue) {
          console.log(`[HintExtractor] 📝 Updating description for dropdown variable substitution`);
        }
      }
    } else if (value && variableValues) {
      // Legacy {{varName}} pattern replacement
      value = value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return variableValues[varName] ?? match;
      });
    }
    
    // Build description - use substituted value for dropdowns
    let description = step.description;
    
    if (step.type === 'NAVIGATION') {
      const elementTextToUse = originalElementText || payload.elementText;
      if (elementTextToUse) {
        description = `Click on "${elementTextToUse}"`;
      } else if (payload.url) {
        const urlPath = payload.url.split('/').pop() || '';
        description = `Navigate to ${urlPath} (click through UI)`;
      } else {
        description = `Click to navigate`;
      }
    } else if (step.type === 'INPUT' && originalValue && originalValue !== value) {
      const fieldName = placeholder || payload.elementText || 'field';
      description = `Enter "${value}" in ${fieldName} (originally: "${originalValue}")`;
    } else if (step.type === 'INPUT' && value) {
      const fieldName = placeholder || payload.elementText || 'field';
      description = `Enter "${value}" in ${fieldName}`;
    } else if (step.type === 'CLICK' && payload.context?.decisionSpace?.options && payload.context.decisionSpace.options.length > 0 && value) {
      // DROPDOWN SELECTION: Use substituted value in description
      const fieldName = stepVariable?.fieldName || payload.label || 'dropdown';
      description = `Select "${value}" from ${fieldName}`;
      console.log(`[HintExtractor] 📋 Dropdown selection description updated: "${description}"`);
    } else if (step.type === 'CLICK' && !payload.elementText && payload.context?.decisionSpace?.selectedText) {
      // Special case: dropdown option without elementText - use selectedText
      const selectedText = payload.context.decisionSpace.selectedText;
      description = step.description || `Click "${selectedText}" option`;
      console.log(`[HintExtractor] Using decisionSpace.selectedText for description: "${description}"`);
    } else {
      // Fallback: use elementText or decisionSpace.selectedText or selector
      const textToUse = payload.elementText || payload.context?.decisionSpace?.selectedText || payload.selector;
      description = step.description || `${step.type} on ${textToUse}`;
    }
    
    return { value, description };
  }

  private extractLocatorData(payload: WorkflowStepPayload): Partial<AgentHint> {
    const recordedFallbackSelectors = payload.fallbackSelectors || [];
    const recordedTestId = payload.context?.uniqueAttributes?.['data-testid'] || 
                          payload.context?.uniqueAttributes?.['data-test-id'];
    
    // Use the dedicated clean label function for AI element matching
    // This ONLY returns clean sources (ariaLabel, uniqueAttributes['aria-label'], payloadLabel)
    // It NEVER returns dirty textLabel which can contain validation messages
    const recordedAriaLabel = getCleanLabelForMatching(
      payload.aiEvidence,
      payload.label,
      payload.context?.uniqueAttributes
    );
    
    // Debug logging for label extraction
    if (!recordedAriaLabel) {
      console.warn(`[HintExtractor] ⚠️ No clean label found for element. Available sources:`, {
        aiEvidenceAriaLabel: payload.aiEvidence?.semanticAnchors?.ariaLabel,
        aiEvidenceTextLabel: payload.aiEvidence?.semanticAnchors?.textLabel?.substring(0, 50),
        payloadLabel: payload.label,
        uniqueAriaLabel: payload.context?.uniqueAttributes?.['aria-label'],
        formLabel: payload.context?.formCoordinates?.label,
        placeholder: payload.context?.uniqueAttributes?.placeholder,
        elementRole: payload.elementRole,
      });
    } else {
      console.log(`[HintExtractor] ✅ Found clean label: "${recordedAriaLabel}" (role: ${payload.elementRole})`);
    }
    
    // Extract scope hint
    let recordedScopeHint: string | undefined;
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hint-extractor.ts:346',message:'SCOPE_EXTRACT_START',data:{payloadScope:payload.scope,containerText:payload.context?.container?.text?.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (payload.scope) {
      switch (payload.scope.kind) {
        case 'WIDGET':
          recordedScopeHint = (payload.scope as any).title;
          break;
        case 'NEAREST_SECTION':
          recordedScopeHint = (payload.scope as any).headingText;
          break;
        case 'TABLE_ROW':
          recordedScopeHint = (payload.scope as any).anchorText;
          break;
      }
    }
    
    if (!recordedScopeHint) {
      recordedScopeHint = payload.context?.container?.text;
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hint-extractor.ts:370',message:'SCOPE_EXTRACTED',data:{recordedScopeHint,payloadScopeKind:payload.scope?.kind},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    const recordedRowKey = payload.context?.gridCoordinates?.rowHeader || 
                          payload.context?.gridCoordinates?.cellReference;
    const nearbyText = payload.aiEvidence?.semanticAnchors?.nearbyText || 
                      payload.context?.siblings?.before || 
                      [];
    
    return {
      recordedSelector: payload.selector,
      recordedFallbackSelectors: recordedFallbackSelectors.length > 0 ? recordedFallbackSelectors : undefined,
      recordedTestId,
      recordedAriaLabel,
      recordedScopeHint,
      recordedRowKey,
      nearbyText: nearbyText.length > 0 ? nearbyText : undefined,
    };
  }

  private extractScrollData(stepType: string, payload: WorkflowStepPayload, description: string): Partial<AgentHint> {
    if (stepType !== 'SCROLL') {
      return {};
    }
    
    const scrollContainer = (payload as any).elementScrollContainer?.selector ||
                           (payload as any).scrollContainer?.selector;
    const viewport = payload.viewport;
    const elementScrollContainer = viewport?.elementScrollContainer;
    
    // Extract scroll delta
    let scrollDelta: number | undefined;
    
    if (elementScrollContainer?.scrollDeltaY !== undefined) {
      scrollDelta = elementScrollContainer.scrollDeltaY;
    } else if (viewport?.scrollDeltaY !== undefined) {
      scrollDelta = viewport.scrollDeltaY;
    } else if ((payload as any).deltaY !== undefined) {
      scrollDelta = (payload as any).deltaY;
    } else if ((payload as any).scrollAmount !== undefined) {
      scrollDelta = (payload as any).scrollAmount;
    }
    
    let scrollAmount: number | undefined;
    let scrollDirection: 'up' | 'down' | 'left' | 'right' | undefined;
    
    if (typeof scrollDelta === 'number' && scrollDelta !== 0) {
      scrollAmount = Math.abs(Math.round(scrollDelta));
      scrollDirection = scrollDelta > 0 ? 'down' : 'up';
    } else {
      const desc = description.toLowerCase();
      scrollDirection = desc.includes('up') ? 'up' : 
                       desc.includes('left') ? 'left' :
                       desc.includes('right') ? 'right' : 'down';
      scrollAmount = 400;
    }
    
    return { scrollAmount, scrollDirection, scrollContainer };
  }

  private extractNaturalLanguage(step: any): AgentHint['naturalLanguage'] | undefined {
    if (!step.naturalLanguage) {
      return undefined;
    }

    return {
      intent: step.naturalLanguage.intent,
      precondition: step.naturalLanguage.precondition,
      expectedOutcome: step.naturalLanguage.expectedOutcome,
      dependencies: step.naturalLanguage.dependencies || [],
    };
  }

  /**
   * Build AI analysis context from step guidance
   * This provides rich context about WHY this element was chosen and HOW to find it
   */
  private buildAIAnalysisContext(guidance: StepExecutionGuidance | undefined): AIAnalysisContext | undefined {
    if (!guidance) {
      return undefined;
    }

    // Build structured success criteria from expected outcome
    const successCriteria = this.inferSuccessCriteria(guidance.expectedOutcome);

    return {
      intent: guidance.intent,
      whyThisElement: guidance.whyThisElement,
      elementFindingStrategy: {
        lookingFor: guidance.elementFindingStrategy.lookingFor,
        searchContext: guidance.elementFindingStrategy.searchContext,
        distinguishers: guidance.elementFindingStrategy.distinguishers,
        textPatterns: guidance.elementFindingStrategy.textPatterns,
        elementType: guidance.elementFindingStrategy.elementType,
      },
      preconditions: guidance.preconditions,
      expectedOutcome: guidance.expectedOutcome,
      criticality: guidance.criticality,
      alternatives: guidance.alternatives,
      successCriteria,
    };
  }

  /**
   * Infer structured success criteria from expected outcome text
   */
  private inferSuccessCriteria(expectedOutcome: string): StructuredSuccessCriteria | undefined {
    if (!expectedOutcome) {
      return undefined;
    }

    const outcomeLower = expectedOutcome.toLowerCase();

    // Dropdown opens
    if (outcomeLower.includes('dropdown') && outcomeLower.includes('open')) {
      return {
        type: 'element_appears',
        params: {
          elementDescription: 'dropdown options list',
          elementRole: 'listbox',
        },
        fallback: expectedOutcome,
      };
    }

    // Modal/dialog appears
    if (outcomeLower.includes('modal') || outcomeLower.includes('dialog') || outcomeLower.includes('popup')) {
      if (outcomeLower.includes('open') || outcomeLower.includes('appear')) {
        return {
          type: 'modal_appears',
          params: {},
          fallback: expectedOutcome,
        };
      }
      if (outcomeLower.includes('close') || outcomeLower.includes('disappear')) {
        return {
          type: 'element_disappears',
          params: {
            elementDescription: 'modal dialog',
          },
          fallback: expectedOutcome,
        };
      }
    }

    // Success/confirmation messages
    if (outcomeLower.includes('success') || outcomeLower.includes('saved') || outcomeLower.includes('created') || outcomeLower.includes('added')) {
      return {
        type: 'toast_appears',
        params: {
          toastType: 'success',
          toastPattern: 'success|saved|created|added|complete',
        },
        fallback: expectedOutcome,
      };
    }

    // Page navigation
    if (outcomeLower.includes('navigate') || outcomeLower.includes('redirect') || outcomeLower.includes('url')) {
      return {
        type: 'url_changes',
        params: {},
        fallback: expectedOutcome,
      };
    }

    // Value entered in field
    if (outcomeLower.includes('enter') || outcomeLower.includes('value') || outcomeLower.includes('field')) {
      return {
        type: 'dom_stabilizes',
        params: {},
        fallback: expectedOutcome,
      };
    }

    // Option selected
    if (outcomeLower.includes('select') || outcomeLower.includes('chosen') || outcomeLower.includes('option')) {
      return {
        type: 'text_appears',
        params: {
          textPattern: '', // Will be filled with the selected value
        },
        fallback: expectedOutcome,
      };
    }

    // Default: DOM stabilizes
    return {
      type: 'dom_stabilizes',
      params: {},
      fallback: expectedOutcome,
    };
  }
}

// Export singleton for convenience
export const hintExtractor = new HintExtractor();

