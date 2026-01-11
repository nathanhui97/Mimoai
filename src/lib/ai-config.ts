/**
 * AI Configuration - Supabase configuration for AI features
 * No API key storage (handled in Supabase Edge Function)
 */

export interface AIConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  // Element recovery
  edgeFunctionName: string;
  // Selector validation
  validateSelectorEdgeFunctionName: string;
  validateSelectorTimeout: number;
  // Step description generation
  generateDescriptionEdgeFunctionName: string;
  // Debug/self-healing functions
  debugStepFailureEdgeFunctionName: string;
  // Visual analysis functions
  classifyPageTypeEdgeFunctionName: string;
  visualSimilarityEdgeFunctionName: string;
  visualAnalysisEdgeFunctionName: string;
  analyzeIntentEdgeFunctionName: string;
  detectVariablesEdgeFunctionName: string;
  extractFieldLabelEdgeFunctionName: string; // AI vision label extraction
  visualAnalysisTimeout: number;
  // Visual AI Click function (95-99% accuracy fallback)
  visualClickEdgeFunctionName: string;
  visualClickEnabled: boolean;
  // Feature flags
  enabled: boolean;
  visualAnalysisEnabled: boolean;
  correctionLearningEnabled: boolean;
  aiSelfHealingEnabled: boolean;
  aiLabelEnhancementEnabled: boolean; // Enable AI label enhancement for low-confidence labels
  // Debug mode - controls verbose logging (OPTIMIZATION)
  debugMode: boolean;
  // Timeouts
  timeout: number;
  localCacheTTL: number;
}

class AIConfigManager {
  private config: AIConfig;

  constructor() {
    // Default configuration
    // Supabase project: mimoai (jfboagngbpzollcipewh)
    this.config = {
      supabaseUrl: 'https://jfboagngbpzollcipewh.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmYm9hZ25nYnB6b2xsY2lwZXdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5OTIyMzMsImV4cCI6MjA4MDU2ODIzM30.CHHB1kvhiq4i063unS6_UdBLwLd8uXVi71id6hdelUI',
      
      // Element recovery
      edgeFunctionName: 'recover_element',
      
      // Selector validation
      validateSelectorEdgeFunctionName: 'validate_selector',
      validateSelectorTimeout: 15000, // 15 seconds for selector validation
      
      // Step description generation
      generateDescriptionEdgeFunctionName: 'generate_step_description',
      
      // Debug/self-healing functions
      debugStepFailureEdgeFunctionName: 'debug_step_failure',
      
      // Visual analysis functions (human-like understanding)
      classifyPageTypeEdgeFunctionName: 'classify_page_type',
      visualSimilarityEdgeFunctionName: 'visual_similarity',
      visualAnalysisEdgeFunctionName: 'visual_analysis',
      analyzeIntentEdgeFunctionName: 'analyze_intent',
      detectVariablesEdgeFunctionName: 'detect_variables',
      extractFieldLabelEdgeFunctionName: 'extract_field_label', // AI vision label extraction
      visualAnalysisTimeout: 20000, // 20 seconds for visual analysis (images are larger)
      
      // Visual AI Click (95-99% accuracy final fallback)
      visualClickEdgeFunctionName: 'visual_click',
      visualClickEnabled: true, // Enable visual AI click fallback
      
      // Feature flags
      enabled: true, // Master feature flag for AI
      visualAnalysisEnabled: true, // Enable visual analysis features
      correctionLearningEnabled: true, // Enable learning from user corrections
      aiSelfHealingEnabled: true, // Enable AI-powered self-healing during replay
      aiLabelEnhancementEnabled: true, // Enable AI label enhancement for low-confidence labels
      
      // Debug mode - set to false for production to reduce logging overhead
      debugMode: false, // OPTIMIZATION: Disable verbose logging by default
      
      // Timeouts
      timeout: 10000, // 10 seconds for standard Edge Function calls
      localCacheTTL: 3600000, // 1 hour for local cache
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): AIConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AIConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check if AI features are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if visual analysis is enabled
   */
  isVisualAnalysisEnabled(): boolean {
    return this.config.enabled && this.config.visualAnalysisEnabled;
  }

  /**
   * Check if correction learning is enabled
   */
  isCorrectionLearningEnabled(): boolean {
    return this.config.enabled && this.config.correctionLearningEnabled;
  }

  /**
   * Check if AI self-healing is enabled
   */
  isAISelfHealingEnabled(): boolean {
    return this.config.enabled && this.config.aiSelfHealingEnabled;
  }

  /**
   * Check if AI label enhancement is enabled
   */
  isAILabelEnhancementEnabled(): boolean {
    return this.config.enabled && this.config.aiLabelEnhancementEnabled;
  }

  /**
   * Check if debug mode is enabled (OPTIMIZATION)
   * When false, verbose logging is suppressed for better performance
   */
  isDebugMode(): boolean {
    return this.config.debugMode;
  }

  /**
   * Get Supabase URL
   */
  getSupabaseUrl(): string {
    return this.config.supabaseUrl;
  }

  /**
   * Get Supabase anon key
   */
  getSupabaseAnonKey(): string {
    return this.config.supabaseAnonKey;
  }

  /**
   * Get Edge Function name
   */
  getEdgeFunctionName(): string {
    return this.config.edgeFunctionName;
  }

  /**
   * Get timeout for Edge Function calls
   */
  getTimeout(): number {
    return this.config.timeout;
  }

  /**
   * Get visual analysis timeout
   */
  getVisualAnalysisTimeout(): number {
    return this.config.visualAnalysisTimeout;
  }

  /**
   * Get local cache TTL
   */
  getLocalCacheTTL(): number {
    return this.config.localCacheTTL;
  }

  /**
   * Get Edge Function URL
   */
  getEdgeFunctionUrl(functionName: string): string {
    return `${this.config.supabaseUrl}/functions/v1/${functionName}`;
  }
}

// Singleton instance
export const aiConfig = new AIConfigManager();

/**
 * Debug logger - only logs when debug mode is enabled (OPTIMIZATION)
 * Use this for verbose logging that isn't needed in production
 */
export function debugLog(category: string, message: string, data?: unknown): void {
  if (aiConfig.isDebugMode()) {
    if (data !== undefined) {
      console.log(`[${category}] ${message}`, data);
    } else {
      console.log(`[${category}] ${message}`);
    }
  }
}

/**
 * Always log - for important messages that should always be shown
 * Use this for errors, warnings, and critical execution info
 */
export function alwaysLog(category: string, message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[${category}] ${message}`, data);
  } else {
    console.log(`[${category}] ${message}`);
  }
}
