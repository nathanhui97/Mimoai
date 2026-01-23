/**
 * Brain Verifier
 *
 * Verifies that actions achieved their intended outcome.
 * Compares before/after screenshots to understand what happened.
 */

import type { Screenshot, VerificationResult, ActionIntent, ScreenUnderstanding } from '../types';
import { extractBase64 } from '../eyes/screenshot';

/**
 * Configuration for the vision API
 */
interface VisionConfig {
  apiUrl: string;
  apiKey?: string;
}

let visionConfig: VisionConfig | null = null;

/**
 * Initialize vision API configuration
 */
export function initVerifierConfig(config: VisionConfig): void {
  visionConfig = config;
}

/**
 * Get the current vision config
 */
async function getVisionConfig(): Promise<VisionConfig> {
  if (visionConfig) {
    return visionConfig;
  }

  const stored = await chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey']);
  if (stored.supabaseUrl) {
    return {
      apiUrl: `${stored.supabaseUrl as string}/functions/v1/vision_analyze`,
      apiKey: stored.supabaseAnonKey as string | undefined,
    };
  }

  throw new Error('Vision API not configured');
}

/**
 * Verify that an action achieved its intended outcome
 */
export async function verifyAction(
  beforeScreenshot: Screenshot,
  afterScreenshot: Screenshot,
  action: ActionIntent,
  expectedOutcome: string
): Promise<VerificationResult> {
  console.log('[Verifier] verifyAction called, getting config...');
  const config = await getVisionConfig();
  console.log('[Verifier] Config obtained, making API call to:', config.apiUrl);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      },
      body: JSON.stringify({
        type: 'verify_action',
        screenshots: {
          before: extractBase64(beforeScreenshot),
          after: extractBase64(afterScreenshot),
        },
        context: {
          action,
          expectedOutcome,
          beforeUrl: beforeScreenshot.url,
          afterUrl: afterScreenshot.url,
        },
      }),
    });

    console.log('[Verifier] API response status:', response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error('[Verifier] API error:', error);
      throw new Error(`Vision API error: ${error}`);
    }

    const result = await response.json();
    console.log('[Verifier] API result success:', result.success);

    if (!result.success) {
      // Return a failed verification
      return {
        success: false,
        confidence: 0,
        explanation: result.error || 'Failed to verify action',
        stateChanged: false,
        progressMade: false,
        goalAchieved: false,
      };
    }

    return result.result as VerificationResult;
  } catch (error) {
    console.error('[Verifier] verifyAction error:', error);
    throw error;
  }
}

/**
 * Quick check if the screen changed at all
 */
export async function didScreenChange(
  before: Screenshot,
  after: Screenshot
): Promise<{ changed: boolean; description: string }> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'compare_screens',
      screenshots: {
        before: extractBase64(before),
        after: extractBase64(after),
      },
    }),
  });

  if (!response.ok) {
    return { changed: true, description: 'Unable to compare' };
  }

  const result = await response.json();
  return result.result || { changed: false, description: 'No change detected' };
}

/**
 * Check for error states in the current screen
 */
export async function detectErrors(screenshot: Screenshot): Promise<{
  hasErrors: boolean;
  errors: string[];
}> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'detect_errors',
      screenshot: extractBase64(screenshot),
    }),
  });

  if (!response.ok) {
    return { hasErrors: false, errors: [] };
  }

  const result = await response.json();
  return result.result || { hasErrors: false, errors: [] };
}

/**
 * Check for success indicators in the current screen
 */
export async function detectSuccess(
  screenshot: Screenshot,
  expectedIndicators: string[]
): Promise<{
  hasSuccess: boolean;
  matchedIndicators: string[];
}> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'detect_success',
      screenshot: extractBase64(screenshot),
      context: {
        expectedIndicators,
      },
    }),
  });

  if (!response.ok) {
    return { hasSuccess: false, matchedIndicators: [] };
  }

  const result = await response.json();
  return result.result || { hasSuccess: false, matchedIndicators: [] };
}

/**
 * Verify a form field was filled correctly
 */
export async function verifyFieldFilled(
  screenshot: Screenshot,
  fieldDescription: string,
  expectedValue: string
): Promise<{
  filled: boolean;
  actualValue?: string;
  confidence: number;
}> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'verify_field',
      screenshot: extractBase64(screenshot),
      context: {
        fieldDescription,
        expectedValue,
      },
    }),
  });

  if (!response.ok) {
    return { filled: false, confidence: 0 };
  }

  const result = await response.json();
  return result.result || { filled: false, confidence: 0 };
}

/**
 * Local verification when API is unavailable
 * Uses basic heuristics to determine if action likely succeeded
 */
export function localVerification(
  beforeState: ScreenUnderstanding,
  afterState: ScreenUnderstanding,
  action: ActionIntent
): VerificationResult {
  // Check if URL changed
  const urlChanged = beforeState.pageDescription !== afterState.pageDescription;

  // Check if new errors appeared
  const newErrors = afterState.state.visibleErrors.filter(
    (e) => !beforeState.state.visibleErrors.includes(e)
  );

  // Check if success messages appeared
  const newSuccess = afterState.state.visibleSuccess.filter(
    (s) => !beforeState.state.visibleSuccess.includes(s)
  );

  // Loading state is available in beforeState.state.isLoading and afterState.state.isLoading
  // if needed for more sophisticated verification in the future

  // Basic success determination
  let success = false;
  let explanation = '';

  if (newErrors.length > 0) {
    success = false;
    explanation = `Errors appeared: ${newErrors.join(', ')}`;
  } else if (newSuccess.length > 0) {
    success = true;
    explanation = `Success indicators: ${newSuccess.join(', ')}`;
  } else if (urlChanged) {
    success = true;
    explanation = 'Page changed';
  } else if (action.type === 'type' && afterState.formState?.fields) {
    // Check if field now has value
    success = true;
    explanation = 'Text was typed';
  } else if (action.type === 'click') {
    // Assume click succeeded if no errors
    success = true;
    explanation = 'Click executed';
  } else {
    success = true;
    explanation = 'Action executed, no errors detected';
  }

  return {
    success,
    confidence: 0.5, // Low confidence for local verification
    explanation,
    stateChanged: urlChanged || newErrors.length > 0 || newSuccess.length > 0,
    progressMade: success && !newErrors.length,
    goalAchieved: false, // Can't determine this locally
    newErrors: newErrors.length > 0 ? newErrors : undefined,
    successIndicators: newSuccess.length > 0 ? newSuccess : undefined,
  };
}

/**
 * Wait and verify with retries
 * Useful when page is loading or updating
 */
export async function waitAndVerify(
  captureScreenshot: () => Promise<Screenshot>,
  action: ActionIntent,
  expectedOutcome: string,
  beforeScreenshot: Screenshot,
  maxAttempts: number = 3,
  delayMs: number = 500
): Promise<VerificationResult> {
  console.log(`[Verifier] waitAndVerify starting, maxAttempts=${maxAttempts}, delayMs=${delayMs}`);

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[Verifier] Attempt ${i + 1}/${maxAttempts}: waiting ${delayMs}ms...`);
    // Wait for potential page updates
    await delay(delayMs);

    // Capture new screenshot
    console.log(`[Verifier] Capturing after screenshot...`);
    const afterScreenshot = await captureScreenshot();
    console.log(`[Verifier] After screenshot captured, verifying action...`);

    // Verify
    const result = await verifyAction(
      beforeScreenshot,
      afterScreenshot,
      action,
      expectedOutcome
    );
    console.log(`[Verifier] Verification result:`, result.success, result.explanation);

    if (result.success || result.goalAchieved) {
      console.log(`[Verifier] Success! Returning result.`);
      return result;
    }

    // If no change and not last attempt, wait longer
    if (!result.stateChanged && i < maxAttempts - 1) {
      console.log(`[Verifier] No change detected, trying again...`);
      continue;
    }

    // If state changed but not successful, return the result
    if (result.stateChanged) {
      console.log(`[Verifier] State changed but not successful, returning result.`);
      return result;
    }
  }

  console.log(`[Verifier] All ${maxAttempts} attempts failed.`);
  // All attempts failed
  return {
    success: false,
    confidence: 0.5,
    explanation: 'Action did not produce expected result after multiple attempts',
    stateChanged: false,
    progressMade: false,
    goalAchieved: false,
  };
}

/**
 * Utility function for delays
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
