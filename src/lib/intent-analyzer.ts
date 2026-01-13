/**
 * Intent Analyzer - Understands user intent from recorded workflows
 * Analyzes full workflow to infer goals, sub-tasks, and expected outcomes
 */

import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { AICache } from './ai-cache';
import { aiConfig } from './ai-config';
import { AIDataBuilder } from '../content/ai-data-builder';

export interface StepTranslation {
  stepIndex: number;
  intent: string;
  precondition: string;
  expectedOutcome: string;
  dependencies: number[];
}

export interface AnalyzedIntent {
  primaryGoal: string;
  subGoals: string[];
  expectedOutcome: string;
  visualConfirmation?: string;
  confidence: number;
  failurePatterns?: Array<{
    description: string;
    visualIndicator?: string;
    recovery?: string;
  }>;
  stepTranslations?: StepTranslation[];
}

export interface IntentAnalysisResult {
  intent: AnalyzedIntent;
  suggestions?: string[];
  confidence: number;
}

export class IntentAnalyzer {
  /**
   * Analyze workflow to understand user intent
   */
  static async analyzeWorkflowIntent(
    workflow: SavedWorkflow
  ): Promise<IntentAnalysisResult | null> {
    if (!aiConfig.isEnabled()) {
      console.log('🎯 GhostWriter: Intent analysis disabled');
      return null;
    }

    try {
      // Generate cache key
      const cacheKey = AICache.generateKey({
        type: 'workflow_intent',
        workflowId: workflow.id,
        stepCount: workflow.steps.length,
        firstStepUrl: (workflow.steps[0] && isWorkflowStepPayload(workflow.steps[0].payload)) ? workflow.steps[0].payload.url : undefined,
        lastStepType: workflow.steps[workflow.steps.length - 1]?.type,
      });

      // Check cache first
      const cached = await AICache.getFromLocal(cacheKey);
      if (cached) {
        console.log('🎯 GhostWriter: Using cached intent analysis');
        return cached as IntentAnalysisResult;
      }

      // Build AI payload (now async to optimize screenshots)
      const aiPayload = await AIDataBuilder.buildWorkflowAnalysisPayload(workflow);

      // Call Edge Function
      const result = await this.callAnalyzeIntentFunction(workflow, aiPayload);

      // Cache result (30 minute TTL)
      await AICache.saveToLocal(cacheKey, result, 30 * 60 * 1000);

      return result;
    } catch (error) {
      console.warn('🎯 GhostWriter: Intent analysis failed:', error);
      // Return fallback analysis
      return this.createFallbackAnalysis(workflow);
    }
  }

  /**
   * Quick local intent analysis (no API call)
   * Used for real-time feedback during recording
   */
  static analyzeIntentLocally(steps: WorkflowStep[]): AnalyzedIntent {
    if (steps.length === 0) {
      return {
        primaryGoal: 'Unknown goal',
        subGoals: [],
        expectedOutcome: 'Workflow not yet started',
        confidence: 0,
      };
    }

    // Analyze step types
    const stepTypes = steps.map(s => s.type);
    const hasNavigation = stepTypes.includes('NAVIGATION');
    const hasInput = stepTypes.includes('INPUT');
    const hasClick = stepTypes.includes('CLICK');
    
    // Count input steps
    const inputCount = stepTypes.filter(t => t === 'INPUT').length;
    const clickCount = stepTypes.filter(t => t === 'CLICK').length;

    // Infer primary goal based on patterns
    let primaryGoal = 'Perform browser interactions';
    let expectedOutcome = 'Complete the recorded steps';
    const subGoals: string[] = [];

    // Form filling pattern
    if (inputCount >= 2 && hasClick) {
      primaryGoal = 'Fill out a form';
      expectedOutcome = 'Form submitted successfully';
      
      // Extract field labels as sub-goals
      steps.forEach(step => {
        if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload) && step.payload.label) {
          subGoals.push(`Enter ${step.payload.label}`);
        }
      });
      
      if (hasClick) {
        subGoals.push('Submit the form');
      }
    }
    
    // Data entry pattern (spreadsheet)
    else if (inputCount >= 1 && steps.some(s => isWorkflowStepPayload(s.payload) && s.payload.context?.gridCoordinates)) {
      primaryGoal = 'Enter data into spreadsheet';
      expectedOutcome = 'Data saved in cells';
      
      steps.forEach(step => {
        if (step.type === 'INPUT' && isWorkflowStepPayload(step.payload) && step.payload.context?.gridCoordinates) {
          const cell = step.payload.context.gridCoordinates.cellReference;
          subGoals.push(`Enter data in cell ${cell || 'unknown'}`);
        }
      });
    }
    
    // Navigation + action pattern
    else if (hasNavigation && (hasClick || hasInput)) {
      primaryGoal = 'Navigate and interact with website';
      expectedOutcome = 'Complete the interaction flow';
      
      if (hasNavigation) subGoals.push('Navigate to target page');
      if (hasClick) subGoals.push('Click on target elements');
      if (hasInput) subGoals.push('Enter required information');
    }
    
    // Selection pattern
    else if (clickCount >= 2 && steps.some(s => isWorkflowStepPayload(s.payload) && s.payload.context?.decisionSpace)) {
      primaryGoal = 'Select options from menus';
      expectedOutcome = 'Options selected successfully';
      
      steps.forEach(step => {
        if (isWorkflowStepPayload(step.payload) && step.payload.context?.decisionSpace) {
          subGoals.push(`Select "${step.payload.context.decisionSpace.selectedText}"`);
        }
      });
    }

    return {
      primaryGoal,
      subGoals: subGoals.slice(0, 5), // Limit to 5 sub-goals
      expectedOutcome,
      confidence: 0.6, // Local analysis has lower confidence
    };
  }

  /**
   * Identify sub-goals from workflow steps
   */
  static identifySubGoals(steps: WorkflowStep[]): string[] {
    const subGoals: string[] = [];

    for (const step of steps) {
      const description = step.description || this.generateStepDescription(step);
      if (description && !subGoals.includes(description)) {
        subGoals.push(description);
      }
    }

    return subGoals.slice(0, 10); // Limit to 10 sub-goals
  }

  /**
   * Predict expected outcome based on workflow pattern
   */
  static predictExpectedOutcome(steps: WorkflowStep[]): string {
    if (steps.length === 0) return 'No outcome expected';

    const lastStep = steps[steps.length - 1];
    
    // Check for form submission patterns
    const hasSubmitButton = steps.some(s => 
      s.type === 'CLICK' && 
      isWorkflowStepPayload(s.payload) &&
      (s.payload.elementText?.toLowerCase().includes('submit') ||
       s.payload.elementText?.toLowerCase().includes('save') ||
       s.payload.elementText?.toLowerCase().includes('send') ||
       s.payload.elementText?.toLowerCase().includes('confirm'))
    );
    
    if (hasSubmitButton) {
      return 'Form submitted and confirmation displayed';
    }

    // Check for navigation patterns
    if (lastStep.type === 'NAVIGATION') {
      return 'New page loaded with expected content';
    }

    // Check for selection patterns
    if (isWorkflowStepPayload(lastStep.payload) && lastStep.payload.context?.decisionSpace) {
      return 'Selection applied and UI updated';
    }

    // Default
    return 'Workflow completed successfully';
  }

  /**
   * Detect common failure patterns for a workflow
   */
  static detectFailurePatterns(steps: WorkflowStep[]): Array<{
    description: string;
    visualIndicator?: string;
    recovery?: string;
  }> {
    const patterns: Array<{
      description: string;
      visualIndicator?: string;
      recovery?: string;
    }> = [];

    // Check for form inputs
    const hasFormInputs = steps.some(s => 
      s.type === 'INPUT' && isWorkflowStepPayload(s.payload) && s.payload.context?.formCoordinates
    );
    
    if (hasFormInputs) {
      patterns.push({
        description: 'Form validation error',
        visualIndicator: 'Red error message near form fields',
        recovery: 'Check field values and try again',
      });
    }

    // Check for button clicks
    const hasButtonClicks = steps.some(s => 
      s.type === 'CLICK' && 
      isWorkflowStepPayload(s.payload) &&
      (s.payload.elementRole === 'button' || s.payload.context?.buttonContext)
    );
    
    if (hasButtonClicks) {
      patterns.push({
        description: 'Button not found or disabled',
        visualIndicator: 'Button appears grayed out or missing',
        recovery: 'Wait for page to load completely or check if logged in',
      });
    }

    // Check for dropdown selections
    const hasDropdowns = steps.some(s => isWorkflowStepPayload(s.payload) && s.payload.context?.decisionSpace);
    
    if (hasDropdowns) {
      patterns.push({
        description: 'Dropdown option not available',
        visualIndicator: 'Dropdown shows different options than expected',
        recovery: 'Verify data has not changed and options are still valid',
      });
    }

    // Check for navigation
    const hasNavigation = steps.some(s => s.type === 'NAVIGATION');
    
    if (hasNavigation) {
      patterns.push({
        description: 'Page not loading or timeout',
        visualIndicator: 'Page shows loading spinner or error',
        recovery: 'Check network connection and try refreshing',
      });
    }

    return patterns;
  }

  /**
   * Call analyze_intent Edge Function
   */
  private static async callAnalyzeIntentFunction(
    workflow: SavedWorkflow,
    aiPayload: import('../types/ai').AIWorkflowPayload
  ): Promise<IntentAnalysisResult> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const functionName = config.analyzeIntentEdgeFunctionName || 'analyze_intent';
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
    const timeout = config.visualAnalysisTimeout || 20000;

    console.log(`🎯 GhostWriter: Analyzing intent for workflow "${workflow.name}"...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          workflow: {
            id: workflow.id,
            name: workflow.name,
            stepCount: workflow.steps.length,
          },
          steps: aiPayload.steps,
          pattern: aiPayload.pattern,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseIntentResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Intent analysis timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse intent analysis response
   */
  private static parseIntentResponse(response: any): IntentAnalysisResult {
    return {
      intent: {
        primaryGoal: response.intent?.primaryGoal || 'Unknown goal',
        subGoals: Array.isArray(response.intent?.subGoals) ? response.intent.subGoals : [],
        expectedOutcome: response.intent?.expectedOutcome || 'Unknown outcome',
        visualConfirmation: response.intent?.visualConfirmation,
        confidence: typeof response.intent?.confidence === 'number' ? response.intent.confidence : 0,
        failurePatterns: Array.isArray(response.intent?.failurePatterns) 
          ? response.intent.failurePatterns 
          : [],
        stepTranslations: Array.isArray(response.intent?.stepTranslations)
          ? response.intent.stepTranslations
          : [],
      },
      suggestions: Array.isArray(response.suggestions) ? response.suggestions : [],
      confidence: typeof response.confidence === 'number' ? response.confidence : 0,
    };
  }

  /**
   * Create fallback analysis when API fails
   */
  private static createFallbackAnalysis(workflow: SavedWorkflow): IntentAnalysisResult {
    const localAnalysis = this.analyzeIntentLocally(workflow.steps);
    const failurePatterns = this.detectFailurePatterns(workflow.steps);

    return {
      intent: {
        ...localAnalysis,
        failurePatterns,
      },
      suggestions: [
        'Consider adding wait conditions between steps',
        'Record on a stable page state for better reliability',
      ],
      confidence: 0.5,
    };
  }

  /**
   * Generate step description locally
   */
  private static generateStepDescription(step: WorkflowStep): string {
    switch (step.type) {
      case 'TAB_SWITCH':
        return 'Switch to different tab';
      case 'CLICK':
        if (isWorkflowStepPayload(step.payload)) {
          const clickText = step.payload.elementText || step.payload.label || 'element';
          return `Click "${clickText.substring(0, 30)}"`;
        }
        return 'Click element';
      case 'INPUT':
        if (isWorkflowStepPayload(step.payload)) {
          const inputLabel = step.payload.label || 'field';
          return `Enter value in "${inputLabel.substring(0, 30)}"`;
        }
        return 'Enter value';
      case 'NAVIGATION':
        return 'Navigate to page';
      case 'KEYBOARD':
        if (isWorkflowStepPayload(step.payload)) {
          return `Press ${step.payload.keyboardDetails?.key || 'key'}`;
        }
        return 'Press key';
      case 'SCROLL':
        return 'Scroll page';
      default:
        return `${step.type} action`;
    }
  }

  /**
   * Format analyzed intent into a human-readable summary string
   */
  static formatIntentAsSummary(intent: AnalyzedIntent): string {
    const parts: string[] = [];
    
    // Primary goal
    parts.push(intent.primaryGoal);
    
    // Add sub-goals if available (limit to 3 for brevity)
    if (intent.subGoals && intent.subGoals.length > 0) {
      const topSubGoals = intent.subGoals.slice(0, 3);
      parts.push(`Steps: ${topSubGoals.join(', ')}`);
      
      if (intent.subGoals.length > 3) {
        parts.push(`... and ${intent.subGoals.length - 3} more`);
      }
    }
    
    // Expected outcome
    if (intent.expectedOutcome && intent.expectedOutcome !== 'Unknown outcome') {
      parts.push(`Expected result: ${intent.expectedOutcome}`);
    }
    
    return parts.join('. ') + '.';
  }
}


