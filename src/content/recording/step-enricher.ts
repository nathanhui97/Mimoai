/**
 * StepEnricher - Enriches workflow steps with reliable replayer data
 * 
 * Adds LocatorBundle, Intent, StepGoal, and Success Conditions to steps
 * for improved replay reliability.
 */

import { buildLocatorBundle } from '../../lib/locator-builder';
import { 
  inferClickIntent, 
  inferInputIntent, 
  inferKeyboardIntent,
  inferSuccessCondition,
  buildStepGoal 
} from '../../lib/intent-inference';
import type { Intent } from '../../types/intent';
import type { StepEnrichmentResult } from './types';

export interface StepEnricherConfig {
  enableReliableRecording: boolean;
}

/**
 * StepEnricher adds comprehensive locator strategies and intent information
 * to workflow steps for improved replay reliability.
 */
export class StepEnricher {
  private config: StepEnricherConfig;

  constructor(config: StepEnricherConfig = { enableReliableRecording: true }) {
    this.config = config;
  }

  /**
   * Enrich step with reliable replayer data (LocatorBundle, Intent, Success Conditions)
   */
  enrichStep(
    element: Element,
    stepType: 'CLICK' | 'INPUT' | 'KEYBOARD' | 'COPY' | 'PASTE',
    value?: string,
    key?: string
  ): StepEnrichmentResult | null {
    if (!this.config.enableReliableRecording) {
      return null;
    }

    try {
      // Build comprehensive locator bundle with all strategies and features
      const locatorBundle = buildLocatorBundle(element, document);
      
      // Infer machine-readable intent based on step type and element context
      let intent: Intent;
      switch (stepType) {
        case 'CLICK':
          intent = inferClickIntent(element);
          break;
        case 'INPUT':
          intent = inferInputIntent(element, value || '');
          break;
        case 'KEYBOARD':
          intent = inferKeyboardIntent(key || 'Enter');
          break;
        case 'COPY':
          // For COPY, we use a READ intent since we're extracting text
          intent = { kind: 'READ' };
          break;
        case 'PASTE':
          // For PASTE, we use a TYPE intent since we're inserting text
          intent = { kind: 'TYPE', valueVar: value || 'pastedText' };
          break;
      }
      
      // Build complete step goal with description and expected outcome
      const stepGoal = buildStepGoal(intent, element);
      
      // Suggest success condition based on intent and context
      const suggestedCondition = inferSuccessCondition(intent, element);
      
      console.log('🎯 GhostWriter: Enriched step with reliable data:', {
        intent: intent.kind,
        strategiesFound: locatorBundle.strategies.length,
        hasScope: !!locatorBundle.scope,
        disambiguators: locatorBundle.disambiguators.length,
        conditionConfidence: suggestedCondition.confidence,
      });
      
      return { locatorBundle, intent, stepGoal, suggestedCondition };
    } catch (error) {
      console.warn('GhostWriter: Failed to enrich step with reliable data:', error);
      return null;
    }
  }
}

