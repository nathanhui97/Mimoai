/**
 * Tab Manager for Multi-Tab Workflow Execution
 * 
 * Manages mapping between logical tab indices (recorded during workflow)
 * and physical tab IDs (during replay), handles tab switching and creation.
 */

export interface TabInfo {
  tabId: number;
  url: string;
  title?: string;
  logicalIndex: number; // The recorded tab index (Tab 0, Tab 1, etc.)
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

  constructor(startingTabId: number) {
    this.startingTabId = startingTabId;
    this.currentTabId = startingTabId;
    
    // Register starting tab as logical Tab 0
    this.registerTab(0, startingTabId, window.location.href, document.title);
    
    console.log('[TabManager] Initialized with starting tab:', startingTabId);
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
}

