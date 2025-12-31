/**
 * VisionClicker - Pure coordinate-based clicking
 * 
 * TRUE VISION MODE: No DOM dependency!
 * The AI sees the screen and tells us WHERE to click.
 * We click at those exact pixel coordinates like a human would.
 */

export interface VisionClickResult {
  success: boolean;
  coordinates: { x: number; y: number };
  error?: string;
}

export class VisionClicker {
  private static debuggerAttached = false;
  private static attachingDebugger: Promise<boolean> | null = null;

  /**
   * Pre-attach debugger to stabilize viewport
   * Should be called once at the start of workflow
   */
  static async preAttachDebugger(): Promise<boolean> {
    if (this.debuggerAttached) return true;
    if (this.attachingDebugger) return this.attachingDebugger;

    this.attachingDebugger = (async () => {
      try {
        console.log('[VisionClicker] 🔧 Pre-attaching debugger for TRUE VISION...');
        await this.attachDebugger();
        await this.sleep(300); // Let viewport stabilize
        this.debuggerAttached = true;
        console.log('[VisionClicker] ✅ Debugger ready for TRUE VISION');
        return true;
      } catch (error) {
        console.error('[VisionClicker] Failed to attach debugger:', error);
        return false;
      } finally {
        this.attachingDebugger = null;
      }
    })();

    return this.attachingDebugger;
  }

  static isDebuggerReady(): boolean {
    return this.debuggerAttached;
  }

  /**
   * Click at exact pixel coordinates (TRUE VISION mode)
   * No DOM lookup - just click where the AI tells us to click
   */
  static async clickAt(
    x: number,
    y: number,
    description?: string
  ): Promise<VisionClickResult> {
    console.log(`[VisionClicker] 👁️ TRUE VISION click at (${x}, ${y})${description ? ` - ${description}` : ''}`);

    // Ensure debugger is attached
    if (!this.debuggerAttached) {
      await this.preAttachDebugger();
    }

    try {
      // Add slight random offset for human-like clicking
      const humanX = x + this.randomOffset(-5, 5);
      const humanY = y + this.randomOffset(-3, 3);

      console.log(`[VisionClicker] Humanized coordinates: (${Math.round(humanX)}, ${Math.round(humanY)})`);

      // Small delay before click (human reaction time)
      await this.sleep(10 + Math.random() * 30);

      // Click using debugger API
      await this.debuggerClick(humanX, humanY);

      console.log('[VisionClicker] ✅ TRUE VISION click succeeded');
      return {
        success: true,
        coordinates: { x: Math.round(humanX), y: Math.round(humanY) },
      };
    } catch (error) {
      console.error('[VisionClicker] Click failed:', error);
      return {
        success: false,
        coordinates: { x, y },
        error: error instanceof Error ? error.message : 'Click failed',
      };
    }
  }

  /**
   * Attach Chrome Debugger
   */
  private static async attachDebugger(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'DEBUGGER_ATTACH' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve();
          } else {
            reject(new Error('Debugger attach failed'));
          }
        }
      );
    });
  }

  /**
   * Chrome Debugger API click
   */
  private static async debuggerClick(x: number, y: number): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'DEBUGGER_CLICK', x, y },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success) {
            resolve();
          } else {
            reject(new Error(response?.error || 'Debugger click failed'));
          }
        }
      );
    });
  }

  /**
   * Human-like random offset
   */
  private static randomOffset(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep utility
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}



