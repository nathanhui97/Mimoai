/**
 * Network Capture Fallback - Fetch/XHR patching observer
 * 
 * Used when CDP is unavailable (blocked by policy, user declined, etc.)
 * Patches window.fetch and XMLHttpRequest to monitor network requests.
 * 
 * This runs in the content script context.
 */

export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  duration?: number;
  responseType?: string;
}

/**
 * Fetch/XHR observer for content script (fallback when CDP unavailable)
 */
export class FetchXHRObserver {
  private isMonitoring = false;
  private completedRequests: CapturedRequest[] = [];
  private maxStoredRequests = 100;
  private originalFetch: typeof window.fetch | null = null;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;

  /**
   * Start monitoring fetch/XHR requests
   */
  start(): boolean {
    if (this.isMonitoring) {
      console.log('[FetchXHRObserver] Already monitoring');
      return true;
    }

    try {
      this.patchFetch();
      this.patchXHR();
      this.isMonitoring = true;
      console.log('[FetchXHRObserver] ✅ Started monitoring fetch/XHR requests');
      return true;
    } catch (error) {
      console.error('[FetchXHRObserver] Failed to start monitoring:', error);
      return false;
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isMonitoring) return;

    // Restore originals
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
    }
    if (this.originalXHROpen) {
      XMLHttpRequest.prototype.open = this.originalXHROpen;
    }
    if (this.originalXHRSend) {
      XMLHttpRequest.prototype.send = this.originalXHRSend;
    }

    this.isMonitoring = false;
    this.completedRequests = [];
    console.log('[FetchXHRObserver] Stopped monitoring');
  }

  /**
   * Get requests in time window
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
   * Check if monitoring
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Patch window.fetch
   */
  private patchFetch(): void {
    const self = this;
    this.originalFetch = window.fetch;

    window.fetch = async function(...args: Parameters<typeof fetch>): Promise<Response> {
      const startTime = Date.now();
      const firstArg = args[0];
      const url = typeof firstArg === 'string' ? firstArg :
                  firstArg instanceof Request ? firstArg.url :
                  firstArg instanceof URL ? firstArg.toString() : '';
      
      const method = args[1]?.method?.toUpperCase() || 'GET';

      try {
        const response = await self.originalFetch!(...args);
        
        // Record completed request
        const capturedReq: CapturedRequest = {
          url,
          method,
          status: response.status,
          timestamp: startTime,
          duration: Date.now() - startTime,
          responseType: self.inferResponseType(response.headers.get('content-type')),
        };
        
        self.completedRequests.push(capturedReq);
        
        // Limit stored requests
        if (self.completedRequests.length > self.maxStoredRequests) {
          self.completedRequests.shift();
        }
        
        return response;
      } catch (error) {
        // Record failed request
        const capturedReq: CapturedRequest = {
          url,
          method,
          status: undefined,
          timestamp: startTime,
          duration: Date.now() - startTime,
          responseType: undefined,
        };
        
        self.completedRequests.push(capturedReq);
        
        if (self.completedRequests.length > self.maxStoredRequests) {
          self.completedRequests.shift();
        }
        
        throw error;
      }
    };
  }

  /**
   * Patch XMLHttpRequest
   */
  private patchXHR(): void {
    const self = this;
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(
      method: string,
      url: string | URL,
      ...rest: any[]
    ): void {
      const urlStr = typeof url === 'string' ? url : url.toString();
      (this as any)._captureUrl = urlStr;
      (this as any)._captureMethod = method.toUpperCase();
      (this as any)._captureStartTime = Date.now();
      
      return self.originalXHROpen!.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function(...args: any[]): void {
      const url = (this as any)._captureUrl as string | undefined;
      const method = (this as any)._captureMethod as string | undefined;
      const startTime = (this as any)._captureStartTime as number | undefined;

      if (url && method && startTime) {
        const handleLoad = () => {
          const capturedReq: CapturedRequest = {
            url,
            method,
            status: this.status,
            timestamp: startTime,
            duration: Date.now() - startTime,
            responseType: self.inferResponseType(
              this.getResponseHeader('content-type')
            ),
          };
          
          self.completedRequests.push(capturedReq);
          
          if (self.completedRequests.length > self.maxStoredRequests) {
            self.completedRequests.shift();
          }
        };

        const handleError = () => {
          const capturedReq: CapturedRequest = {
            url,
            method,
            status: undefined,
            timestamp: startTime,
            duration: Date.now() - startTime,
            responseType: undefined,
          };
          
          self.completedRequests.push(capturedReq);
          
          if (self.completedRequests.length > self.maxStoredRequests) {
            self.completedRequests.shift();
          }
        };

        this.addEventListener('load', handleLoad);
        this.addEventListener('error', handleError);
        this.addEventListener('abort', handleError);
      }

      return self.originalXHRSend!.apply(this, args as any);
    };
  }

  /**
   * Infer response type from content-type header
   */
  private inferResponseType(contentType: string | null): string | undefined {
    if (!contentType) return undefined;
    
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

// Global instance for content script
let globalObserver: FetchXHRObserver | null = null;

/**
 * Get or create global observer instance
 */
export function getGlobalObserver(): FetchXHRObserver {
  if (!globalObserver) {
    globalObserver = new FetchXHRObserver();
  }
  return globalObserver;
}


