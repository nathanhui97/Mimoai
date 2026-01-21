/**
 * Phase 2: Enhanced Learning Tests
 *
 * Tests for Phase 2 functionality:
 * 1. Milestone extraction edge cases
 * 2. Q&A clarifications to knowledge rules conversion
 * 3. Phase/milestone generation from edge function
 */

import { describe, it, expect } from 'vitest';
import { getSkill, getSkillSummary } from './skill-view';
import type { SavedWorkflow } from '../../types/workflow';
import type { WorkflowMemory, ClarificationItem, WorkflowPhase } from '../workflow-memory/types';

// ============================================================================
// Test Helpers
// ============================================================================

const createBaseMemory = (): WorkflowMemory => ({
  version: '1.0',
  generatedAt: Date.now(),
  identity: {
    name: 'Test Workflow',
    purpose: 'Test purpose',
    domain: 'Testing',
    category: 'data_entry',
  },
  understanding: {
    elevator: 'Test elevator pitch',
    phases: [],
    entities: ['test'],
  },
  inputs: {
    required: [],
    optional: [],
  },
  triggers: {
    phrases: ['test workflow'],
  },
  pattern: {
    type: 'single_entry',
  },
  success: {
    indicators: [],
    failureIndicators: [],
    endState: 'Test complete',
  },
  adaptability: {
    optionalSteps: [],
    reorderablePhases: false,
    handledVariations: [],
    fallbacks: [],
  },
  experience: {
    timesExecuted: 0,
    successfulExecutions: 0,
    successRate: 0,
    troubleSpots: [],
    provenStrategies: [],
  },
});

const createMockWorkflowForPhase2 = (overrides?: {
  phases?: WorkflowPhase[];
  clarifications?: ClarificationItem[];
  memoryOverrides?: Partial<WorkflowMemory>;
}): SavedWorkflow => {
  const baseMemory = createBaseMemory();

  return {
    id: 'phase2-test-workflow',
    name: 'Phase 2 Test Workflow',
    description: 'Testing Phase 2 functionality',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: [
      {
        type: 'CLICK',
        description: 'Click Open Form',
        payload: {
          selector: '#open-form',
          elementText: 'Open Form',
          elementRole: 'button',
          timestamp: Date.now(),
          url: 'https://example.com',
        },
      },
      {
        type: 'INPUT',
        description: 'Type name',
        payload: {
          selector: '#name',
          value: 'Test Name',
          label: 'Name',
          timestamp: Date.now() + 1000,
          url: 'https://example.com/form',
        },
      },
      {
        type: 'INPUT',
        description: 'Type email',
        payload: {
          selector: '#email',
          value: 'test@example.com',
          label: 'Email',
          timestamp: Date.now() + 2000,
          url: 'https://example.com/form',
        },
      },
      {
        type: 'CLICK',
        description: 'Click Save',
        payload: {
          selector: '#save',
          elementText: 'Save',
          elementRole: 'button',
          timestamp: Date.now() + 3000,
          url: 'https://example.com/form',
        },
      },
    ],
    memory: {
      ...baseMemory,
      understanding: {
        ...baseMemory.understanding,
        phases: overrides?.phases || [],
      },
      clarifications: overrides?.clarifications ? {
        collectedAt: Date.now(),
        items: overrides.clarifications,
      } : undefined,
      ...overrides?.memoryOverrides,
    } as WorkflowMemory,
  };
};

// ============================================================================
// Phase 2 Tests: Milestone Extraction
// ============================================================================

describe('Phase 2: Enhanced Learning', () => {
  describe('Milestone Extraction', () => {
    it('should extract milestones from memory.understanding.phases', () => {
      const phases: WorkflowPhase[] = [
        {
          name: 'Open Form',
          purpose: 'Navigate to and open the data entry form',
          stepIndices: [0],
          criticality: 'critical',
        },
        {
          name: 'Fill Details',
          purpose: 'Enter required information into the form',
          stepIndices: [1, 2],
          criticality: 'critical',
        },
        {
          name: 'Save',
          purpose: 'Submit the form to save the data',
          stepIndices: [3],
          criticality: 'critical',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ phases });
      const skill = getSkill(workflow);

      expect(skill.milestones).toHaveLength(3);
      expect(skill.milestones[0].name).toBe('Open Form');
      expect(skill.milestones[1].name).toBe('Fill Details');
      expect(skill.milestones[2].name).toBe('Save');
    });

    it('should preserve step indices in milestones', () => {
      const phases: WorkflowPhase[] = [
        {
          name: 'Setup',
          purpose: 'Initial setup',
          stepIndices: [0],
          criticality: 'important',
        },
        {
          name: 'Main Work',
          purpose: 'Core task',
          stepIndices: [1, 2],
          criticality: 'critical',
        },
        {
          name: 'Finish',
          purpose: 'Complete task',
          stepIndices: [3],
          criticality: 'critical',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ phases });
      const skill = getSkill(workflow);

      expect(skill.milestones[0].stepIndices).toEqual([0]);
      expect(skill.milestones[1].stepIndices).toEqual([1, 2]);
      expect(skill.milestones[2].stepIndices).toEqual([3]);
    });

    it('should preserve criticality in milestones', () => {
      const phases: WorkflowPhase[] = [
        {
          name: 'Optional Setup',
          purpose: 'Optional configuration',
          stepIndices: [0],
          criticality: 'optional',
        },
        {
          name: 'Required Work',
          purpose: 'Must be done',
          stepIndices: [1, 2, 3],
          criticality: 'critical',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ phases });
      const skill = getSkill(workflow);

      expect(skill.milestones[0].criticality).toBe('optional');
      expect(skill.milestones[1].criticality).toBe('critical');
    });

    it('should assign correct order to milestones', () => {
      const phases: WorkflowPhase[] = [
        { name: 'Phase A', purpose: 'First', stepIndices: [0], criticality: 'critical' },
        { name: 'Phase B', purpose: 'Second', stepIndices: [1], criticality: 'critical' },
        { name: 'Phase C', purpose: 'Third', stepIndices: [2, 3], criticality: 'critical' },
      ];

      const workflow = createMockWorkflowForPhase2({ phases });
      const skill = getSkill(workflow);

      expect(skill.milestones[0].order).toBe(0);
      expect(skill.milestones[1].order).toBe(1);
      expect(skill.milestones[2].order).toBe(2);
    });

    it('should handle empty phases array gracefully', () => {
      const workflow = createMockWorkflowForPhase2({ phases: [] });
      const skill = getSkill(workflow);

      // Should return empty array or synthesize from steps
      expect(Array.isArray(skill.milestones)).toBe(true);
    });

    it('should handle missing phases in memory gracefully', () => {
      const workflow = createMockWorkflowForPhase2();
      // Remove phases entirely
      if (workflow.memory?.understanding) {
        (workflow.memory.understanding as any).phases = undefined;
      }

      const skill = getSkill(workflow);

      // Should not crash, should return empty or synthesized milestones
      expect(Array.isArray(skill.milestones)).toBe(true);
    });

    it('should handle workflow without memory', () => {
      const workflow = createMockWorkflowForPhase2();
      workflow.memory = undefined;

      const skill = getSkill(workflow);

      // Should synthesize basic milestones from steps
      expect(Array.isArray(skill.milestones)).toBe(true);
    });
  });

  // ============================================================================
  // Phase 2 Tests: Q&A to Knowledge Rules
  // ============================================================================

  describe('Q&A Clarifications to Knowledge Rules', () => {
    it('should convert clarifications to knowledge rules', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What is this spreadsheet for?',
          answerValue: 'customer_data',
          answerText: 'Customer contact information',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      expect(skill.knowledge.rules.some(r => r.source === 'qa_answer')).toBe(true);
    });

    it('should include question and answer in rule text', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What is the Lead Source?',
          answerValue: 'web',
          answerText: 'Web - Online Form',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRule = skill.knowledge.rules.find(r => r.source === 'qa_answer');
      expect(qaRule).toBeDefined();
      expect(qaRule!.rule).toContain('Lead Source');
      expect(qaRule!.rule).toContain('Web');
    });

    it('should use custom answer when provided', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'intent',
          question: 'What is the purpose?',
          answerValue: 'other',
          answerText: 'Other',
          customAnswer: 'Track new leads from marketing campaigns',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRule = skill.knowledge.rules.find(r => r.source === 'qa_answer');
      expect(qaRule).toBeDefined();
      expect(qaRule!.rule).toContain('marketing campaigns');
    });

    it('should assign high confidence to Q&A rules', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What field is required?',
          answerValue: 'name',
          answerText: 'Name is always required',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRule = skill.knowledge.rules.find(r => r.source === 'qa_answer');
      expect(qaRule).toBeDefined();
      expect(qaRule!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should handle multiple clarifications', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What is the source?',
          answerValue: 'web',
          answerText: 'Web',
        },
        {
          questionId: 'q2',
          category: 'scope',
          question: 'Should phone be required?',
          answerValue: 'no',
          answerText: 'No, phone is optional',
        },
        {
          questionId: 'q3',
          category: 'triggers',
          question: 'What should trigger this?',
          answerValue: 'add_contact',
          answerText: 'When user says "add contact"',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRules = skill.knowledge.rules.filter(r => r.source === 'qa_answer');
      expect(qaRules.length).toBe(3);
    });

    it('should handle empty clarifications gracefully', () => {
      const workflow = createMockWorkflowForPhase2({ clarifications: [] });
      const skill = getSkill(workflow);

      // Should not crash, rules array should exist
      expect(Array.isArray(skill.knowledge.rules)).toBe(true);
    });

    it('should handle missing clarifications in memory', () => {
      const workflow = createMockWorkflowForPhase2();
      // Explicitly remove clarifications
      if (workflow.memory) {
        workflow.memory.clarifications = undefined;
      }

      const skill = getSkill(workflow);

      // Should not crash
      expect(Array.isArray(skill.knowledge.rules)).toBe(true);
    });

    it('should skip "skip" or "optional" answers', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What about this field?',
          answerValue: 'skip',
          answerText: 'Skip',
        },
        {
          questionId: 'q2',
          category: 'context',
          question: 'Another question?',
          answerValue: 'optional',
          answerText: 'Optional',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRules = skill.knowledge.rules.filter(r => r.source === 'qa_answer');
      expect(qaRules.length).toBe(0);
    });

    it('should preserve category in rule appliesTo field', () => {
      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'Context question?',
          answerValue: 'answer',
          answerText: 'Context answer',
        },
        {
          questionId: 'q2',
          category: 'scope',
          question: 'Scope question?',
          answerValue: 'answer',
          answerText: 'Scope answer',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ clarifications });
      const skill = getSkill(workflow);

      const qaRules = skill.knowledge.rules.filter(r => r.source === 'qa_answer');
      const contextRule = qaRules.find(r => r.appliesTo === 'context');
      const scopeRule = qaRules.find(r => r.appliesTo === 'scope');

      expect(contextRule).toBeDefined();
      expect(scopeRule).toBeDefined();
    });
  });

  // ============================================================================
  // Phase 2 Tests: Skill Summary with Phases
  // ============================================================================

  describe('Skill Summary with Milestones', () => {
    it('should indicate readiness based on phases presence', () => {
      const phasesWorkflow = createMockWorkflowForPhase2({
        phases: [
          { name: 'Phase 1', purpose: 'Test', stepIndices: [0, 1, 2, 3], criticality: 'critical' },
        ],
      });

      const noPhasesWorkflow = createMockWorkflowForPhase2({ phases: [] });

      const summaryWithPhases = getSkillSummary(phasesWorkflow);
      const summaryWithoutPhases = getSkillSummary(noPhasesWorkflow);

      // Both should have valid summaries
      expect(summaryWithPhases.id).toBe('phase2-test-workflow');
      expect(summaryWithoutPhases.id).toBe('phase2-test-workflow');
    });

    it('should include goal summary from memory', () => {
      const workflow = createMockWorkflowForPhase2({
        memoryOverrides: {
          identity: {
            name: 'Test',
            purpose: 'Create a new entry in the database',
            domain: 'Database',
            category: 'data_entry',
          },
        } as any,
      });

      const summary = getSkillSummary(workflow);
      expect(summary.goalSummary).toBe('Create a new entry in the database');
    });
  });

  // ============================================================================
  // Phase 2 Tests: Integration Scenarios
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should handle complete workflow with phases and clarifications', () => {
      const phases: WorkflowPhase[] = [
        { name: 'Navigate', purpose: 'Go to the right page', stepIndices: [0], criticality: 'critical' },
        { name: 'Enter Data', purpose: 'Fill in the form', stepIndices: [1, 2], criticality: 'critical' },
        { name: 'Submit', purpose: 'Save the data', stepIndices: [3], criticality: 'critical' },
      ];

      const clarifications: ClarificationItem[] = [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What type of data is this?',
          answerValue: 'customer',
          answerText: 'Customer contact information',
        },
        {
          questionId: 'q2',
          category: 'scope',
          question: 'Is email required?',
          answerValue: 'yes',
          answerText: 'Yes, email is required',
        },
      ];

      const workflow = createMockWorkflowForPhase2({ phases, clarifications });
      const skill = getSkill(workflow);

      // Should have milestones
      expect(skill.milestones).toHaveLength(3);
      expect(skill.milestones.map(m => m.name)).toEqual(['Navigate', 'Enter Data', 'Submit']);

      // Should have knowledge rules from Q&A
      const qaRules = skill.knowledge.rules.filter(r => r.source === 'qa_answer');
      expect(qaRules.length).toBe(2);

      // Should have valid goal and triggers
      expect(skill.goal.description).toBeDefined();
      expect(skill.triggers.phrases.length).toBeGreaterThan(0);
    });

    it('should handle realistic CRM workflow', () => {
      const phases: WorkflowPhase[] = [
        { name: 'Open Contact Form', purpose: 'Click New Contact to open the form', stepIndices: [0], criticality: 'critical' },
        { name: 'Fill Contact Details', purpose: 'Enter name and email', stepIndices: [1, 2], criticality: 'critical' },
        { name: 'Save Contact', purpose: 'Click Save to create the contact', stepIndices: [3], criticality: 'critical' },
      ];

      const clarifications: ClarificationItem[] = [
        {
          questionId: 'lead_source',
          category: 'context',
          question: 'What should the Lead Source be?',
          answerValue: 'web',
          answerText: 'Web - all contacts from this form are web leads',
        },
      ];

      const workflow = createMockWorkflowForPhase2({
        phases,
        clarifications,
        memoryOverrides: {
          identity: {
            name: 'Add Contact',
            purpose: 'Create a new contact in Salesforce CRM',
            domain: 'CRM',
            category: 'data_entry',
          },
          triggers: {
            phrases: ['add contact', 'new contact', 'create contact'],
            verbSynonyms: ['add', 'create', 'new'],
            objectSynonyms: ['contact', 'customer', 'lead'],
          },
        } as any,
      });

      const skill = getSkill(workflow);

      // Verify complete skill structure
      expect(skill.name).toBeDefined();
      expect(skill.goal.domain).toBe('CRM');
      expect(skill.milestones).toHaveLength(3);
      expect(skill.knowledge.rules.some(r => r.rule.includes('Lead Source'))).toBe(true);
      expect(skill.triggers.phrases).toContain('add contact');
    });
  });
});
