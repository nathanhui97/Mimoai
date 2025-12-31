/**
 * Network Capture Proxy - Communicates with content script fallback observer
 * 
 * When CDP is unavailable, this proxy forwards calls to the content script's
 * fetch/XHR observer via message passing.
 */

import type { NetworkObserver, CapturedRequest } from './network-capture';

/**
 * Proxy that communicates with content script's fetch/XHR observer
 */
export class FetchXHRObserverProxy implements NetworkObserver {
  private tabId: number;
  private active = false;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  async start(tabId: number): Promise<boolean> {
    try {
      // Send message to content script to start monitoring
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'START_NETWORK_CAPTURE',
      });
      
      if (response?.success) {
        this.active = true;
        console.log('[FetchXHRObserverProxy] Content script observer started');
        return true;
      }
      
      console.warn('[FetchXHRObserverProxy] Failed to start content script observer');
      return false;
    } catch (error) {
      console.error('[FetchXHRObserverProxy] Error starting observer:', error);
      return false;
    }
  }

  stop(): void {
    if (!this.active) return;

    try {
      chrome.tabs.sendMessage(this.tabId, {
        type: 'STOP_NETWORK_CAPTURE',
      }).catch(() => {
        // Tab may have been closed, ignore
      });
      
      this.active = false;
      console.log('[FetchXHRObserverProxy] Content script observer stopped');
    } catch (error) {
      console.warn('[FetchXHRObserverProxy] Error stopping observer:', error);
    }
  }

  getRequestsInWindow(
    _actionTimestamp: number,
    _windowMs: number = 2000
  ): CapturedRequest[] {
    // Proxy can't make synchronous calls to content script
    // For now, return empty array. This will be populated via message passing
    // in a future iteration when we wire up the full CDP/fallback flow
    console.warn('[FetchXHRObserverProxy] getRequestsInWindow called - not yet implemented for proxy');
    return [];
  }

  isActive(): boolean {
    return this.active;
  }
}


