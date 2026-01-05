import { useEffect, useState } from 'react';
import { useExtensionStore } from '../lib/store';
import { runtimeBridge } from '../lib/bridge';
import { WorkflowStorage } from '../lib/storage';
import { CorrectionMemory } from '../lib/correction-memory';
import { VariableDetector } from '../lib/variable-detector';
import { SimpleVariableDetector } from '../lib/simple-variable-detector';
import { NavigationOptimizer } from '../lib/navigation-optimizer';
import { IntentAnalyzer } from '../lib/intent-analyzer';
import { VariableInputForm } from './VariableInputForm';
import { ScreenshotModal } from './ScreenshotModal';
import { FeatureFlags } from '../lib/feature-flags';
import type { ExtensionState } from '../types/state';
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
  ElementFindFailedMessage
} from '../types/messages';
import type { CorrectionEntry } from '../types/visual';

function App() {
  const { 
    state, 
    connectionStatus, 
    error, 
    lastPingTime,
    workflowSteps,
    savedWorkflows,
    currentWorkflowName,
    isRecording,
    pendingAIValidations,
    enhancedSteps,
    setState,
    setConnectionStatus,
    setError,
    setLastPingTime,
    clearWorkflowSteps,
    loadWorkflow,
    setSavedWorkflows,
    addSavedWorkflow,
    removeSavedWorkflow,
    setCurrentWorkflowName,
    setIsRecording,
    setWorkflowSteps,
  } = useExtensionStore();

  const [isPinging, setIsPinging] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [pendingTabId, setPendingTabId] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  // Correction learning state
  const [showCorrections, setShowCorrections] = useState(false);
  const [storedCorrections, setStoredCorrections] = useState<CorrectionEntry[]>([]);
  const [correctionModeStep, setCorrectionModeStep] = useState<string | null>(null);
  const [learningFeedback, setLearningFeedback] = useState<string | null>(null);
  // Variable detection state
  const [isDetectingVariables, setIsDetectingVariables] = useState(false);
  // Natural language translation state
  const [isTranslatingSteps, setIsTranslatingSteps] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ current: number; total: number } | null>(null);
  // Recording finalization state (flushing pending steps)
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [expandedVariables, setExpandedVariables] = useState<Set<string>>(new Set());
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
  // Optimization toggle state
  // Editable AI instructions state
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [editedInstruction, setEditedInstruction] = useState<string>('');
  
  // AI Agent execution state
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [_agentProgress, setAgentProgress] = useState<{
    stepNumber: number;
    action: AgentAction | null;
    status: 'thinking' | 'acting' | 'completed' | 'failed';
  } | null>(null);
  const [agentLog, setAgentLog] = useState<Array<{
    time: string;
    action: string;
    status: 'success' | 'failed' | 'info';
    reasoning?: string;
  }>>([]);
  // Mode selection: 'selector' (legacy) or 'agent' (AI-powered)
  // Default to selector if agent is disabled
  const [executionMode, setExecutionMode] = useState<'selector' | 'agent'>(
    FeatureFlags.AI_AGENT_LOOP ? 'agent' : 'selector'
  );

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
        console.log('[App] Agent execution completed:', result);
        
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
        
        if (result.success) {
          setLearningFeedback('✓ AI Agent completed workflow successfully');
        } else {
          setLearningFeedback(`⚠️ AI Agent: ${result.stepsCompleted}/${result.totalSteps} steps completed`);
        }
        setTimeout(() => setLearningFeedback(null), 5000);
      } else if (message.type === 'RECORDED_STEP' && message.payload?.step) {
        // Use the store actions directly instead of from hook to avoid stale closures
        useExtensionStore.getState().addWorkflowStep(message.payload.step);
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
      
      // Check if it's a spreadsheet domain
      const isSpreadsheet = isSpreadsheetDomain(tab.url);
      
      if (isSpreadsheet) {
        // Show refresh dialog for spreadsheets
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

  const handleAddTab = async () => {
    try {
      // 1. Update UI immediately (optimistic update)
      setIsPaused(true);
      setState('PAUSED');
      
      // 2. Send ADD_TAB message to service worker
      // Service worker will handle pausing (without finalizing) and open new tab
      const response = await runtimeBridge.sendMessage({
        type: 'ADD_TAB',
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to add tab');
      }
      
      // Service worker will:
      // - Pause recording in all tabs (without finalizing)
      // - Store last recorded tab info
      // - Open new tab
    } catch (err) {
      console.error('Add tab error:', err);
      setError(err instanceof Error ? err.message : 'Failed to add tab');
      // Revert UI state if failed
      setIsPaused(false);
      setState('RECORDING'); // Revert to recording state
    }
  };

  const handleResumeRecording = async () => {
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }
      
      // Check if it's a restricted page
      if (tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') || 
          tab.url.startsWith('about:') ||
          tab.url.startsWith('edge://')) {
        throw new Error('Cannot record on this page type. Please navigate to a regular website.');
      }
      
      // Service worker tracks lastRecordedTabUrl and lastRecordedTabIndex
      // We don't need to pass fromUrl/fromTabIndex - service worker has it
      // But we can pass it for clarity
      
      // Send RESUME_RECORDING message
      // Service worker will use stored lastRecordedTabUrl and lastRecordedTabIndex
      const response = await runtimeBridge.sendMessage({
        type: 'RESUME_RECORDING',
        payload: {
          tabId: tab.id,
          tabUrl: tab.url,
          tabTitle: tab.title,
          fromUrl: '', // Service worker will use stored value
          // fromTabIndex and toTabIndex will be handled by service worker
        },
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to resume recording');
      }
      
      // Update UI state
      setIsPaused(false);
      setIsRecording(true);
      setState('RECORDING');
    } catch (err) {
      console.error('Resume recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume recording');
    }
  };

  // ============================================================================
  // Editable AI Instructions Handlers
  // ============================================================================
  
  /**
   * Start editing a step's AI instruction
   */
  const handleStartEditInstruction = (index: number, currentInstruction: string) => {
    setEditingStepIndex(index);
    setEditedInstruction(currentInstruction);
  };

  /**
   * Save edited instruction to the workflow step
   */
  const handleSaveInstruction = (index: number) => {
    const updatedSteps = [...workflowSteps];
    const step = updatedSteps[index];
    
    // Update the naturalLanguage.intent with user's edit
    updatedSteps[index] = {
      ...step,
      naturalLanguage: {
        intent: editedInstruction,
        precondition: step.naturalLanguage?.precondition || 'Page must be loaded',
        expectedOutcome: step.naturalLanguage?.expectedOutcome || 'Action completes successfully',
        dependencies: step.naturalLanguage?.dependencies || [],
        userEdited: true, // Flag that user modified this
      },
    };
    
    setWorkflowSteps(updatedSteps);
    setEditingStepIndex(null);
    setEditedInstruction('');
    console.log(`[App] ✏️ Saved edited instruction for step ${index + 1}: "${editedInstruction}"`);
  };

  /**
   * Cancel editing
   */
  const handleCancelEditInstruction = () => {
    setEditingStepIndex(null);
    setEditedInstruction('');
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
          let variables;
          
          if (FeatureFlags.AI_VARIABLE_DETECTION) {
            console.log('[App] Calling AI VariableDetector.detectVariables...');
            variables = await VariableDetector.detectVariables(currentSteps, initialFullPageSnapshot);
            console.log('[App] ✅ AI Variable detection completed:', {
              totalVariables: variables.variables.length,
              analysisCount: variables.analysisCount,
              variables: variables.variables.map(v => ({
                fieldName: v.fieldName,
                variableName: v.variableName,
                isVariable: v.isVariable,
                confidence: v.confidence,
              })),
            });
          } else {
            console.log('[App] Using pattern-based SimpleVariableDetector (AI disabled)');
            variables = SimpleVariableDetector.detectVariables(currentSteps);
            console.log('[App] ✅ Pattern-based detection completed:', {
              totalVariables: variables.variables.length,
              analysisCount: variables.analysisCount,
              variables: variables.variables.map(v => ({
                fieldName: v.fieldName,
                variableName: v.variableName,
              })),
            });
          }
          
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
        
        // Now translate steps to natural language
        await translateStepsToNaturalLanguage(currentSteps);
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
      setIsTranslatingSteps(false);
      setIsFinalizingRecording(false);
    }
  };
  
  // Translate workflow steps to natural language
  const translateStepsToNaturalLanguage = async (steps: WorkflowStep[]) => {
    if (steps.length === 0) return;
    
    console.log('[App] 🧠 Starting natural language translation for', steps.length, 'steps');
    setIsTranslatingSteps(true);
    setTranslationProgress({ current: 0, total: steps.length });
    setLearningFeedback('🧠 Translating steps to natural language...');
    
    try {
      const { translateWorkflow } = await import('../lib/workflow-translator');
      
      // Translate with progress updates
      const translatedSteps = await translateWorkflow(steps, (current, total) => {
        setTranslationProgress({ current, total });
        setLearningFeedback(`🧠 Translating step ${current}/${total}...`);
      });
      
      console.log('[App] ✅ Translation complete:', translatedSteps.length, 'steps translated');
      console.log('[App] Sample translation:', translatedSteps[0]?.naturalLanguage);
      
      // Update the workflow steps in the store with translations
      setWorkflowSteps(translatedSteps);
      
      setLearningFeedback(`✨ Translated ${translatedSteps.length} steps - ready to save/export`);
      setTimeout(() => setLearningFeedback(null), 3000);
    } catch (err) {
      console.error('[App] ❌ Translation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to translate steps');
      setLearningFeedback('⚠️ Translation failed, but you can still save/export');
      setTimeout(() => setLearningFeedback(null), 4000);
    } finally {
      setIsTranslatingSteps(false);
      setTranslationProgress(null);
    }
  };

  const handleSaveWorkflow = async () => {
    if (!workflowName.trim() || workflowSteps.length === 0) {
      return;
    }

    try {
      // CRITICAL: Sort steps by timestamp before saving
      // INPUT steps are debounced and may arrive after subsequent CLICK steps
      // This ensures the correct execution order is preserved
      const sortedSteps = [...workflowSteps].sort((a, b) => 
        a.payload.timestamp - b.payload.timestamp
      );
      
      console.log('[SaveWorkflow] 📊 Sorted steps by timestamp:', 
        sortedSteps.map(s => `${s.type}@${s.payload.timestamp}`).join(' → ')
      );
      
      // Start variable detection
      setIsDetectingVariables(true);
      
      // Detect variables using AI vision analysis (if enabled)
      let variables;
      
      if (FeatureFlags.AI_VARIABLE_DETECTION) {
        console.log('[SaveWorkflow] Starting AI variable detection for', sortedSteps.length, 'steps');
        console.log('[SaveWorkflow] Step types:', sortedSteps.map(s => ({ type: s.type, hasSnapshot: isWorkflowStepPayload(s.payload) ? !!s.payload.visualSnapshot : false })));
        // For saved workflows, we don't have the initial snapshot, so pass null
        variables = await VariableDetector.detectVariables(sortedSteps, null);
        console.log('[SaveWorkflow] AI variables detected:', JSON.stringify(variables, null, 2));
      } else {
        console.log('[SaveWorkflow] Using pattern-based variable detection');
        variables = SimpleVariableDetector.detectVariables(sortedSteps);
        console.log('[SaveWorkflow] Pattern-based variables detected:', {
          count: variables.variables.length,
          variables: variables.variables.map(v => v.fieldName),
        });
      }

      // Run navigation optimization to detect and optimize unnecessary navigation steps
      console.log('[SaveWorkflow] Starting navigation optimization...');
      setLearningFeedback('🔧 Analyzing navigation patterns...');
      
      const optimizer = new NavigationOptimizer();
      const tempWorkflow: SavedWorkflow = {
        id: `workflow-${Date.now()}`,
        name: workflowName.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: sortedSteps,
      };
      
      const optimizationResult = await optimizer.optimizeWorkflow(tempWorkflow, {
        useAI: true,
        aiConfidenceThreshold: 0.7,
      });
      
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

      // Generate task summary using IntentAnalyzer
      console.log('[SaveWorkflow] Analyzing workflow intent for summary...');
      setLearningFeedback('📝 Generating task summary...');
      let workflowDescription: string | undefined;
      
      try {
        const intentAnalysis = await IntentAnalyzer.analyzeWorkflowIntent(tempWorkflow);
        if (intentAnalysis?.intent) {
          workflowDescription = IntentAnalyzer.formatIntentAsSummary(intentAnalysis.intent);
          console.log('[SaveWorkflow] Generated description:', workflowDescription);
        } else {
          // Fallback to local analysis
          const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
          workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
          console.log('[SaveWorkflow] Generated description (local):', workflowDescription);
        }
      } catch (error) {
        console.warn('[SaveWorkflow] Failed to generate description:', error);
        // Fallback to local analysis
        const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
        workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
      }

      const workflow: SavedWorkflow = {
        id: tempWorkflow.id,
        name: workflowName.trim(),
        description: workflowDescription,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // Use sortedSteps to ensure correct execution order
        steps: sortedSteps,
        // Include detected variables if any were found
        variables: variables.variables.length > 0 ? variables : undefined,
        // Use optimized steps if optimization reduced steps, otherwise use sortedSteps
        optimizedSteps: optimizationResult.metadata.stepsRemoved > 0 
          ? optimizationResult.optimizedSteps 
          : sortedSteps,
        optimizationMetadata: optimizationResult.metadata.stepsRemoved > 0 ? optimizationResult.metadata : undefined,
      };

      await WorkflowStorage.saveWorkflow(workflow);
      addSavedWorkflow(workflow);
      setCurrentWorkflowName(workflow.name);
      setShowSaveDialog(false);
      setWorkflowName('');
      
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

  const handleLoadWorkflow = (workflow: SavedWorkflow) => {
    loadWorkflow(workflow);
    setState('IDLE');
    // Store variables for display
    console.log('[LoadWorkflow] Loading workflow with variables:', workflow.variables);
    setCurrentWorkflowVariables(workflow.variables || null);
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
   * Uses the new Universal Execution Engine for reliable clicks and dropdown handling
   */
  const executeWorkflowWithVariables = async (
    steps: WorkflowStep[],
    workflow: SavedWorkflow,
    variableValues?: Record<string, string>
  ) => {
    // Route to appropriate execution mode (if agent is enabled)
    if (FeatureFlags.AI_AGENT_LOOP && executionMode === 'agent') {
      await executeWithAgent(workflow, variableValues);
    } else {
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
      const startingUrl = workflow.steps.length > 0 && isWorkflowStepPayload(workflow.steps[0].payload)
        ? workflow.steps[0].payload.url
        : undefined;
      
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
    } finally {
      setIsAgentRunning(false);
      setIsExecuting(false);
      setState('IDLE');
      setAgentProgress(null);
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

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await WorkflowStorage.deleteWorkflow(id);
      removeSavedWorkflow(id);
      setShowDeleteConfirm(null);
      
      // Clear current workflow if it was deleted
      if (currentWorkflowName && savedWorkflows.find(w => w.id === id)?.name === currentWorkflowName) {
        clearWorkflowSteps();
        setCurrentWorkflowName(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workflow');
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

  const getStateColor = (currentState: ExtensionState) => {
    switch (currentState) {
      case 'IDLE':
        return 'bg-gray-500';
      case 'CONNECTING':
        return 'bg-yellow-500';
      case 'RECORDING':
        return 'bg-red-500';
      case 'PROCESSING_AI':
        return 'bg-blue-500';
      case 'EXECUTING':
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-600';
      case 'connecting':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-foreground">mimoai</h1>
        
        {/* Connection Status */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Connection Status</h2>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500' :
              'bg-red-500'
            }`} />
            <span className={`font-medium ${getConnectionStatusColor()}`}>
              {connectionStatus.toUpperCase()}
            </span>
            {isPinging && (
              <span className="text-sm text-muted-foreground">(Pinging...)</span>
            )}
          </div>
          {lastPingTime && (
            <p className="text-sm text-muted-foreground mt-2">
              Last ping: {new Date(lastPingTime).toLocaleTimeString()}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive mt-2">{error}</p>
          )}
        </div>

        {/* Extension State */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Extension State</h2>
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${getStateColor(state)} animate-pulse`} />
            <span className="font-medium text-foreground">{state}</span>
          </div>
          {currentWorkflowName && (
            <p className="text-sm text-muted-foreground mt-2">
              Current workflow: {currentWorkflowName}
            </p>
          )}
          {pendingAIValidations.size > 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-yellow-600">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>AI validating {pendingAIValidations.size} step{pendingAIValidations.size > 1 ? 's' : ''}...</span>
            </div>
          )}
          {enhancedSteps.size > 0 && pendingAIValidations.size === 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{enhancedSteps.size} step{enhancedSteps.size > 1 ? 's' : ''} enhanced with AI</span>
            </div>
          )}
          {currentWorkflowVariables && currentWorkflowVariables.variables.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-purple-600">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              <span>{currentWorkflowVariables.variables.length} variable{currentWorkflowVariables.variables.length !== 1 ? 's' : ''} detected by AI</span>
            </div>
          )}
        </div>

        {/* Paused State Indicator */}
        {isPaused && (
          <div className="mb-4 p-4 bg-yellow-100 dark:bg-yellow-900 rounded-lg border border-yellow-300 dark:border-yellow-700">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Recording paused. Navigate to your target site, then click "Resume Recording".
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-4 text-card-foreground">Actions</h2>
          <div className="space-y-2">
            <button
              onClick={handleStartRecording}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state === 'RECORDING' || state === 'CONNECTING' || isPaused}
            >
              Start Recording
            </button>
            {isRecording && !isPaused && (
              <button
                onClick={handleAddTab}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Tab
              </button>
            )}
            {isPaused && (
              <button
                onClick={handleResumeRecording}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Resume Recording
              </button>
            )}
            <button
              onClick={handleStopRecording}
              className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={(state !== 'RECORDING' && !isPaused) || isFinalizingRecording}
            >
              {isFinalizingRecording ? '⏳ Finishing...' : 'Stop Recording'}
            </button>
            <button
              onClick={() => setShowSaveDialog(true)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording || isDetectingVariables || isTranslatingSteps}
            >
              {isDetectingVariables ? 'Analyzing Variables...' : isTranslatingSteps ? `Translating ${translationProgress?.current || 0}/${translationProgress?.total || 0}...` : 'Save Workflow'}
            </button>
            <button
              onClick={() => handleExportJSON()}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording || isDetectingVariables || isTranslatingSteps}
            >
              {isTranslatingSteps ? 'Translating...' : 'Export JSON'}
            </button>
            <button
              onClick={clearWorkflowSteps}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={workflowSteps.length === 0 || isRecording}
            >
              Clear Steps
            </button>
          </div>
        </div>

        {/* Recorded Steps */}
        {workflowSteps.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold mb-4 text-card-foreground">
              Recorded Steps ({workflowSteps.length})
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {workflowSteps.map((step, index) => {
                const stepId = step.payload.timestamp.toString();
                const isPending = pendingAIValidations.has(stepId);
                const isEnhanced = enhancedSteps.has(stepId);
                const aiFallbackCount = isWorkflowStepPayload(step.payload) ? step.payload.fallbackSelectors?.filter((s: string) => 
                  !s.includes('nth-of-type') && !s.includes('ng-star-inserted')
                ).length || 0 : 0;
                
                // Check if this step is a detected variable
                const variableDef = currentWorkflowVariables?.variables.find(
                  v => String(v.stepId) === stepId
                );
                const isVariable = !!variableDef;
                
                // Check if this step has a visual snapshot
                const hasScreenshot = isWorkflowStepPayload(step.payload) && 
                  (step.payload.visualSnapshot?.viewport || step.payload.visualSnapshot?.elementSnippet);
                
                return (
                  <div 
                    key={index} 
                    className={`p-3 bg-muted rounded-md text-sm border-l-4 ${
                      isVariable ? 'border-purple-500' :
                      isEnhanced ? 'border-blue-500' : 
                      isPending ? 'border-yellow-500 animate-pulse' : 
                      'border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          {index + 1}. {step.type}
                          {isVariable && (
                            <span 
                              className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-medium"
                              title={`Variable: ${variableDef.fieldName} (${variableDef.variableName}) - Confidence: ${Math.round(variableDef.confidence * 100)}%`}
                            >
                              ✨ {variableDef.variableName}
                            </span>
                          )}
                          {!isVariable && step.type === 'INPUT' && isWorkflowStepPayload(step.payload) && step.payload.value && !currentWorkflowVariables && (
                            <span 
                              className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-500 rounded"
                              title="May be detected as a variable when workflow is saved"
                            >
                              ?var
                            </span>
                          )}
                        </div>
                        {step.description && (
                          <div className="text-sm text-blue-600 mt-1 font-medium">
                            {step.description}
                          </div>
                        )}
                        
                        {/* Editable AI Instructions */}
                        {step.naturalLanguage?.intent && (
                          <div className="mt-2">
                            {editingStepIndex === index ? (
                              // Edit Mode
                              <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
                                <div className="flex items-center gap-1 text-amber-700 text-xs mb-1 font-medium">
                                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                  </svg>
                                  <span>Edit AI Instructions:</span>
                                </div>
                                <textarea
                                  value={editedInstruction}
                                  onChange={(e) => setEditedInstruction(e.target.value)}
                                  className="w-full text-sm p-2 border border-amber-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                                  rows={2}
                                  placeholder="Describe what this step should do..."
                                  autoFocus
                                />
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => handleSaveInstruction(index)}
                                    className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors flex items-center gap-1"
                                  >
                                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Save
                                  </button>
                                  <button
                                    onClick={handleCancelEditInstruction}
                                    className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // View Mode
                              <div 
                                className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                                  step.naturalLanguage.userEdited 
                                    ? 'bg-amber-50 border border-amber-200 hover:bg-amber-100' 
                                    : 'bg-emerald-50 border border-emerald-200 hover:bg-emerald-100'
                                }`}
                                onClick={() => handleStartEditInstruction(index, step.naturalLanguage?.intent || '')}
                                title="Click to edit AI instructions"
                              >
                                <div className="flex-shrink-0 mt-0.5">
                                  <span className="text-sm">
                                    {step.naturalLanguage.userEdited ? '✏️' : '💡'}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm ${
                                    step.naturalLanguage.userEdited ? 'text-amber-800' : 'text-emerald-800'
                                  }`}>
                                    {step.naturalLanguage.intent}
                                  </div>
                                  {step.naturalLanguage.userEdited && (
                                    <div className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                      </svg>
                                      User edited
                                    </div>
                                  )}
                                </div>
                                <button
                                  className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                                  title="Edit instructions"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Screenshot Button */}
                        {hasScreenshot && (
                          <button
                            onClick={() => setScreenshotModalStep({ step, index })}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="View screenshot"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        )}
                        {isPending && (
                          <div className="flex items-center gap-1 text-yellow-600 text-xs">
                            <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>AI analyzing...</span>
                          </div>
                        )}
                        {isEnhanced && !isPending && (
                          <div className="flex items-center gap-1 text-blue-600 text-xs">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span>AI enhanced</span>
                          </div>
                        )}
                        {/* Execution Strategy Indicator */}
                        {isWorkflowStepPayload(step.payload) && step.payload.elementAnalysis && (
                          <div className={`flex items-center gap-1 text-xs ${
                            step.payload.elementAnalysis.executionStrategy === 'SIMPLE' ? 'text-green-600' :
                            step.payload.elementAnalysis.executionStrategy === 'AI_RECOMMENDED' ? 'text-yellow-600' :
                            'text-purple-600'
                          }`}>
                            {step.payload.elementAnalysis.executionStrategy === 'SIMPLE' && (
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                              </svg>
                            )}
                            {step.payload.elementAnalysis.executionStrategy === 'AI_RECOMMENDED' && (
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                            )}
                            {step.payload.elementAnalysis.executionStrategy === 'AI_REQUIRED' && (
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
                              </svg>
                            )}
                            <span title={`Confidence: ${step.payload.elementAnalysis.confidence}/100`}>
                              {step.payload.elementAnalysis.executionStrategy === 'SIMPLE' ? '⚡ Fast' :
                               step.payload.elementAnalysis.executionStrategy === 'AI_RECOMMENDED' ? '🔀 Hybrid' :
                               '🤖 AI'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {isWorkflowStepPayload(step.payload) && step.payload.label && (
                      <div className="text-muted-foreground">Label: {step.payload.label}</div>
                    )}
                    {isWorkflowStepPayload(step.payload) && step.payload.value && (
                      <div className="text-muted-foreground">
                        Value: {step.payload.value}
                        {isVariable && variableDef && (
                          <span className="ml-2 text-xs text-purple-600">
                            (Variable: {variableDef.fieldName})
                          </span>
                        )}
                      </div>
                    )}
                    {isWorkflowStepPayload(step.payload) && (
                      <div className="text-muted-foreground text-xs mt-1">
                        Selector: {step.payload.selector}
                      </div>
                    )}
                    {isVariable && variableDef && (
                      <div className="text-purple-600 text-xs mt-1 flex items-center gap-1">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                        </svg>
                        <span>AI detected as variable ({Math.round(variableDef.confidence * 100)}% confidence)</span>
                      </div>
                    )}
                    {isEnhanced && aiFallbackCount > 0 && (
                      <div className="text-blue-600 text-xs mt-1">
                        ✨ {aiFallbackCount} AI-enhanced fallback selector{aiFallbackCount > 1 ? 's' : ''} added
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Detected Variables */}
        {workflowSteps.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-border border-purple-200">
            <h2 className="text-lg font-semibold mb-4 text-card-foreground flex items-center gap-2">
              <svg className="h-5 w-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              Detected Variables ({currentWorkflowVariables?.variables?.length || 0})
              {/* Debug: {currentWorkflowVariables ? 'has vars' : 'no vars'} */}
            </h2>
            {currentWorkflowVariables && currentWorkflowVariables.variables && currentWorkflowVariables.variables.length > 0 ? (
              <div className="space-y-2">
                {currentWorkflowVariables.variables.map((variable) => {
                  const isExpanded = expandedVariables.has(variable.variableName);
                  return (
                    <div 
                      key={variable.variableName}
                      className="p-3 bg-purple-50 rounded-md border border-purple-200 hover:border-purple-300 transition-colors cursor-pointer"
                      onClick={() => {
                        const newExpanded = new Set(expandedVariables);
                        if (isExpanded) {
                          newExpanded.delete(variable.variableName);
                        } else {
                          newExpanded.add(variable.variableName);
                        }
                        setExpandedVariables(newExpanded);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">
                              {variable.fieldName}
                            </span>
                            <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded font-mono">
                              {variable.variableName}
                            </span>
                            {variable.isDropdown && (
                              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                📋 Dropdown
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Default:</span>
                            <span className="font-mono bg-white px-2 py-0.5 rounded border text-foreground">
                              {variable.defaultValue || '(empty)'}
                            </span>
                          </div>
                          {variable.isDropdown && variable.options && variable.options.length > 0 && !isExpanded && (
                            <div className="mt-2">
                              <div className="flex flex-wrap gap-1">
                                {variable.options.slice(0, 5).map((option, idx) => (
                                  <span
                                    key={idx}
                                    className={`px-2 py-0.5 text-xs rounded border ${
                                      option === variable.defaultValue
                                        ? 'bg-purple-200 border-purple-400 font-medium text-purple-800'
                                        : 'bg-white border-gray-300 text-gray-700'
                                    }`}
                                  >
                                    {option}
                                  </span>
                                ))}
                                {variable.options.length > 5 && (
                                  <span className="px-2 py-0.5 text-xs text-muted-foreground">
                                    +{variable.options.length - 5} more
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <button
                          className="ml-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newExpanded = new Set(expandedVariables);
                            if (isExpanded) {
                              newExpanded.delete(variable.variableName);
                            } else {
                              newExpanded.add(variable.variableName);
                            }
                            setExpandedVariables(newExpanded);
                          }}
                        >
                          <svg 
                            className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                      
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-purple-200 space-y-2">
                          {variable.isDropdown && variable.options && variable.options.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground mb-1">
                                All Options ({variable.options.length}):
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {variable.options.map((option, idx) => (
                                  <span
                                    key={idx}
                                    className={`px-2 py-0.5 text-xs rounded border ${
                                      option === variable.defaultValue
                                        ? 'bg-purple-200 border-purple-400 font-medium text-purple-800'
                                        : 'bg-white border-gray-300 text-gray-700'
                                    }`}
                                  >
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {variable.inputType && (
                            <div className="text-xs text-muted-foreground">
                              Input Type: <span className="font-mono">{variable.inputType}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Confidence: {Math.round(variable.confidence * 100)}%
                            </span>
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[100px]">
                              <div 
                                className="h-full bg-purple-500 rounded-full"
                                style={{ width: `${variable.confidence * 100}%` }}
                              />
                            </div>
                          </div>
                          {variable.reasoning && (
                            <div className="text-xs text-muted-foreground italic border-l-2 border-purple-300 pl-2">
                              {variable.reasoning}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center border-2 border-dashed border-purple-200 rounded-md bg-purple-50">
                {isDetectingVariables ? (
                  <div className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-purple-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>AI is analyzing workflow steps to detect variables...</span>
                  </div>
                ) : currentWorkflowVariables ? (
                  <div>
                    <p className="font-medium mb-1">No variables detected</p>
                    <p className="text-xs">
                      {currentWorkflowVariables.analysisCount > 0 
                        ? `AI analyzed ${currentWorkflowVariables.analysisCount} step${currentWorkflowVariables.analysisCount !== 1 ? 's' : ''} but didn't find any parameterizable variables.`
                        : 'No steps were analyzed. Make sure INPUT steps have values and snapshots.'}
                    </p>
                    <p className="text-xs mt-2 text-purple-600">
                      💡 Check the browser console (F12 → Console) for detailed detection logs
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium mb-1">Variables will be detected when recording stops</p>
                    <p className="text-xs">After you stop recording, AI will automatically analyze which values should be variables.</p>
                    <p className="text-xs mt-2 text-purple-600">💡 Variables are typically: email addresses, names, amounts, dates, and dropdown selections</p>
                  </div>
                )}
              </div>
            )}
            {currentWorkflowVariables && currentWorkflowVariables.variables && currentWorkflowVariables.variables.length > 0 && (
              <div className="mt-3 pt-3 border-t border-purple-200 text-xs text-muted-foreground flex items-center gap-1">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>Click any variable to see details. These can be customized when executing the workflow.</span>
              </div>
            )}
          </div>
        )}

        {/* Execution Mode Toggle */}
        {savedWorkflows.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-border">
            <h2 className="text-lg font-semibold mb-3 text-card-foreground flex items-center gap-2">
              <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Execution Mode
            </h2>
            <div className="flex gap-2">
              {FeatureFlags.AI_AGENT_LOOP && (
                <button
                  onClick={() => setExecutionMode('agent')}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    executionMode === 'agent'
                      ? 'bg-purple-600 text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI Agent
                  </div>
                  <div className="text-xs opacity-80 mt-0.5">Observe → Think → Act</div>
                </button>
              )}
              <button
                onClick={() => setExecutionMode('selector')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  executionMode === 'selector'
                    ? 'bg-blue-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  Selectors
                </div>
                <div className="text-xs opacity-80 mt-0.5">CSS/XPath based</div>
              </button>
            </div>
            {FeatureFlags.AI_AGENT_LOOP ? (
              <p className="text-xs text-muted-foreground mt-2">
                {executionMode === 'agent' 
                  ? '🤖 AI Agent: Understands the page and decides actions. Works on complex sites like Salesforce.'
                  : '⚡ Selector Mode: Uses recorded selectors directly. Faster for simple pages.'}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                ⚡ Uses recorded CSS selectors with AI recovery fallback. Fast and reliable.
              </p>
            )}
          </div>
        )}

        {/* AI Agent Log */}
        {agentLog.length > 0 && (
          <div className="mb-6 p-4 bg-card rounded-lg border border-purple-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
                <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                AI Agent Log
                {isAgentRunning && (
                  <span className="flex items-center gap-1 text-sm text-purple-600">
                    <span className="animate-pulse">●</span> Running
                  </span>
                )}
              </h2>
              <button
                onClick={() => setAgentLog([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto text-sm">
              {agentLog.map((entry, i) => (
                <div key={i} className={`flex items-start gap-2 p-1.5 rounded ${
                  entry.status === 'success' ? 'bg-green-50' :
                  entry.status === 'failed' ? 'bg-red-50' : 'bg-gray-50'
                }`}>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{entry.time}</span>
                  <span className={`${
                    entry.status === 'success' ? 'text-green-700' :
                    entry.status === 'failed' ? 'text-red-700' : 'text-gray-700'
                  }`}>
                    {entry.action}
                  </span>
                  {entry.reasoning && (
                    <span className="text-xs text-muted-foreground truncate" title={entry.reasoning}>
                      - {entry.reasoning}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Saved Workflows */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <h2 className="text-lg font-semibold mb-4 text-card-foreground">
            Saved Workflows ({savedWorkflows.length})
          </h2>
          {savedWorkflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved workflows yet</p>
          ) : (
            <div className="space-y-3">
              {savedWorkflows.map((workflow) => (
                <div key={workflow.id} className="p-3 bg-muted rounded-md">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2 flex-wrap">
                        {workflow.name}
                        {workflow.variables && workflow.variables.variables.length > 0 && (
                          <span 
                            className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full"
                            title={`${workflow.variables.variables.length} variable${workflow.variables.variables.length !== 1 ? 's' : ''} detected`}
                          >
                            {workflow.variables.variables.length} var{workflow.variables.variables.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {workflow.optimizationMetadata && workflow.optimizationMetadata.stepsRemoved > 0 && (
                          <span 
                            className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full"
                            title={`${workflow.optimizationMetadata.stepsRemoved} navigation step${workflow.optimizationMetadata.stepsRemoved !== 1 ? 's' : ''} optimized`}
                          >
                            -{workflow.optimizationMetadata.stepsRemoved} nav
                          </span>
                        )}
                      </div>
                      {workflow.description && (
                        <div className="text-sm text-muted-foreground mt-1 italic">
                          {workflow.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDate(workflow.updatedAt)} • {workflow.steps.length} steps
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleLoadWorkflow(workflow)}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      disabled={isRecording || isExecuting}
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleExecuteWorkflow(workflow)}
                      className="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50"
                      disabled={isRecording || isExecuting}
                    >
                      {isExecuting ? 'Running...' : 'Execute'}
                    </button>
                    <button
                      onClick={() => handleExportJSON(workflow.steps)}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(workflow.id)}
                      className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      disabled={isRecording || isExecuting}
                    >
                      Delete
                    </button>
                  </div>
                  {showDeleteConfirm === workflow.id && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <p className="text-sm text-red-800 mb-2">Are you sure you want to delete this workflow?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        >
                          Confirm Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(null)}
                          className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Learning & Corrections */}
        <div className="mb-6 p-4 bg-card rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-card-foreground">
              Learning Memory
            </h2>
            <button
              onClick={async () => {
                const corrections = await CorrectionMemory.getAllCorrections();
                setStoredCorrections(corrections);
                setShowCorrections(!showCorrections);
              }}
              className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              {showCorrections ? 'Hide' : 'Show'} ({storedCorrections.length})
            </button>
          </div>
          
          {learningFeedback && (
            <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
              <div className="flex items-center gap-2">
                {(isDetectingVariables || isTranslatingSteps) && (
                  <svg className="animate-spin h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {learningFeedback}
              </div>
              {isTranslatingSteps && translationProgress && (
                <div className="mt-2">
                  <div className="w-full bg-green-200 rounded-full h-1.5">
                    <div 
                      className="bg-green-600 h-1.5 rounded-full transition-all duration-300" 
                      style={{ width: `${(translationProgress.current / translationProgress.total) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {correctionModeStep && (
            <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800 font-medium mb-2">
                🔧 Correction Mode Active
              </p>
              <p className="text-xs text-yellow-700 mb-2">
                Click on the correct element in the page. The extension will learn from your correction.
              </p>
              <button
                onClick={() => {
                  setCorrectionModeStep(null);
                  // Send message to cancel correction mode
                  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                    if (tab?.id) {
                      chrome.tabs.sendMessage(tab.id, { type: 'CANCEL_CORRECTION' });
                    }
                  });
                }}
                className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel Correction
              </button>
            </div>
          )}
          
          {showCorrections && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {storedCorrections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No corrections yet. The extension will learn from your corrections when element finding fails.
                </p>
              ) : (
                storedCorrections.map((correction) => (
                  <div key={correction.id} className="p-2 bg-muted rounded text-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {correction.originalDescription || 'Element correction'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Page: {correction.pageType?.type || 'unknown'}
                        </div>
                        <div className="text-xs text-green-600 mt-1">
                          ✓ {correction.successCount} successful • ✗ {correction.failureCount} failed
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await CorrectionMemory.deleteCorrection(correction.id);
                          const updated = await CorrectionMemory.getAllCorrections();
                          setStoredCorrections(updated);
                        }}
                        className="p-1 text-red-500 hover:text-red-700"
                        title="Delete correction"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
              {storedCorrections.length > 0 && (
                <button
                  onClick={async () => {
                    if (confirm('Clear all learned corrections?')) {
                      await CorrectionMemory.clearAll();
                      setStoredCorrections([]);
                    }
                  }}
                  className="w-full px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Clear All Corrections
                </button>
              )}
            </div>
          )}
        </div>

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
              <h2 className="text-xl font-semibold mb-4 text-card-foreground">Save Workflow</h2>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder={`Workflow ${new Date().toLocaleString()}`}
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
              <h2 className="text-xl font-semibold mb-4 text-card-foreground">Refresh Page for Header Detection</h2>
              <p className="text-sm text-muted-foreground mb-4">
                This will refresh the page to capture column headers. Any unsaved work may be lost. Continue?
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
      </div>
    </div>
  );
}

export default App;
