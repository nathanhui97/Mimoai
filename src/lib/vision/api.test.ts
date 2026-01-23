/**
 * API Tests for Vision Analyze Edge Function
 *
 * These tests verify the edge function endpoints are working correctly.
 * Run with: npm run test:run src/lib/vision/api.test.ts
 *
 * NOTE: These tests call the actual deployed edge function.
 * Make sure GEMINI_API_KEY is configured in Supabase secrets.
 */

import { describe, test, expect } from 'vitest';

const EDGE_FUNCTION_URL = 'https://jfboagngbpzollcipewh.supabase.co/functions/v1/vision_analyze';
const AUTH_HEADER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmYm9hZ25nYnB6b2xsY2lwZXdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5OTIyMzMsImV4cCI6MjA4MDU2ODIzM30.CHHB1kvhiq4i063unS6_UdBLwLd8uXVi71id6hdelUI';

// 1x1 transparent PNG for testing (minimal image)
const TEST_SCREENSHOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Helper function to call the edge function
async function callVisionAnalyze(type: string, body: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_HEADER,
    },
    body: JSON.stringify({ type, ...body }),
  });

  return response.json();
}

describe('Vision Analyze API - Gemini Flash (Analysis)', () => {
  test('decide_action_rich returns valid action', async () => {
    const result = await callVisionAnalyze('decide_action_rich', {
      screenshot: TEST_SCREENSHOT,
      context: {
        task: { name: 'Test Login', goal: 'Log in successfully' },
        currentPhase: { name: 'Enter Credentials', intent: 'Fill login form' },
        knowledge: { rules: ['Wait for page load'], tips: [], warnings: [] },
        successCriteria: { indicators: [], failureIndicators: [], endState: 'Logged in' },
        variables: { username: 'testuser' },
        screenState: { pageType: 'login', pageDescription: 'Login page' },
        recentHistory: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const action = result.result as Record<string, unknown>;
    expect(action.action).toBeDefined();
    expect(action.reasoning).toBeDefined();
    expect(action.confidence).toBeDefined();
  }, 30000); // 30 second timeout for API call

  test('check_task_complete_rich returns completion status', async () => {
    const result = await callVisionAnalyze('check_task_complete_rich', {
      screenshot: TEST_SCREENSHOT,
      context: {
        task: { name: 'Test Login', goal: 'User sees dashboard' },
        successCriteria: {
          indicators: [{ description: 'Dashboard visible', priority: 'primary' }],
          failureIndicators: ['Error message'],
          endState: 'User sees dashboard',
        },
        screenState: { pageDescription: 'Login page - not logged in yet' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const completion = result.result as Record<string, unknown>;
    expect(typeof completion.complete).toBe('boolean');
    expect(typeof completion.confidence).toBe('number');
    expect(completion.reason).toBeDefined();
  }, 30000);

  test('check_phase_complete_rich returns phase status', async () => {
    const result = await callVisionAnalyze('check_phase_complete_rich', {
      screenshot: TEST_SCREENSHOT,
      context: {
        currentPhase: { name: 'Enter Credentials', intent: 'Fill the login form' },
        successCriteria: { indicators: [], failureIndicators: [], endState: 'Form filled' },
        screenState: { pageDescription: 'Login form with empty fields' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const completion = result.result as Record<string, unknown>;
    expect(typeof completion.complete).toBe('boolean');
  }, 30000);

  test('get_recovery_rich returns recovery suggestions', async () => {
    const result = await callVisionAnalyze('get_recovery_rich', {
      screenshot: TEST_SCREENSHOT,
      context: {
        stuckReason: 'Cannot find the Submit button',
        task: { name: 'Submit Form', goal: 'Submit the contact form' },
        currentPhase: { name: 'Submit', intent: 'Click submit button' },
        knowledge: { rules: [], tips: ['Button might be at bottom of form'], warnings: [] },
        adaptations: [{ scenario: 'Button not visible', howToAdapt: 'Scroll down' }],
        screenState: { pageDescription: 'Form page' },
        recentHistory: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const recovery = result.result as Record<string, unknown>;
    expect(Array.isArray(recovery.suggestions)).toBe(true);
    expect(typeof recovery.shouldAskUser).toBe('boolean');
  }, 30000);
});

describe('Vision Analyze API - Gemini Computer Use (Execution)', () => {
  test('execute_action returns function_call with coordinates', async () => {
    const result = await callVisionAnalyze('execute_action', {
      screenshot: TEST_SCREENSHOT,
      goal: 'Click the login button',
      context: {
        task: { name: 'Login', goal: 'Log into the application' },
        currentPhase: { name: 'Submit', intent: 'Click login button' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const execution = result.result as Record<string, unknown>;
    // Computer Use model returns action with name and args
    expect(execution.action || execution.done).toBeDefined();
    expect(typeof execution.thinking === 'string' || execution.thinking === '').toBe(true);
    expect(typeof execution.done).toBe('boolean');
  }, 60000); // 60 second timeout for Computer Use model

  test('execute_action_rich returns action with rich context', async () => {
    const result = await callVisionAnalyze('execute_action_rich', {
      screenshot: TEST_SCREENSHOT,
      context: {
        task: { name: 'Create Contact', goal: 'Add new contact to CRM' },
        currentPhase: {
          name: 'Fill Form',
          intent: 'Enter contact details',
          stepGuidance: [
            {
              stepIndex: 0,
              intent: 'Type first name',
              elementFindingStrategy: {
                lookingFor: 'First Name input field',
                searchContext: 'Contact form',
                distinguishers: ['Label "First Name"', 'Text input'],
              },
              expectedOutcome: 'Field is filled',
              alternatives: ['Look for "Given Name"'],
            },
          ],
        },
        knowledge: { rules: ['Lead Source should be Web'], tips: [], warnings: [] },
        successCriteria: { indicators: [], failureIndicators: [], endState: 'Contact created' },
        variables: { firstName: 'John', lastName: 'Doe' },
        recentHistory: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const execution = result.result as Record<string, unknown>;
    expect(execution.action || execution.done).toBeDefined();
  }, 60000);
});

describe('Vision Analyze API - Basic Analysis', () => {
  test('detect_page_type returns valid type', async () => {
    const result = await callVisionAnalyze('detect_page_type', {
      screenshot: TEST_SCREENSHOT,
      context: {},
    });

    expect(result.success).toBe(true);

    const validTypes = ['form', 'list', 'detail', 'dashboard', 'login', 'search', 'other'];
    expect(validTypes).toContain(result.result);
  }, 30000);

  test('detect_errors returns error check result', async () => {
    const result = await callVisionAnalyze('detect_errors', {
      screenshot: TEST_SCREENSHOT,
    });

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();

    const errors = result.result as Record<string, unknown>;
    expect(typeof errors.hasErrors).toBe('boolean');
    expect(Array.isArray(errors.errors)).toBe(true);
  }, 30000);
});

describe('Vision Analyze API - Error Handling', () => {
  test('unknown type returns error', async () => {
    const result = await callVisionAnalyze('invalid_type_xyz', {
      screenshot: TEST_SCREENSHOT,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown type');
  });

  test('missing screenshot for analysis handles gracefully', async () => {
    const result = await callVisionAnalyze('detect_page_type', {
      // No screenshot provided
      context: {},
    });

    // The API may return success with a default value or fail
    // Either response is acceptable - we just verify it doesn't crash
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  }, 30000);
});
