/**
 * Unit Tests for Memory Adapter
 *
 * Tests the conversion of WorkflowMemory → VisionExecutionContext
 * This is critical for Phase 4: ensuring all intelligence from recording
 * is properly passed to the vision AI during execution.
 */

import { describe, test, expect } from 'vitest';
import {
  createVisionExecutionContext,
  getPhaseCount,
  getPhase,
  hasRichMemory,
  summarizeContext,
} from './memory-adapter';
import type { SavedWorkflow } from '../../../types/workflow';
import type { ActionRecord } from '../types';

// Mock workflow with full memory (Phase 2 completed)
const mockWorkflowWithMemory: SavedWorkflow = {
  id: 'test-workflow-1',
  name: 'Create CRM Contact',
  description: 'Add a new contact to the CRM system',
  steps: [
    {
      id: 'step-1',
      type: 'CLICK',
      description: 'Click New Contact button',
      payload: {
        selector: '[data-testid="new-contact"]',
        label: 'New Contact',
        elementText: 'New Contact',
        elementRole: 'button',
      },
    },
    {
      id: 'step-2',
      type: 'INPUT',
      description: 'Enter first name',
      payload: {
        selector: '#firstName',
        label: 'First Name',
        value: 'John',
        inputDetails: { type: 'text' },
      },
    },
    {
      id: 'step-3',
      type: 'CLICK',
      description: 'Click Save button',
      payload: {
        selector: '[data-testid="save"]',
        label: 'Save',
        elementText: 'Save',
        elementRole: 'button',
      },
    },
  ],
  memory: {
    identity: {
      name: 'Create CRM Contact',
      purpose: 'Add a new contact to the CRM system',
      domain: 'Salesforce CRM',
    },
    understanding: {
      phases: [
        {
          name: 'Open Form',
          purpose: 'Navigate to the contact creation form',
          stepIndices: [0],
        },
        {
          name: 'Fill Details',
          purpose: 'Enter contact information',
          stepIndices: [1],
        },
        {
          name: 'Submit',
          purpose: 'Save the new contact',
          stepIndices: [2],
        },
      ],
    },
    success: {
      indicators: [
        { type: 'toast', description: 'Success message appears', priority: 'primary' },
        { type: 'url_change', description: 'URL changes to contact detail page' },
      ],
      failureIndicators: ['Error message appears', 'Form validation fails'],
      endState: 'Contact is created and visible in list',
    },
    adaptability: {
      fallbacks: [
        { when: 'Button not visible', then: 'Scroll down to find it', forStep: 0 },
        { when: 'Form validation error', then: 'Check required fields' },
      ],
      handledVariations: ['Mobile layout', 'Different button positions'],
    },
    experience: {
      timesExecuted: 5,
      successRate: 0.8,
      troubleSpots: [
        { stepIndex: 1, issue: 'First name field sometimes slow to load', solution: 'Wait for field' },
      ],
      provenStrategies: [{ strategy: 'Wait for form to fully load before filling' }],
    },
    clarifications: {
      items: [
        {
          question: 'What should Lead Source be set to?',
          answerText: 'Web',
          customAnswer: null,
        },
      ],
    },
  },
  aiAnalysis: {
    workflowUnderstanding: {
      summary: 'Create a new CRM contact',
      primaryGoal: 'Add contact to Salesforce with correct information',
      secondaryGoals: [],
      successIndicators: ['Contact created toast'],
      failureIndicators: ['Error message'],
    },
    stepGuidance: [
      {
        stepIndex: 0,
        intent: 'Open the contact creation form',
        whyThisElement: 'New Contact button initiates the workflow',
        elementFindingStrategy: {
          lookingFor: 'Button labeled "New Contact"',
          searchContext: 'Top navigation or toolbar',
          distinguishers: ['Blue button', 'Plus icon'],
          relatedElements: [],
          textPatterns: ['New Contact', 'Add Contact'],
          elementType: 'button',
        },
        preconditions: ['On contacts list page'],
        expectedOutcome: 'Contact form opens',
        dependencies: [],
        criticality: 'critical' as const,
        retryStrategy: { maxAttempts: 3, backoffMs: 1000 },
        alternatives: ['Use keyboard shortcut Ctrl+N', 'Click + icon'],
      },
      {
        stepIndex: 1,
        intent: 'Enter the contact first name',
        whyThisElement: 'Required field for contact',
        elementFindingStrategy: {
          lookingFor: 'Input field labeled "First Name"',
          searchContext: 'Contact form',
          distinguishers: ['Text input', 'Label above or beside'],
          relatedElements: [],
          textPatterns: ['First Name', 'Given Name'],
          elementType: 'text-field',
        },
        preconditions: ['Form is open'],
        expectedOutcome: 'Field is populated',
        dependencies: [],
        criticality: 'critical' as const,
        retryStrategy: { maxAttempts: 3, backoffMs: 1000 },
        alternatives: [],
      },
    ],
    adaptationStrategies: [
      {
        scenario: 'Save button is disabled',
        howToAdapt: 'Check for required fields that are empty',
        affectedSteps: [2],
      },
    ],
  },
  learnedSkill: {
    constants: [
      { name: 'Lead Source', value: 'Web', overridable: false },
      { name: 'Status', value: 'New', overridable: true },
    ],
    extractableVariables: [
      { name: 'firstName', patterns: ['First Name', 'Given Name'] },
    ],
  },
} as unknown as SavedWorkflow;

// Mock workflow without memory (Phase 2 not completed)
const mockWorkflowMinimal = {
  id: 'test-workflow-2',
  name: 'Simple Click',
  description: 'Just a click',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  steps: [
    {
      id: 'step-1',
      type: 'CLICK',
      description: 'Click button',
      payload: { selector: 'button' },
    },
  ],
} as unknown as SavedWorkflow;

// Example mock action history for reference (actual tests create their own)
// See 'includes recent history (last 5)' test for usage example

describe('Memory Adapter - createVisionExecutionContext', () => {
  test('creates context with full task identity', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      { firstName: 'John' },
      []
    );

    expect(context.task.name).toBe('Create CRM Contact');
    expect(context.task.description).toBe('Add a new contact to the CRM system');
    expect(context.task.domain).toBe('Salesforce CRM');
    expect(context.task.goal).toBe('Add contact to Salesforce with correct information');
  });

  test('extracts current phase correctly', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      1, // Second phase
      {},
      []
    );

    expect(context.currentPhase.name).toBe('Fill Details');
    expect(context.currentPhase.intent).toBe('Enter contact information');
    expect(context.currentPhase.stepIndices).toEqual([1]);
    expect(context.phaseIndex).toBe(1);
    expect(context.totalPhases).toBe(3);
  });

  test('extracts step guidance with element finding strategy', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0, // First phase
      {},
      []
    );

    expect(context.currentPhase.stepGuidance.length).toBeGreaterThan(0);

    const firstGuidance = context.currentPhase.stepGuidance[0];
    expect(firstGuidance.intent).toBe('Open the contact creation form');
    expect(firstGuidance.elementFindingStrategy.lookingFor).toBe('Button labeled "New Contact"');
    expect(firstGuidance.elementFindingStrategy.searchContext).toBe('Top navigation or toolbar');
    expect(firstGuidance.elementFindingStrategy.distinguishers).toContain('Blue button');
    expect(firstGuidance.alternatives).toContain('Use keyboard shortcut Ctrl+N');
  });

  test('extracts knowledge rules from Q&A and constants', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.knowledge.rules.length).toBeGreaterThan(0);

    // Should include Q&A clarification
    const hasLeadSourceRule = context.knowledge.rules.some(r => r.includes('Lead Source'));
    expect(hasLeadSourceRule).toBe(true);

    // Should include constants
    const hasStatusRule = context.knowledge.rules.some(r => r.includes('Status'));
    expect(hasStatusRule).toBe(true);
  });

  test('extracts tips from fallbacks and patterns', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.knowledge.tips.length).toBeGreaterThan(0);

    // Should include fallback tips
    const hasScrollTip = context.knowledge.tips.some(t => t.includes('Scroll'));
    expect(hasScrollTip).toBe(true);
  });

  test('extracts warnings from trouble spots', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.knowledge.warnings.length).toBeGreaterThan(0);

    const hasSlowFieldWarning = context.knowledge.warnings.some(w => w.includes('slow to load'));
    expect(hasSlowFieldWarning).toBe(true);
  });

  test('extracts success criteria', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.successCriteria.indicators.length).toBe(2);
    expect(context.successCriteria.indicators[0].type).toBe('toast');
    expect(context.successCriteria.failureIndicators).toContain('Error message appears');
    expect(context.successCriteria.endState).toBe('Contact is created and visible in list');
  });

  test('extracts adaptation strategies', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.adaptations.length).toBeGreaterThan(0);

    // From memory fallbacks
    const hasScrollAdaptation = context.adaptations.some(a => a.howToAdapt.includes('Scroll'));
    expect(hasScrollAdaptation).toBe(true);

    // From analysis
    const hasDisabledButtonAdaptation = context.adaptations.some(
      a => a.scenario.includes('disabled')
    );
    expect(hasDisabledButtonAdaptation).toBe(true);
  });

  test('extracts demonstration reference', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.demonstration.length).toBe(3);
    expect(context.demonstration[0].action).toBe('CLICK');
    expect(context.demonstration[0].target).toBe('New Contact');
    expect(context.demonstration[1].value).toBe('John');
  });

  test('extracts experience data', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      []
    );

    expect(context.experience.timesExecuted).toBe(5);
    expect(context.experience.successRate).toBe(0.8);
    expect(context.experience.commonIssues.length).toBeGreaterThan(0);
    expect(context.experience.provenFixes.length).toBeGreaterThan(0);
  });

  test('includes variables in context', () => {
    const variables = { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' };

    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      variables,
      []
    );

    expect(context.variables).toEqual(variables);
  });

  test('includes recent history (last 5)', () => {
    const longHistory = Array(10).fill(null).map((_, i) => ({
      timestamp: Date.now() + i,
      decision: {
        action: { type: 'click', targetDescription: `Button ${i}` },
        reasoning: `Step ${i}`,
        confidence: 0.9,
        expectedOutcome: 'Click button',
      },
      result: { success: true },
      beforeState: { pageType: 'form', pageDescription: 'Form' },
      afterState: { pageType: 'form', pageDescription: 'Form clicked' },
      verification: { success: true, confidence: 0.9, explanation: 'OK', stateChanged: true, progressMade: true, goalAchieved: false },
    })) as unknown as ActionRecord[];

    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      {},
      longHistory
    );

    expect(context.recentHistory.length).toBe(5);
    // Should be the LAST 5
    expect(context.recentHistory[0].reasoning).toBe('Step 5');
  });

  test('handles workflow without memory gracefully', () => {
    const context = createVisionExecutionContext(
      mockWorkflowMinimal,
      0,
      { test: 'value' },
      []
    );

    expect(context.task.name).toBe('Simple Click');
    expect(context.currentPhase.name).toBe('Phase 1');
    expect(context.totalPhases).toBe(1);
    expect(context.knowledge.rules.length).toBe(0);
    expect(context.experience.timesExecuted).toBe(0);
  });
});

describe('Memory Adapter - Helper Functions', () => {
  test('getPhaseCount returns correct count', () => {
    expect(getPhaseCount(mockWorkflowWithMemory)).toBe(3);
    expect(getPhaseCount(mockWorkflowMinimal)).toBe(1);
  });

  test('getPhase returns correct phase', () => {
    const phase = getPhase(mockWorkflowWithMemory, 1);
    expect(phase?.name).toBe('Fill Details');
    expect(phase?.stepIndices).toEqual([1]);

    const undefinedPhase = getPhase(mockWorkflowWithMemory, 99);
    expect(undefinedPhase).toBeUndefined();
  });

  test('hasRichMemory detects memory presence', () => {
    expect(hasRichMemory(mockWorkflowWithMemory)).toBe(true);
    expect(hasRichMemory(mockWorkflowMinimal)).toBe(false);
  });

  test('summarizeContext produces readable summary', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      0,
      { firstName: 'John' },
      []
    );

    const summary = summarizeContext(context);

    expect(summary).toContain('Task: Create CRM Contact');
    expect(summary).toContain('Phase: Open Form');
    expect(summary).toContain('1/3');
    expect(summary).toContain('Variables: firstName');
    expect(summary).toContain('80% success');
  });
});

describe('Memory Adapter - Edge Cases', () => {
  test('handles empty phases array', () => {
    const workflowEmptyPhases = {
      ...mockWorkflowWithMemory,
      memory: {
        ...mockWorkflowWithMemory.memory,
        understanding: { phases: [], elevator: '', entities: [] },
      },
    } as unknown as SavedWorkflow;

    const context = createVisionExecutionContext(workflowEmptyPhases, 0, {}, []);

    expect(context.currentPhase.name).toBe('Phase 1');
    expect(context.totalPhases).toBe(1);
  });

  test('handles missing aiAnalysis', () => {
    const workflowNoAnalysis = {
      ...mockWorkflowWithMemory,
      aiAnalysis: undefined,
    } as SavedWorkflow;

    const context = createVisionExecutionContext(workflowNoAnalysis, 0, {}, []);

    // Should still work, using fallback values
    expect(context.task.goal).toBeTruthy();
    expect(context.adaptations.length).toBeGreaterThan(0); // From memory fallbacks
  });

  test('handles missing learnedSkill', () => {
    const workflowNoSkill = {
      ...mockWorkflowWithMemory,
      learnedSkill: undefined,
    } as SavedWorkflow;

    const context = createVisionExecutionContext(workflowNoSkill, 0, {}, []);

    // Should still have rules from Q&A
    expect(context.knowledge.rules.some(r => r.includes('Lead Source'))).toBe(true);
  });

  test('phase index out of bounds uses default', () => {
    const context = createVisionExecutionContext(
      mockWorkflowWithMemory,
      99, // Out of bounds
      {},
      []
    );

    expect(context.currentPhase.name).toBe('Phase 100'); // Fallback naming
    expect(context.phaseIndex).toBe(99);
  });
});
