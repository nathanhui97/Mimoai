/**
 * Feature Flags - Centralized toggles for expensive/experimental features
 * 
 * This allows us to simplify the system by disabling costly AI features
 * while keeping the core reliability improvements.
 */

export const FeatureFlags = {
  // ============================================================================
  // DISABLED by default (can re-enable for testing)
  // ============================================================================
  
  /**
   * Full AI Agent observe-act loop (DOM-based, not coordinate-based)
   * Cost: Medium (one LLM call per step using DOM map, not screenshots)
   * Risk: Low (uses reliable locator/scope engine for execution)
   */
  AI_AGENT_LOOP: true,
  
  /**
   * VisionClicker coordinate-based clicking
   * Cost: High (screenshot + LLM call per attempt)
   * Risk: Misclicks, scary debugging
   */
  VISION_CLICKER: false,
  
  /**
   * AI-powered variable detection after recording
   * Cost: Medium (one-time LLM call per workflow)
   * Risk: None, just expensive
   * ALWAYS ENABLED - Required for spreadsheet column header detection
   */
  AI_VARIABLE_DETECTION: true,
  
  /**
   * AI workflow analyzer to choose execution strategy
   * Cost: Medium (one-time LLM call per workflow)
   * Risk: None, just not needed for MVP
   */
  AI_WORKFLOW_ANALYZER: false,
  
  /**
   * Human-like character-by-character typing by default
   * Cost: Low (time only)
   * Risk: Slower execution
   */
  HUMAN_TYPING_DEFAULT: false,
  
  /**
   * XPath locator strategy as fallback
   * Cost: None
   * Risk: Often brittle, can be confusing
   */
  XPATH_FALLBACK: false,
  
  // ============================================================================
  // ALWAYS ENABLED (core reliability features)
  // ============================================================================
  
  /**
   * AI recovery when selectors fail
   * Cost: Medium (only on failure)
   * Risk: None - only used as fallback
   */
  AI_RECOVERY: true,
  
  /**
   * Container-first scope resolution
   * Cost: None
   * Risk: None - critical for dashboard clicks
   */
  SCOPE_RESOLUTION: true,
  
  /**
   * Outcome verification after actions
   * Cost: None
   * Risk: None - essential for reliability
   */
  OUTCOME_VERIFICATION: true,
  
  /**
   * DOM/network stability waits
   * Cost: None (time only)
   * Risk: None - prevents flaky execution
   */
  STABILITY_WAITS: true,
} as const;

/**
 * Type-safe feature flag keys
 */
export type FeatureFlagKey = keyof typeof FeatureFlags;

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return FeatureFlags[key];
}

/**
 * Get all enabled features
 */
export function getEnabledFeatures(): FeatureFlagKey[] {
  return (Object.keys(FeatureFlags) as FeatureFlagKey[]).filter(
    key => FeatureFlags[key]
  );
}

/**
 * Get all disabled features
 */
export function getDisabledFeatures(): FeatureFlagKey[] {
  return (Object.keys(FeatureFlags) as FeatureFlagKey[]).filter(
    key => !FeatureFlags[key]
  );
}



