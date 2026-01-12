import { useEffect, useState } from 'react';
import { useExtensionStore } from '../lib/store';
import { runtimeBridge } from '../lib/bridge';
import { WorkflowStorage } from '../lib/storage';
import { CorrectionMemory } from '../lib/correction-memory';
import { VariableDetector } from '../lib/variable-detector';
// import { NavigationOptimizer } from '../lib/navigation-optimizer'; // DISABLED - breaks AI Agent workflows
import { IntentAnalyzer } from '../lib/intent-analyzer';
import { SiteKnowledgeBase } from '../lib/site-knowledge';
import { VariableInputForm } from './VariableInputForm';
import { ScreenshotModal } from './ScreenshotModal';
import { SettingsPanel } from './SettingsPanel';
import { ThinkingPanel } from './ThinkingPanel';
import { OpenWorkWindowButton } from './OpenWorkWindowButton';
import { FeatureFlags } from '../lib/feature-flags';
import { VersionChecker, EXTENSION_VERSION } from '../lib/version-checker';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { AgentAction } from '../lib/ai-agent';
import type { 
  RecordedStepMessage, 
  UpdateStepMessage,
  AIValidationStartedMessage,
  AIValidationCompletedMessage,
  StepEnhancedMessage,
  CorrectionSavedMessage,
  ElementFindFailedMessage,
  ThinkingEvent
} from '../types/messages';
import type { CorrectionEntry } from '../types/visual';

function App() {
  const { 
    state, 
    workflowSteps,
    savedWorkflows,
    isRecording,
    setState,
    setConnectionStatus,
    setError,
    setLastPingTime,
    clearWorkflowSteps,
    setSavedWorkflows,
    addSavedWorkflow,
    setCurrentWorkflowName,
    setIsRecording,
  } = useExtensionStore();

  const [_isPinging, setIsPinging] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [pendingTabId, setPendingTabId] = useState<number | null>(null);
  const [_isPaused, setIsPaused] = useState(false);
  const [tabSwitchToast, setTabSwitchToast] = useState<{ title: string; tabIndex: number; totalTabs: number } | null>(null);
  // Correction learning state
  const [showCorrections, setShowCorrections] = useState(false);
  const [storedCorrections, setStoredCorrections] = useState<CorrectionEntry[]>([]);
  const [correctionModeStep, setCorrectionModeStep] = useState<string | null>(null);
  const [learningFeedback, setLearningFeedback] = useState<string | null>(null);
  // Variable detection state
  const [isDetectingVariables, setIsDetectingVariables] = useState(false);
  // Recording finalization state (flushing pending steps)
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [currentWorkflowVariables, setCurrentWorkflowVariables] = useState<import('../lib/variable-detector').WorkflowVariables | null>(null);
  // Variable form modal state
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [pendingExecution, setPendingExecution] = useState<{
    workflow: SavedWorkflow | null;
    steps: WorkflowStep[];
  }>({ workflow: null, steps: [] });
  const [isExecuting, setIsExecuting] = useState(false);
  // Screenshot modal state
  const [screenshotModalStep, setScreenshotModalStep] = useState<{ step: WorkflowStep; index: number } | null>(null);
  // UI simplification state
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [_workflowMenu, _setWorkflowMenu] = useState<string | null>(null);
  
  // AI Agent execution state
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [_agentProgress, setAgentProgress] = useState<{
    stepNumber: number;
    action: AgentAction | null;
    status: 'thinking' | 'acting' | 'completed' | 'failed';
  } | null>(null);
  const [_agentLog, setAgentLog] = useState<Array<{
    time: string;
    action: string;
    status: 'success' | 'failed' | 'info';
    reasoning?: string;
  }>>([]);
  
  // Chain of thought state
  const [thinkingEvents, setThinkingEvents] = useState<ThinkingEvent[]>([]);
  const [currentStep, setCurrentStep] = useState<{index: number; total: number}>({index: 0, total: 0});
  
  // Centralized execution state (from service worker)
  const [executionSession, setExecutionSession] = useState<any>(null);
  
  // Real-time intent inference (during recording)
  const [realtimeIntent, setRealtimeIntent] = useState<{
    likelyGoal: string;
    confidence: number;
    suggestedName: string;
  } | null>(null);

  // Ping content script on mount
  useEffect(() => {
    const performPing = async () => {
      setIsPinging(true);
      setConnectionStatus('connecting');
      setState('CONNECTING');
      setError(null);

      try {
        // Check what page we're on first
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentUrl = tab?.url || 'unknown';
        
        // Check if it's a restricted page
        if (currentUrl.startsWith('chrome://') || 
            currentUrl.startsWith('chrome-extension://') || 
            currentUrl.startsWith('about:') ||
            currentUrl.startsWith('edge://')) {
          setConnectionStatus('error');
          setState('IDLE');
          setError(`Content scripts cannot run on this page type: ${currentUrl}. Please navigate to a regular website (like google.com).`);
          setIsPinging(false);
          return;
        }

        const isReady = await runtimeBridge.ping();
        if (isReady) {
          setConnectionStatus('connected');
          setState('IDLE');
          setLastPingTime(Date.now());
        } else {
          setConnectionStatus('error');
          setState('IDLE'); // Make sure to set state to IDLE even on failure
          setError(`Content script not ready on ${currentUrl}. Try refreshing the page.`);
        }
      } catch (err) {
        console.error('Ping error:', err);
        setConnectionStatus('error');
        setState('IDLE'); // Make sure to set state to IDLE on error
        const errorMsg = err instanceof Error ? err.message : 'Failed to connect';
        setError(`${errorMsg}. Make sure you are on a regular web page and the extension is reloaded.`);
      } finally {
        setIsPinging(false);
      }
    };

    performPing();
  }, [setState, setConnectionStatus, setError, setLastPingTime]);

  // Real-time intent inference during recording
  useEffect(() => {
    if (isRecording && workflowSteps.length > 0) {
      try {
        const intent = IntentAnalyzer.analyzeIntentLocally(workflowSteps);
        setRealtimeIntent({
          likelyGoal: intent.primaryGoal,
          confidence: intent.confidence,
          suggestedName: intent.primaryGoal.split(' ').slice(0, 4).join(' '), // Simplified suggested name
        });
      } catch (error) {
        console.warn('Failed to analyze intent in real-time:', error);
      }
    } else {
      setRealtimeIntent(null);
    }
  }, [isRecording, workflowSteps]);

  // Load saved workflows on mount
  useEffect(() => {
    const loadSavedWorkflows = async () => {
      try {
        const workflows = await WorkflowStorage.loadWorkflows();
        setSavedWorkflows(workflows);
      } catch (err) {
        console.error('Error loading saved workflows:', err);
      }
    };

    loadSavedWorkflows();
  }, [setSavedWorkflows]);

  // Debug: Log when currentWorkflowVariables changes
  useEffect(() => {
    console.log('[App] currentWorkflowVariables changed:', currentWorkflowVariables);
    if (currentWorkflowVariables) {
      console.log('[App] Variables count:', currentWorkflowVariables.variables?.length || 0);
      console.log('[App] Variables:', currentWorkflowVariables.variables);
    }
  }, [currentWorkflowVariables]);

  // Subscribe to centralized execution state from service worker
  useEffect(() => {
    const handleExecutionStateChange = (message: any) => {
      if (message.type === 'EXECUTION_STATE_CHANGED') {
        const session = message.session;
        console.log('[App] 🔄 Execution state changed:', {
          hasSession: !!session,
          sessionId: session?.id,
          status: session?.status,
          workflowName: session?.workflowName,
          currentStep: session?.currentStepIndex,
          totalSteps: session?.totalSteps,
          hasSteps: !!session?.workflowSteps,
          stepsCount: session?.workflowSteps?.length,
          pauseReason: session?.pauseReason,
          hasHelpContext: !!session?.humanHelpContext,
        });
        
        // CRITICAL: Always set the session, even if null (to clear old state)
        setExecutionSession(session);
        
        // If session is paused/stopped, make sure we show it
        if (session && (session.status === 'paused' || session.status === 'stopped' || session.status === 'waiting_for_human')) {
          console.log('[App] 🎯 Session is paused/stopped - UI should show Resume button');
          console.log('[App] 🎯 isStopped will be:', session.status === 'paused' || session.status === 'stopped' || session.status === 'waiting_for_human');
        }
      }
    };
    
    chrome.runtime.onMessage.addListener(handleExecutionStateChange);
    
    // Fetch current execution state on mount (handles sidepanel reopen)
    console.log('[App] 🔍 Fetching execution state on mount...');
    chrome.runtime.sendMessage({ type: 'GET_EXECUTION_STATE' })
      .then((response) => {
        console.log('[App] 📥 GET_EXECUTION_STATE response:', {
          success: response.success,
          hasData: !!response.data,
          hasSession: !!response.data?.session,
          sessionStatus: response.data?.session?.status,
          sessionId: response.data?.session?.id,
        });
        
        if (response.success && response.data?.session) {
          const session = response.data.session;
          console.log('[App] ✅ Restored execution session:', {
            id: session.id,
            status: session.status,
            workflowName: session.workflowName,
            currentStep: session.currentStepIndex,
            totalSteps: session.totalSteps,
            stepsCount: session.workflowSteps?.length,
            pauseReason: session.pauseReason,
          });
          setExecutionSession(session);
        } else {
          console.log('[App] ℹ️ No execution session to restore (response.data?.session is null)');
          setExecutionSession(null);
        }
      })
      .catch(err => console.warn('[App] ❌ Failed to fetch execution state:', err));
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleExecutionStateChange);
    };
  }, []);

  // Listen for RECORDED_STEP, UPDATE_STEP, AI validation, and agent messages from content script
  // Note: Empty dependency array ensures listener is only registered once on mount
  useEffect(() => {
    const handleMessage = (
      message: RecordedStepMessage | UpdateStepMessage | AIValidationStartedMessage | AIValidationCompletedMessage | StepEnhancedMessage | CorrectionSavedMessage | ElementFindFailedMessage | any,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: any) => void
    ) => {
      if (message.type === 'AGENT_EXECUTION_COMPLETED' && message.payload) {
        // AI Agent finished executing
        const result = message.payload;
        console.log('[App] Agent execution completed:', {
          finalStatus: result.finalStatus,
          success: result.success,
          stepsCompleted: result.stepsCompleted,
          totalSteps: result.totalSteps,
        });
        
        // Update UI state only - execution session is managed by service worker
        setIsAgentRunning(false);
        setIsExecuting(false);
        setState('IDLE');
        setAgentProgress(null);
        
        setAgentLog(prev => [...prev, {
          time: new Date().toLocaleTimeString(),
          action: `Completed: ${result.stepsCompleted}/${result.totalSteps} steps`,
          status: result.success ? 'success' : 'failed',
          reasoning: result.error,
        }]);
        
        // Set appropriate feedback based on final status
        if (result.finalStatus === 'stopped' || result.finalStatus === 'paused') {
          setLearningFeedback('⏸️ Execution paused - click Resume to continue');
        } else if (result.success) {
          setLearningFeedback('✓ AI Agent completed workflow successfully');
          // Clear thinking events after successful completion
          setTimeout(() => {
            setThinkingEvents([]);
            setCurrentStep({index: 0, total: 0});
          }, 3000);
        } else {
          setLearningFeedback(`⚠️ AI Agent: ${result.stepsCompleted}/${result.totalSteps} steps completed`);
          // Clear thinking events after failure
          setTimeout(() => {
            setThinkingEvents([]);
            setCurrentStep({index: 0, total: 0});
          }, 3000);
        }
        
        setTimeout(() => setLearningFeedback(null), 5000);
      } else if (message.type === 'AGENT_THINKING' && message.payload) {
        // AI Agent thinking event - update chain of thought
        const event = message.payload as ThinkingEvent;
        setThinkingEvents(prev => [...prev, event]);
        setCurrentStep({
          index: event.stepIndex,
          total: event.stepTotal,
        });
      } else if (message.type === 'RECORDED_STEP' && message.payload?.step) {
        const receivedStep = message.payload.step;
        console.log('[App] 📨 Received RECORDED_STEP message:', {
          type: receivedStep.type,
          hasPayload: !!receivedStep.payload,
          hasContext: !!(receivedStep.payload as any)?.context,
          hasDecisionSpace: !!(receivedStep.payload as any)?.context?.decisionSpace,
          decisionSpaceOptions: (receivedStep.payload as any)?.context?.decisionSpace?.options?.length || 0,
        });
        
        // Use the store actions directly instead of from hook to avoid stale closures
        useExtensionStore.getState().addWorkflowStep(receivedStep);
        
        // Track tab metadata
        const tabIndex = message.payload.tabIndex;
        const tabUrl = message.payload.tabUrl;
        const tabTitle = message.payload.tabTitle;
        if (tabIndex !== undefined && tabUrl && tabTitle) {
          useExtensionStore.getState().addRecordedTab(tabIndex, tabUrl, tabTitle);
          useExtensionStore.getState().incrementTabStepCount(tabIndex);
        }
      } else if (message.type === 'TAB_SWITCHED' && message.payload) {
        // Tab switch detected - show toast notification
        const { toUrl, toTitle, toTabIndex } = message.payload;
        if (toTabIndex !== undefined) {
          const totalTabs = useExtensionStore.getState().recordedTabs.size;
          setTabSwitchToast({
            title: toTitle || toUrl || 'New Tab',
            tabIndex: toTabIndex,
            totalTabs: totalTabs + 1, // +1 because we're adding this tab
          });
          // Auto-hide toast after 3 seconds
          setTimeout(() => setTabSwitchToast(null), 3000);
        }
      } else if (message.type === 'UPDATE_STEP' && message.payload?.stepId && message.payload?.step) {
        useExtensionStore.getState().updateWorkflowStep(message.payload.stepId, message.payload.step);
        // Mark as enhanced when step is updated with AI suggestions
        if (isWorkflowStepPayload(message.payload.step.payload) && (message.payload.step.payload.fallbackSelectors?.length ?? 0) > 0) {
          useExtensionStore.getState().setStepEnhanced(message.payload.stepId);
        }
      } else if (message.type === 'AI_VALIDATION_STARTED' && message.payload?.stepId) {
        useExtensionStore.getState().setAIValuationPending(message.payload.stepId, true);
      } else if (message.type === 'AI_VALIDATION_COMPLETED' && message.payload?.stepId) {
        useExtensionStore.getState().setAIValuationPending(message.payload.stepId, false);
        if (message.payload.enhanced) {
          useExtensionStore.getState().setStepEnhanced(message.payload.stepId);
        }
      } else if (message.type === 'STEP_ENHANCED' && message.payload?.stepId) {
        useExtensionStore.getState().setAIValuationPending(message.payload.stepId, false);
        useExtensionStore.getState().setStepEnhanced(message.payload.stepId);
      } else if (message.type === 'CORRECTION_SAVED') {
        setCorrectionModeStep(null);
        setLearningFeedback('✓ Correction saved! The extension will learn from this.');
        setTimeout(() => setLearningFeedback(null), 3000);
        // Refresh corrections list
        CorrectionMemory.getAllCorrections().then(setStoredCorrections);
      } else if (message.type === 'ELEMENT_FIND_FAILED' && message.payload?.stepId) {
        // Show correction option when element finding fails
        setCorrectionModeStep(message.payload.stepId);
      }
      return false;
    };

    // Listen for messages from content script
    console.log('[App] Registering message listener');
    chrome.runtime.onMessage.addListener(handleMessage);

    // Cleanup listener on unmount
    return () => {
      console.log('[App] Removing message listener');
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []); // Empty deps array - listener registered only once on mount

  // Helper function to check if current page is a spreadsheet domain
  const isSpreadsheetDomain = (url: string): boolean => {
    const urlLower = url.toLowerCase();
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Google Sheets
    if (hostname.includes('docs.google.com') && urlLower.includes('/spreadsheets')) {
      return true;
    }
    
    // Excel Online / Office 365
    if (hostname.includes('office.com') || 
        hostname.includes('excel.office.com') || 
        hostname.includes('onedrive.live.com') ||
        hostname.includes('office365.com')) {
      return true;
    }
    
    return false;
  };

  // Handler to clear extension caches
  const handleClearCache = async () => {
    try {
      console.log('[App] Clearing extension caches...');
      const result = await VersionChecker.clearAllCaches();
      
      if (result.success) {
        const feedbackMsg = `✅ Caches cleared: ${result.cleared.join(', ')}`;
        setLearningFeedback(feedbackMsg);
        console.log('[App] ✅ Caches cleared:', result.cleared);
        
        // Show feedback for 5 seconds
        setTimeout(() => {
          setLearningFeedback(null);
        }, 5000);
      } else {
        console.error('[App] Failed to clear caches');
        setError('Failed to clear caches');
      }
    } catch (err) {
      console.error('[App] Error clearing caches:', err);
      setError('Error clearing caches: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Expose clear cache function globally for console debugging
  useEffect(() => {
    (window as any).clearExtensionCache = handleClearCache;
    console.log('[App] 💡 clearExtensionCache() available in console');
    console.log('[App] 📦 Extension version:', EXTENSION_VERSION);
    
    // Check version on sidepanel load
    VersionChecker.checkVersion('sidepanel').catch(err => {
      console.error('[App] Failed to check sidepanel version:', err);
    });
    
    return () => {
      delete (window as any).clearExtensionCache;
    };
  }, []);

  const handleStartRecording = async () => {
    try {
      clearWorkflowSteps();
      setCurrentWorkflowName(null);
      setCurrentWorkflowVariables(null); // Clear variables when starting new recording
      setIsDetectingVariables(false); // Reset detection state
      
      // Get the active tab to check domain
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }
      
      // CRITICAL: Check if content script is responsive before starting recording
      // This prevents the "extension context invalidated" zombie script issue
      console.log('[App] Checking if content script is responsive...');
      const isContentScriptAlive = await runtimeBridge.ping(tab.id);
      
      if (!isContentScriptAlive) {
        console.warn('[App] Content script not responsive - triggering page refresh');
        // Content script is dead/invalid - refresh the page to reinitialize it
        setPendingTabId(tab.id);
        setShowRefreshDialog(true);
        return; // Exit early, dialog will handle the rest
      }
      
      console.log('[App] Content script is responsive ✅');
      
      // Check if it's a spreadsheet domain
      const isSpreadsheet = isSpreadsheetDomain(tab.url);
      
      if (isSpreadsheet) {
        // For spreadsheets, always refresh to capture clean column headers
        // (even if content script is alive, we want a fresh start for header detection)
        setPendingTabId(tab.id);
        setShowRefreshDialog(true);
      } else {
        // For non-spreadsheet pages, start recording through service worker (for multi-tab coordination)
        setIsRecording(true);
        setState('RECORDING');
        
        // Send to service worker, which will coordinate starting recording in active tab
        const response = await runtimeBridge.sendMessage({
          type: 'START_RECORDING',
        });
        
        if (!response.success) {
          throw new Error(response.error || 'Failed to start recording');
        }
      }
    } catch (err) {
      console.error('Start recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording. Make sure you are on a regular web page.');
      setIsRecording(false);
      setState('IDLE');
    }
  };

  const handleRefreshConfirm = async () => {
    if (!pendingTabId) {
      setShowRefreshDialog(false);
      return;
    }
    
    try {
      setShowRefreshDialog(false);
      
      // Send REFRESH_PAGE message
      // Note: Page will refresh, so we won't get a response back
      // The content script will auto-start recording after refresh using sessionStorage flag
      // and will notify the service worker to initialize the recording session
      await runtimeBridge.sendMessage(
        {
          type: 'REFRESH_PAGE',
        },
        pendingTabId
      );
      
      // Optimistically update UI - page will refresh and recording will auto-start
      setIsRecording(true);
      setState('RECORDING');
      setPendingTabId(null);
      
      // Wait a moment and verify recording actually started
      setTimeout(async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const pingResponse = await runtimeBridge.ping(tab.id);
            if (!pingResponse) {
              // Page might still be loading, that's okay
              console.log('📸 GhostWriter: Page may still be loading after refresh');
            }
          }
        } catch (err) {
          // Ignore errors - page is refreshing
          console.log('📸 GhostWriter: Page is refreshing, will auto-start recording');
        }
      }, 1000);
    } catch (err) {
      console.error('Refresh error:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh page');
      setIsRecording(false);
      setState('IDLE');
      setPendingTabId(null);
    }
  };

  const handleRefreshCancel = () => {
    setShowRefreshDialog(false);
    setPendingTabId(null);
    setIsRecording(false);
    setIsPaused(false);
    setState('IDLE');
  };

  const handleStopRecording = async () => {
    console.log('[App] handleStopRecording called, workflowSteps.length:', workflowSteps.length);
    try {
      // Show "finishing up" feedback immediately - this lets users know we're capturing final steps
      setIsFinalizingRecording(true);
      setLearningFeedback('⏳ Finishing up - capturing pending steps...');
      
      setIsRecording(false);
      setIsPaused(false);
      setState('IDLE');
      
      // Send to service worker, which will stop recording in all active tabs
      // This now flushes pending debounced steps before stopping
      console.log('[App] Sending STOP_RECORDING message to service worker');
      const response = await runtimeBridge.sendMessage({
        type: 'STOP_RECORDING',
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to stop recording');
      }
      console.log('[App] STOP_RECORDING message sent successfully');
      
      // Update feedback to show recording stopped
      setLearningFeedback('✅ Recording stopped - processing steps...');
      setIsFinalizingRecording(false);
      
      // Get initial full page snapshot from response if available
      // Note: This may not be available when stopping multi-tab recording
      // We'll need to collect snapshots from all tabs if needed

      // Get initial full page snapshot from response (captured at recording start for spreadsheet headers)
      const initialFullPageSnapshot = response.data?.initialFullPageSnapshot || null;
      console.log('[App] Initial snapshot check:', {
        hasResponseData: !!response.data,
        hasSnapshot: !!initialFullPageSnapshot,
        snapshotLength: initialFullPageSnapshot?.length,
      });
      if (initialFullPageSnapshot) {
        console.log('[App] ✅ Received initial full page snapshot for spreadsheet column header detection');
      } else {
        console.log('[App] ⚠️ No initial full page snapshot received');
      }

      // Detect variables immediately after recording stops
      // Use a small delay to ensure workflowSteps state is updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get current workflow steps (might have been updated by RECORDED_STEP messages)
      const currentSteps = workflowSteps.length > 0 ? workflowSteps : [];
      
      console.log('[App] Checking for variable detection:', {
        workflowStepsLength: workflowSteps.length,
        currentStepsLength: currentSteps.length,
        willDetect: currentSteps.length > 0,
        hasInitialSnapshot: !!initialFullPageSnapshot,
      });
      
      if (currentSteps.length > 0) {
        console.log('[App] ✅ Starting variable detection for', currentSteps.length, 'steps');
        console.log('[App] Step types:', currentSteps.map(s => ({ 
          type: s.type, 
          hasValue: isWorkflowStepPayload(s.payload) ? !!s.payload.value : false,
          hasLabel: isWorkflowStepPayload(s.payload) ? !!s.payload.label : false,
          hasSnapshot: isWorkflowStepPayload(s.payload) ? !!(s.payload.visualSnapshot?.viewport || s.payload.visualSnapshot?.elementSnippet) : false
        })));
        
        // Show loading state immediately
        setIsDetectingVariables(true);
        setLearningFeedback('🔍 Analyzing workflow steps for variables...');
        
        try {
          // For spreadsheets, use cell references as variable names (users can rename in UI)
          // This is more reliable than trying to detect headers programmatically
          console.log('[App] 📊 Spreadsheet variable detection will use cell references as default names');
          
          // Use simplified variable detection (no AI needed)
          console.log('[App] Calling simplified VariableDetector.detectVariablesSimplified...');
          const variables = VariableDetector.detectVariablesSimplified(currentSteps);
          console.log('[App] ✅ Simplified variable detection completed:', {
            totalVariables: variables.variables.length,
            analysisCount: variables.analysisCount,
            variables: variables.variables.map(v => ({
              fieldName: v.fieldName,
              variableName: v.variableName,
              isVariable: v.isVariable,
              confidence: v.confidence,
            })),
          });
          
          // Store variables for display (even if empty, so UI shows the section)
          setCurrentWorkflowVariables(variables);
          
          if (variables.variables.length > 0) {
            setLearningFeedback(`✨ Detected ${variables.variables.length} variable${variables.variables.length > 1 ? 's' : ''} in recorded workflow`);
            setTimeout(() => setLearningFeedback(null), 4000);
          } else {
            console.log('[App] ⚠️ No variables detected. Analysis count:', variables.analysisCount);
            if (variables.analysisCount === 0) {
              setLearningFeedback('ℹ️ No steps were analyzed for variables. Make sure INPUT steps have values.');
              setTimeout(() => setLearningFeedback(null), 3000);
            } else {
              setLearningFeedback('ℹ️ AI analyzed steps but didn\'t detect any variables.');
              setTimeout(() => setLearningFeedback(null), 3000);
            }
          }
        } catch (err) {
          console.error('[App] ❌ Error detecting variables:', err);
          console.error('[App] Error stack:', err instanceof Error ? err.stack : 'No stack');
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          setError(`Variable detection failed: ${errorMessage}`);
          setLearningFeedback(`❌ Variable detection failed: ${errorMessage}`);
          setTimeout(() => setLearningFeedback(null), 5000);
          // Still set empty variables so UI shows the section
          setCurrentWorkflowVariables({
            variables: [],
            detectedAt: Date.now(),
            analysisCount: 0,
          });
        } finally {
          setIsDetectingVariables(false);
          console.log('[App] Variable detection finished, isDetectingVariables set to false');
        }
        
        // Note: Step translations now happen during intent analysis (in handleSaveWorkflow)
        // This reduces API calls from N+1 to just 1
        console.log('[App] ✅ Recording stopped - translations will happen on save');
        
        // Auto-suggest a task name and show save dialog
        setTimeout(() => {
          const suggestedName = generateTaskName(currentSteps);
          setWorkflowName(suggestedName);
          setShowSaveDialog(true);
          console.log('[App] 💡 Auto-generated task name:', suggestedName);
        }, 500); // Small delay to let UI update
      } else {
        console.log('[App] ⚠️ No workflow steps to analyze for variables (workflowSteps.length =', workflowSteps.length, ')');
        // Still set empty variables so UI shows the section
        setCurrentWorkflowVariables({
          variables: [],
          detectedAt: Date.now(),
          analysisCount: 0,
        });
      }
    } catch (err) {
      console.error('[App] Stop recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
      setIsDetectingVariables(false);
      setIsFinalizingRecording(false);
    }
  };

  /**
   * Consolidate consecutive INPUT steps on the same field
   * Prevents fragmented text input from being saved as multiple steps
   * Example: ["na", "nath", "nathan"] -> ["nathan"]
   */
  const consolidateInputSteps = (steps: WorkflowStep[]): WorkflowStep[] => {
    if (steps.length === 0) return steps;
    
    const consolidated: WorkflowStep[] = [];
    let i = 0;
    
    while (i < steps.length) {
      const currentStep = steps[i];
      
      // Only consolidate INPUT steps
      if (currentStep.type !== 'INPUT') {
        consolidated.push(currentStep);
        i++;
        continue;
      }
      
      // Check if this is a WorkflowStepPayload (has selector, label, etc.)
      if (!isWorkflowStepPayload(currentStep.payload)) {
        consolidated.push(currentStep);
        i++;
        continue;
      }
      
      // Look ahead for consecutive INPUT steps on the same field
      const currentSelector = currentStep.payload.selector;
      const currentLabel = currentStep.payload.label;
      let lastInputStep = currentStep;
      let j = i + 1;
      
      // Find all consecutive INPUT steps on the same field
      while (j < steps.length) {
        const nextStep = steps[j];
        
        // Stop if not an INPUT step
        if (nextStep.type !== 'INPUT') break;
        if (!isWorkflowStepPayload(nextStep.payload)) break;
        
        // Stop if different field (check both selector and label)
        const nextSelector = nextStep.payload.selector;
        const nextLabel = nextStep.payload.label;
        const sameField = (currentSelector && nextSelector && currentSelector === nextSelector) ||
                         (currentLabel && nextLabel && currentLabel === nextLabel);
        
        if (!sameField) break;
        
        // Same field - this is a continuation of the input
        lastInputStep = nextStep;
        j++;
      }
      
      // If we found multiple consecutive INPUT steps on the same field
      if (j > i + 1) {
        console.log('[consolidateInputSteps] Found', j - i, 'consecutive INPUT steps on', currentLabel || currentSelector, '- keeping only the last one');
        console.log('[consolidateInputSteps] Discarded intermediate values:', 
          steps.slice(i, j - 1).map((s: any) => s.payload.value).join(', ')
        );
        console.log('[consolidateInputSteps] Final value:', (lastInputStep.payload as any).value);
      }
      
      // Keep only the last INPUT step (with the final value)
      consolidated.push(lastInputStep);
      i = j;
    }
    
    console.log('[consolidateInputSteps] Original steps:', steps.length, '→ Consolidated:', consolidated.length, '(removed', steps.length - consolidated.length, 'fragmented inputs)');
    return consolidated;
  };

  const handleSaveWorkflow = async () => {
    console.log('[SaveWorkflow] 🚀 Save button clicked', {
      hasName: !!workflowName.trim(),
      workflowName: workflowName,
      stepsCount: workflowSteps.length,
    });
    
    if (!workflowName.trim() || workflowSteps.length === 0) {
      console.warn('[SaveWorkflow] ❌ Cannot save: missing name or no steps', {
        workflowName: workflowName,
        stepsCount: workflowSteps.length,
      });
      return;
    }

    try {
      // STEP 1: Consolidate fragmented INPUT steps
      // This prevents "na", "nath", "nathan" from being saved as 3 separate steps
      console.log('[SaveWorkflow] 🔧 Consolidating fragmented INPUT steps...');
      const consolidatedSteps = consolidateInputSteps(workflowSteps);
      
      // STEP 2: Sort steps by timestamp
      // INPUT steps are debounced and may arrive after subsequent CLICK steps
      // This ensures the correct execution order is preserved
      const sortedSteps = [...consolidatedSteps].sort((a, b) => 
        a.payload.timestamp - b.payload.timestamp
      );
      
      console.log('[SaveWorkflow] 📊 Sorted steps by timestamp:', 
        sortedSteps.map(s => `${s.type}@${s.payload.timestamp}`).join(' → ')
      );
      
      // Start variable detection
      setIsDetectingVariables(true);
      
      // Detect variables using simplified deterministic rules (no AI needed)
      // NEW: Use simplified detection - all INPUT steps with values are variables
      console.log('[SaveWorkflow] ========================================');
      console.log('[SaveWorkflow] Starting simplified variable detection for', sortedSteps.length, 'steps');
      console.log('[SaveWorkflow] Step breakdown:', sortedSteps.map((s, i) => ({ 
        index: i,
        type: s.type, 
        hasPayload: isWorkflowStepPayload(s.payload),
        hasValue: isWorkflowStepPayload(s.payload) ? !!s.payload.value : false,
        value: isWorkflowStepPayload(s.payload) ? s.payload.value?.substring(0, 30) : 'N/A',
        label: isWorkflowStepPayload(s.payload) ? s.payload.label : 'N/A',
      })));
      
      const variables = VariableDetector.detectVariablesSimplified(sortedSteps);
      
      console.log('[SaveWorkflow] ========================================');
      console.log('[SaveWorkflow] VARIABLE DETECTION COMPLETE');
      console.log('[SaveWorkflow] Total variables detected:', variables.variables.length);
      console.log('[SaveWorkflow] Variables:', variables.variables.map(v => ({
        fieldName: v.fieldName,
        variableName: v.variableName,
        defaultValue: v.defaultValue?.substring(0, 30),
        stepIndex: v.stepIndex,
      })));
      console.log('[SaveWorkflow] ========================================');

      // OPTIMIZATION DISABLED - Breaks AI Agent workflows
      // The optimizer removes "redundant" clicks that are actually ESSENTIAL for UI flow
      // Example: Removes "Click Accounts → Click New" thinking it can navigate directly
      // But AI Agent needs these clicks to open menus/modals in the correct sequence
      // 
      // LESSON: Don't optimize workflows designed for sequential UI interactions
      console.log('[SaveWorkflow] ⚠️ Navigation optimizer DISABLED - AI Agent requires all original steps');
      
      // Create temp workflow for intent analysis
      const tempWorkflow: SavedWorkflow = {
        id: `workflow-${Date.now()}`,
        name: workflowName.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: sortedSteps,
      };
      
      // Create empty optimization result (no optimization)
      const optimizationResult = {
        optimizedSteps: sortedSteps,  // Use original steps as-is
        metadata: {
          analyzedAt: Date.now(),
          sequencesFound: 0,
          sequencesOptimized: 0,
          originalStepCount: sortedSteps.length,
          optimizedStepCount: sortedSteps.length,
          stepsRemoved: 0,
          aiAnalysisUsed: false,
          optimizationMap: [],
        }
      };
      
      /* DISABLED - Optimizer breaks AI Agent workflows:
      const optimizer = new NavigationOptimizer();
      const optimizationResult = await optimizer.optimizeWorkflow(tempWorkflow, {
        useAI: true,
        aiConfidenceThreshold: 0.7,
      });
      */
      
      console.log('[SaveWorkflow] Optimization complete:', {
        originalSteps: sortedSteps.length,
        optimizedSteps: optimizationResult.optimizedSteps.length,
        stepsRemoved: optimizationResult.metadata.stepsRemoved,
        sequencesOptimized: optimizationResult.metadata.sequencesOptimized,
        aiUsed: optimizationResult.metadata.aiAnalysisUsed,
      });

      // Note: Natural language translation already happened after recording stopped
      // The sortedSteps already have naturalLanguage attached to each step
      const hasNaturalLanguage = sortedSteps.some((s: any) => s.naturalLanguage);
      console.log('[SaveWorkflow] Steps have naturalLanguage:', hasNaturalLanguage);
      if (hasNaturalLanguage) {
        console.log('[SaveWorkflow] Sample naturalLanguage:', (sortedSteps[0] as any)?.naturalLanguage);
      }

      // Generate task summary AND step translations using IntentAnalyzer
      console.log('[SaveWorkflow] Analyzing workflow intent (includes step translations)...');
      setLearningFeedback('📝 Analyzing workflow with AI...');
      let workflowDescription: string | undefined;
      let analyzedIntent: import('../lib/intent-analyzer').AnalyzedIntent | undefined;
      let stepsWithTranslations = sortedSteps;
      
      try {
        const intentAnalysis = await IntentAnalyzer.analyzeWorkflowIntent(tempWorkflow);
        if (intentAnalysis?.intent) {
          // Store full intent for AI agent
          analyzedIntent = intentAnalysis.intent;
          workflowDescription = IntentAnalyzer.formatIntentAsSummary(intentAnalysis.intent);
          console.log('[SaveWorkflow] Generated description:', workflowDescription);
          
          // Use AI primary goal as name if it's more concise than user's input
          if (intentAnalysis.intent.primaryGoal && intentAnalysis.intent.primaryGoal.length < 60) {
            const aiName = intentAnalysis.intent.primaryGoal;
            const userName = workflowName.trim();
            // If user kept the auto-generated name or it's generic, use AI name
            if (userName.startsWith('Click') || userName.startsWith('Type') || aiName.length < userName.length) {
              console.log('[SaveWorkflow] 💡 Using AI-generated name instead:', aiName);
              tempWorkflow.name = aiName;
            }
          }
          
          // Apply step translations if available
          if (intentAnalysis.intent.stepTranslations && intentAnalysis.intent.stepTranslations.length > 0) {
            console.log('[SaveWorkflow] ✨ Applying', intentAnalysis.intent.stepTranslations.length, 'step translations');
            stepsWithTranslations = sortedSteps.map((step, index) => {
              const translation = intentAnalysis.intent.stepTranslations?.find(t => t.stepIndex === index);
              if (translation) {
                return {
                  ...step,
                  naturalLanguage: {
                    intent: translation.intent,
                    precondition: translation.precondition,
                    expectedOutcome: translation.expectedOutcome,
                    dependencies: translation.dependencies,
                  },
                };
              }
              return step;
            });
            console.log('[SaveWorkflow] Sample translation:', stepsWithTranslations[0]?.naturalLanguage);
          } else {
            console.warn('[SaveWorkflow] ⚠️ No stepTranslations received from analyze_intent');
          }
          
          // Log full intent for verification
          console.log('[SaveWorkflow] 📊 Full Intent Analysis:', {
            primaryGoal: analyzedIntent.primaryGoal,
            expectedOutcome: analyzedIntent.expectedOutcome,
            confidence: analyzedIntent.confidence,
            subGoalsCount: analyzedIntent.subGoals?.length,
            failurePatternsCount: analyzedIntent.failurePatterns?.length,
            stepTranslationsCount: analyzedIntent.stepTranslations?.length,
          });
        } else {
          // Fallback to local analysis
          const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
          analyzedIntent = localIntent;
          workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
          console.log('[SaveWorkflow] Generated description (local):', workflowDescription);
        }
      } catch (error) {
        console.warn('[SaveWorkflow] Failed to generate description:', error);
        // Fallback to local analysis
        const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
        analyzedIntent = localIntent;
        workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
      }

      const workflow: SavedWorkflow = {
        id: tempWorkflow.id,
        name: workflowName.trim(),
        description: workflowDescription,
        analyzedIntent: analyzedIntent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // Use steps with translations applied
        steps: stepsWithTranslations,
        // Include detected variables if any were found
        variables: variables.variables.length > 0 ? variables : undefined,
        // Use optimized steps if optimization reduced steps, otherwise use stepsWithTranslations
        optimizedSteps: optimizationResult.metadata.stepsRemoved > 0 
          ? optimizationResult.optimizedSteps 
          : stepsWithTranslations,
        optimizationMetadata: optimizationResult.metadata.stepsRemoved > 0 ? optimizationResult.metadata : undefined,
      };

      await WorkflowStorage.saveWorkflow(workflow);
      addSavedWorkflow(workflow);
      setCurrentWorkflowName(workflow.name);
      setShowSaveDialog(false);
      setWorkflowName('');
      
      // Clear workflow steps to return to home screen
      clearWorkflowSteps();
      
      // Extract site knowledge from workflow (async, non-blocking)
      SiteKnowledgeBase.learnFromWorkflow(workflow).catch(err => {
        console.warn('Failed to extract site knowledge:', err);
      });
      
      // Store variables for display (use the fresh detection result, not workflow.variables which might be undefined)
      console.log('[SaveWorkflow] Setting currentWorkflowVariables:', variables);
      console.log('[SaveWorkflow] Variables count:', variables.variables.length);
      setCurrentWorkflowVariables(variables.variables.length > 0 ? variables : null);
      
      // Build feedback message
      const feedbackParts: string[] = [];
      if (variables.variables.length > 0) {
        feedbackParts.push(`✨ ${variables.variables.length} variable${variables.variables.length > 1 ? 's' : ''} detected`);
      }
      if (optimizationResult.metadata.stepsRemoved > 0) {
        feedbackParts.push(`🔧 ${optimizationResult.metadata.stepsRemoved} navigation step${optimizationResult.metadata.stepsRemoved > 1 ? 's' : ''} optimized`);
      }
      
      if (feedbackParts.length > 0) {
        setLearningFeedback(feedbackParts.join(' • '));
        setTimeout(() => setLearningFeedback(null), 4000);
      } else {
        console.log('[SaveWorkflow] No variables or optimizations detected');
        setLearningFeedback(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setIsDetectingVariables(false);
    }
  };

  /**
   * Execute a workflow - shows variable form if workflow has variables
   */
  const handleExecuteWorkflow = async (workflow: SavedWorkflow) => {
    // Check if workflow has variables
    if (workflow.variables && workflow.variables.variables.length > 0) {
      // Show variable input form
      setPendingExecution({ workflow, steps: workflow.steps });
      setShowVariableForm(true);
    } else {
      // No variables - execute directly
      await executeWorkflowWithVariables(workflow.steps, workflow);
    }
  };

  /**
   * Handle variable form confirmation - execute workflow with provided values
   */
  const handleVariableFormConfirm = async (values: Record<string, string>, editedDescription?: string) => {
    setShowVariableForm(false);
    
    if (pendingExecution.workflow) {
      // If user edited the description, pass it along
      // This will be sent to the AI agent to guide intelligent placement
      const workflowWithContext = editedDescription 
        ? { ...pendingExecution.workflow, description: editedDescription, userEditedDescription: true }
        : pendingExecution.workflow;
        
      await executeWorkflowWithVariables(
        pendingExecution.steps,
        workflowWithContext,
        values
      );
    }
    
    setPendingExecution({ workflow: null, steps: [] });
  };

  /**
   * Handle variable form cancellation
   */
  const handleVariableFormCancel = () => {
    setShowVariableForm(false);
    setPendingExecution({ workflow: null, steps: [] });
  };

  /**
   * Execute workflow with optional variable values
   * Uses AI Agent with fast-path DOM execution for best reliability
   */
  const executeWorkflowWithVariables = async (
    steps: WorkflowStep[],
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>
  ) => {
    // ALWAYS use AI Agent mode with fast-path DOM execution
    // Fast-path: Try recorded selectors first (95% of steps, 0ms LLM latency)
    // Fallback: Use LLM for intelligent recovery when selectors fail
    // This provides the best of both worlds: speed + adaptability
    if (FeatureFlags.AI_AGENT_LOOP) {
      await executeWithAgent(workflow, variableValues);
    } else {
      // Fallback to selector-based execution if AI Agent is disabled
      await executeWithSelectors(steps, workflow, variableValues);
    }
  };

  /**
   * Execute workflow using AI Agent (observe-act loop)
   */
  const executeWithAgent = async (
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>
  ) => {
    setIsAgentRunning(true);
    setIsExecuting(true);
    setState('EXECUTING');
    setAgentLog([]);
    setAgentProgress(null);
    
    // Clear previous thinking events
    setThinkingEvents([]);
    setCurrentStep({index: 0, total: workflow.steps.length});
    
    const addLog = (action: string, status: 'success' | 'failed' | 'info', reasoning?: string) => {
      setAgentLog(prev => [...prev, {
        time: new Date().toLocaleTimeString(),
        action,
        status,
        reasoning,
      }]);
    };
    
    try {
      // Get the active tab to send message to its content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      // Navigate to starting page OR refresh if already there
      // Handle workflows that start with TAB_SWITCH (get URL from fromUrl or find first non-TAB_SWITCH step)
      let startingUrl: string | undefined;
      
      if (workflow.steps.length > 0) {
        const firstStep = workflow.steps[0];
        
        if (firstStep.type === 'TAB_SWITCH') {
          // Workflow starts with tab switch - use the fromUrl as starting point
          startingUrl = (firstStep.payload as any).fromUrl;
          console.log('[App] Workflow starts with TAB_SWITCH, using fromUrl as starting point:', startingUrl);
        } else if (isWorkflowStepPayload(firstStep.payload)) {
          // Regular step - use its URL
          startingUrl = firstStep.payload.url;
        }
        
        // Fallback: Find first non-TAB_SWITCH step
        if (!startingUrl) {
          for (const step of workflow.steps) {
            if (step.type !== 'TAB_SWITCH' && isWorkflowStepPayload(step.payload)) {
              startingUrl = step.payload.url;
              console.log('[App] Found starting URL from first non-TAB_SWITCH step:', startingUrl);
              break;
            }
          }
        }
      }
      
      if (startingUrl) {
        const needsNavigation = tab.url !== startingUrl;
        const needsRefresh = tab.url === startingUrl; // Refresh to reset page state
        
        if (needsNavigation) {
          addLog(`Navigating to starting page: ${startingUrl}`, 'info');
          await chrome.tabs.update(tab.id, { url: startingUrl });
        } else if (needsRefresh) {
          addLog('Refreshing page to reset state...', 'info');
          await chrome.tabs.reload(tab.id);
        }
        
        if (needsNavigation || needsRefresh) {
          // Wait for page load
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error('Page load timeout'));
            }, 15000);
            
            const listener = (tabId: number, changeInfo: { status?: string }) => {
              if (tabId === tab.id && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                // Wait a bit more for Salesforce Lightning to fully load
                setTimeout(() => resolve(), 1500);
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          
          addLog(`Page ${needsNavigation ? 'loaded' : 'refreshed'} successfully`, 'info');
        }
      }
      
      addLog('Starting AI Agent execution...', 'info');
      
      // Send execution message to content script using AI Agent
      // Note: Agent runs in background, completion comes via AGENT_EXECUTION_COMPLETED message
      const response = await runtimeBridge.sendMessage(
        {
          type: 'EXECUTE_WORKFLOW_AGENT',
          payload: {
            workflow,
            variableValues,
          },
        },
        tab.id
      );
      
      if (!response.success) {
        addLog(`Failed to start agent: ${response.error}`, 'failed');
        throw new Error(response.error || 'Failed to start AI Agent');
      }
      
      addLog('AI Agent is running...', 'info');
      // Completion will be handled by AGENT_EXECUTION_COMPLETED message listener
    } catch (err) {
      console.error('AI Agent execution error:', err);
      addLog(err instanceof Error ? err.message : 'Unknown error', 'failed');
      setError(err instanceof Error ? err.message : 'Failed to execute workflow');
      // Only reset state on error - normal completion is handled by AGENT_EXECUTION_COMPLETED
      setIsAgentRunning(false);
      setIsExecuting(false);
      setState('IDLE');
      setAgentProgress(null);
    }
  };

  /**
   * Stop agent execution via centralized controller
   */
  const handleStopExecution = async () => {
    try {
      const response = await runtimeBridge.sendMessage({
        type: 'EXECUTION_CONTROL',
        payload: {
          action: 'pause',
          reason: 'user_requested',
        },
      });
      
      console.log('[App] Pause execution response:', response);
      
      if (response.success) {
        setIsAgentRunning(false);
        setLearningFeedback('⏸️ Execution paused - click Resume to continue');
      } else {
        console.error('[App] Failed to pause:', response);
        setIsAgentRunning(false);
        setError('Cannot pause: ' + (response.error || 'Unknown error'));
        setTimeout(() => {
          setThinkingEvents([]);
          setCurrentStep({index: 0, total: 0});
          setError(null);
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to pause execution:', err);
      setError(err instanceof Error ? err.message : 'Failed to pause execution');
    }
  };

  /**
   * Dismiss execution panel and return to home
   */
  const handleDismissExecution = () => {
    setThinkingEvents([]);
    setCurrentStep({index: 0, total: 0});
    setExecutionSession(null);
    setIsAgentRunning(false);
    setIsExecuting(false);
    setState('IDLE');
    setAgentProgress(null);
    setLearningFeedback(null);
  };

  /**
   * Resume agent execution via centralized controller
   * @param choice - User's choice: completed (default), skipped, or retry
   */
  const handleResumeExecution = async (choice?: 'completed' | 'skipped' | 'retry') => {
    try {
      const response = await runtimeBridge.sendMessage({
        type: 'EXECUTION_CONTROL',
        payload: {
          action: 'resume',
          userChoice: choice,
        },
      });
      
      console.log('[App] Resume execution response:', response, 'with choice:', choice);
      
      if (response.success) {
        // Update local state optimistically
        setIsAgentRunning(true);
        setLearningFeedback(null);
        
        // Also update execution session locally to prevent both buttons showing
        if (executionSession) {
          setExecutionSession({
            ...executionSession,
            status: 'running',
            pauseReason: undefined,
            humanHelpContext: undefined,
          });
        }
      } else {
        setError('Cannot resume: ' + (response.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Failed to resume execution:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume execution');
    }
  };

  /**
   * Execute workflow using legacy selector-based execution
   */
  const executeWithSelectors = async (
    steps: WorkflowStep[],
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>
  ) => {
    setIsExecuting(true);
    setState('EXECUTING');
    
    try {
      // Get the active tab to send message to its content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      // Always use original steps for reliable click-through behavior
      // The AI Agent automatically handles navigation by clicking through the UI
      const stepsToExecute = steps;
      const isOptimized = false;
      
      if (workflow.optimizedSteps) {
        console.log(`[ExecuteWorkflow] Ignoring optimized steps, using original ${steps.length} steps for reliability`);
      } else if (workflow.optimizedSteps) {
        console.log(`[ExecuteWorkflow] Using original steps (user disabled optimization)`);
      }
      
      console.log('[ExecuteWorkflow] Using Universal Execution Engine');
      
      // Send execution message using new Universal Execution Engine
      const response = await runtimeBridge.sendMessage(
        {
          type: 'EXECUTE_WORKFLOW_UNIVERSAL',
          payload: {
            steps: stepsToExecute,
            workflowId: workflow.id,
            variableValues,
          },
        },
        tab.id
      );
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to execute workflow');
      }
      
      const feedbackParts: string[] = ['✓ Workflow executed successfully'];
      if (variableValues) {
        feedbackParts.push('with custom values');
      }
      if (isOptimized && workflow.optimizationMetadata) {
        feedbackParts.push(`(${workflow.optimizationMetadata.stepsRemoved} steps optimized)`);
      }
      
      setLearningFeedback(feedbackParts.join(' '));
      setTimeout(() => setLearningFeedback(null), 3000);
    } catch (err) {
      console.error('Execute workflow error:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute workflow');
    } finally {
      setIsExecuting(false);
      setState('IDLE');
    }
  };

  const handleExportJSON = (steps: WorkflowStep[] = workflowSteps) => {
    const json = JSON.stringify(steps, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `ghostwriter-workflow-${Date.now()}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Export a specific workflow as JSON
   */
  const handleExportWorkflowJSON = (workflow: SavedWorkflow) => {
    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = `ghostwriter-${workflow.name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Delete a workflow
   */
  const handleDeleteWorkflow = async (workflowId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }
    
    try {
      await WorkflowStorage.deleteWorkflow(workflowId);
      const workflows = await WorkflowStorage.loadWorkflows();
      setSavedWorkflows(workflows);
    } catch (error) {
      console.error('Error deleting workflow:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete workflow');
    }
  };

  // Task selection handler
  const handleTaskSelect = async (workflow: SavedWorkflow) => {
    await handleExecuteWorkflow(workflow);
  };

  const getHumanDescription = (step: WorkflowStep): string => {
    // Use natural language if available
    if (step.naturalLanguage?.intent) {
      return step.naturalLanguage.intent;
    }
    
    // Otherwise generate from step data
    if (!isWorkflowStepPayload(step.payload)) {
      return step.description || step.type;
    }

    switch(step.type) {
      case 'CLICK':
        return `Click "${step.payload.elementText || step.payload.label || 'element'}"`;
      case 'INPUT':
        const value = step.payload.value?.substring(0, 20);
        const label = step.payload.label || 'field';
        return `Type "${value}${value && value.length >= 20 ? '...' : ''}" in ${label}`;
      case 'NAVIGATION':
        try {
          return `Go to ${new URL(step.payload.url).hostname}`;
        } catch {
          return `Navigate to page`;
        }
      case 'TAB_SWITCH':
        return 'Switch to different tab';
      case 'SCROLL':
        return 'Scroll page';
      case 'KEYBOARD':
        return `Press ${step.payload.keyboardDetails?.key || 'key'}`;
      default:
        return step.description || step.type;
    }
  };

  // Auto-generate task name from AI description or workflow steps
  const generateTaskName = (steps: WorkflowStep[]): string => {
    // Try to create a meaningful name from the first few steps
    if (steps.length === 0) {
      return `Task ${new Date().toLocaleString()}`;
    }
    
    // Get first significant action (skip navigation)
    const firstAction = steps.find(s => s.type === 'CLICK' || s.type === 'INPUT');
    if (firstAction) {
      const desc = getHumanDescription(firstAction);
      // Take first 5 words
      const words = desc.split(' ').slice(0, 5).join(' ');
      return words.length > 3 ? words : desc;
    }
    
    // Fallback to first step
    return getHumanDescription(steps[0]);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header - Minimal */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-bold text-foreground">mimoai</h1>
            <div className="flex items-center gap-2">
              <OpenWorkWindowButton variant="icon" />
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Settings"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Recording Indicator */}
          {isRecording && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-700 font-medium flex-1">Learning your task...</span>
              <button
                onClick={handleStopRecording}
                className="text-sm text-red-600 hover:underline"
                disabled={isFinalizingRecording}
              >
                {isFinalizingRecording ? 'Finishing...' : 'Done'}
              </button>
            </div>
          )}
          
          {/* Greeting - Only show when not recording and no steps */}
          {!isRecording && workflowSteps.length === 0 && !isAgentRunning && !executionSession && thinkingEvents.length === 0 && (
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                How can I help you?
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Choose a task below or type what you'd like to do
              </p>
              
              {/* Task Cards */}
              {savedWorkflows.length > 0 && (
                <div className="mb-4">
                  <div className="space-y-2 mb-2">
                    {savedWorkflows.map((workflow) => (
                      <div
                        key={workflow.id}
                        className="flex items-center gap-2 p-3 bg-card border border-border rounded-md hover:border-primary/50 transition-colors"
                      >
                        <button
                          onClick={() => handleTaskSelect(workflow)}
                          disabled={isExecuting}
                          className="flex-1 text-left px-3 py-2 bg-muted border border-border rounded-md text-sm text-foreground hover:bg-primary/10 hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {workflow.name}
                        </button>
                        <button
                          onClick={() => handleExportWorkflowJSON(workflow)}
                          disabled={isExecuting}
                          className="px-3 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Export as JSON"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          disabled={isExecuting}
                          className="px-3 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete task"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  {/* Teach New Task Button */}
                  <button
                    onClick={handleStartRecording}
                    disabled={state === 'CONNECTING'}
                    className="w-full px-4 py-2 bg-background border border-dashed border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
                  >
                    + Teach me something new
                  </button>
                </div>
              )}
              
              {/* No tasks state */}
              {savedWorkflows.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground border-2 border-dashed border-border rounded-lg mb-4">
                  <p className="mb-3">You haven't taught me any tasks yet.</p>
                  <button
                    onClick={handleStartRecording}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                  >
                    Show me how to do something
                  </button>
                </div>
              )}
            </div>
          )}

        {/* After recording: Show save workflow UI */}
        {workflowSteps.length > 0 && !isRecording && (
          <div className="mb-6">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  clearWorkflowSteps();
                  setCurrentWorkflowVariables(null);
                }}
                className="px-3 py-2 bg-muted border border-border rounded-md hover:bg-muted/80 text-sm"
                title="Cancel and go back"
              >
                ← Back
              </button>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                disabled={isDetectingVariables}
              >
                {isDetectingVariables ? 'Analyzing...' : 'Save as task'}
              </button>
              <button
                onClick={() => setShowAdvancedMenu(!showAdvancedMenu)}
                className="p-2 bg-muted border border-border rounded-md hover:bg-muted/80"
                title="More options"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
            </div>
            
            {showAdvancedMenu && (
              <div className="mt-2 p-2 bg-muted rounded-md border border-border space-y-1">
                <button
                  onClick={() => {
                    handleExportJSON();
                    setShowAdvancedMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-background rounded"
                >
                  Export as JSON
                </button>
                <button
                  onClick={() => {
                    if (confirm('Clear all recorded steps?')) {
                      clearWorkflowSteps();
                      setShowAdvancedMenu(false);
                    }
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-background rounded"
                >
                  Clear steps
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab Switch Toast Notification - Only during recording */}
        {tabSwitchToast && isRecording && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900 rounded-lg border border-blue-200 dark:border-blue-700 animate-fade-in">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
              </svg>
              <span>Recording in: <strong>{tabSwitchToast.title}</strong></span>
              <span className="ml-auto text-xs">Tab {tabSwitchToast.tabIndex + 1} of {tabSwitchToast.totalTabs}</span>
            </div>
          </div>
        )}

        {/* Real-time Intent Display - Show during recording */}
        {isRecording && realtimeIntent && (
          <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-4 w-4 text-purple-600 dark:text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm font-medium text-purple-800 dark:text-purple-200">
                I think you're trying to: <strong>{realtimeIntent.likelyGoal}</strong>
              </span>
            </div>
            <div className="text-xs text-purple-600 dark:text-purple-300">
              Confidence: {(realtimeIntent.confidence * 100).toFixed(0)}%
            </div>
          </div>
        )}

        {/* Recorded Steps - Show during/after recording */}
        {workflowSteps.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-border">
            <h3 className="font-medium mb-3 text-card-foreground">
              I learned {workflowSteps.length} action{workflowSteps.length !== 1 ? 's' : ''}
            </h3>
            
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {workflowSteps.map((step, index) => (
                  <div 
                    key={index} 
                    className="py-2 border-b border-border last:border-0 text-sm flex items-start gap-2"
                  >
                    <span className="text-muted-foreground flex-shrink-0">{index + 1}.</span>
                    <span className="flex-1 text-foreground">{getHumanDescription(step)}</span>
                  </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Agent Chain of Thought */}
        {(isAgentRunning || executionSession || thinkingEvents.length > 0) && (() => {
          // Derive button states from execution session (source of truth)
          const sessionStatus = executionSession?.status;
          const isSessionRunning = sessionStatus === 'running';
          const isSessionStopped = sessionStatus === 'paused' || sessionStatus === 'stopped' || sessionStatus === 'waiting_for_human';
          
          // If we have a session, use its status; otherwise fall back to local state
          const showStopButton = executionSession ? isSessionRunning : isAgentRunning;
          const showResumeButton = executionSession ? isSessionStopped : false;
          
          return (
            <ThinkingPanel
              events={thinkingEvents}
              currentStep={executionSession ? { index: executionSession.currentStepIndex, total: executionSession.totalSteps } : currentStep}
              hints={executionSession?.agentState?.hints || executionSession?.workflowSteps || pendingExecution.workflow?.steps || []}
              isRunning={showStopButton}
              isStopped={showResumeButton}
              workflowName={executionSession?.workflowName || pendingExecution.workflow?.name}
              pauseReason={executionSession?.pauseReason}
              helpContext={executionSession?.humanHelpContext}
              onStop={handleStopExecution}
              onResume={handleResumeExecution}
              onDismiss={handleDismissExecution}
            />
          );
        })()}

        {/* Learning Feedback */}
        {learningFeedback && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            <div className="flex items-center gap-2">
              {isDetectingVariables && (
                <svg className="animate-spin h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {learningFeedback}
            </div>
          </div>
        )}

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
              <h2 className="text-xl font-semibold mb-2 text-card-foreground">Got it!</h2>
              <p className="text-sm text-muted-foreground mb-4">What should I call this task?</p>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder={`Task ${new Date().toLocaleString()}`}
                className="w-full px-3 py-2 border border-border rounded-md mb-4 bg-background text-foreground"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveWorkflow();
                  } else if (e.key === 'Escape') {
                    setShowSaveDialog(false);
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveWorkflow}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  disabled={!workflowName.trim() || isDetectingVariables}
                >
                  {isDetectingVariables ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </span>
                  ) : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setShowSaveDialog(false);
                    setWorkflowName('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  disabled={isDetectingVariables}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Variable Input Form Modal */}
        {showVariableForm && pendingExecution.workflow?.variables && (
          <VariableInputForm
            key={pendingExecution.workflow.id}
            variables={pendingExecution.workflow.variables}
            workflowName={pendingExecution.workflow.name}
            workflowDescription={pendingExecution.workflow.description}
            onConfirm={handleVariableFormConfirm}
            onCancel={handleVariableFormCancel}
          />
        )}

        {/* Refresh Warning Dialog */}
        {showRefreshDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
              <h2 className="text-xl font-semibold mb-4 text-card-foreground">Refresh Page to Start Recording</h2>
              <p className="text-sm text-muted-foreground mb-4">
                The page needs to be refreshed to initialize recording properly. Recording will start automatically after refresh. Any unsaved work may be lost. Continue?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRefreshConfirm}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Continue
                </button>
                <button
                  onClick={handleRefreshCancel}
                  className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Screenshot Modal */}
        {screenshotModalStep && (
          <ScreenshotModal
            step={screenshotModalStep.step}
            stepIndex={screenshotModalStep.index}
            isOpen={true}
            onClose={() => setScreenshotModalStep(null)}
          />
        )}

        {/* Settings Panel */}
        {showSettings && (
          <SettingsPanel
            workflowSteps={workflowSteps}
            storedCorrections={storedCorrections}
            setStoredCorrections={setStoredCorrections}
            showCorrections={showCorrections}
            setShowCorrections={setShowCorrections}
            correctionModeStep={correctionModeStep}
            setCorrectionModeStep={setCorrectionModeStep}
            handleExportJSON={handleExportJSON}
            clearWorkflowSteps={clearWorkflowSteps}
            onClose={() => setShowSettings(false)}
          />
        )}
        </div>
      </div>
    </div>
  );
}

export default App;
