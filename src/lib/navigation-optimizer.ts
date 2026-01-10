/**
 * Navigation Optimizer - Analyzes and optimizes workflows by detecting unnecessary navigation steps
 * 
 * Uses a hybrid approach combining rule-based classification with AI-powered analysis
 * to identify multi-step navigation sequences that can be replaced with direct URL navigation.
 */

import type { WorkflowStep, WorkflowStepPayload, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import { aiConfig } from './ai-config';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Classification result for a single step
 */
export type StepClassification = 'necessary' | 'optimizable' | 'uncertain';

/**
 * Decision method used for classification
 */
export type DecisionMethod = 'rule-based' | 'ai-powered' | 'hybrid';

/**
 * Represents a sequence of steps that ends in a URL change
 */
export interface NavigationSequence {
  /** Index of first step in the sequence (in original workflow) */
  startIndex: number;
  /** Index of last step in the sequence (in original workflow) */
  endIndex: number;
  /** URL at the start of the sequence */
  startUrl: string;
  /** URL at the end of the sequence (destination) */
  endUrl: string;
  /** Steps in this sequence */
  steps: WorkflowStep[];
  /** Whether this sequence can be optimized (replaced with direct navigation) */
  canOptimize: boolean;
  /** Indices of steps that cannot be removed (relative to sequence start) */
  necessarySteps: number[];
  /** Classification details for each step */
  stepClassifications: StepClassificationResult[];
}

/**
 * Classification result for a single step
 */
export interface StepClassificationResult {
  /** Index in the original workflow */
  stepIndex: number;
  /** Whether this step is necessary (cannot be removed) */
  isNecessary: boolean;
  /** Classification category */
  classification: StepClassification;
  /** Confidence score (0-1), only relevant for AI classifications */
  confidence: number;
  /** Reason for the classification */
  reasoning: string;
  /** How the classification was determined */
  decisionMethod: DecisionMethod;
}

/**
 * Input for AI analysis of uncertain steps
 */
export interface AIAnalysisInput {
  sequence: {
    startUrl: string;
    endUrl: string;
    stepCount: number;
  };
  steps: Array<{
    type: string;
    elementText?: string;
    label?: string;
    url: string;
    formContext?: any;
    inputDetails?: any;
    hasClipboardData: boolean;
    ruleBasedClassification: StepClassification;
    stepIndex: number;
  }>;
}

/**
 * Output from AI analysis
 */
export interface AIAnalysisOutput {
  stepClassifications: Array<{
    stepIndex: number;
    isNecessary: boolean;
    confidence: number;
    reasoning: string;
  }>;
  overallRecommendation: 'optimize' | 'keep' | 'partial';
}

/**
 * Optimization options
 */
export interface OptimizationOptions {
  /** Whether to use AI for uncertain step classification */
  useAI?: boolean;
  /** Minimum AI confidence to trust the classification (0-1) */
  aiConfidenceThreshold?: number;
}

/**
 * Metadata about an optimization decision
 */
export interface OptimizationMapEntry {
  /** Indices of original steps that were optimized */
  originalIndices: number[];
  /** Index in the optimized workflow (-1 if removed entirely) */
  optimizedIndex: number;
  /** Reason for the optimization */
  reason: string;
  /** How the decision was made */
  decisionMethod: DecisionMethod;
  /** AI confidence if AI was used */
  aiConfidence?: number;
}

/**
 * Metadata about the optimization process
 */
export interface OptimizationMetadata {
  /** When the analysis was performed */
  analyzedAt: number;
  /** Number of navigation sequences found */
  sequencesFound: number;
  /** Number of sequences that were optimized */
  sequencesOptimized: number;
  /** Total number of steps removed */
  stepsRemoved: number;
  /** Whether AI analysis was used */
  aiAnalysisUsed: boolean;
  /** Average AI confidence (if AI was used) */
  aiConfidenceAvg?: number;
  /** Detailed optimization map */
  optimizationMap: OptimizationMapEntry[];
}

/**
 * Result of workflow optimization
 */
export interface OptimizationResult {
  /** Optimized workflow steps */
  optimizedSteps: WorkflowStep[];
  /** Metadata about the optimization */
  metadata: OptimizationMetadata;
}

// ============================================================================
// Navigation Optimizer Class
// ============================================================================

export class NavigationOptimizer {
  private readonly defaultOptions: Required<OptimizationOptions> = {
    useAI: true,
    aiConfidenceThreshold: 0.7,
  };

  /**
   * Optimize a workflow by detecting and replacing unnecessary navigation steps
   */
  async optimizeWorkflow(
    workflow: SavedWorkflow,
    options?: OptimizationOptions
  ): Promise<OptimizationResult> {
    const opts = { ...this.defaultOptions, ...options };
    const steps = workflow.steps;
    
    console.log(`🔧 NavigationOptimizer: Analyzing workflow with ${steps.length} steps`);

    // Step 1: Detect navigation sequences
    const sequences = this.detectNavigationSequences(steps);
    console.log(`🔧 NavigationOptimizer: Found ${sequences.length} navigation sequences`);

    // Step 2: Classify steps in each sequence
    const classifiedSequences = await this.classifySequences(sequences, steps, opts);

    // Step 3: Generate optimized workflow
    const result = this.generateOptimizedWorkflow(steps, classifiedSequences, opts);

    console.log(`🔧 NavigationOptimizer: Navigation optimization complete - ${result.metadata.stepsRemoved} steps removed`);
    
    // Step 4: Consolidate duplicate INPUT and SCROLL steps
    const consolidatedResult = this.consolidateDuplicateSteps(result.optimizedSteps, result.metadata.optimizationMap);
    
    console.log(`🔧 NavigationOptimizer: Total optimization complete - ${consolidatedResult.metadata.stepsRemoved} steps removed (${result.optimizedSteps.length} → ${consolidatedResult.optimizedSteps.length})`);
    
    return consolidatedResult;
  }

  // ============================================================================
  // Sequence Detection
  // ============================================================================

  /**
   * Detect sequences of steps that end in a URL change
   */
  private detectNavigationSequences(steps: WorkflowStep[]): NavigationSequence[] {
    const sequences: NavigationSequence[] = [];
    let currentSequence: {
      startIndex: number;
      startUrl: string;
      steps: WorkflowStep[];
    } | null = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const payload = step.payload;

      // Skip TAB_SWITCH steps for sequence detection
      if (!isWorkflowStepPayload(payload)) {
        // If we have a current sequence, finalize it
        if (currentSequence) {
          // No URL change detected, this sequence doesn't end in navigation
          currentSequence = null;
        }
        continue;
      }

      const currentUrl = payload.url;

      // Start a new sequence if we don't have one
      if (!currentSequence) {
        currentSequence = {
          startIndex: i,
          startUrl: currentUrl,
          steps: [step],
        };
        continue;
      }

      // Check if this step causes a URL change
      const previousStep = steps[i - 1];
      const prevUrl: string = isWorkflowStepPayload(previousStep?.payload) 
        ? previousStep.payload.url 
        : currentSequence.startUrl;

      if (currentUrl !== prevUrl) {
        // URL changed! This sequence ends with navigation
        currentSequence.steps.push(step);

        // Create the sequence
        sequences.push({
          startIndex: currentSequence.startIndex,
          endIndex: i,
          startUrl: currentSequence.startUrl,
          endUrl: currentUrl,
          steps: currentSequence.steps,
          canOptimize: false, // Will be determined during classification
          necessarySteps: [],
          stepClassifications: [],
        });

        // Start a new sequence from this point
        currentSequence = {
          startIndex: i,
          startUrl: currentUrl,
          steps: [step],
        };
      } else {
        // Same URL, add to current sequence
        currentSequence.steps.push(step);
      }
    }

    // Filter out sequences with only 1 step (no optimization possible)
    return sequences.filter(seq => seq.steps.length > 1);
  }

  // ============================================================================
  // Step Classification (Rule-Based)
  // ============================================================================

  /**
   * Classify a step using rule-based logic
   */
  private classifyStepRuleBased(step: WorkflowStep): StepClassificationResult {
    const baseResult: Omit<StepClassificationResult, 'stepIndex'> = {
      isNecessary: false,
      classification: 'uncertain',
      confidence: 1.0,
      reasoning: '',
      decisionMethod: 'rule-based',
    };

    // TAB_SWITCH steps are generally optimizable for navigation purposes
    if (!isWorkflowStepPayload(step.payload)) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: 'TAB_SWITCH step is just for navigation',
      };
    }

    const payload = step.payload;

    // DEFINITELY NECESSARY: INPUT steps
    if (step.type === 'INPUT') {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: true,
        classification: 'necessary',
        reasoning: 'INPUT step - form field interaction that must be preserved',
      };
    }

    // DEFINITELY NECESSARY: Steps with inputDetails
    if (payload.inputDetails) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: true,
        classification: 'necessary',
        reasoning: 'Step has input details - indicates form interaction',
      };
    }

    // DEFINITELY NECESSARY: Steps in forms (formContext present)
    if (payload.context?.formContext) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: true,
        classification: 'necessary',
        reasoning: 'Step is within a form context',
      };
    }

    // DEFINITELY NECESSARY: Steps with clipboard operations
    if (payload.aiEvidence?.clipboardMetadata) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: true,
        classification: 'necessary',
        reasoning: 'Step involves clipboard operations (copy/paste)',
      };
    }

    // DEFINITELY NECESSARY: KEYBOARD steps (except navigation keys)
    if (step.type === 'KEYBOARD') {
      const key = payload.keyboardDetails?.key?.toLowerCase();
      const isNavigationKey = ['tab', 'escape', 'arrowdown', 'arrowup', 'arrowleft', 'arrowright'].includes(key || '');
      
      if (!isNavigationKey) {
        return {
          ...baseResult,
          stepIndex: -1,
          isNecessary: true,
          classification: 'necessary',
          reasoning: 'KEYBOARD step with non-navigation key',
        };
      }
    }

    // LIKELY OPTIMIZABLE: NAVIGATION steps (the actual URL change)
    if (step.type === 'NAVIGATION') {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: 'NAVIGATION step - can be replaced with direct URL navigation',
      };
    }

    // LIKELY OPTIMIZABLE: SCROLL steps
    if (step.type === 'SCROLL') {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: 'SCROLL step - usually just for navigation UI visibility',
      };
    }

    // CLICK steps require more analysis
    if (step.type === 'CLICK') {
      return this.classifyClickStep(payload, baseResult);
    }

    // Default: uncertain
    return {
      ...baseResult,
      stepIndex: -1,
      classification: 'uncertain',
      reasoning: 'Could not determine step necessity from rules alone',
    };
  }

  /**
   * Classify a CLICK step - more nuanced analysis needed
   */
  private classifyClickStep(
    payload: WorkflowStepPayload,
    baseResult: Omit<StepClassificationResult, 'stepIndex'>
  ): Omit<StepClassificationResult, 'stepIndex'> & { stepIndex: number } {
    const elementText = payload.elementText?.toLowerCase() || '';
    const label = payload.label?.toLowerCase() || '';
    const selector = payload.selector?.toLowerCase() || '';
    const role = payload.elementRole?.toLowerCase() || '';

    // LIKELY OPTIMIZABLE: Navigation-related element text
    const navigationKeywords = [
      'menu', 'nav', 'navigation', 'dropdown', 'expand', 'collapse',
      'more', 'show more', 'toggle', 'open', 'close', 'hamburger'
    ];
    
    const isNavigationElement = navigationKeywords.some(keyword => 
      elementText.includes(keyword) || label.includes(keyword) || role.includes(keyword)
    );

    if (isNavigationElement) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: `Click on navigation element (contains: ${navigationKeywords.find(k => elementText.includes(k) || label.includes(k))})`,
      };
    }

    // LIKELY OPTIMIZABLE: Menu/dropdown selector patterns
    const menuSelectorPatterns = [
      'menu', 'dropdown', 'nav', 'sidebar', 'header', 
      '[role="menu"]', '[role="menuitem"]', '[role="navigation"]',
      'mat-menu', 'md-menu', 'ant-menu', 'chakra-menu'
    ];
    
    const isMenuSelector = menuSelectorPatterns.some(pattern => selector.includes(pattern));

    if (isMenuSelector) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: 'Click on menu/navigation selector pattern',
      };
    }

    // LIKELY OPTIMIZABLE: Link clicks (a tags)
    if (selector.includes('a[') || selector.startsWith('a.') || selector.startsWith('a#') || 
        payload.selector === 'a' || role === 'link') {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: false,
        classification: 'optimizable',
        reasoning: 'Click on link element - can be replaced with direct navigation',
      };
    }

    // NECESSARY: Button that might trigger actions
    const actionKeywords = [
      'submit', 'save', 'create', 'delete', 'remove', 'add', 'update',
      'confirm', 'cancel', 'send', 'upload', 'download', 'export', 'import'
    ];
    
    const isActionButton = actionKeywords.some(keyword => 
      elementText.includes(keyword) || label.includes(keyword)
    );

    if (isActionButton) {
      return {
        ...baseResult,
        stepIndex: -1,
        isNecessary: true,
        classification: 'necessary',
        reasoning: `Click on action button (contains: ${actionKeywords.find(k => elementText.includes(k) || label.includes(k))})`,
      };
    }

    // UNCERTAIN: Generic clicks that could go either way
    return {
      ...baseResult,
      stepIndex: -1,
      classification: 'uncertain',
      reasoning: 'Generic click - cannot determine from rules if it modifies state',
    };
  }

  // ============================================================================
  // Sequence Classification (Combining Rules + AI)
  // ============================================================================

  /**
   * Classify all steps in detected sequences
   */
  private async classifySequences(
    sequences: NavigationSequence[],
    allSteps: WorkflowStep[],
    options: Required<OptimizationOptions>
  ): Promise<NavigationSequence[]> {
    const classifiedSequences: NavigationSequence[] = [];

    for (const sequence of sequences) {
      const classifiedSequence = await this.classifySequence(sequence, allSteps, options);
      classifiedSequences.push(classifiedSequence);
    }

    return classifiedSequences;
  }

  /**
   * Classify a single sequence
   */
  private async classifySequence(
    sequence: NavigationSequence,
    _allSteps: WorkflowStep[],
    options: Required<OptimizationOptions>
  ): Promise<NavigationSequence> {
    const classifications: StepClassificationResult[] = [];
    const uncertainSteps: number[] = [];

    // Phase 1: Rule-based classification
    for (let i = 0; i < sequence.steps.length; i++) {
      const step = sequence.steps[i];
      const globalIndex = sequence.startIndex + i;
      const classification = this.classifyStepRuleBased(step);
      classification.stepIndex = globalIndex;
      classifications.push(classification);

      if (classification.classification === 'uncertain') {
        uncertainSteps.push(i);
      }
    }

    // Phase 2: AI classification for uncertain steps
    if (options.useAI && uncertainSteps.length > 0 && aiConfig.isEnabled()) {
      try {
        const aiClassifications = await this.getAIClassifications(sequence, classifications, options);
        
        // Merge AI classifications
        for (const aiResult of aiClassifications.stepClassifications) {
          const classificationIndex = classifications.findIndex(c => c.stepIndex === aiResult.stepIndex);
          if (classificationIndex >= 0) {
            const existing = classifications[classificationIndex];
            
            // Phase 3: Hybrid decision logic
            classifications[classificationIndex] = this.mergeClassifications(
              existing,
              aiResult,
              options.aiConfidenceThreshold
            );
          }
        }
      } catch (error) {
        console.warn('🔧 NavigationOptimizer: AI classification failed, using rule-based only:', error);
      }
    }

    // Determine which steps are necessary
    const necessarySteps = classifications
      .filter(c => c.isNecessary)
      .map(c => c.stepIndex - sequence.startIndex);

    // Determine if sequence can be optimized
    // A sequence can be optimized if it has more optimizable steps than necessary steps
    const optimizableCount = classifications.filter(c => c.classification === 'optimizable').length;
    const necessaryCount = necessarySteps.length;
    const canOptimize = optimizableCount > 0 && necessaryCount < sequence.steps.length - 1;

    return {
      ...sequence,
      canOptimize,
      necessarySteps,
      stepClassifications: classifications,
    };
  }

  /**
   * Merge rule-based and AI classifications using hybrid logic
   */
  private mergeClassifications(
    ruleBased: StepClassificationResult,
    aiResult: { stepIndex: number; isNecessary: boolean; confidence: number; reasoning: string },
    confidenceThreshold: number
  ): StepClassificationResult {
    // Rule 1: If rule-based = "definitely necessary" → Keep (no AI needed)
    if (ruleBased.classification === 'necessary') {
      return ruleBased;
    }

    // Rule 2: If rule-based = "likely optimizable" AND AI agrees → Optimize
    if (ruleBased.classification === 'optimizable' && !aiResult.isNecessary) {
      return {
        ...ruleBased,
        decisionMethod: 'hybrid',
        confidence: aiResult.confidence,
        reasoning: `${ruleBased.reasoning}; AI confirms: ${aiResult.reasoning}`,
      };
    }

    // Rule 3: If rule-based = "uncertain" → Use AI classification
    if (ruleBased.classification === 'uncertain') {
      // Rule 5: If AI confidence < threshold → Default to safe (keep step)
      if (aiResult.confidence < confidenceThreshold) {
        return {
          ...ruleBased,
          isNecessary: true,
          classification: 'necessary',
          decisionMethod: 'hybrid',
          confidence: aiResult.confidence,
          reasoning: `AI confidence (${(aiResult.confidence * 100).toFixed(0)}%) below threshold - keeping step for safety`,
        };
      }

      return {
        stepIndex: aiResult.stepIndex,
        isNecessary: aiResult.isNecessary,
        classification: aiResult.isNecessary ? 'necessary' : 'optimizable',
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        decisionMethod: 'ai-powered',
      };
    }

    // Rule 4: If rule-based conflicts with AI → AI has final say (if confidence is high)
    if (aiResult.confidence >= confidenceThreshold) {
      return {
        stepIndex: aiResult.stepIndex,
        isNecessary: aiResult.isNecessary,
        classification: aiResult.isNecessary ? 'necessary' : 'optimizable',
        confidence: aiResult.confidence,
        reasoning: `AI override: ${aiResult.reasoning}`,
        decisionMethod: 'ai-powered',
      };
    }

    // Default: use rule-based result
    return ruleBased;
  }

  // ============================================================================
  // AI Classification
  // ============================================================================

  /**
   * Get AI classifications for uncertain steps
   */
  private async getAIClassifications(
    sequence: NavigationSequence,
    classifications: StepClassificationResult[],
    _options: Required<OptimizationOptions>
  ): Promise<AIAnalysisOutput> {
    // Build minimal smart context for AI
    const aiInput: AIAnalysisInput = {
      sequence: {
        startUrl: sequence.startUrl,
        endUrl: sequence.endUrl,
        stepCount: sequence.steps.length,
      },
      steps: sequence.steps.map((step, i) => {
        const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;
        const classification = classifications[i];
        
        return {
          type: step.type,
          elementText: payload?.elementText,
          label: payload?.label,
          url: payload?.url || '',
          formContext: payload?.context?.formContext,
          inputDetails: payload?.inputDetails,
          hasClipboardData: !!payload?.aiEvidence?.clipboardMetadata,
          ruleBasedClassification: classification.classification,
          stepIndex: sequence.startIndex + i,
        };
      }),
    };

    // Call AI service
    return await this.callAIAnalysis(aiInput);
  }

  /**
   * Call AI service for step necessity analysis
   */
  private async callAIAnalysis(input: AIAnalysisInput): Promise<AIAnalysisOutput> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    const url = `${config.supabaseUrl}/functions/v1/analyze_navigation_steps`;
    const timeout = config.timeout || 10000;
    
    console.log(`🔧 NavigationOptimizer: Calling AI analysis for ${input.steps.length} steps`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI analysis error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseAIResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`AI analysis timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse AI response
   */
  private parseAIResponse(response: any): AIAnalysisOutput {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid AI response format');
    }

    return {
      stepClassifications: Array.isArray(response.stepClassifications) 
        ? response.stepClassifications.map((c: any) => ({
            stepIndex: typeof c.stepIndex === 'number' ? c.stepIndex : 0,
            isNecessary: typeof c.isNecessary === 'boolean' ? c.isNecessary : true,
            confidence: typeof c.confidence === 'number' ? c.confidence : 0,
            reasoning: typeof c.reasoning === 'string' ? c.reasoning : '',
          }))
        : [],
      overallRecommendation: ['optimize', 'keep', 'partial'].includes(response.overallRecommendation)
        ? response.overallRecommendation
        : 'keep',
    };
  }

  // ============================================================================
  // Workflow Generation
  // ============================================================================

  /**
   * Generate optimized workflow from classified sequences
   */
  private generateOptimizedWorkflow(
    originalSteps: WorkflowStep[],
    classifiedSequences: NavigationSequence[],
    _options: Required<OptimizationOptions>
  ): OptimizationResult {
    const optimizedSteps: WorkflowStep[] = [];
    const optimizationMap: OptimizationMapEntry[] = [];
    let sequencesOptimized = 0;
    let stepsRemoved = 0;
    let aiUsed = false;
    const aiConfidences: number[] = [];

    // Create a map of step indices to their sequence (if any)
    const stepToSequence = new Map<number, NavigationSequence>();
    for (const seq of classifiedSequences) {
      for (let i = seq.startIndex; i <= seq.endIndex; i++) {
        stepToSequence.set(i, seq);
      }
    }

    // Track which steps we've processed (to avoid duplicates from sequences)
    const processedSteps = new Set<number>();

    for (let i = 0; i < originalSteps.length; i++) {
      if (processedSteps.has(i)) continue;

      const sequence = stepToSequence.get(i);

      if (sequence && sequence.canOptimize && i === sequence.startIndex) {
        // This is the start of an optimizable sequence
        const result = this.optimizeSequence(sequence, optimizedSteps.length);
        
        optimizedSteps.push(...result.steps);
        optimizationMap.push(...result.mapEntries);
        
        if (result.stepsRemoved > 0) {
          sequencesOptimized++;
          stepsRemoved += result.stepsRemoved;
        }

        // Track AI usage
        for (const classification of sequence.stepClassifications) {
          if (classification.decisionMethod === 'ai-powered' || classification.decisionMethod === 'hybrid') {
            aiUsed = true;
            if (classification.confidence > 0) {
              aiConfidences.push(classification.confidence);
            }
          }
        }

        // Mark all steps in sequence as processed
        for (let j = sequence.startIndex; j <= sequence.endIndex; j++) {
          processedSteps.add(j);
        }
      } else {
        // Not part of an optimizable sequence, keep as-is
        optimizedSteps.push(originalSteps[i]);
        processedSteps.add(i);
      }
    }

    const metadata: OptimizationMetadata = {
      analyzedAt: Date.now(),
      sequencesFound: classifiedSequences.length,
      sequencesOptimized,
      stepsRemoved,
      aiAnalysisUsed: aiUsed,
      aiConfidenceAvg: aiConfidences.length > 0 
        ? aiConfidences.reduce((a, b) => a + b, 0) / aiConfidences.length 
        : undefined,
      optimizationMap,
    };

    return { optimizedSteps, metadata };
  }

  /**
   * Optimize a single sequence
   */
  private optimizeSequence(
    sequence: NavigationSequence,
    startOptimizedIndex: number
  ): { steps: WorkflowStep[]; mapEntries: OptimizationMapEntry[]; stepsRemoved: number } {
    const steps: WorkflowStep[] = [];
    const mapEntries: OptimizationMapEntry[] = [];
    const removedIndices: number[] = [];
    const keptIndices: number[] = [];

    let optimizedIndex = startOptimizedIndex;

    // Collect necessary steps
    for (let i = 0; i < sequence.steps.length; i++) {
      const globalIndex = sequence.startIndex + i;
      const classification = sequence.stepClassifications.find(c => c.stepIndex === globalIndex);
      
      if (classification?.isNecessary) {
        steps.push(sequence.steps[i]);
        keptIndices.push(globalIndex);
        optimizedIndex++;
      } else {
        removedIndices.push(globalIndex);
      }
    }

    // If we're removing steps, add a direct navigation step to the end URL
    // (only if the sequence ends with navigation to a different URL)
    if (removedIndices.length > 0 && sequence.startUrl !== sequence.endUrl) {
      // Find the last step to get timestamp and other context
      const lastStep = sequence.steps[sequence.steps.length - 1];
      const lastPayload = isWorkflowStepPayload(lastStep.payload) ? lastStep.payload : null;

      if (lastPayload) {
        // Create a direct navigation step
        const directNavStep: WorkflowStep = {
          type: 'NAVIGATION',
          payload: {
            selector: 'body', // Direct navigation doesn't target a specific element
            fallbackSelectors: [],
            xpath: '/html/body',
            timestamp: lastPayload.timestamp,
            url: sequence.endUrl,
            tabUrl: lastPayload.tabUrl,
            tabTitle: lastPayload.tabTitle,
            tabInfo: lastPayload.tabInfo,
            // Wait conditions handled dynamically by StateWaitEngine at execution time
          },
          description: `Navigate directly to ${sequence.endUrl}`,
        };

        // Insert the navigation step at the appropriate position
        steps.push(directNavStep);
      }

      // Create map entry for removed steps
      mapEntries.push({
        originalIndices: removedIndices,
        optimizedIndex: steps.length > 0 ? optimizedIndex - 1 : -1,
        reason: `Replaced ${removedIndices.length} navigation steps with direct URL navigation`,
        decisionMethod: this.getSequenceDecisionMethod(sequence),
        aiConfidence: this.getSequenceAverageConfidence(sequence),
      });
    }

    // Create map entries for kept steps
    for (let i = 0; i < keptIndices.length; i++) {
      const classification = sequence.stepClassifications.find(c => c.stepIndex === keptIndices[i]);
      mapEntries.push({
        originalIndices: [keptIndices[i]],
        optimizedIndex: startOptimizedIndex + i,
        reason: classification?.reasoning || 'Preserved necessary step',
        decisionMethod: classification?.decisionMethod || 'rule-based',
        aiConfidence: classification?.confidence,
      });
    }

    return {
      steps,
      mapEntries,
      stepsRemoved: removedIndices.length,
    };
  }

  /**
   * Get the primary decision method for a sequence
   */
  private getSequenceDecisionMethod(sequence: NavigationSequence): DecisionMethod {
    const methods = sequence.stepClassifications.map(c => c.decisionMethod);
    if (methods.includes('ai-powered')) return 'ai-powered';
    if (methods.includes('hybrid')) return 'hybrid';
    return 'rule-based';
  }

  /**
   * Get average AI confidence for a sequence
   */
  private getSequenceAverageConfidence(sequence: NavigationSequence): number | undefined {
    const confidences = sequence.stepClassifications
      .filter(c => c.decisionMethod !== 'rule-based' && c.confidence > 0)
      .map(c => c.confidence);
    
    if (confidences.length === 0) return undefined;
    return confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  // ============================================================================
  // Step Consolidation (INPUT/SCROLL Deduplication)
  // ============================================================================

  /**
   * Consolidate duplicate INPUT and SCROLL steps
   * - For INPUT: Keep only the final value for each field (remove intermediate keystrokes)
   * - For SCROLL: Combine sequential scrolls in the same direction
   */
  private consolidateDuplicateSteps(
    steps: WorkflowStep[],
    existingMap: OptimizationMapEntry[]
  ): OptimizationResult {
    const consolidatedSteps: WorkflowStep[] = [];
    const consolidationMap: OptimizationMapEntry[] = [...existingMap];
    let additionalStepsRemoved = 0;

    // Track which original indices are being consolidated
    const originalIndexMap = new Map<number, number>(); // original → optimized
    
    // Build reverse map from existing optimization map
    for (const entry of existingMap) {
      for (const originalIdx of entry.originalIndices) {
        originalIndexMap.set(originalIdx, entry.optimizedIndex);
      }
    }

    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      const payload = isWorkflowStepPayload(step.payload) ? step.payload : null;

      // ====== INPUT CONSOLIDATION ======
      if (step.type === 'INPUT' && payload) {
        // Look ahead for more INPUT steps on the same field
        const fieldSelector = payload.selector;
        const fieldLabel = payload.label;
        let lastInputStep = step;
        let lastInputIndex = i;
        const consolidatedIndices = [i];

        // Scan forward for consecutive INPUT steps on the same field
        let j = i + 1;
        while (j < steps.length) {
          const nextStep = steps[j];
          const nextPayload = isWorkflowStepPayload(nextStep.payload) ? nextStep.payload : null;

          // Stop if we hit a non-INPUT step or different field
          if (nextStep.type !== 'INPUT' || !nextPayload) break;
          if (nextPayload.selector !== fieldSelector && nextPayload.label !== fieldLabel) break;

          // Same field - this is an intermediate keystroke
          lastInputStep = nextStep;
          lastInputIndex = j;
          consolidatedIndices.push(j);
          j++;
        }

        // If we found duplicates, keep only the last one
        if (consolidatedIndices.length > 1) {
          console.log(`🔧 Consolidating ${consolidatedIndices.length} INPUT steps → keeping final value:`, 
            (isWorkflowStepPayload(lastInputStep.payload) ? lastInputStep.payload.value : ''));
          
          consolidatedSteps.push(lastInputStep);
          additionalStepsRemoved += consolidatedIndices.length - 1;

          // Add to consolidation map
          consolidationMap.push({
            originalIndices: consolidatedIndices,
            optimizedIndex: consolidatedSteps.length - 1,
            reason: `Consolidated ${consolidatedIndices.length} INPUT keystrokes → final value`,
            decisionMethod: 'rule-based',
          });

          // Skip all the intermediate steps
          i = lastInputIndex + 1;
          continue;
        }
      }

      // ====== SCROLL CONSOLIDATION ======
      if (step.type === 'SCROLL' && payload) {
        // Look ahead for consecutive SCROLL steps
        const scrollSteps = [step];
        const consolidatedIndices = [i];

        let j = i + 1;
        while (j < steps.length && steps[j].type === 'SCROLL') {
          scrollSteps.push(steps[j]);
          consolidatedIndices.push(j);
          j++;
        }

        // If we found multiple scrolls, combine them
        if (scrollSteps.length > 1) {
          console.log(`🔧 Consolidating ${scrollSteps.length} SCROLL steps → single scroll`);
          
          // Keep the last scroll (it represents the final scroll position)
          const lastScroll = scrollSteps[scrollSteps.length - 1];
          consolidatedSteps.push(lastScroll);
          additionalStepsRemoved += scrollSteps.length - 1;

          // Add to consolidation map
          consolidationMap.push({
            originalIndices: consolidatedIndices,
            optimizedIndex: consolidatedSteps.length - 1,
            reason: `Consolidated ${scrollSteps.length} SCROLL steps → final position`,
            decisionMethod: 'rule-based',
          });

          // Skip all the scroll steps
          i = j;
          continue;
        }
      }

      // Keep step as-is
      consolidatedSteps.push(step);
      i++;
    }

    // Update metadata
    const metadata: OptimizationMetadata = {
      analyzedAt: Date.now(),
      sequencesFound: 0, // Only navigation sequences tracked separately
      sequencesOptimized: 0,
      stepsRemoved: existingMap.reduce((sum, entry) => {
        return sum + (entry.originalIndices.length > 1 && entry.optimizedIndex === -1 ? entry.originalIndices.length : 0);
      }, 0) + additionalStepsRemoved,
      aiAnalysisUsed: false,
      optimizationMap: consolidationMap,
    };

    return { optimizedSteps: consolidatedSteps, metadata };
  }
}

