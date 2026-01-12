/**
 * Teaching Service
 * 
 * Client-side service for the teaching conversation flow.
 * Provides a clean API for pre-recording and post-recording interactions.
 */

import type { TeachingIntent, LearnedSkill, WorkflowStep } from '../types/workflow';
import { aiConfig } from './ai-config';

// ============================================================================
// Types
// ============================================================================

export interface PreRecordingResponse {
  intent: TeachingIntent;
  aiResponse: string;
  suggestedName: string;
}

export interface PostRecordingQuestion {
  id: string;
  type: 'variable' | 'constant' | 'trigger' | 'confirmation';
  question: string;
  quickOptions?: string[];
  allowFreeText: boolean;
}

export interface PostRecordingResponse {
  question?: PostRecordingQuestion;
  isComplete: boolean;
  learnedSkill?: LearnedSkill;
  aiResponse: string;
}

export interface SimplifiedStep {
  type: string;
  description?: string;
  url: string;
  inputValue?: string;
  selectedOption?: string;
  hasDropdown: boolean;
  hasTextInput: boolean;
}

// ============================================================================
// Teaching Service
// ============================================================================

export class TeachingService {
  
  /**
   * Capture user intent before recording starts
   * Returns the AI's understanding and what to watch for
   */
  static async capturePreRecordingIntent(
    userMessage: string
  ): Promise<PreRecordingResponse> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    const url = `${config.supabaseUrl}/functions/v1/teaching_conversation`;
    const timeout = 15000; // 15 seconds

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
          mode: 'pre_recording',
          userMessage,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge function error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  /**
   * Process post-recording conversation
   * Either returns the next question or the final learned skill
   */
  static async processPostRecording(
    teachingIntent: TeachingIntent,
    workflow: { name: string; steps: WorkflowStep[] },
    previousAnswers?: Array<{ questionId: string; answer: string }>
  ): Promise<PostRecordingResponse> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase configuration missing');
    }

    const url = `${config.supabaseUrl}/functions/v1/teaching_conversation`;
    const timeout = 20000; // 20 seconds

    // Simplify steps for the API
    const simplifiedSteps = this.simplifySteps(workflow.steps);

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
          mode: 'post_recording',
          teachingIntent,
          workflow: {
            name: workflow.name,
            stepCount: workflow.steps.length,
            steps: simplifiedSteps,
          },
          previousAnswers: previousAnswers || [],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge function error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  /**
   * Simplify workflow steps for API transmission
   * Extracts only the relevant fields for teaching analysis
   */
  private static simplifySteps(steps: WorkflowStep[]): SimplifiedStep[] {
    return steps.map((step) => {
      const payload = step.payload as any;
      
      return {
        type: step.type,
        description: step.description,
        url: payload?.url || '',
        inputValue: payload?.value,
        selectedOption: payload?.context?.decisionSpace?.selectedText,
        hasDropdown: !!payload?.context?.decisionSpace,
        hasTextInput: step.type === 'INPUT',
      };
    });
  }

  /**
   * Create a fallback learned skill when API fails
   * Uses the teaching intent to build a basic skill
   */
  static createFallbackSkill(
    teachingIntent: TeachingIntent,
    _workflowName: string
  ): LearnedSkill {
    const { verb, object, isGeneric } = teachingIntent.expectedAction;
    
    return {
      originalIntent: teachingIntent,
      whatItDoes: `${this.capitalize(verb)} ${object}`,
      canonicalAction: {
        verb,
        verbSynonyms: this.getVerbSynonyms(verb),
        object,
        objectSynonyms: [],
      },
      exampleQueries: [
        `${verb} the ${object}`,
        `${verb} a ${object}`,
        `${verb} ${object}`,
      ],
      extractableVariables: isGeneric && teachingIntent.expectedVariables.length > 0
        ? teachingIntent.expectedVariables.map(name => ({
            name,
            patterns: [`the {X} ${object}`],
            examples: [],
          }))
        : [],
      constants: [],
      domain: {
        application: 'Web Application',
        category: 'general',
      },
      teachingMetadata: {
        taughtAt: Date.now(),
        questionsAsked: 0,
        userConfirmed: false,
      },
    };
  }

  /**
   * Get synonyms for common verbs
   */
  private static getVerbSynonyms(verb: string): string[] {
    const synonymMap: Record<string, string[]> = {
      download: ['export', 'get', 'fetch', 'pull', 'save', 'retrieve'],
      create: ['add', 'new', 'make', 'insert', 'generate'],
      update: ['edit', 'modify', 'change', 'revise'],
      delete: ['remove', 'clear', 'erase'],
      search: ['find', 'look for', 'locate', 'query'],
      navigate: ['go to', 'open', 'visit', 'access'],
      submit: ['send', 'save', 'confirm', 'complete'],
      select: ['choose', 'pick', 'set'],
      enter: ['type', 'input', 'fill in', 'write'],
    };

    return synonymMap[verb.toLowerCase()] || [];
  }

  /**
   * Capitalize first letter
   */
  private static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
