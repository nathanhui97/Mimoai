/**
 * Visual Analysis Service - Client-side service for human-like visual understanding
 * Calls Supabase Edge Functions for AI-powered visual analysis
 * No direct Gemini API calls from client (all handled server-side)
 */

import type {
  PageType,
  PageRegions,
  VisualImportance,
  VisualSimilarity,
  VisualContext,
  VisualLandmark,
  PageAnalysis,
  VisualCandidate,
  VisualMatchRequest,
  VisualMatchResult,
  ClassifyPageTypeResponse,
  VisualSimilarityResponse,
  BoundingBox,
  VisualPattern,
  NearbyElement,
} from '../types/visual';
import { AICache } from './ai-cache';
import { aiConfig } from './ai-config';
import { VisualSnapshotService } from '../content/visual-snapshot';

export class VisualAnalysisService {
  /**
   * Analyze page type from screenshot
   * Returns classification, regions, and landmarks
   */
  static async analyzePageType(
    screenshot?: string
  ): Promise<PageAnalysis | null> {
    if (!aiConfig.isEnabled()) {
      console.log('🔍 GhostWriter: Visual analysis disabled');
      return null;
    }

    try {
      // Capture screenshot if not provided
      let pageScreenshot = screenshot;
      if (!pageScreenshot) {
        // skipZoom=true to avoid zoom flashing during execution
        const fullPage = await VisualSnapshotService.captureFullPage(0.7, true);
        if (!fullPage) {
          console.warn('🔍 GhostWriter: Could not capture page screenshot');
          return null;
        }
        pageScreenshot = fullPage.screenshot;
      }

      // Generate cache key
      const cacheKey = AICache.generateKey({
        type: 'page_type_classification',
        url: window.location.href,
        screenshotHash: pageScreenshot.substring(0, 500), // Use partial hash for cache key
      });

      // Check cache first
      const cached = await AICache.getFromLocal(cacheKey);
      if (cached) {
        console.log('🔍 GhostWriter: Using cached page type analysis');
        return cached as PageAnalysis;
      }

      // Call Edge Function
      const result = await this.callClassifyPageType(pageScreenshot);
      
      // Build full analysis result
      const analysis: PageAnalysis = {
        pageType: result.pageType,
        regions: result.regions,
        landmarks: result.landmarks,
        visualPatterns: [], // Will be populated by visual_analysis Edge Function
        dominantColors: [],
        textDensity: 'medium',
        interactiveElementCount: this.countInteractiveElements(),
        timestamp: Date.now(),
      };

      // Cache result (5 minute TTL for page type)
      await AICache.saveToLocal(cacheKey, analysis, 5 * 60 * 1000);

      return analysis;
    } catch (error) {
      console.warn('🔍 GhostWriter: Page type analysis failed:', error);
      // Return basic fallback analysis
      return this.createFallbackAnalysis();
    }
  }

  /**
   * Score visual importance of an element
   * Based on size, color, position, and visual prominence
   */
  static async scoreVisualImportance(
    element: Element,
    _pageScreenshot?: string
  ): Promise<VisualImportance> {
    try {
      // Calculate local scores first (no API call needed)
      const localScores = this.calculateLocalImportanceScores(element);

      // If AI is disabled or no screenshot, return local scores
      if (!aiConfig.isEnabled()) {
        return localScores;
      }

      // For AI-enhanced scoring, capture element screenshot
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return localScores;
      }

      // Generate cache key
      const cacheKey = AICache.generateKey({
        type: 'visual_importance',
        url: window.location.href,
        elementTag: element.tagName,
        elementText: (element as HTMLElement).textContent?.substring(0, 100),
        position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });

      // Check cache
      const cached = await AICache.getFromLocal(cacheKey);
      if (cached) {
        return cached as VisualImportance;
      }

      // For now, use local scores (AI enhancement can be added later)
      // This avoids API calls for every element
      await AICache.saveToLocal(cacheKey, localScores, 10 * 60 * 1000);
      
      return localScores;
    } catch (error) {
      console.warn('🔍 GhostWriter: Visual importance scoring failed:', error);
      return this.calculateLocalImportanceScores(element);
    }
  }

  /**
   * Find visually similar elements to target
   * Uses AI to compare visual appearance
   */
  static async findVisualSimilarity(
    targetScreenshot: string,
    candidates: VisualCandidate[],
    pageType?: PageType
  ): Promise<VisualMatchResult | null> {
    if (!aiConfig.isEnabled()) {
      console.log('🔍 GhostWriter: Visual similarity disabled');
      return null;
    }

    if (candidates.length === 0) {
      return null;
    }

    try {
      // Generate cache key
      const cacheKey = AICache.generateKey({
        type: 'visual_similarity',
        targetHash: targetScreenshot.substring(0, 200),
        candidateCount: candidates.length,
        candidateSelectors: candidates.map(c => c.selector).join(',').substring(0, 200),
      });

      // Check cache
      const cached = await AICache.getFromLocal(cacheKey);
      if (cached) {
        console.log('🔍 GhostWriter: Using cached visual similarity result');
        return cached as VisualMatchResult;
      }

      // Build request
      const request: VisualMatchRequest = {
        targetScreenshot,
        candidates,
        pageType,
      };

      // Call Edge Function
      const response = await this.callVisualSimilarity(request);

      // Convert response to result
      const result: VisualMatchResult = {
        bestMatchIndex: response.bestMatch.index,
        bestMatchSelector: candidates[response.bestMatch.index]?.selector,
        confidence: response.matches[response.bestMatch.index]?.confidence || 0,
        similarity: response.matches[response.bestMatch.index]?.similarity || this.createDefaultSimilarity(),
        reasoning: response.bestMatch.reasoning,
        alternativeMatches: response.matches
          .filter((_m, i) => i !== response.bestMatch.index)
          .slice(0, 3)
          .map(m => ({
            index: m.candidateIndex,
            confidence: m.confidence,
            reasoning: `Similarity: ${(m.similarity.overallVisualMatch * 100).toFixed(0)}%`,
          })),
      };

      // Cache result
      await AICache.saveToLocal(cacheKey, result, 30 * 60 * 1000);

      return result;
    } catch (error) {
      console.warn('🔍 GhostWriter: Visual similarity matching failed:', error);
      return null;
    }
  }

  /**
   * Extract visual context for an element
   * Includes nearby elements, landmarks, and visual patterns
   */
  static async extractVisualContext(
    element: Element,
    pageAnalysis?: PageAnalysis
  ): Promise<VisualContext> {
    try {
      // Find nearby elements
      const nearbyElements = this.findNearbyElements(element);

      // Determine visual pattern
      const visualPattern = this.detectVisualPattern(element);

      // Determine region type
      const regionType = this.determineRegionType(element, pageAnalysis?.regions);

      // Get landmarks from page analysis or detect locally
      const landmarks = pageAnalysis?.landmarks || this.detectLocalLandmarks(element);

      const context: VisualContext = {
        nearbyElements,
        landmarks,
        visualPattern,
        regionType,
      };

      return context;
    } catch (error) {
      console.warn('🔍 GhostWriter: Visual context extraction failed:', error);
      return {
        nearbyElements: [],
        landmarks: [],
        visualPattern: 'unknown',
      };
    }
  }

  /**
   * Detect visual changes between two screenshots
   */
  static async detectVisualChanges(
    beforeScreenshot: string,
    afterScreenshot: string
  ): Promise<{
    hasChanges: boolean;
    similarity: number;
    description: string;
  }> {
    try {
      // Quick local comparison first
      const similarity = await VisualSnapshotService.compareScreenshots(
        beforeScreenshot,
        afterScreenshot
      );

      const hasChanges = similarity < 0.95; // 5% change threshold

      return {
        hasChanges,
        similarity,
        description: hasChanges 
          ? `Visual changes detected (${((1 - similarity) * 100).toFixed(0)}% different)`
          : 'No significant visual changes',
      };
    } catch (error) {
      console.warn('🔍 GhostWriter: Visual change detection failed:', error);
      return {
        hasChanges: false,
        similarity: 1,
        description: 'Could not detect changes',
      };
    }
  }

  /**
   * Build visual candidate from element
   */
  static async buildVisualCandidate(
    element: Element,
    selector: string
  ): Promise<VisualCandidate | null> {
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return null;
      }

      // Capture element screenshot
      const captureResult = await VisualSnapshotService.capture(element);
      if (!captureResult) {
        return null;
      }

      // Calculate importance
      const importance = await this.scoreVisualImportance(element);

      // Extract context
      const context = await this.extractVisualContext(element);

      // Generate visual description
      const visualDescription = this.generateVisualDescription(element);

      return {
        selector,
        screenshot: captureResult.elementSnippet,
        visualDescription,
        importance,
        context,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    } catch (error) {
      console.warn('🔍 GhostWriter: Failed to build visual candidate:', error);
      return null;
    }
  }

  // ============================================
  // Private methods - Edge Function calls
  // ============================================

  /**
   * Call classify_page_type Edge Function
   */
  private static async callClassifyPageType(
    screenshot: string
  ): Promise<ClassifyPageTypeResponse> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const functionName = config.classifyPageTypeEdgeFunctionName || 'classify_page_type';
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
    const timeout = config.visualAnalysisTimeout || 15000;

    console.log(`🔍 GhostWriter: Calling ${functionName}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify({
          screenshot,
          url: window.location.href,
          title: document.title,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseClassifyPageTypeResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Page type classification timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Call visual_similarity Edge Function
   */
  private static async callVisualSimilarity(
    request: VisualMatchRequest
  ): Promise<VisualSimilarityResponse> {
    const config = aiConfig.getConfig();
    
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('GhostWriter: Supabase configuration missing');
    }

    const functionName = config.visualSimilarityEdgeFunctionName || 'visual_similarity';
    const url = `${config.supabaseUrl}/functions/v1/${functionName}`;
    const timeout = config.visualAnalysisTimeout || 15000;

    console.log(`🔍 GhostWriter: Calling ${functionName} with ${request.candidates.length} candidates...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return this.parseVisualSimilarityResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Visual similarity timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  // ============================================
  // Private methods - Response parsing
  // ============================================

  private static parseClassifyPageTypeResponse(response: any): ClassifyPageTypeResponse {
    return {
      pageType: {
        type: response.pageType?.type || 'unknown',
        confidence: response.pageType?.confidence || 0,
        subType: response.pageType?.subType,
        characteristics: response.pageType?.characteristics || [],
      },
      regions: response.regions || {},
      landmarks: response.landmarks || [],
      confidence: response.confidence || 0,
    };
  }

  private static parseVisualSimilarityResponse(response: any): VisualSimilarityResponse {
    return {
      matches: response.matches || [],
      bestMatch: response.bestMatch || { index: 0, reasoning: 'No match found' },
    };
  }

  // ============================================
  // Private methods - Local calculations
  // ============================================

  /**
   * Calculate importance scores locally (no API call)
   */
  private static calculateLocalImportanceScores(element: Element): VisualImportance {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Size score - larger elements are more important
    const maxArea = viewportWidth * viewportHeight * 0.25; // Max 25% of viewport
    const area = rect.width * rect.height;
    const sizeScore = Math.min(area / maxArea, 1);

    // Color score - brighter/more saturated colors are more prominent
    const bgColor = style.backgroundColor;
    const colorScore = this.calculateColorProminence(bgColor);

    // Position score - F-pattern: top-left is most important
    const xScore = 1 - (rect.left / viewportWidth);
    const yScore = 1 - (rect.top / viewportHeight);
    const positionScore = (xScore * 0.4 + yScore * 0.6); // Y position more important

    // Icon score - check if element contains icons
    const hasIcon = element.querySelector('svg, img, [class*="icon"], i[class*="fa"]') !== null;
    const iconScore = hasIcon ? 0.8 : 0.2;

    // Text style score - bold/large text is more important
    const fontSize = parseFloat(style.fontSize) || 16;
    const fontWeight = parseInt(style.fontWeight) || 400;
    const textStyleScore = Math.min(
      (fontSize / 24) * 0.5 + (fontWeight > 500 ? 0.5 : 0.2),
      1
    );

    // Interactive score - looks clickable
    const isInteractive = this.isInteractiveElement(element);
    const cursor = style.cursor;
    const interactiveScore = isInteractive ? 0.9 : (cursor === 'pointer' ? 0.7 : 0.3);

    // Overall importance - weighted combination
    const overallImportance = (
      sizeScore * 0.2 +
      colorScore * 0.15 +
      positionScore * 0.2 +
      iconScore * 0.1 +
      textStyleScore * 0.15 +
      interactiveScore * 0.2
    );

    return {
      sizeScore,
      colorScore,
      positionScore,
      iconScore,
      textStyleScore,
      interactiveScore,
      overallImportance,
    };
  }

  /**
   * Calculate color prominence (how attention-grabbing is the color)
   */
  private static calculateColorProminence(color: string): number {
    // Parse color
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return 0.5;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    // Calculate brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    // Calculate saturation (simplified)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    // High saturation and moderate brightness are most prominent
    return saturation * 0.6 + (1 - Math.abs(brightness - 128) / 128) * 0.4;
  }

  /**
   * Check if element is interactive
   */
  private static isInteractiveElement(element: Element): boolean {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    
    if (['button', 'a', 'input', 'select', 'textarea'].includes(tag)) {
      return true;
    }
    
    if (role && ['button', 'link', 'menuitem', 'option', 'tab'].includes(role)) {
      return true;
    }

    const style = window.getComputedStyle(element as HTMLElement);
    return style.cursor === 'pointer';
  }

  /**
   * Find nearby elements
   */
  private static findNearbyElements(element: Element): NearbyElement[] {
    const rect = element.getBoundingClientRect();
    const nearby: NearbyElement[] = [];
    const maxDistance = 100; // pixels

    // Get all visible elements
    const allElements = document.querySelectorAll('button, a, input, select, label, [role="button"], [role="link"]');

    for (const el of allElements) {
      if (el === element) continue;

      const elRect = el.getBoundingClientRect();
      if (elRect.width === 0 || elRect.height === 0) continue;

      // Calculate distance
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const elCenterX = elRect.left + elRect.width / 2;
      const elCenterY = elRect.top + elRect.height / 2;

      const distance = Math.sqrt(
        Math.pow(centerX - elCenterX, 2) + 
        Math.pow(centerY - elCenterY, 2)
      );

      if (distance > maxDistance) continue;

      // Determine relationship
      let relationship: NearbyElement['relationship'];
      if (elRect.bottom < rect.top) relationship = 'above';
      else if (elRect.top > rect.bottom) relationship = 'below';
      else if (elRect.right < rect.left) relationship = 'left';
      else if (elRect.left > rect.right) relationship = 'right';
      else relationship = 'overlapping';

      // Determine type
      const tag = el.tagName.toLowerCase();
      let type: NearbyElement['type'];
      if (['button'].includes(tag) || el.getAttribute('role') === 'button') type = 'button';
      else if (['input', 'select', 'textarea'].includes(tag)) type = 'input';
      else if (tag === 'label') type = 'label';
      else if (tag === 'img' || el.querySelector('img')) type = 'image';
      else if (el.querySelector('svg, [class*="icon"]')) type = 'icon';
      else type = 'other';

      nearby.push({
        visualDescription: this.generateVisualDescription(el),
        relationship,
        distance: Math.round(distance),
        type,
      });
    }

    // Sort by distance and limit
    return nearby.sort((a, b) => a.distance - b.distance).slice(0, 5);
  }

  /**
   * Detect visual pattern in element's region
   */
  private static detectVisualPattern(element: Element): VisualPattern {
    // Check for form layout
    const form = element.closest('form');
    if (form) return 'form_layout';

    // Check for table
    const table = element.closest('table, [role="grid"]');
    if (table) return 'data_table';

    // Check for card grid
    const parent = element.parentElement;
    if (parent) {
      const style = window.getComputedStyle(parent);
      if (style.display === 'grid' || style.display === 'flex') {
        const siblings = parent.children;
        if (siblings.length > 2) {
          // Check if siblings look similar (card grid)
          const firstTag = siblings[0]?.tagName;
          const allSameTag = Array.from(siblings).every(s => s.tagName === firstTag);
          if (allSameTag) return 'card_grid';
        }
      }
    }

    // Check for list
    const list = element.closest('ul, ol, [role="list"], [role="listbox"]');
    if (list) return 'list_view';

    // Check for modal
    const modal = element.closest('[role="dialog"], .modal, [class*="modal"]');
    if (modal) return 'modal_dialog';

    // Check for dropdown
    const dropdown = element.closest('[role="menu"], [role="listbox"], .dropdown');
    if (dropdown) return 'dropdown_menu';

    // Check for tabs
    const tabs = element.closest('[role="tablist"], .tabs');
    if (tabs) return 'tab_content';

    // Check for navigation
    const nav = element.closest('nav, [role="navigation"]');
    if (nav) return 'navigation_menu';

    return 'unknown';
  }

  /**
   * Determine which region the element is in
   */
  private static determineRegionType(
    element: Element,
    regions?: PageRegions
  ): VisualContext['regionType'] {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (regions) {
      // Check each region
      for (const [name, box] of Object.entries(regions)) {
        if (box && this.isPointInBox(centerX, centerY, box)) {
          switch (name) {
            case 'header': return 'header';
            case 'sidebar': return 'sidebar';
            case 'mainContent': return 'main_content';
            case 'footer': return 'footer';
          }
        }
      }
    }

    // Fallback: use heuristics
    const viewportHeight = window.innerHeight;

    if (centerY < 80) return 'header';
    if (centerY > viewportHeight - 80) return 'footer';
    if (centerX < 250) return 'sidebar';
    return 'main_content';
  }

  private static isPointInBox(x: number, y: number, box: BoundingBox): boolean {
    return x >= box.x && x <= box.x + box.width &&
           y >= box.y && y <= box.y + box.height;
  }

  /**
   * Detect landmarks near element
   */
  private static detectLocalLandmarks(element: Element): VisualLandmark[] {
    const landmarks: VisualLandmark[] = [];
    const rect = element.getBoundingClientRect();
    const searchRadius = 300;

    // Search for landmark elements
    const landmarkSelectors = [
      'button[type="submit"], input[type="submit"]',
      '[role="button"]',
      'nav, [role="navigation"]',
      '[role="search"], input[type="search"]',
      '.logo, [class*="logo"]',
      '[class*="user"], [class*="avatar"], [class*="profile"]',
    ];

    for (const selector of landmarkSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const elRect = el.getBoundingClientRect();
          const distance = Math.sqrt(
            Math.pow(rect.left - elRect.left, 2) +
            Math.pow(rect.top - elRect.top, 2)
          );

          if (distance < searchRadius && elRect.width > 0) {
            landmarks.push({
              type: this.classifyLandmarkType(el, selector),
              position: {
                x: elRect.x,
                y: elRect.y,
                width: elRect.width,
                height: elRect.height,
              },
              description: this.generateVisualDescription(el),
              text: (el as HTMLElement).textContent?.trim().substring(0, 50),
              confidence: 0.7,
            });
          }
        }
      } catch (e) {
        // Skip invalid selectors
      }
    }

    return landmarks.slice(0, 10);
  }

  private static classifyLandmarkType(element: Element, _selector: string): VisualLandmark['type'] {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const className = element.className?.toString().toLowerCase() || '';

    if (tag === 'button' || role === 'button') return 'button';
    if (tag === 'input') return 'input';
    if (tag === 'nav' || role === 'navigation') return 'navigation';
    if (className.includes('logo')) return 'logo';
    if (className.includes('search') || role === 'search') return 'search_bar';
    if (className.includes('user') || className.includes('avatar')) return 'user_menu';
    if (tag === 'table' || role === 'grid') return 'table';
    return 'button';
  }

  /**
   * Generate human-readable visual description
   */
  private static generateVisualDescription(element: Element): string {
    const tag = element.tagName.toLowerCase();
    const text = (element as HTMLElement).textContent?.trim().substring(0, 30);
    const role = element.getAttribute('role');
    const className = element.className?.toString() || '';
    const style = window.getComputedStyle(element as HTMLElement);
    
    const parts: string[] = [];

    // Add color if notable
    const bgColor = style.backgroundColor;
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
      const colorName = this.getColorName(bgColor);
      if (colorName) parts.push(colorName);
    }

    // Add element type
    if (tag === 'button' || role === 'button') parts.push('button');
    else if (tag === 'a' || role === 'link') parts.push('link');
    else if (tag === 'input') parts.push(`${(element as HTMLInputElement).type || 'text'} input`);
    else if (className.includes('icon')) parts.push('icon');
    else parts.push(tag);

    // Add text if present
    if (text) parts.push(`"${text}"`);

    return parts.join(' ') || tag;
  }

  /**
   * Get human-readable color name
   */
  private static getColorName(color: string): string | null {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    // Simple color classification
    if (r > 200 && g < 100 && b < 100) return 'red';
    if (r < 100 && g > 200 && b < 100) return 'green';
    if (r < 100 && g < 100 && b > 200) return 'blue';
    if (r > 200 && g > 200 && b < 100) return 'yellow';
    if (r > 200 && g > 100 && b < 100) return 'orange';
    if (r > 150 && g < 100 && b > 150) return 'purple';
    if (r > 220 && g > 220 && b > 220) return 'white';
    if (r < 50 && g < 50 && b < 50) return 'black';
    if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return 'gray';
    
    return null;
  }

  /**
   * Count interactive elements on page
   */
  private static countInteractiveElements(): number {
    return document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [role="link"], [onclick]'
    ).length;
  }

  /**
   * Create default similarity scores
   */
  private static createDefaultSimilarity(): VisualSimilarity {
    return {
      colorSimilarity: 0,
      shapeSimilarity: 0,
      sizeSimilarity: 0,
      layoutSimilarity: 0,
      textSimilarity: 0,
      iconSimilarity: 0,
      overallVisualMatch: 0,
    };
  }

  /**
   * Create fallback analysis when AI fails
   */
  private static createFallbackAnalysis(): PageAnalysis {
    // Detect page type using heuristics
    const hasForm = document.querySelector('form') !== null;
    const hasTable = document.querySelector('table, [role="grid"]') !== null;
    const hasDashboardWidgets = document.querySelectorAll('.widget, .card, .panel').length > 2;
    const hasLogin = document.querySelector('input[type="password"]') !== null;

    let type: PageType['type'] = 'unknown';
    if (hasLogin) type = 'login';
    else if (hasForm) type = 'form';
    else if (hasTable) type = 'data_table';
    else if (hasDashboardWidgets) type = 'dashboard';

    return {
      pageType: {
        type,
        confidence: 0.5,
        characteristics: [],
      },
      regions: {},
      landmarks: [],
      visualPatterns: [],
      dominantColors: [],
      textDensity: 'medium',
      interactiveElementCount: this.countInteractiveElements(),
      timestamp: Date.now(),
    };
  }
}










