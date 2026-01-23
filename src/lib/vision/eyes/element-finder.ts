/**
 * Element Finder
 *
 * Locates elements on screen using AI vision based on descriptions.
 * Returns coordinates for CDP actions - no DOM access.
 */

import type { Screenshot, ElementLocation, BoundingBoxWithCenter } from '../types';
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
export function initElementFinderConfig(config: VisionConfig): void {
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
 * Find a single element by description
 *
 * @param screenshot - Current screenshot
 * @param description - Natural language description of element to find
 * @param context - Optional additional context
 * @returns Location of the element with click coordinates
 */
export async function findElement(
  screenshot: Screenshot,
  description: string,
  context?: {
    fieldType?: string;
    expectedValue?: string;
    nearText?: string;
  }
): Promise<ElementLocation> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'find_element',
      screenshot: extractBase64(screenshot),
      description,
      context: {
        ...context,
        viewport: screenshot.viewport,
        url: screenshot.url,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    // Return a "not found" result rather than throwing
    return {
      found: false,
      confidence: 0,
      description: result.error || `Could not find: ${description}`,
    };
  }

  return result.result as ElementLocation;
}

/**
 * Find all elements matching a description
 *
 * @param screenshot - Current screenshot
 * @param description - Natural language description of elements
 * @returns Array of element locations
 */
export async function findAllElements(
  screenshot: Screenshot,
  description: string
): Promise<ElementLocation[]> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'find_all_elements',
      screenshot: extractBase64(screenshot),
      description,
      context: {
        viewport: screenshot.viewport,
        url: screenshot.url,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${error}`);
  }

  const result = await response.json();

  if (!result.success) {
    return [];
  }

  return result.result as ElementLocation[];
}

/**
 * Find element by semantic type (for form filling)
 *
 * @param screenshot - Current screenshot
 * @param fieldType - Type of field (email, password, date, etc.)
 * @param label - Optional label text
 * @returns Location of the field
 */
export async function findFormField(
  screenshot: Screenshot,
  fieldType: string,
  label?: string
): Promise<ElementLocation> {
  const description = label
    ? `${fieldType} input field with label "${label}"`
    : `${fieldType} input field`;

  return findElement(screenshot, description, { fieldType });
}

/**
 * Find a button by its label
 *
 * @param screenshot - Current screenshot
 * @param buttonText - Text on the button
 * @returns Location of the button
 */
export async function findButton(
  screenshot: Screenshot,
  buttonText: string
): Promise<ElementLocation> {
  return findElement(screenshot, `button with text "${buttonText}"`, {
    fieldType: 'button',
  });
}

/**
 * Find a link by its text
 *
 * @param screenshot - Current screenshot
 * @param linkText - Text of the link
 * @returns Location of the link
 */
export async function findLink(screenshot: Screenshot, linkText: string): Promise<ElementLocation> {
  return findElement(screenshot, `link with text "${linkText}"`, {
    fieldType: 'link',
  });
}

/**
 * Find checkbox by label
 *
 * @param screenshot - Current screenshot
 * @param label - Label text for the checkbox
 * @returns Location of the checkbox
 */
export async function findCheckbox(
  screenshot: Screenshot,
  label: string
): Promise<ElementLocation> {
  return findElement(screenshot, `checkbox with label "${label}"`, {
    fieldType: 'checkbox',
  });
}

/**
 * Find dropdown/select by label
 *
 * @param screenshot - Current screenshot
 * @param label - Label text for the dropdown
 * @returns Location of the dropdown
 */
export async function findDropdown(
  screenshot: Screenshot,
  label: string
): Promise<ElementLocation> {
  return findElement(screenshot, `dropdown or select field with label "${label}"`, {
    fieldType: 'dropdown',
  });
}

/**
 * Find a specific option within an open dropdown
 *
 * @param screenshot - Current screenshot (with dropdown open)
 * @param optionText - Text of the option to select
 * @returns Location of the option
 */
export async function findDropdownOption(
  screenshot: Screenshot,
  optionText: string
): Promise<ElementLocation> {
  return findElement(screenshot, `dropdown option with text "${optionText}"`, {
    fieldType: 'dropdown-option',
  });
}

/**
 * Find date picker and its controls
 *
 * @param screenshot - Current screenshot
 * @param label - Label for the date field
 * @returns Location of date picker trigger
 */
export async function findDatePicker(
  screenshot: Screenshot,
  label?: string
): Promise<ElementLocation> {
  const description = label
    ? `date picker field with label "${label}"`
    : 'date picker field or calendar input';

  return findElement(screenshot, description, { fieldType: 'date-picker' });
}

/**
 * Find a specific date within an open calendar
 *
 * @param screenshot - Current screenshot (with calendar open)
 * @param day - Day number to select
 * @param month - Optional month name if visible
 * @returns Location of the date cell
 */
export async function findCalendarDate(
  screenshot: Screenshot,
  day: number,
  month?: string
): Promise<ElementLocation> {
  const description = month
    ? `calendar date cell for day ${day} in ${month}`
    : `calendar date cell for day ${day}`;

  return findElement(screenshot, description, { fieldType: 'calendar-date' });
}

/**
 * Calculate center point of a bounding box
 */
export function getBoundingBoxCenter(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): BoundingBoxWithCenter {
  return {
    ...box,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
}

/**
 * Get click coordinates from element location
 * Returns the center point for clicking
 */
export function getClickCoordinates(location: ElementLocation): { x: number; y: number } | null {
  if (!location.found || !location.boundingBox) {
    return null;
  }

  return {
    x: location.boundingBox.centerX,
    y: location.boundingBox.centerY,
  };
}
