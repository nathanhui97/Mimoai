/**
 * MenuDetector - Universal menu detection for all frameworks
 * 
 * Uses behavioral detection (observe what appeared) + universal selectors
 * to find menus regardless of framework (Angular CDK, Salesforce Lightning,
 * MUI, Radix, Ant Design, etc.)
 * 
 * This replaces scattered framework-specific selectors across 21+ files.
 */

// ============================================================================
// Universal Selectors
// ============================================================================

/**
 * Universal menu selectors that cover 99% of frameworks
 * Ordered by priority: ARIA roles first, then framework-specific
 */
export const UNIVERSAL_MENU_SELECTORS = [
  // ARIA roles (highest priority - works across all accessible frameworks)
  '[role="menu"]',
  '[role="listbox"]',
  '[role="menubar"]',
  
  // Angular CDK/Material (Gainsight uses this)
  '.cdk-overlay-pane',
  '.cdk-overlay-connected-position-bounding-box',
  '.cdk-overlay-container',
  '.mat-menu-panel',
  '.mat-menu-content',
  '.mat-mdc-menu-panel',
  '.mat-mdc-menu-content',
  
  // Gainsight-specific (Angular CDK + Ant Design hybrid)
  '.gs-popover-menu__list',
  'ul.gs-popover-menu__list',
  '[class*="gs-popover-menu"]',
  '[class*="ant-menu"][role="menu"]',
  
  // Salesforce Lightning (SLDS)
  '[class*="slds-dropdown"]',
  '[class*="slds-listbox"]',
  '[class*="slds-combobox"]',
  'ul[role="menu"][class*="slds"]',
  
  // Material UI (React)
  '.MuiMenu-paper',
  '.MuiMenu-list',
  '.MuiPaper-root[role="listbox"]',
  '.MuiPopover-paper',
  '.MuiAutocomplete-popper',
  
  // Radix UI
  '[data-radix-select-viewport]',
  '[data-radix-select-content]',
  '[data-radix-menu-content]',
  '[data-radix-dropdown-menu-content]',
  
  // Ant Design
  '.ant-dropdown',
  '.ant-dropdown-menu',
  '.ant-select-dropdown',
  '.ant-cascader-menus',
  '.ant-picker-dropdown',
  
  // Chakra UI
  '.chakra-menu__menu-list',
  '.chakra-select__menu',
  
  // Headless UI
  '[data-headlessui-state]',
  
  // React Select
  '.react-select__menu',
  '[class*="__menu"]',
  
  // Bootstrap
  '.dropdown-menu',
  '.dropdown-menu.show',
  
  // Gainsight-specific
  '[class*="gs-menu"]',
  '[class*="gs-dropdown"]',
  
  // Generic catch-all patterns
  '[class*="dropdown"][class*="menu"]',
  '[class*="popup"][class*="menu"]',
  '[class*="select"][class*="menu"]',
  '[class*="context-menu"]',
  '[class*="options-list"]',
  '[class*="menu-list"]',
];

/**
 * Universal menu item selectors
 */
export const MENU_ITEM_SELECTORS = [
  // ARIA roles
  '[role="menuitem"]',
  '[role="option"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  
  // Angular Material
  '.mat-menu-item',
  '.mat-mdc-menu-item',
  'button[mat-menu-item]',
  
  // Salesforce Lightning
  '.slds-listbox__option',
  '[role="presentation"] > .slds-listbox__option',
  
  // Material UI
  '.MuiMenuItem-root',
  '.MuiAutocomplete-option',
  
  // Radix UI
  '[data-radix-select-item]',
  
  // Ant Design
  '.ant-dropdown-menu-item',
  '.ant-select-item-option',
  '.ant-menu-item',
  'li.ant-menu-item',
  
  // Gainsight-specific menu items
  '.gs-popover-menu__item',
  'li.gs-popover-menu__item',
  
  // Chakra UI
  '.chakra-menu__menuitem',
  
  // React Select
  '.react-select__option',
  '[class*="__option"]',
  
  // Bootstrap
  '.dropdown-item',
  
  // Generic
  'li[tabindex]',
  'li[role="option"]',
  '[data-option]',
  '[data-value]',
];

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
   */
  private static querySelectorAllDeep(selector: string): Element[] {
    const results: Element[] = [];
    
    // First, search regular DOM
    try {
      results.push(...Array.from(document.querySelectorAll(selector)));
    } catch (e) {
      // Invalid selector
    }
    
    // Then search inside all shadow DOMs
    const searchShadowRoots = (root: Element | Document) => {
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          try {
            const shadowResults = el.shadowRoot.querySelectorAll(selector);
            results.push(...Array.from(shadowResults));
          } catch (e) {
            // Invalid selector for this shadow root
          }
          // Recursively search nested shadow DOMs
          searchShadowRoots(el.shadowRoot as unknown as Document);
        }
      }
    };
    
    searchShadowRoots(document);
    return results;
  }

  /**
   * Find a menu within a given element (used by DOM observer)
   */
  private static findMenuInElement(element: Element): Element | null {
    // Check the element itself
    if (this.hasMenuCharacteristics(element) && this.isVisible(element)) {
      return element;
    }
    
    // CRITICAL: For Angular CDK overlays, the menu is nested inside
    // Check if this is an overlay container, then find menu inside
    // The overlay container might be invisible, but the menu inside might be visible!
    if (element.classList.contains('cdk-overlay-pane') || 
        element.classList.contains('cdk-overlay-connected-position-bounding-box') ||
        element.classList.contains('cdk-overlay-container')) {
      // Look for the actual menu list inside the overlay (even if overlay is invisible)
      let menuList = element.querySelector('[role="menu"], [role="listbox"], .gs-popover-menu__list, .ant-menu, ul[role="menu"]');
      
      // If standard selectors fail, search for any element with menu items inside
      if (!menuList) {
        const allChildren = Array.from(element.querySelectorAll('*'));
        for (const child of allChildren) {
          const items = child.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
          if (items.length > 0 && this.isVisible(child)) {
            menuList = child;
            break;
          }
        }
      }
      
      if (menuList && this.hasMenuCharacteristics(menuList) && this.isVisible(menuList)) {
        console.log('[MenuDetector] Found visible menu list inside CDK overlay (overlay itself might be invisible)');
        return menuList;
      }
      // If no menu list found, check if overlay itself has menu items (only if overlay is visible)
      if (this.isVisible(element) && this.hasOptions(element)) {
        console.log('[MenuDetector] CDK overlay contains menu items directly');
        return element;
      }
    }
    
    // Check children using universal selectors
    for (const selector of UNIVERSAL_MENU_SELECTORS) {
      try {
        const found = element.querySelector(selector);
        if (found && this.hasMenuCharacteristics(found) && this.isVisible(found)) {
          return found;
        }
      } catch (e) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Check if an element has menu characteristics
   */
  private static hasMenuCharacteristics(element: Element): boolean {
    const analysis = this.analyzeElement(element);
    
    // Has ARIA role = high confidence
    if (analysis.hasAriaRole) {
      return true;
    }
    
    // Contains multiple menu items = likely a menu
    if (analysis.itemCount >= 2) {
      return true;
    }
    
    // CRITICAL: CDK overlay containers that contain menus
    if ((element.classList.contains('cdk-overlay-pane') || 
         element.classList.contains('cdk-overlay-connected-position-bounding-box')) &&
        this.hasOptions(element)) {
      return true; // Overlay contains menu items
    }
    
    // Matches a universal selector
    for (const selector of UNIVERSAL_MENU_SELECTORS) {
      try {
        if (element.matches(selector)) {
          return true;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Is positioned as popup with at least 1 item = likely a menu
    if (analysis.isPopup && analysis.zIndex > 1000 && analysis.itemCount >= 1) {
      return true;
    }
    
    // Gainsight-specific: ant-menu with role="menu"
    if (element.classList.contains('ant-menu') && element.getAttribute('role') === 'menu') {
      return true;
    }
    
    return false;
  }

  /**
   * Analyze element characteristics
   */
  private static analyzeElement(element: Element): MenuAnalysis {
    const role = element.getAttribute('role');
    const hasAriaRole = role === 'menu' || role === 'listbox' || role === 'menubar';
    
    const items = element.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
    const itemCount = items.length;
    
    const style = window.getComputedStyle(element as HTMLElement);
    const zIndex = parseInt(style.zIndex) || 0;
    const position = style.position;
    const isPopup = position === 'fixed' || position === 'absolute';
    const isVisible = this.isVisible(element);
    
    return {
      hasAriaRole,
      itemCount,
      isPopup,
      zIndex,
      isVisible,
    };
  }

  /**
   * Check if element is visible
   */
  private static isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    
    // CRITICAL: CDK overlay containers are just wrappers - they may have width=0 or opacity animations
    // For overlays, only check that they're not display:none
    const isCdkOverlay = element.classList.contains('cdk-overlay-pane') || 
                         element.classList.contains('cdk-overlay-container') ||
                         element.classList.contains('cdk-overlay-connected-position-bounding-box');
    
    if (isCdkOverlay) {
      // For CDK overlays, just check display and visibility (not size/opacity)
      return true;
    }
    
    // For non-overlay elements, do full checks
    if (style.opacity === '0') {
      return false;
    }
    
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    return true;
  }

  /**
   * Check if menu element has options/items
   * Also handles Angular CDK overlay containers that wrap menus
   * Searches both regular DOM and Shadow DOMs
   */
  private static hasOptions(element: Element): boolean {
    // Check if element itself is a menu item
    for (const selector of MENU_ITEM_SELECTORS) {
      try {
        if (element.matches(selector)) {
          return true; // Element itself is a menu item
        }
      } catch (e) {
        continue;
      }
    }
    
    // Check for menu items inside (regular DOM)
    const items = element.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
    if (items.length > 0) {
      return true;
    }
    
    // Check in Shadow DOM
    if (element.shadowRoot) {
      const shadowItems = element.shadowRoot.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
      if (shadowItems.length > 0) {
        return true;
      }
    }
    
    // Check in child elements' Shadow DOMs
    const allChildren = element.querySelectorAll('*');
    for (const child of allChildren) {
      if (child.shadowRoot) {
        const childShadowItems = child.shadowRoot.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
        if (childShadowItems.length > 0) {
          return true;
        }
      }
    }
    
    // CRITICAL: For Angular CDK overlays, the menu might be nested
    // Check if this is a cdk-overlay-pane that contains a menu
    if (element.classList.contains('cdk-overlay-pane') || 
        element.classList.contains('cdk-overlay-connected-position-bounding-box')) {
      // Look for menu inside the overlay
      const menuInside = element.querySelector('[role="menu"], [role="listbox"], .gs-popover-menu__list, .ant-menu, ul[role="menu"]');
      if (menuInside) {
        const menuItems = menuInside.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
        if (menuItems.length > 0) {
          return true;
        }
        
        // Also check in menu's Shadow DOM
        if (menuInside.shadowRoot) {
          const shadowMenuItems = menuInside.shadowRoot.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
          if (shadowMenuItems.length > 0) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Find a currently visible menu (no waiting)
   */
  static findVisibleMenu(): Element | null {
    console.log('[MenuDetector] Searching for visible menu...');
    
    // First, try direct menu selectors (but skip CDK containers - we handle those specially)
    const cdkSelectors = ['.cdk-overlay-pane', '.cdk-overlay-connected-position-bounding-box', '.cdk-overlay-container'];
    for (const selector of UNIVERSAL_MENU_SELECTORS) {
      // Skip CDK overlay containers - they need special handling
      if (cdkSelectors.includes(selector)) {
        continue;
      }
      
      try {
        const elements = document.querySelectorAll(selector);
        console.log(`[MenuDetector] Selector "${selector}" found ${elements.length} elements`);
        for (const element of elements) {
          const visible = this.isVisible(element);
          const hasOpts = this.hasOptions(element);
          console.log(`[MenuDetector]   Element: visible=${visible}, hasOptions=${hasOpts}, classes=${element.className.substring(0, 50)}`);
          if (visible && hasOpts) {
            console.log(`[MenuDetector] ✅ Found visible menu via selector: ${selector}`);
            return element;
          }
        }
      } catch (e) {
        console.warn(`[MenuDetector] Selector "${selector}" failed:`, e);
        continue;
      }
    }
    
    // CRITICAL: Also check inside CDK overlay containers
    // Angular CDK menus are wrapped in .cdk-overlay-pane
    // The overlay container might be invisible, but the menu inside might be visible!
      try {
        const overlays = document.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-connected-position-bounding-box');
        console.log(`[MenuDetector] Found ${overlays.length} CDK overlay containers`);
        
        // CRITICAL: Check ALL overlays - there might be multiple (notifications, menus, etc.)
        for (let overlayIndex = 0; overlayIndex < overlays.length; overlayIndex++) {
          const overlay = overlays[overlayIndex];
          try {
            console.log(`[MenuDetector] Checking overlay ${overlayIndex + 1}/${overlays.length}...`);
            
            // CRITICAL: Even if overlay is invisible, check inside it - menu might be visible!
            // Look for menu inside overlay
            console.log(`[MenuDetector]   Checking inside overlay for menu...`);
            
            // First, try standard menu selectors
            let menuInside = overlay.querySelector('[role="menu"], [role="listbox"], .gs-popover-menu__list, .ant-menu, ul[role="menu"]');
            
            if (!menuInside) {
              // Broader search - look for ANY element with menu items inside
              console.log(`[MenuDetector]   Standard selectors failed, searching for any element with menu items...`);
              const allChildren = Array.from(overlay.querySelectorAll('*'));
              console.log(`[MenuDetector]   Overlay has ${allChildren.length} child elements total`);
              
              // Log first few children to see structure
              allChildren.slice(0, 5).forEach((child, i) => {
                console.log(`[MenuDetector]   Child ${i}: ${child.tagName}.${child.className.substring(0, 30)} role=${child.getAttribute('role')}`);
              });
              
              // Find any child that contains menu items
              for (const child of allChildren) {
                const items = child.querySelectorAll(MENU_ITEM_SELECTORS.join(', '));
                if (items.length > 0 && this.isVisible(child)) {
                  console.log(`[MenuDetector]   Found ${items.length} menu items in child: ${child.tagName}.${child.className.substring(0, 30)}`);
                  menuInside = child;
                  break;
                }
              }
            }
            
            if (menuInside) {
              console.log(`[MenuDetector]   Found menu element inside overlay (checking visibility...)`);
              const menuVisible = this.isVisible(menuInside);
              const menuHasOpts = this.hasOptions(menuInside);
              console.log(`[MenuDetector]   Menu element: visible=${menuVisible}, hasOptions=${menuHasOpts}, role=${menuInside.getAttribute('role')}, classes=${menuInside.className.substring(0, 50)}`);
              if (menuVisible && menuHasOpts) {
                console.log('[MenuDetector] ✅ Found visible menu inside CDK overlay');
                return menuInside;
              } else {
                console.log(`[MenuDetector]   Menu element not usable: visible=${menuVisible}, hasOptions=${menuHasOpts}`);
              }
            } else {
              console.log(`[MenuDetector]   ❌ This overlay doesn't contain a menu (might be notifications, tooltips, etc.)`);
            }
          } catch (innerError) {
            console.error(`[MenuDetector] Error processing overlay ${overlayIndex}:`, innerError);
          }
        }
      } catch (e) {
        console.error('[MenuDetector] Overlay check failed:', e);
      }
    
    // PHASE 3: Search inside Shadow DOMs - menu might be inside a web component
    console.log('[MenuDetector] 🌑 Searching inside Shadow DOMs...');
    const shadowMenuSelectors = [
      '[role="menu"]', 
      '[role="listbox"]', 
      '.gs-popover-menu__list',
      'ul.gs-popover-menu__list'
    ];
    
    const candidateMenus: Array<{menu: Element, itemCount: number}> = [];
    
    for (const selector of shadowMenuSelectors) {
      const shadowResults = this.querySelectorAllDeep(selector);
      console.log(`[MenuDetector] 🌑 Deep search "${selector}" found ${shadowResults.length} elements`);
      
      for (const element of shadowResults) {
        const visible = this.isVisible(element);
        const hasOpts = this.hasOptions(element);
        if (visible && hasOpts) {
          const itemCount = this.extractMenuItems(element).length;
          console.log(`[MenuDetector] 🌑 Found candidate menu in Shadow DOM: ${element.tagName}.${element.className.substring(0, 30)} with ${itemCount} items`);
          candidateMenus.push({menu: element, itemCount});
        }
      }
    }
    
    // If multiple menus found, return the one with the MOST items
    // (most likely to be the freshly opened dropdown, not a stale menu)
    if (candidateMenus.length > 0) {
      candidateMenus.sort((a, b) => b.itemCount - a.itemCount); // Sort descending
      const winner = candidateMenus[0];
      console.log(`[MenuDetector] ✅ Selected menu with ${winner.itemCount} items (${candidateMenus.length} candidates found)`);
      return winner.menu;
    }
    
    console.log('[MenuDetector] ⚠️ No visible menu found');
    return null;
  }

  /**
   * Extract menu items from a menu element
   * Searches both regular DOM and Shadow DOMs
   */
  static extractMenuItems(menu: Element): Element[] {
    const items: Element[] = [];
    
    // First search in regular DOM
    for (const selector of MENU_ITEM_SELECTORS) {
      const found = menu.querySelectorAll(selector);
      items.push(...Array.from(found));
    }
    
    // Then search in the menu's own Shadow DOM (if it has one)
    if (menu.shadowRoot) {
      for (const selector of MENU_ITEM_SELECTORS) {
        try {
          const found = menu.shadowRoot.querySelectorAll(selector);
          items.push(...Array.from(found));
        } catch (e) {
          // Invalid selector for this shadow root
        }
      }
    }
    
    // Deduplicate
    const uniqueItems = Array.from(new Set(items));
    console.log(`[MenuDetector] extractMenuItems found ${uniqueItems.length} items in menu: ${menu.tagName}.${menu.className.substring(0, 30)}`);
    
    return uniqueItems;
  }

  /**
   * Check if element is inside a menu
   */
  static isInsideMenu(element: Element): boolean {
    for (const selector of UNIVERSAL_MENU_SELECTORS) {
      try {
        const menu = element.closest(selector);
        if (menu) return true;
      } catch (e) {
        continue;
      }
    }
    return false;
  }

  /**
   * Find parent menu of an element
   */
  static findParentMenu(element: Element): Element | null {
    for (const selector of UNIVERSAL_MENU_SELECTORS) {
      try {
        const menu = element.closest(selector);
        if (menu) return menu;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

