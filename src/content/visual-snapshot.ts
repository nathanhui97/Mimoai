/**
 * Visual Snapshot Service - Captures viewport and element snippets using Chrome API
 * Uses native Chrome captureVisibleTab API + Canvas cropping to avoid html2canvas limitations
 * (html2canvas fails on Google Sheets canvas elements and cross-origin iframes)
 * 
 * Enhanced with full page capture and region extraction for human-like visual understanding
 * 
 * Now includes annotation capabilities for AI Visual Click:
 * - Captures screenshots with visual markers showing where user clicked/typed
 * - Provides both original and annotated versions for debugging and AI analysis
 */

import type { PageRegions, BoundingBox } from '../types/visual';
import { VisualAnnotationService, type ActionType } from '../lib/visual-annotation';

export interface CaptureResult {
  viewport: string;
  elementSnippet: string;
}

export interface FullPageResult {
  screenshot: string; // Base64 full page screenshot
  dimensions: {
    width: number;
    height: number;
  };
  timestamp: number;
}

export interface RegionCapture {
  region: BoundingBox;
  screenshot: string; // Base64 cropped region
  name: string; // Region name (header, sidebar, etc.)
}

export interface MultiResolutionSnapshot {
  /** Full viewport screenshot */
  fullViewport: string;
  /** 2x zoomed region around target area */
  zoomedRegion?: string;
  /** Tight crop around target area (for small elements) */
  focusedCrop?: string;
  /** Metadata about the snapshots */
  metadata: {
    viewportSize: { width: number; height: number };
    zoomLevel?: number;
    focusArea?: { x: number; y: number; width: number; height: number };
  };
}

export interface AnnotatedCaptureResult {
  /** Original viewport screenshot (unchanged) */
  viewport: string;
  /** Cropped element snippet (unchanged) */
  elementSnippet: string;
  /** Annotated viewport with visual markers */
  annotatedViewport?: string;
  /** Annotated element snippet with visual markers */
  annotatedSnippet?: string;
  /** Click point coordinates (in viewport space) */
  clickPoint?: { x: number; y: number };
  /** Action type that was annotated */
  actionType?: ActionType;
  /** Timestamp of capture */
  timestamp: number;
  /** Viewport dimensions */
  viewportSize: { width: number; height: number };
  /** Element bounds in viewport */
  elementBounds?: BoundingBox;
}

export class VisualSnapshotService {
  // Cache for full page screenshot to avoid redundant captures
  private static lastFullPageCapture: {
    screenshot: string;
    timestamp: number;
  } | null = null;
  private static readonly CACHE_TTL = 500; // 500ms cache for rapid captures

  /**
   * Check if current page is a spreadsheet domain (Google Sheets or Excel Online)
   */
  static isSpreadsheetDomain(): boolean {
    const url = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    
    // Google Sheets
    if (hostname.includes('docs.google.com') && url.includes('/spreadsheets')) {
      return true;
    }
    
    // Excel Online - Be specific to avoid false positives
    if (hostname === 'excel.office.com' || 
        hostname.endsWith('.excel.office.com') ||
        (hostname.includes('onedrive.live.com') && url.includes('/excel')) ||
        (hostname.includes('.sharepoint.com') && url.includes('/_layouts/15/Doc.aspx'))) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if element is a spreadsheet cell
   * Only returns true if on spreadsheet domain AND element is in spreadsheet context
   */
  static isSpreadsheetCell(element: Element): boolean {
    // First check domain - must be on spreadsheet domain
    if (!this.isSpreadsheetDomain()) {
      return false;
    }
    
    // Import ContextScanner dynamically to avoid circular dependencies
    // Check for spreadsheet container
    const className = element.className?.toString().toLowerCase() || '';
    
    // Google Sheets indicators
    if (className.includes('input-box') || 
        className.includes('cell-input') ||
        className.includes('waffle') ||
        className.includes('grid-container') ||
        className.includes('grid-table-container')) {
      return true;
    }
    
    // Excel Online indicators
    if (className.includes('excel') || 
        className.includes('office-grid')) {
      return true;
    }
    
    // Check if element is in a spreadsheet container
    let current: Element | null = element;
    let level = 0;
    while (current && level < 10) {
      const currentClass = current.className?.toString().toLowerCase() || '';
      const currentId = current.id?.toLowerCase() || '';
      
      if (currentClass.includes('grid-container') ||
          currentClass.includes('grid-table-container') ||
          currentClass.includes('waffle') ||
          currentClass.includes('spreadsheet') ||
          currentId.includes('spreadsheet') ||
          currentId.includes('grid')) {
        return true;
      }
      
      current = current.parentElement;
      level++;
    }
    
    return false;
  }

  /**
   * Capture viewport and element snippet using Chrome API + Canvas crop
   * This avoids html2canvas limitations with Google Sheets canvas elements
   */
  static async capture(element: Element): Promise<CaptureResult | null> {
    try {
      // First check domain - use spreadsheet capture on spreadsheet domains
      if (this.isSpreadsheetDomain() && this.isSpreadsheetCell(element)) {
        console.log('📸 GhostWriter: Detected spreadsheet cell, using enhanced capture');
        return await this.captureSpreadsheetCell(element);
      }

      // Step A: Get Coordinates BEFORE the async call (in case DOM shifts)
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('📸 GhostWriter: Element has zero dimensions, skipping snapshot');
        return null;
      }

      console.log('📸 GhostWriter: Requesting viewport screenshot from service worker');
      // Step B: Get the Master Screenshot via Chrome API
      // This handles the "Google Sheets Canvas" problem because it captures pixels, not DOM
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      if (!response || !response.data?.snapshot) {
        console.warn('📸 GhostWriter: No snapshot received from service worker');
        return null;
      }
      
      const fullScreenshot = response.data.snapshot;
      console.log('📸 GhostWriter: Viewport screenshot captured, size:', fullScreenshot.length, 'chars');

      // Step C: Crop it (Handling Retina Displays)
      const snippet = await this.cropImage(fullScreenshot, rect, 200);
      console.log('📸 GhostWriter: Element snippet cropped, size:', snippet.length, 'chars');

      return {
        viewport: fullScreenshot,
        elementSnippet: snippet
      };
    } catch (err) {
      console.warn("📸 GhostWriter Visual Capture Failed:", err);
      return null;
    }
  }

  /**
   * Capture spreadsheet cell with enhanced header detection
   * Only activates on spreadsheet domains
   * Ensures column headers are included in snapshot even when scrolled
   */
  static async captureSpreadsheetCell(element: Element): Promise<CaptureResult | null> {
    try {
      // Only activate on spreadsheet domains
      if (!this.isSpreadsheetDomain()) {
        console.log('📸 GhostWriter: Not on spreadsheet domain, using standard capture');
        return await this.capture(element);
      }

      // Get element coordinates
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('📸 GhostWriter: Spreadsheet cell has zero dimensions, skipping snapshot');
        return null;
      }

      console.log('📸 GhostWriter: Capturing spreadsheet cell with header detection');
      
      // Get viewport screenshot
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      if (!response || !response.data?.snapshot) {
        console.warn('📸 GhostWriter: No snapshot received from service worker');
        return null;
      }
      
      const fullScreenshot = response.data.snapshot;
      console.log('📸 GhostWriter: Viewport screenshot captured for spreadsheet cell');

      // Calculate crop region that includes header row
      // Use larger vertical padding (up to 500px) to ensure header is captured
      const headerBounds = await this.calculateSpreadsheetCropRegion(element, rect);
      const extendedRect = headerBounds || rect;
      
      // Use larger padding for spreadsheet cells to ensure headers are visible
      const verticalPadding = headerBounds ? 0 : 500; // If we found header bounds, use them; otherwise use large padding
      const horizontalPadding = 200;
      
      const snippet = await this.cropImageWithHeader(
        fullScreenshot, 
        rect, 
        extendedRect,
        horizontalPadding, 
        verticalPadding
      );
      
      console.log('📸 GhostWriter: Spreadsheet cell snippet cropped with header context');

      return {
        viewport: fullScreenshot,
        elementSnippet: snippet
      };
    } catch (err) {
      console.warn("📸 GhostWriter Spreadsheet Cell Capture Failed:", err);
      // Fallback to standard capture
      return await this.capture(element);
    }
  }

  /**
   * Calculate optimal crop region for spreadsheet cell including header
   * Returns extended bounds that ensure header visibility
   */
  private static async calculateSpreadsheetCropRegion(
    element: Element, 
    cellRect: DOMRect
  ): Promise<DOMRect | null> {
    try {
      // Try to find header row element
      // Import ContextScanner to use its methods
      // For now, we'll use a simple heuristic: look for header row above the cell
      
      // Find spreadsheet container
      let container: Element | null = element;
      let level = 0;
      while (container && level < 10) {
        const className = container.className?.toString().toLowerCase() || '';
        if (className.includes('grid-container') ||
            className.includes('grid-table-container') ||
            className.includes('waffle')) {
          break;
        }
        container = container.parentElement;
        level++;
      }
      
      if (!container) {
        return null;
      }
      
      // Try to find header row (usually row 0 or 1)
      const headerRow = container.querySelector('[role="rowheader"], thead tr, [data-row="0"], [data-row="1"]');
      if (headerRow) {
        const headerRect = headerRow.getBoundingClientRect();
        // If header is above the cell, include it in crop region
        if (headerRect.top < cellRect.top && headerRect.bottom < cellRect.top) {
          // Calculate extended rect that includes both header and cell
          const extendedTop = Math.min(headerRect.top, cellRect.top);
          const extendedBottom = cellRect.bottom;
          const extendedLeft = Math.min(headerRect.left, cellRect.left);
          const extendedRight = Math.max(headerRect.right, cellRect.right);
          
          return new DOMRect(
            extendedLeft,
            extendedTop,
            extendedRight - extendedLeft,
            extendedBottom - extendedTop
          );
        }
      }
      
      return null;
    } catch (err) {
      console.warn('📸 GhostWriter: Failed to calculate spreadsheet crop region:', err);
      return null;
    }
  }

  /**
   * Crop image with optional header bounds
   * When header bounds are provided, ensures header is included in crop
   */
  private static async cropImageWithHeader(
    base64: string, 
    cellRect: DOMRect, 
    headerBounds: DOMRect | null,
    horizontalPadding: number = 200,
    verticalPadding: number = 200
  ): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(base64);
          return;
        }
        
        const dpr = window.devicePixelRatio || 1;
        
        // Use header bounds if available, otherwise use cell rect with padding
        const cropRect = headerBounds || cellRect;
        const paddingX = headerBounds ? 0 : horizontalPadding;
        const paddingY = headerBounds ? 0 : verticalPadding;
        
        const sourceX = Math.max(0, (cropRect.left - paddingX) * dpr);
        const sourceY = Math.max(0, (cropRect.top - paddingY) * dpr);
        const sourceWidth = Math.min(
          (cropRect.width + (paddingX * 2)) * dpr,
          image.width - sourceX
        );
        const sourceHeight = Math.min(
          (cropRect.height + (paddingY * 2)) * dpr,
          image.height - sourceY
        );
        
        if (sourceWidth <= 0 || sourceHeight <= 0) {
          resolve(base64);
          return;
        }
        
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        
        ctx.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, sourceWidth, sourceHeight
        );
        
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      image.onerror = () => resolve(base64);
      image.src = base64;
    });
  }

  /**
   * Get current zoom level of the tab
   */
  static async getZoomLevel(): Promise<number> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ZOOM' });
      if (response?.success && typeof response.data?.zoomFactor === 'number') {
        return response.data.zoomFactor;
      }
      console.warn('📸 GhostWriter: Failed to get zoom level, defaulting to 1.0');
      return 1.0;
    } catch (err) {
      console.warn('📸 GhostWriter: Error getting zoom level:', err);
      return 1.0;
    }
  }

  /**
   * Set zoom level of the tab
   */
  static async setZoomLevel(zoomFactor: number): Promise<boolean> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_ZOOM',
        payload: { zoomFactor }
      });
      if (response?.success) {
        // Wait a bit for zoom to apply
        await new Promise(resolve => setTimeout(resolve, 200));
        return true;
      }
      console.warn('📸 GhostWriter: Failed to set zoom level');
      return false;
    } catch (err) {
      console.warn('📸 GhostWriter: Error setting zoom level:', err);
      return false;
    }
  }

  /**
   * Capture full page screenshot (optimized for AI analysis)
   * Uses compression to keep size manageable while preserving visual clarity
   * Note: For spreadsheets, page is refreshed before recording starts, so headers are visible
   * For spreadsheets, zooms out to 33% to capture more columns, then restores original zoom
   * @param quality - JPEG quality (0-1)
   * @param skipZoom - If true, skip zoom manipulation (use during execution to avoid flashing)
   */
  static async captureFullPage(quality: number = 0.7, skipZoom: boolean = false): Promise<FullPageResult | null> {
    // CRITICAL: Only apply zoom for spreadsheets (Google Sheets/Excel)
    // Skip zoom if explicitly requested (e.g., during execution)
    const isSpreadsheet = this.isSpreadsheetDomain() && !skipZoom;
    let originalZoom = 1.0;

    try {
      // Check cache first
      const now = Date.now();
      if (this.lastFullPageCapture && 
          (now - this.lastFullPageCapture.timestamp) < this.CACHE_TTL) {
        console.log('📸 GhostWriter: Using cached full page screenshot');
        return {
          screenshot: this.lastFullPageCapture.screenshot,
          dimensions: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          timestamp: this.lastFullPageCapture.timestamp,
        };
      }

      // For spreadsheets, zoom out to capture more columns
      if (isSpreadsheet) {
        try {
          // 1. Get current zoom level
          originalZoom = await this.getZoomLevel();
          console.log(`📸 GhostWriter: Current zoom level: ${originalZoom}`);

          // 2. Set zoom to 33% (0.33) - safer than 25% to avoid pixel mush
          // 33% triples visible columns while keeping text readable
          await this.setZoomLevel(0.33);
          console.log('📸 GhostWriter: Zoomed out to 33% for spreadsheet capture');

          // 3. CRITICAL: Wait 1000ms for Google Sheets Canvas to repaint
          // Google Sheets needs time to fetch virtualized rows/cols after zoom
          // Increased from 600ms to 1000ms for more reliable header rendering
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (zoomErr) {
          console.warn('📸 GhostWriter: Zoom operation failed, continuing with current zoom:', zoomErr);
          // Continue with capture at current zoom if zoom fails
        }
      }

      console.log('📸 GhostWriter: Capturing full page screenshot...');
      
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      if (!response || !response.data?.snapshot) {
        console.warn('📸 GhostWriter: No snapshot received from service worker');
        return null;
      }

      const fullScreenshot = response.data.snapshot;
      
      // Compress full page screenshot for AI efficiency
      const compressed = await this.compressImage(fullScreenshot, quality);
      
      console.log('📸 GhostWriter: Full page captured, original:', fullScreenshot.length, 
                  'chars, compressed:', compressed.length, 'chars');

      // Update cache
      this.lastFullPageCapture = {
        screenshot: compressed,
        timestamp: now,
      };

      return {
        screenshot: compressed,
        dimensions: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        timestamp: now,
      };
    } catch (err) {
      console.warn('📸 GhostWriter: Full page capture failed:', err);
      return null;
    } finally {
      // RESTORE ZOOM NO MATTER WHAT (even if capture errors)
      // Only restore if we're on a spreadsheet (where we may have changed zoom)
      if (isSpreadsheet) {
        console.log(`📸 GhostWriter: Restoring zoom from 33% to ${originalZoom}...`);
        try {
          const restoreSuccess = await this.setZoomLevel(originalZoom);
          if (restoreSuccess) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Smooth transition
            console.log(`📸 GhostWriter: ✅ Zoom restored to ${originalZoom}`);
          } else {
            console.error(`📸 GhostWriter: ❌ setZoomLevel returned false for ${originalZoom}`);
          }
        } catch (restoreErr) {
          console.error('📸 GhostWriter: ❌ Failed to restore zoom level:', restoreErr);
        }
      }
    }
  }

  /**
   * Capture multiple page regions (header, sidebar, main content, etc.)
   * Uses heuristics to identify common page regions
   */
  static async capturePageRegions(): Promise<{
    regions: PageRegions;
    captures: RegionCapture[];
  } | null> {
    try {
      // First capture full page (skipZoom for execution)
      const fullPage = await this.captureFullPage(0.8, true);
      if (!fullPage) {
        return null;
      }

      // Detect page regions using DOM heuristics
      const regions = this.detectPageRegions();
      
      // Capture each detected region
      const captures: RegionCapture[] = [];
      
      for (const [name, box] of Object.entries(regions)) {
        if (box) {
          try {
            const regionScreenshot = await this.cropImageFromBox(
              fullPage.screenshot,
              box,
              0
            );
            captures.push({
              region: box,
              screenshot: regionScreenshot,
              name,
            });
          } catch (err) {
            console.warn(`📸 GhostWriter: Failed to capture region ${name}:`, err);
          }
        }
      }

      console.log('📸 GhostWriter: Captured', captures.length, 'page regions');

      return {
        regions,
        captures,
      };
    } catch (err) {
      console.warn('📸 GhostWriter: Page regions capture failed:', err);
      return null;
    }
  }

  /**
   * Capture a specific bounding box region
   */
  static async captureRegion(box: BoundingBox, padding: number = 20): Promise<string | null> {
    try {
      // skipZoom for execution
      const fullPage = await this.captureFullPage(0.7, true);
      if (!fullPage) {
        return null;
      }

      return await this.cropImageFromBox(fullPage.screenshot, box, padding);
    } catch (err) {
      console.warn('📸 GhostWriter: Region capture failed:', err);
      return null;
    }
  }

  /**
   * Capture multiple elements at once (batch operation)
   */
  static async captureElements(elements: Element[]): Promise<Map<Element, string>> {
    const results = new Map<Element, string>();

    try {
      // Get single full page screenshot (skipZoom for execution)
      const fullPage = await this.captureFullPage(0.7, true);
      if (!fullPage) {
        return results;
      }

      // Crop each element from the same screenshot
      for (const element of elements) {
        try {
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const snippet = await this.cropImage(fullPage.screenshot, rect, 50);
            results.set(element, snippet);
          }
        } catch (err) {
          // Skip failed elements
        }
      }

      console.log('📸 GhostWriter: Batch captured', results.size, 'of', elements.length, 'elements');
    } catch (err) {
      console.warn('📸 GhostWriter: Batch capture failed:', err);
    }

    return results;
  }

  /**
   * Compare two screenshots for similarity (basic pixel comparison)
   * Returns 0-1 similarity score
   */
  static async compareScreenshots(screenshot1: string, screenshot2: string): Promise<number> {
    return new Promise((resolve) => {
      const img1 = new Image();
      const img2 = new Image();
      let loaded = 0;

      const checkBoth = () => {
        loaded++;
        if (loaded < 2) return;

        try {
          // Resize to common dimensions for comparison
          const size = 100; // Small size for fast comparison
          const canvas1 = document.createElement('canvas');
          const canvas2 = document.createElement('canvas');
          canvas1.width = canvas2.width = size;
          canvas1.height = canvas2.height = size;

          const ctx1 = canvas1.getContext('2d');
          const ctx2 = canvas2.getContext('2d');

          if (!ctx1 || !ctx2) {
            resolve(0);
            return;
          }

          ctx1.drawImage(img1, 0, 0, size, size);
          ctx2.drawImage(img2, 0, 0, size, size);

          const data1 = ctx1.getImageData(0, 0, size, size).data;
          const data2 = ctx2.getImageData(0, 0, size, size).data;

          // Calculate pixel-wise similarity
          let diff = 0;
          for (let i = 0; i < data1.length; i += 4) {
            // Compare RGB (skip alpha)
            diff += Math.abs(data1[i] - data2[i]);     // R
            diff += Math.abs(data1[i + 1] - data2[i + 1]); // G
            diff += Math.abs(data1[i + 2] - data2[i + 2]); // B
          }

          const maxDiff = size * size * 3 * 255;
          const similarity = 1 - (diff / maxDiff);
          resolve(similarity);
        } catch (err) {
          resolve(0);
        }
      };

      img1.onload = checkBoth;
      img2.onload = checkBoth;
      img1.onerror = () => resolve(0);
      img2.onerror = () => resolve(0);
      img1.src = screenshot1;
      img2.src = screenshot2;
    });
  }

  /**
   * Detect page regions using DOM heuristics
   */
  private static detectPageRegions(): PageRegions {
    const regions: PageRegions = {};
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Detect header - typically at top, full width
    const headerCandidates = document.querySelectorAll(
      'header, [role="banner"], nav:first-of-type, .header, #header, .navbar, .top-bar'
    );
    for (const el of headerCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 100 && rect.width > viewportWidth * 0.8) {
        regions.header = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect sidebar - typically on left or right, tall
    const sidebarCandidates = document.querySelectorAll(
      'aside, [role="complementary"], .sidebar, #sidebar, .side-nav, .left-panel, .right-panel'
    );
    for (const el of sidebarCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.height > viewportHeight * 0.5 && rect.width < viewportWidth * 0.3) {
        regions.sidebar = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect main content - typically the largest central area
    const mainCandidates = document.querySelectorAll(
      'main, [role="main"], .main-content, #main, .content, #content, article'
    );
    for (const el of mainCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > viewportWidth * 0.4 && rect.height > viewportHeight * 0.4) {
        regions.mainContent = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect footer - typically at bottom, full width
    const footerCandidates = document.querySelectorAll(
      'footer, [role="contentinfo"], .footer, #footer'
    );
    for (const el of footerCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > viewportHeight * 0.8 && rect.width > viewportWidth * 0.8) {
        regions.footer = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect navigation
    const navCandidates = document.querySelectorAll(
      'nav, [role="navigation"], .nav, .navigation'
    );
    for (const el of navCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 30) {
        regions.navigation = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect action bar / toolbar
    const toolbarCandidates = document.querySelectorAll(
      '[role="toolbar"], .toolbar, .action-bar, .button-bar, .actions'
    );
    for (const el of toolbarCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100) {
        regions.actionBar = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect form area
    const formCandidates = document.querySelectorAll('form, .form, [role="form"]');
    for (const el of formCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 100) {
        regions.formArea = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    // Detect table area
    const tableCandidates = document.querySelectorAll(
      'table, [role="grid"], .data-table, .table-container'
    );
    for (const el of tableCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 100) {
        regions.tableArea = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        break;
      }
    }

    return regions;
  }

  /**
   * Crop image from base64 string using DOMRect
   */
  private static cropImage(base64: string, rect: DOMRect, padding: number = 200): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(base64); // Fallback to full screenshot if canvas context fails
          return;
        }
        
        // CRITICAL: Handle Device Pixel Ratio (MacBooks/High-DPI)
        const dpr = window.devicePixelRatio || 1;

        // Calculate Crop Dimensions (clamp to image bounds)
        const sourceX = Math.max(0, (rect.left - padding) * dpr);
        const sourceY = Math.max(0, (rect.top - padding) * dpr);
        const sourceWidth = Math.min(
          (rect.width + (padding * 2)) * dpr,
          image.width - sourceX
        );
        const sourceHeight = Math.min(
          (rect.height + (padding * 2)) * dpr,
          image.height - sourceY
        );

        // Ensure valid dimensions
        if (sourceWidth <= 0 || sourceHeight <= 0) {
          resolve(base64); // Fallback to full screenshot
          return;
        }

        canvas.width = sourceWidth;
        canvas.height = sourceHeight;

        ctx.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight, // Source Rect
          0, 0, sourceWidth, sourceHeight              // Dest Rect
        );

        // Compress for Token Efficiency (JPEG 60% quality)
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      image.onerror = () => {
        // Fallback to full screenshot if image load fails
        resolve(base64);
      };
      image.src = base64;
    });
  }

  /**
   * Crop image using BoundingBox (for regions)
   */
  private static cropImageFromBox(base64: string, box: BoundingBox, padding: number = 0): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(base64);
          return;
        }
        
        const dpr = window.devicePixelRatio || 1;

        const sourceX = Math.max(0, (box.x - padding) * dpr);
        const sourceY = Math.max(0, (box.y - padding) * dpr);
        const sourceWidth = Math.min(
          (box.width + (padding * 2)) * dpr,
          image.width - sourceX
        );
        const sourceHeight = Math.min(
          (box.height + (padding * 2)) * dpr,
          image.height - sourceY
        );

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          resolve(base64);
          return;
        }

        canvas.width = sourceWidth;
        canvas.height = sourceHeight;

        ctx.drawImage(
          image,
          sourceX, sourceY, sourceWidth, sourceHeight,
          0, 0, sourceWidth, sourceHeight
        );

        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      image.onerror = () => resolve(base64);
      image.src = base64;
    });
  }

  /**
   * Compress an image to reduce size
   */
  private static compressImage(base64: string, quality: number = 0.7): Promise<string> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(base64);
          return;
        }

        // For very large images, scale down
        let width = image.width;
        let height = image.height;
        const maxDimension = 2000; // Max dimension for AI efficiency

        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = () => resolve(base64);
      image.src = base64;
    });
  }

  /**
   * Clear the screenshot cache
   */
  static clearCache(): void {
    this.lastFullPageCapture = null;
  }

  /**
   * Capture element with visual annotation showing where user clicked/typed
   * 
   * This is the main method for recording phase - captures both original
   * and annotated screenshots for later use by AI Visual Click.
   * 
   * @param element - The element that was interacted with
   * @param clickPoint - The exact coordinates where user clicked (in viewport space)
   * @param actionType - Type of action ('click', 'type', 'select', etc.)
   * @returns Promise with original and annotated screenshots
   */
  static async captureWithAnnotation(
    element: Element,
    clickPoint: { x: number; y: number },
    actionType: ActionType = 'click'
  ): Promise<AnnotatedCaptureResult | null> {
    try {
      // First, capture the standard screenshot
      const standardCapture = await this.capture(element);
      if (!standardCapture) {
        console.warn('📸 GhostWriter: Failed to capture standard screenshot for annotation');
        return null;
      }

      const rect = element.getBoundingClientRect();
      const elementBounds: BoundingBox = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };

      // Create annotated viewport
      let annotatedViewport: string | undefined;
      try {
        const viewportAnnotation = await VisualAnnotationService.annotate(
          standardCapture.viewport,
          {
            actionType,
            clickPoint,
            elementBounds,
            drawBoundingBox: true,
            circleRadius: 20,
            lineWidth: 3,
          }
        );
        annotatedViewport = viewportAnnotation.annotated;
        console.log('📸 GhostWriter: Created annotated viewport, size:', annotatedViewport.length, 'chars');
      } catch (error) {
        console.warn('📸 GhostWriter: Failed to annotate viewport:', error);
      }

      // Create annotated element snippet
      let annotatedSnippet: string | undefined;
      try {
        // For the snippet, we need to adjust the click point relative to the cropped area
        const padding = 200; // Same padding used in cropImage
        const snippetClickPoint = {
          x: clickPoint.x - Math.max(0, rect.left - padding),
          y: clickPoint.y - Math.max(0, rect.top - padding),
        };
        const snippetBounds = {
          x: Math.min(padding, rect.left),
          y: Math.min(padding, rect.top),
          width: rect.width,
          height: rect.height,
        };

        const snippetAnnotation = await VisualAnnotationService.annotate(
          standardCapture.elementSnippet,
          {
            actionType,
            clickPoint: snippetClickPoint,
            elementBounds: snippetBounds,
            drawBoundingBox: true,
            circleRadius: 15,
            lineWidth: 2,
          }
        );
        annotatedSnippet = snippetAnnotation.annotated;
        console.log('📸 GhostWriter: Created annotated snippet, size:', annotatedSnippet.length, 'chars');
      } catch (error) {
        console.warn('📸 GhostWriter: Failed to annotate element snippet:', error);
      }

      return {
        viewport: standardCapture.viewport,
        elementSnippet: standardCapture.elementSnippet,
        annotatedViewport,
        annotatedSnippet,
        clickPoint,
        actionType,
        timestamp: Date.now(),
        viewportSize: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        elementBounds,
      };
    } catch (error) {
      console.error('📸 GhostWriter: captureWithAnnotation failed:', error);
      return null;
    }
  }

  /**
   * Annotate an existing screenshot with a click marker
   * 
   * This is useful during execution when we have a fresh screenshot
   * and want to show where we expect the element to be.
   * 
   * @param screenshot - Existing screenshot to annotate
   * @param clickPoint - Click coordinates
   * @param actionType - Action type
   * @param elementBounds - Optional element bounds
   * @returns Annotated screenshot
   */
  static async annotateScreenshot(
    screenshot: string,
    clickPoint: { x: number; y: number },
    actionType: ActionType = 'click',
    elementBounds?: BoundingBox
  ): Promise<string> {
    try {
      const result = await VisualAnnotationService.annotate(screenshot, {
        actionType,
        clickPoint,
        elementBounds,
        drawBoundingBox: !!elementBounds,
        circleRadius: 25, // Larger for AI visibility
        lineWidth: 4,     // Thicker for AI
      });
      return result.annotated;
    } catch (error) {
      console.warn('📸 GhostWriter: Failed to annotate screenshot:', error);
      return screenshot;
    }
  }

  /**
   * Capture multi-resolution snapshots for AI visual click
   * Returns full viewport, zoomed region, and focused crop
   * 
   * @param focusPoint - Optional point to focus zoom on
   * @param zoomLevel - Zoom multiplier (default 2x)
   */
  static async captureMultiResolution(
    focusPoint?: { x: number; y: number },
    zoomLevel: number = 2
  ): Promise<MultiResolutionSnapshot> {
    const result: MultiResolutionSnapshot = {
      fullViewport: '',
      metadata: {
        viewportSize: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        zoomLevel,
      },
    };

    try {
      // 1. Capture full viewport (skipZoom for execution)
      const fullPage = await this.captureFullPage(0.8, true);
      if (fullPage) {
        result.fullViewport = fullPage.screenshot;
      } else {
        console.warn('📸 GhostWriter: Failed to capture full viewport for multi-resolution');
        return result;
      }

      // 2. If we have a focus point, capture zoomed region
      if (focusPoint) {
        const regionSize = 300; // 300x300px base region
        const focusArea: BoundingBox = {
          x: Math.max(0, focusPoint.x - regionSize / 2),
          y: Math.max(0, focusPoint.y - regionSize / 2),
          width: Math.min(regionSize, window.innerWidth - Math.max(0, focusPoint.x - regionSize / 2)),
          height: Math.min(regionSize, window.innerHeight - Math.max(0, focusPoint.y - regionSize / 2)),
        };

        result.metadata.focusArea = focusArea;

        // Capture and zoom the region
        const regionCapture = await this.captureZoomedRegion(focusArea, zoomLevel);
        if (regionCapture) {
          result.zoomedRegion = regionCapture;
        }

        // Also capture a tighter crop (150x150) for small elements
        const tightArea: BoundingBox = {
          x: Math.max(0, focusPoint.x - 75),
          y: Math.max(0, focusPoint.y - 75),
          width: 150,
          height: 150,
        };
        const tightCapture = await this.captureZoomedRegion(tightArea, 3); // 3x zoom for tiny elements
        if (tightCapture) {
          result.focusedCrop = tightCapture;
        }
      }

      console.log('📸 GhostWriter: Multi-resolution capture complete:', {
        hasFullViewport: !!result.fullViewport,
        hasZoomedRegion: !!result.zoomedRegion,
        hasFocusedCrop: !!result.focusedCrop,
        focusArea: result.metadata.focusArea,
      });
    } catch (error) {
      console.warn('📸 GhostWriter: Multi-resolution capture error:', error);
    }

    return result;
  }

  /**
   * Capture a region and zoom it by the specified factor
   * 
   * @param region - Region to capture
   * @param zoomLevel - Zoom multiplier (e.g., 2 = 2x zoom)
   */
  static async captureZoomedRegion(
    region: BoundingBox,
    zoomLevel: number = 2
  ): Promise<string | null> {
    try {
      // First get the full page screenshot (skipZoom for execution)
      const fullPage = await this.captureFullPage(0.7, true);
      if (!fullPage) {
        return null;
      }

      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            resolve(null);
            return;
          }
          
          const dpr = window.devicePixelRatio || 1;

          // Source dimensions (in screenshot pixels)
          const sourceX = Math.max(0, region.x * dpr);
          const sourceY = Math.max(0, region.y * dpr);
          const sourceWidth = Math.min(
            region.width * dpr,
            image.width - sourceX
          );
          const sourceHeight = Math.min(
            region.height * dpr,
            image.height - sourceY
          );

          if (sourceWidth <= 0 || sourceHeight <= 0) {
            resolve(null);
            return;
          }

          // Output dimensions (zoomed)
          const outputWidth = sourceWidth * zoomLevel;
          const outputHeight = sourceHeight * zoomLevel;

          canvas.width = outputWidth;
          canvas.height = outputHeight;

          // Use high-quality scaling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw zoomed region
          ctx.drawImage(
            image,
            sourceX, sourceY, sourceWidth, sourceHeight,
            0, 0, outputWidth, outputHeight
          );

          // Return as JPEG with higher quality for zoomed images
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        image.onerror = () => resolve(null);
        image.src = fullPage.screenshot;
      });
    } catch (error) {
      console.warn('📸 GhostWriter: Zoomed region capture error:', error);
      return null;
    }
  }

  /**
   * Capture element with surrounding context at multiple zoom levels
   * Useful for small elements that are hard to identify
   * 
   * @param element - Element to capture
   * @param contextPadding - Padding around element (default 50px)
   */
  static async captureElementWithContext(
    element: Element,
    contextPadding: number = 50
  ): Promise<{
    standard: string | null;
    zoomed: string | null;
    superZoomed: string | null;
    bounds: BoundingBox;
  }> {
    const rect = element.getBoundingClientRect();
    const bounds: BoundingBox = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    // Region with context
    const contextRegion: BoundingBox = {
      x: Math.max(0, rect.left - contextPadding),
      y: Math.max(0, rect.top - contextPadding),
      width: rect.width + (contextPadding * 2),
      height: rect.height + (contextPadding * 2),
    };

    const [standard, zoomed, superZoomed] = await Promise.all([
      this.captureRegion(contextRegion, 0),              // 1x
      this.captureZoomedRegion(contextRegion, 2),        // 2x
      this.captureZoomedRegion(contextRegion, 3),        // 3x for tiny elements
    ]);

    return {
      standard,
      zoomed,
      superZoomed,
      bounds,
    };
  }

  /**
   * Compare current viewport to a reference screenshot
   * Returns similarity score (0-1)
   */
  static async compareToReference(referenceScreenshot: string): Promise<{
    similarity: number;
    currentScreenshot: string | null;
  }> {
    // skipZoom for execution
    const current = await this.captureFullPage(0.7, true);
    if (!current) {
      return { similarity: 0, currentScreenshot: null };
    }

    const similarity = await this.compareScreenshots(current.screenshot, referenceScreenshot);
    return {
      similarity,
      currentScreenshot: current.screenshot,
    };
  }
}
