/**
 * Background Service Worker for GhostWriter Extension
 * Handles message routing between Side Panel and Content Scripts
 * Manages multi-tab recording coordination
 */

import type { ExtensionMessage, MessageResponse, TabSwitchedMessage, StartRecordingInTabMessage, StopRecordingInTabMessage, ResumeRecordingMessage } from '../types/messages';

// Tab tracking state (runtime only, not persisted)
const activeRecordingTabs: Set<number> = new Set();
let recordingSessionId: string | null = null;
const tabUrlMap: Map<number, { url: string; title?: string }> = new Map();
let lastActiveTabId: number | null = null; // Track last active tab for TAB_SWITCH step creation

// Logical tab indexing: maps physical tabId -> logical index (Tab 0, Tab 1, etc.)
const sessionTabMap: Map<number, number> = new Map();
let lastRecordedTabUrl: string | null = null; // Track last tab URL before pause
let lastRecordedTabIndex: number | null = null; // Track last tab's logical index before pause

/**
 * Broadcast message to all tabs currently being recorded
 * Note: This function is currently unused but kept for future multi-tab coordination
 */
// @ts-expect-error - Function is kept for future use
async function broadcastToRecordingTabs(_message: ExtensionMessage): Promise<void> {
  const tabIds = Array.from(activeRecordingTabs);
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.sendMessage(tabId, _message);
    } catch (error) {
      console.warn(`Failed to send message to tab ${tabId}:`, error);
      // Remove tab from active set if it's no longer accessible
      activeRecordingTabs.delete(tabId);
      tabUrlMap.delete(tabId);
    }
  }
}

/**
 * Start recording in a specific tab
 */
async function startRecordingInTab(tabId: number, tabUrl: string, tabTitle?: string): Promise<void> {
  if (activeRecordingTabs.has(tabId)) {
    console.log(`Tab ${tabId} is already being recorded`);
    return;
  }

  try {
    // 1. Verify content script is loaded (ping it)
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch (e) {
      // 2. If ping fails, inject content script dynamically
      console.log(`Content script not loaded in tab ${tabId}, injecting...`);
      // Get content script paths from manifest (will be compiled paths in production)
      const manifest = chrome.runtime.getManifest();
      const contentScripts = manifest.content_scripts || [];
      if (contentScripts.length > 0 && contentScripts[0].js) {
        const scriptFiles = contentScripts[0].js;
        await chrome.scripting.executeScript({
          target: { tabId },
          files: scriptFiles,
        });
        // Wait for script to initialize
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        throw new Error('Content script not found in manifest');
      }
    }

    // 3. Assign logical index if tabId not in sessionTabMap
    if (!sessionTabMap.has(tabId)) {
      const logicalIndex = sessionTabMap.size;
      sessionTabMap.set(tabId, logicalIndex);
      console.log(`Assigned logical index ${logicalIndex} to tab ${tabId}`);
    }

    // 4. Now send START_RECORDING_IN_TAB message
    const message: StartRecordingInTabMessage = {
      type: 'START_RECORDING_IN_TAB',
      payload: { tabId, tabUrl, tabTitle },
    };
    
    await chrome.tabs.sendMessage(tabId, message);
    activeRecordingTabs.add(tabId);
    tabUrlMap.set(tabId, { url: tabUrl, title: tabTitle });
    
    // 5. Store tab info for pause/resume
    const tabIndex = sessionTabMap.get(tabId) ?? sessionTabMap.size - 1;
    lastRecordedTabUrl = tabUrl;
    lastRecordedTabIndex = tabIndex;
    
    console.log(`Started recording in tab ${tabId} (${tabUrl}) [Index: ${tabIndex}]`);
  } catch (error) {
    console.error(`Failed to start recording in tab ${tabId}:`, error);
    throw error;
  }
}

/**
 * Stop recording in a specific tab
 */
async function stopRecordingInTab(tabId: number): Promise<void> {
  if (!activeRecordingTabs.has(tabId)) {
    return;
  }

  try {
    const message: StopRecordingInTabMessage = {
      type: 'STOP_RECORDING_IN_TAB',
      payload: { tabId },
    };
    
    await chrome.tabs.sendMessage(tabId, message);
    activeRecordingTabs.delete(tabId);
    tabUrlMap.delete(tabId);
    console.log(`Stopped recording in tab ${tabId}`);
  } catch (error) {
    console.warn(`Failed to stop recording in tab ${tabId}:`, error);
    // Still remove from tracking even if message fails
    activeRecordingTabs.delete(tabId);
    tabUrlMap.delete(tabId);
  }
}

/**
 * Pause recording in all tabs without finalizing the session
 * Preserves sessionTabMap, recordingSessionId, and last recorded tab info
 */
async function pauseRecordingInAllTabs(): Promise<void> {
  const tabIds = Array.from(activeRecordingTabs);
  for (const tabId of tabIds) {
    await stopRecordingInTab(tabId);
  }
  activeRecordingTabs.clear();
  
  // Store last recorded tab info before clearing tabUrlMap
  if (lastActiveTabId) {
    const lastTabInfo = tabUrlMap.get(lastActiveTabId);
    if (lastTabInfo) {
      lastRecordedTabUrl = lastTabInfo.url;
      lastRecordedTabIndex = sessionTabMap.get(lastActiveTabId) ?? null;
    }
  }
  
  // Do NOT clear:
  // - recordingSessionId (preserve for resume)
  // - sessionTabMap (preserve for resume)
  // - tabUrlMap (we'll keep it for reference, but activeRecordingTabs is cleared)
  
  console.log('Recording paused (session preserved)');
}

/**
 * Stop recording in all active tabs and finalize the session
 * Returns the initial full page snapshot from the last active tab (if available)
 */
async function stopRecordingInAllTabs(): Promise<{ initialFullPageSnapshot?: string }> {
  let tabIds = Array.from(activeRecordingTabs);
  let initialSnapshot: string | undefined;
  
  console.log(`[Service Worker] Stopping recording in ${tabIds.length} tabs`, { tabIds, lastActiveTabId });
  
  // FALLBACK: If no tabs tracked, try current active tab
  if (tabIds.length === 0) {
    console.warn('[Service Worker] ⚠️ No recording tabs tracked, trying active tab as fallback');
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        console.log(`[Service Worker] Using fallback active tab ${activeTab.id} (${activeTab.url})`);
        tabIds = [activeTab.id];
      }
    } catch (error) {
      console.warn('[Service Worker] Failed to query active tab for fallback:', error);
    }
  }
  
  // Try to get snapshot from each tab (priority: last active tab first, then all others)
  const tabsToCheck = lastActiveTabId && tabIds.includes(lastActiveTabId)
    ? [lastActiveTabId, ...tabIds.filter(id => id !== lastActiveTabId)]
    : tabIds;
  
  for (const tabId of tabsToCheck) {
    if (!initialSnapshot) {  // Stop once we get a snapshot
      try {
        console.log(`[Service Worker] Requesting STOP_RECORDING from tab ${tabId}...`);
        const response = await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' });
        console.log(`[Service Worker] Response from tab ${tabId}:`, {
          success: response?.success,
          hasData: !!response?.data,
          hasSnapshot: !!response?.data?.initialFullPageSnapshot,
          snapshotLength: response?.data?.initialFullPageSnapshot?.length || 0,
        });
        
        if (response && response.success && response.data?.initialFullPageSnapshot) {
          initialSnapshot = response.data.initialFullPageSnapshot;
          console.log(`[Service Worker] ✅ Received snapshot from tab ${tabId}, length:`, initialSnapshot?.length || 0);
        }
      } catch (error) {
        console.warn(`[Service Worker] Failed to get snapshot from tab ${tabId}:`, error);
      }
    } else {
      // Already have snapshot, just stop recording in remaining tabs
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING_IN_TAB', payload: { tabId } });
      } catch (error) {
        console.warn(`[Service Worker] Failed to stop recording in tab ${tabId}:`, error);
      }
    }
  }
  
  activeRecordingTabs.clear();
  tabUrlMap.clear();
  recordingSessionId = null;
  lastActiveTabId = null;
  sessionTabMap.clear();
  lastRecordedTabUrl = null;
  lastRecordedTabIndex = null;
  
  console.log(`[Service Worker] Recording stopped, snapshot available: ${!!initialSnapshot}, length: ${initialSnapshot?.length || 0}`);
  
  return { initialFullPageSnapshot: initialSnapshot };
}

/**
 * Perform a click using Chrome Debugger API (sends real mouse events with isTrusted=true)
 * Optimized: attach, click, detach immediately to avoid lag
 */
async function performDebuggerClick(tabId: number, x: number, y: number): Promise<void> {
  try {
    // Attach debugger
    await chrome.debugger.attach({ tabId }, '1.3');
    
    try {
      // Mouse down
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });

      // Mouse up immediately (no delay needed)
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });

      console.log(`[Debugger] Click at (${x}, ${y})`);
    } finally {
      // Always detach immediately to prevent lag
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  } catch (error) {
    // Detach on error too
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw error;
  }
}

// Message routing: forward messages between sidepanel and content scripts
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    // Handle DEBUGGER_CLICK request from content script
    if (message.type === 'DEBUGGER_CLICK') {
      const { x, y } = message as any;
      const tabId = sender.tab?.id;
      
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab ID' });
        return false;
      }
      
      performDebuggerClick(tabId, x, y)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed'
        }));
      
      return true; // Keep channel open for async
    }

    // Handle DEBUGGER_DETACH - no-op (we detach immediately now)
    if (message.type === 'DEBUGGER_DETACH') {
      sendResponse({ success: true });
      return false;
    }

    // Handle CAPTURE_VIEWPORT request from content script
    if (message.type === 'CAPTURE_VIEWPORT') {
      if (!sender.tab) {
        console.error('📸 Service Worker: CAPTURE_VIEWPORT called without sender.tab');
        sendResponse({ 
          success: false, 
          error: 'No tab context available' 
        });
        return false;
      }
      
      console.log('📸 Service Worker: Capturing viewport for tab:', sender.tab.id);
      // windowId is optional - if not provided, captures active window
      chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Capture failed:', chrome.runtime.lastError.message);
          sendResponse({ 
            success: false, 
            error: chrome.runtime.lastError.message 
          });
        } else if (!dataUrl) {
          console.error('📸 Service Worker: Capture returned empty data');
          sendResponse({ 
            success: false, 
            error: 'Screenshot data is empty' 
          });
        } else {
          console.log('📸 Service Worker: Viewport captured successfully, size:', dataUrl.length, 'chars');
          sendResponse({ 
            success: true, 
            data: { snapshot: dataUrl } 
          });
        }
      });
      return true; // Keep channel open for async
    }

    // Handle GET_ZOOM request
    if (message.type === 'GET_ZOOM') {
      const targetTabId = (message.payload?.tabId) || sender.tab?.id;
      if (!targetTabId) {
        sendResponse({
          success: false,
          error: 'No tab ID available'
        });
        return false;
      }

      chrome.tabs.getZoom(targetTabId, (zoomFactor) => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Get zoom failed:', chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          console.log(`📸 Service Worker: Current zoom for tab ${targetTabId}:`, zoomFactor);
          sendResponse({
            success: true,
            data: { zoomFactor }
          });
        }
      });
      return true; // Keep channel open for async
    }

    // Handle SET_ZOOM request
    if (message.type === 'SET_ZOOM') {
      const targetTabId = (message.payload?.tabId) || sender.tab?.id;
      const zoomFactor = message.payload?.zoomFactor;
      
      if (!targetTabId) {
        sendResponse({
          success: false,
          error: 'No tab ID available'
        });
        return false;
      }

      if (typeof zoomFactor !== 'number' || zoomFactor < 0.25 || zoomFactor > 5.0) {
        sendResponse({
          success: false,
          error: 'Invalid zoom factor. Must be between 0.25 and 5.0'
        });
        return false;
      }

      chrome.tabs.setZoom(targetTabId, zoomFactor, () => {
        if (chrome.runtime.lastError) {
          console.error('📸 Service Worker: Set zoom failed:', chrome.runtime.lastError.message);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          console.log(`📸 Service Worker: Zoom set to ${zoomFactor} for tab ${targetTabId}`);
          sendResponse({
            success: true,
            data: { zoomFactor }
          });
        }
      });
      return true; // Keep channel open for async
    }

    // Handle GET_FRAME_ID request from content script
    if (message.type === 'GET_FRAME_ID') {
      const frameId = sender.frameId ?? 0; // Default to 0 (main frame) if not available
      sendResponse({
        success: true,
        frameId: frameId,
      });
      return false;
    }

    // Handle START_RECORDING - coordinate multi-tab recording
    if (message.type === 'START_RECORDING') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id || !activeTab.url) {
            sendResponse({
              success: false,
              error: 'No active tab found',
            });
            return;
          }

          // Check if it's a restricted page
          if (activeTab.url.startsWith('chrome://') || 
              activeTab.url.startsWith('chrome-extension://') || 
              activeTab.url.startsWith('about:') ||
              activeTab.url.startsWith('edge://')) {
            sendResponse({
              success: false,
              error: `Content scripts cannot run on this page type: ${activeTab.url}`,
            });
            return;
          }

          // Generate session ID
          recordingSessionId = `recording-${Date.now()}`;
          
          // Initialize sessionTabMap with first tab as Index 0
          if (sessionTabMap.size === 0) {
            sessionTabMap.set(activeTab.id, 0); // The first tab is always Tab 0
          }
          
          // Start recording in active tab
          await startRecordingInTab(activeTab.id, activeTab.url, activeTab.title);
          lastActiveTabId = activeTab.id;
          
          // Store initial tab info
          const initialTabIndex = sessionTabMap.get(activeTab.id) ?? 0;
          lastRecordedTabUrl = activeTab.url;
          lastRecordedTabIndex = initialTabIndex;
          
          sendResponse({
            success: true,
            data: { message: 'Recording started', sessionId: recordingSessionId },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
        }
      })();
      return true; // Keep channel open for async
    }

    // Handle STOP_RECORDING - stop recording in all tabs
    if (message.type === 'STOP_RECORDING') {
      (async () => {
        try {
          const result = await stopRecordingInAllTabs();
          sendResponse({
            success: true,
            data: { 
              message: 'Recording stopped',
              initialFullPageSnapshot: result.initialFullPageSnapshot,
            },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to stop recording',
          });
        }
      })();
      return true; // Keep channel open for async
    }

    // Handle ADD_TAB - pause recording and open new tab
    if (message.type === 'ADD_TAB') {
      (async () => {
        try {
          // Pause recording in all tabs (without finalizing)
          await pauseRecordingInAllTabs();
          
          // Open new tab
          const newTab = await chrome.tabs.create({ url: 'chrome://newtab' });
          
          sendResponse({
            success: true,
            data: { message: 'Recording paused, new tab opened', tabId: newTab.id },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to add tab',
          });
        }
      })();
      return true; // Keep channel open for async
    }

    // Handle RESUME_RECORDING - resume recording in current tab
    if (message.type === 'RESUME_RECORDING') {
      (async () => {
        try {
          const resumeMessage = message as ResumeRecordingMessage;
          const { tabId, tabUrl, tabTitle } = resumeMessage.payload;
          
          // Assign logical index
          let toTabIndex: number;
          if (sessionTabMap.has(tabId)) {
            toTabIndex = sessionTabMap.get(tabId)!;
          } else {
            toTabIndex = sessionTabMap.size;
            sessionTabMap.set(tabId, toTabIndex);
          }
          
          // Get from tab info before updating lastActiveTabId
          const fromUrl = lastRecordedTabUrl || '';
          const fromTabIndex = lastRecordedTabIndex ?? null;
          
          // Get from title from tabUrlMap if available (before we update lastActiveTabId)
          let fromTitle: string | undefined;
          // Find the tab that matches lastRecordedTabUrl to get its title
          if (fromUrl) {
            for (const [, tabInfo] of tabUrlMap.entries()) {
              if (tabInfo.url === fromUrl) {
                fromTitle = tabInfo.title;
                break;
              }
            }
          }
          
          // Ensure content script is loaded and start recording
          await startRecordingInTab(tabId, tabUrl, tabTitle);
          
          // Update last active tab
          lastActiveTabId = tabId;
          
          // Create TAB_SWITCH step with logical indices
          const tabSwitchStep = {
            type: 'TAB_SWITCH' as const,
            payload: {
              fromUrl,
              toUrl: tabUrl,
              fromTitle,
              toTitle: tabTitle,
              fromTabIndex,
              toTabIndex,
              timestamp: Date.now(),
            },
            description: `Switch to tab ${toTabIndex}: ${tabTitle || tabUrl}`,
          };
          
          // Send TAB_SWITCHED message to sidepanel
          chrome.runtime.sendMessage({
            type: 'TAB_SWITCHED',
            payload: {
              fromUrl,
              toUrl: tabUrl,
              fromTitle,
              toTitle: tabTitle,
              timestamp: Date.now(),
            },
          } as TabSwitchedMessage).catch(() => {
            // Sidepanel might not be open, that's okay
          });
          
          // Broadcast the recorded step
          chrome.runtime.sendMessage({
            type: 'RECORDED_STEP',
            payload: {
              step: tabSwitchStep,
              tabUrl: tabUrl,
              tabTitle: tabTitle,
            },
          }).catch(() => {
            // Sidepanel might not be open, that's okay
          });
          
          sendResponse({
            success: true,
            data: { message: 'Recording resumed', tabIndex: toTabIndex },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to resume recording',
          });
        }
      })();
      return true; // Keep channel open for async
    }

    // Forward RECORDED_STEP messages from content scripts to sidepanel
    if (message.type === 'RECORDED_STEP' && sender.tab) {
      // Forward to sidepanel (if it's listening)
      chrome.runtime.sendMessage(message).catch(() => {
        // Sidepanel might not be open, that's okay
      });
      sendResponse({ success: true });
      return false;
    }

    // If message comes from content script, forward to sidepanel
    if (sender.tab) {
      // Message from content script - could forward to sidepanel if needed
      // For now, just acknowledge
      sendResponse({ success: true, data: message });
      return false;
    }

    // If message comes from sidepanel, forward to active tab's content script
    if (sender.id === chrome.runtime.id && !sender.tab) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, message, (response: MessageResponse) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: chrome.runtime.lastError.message,
              });
            } else {
              sendResponse(response || { success: true });
            }
          });
        } else {
          sendResponse({
            success: false,
            error: 'No active tab found',
          });
        }
      });
      return true; // Keep channel open for async response
    }

    return false;
  }
);

// Initialize on startup
async function initializeExtension() {
  try {
    // Explicitly disable popup to enable onClicked handler
    await chrome.action.setPopup({ popup: '' });
    console.log('Popup disabled, onClicked handler should work');
    
    // Set up side panel globally
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true,
    });
    console.log('Side panel configured');
  } catch (error) {
    console.error('Error initializing extension:', error);
  }
}

// Initialize immediately
initializeExtension();

// Extension installation/startup
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('GhostWriter extension installed');
  } else if (details.reason === 'update') {
    console.log('GhostWriter extension updated');
  }
  
  // Re-initialize on install/update
  initializeExtension();
});

// Open side panel directly when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked, opening side panel...');
  
  // Call open() synchronously to preserve user gesture context
  // Don't use async/await as it breaks the user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to open side panel:', chrome.runtime.lastError.message);
    } else {
      console.log('Side panel opened successfully');
    }
  });
});

// Listen for tab updates to track URL changes during recording
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Content script will be injected automatically via manifest
  if (changeInfo.status === 'complete' && tab.url) {
    console.log(`Tab ${tabId} loaded: ${tab.url}`);
    
    // Update URL map if this tab is being recorded
    if (activeRecordingTabs.has(tabId) && tab.url) {
      tabUrlMap.set(tabId, { url: tab.url, title: tab.title });
    }
  }
});

// Listen for tab activation to detect tab switches during recording
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Only auto-detect when actively recording (not paused)
  if (recordingSessionId && activeRecordingTabs.size > 0) {
    const newTabId = activeInfo.tabId;
    // windowId is available but not currently used - kept for future window management
    
    // Check if the newly activated tab is already being recorded
    if (!activeRecordingTabs.has(newTabId)) {
      try {
        const newTab = await chrome.tabs.get(newTabId);
        
        // Only start recording if it's not a restricted page
        if (newTab.url && 
            !newTab.url.startsWith('chrome://') && 
            !newTab.url.startsWith('chrome-extension://') && 
            !newTab.url.startsWith('about:') &&
            !newTab.url.startsWith('edge://')) {
          
          // Get the previous active tab's URL for TAB_SWITCH step
          let fromUrl = '';
          let fromTitle = '';
          if (lastActiveTabId && activeRecordingTabs.has(lastActiveTabId)) {
            const prevTabInfo = tabUrlMap.get(lastActiveTabId);
            if (prevTabInfo) {
              fromUrl = prevTabInfo.url;
              fromTitle = prevTabInfo.title || '';
            }
          }
          
          // Start recording in new tab
          await startRecordingInTab(newTabId, newTab.url, newTab.title);
          
          // Update last active tab
          lastActiveTabId = newTabId;
          
          // Create and send TAB_SWITCH step
          const tabSwitchStep = {
            type: 'TAB_SWITCH' as const,
            payload: {
              fromUrl,
              toUrl: newTab.url,
              fromTitle,
              toTitle: newTab.title,
              timestamp: Date.now(),
            },
            description: `Switch to tab: ${newTab.title || newTab.url}`,
          };
          
          // Send TAB_SWITCHED message to sidepanel
          chrome.runtime.sendMessage({
            type: 'TAB_SWITCHED',
            payload: {
              fromUrl,
              toUrl: newTab.url,
              fromTitle,
              toTitle: newTab.title,
              timestamp: Date.now(),
            },
          } as TabSwitchedMessage);
          
          // Broadcast the recorded step
          chrome.runtime.sendMessage({
            type: 'RECORDED_STEP',
            payload: {
              step: tabSwitchStep,
              tabUrl: newTab.url,
              tabTitle: newTab.title,
            },
          }).catch(() => {
            // Sidepanel might not be open, that's okay
          });
        }
      } catch (error) {
        console.warn(`Failed to handle tab switch to ${newTabId}:`, error);
      }
    }
  }
});

// Listen for tab removal to clean up tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeRecordingTabs.has(tabId)) {
    activeRecordingTabs.delete(tabId);
    tabUrlMap.delete(tabId);
    if (lastActiveTabId === tabId) {
      lastActiveTabId = null;
    }
    console.log(`Tab ${tabId} closed, removed from recording tracking`);
  }
});

