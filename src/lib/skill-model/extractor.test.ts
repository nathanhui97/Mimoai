import { describe, it, expect } from 'vitest';
import { SkillExtractor } from './extractor';
import type { WorkflowStep } from '../../types/workflow';
import type { WorkflowMemory } from '../workflow-memory/types';
import type { FormAudit, FormCompletionDiff } from '../../content/recording/form-auditor';

// ============================================================================
// Helpers
// ============================================================================

function makeInputStep(label: string, value: string, url: string = 'https://app.example.com/form'): WorkflowStep {
  return {
    type: 'INPUT',
    description: `Type "${value}" in ${label}`,
    payload: {
      label,
      value,
      selector: `#${label.toLowerCase().replace(/\s+/g, '-')}`,
      url,
    } as any,
  };
}

function makeClickStep(text: string, url: string = 'https://app.example.com/form', intent?: string): WorkflowStep {
  return {
    type: 'CLICK',
    description: `Click ${text}`,
    payload: {
      elementText: text,
      selector: `button.${text.toLowerCase().replace(/\s+/g, '-')}`,
      url,
      intent: intent ? { kind: intent } : undefined,
    } as any,
  };
}

function makeNavStep(url: string): WorkflowStep {
  return {
    type: 'NAVIGATION',
    description: `Navigate to ${url}`,
    payload: { url } as any,
  };
}

// ============================================================================
// SkillExtractor.extract()
// ============================================================================

describe('SkillExtractor.extract', () => {
  it('creates a SkillModel with correct metadata', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-1',
      steps: [makeInputStep('Name', 'John')],
    });

    expect(result.workflowId).toBe('test-1');
    expect(result.version).toBe('1.0');
    expect(result.generatedAt).toBeGreaterThan(0);
    expect(result.executionCount).toBe(0);
  });

  it('groups steps by page URL', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-2',
      steps: [
        makeInputStep('Name', 'John', 'https://app.example.com/page1'),
        makeInputStep('Email', 'john@test.com', 'https://app.example.com/page1'),
        makeInputStep('Status', 'Active', 'https://app.example.com/page2'),
      ],
    });

    expect(result.pages.length).toBe(2);
  });

  it('normalizes URLs when grouping (strips query params)', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-3',
      steps: [
        makeInputStep('Name', 'John', 'https://app.example.com/form?id=123'),
        makeInputStep('Email', 'john@test.com', 'https://app.example.com/form?id=123'),
      ],
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0].urlPattern).not.toContain('?');
  });

  it('extracts fields from INPUT steps', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-4',
      steps: [
        makeInputStep('First Name', 'John'),
        makeInputStep('Last Name', 'Doe'),
        makeInputStep('Email', 'john@test.com'),
      ],
    });

    const page = result.pages[0];
    expect(page.fields.length).toBe(3);
    expect(page.fields[0].fieldName).toBe('First Name');
    expect(page.fields[0].exampleValues).toContain('John');
    expect(page.fields[1].fieldName).toBe('Last Name');
    expect(page.fields[2].fieldName).toBe('Email');
  });

  it('classifies page as "form" when 2+ fields exist', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-5',
      steps: [
        makeInputStep('Name', 'John'),
        makeInputStep('Email', 'john@test.com'),
      ],
    });

    expect(result.pages[0].pageType).toBe('form');
  });

  it('detects submit actions from CLICK steps', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-6',
      steps: [
        makeInputStep('Name', 'John'),
        makeClickStep('Save', 'https://app.example.com/form', 'SUBMIT_FORM'),
      ],
    });

    const page = result.pages[0];
    expect(page.submitAction).toBeDefined();
    expect(page.submitAction!.text).toBe('Save');
    expect(page.submitAction!.waitAfterMs).toBe(1000);
  });

  it('detects submit by button text pattern', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-7',
      steps: [
        makeInputStep('Name', 'John'),
        makeClickStep('Submit'),
      ],
    });

    expect(result.pages[0].submitAction).toBeDefined();
    expect(result.pages[0].submitAction!.text).toBe('Submit');
  });

  it('classifies non-submit CLICK steps as navigation actions', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-8',
      steps: [
        makeClickStep('New Contact'),
        makeInputStep('Name', 'John'),
      ],
    });

    const page = result.pages[0];
    expect(page.actions.length).toBe(1);
    expect(page.actions[0].text).toBe('New Contact');
  });

  it('builds selectors from step payload', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-9',
      steps: [makeInputStep('Name', 'John')],
    });

    const field = result.pages[0].fields[0];
    expect(field.selectors.length).toBeGreaterThan(0);
    expect(field.selectors[0].selector).toBe('#name');
    expect(field.selectors[0].reliability).toBe(0.7);
  });

  it('avoids duplicate fields with the same name', () => {
    const result = SkillExtractor.extract({
      workflowId: 'test-10',
      steps: [
        makeInputStep('Name', 'John'),
        makeInputStep('Name', 'Jonathan'), // Same field, different value
      ],
    });

    // Should have only 1 field named "Name"
    const nameFields = result.pages[0].fields.filter(f => f.fieldName === 'Name');
    expect(nameFields.length).toBe(1);
  });

  it('uses executionCount from memory.experience', () => {
    const memory = {
      experience: { timesExecuted: 5 },
    } as any as WorkflowMemory;

    const result = SkillExtractor.extract({
      workflowId: 'test-11',
      steps: [makeInputStep('Name', 'John')],
      memory,
    });

    expect(result.executionCount).toBe(5);
  });
});

// ============================================================================
// SkillExtractor.extract() with FormAudit
// ============================================================================

describe('SkillExtractor.extract with FormAudit', () => {
  const formAudit: FormAudit = {
    capturedAt: Date.now(),
    url: 'https://app.example.com/form',
    formId: 'contact-form',
    totalFields: 4,
    requiredFields: 2,
    prefilledFields: 1,
    fields: [
      {
        label: 'First Name',
        name: 'firstName',
        selector: '#first-name',
        type: 'text',
        required: true,
        currentValue: '',
        isEmpty: true,
        isEnabled: true,
        isVisible: true,
        fieldOrder: 0,
      },
      {
        label: 'Last Name',
        name: 'lastName',
        selector: '#last-name',
        type: 'text',
        required: true,
        currentValue: '',
        isEmpty: true,
        isEnabled: true,
        isVisible: true,
        fieldOrder: 1,
      },
      {
        label: 'Phone',
        name: 'phone',
        selector: '#phone',
        type: 'phone' as any,
        required: false,
        currentValue: '',
        isEmpty: true,
        isEnabled: true,
        isVisible: true,
        fieldOrder: 2,
      },
      {
        label: 'Country',
        name: 'country',
        selector: '#country',
        type: 'select',
        required: false,
        options: ['US', 'UK', 'CA'],
        currentValue: 'US',
        isEmpty: false,
        isEnabled: true,
        isVisible: true,
        fieldOrder: 3,
      },
    ],
  };

  it('builds fields from form audit (complete picture)', () => {
    const result = SkillExtractor.extract({
      workflowId: 'audit-1',
      steps: [
        makeInputStep('First Name', 'John', 'https://app.example.com/form'),
        makeInputStep('Last Name', 'Doe', 'https://app.example.com/form'),
      ],
      formAudits: [formAudit],
    });

    const page = result.pages[0];
    // Should have 4 fields from audit (not just 2 from steps)
    expect(page.fields.length).toBe(4);
  });

  it('marks HTML-required fields correctly', () => {
    const result = SkillExtractor.extract({
      workflowId: 'audit-2',
      steps: [makeInputStep('First Name', 'John', 'https://app.example.com/form')],
      formAudits: [formAudit],
    });

    const firstName = result.pages[0].fields.find(f => f.fieldName === 'First Name');
    expect(firstName!.required).toBe(true);
    expect(firstName!.requiredSource).toBe('html_attribute');
    expect(firstName!.requiredConfidence).toBeGreaterThan(0.9);

    const phone = result.pages[0].fields.find(f => f.fieldName === 'Phone');
    // Phone is not HTML required, and user didn't fill it → stays not required
    expect(phone!.required).toBe(false);
  });

  it('detects pre-filled default values', () => {
    const result = SkillExtractor.extract({
      workflowId: 'audit-3',
      steps: [makeInputStep('First Name', 'John', 'https://app.example.com/form')],
      formAudits: [formAudit],
    });

    const country = result.pages[0].fields.find(f => f.fieldName === 'Country');
    expect(country!.defaultValue).toBe('US');
    expect(country!.keepsDefault).toBe(true); // User didn't change it
  });

  it('includes options for select fields', () => {
    const result = SkillExtractor.extract({
      workflowId: 'audit-4',
      steps: [makeInputStep('First Name', 'John', 'https://app.example.com/form')],
      formAudits: [formAudit],
    });

    const country = result.pages[0].fields.find(f => f.fieldName === 'Country');
    expect(country!.options).toEqual(['US', 'UK', 'CA']);
    expect(country!.strategy).toBe('select');
  });

  it('infers strategy from field type', () => {
    const result = SkillExtractor.extract({
      workflowId: 'audit-5',
      steps: [makeInputStep('First Name', 'John', 'https://app.example.com/form')],
      formAudits: [formAudit],
    });

    const firstName = result.pages[0].fields.find(f => f.fieldName === 'First Name');
    expect(firstName!.strategy).toBe('type'); // text → type

    const country = result.pages[0].fields.find(f => f.fieldName === 'Country');
    expect(country!.strategy).toBe('select');
  });
});

// ============================================================================
// SkillExtractor.refineFromExecution
// ============================================================================

describe('SkillExtractor.refineFromExecution', () => {
  it('increments execution count', () => {
    const skill = SkillExtractor.extract({
      workflowId: 'refine-1',
      steps: [makeInputStep('Name', 'John')],
    });

    const refined = SkillExtractor.refineFromExecution(skill, []);
    expect(refined.executionCount).toBe(skill.executionCount + 1);
  });

  it('updates selector reliability on success', () => {
    const skill = SkillExtractor.extract({
      workflowId: 'refine-2',
      steps: [makeInputStep('Name', 'John')],
    });

    const existingSelector = skill.pages[0].fields[0].selectors[0].selector;

    const refined = SkillExtractor.refineFromExecution(skill, [{
      stepIndex: 0,
      success: true,
      selectorUsed: existingSelector,
      method: 'css',
    }]);

    const field = refined.pages[0].fields[0];
    const selector = field.selectors.find(s => s.selector === existingSelector);
    expect(selector!.attemptCount).toBe(1);
    expect(selector!.successCount).toBe(1);
    expect(selector!.reliability).toBe(1.0);
  });

  it('adds new selectors discovered during execution', () => {
    const skill = SkillExtractor.extract({
      workflowId: 'refine-3',
      steps: [makeInputStep('Name', 'John')],
    });

    const initialSelectorCount = skill.pages[0].fields[0].selectors.length;

    const refined = SkillExtractor.refineFromExecution(skill, [{
      stepIndex: 0,
      success: true,
      selectorUsed: '[data-testid="name-input"]',
      method: 'data-testid',
    }]);

    const field = refined.pages[0].fields[0];
    expect(field.selectors.length).toBe(initialSelectorCount + 1);
    const newSelector = field.selectors.find(s => s.selector === '[data-testid="name-input"]');
    expect(newSelector).toBeDefined();
    expect(newSelector!.type).toBe('data-testid');
    expect(newSelector!.reliability).toBe(1.0);
  });

  it('tracks failures and computes reliability', () => {
    const skill = SkillExtractor.extract({
      workflowId: 'refine-4',
      steps: [makeInputStep('Name', 'John')],
    });

    const existingSelector = skill.pages[0].fields[0].selectors[0].selector;

    // First attempt: fail
    let refined = SkillExtractor.refineFromExecution(skill, [{
      stepIndex: 0,
      success: false,
      selectorUsed: existingSelector,
      method: 'css',
    }]);

    // Second attempt: success
    refined = SkillExtractor.refineFromExecution(refined, [{
      stepIndex: 0,
      success: true,
      selectorUsed: existingSelector,
      method: 'css',
    }]);

    const field = refined.pages[0].fields[0];
    const selector = field.selectors.find(s => s.selector === existingSelector);
    expect(selector!.attemptCount).toBe(2);
    expect(selector!.successCount).toBe(1);
    expect(selector!.reliability).toBe(0.5);
  });

  it('sorts selectors by reliability (best first)', () => {
    const skill = SkillExtractor.extract({
      workflowId: 'refine-5',
      steps: [makeInputStep('Name', 'John')],
    });

    // Add a highly reliable new selector
    let refined = SkillExtractor.refineFromExecution(skill, [
      { stepIndex: 0, success: true, selectorUsed: '[data-testid="best"]', method: 'data-testid' },
      { stepIndex: 0, success: true, selectorUsed: '[data-testid="best"]', method: 'data-testid' },
      { stepIndex: 0, success: true, selectorUsed: '[data-testid="best"]', method: 'data-testid' },
    ]);

    const field = refined.pages[0].fields[0];
    // Best selector should be first
    expect(field.selectors[0].selector).toBe('[data-testid="best"]');
    expect(field.selectors[0].reliability).toBe(1.0);
  });
});

// ============================================================================
// Selector Classification
// ============================================================================

describe('Selector classification', () => {
  it('classifies various selector types correctly', () => {
    // We can test this indirectly through extract
    const steps = [
      { type: 'INPUT' as const, description: 'test', payload: { label: 'A', value: 'a', selector: '#my-id', url: 'https://test.com' } as any },
      { type: 'INPUT' as const, description: 'test', payload: { label: 'B', value: 'b', selector: '[name="email"]', url: 'https://test.com' } as any },
      { type: 'INPUT' as const, description: 'test', payload: { label: 'C', value: 'c', selector: '[data-testid="phone"]', url: 'https://test.com' } as any },
      { type: 'INPUT' as const, description: 'test', payload: { label: 'D', value: 'd', selector: '[aria-label="notes"]', url: 'https://test.com' } as any },
      { type: 'INPUT' as const, description: 'test', payload: { label: 'E', value: 'e', selector: '.form-field input', url: 'https://test.com' } as any },
    ];

    const result = SkillExtractor.extract({ workflowId: 'sel', steps });
    const fields = result.pages[0].fields;

    expect(fields.find(f => f.fieldName === 'A')!.selectors[0].type).toBe('id');
    expect(fields.find(f => f.fieldName === 'B')!.selectors[0].type).toBe('name');
    expect(fields.find(f => f.fieldName === 'C')!.selectors[0].type).toBe('data-testid');
    expect(fields.find(f => f.fieldName === 'D')!.selectors[0].type).toBe('aria-label');
    expect(fields.find(f => f.fieldName === 'E')!.selectors[0].type).toBe('css');
  });
});
