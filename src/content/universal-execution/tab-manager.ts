/**
 * Tab Manager for Multi-Tab Workflow Execution
 * 
 * Manages mapping between logical tab indices (recorded during workflow)
 * and physical tab IDs (during replay), handles tab switching and creation.
 * 
 * State is persisted in chrome.storage.session so all tabs share the same mappings.
 */

export interface TabInfo {
  tabId: number;
  url: string;
  title?: string;
  logicalIndex: number; // The recorded tab index (Tab 0, Tab 1, etc.)
}

interface TabManagerState {
  tabMap: [number, number][]; // Array of [logicalIndex, physicalTabId]
  tabInfo: [number, TabInfo][]; // Array of [physicalTabId, TabInfo]
  currentTabId: number | null;
}

export class TabManager {
  // Map: logical index → physical tab ID
  private tabMap: Map<number, number> = new Map();
  
  // Map: physical tab ID → TabInfo
  private tabInfo: Map<number, TabInfo> = new Map();
  
  // Current active tab ID
  private currentTabId: number | null = null;
  
  // Starting tab ID (where execution began)
  private startingTabId: number;
  
  // Flag to track if state has been loaded from storage
  private isInitialized: boolean = false;

  constructor(startingTabId: number) {
    this.startingTabId = startingTabId;
    this.currentTabId = startingTabId;
  }

  /**
   * Initialize TabManager by loading shared state from storage
   * This MUST be called before using the TabManager
   * Routes through service worker to avoid storage access restrictions in some contexts
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[TabManager] Already initialized, skipping');
      return;
    }
    
    console.log('[TabManager] Initializing with starting tab:', this.startingTabId);
    
    try {
      // Load existing state via service worker (bypasses content script storage restrictions)
      const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_MANAGER_STATE' });
      const savedState = response?.data as TabManagerState | null | undefined;
      
      if (savedState) {
        // Restore existing mappings
        this.tabMap = new Map(savedState.tabMap);
        this.tabInfo = new Map(savedState.tabInfo);
        // IMPORTANT: Don't restore currentTabId from saved state!
        // We need to detect which tab we're ACTUALLY in right now
        
        console.log('[TabManager] ✅ Restored state from storage:', {
          tabs: this.tabMap.size,
          mappings: Array.from(this.tabMap.entries()),
        });
      } else {
        console.log('[TabManager] No existing state found, will create new mappings');
      }
      
      // Find which logical index THIS tab has (by matching physical tab ID)
      let logicalIndex = -1;
      for (const [index, tabId] of this.tabMap.entries()) {
        if (tabId === this.startingTabId) {
          logicalIndex = index;
          break;
        }
      }
      
      // Update currentTabId to reflect where we ACTUALLY are
      this.currentTabId = this.startingTabId;
      
      // If current tab is not registered, register it
      if (logicalIndex === -1) {
        // IMPORTANT: Don't automatically assign Tab 0!
        // Tab 0 should be the first tab where workflow started
        // If there's no existing state, this IS Tab 0
        // If there IS existing state, we need to wait for explicit registration via openNewTab/switchToTab
        if (this.tabMap.size === 0) {
          // No existing tabs - this is the starting tab (Tab 0)
          console.log('[TabManager] First tab in workflow, registering as Tab 0');
          this.registerTab(0, this.startingTabId, window.location.href, document.title);
        } else {
          // There are existing tabs, but current tab is not registered
          // This means we're in a tab that's not part of the workflow yet
          // Don't register it automatically - wait for explicit action
          console.log('[TabManager] Current tab not in workflow mappings, waiting for explicit registration');
        }
      } else {
        console.log(`[TabManager] Current tab is registered as Tab ${logicalIndex}, physical ID ${this.startingTabId}`);
      }
      
      this.isInitialized = true;
      console.log('[TabManager] ✅ Initialization complete, currentTabId:', this.currentTabId);
    } catch (error) {
      console.error('[TabManager] Error initializing:', error);
      // Fallback: Only register if no existing state
      console.warn('[TabManager] ⚠️ Could not load shared state, using local-only mode');
      // Still mark as initialized, but without shared state
      this.currentTabId = this.startingTabId;
      if (this.tabMap.size === 0) {
        this.registerTab(0, this.startingTabId, window.location.href, document.title);
      }
      this.isInitialized = true;
    }
  }

  /**
   * Persist current state via service worker (bypasses content script storage restrictions)
   */
  private async persistState(): Promise<void> {
    try {
      const state: TabManagerState = {
        tabMap: Array.from(this.tabMap.entries()),
        tabInfo: Array.from(this.tabInfo.entries()),
        currentTabId: this.currentTabId,
      };
      
      const response = await chrome.runtime.sendMessage({
        type: 'SET_TAB_MANAGER_STATE',
        payload: { state },
      });
      
      if (response?.success) {
        console.log('[TabManager] 💾 State persisted via service worker:', {
          tabs: this.tabMap.size,
          currentTabId: this.currentTabId,
        });
      } else {
        console.error('[TabManager] ⚠️ Service worker failed to persist state:', response?.error);
      }
    } catch (error) {
      console.error('[TabManager] ⚠️ Error persisting state:', error);
      // Don't throw - allow operation to continue without persistence
    }
  }

  /**
   * Register a tab with its logical index
   */
  registerTab(logicalIndex: number, tabId: number, url: string, title?: string): void {
    this.tabMap.set(logicalIndex, tabId);
    this.tabInfo.set(tabId, {
      tabId,
      url,
      title,
      logicalIndex,
    });
    
    console.log(`[TabManager] Registered tab ${logicalIndex} → physical ID ${tabId} (${url})`);
    
    // Persist state after registration
    this.persistState().catch(err => console.error('[TabManager] Failed to persist after registration:', err));
  }

  /**
   * Get physical tab ID for a logical index
   */
  getTabId(logicalIndex: number): number | undefined {
    return this.tabMap.get(logicalIndex);
  }

  /**
   * Get tab info for a physical tab ID
   */
  getTabInfo(tabId: number): TabInfo | undefined {
    return this.tabInfo.get(tabId);
  }

  /**
   * Get current active tab ID
   */
  getCurrentTabId(): number {
    return this.currentTabId || this.startingTabId;
  }

  /**
   * Switch to a different tab
   * Returns true if switch was successful
   */
  async switchToTab(logicalIndex: number): Promise<boolean> {
    const targetTabId = this.getTabId(logicalIndex);
    
    if (!targetTabId) {
      console.error(`[TabManager] No tab registered for logical index ${logicalIndex}`);
      return false;
    }

    if (targetTabId === this.currentTabId) {
      console.log(`[TabManager] Already on tab ${logicalIndex}`);
      return true;
    }

    try {
      console.log(`[TabManager] Switching from tab ${this.currentTabId} to tab ${targetTabId} (logical ${logicalIndex})`);
      
      // Request service worker to activate the tab
      const response = await chrome.runtime.sendMessage({
        type: 'ACTIVATE_TAB',
        payload: { tabId: targetTabId },
      });

      if (response?.success) {
        this.currentTabId = targetTabId;
        console.log(`[TabManager] Successfully switched to tab ${logicalIndex}`);
        
        // Persist state after switching
        await this.persistState();
        
        // Wait for tab to be fully activated
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return true;
      } else {
        console.error(`[TabManager] Failed to activate tab:`, response?.error);
        return false;
      }
    } catch (error) {
      console.error(`[TabManager] Error switching to tab ${logicalIndex}:`, error);
      return false;
    }
  }

  /**
   * Open a new tab and register it
   * Returns the new tab ID or null if failed
   */
  async openNewTab(logicalIndex: number, url: string): Promise<number | null> {
    try {
      console.log(`[TabManager] Opening new tab for logical index ${logicalIndex} at ${url}`);
      
      // Request service worker to create a new tab
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_TAB',
        payload: { url },
      });

      if (response?.success && response.data?.tabId) {
        const newTabId = response.data.tabId;
        this.registerTab(logicalIndex, newTabId, url);
        this.currentTabId = newTabId;
        
        console.log(`[TabManager] Created new tab ${newTabId} for logical index ${logicalIndex}`);
        
        // Persist state after creating tab (registerTab already persists, but update currentTabId)
        await this.persistState();
        
        // Wait for tab to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return newTabId;
      } else {
        console.error(`[TabManager] Failed to create tab:`, response?.error);
        return null;
      }
    } catch (error) {
      console.error(`[TabManager] Error creating new tab:`, error);
      return null;
    }
  }

  /**
   * Navigate current tab to a URL
   */
  async navigateTab(tabId: number, url: string): Promise<boolean> {
    try {
      console.log(`[TabManager] Navigating tab ${tabId} to ${url}`);
      
      const response = await chrome.runtime.sendMessage({
        type: 'NAVIGATE_TAB',
        payload: { tabId, url },
      });

      if (response?.success) {
        // Update tab info URL
        const info = this.tabInfo.get(tabId);
        if (info) {
          info.url = url;
        }
        
        // Wait for navigation to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return true;
      } else {
        console.error(`[TabManager] Failed to navigate tab:`, response?.error);
        return false;
      }
    } catch (error) {
      console.error(`[TabManager] Error navigating tab:`, error);
      return false;
    }
  }

  /**
   * Get all registered tabs
   */
  getAllTabs(): TabInfo[] {
    return Array.from(this.tabInfo.values());
  }

  /**
   * Check if a logical tab index is registered
   */
  hasTab(logicalIndex: number): boolean {
    return this.tabMap.has(logicalIndex);
  }

  /**
   * Clear all tab mappings from storage via service worker
   * Should be called when workflow execution completes or is cancelled
   */
  static async clearStorage(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLEAR_TAB_MANAGER_STATE' });
      if (response?.success) {
        console.log('[TabManager] 🧹 Cleared tab manager state from storage');
      } else {
        console.error('[TabManager] Failed to clear storage:', response?.error);
      }
    } catch (error) {
      console.error('[TabManager] Error clearing storage:', error);
    }
  }
}

