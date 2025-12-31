/**
 * Visual Wait - Detects when to proceed based on visual changes
 * Implements human-like wait conditions using visual comparison
 */

import { VisualSnapshotService } from '../content/visual-snapshot';
import type { VisualWaitCondition, BoundingBox } from '../types/visual';

export interface WaitResult {
  success: boolean;
  conditionMet: boolean;
  elapsedTime: number;
  finalSimilarity?: number;
  error?: string;
}

export class VisualWait {
  /**
   * Wait for a visual condition to be met
   */
  static async waitFor(condition: VisualWaitCondition): Promise<WaitResult> {
    const startTime = Date.now();
    let lastError: string | undefined;

    while (Date.now() - startTime < condition.timeout) {
      try {
        const result = await this.checkCondition(condition);
        
        if (result.conditionMet) {
          return {
            success: true,
            conditionMet: true,
            elapsedTime: Date.now() - startTime,
            finalSimilarity: result.similarity,
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Wait before next poll
      await this.sleep(condition.pollInterval);
    }

    return {
      success: false,
      conditionMet: false,
      elapsedTime: Date.now() - startTime,
      error: lastError || 'Timeout waiting for visual condition',
    };
  }

  /**
   * Wait for visual stability (no changes for duration)
   */
  static async waitForStability(
    stabilityDuration: number = 500,
    timeout: number = 10000,
    pollInterval: number = 200
  ): Promise<WaitResult> {
    const startTime = Date.now();
    let lastScreenshot: string | null = null;
    let stableStartTime: number | null = null;

    while (Date.now() - startTime < timeout) {
      try {
        const fullPage = await VisualSnapshotService.captureFullPage(0.5);
        if (!fullPage) {
          await this.sleep(pollInterval);
          continue;
        }

        const currentScreenshot = fullPage.screenshot;

        if (lastScreenshot) {
          const similarity = await VisualSnapshotService.compareScreenshots(
            lastScreenshot,
            currentScreenshot
          );

          // If very similar (>98%), page is stable
          if (similarity > 0.98) {
            if (!stableStartTime) {
              stableStartTime = Date.now();
            } else if (Date.now() - stableStartTime >= stabilityDuration) {
              return {
                success: true,
                conditionMet: true,
                elapsedTime: Date.now() - startTime,
                finalSimilarity: similarity,
              };
            }
          } else {
            // Page changed, reset stability timer
            stableStartTime = null;
          }
        }

        lastScreenshot = currentScreenshot;
        await this.sleep(pollInterval);
      } catch (error) {
        await this.sleep(pollInterval);
      }
    }

    return {
      success: false,
      conditionMet: false,
      elapsedTime: Date.now() - startTime,
      error: 'Timeout waiting for visual stability',
    };
  }

  /**
   * Wait for a specific element to appear visually
   */
  static async waitForElementAppears(
    selector: string,
    timeout: number = 10000,
    pollInterval: number = 200
  ): Promise<WaitResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          const rect = element.getBoundingClientRect();
          // Check if element is visible (has dimensions and is in viewport)
          if (rect.width > 0 && rect.height > 0 &&
              rect.top < window.innerHeight && rect.bottom > 0 &&
              rect.left < window.innerWidth && rect.right > 0) {
            return {
              success: true,
              conditionMet: true,
              elapsedTime: Date.now() - startTime,
            };
          }
        }
      } catch (error) {
        // Continue polling
      }

      await this.sleep(pollInterval);
    }

    return {
      success: false,
      conditionMet: false,
      elapsedTime: Date.now() - startTime,
      error: 'Timeout waiting for element to appear',
    };
  }

  /**
   * Wait for a specific element to disappear visually
   */
  static async waitForElementDisappears(
    selector: string,
    timeout: number = 10000,
    pollInterval: number = 200
  ): Promise<WaitResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const element = document.querySelector(selector);
        if (!element) {
          return {
            success: true,
            conditionMet: true,
            elapsedTime: Date.now() - startTime,
          };
        }

        const rect = element.getBoundingClientRect();
        // Also consider it disappeared if it has no dimensions
        if (rect.width === 0 && rect.height === 0) {
          return {
            success: true,
            conditionMet: true,
            elapsedTime: Date.now() - startTime,
          };
        }
      } catch (error) {
        // Element might be removed, consider it disappeared
        return {
          success: true,
          conditionMet: true,
          elapsedTime: Date.now() - startTime,
        };
      }

      await this.sleep(pollInterval);
    }

    return {
      success: false,
      conditionMet: false,
      elapsedTime: Date.now() - startTime,
      error: 'Timeout waiting for element to disappear',
    };
  }

  /**
   * Wait for visual change in a specific region
   */
  static async waitForRegionChange(
    region: BoundingBox,
    timeout: number = 10000,
    pollInterval: number = 200,
    changeThreshold: number = 0.1
  ): Promise<WaitResult> {
    const startTime = Date.now();
    let initialScreenshot: string | null = null;

    // Capture initial region
    try {
      initialScreenshot = await VisualSnapshotService.captureRegion(region, 0);
    } catch (error) {
      return {
        success: false,
        conditionMet: false,
        elapsedTime: 0,
        error: 'Failed to capture initial region',
      };
    }

    if (!initialScreenshot) {
      return {
        success: false,
        conditionMet: false,
        elapsedTime: 0,
        error: 'No initial screenshot captured',
      };
    }

    while (Date.now() - startTime < timeout) {
      try {
        const currentScreenshot = await VisualSnapshotService.captureRegion(region, 0);
        if (currentScreenshot) {
          const similarity = await VisualSnapshotService.compareScreenshots(
            initialScreenshot,
            currentScreenshot
          );

          // Check if change exceeds threshold
          if (1 - similarity >= changeThreshold) {
            return {
              success: true,
              conditionMet: true,
              elapsedTime: Date.now() - startTime,
              finalSimilarity: similarity,
            };
          }
        }
      } catch (error) {
        // Continue polling
      }

      await this.sleep(pollInterval);
    }

    return {
      success: false,
      conditionMet: false,
      elapsedTime: Date.now() - startTime,
      error: 'Timeout waiting for region change',
    };
  }

  /**
   * Wait for animation to complete (detect when changes settle)
   */
  static async waitForAnimationComplete(
    timeout: number = 5000,
    settleDuration: number = 200,
    pollInterval: number = 50
  ): Promise<WaitResult> {
    const startTime = Date.now();
    let previousScreenshot: string | null = null;
    let settleStartTime: number | null = null;

    while (Date.now() - startTime < timeout) {
      try {
        const fullPage = await VisualSnapshotService.captureFullPage(0.3);
        if (!fullPage) {
          await this.sleep(pollInterval);
          continue;
        }

        const currentScreenshot = fullPage.screenshot;

        if (previousScreenshot) {
          const similarity = await VisualSnapshotService.compareScreenshots(
            previousScreenshot,
            currentScreenshot
          );

          // Very high similarity means animation has stopped
          if (similarity > 0.99) {
            if (!settleStartTime) {
              settleStartTime = Date.now();
            } else if (Date.now() - settleStartTime >= settleDuration) {
              return {
                success: true,
                conditionMet: true,
                elapsedTime: Date.now() - startTime,
                finalSimilarity: similarity,
              };
            }
          } else {
            // Animation still happening, reset settle timer
            settleStartTime = null;
          }
        }

        previousScreenshot = currentScreenshot;
        await this.sleep(pollInterval);
      } catch (error) {
        await this.sleep(pollInterval);
      }
    }

    // If we reach timeout, animation might be settled anyway
    return {
      success: true,
      conditionMet: true,
      elapsedTime: Date.now() - startTime,
    };
  }

  /**
   * Check a visual wait condition
   */
  private static async checkCondition(
    condition: VisualWaitCondition
  ): Promise<{ conditionMet: boolean; similarity?: number }> {
    switch (condition.type) {
      case 'element_appears':
        if (condition.targetDescription) {
          // Try to find element by common selectors
          const selectors = this.descriptionToSelectors(condition.targetDescription);
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              const rect = element.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { conditionMet: true };
              }
            }
          }
        }
        return { conditionMet: false };

      case 'element_disappears':
        if (condition.targetDescription) {
          const selectors = this.descriptionToSelectors(condition.targetDescription);
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              const rect = element.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { conditionMet: false };
              }
            }
          }
        }
        return { conditionMet: true };

      case 'visual_stable':
        // Check if page hasn't changed
        const stability = await this.waitForStability(
          200,
          condition.pollInterval * 2,
          condition.pollInterval
        );
        return {
          conditionMet: stability.conditionMet,
          similarity: stability.finalSimilarity,
        };

      case 'animation_complete':
        const animation = await this.waitForAnimationComplete(
          condition.pollInterval * 3,
          100,
          condition.pollInterval / 2
        );
        return { conditionMet: animation.conditionMet };

      case 'color_change':
      case 'text_change':
        // These require region monitoring
        if (condition.targetRegion) {
          const regionChange = await this.waitForRegionChange(
            condition.targetRegion,
            condition.pollInterval * 2,
            condition.pollInterval / 2,
            0.05
          );
          return {
            conditionMet: regionChange.conditionMet,
            similarity: regionChange.finalSimilarity,
          };
        }
        return { conditionMet: false };

      default:
        return { conditionMet: false };
    }
  }

  /**
   * Convert description to possible selectors
   */
  private static descriptionToSelectors(description: string): string[] {
    const selectors: string[] = [];
    const text = description.toLowerCase();

    // Loading indicators
    if (text.includes('loading') || text.includes('spinner')) {
      selectors.push(
        '.loading',
        '.spinner',
        '[class*="loading"]',
        '[class*="spinner"]',
        '.loader',
        '[class*="loader"]',
        '[role="progressbar"]',
        '.MuiCircularProgress-root'
      );
    }

    // Modal/dialog
    if (text.includes('modal') || text.includes('dialog') || text.includes('popup')) {
      selectors.push(
        '[role="dialog"]',
        '.modal',
        '[class*="modal"]',
        '.popup',
        '[class*="popup"]',
        '.dialog',
        '[class*="dialog"]',
        '.MuiDialog-root'
      );
    }

    // Toast/notification
    if (text.includes('toast') || text.includes('notification') || text.includes('alert')) {
      selectors.push(
        '.toast',
        '[class*="toast"]',
        '.notification',
        '[class*="notification"]',
        '[role="alert"]',
        '.MuiSnackbar-root'
      );
    }

    // Dropdown/menu
    if (text.includes('dropdown') || text.includes('menu')) {
      selectors.push(
        '[role="menu"]',
        '[role="listbox"]',
        '.dropdown-menu',
        '[class*="dropdown"]',
        '.MuiMenu-paper'
      );
    }

    return selectors;
  }

  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a visual wait condition
 */
export function createVisualWaitCondition(
  type: VisualWaitCondition['type'],
  options: {
    targetRegion?: BoundingBox;
    targetDescription?: string;
    expectedState?: string;
    timeout?: number;
    pollInterval?: number;
    confidence?: number;
  } = {}
): VisualWaitCondition {
  return {
    type,
    targetRegion: options.targetRegion,
    targetDescription: options.targetDescription,
    expectedState: options.expectedState,
    timeout: options.timeout || 10000,
    pollInterval: options.pollInterval || 200,
    confidence: options.confidence || 0.9,
  };
}








