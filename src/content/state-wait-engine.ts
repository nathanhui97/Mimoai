/**
 * StateWaitEngine - Deterministic state-based waits
 * 
 * Replaces time-based waits (delay(1000)) with state-based conditions:
 * - Wait for DOM stable
 * - Wait for network idle
 * - Wait for loaders gone
 * - Wait for element interactable
 */

import type { Scope } from '../types/scope';
import { resolveScopeContainer } from '../types/scope';

/**
 * Result of a wait operation
 */
export interface WaitResult {
  success: boolean;
  elapsedMs: number;
  reason?: string;
}

/**
 * Result of stability wait with detailed status
 */
export interface StabilityResult extends WaitResult {
  domStable?: boolean;
  networkIdle?: boolean;
  spinnersGone?: boolean;
}

/**
 * Configuration for unified stability wait
 */
export interface StabilityConfig {
  /** Minimum time with no DOM mutations (default: 300-600ms) */
  domQuietMs?: number;
  /** Minimum time with no pending network requests (default: 400-800ms) */
  networkQuietMs?: number;
  /** Maximum total time to wait (default: 5000ms) */
  maxWaitMs?: number;
  /** Whether to check for spinners (default: true) */
  checkSpinners?: boolean;
}

/**
 * Configuration for network idle detection
 */
interface NetworkIdleConfig {
  idleMs: number;
  timeoutMs: number;
  ignorePatterns?: RegExp[];
}

/**
 * StateWaitEngine provides deterministic state-based wait utilities
 */
export class StateWaitEngine {
  // Track pending network requests
  private static pendingRequests = new Set<string>();
  private static isTrackingNetwork = false;
  
  /**
   * Wait for DOM mutations to settle
   * @param minStableMs - Minimum time with no mutations
   * @param timeoutMs - Maximum time to wait
   */
  static async waitForDOMStable(
    minStableMs: number = 300,
    timeoutMs: number = 10000
  ): Promise<WaitResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      let lastMutationTime = Date.now();
      let checkInterval: number;
      let timeoutId: number;
      
      const observer = new MutationObserver(() => {
        lastMutationTime = Date.now();
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      
      const checkStability = () => {
        const timeSinceLastMutation = Date.now() - lastMutationTime;
        
        if (timeSinceLastMutation >= minStableMs) {
          cleanup();
          resolve({
            success: true,
            elapsedMs: Date.now() - startTime,
          });
        }
      };
      
      const cleanup = () => {
        observer.disconnect();
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
      };
      
      checkInterval = window.setInterval(checkStability, 50);
      
      timeoutId = window.setTimeout(() => {
        cleanup();
        resolve({
          success: false,
          elapsedMs: Date.now() - startTime,
          reason: 'DOM stability timeout',
        });
      }, timeoutMs);
    });
  }
  
  /**
   * UNIFIED STABILITY WAIT - Foundation for reliable outcome diffing
   * 
   * Combines DOM quiet + network idle + spinner detection
   * Returns when ALL conditions are met, or timeout
   * 
   * This is the key function that replaces fixed setTimeout() delays.
   * Use this before capturing "after" state in outcome diffing.
   * 
   * @param config - Configuration for stability checks
   * @returns StabilityResult with detailed status of each check
   */
  static async waitForStability(config: StabilityConfig = {}): Promise<StabilityResult> {
    const {
      domQuietMs = 150,           // OPTIMIZED from 400ms for faster execution
      networkQuietMs = 200,       // OPTIMIZED from 600ms for faster execution
      maxWaitMs = 3000,           // OPTIMIZED from 5000ms - shorter max wait
      checkSpinners = true,
    } = config;
    
    const startTime = Date.now();
    const result: StabilityResult = {
      success: false,
      elapsedMs: 0,
      domStable: false,
      networkIdle: false,
      spinnersGone: false,
    };
    
    // Helper to check remaining time
    const remainingTime = () => Math.max(0, maxWaitMs - (Date.now() - startTime));
    
    // 1. Wait for DOM mutations to stop
    const domResult = await this.waitForDOMStable(
      domQuietMs,
      Math.min(3000, remainingTime())
    );
    result.domStable = domResult.success;
    
    if (!domResult.success) {
      console.log('[StateWaitEngine] DOM not stable, continuing anyway');
    }
    
    // 2. Wait for network to be idle
    const networkResult = await this.waitForNetworkIdle({
      idleMs: networkQuietMs,
      timeoutMs: Math.min(2000, remainingTime()),
    });
    result.networkIdle = networkResult.success;
    
    if (!networkResult.success) {
      console.log('[StateWaitEngine] Network not idle, continuing anyway');
    }
    
    // 3. Wait for spinners to disappear (if enabled)
    if (checkSpinners) {
      const spinnersResult = await this.waitForLoadersGone(
        Math.min(2000, remainingTime())
      );
      result.spinnersGone = spinnersResult.success;
      
      if (!spinnersResult.success) {
        console.log('[StateWaitEngine] Spinners still present, continuing anyway');
      }
    } else {
      result.spinnersGone = true; // Not checking, so assume true
    }
    
    // Success if ALL checks passed (or were not required)
    result.success = result.domStable && result.networkIdle && result.spinnersGone;
    result.elapsedMs = Date.now() - startTime;
    
    if (result.success) {
      console.log(`[StateWaitEngine] ✅ Stability achieved in ${result.elapsedMs}ms`);
    } else {
      console.log(`[StateWaitEngine] ⚠️ Partial stability after ${result.elapsedMs}ms:`, {
        domStable: result.domStable,
        networkIdle: result.networkIdle,
        spinnersGone: result.spinnersGone,
      });
    }
    
    return result;
  }
  
  /**
   * Wait for element to be visible, enabled, and not obscured
   */
  static async waitForInteractable(
    selector: string,
    scope?: Scope,
    timeoutMs: number = 10000
  ): Promise<Element | null> {
    const startTime = Date.now();
    const container = scope ? resolveScopeContainer(scope) : document.body;
    
    if (!container) return null;
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const element = container.querySelector(selector);
        
        if (element && this.isInteractable(element)) {
          return element;
        }
      } catch (e) {
        // Invalid selector
      }
      
      await this.sleep(100);
    }
    
    return null;
  }
  
  /**
   * Check if element is interactable (visible, enabled, not obscured)
   */
  static isInteractable(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    // Check visibility
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    if (style.pointerEvents === 'none') return false;
    
    // Check if enabled
    if (element instanceof HTMLButtonElement || 
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) {
      if (element.disabled) return false;
    }
    
    // Check if element is in viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    
    // Check if element is not obscured (element at center point)
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    
    if (topElement && !element.contains(topElement) && !topElement.contains(element)) {
      // Something else is on top
      return false;
    }
    
    return true;
  }
  
  /**
   * Wait for common loaders/spinners to disappear
   */
  static async waitForLoadersGone(timeoutMs: number = 10000): Promise<WaitResult> {
    const startTime = Date.now();
    
    const loaderSelectors = [
      '.loading',
      '.loader',
      '.spinner',
      '[class*="loading"]',
      '[class*="spinner"]',
      '[class*="loader"]',
      '[role="progressbar"]',
      '.MuiCircularProgress-root',
      '.MuiLinearProgress-root',
      '[data-loading="true"]',
      '.sk-spinner',
      '.ant-spin',
      '.chakra-spinner',
    ];
    
    const combinedSelector = loaderSelectors.join(', ');
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const loaders = document.querySelectorAll(combinedSelector);
        const visibleLoaders = Array.from(loaders).filter(loader => {
          const rect = loader.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          
          const style = window.getComputedStyle(loader);
          return style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 style.opacity !== '0';
        });
        
        if (visibleLoaders.length === 0) {
          return {
            success: true,
            elapsedMs: Date.now() - startTime,
          };
        }
      } catch (e) {
        // Selector error, continue
      }
      
      await this.sleep(100);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: 'Loaders still visible after timeout',
    };
  }
  
  /**
   * Wait for pending network requests to settle
   */
  static async waitForNetworkIdle(
    config: Partial<NetworkIdleConfig> = {}
  ): Promise<WaitResult> {
    const { idleMs = 500, timeoutMs = 10000, ignorePatterns = [] } = config;
    const startTime = Date.now();
    
    // Start tracking if not already
    this.startNetworkTracking(ignorePatterns);
    
    let lastRequestTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (this.pendingRequests.size > 0) {
        lastRequestTime = Date.now();
      } else {
        const idleTime = Date.now() - lastRequestTime;
        if (idleTime >= idleMs) {
          return {
            success: true,
            elapsedMs: Date.now() - startTime,
          };
        }
      }
      
      await this.sleep(50);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: `Network not idle. ${this.pendingRequests.size} requests pending`,
    };
  }
  
  /**
   * Start tracking network requests
   */
  private static startNetworkTracking(ignorePatterns: RegExp[]): void {
    if (this.isTrackingNetwork) return;
    this.isTrackingNetwork = true;
    
    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const firstArg = args[0];
      const url = typeof firstArg === 'string' ? firstArg : 
                  firstArg instanceof Request ? firstArg.url :
                  firstArg instanceof URL ? firstArg.toString() : '';
      
      // Check if URL should be ignored
      const shouldIgnore = ignorePatterns.some(pattern => pattern.test(url));
      if (shouldIgnore) {
        return originalFetch(...args);
      }
      
      const requestId = `fetch-${Date.now()}-${Math.random()}`;
      this.pendingRequests.add(requestId);
      
      try {
        const response = await originalFetch(...args);
        return response;
      } finally {
        this.pendingRequests.delete(requestId);
      }
    };
    
    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const pendingRequests = this.pendingRequests;
    
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      (this as any)._trackingUrl = urlStr;
      return originalXHROpen.apply(this, [method, url, ...rest] as any);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
      const urlStr = (this as any)._trackingUrl as string | undefined;
      const shouldIgnore = urlStr ? ignorePatterns.some(pattern => pattern.test(urlStr)) : false;
      
      if (!shouldIgnore) {
        const requestId = `xhr-${Date.now()}-${Math.random()}`;
        pendingRequests.add(requestId);
        
        this.addEventListener('loadend', () => {
          pendingRequests.delete(requestId);
        });
      }
      
      return originalXHRSend.apply(this, args);
    };
  }
  
  /**
   * Wait for page to be fully ready
   * Combines: DOM stable + network idle + no loaders + no animations
   */
  static async waitForPageReady(timeoutMs: number = 15000): Promise<WaitResult> {
    const startTime = Date.now();
    
    // Run checks in parallel with individual timeouts
    const remainingTime = () => Math.max(0, timeoutMs - (Date.now() - startTime));
    
    // Wait for loaders to disappear first
    const loadersResult = await this.waitForLoadersGone(Math.min(5000, remainingTime()));
    
    if (!loadersResult.success) {
      console.warn('StateWaitEngine: Loaders still present, continuing anyway');
    }
    
    // Then wait for DOM stability
    const domResult = await this.waitForDOMStable(300, Math.min(5000, remainingTime()));
    
    if (!domResult.success) {
      console.warn('StateWaitEngine: DOM not stable, continuing anyway');
    }
    
    // Brief network idle check (don't wait too long)
    const networkResult = await this.waitForNetworkIdle({
      idleMs: 200,
      timeoutMs: Math.min(2000, remainingTime()),
    });
    
    if (!networkResult.success) {
      console.warn('StateWaitEngine: Network not idle, continuing anyway');
    }
    
    // Wait for animations to complete
    await this.waitForAnimationsComplete(Math.min(1000, remainingTime()));
    
    return {
      success: true,
      elapsedMs: Date.now() - startTime,
    };
  }
  
  /**
   * Wait for CSS animations to complete
   */
  static async waitForAnimationsComplete(timeoutMs: number = 2000): Promise<WaitResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const animations = document.getAnimations();
      const runningAnimations = animations.filter(
        anim => anim.playState === 'running'
      );
      
      if (runningAnimations.length === 0) {
        return {
          success: true,
          elapsedMs: Date.now() - startTime,
        };
      }
      
      await this.sleep(50);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: 'Animations still running',
    };
  }
  
  /**
   * Wait for a specific text to appear
   */
  static async waitForText(
    text: string,
    scope?: Scope,
    timeoutMs: number = 10000
  ): Promise<WaitResult> {
    const startTime = Date.now();
    const container = scope ? resolveScopeContainer(scope) : document.body;
    
    if (!container) {
      return {
        success: false,
        elapsedMs: 0,
        reason: 'Could not resolve scope container',
      };
    }
    
    const normalizedText = text.toLowerCase().trim();
    
    while (Date.now() - startTime < timeoutMs) {
      const content = container.textContent?.toLowerCase() || '';
      
      if (content.includes(normalizedText)) {
        return {
          success: true,
          elapsedMs: Date.now() - startTime,
        };
      }
      
      await this.sleep(100);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: `Text "${text}" not found`,
    };
  }
  
  /**
   * Wait for a specific text to disappear
   */
  static async waitForTextGone(
    text: string,
    scope?: Scope,
    timeoutMs: number = 10000
  ): Promise<WaitResult> {
    const startTime = Date.now();
    const container = scope ? resolveScopeContainer(scope) : document.body;
    
    if (!container) {
      return {
        success: true,
        elapsedMs: 0,
      };
    }
    
    const normalizedText = text.toLowerCase().trim();
    
    while (Date.now() - startTime < timeoutMs) {
      const content = container.textContent?.toLowerCase() || '';
      
      if (!content.includes(normalizedText)) {
        return {
          success: true,
          elapsedMs: Date.now() - startTime,
        };
      }
      
      await this.sleep(100);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: `Text "${text}" still present`,
    };
  }
  
  /**
   * Wait for URL to change
   */
  static async waitForURLChange(
    previousURL: string,
    timeoutMs: number = 10000
  ): Promise<WaitResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (window.location.href !== previousURL) {
        return {
          success: true,
          elapsedMs: Date.now() - startTime,
        };
      }
      
      await this.sleep(100);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: 'URL did not change',
    };
  }
  
  /**
   * Wait for URL to contain a pattern
   */
  static async waitForURLContains(
    pattern: string,
    timeoutMs: number = 10000
  ): Promise<WaitResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (window.location.href.includes(pattern)) {
        return {
          success: true,
          elapsedMs: Date.now() - startTime,
        };
      }
      
      await this.sleep(100);
    }
    
    return {
      success: false,
      elapsedMs: Date.now() - startTime,
      reason: `URL does not contain "${pattern}"`,
    };
  }
  
  /**
   * Helper sleep function
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

