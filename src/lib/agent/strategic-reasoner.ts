/**
 * Strategic Reasoner
 *
 * Pre-execution reasoning layer that thinks about:
 * 1. WHAT the user is trying to accomplish (not just HOW)
 * 2. WHETHER to iterate for multiple items
 * 3. WHICH blocks need to repeat
 *
 * This addresses the gap between tactical thinking (finding elements)
 * and strategic thinking (understanding goals and planning iterations).
 */

import type { SavedWorkflow } from '../../types/workflow';
import type { WorkflowMemory, WorkflowBlock, InputFieldWithArraySupport } from '../workflow-memory/types';
import { VariableExtractor } from '../variable-extractor';

/**
 * Execution Plan - the strategic output before tactical execution
 */
export interface ExecutionPlan {
  /** Overall goal understanding */
  goal: {
    summary: string;
    isRepeatable: boolean;
    itemsToProcess: number;
  };

  /** Iteration plan for multi-item execution */
  iterations: IterationPlan[];

  /** Reasoning trace for debugging */
  reasoning: string[];

  /** Confidence in the plan (0-1) */
  confidence: number;
}

export interface IterationPlan {
  /** Iteration index (0-based) */
  index: number;

  /** Variable values for this iteration */
  variableValues: Record<string, string>;

  /** Human-readable description */
  description: string;

  /** Which blocks to execute (null = all) */
  blocksToExecute: number[] | null;
}

/**
 * Detection result for multi-value variables
 */
interface MultiValueDetection {
  variableName: string;
  singleValue: string;
  multipleValues: string[];
  isArray: boolean;
  confidence: number;
}

/**
 * Strategic Reasoner - thinks before acting
 */
export class StrategicReasoner {

  /**
   * Create an execution plan by reasoning about the workflow and user input.
   * This is the "strategic thinking" phase before tactical execution.
   */
  static createExecutionPlan(
    workflow: SavedWorkflow,
    variableValues: Record<string, string>,
    userQuery?: string
  ): ExecutionPlan {
    const reasoning: string[] = [];
    const memory = workflow.memory;

    reasoning.push(`Analyzing workflow: "${workflow.name}"`);

    // Step 1: Understand the workflow's repeatability
    const repeatableBlocks = this.findRepeatableBlocks(memory);
    reasoning.push(`Found ${repeatableBlocks.length} repeatable block(s)`);

    // Step 2: Detect multi-value variables
    const multiValueDetections = this.detectMultipleValues(
      variableValues,
      memory,
      userQuery
    );

    const hasMultipleItems = multiValueDetections.some(d => d.isArray && d.multipleValues.length > 1);
    reasoning.push(`Multi-value detection: ${hasMultipleItems ? 'YES' : 'NO'}`);

    if (hasMultipleItems) {
      for (const detection of multiValueDetections.filter(d => d.isArray)) {
        reasoning.push(`  - ${detection.variableName}: [${detection.multipleValues.join(', ')}] (${detection.multipleValues.length} items)`);
      }
    }

    // Step 3: Decide on iteration strategy
    if (hasMultipleItems && repeatableBlocks.length > 0) {
      // Multi-item execution with iteration
      return this.createIteratedPlan(
        workflow,
        variableValues,
        multiValueDetections,
        repeatableBlocks,
        reasoning
      );
    } else {
      // Single execution (no iteration needed)
      return this.createSinglePlan(
        workflow,
        variableValues,
        reasoning
      );
    }
  }

  /**
   * Find blocks that are marked as repeatable in workflow memory
   */
  private static findRepeatableBlocks(memory?: WorkflowMemory): WorkflowBlock[] {
    // Check for blocks in understanding (WorkflowUnderstandingWithBlocks)
    const understanding = memory?.understanding as { blocks?: WorkflowBlock[] } | undefined;
    if (!understanding?.blocks) {
      return [];
    }

    return understanding.blocks.filter((block: WorkflowBlock) => block.isRepeatable);
  }

  /**
   * Detect if any variable contains multiple values
   */
  private static detectMultipleValues(
    variableValues: Record<string, string>,
    memory?: WorkflowMemory,
    _userQuery?: string
  ): MultiValueDetection[] {
    const detections: MultiValueDetection[] = [];

    // Get array-capable inputs from memory
    const arrayInputs = this.getArrayCapableInputs(memory);

    for (const [varName, value] of Object.entries(variableValues)) {
      // Check if this variable supports arrays
      const inputDef = arrayInputs.find(
        inp => inp.name === varName || inp.variableName === varName
      );

      if (inputDef?.isArray) {
        // Parse as array using separators from memory
        const separators = inputDef.arraySeparators || ['and', ',', ';'];
        const multipleValues = VariableExtractor.parseArrayFromText(value, separators);

        detections.push({
          variableName: varName,
          singleValue: value,
          multipleValues,
          isArray: multipleValues.length > 1,
          confidence: multipleValues.length > 1 ? 0.9 : 0.5,
        });
      } else {
        // Not marked as array, but check anyway for explicit lists
        const maybeArray = this.detectImplicitArray(value);

        detections.push({
          variableName: varName,
          singleValue: value,
          multipleValues: maybeArray.values,
          isArray: maybeArray.isArray,
          confidence: maybeArray.confidence,
        });
      }
    }

    return detections;
  }

  /**
   * Get inputs that are marked as supporting arrays
   */
  private static getArrayCapableInputs(memory?: WorkflowMemory): InputFieldWithArraySupport[] {
    if (!memory?.inputs) {
      return [];
    }

    const inputs: InputFieldWithArraySupport[] = [
      ...(memory.inputs.required || []),
      ...(memory.inputs.optional || []),
    ];

    // Filter to only array-capable inputs
    return inputs.filter(inp =>
      'isArray' in inp && inp.isArray
    ) as InputFieldWithArraySupport[];
  }

  /**
   * Detect implicit arrays in a value (e.g., "Alice, Bob, Carol")
   */
  private static detectImplicitArray(value: string): {
    values: string[];
    isArray: boolean;
    confidence: number;
  } {
    // Common list patterns
    const patterns = [
      /(.+?)\s*,\s*(.+?)\s*(?:,\s*)?(?:and|&)\s+(.+)/i,  // "A, B, and C"
      /(.+?)\s*(?:and|&)\s+(.+)/i,                        // "A and B"
      /(.+?)\s*,\s*(.+)/,                                  // "A, B"
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) {
        // Extract all captured groups
        const values = match.slice(1)
          .flatMap(v => v.split(/\s*,\s*/))
          .map(v => v.trim())
          .filter(v => v.length > 0);

        if (values.length > 1) {
          return {
            values,
            isArray: true,
            confidence: 0.7, // Lower confidence for implicit detection
          };
        }
      }
    }

    return {
      values: [value],
      isArray: false,
      confidence: 1.0,
    };
  }

  /**
   * Create an iterated execution plan for multiple items
   */
  private static createIteratedPlan(
    workflow: SavedWorkflow,
    originalValues: Record<string, string>,
    detections: MultiValueDetection[],
    repeatableBlocks: WorkflowBlock[],
    reasoning: string[]
  ): ExecutionPlan {
    // Find the primary iteration variable (the one with most items)
    const primaryDetection = detections
      .filter(d => d.isArray)
      .sort((a, b) => b.multipleValues.length - a.multipleValues.length)[0];

    if (!primaryDetection) {
      // Fallback to single plan
      return this.createSinglePlan(workflow, originalValues, reasoning);
    }

    const itemCount = primaryDetection.multipleValues.length;
    reasoning.push(`Creating ${itemCount} iterations based on "${primaryDetection.variableName}"`);

    // Create iteration plans
    const iterations: IterationPlan[] = [];

    for (let i = 0; i < itemCount; i++) {
      const iterationValues = { ...originalValues };

      // Replace the primary variable with current item
      iterationValues[primaryDetection.variableName] = primaryDetection.multipleValues[i];

      // Check if other variables are also arrays of same length
      for (const detection of detections) {
        if (detection.isArray &&
            detection.variableName !== primaryDetection.variableName &&
            detection.multipleValues.length === itemCount) {
          iterationValues[detection.variableName] = detection.multipleValues[i];
        }
      }

      iterations.push({
        index: i,
        variableValues: iterationValues,
        description: `Item ${i + 1}/${itemCount}: ${primaryDetection.multipleValues[i]}`,
        blocksToExecute: repeatableBlocks.length > 0
          ? repeatableBlocks.map((_, idx) => idx)
          : null,
      });
    }

    return {
      goal: {
        summary: workflow.memory?.identity?.purpose || workflow.name || 'Execute workflow',
        isRepeatable: true,
        itemsToProcess: itemCount,
      },
      iterations,
      reasoning,
      confidence: primaryDetection.confidence,
    };
  }

  /**
   * Create a single execution plan (no iteration)
   */
  private static createSinglePlan(
    workflow: SavedWorkflow,
    variableValues: Record<string, string>,
    reasoning: string[]
  ): ExecutionPlan {
    reasoning.push('Creating single execution plan (no iteration needed)');

    return {
      goal: {
        summary: workflow.memory?.identity?.purpose || workflow.name || 'Execute workflow',
        isRepeatable: false,
        itemsToProcess: 1,
      },
      iterations: [{
        index: 0,
        variableValues,
        description: 'Single execution',
        blocksToExecute: null,
      }],
      reasoning,
      confidence: 1.0,
    };
  }

  /**
   * Log the execution plan for debugging
   */
  static logPlan(plan: ExecutionPlan): void {
    console.log('[StrategicReasoner] ========== EXECUTION PLAN ==========');
    console.log(`[StrategicReasoner] Goal: ${plan.goal.summary}`);
    console.log(`[StrategicReasoner] Repeatable: ${plan.goal.isRepeatable}`);
    console.log(`[StrategicReasoner] Items: ${plan.goal.itemsToProcess}`);
    console.log(`[StrategicReasoner] Confidence: ${(plan.confidence * 100).toFixed(0)}%`);
    console.log('[StrategicReasoner] Reasoning:');
    for (const r of plan.reasoning) {
      console.log(`  - ${r}`);
    }
    if (plan.iterations.length > 1) {
      console.log('[StrategicReasoner] Iterations:');
      for (const iter of plan.iterations) {
        console.log(`  ${iter.index + 1}. ${iter.description}`);
      }
    }
    console.log('[StrategicReasoner] ==================================');
  }
}
