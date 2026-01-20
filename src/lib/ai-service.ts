/**
 * AI Service - Client-side service that calls Supabase Edge Function for AI recovery
 * No direct Gemini API calls from client (all handled server-side)
 * Phase 4: Enhanced with page type, visual similarity, and correction memory
 */

import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { AIAnalysisPayload } from '../types/ai';
import type { FailureSnapshot } from './dom-distiller';
import type { PageType } from '../types/visual';
import { AIDataBuilder } from '../content/ai-data-builder';
import { DOMDistiller } from './dom-distiller';
import { PIIScrubber } from './pii-scrubber';
import { AICache } from './ai-cache';
import { aiConfig } from './ai-config';
import { CorrectionMemory } from './correction-memory';
import { UserContextStorage } from './user-context-storage';

export interface ElementFindingResult {
  candidateIndex?: number;
  selector?: string;
  confidence: number;
  reasoning: string;
}

export interface SelectorValidationResult {
  isStable: boolean;
  alternatives: string[];
  reasoning: string;
  confidence: number;
}

export interface StepDescriptionResult {
  description: string;
  confidence: number;
}

export class AIService {
  /**
   * Recover target element using AI (calls Supabase Edge Function)
   * Phase 4: Enhanced with page type context and correction learning
   */
  static async recoverTarget(
    step: WorkflowStep,
    doc: Document = document
  ): Promise<Element | null> {
    if (!aiConfig.isEnabled()) {
      console.log('GhostWriter: AI recovery disabled');
      return null;
    }

    try {
      // Step 1: Create failure snapshot with DOM Distiller (includes geometric filtering)
      const snapshot = DOMDistiller.createFailureSnapshot(step, doc);
      
      // Step 2: Scrub PII from snapshot
      const scrubbedSnapshot = PIIScrubber.scrubSnapshot(snapshot);
      
      // Step 3: Build AIAnalysisPayload using AIDataBuilder
      const aiPayload = AIDataBuilder.buildStepAnalysisPayload(step);
      
      // Step 4: Add failure snapshot context to payload (for Edge Function)
      // The Edge Function will use this to build the prompt
      const enhancedPayload: AIAnalysisPayload & { 
        failureSnapshot?: FailureSnapshot;
        pageTypeContext?: PageType;
        hasCorrectionHistory?: boolean;
      } = {
        ...aiPayload,
        failureSnapshot: scrubbedSnapshot,
      };
      
      // Skip TAB_SWITCH steps - they don't need AI recovery
      if (!isWorkflowStepPayload(step.payload)) {
        throw new Error('AI recovery not applicable for TAB_SWITCH steps');
      }
      
      // Phase 4: Add page type context for better AI understanding
      if (step.payload.pageType) {
        enhancedPayload.pageTypeContext = step.payload.pageType;
      }
      
      // Phase 4: Check if we have correction history for this type of step
      if (aiConfig.isCorrectionLearningEnabled()) {
        const corrections = await CorrectionMemory.findSimilarCorrections(step, 1);
        if (corrections.length > 0) {
          enhancedPayload.hasCorrectionHistory = true;
          console.log('GhostWriter: AI recovery has correction history context');
        }
      }
      
      // Generate cache key (including page type for better cache hits)
      const cacheKey = AICache.generateKey({
        selector: step.payload.selector,
        elementText: step.payload.elementText,
        label: step.payload.label,
        url: step.payload.url,
        visualSnapshot: step.payload.visualSnapshot ? 'has_snapshot' : 'no_snapshot',
        candidates: scrubbedSnapshot.candidates.length,
        pageType: step.payload.pageType?.type,
      });

      // Check local cache first
      const cachedResult = await AICache.getFromLocal(cacheKey);
      if (cachedResult) {
        console.log('GhostWriter: Using cached AI recovery result');
        return this.findElementFromResult(cachedResult, step, doc, scrubbedSnapshot.candidates);
      }

      // Call Supabase Edge Function
      const result = await this.callSupabaseFunction(enhancedPayload);
      
      // Cache the result
      await AICache.saveToLocal(cacheKey, result);
      
      // Find element from result
      return this.findElementFromResult(result, step, doc, scrubbedSnapshot.candidates);
    } catch (error) {
      console.warn('GhostWriter: AI recovery failed:', error);
      return null;
    }
  }

  /**
   * Call Supabase Edge Function
   */
  private static async callSupabaseFunction(
    payload: AIAnalysisPayload
  ): Promise<ElementFindingResult> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const url = `${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}`;
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseElementFindingResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`GhostWriter: AI recovery timeout after ${config.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse Supabase function response
   */
  private static parseElementFindingResponse(
    response: any
  ): ElementFindingResult {
    // Expected response format from Edge Function:
    // { candidateIndex?: number, selector?: string, confidence: number, reasoning: string }
    
    if (typeof response !== 'object' || response === null) {
      throw new Error('Invalid response format from Edge Function');
    }

    const result: ElementFindingResult = {
      confidence: typeof response.confidence === 'number' ? response.confidence : 0,
      reasoning: typeof response.reasoning === 'string' ? response.reasoning : '',
    };

    if (typeof response.candidateIndex === 'number') {
      result.candidateIndex = response.candidateIndex;
    }

    if (typeof response.selector === 'string') {
      result.selector = response.selector;
    }

    return result;
  }

  /**
   * Find element in DOM from AI result
   */
  private static findElementFromResult(
    result: ElementFindingResult,
    _step: WorkflowStep,
    doc: Document,
    candidates?: Array<{ selector: string; tag: string; text: string }>
  ): Element | null {
    // Try selector first (if provided)
    if (result.selector) {
      try {
        const element = doc.querySelector(result.selector);
        if (element) {
          return element;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    // Try candidate index (if provided and candidates available)
    if (result.candidateIndex !== undefined && candidates) {
      const candidate = candidates[result.candidateIndex];
      
      if (candidate) {
        try {
          const element = doc.querySelector(candidate.selector);
          if (element) {
            return element;
          }
        } catch (e) {
          // Invalid selector, continue
        }
      }
    }

    return null;
  }

  /**
   * Validate selector stability and get better alternatives (calls Supabase Edge Function)
   */
  static async validateSelector(
    selector: string,
    elementContext: string,
    pageContext: { title: string; url: string }
  ): Promise<SelectorValidationResult> {
    if (!aiConfig.isEnabled()) {
      console.log('GhostWriter: AI validation disabled');
      return {
        isStable: true,
        alternatives: [],
        reasoning: 'AI validation disabled',
        confidence: 0,
      };
    }

    try {
      // Generate cache key
      const cacheKey = AICache.generateKey({
        type: 'selector_validation',
        selector,
        elementContext: elementContext.substring(0, 200), // Truncate for cache key
        url: pageContext.url,
      });

      // Check local cache first
      const cachedResult = await AICache.getFromLocal(cacheKey);
      if (cachedResult) {
        console.log('GhostWriter: Using cached selector validation result');
        return cachedResult;
      }

      // Call Supabase Edge Function
      const result = await this.callValidateSelectorFunction(selector, elementContext, pageContext);
      
      // Cache the result
      await AICache.saveToLocal(cacheKey, result);
      
      return result;
    } catch (error) {
      console.warn('GhostWriter: Selector validation failed:', error);
      // Return stable result on error (fail gracefully)
      return {
        isStable: true,
        alternatives: [],
        reasoning: 'Validation failed, assuming stable',
        confidence: 0,
      };
    }
  }

  /**
   * Call Supabase Edge Function for selector validation
   */
  private static async callValidateSelectorFunction(
    selector: string,
    elementContext: string,
    pageContext: { title: string; url: string }
  ): Promise<SelectorValidationResult> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const validateSelectorFunctionName = config.validateSelectorEdgeFunctionName || 'validate_selector';
    const timeout = config.validateSelectorTimeout || 5000;
    const url = `${config.supabaseUrl}/functions/v1/${validateSelectorFunctionName}`;
    
    console.log(`🤖 GhostWriter: Calling validate_selector at ${url} (timeout: ${timeout}ms)`);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`🤖 GhostWriter: Request timeout after ${timeout}ms - Edge Function may not be deployed or is slow`);
      controller.abort();
    }, timeout);

    try {
      const fetchStartTime = performance.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          selector,
          elementContext,
          pageContext,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const fetchTime = performance.now() - fetchStartTime;
      console.log(`🤖 GhostWriter: Received response in ${fetchTime.toFixed(2)}ms, status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🤖 GhostWriter: Edge Function error ${response.status}:`, errorText);
        throw new Error(`Supabase Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseSelectorValidationResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`🤖 GhostWriter: Request aborted (timeout or network error). Check if Edge Function is deployed.`);
        throw new Error(`GhostWriter: Selector validation timeout after ${timeout}ms. Is the Edge Function deployed?`);
      }
      if (error instanceof Error && error.message.includes('Failed to fetch')) {
        console.error(`🤖 GhostWriter: Network error - Edge Function may not be deployed or URL is incorrect`);
      }
      throw error;
    }
  }

  /**
   * Parse Supabase function response for selector validation
   */
  private static parseSelectorValidationResponse(
    response: any
  ): SelectorValidationResult {
    if (typeof response !== 'object' || response === null) {
      throw new Error('Invalid response format from Edge Function');
    }

    return {
      isStable: typeof response.isStable === 'boolean' ? response.isStable : true,
      alternatives: Array.isArray(response.alternatives) ? response.alternatives : [],
      reasoning: typeof response.reasoning === 'string' ? response.reasoning : '',
      confidence: typeof response.confidence === 'number' ? response.confidence : 0,
    };
  }

  /**
   * Generate natural language description for a workflow step
   */
  static async generateStepDescription(
    step: WorkflowStep
  ): Promise<StepDescriptionResult> {
    if (!aiConfig.isEnabled()) {
      return {
        description: `${step.type} action`,
        confidence: 0,
      };
    }

    // Skip TAB_SWITCH steps - they don't need AI description generation
    if (!isWorkflowStepPayload(step.payload)) {
      return {
        description: `Switch to tab`,
        confidence: 1,
      };
    }

    // FAST PATH: Skip AI for spreadsheet INPUT steps - use simple template instead
    if (step.type === 'INPUT') {
      const payload = step.payload;
      const cellRef = payload.spreadsheetContext?.recordedIntent?.cellRef || 
                     payload.context?.gridCoordinates?.cellReference;
      
      if (cellRef) {
        // Use simple template for spreadsheet cells - no AI needed!
        const description = `Enter "${payload.value}" into cell ${cellRef}`;
        console.log(`[AIService] 📊 Skipping AI for spreadsheet INPUT (cell ${cellRef}) - using template`);
        return {
          description,
          confidence: 1,
        };
      }
    }

    try {
      // Generate cache key (include visual snapshot hash to differentiate similar steps)
      // CRITICAL: Include decisionSpace selectedText and selectedIndex to differentiate dropdown items
      // Also include elementText to differentiate similar elements
      // IMPORTANT: For widget clicks, use more of the visual snapshot to differentiate between different widgets
      // Use first 500 chars of snapshot (instead of 200) to better differentiate widgets with similar selectors
      const snapshotHash = step.payload.visualSnapshot?.elementSnippet?.substring(0, 500) || 
                          step.payload.visualSnapshot?.viewport?.substring(0, 500);
      
      // Include clipboard metadata in cache key for copy/paste operations
      // This ensures different copy/paste operations get different descriptions
      const clipboardMetadata = step.payload.aiEvidence?.clipboardMetadata;
      const clipboardValue = clipboardMetadata?.copiedValue ? 
        clipboardMetadata.copiedValue.substring(0, 100) : // Use first 100 chars for cache key
        undefined;
      
      const cacheKey = AICache.generateKey({
        type: 'step_description',
        stepType: step.type,
        selector: step.payload.selector,
        label: step.payload.label,
        value: step.payload.value,
        elementText: step.payload.elementText,
        url: step.payload.url,
        selectedText: step.payload.context?.decisionSpace?.selectedText,
        selectedIndex: step.payload.context?.decisionSpace?.selectedIndex,
        containerText: step.payload.context?.container?.text, // Include container context in cache key
        snapshotHash: snapshotHash, // Use 500 chars for better widget differentiation
        // Include element bounds to differentiate widgets at different positions
        elementBounds: step.payload.elementBounds ? 
          `${step.payload.elementBounds.x},${step.payload.elementBounds.y},${step.payload.elementBounds.width},${step.payload.elementBounds.height}` : 
          undefined,
        // Include clipboard metadata to differentiate copy/paste operations
        clipboardValue: clipboardValue,
        keyboardKey: step.payload.keyboardDetails?.key,
        keyboardModifiers: step.payload.keyboardDetails?.modifiers,
      });

      // Check local cache first
      // CRITICAL: For widget clicks with visual snapshots but NO decisionSpace (not menu items),
      // skip cache to ensure each widget gets a fresh description based on its visual snapshot
      // Widget clicks with the same selector pattern but different visual snapshots should NOT share cache
      const hasVisualSnapshot = !!step.payload.visualSnapshot?.elementSnippet;
      const hasDecisionSpace = !!step.payload.context?.decisionSpace;
      const isWidgetClick = step.payload.selector?.includes('gs-report-widget-element') || 
                           step.payload.selector?.includes('widget-element');
      
      // Skip cache for copy/paste operations - they should always get fresh descriptions based on clipboard content
      const isCopyPasteOperation = step.type === 'KEYBOARD' && 
        ((step.payload.keyboardDetails?.key?.toLowerCase() === 'c' && 
          (step.payload.keyboardDetails?.modifiers?.ctrl || step.payload.keyboardDetails?.modifiers?.meta)) ||
         (step.payload.keyboardDetails?.key?.toLowerCase() === 'v' && 
          (step.payload.keyboardDetails?.modifiers?.ctrl || step.payload.keyboardDetails?.modifiers?.meta)));
      
      if (isCopyPasteOperation) {
        console.log('GhostWriter: Skipping cache for copy/paste operation (will analyze fresh based on clipboard content)');
        // Don't check cache - go straight to AI analysis to get semantic description
      } else if (hasVisualSnapshot && isWidgetClick && !hasDecisionSpace) {
        console.log('GhostWriter: Skipping cache for widget click with visual snapshot (will analyze fresh to identify specific widget)');
        // Don't check cache - go straight to AI analysis
      } else {
        // For menu items (with decisionSpace) or non-widget clicks, use cache normally
        const cachedResult = await AICache.getFromLocal(cacheKey);
        if (cachedResult) {
          console.log('GhostWriter: Using cached step description');
          return cachedResult as StepDescriptionResult;
        }
      }

      // Call Supabase Edge Function
      const result = await this.callGenerateDescriptionFunction(step);

      // Cache the result
      await AICache.saveToLocal(cacheKey, result);

      return result;
    } catch (error) {
      console.warn('GhostWriter: Step description generation failed:', error);
      // Return fallback description
      return {
        description: this.generateFallbackDescription(step),
        confidence: 0,
      };
    }
  }

  /**
   * Call Supabase Edge Function for step description generation
   */
  private static async callGenerateDescriptionFunction(
    step: WorkflowStep
  ): Promise<StepDescriptionResult> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const functionName = 'generate_step_description';
    const timeout = config.timeout || 10000;
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
    
    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('Description generation not applicable for TAB_SWITCH steps');
    }
    
    console.log(`🤖 GhostWriter: Generating description for ${step.type} step...`);
    console.log(`🤖 GhostWriter: Has visual snapshot:`, !!step.payload.visualSnapshot?.elementSnippet);
    console.log(`🤖 GhostWriter: Has decisionSpace:`, !!step.payload.context?.decisionSpace);
    console.log(`🤖 GhostWriter: Element text:`, step.payload.elementText);
    console.log(`🤖 GhostWriter: Label:`, step.payload.label);
    console.log(`🤖 GhostWriter: Container context:`, step.payload.context?.container?.text || 'NONE');
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`🤖 GhostWriter: Description generation timeout after ${timeout}ms`);
      controller.abort();
    }, timeout);

    try {
      const fetchStartTime = performance.now();
      const userContext = await UserContextStorage.getUserContext();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ step, userContext: userContext || undefined }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const fetchTime = performance.now() - fetchStartTime;
      console.log(`🤖 GhostWriter: Description received in ${fetchTime.toFixed(2)}ms, status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🤖 GhostWriter: Edge Function error ${response.status}:`, errorText);
        throw new Error(`Supabase Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseDescriptionResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`GhostWriter: Description generation timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse Supabase function response for step description
   */
  private static parseDescriptionResponse(
    response: any
  ): StepDescriptionResult {
    if (typeof response !== 'object' || response === null) {
      throw new Error('Invalid response format from Edge Function');
    }

    return {
      description: typeof response.description === 'string' ? response.description : '',
      confidence: typeof response.confidence === 'number' ? response.confidence : 0,
    };
  }

  /**
   * Generate fallback description when AI fails
   * Returns concise, relevant descriptions (max 50 chars)
   */
  private static generateFallbackDescription(step: WorkflowStep): string {
    if (!isWorkflowStepPayload(step.payload)) {
      return `Switch to tab`;
    }
    
    switch (step.type) {
      case 'CLICK':
        // Priority 1: Use button context if available (most specific)
        if (step.payload.context?.buttonContext?.label) {
          const label = step.payload.context.buttonContext.label;
          return label.length > 40 ? label.substring(0, 40) + '...' : `Click "${label}"`;
        }
        
        // Priority 2: Use decision space (dropdown selection)
        if (step.payload.context?.decisionSpace?.selectedText) {
          const selected = step.payload.context.decisionSpace.selectedText;
          return selected.length > 40 ? selected.substring(0, 40) + '...' : `Select "${selected}"`;
        }
        
        // Priority 3: Use label
        if (step.payload.label) {
          const label = step.payload.label;
          return label.length > 40 ? label.substring(0, 40) + '...' : `Click "${label}"`;
        }
        
        // Priority 4: Use element text (but limit to 40 chars)
        if (step.payload.elementText) {
          const text = step.payload.elementText;
          return text.length > 40 ? text.substring(0, 40) + '...' : `Click "${text}"`;
        }
        
        // Priority 5: Use container context (combine with element text if available)
        if (step.payload.context?.container?.text) {
          const containerText = step.payload.context.container.text;
          const elementText = step.payload.elementText;
          
          if (elementText && elementText.length <= 30) {
            // Combine: "Click [element] in [container]"
            const combined = `Click "${elementText}" in ${containerText}`;
            return combined.length > 50 ? combined.substring(0, 47) + '...' : combined;
          } else if (containerText.length <= 40) {
            return `Click in "${containerText}"`;
          }
        }
        
        // Last resort: at least mention it's a click action
        return step.payload.elementText 
          ? `Click "${step.payload.elementText.substring(0, 30)}"`
          : 'Click element';
      case 'INPUT':
        const value = step.payload.value || '';
        const valuePreview = value.length > 20 ? value.substring(0, 20) + '...' : value;
        
        if (step.payload.label) {
          const label = step.payload.label.length > 20 
            ? step.payload.label.substring(0, 20) + '...' 
            : step.payload.label;
          return `Enter "${valuePreview}" in "${label}"`;
        }
        
        if (step.payload.context?.formCoordinates?.label) {
          const fieldLabel = step.payload.context.formCoordinates.label;
          const label = fieldLabel.length > 20 
            ? fieldLabel.substring(0, 20) + '...' 
            : fieldLabel;
          return `Enter "${valuePreview}" in "${label}"`;
        }
        
        return value ? `Enter "${valuePreview}"` : 'Enter value';
      case 'NAVIGATION':
        try {
          const url = new URL(step.payload.url || '');
          const path = url.pathname.split('/').filter(p => p).pop() || url.hostname;
          return path.length > 40 ? path.substring(0, 40) + '...' : `Navigate to ${path}`;
        } catch {
          return 'Navigate';
        }
      case 'KEYBOARD':
        const key = step.payload.keyboardDetails?.key || 'key';
        return `Press ${key}`;
      case 'SCROLL':
        const scrollX = step.payload.viewport?.scrollX || 0;
        const scrollY = step.payload.viewport?.scrollY || 0;
        if (scrollY > 0) {
          return `Scroll down to position ${Math.round(scrollY)}`;
        } else if (scrollX > 0) {
          return `Scroll right to position ${Math.round(scrollX)}`;
        }
        return 'Scroll';
      default:
        return `${step.type} action`;
    }
  }
}
