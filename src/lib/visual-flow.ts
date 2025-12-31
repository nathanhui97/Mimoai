/**
 * Visual Flow Tracker - Tracks visual state changes across workflow steps
 * Captures before/after screenshots to understand visual transitions
 */

import { VisualSnapshotService } from '../content/visual-snapshot';
import { VisualAnalysisService } from './visual-analysis';
import type { VisualFlow, VisualChange } from '../types/visual';

export interface VisualState {
  screenshot: string; // Base64 full page screenshot
  timestamp: number;
  url: string;
  title: string;
}

export class VisualFlowTracker {
  private beforeState: VisualState | null = null;
  private afterState: VisualState | null = null;
  private isCapturing: boolean = false;

  /**
   * Capture the "before" state (call before performing an action)
   */
  async captureBeforeState(): Promise<void> {
    if (this.isCapturing) {
      console.warn('🔄 GhostWriter: Visual flow capture already in progress');
      return;
    }

    try {
      this.isCapturing = true;
      
      const fullPage = await VisualSnapshotService.captureFullPage(0.6);
      if (fullPage) {
        this.beforeState = {
          screenshot: fullPage.screenshot,
          timestamp: fullPage.timestamp,
          url: window.location.href,
          title: document.title,
        };
        console.log('🔄 GhostWriter: Captured before state');
      }
    } catch (error) {
      console.warn('🔄 GhostWriter: Failed to capture before state:', error);
    }
  }

  /**
   * Capture the "after" state (call after performing an action)
   */
  async captureAfterState(): Promise<void> {
    try {
      const fullPage = await VisualSnapshotService.captureFullPage(0.6);
      if (fullPage) {
        this.afterState = {
          screenshot: fullPage.screenshot,
          timestamp: fullPage.timestamp,
          url: window.location.href,
          title: document.title,
        };
        console.log('🔄 GhostWriter: Captured after state');
      }
    } catch (error) {
      console.warn('🔄 GhostWriter: Failed to capture after state:', error);
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Get the visual flow data for the current action
   */
  async getVisualFlow(): Promise<VisualFlow | null> {
    if (!this.beforeState) {
      return null;
    }

    const flow: VisualFlow = {
      beforeSnapshot: this.beforeState.screenshot,
      afterSnapshot: this.afterState?.screenshot,
      changes: [],
    };

    // Detect changes if we have both states
    if (this.beforeState && this.afterState) {
      flow.changes = await this.detectChanges(
        this.beforeState.screenshot,
        this.afterState.screenshot
      );

      // Predict next state based on changes
      flow.expectedNextState = this.predictNextState(flow.changes);
    }

    return flow;
  }

  /**
   * Detect visual changes between before and after screenshots
   */
  private async detectChanges(
    beforeScreenshot: string,
    afterScreenshot: string
  ): Promise<VisualChange[]> {
    const changes: VisualChange[] = [];

    try {
      // Quick pixel comparison
      const comparison = await VisualAnalysisService.detectVisualChanges(
        beforeScreenshot,
        afterScreenshot
      );

      if (comparison.hasChanges) {
        // Check for URL change
        if (this.beforeState && this.afterState && 
            this.beforeState.url !== this.afterState.url) {
          changes.push({
            type: 'appeared',
            region: { x: 0, y: 0, width: 100, height: 100 }, // Full page
            description: `Navigation from ${this.beforeState.url} to ${this.afterState.url}`,
            elementType: 'page',
            confidence: 1.0,
          });
        }

        // Check for title change
        if (this.beforeState && this.afterState &&
            this.beforeState.title !== this.afterState.title) {
          changes.push({
            type: 'text_changed',
            region: { x: 0, y: 0, width: 100, height: 20 }, // Top of page
            description: `Title changed from "${this.beforeState.title}" to "${this.afterState.title}"`,
            elementType: 'title',
            confidence: 1.0,
          });
        }

        // Add general change detection result
        if (changes.length === 0) {
          changes.push({
            type: 'state_changed',
            region: { x: 0, y: 0, width: 100, height: 100 },
            description: comparison.description,
            confidence: 1 - comparison.similarity,
          });
        }
      }
    } catch (error) {
      console.warn('🔄 GhostWriter: Change detection failed:', error);
    }

    return changes;
  }

  /**
   * Predict expected next state based on detected changes
   */
  private predictNextState(changes: VisualChange[]): string {
    if (changes.length === 0) {
      return 'No visual changes expected';
    }

    const changeTypes = changes.map(c => c.type);

    if (changeTypes.includes('appeared') && changes.some(c => c.elementType === 'page')) {
      return 'New page loaded - wait for page content to appear';
    }

    if (changeTypes.includes('appeared')) {
      return 'New element appeared - may be modal, dropdown, or dynamic content';
    }

    if (changeTypes.includes('disappeared')) {
      return 'Element disappeared - modal closed or content removed';
    }

    if (changeTypes.includes('state_changed')) {
      return 'Visual state changed - form submitted, button clicked, or data updated';
    }

    return 'Minor visual changes detected';
  }

  /**
   * Clear captured states
   */
  clear(): void {
    this.beforeState = null;
    this.afterState = null;
    this.isCapturing = false;
  }

  /**
   * Check if before state is captured
   */
  hasBeforeState(): boolean {
    return this.beforeState !== null;
  }

  /**
   * Check if flow capture is in progress
   */
  isCapturingFlow(): boolean {
    return this.isCapturing;
  }

  /**
   * Get before screenshot (for debugging)
   */
  getBeforeScreenshot(): string | null {
    return this.beforeState?.screenshot || null;
  }

  /**
   * Get after screenshot (for debugging)
   */
  getAfterScreenshot(): string | null {
    return this.afterState?.screenshot || null;
  }
}

// Singleton instance for global flow tracking
export const visualFlowTracker = new VisualFlowTracker();

/**
 * Helper function to wrap an action with visual flow tracking
 */
export async function withVisualFlow<T>(
  action: () => Promise<T>
): Promise<{ result: T; flow: VisualFlow | null }> {
  const tracker = new VisualFlowTracker();

  // Capture before state
  await tracker.captureBeforeState();

  // Perform action
  const result = await action();

  // Wait a bit for visual changes to settle
  await new Promise(resolve => setTimeout(resolve, 100));

  // Capture after state
  await tracker.captureAfterState();

  // Get flow data
  const flow = await tracker.getVisualFlow();

  return { result, flow };
}

/**
 * Compare two visual flows for similarity
 */
export function compareVisualFlows(
  recorded: VisualFlow,
  current: VisualFlow
): {
  isSimilar: boolean;
  similarity: number;
  differences: string[];
} {
  const differences: string[] = [];
  let similarityScore = 0;
  let totalFactors = 0;

  // Compare change types
  if (recorded.changes.length > 0 && current.changes.length > 0) {
    const recordedTypes = new Set(recorded.changes.map(c => c.type));
    const currentTypes = new Set(current.changes.map(c => c.type));
    
    // Check if same types of changes occurred
    let matchingTypes = 0;
    for (const type of recordedTypes) {
      if (currentTypes.has(type)) {
        matchingTypes++;
      }
    }
    
    const typeOverlap = matchingTypes / Math.max(recordedTypes.size, currentTypes.size);
    similarityScore += typeOverlap;
    totalFactors++;

    if (typeOverlap < 0.5) {
      differences.push(`Different change types: expected ${Array.from(recordedTypes).join(', ')}, got ${Array.from(currentTypes).join(', ')}`);
    }
  } else if (recorded.changes.length !== current.changes.length) {
    totalFactors++;
    if (recorded.changes.length > 0 && current.changes.length === 0) {
      differences.push('Expected visual changes but none detected');
    } else if (recorded.changes.length === 0 && current.changes.length > 0) {
      differences.push('Unexpected visual changes detected');
      similarityScore += 0.5; // Partial credit
    }
  } else {
    // Both have no changes
    similarityScore += 1;
    totalFactors++;
  }

  // Compare expected outcomes
  if (recorded.expectedNextState && current.expectedNextState) {
    const expectedSimilar = recorded.expectedNextState.toLowerCase()
      .includes(current.expectedNextState.toLowerCase().substring(0, 20)) ||
      current.expectedNextState.toLowerCase()
      .includes(recorded.expectedNextState.toLowerCase().substring(0, 20));
    
    if (expectedSimilar) {
      similarityScore += 1;
    } else {
      differences.push(`Expected outcome differs: "${recorded.expectedNextState}" vs "${current.expectedNextState}"`);
    }
    totalFactors++;
  }

  const similarity = totalFactors > 0 ? similarityScore / totalFactors : 0;
  const isSimilar = similarity > 0.6;

  return {
    isSimilar,
    similarity,
    differences,
  };
}








