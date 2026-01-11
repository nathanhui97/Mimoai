/**
 * Label Extraction Utilities
 * 
 * Centralized utilities for extracting element labels from various sources.
 * This ensures consistent handling across the codebase.
 */

import type { AIEvidence } from '../types/workflow';

/**
 * Get element label from multiple sources with priority order.
 * 
 * Priority order:
 * 1. ariaLabel - Explicit accessibility label (most reliable)
 * 2. textLabel - Human-readable label from associated <label> element
 * 3. payloadLabel - Field label captured during recording
 * 4. aria-label attribute - From context.uniqueAttributes
 * 5. formCoordinates.label - From form context (Salesforce SLDS fields)
 * 6. placeholder - Last resort for text inputs
 * 
 * @param aiEvidence - AI evidence from workflow step
 * @param payloadLabel - Label from step payload
 * @param uniqueAttributes - Unique attributes from context
 * @param formCoordinates - Form context with label info
 * @param placeholder - Element placeholder as fallback
 * @returns The first available label, or undefined if none found
 * 
 * @example
 * // INPUT field with textLabel
 * getElementLabel({ semanticAnchors: { textLabel: '*Account Name' } })
 * // Returns: '*Account Name'
 * 
 * @example
 * // Combobox with ariaLabel
 * getElementLabel({ semanticAnchors: { ariaLabel: 'Account Status' } })
 * // Returns: 'Account Status'
 */
export function getElementLabel(
  aiEvidence?: AIEvidence,
  payloadLabel?: string,
  uniqueAttributes?: Record<string, string>,
  formCoordinates?: { label?: string },
  placeholder?: string
): string | undefined {
  const ariaLabel = aiEvidence?.semanticAnchors?.ariaLabel;
  const textLabel = aiEvidence?.semanticAnchors?.textLabel;
  
  // Check if textLabel is "dirty" (contains validation messages, duplicates, etc.)
  const textLabelIsDirty = textLabel && (
    // Contains common validation messages
    textLabel.includes('Complete this field') ||
    textLabel.includes('required') ||
    textLabel.includes('invalid') ||
    textLabel.includes('error') ||
    // Contains duplicated text (like "*Account NameAccount Name")
    /(.{3,})\1/.test(textLabel) ||
    // Too long to be a clean label (likely concatenated text)
    textLabel.length > 50
  );
  
  // If textLabel is dirty but payloadLabel is clean, prefer payloadLabel
  if (textLabelIsDirty && payloadLabel && payloadLabel.length < 50) {
    console.log(`[LabelUtils] Preferring payloadLabel "${payloadLabel}" over dirty textLabel "${textLabel.substring(0, 50)}..."`);
    return payloadLabel;
  }
  
  return (
    ariaLabel ||
    textLabel ||
    payloadLabel ||
    uniqueAttributes?.['aria-label'] ||
    formCoordinates?.label ||
    placeholder
  );
}

/**
 * Get a CLEAN label for AI element matching.
 * 
 * CRITICAL: This function ONLY returns clean, reliable label sources.
 * It NEVER returns textLabel which can contain dirty content like
 * validation messages or duplicated text.
 * 
 * Use this for:
 * - recordedAriaLabel in hints (sent to AI for element matching)
 * - Candidate scoring/filtering
 * - Any context where the label will be used to FIND elements
 * 
 * Priority order (all clean sources):
 * 1. ariaLabel - Explicit aria-label attribute (always clean)
 * 2. uniqueAttributes['aria-label'] - Same, from context
 * 3. payloadLabel - From LabelFinder during recording (cleaned)
 * 
 * @param aiEvidence - AI evidence from workflow step
 * @param payloadLabel - Label from step payload (pre-cleaned by LabelFinder)
 * @param uniqueAttributes - Unique attributes from context
 * @returns Clean label suitable for element matching, or undefined
 */
export function getCleanLabelForMatching(
  aiEvidence?: AIEvidence,
  payloadLabel?: string,
  uniqueAttributes?: Record<string, string>
): string | undefined {
  // ONLY use sources that are guaranteed to be clean
  // Never use textLabel here - it can contain dirty content!
  return (
    aiEvidence?.semanticAnchors?.ariaLabel ||
    uniqueAttributes?.['aria-label'] ||
    payloadLabel  // Already cleaned by LabelFinder during recording
  );
}

/**
 * Get a label for human display/debugging purposes.
 * 
 * This function is more permissive and can return textLabel
 * since the output is for display only, not for element matching.
 * 
 * Use this for:
 * - Showing labels in the UI
 * - Debug logging
 * - Step descriptions
 * 
 * @param aiEvidence - AI evidence from workflow step
 * @param payloadLabel - Label from step payload
 * @returns Label for display, or undefined
 */
export function getLabelForDisplay(
  aiEvidence?: AIEvidence,
  payloadLabel?: string
): string | undefined {
  // For display, we can use textLabel since humans can interpret dirty text
  return (
    aiEvidence?.semanticAnchors?.ariaLabel ||
    payloadLabel ||
    aiEvidence?.semanticAnchors?.textLabel
  );
}

/**
 * Get all available labels for debugging and disambiguation.
 * 
 * This is useful when you need to see all possible label sources
 * to debug why an element isn't being found correctly.
 * 
 * @param aiEvidence - AI evidence from workflow step
 * @param payloadLabel - Label from step payload
 * @param uniqueAttributes - Unique attributes from context
 * @returns Object containing all label sources
 */
export function getAllLabels(
  aiEvidence?: AIEvidence,
  payloadLabel?: string,
  uniqueAttributes?: Record<string, string>
): { 
  ariaLabel?: string; 
  textLabel?: string; 
  payloadLabel?: string; 
  attrLabel?: string;
} {
  return {
    ariaLabel: aiEvidence?.semanticAnchors?.ariaLabel,
    textLabel: aiEvidence?.semanticAnchors?.textLabel,
    payloadLabel,
    attrLabel: uniqueAttributes?.['aria-label'],
  };
}
