/**
 * Smart Input Handler
 * 
 * Combines Parametric Replay and Data Transformation into a single AI call
 * to minimize latency (one round trip instead of two per INPUT step).
 * 
 * Features:
 * - Smart variable interpolation (adapts interaction method if needed)
 * - Data format transformation (splits names, converts dates, etc.)
 */

import { aiConfig } from './ai-config';
import { AICache } from './ai-cache';
import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

export interface SmartInputResult {
  transformedValue: string;
  interactionMethod: 'type' | 'select' | 'click' | 'auto';
  confidence: number;
  reasoning: string;
  needsTransformation: boolean;
}

export class AISmartInput {
  /**
   * Process input value with AI (parametric replay + data transformation)
   * Returns both the transformed value and interaction method in one call
   * 
   * @param step - The workflow step being executed
   * @param newValue - The new variable value (or original if no variable)
   * @returns Smart input result with transformed value and interaction method
   */
  static async processInput(
    step: WorkflowStep,
    newValue: string
  ): Promise<SmartInputResult> {
    if (!aiConfig.isEnabled()) {
      // Return original value without transformation
      return {
        transformedValue: newValue,
        interactionMethod: 'type',
        confidence: 1,
        reasoning: 'AI disabled',
        needsTransformation: false,
      };
    }

    // Skip AI call if step is not INPUT
    if (step.type !== 'INPUT') {
      return {
        transformedValue: newValue,
        interactionMethod: 'type',
        confidence: 1,
        reasoning: 'Not an INPUT step',
        needsTransformation: false,
      };
    }

    if (!isWorkflowStepPayload(step.payload)) {
      return {
        transformedValue: newValue,
        interactionMethod: 'type',
        confidence: 1,
        reasoning: 'Invalid step payload',
        needsTransformation: false,
      };
    }

    const originalValue = step.payload.value || '';
    
    // Performance optimization: Skip AI if new value === original value
    if (newValue === originalValue) {
      return {
        transformedValue: newValue,
        interactionMethod: 'type',
        confidence: 1,
        reasoning: 'No change from original value',
        needsTransformation: false,
      };
    }

    // Check cache first
    const cacheKey = AICache.generateKey({
      type: 'smart_input',
      stepId: String(step.payload.timestamp),
      originalValue,
      newValue,
      fieldType: step.payload.inputDetails?.type,
      label: step.payload.label,
    });

    const cachedResult = await AICache.getFromLocal(cacheKey);
    if (cachedResult) {
      console.log('[AISmartInput] Using cached result');
      return cachedResult as SmartInputResult;
    }

    try {
      // Call Edge Function
      const result = await this.callEdgeFunction(step, newValue, originalValue);
      
      // Cache the result
      await AICache.saveToLocal(cacheKey, result);
      
      return result;
    } catch (error) {
      console.warn('[AISmartInput] AI processing failed, using original value:', error);
      // Fallback: return original value without transformation
      return {
        transformedValue: newValue,
        interactionMethod: 'type',
        confidence: 0,
        reasoning: `AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        needsTransformation: false,
      };
    }
  }

  /**
   * Call Supabase Edge Function for smart input processing
   */
  private static async callEdgeFunction(
    step: WorkflowStep,
    newValue: string,
    originalValue: string
  ): Promise<SmartInputResult> {
    if (!isWorkflowStepPayload(step.payload)) {
      throw new Error('Invalid step payload');
    }

    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    const functionName = 'smart_input_handler';
    const timeout = config.timeout || 10000;
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[AISmartInput] Request timeout after ${timeout}ms`);
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          step: {
            type: step.type,
            payload: {
              selector: step.payload.selector,
              value: originalValue,
              label: step.payload.label,
              inputType: step.payload.inputDetails?.type,
              elementText: step.payload.elementText,
              visualSnapshot: step.payload.visualSnapshot,
              context: step.payload.context,
            },
          },
          originalValue,
          newValue,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Smart input processing timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse Edge Function response
   */
  private static parseResponse(response: any): SmartInputResult {
    if (typeof response !== 'object' || response === null) {
      throw new Error('Invalid response format from Edge Function');
    }

    return {
      transformedValue: typeof response.transformedValue === 'string' 
        ? response.transformedValue 
        : response.newValue || '',
      interactionMethod: ['type', 'select', 'click', 'auto'].includes(response.interactionMethod)
        ? response.interactionMethod
        : 'auto',
      confidence: typeof response.confidence === 'number' ? response.confidence : 0.5,
      reasoning: typeof response.reasoning === 'string' ? response.reasoning : '',
      needsTransformation: typeof response.needsTransformation === 'boolean'
        ? response.needsTransformation
        : response.transformedValue !== response.newValue,
    };
  }
}







