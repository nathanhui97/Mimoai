/**
 * Screenshot Capture
 *
 * Captures screenshots of the current tab for vision analysis.
 * Uses Chrome extension APIs for capture.
 */

import type { Screenshot } from '../types';

/**
 * Capture a screenshot of the visible viewport
 */
export async function captureViewport(): Promise<Screenshot> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      chrome.windows.WINDOW_ID_CURRENT, // current window
      { format: 'png', quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!dataUrl) {
          reject(new Error('Failed to capture screenshot'));
          return;
        }

        // Get current tab info
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];

          resolve({
            data: dataUrl,
            timestamp: Date.now(),
            viewport: {
              width: tab?.width || (typeof window !== 'undefined' ? window.innerWidth : 1920) || 1920,
              height: tab?.height || (typeof window !== 'undefined' ? window.innerHeight : 1080) || 1080,
            },
            url: tab?.url || '',
            title: tab?.title || '',
            format: 'png',
          });
        });
      }
    );
  });
}

/**
 * Capture a full-page screenshot (scrolls and stitches)
 * For now, falls back to viewport capture.
 * TODO: Implement full page capture via CDP
 */
export async function captureScreenshot(): Promise<Screenshot> {
  // For initial implementation, just capture viewport
  // Full page capture requires CDP Page.captureScreenshot with captureBeyondViewport
  return captureViewport();
}

/**
 * Capture screenshot via CDP (for when we have debugger attached)
 *
 * IMPORTANT: We capture at CSS pixel resolution (deviceScaleFactor: 1) to ensure
 * coordinates from vision AI match CDP mouse event coordinates.
 */
export async function captureScreenshotCDP(tabId: number): Promise<Screenshot> {
  // First, get the layout metrics to know the actual viewport size
  const layoutMetrics: any = await new Promise((resolve) => {
    chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics', {}, (result: any) => {
      if (chrome.runtime.lastError) {
        // Fallback if getLayoutMetrics fails
        resolve(null);
        return;
      }
      resolve(result);
    });
  });

  const viewportWidth = layoutMetrics?.cssLayoutViewport?.clientWidth || layoutMetrics?.layoutViewport?.clientWidth || 1920;
  const viewportHeight = layoutMetrics?.cssLayoutViewport?.clientHeight || layoutMetrics?.layoutViewport?.clientHeight || 1080;

  console.log(`[Screenshot] Capturing at CSS viewport: ${viewportWidth}x${viewportHeight}`);

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      { tabId },
      'Page.captureScreenshot',
      {
        format: 'png',
        quality: 100,
        captureBeyondViewport: false,
        // CRITICAL: Set clip to viewport size and deviceScaleFactor to 1
        // This ensures the image dimensions match CSS pixel coordinates
        clip: {
          x: 0,
          y: 0,
          width: viewportWidth,
          height: viewportHeight,
          scale: 1, // CSS pixels, not device pixels
        },
      },
      (result: any) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!result?.data) {
          reject(new Error('Failed to capture screenshot via CDP'));
          return;
        }

        // Get tab info
        chrome.tabs.get(tabId, (tab) => {
          resolve({
            data: `data:image/png;base64,${result.data}`,
            timestamp: Date.now(),
            viewport: {
              width: viewportWidth,
              height: viewportHeight,
            },
            url: tab?.url || '',
            title: tab?.title || '',
            format: 'png',
          });
        });
      }
    );
  });
}

/**
 * Extract base64 data from data URL
 */
export function extractBase64(screenshot: Screenshot): string {
  const match = screenshot.data.match(/^data:image\/[^;]+;base64,(.+)$/);
  return match ? match[1] : screenshot.data;
}

/**
 * Compress screenshot for API calls (reduce size)
 * Note: This function requires DOM APIs (Image, canvas) and won't work in service workers.
 * In service worker context, it returns the original screenshot uncompressed.
 */
export async function compressScreenshot(
  screenshot: Screenshot,
  maxWidth: number = 1280,
  quality: number = 0.8
): Promise<Screenshot> {
  // Check if we're in a context that supports DOM APIs
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    console.log('[screenshot] Skipping compression - DOM APIs not available');
    return screenshot;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = Math.round(height * ratio);
      }

      // Create canvas and draw resized image
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);

        resolve({
          ...screenshot,
          data: canvas.toDataURL('image/jpeg', quality),
          format: 'jpeg',
          viewport: { width, height },
        });
      } else {
        resolve(screenshot);
      }
    };

    img.onerror = () => resolve(screenshot);
    img.src = screenshot.data;
  });
}
