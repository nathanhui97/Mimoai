/**
 * Content Script for mimoai Extension
 * Runs on all URLs and handles DOM interaction recording/replay
 */

// IMMEDIATE LOG - This should appear if script loads at all
// Version identifier for debugging - update this when making significant changes
const EXTENSION_VERSION = 'v0.1.1-starting-page-validation';
const BUILD_TIMESTAMP = new Date().toISOString();
console.log(`🚀 mimoai: Content script loaded (${EXTENSION_VERSION}) - ${BUILD_TIMESTAMP}`);

// Dynamically detect build hash from script URL
try {
  const scripts = document.querySelectorAll('script[src*="content-script"]');
  if (scripts.length > 0) {
    const src = scripts[scripts.length - 1].getAttribute('src') || '';
    const hashMatch = src.match(/content-script\.ts-([A-Za-z0-9]+)\.js/);
    if (hashMatch) {
      console.log(`📦 Build hash: content-script.ts-${hashMatch[1]}.js`);
    }
  }
} catch (e) {
  // Fallback: try to get from chrome.runtime.getURL if available
  try {
    const url = chrome.runtime.getURL('assets/content-script.ts-loader-eLd2ZhJw.js');
    console.log(`📦 Loader script: ${url}`);
  } catch {}
}

// Set up message listener IMMEDIATELY, before any imports
// This ensures we can respond to PING even if imports fail
let isReady = false;
let recordingManager: any = null;
let currentFrameId: number = 0; // Will be set after initialization

// Export getCurrentFrameId for use by other modules
export function getCurrentFrameId(): number {
  return currentFrameId;
}

// Now do imports
import type { ExtensionMessage, MessageResponse, PongMessage } from '../types/messages';
import { RecordingManager } from './recording-manager';
import { AIWorkflowAnalyzer } from './ai-workflow-analyzer';
import { PatternDetector } from './pattern-detector';
import { AIDataBuilder } from './ai-data-builder';
import { VisualSnapshotService } from './visual-snapshot';
import { FeatureFlags } from '../lib/feature-flags';
import type { WorkflowStep } from '../types/workflow';
// import { isWorkflowStepPayload } from '../types/workflow'; // Unused after removing Universal Engine
// Universal Execution Engine - DEPRECATED (replaced by AI Agent with fast-path)
// import { executeWorkflow as executeUniversalWorkflow, convertLegacyStep } from './universal-execution';

// Request frameId from background script on initialization
(async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_FRAME_ID' });
    if (response && typeof response.frameId === 'number') {
      currentFrameId = response.frameId;
      console.log(`🖼️ GhostWriter: Frame ID set to ${currentFrameId} (0 = main frame)`);
    }
  } catch (error) {
    console.warn('GhostWriter: Could not get frameId from background:', error);
    // Default to 0 (main frame)
    currentFrameId = 0;
  }
})();

// ============================================================================
// Agent Auto-Resume System
// ============================================================================

// Track if agent is currently resuming to prevent duplicate resumptions
let isResumingAgent = false;

/**
 * Check for saved agent state and resume execution if needed
 * This is called both on page load AND when tab becomes visible
 */
async function checkAndResumeAgent(trigger: 'page_load' | 'tab_visible'): Promise<void> {
  try {
    // Prevent duplicate resumptions
    if (isResumingAgent) {
      console.log(`[Content] ⏭️ Agent already resuming, skipping ${trigger} trigger`);
      return;
    }
    
    // ONLY resume in main frame (frameId === 0) - not in iframes
    if (currentFrameId !== 0) {
      console.log('[Content] Skipping agent resumption in iframe (frameId:', currentFrameId, ')');
      return;
    }
    
    console.log(`[Content] 🔍 Checking for saved agent state (trigger: ${trigger})...`);
    const result = await chrome.storage.local.get(['agentState']);
    const savedState = result.agentState as any;
    
    if (savedState) {
      console.log('[Content] 📦 Found saved state:', {
        status: savedState.status,
        currentHintIndex: savedState.currentHintIndex,
        totalHints: savedState.hints?.length,
        transferredToTab: savedState.transferredToTab,
      });
    } else {
      console.log('[Content] ℹ️ No saved agent state found');
      return;
    }
    
    if (savedState && savedState.status === 'running') {
      // Set flag to prevent duplicate resumptions
      isResumingAgent = true;
      
      const transferType = savedState.transferredToTab ? 'tab switch' : 'navigation';
      console.log(`[Content] 🔄 Resuming agent after ${transferType} (trigger: ${trigger})`);
      console.log(`[Content] Current hint index: ${savedState.currentHintIndex}, Total hints: ${savedState.hints?.length}`);
      console.log(`[Content] Current frameId: ${currentFrameId}, URL: ${window.location.href}`);
      console.log(`[Content] Next hint:`, savedState.hints?.[savedState.currentHintIndex]?.description);
      
      // Small delay to ensure page is ready
      // Use shorter delay for tab_visible since page is already loaded
      const readyDelay = trigger === 'tab_visible' ? 500 : 1500;
      await new Promise(resolve => setTimeout(resolve, readyDelay));
      
      // CRITICAL: Double-check we're in the main frame
      if (currentFrameId !== 0) {
        console.error(`[Content] ❌ Agent state found but we're in iframe! frameId: ${currentFrameId}`);
        isResumingAgent = false;
        return;
      }
      
      // CRITICAL: Verify we're on a real page, not an iframe URL
      const currentUrl = window.location.href;
      if (currentUrl.includes('/offline/iframeapi') ||
          currentUrl.includes('RotateCookiesPage') ||
          currentUrl.includes('/_/og/bscframe')) {
        console.error(`[Content] ❌ Agent resume blocked - we're on an iframe URL: ${currentUrl}`);
        // Don't clear state - let the actual main frame resume
        isResumingAgent = false;
        return;
      }
      
      console.log('[Content] ✅ Confirmed in main frame on real page, creating agent...');
      console.log(`[Content] Current URL: ${currentUrl}`);
      
      // Dynamically import and resume
      const { AIAgent } = await import('../lib/ai-agent');
      const agent = new AIAgent({
        maxSteps: 50,
        stepTimeout: 30000,
        onProgress: (stepNumber, action, status) => {
          console.log(`[Content] Agent step ${stepNumber} - ${status}:`, action.type);
        },
      });
      
      console.log(`[Content] 🚀 Starting agent resumption...`);
      
      // Resume from saved state
      const agentResult = await agent.resume(savedState);
      
      // Clear saved state
      await chrome.storage.local.remove(['agentState']);
      
      // Notify completion
      chrome.runtime.sendMessage({
        type: 'AGENT_EXECUTION_COMPLETED',
        payload: agentResult,
      });
      
      console.log('[Content] Agent resumption complete:', agentResult);
      
      // Reset flag after completion
      isResumingAgent = false;
    }
  } catch (error) {
    console.error('[Content] Error resuming agent:', error);
    // Reset flag on error
    isResumingAgent = false;
  }
}

// Check for saved agent state after page load
(async () => {
  // Add a delay to let the page load first
  await new Promise(resolve => setTimeout(resolve, 500));
  await checkAndResumeAgent('page_load');
})();

// Listen for tab visibility changes (critical for tab switching!)
// When switching from Tab A → Tab B, Tab B becomes visible and should resume agent
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    console.log('[Content] 👀 Tab became visible, checking for agent state...');
    // Small delay to ensure tab is fully activated
    await new Promise(resolve => setTimeout(resolve, 200));
    await checkAndResumeAgent('tab_visible');
  }
});

// Full message handler with all message types
function handleFullMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean {
  try {
    switch (message.type) {
      case 'PING': {
        const pongResponse: PongMessage = {
          type: 'PONG',
          payload: {
            timestamp: Date.now(),
            ready: isReady,
          },
        };
        sendResponse({
          success: true,
          data: pongResponse,
        });
        return false;
      }

      case 'START_RECORDING': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized. Please wait a moment and try again.',
          });
          return false;
        }
        try {
          recordingManager.start();
          sendResponse({
            success: true,
            data: { message: 'Recording started' },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
        }
        return false;
      }

      case 'START_RECORDING_IN_TAB': {
        // Internal message from service worker to start recording in this tab
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized. Please wait a moment and try again.',
          });
          return false;
        }
        try {
          const tabIndex = message.payload?.tabIndex;
          recordingManager.start(tabIndex);
          sendResponse({
            success: true,
            data: { message: 'Recording started in tab' },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording in tab',
          });
        }
        return false;
      }

      case 'START_RECORDING_ALL_FRAMES': {
        // Broadcast message to start recording in all frames (including iframes)
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized. Please wait a moment and try again.',
          });
          return false;
        }
        try {
          recordingManager.start();
          console.log(`[Content] Recording started in frame ${currentFrameId}`);
          sendResponse({
            success: true,
            data: { message: `Recording started in frame ${currentFrameId}` },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start recording',
          });
        }
        return false;
      }

      case 'STOP_RECORDING_ALL_FRAMES': {
        // Broadcast message to stop recording in all frames (including iframes)
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        (async () => {
          try {
            await recordingManager.stop();
            console.log(`[Content] Recording stopped in frame ${currentFrameId}`);
            sendResponse({
              success: true,
              data: { message: `Recording stopped in frame ${currentFrameId}` },
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

      case 'STOP_RECORDING_IN_TAB': {
        // Internal message from service worker to stop recording in this tab
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        // Handle async stop() method
        (async () => {
          try {
            await recordingManager.stop();
            sendResponse({
              success: true,
              data: { message: 'Recording stopped in tab' },
            });
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to stop recording in tab',
            });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'STOP_RECORDING': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        // Handle async stop() method
        (async () => {
          try {
            await recordingManager.stop();
            // Include initial full page snapshot if available (for spreadsheet column headers)
            // Use async version to wait for capture to complete if still in progress
            const initialSnapshot = await recordingManager.getInitialFullPageSnapshotAsync();
            sendResponse({
              success: true,
              data: { 
                message: 'Recording stopped',
                initialFullPageSnapshot: initialSnapshot || undefined,
              },
            });
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to stop recording',
            });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'GET_INITIAL_SNAPSHOT': {
        if (!recordingManager) {
          sendResponse({
            success: false,
            error: 'RecordingManager not initialized',
          });
          return false;
        }
        const snapshot = recordingManager.getInitialFullPageSnapshot();
        sendResponse({
          success: true,
          data: { initialFullPageSnapshot: snapshot || null },
        });
        return false;
      }

      case 'REFRESH_PAGE': {
        // Check if current page is a spreadsheet domain
        const isSpreadsheet = VisualSnapshotService.isSpreadsheetDomain();
        
        if (!isSpreadsheet) {
          sendResponse({
            success: false,
            error: 'Refresh is only available for spreadsheet domains',
          });
          return false;
        }

        try {
          console.log('📸 GhostWriter: Refreshing page to capture headers...');
          
          // Set flag in sessionStorage to auto-start recording after refresh
          sessionStorage.setItem('ghostwriter_auto_start_recording', 'true');
          
          // If recording manager has a tab index, preserve it across refresh
          const currentTabIndex = (recordingManager as any)?.currentTabIndex;
          if (currentTabIndex !== undefined && currentTabIndex !== null) {
            sessionStorage.setItem('ghostwriter_tab_index', String(currentTabIndex));
            console.log('📸 GhostWriter: Preserving tab index across refresh:', currentTabIndex);
          }
          
          // Ensure scroll is at (0, 0) before refresh
          window.scrollTo(0, 0);
          
          // Small delay to ensure scroll completes, then refresh
          setTimeout(() => {
            window.location.reload();
          }, 100);
          
          // Send immediate response (page will reload, so async response won't work)
          sendResponse({
            success: true,
            data: { message: 'Page refresh initiated' },
          });
        } catch (error) {
          console.error('📸 GhostWriter: Refresh failed:', error);
          sessionStorage.removeItem('ghostwriter_auto_start_recording');
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to refresh page',
          });
        }
        
        return false;
      }

      case 'EXECUTE_STEP': {
        console.log('Execute step requested', message.payload);
        sendResponse({
          success: true,
          data: { message: 'Step executed (placeholder)' },
        });
        return false;
      }

      case 'ANALYZE_WORKFLOW': {
        if (!message.payload?.steps) {
          sendResponse({
            success: false,
            error: 'ANALYZE_WORKFLOW requires steps in payload',
          });
          return false;
        }

        // Analyze workflow asynchronously (if enabled)
        (async () => {
          try {
            const steps = message.payload.steps as WorkflowStep[];
            
            if (!FeatureFlags.AI_WORKFLOW_ANALYZER) {
              // Feature disabled - return basic pattern detection only
              console.log('GhostWriter: AI Workflow Analyzer disabled');
              const pattern = PatternDetector.detectPattern(steps);
              chrome.runtime.sendMessage({
                type: 'ANALYZE_WORKFLOW_RESPONSE',
                payload: { 
                  intent: {
                    description: 'Workflow recorded',
                    category: 'general',
                    subGoals: [],
                    expectedOutcome: 'Workflow completed',
                    confidence: 0.5,
                  },
                  pattern,
                },
              });
              return;
            }
            
            // Detect pattern first
            const pattern = PatternDetector.detectPattern(steps);
            
            // Analyze with AI
            const analyzer = new AIWorkflowAnalyzer();
            const intent = await analyzer.analyzeWorkflow(steps, pattern || undefined);
            
            // Send response back
            chrome.runtime.sendMessage({
              type: 'ANALYZE_WORKFLOW_RESPONSE',
              payload: { intent },
            });
          } catch (error) {
            console.error('GhostWriter: Error analyzing workflow:', error);
            chrome.runtime.sendMessage({
              type: 'ANALYZE_WORKFLOW_RESPONSE',
              payload: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        })();

        // Return immediately (async response will be sent separately)
        sendResponse({
          success: true,
          data: { message: 'Analysis started' },
        });
        return false;
      }

      // DEPRECATED: Universal Execution Engine replaced by AI Agent with fast-path
      // All execution now uses AI Agent mode (EXECUTE_WORKFLOW_AGENT)
      case 'EXECUTE_WORKFLOW':
      case 'EXECUTE_WORKFLOW_ADAPTIVE':
      case 'EXECUTE_WORKFLOW_VERIFIED':
      case 'EXECUTE_WORKFLOW_UNIVERSAL': {
        console.warn('[DEPRECATED] EXECUTE_WORKFLOW_UNIVERSAL is deprecated. Use EXECUTE_WORKFLOW_AGENT instead.');
        sendResponse({
          success: false,
          error: 'EXECUTE_WORKFLOW_UNIVERSAL is deprecated. Please use AI Agent mode (EXECUTE_WORKFLOW_AGENT).',
        });
        return false;
      }

      case 'VERIFIED_EXECUTION_CANCEL': {
        // Execution cancellation
        console.log('GhostWriter: Execution cancellation requested');
        sendResponse({ success: true });
        return false;
      }

      case 'EXECUTE_WORKFLOW_AGENT': {
        // AI Agent execution - observe-act loop
        // ⚠️ CRITICAL: Only run agent in the MAIN FRAME (frameId === 0)
        // If we run in iframes, we'll have multiple agents competing and looking at empty iframe content
        if (currentFrameId !== 0) {
          console.log(`[Content] Ignoring EXECUTE_WORKFLOW_AGENT in iframe (frameId: ${currentFrameId})`);
          // IMPORTANT: Don't call sendResponse() in iframes!
          // Chrome only accepts the first response, and if an iframe responds first,
          // the main frame's response will be ignored. By returning false without
          // responding, we let the main frame be the only responder.
          return false;
        }
        
        // Check if AI Agent is enabled
        if (!FeatureFlags.AI_AGENT_LOOP) {
          sendResponse({
            success: false,
            error: 'AI Agent execution is disabled. Use selector mode instead.',
          });
          return false;
        }
        
        if (!message.payload?.workflow) {
          sendResponse({
            success: false,
            error: 'EXECUTE_WORKFLOW_AGENT requires workflow in payload',
          });
          return false;
        }

        const workflow = message.payload.workflow;
        const variableValues = message.payload.variableValues as Record<string, string> || {};
        
        // Execute workflow with AI Agent
        // IMPORTANT: We send immediate response, then agent runs in background
        // This prevents navigation from closing the message channel
        (async () => {
          try {
            console.log('GhostWriter: Starting AI Agent execution for workflow:', workflow.id);
            
            // Dynamically import the AI Agent to avoid loading it when not needed
            const { AIAgent } = await import('../lib/ai-agent');
            
            // Create agent instance with progress callback
            const agent = new AIAgent({
              maxSteps: 50,
              stepTimeout: 30000,
              onProgress: (stepNumber, action, status) => {
                console.log(`GhostWriter: Agent step ${stepNumber} - ${status}:`, action.type);
              },
            });
            
            // Run the agent
            const result = await agent.run(workflow, variableValues);
            
            console.log('GhostWriter: Agent execution completed:', result);
            
            // Only send completion message if agent actually finished
            // Don't send if it transferred to another tab (still running)
            if (result.finalStatus !== 'running') {
              console.log('GhostWriter: Sending AGENT_EXECUTION_COMPLETED message');
              // Send final result via runtime message (not via sendResponse which would be closed)
              chrome.runtime.sendMessage({
                type: 'AGENT_EXECUTION_COMPLETED',
                payload: result,
              });
            } else {
              console.log('GhostWriter: Agent transferred to another tab - not sending completion message yet');
            }
            
          } catch (error) {
            console.error('GhostWriter: Error in AI Agent execution:', error);
            chrome.runtime.sendMessage({
              type: 'AGENT_EXECUTION_COMPLETED',
              payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        })();

        // Send immediate response - agent will run in background
        sendResponse({
          success: true,
          data: { message: 'AI Agent started in background' },
        });
        return false;
      }

      case 'GET_IFRAME_DOM_MAP': {
        // Request for DOM map from this iframe
        console.log(`[Content] Generating DOM map for frame ${currentFrameId}`);
        
        (async () => {
          try {
            const { generateDOMMap } = await import('./dom-map');
            const domMap = generateDOMMap();
            
            // Send response back via runtime message
            chrome.runtime.sendMessage({
              type: 'IFRAME_DOM_MAP_RESPONSE',
              payload: {
                frameId: currentFrameId,
                domMap,
              },
            });
            
            sendResponse({
              success: true,
              data: { message: 'DOM map generated' },
            });
          } catch (error) {
            console.error(`[Content] Error generating DOM map in frame ${currentFrameId}:`, error);
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to generate DOM map',
            });
          }
        })();
        
        return true; // Keep channel open for async
      }

      case 'EXECUTE_ACTION_IN_FRAME': {
        // Cross-frame execution - this frame should execute an action
        // This is called when the main frame agent needs to interact with an iframe element
        console.log(`[Content] Executing action in frame ${currentFrameId}:`, message.payload?.action);
        
        (async () => {
          try {
            const { Tier1Executor } = await import('../lib/tier1-executor');
            const action = message.payload?.action;
            
            if (!action) {
              throw new Error('No action provided for cross-frame execution');
            }
            
            // Execute the action in this frame
            const result = await Tier1Executor.execute(action);
            
            // Send result back to main frame via runtime message
            chrome.runtime.sendMessage({
              type: 'FRAME_ACTION_COMPLETED',
              payload: {
                frameId: currentFrameId,
                success: result.status === 'success',
                result,
              },
            });
            
          } catch (error) {
            console.error(`[Content] Error executing action in frame ${currentFrameId}:`, error);
            chrome.runtime.sendMessage({
              type: 'FRAME_ACTION_COMPLETED',
              payload: {
                frameId: currentFrameId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        })();
        
        sendResponse({ success: true, data: { message: 'Action execution started in frame' } });
        return false;
      }

      default: {
        sendResponse({
          success: false,
          error: `Unknown message type: ${(message as ExtensionMessage).type}`,
        });
        return false;
      }
    }
  } catch (error) {
    console.error('GhostWriter: Error in message handler:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

// Register the message listener (single handler that works for both early and full)
// We'll update handleMessage to use the full handler after imports
const messageListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
): boolean => {
  // Handle PING immediately (doesn't need imports)
  if (message?.type === 'PING') {
    try {
      sendResponse({
        success: true,
        data: {
          type: 'PONG',
          payload: {
            timestamp: Date.now(),
            ready: isReady,
          },
        },
      });
      return false;
    } catch (error) {
      console.error('GhostWriter: Error handling PING:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
  
  // For other messages, use the full handler (which will be available after imports)
  try {
    return handleFullMessage(message as ExtensionMessage, sender, sendResponse);
  } catch (error) {
    console.error('GhostWriter: Error in full handler:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
};

// Register the message listener
try {
  chrome.runtime.onMessage.addListener(messageListener);
  console.log('GhostWriter: Message listener registered');
} catch (error) {
  console.error('GhostWriter: Failed to register message listener:', error);
}

// Initialize recording manager with error handling
try {
  recordingManager = new RecordingManager();
  console.log('GhostWriter: RecordingManager initialized successfully');
  
  // Check if we should auto-start recording after page refresh
  const shouldAutoStart = sessionStorage.getItem('ghostwriter_auto_start_recording') === 'true';
  if (shouldAutoStart) {
    console.log('📸 GhostWriter: Auto-starting recording after page refresh');
    sessionStorage.removeItem('ghostwriter_auto_start_recording');
    
    // Retrieve tab index if it was stored before refresh
    const storedTabIndex = sessionStorage.getItem('ghostwriter_tab_index');
    const tabIndex = storedTabIndex !== null ? parseInt(storedTabIndex, 10) : undefined;
    if (tabIndex !== undefined) {
      console.log('📸 GhostWriter: Restored tab index from sessionStorage:', tabIndex);
      sessionStorage.removeItem('ghostwriter_tab_index');
    }
    
    // Wait for page to fully load and spreadsheet to render
    const startRecording = async () => {
      // Wait for page to be fully loaded
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve(undefined);
          } else {
            window.addEventListener('load', () => resolve(undefined), { once: true });
          }
        });
      }
      
      // Additional wait for spreadsheet to fully render
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Ensure scroll is at (0, 0) to guarantee header row is visible
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify scroll position
      const scrollY = window.scrollY || window.pageYOffset || 0;
      if (scrollY !== 0) {
        console.warn('📸 GhostWriter: Scroll position not at top after refresh, forcing scroll');
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      console.log('📸 GhostWriter: Page refreshed, scroll position:', { x: window.scrollX, y: window.scrollY });
      
      // Start recording locally with the preserved tab index
      if (recordingManager) {
        recordingManager.start(tabIndex);
        console.log('📸 GhostWriter: Recording started after refresh with tab index:', tabIndex);
      }
      
      // IMPORTANT: Now notify service worker to initialize the recording session
      // for multi-tab coordination. We do this AFTER recordingManager.start()
      // so that the initial snapshot capture happens first with the zoom logic.
      // Wait a bit to ensure the initial snapshot is captured
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        console.log('📸 GhostWriter: Notifying service worker to initialize session...');
        const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
        if (response?.success) {
          console.log('📸 GhostWriter: Service worker recording session initialized');
        } else {
          console.warn('📸 GhostWriter: Failed to initialize service worker session:', response?.error);
        }
      } catch (err) {
        console.error('📸 GhostWriter: Error initializing service worker session:', err);
      }
    };
    
    startRecording().catch((error) => {
      console.error('📸 GhostWriter: Failed to auto-start recording after refresh:', error);
    });
  }
  
  // DISABLED: Universal Execution Engine resumption logic
  // AI Agent mode uses chrome.storage.local for state persistence instead of sessionStorage
  // This sessionStorage-based resumption is no longer needed
  /*
  const pendingExecutionStr = sessionStorage.getItem('ghostwriter_pending_execution');
  if (pendingExecutionStr) {
    console.log('🚀 GhostWriter: Found pending workflow execution in sessionStorage, resuming...');
    console.log('⚠️ WARNING: This may be an OLD cached workflow! If you want to run a NEW workflow, run this in console: sessionStorage.clear()');
    sessionStorage.removeItem('ghostwriter_pending_execution');
    
    try {
      const pendingExecution = JSON.parse(pendingExecutionStr);
      const { steps, workflowId, variableValues } = pendingExecution;
      console.log(`🆔 Resuming workflow ID: ${workflowId} (${steps.length} steps)`);
      
      // Wait for page to be fully loaded before starting execution
      const startExecution = async () => {
        // Wait for page to be fully loaded
        if (document.readyState !== 'complete') {
          await new Promise(resolve => {
            if (document.readyState === 'complete') {
              resolve(undefined);
            } else {
              window.addEventListener('load', () => resolve(undefined), { once: true });
            }
          });
        }
        
        // Additional wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // CRITICAL: For Salesforce Lightning apps, wait for body to have proper dimensions
        // Lightning apps load dynamically and body might have zero height initially
        const isSalesforce = window.location.hostname.includes('force.com') || 
                            window.location.hostname.includes('salesforce.com');
        
        if (isSalesforce) {
          console.log('🚀 GhostWriter: Detected Salesforce Lightning, waiting for full render...');
          
          // CRITICAL: Salesforce Lightning uses a special layout where containers may have height: 0
          // Instead, wait for actual visible interactive elements to appear
          const maxWait = 20000; // Increased to 20 seconds for slow Lightning pages
          const startWait = Date.now();
          let appReady = false;
          
          // Helper to check if element is actually visible and has dimensions
          const isElementVisible = (el: Element): boolean => {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && 
                   rect.height > 0 && 
                   style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0';
          };
          
          while (Date.now() - startWait < maxWait) {
            // Strategy 1: Check for visible interactive elements anywhere on the page
            const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], [role="button"], a[href]'));
            const visibleButtons = allButtons.filter(isElementVisible);
            
            // Strategy 2: Check for Lightning spinners disappearing
            const spinners = document.querySelectorAll('lightning-spinner, .slds-spinner, [class*="spinner"]');
            const visibleSpinners = Array.from(spinners).filter(isElementVisible);
            
            // Strategy 3: Check for main content areas
            const mainContent = document.querySelector('main, [role="main"], .slds-scope, [class*="oneOne"]');
            const hasMainContent = mainContent && isElementVisible(mainContent);
            
            console.log('🚀 GhostWriter: Lightning check - Visible buttons:', visibleButtons.length, 
                       'Visible spinners:', visibleSpinners.length,
                       'Has main content:', hasMainContent);
            
            // Page is ready if:
            // 1. We have visible interactive elements, AND
            // 2. No visible spinners (or very few), AND
            // 3. Main content exists (optional - some pages might not have it)
            if (visibleButtons.length >= 3 && visibleSpinners.length === 0) {
              console.log('🚀 GhostWriter: Salesforce Lightning app fully loaded!');
              console.log('🚀 GhostWriter: Found', visibleButtons.length, 'visible interactive elements');
              appReady = true;
              break;
            }
            
            // Also check if we have at least some buttons even if spinners are present
            // (some pages have persistent spinners)
            if (visibleButtons.length >= 5) {
              console.log('🚀 GhostWriter: Found enough interactive elements, proceeding despite spinners');
              appReady = true;
              break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          if (!appReady) {
            console.warn('🚀 GhostWriter: Lightning app not fully ready after', (Date.now() - startWait) / 1000, 's wait');
            console.warn('🚀 GhostWriter: Proceeding anyway - page may still be loading');
          }
          
          // Additional wait for dynamic content to stabilize
          console.log('🚀 GhostWriter: Waiting additional 2s for dynamic content to stabilize...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Final check: Ensure we have at least some visible elements
          const finalCheck = Array.from(document.querySelectorAll('button, a, [role="button"]'))
            .filter(isElementVisible);
          
          if (finalCheck.length === 0) {
            console.warn('🚀 GhostWriter: ⚠️ No visible interactive elements found after wait!');
            console.warn('🚀 GhostWriter: Page may not be fully loaded, execution may fail');
          } else {
            console.log('🚀 GhostWriter: ✅ Found', finalCheck.length, 'visible interactive elements - ready for execution');
          }
          
          console.log('🚀 GhostWriter: Salesforce Lightning ready for execution');
        }
        
        console.log('🚀 GhostWriter: Starting pending workflow execution:', workflowId);
        
        // Notify execution started
        chrome.runtime.sendMessage({
          type: 'VERIFIED_EXECUTION_STARTED',
          payload: { workflowId },
        }).catch(err => console.error('Failed to send execution started message:', err));
        
        // Convert legacy steps to universal format
        const universalSteps = steps.map((step: WorkflowStep) => convertLegacyStep(step));
        
        // Execute with universal engine
        const result = await executeUniversalWorkflow(universalSteps, {
          stopOnFailure: true,
          stepTimeout: 10000,
          variableValues: variableValues || {},
          onStepProgress: (stepIndex, status) => {
            chrome.runtime.sendMessage({
              type: status === 'starting' ? 'VERIFIED_STEP_STARTED' :
                    status === 'completed' ? 'VERIFIED_STEP_COMPLETED' : 'VERIFIED_STEP_FAILED',
              payload: { stepIndex },
            }).catch(err => console.error('Failed to send step progress:', err));
          },
          onStepError: (stepIndex, error) => {
            console.error(`GhostWriter: Universal step ${stepIndex} error:`, error);
          },
        });
        
        // Notify execution completed
        chrome.runtime.sendMessage({
          type: 'VERIFIED_EXECUTION_COMPLETED',
          payload: {
            success: result.success,
            stepsExecuted: result.stepsCompleted,
            totalSteps: result.totalSteps,
            totalTimeMs: result.totalElapsedMs,
            error: result.success ? undefined : result.failureSummary,
          },
        }).catch(err => console.error('Failed to send execution completed message:', err));
      };
      
      startExecution().catch((error) => {
        console.error('🚀 GhostWriter: Failed to start pending execution:', error);
        chrome.runtime.sendMessage({
          type: 'VERIFIED_EXECUTION_COMPLETED',
          payload: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        }).catch(err => console.error('Failed to send error message:', err));
      });
    } catch (error) {
      console.error('🚀 GhostWriter: Failed to parse pending execution:', error);
      sessionStorage.removeItem('ghostwriter_pending_execution');
    }
  }
  */
} catch (error) {
  console.error('GhostWriter: Failed to initialize RecordingManager:', error);
  if (error instanceof Error) {
    console.error('GhostWriter: Error message:', error.message);
    console.error('GhostWriter: Error stack:', error.stack);
  }
}


// Initialize content script
function initialize() {
  try {
    isReady = true;
    console.log('GhostWriter: Content script loaded and ready');
    console.log('GhostWriter: Current URL:', window.location.href);
    console.log('GhostWriter: Message listener registered:', !!chrome.runtime.onMessage.hasListeners());
    console.log('GhostWriter: RecordingManager available:', !!recordingManager);
    console.log('GhostWriter: Document ready state:', document.readyState);
    console.log('GhostWriter: Body exists:', !!document.body);
    
    // Expose test function for Phase 1 testing (dev only)
    (window as any).testPhase1 = (steps: WorkflowStep[]) => {
      AIDataBuilder.testPhase1(steps);
    };
    console.log('GhostWriter: Phase 1 test function available: window.testPhase1(steps)');
    
    // Expose test function for snapshot testing (dev only)
    (window as any).testSnapshot = async (selector?: string) => {
      const element = selector 
        ? document.querySelector(selector)
        : document.body?.querySelector('button, a, input, [role="button"]') || document.body;
      
      if (!element) {
        console.error('📸 Test: No element found');
        return;
      }
      
      console.log('📸 Test: Testing snapshot capture on element:', element);
      console.log('📸 Test: Element bounds:', element.getBoundingClientRect());
      
      try {
        const result = await VisualSnapshotService.capture(element);
        if (result) {
          console.log('✅ Test: Snapshot captured successfully!');
          console.log('📸 Test: Viewport size:', result.viewport.length, 'chars');
          console.log('📸 Test: Element snippet size:', result.elementSnippet.length, 'chars');
          console.log('📸 Test: Viewport preview:', result.viewport.substring(0, 100) + '...');
          console.log('📸 Test: Snippet preview:', result.elementSnippet.substring(0, 100) + '...');
          
          // Create a test image to verify it works
          const img = document.createElement('img');
          img.src = result.elementSnippet;
          img.style.maxWidth = '300px';
          img.style.border = '2px solid green';
          img.style.margin = '10px';
          document.body.appendChild(img);
          console.log('📸 Test: Image element added to page for visual verification');
        } else {
          console.error('❌ Test: Snapshot returned null');
        }
      } catch (error) {
        console.error('❌ Test: Snapshot capture failed:', error);
      }
    };
    console.log('GhostWriter: Snapshot test function available: window.testSnapshot(selector?)');
    
    // Expose diagnostic function for dropdown debugging (dev only)
    (window as any).debugDropdowns = () => {
      console.log('🔍 GhostWriter: Dropdown Diagnostic Tool');
      console.log('====================================');
      
      // Find all dropdown containers
      const dropdownContainers = document.querySelectorAll('[role="listbox"], [role="menu"], [role="combobox"], select, [data-baseui="listbox"]');
      console.log(`Found ${dropdownContainers.length} dropdown container(s):`);
      
      dropdownContainers.forEach((container, idx) => {
        const containerInfo = {
          index: idx + 1,
          tag: container.tagName,
          role: container.getAttribute('role'),
          id: container.id,
          label: container.getAttribute('aria-label'),
          labelledBy: container.getAttribute('aria-labelledby'),
          expanded: container.getAttribute('aria-expanded'),
          visible: window.getComputedStyle(container as HTMLElement).display !== 'none',
          bounds: container.getBoundingClientRect(),
        };
        
        console.log(`\n📦 Dropdown ${idx + 1}:`, containerInfo);
        
        // Find all options within this container
        const options = container.querySelectorAll('[role="option"], option, li');
        console.log(`   Found ${options.length} option(s):`);
        
        options.forEach((option, optIdx) => {
          const optionInfo = {
            index: optIdx + 1,
            tag: option.tagName,
            role: option.getAttribute('role'),
            text: (option as HTMLElement).textContent?.trim().substring(0, 50),
            value: (option as HTMLOptionElement).value || option.getAttribute('data-value'),
            selected: option.getAttribute('aria-selected') || (option as HTMLOptionElement).selected,
            visible: window.getComputedStyle(option as HTMLElement).display !== 'none',
          };
          console.log(`   ${optIdx + 1}.`, optionInfo);
        });
      });
      
      // Find all combobox triggers
      const triggers = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]');
      console.log(`\n\n🎯 Found ${triggers.length} dropdown trigger(s):`);
      
      triggers.forEach((trigger, idx) => {
        const triggerInfo = {
          index: idx + 1,
          tag: trigger.tagName,
          role: trigger.getAttribute('role'),
          text: (trigger as HTMLElement).textContent?.trim().substring(0, 50),
          controls: trigger.getAttribute('aria-controls'),
          expanded: trigger.getAttribute('aria-expanded'),
          hasPopup: trigger.getAttribute('aria-haspopup'),
          visible: window.getComputedStyle(trigger as HTMLElement).display !== 'none',
        };
        console.log(`${idx + 1}.`, triggerInfo);
      });
      
      console.log('\n====================================');
      console.log('💡 Tip: Click on a dropdown and run this again to see what changes');
    };
    console.log('GhostWriter: Dropdown diagnostic function available: window.debugDropdowns()');
    
    // Expose cache clearing utility for AI Visual Click debugging
    (window as any).clearAICache = async () => {
      try {
        const all = await chrome.storage.local.get(null);
        const aiKeys = Object.keys(all).filter(key => key.startsWith('ai_cache_'));
        console.log('🧹 GhostWriter: Found', aiKeys.length, 'AI cache entries');
        
        if (aiKeys.length > 0) {
          await chrome.storage.local.remove(aiKeys);
          console.log('✅ GhostWriter: Cleared', aiKeys.length, 'AI cache entries');
        } else {
          console.log('ℹ️ GhostWriter: No AI cache entries found');
        }
        
        console.log('✅ GhostWriter: Cache cleared! Reload the page to test with fresh AI calls.');
        return { success: true, cleared: aiKeys.length };
      } catch (error) {
        console.error('❌ GhostWriter: Error clearing cache:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    };
    console.log('GhostWriter: Cache clearing function available: window.clearAICache()');
  } catch (error) {
    console.error('GhostWriter: Error initializing content script:', error);
    if (error instanceof Error) {
      console.error('GhostWriter: Error stack:', error.stack);
    }
  }
}

// Initialize immediately with error handling
try {
  initialize();
} catch (error) {
  console.error('GhostWriter: Failed to initialize content script:', error);
  if (error instanceof Error) {
    console.error('GhostWriter: Error stack:', error.stack);
  }
  // Still mark as ready so ping can work
  isReady = true;
}

// Inject a marker to identify that content script is loaded
if (document.body) {
  document.body.setAttribute('data-ghostwriter-ready', 'true');
} else {
  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', () => {
    document.body?.setAttribute('data-ghostwriter-ready', 'true');
  });
}

