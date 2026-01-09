/**
 * MenuDetector - Universal menu detection for all frameworks
 * 
 * Uses PATTERN-BASED detection (behavioral + ARIA) instead of hardcoded selectors
 * to find menus regardless of framework (Angular CDK, Salesforce Lightning,
 * MUI, Radix, Ant Design, etc.)
 * 
 * This approach is maintenance-free and works universally.
 */

import { ShadowDOMUtils } from './shadow-dom-utils';
import { VisibilityChecker } from './visibility-checker';

// ============================================================================
// Core Selectors (ARIA only - framework-agnostic)
// ============================================================================

/**
 * Core menu selectors - ARIA roles only
 * Framework-specific selectors replaced with pattern-based detection
 */
const CORE_MENU_SELECTORS = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="menubar"]',
];

/**
 * Core menu item selectors - ARIA roles + universal patterns
 */
const CORE_MENU_ITEM_SELECTORS = [
  '[role="menuitem"]',
  '[role="option"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
];

// Keep legacy exports for backward compatibility (will be deprecated)
export const UNIVERSAL_MENU_SELECTORS = CORE_MENU_SELECTORS;
export const MENU_ITEM_SELECTORS = CORE_MENU_ITEM_SELECTORS;

// ============================================================================
// Types
// ============================================================================

export interface MenuDetectionResult {
  /** The detected menu element, or null if not found */
  menu: Element | null;
  /** Method used to find the menu */
  method: 'observation' | 'selector' | 'fallback';
  /** Confidence score 0-1 */
  confidence: number;
  /** Time taken to detect in milliseconds */
  elapsedMs: number;
}

export interface MenuAnalysis {
  /** Does it have ARIA role? */
  hasAriaRole: boolean;
  /** Number of items inside */
  itemCount: number;
  /** Is it positioned as popup? */
  isPopup: boolean;
  /** Z-index value */
  zIndex: number;
  /** Is it visible? */
  isVisible: boolean;
}

// ============================================================================
// MenuDetector Class
// ============================================================================

export class MenuDetector {
  // Track menu open timing for disambiguation when multiple menus exist
  private static lastMenuOpenTime: Map<Element, number> = new Map();
  
  /**
   * PATTERN-BASED: Check if element is likely a menu
   * Uses behavioral patterns instead of hardcoded selectors
   */
  static isLikelyMenu(element: Element): boolean {
    // 1. ARIA role (highest confidence - universal)
    const role = element.getAttribute('role');
    if (role === 'menu' || role === 'listbox' || role === 'menubar') {
      return true;
    }
    
    // 2. Popup positioning pattern (universal across frameworks)
    if (!(element instanceof HTMLElement)) return false;
    
    const style = window.getComputedStyle(element);
    const isPopup = style.position === 'fixed' || style.position === 'absolute';
    const hasHighZIndex = parseInt(style.zIndex) > 1000 || style.zIndex === 'auto';
    
    // 3. Contains menu items (universal pattern)
    const items = this.findMenuItems(element);
    
    // Must be positioned as popup with high z-index AND contain items
    return isPopup && hasHighZIndex && items.length >= 2;
  }
  
  /**
   * PATTERN-BASED: Find menu items using universal patterns
   * Replaces hardcoded framework-specific selectors
   */
  static findMenuItems(menu: Element): Element[] {
    const items: Element[] = [];
    
    // Pattern 1: ARIA roles (universal)
    const ariaItems = ShadowDOMUtils.queryDeep(
      '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]',
      menu
    );
    items.push(...ariaItems);
    
    // Pattern 2: Direct li children in a ul (common pattern)
    if (menu.tagName === 'UL') {
      const liChildren = Array.from(menu.children).filter(c => c.tagName === 'LI');
      items.push(...liChildren);
    }
    
    // Pattern 3: Clickable children with similar structure (universal pattern)
    const clickableChildren = ShadowDOMUtils.queryDeep(
      'button, a, [tabindex]:not([tabindex="-1"]), [onclick]',
      menu
    ).filter(el => VisibilityChecker.isVisible(el));
    items.push(...clickableChildren);
    
    // Deduplicate
    return [...new Set(items)];
  }
  
  /**
   * Wait for a menu to appear after clicking a trigger
   * Uses DOM observation first, then falls back to selectors
   * 
   * @param timeout - Maximum time to wait in milliseconds
   * @returns MenuDetectionResult with found menu or null
   */
  static async waitForMenu(timeout: number = 2000): Promise<MenuDetectionResult> {
    const startTime = Date.now();
    
    console.log('[MenuDetector] Starting menu detection...');
    
    // PHASE 0: Check if menu is already visible (CRITICAL for menus that are already open)
    const alreadyVisible = this.findVisibleMenu();
    if (alreadyVisible) {
      console.log('[MenuDetector] ✅ Menu already visible (found immediately)');
      return {
        menu: alreadyVisible,
        method: 'selector',
        confidence: 0.90,
        elapsedMs: Date.now() - startTime,
      };
    }
    
    // PHASE 1: Observe DOM changes (most reliable - catches any framework)
    const observed = await this.observeMenuAppearance(timeout * 0.6);
    if (observed) {
      console.log('[MenuDetector] ✅ Menu found via DOM observation');
      return {
        menu: observed,
        method: 'observation',
        confidence: 0.95,
        elapsedMs: Date.now() - startTime,
      };
    }
    
    // PHASE 2: Try universal selectors (fallback)
    const found = await this.findWithSelectors(timeout * 0.4);
    if (found) {
      console.log('[MenuDetector] ✅ Menu found via selectors');
      return {
        menu: found,
        method: 'selector',
        confidence: 0.85,
        elapsedMs: Date.now() - startTime,
      };
    }
    
    console.warn('[MenuDetector] ⚠️ No menu found');
    return {
      menu: null,
      method: 'fallback',
      confidence: 0,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * Observe DOM for new elements that appear after trigger click
   * This is framework-agnostic - works for any UI library
   */
  private static async observeMenuAppearance(timeout: number): Promise<Element | null> {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              // Check if this element or its children look like a menu
              const menu = this.findMenuInElement(node);
              if (menu) {
                observer.disconnect();
                resolve(menu);
                return;
              }
            }
          }
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      
      // Timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Find menu using universal selectors with polling
   */
  private static async findWithSelectors(timeout: number): Promise<Element | null> {
    const startTime = Date.now();
    
    const cdkSelectors = ['.cdk-overlay-pane', '.cdk-overlay-connected-position-bounding-box', '.cdk-overlay-container'];
    
    while (Date.now() - startTime < timeout) {
      // First, try direct menu selectors (but skip CDK containers - we handle those specially)
      for (const selector of UNIVERSAL_MENU_SELECTORS) {
        // Skip CDK overlay containers - they need special handling
        if (cdkSelectors.includes(selector)) {
          continue;
        }
        
        try {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (this.isVisible(element) && this.hasOptions(element)) {
              return element;
            }
          }
        } catch (e) {
          // Invalid selector, skip
          continue;
        }
      }
      
      // CRITICAL: Also check inside CDK overlay containers
      // Angular CDK menus are wrapped in .cdk-overlay-pane
      // The overlay container might be invisible, but the menu inside might be visible!
      try {
        const overlays = document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-connected-position-bounding-box');
        for (const overlay of overlays) {
          // CRITICAL: Check inside overlay even if overlay is invisible - menu might be visible!
          let menuInside = overlay.querySelector('[role="menu"], [role="listbox"], .gs-popover-menu__list, .ant-menu, ul[role="menu"]');
          
          // If standard selectors fail, search for any element with menu items
          if (!menuInside) {
            const allChildren = Array.from(overlay.querySelectorAll('*'));
            for (const child of allChildren) {
              const items = child.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
              if (items.length > 0 && this.isVisible(child)) {
                menuInside = child;
                break;
              }
            }
          }
          
          if (menuInside && this.isVisible(menuInside) && this.hasOptions(menuInside)) {
            console.log('[MenuDetector] Found visible menu inside CDK overlay via selector polling');
            return menuInside;
          }
          
          // Only check overlay itself if overlay is visible
          if (this.isVisible(overlay)) {
            // Or check if overlay itself has menu items
            if (this.hasOptions(overlay)) {
              console.log('[MenuDetector] CDK overlay has menu items directly (via selector polling)');
              return overlay;
            }
          }
        }
      } catch (e) {
        // Continue if overlay check fails
      }
      
      // PHASE 3: Also search inside Shadow DOMs during polling
      const shadowMenuSelectors = ['[role="menu"]', '[role="listbox"]', '.gs-popover-menu__list'];
      for (const selector of shadowMenuSelectors) {
        const shadowResults = this.querySelectorAllDeep(selector);
        for (const element of shadowResults) {
          if (this.isVisible(element) && this.hasOptions(element)) {
            console.log(`[MenuDetector] Found menu in Shadow DOM via polling: ${selector}`);
            return element;
          }
        }
      }
      
      await this.sleep(50);
    }
    
    return null;
  }

  /**
   * Search entire document INCLUDING shadow DOMs for elements matching a selector
   * Uses shared ShadowDOMUtils utility
   */
  private static querySelectorAllDeep(selector: string): Element[] {
    return ShadowDOMUtils.queryDeep(selector);
  }

  /**
   * Find a menu within a given element (used by DOM observer)
   * Uses pattern-based detection instead of hardcoded selectors
   */
  private static findMenuInElement(element: Element): Element | null {
    // Check the element itself using pattern-based detection
    if (this.isLikelyMenu(element) && VisibilityChecker.isVisible(element)) {
      // Track when this menu appeared
      this.lastMenuOpenTime.set(element, Date.now());
      return element;
    }
    
    // CRITICAL: For Angular CDK overlays, the menu is nested inside
    // Check if this is an overlay container, then find menu inside
    if (element.classList.contains('cdk-overlay-pane') || 
        element.classList.contains('cdk-overlay-connected-position-bounding-box') ||
        element.classList.contains('cdk-overlay-container')) {
      // Use pattern-based detection to find menu inside overlay
      const menuList = ShadowDOMUtils.queryDeepFirst('[role="menu"], [role="listbox"]', element);
      
      if (menuList && this.isLikelyMenu(menuList) && VisibilityChecker.isVisible(menuList)) {
        console.log('[MenuDetector] Found visible menu list inside CDK overlay');
        this.lastMenuOpenTime.set(menuList, Date.now());
        return menuList;
      }
      
      // Check if overlay itself is a menu (using pattern detection)
      if (this.isLikelyMenu(element)) {
        console.log('[MenuDetector] CDK overlay is itself a menu');
        this.lastMenuOpenTime.set(element, Date.now());
        return element;
      }
    }
    
    // Search children using core ARIA selectors
    for (const selector of CORE_MENU_SELECTORS) {
      try {
        const found = element.querySelector(selector);
        if (found && this.isLikelyMenu(found) && VisibilityChecker.isVisible(found)) {
          this.lastMenuOpenTime.set(found, Date.now());
          return found;
        }
      } catch (e) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Check if element is visible
   * Uses shared VisibilityChecker utility
   */
  private static isVisible(element: Element): boolean {
    return VisibilityChecker.isVisible(element);
  }

  /**
   * Check if menu element has options/items
   * Uses pattern-based detection with shared Shadow DOM utilities
   */
  private static hasOptions(element: Element): boolean {
    // Use findMenuItems which already uses pattern-based detection
    const items = this.findMenuItems(element);
    return items.length > 0;
  }

  /**
   * Find a currently visible menu (no waiting)
   * Uses pattern-based detection and handles multiple menus
   */
  static findVisibleMenu(): Element | null {
    console.log('[MenuDetector] Searching for visible menu using pattern-based detection...');
    
    const candidateMenus: Array<{menu: Element, openTime: number, itemCount: number}> = [];
    
    // Phase 1: Search using core ARIA selectors
    for (const selector of CORE_MENU_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        console.log(`[MenuDetector] ARIA selector "${selector}" found ${elements.length} elements`);
        
        for (const element of elements) {
          if (this.isLikelyMenu(element) && VisibilityChecker.isVisible(element)) {
            const openTime = this.lastMenuOpenTime.get(element) || 0;
            const itemCount = this.findMenuItems(element).length;
            console.log(`[MenuDetector] Found candidate menu via ARIA: ${element.tagName}.${element.className.substring(0, 30)} with ${itemCount} items`);
            candidateMenus.push({menu: element, openTime, itemCount});
          }
        }
      } catch (e) {
        console.warn(`[MenuDetector] Selector "${selector}" failed:`, e);
      }
    }
    
    // Phase 2: Check inside CDK overlay containers using pattern detection
    try {
      const overlays = document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-connected-position-bounding-box');
      console.log(`[MenuDetector] Found ${overlays.length} CDK overlay containers`);
      
      for (const overlay of overlays) {
        // Look for menus inside overlay using pattern detection
        const menuInside = ShadowDOMUtils.queryDeepFirst('[role="menu"], [role="listbox"]', overlay);
        
        if (menuInside && this.isLikelyMenu(menuInside) && VisibilityChecker.isVisible(menuInside)) {
          const openTime = this.lastMenuOpenTime.get(menuInside) || 0;
          const itemCount = this.findMenuItems(menuInside).length;
          console.log(`[MenuDetector] Found candidate menu inside CDK overlay with ${itemCount} items`);
          candidateMenus.push({menu: menuInside, openTime, itemCount});
        }
      }
    } catch (e) {
      console.error('[MenuDetector] CDK overlay check failed:', e);
    }
    
    // Phase 3: Search Shadow DOMs using pattern detection
    console.log('[MenuDetector] 🌑 Searching inside Shadow DOMs...');
    const shadowResults = this.querySelectorAllDeep('[role="menu"], [role="listbox"]');
    console.log(`[MenuDetector] 🌑 Deep search found ${shadowResults.length} elements`);
    
    for (const element of shadowResults) {
      if (this.isLikelyMenu(element) && VisibilityChecker.isVisible(element)) {
        const openTime = this.lastMenuOpenTime.get(element) || 0;
        const itemCount = this.findMenuItems(element).length;
        console.log(`[MenuDetector] 🌑 Found candidate menu in Shadow DOM with ${itemCount} items`);
        candidateMenus.push({menu: element, openTime, itemCount});
      }
    }
    
    // Handle multiple candidates - prioritize by open time, then by item count
    if (candidateMenus.length === 0) {
      console.log('[MenuDetector] ⚠️ No visible menu found');
      return null;
    }
    
    if (candidateMenus.length === 1) {
      console.log(`[MenuDetector] ✅ Found single menu with ${candidateMenus[0].itemCount} items`);
      return candidateMenus[0].menu;
    }
    
    // Multiple menus: Select most recently opened (highest openTime)
    // If same openTime, select one with most items
    candidateMenus.sort((a, b) => {
      if (b.openTime !== a.openTime) {
        return b.openTime - a.openTime; // Most recent first
      }
      return b.itemCount - a.itemCount; // Most items first
    });
    
    const winner = candidateMenus[0];
    console.log(`[MenuDetector] ✅ Selected menu with ${winner.itemCount} items from ${candidateMenus.length} candidates (most recently opened)`);
    return winner.menu;
  }

  /**
   * Extract menu items from a menu element
   * Uses pattern-based findMenuItems method
   */
  static extractMenuItems(menu: Element): Element[] {
    return this.findMenuItems(menu);
  }

  /**
   * Check if element is inside a menu
   */
  static isInsideMenu(element: Element): boolean {
    for (const selector of CORE_MENU_SELECTORS) {
      try {
        const menu = element.closest(selector);
        if (menu) return true;
      } catch (e) {
        continue;
      }
    }
    // Also check shadow DOM boundaries
    return !!ShadowDOMUtils.closestAcrossShadow(element, '[role="menu"], [role="listbox"]');
  }

  /**
   * Find parent menu of an element
   */
  static findParentMenu(element: Element): Element | null {
    for (const selector of CORE_MENU_SELECTORS) {
      try {
        const menu = element.closest(selector);
        if (menu) return menu;
      } catch (e) {
        continue;
      }
    }
    // Also check across shadow DOM boundaries
    return ShadowDOMUtils.closestAcrossShadow(element, '[role="menu"], [role="listbox"]');
  }

  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

