/**
 * Screen Analyzer
 *
 * Analyzes screenshots using AI vision to understand the screen state.
 * This is the "understanding" capability of the Eyes.
 */

import type { Screenshot, ScreenUnderstanding, PageType } from '../types';
import { extractBase64 } from './screenshot';

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
export function initVisionConfig(config: VisionConfig): void {
  visionConfig = config;
}

/**
 * Get the current vision config, with fallback to stored settings
 */
async function getVisionConfig(): Promise<VisionConfig> {
  if (visionConfig) {
    return visionConfig;
  }

  // Try to load from storage
  const stored = await chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey']);
  if (stored.supabaseUrl) {
    return {
      apiUrl: `${stored.supabaseUrl as string}/functions/v1/vision_analyze`,
      apiKey: stored.supabaseAnonKey as string | undefined,
    };
  }

  throw new Error('Vision API not configured. Call initVisionConfig() first.');
}

/**
 * Analyze a screenshot to understand the current screen state
 *
 * @param screenshot - The screenshot to analyze
 * @returns Full understanding of the screen
 */
export async function analyzeScreen(screenshot: Screenshot): Promise<ScreenUnderstanding> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'analyze_screen',
      screenshot: extractBase64(screenshot),
      context: {
        url: screenshot.url,
        title: screenshot.title,
        viewport: screenshot.viewport,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to analyze screen');
  }

  return result.result as ScreenUnderstanding;
}

/**
 * Get a simple description of the current screen
 *
 * @param screenshot - The screenshot to describe
 * @returns Natural language description
 */
export async function describeScreen(screenshot: Screenshot): Promise<string> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'describe_screen',
      screenshot: extractBase64(screenshot),
      context: {
        url: screenshot.url,
        title: screenshot.title,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to describe screen');
  }

  return result.result as string;
}

/**
 * Detect the type of page from a screenshot
 *
 * @param screenshot - The screenshot to analyze
 * @returns The detected page type
 */
export async function detectPageType(screenshot: Screenshot): Promise<PageType> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'detect_page_type',
      screenshot: extractBase64(screenshot),
      context: {
        url: screenshot.url,
        title: screenshot.title,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to detect page type');
  }

  return result.result as PageType;
}

/**
 * Quick check if page has changed significantly
 *
 * @param before - Screenshot before action
 * @param after - Screenshot after action
 * @returns True if significant change detected
 */
export async function hasPageChanged(before: Screenshot, after: Screenshot): Promise<boolean> {
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
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to compare screens');
  }

  return result.result.changed as boolean;
}

/**
 * Local fallback for basic screen analysis when API is unavailable
 * This provides minimal functionality for offline/error scenarios
 */
export function createBasicScreenUnderstanding(screenshot: Screenshot): ScreenUnderstanding {
  return {
    pageType: 'other',
    pageDescription: `Page at ${screenshot.url}`,
    applicationName: new URL(screenshot.url).hostname,
    components: [],
    state: {
      activeModal: null,
      activeDropdown: null,
      focusedElement: null,
      visibleErrors: [],
      visibleSuccess: [],
      isLoading: false,
    },
    formState: null,
    possibleActions: ['click', 'type', 'scroll'],
  };
}
