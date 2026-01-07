/**
 * Unit tests for AIAgent
 * 
 * Tests critical AI agent functionality:
 * - Workflow execution
 * - Page observation
 * - Action selection
 * - Hint extraction
 * - Goal inference
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { AIAgent } from './ai-agent';
import type { SavedWorkflow } from '../types/workflow';

// Mock dependencies
vi.mock('./ai-config', () => ({
  aiConfig: {
    isEnabled: vi.fn(() => true),
    getProjectUrl: vi.fn(() => 'https://test.supabase.co'),
  },
}));

vi.mock('../content/visual-snapshot', () => ({
  VisualSnapshotService: {
    captureViewport: vi.fn(() => Promise.resolve('base64-screenshot')),
    isSpreadsheetDomain: vi.fn(() => false),
  },
}));

vi.mock('../content/dom-map', async () => {
  const actual = await vi.importActual('../content/dom-map');
  const mockElement = {
    tag: 'button',
    text: 'Submit',
    role: 'button',
    name: 'Submit',
    interactive: true,
    frameId: 0,
    attrs: { 'data-testid': 'submit-btn' },
  };
  const mockDOMMap = {
    url: 'https://example.com',
    title: 'Test Page',
    interactiveElements: [mockElement],
    formFields: [],
    headings: [],
    regions: [],
    tables: [],
    timestamp: Date.now(),
  };
  return {
    ...actual,
    generateDOMMap: vi.fn(() => mockDOMMap),
    generateDOMMapWithIframes: vi.fn(() => Promise.resolve(mockDOMMap)),
    domMapToText: vi.fn(() => '[button] "Submit"'),
  };
});

vi.mock('./feature-flags', () => ({
  FeatureFlags: {
    VISION_CLICKER: false,
  },
}));

vi.mock('./tier1-executor', () => ({
  Tier1Executor: {
    execute: vi.fn(() => Promise.resolve({
      success: true,
      element: document.createElement('button'),
    })),
  },
}));

vi.mock('./spreadsheet-executor', () => ({
  SpreadsheetExecutor: {
    isSpreadsheetDomain: vi.fn(() => false),
  },
}));

describe('AIAgent - Initialization', () => {
  test('creates agent with default options', () => {
    const agent = new AIAgent();
    expect(agent).toBeInstanceOf(AIAgent);
  });

  test('creates agent with custom maxSteps', () => {
    const agent = new AIAgent({ maxSteps: 100 });
    expect(agent).toBeInstanceOf(AIAgent);
  });

  test('creates agent with progress callback', () => {
    const onProgress = vi.fn();
    const agent = new AIAgent({ onProgress });
    expect(agent).toBeInstanceOf(AIAgent);
  });
});

describe('AIAgent - Goal Inference', () => {
  let agent: AIAgent;

  beforeEach(() => {
    agent = new AIAgent();
  });

  test('infers goal from workflow steps', () => {
    const workflow: SavedWorkflow = {
      id: 'test-1',
      name: 'Test Workflow',
      steps: [
        {
          type: 'CLICK',
          payload: {
            selector: 'button',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
        {
          type: 'INPUT',
          payload: {
            selector: 'input',
            value: 'test',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const goal = (agent as any).inferGoal(workflow);
    expect(goal).toBeTruthy();
    expect(typeof goal).toBe('string');
  });

  test('infers goal from workflow name if available', () => {
    const workflow: SavedWorkflow = {
      id: 'test-2',
      name: 'Login to Salesforce',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const goal = (agent as any).inferGoal(workflow);
    expect(goal).toContain('Login');
  });
});

describe('AIAgent - Hint Extraction', () => {
  let agent: AIAgent;

  beforeEach(() => {
    agent = new AIAgent();
  });

  test('extracts hints from workflow steps', () => {
    const workflow: SavedWorkflow = {
      id: 'test-1',
      name: 'Test Workflow',
      steps: [
        {
          type: 'CLICK',
          payload: {
            selector: '[data-testid="submit"]',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const hints = (agent as any).extractHints(workflow);
    expect(hints).toBeInstanceOf(Array);
    expect(hints.length).toBeGreaterThan(0);
  });

  test('extracts hints with variable substitution', () => {
    const workflow: SavedWorkflow = {
      id: 'test-2',
      name: 'Test Workflow',
      steps: [
        {
          type: 'INPUT',
          payload: {
            selector: 'input[name="email"]',
            value: '{{email}}',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const variableValues = { email: 'test@example.com' };
    const hints = (agent as any).extractHints(workflow, variableValues);
    
    expect(hints).toBeInstanceOf(Array);
    expect(hints.length).toBeGreaterThan(0);
    // Variable should be substituted in hint description or value
    const inputHint = hints.find((h: any) => 
      h.description?.includes('input') || 
      h.description?.includes('email') ||
      h.description?.includes('test@example.com')
    );
    expect(inputHint).toBeDefined();
  });

  test('extracts hints with step numbers', () => {
    const workflow: SavedWorkflow = {
      id: 'test-3',
      name: 'Test Workflow',
      steps: [
        {
          type: 'CLICK',
          payload: {
            selector: 'button',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
        {
          type: 'INPUT',
          payload: {
            selector: 'input',
            value: 'test',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const hints = (agent as any).extractHints(workflow);
    expect(hints.length).toBeGreaterThanOrEqual(2);
    // Step numbers are 1-based in the actual implementation
    expect(hints[0].stepNumber).toBeGreaterThanOrEqual(0);
    expect(hints[1].stepNumber).toBeGreaterThan(hints[0].stepNumber);
  });
});

describe('AIAgent - Observation', () => {
  let agent: AIAgent;

  beforeEach(() => {
    // Setup DOM mocks
    Object.defineProperty(window, 'location', {
      value: { href: 'https://example.com' },
      writable: true,
    });
    Object.defineProperty(document, 'title', {
      value: 'Test Page',
      writable: true,
    });
    
    agent = new AIAgent();
  });

  test('observes current page state', async () => {
    const observation = await (agent as any).observe();
    
    expect(observation).toBeDefined();
    expect(observation.url).toBe('https://example.com');
    expect(observation.title).toBe('Test Page');
    expect(observation.domMapText).toBeDefined();
  });

  test('observation includes DOM map', async () => {
    const observation = await (agent as any).observe();
    
    expect(observation.domMapText).toBeTruthy();
    expect(typeof observation.domMapText).toBe('string');
  });

  test('observation includes viewport size', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true });
    
    const observation = await (agent as any).observe();
    
    expect(observation.viewportSize).toBeDefined();
    expect(observation.viewportSize.width).toBe(1920);
    expect(observation.viewportSize.height).toBe(1080);
  });

  test('observation includes timestamp', async () => {
    const before = Date.now();
    const observation = await (agent as any).observe();
    const after = Date.now();
    
    expect(observation.timestamp).toBeGreaterThanOrEqual(before);
    expect(observation.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('AIAgent - Workflow Execution', () => {
  let agent: AIAgent;

  beforeEach(() => {
    agent = new AIAgent({ maxSteps: 10 });
  });

  test('run() initializes state correctly', async () => {
    const workflow: SavedWorkflow = {
      id: 'test-1',
      name: 'Test Workflow',
      steps: [
        {
          type: 'CLICK',
          payload: {
            selector: 'button',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Mock continueExecution to return immediately
    vi.spyOn(agent as any, 'continueExecution').mockResolvedValue({
      success: true,
      stepsCompleted: 1,
      totalSteps: 1,
      history: [],
      elapsedMs: 100,
      finalStatus: 'completed',
    });

    const result = await agent.run(workflow);
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.totalSteps).toBe(1);
  });

  test('run() handles empty workflow', async () => {
    const workflow: SavedWorkflow = {
      id: 'test-2',
      name: 'Empty Workflow',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    vi.spyOn(agent as any, 'continueExecution').mockResolvedValue({
      success: true,
      stepsCompleted: 0,
      totalSteps: 0,
      history: [],
      elapsedMs: 0,
      finalStatus: 'completed',
    });

    const result = await agent.run(workflow);
    
    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(0);
  });

  test('run() handles variable values', async () => {
    const workflow: SavedWorkflow = {
      id: 'test-3',
      name: 'Test Workflow',
      steps: [
        {
          type: 'INPUT',
          payload: {
            selector: 'input',
            value: '{{email}}',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const variableValues = { email: 'test@example.com' };

    vi.spyOn(agent as any, 'continueExecution').mockResolvedValue({
      success: true,
      stepsCompleted: 1,
      totalSteps: 1,
      history: [],
      elapsedMs: 100,
      finalStatus: 'completed',
    });

    const result = await agent.run(workflow, variableValues);
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});

describe('AIAgent - State Management', () => {
  let agent: AIAgent;

  beforeEach(() => {
    agent = new AIAgent();
  });

  test('getState() returns current state', () => {
    const state = (agent as any).getState();
    
    expect(state).toBeDefined();
    expect(state.status).toBe('paused');
    expect(state.hints).toEqual([]);
    expect(state.history).toEqual([]);
  });

  test('state is initialized correctly after run()', async () => {
    const workflow: SavedWorkflow = {
      id: 'test-1',
      name: 'Test Workflow',
      steps: [
        {
          type: 'CLICK',
          payload: {
            selector: 'button',
            timestamp: Date.now(),
            url: 'https://example.com',
          },
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    vi.spyOn(agent as any, 'continueExecution').mockResolvedValue({
      success: true,
      stepsCompleted: 1,
      totalSteps: 1,
      history: [],
      elapsedMs: 100,
      finalStatus: 'completed',
    });

    await agent.run(workflow);
    
    const state = (agent as any).getState();
    expect(state.workflowId).toBe('test-1');
    expect(state.goal).toBeTruthy();
    expect(state.hints.length).toBeGreaterThan(0);
  });
});

// Note: These are foundational tests. More comprehensive tests would require:
// - Mocking Supabase Edge Functions
// - Testing actual DOM interactions
// - Testing complex workflows with multiple steps
// - Testing error scenarios and recovery
// - Integration tests with real browser environments

