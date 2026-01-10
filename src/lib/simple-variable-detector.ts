/**
 * Simple Variable Detector (No AI Required)
 * 
 * Detects variables using deterministic rules:
 * - All INPUT steps with values → VARIABLES (user typed data)
 * - CLICK steps on choice elements → VARIABLES (dropdown, radio, checkbox)
 * - CLICK steps on buttons → NOT VARIABLES (actions like Submit, Save)
 * 
 * This is the primary detector - AI is only used for label enhancement,
 * not for deciding whether something is a variable.
 */

import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { VariableDefinition, WorkflowVariables } from './variable-detector';

// Navigation button patterns to exclude (case-insensitive)
const NAVIGATION_PATTERNS = [
  'next', 'previous', 'prev', 'back', 'forward',
  'submit', 'save', 'cancel', 'close', 'done',
  'continue', 'proceed', 'finish', 'complete',
  'ok', 'yes', 'no', 'confirm', 'apply',
  'search', 'filter', 'reset', 'clear',
  'login', 'logout', 'sign in', 'sign out',
];

// Common variable field patterns (for prioritization/confidence)
const VARIABLE_FIELD_PATTERNS = [
  'name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'country',
  'first', 'last', 'username', 'password',
  'company', 'organization', 'title', 'position',
  'date', 'time', 'amount', 'price', 'quantity', 'number',
  'description', 'message', 'comment', 'note',
  'search', 'query', 'filter',
];

// Roles that indicate selectable options (choice elements = variables)
const SELECTABLE_ROLES = [
  'option', 'radio', 'checkbox', 'menuitemradio', 'menuitemcheckbox',
  'listitem', 'switch',
];

// Roles that indicate buttons (NOT variables)
const BUTTON_ROLES = ['button', 'link', 'menuitem', 'tab', 'treeitem'];

export class SimpleVariableDetector {
  /**
   * Detect variables using simple pattern-based rules (no AI)
   */
  static detectVariables(steps: WorkflowStep[]): WorkflowVariables {
    console.log('[SimpleVariableDetector] Starting pattern-based detection for', steps.length, 'steps');
    
    const variables: VariableDefinition[] = [];
    const processedFields = new Set<string>(); // Deduplicate by field name
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const payload = step.payload;
      
      if (!isWorkflowStepPayload(payload)) continue;
      
      // Process INPUT steps
      if (step.type === 'INPUT' && payload.value) {
        const stepId = `step-${i}`;
        const variable = this.createInputVariable(i, stepId, payload);
        if (variable && !processedFields.has(variable.fieldName)) {
          variables.push(variable);
          processedFields.add(variable.fieldName);
          console.log('[SimpleVariableDetector] ✅ Detected input variable:', variable.fieldName);
        }
      }
      
      // Process CLICK steps (dropdowns, selects, checkboxes)
      else if (step.type === 'CLICK') {
        const stepId = `step-${i}`;
        const variable = this.createClickVariable(i, stepId, payload);
        if (variable && !processedFields.has(variable.fieldName)) {
          variables.push(variable);
          processedFields.add(variable.fieldName);
          console.log('[SimpleVariableDetector] ✅ Detected select variable:', variable.fieldName);
        }
      }
    }
    
    console.log(`[SimpleVariableDetector] Detected ${variables.length} variables`);
    
    return {
      variables,
      detectedAt: Date.now(),
      analysisCount: steps.length,
    };
  }
  
  /**
   * Create variable from INPUT step
   */
  private static createInputVariable(
    stepIndex: number,
    stepId: string,
    payload: WorkflowStepPayload
  ): VariableDefinition | null {
    const value = payload.value;
    if (!value) return null;
    
    // Extract field name from label or aria-label
    const fieldLabel = payload.label || 
                      payload.elementRole || 
                      'input';
    
    const fieldName = this.cleanFieldName(fieldLabel);
    const variableName = this.toVariableName(fieldName);
    
    // Calculate confidence based on field patterns
    const confidence = this.calculateConfidence(fieldName, payload.inputDetails?.type);
    
    return {
      stepIndex,
      stepId,
      fieldName,
      fieldLabel,
      variableName,
      defaultValue: value,
      inputType: payload.inputDetails?.type || 'text',
      isVariable: true,
      confidence,
      reasoning: 'Pattern-based detection: INPUT field',
    };
  }
  
  /**
   * Create variable from CLICK step (dropdown/select/checkbox)
   * Only creates variable for choice elements, NOT buttons
   */
  private static createClickVariable(
    stepIndex: number,
    stepId: string,
    payload: WorkflowStepPayload
  ): VariableDefinition | null {
    const elementText = payload.elementText || payload.label;
    if (!elementText) return null;
    
    // FIRST: Check if this is a button (buttons are NOT variables)
    if (this.isButtonElement(payload)) {
      console.log('[SimpleVariableDetector] ⏭️ Skipping button:', elementText.substring(0, 30));
      return null;
    }
    
    // Check if this is a selectable option (choice element)
    const isSelectable = this.isSelectableOption(payload);
    if (!isSelectable) return null;
    
    // Double-check: navigation text patterns (buttons with action text)
    if (this.isNavigationButton(elementText)) {
      console.log('[SimpleVariableDetector] ⏭️ Skipping navigation button:', elementText);
      return null;
    }
    
    // Extract field name from label or context
    const fieldLabel = payload.label || 
                      payload.context?.parent?.text ||
                      'selection';
    
    const fieldName = this.cleanFieldName(fieldLabel);
    const variableName = this.toVariableName(fieldName);
    
    // Check if this is a dropdown
    const isDropdown = this.isDropdown(payload);
    
    // Get available options from decisionSpace if available
    const options = payload.context?.decisionSpace?.options || [];
    
    return {
      stepIndex,
      stepId,
      fieldName,
      fieldLabel,
      variableName,
      defaultValue: elementText,
      isVariable: true,
      confidence: 0.8,
      reasoning: isDropdown ? 'Choice selection: Dropdown option' : 'Choice selection: Selectable option',
      isDropdown,
      options: options.length > 0 ? options : undefined,
    };
  }
  
  /**
   * Check if element is a selectable option
   */
  private static isSelectableOption(payload: WorkflowStepPayload): boolean {
    // Check by role
    if (payload.elementRole && SELECTABLE_ROLES.includes(payload.elementRole)) {
      return true;
    }
    
    // Check by input type
    if (payload.inputDetails?.type === 'checkbox' || payload.inputDetails?.type === 'radio') {
      return true;
    }
    
    // Check by intent kind
    if (payload.intent?.kind === 'SELECT_DROPDOWN_OPTION' || payload.intent?.kind === 'TOGGLE_CHECKBOX') {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if this is a dropdown (select element)
   */
  private static isDropdown(payload: WorkflowStepPayload): boolean {
    return payload.elementRole === 'option' || 
           payload.elementRole === 'menuitem' ||
           payload.elementRole === 'listitem' ||
           payload.selector?.includes('select') ||
           payload.selector?.includes('[role="listbox"]') ||
           false;
  }
  
  /**
   * Check if element is a button (NOT a variable)
   */
  private static isButtonElement(payload: WorkflowStepPayload): boolean {
    const role = (payload.elementRole || '').toLowerCase();
    const inputType = payload.inputDetails?.type?.toLowerCase();
    const selector = (payload.selector || '').toLowerCase();

    // Check by role
    if (BUTTON_ROLES.includes(role)) return true;

    // Check by input type
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') return true;

    // Check by tag in selector
    if (selector.startsWith('button') || selector.includes('button[')) return true;

    return false;
  }

  /**
   * Check if this is a navigation button (should not be a variable)
   */
  private static isNavigationButton(text: string): boolean {
    const lowerText = text.toLowerCase().trim();
    return NAVIGATION_PATTERNS.some(pattern => 
      lowerText.includes(pattern) || pattern.includes(lowerText)
    );
  }
  
  /**
   * Clean field name for display
   */
  private static cleanFieldName(label: string): string {
    return label
      .replace(/[*:]/g, '') // Remove asterisks and colons
      .trim()
      .split('\n')[0] // Take first line if multi-line
      .substring(0, 50) // Limit length
      || 'field';
  }
  
  /**
   * Convert field name to camelCase variable name
   */
  private static toVariableName(fieldName: string): string {
    // Remove special characters, split by spaces/underscores/hyphens
    const words = fieldName
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/gi, '')
      .split(/[\s_-]+/)
      .filter(w => w.length > 0);
    
    if (words.length === 0) return 'variable';
    
    // camelCase: first word lowercase, rest capitalized
    return words[0] + words.slice(1).map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join('');
  }
  
  /**
   * Calculate confidence score based on field patterns
   */
  private static calculateConfidence(fieldName: string, inputType?: string): number {
    const lowerField = fieldName.toLowerCase();
    
    // High confidence for known variable patterns
    if (VARIABLE_FIELD_PATTERNS.some(pattern => lowerField.includes(pattern))) {
      return 0.9;
    }
    
    // Medium confidence for specific input types
    if (inputType && ['email', 'tel', 'number', 'date', 'time'].includes(inputType)) {
      return 0.85;
    }
    
    // Default confidence
    return 0.7;
  }
}

