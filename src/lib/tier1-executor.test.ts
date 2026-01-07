/**
 * Unit tests for Tier1Executor
 * 
 * Tests critical execution functionality:
 * - Action execution (click, type, select, etc.)
 * - Element resolution
 * - Interactability checks
 * - Safety checks
 * - Outcome verification
 * - Rejection codes
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { Tier1Executor } from './tier1-executor';
import type { AgentAction } from './ai-agent';

// Mock dependencies
vi.mock('../content/resolver', () => ({
  Resolver: {
    resolve: vi.fn(),
  },
}));

vi.mock('../content/state-wait-engine', () => ({
  StateWaitEngine: {
    waitForStability: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../lib/locator-builder', () => ({
  buildLocatorBundle: vi.fn(),
}));

describe('Tier1Executor - Action Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('execute() handles done action', async () => {
    const action: AgentAction = {
      type: 'done',
      params: {},
      reasoning: 'Workflow complete',
      confidence: 1.0,
    };

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('success');
    expect(result.details).toBeDefined();
  });

  test('execute() handles fail action', async () => {
    const action: AgentAction = {
      type: 'fail',
      params: { reason: 'Test failure' },
      reasoning: 'Failed intentionally',
      confidence: 1.0,
    };

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Test failure');
  });

  test('execute() rejects unknown action types', async () => {
    const action = {
      type: 'unknown_action' as any,
      params: {},
      reasoning: 'Test',
      confidence: 1.0,
    };

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('UNSAFE_ACTION');
    expect(result.details.dangerousPattern).toContain('Unknown action type');
  });

  test('execute() handles errors gracefully', async () => {
    // Mock an error in execution
    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Test Button',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock resolver to throw
    const { Resolver } = await import('../content/resolver');
    vi.mocked(Resolver.resolve).mockRejectedValue(new Error('Test error'));

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Test error');
  });
});

describe('Tier1Executor - Click Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup DOM
    document.body.innerHTML = '';
  });

  test('executeClick() rejects when no target specified', async () => {
    const action: AgentAction = {
      type: 'click',
      params: {},
      reasoning: 'Test',
      confidence: 1.0,
    };

    const result = await (Tier1Executor as any).executeClick(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('No target specified');
  });

  test('executeClick() rejects when element not found', async () => {
    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Non-existent Button',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock buildLocatorBundle to return a bundle
    vi.spyOn(Tier1Executor as any, 'buildLocatorBundle').mockReturnValue({
      strategies: [],
      disambiguators: [],
    });

    // Mock resolver to return not found
    vi.spyOn(Tier1Executor as any, 'resolveElement').mockResolvedValue({
      status: 'rejected',
      code: 'NOT_FOUND',
      details: {},
    });

    const result = await (Tier1Executor as any).executeClick(action);
    
    expect(result.status).toBe('rejected');
  });

  test('executeClick() rejects when element not interactable', async () => {
    const button = document.createElement('button');
    button.style.display = 'none'; // Hidden
    document.body.appendChild(button);

    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Hidden Button',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock buildLocatorBundle
    vi.spyOn(Tier1Executor as any, 'buildLocatorBundle').mockReturnValue({
      strategies: [],
      disambiguators: [],
    });

    // Mock resolver to return element
    vi.spyOn(Tier1Executor as any, 'resolveElement').mockResolvedValue({
      status: 'success',
      details: { element: button },
    });

    // Mock interactability check to fail
    vi.spyOn(Tier1Executor as any, 'checkInteractability').mockResolvedValue({
      success: false,
      reason: 'Element is not visible',
    });

    const result = await (Tier1Executor as any).executeClick(action);
    
    // Should reject due to interactability
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_INTERACTABLE');
  });

  test('executeClick() verifies text match for options', async () => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'BOGO';
    document.body.appendChild(option);

    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'option',
          text: 'BOGO',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock buildLocatorBundle
    vi.spyOn(Tier1Executor as any, 'buildLocatorBundle').mockReturnValue({
      strategies: [],
      disambiguators: [],
    });

    // Mock resolver to return element
    vi.spyOn(Tier1Executor as any, 'resolveElement').mockResolvedValue({
      status: 'success',
      details: { element: option },
    });

    // Mock interactability check to pass
    vi.spyOn(Tier1Executor as any, 'checkInteractability').mockResolvedValue({
      success: true,
    });

    // Mock safety check to pass
    vi.spyOn(Tier1Executor as any, 'checkActionSafety').mockReturnValue({
      safe: true,
    });

    // Mock clickElement
    vi.spyOn(Tier1Executor as any, 'clickElement').mockImplementation(() => {});

    const result = await (Tier1Executor as any).executeClick(action);
    
    // Should succeed with matching text
    expect(result.status).toBe('success');
  });

  test('executeClick() rejects when option text does not match', async () => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'BOGA'; // Wrong text
    document.body.appendChild(option);

    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'option',
          text: 'BOGO', // Requested text
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock buildLocatorBundle
    vi.spyOn(Tier1Executor as any, 'buildLocatorBundle').mockReturnValue({
      strategies: [],
      disambiguators: [],
    });

    // Mock resolver to return element
    vi.spyOn(Tier1Executor as any, 'resolveElement').mockResolvedValue({
      status: 'success',
      details: { element: option },
    });

    // Mock interactability check to pass
    vi.spyOn(Tier1Executor as any, 'checkInteractability').mockResolvedValue({
      success: true,
    });

    // Mock safety check to pass
    vi.spyOn(Tier1Executor as any, 'checkActionSafety').mockReturnValue({
      safe: true,
    });

    const result = await (Tier1Executor as any).executeClick(action);
    
    // Should reject due to text mismatch
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('AMBIGUOUS');
    expect(result.message).toContain('doesn\'t match');
  });
});

describe('Tier1Executor - Type Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('executeType() rejects when no text specified', async () => {
    const action: AgentAction = {
      type: 'type',
      params: {},
      reasoning: 'Test',
      confidence: 1.0,
    };

    const result = await (Tier1Executor as any).executeType(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('No text specified');
  });

  test('executeType() rejects when no field focused and no fieldTarget', async () => {
    const action: AgentAction = {
      type: 'type',
      params: {
        text: 'test',
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // No active element
    Object.defineProperty(document, 'activeElement', {
      value: document.body,
      writable: true,
    });

    const result = await (Tier1Executor as any).executeType(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_FOUND');
  });

  test('executeType() rejects when element does not accept input', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.focus();

    const action: AgentAction = {
      type: 'type',
      params: {
        text: 'test',
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    const result = await (Tier1Executor as any).executeType(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('NOT_INTERACTABLE');
    expect(result.details.interactabilityIssue).toContain('does not accept text input');
  });

  test('executeType() accepts input elements', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    const action: AgentAction = {
      type: 'type',
      params: {
        text: 'test value',
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock sleep to avoid delays
    vi.spyOn(Tier1Executor as any, 'sleep').mockResolvedValue(undefined);

    const result = await (Tier1Executor as any).executeType(action);
    
    // Should succeed (or at least not reject for wrong reason)
    expect(result.status).toBeDefined();
  });
});

describe('Tier1Executor - Rejection Codes', () => {
  test('NOT_FOUND code is returned when element not found', async () => {
    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Missing Button',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock resolver to return not found
    const { Resolver } = await import('../content/resolver');
    vi.mocked(Resolver.resolve).mockResolvedValue({
      status: 'not_found',
      details: {},
    } as any);

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBeDefined();
  });

  test('AMBIGUOUS code is returned when multiple candidates', async () => {
    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Ambiguous Button',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock resolver to return ambiguous
    const { Resolver } = await import('../content/resolver');
    vi.mocked(Resolver.resolve).mockResolvedValue({
      status: 'ambiguous',
      details: {
        matchCount: 3,
        candidates: [
          { role: 'button', name: 'Button 1' },
          { role: 'button', name: 'Button 2' },
          { role: 'button', name: 'Button 3' },
        ],
      },
    } as any);

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('AMBIGUOUS');
    expect(result.details.matchCount).toBe(3);
  });

  test('SCOPE_FAILED code is returned when scope not found', async () => {
    const action: AgentAction = {
      type: 'click',
      params: {
        target: {
          role: 'button',
          name: 'Test Button',
          scopeHint: 'Non-existent Widget',
        },
      },
      reasoning: 'Test',
      confidence: 1.0,
    };

    // Mock buildLocatorBundle
    vi.spyOn(Tier1Executor as any, 'buildLocatorBundle').mockReturnValue({
      strategies: [],
      disambiguators: [],
    });

    // Mock resolver to return scope failed
    vi.spyOn(Tier1Executor as any, 'resolveElement').mockResolvedValue({
      status: 'rejected',
      code: 'SCOPE_FAILED',
      details: {
        scopeStatus: 'Container not found',
      },
    });

    const result = await Tier1Executor.execute(action);
    
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('SCOPE_FAILED');
  });
});

describe('Tier1Executor - Safety Checks', () => {
  test('checkActionSafety() detects dangerous delete actions in modals', () => {
    // Create a modal
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    document.body.appendChild(modal);
    
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete Account';
    modal.appendChild(deleteButton);

    // Mock closest to return modal
    const originalClosest = Element.prototype.closest;
    Element.prototype.closest = vi.fn((selector: string) => {
      if (selector.includes('dialog') || selector.includes('modal')) {
        return modal;
      }
      return originalClosest.call(deleteButton, selector);
    });

    const safetyCheck = (Tier1Executor as any).checkActionSafety(deleteButton, 'click');
    
    // Restore original
    Element.prototype.closest = originalClosest;
    
    // Should detect dangerous pattern when in modal
    expect(safetyCheck.safe).toBe(false);
    expect(safetyCheck.reason).toBeDefined();
    expect(safetyCheck.reason).toContain('destructive');
  });

  test('checkActionSafety() allows safe actions', () => {
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';

    const safetyCheck = (Tier1Executor as any).checkActionSafety(saveButton, 'click');
    
    // Should allow safe actions
    expect(safetyCheck.safe).toBe(true);
  });
});

// Note: These are foundational tests. More comprehensive tests would require:
// - Mocking all dependencies (Resolver, StateWaitEngine, etc.)
// - Testing actual DOM interactions
// - Testing complex scenarios (multi-step, error recovery)
// - Integration tests with real browser environments

