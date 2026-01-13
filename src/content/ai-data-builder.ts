/**
 * AIDataBuilder - Transforms WorkflowStep data into AI-optimized payloads
 * Prioritizes semantic coordinates over technical selectors
 * Token-optimized for LLM consumption
 * 
 * CRITICAL: These fields are EXCLUDED from AI payload to prevent token explosion:
 * ✂️ fallbackSelectors: CSS selectors are noise for LLMs (15-20 CSS strings per step)
 * ✂️ ancestors: Full DOM tree burns tokens (~500+ per step) - generic div wrappers
 * ✂️ eventDetails: Coordinates (x, y) are meaningless to text models
 * ✂️ elementBounds: Bounding box coordinates are meaningless without visual context
 * ✂️ timing: Performance data (timestamp, delayAfter) not needed for intent analysis
 * ✂️ html/outerHTML: Raw HTML causes context window overflow (5kb+ per Google Sheets cell)
 * ✂️ scrollPosition & viewport: Coordinates meaningless without visual context
 * 
 * KEPT FIELDS (semantic anchors that AI understands):
 * ✅ gridCoordinates: "A1", "Price column" (spreadsheets)
 * ✅ formCoordinates: "Client Name" label (forms)
 * ✅ decisionSpace: Dropdown options and selection
 * ✅ buttonContext: "Edit button in Account Information section" (Interactive Section Anchoring)
 * ✅ elementText: Clean text content
 * ✅ visualSnapshot: Screenshots for AI vision (Phase 2) - provides spatial context
 */

import type { WorkflowStep, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { AIAnalysisPayload, AIWorkflowPayload, SemanticContext, ElementContext, PageContext } from '../types/ai';

export class AIDataBuilder {
  /**
   * Test function - can be called from console to test Phase 1
   * Usage: window.testPhase1(workflowSteps)
   */
  static testPhase1(steps: import('../types/workflow').WorkflowStep[]): void {
    console.group('🧪 Phase 1 Test - AI Data Builder');
    console.log('Testing with', steps.length, 'steps');
    
    steps.forEach((step, index) => {
      const previousStep = index > 0 ? steps[index - 1] : undefined;
      const payload = this.buildStepAnalysisPayload(step, previousStep);
      
      console.group(`Step ${index + 1}: ${step.type}`);
      if (isWorkflowStepPayload(step.payload)) {
        console.log('Original has gridCoordinates?', !!step.payload.context?.gridCoordinates);
        console.log('Original has formCoordinates?', !!step.payload.context?.formCoordinates);
        console.log('Original has decisionSpace?', !!step.payload.context?.decisionSpace);
      }
      console.log('Transformed Payload:', payload);
      console.log('Has Semantic Context?', !!payload.semanticContext);
      if (payload.semanticContext) {
        console.log('Semantic Context:', payload.semanticContext);
      }
      console.log('Has Visual Snapshot?', !!payload.visualSnapshot);
      console.log('Payload Size:', JSON.stringify(payload).length, 'bytes');
      console.groupEnd();
    });
    
    console.groupEnd();
  }

  /**
   * Build AI-optimized payload for a single step
   * Prioritizes semantic coordinates (gridCoordinates, formCoordinates) over CSS selectors
   */
  static buildStepAnalysisPayload(
    step: WorkflowStep,
    previousStep?: WorkflowStep
  ): AIAnalysisPayload {
    // Skip TAB_SWITCH steps - they don't need AI analysis
    if (step.type === 'TAB_SWITCH' || !isWorkflowStepPayload(step.payload)) {
      return {
        action: {
          type: 'NAVIGATION' as const,
          url: 'tab-switch',
        },
        pageContext: {
          title: document.title,
          url: 'tab-switch',
        },
      };
    }

    const pageContext = this.buildPageContext(step);
    const payload: AIAnalysisPayload = {
      action: {
        type: step.type as 'INPUT' | 'CLICK' | 'KEYBOARD' | 'NAVIGATION' | 'SCROLL',
        url: step.payload.url,
      },
      pageContext: pageContext || {
        title: document.title,
        url: step.payload.url,
      },
    };

    // PRIORITY 1: Semantic Context (what AI cares about most)
    const semanticContext = this.buildSemanticContext(step);
    if (semanticContext && this.hasSemanticData(semanticContext)) {
      payload.semanticContext = semanticContext;
    }

    // PRIORITY 2: Element Context (simplified)
    const elementContext = this.buildElementContext(step);
    if (elementContext && this.hasElementData(elementContext)) {
      payload.elementContext = elementContext;
    }

    // PRIORITY 3: Flow Context (previous action, patterns)
    if (previousStep) {
      payload.flowContext = {
        previousAction: previousStep.type,
      };
    }

    // PRIORITY 4: Visual Snapshot (Phase 2 - for AI vision)
    // CRITICAL: visualSnapshot provides spatial context that coordinates cannot
    if (step.payload.visualSnapshot) {
      payload.visualSnapshot = {
        viewport: step.payload.visualSnapshot.viewport,
        elementSnippet: step.payload.visualSnapshot.elementSnippet,
        // Omit timestamp, viewportSize, elementBounds - coordinates are meaningless to text models
        // The screenshot itself provides all spatial context the AI needs
      };
    }

    // PRIORITY 5: Human-like Visual Understanding (Phase 4)
    // These provide AI with page context and visual prominence information
    
    // Page type classification
    if (step.payload.pageType) {
      payload.pageType = {
        type: step.payload.pageType.type,
        confidence: step.payload.pageType.confidence,
        subType: step.payload.pageType.subType,
      };
    }
    
    // Visual importance scores (helps AI understand element prominence)
    if (step.payload.visualImportance) {
      payload.visualImportance = {
        overallImportance: step.payload.visualImportance.overallImportance,
        // Only include overall score to minimize tokens
        // Full scores available in original payload if needed
      };
    }
    
    // Visual context (nearby elements for spatial understanding)
    if (step.payload.visualContext) {
      payload.visualContext = {
        visualPattern: step.payload.visualContext.visualPattern,
        regionType: step.payload.visualContext.regionType,
        // Nearby elements and landmarks available in original payload
      };
    }

    // EXPLICITLY EXCLUDED FROM AI PAYLOAD (to prevent token explosion):
    // - step.payload.fallbackSelectors: CSS selectors are noise for LLMs
    // - step.payload.context?.ancestors: Full DOM tree burns tokens
    // - step.payload.eventDetails: Coordinates (x, y) are meaningless
    // - step.payload.elementBounds: Bounding box coordinates are meaningless
    // - step.payload.timing: Performance data not needed for intent
    // - step.payload.html/outerHTML: Raw HTML causes context overflow
    // AI should rely on semantic anchors (gridCoordinates, label, visualSnapshot) instead

    return payload;
  }

  /**
   * Build AI-optimized payload for full workflow
   */
  static async buildWorkflowAnalysisPayload(
    workflow: SavedWorkflow,
    pattern?: import('../types/workflow').Pattern
  ): Promise<AIWorkflowPayload> {
    const steps = workflow.steps.map((step, index) => {
      const previousStep = index > 0 ? workflow.steps[index - 1] : undefined;
      return this.buildStepAnalysisPayload(step, previousStep);
    });

    const payload: AIWorkflowPayload = {
      workflow: {
        id: workflow.id,
        name: workflow.name,
        stepCount: workflow.steps.length,
      },
      steps,
    };

    // Add pattern if available
    if (pattern) {
      payload.pattern = {
        type: pattern.type,
        sequenceType: pattern.sequenceType,
        confidence: pattern.confidence,
      };
    }

    // Extract and optimize key screenshots for vision-based summary
    const keyScreenshots: { first?: string; last?: string } = {};

    // Get and optimize first step viewport
    const firstStep = workflow.steps[0];
    if (isWorkflowStepPayload(firstStep?.payload) && firstStep.payload.visualSnapshot?.viewport) {
      console.log('📸 AIDataBuilder: Optimizing first step screenshot for summary...');
      keyScreenshots.first = await this.optimizeScreenshotForSummary(
        firstStep.payload.visualSnapshot.viewport
      );
    }

    // Get and optimize last step viewport
    const lastStep = workflow.steps[workflow.steps.length - 1];
    if (isWorkflowStepPayload(lastStep?.payload) && lastStep.payload.visualSnapshot?.viewport) {
      console.log('📸 AIDataBuilder: Optimizing last step screenshot for summary...');
      keyScreenshots.last = await this.optimizeScreenshotForSummary(
        lastStep.payload.visualSnapshot.viewport
      );
    }

    // Add key screenshots if we have any
    if (keyScreenshots.first || keyScreenshots.last) {
      payload.keyScreenshots = keyScreenshots;
      console.log('📸 AIDataBuilder: Added optimized screenshots to payload');
    }

    return payload;
  }

  /**
   * Build semantic context (prioritized for AI understanding)
   */
  private static buildSemanticContext(step: WorkflowStep): SemanticContext | null {
    if (!isWorkflowStepPayload(step.payload)) {
      return null;
    }
    const context = step.payload.context;
    if (!context) {
      return null;
    }

    const semantic: SemanticContext = {};

    // PRIORITY: Grid coordinates (spreadsheets - highest priority)
    if (context.gridCoordinates) {
      semantic.gridCoordinates = {
        cellReference: context.gridCoordinates.cellReference,
        columnHeader: context.gridCoordinates.columnHeader,
        rowHeader: context.gridCoordinates.rowHeader,
        rowIndex: context.gridCoordinates.rowIndex,
        columnIndex: context.gridCoordinates.columnIndex,
        isHeader: context.gridCoordinates.isHeader,
      };
    }

    // PRIORITY: Form coordinates (forms - high priority)
    if (context.formCoordinates) {
      semantic.formCoordinates = {
        label: context.formCoordinates.label,
        fieldOrder: context.formCoordinates.fieldOrder,
        fieldset: context.formCoordinates.fieldset,
        section: context.formCoordinates.section,
      };
    }

    // Table coordinates
    if (context.tableCoordinates) {
      semantic.tableCoordinates = {
        rowIndex: context.tableCoordinates.rowIndex,
        columnIndex: context.tableCoordinates.columnIndex,
        headerRow: context.tableCoordinates.headerRow,
        headerColumn: context.tableCoordinates.headerColumn,
      };
    }

    // Decision space (dropdowns, lists)
    if (context.decisionSpace) {
      semantic.decisionSpace = {
        type: context.decisionSpace.type,
        options: context.decisionSpace.options,
        selectedIndex: context.decisionSpace.selectedIndex,
        selectedText: context.decisionSpace.selectedText,
        containerSelector: context.decisionSpace.containerSelector,
      };
    }

    // Button context (Interactive Section Anchoring - for generic div buttons in Salesforce/React)
    if (context.buttonContext) {
      semantic.buttonContext = {
        section: context.buttonContext.section,
        label: context.buttonContext.label,
        role: context.buttonContext.role,
      };
    }

    return semantic;
  }

  /**
   * Build element context (simplified for AI)
   */
  private static buildElementContext(step: WorkflowStep): ElementContext | null {
    if (!isWorkflowStepPayload(step.payload)) {
      return null;
    }
    const payload = step.payload;
    const context = payload.context;

    const elementContext: ElementContext = {};

    // Element text
    if (payload.elementText) {
      elementContext.text = payload.elementText;
    }

    // Label (for form fields)
    if (payload.label) {
      elementContext.label = payload.label;
    }

    // Value (for inputs)
    if (payload.value) {
      elementContext.value = payload.value;
    }

    // Role
    if (payload.elementRole) {
      elementContext.role = payload.elementRole;
    }

    // Container context (simplified)
    if (context?.container) {
      elementContext.container = {
        type: context.container.type,
        text: context.container.text,
      };
    }

    // Position
    if (context?.position) {
      elementContext.position = {
        index: context.position.index,
        total: context.position.total,
        type: context.position.type,
      };
    }

    // Surrounding text
    if (context?.surroundingText) {
      elementContext.surroundingText = context.surroundingText;
    }

    return elementContext;
  }

  /**
   * Build page context (simplified - removed coordinates)
   */
  private static buildPageContext(step: WorkflowStep): PageContext | undefined {
    if (!isWorkflowStepPayload(step.payload)) {
      return undefined;
    }
    return {
      title: document.title,
      url: step.payload.url,
      // scrollPosition removed - coordinates are meaningless to text models
      // viewport removed - dimensions are meaningless without visual context
    };
  }

  /**
   * Check if semantic context has meaningful data
   */
  private static hasSemanticData(context: SemanticContext): boolean {
    return !!(
      context.gridCoordinates ||
      context.formCoordinates ||
      context.tableCoordinates ||
      context.decisionSpace ||
      context.buttonContext
    );
  }

  /**
   * Check if element context has meaningful data
   */
  private static hasElementData(context: ElementContext): boolean {
    return !!(
      context.text ||
      context.label ||
      context.value ||
      context.role ||
      context.container ||
      context.position ||
      context.surroundingText
    );
  }

  /**
   * Optimize screenshot for summary generation
   * Resizes to max 1280px width and compresses to 75% JPEG quality
   * This reduces payload size while preserving text readability for AI
   */
  private static async optimizeScreenshotForSummary(base64: string): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(base64);
          return;
        }

        // Resize to max 1280px width (maintains aspect ratio)
        const maxWidth = 1280;
        let width = image.width;
        let height = image.height;

        if (width > maxWidth) {
          const scale = maxWidth / width;
          width = maxWidth;
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        // Compress to 75% JPEG quality (good for text readability)
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      image.onerror = () => resolve(base64);
      image.src = base64;
    });
  }
}

