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
  VISION_CLICKER: true,
  
  /**
   * Use Gemini Computer Use model for vision tasks
   * When enabled: Uses gemini-3-flash-preview (specialized for UI automation)
   * When disabled: Falls back to gemini-3-flash-preview (generic vision model)
   * Cost: Similar to flash, but more accurate for coordinates
   * Risk: Preview model - may have occasional issues
   */
  COMPUTER_USE_MODEL: true,

  /**
   * Smart hybrid execution features (proactive fixes, vision scroll, dropdown flow)
   * Cost: Medium (extra screenshot + Computer Use calls on low confidence)
   * Risk: Low - gated to avoid regressions
   */
  SMART_HYBRID_MODE: true,
  
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
  
  /**
   * Post-action observation for intelligent change detection
   * Cost: Very Low (~5-15ms per action)
   * Risk: None - isolated, wrapped in try-catch
   */
  POST_ACTION_OBSERVER: true,

  // ============================================================================
  // INTELLIGENT AGENT UPGRADES (Phased rollout)
  // ============================================================================

  /**
   * Phase 1: Fast-path context passed to LLM
   * When enabled: LLM receives information about what fast-path tried
   * Cost: None (additive context, no extra API calls)
   * Risk: Low - additive change, doesn't break existing flow
   */
  INTELLIGENT_AGENT_CONTEXT: true,

  /**
   * Phase 2A: Flexible LLM responses (scroll, skip, alternatives)
   * When enabled: LLM can suggest scroll/wait/skip instead of just picking candidates
   * Cost: None (same API call, different response parsing)
   * Risk: Medium - changes response parsing, needs testing
   */
  INTELLIGENT_AGENT_FLEXIBLE: true,

  /**
   * Phase 2B: Goal-oriented prompting
   * When enabled: LLM reasons about goals instead of rigidly following hints
   * Cost: None (prompt change only)
   * Risk: Medium - prompt changes can affect behavior
   */
  INTELLIGENT_AGENT_GOAL: false,

  /**
   * Phase 2C: Goal verification and early completion
   * When enabled: Agent can finish early when goal is achieved
   * Cost: Low (verification checks after actions)
   * Risk: Medium-High - new verification logic
   */
  INTELLIGENT_AGENT_VERIFY: false,
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



