/**
 * AILabelEnhancer - Service for async AI-powered label enhancement
 * 
 * When DOM-based label detection has low confidence, this service
 * queues the step for AI vision analysis and updates the label asynchronously.
 */

import { aiConfig } from './ai-config';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EnhancedLabel {
  label: string;
  confidence: number;
  reasoning: string;
  source: 'ai-vision';
  alternativeLabels?: string[];
}

export interface PendingEnhancement {
  stepId: string;
  screenshot: string;
  elementBounds?: BoundingBox;
  domLabelHint?: string;
  placeholderHint?: string;
  inputType?: string;
  context?: {
    pageTitle?: string;
    pageUrl?: string;
    nearbyText?: string[];
  };
  timestamp: number;
  retryCount: number;
}

export interface LabelEnhancementResult {
  stepId: string;
  enhancedLabel: EnhancedLabel;
  originalLabel?: string;
}

// Callback type for when a label is enhanced
export type LabelEnhancedCallback = (result: LabelEnhancementResult) => void;

export class AILabelEnhancer {
  private static instance: AILabelEnhancer | null = null;
  
  private pendingEnhancements: Map<string, PendingEnhancement> = new Map();
  private processingQueue: string[] = [];
  private isProcessing: boolean = false;
  private callbacks: LabelEnhancedCallback[] = [];
  
  // Configuration
  private readonly MAX_RETRIES = 2;
  private readonly BATCH_SIZE = 3; // Process up to 3 at a time
  private readonly PROCESS_DELAY_MS = 500; // Delay between batches

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): AILabelEnhancer {
    if (!AILabelEnhancer.instance) {
      AILabelEnhancer.instance = new AILabelEnhancer();
    }
    return AILabelEnhancer.instance;
  }

  /**
   * Register a callback to be notified when labels are enhanced
   */
  onLabelEnhanced(callback: LabelEnhancedCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove a callback
   */
  offLabelEnhanced(callback: LabelEnhancedCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Queue a step for AI label enhancement
   */
  queueForEnhancement(
    stepId: string,
    screenshot: string,
    options: {
      elementBounds?: BoundingBox;
      domLabelHint?: string;
      placeholderHint?: string;
      inputType?: string;
      pageTitle?: string;
      pageUrl?: string;
      nearbyText?: string[];
    } = {}
  ): void {
    // Don't queue if already pending
    if (this.pendingEnhancements.has(stepId)) {
      console.log(`[AILabelEnhancer] Step ${stepId} already queued for enhancement`);
      return;
    }

    const enhancement: PendingEnhancement = {
      stepId,
      screenshot,
      elementBounds: options.elementBounds,
      domLabelHint: options.domLabelHint,
      placeholderHint: options.placeholderHint,
      inputType: options.inputType,
      context: {
        pageTitle: options.pageTitle,
        pageUrl: options.pageUrl,
        nearbyText: options.nearbyText,
      },
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.pendingEnhancements.set(stepId, enhancement);
    this.processingQueue.push(stepId);

    console.log(`[AILabelEnhancer] Queued step ${stepId} for enhancement. Queue size: ${this.processingQueue.length}`);

    // Start processing if not already running
    this.startProcessing();
  }

  /**
   * Enhance a single label immediately (blocking)
   */
  async enhanceLabelNow(
    screenshot: string,
    options: {
      elementBounds?: BoundingBox;
      domLabelHint?: string;
      placeholderHint?: string;
      inputType?: string;
      pageTitle?: string;
      pageUrl?: string;
      nearbyText?: string[];
    } = {}
  ): Promise<EnhancedLabel> {
    return this.callEdgeFunction({
      screenshot,
      elementBounds: options.elementBounds,
      domLabelHint: options.domLabelHint,
      placeholderHint: options.placeholderHint,
      inputType: options.inputType,
      context: {
        pageTitle: options.pageTitle,
        pageUrl: options.pageUrl,
        nearbyText: options.nearbyText,
      },
    });
  }

  /**
   * Get the number of pending enhancements
   */
  getPendingCount(): number {
    return this.processingQueue.length;
  }

  /**
   * Check if there are pending enhancements
   */
  hasPendingEnhancements(): boolean {
    return this.processingQueue.length > 0;
  }

  /**
   * Wait for all pending enhancements to complete
   */
  async waitForCompletion(): Promise<void> {
    while (this.isProcessing || this.processingQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Clear all pending enhancements
   */
  clearPending(): void {
    this.pendingEnhancements.clear();
    this.processingQueue = [];
    console.log('[AILabelEnhancer] Cleared all pending enhancements');
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('[AILabelEnhancer] Starting processing queue');

    while (this.processingQueue.length > 0) {
      // Process a batch
      const batch = this.processingQueue.splice(0, this.BATCH_SIZE);
      
      await Promise.all(
        batch.map(stepId => this.processEnhancement(stepId))
      );

      // Delay between batches to avoid rate limiting
      if (this.processingQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.PROCESS_DELAY_MS));
      }
    }

    this.isProcessing = false;
    console.log('[AILabelEnhancer] Processing queue complete');
  }

  private async processEnhancement(stepId: string): Promise<void> {
    const enhancement = this.pendingEnhancements.get(stepId);
    if (!enhancement) return;

    try {
      console.log(`[AILabelEnhancer] Processing enhancement for step ${stepId}`);

      const enhancedLabel = await this.callEdgeFunction({
        screenshot: enhancement.screenshot,
        elementBounds: enhancement.elementBounds,
        domLabelHint: enhancement.domLabelHint,
        placeholderHint: enhancement.placeholderHint,
        inputType: enhancement.inputType,
        context: enhancement.context,
      });

      // Notify callbacks
      const result: LabelEnhancementResult = {
        stepId,
        enhancedLabel,
        originalLabel: enhancement.domLabelHint,
      };

      this.notifyCallbacks(result);

      // Remove from pending
      this.pendingEnhancements.delete(stepId);

      console.log(`[AILabelEnhancer] Enhanced step ${stepId}: "${enhancedLabel.label}" (confidence: ${enhancedLabel.confidence})`);

    } catch (error) {
      console.error(`[AILabelEnhancer] Error enhancing step ${stepId}:`, error);

      // Retry if under limit
      enhancement.retryCount++;
      if (enhancement.retryCount < this.MAX_RETRIES) {
        console.log(`[AILabelEnhancer] Retrying step ${stepId} (attempt ${enhancement.retryCount + 1})`);
        this.processingQueue.push(stepId);
      } else {
        // Give up after max retries
        console.log(`[AILabelEnhancer] Max retries reached for step ${stepId}, using DOM hint`);
        
        const fallbackResult: LabelEnhancementResult = {
          stepId,
          enhancedLabel: {
            label: enhancement.domLabelHint || enhancement.placeholderHint || 'Unknown Field',
            confidence: 0.3,
            reasoning: 'AI enhancement failed, using fallback',
            source: 'ai-vision',
          },
          originalLabel: enhancement.domLabelHint,
        };

        this.notifyCallbacks(fallbackResult);
        this.pendingEnhancements.delete(stepId);
      }
    }
  }

  private async callEdgeFunction(request: {
    screenshot: string;
    elementBounds?: BoundingBox;
    domLabelHint?: string;
    placeholderHint?: string;
    inputType?: string;
    context?: {
      pageTitle?: string;
      pageUrl?: string;
      nearbyText?: string[];
    };
  }): Promise<EnhancedLabel> {
    const config = aiConfig.getConfig();
    const url = aiConfig.getEdgeFunctionUrl('extract_field_label');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return {
      label: result.label,
      confidence: result.confidence,
      reasoning: result.reasoning,
      source: 'ai-vision',
      alternativeLabels: result.alternativeLabels,
    };
  }

  private notifyCallbacks(result: LabelEnhancementResult): void {
    for (const callback of this.callbacks) {
      try {
        callback(result);
      } catch (error) {
        console.error('[AILabelEnhancer] Error in callback:', error);
      }
    }
  }
}

// Export singleton instance
export const aiLabelEnhancer = AILabelEnhancer.getInstance();
