/**
 * Phase 1: Skill Foundation Tests
 *
 * Tests the skill module to ensure:
 * 1. getSkill() extracts proper Skill from SavedWorkflow
 * 2. SkillIndex matches queries correctly
 * 3. All fields are populated as expected
 */

import { describe, it, expect } from 'vitest';
import { getSkill, getSkillSummary } from './skill-view';
import { buildSkillIndex, findSkillsForQuery, findBestSkillForQuery } from './skill-index';
import type { SavedWorkflow } from '../../types/workflow';
import type { WorkflowMemory } from '../workflow-memory/types';

// Mock workflow for testing
const createMockWorkflow = (overrides?: Partial<SavedWorkflow>): SavedWorkflow => ({
  id: 'test-workflow-1',
  name: 'Add Contact',
  description: 'Create a new contact in the CRM',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  steps: [
    {
      type: 'CLICK',
      description: 'Click New Contact button',
      payload: {
        selector: '#new-contact-btn',
        elementText: 'New Contact',
        elementRole: 'button',
        label: 'New Contact',
        timestamp: Date.now(),
        url: 'https://example.com/contacts',
      },
    },
    {
      type: 'INPUT',
      description: 'Type name',
      payload: {
        selector: '#name-field',
        value: 'John Smith',
        label: 'Name',
        timestamp: Date.now() + 1000,
        url: 'https://example.com/contacts/new',
      },
    },
    {
      type: 'CLICK',
      description: 'Click Save button',
      payload: {
        selector: '#save-btn',
        elementText: 'Save',
        elementRole: 'button',
        label: 'Save',
        timestamp: Date.now() + 2000,
        url: 'https://example.com/contacts/new',
      },
    },
  ],
  variables: {
    variables: [
      {
        fieldName: 'Name',
        variableName: 'contact_name',
        defaultValue: 'John Smith',
        inputType: 'text',
        stepIndex: 1,
        stepId: 'step-1',
        isVariable: true,
        confidence: 0.9,
      },
    ],
    detectedAt: Date.now(),
    analysisCount: 3,
  },
  memory: {
    version: '1.0',
    generatedAt: Date.now(),
    identity: {
      name: 'Add Contact',
      purpose: 'Create a new contact in the CRM system',
      domain: 'CRM',
      category: 'data_entry',
      tags: ['salesforce', 'contacts'],
    },
    understanding: {
      elevator: 'Adds a new contact to Salesforce with name and email',
      phases: [
        {
          name: 'Open Form',
          purpose: 'Open the contact creation form',
          stepIndices: [0],
          criticality: 'critical',
        },
        {
          name: 'Fill Details',
          purpose: 'Enter contact information',
          stepIndices: [1],
          criticality: 'critical',
        },
        {
          name: 'Save',
          purpose: 'Save the new contact',
          stepIndices: [2],
          criticality: 'critical',
        },
      ],
      entities: ['contact', 'form', 'CRM'],
    },
    inputs: {
      required: [
        {
          name: 'Name',
          variableName: 'contact_name',
          description: 'The contact full name',
          type: 'person_name',
          extractionHints: ['named', 'called', 'for'],
          exampleValues: ['John Smith', 'Jane Doe'],
          usedInSteps: [1],
        },
      ],
      optional: [],
    },
    triggers: {
      phrases: ['add contact', 'new contact', 'create contact'],
      verbSynonyms: ['add', 'create', 'new'],
      objectSynonyms: ['contact', 'person', 'customer'],
    },
    pattern: {
      type: 'single_entry',
    },
    success: {
      indicators: [
        {
          type: 'toast_appears',
          description: 'Success toast shows "Contact Created"',
          pattern: 'Contact.*created',
          priority: 'primary',
        },
      ],
      failureIndicators: ['Error message appears', 'Form validation failed'],
      endState: 'Contact appears in list, form is closed',
    },
    adaptability: {
      optionalSteps: [],
      reorderablePhases: false,
      handledVariations: ['with email', 'without phone'],
      fallbacks: [],
    },
    experience: {
      timesExecuted: 5,
      successfulExecutions: 4,
      successRate: 0.8,
      troubleSpots: [],
      provenStrategies: [],
    },
    clarifications: {
      collectedAt: Date.now(),
      items: [
        {
          questionId: 'q1',
          category: 'context',
          question: 'Who are these contacts?',
          answerValue: 'customers',
          answerText: 'New customers from sales calls',
        },
      ],
    },
  } as WorkflowMemory,
  ...overrides,
});

describe('Skill Foundation - Phase 1', () => {
  describe('getSkill()', () => {
    it('should extract basic skill properties', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.id).toBe('test-workflow-1');
      expect(skill.name).toBe('Add Contact');
      expect(skill.learnedAt).toBe(workflow.createdAt);
      expect(skill.updatedAt).toBe(workflow.updatedAt);
    });

    it('should extract goal from memory', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.goal.description).toBe('Create a new contact in the CRM system');
      expect(skill.goal.summary).toBe('Adds a new contact to Salesforce with name and email');
      expect(skill.goal.domain).toBe('CRM');
      expect(skill.goal.action).toBe('create');
    });

    it('should extract knowledge from clarifications', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.knowledge.rules.length).toBeGreaterThan(0);
      expect(skill.knowledge.rules[0].source).toBe('qa_answer');
      expect(skill.knowledge.rules[0].confidence).toBe(0.95);
    });

    it('should extract inputs from memory', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.inputs.required.length).toBe(1);
      expect(skill.inputs.required[0].name).toBe('Name');
      expect(skill.inputs.required[0].type).toBe('person_name');
      expect(skill.inputs.required[0].extractionHints).toContain('named');
    });

    it('should extract milestones from phases', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.milestones.length).toBe(3);
      expect(skill.milestones[0].name).toBe('Open Form');
      expect(skill.milestones[1].name).toBe('Fill Details');
      expect(skill.milestones[2].name).toBe('Save');
    });

    it('should extract success criteria', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.successCriteria.primary.type).toBe('toast_appears');
      expect(skill.successCriteria.primary.pattern).toBe('Contact.*created');
      expect(skill.successCriteria.failureIndicators).toContain('Error message appears');
    });

    it('should extract triggers', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.triggers.phrases).toContain('add contact');
      expect(skill.triggers.verbSynonyms).toContain('add');
      expect(skill.triggers.objectSynonyms).toContain('contact');
    });

    it('should extract demonstration steps', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.demonstration.totalSteps).toBe(3);
      expect(skill.demonstration.steps.length).toBe(3);
      expect(skill.demonstration.steps[0].action).toBe('click');
      expect(skill.demonstration.steps[1].action).toBe('type');
    });

    it('should extract experience', () => {
      const workflow = createMockWorkflow();
      const skill = getSkill(workflow);

      expect(skill.experience.timesExecuted).toBe(5);
      expect(skill.experience.successfulExecutions).toBe(4);
      expect(skill.experience.successRate).toBe(0.8);
    });

    it('should handle workflow without memory', () => {
      const workflow = createMockWorkflow({ memory: undefined });
      const skill = getSkill(workflow);

      // Should still extract basic info
      expect(skill.name).toBe('Add Contact');
      expect(skill.goal.description).toBe('Create a new contact in the CRM');

      // Should create default milestones
      expect(skill.milestones.length).toBeGreaterThan(0);

      // Should fall back to workflow variables for inputs
      expect(skill.inputs.required.length).toBe(0); // No memory = falls to variables
      expect(skill.inputs.optional.length).toBe(1); // Has default value = optional
    });
  });

  describe('getSkillSummary()', () => {
    it('should return lightweight summary', () => {
      const workflow = createMockWorkflow();
      const summary = getSkillSummary(workflow);

      expect(summary.id).toBe('test-workflow-1');
      expect(summary.name).toBe('Add Contact');
      expect(summary.goalSummary).toBe('Create a new contact in the CRM system');
      expect(summary.domain).toBe('CRM');
      expect(summary.triggers).toContain('add contact');
      expect(summary.inputNames).toContain('Name');
      expect(summary.successRate).toBe(0.8);
      expect(summary.isReady).toBe(true);
    });
  });

  describe('buildSkillIndex()', () => {
    it('should build phrase map', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      expect(index.phraseMap['add contact']).toContain('test-workflow-1');
      expect(index.phraseMap['new contact']).toContain('test-workflow-1');
    });

    it('should build domain map', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      expect(index.domainMap['CRM']).toContain('test-workflow-1');
    });

    it('should build verb+object combinations', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      // Should have "add contact", "add person", "create contact", etc.
      expect(index.phraseMap['add contact']).toContain('test-workflow-1');
      expect(index.phraseMap['create contact']).toContain('test-workflow-1');
    });
  });

  describe('findSkillsForQuery()', () => {
    it('should find exact phrase match', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const matches = findSkillsForQuery('add contact', index);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skillId).toBe('test-workflow-1');
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should find partial match', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const matches = findSkillsForQuery('create a new contact please', index);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].skillId).toBe('test-workflow-1');
    });

    it('should find by word overlap', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const matches = findSkillsForQuery('new customer entry', index);

      // Should match due to 'customer' in objectSynonyms
      expect(matches.length).toBeGreaterThan(0);
    });

    it('should return empty for unrelated query', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const matches = findSkillsForQuery('download report', index, { minConfidence: 0.5 });

      expect(matches.length).toBe(0);
    });

    it('should filter by domain', () => {
      const workflow1 = createMockWorkflow({ id: 'crm-1' });
      const workflow2 = createMockWorkflow({
        id: 'spreadsheet-1',
        memory: {
          ...createMockWorkflow().memory!,
          identity: {
            ...createMockWorkflow().memory!.identity,
            domain: 'Spreadsheet',
          },
        },
      });

      const skills = [getSkill(workflow1), getSkill(workflow2)];
      const index = buildSkillIndex(skills);

      const matches = findSkillsForQuery('add contact', index, { domain: 'CRM' });

      expect(matches.length).toBe(1);
      expect(matches[0].skillId).toBe('crm-1');
    });
  });

  describe('findBestSkillForQuery()', () => {
    it('should return best match', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const best = findBestSkillForQuery('add contact', index);

      expect(best).not.toBeNull();
      expect(best!.skillId).toBe('test-workflow-1');
    });

    it('should return null for no match', () => {
      const workflow = createMockWorkflow();
      const skills = [getSkill(workflow)];
      const index = buildSkillIndex(skills);

      const best = findBestSkillForQuery('fly to mars', index, { minConfidence: 0.8 });

      expect(best).toBeNull();
    });
  });
});
