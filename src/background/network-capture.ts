/**
 * Network Capture - CDP-based network request monitoring
 * 
 * Captures network requests correlated to user actions during recording.
 * Uses Chrome DevTools Protocol (CDP) for complete network visibility.
 * 
 * Falls back to fetch/XHR patching if CDP unavailable (see network-capture-fallback.ts)
 */

export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  duration?: number;
  responseType?: string;  // 'json' | 'blob' | 'text'
}

export interface NetworkPattern {
  urlPattern: string;      // e.g., "/api/contacts*" (path only, normalized)
  method: string;          // GET, POST, etc.
  expectedStatus?: number;
  triggerDelayMs: number;  // time from action to request
}

/**
 * Interface for network observers
 */
export interface NetworkObserver {
  start(tabId: number): Promise<boolean>;  // Returns false if can't attach
  stop(): void;
  getRequestsInWindow(actionTimestamp: number, windowMs?: number): CapturedRequest[];
  isActive(): boolean;
}

/**
 * CDP-based network observer (primary implementation)
 */
export class CDPNetworkObserver implements NetworkObserver {
  private tabId: number | null = null;
  private isAttached = false;
  private activeRequests = new Map<string, Partial<CapturedRequest>>();
  private completedRequests: CapturedRequest[] = [];
  private maxStoredRequests = 100; // Limit memory usage

  /**
   * Attach CDP debugger and start monitoring network
   */
  async start(tabId: number): Promise<boolean> {
    console.log(`[CDPNetworkObserver] Attempting to attach to tab ${tabId}...`);
    
    try {
      // Try to attach debugger
      await chrome.debugger.attach({ tabId }, '1.3');
      console.log('[CDPNetworkObserver] ✅ Debugger attached successfully');
      
      // Enable network monitoring
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      console.log('[CDPNetworkObserver] ✅ Network monitoring enabled');
      
      this.tabId = tabId;
      this.isAttached = true;
      
      // Listen to CDP events
      chrome.debugger.onEvent.addListener(this.handleCDPEvent.bind(this));
      
      // Listen for debugger detach
      chrome.debugger.onDetach.addListener(this.handleDetach.bind(this));
      
      return true;
    } catch (error) {
      console.warn('[CDPNetworkObserver] ❌ CDP attach failed:', error);
      console.warn('[CDPNetworkObserver] This may be due to:');
      console.warn('  - Debugger permission blocked by organization policy');
      console.warn('  - Another debugger already attached');
      console.warn('  - User declined debugger permission');
      console.warn('[CDPNetworkObserver] Will use fetch/XHR fallback instead');
      return false;
    }
  }

  /**
   * Stop monitoring and detach debugger
   */
  stop(): void {
    if (!this.tabId || !this.isAttached) return;

    try {
      chrome.debugger.detach({ tabId: this.tabId });
      console.log('[CDPNetworkObserver] Debugger detached');
    } catch (error) {
      console.warn('[CDPNetworkObserver] Error detaching debugger:', error);
    }

    this.isAttached = false;
    this.tabId = null;
    this.activeRequests.clear();
    this.completedRequests = [];
  }

  /**
   * Check if observer is actively monitoring
   */
  isActive(): boolean {
    return this.isAttached && this.tabId !== null;
  }

  /**
   * Get requests in time window after action (synchronous)
   */
  getRequestsInWindow(
    actionTimestamp: number,
    windowMs: number = 2000
  ): CapturedRequest[] {
    const endTime = actionTimestamp + windowMs;
    
    return this.completedRequests.filter(req => 
      req.timestamp >= actionTimestamp && req.timestamp <= endTime
    );
  }

  /**
   * Handle CDP events
   */
  private handleCDPEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: any
  ): void {
    // Only handle events for our tab
    if (source.tabId !== this.tabId) return;

    switch (method) {
      case 'Network.requestWillBeSent':
        this.onRequestWillBeSent(params);
        break;
      case 'Network.responseReceived':
        this.onResponseReceived(params);
        break;
      case 'Network.loadingFinished':
        this.onLoadingFinished(params);
        break;
      case 'Network.loadingFailed':
        this.onLoadingFailed(params);
        break;
    }
  }

  /**
   * Handle debugger detach
   */
  private handleDetach(source: chrome.debugger.Debuggee, reason?: string): void {
    if (source.tabId === this.tabId) {
      console.log(`[CDPNetworkObserver] Debugger detached: ${reason || 'unknown reason'}`);
      this.isAttached = false;
      this.tabId = null;
    }
  }

  /**
   * Network.requestWillBeSent - Request initiated
   */
  private onRequestWillBeSent(params: any): void {
    const { requestId, request, timestamp } = params;
    
    this.activeRequests.set(requestId, {
      url: request.url,
      method: request.method,
      timestamp: timestamp * 1000, // CDP timestamp is in seconds
    });
  }

  /**
   * Network.responseReceived - Response headers received
   */
  private onResponseReceived(params: any): void {
    const { requestId, response } = params;
    
    const req = this.activeRequests.get(requestId);
    if (req) {
      req.status = response.status;
      req.responseType = this.inferResponseType(response);
    }
  }

  /**
   * Network.loadingFinished - Request completed successfully
   */
  private onLoadingFinished(params: any): void {
    const { requestId, timestamp } = params;
    
    const req = this.activeRequests.get(requestId);
    if (req && req.url && req.method && req.timestamp) {
      const duration = (timestamp * 1000) - req.timestamp;
      
      const completedReq: CapturedRequest = {
        url: req.url,
        method: req.method,
        status: req.status,
        timestamp: req.timestamp,
        duration,
        responseType: req.responseType,
      };
      
      this.completedRequests.push(completedReq);
      
      // Limit stored requests to prevent memory issues
      if (this.completedRequests.length > this.maxStoredRequests) {
        this.completedRequests.shift();
      }
    }
    
    this.activeRequests.delete(requestId);
  }

  /**
   * Network.loadingFailed - Request failed
   */
  private onLoadingFailed(params: any): void {
    const { requestId } = params;
    
    const req = this.activeRequests.get(requestId);
    if (req && req.url && req.method && req.timestamp) {
      // Still record failed requests (status will be undefined)
      const completedReq: CapturedRequest = {
        url: req.url,
        method: req.method,
        status: undefined, // Failed
        timestamp: req.timestamp,
        duration: undefined,
        responseType: undefined,
      };
      
      this.completedRequests.push(completedReq);
      
      if (this.completedRequests.length > this.maxStoredRequests) {
        this.completedRequests.shift();
      }
    }
    
    this.activeRequests.delete(requestId);
  }

  /**
   * Infer response type from headers
   */
  private inferResponseType(response: any): string | undefined {
    const contentType = response.headers?.['content-type'] || 
                       response.headers?.['Content-Type'] || '';
    
    if (contentType.includes('application/json')) {
      return 'json';
    } else if (contentType.includes('text/')) {
      return 'text';
    } else if (contentType.includes('application/octet-stream') || 
               contentType.includes('blob')) {
      return 'blob';
    }
    
    return undefined;
  }
}

/**
 * Factory function to create network observer
 * Tries CDP first, falls back to fetch/XHR patching
 */
export async function createNetworkObserver(tabId: number): Promise<NetworkObserver> {
  // Try CDP first
  const cdp = new CDPNetworkObserver();
  const cdpSuccess = await cdp.start(tabId);
  
  if (cdpSuccess) {
    console.log('[NetworkCapture] Using CDP observer');
    return cdp;
  }
  
  // Fallback to fetch/XHR observer (implemented in content script)
  console.log('[NetworkCapture] CDP unavailable, will use fetch/XHR fallback');
  
  // For fallback, we need to communicate with content script
  // Return a proxy observer that communicates via messages
  const { FetchXHRObserverProxy } = await import('./network-capture-proxy');
  return new FetchXHRObserverProxy(tabId);
}

/**
 * Convert captured requests to network patterns for storage
 */
export function generateNetworkPatterns(
  requests: CapturedRequest[],
  actionTimestamp: number
): NetworkPattern[] {
  const patterns: NetworkPattern[] = [];
  
  for (const req of requests) {
    // Filter out static assets, extensions, chrome internals
    if (req.url.includes('chrome-extension://')) continue;
    if (req.url.includes('chrome://')) continue;
    if (req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico)$/)) continue;
    
    // Extract path pattern from URL
    try {
      const url = new URL(req.url);
      let urlPattern = url.pathname;
      
      // Normalize: remove trailing slashes
      if (urlPattern.endsWith('/') && urlPattern.length > 1) {
        urlPattern = urlPattern.slice(0, -1);
      }
      
      // Add wildcard for query params if present
      if (url.search) {
        urlPattern += '*';
      }
      
      patterns.push({
        urlPattern,
        method: req.method,
        expectedStatus: req.status,
        triggerDelayMs: req.timestamp - actionTimestamp,
      });
    } catch (e) {
      // Invalid URL, skip
      continue;
    }
    
    // Limit to top 5 requests
    if (patterns.length >= 5) break;
  }
  
  return patterns;
}


