/**
 * Variable Detector Service
 * 
 * Detects which workflow steps should be parameterized as variables.
 * 
 * SIMPLIFIED RULES (no AI needed for classification):
 * - INPUT steps with values → ALWAYS variables (user typed data)
 * - CLICK steps on choice elements → VARIABLES (dropdown, radio, checkbox)
 * - CLICK steps on buttons → NOT variables (actions like Submit, Save)
 * 
 * AI is only used for:
 * - Label extraction when DOM-based detection fails
 * - Dropdown option extraction when DOM-based detection fails
 */

import { aiConfig } from './ai-config';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { SpreadsheetHelpers } from './spreadsheet-helpers';
import { UserContextStorage } from './user-context-storage';

/**
 * Definition of a detected variable in a workflow
 */
export interface VariableDefinition {
  stepIndex: number;
  stepId: string;
  fieldName: string;        // Human-readable field name (e.g., "Email", "Client Name")
  fieldLabel?: string;      // Original label from the element
  variableName: string;     // camelCase variable name (e.g., "email", "clientName")
  defaultValue: string;     // The recorded value (used as default)
  inputType?: string;       // Input type (text, email, password, etc.)
  isVariable: boolean;      // Whether AI confirmed this is a variable
  confidence: number;       // AI confidence score (0-1)
  reasoning?: string;       // AI explanation for the classification
  // For dropdowns/selects: all available options
  options?: string[];       // Available options for dropdown/select variables
  isDropdown?: boolean;     // Whether this is a dropdown/select variable
  // For spreadsheet cells: column context
  columnHeader?: string;    // Column header (e.g., "Name", "Email", "Phone")
  cellReference?: string;   // Cell reference (e.g., "A2", "B3")
  // Source hint for UI clarity (how the variable was captured)
  sourceHint?: 'user_input' | 'external_paste' | 'dropdown_selection';
}

/**
 * Container for workflow variables
 */
export interface WorkflowVariables {
  variables: VariableDefinition[];
  detectedAt: number;       // Timestamp of detection
  analysisCount: number;    // Number of steps analyzed
}

  /**
   * Step metadata for AI analysis
   */
interface StepMetadata {
  stepIndex: number;
  stepId: string;
  stepType: 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD';
  value?: string;
  label?: string;
  inputType?: string;
  elementRole?: string;
  elementTag?: string;
  placeholder?: string;
  isSelectableOption?: boolean;
  isDropdown?: boolean;        // Whether this is a dropdown/select
  dropdownOptions?: string[];  // Available options in dropdown (if known)
  selector?: string;           // Element selector (for detecting dropdowns)
  columnHeader?: string;       // Column header for spreadsheet cells (e.g., "Price", "Quantity")
  cellReference?: string;      // Cell reference for spreadsheet cells (e.g., "B5", "A1")
}

/**
 * Step data to send to Edge Function
 */
interface StepForAnalysis {
  metadata: StepMetadata;
  beforeSnapshot?: string;
  afterSnapshot?: string;
}

/**
 * Response from Edge Function
 */
interface DetectVariablesResponse {
  variables: VariableDefinition[];
  analysisCount: number;
  error?: string;
}

// Navigation button text patterns (case-insensitive)
const NAVIGATION_BUTTON_PATTERNS = [
  'next', 'previous', 'prev', 'back', 'forward',
  'submit', 'save', 'cancel', 'close', 'done',
  'continue', 'proceed', 'finish', 'complete',
  'ok', 'yes', 'no', 'confirm', 'apply',
  'search', 'filter', 'reset', 'clear',
  'add', 'create', 'new', 'edit', 'delete', 'remove',
  'login', 'logout', 'sign in', 'sign out', 'sign up',
  'expand', 'collapse', 'show', 'hide', 'toggle',
  'refresh', 'reload', 'update',
];

// Roles that indicate selectable options
const SELECTABLE_ROLES = [
  'option', 'radio', 'checkbox', 'menuitemradio', 'menuitemcheckbox',
  'listitem', 'treeitem', 'tab', 'switch',
];

// Roles that indicate choice elements (variables)
const CHOICE_ROLES = [
  'option', 'radio', 'checkbox', 'menuitemradio', 'menuitemcheckbox',
  'switch', 'listitem',
];

// Roles that indicate buttons/triggers (NOT variables)
const BUTTON_ROLES = ['button', 'link', 'menuitem', 'combobox']; // combobox = dropdown trigger, not the selection

export class VariableDetector {
  // ============================================================================
  // NEW: Simplified Variable Detection with Deterministic Rules
  // ============================================================================

  /**
   * Detect variables using simple deterministic rules (no AI needed for classification)
   * 
   * Rules:
   * - INPUT steps with values → ALWAYS variables
   * - CLICK steps on choice elements → VARIABLES (dropdown, radio, checkbox)
   * - CLICK steps on buttons → NOT variables
   */
  static detectVariablesSimplified(steps: WorkflowStep[]): WorkflowVariables {
    console.log('[VariableDetector] Using simplified detection for', steps.length, 'steps');
    
    const variables: VariableDefinition[] = [];
    const processedFields = new Map<string, VariableDefinition>(); // Deduplicate by field key
    const skipSteps = new Set<number>(); // Track steps to skip (e.g., CLICK when INPUT follows)

    // Pre-pass: Identify CLICK+INPUT pairs for the same dropdown field
    // Transfer dropdown options from CLICK to INPUT before skipping
    for (let i = 0; i < steps.length - 1; i++) {
      const currentStep = steps[i];
      const nextStep = steps[i + 1];
      
      if (!isWorkflowStepPayload(currentStep.payload) || !isWorkflowStepPayload(nextStep.payload)) continue;
      
      // Check if this is a CLICK followed by INPUT within 2 seconds (dropdown selection pattern)
      if (currentStep.type === 'CLICK' && nextStep.type === 'INPUT') {
        const timeDiff = nextStep.payload.timestamp - currentStep.payload.timestamp;
        // Match by: label, elementText, or if CLICK elementText matches INPUT label
        const sameField = currentStep.payload.label === nextStep.payload.label ||
                         currentStep.payload.elementText === nextStep.payload.value ||
                         currentStep.payload.elementText === nextStep.payload.label;
        
        if (timeDiff < 2000 && sameField) {
          console.log(`[VariableDetector] Detected CLICK+INPUT pair for same field at steps ${i} and ${i+1}`);
          console.log(`[VariableDetector] CLICK label: "${currentStep.payload.label}", INPUT label: "${nextStep.payload.label}"`);
          console.log(`[VariableDetector] CLICK step context:`, {
            hasContext: !!currentStep.payload.context,
            hasDecisionSpace: !!currentStep.payload.context?.decisionSpace,
            hasOptions: !!currentStep.payload.context?.decisionSpace?.options,
            optionsCount: currentStep.payload.context?.decisionSpace?.options?.length || 0,
          });
          
          // CRITICAL: Transfer dropdown options from CLICK to INPUT
          if (currentStep.payload.context?.decisionSpace?.options) {
            const options = currentStep.payload.context.decisionSpace.options;
            console.log(`[VariableDetector] 📋 Transferring ${options.length} dropdown options from CLICK to INPUT step`);
            
            // Ensure context exists
            const inputPayload = nextStep.payload as any;
            if (!inputPayload.context) {
              inputPayload.context = {};
            }
            
            // Create or update decisionSpace on INPUT step
            if (!inputPayload.context.decisionSpace) {
              inputPayload.context.decisionSpace = {
                type: 'LIST_SELECTION',
                selectedText: nextStep.payload.value || '',
                selectedIndex: options.indexOf(nextStep.payload.value || ''),
                options: options,
              };
            } else {
              inputPayload.context.decisionSpace.options = options;
              inputPayload.context.decisionSpace.selectedIndex = options.indexOf(nextStep.payload.value || '');
            }
          }
          
          console.log(`[VariableDetector] Will skip CLICK step and only use INPUT step (with transferred options)`);
          skipSteps.add(i); // Skip the CLICK, keep the INPUT
        }
      }
    }

    for (let i = 0; i < steps.length; i++) {
      // Skip if identified as duplicate CLICK in a CLICK+INPUT pair
      if (skipSteps.has(i)) {
        console.log(`[VariableDetector] ⏭️ Skipping step ${i} (duplicate CLICK in CLICK+INPUT pair)`);
        continue;
      }
      
      const step = steps[i];
      const payload = step.payload;

      if (!isWorkflowStepPayload(payload)) {
        console.log(`[VariableDetector] ⏭️ Skipping step ${i}: not a workflow step payload`);
        continue;
      }

      // Rule 1: INPUT steps with values are ALWAYS variables
      if ((step.type === 'INPUT' || step.type === 'KEYBOARD') && payload.value) {
        console.log(`[VariableDetector] 📝 Processing INPUT step ${i}:`, {
          type: step.type,
          hasValue: !!payload.value,
          value: payload.value?.substring(0, 30),
          label: payload.label,
          selector: payload.selector?.substring(0, 50),
        });
        
        const variable = this.createVariableFromInput(i, step, payload);
        if (variable) {
          // Deduplicate: Use label + selector as key (same field = update value)
          const fieldKey = `${variable.fieldLabel || 'field'}-${payload.selector?.substring(0, 30) || i}`;
          
          if (processedFields.has(fieldKey)) {
            // Update existing variable with latest value
            const existing = processedFields.get(fieldKey)!;
            existing.defaultValue = variable.defaultValue;
            existing.stepIndex = i; // Update to latest step
            console.log(`[VariableDetector] 🔄 Updated existing variable:`, existing.fieldName);
          } else {
            // New variable
            processedFields.set(fieldKey, variable);
            console.log(`[VariableDetector] ✅ Created INPUT variable:`, {
              fieldName: variable.fieldName,
              variableName: variable.variableName,
              defaultValue: variable.defaultValue?.substring(0, 30),
            });
          }
        } else {
          console.log(`[VariableDetector] ❌ Failed to create variable for step ${i}`);
        }
      }

      // Rule 2: CLICK steps on choice elements are variables
      else if (step.type === 'CLICK') {
        const isChoice = this.isChoiceElement(payload);
        const isButton = this.isButtonElement(payload);

        console.log(`[VariableDetector] 🖱️ Processing CLICK step ${i}:`, {
          isChoice,
          isButton,
          elementText: payload.elementText?.substring(0, 30),
          role: payload.elementRole,
          label: payload.label?.substring(0, 30),
        });

        if (isChoice && !isButton) {
          const variable = this.createVariableFromChoice(i, step, payload);
          if (variable) {
            // Deduplicate by label/selector
            const fieldKey = `choice-${variable.fieldLabel || 'selection'}-${payload.selector?.substring(0, 30) || i}`;
            
            if (!processedFields.has(fieldKey)) {
              processedFields.set(fieldKey, variable);
              console.log(`[VariableDetector] ✅ Created CHOICE variable:`, {
                fieldName: variable.fieldName,
                defaultValue: variable.defaultValue?.substring(0, 30),
              });
            } else {
              console.log(`[VariableDetector] 🔄 Skipping duplicate choice:`, variable.fieldName);
            }
          }
        } else if (isButton) {
          console.log('[VariableDetector] ⏭️ Skipping button:', payload.elementText?.substring(0, 30));
        } else {
          console.log('[VariableDetector] ⏭️ Skipping non-choice CLICK:', payload.elementText?.substring(0, 30));
        }
      }
    }
    
    // Convert map to array
    variables.push(...Array.from(processedFields.values()));

    console.log(`[VariableDetector] 🎯 Detected ${variables.length} variables using simplified rules`);
    console.log('[VariableDetector] Variables:', variables.map(v => ({
      fieldName: v.fieldName,
      variableName: v.variableName,
      value: v.defaultValue?.substring(0, 20),
    })));

    return {
      variables,
      detectedAt: Date.now(),
      analysisCount: steps.length,
    };
  }

  /**
   * Check if a CLICK step is on a choice element (dropdown option, radio, checkbox)
   */
  private static isChoiceElement(payload: WorkflowStepPayload): boolean {
    // UNIFIED DETECTION: Check interactionType first (if available)
    if (payload.interactionType) {
      const kind = payload.interactionType.kind;
      if (kind === 'DROPDOWN_SELECTION' || kind === 'CHECKBOX_TOGGLE' || kind === 'RADIO_SELECTION') {
        console.log('[VariableDetector] ✅ Is choice element via interactionType:', kind);
        return true;
      }
      if (kind === 'BUTTON_CLICK' || kind === 'LINK_CLICK') {
        console.log('[VariableDetector] ❌ Not choice element via interactionType:', kind);
        return false;
      }
      // If UNKNOWN or other types, fall through to legacy detection
    }

    // LEGACY DETECTION: Fallback for old workflows without interactionType
    const role = (payload.elementRole || '').toLowerCase();
    const inputType = payload.inputDetails?.type?.toLowerCase();
    const selector = (payload.selector || '').toLowerCase();
    const label = (payload.label || '').toLowerCase();

    console.log('[VariableDetector] Checking if choice element (legacy):', {
      role,
      inputType,
      selectorPreview: selector.substring(0, 100),
      label: label.substring(0, 50),
      hasDecisionSpace: !!payload.context?.decisionSpace,
    });

    // Check by role
    if (CHOICE_ROLES.includes(role)) {
      console.log('[VariableDetector] ✅ Is choice element (by role):', role);
      return true;
    }

    // Check by input type
    if (inputType === 'radio' || inputType === 'checkbox') {
      console.log('[VariableDetector] ✅ Is choice element (by inputType):', inputType);
      return true;
    }

    // Check by selector patterns
    if (selector.includes('role="option"') || 
        selector.includes("role='option'") ||
        selector.includes('[role="listbox"]') ||
        selector.includes('[role="menu"]')) {
      console.log('[VariableDetector] ✅ Is choice element (by selector role)');
      return true;
    }

    // Check by context (decisionSpace indicates dropdown)
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      console.log('[VariableDetector] ✅ Is choice element (by decisionSpace)');
      return true;
    }

    // Check if inside a listbox or menu
    if (selector.includes('listbox') || 
        selector.includes('lightning-base-combobox') ||
        selector.includes('slds-dropdown') ||
        selector.includes('slds-listbox') ||
        payload.context?.container?.type?.toLowerCase().includes('dropdown')) {
      console.log('[VariableDetector] ✅ Is choice element (by Salesforce pattern)');
      return true;
    }

    // Salesforce Lightning specific patterns
    if (selector.includes('lightning-combobox') || 
        selector.includes('lightning-dual-listbox') ||
        selector.includes('lightning-menu-item') ||
        selector.includes('records-record-picklist') ||
        selector.includes('lightning-picklist') ||
        selector.includes('data-value=') ||
        role === 'presentation' && selector.includes('listbox')) {
      console.log('[VariableDetector] ✅ Is choice element (by Lightning component)');
      return true;
    }

    // Check if previous step was a dropdown trigger for this field
    // (CLICK to open dropdown, followed by another CLICK or INPUT for the selection)
    if (label.includes('status') || 
        label.includes('type') || 
        label.includes('category') ||
        label.includes('priority') ||
        label.includes('stage')) {
      console.log('[VariableDetector] ✅ Is choice element (by common dropdown field name):', label);
      return true;
    }

    console.log('[VariableDetector] ❌ Not a choice element');
    return false;
  }

  /**
   * Check if a CLICK step is on a button (NOT a variable)
   */
  private static isButtonElement(payload: WorkflowStepPayload): boolean {
    const role = (payload.elementRole || '').toLowerCase();
    const inputType = payload.inputDetails?.type?.toLowerCase();
    const elementText = (payload.elementText || '').toLowerCase();
    const label = (payload.label || '').toLowerCase();
    const selector = (payload.selector || '').toLowerCase();

    // Check by role
    if (BUTTON_ROLES.includes(role)) return true;

    // Check by input type
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') return true;

    // Check by tag (via selector)
    if (selector.startsWith('button') || selector.includes('<button')) return true;

    // Check by navigation text patterns
    const textToCheck = elementText || label;
    if (this.isNavigationButton(textToCheck)) return true;

    return false;
  }

  /**
   * Create a variable definition from an INPUT step
   */
  private static createVariableFromInput(
    stepIndex: number,
    _step: WorkflowStep,
    payload: WorkflowStepPayload
  ): VariableDefinition | null {
    if (!payload.value) return null;

    // Check for spreadsheet cell reference
    const cellRef = SpreadsheetHelpers.extractCellReference(payload);
    if (cellRef) {
      // Get column header from enriched spreadsheet context (pattern understanding)
      const columnHeader = payload.spreadsheetContext?.recordedIntent?.columnHeader ||
                          payload.spreadsheetContext?.recordedIntent?.semanticField ||
                          payload.context?.gridCoordinates?.columnHeader;

      // Use column header as field name if available (e.g., "Name" instead of "A10")
      const fieldName = columnHeader || cellRef;
      const variableName = columnHeader
        ? this.generateVariableName(columnHeader)  // "Name" → "name"
        : SpreadsheetHelpers.generateVariableName(cellRef);  // "A10" → "cellA10"

      console.log('[VariableDetector] 📊 Spreadsheet variable:', {
        cellRef,
        columnHeader,
        fieldName,
        variableName,
        value: payload.value?.substring(0, 20),
      });

      return {
        stepIndex,
        stepId: `${payload.timestamp}`,
        fieldName,
        fieldLabel: columnHeader || payload.label || cellRef,
        variableName,
        defaultValue: payload.value,
        inputType: payload.inputDetails?.type,
        isVariable: true,
        confidence: 1.0,
        reasoning: columnHeader
          ? `User typed value in "${columnHeader}" column (cell ${cellRef})`
          : 'User typed value in spreadsheet cell',
        cellReference: cellRef,
        columnHeader,
      };
    }

    // Regular input field
    const fieldName = payload.label || 'Input Field';

    // Check if this INPUT came from an external paste (demo value - should be variable)
    const isExternalPaste = payload.clipboardDetails?.isExternalPaste === true;

    // Check if this INPUT is actually a dropdown (has decisionSpace with options)
    const hasDropdownOptions = payload.context?.decisionSpace?.options &&
                               payload.context.decisionSpace.options.length > 0;

    if (hasDropdownOptions) {
      console.log('[VariableDetector] 📋 INPUT step has dropdown options:', {
        fieldName,
        optionsCount: payload.context!.decisionSpace!.options!.length,
        options: payload.context!.decisionSpace!.options!.slice(0, 5),
      });
    }

    if (isExternalPaste) {
      console.log('[VariableDetector] 📋 INPUT step from external paste (demo value):', {
        fieldName,
        value: payload.value?.substring(0, 30),
      });
    }

    // Determine source hint for UI clarity
    let sourceHint: 'user_input' | 'external_paste' | 'dropdown_selection' = 'user_input';
    if (isExternalPaste) {
      sourceHint = 'external_paste';
    } else if (hasDropdownOptions) {
      sourceHint = 'dropdown_selection';
    }

    // Adjust confidence and reasoning based on source
    const confidence = isExternalPaste ? 0.95 : 0.9;
    const reasoning = isExternalPaste
      ? 'External paste detected - user should provide their own value at runtime'
      : (hasDropdownOptions ? 'User selected option from dropdown' : 'User typed value in input field');

    return {
      stepIndex,
      stepId: `${payload.timestamp}`,
      fieldName,
      fieldLabel: payload.label,
      variableName: this.generateVariableName(fieldName),
      defaultValue: payload.value,
      inputType: payload.inputDetails?.type,
      isVariable: true,
      confidence,
      reasoning,
      sourceHint,
      // Include dropdown data if available
      isDropdown: hasDropdownOptions,
      options: hasDropdownOptions ? payload.context!.decisionSpace!.options : undefined,
    };
  }

  /**
   * Create a variable definition from a choice CLICK step
   */
  private static createVariableFromChoice(
    stepIndex: number,
    _step: WorkflowStep,
    payload: WorkflowStepPayload
  ): VariableDefinition | null {
    // UNIFIED DETECTION: Use interactionType if available
    let selectedText: string;
    let options: string[] = [];
    let isDropdown = false;
    
    if (payload.interactionType?.kind === 'DROPDOWN_SELECTION' && payload.interactionType.dropdown) {
      // Use unified detection data
      selectedText = payload.interactionType.dropdown.selectedOption;
      options = payload.interactionType.dropdown.options;
      isDropdown = true;
      console.log('[VariableDetector] Using interactionType dropdown metadata:', {
        selectedOption: selectedText,
        optionsCount: options.length,
      });
    } else {
      // LEGACY: Fallback to old detection
      selectedText = payload.elementText || 
                     payload.context?.decisionSpace?.selectedText || 
                     '';
      options = payload.context?.decisionSpace?.options || [];
      isDropdown = payload.elementRole === 'option' || 
                   payload.context?.decisionSpace?.type === 'LIST_SELECTION' ||
                   options.length > 0;
    }
    
    if (!selectedText) return null;

    // FIX: Use semantic anchors for field name (they contain the actual dropdown label like "Account Status")
    // This prevents multiple dropdowns from having the same variableName "selection"
    const fieldName = payload.label || 
                     payload.aiEvidence?.semanticAnchors?.textLabel ||
                     payload.aiEvidence?.semanticAnchors?.ariaLabel ||
                     payload.context?.container?.text || 
                     'Selection';
    
    console.log('[VariableDetector] Creating choice variable:', {
      fieldName,
      selectedText,
      hasOptions: options.length > 0,
      optionsCount: options.length,
      options: options.slice(0, 5), // Show first 5 options
      semanticAnchors: payload.aiEvidence?.semanticAnchors,
    });

    return {
      stepIndex,
      stepId: `${payload.timestamp}`,
      fieldName,
      fieldLabel: payload.label || payload.aiEvidence?.semanticAnchors?.textLabel,
      variableName: this.generateVariableName(fieldName),
      defaultValue: selectedText,
      isVariable: true,
      confidence: payload.interactionType?.confidence || 0.9,
      reasoning: 'User selected option from choices',
      isDropdown: isDropdown,
      options: options.length > 0 ? options : undefined,
    };
  }

  // ============================================================================
  // LEGACY: AI-based Variable Detection (kept for backward compatibility)
  // ============================================================================

  /**
   * Detect variables in workflow steps
   * Filters steps before sending to AI for cost optimization
   * @param steps - Workflow steps to analyze
   * @param initialFullPageSnapshot - Optional full page snapshot captured at recording start (for spreadsheet column headers)
   */
  static async detectVariables(
    steps: WorkflowStep[], 
    initialFullPageSnapshot?: string | null
  ): Promise<WorkflowVariables> {
    console.log('[VariableDetector] detectVariables called with:', {
      stepsCount: steps.length,
      hasInitialSnapshot: !!initialFullPageSnapshot,
      snapshotLength: initialFullPageSnapshot?.length,
    });
    const config = aiConfig.getConfig();
    
    if (!config.enabled) {
      console.log('[VariableDetector] AI is disabled, skipping variable detection');
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }

    console.log(`[VariableDetector] Starting detection for ${steps.length} total steps`);
    console.log(`[VariableDetector] Step types:`, steps.map(s => s.type));

    // FAST PATH: Extract spreadsheet variables directly (no AI needed)
    const spreadsheetVariables: any[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload)) {
        const payload = step.payload;
        // Use centralized helper to extract cell reference
        const cellRef = SpreadsheetHelpers.extractCellReference(payload);

        if (cellRef) {
          // Get column header from enriched spreadsheet context (pattern understanding)
          const columnHeader = payload.spreadsheetContext?.recordedIntent?.columnHeader ||
                              payload.spreadsheetContext?.recordedIntent?.semanticField ||
                              payload.context?.gridCoordinates?.columnHeader;

          // Use column header as field name if available (e.g., "Name" instead of "A10")
          const fieldName = columnHeader || cellRef;
          const variableName = columnHeader
            ? this.generateVariableName(columnHeader)  // "Name" → "name"
            : SpreadsheetHelpers.generateVariableName(cellRef);  // "A10" → "cellA10"

          const variable = {
            stepIndex: i,
            stepId: `${payload.timestamp}`,
            stepType: step.type,
            fieldName,
            variableName,
            defaultValue: payload.value || '',
            isVariable: true,
            confidence: 1.0, // 100% confident - we captured it directly
            reasoning: columnHeader
              ? `Spreadsheet INPUT in "${columnHeader}" column (cell ${cellRef})`
              : `Spreadsheet INPUT in cell ${cellRef}`,
            cellReference: cellRef,
            columnHeader,
          };
          console.log(`[VariableDetector] 📊 Found spreadsheet INPUT at step ${i}:`, {
            stepIndex: i,
            stepId: variable.stepId,
            cellRef,
            columnHeader,
            value: payload.value,
            fieldName: variable.fieldName,
            variableName: variable.variableName,
            fromSpreadsheetContext: !!payload.spreadsheetContext,
            fromGridCoordinates: !!payload.context?.gridCoordinates,
          });
          spreadsheetVariables.push(variable);
        }
      }
    }
    
    if (spreadsheetVariables.length > 0) {
      console.log(`[VariableDetector] ⚡ Created ${spreadsheetVariables.length} spreadsheet variables instantly (no AI needed):`, 
        spreadsheetVariables.map(v => `${v.fieldName}="${v.defaultValue}"`));
      
      // Return spreadsheet variables immediately - no AI analysis needed!
      return {
        variables: spreadsheetVariables,
        detectedAt: Date.now(),
        analysisCount: 0, // No AI calls made
      };
    }

    // Filter steps to only those that could contain variables (NON-spreadsheet steps)
    const stepsForAnalysis = this.filterStepsForAnalysis(steps);

    if (stepsForAnalysis.length === 0) {
      console.log('[VariableDetector] No steps to analyze for variables');
      console.log('[VariableDetector] Reasons: Steps may be missing visual snapshots or are not INPUT/selectable CLICK steps');
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }

    console.log(`[VariableDetector] Analyzing ${stepsForAnalysis.length} steps for variables (filtered from ${steps.length} total)`);
    console.log(`[VariableDetector] Steps to analyze:`, stepsForAnalysis.map(s => ({
      type: s.metadata.stepType,
      hasBefore: !!s.beforeSnapshot,
      hasAfter: !!s.afterSnapshot,
      isDropdown: s.metadata.isDropdown,
    })));

    try {
      // Call Edge Function for NON-spreadsheet steps only
      const response = await this.callEdgeFunction(stepsForAnalysis, steps, initialFullPageSnapshot);
      
      // Filter to only confirmed variables
      const confirmedVariables = response.variables.filter(v => v.isVariable && v.confidence >= 0.5);
      
      // Store steps reference for deduplication
      const stepsRef = steps;

      console.log(`[VariableDetector] Edge Function response:`, {
        totalVariables: response.variables.length,
        confirmedVariables: confirmedVariables.length,
        analysisCount: response.analysisCount,
        allVariables: response.variables.map(v => ({
          fieldName: v.fieldName,
          isVariable: v.isVariable,
          confidence: v.confidence,
        })),
      });

      // Deduplicate variables - merge variables that refer to the same field
      const deduplicatedVariables = this.deduplicateVariables(confirmedVariables, stepsRef);

      console.log(`[VariableDetector] After deduplication:`, {
        before: confirmedVariables.length,
        after: deduplicatedVariables.length,
        removed: confirmedVariables.length - deduplicatedVariables.length,
      });

      return {
        variables: deduplicatedVariables,
        detectedAt: Date.now(),
        analysisCount: response.analysisCount,
      };
    } catch (error) {
      console.error('[VariableDetector] Error detecting variables:', error);
      return {
        variables: [],
        detectedAt: Date.now(),
        analysisCount: 0,
      };
    }
  }

  /**
   * Filter steps to only those that could contain variables
   * This is the key cost optimization - only send relevant steps to AI
   */
  private static filterStepsForAnalysis(steps: WorkflowStep[]): StepForAnalysis[] {
    const result: StepForAnalysis[] = [];
    
    // Track which steps to skip (e.g., dropdown triggers that are followed by option selections)
    const stepsToSkip = new Set<number>();
    
    // First pass: Identify dropdown trigger + option pairs to skip the trigger
    for (let i = 0; i < steps.length - 1; i++) {
      const currentStep = steps[i];
      const nextStep = steps[i + 1];
      
      if (currentStep.type === 'CLICK' && nextStep.type === 'CLICK' &&
          isWorkflowStepPayload(currentStep.payload) && isWorkflowStepPayload(nextStep.payload)) {
        
        const currentIsDropdownTrigger = this.isDropdownTrigger(currentStep.payload);
        const nextIsDropdownOption = this.isDropdownOption(nextStep.payload);
        
        if (currentIsDropdownTrigger && nextIsDropdownOption) {
          console.log(`[VariableDetector] Detected dropdown trigger + option pair at steps ${i} and ${i + 1}`);
          console.log(`[VariableDetector] Trigger text: "${currentStep.payload.elementText}", Option text: "${nextStep.payload.elementText}"`);
          console.log(`[VariableDetector] Skipping trigger step ${i}, will only analyze option step ${i + 1}`);
          stepsToSkip.add(i); // Skip the trigger, keep the option
        }
      }
    }
    
    for (let i = 0; i < steps.length; i++) {
      // Skip if identified as dropdown trigger in a pair
      if (stepsToSkip.has(i)) {
        console.log(`[VariableDetector] ⏭️ Skipping dropdown trigger at step ${i}`);
        continue;
      }
      
      const step = steps[i];
      const payload = step.payload;

      // Skip TAB_SWITCH steps - they don't have variable values
      if (step.type === 'TAB_SWITCH' || !isWorkflowStepPayload(payload)) {
        continue;
      }

      // Always include INPUT steps (primary variable source)
      // INPUT steps are important even without snapshots - the value is what matters
      if (step.type === 'INPUT') {
        // CRITICAL: Skip row 1 inputs (header row edits) - they're not variables!
        const cellRef = payload.context?.gridCoordinates?.cellReference;
        if (cellRef && /^[A-Z]+1$/.test(cellRef)) {
          console.log(`[VariableDetector] ⏭️ Skipping INPUT step ${i}: row 1 (header row) - cellRef: ${cellRef}`);
          continue;
        }
        
        // Include if it has a value (what user typed) OR a label (field name)
        const hasValue = !!payload.value;
        const hasLabel = !!payload.label;
        const hasSnapshot = !!(payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet);
        
        if (hasValue || hasLabel) {
          console.log(`[VariableDetector] Including INPUT step ${i}: value="${payload.value || '(empty)'}", label="${payload.label || '(none)'}", hasSnapshot=${hasSnapshot}, cellRef=${cellRef || 'none'}`);
          result.push(this.createStepForAnalysis(i, step, steps));
        } else {
          console.log(`[VariableDetector] Skipping INPUT step ${i}: no value and no label`);
        }
        continue;
      }

      // Include KEYBOARD steps that have a value (text input via keyboard)
      if (step.type === 'KEYBOARD' && payload.value) {
        // KEYBOARD steps can work without snapshots if they have a value
        console.log(`[VariableDetector] Including KEYBOARD step ${i}: value="${payload.value}", hasSnapshot=${!!(payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet)}`);
        result.push(this.createStepForAnalysis(i, step, steps));
        continue;
      }

      // For CLICK steps, only include if it's a selectable option (not navigation)
      if (step.type === 'CLICK') {
        const isSelectable = this.isSelectableOption(payload);
        console.log(`[VariableDetector] CLICK step ${i} check:`, {
          isSelectable,
          elementText: payload.elementText?.substring(0, 50),
          label: payload.label?.substring(0, 50),
          hasContext: !!payload.context,
          hasDecisionSpace: !!payload.context?.decisionSpace,
          decisionSpaceType: payload.context?.decisionSpace?.type,
          decisionSpaceOptions: payload.context?.decisionSpace?.options,
          decisionSpaceOptionsLength: payload.context?.decisionSpace?.options?.length || 0,
        });
        
        if (isSelectable) {
          // For dropdowns, include even without snapshot if we have decisionSpace data
          const hasSnapshot = payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet;
          const hasDecisionSpace = payload.context?.decisionSpace?.type === 'LIST_SELECTION' && 
                                    payload.context.decisionSpace.options && 
                                    payload.context.decisionSpace.options.length > 0;
          
          // Also check if it's a dropdown by checking if the element has role="option" or is in a listbox
          // Check both single and double quotes in selector (XPath can use either)
          const selectorLower = (payload.selector || '').toLowerCase();
          const isLikelyDropdown = payload.elementRole === 'option' || 
                                   payload.context?.decisionSpace?.type === 'LIST_SELECTION' ||
                                   selectorLower.includes('role="option"') ||
                                   selectorLower.includes("role='option'") ||
                                   selectorLower.includes('role=\'option\'') ||
                                   selectorLower.includes('listbox') ||
                                   selectorLower.includes('[role="option"]') ||
                                   selectorLower.includes("[role='option']");
          
          // Also check if this is the step immediately after a dropdown trigger
          let isAfterDropdownTrigger = false;
          if (i > 0 && steps[i - 1]?.type === 'CLICK') {
            const prevStep = steps[i - 1];
            if (isWorkflowStepPayload(prevStep.payload)) {
              isAfterDropdownTrigger = (prevStep.payload.label?.toLowerCase().includes('select') ||
                                        prevStep.payload.label?.toLowerCase().includes('choose') ||
                                        prevStep.payload.elementText?.toLowerCase().includes('select') ||
                                        prevStep.payload.selector?.toLowerCase().includes('promotion type')) || false;
            }
          }
          
          const shouldInclude = hasSnapshot || hasDecisionSpace || isLikelyDropdown || isAfterDropdownTrigger;
          
          console.log(`[VariableDetector] CLICK step ${i} inclusion check:`, {
            hasSnapshot,
            hasDecisionSpace,
            isLikelyDropdown,
            isAfterDropdownTrigger,
            elementRole: payload.elementRole,
            selector: payload.selector?.substring(0, 100),
            willInclude: shouldInclude,
          });
          
          if (shouldInclude) {
            console.log(`[VariableDetector] ✅ Including CLICK step ${i}: hasSnapshot=${hasSnapshot}, hasDecisionSpace=${hasDecisionSpace}, isLikelyDropdown=${isLikelyDropdown}, isAfterDropdownTrigger=${isAfterDropdownTrigger}`);
            result.push(this.createStepForAnalysis(i, step, steps));
          } else {
            console.log(`[VariableDetector] ❌ Skipping CLICK step ${i}: no snapshot, no decisionSpace, and not a dropdown`);
          }
        } else {
          console.log(`[VariableDetector] ❌ Skipping CLICK step ${i}: not a selectable option (likely navigation)`);
        }
        // Skip navigation clicks
      }
    }

    return result;
  }

  /**
   * Determine if a CLICK step is a dropdown trigger (the element that opens the dropdown)
   * Dropdown triggers typically:
   * - Have role="combobox" or similar
   * - Have placeholder text like "Select...", "Choose...", etc.
   * - Open a listbox when clicked
   */
  private static isDropdownTrigger(payload: WorkflowStepPayload): boolean {
    const elementText = (payload.elementText || '').toLowerCase().trim();
    const label = (payload.label || '').toLowerCase().trim();
    const role = (payload.elementRole || '').toLowerCase();
    const selector = (payload.selector || '').toLowerCase();
    
    // ENHANCED LOGGING: Show all detection criteria
    const detectionInfo = {
      elementText: elementText.substring(0, 50),
      label: label.substring(0, 50),
      role,
      hasComboboxRole: role === 'combobox',
      selectorHasCombobox: selector.includes('combobox'),
    };
    
    // Check for combobox role (strong indicator)
    if (role === 'combobox' || selector.includes('role="combobox"') || selector.includes("role='combobox'")) {
      console.log('🔍 [VariableDetector] Identified as dropdown TRIGGER (combobox role):', detectionInfo);
      return true;
    }
    
    // Check for placeholder-like text patterns
    const placeholderPatterns = ['select ', 'choose ', 'pick ', 'please select', 'please choose'];
    const hasPlaceholderText = placeholderPatterns.some(pattern => 
      elementText.includes(pattern) || label.includes(pattern)
    );
    
    // Check if selector contains combobox or input with dropdown properties
    const hasDropdownSelector = selector.includes('combobox') || 
                                 selector.includes('dropdown') ||
                                 (selector.includes('input') && selector.includes('listbox'));
    
    const isTrigger = hasPlaceholderText || hasDropdownSelector;
    
    if (isTrigger) {
      console.log('🔍 [VariableDetector] Identified as dropdown TRIGGER:', {
        ...detectionInfo,
        hasPlaceholderText,
        hasDropdownSelector,
        matchedPattern: placeholderPatterns.find(p => elementText.includes(p) || label.includes(p)),
      });
    }
    
    return isTrigger;
  }
  
  /**
   * Determine if a CLICK step is a dropdown option (an option within an opened dropdown)
   * Dropdown options typically:
   * - Have role="option"
   * - Are inside a listbox
   * - Have specific option text (not placeholder)
   */
  private static isDropdownOption(payload: WorkflowStepPayload): boolean {
    const role = (payload.elementRole || '').toLowerCase();
    const selector = (payload.selector || '').toLowerCase();
    const elementText = (payload.elementText || '').substring(0, 50);
    
    // ENHANCED LOGGING: Show all detection criteria
    const detectionInfo = {
      elementText,
      role,
      hasOptionRole: role === 'option',
      selectorHasOption: selector.includes('role="option"') || selector.includes("role='option'"),
      selectorHasListbox: selector.includes('listbox'),
      hasDecisionSpace: payload.context?.decisionSpace?.type === 'LIST_SELECTION',
    };
    
    // Check for option role (strongest indicator)
    if (role === 'option') {
      console.log('🔍 [VariableDetector] Identified as dropdown OPTION (option role):', detectionInfo);
      return true;
    }
    
    // Check selector for role='option' or role="option"
    if (selector.includes('role="option"') || selector.includes("role='option'") || 
        selector.includes('[role="option"]') || selector.includes("[role='option']")) {
      console.log('🔍 [VariableDetector] Identified as dropdown OPTION (selector has option role):', detectionInfo);
      return true;
    }
    
    // Check for listbox context
    if (selector.includes('listbox')) {
      console.log('🔍 [VariableDetector] Identified as dropdown OPTION (listbox in selector):', detectionInfo);
      return true;
    }
    
    // Check if decisionSpace indicates this is a list option
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      console.log('🔍 [VariableDetector] Identified as dropdown OPTION (decisionSpace LIST_SELECTION):', detectionInfo);
      return true;
    }
    
    console.log('🔍 [VariableDetector] NOT identified as dropdown option:', detectionInfo);
    return false;
  }

  /**
   * Determine if a CLICK step is a selectable option (dropdown, radio, checkbox)
   * vs a navigation button (Next, Submit, etc.)
   */
  private static isSelectableOption(payload: WorkflowStepPayload): boolean {
    const elementText = (payload.elementText || '').toLowerCase().trim();
    const label = (payload.label || '').toLowerCase().trim();
    const role = (payload.elementRole || '').toLowerCase();
    const selector = (payload.selector || '').toLowerCase();

    // Check if it's a navigation button by text
    if (this.isNavigationButton(elementText) || this.isNavigationButton(label)) {
      return false;
    }

    // Check if element has a selectable role
    if (SELECTABLE_ROLES.includes(role)) {
      return true;
    }

    // Check if it's inside a select dropdown
    if (selector.includes('select') || selector.includes('option')) {
      return true;
    }

    // Check for radio/checkbox input types
    if (payload.inputDetails?.type === 'radio' || payload.inputDetails?.type === 'checkbox') {
      return true;
    }

    // Check context for decision space (indicates a list selection)
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      return true;
    }

    // Check if parent/container suggests a dropdown or list
    const containerType = payload.context?.container?.type?.toLowerCase() || '';
    if (containerType.includes('dropdown') || containerType.includes('select') || containerType.includes('list')) {
      return true;
    }

    // Default: not a selectable option
    return false;
  }

  /**
   * Check if text indicates a navigation button
   */
  private static isNavigationButton(text: string): boolean {
    if (!text) return false;
    
    const normalizedText = text.toLowerCase().trim();
    
    // Check against navigation patterns
    return NAVIGATION_BUTTON_PATTERNS.some(pattern => 
      normalizedText === pattern || 
      normalizedText.startsWith(pattern + ' ') ||
      normalizedText.endsWith(' ' + pattern)
    );
  }

  /**
   * Create step data for AI analysis
   */
  private static createStepForAnalysis(
    stepIndex: number,
    step: WorkflowStep,
    allSteps: WorkflowStep[]
  ): StepForAnalysis {
    const payload = step.payload;

    // Only process WorkflowStepPayload, not TabSwitchPayload
    if (!isWorkflowStepPayload(payload)) {
      throw new Error('createStepForAnalysis called with TabSwitchPayload');
    }

    // Get "before" snapshot from previous step if available
    let beforeSnapshot: string | undefined;
    if (stepIndex > 0) {
      const prevStep = allSteps[stepIndex - 1];
      if (isWorkflowStepPayload(prevStep.payload)) {
        beforeSnapshot = prevStep.payload.visualSnapshot?.viewport || 
                         prevStep.payload.visualSnapshot?.elementSnippet;
      }
    }

    // Get "after" snapshot from current step
    // For dropdowns without snapshots, try to use the previous step's snapshot (dropdown trigger)
    let afterSnapshot = payload.visualSnapshot?.viewport || 
                        payload.visualSnapshot?.elementSnippet;
    
    // If no snapshot, try to use previous step's snapshot (for dropdowns or INPUT steps)
    if (!afterSnapshot && (step.type === 'CLICK' || step.type === 'INPUT')) {
      if (stepIndex > 0) {
        const prevStep = allSteps[stepIndex - 1];
        if (isWorkflowStepPayload(prevStep.payload)) {
          afterSnapshot = prevStep.payload.visualSnapshot?.viewport || 
                         prevStep.payload.visualSnapshot?.elementSnippet;
          if (afterSnapshot) {
            console.log(`[VariableDetector] Using previous step's snapshot for ${step.type} step ${stepIndex}`);
          }
        }
      }
    }

    // Check if this is a dropdown and extract options
    const isDropdown = this.isDropdownStep(payload);
    let dropdownOptions = isDropdown ? this.extractDropdownOptions(payload) : undefined;
    
    // Log decisionSpace data for debugging
    if (step.type === 'CLICK') {
      console.log(`[VariableDetector] CLICK step ${stepIndex} decisionSpace check:`, {
        hasDecisionSpace: !!payload.context?.decisionSpace,
        decisionSpaceType: payload.context?.decisionSpace?.type,
        decisionSpaceOptions: payload.context?.decisionSpace?.options,
        decisionSpaceOptionsLength: payload.context?.decisionSpace?.options?.length || 0,
        selectedText: payload.context?.decisionSpace?.selectedText,
      });
    }
    
    // If no options extracted but we have decisionSpace, use those options
    if (isDropdown && (!dropdownOptions || dropdownOptions.length === 0)) {
      if (payload.context?.decisionSpace?.options && Array.isArray(payload.context.decisionSpace.options)) {
        dropdownOptions = payload.context.decisionSpace.options;
        console.log(`[VariableDetector] ✅ Using decisionSpace options for dropdown step ${stepIndex}:`, dropdownOptions);
      } else {
        console.log(`[VariableDetector] ⚠️ Dropdown step ${stepIndex} has no options extracted and no decisionSpace data`);
      }
    }

    // Extract value - try multiple sources
    let extractedValue = payload.value || payload.context?.decisionSpace?.selectedText;
    
    // For dropdown options without value, try to extract from selector
    // Example: //*[@role='option'][contains(normalize-space(.), 'BOGO')] -> extract "BOGO"
    if (!extractedValue && isDropdown && payload.selector) {
      const valueMatch = payload.selector.match(/contains\([^,]+,\s*['"]([^'"]+)['"]\)/);
      if (valueMatch && valueMatch[1]) {
        extractedValue = valueMatch[1];
        console.log(`[VariableDetector] Extracted value from selector for step ${stepIndex}: "${extractedValue}"`);
      }
    }

    // Extract column header and cell reference using centralized helpers
    const columnHeader = SpreadsheetHelpers.extractColumnHeader(payload) || undefined;
    let cellReference = SpreadsheetHelpers.extractCellReference(payload) || undefined;
    
    // CRITICAL FIX: If label matches a cell reference pattern (A15, B15, etc.) and cellReference doesn't match,
    // use the label as the cellReference. This fixes timing issues where Name Box hasn't updated yet.
    if (payload.label && /^[A-Z]+\d+$/.test(payload.label) && cellReference !== payload.label) {
      console.log(`[VariableDetector] ⚠️ Mismatch detected: label="${payload.label}" but cellReference="${cellReference}". Using label as cellReference.`);
      console.log(`[VariableDetector] Mismatch fix - step ${stepIndex}: label="${payload.label}", originalCellRef="${cellReference}", correctedCellRef="${payload.label}"`);
      cellReference = payload.label;
    }
    
    // Log spreadsheet context if available
    if (columnHeader || cellReference) {
      console.log(`[VariableDetector] Spreadsheet context for step ${stepIndex}:`, {
        columnHeader,
        cellReference,
        fromSpreadsheetContext: !!payload.spreadsheetContext,
        fromGridCoordinates: !!payload.context?.gridCoordinates,
        rowIndex: payload.context?.gridCoordinates?.rowIndex,
        columnIndex: payload.context?.gridCoordinates?.columnIndex,
      });
    }

    // Extract metadata
    const metadata: StepMetadata = {
      stepIndex,
      stepId: `${payload.timestamp}`,
      stepType: step.type as 'INPUT' | 'CLICK' | 'SELECT' | 'KEYBOARD',
      value: extractedValue,
      label: payload.label,
      inputType: payload.inputDetails?.type,
      elementRole: payload.elementRole,
      elementTag: this.extractTagFromSelector(payload.selector),
      placeholder: this.extractPlaceholder(payload),
      isSelectableOption: step.type === 'CLICK' ? this.isSelectableOption(payload) : undefined,
      isDropdown,
      dropdownOptions,
      selector: payload.selector, // Include selector for Edge Function to detect dropdowns
      columnHeader, // Include column header for spreadsheet cells
      cellReference, // Include cell reference for spreadsheet cells
    };
    
    // Log metadata for dropdown CLICK steps
    if (step.type === 'CLICK' && isDropdown) {
      console.log(`[VariableDetector] Dropdown CLICK step ${stepIndex} metadata:`, {
        isDropdown,
        hasDropdownOptions: !!dropdownOptions,
        dropdownOptionsCount: dropdownOptions?.length || 0,
        value: metadata.value,
        label: metadata.label,
        hasDecisionSpace: !!payload.context?.decisionSpace,
      });
    }

    return {
      metadata,
      beforeSnapshot,
      afterSnapshot,
    };
  }

  /**
   * Deduplicate variables that refer to the same field
   * Groups by: cellReference (for spreadsheets), selector, or fieldLabel
   * Merges duplicates keeping the best fieldName, highest confidence, and most recent value
   */
  private static deduplicateVariables(
    variables: VariableDefinition[],
    steps: WorkflowStep[]
  ): VariableDefinition[] {
    if (variables.length === 0) {
      return variables;
    }

    // Create a map to group variables by field identifier
    const variableMap = new Map<string, VariableDefinition[]>();

    for (const variable of variables) {
      // Get the original step to access cellReference/selector
      const originalStep = steps[variable.stepIndex];
      const payload = originalStep?.payload;

      // Only process WorkflowStepPayload
      if (!isWorkflowStepPayload(payload)) {
        continue;
      }

      // Determine the field identifier key
      let fieldKey: string;

      // For spreadsheets, use cellReference as the key (most reliable)
      const cellReference = payload.context?.gridCoordinates?.cellReference;
      if (cellReference) {
        fieldKey = `cell:${cellReference}`;
      } else if (variable.fieldLabel && /^[A-Z]+\d+$/.test(variable.fieldLabel)) {
        // If fieldLabel is a cell reference (like "B15"), use it
        fieldKey = `cell:${variable.fieldLabel}`;
      } else if (payload.selector) {
        // For regular fields, use selector (normalized)
        // Normalize selector by removing dynamic parts (like indices, timestamps)
        const normalizedSelector = this.normalizeSelector(payload.selector);
        fieldKey = `selector:${normalizedSelector}`;
      } else if (variable.fieldLabel) {
        // Fallback to fieldLabel (normalized)
        const normalizedLabel = variable.fieldLabel.toLowerCase().trim();
        fieldKey = `label:${normalizedLabel}`;
      } else {
        // Last resort: use fieldName (but this is less reliable)
        // Only use this if fieldName is not generic
        const normalizedFieldName = variable.fieldName.toLowerCase().trim();
        const isGeneric = /^(unknown|field|cell|column|value|input|step)/i.test(variable.fieldName);
        if (!isGeneric) {
          fieldKey = `field:${normalizedFieldName}`;
        } else {
          // Can't reliably deduplicate generic names, keep as separate
          fieldKey = `unique:${variable.stepIndex}`;
        }
      }

      // Group variables by field key
      if (!variableMap.has(fieldKey)) {
        variableMap.set(fieldKey, []);
      }
      variableMap.get(fieldKey)!.push(variable);
    }

    // Merge variables in each group
    const mergedVariables: VariableDefinition[] = [];

    for (const [fieldKey, group] of variableMap.entries()) {
      if (group.length === 1) {
        // No duplicates, keep as is
        mergedVariables.push(group[0]);
        continue;
      }

      // Multiple variables for the same field - merge them
      console.log(`[VariableDetector] Merging ${group.length} duplicate variables for field: ${fieldKey}`, {
        variables: group.map(v => ({
          stepIndex: v.stepIndex,
          fieldName: v.fieldName,
          defaultValue: v.defaultValue,
          confidence: v.confidence,
        })),
      });

      // Sort by stepIndex (most recent last) to get the latest value
      group.sort((a, b) => a.stepIndex - b.stepIndex);

      // Find the best variable (highest confidence, best fieldName)
      let bestVariable = group[0];
      for (const variable of group) {
        // Prefer non-generic field names
        const isGeneric = /^(unknown|field|cell|column|value|input)/i.test(variable.fieldName);
        const bestIsGeneric = /^(unknown|field|cell|column|value|input)/i.test(bestVariable.fieldName);
        
        if (variable.confidence > bestVariable.confidence) {
          bestVariable = variable;
        } else if (variable.confidence === bestVariable.confidence && !isGeneric && bestIsGeneric) {
          // Same confidence, but this one has a better (non-generic) name
          bestVariable = variable;
        }
      }

      // Merge: use best fieldName, highest confidence, most recent value
      const merged: VariableDefinition = {
        ...bestVariable,
        // Use the most recent value (last step)
        defaultValue: group[group.length - 1].defaultValue,
        // Use the highest confidence
        confidence: Math.max(...group.map(v => v.confidence)),
        // Combine options if any are dropdowns
        options: this.mergeOptions(group),
        // Use the stepIndex of the first occurrence (for reference)
        stepIndex: group[0].stepIndex,
      };

      console.log(`[VariableDetector] Merged variable:`, {
        fieldName: merged.fieldName,
        defaultValue: merged.defaultValue,
        confidence: merged.confidence,
        mergedFrom: group.length,
      });

      mergedVariables.push(merged);
    }

    return mergedVariables;
  }

  /**
   * Normalize selector by removing dynamic parts (indices, timestamps, etc.)
   * This helps identify the same field even if DOM structure changes slightly
   */
  private static normalizeSelector(selector: string): string {
    if (!selector) return '';

    // Remove array indices like [0], [1], etc.
    let normalized = selector.replace(/\[\d+\]/g, '');
    
    // Remove common dynamic attributes (ids with timestamps, etc.)
    normalized = normalized.replace(/id="[^"]*"/gi, '');
    normalized = normalized.replace(/id='[^']*'/gi, '');
    
    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized.toLowerCase();
  }

  /**
   * Merge options from multiple dropdown variables
   */
  private static mergeOptions(variables: VariableDefinition[]): string[] | undefined {
    const allOptions = new Set<string>();
    
    for (const variable of variables) {
      if (variable.options && variable.options.length > 0) {
        variable.options.forEach(opt => allOptions.add(opt));
      }
    }
    
    return allOptions.size > 0 ? Array.from(allOptions).sort() : undefined;
  }

  /**
   * Extract tag name from selector
   */
  private static extractTagFromSelector(selector: string): string | undefined {
    if (!selector) return undefined;
    
    // Match tag at start of selector (e.g., "input#email" -> "input")
    const match = selector.match(/^([a-z]+)/i);
    return match ? match[1].toLowerCase() : undefined;
  }

  /**
   * Extract placeholder from payload
   */
  private static extractPlaceholder(payload: WorkflowStepPayload): string | undefined {
    // Try to find placeholder in unique attributes
    if (payload.context?.uniqueAttributes?.placeholder) {
      return payload.context.uniqueAttributes.placeholder;
    }
    return undefined;
  }

  /**
   * Check if this step is a dropdown/select
   */
  private static isDropdownStep(payload: WorkflowStepPayload): boolean {
    // Check if it's a SELECT element
    if (payload.selector?.toLowerCase().includes('select')) {
      return true;
    }

    // Check if decisionSpace indicates a list selection (dropdown)
    if (payload.context?.decisionSpace?.type === 'LIST_SELECTION') {
      return true;
    }

    // Check if element role suggests dropdown
    const role = (payload.elementRole || '').toLowerCase();
    if (role === 'combobox' || role === 'listbox' || role === 'option') {
      return true;
    }

    // Check if selector contains role="option" or role='option' (dropdown option)
    const selector = (payload.selector || '').toLowerCase();
    if (selector.includes('role="option"') || 
        selector.includes("role='option'") ||
        selector.includes('[role="option"]') ||
        selector.includes("[role='option']") ||
        selector.includes('listbox')) {
      return true;
    }

    return false;
  }

  /**
   * Extract dropdown options from step payload
   * Uses decisionSpace if available, otherwise returns undefined (AI will extract from snapshot)
   */
  private static extractDropdownOptions(payload: WorkflowStepPayload): string[] | undefined {
    // If decisionSpace has options, use them
    if (payload.context?.decisionSpace?.options && Array.isArray(payload.context.decisionSpace.options)) {
      return payload.context.decisionSpace.options;
    }

    // Return undefined - AI will extract from snapshot
    return undefined;
  }

  /**
   * Call the detect_variables Edge Function
   * @param initialFullPageSnapshot - Optional full page snapshot for spreadsheet column header detection
   */
  private static async callEdgeFunction(
    stepsForAnalysis: StepForAnalysis[],
    allSteps: WorkflowStep[],
    initialFullPageSnapshot?: string | null
  ): Promise<DetectVariablesResponse> {
    const config = aiConfig.getConfig();
    const url = aiConfig.getEdgeFunctionUrl(config.detectVariablesEdgeFunctionName);

    // Build page context from first step
    const firstStep = allSteps[0];
    const pageContext = firstStep && isWorkflowStepPayload(firstStep.payload) ? {
      url: firstStep.payload.url,
      title: document.title || '',
      pageType: firstStep.payload.pageType?.type,
    } : undefined;
    
    // Check if any step has spreadsheet context (cellReference or columnHeader)
    const hasSpreadsheetSteps = stepsForAnalysis.some(s => s.metadata.cellReference || s.metadata.columnHeader);
    console.log('[VariableDetector] Spreadsheet detection:', {
      hasSpreadsheetSteps,
      stepsWithCellReference: stepsForAnalysis.filter(s => s.metadata.cellReference).map(s => ({
        stepIndex: s.metadata.stepIndex,
        cellReference: s.metadata.cellReference,
      })),
    });

    // CRITICAL: For spreadsheet steps, ensure snapshot is included
    const isSpreadsheetUrl = pageContext?.url ? (
      pageContext.url.includes('docs.google.com/spreadsheets') ||
      pageContext.url.includes('excel.office.com') ||
      pageContext.url.includes('onedrive.live.com') ||
      pageContext.url.includes('office365.com')
    ) : false;
    const needsSnapshot = hasSpreadsheetSteps || isSpreadsheetUrl || pageContext?.pageType === 'data_table';
    
    if (needsSnapshot && !initialFullPageSnapshot) {
      console.warn('[VariableDetector] ⚠️ WARNING: Spreadsheet steps detected but no initial snapshot available!', {
        hasSpreadsheetSteps,
        isSpreadsheetUrl,
        pageType: pageContext?.pageType,
        pageUrl: pageContext?.url?.substring(0, 80) || 'N/A',
        stepsWithCellRef: stepsForAnalysis.filter(s => s.metadata.cellReference).map(s => ({
          stepIndex: s.metadata.stepIndex,
          cellReference: s.metadata.cellReference,
        })),
        message: 'Snapshot is required for AI to read column headers. Without it, AI will use cell references instead of header names.',
      });
    } else if (needsSnapshot && initialFullPageSnapshot) {
      console.log('[VariableDetector] ✅ Snapshot available for spreadsheet column header detection:', {
        snapshotLength: initialFullPageSnapshot.length,
        stepsWithCellRef: stepsForAnalysis.filter(s => s.metadata.cellReference).length,
      });
    }

    const userContext = await UserContextStorage.getUserContext();
    const requestPayload = {
      steps: stepsForAnalysis,
      pageContext,
      initialFullPageSnapshot: initialFullPageSnapshot || undefined, // Include full page snapshot for spreadsheet column header detection
      userContext: userContext || undefined,
    };
    console.log('[VariableDetector] Request payload:', {
      stepsCount: requestPayload.steps.length,
      hasPageContext: !!requestPayload.pageContext,
      pageType: requestPayload.pageContext?.pageType,
      hasInitialSnapshot: !!requestPayload.initialFullPageSnapshot,
      snapshotLength: requestPayload.initialFullPageSnapshot?.length,
      needsSnapshot,
      stepsWithCellReference: requestPayload.steps.filter(s => s.metadata.cellReference).map(s => ({
        stepIndex: s.metadata.stepIndex,
        cellReference: s.metadata.cellReference,
        columnHeader: s.metadata.columnHeader,
      })),
    });

    console.log(`[VariableDetector] Calling Edge Function: ${url}`);
    console.log(`[VariableDetector] Sending ${stepsForAnalysis.length} steps for analysis`);
    
    // Log request body size to check if snapshot is included
    const requestBody = JSON.stringify(requestPayload);
    console.log('[VariableDetector] Request body size:', {
      totalSize: requestBody.length,
      hasInitialSnapshot: !!requestPayload.initialFullPageSnapshot,
      snapshotSize: requestPayload.initialFullPageSnapshot?.length || 0,
      snapshotInBody: requestBody.includes(requestPayload.initialFullPageSnapshot?.substring(0, 50) || ''),
      stepsWithCellRef: requestPayload.steps.filter(s => s.metadata.cellReference).map(s => ({ stepIndex: s.metadata.stepIndex, cellRef: s.metadata.cellReference, label: s.metadata.label })),
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VariableDetector] Edge Function error ${response.status}:`, errorText);
      throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[VariableDetector] Edge Function response received:`, {
      variablesCount: result.variables?.length || 0,
      analysisCount: result.analysisCount || 0,
      hasError: !!result.error,
    });
    
    return result;
  }

  /**
   * Generate a camelCase variable name from a field name
   */
  static generateVariableName(fieldName: string): string {
    if (!fieldName) return 'field';
    
    return fieldName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 0)
      .map((word, index) => 
        index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join('') || 'field';
  }
}
