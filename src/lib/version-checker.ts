/**
 * Version Checker - Ensures extension always uses fresh code
 * 
 * Detects version mismatches between:
 * - Content script vs background service worker
 * - Built code vs loaded code
 * - Cached code vs fresh code
 * 
 * Automatically triggers reloads when stale code is detected.
 */

// Auto-generated version from build timestamp
// Format: YYYY-MM-DDTHH-MM-SS (automatically updated on each build)
export const EXTENSION_VERSION = import.meta.env.VITE_BUILD_TIMESTAMP || 'dev';

// Build-time hash (unique for each build)
export const BUILD_HASH = import.meta.env.VITE_BUILD_HASH || 'dev';

/**
 * Version information stored in extension
 */
export interface VersionInfo {
  version: string;
  buildHash: string;
  timestamp: number;
  component: 'content-script' | 'service-worker' | 'sidepanel';
}

/**
 * VersionChecker ensures all parts of the extension are on the same version
 */
export class VersionChecker {
  private static readonly STORAGE_KEY = 'ghostwriter_version_info';
  
  /**
   * Check if this component's version matches the stored version
   * If mismatch detected, triggers a reload
   */
  static async checkVersion(component: VersionInfo['component']): Promise<void> {
    try {
      const currentVersion: VersionInfo = {
        version: EXTENSION_VERSION,
        buildHash: BUILD_HASH,
        timestamp: Date.now(),
        component,
      };
      
      console.log(`[VersionChecker] ${component} version:`, EXTENSION_VERSION, 'hash:', BUILD_HASH);
      
      // Get stored version from extension storage
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const storedVersions = result[this.STORAGE_KEY] as Record<string, VersionInfo> || {};
      
      // Check if we have a version mismatch
      const storedVersion = storedVersions[component];
      
      if (storedVersion) {
        const versionMismatch = storedVersion.version !== currentVersion.version;
        const hashMismatch = storedVersion.buildHash !== currentVersion.buildHash;
        
        if (versionMismatch || hashMismatch) {
          console.warn(`[VersionChecker] ⚠️ Version mismatch detected for ${component}!`);
          console.warn(`[VersionChecker] Stored: ${storedVersion.version} (${storedVersion.buildHash})`);
          console.warn(`[VersionChecker] Current: ${currentVersion.version} (${currentVersion.buildHash})`);
          console.warn(`[VersionChecker] This indicates cached code is being used. Triggering reload...`);
          
          // Clear the version mismatch
          await this.updateVersion(component);
          
          // Trigger appropriate reload based on component
          await this.triggerReload(component);
          
          return;
        }
      }
      
      // Update stored version
      await this.updateVersion(component);
      
      console.log(`[VersionChecker] ✅ ${component} version verified:`, EXTENSION_VERSION);
    } catch (error) {
      console.error('[VersionChecker] Error checking version:', error);
    }
  }
  
  /**
   * Update stored version for a component
   */
  private static async updateVersion(component: VersionInfo['component']): Promise<void> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const storedVersions = result[this.STORAGE_KEY] as Record<string, VersionInfo> || {};
      
      storedVersions[component] = {
        version: EXTENSION_VERSION,
        buildHash: BUILD_HASH,
        timestamp: Date.now(),
        component,
      };
      
      await chrome.storage.local.set({ [this.STORAGE_KEY]: storedVersions });
      console.log(`[VersionChecker] Updated stored version for ${component}`);
    } catch (error) {
      console.error('[VersionChecker] Error updating version:', error);
    }
  }
  
  /**
   * Trigger reload based on component type
   */
  private static async triggerReload(component: VersionInfo['component']): Promise<void> {
    switch (component) {
      case 'content-script':
        // Content scripts can't reload themselves, must notify user
        console.error(`[VersionChecker] 🔄 Content script version mismatch!`);
        console.error(`[VersionChecker] ACTION REQUIRED: Reload this tab to get fresh code`);
        console.error(`[VersionChecker] Press Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)`);
        
        // Try to inject a visual notification
        this.showReloadNotification();
        break;
        
      case 'service-worker':
        // Service workers can reload the extension
        console.log(`[VersionChecker] 🔄 Service worker version mismatch - reloading extension...`);
        try {
          await chrome.runtime.reload();
        } catch (error) {
          console.error('[VersionChecker] Failed to reload extension:', error);
        }
        break;
        
      case 'sidepanel':
        // Sidepanel can reload itself
        console.log(`[VersionChecker] 🔄 Sidepanel version mismatch - reloading...`);
        window.location.reload();
        break;
    }
  }
  
  /**
   * Show visual notification to user that tab needs reload
   */
  private static showReloadNotification(): void {
    try {
      // Create a prominent banner at the top of the page
      const banner = document.createElement('div');
      banner.id = 'ghostwriter-reload-banner';
      banner.setAttribute('data-ghostwriter', 'true'); // Prevent recording this element
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
      `;
      
      banner.innerHTML = `
        <span>🔄 GhostWriter extension updated! Please reload this tab to use the latest code.</span>
        <button id="ghostwriter-reload-btn" style="
          background: white;
          color: #667eea;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        ">Reload Tab</button>
        <button id="ghostwriter-dismiss-btn" style="
          background: transparent;
          color: white;
          border: 1px solid white;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        ">Dismiss</button>
      `;
      
      document.body.prepend(banner);
      
      // Add click handlers
      const reloadBtn = document.getElementById('ghostwriter-reload-btn');
      const dismissBtn = document.getElementById('ghostwriter-dismiss-btn');
      
      if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
          window.location.reload();
        });
      }
      
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          banner.remove();
        });
      }
      
      console.log('[VersionChecker] 📢 Reload notification shown to user');
    } catch (error) {
      console.error('[VersionChecker] Failed to show reload notification:', error);
    }
  }
  
  /**
   * Force clear all caches (called from UI or console)
   */
  static async clearAllCaches(): Promise<{ success: boolean; cleared: string[] }> {
    const cleared: string[] = [];
    
    try {
      // 1. Clear chrome.storage.local (except workflows)
      console.log('[VersionChecker] 🧹 Clearing chrome.storage.local...');
      const all = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter(key => 
        !key.startsWith('workflow_') && // Keep saved workflows
        !key.startsWith('ghostwriter_workflows') // Keep workflow list
      );
      
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        cleared.push(`chrome.storage.local (${keysToRemove.length} keys)`);
        console.log('[VersionChecker] ✅ Cleared', keysToRemove.length, 'storage keys');
      }
      
      // 2. Clear sessionStorage (if in content script)
      if (typeof sessionStorage !== 'undefined') {
        console.log('[VersionChecker] 🧹 Clearing sessionStorage...');
        sessionStorage.clear();
        cleared.push('sessionStorage');
      }
      
      // 3. Clear localStorage (if in content script)
      if (typeof localStorage !== 'undefined') {
        console.log('[VersionChecker] 🧹 Clearing localStorage...');
        localStorage.clear();
        cleared.push('localStorage');
      }
      
      // 4. Reset version info to force fresh checks
      await chrome.storage.local.remove([this.STORAGE_KEY]);
      cleared.push('version info');
      
      console.log('[VersionChecker] ✅ All caches cleared:', cleared);
      return { success: true, cleared };
    } catch (error) {
      console.error('[VersionChecker] Error clearing caches:', error);
      return { success: false, cleared };
    }
  }
  
  /**
   * Get version info for all components
   */
  static async getAllVersions(): Promise<Record<string, VersionInfo>> {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      return result[this.STORAGE_KEY] as Record<string, VersionInfo> || {};
    } catch (error) {
      console.error('[VersionChecker] Error getting versions:', error);
      return {};
    }
  }
}

// Export convenience function for console debugging
(globalThis as any).clearExtensionCache = () => VersionChecker.clearAllCaches();
(globalThis as any).checkExtensionVersion = () => VersionChecker.getAllVersions();

console.log('[VersionChecker] 💡 Debug functions available:');
console.log('[VersionChecker] - clearExtensionCache() - Clear all caches');
console.log('[VersionChecker] - checkExtensionVersion() - Check version info');

