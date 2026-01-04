/**
 * Variable Detector Service
 * 
 * Analyzes workflow steps to detect which values should be parameterized as variables.
 * Uses AI vision analysis of snapshots to determine variable vs static values.
 * 
 * Filtering strategy (cost optimization):
 * - Primary focus: INPUT and TEXTAREA steps (most common variable sources)
 * - CLICK steps: Only analyze if element is a selectable option (dropdown, radio, checkbox)
 * - Exclude: Navigation CLICK steps (Next, Submit, tabs, links)
 */

import { aiConfig } from './ai-config';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

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

export class VariableDetector {
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

    // Filter steps to only those that could contain variables
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
      // Call Edge Function
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
        // Include if it has a value (what user typed) OR a label (field name)
        const hasValue = !!payload.value;
        const hasLabel = !!payload.label;
        const hasSnapshot = !!(payload.visualSnapshot?.viewport || payload.visualSnapshot?.elementSnippet);
        
        if (hasValue || hasLabel) {
          console.log(`[VariableDetector] Including INPUT step ${i}: value="${payload.value || '(empty)'}", label="${payload.label || '(none)'}", hasSnapshot=${hasSnapshot}`);
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

    // Extract column header and cell reference from grid coordinates (for spreadsheets)
    const columnHeader = payload.context?.gridCoordinates?.columnHeader;
    let cellReference = payload.context?.gridCoordinates?.cellReference;
    
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

    const requestPayload = {
      steps: stepsForAnalysis,
      pageContext,
      initialFullPageSnapshot: initialFullPageSnapshot || undefined, // Include full page snapshot for spreadsheet column header detection
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
