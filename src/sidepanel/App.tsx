import { useEffect, useState } from 'react';
import { useExtensionStore } from '../lib/store';
import { runtimeBridge } from '../lib/bridge';
import { WorkflowStorage } from '../lib/storage';
import { CorrectionMemory } from '../lib/correction-memory';
import { VariableDetector } from '../lib/variable-detector';
// import { NavigationOptimizer } from '../lib/navigation-optimizer'; // DISABLED - breaks AI Agent workflows
import { IntentAnalyzer } from '../lib/intent-analyzer';
import { analyzeWorkflowWithAI, analyzeWorkflowUnified } from '../lib/post-recording-analyzer';
import type { WorkflowAnalysis } from '../lib/post-recording-analyzer';
import { SiteKnowledgeBase } from '../lib/site-knowledge';
import { VariableInputForm } from './VariableInputForm';
import { ScreenshotModal } from './ScreenshotModal';
import { SettingsPanel } from './SettingsPanel';
import { UserContextModal } from './UserContextModal';
import { ThinkingPanel } from './ThinkingPanel';
import { OpenWorkWindowButton } from './OpenWorkWindowButton';
import { PreRecordingChat } from './PreRecordingChat';
import { PostRecordingConfirm } from './PostRecordingConfirm';
import { WorkflowDetails } from './WorkflowDetails';
import { OptionConfirmationModal } from './OptionConfirmationModal';
import { SkillsLibrary } from './SkillsLibrary';
import { AnnotationInput } from './AnnotationInput';
import { SkillTeacher } from './SkillTeacher';
import { ChatExecutor } from './ChatExecutor';
import { TeachableSkillLibrary } from '../lib/skill-storage';
import type { TeachableSkill } from '../types/skill';
import { FeatureFlags } from '../lib/feature-flags';
import { VersionChecker, EXTENSION_VERSION } from '../lib/version-checker';
import { UserContextStorage, type UserContext } from '../lib/user-context-storage';
import type { WorkflowStep, SavedWorkflow, TeachingIntent, LearnedSkill } from '../types/workflow';
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
import type { SafetyDecision } from '../types/ai';
import type { StepAnnotation } from '../types/skill';
// import { SkillStorage } from '../lib/skill-storage';

// ============================================================================
// Skill Preview Helpers (for post-recording UI)
// ============================================================================

/**
 * Synthesize milestones from workflow steps for preview
 */
function synthesizeMilestones(steps: WorkflowStep[]): Array<{ name: string; stepCount: number }> {
  if (steps.length === 0) return [];
  if (steps.length <= 2) {
    return [{ name: 'Complete Task', stepCount: steps.length }];
  }

  const milestones: Array<{ name: string; stepCount: number }> = [];

  // Find navigation/setup steps at the start
  let setupEnd = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === 'NAVIGATION' || step.type === 'CLICK') {
      setupEnd = i;
      if (i + 1 < steps.length && steps[i + 1].type === 'INPUT') {
        break;
      }
    } else {
      break;
    }
  }

  // Find submit/save step at the end
  let submitStart = steps.length;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === 'CLICK' && isWorkflowStepPayload(step.payload)) {
      const text = (step.payload.elementText || step.payload.label || '').toLowerCase();
      if (text.includes('save') || text.includes('submit') || text.includes('create') || text.includes('add')) {
        submitStart = i;
        break;
      }
    }
  }

  // Build milestones
  if (setupEnd > 0) {
    milestones.push({ name: 'Open Form', stepCount: setupEnd + 1 });
  }

  const mainStart = setupEnd > 0 ? setupEnd + 1 : 0;
  const mainEnd = submitStart < steps.length ? submitStart : steps.length;
  if (mainEnd > mainStart) {
    milestones.push({ name: 'Fill Details', stepCount: mainEnd - mainStart });
  }

  if (submitStart < steps.length) {
    milestones.push({ name: 'Save', stepCount: steps.length - submitStart });
  }

  if (milestones.length === 0) {
    milestones.push({ name: 'Complete Task', stepCount: steps.length });
  }

  return milestones;
}

/**
 * Generate trigger phrase suggestions from workflow name
 */
function suggestTriggerPhrases(name: string): string[] {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return [];

  const phrases: string[] = [normalized];

  const actionWords = ['add', 'create', 'new', 'update', 'edit', 'delete', 'remove', 'fill', 'enter', 'submit'];
  const startsWithAction = actionWords.some(a => normalized.startsWith(a));

  if (!startsWithAction) {
    phrases.push(`do ${normalized}`);
  }

  return phrases.slice(0, 2);
}

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
  const [_tabSwitchToast, setTabSwitchToast] = useState<{ title: string; tabIndex: number; totalTabs: number } | null>(null);
  // Correction learning state
  const [showCorrections, setShowCorrections] = useState(false);
  const [storedCorrections, setStoredCorrections] = useState<CorrectionEntry[]>([]);
  const [correctionModeStep, setCorrectionModeStep] = useState<string | null>(null);
  const [learningFeedback, setLearningFeedback] = useState<string | null>(null);
  // Variable detection state
  const [isDetectingVariables, setIsDetectingVariables] = useState(false);
  // Post-recording processing state (blocks save UI before analysis/questions)
  const [isPostRecordingProcessing, setIsPostRecordingProcessing] = useState(false);
  // Recording finalization state (flushing pending steps)
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [currentWorkflowVariables, setCurrentWorkflowVariables] = useState<import('../lib/variable-detector').WorkflowVariables | null>(null);
  // AI workflow analysis state (runs in background after recording stops)
  const [currentWorkflowAIAnalysis, setCurrentWorkflowAIAnalysis] = useState<WorkflowAnalysis | null>(null);
  const [isAnalyzingWorkflow, setIsAnalyzingWorkflow] = useState(false);
  // Variable naming page state (shown after recording data-entry workflows)
  const [showVariableNamingPage, setShowVariableNamingPage] = useState(false);
  // AI clarifying questions state
  const [showAIQuestionsPage, setShowAIQuestionsPage] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<Array<{
    id: string;
    question: string;
    why: string;
    options: Array<{ label: string; text: string; value: string }>;
    allowCustom: boolean;
    category: string;
  }>>([]);
  const [aiQuestionAnswers, setAiQuestionAnswers] = useState<Record<string, { selected: string; customText?: string }>>({});
  const [_isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  // Variable form modal state
  const [showVariableForm, setShowVariableForm] = useState(false);
  const [pendingExecution, setPendingExecution] = useState<{
    workflow: SavedWorkflow | null;
    steps: WorkflowStep[];
  }>({ workflow: null, steps: [] });
  const [isExecuting, setIsExecuting] = useState(false);
  const [iterationProgress, setIterationProgress] = useState<{
    current: number;
    total: number;
    currentItem: string;
  } | null>(null);
  // Screenshot modal state
  const [screenshotModalStep, setScreenshotModalStep] = useState<{ step: WorkflowStep; index: number } | null>(null);
  // UI simplification state
  const [_showAdvancedMenu, _setShowAdvancedMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserContextModal, setShowUserContextModal] = useState(false);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
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
  
  // Safety confirmation state (for Gemini Computer Use model)
  const [safetyConfirmation, setSafetyConfirmation] = useState<{
    show: boolean;
    decision: SafetyDecision | null;
    actionDescription: string;
    onConfirm: (() => void) | null;
    onDeny: (() => void) | null;
  }>({ show: false, decision: null, actionDescription: '', onConfirm: null, onDeny: null });

  // Option confirmation modal state (fuzzy matching)
  const [optionConfirmation, setOptionConfirmation] = useState<{
    show: boolean;
    requestId: string;
    userInput: string;
    matches: Array<{ option: string; confidence: number; preSelected: boolean }>;
    allOptions: string[];
    fieldName: string;
    stepIndex: number;
  } | null>(null);
  
  // Centralized execution state (from service worker)
  const [executionSession, setExecutionSession] = useState<any>(null);
  
  // Real-time intent inference (during recording)
  const [_realtimeIntent, setRealtimeIntent] = useState<{
    likelyGoal: string;
    confidence: number;
    suggestedName: string;
  } | null>(null);

  // Teaching conversation state
  const [teachingMode, setTeachingMode] = useState<
    'idle' | 'pre_recording' | 'recording_with_intent' | 'post_recording' | 'quick_recording'
  >('idle');
  const [teachingIntent, setTeachingIntent] = useState<TeachingIntent | null>(null);
  const [_pendingLearnedSkill, setPendingLearnedSkill] = useState<LearnedSkill | null>(null);

  // Workflow details view state
  const [selectedWorkflow, setSelectedWorkflow] = useState<SavedWorkflow | null>(null);

  // Skills system state
  const [showSkillsLibrary, setShowSkillsLibrary] = useState(false);
  // Recording annotations - used by AnnotationInput during recording
  const [recordingAnnotations, setRecordingAnnotations] = useState<StepAnnotation[]>([]);

  // Main navigation tab state
  const [activeTab, setActiveTab] = useState<'chat' | 'skills'>('skills');

  // Skill teaching state (new skill-based orchestration system)
  const [showSkillTeacher, setShowSkillTeacher] = useState(false);
  const [_skillTeachingPending, _setSkillTeachingPending] = useState<{ name: string; description: string; usageContext: string } | null>(null);
  const [_teachableSkills, setTeachableSkills] = useState<TeachableSkill[]>([]);  // Used by ChatExecutor

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

  // Load teachable skills on mount
  useEffect(() => {
    const loadTeachableSkills = async () => {
      try {
        const skills = await TeachableSkillLibrary.getSkills();
        setTeachableSkills(skills);
      } catch (err) {
        console.error('[App] Failed to load teachable skills:', err);
      }
    };
    loadTeachableSkills();
  }, []);

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

  // Load user context on mount
  useEffect(() => {
    const loadUserContext = async () => {
      try {
        const context = await UserContextStorage.getUserContext();
        setUserContext(context);
      } catch (error) {
        console.warn('[App] Failed to load user context:', error);
      }
    };

    loadUserContext();
  }, []);

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
      } else if (message.type === 'OPTION_MATCH_CONFIRMATION_NEEDED' && message.payload) {
        // Show option confirmation modal for fuzzy matching
        console.log('[App] Option confirmation needed:', message.payload);
        setOptionConfirmation({
          show: true,
          requestId: message.payload.requestId,
          userInput: message.payload.userInput,
          matches: message.payload.alternatives,
          allOptions: message.payload.allOptions,
          fieldName: message.payload.fieldName,
          stepIndex: message.payload.stepIndex,
        });
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
      setShowSaveDialog(false);
      setShowVariableNamingPage(false);
      setShowAIQuestionsPage(false);
      setIsPostRecordingProcessing(false);
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
      setShowSaveDialog(false);
      setShowVariableNamingPage(false);
      setShowAIQuestionsPage(false);
      setIsPostRecordingProcessing(true);
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
      let currentSteps = workflowSteps.length > 0 ? workflowSteps : [];

      console.log('[App] Checking for variable detection:', {
        workflowStepsLength: workflowSteps.length,
        currentStepsLength: currentSteps.length,
        willDetect: currentSteps.length > 0,
        hasInitialSnapshot: !!initialFullPageSnapshot,
      });

      // Note: Column headers for spreadsheets are now user-provided via the variable rename UI
      // This is more reliable than trying to auto-detect from DOM navigation
      // The user renames "A13" → "Name", "B13" → "Email", etc. and those names are used for AI pattern understanding

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

        // Declare variables outside try block so we can access it later
        let detectedVariables: import('../lib/variable-detector').WorkflowVariables = {
          variables: [],
          detectedAt: Date.now(),
          analysisCount: 0,
        };

        try {
          // For spreadsheets, use cell references as variable names (users can rename in UI)
          // This is more reliable than trying to detect headers programmatically
          console.log('[App] 📊 Spreadsheet variable detection will use cell references as default names');

          // Use simplified variable detection (no AI needed)
          console.log('[App] Calling simplified VariableDetector.detectVariablesSimplified...');
          detectedVariables = VariableDetector.detectVariablesSimplified(currentSteps);
          console.log('[App] ✅ Simplified variable detection completed:', {
            totalVariables: detectedVariables.variables.length,
            analysisCount: detectedVariables.analysisCount,
            variables: detectedVariables.variables.map(v => ({
              fieldName: v.fieldName,
              variableName: v.variableName,
              isVariable: v.isVariable,
              confidence: v.confidence,
            })),
          });

          // Store variables for display (even if empty, so UI shows the section)
          setCurrentWorkflowVariables(detectedVariables);

          if (detectedVariables.variables.length > 0) {
            setLearningFeedback(`✨ Detected ${detectedVariables.variables.length} variable${detectedVariables.variables.length > 1 ? 's' : ''} in recorded workflow`);
            setTimeout(() => setLearningFeedback(null), 4000);
          } else {
            console.log('[App] ⚠️ No variables detected. Analysis count:', detectedVariables.analysisCount);
            if (detectedVariables.analysisCount === 0) {
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
          setCurrentWorkflowVariables(detectedVariables);
        } finally {
          setIsDetectingVariables(false);
          console.log('[App] Variable detection finished, isDetectingVariables set to false');
        }

        // Generate suggested name first (so it's ready when save dialog shows)
        const suggestedName = teachingIntent?.userDescription || generateTaskName(currentSteps);
        setWorkflowName(suggestedName);

        // Check if this is a spreadsheet workflow (only spreadsheet variables should trigger naming)
        const spreadsheetVariables = detectedVariables.variables.filter(v => v.cellReference);
        const isSpreadsheetWorkflow = spreadsheetVariables.length > 0;

        if (isSpreadsheetWorkflow) {
          // For spreadsheet workflows: Show variable naming page FIRST
          // AI will run AFTER user names the variables
          console.log('[App] 📊 Spreadsheet workflow detected with', spreadsheetVariables.length, 'variables');
          console.log('[App] 📝 Showing variable naming page...');
          setCurrentWorkflowAIAnalysis(null); // Clear any previous analysis
          setLearningFeedback('✏️ Name your input fields to help AI understand the workflow');
          // Show variable naming page (not save dialog yet)
          setShowVariableNamingPage(true);
          setIsPostRecordingProcessing(false);
          // Don't show save dialog - will show after variables are named and AI runs
        } else {
          // For non-data-entry workflows: Run AI analysis immediately (blocking)
          console.log('[App] 🤖 Starting AI workflow analysis (blocking)...');
          setIsAnalyzingWorkflow(true);
          setCurrentWorkflowAIAnalysis(null); // Clear previous analysis

          let analysis: WorkflowAnalysis | null = null;
          try {
            analysis = await analyzeWorkflowWithAI(currentSteps, {
              workflowName: suggestedName || undefined,
              onProgress: (status) => {
                console.log('[App] AI Analysis progress:', status);
              },
              useAI: true,
            });

            console.log('[App] ✅ AI workflow analysis completed');
            setCurrentWorkflowAIAnalysis(analysis);
          } catch (err) {
            console.error('[App] ❌ AI workflow analysis failed:', err);
            setCurrentWorkflowAIAnalysis(null);
          } finally {
            setIsAnalyzingWorkflow(false);
          }

          // Fetch clarifying questions for non-data-entry workflows too
          const questionsResult = await fetchClarifyingQuestions(analysis);

          if (questionsResult.hasQuestions && questionsResult.questions.length > 0) {
            // Show questions page
            console.log('[App] Showing', questionsResult.questions.length, 'clarifying questions');
            setAiQuestions(questionsResult.questions);
            setAiQuestionAnswers({});
            setShowAIQuestionsPage(true);
            setLearningFeedback(null);
            setIsPostRecordingProcessing(false);
          } else {
            // No questions - show save dialog
            setShowSaveDialog(true);
            setIsPostRecordingProcessing(false);
          }
        }

        console.log('[App] ✅ Recording stopped');

        // Post-recording flow continues through AI analysis/questions before save
        console.log('[App] 💡 Suggested task name:', suggestedName);
      } else {
        console.log('[App] ⚠️ No workflow steps to analyze for variables (workflowSteps.length =', workflowSteps.length, ')');
        // Still set empty variables so UI shows the section
        setCurrentWorkflowVariables({
          variables: [],
          detectedAt: Date.now(),
          analysisCount: 0,
        });
        setIsPostRecordingProcessing(false);
      }
    } catch (err) {
      console.error('[App] Stop recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
      setIsDetectingVariables(false);
      setIsFinalizingRecording(false);
      setIsPostRecordingProcessing(false);
    }
  };

  // ============================================================================
  // Teaching Conversation Handlers
  // ============================================================================

  /**
   * Start the "Teach Me" flow - shows pre-recording chat
   */
  const handleTeachMeClick = () => {
    console.log('[App] 🎓 Starting Teach Me flow');
    setTeachingMode('pre_recording');
    setTeachingIntent(null);
    setPendingLearnedSkill(null);
  };

  /**
   * Start quick recording without teaching conversation
   */
  const handleQuickRecordClick = async () => {
    console.log('[App] ⚡ Starting quick recording');
    setTeachingMode('quick_recording');
    setTeachingIntent(null);
    await handleStartRecording();
  };

  /**
   * Called when pre-recording chat captures the user's intent
   */
  const handleIntentCaptured = async (
    intent: TeachingIntent,
    suggestedName: string,
    _aiResponse: string
  ) => {
    console.log('[App] 🎓 Intent captured:', intent.userDescription);
    setTeachingIntent(intent);
    setTeachingMode('recording_with_intent');
    setWorkflowName(suggestedName);
    
    // Start recording
    await handleStartRecording();
  };

  /**
   * Called when user skips pre-recording chat
   */
  const handleSkipPreRecording = async () => {
    console.log('[App] 🎓 Skipping pre-recording chat');
    setTeachingMode('quick_recording');
    await handleStartRecording();
  };

  /**
   * Called when user confirms post-recording with simplified UI
   * Saves workflow with user-provided name and edited variable names
   */
  const handlePostRecordingConfirmSave = async (name: string, editedVariableNames: Record<string, string>) => {
    console.log('[App] 🎓 Saving workflow from confirmation UI:', { name, editedVariableNames });

    try {
      setIsDetectingVariables(true);
      setLearningFeedback('💾 Saving your task...');

      // Detect variables
      const variables = VariableDetector.detectVariablesSimplified(workflowSteps);

      // Apply user-edited names to spreadsheet variables
      const updatedVariables = {
        ...variables,
        variables: variables.variables.map(v => {
          if (v.cellReference && editedVariableNames[v.stepId]) {
            return {
              ...v,
              fieldName: editedVariableNames[v.stepId],
            };
          }
          return v;
        }),
      };

      // Create the workflow with AI analysis
      const workflow: SavedWorkflow = {
        id: `workflow-${Date.now()}`,
        name: name,
        description: teachingIntent?.userDescription || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: workflowSteps,
        variables: updatedVariables,
        aiAnalysis: currentWorkflowAIAnalysis || undefined,
      };

      console.log('[App] 🎓 Including AI analysis in saved workflow:', {
        hasAIAnalysis: !!currentWorkflowAIAnalysis,
        primaryGoal: currentWorkflowAIAnalysis?.workflowUnderstanding?.primaryGoal,
        stepGuidanceCount: currentWorkflowAIAnalysis?.stepGuidance?.length,
      });

      // Save to storage (ensures local memory is generated)
      await WorkflowStorage.saveWorkflow(workflow);
      const savedWorkflow = await WorkflowStorage.loadWorkflow(workflow.id);
      addSavedWorkflow(savedWorkflow || workflow);

      // Reset state
      clearWorkflowSteps();
      setTeachingMode('idle');
      setTeachingIntent(null);
      setPendingLearnedSkill(null);
      setCurrentWorkflowVariables(null);
      setCurrentWorkflowAIAnalysis(null);
      setIsDetectingVariables(false);

      setLearningFeedback(`✅ Got it! I saved "${name}".`);
      setTimeout(() => setLearningFeedback(null), 3000);

    } catch (err) {
      console.error('[App] Error saving workflow:', err);
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
      setIsDetectingVariables(false);
    }
  };

  /**
   * Cancel teaching flow and return to idle
   */
  const handleCancelTeaching = () => {
    console.log('[App] 🎓 Canceling teaching flow');
    setTeachingMode('idle');
    setTeachingIntent(null);
    setPendingLearnedSkill(null);
    clearWorkflowSteps();
  };

  // ============================================================================
  // Skill Teaching Handlers (AI Orchestration System)
  // ============================================================================

  /**
   * Start recording for skill teaching
   */
  const handleSkillRecordingStart = async () => {
    console.log('[App] 🧠 Starting skill recording');
    await handleStartRecording();
  };

  /**
   * Stop recording for skill teaching
   */
  const handleSkillRecordingStop = async () => {
    console.log('[App] 🧠 Stopping skill recording');
    await handleStopRecording();
  };

  /**
   * Called when a skill is saved from the SkillTeacher
   */
  const handleSkillSaved = (skill: TeachableSkill) => {
    console.log('[App] 🧠 Skill saved:', skill.name);
    setTeachableSkills(prev => [...prev, skill]);
    setShowSkillTeacher(false);
    setLearningFeedback(`✅ Learned skill: "${skill.name}"`);
    setTimeout(() => setLearningFeedback(null), 3000);
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

  /**
   * Fetch clarifying questions from AI based on workflow context
   */
  const fetchClarifyingQuestions = async (analysis: WorkflowAnalysis | null) => {
    console.log('[AIQuestions] Fetching clarifying questions...');
    setIsGeneratingQuestions(true);
    setLearningFeedback('🤔 AI is thinking of questions...');

    try {
      const { aiConfig } = await import('../lib/ai-config');
      const supabaseUrl = aiConfig.getSupabaseUrl();
      const anonKey = aiConfig.getSupabaseAnonKey();

      if (!supabaseUrl || !anonKey) {
        console.warn('[AIQuestions] Supabase not configured, skipping questions');
        return { questions: [], hasQuestions: false };
      }

      // Build workflow context for question generation
      const variableFields = currentWorkflowVariables?.variables.map(v => v.fieldName) || [];
      const stepSummary = workflowSteps.slice(0, 5).map(s => {
        if (s.type === 'CLICK') return 'Click';
        if (s.type === 'INPUT') return 'Type text';
        if (s.type === 'NAVIGATION') return 'Navigate';
        return s.type;
      }).join(' → ') + (workflowSteps.length > 5 ? ' → ...' : '');

      const workflowContext = {
        name: workflowName || 'Untitled workflow',
        description: analysis?.workflowUnderstanding.summary,
        stepCount: workflowSteps.length,
        stepSummary,
        domain: analysis?.workflowUnderstanding.domain,
        primaryGoal: analysis?.workflowUnderstanding.primaryGoal,
        variableFields: variableFields.length > 0 ? variableFields : undefined,
        patterns: analysis?.patterns.map(p => p.type),
      };

      console.log('[AIQuestions] Workflow context:', workflowContext);

      const response = await fetch(`${supabaseUrl}/functions/v1/generate_clarifying_questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ workflow: workflowContext }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch questions: ${response.status}`);
      }

      const result = await response.json();
      console.log('[AIQuestions] Received:', result);

      return result;
    } catch (err) {
      console.error('[AIQuestions] Failed to fetch questions:', err);
      return { questions: [], hasQuestions: false };
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  /**
   * Handle completion of variable naming page
   * Runs AI analysis with user-named variables, then fetches questions or shows save dialog
   */
  const handleVariableNamingComplete = async () => {
    console.log('[VariableNaming] ✅ User completed naming variables');

    // Get user-named spreadsheet variables from state
    const namedVariables = currentWorkflowVariables?.variables.filter(v => v.cellReference) || [];
    const variableContext = namedVariables.map(v => v.fieldName).join(', ');

    console.log('[VariableNaming] Variable context for AI:', variableContext);

    // Hide variable naming page, show AI analysis loading
    setShowVariableNamingPage(false);
    setIsAnalyzingWorkflow(true);
    setLearningFeedback('🤖 AI is analyzing your workflow...');

    let analysis: WorkflowAnalysis | null = null;

    try {
      // Run AI analysis with user-named variables
      analysis = await analyzeWorkflowWithAI(workflowSteps, {
        workflowName: workflowName || generateTaskName(workflowSteps),
        variableContext,
        onProgress: (status) => {
          console.log('[VariableNaming] AI Analysis progress:', status);
        },
        useAI: true,
      });

      console.log('[VariableNaming] ✅ AI analysis completed');
      setCurrentWorkflowAIAnalysis(analysis);
    } catch (err) {
      console.error('[VariableNaming] ❌ AI analysis failed:', err);
      setCurrentWorkflowAIAnalysis(null);
    } finally {
      setIsAnalyzingWorkflow(false);
    }

    // Fetch clarifying questions
    const questionsResult = await fetchClarifyingQuestions(analysis);

    if (questionsResult.hasQuestions && questionsResult.questions.length > 0) {
      // Show questions page
      console.log('[VariableNaming] Showing', questionsResult.questions.length, 'clarifying questions');
      setAiQuestions(questionsResult.questions);
      setAiQuestionAnswers({});
      setShowAIQuestionsPage(true);
      setLearningFeedback(null);
    } else {
      // No questions - go directly to save dialog
      console.log('[VariableNaming] No questions, showing save dialog');
      setLearningFeedback('✅ AI analysis complete!');
      setShowSaveDialog(true);
    }
  };

  /**
   * Handle completion of AI questions page
   * Stores answers and shows save dialog
   */
  const handleAIQuestionsComplete = () => {
    console.log('[AIQuestions] ✅ User completed questions');
    console.log('[AIQuestions] Answers:', aiQuestionAnswers);

    // Format answers for display in save dialog and storage
    const formattedAnswers = aiQuestions.map(q => {
      const answer = aiQuestionAnswers[q.id];
      if (!answer) return null;

      const selectedOption = answer.selected === 'custom'
        ? null
        : q.options.find(opt => opt.value === answer.selected);

      return {
        questionId: q.id,
        category: q.category as 'intent' | 'behavior' | 'scope' | 'error_handling' | 'triggers',
        question: q.question,
        answerValue: answer.selected,
        answerText: selectedOption?.text || answer.customText || answer.selected,
        customAnswer: answer.selected === 'custom' ? answer.customText : undefined,
      };
    }).filter(Boolean);

    console.log('[AIQuestions] Formatted answers:', formattedAnswers);

    // Store the formatted answers for use when saving
    // We'll attach them to the workflow's memory.clarifications
    setAiQuestionAnswers(prev => ({
      ...prev,
      _formatted: formattedAnswers as any, // Temporary storage for save
    }));

    setShowAIQuestionsPage(false);
    setLearningFeedback('✅ Got it! Ready to save.');
    setShowSaveDialog(true);
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
      
      // Use existing variables from state (which may have user-renamed field names)
      // or detect fresh if not available
      let variables: import('../lib/variable-detector').WorkflowVariables;

      if (currentWorkflowVariables && currentWorkflowVariables.variables.length > 0) {
        // Use existing variables from state (user may have renamed them)
        console.log('[SaveWorkflow] ✅ Using existing variables from state (with user-renamed field names)');
        variables = currentWorkflowVariables;
        console.log('[SaveWorkflow] Variables:', variables.variables.map(v => ({
          fieldName: v.fieldName,
          variableName: v.variableName,
          defaultValue: v.defaultValue?.substring(0, 30),
          stepIndex: v.stepIndex,
        })));
      } else {
        // Detect variables fresh (for non-data-entry workflows)
        setIsDetectingVariables(true);
        console.log('[SaveWorkflow] 🔍 Detecting variables from steps...');
        variables = VariableDetector.detectVariablesSimplified(sortedSteps);
        console.log('[SaveWorkflow] Detected', variables.variables.length, 'variables');
        setIsDetectingVariables(false);
      }

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

      // Generate task summary using existing AI analysis (no duplicate API call)
      let workflowDescription: string | undefined;
      let analyzedIntent: import('../lib/intent-analyzer').AnalyzedIntent | undefined;
      let stepsWithTranslations = sortedSteps;

      // OPTIMIZATION: Reuse currentWorkflowAIAnalysis instead of calling IntentAnalyzer again
      // The post-recording analysis already ran and contains all the data we need
      if (currentWorkflowAIAnalysis) {
        console.log('[SaveWorkflow] ✅ Using existing AI analysis (no duplicate API call)');
        setLearningFeedback('📝 Preparing workflow...');

        // Convert WorkflowAnalysis to AnalyzedIntent format
        const understanding = currentWorkflowAIAnalysis.workflowUnderstanding;
        analyzedIntent = {
          primaryGoal: understanding.primaryGoal,
          subGoals: understanding.subGoals,
          expectedOutcome: understanding.successIndicators.join('; ') || 'Complete the workflow successfully',
          confidence: currentWorkflowAIAnalysis.confidence,
          // Convert string[] failureIndicators to proper format
          failurePatterns: understanding.failureIndicators.map(desc => ({ description: desc })),
          // Convert stepGuidance to stepTranslations format
          stepTranslations: currentWorkflowAIAnalysis.stepGuidance.map(g => ({
            stepIndex: g.stepIndex,
            intent: g.intent,
            precondition: g.preconditions.join('; ') || 'None',
            expectedOutcome: g.expectedOutcome,
            dependencies: g.dependencies,
          })),
        };

        workflowDescription = understanding.summary || understanding.primaryGoal;
        console.log('[SaveWorkflow] Generated description from existing analysis:', workflowDescription);

        // Use AI primary goal as name if it's more concise than user's input
        if (understanding.primaryGoal && understanding.primaryGoal.length < 60) {
          const aiName = understanding.primaryGoal;
          const userName = workflowName.trim();
          if (userName.startsWith('Click') || userName.startsWith('Type') || aiName.length < userName.length) {
            console.log('[SaveWorkflow] 💡 Using AI-generated name instead:', aiName);
            tempWorkflow.name = aiName;
          }
        }

        // Apply step translations from existing analysis
        if (currentWorkflowAIAnalysis.stepGuidance.length > 0) {
          console.log('[SaveWorkflow] ✨ Applying', currentWorkflowAIAnalysis.stepGuidance.length, 'step translations from existing analysis');
          stepsWithTranslations = sortedSteps.map((step, index) => {
            const guidance = currentWorkflowAIAnalysis.stepGuidance.find(g => g.stepIndex === index);
            if (guidance) {
              return {
                ...step,
                naturalLanguage: {
                  intent: guidance.intent,
                  precondition: guidance.preconditions.join('; ') || 'None',
                  expectedOutcome: guidance.expectedOutcome,
                  dependencies: guidance.dependencies,
                },
              };
            }
            return step;
          });
          console.log('[SaveWorkflow] Sample translation:', stepsWithTranslations[0]?.naturalLanguage);
        }

        console.log('[SaveWorkflow] 📊 Intent from existing analysis:', {
          primaryGoal: understanding.primaryGoal,
          expectedOutcome: understanding.successIndicators.join('; '),
          confidence: currentWorkflowAIAnalysis.confidence,
          subGoalsCount: understanding.subGoals?.length,
          stepTranslationsCount: currentWorkflowAIAnalysis.stepGuidance.length,
        });
      } else if (variables.variables.length > 0) {
        // Data-entry workflow: AI analysis was DEFERRED until user named variables
        // Now run AI analysis with the user-provided field names
        console.log('[SaveWorkflow] 🤖 Running deferred AI analysis with user-named variables...');
        setLearningFeedback('🤖 AI is analyzing your workflow with field names...');
        setIsAnalyzingWorkflow(true);

        // Build variable context string for AI (e.g., "Name, Email, Phone")
        const variableContext = variables.variables.map(v => v.fieldName).join(', ');
        console.log('[SaveWorkflow] Variable context for AI:', variableContext);

        try {
          // Use unified analysis to get both analysis AND memory in one AI call
          const { analysis, memory: unifiedMemory } = await analyzeWorkflowUnified(sortedSteps, {
            workflowName: workflowName.trim(),
            variableContext, // Pass user-named fields to AI
            onProgress: (status) => {
              console.log('[SaveWorkflow] AI Analysis progress:', status);
            },
            useAI: true,
          });

          console.log('[SaveWorkflow] ✅ Unified AI analysis completed:', {
            confidence: analysis.confidence,
            stepsAnalyzed: analysis.stepGuidance.length,
            primaryGoal: analysis.workflowUnderstanding.primaryGoal,
            hasMemory: !!unifiedMemory,
          });

          // Store the memory for attaching to workflow later
          (window as any).__pendingWorkflowMemory = unifiedMemory;

          // Use the AI analysis results
          setCurrentWorkflowAIAnalysis(analysis);

          const understanding = analysis.workflowUnderstanding;
          analyzedIntent = {
            primaryGoal: understanding.primaryGoal,
            subGoals: understanding.subGoals,
            expectedOutcome: understanding.successIndicators.join('; ') || 'Complete the workflow successfully',
            confidence: analysis.confidence,
            failurePatterns: understanding.failureIndicators.map(desc => ({ description: desc })),
            stepTranslations: analysis.stepGuidance.map(g => ({
              stepIndex: g.stepIndex,
              intent: g.intent,
              precondition: g.preconditions.join('; ') || 'None',
              expectedOutcome: g.expectedOutcome,
              dependencies: g.dependencies,
            })),
          };

          workflowDescription = understanding.summary || understanding.primaryGoal;
          console.log('[SaveWorkflow] Generated description from deferred analysis:', workflowDescription);

          // Apply step translations
          if (analysis.stepGuidance.length > 0) {
            stepsWithTranslations = sortedSteps.map((step, index) => {
              const guidance = analysis.stepGuidance.find(g => g.stepIndex === index);
              if (guidance) {
                return {
                  ...step,
                  naturalLanguage: {
                    intent: guidance.intent,
                    precondition: guidance.preconditions.join('; ') || 'None',
                    expectedOutcome: guidance.expectedOutcome,
                    dependencies: guidance.dependencies,
                  },
                };
              }
              return step;
            });
          }
        } catch (err) {
          console.error('[SaveWorkflow] ❌ Deferred AI analysis failed:', err);
          // Fallback to local analysis
          const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
          analyzedIntent = localIntent;
          workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
        } finally {
          setIsAnalyzingWorkflow(false);
        }
      } else {
        // Fallback: No existing analysis and no variables, use local analysis (fast, no API call)
        console.log('[SaveWorkflow] ⚠️ No existing AI analysis, using local analysis');
        setLearningFeedback('📝 Analyzing workflow...');
        const localIntent = IntentAnalyzer.analyzeIntentLocally(sortedSteps);
        analyzedIntent = localIntent;
        workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
        console.log('[SaveWorkflow] Generated description (local):', workflowDescription);
      }

      // Get the memory from unified analysis if available
      const pendingMemory = (window as any).__pendingWorkflowMemory;
      delete (window as any).__pendingWorkflowMemory;

      // Get formatted Q&A answers if user completed clarifying questions
      const formattedClarifications = (aiQuestionAnswers as any)?._formatted as Array<{
        questionId: string;
        category: 'intent' | 'context' | 'scope' | 'triggers';
        question: string;
        answerValue: string;
        answerText: string;
        customAnswer?: string;
      }> | undefined;

      // Build clarifications object if we have answers
      const clarifications = formattedClarifications && formattedClarifications.length > 0
        ? {
            collectedAt: Date.now(),
            items: formattedClarifications,
          }
        : undefined;

      if (clarifications) {
        console.log('[SaveWorkflow] ✅ Attaching', clarifications.items.length, 'Q&A clarifications to memory');
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
        // Only include optimizedSteps if actual optimization occurred (steps were removed)
        // This prevents duplicate data when optimizer is disabled
        optimizedSteps: optimizationResult.metadata.stepsRemoved > 0
          ? optimizationResult.optimizedSteps
          : undefined,
        optimizationMetadata: optimizationResult.metadata.stepsRemoved > 0 ? optimizationResult.metadata : undefined,
        // Include AI analysis if completed (runs in background after recording stops)
        aiAnalysis: currentWorkflowAIAnalysis || undefined,
        // Include memory from unified analysis (blocks, triggers, inputs, etc.)
        // Also attach Q&A clarifications if user answered questions
        memory: pendingMemory
          ? { ...pendingMemory, generatedAt: Date.now(), clarifications }
          : clarifications
            ? { clarifications, generatedAt: Date.now() } as any
            : undefined,
      };

      // Log AI analysis and memory status
      if (currentWorkflowAIAnalysis) {
        console.log('[SaveWorkflow] ✅ AI analysis attached to workflow:', {
          confidence: currentWorkflowAIAnalysis.confidence,
          stepsAnalyzed: currentWorkflowAIAnalysis.stepGuidance.length,
          patternsFound: currentWorkflowAIAnalysis.patterns.length,
        });
      } else if (isAnalyzingWorkflow) {
        console.log('[SaveWorkflow] ⏳ AI analysis still running - will not be included in this save');
      } else {
        console.log('[SaveWorkflow] ℹ️ No AI analysis available');
      }

      if (workflow.memory) {
        console.log('[SaveWorkflow] ✅ Memory attached to workflow:', {
          hasUnderstanding: !!(workflow.memory.understanding),
          hasTriggers: !!(workflow.memory.triggers?.phrases),
        });
      }

      await WorkflowStorage.saveWorkflow(workflow);
      const savedWorkflow = await WorkflowStorage.loadWorkflow(workflow.id);
      addSavedWorkflow(savedWorkflow || workflow);
      setCurrentWorkflowName(workflow.name);
      setShowSaveDialog(false);
      setWorkflowName('');

      // Clear workflow steps and reset teaching mode to return to home screen
      clearWorkflowSteps();
      setTeachingMode('idle');
      setTeachingIntent(null);
      setPendingLearnedSkill(null);
      // Clear AI analysis state (now stored in saved workflow)
      setCurrentWorkflowAIAnalysis(null);
      setIsAnalyzingWorkflow(false);
      
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
  const handleVariableFormConfirm = async (
    values: Record<string, string> | Record<string, string>[]
  ) => {
    setShowVariableForm(false);

    try {
      if (pendingExecution.workflow) {
        if (Array.isArray(values)) {
          await executeForEachEntry(pendingExecution.workflow, values);
        } else {
          await executeWorkflowWithVariables(
            pendingExecution.steps,
            pendingExecution.workflow,
            values
          );
        }
      }
    } finally {
      setPendingExecution({ workflow: null, steps: [] });
    }
  };

  const executeForEachEntry = async (
    workflow: SavedWorkflow,
    entries: Record<string, string>[]
  ) => {
    setIsExecuting(true);
    setIterationProgress({ current: 0, total: entries.length, currentItem: '' });

    const results: { index: number; success: boolean; error?: string }[] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const itemLabel = Object.values(entry).find(value => value && value.length > 0) || `Item ${i + 1}`;

      setIterationProgress({
        current: i + 1,
        total: entries.length,
        currentItem: itemLabel,
      });

      try {
        await executeWorkflowWithVariables(workflow.steps, workflow, entry);
        results.push({ index: i, success: true });

        if (i < entries.length - 1) {
          await navigateToWorkflowStart(workflow);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error instanceof Error ? error.message : 'Failed',
        });
      }
    }

    setIterationProgress(null);
    setIsExecuting(false);

    const successCount = results.filter(result => result.success).length;
    if (successCount !== entries.length) {
      setError(`Completed ${successCount}/${entries.length} items`);
    }
  };

  const navigateToWorkflowStart = async (workflow: SavedWorkflow) => {
    const firstStep = workflow.steps[0];
    if (firstStep && isWorkflowStepPayload(firstStep.payload)) {
      const startUrl = firstStep.payload.url;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && startUrl) {
        await chrome.tabs.update(tab.id, { url: startUrl });
      }
    }
  };

  /**
   * Handle variable form cancellation
   */
  const handleVariableFormCancel = () => {
    setShowVariableForm(false);
    setPendingExecution({ workflow: null, steps: [] });
  };

  /**
   * Handle option confirmation (fuzzy matching)
   */
  const handleOptionConfirm = async (selectedOptions: string[]) => {
    if (!optionConfirmation) return;

    console.log('[App] Option confirmed:', selectedOptions);

    // Send confirmation response back to the executor
    await chrome.runtime.sendMessage({
      type: 'OPTION_MATCH_CONFIRMED',
      payload: {
        requestId: optionConfirmation.requestId,
        selectedOptions,
        skipped: false,
      },
    });

    setOptionConfirmation(null);
  };

  /**
   * Handle option skip (fuzzy matching)
   */
  const handleOptionSkip = async () => {
    if (!optionConfirmation) return;

    console.log('[App] Option skipped');

    // Send skip response back to the executor
    await chrome.runtime.sendMessage({
      type: 'OPTION_MATCH_CONFIRMED',
      payload: {
        requestId: optionConfirmation.requestId,
        selectedOptions: [],
        skipped: true,
      },
    });

    setOptionConfirmation(null);
  };

  /**
   * Handle annotation added during recording
   */
  const handleAnnotation = (annotation: StepAnnotation) => {
    setRecordingAnnotations(prev => [...prev, annotation]);
    console.log('[App] Annotation added:', annotation.text, 'for step', annotation.attachedToStepIndex);
  };

  /**
   * Save skills to library (used by SkillTeacher)
   * @deprecated - Currently unused, kept for potential future use
   */
  // const handleSaveSkills = async (skills: SkillDefinition[]) => {
  //   try {
  //     await SkillStorage.saveSkills(skills);
  //     setLearningFeedback(`${skills.length} skill(s) saved to library`);
  //     setTimeout(() => setLearningFeedback(null), 3000);
  //   } catch (error) {
  //     console.error('[App] Failed to save skills:', error);
  //     setLearningFeedback('Failed to save skills');
  //     setTimeout(() => setLearningFeedback(null), 3000);
  //   }
  // };

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
            userContext,
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

  const handleSaveUserContext = async (context: UserContext | null) => {
    try {
      if (context) {
        await UserContextStorage.setUserContext(context);
      } else {
        await UserContextStorage.clearUserContext();
      }
      setUserContext(context);
    } catch (error) {
      console.warn('[App] Failed to save user context:', error);
    } finally {
      setShowUserContextModal(false);
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

  // Task selection handler - now shows details instead of executing
  const handleTaskSelect = (workflow: SavedWorkflow) => {
    setSelectedWorkflow(workflow);
  };

  // Close workflow details and return to home
  const handleCloseWorkflowDetails = () => {
    setSelectedWorkflow(null);
  };

  // Save workflow edits
  const handleSaveWorkflowEdits = async (updatedWorkflow: SavedWorkflow) => {
    try {
      await WorkflowStorage.saveWorkflow(updatedWorkflow);
      // Reload workflows to get updated list
      const workflows = await WorkflowStorage.loadWorkflows();
      setSavedWorkflows(workflows);
      setSelectedWorkflow(updatedWorkflow);
      
      setLearningFeedback('✓ Workflow updated successfully');
      setTimeout(() => setLearningFeedback(null), 2000);
    } catch (err) {
      console.error('Error saving workflow edits:', err);
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    }
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

  const spreadsheetVariablesForNaming = currentWorkflowVariables?.variables.filter(v => v.cellReference) || [];
  const isPostRecordingFlowActive = showVariableNamingPage
    || showAIQuestionsPage
    || isAnalyzingWorkflow
    || isDetectingVariables
    || _isGeneratingQuestions
    || isPostRecordingProcessing;
  const showPostRecordingOverlay = isPostRecordingProcessing
    || isAnalyzingWorkflow
    || isDetectingVariables
    || _isGeneratingQuestions;

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
                onClick={() => setShowSkillsLibrary(true)}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Skills Library"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </button>
              <button
                onClick={() => setShowUserContextModal(true)}
                className="relative p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Role & work context"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4a4 4 0 110 8 4 4 0 010-8z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 20a6 6 0 0112 0" />
                </svg>
                {userContext && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                )}
              </button>
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

          {iterationProgress && (
            <div className="bg-primary/10 px-4 py-3 rounded-xl mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  Processing {iterationProgress.current} of {iterationProgress.total}
                </span>
                <span className="text-sm text-muted-foreground">
                  {iterationProgress.currentItem}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(iterationProgress.current / iterationProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Pre-Recording Teaching Chat */}
          {teachingMode === 'pre_recording' && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Teach me something new</h2>
                <button
                  onClick={handleCancelTeaching}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              <div className="bg-card border border-border rounded-lg p-4 min-h-[300px]">
                <PreRecordingChat
                  onIntentCaptured={handleIntentCaptured}
                  onSkip={handleSkipPreRecording}
                />
              </div>
            </div>
          )}

          {/* Post-Recording Confirmation */}
          {teachingMode === 'post_recording' && workflowSteps.length > 0 && (
            <div className="mb-6">
              <PostRecordingConfirm
                workflowSteps={workflowSteps}
                suggestedName={teachingIntent?.userDescription || generateTaskName(workflowSteps)}
                onSave={handlePostRecordingConfirmSave}
                onCancel={handleCancelTeaching}
              />
            </div>
          )}

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

          {/* Annotation Input during Recording */}
          <AnnotationInput
            isRecording={isRecording}
            currentStepIndex={workflowSteps.length - 1}
            annotations={recordingAnnotations}
            onAnnotation={handleAnnotation}
          />
          
          {/* Workflow Details View - Hide during execution */}
          {selectedWorkflow && !isRecording && workflowSteps.length === 0 && teachingMode === 'idle' && !isAgentRunning && !executionSession && thinkingEvents.length === 0 && (
            <WorkflowDetails
              workflow={selectedWorkflow}
              onExecute={() => handleExecuteWorkflow(selectedWorkflow)}
              onBack={handleCloseWorkflowDetails}
              onExport={() => handleExportWorkflowJSON(selectedWorkflow)}
              onDelete={async () => {
                await handleDeleteWorkflow(selectedWorkflow.id);
                setSelectedWorkflow(null);
              }}
              onSave={handleSaveWorkflowEdits}
              isExecuting={isExecuting}
            />
          )}

          {/* Main Tab Navigation - Only show when idle */}
          {!selectedWorkflow && !isRecording && workflowSteps.length === 0 && !isAgentRunning && !executionSession && thinkingEvents.length === 0 && teachingMode === 'idle' && (
            <>
              {/* Tab Buttons */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                    activeTab === 'chat'
                      ? 'bg-primary text-primary-foreground shadow-soft'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('skills')}
                  className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                    activeTab === 'skills'
                      ? 'bg-primary text-primary-foreground shadow-soft'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Skills
                </button>
              </div>

              {/* Chat Tab Content */}
              {activeTab === 'chat' && (
                <div className="flex-1 -mx-6 -mb-6">
                  <ChatExecutor
                    onTeachSkill={() => {
                      setActiveTab('skills');
                      handleTeachMeClick();
                    }}
                    onExecuteWorkflow={async (workflow, variables) => {
                      try {
                        console.log('[App] ChatExecutor requesting workflow execution:', workflow.name);
                        console.log('[App] With extracted variables:', variables);
                        // Use the existing handleExecuteWorkflow which handles variables/execution
                        await handleExecuteWorkflow(workflow);
                        return true;
                      } catch (err) {
                        console.error('[App] ChatExecutor workflow execution failed:', err);
                        return false;
                      }
                    }}
                  />
                </div>
              )}

              {/* Skills Tab Content */}
              {activeTab === 'skills' && (
                <div className="animate-fade-in">
                  {/* Skills List */}
                  {savedWorkflows.length > 0 && (
                    <div className="mb-4">
                      <div className="space-y-3 mb-4">
                        {savedWorkflows.map((workflow, index) => (
                          <button
                            key={workflow.id}
                            onClick={() => handleTaskSelect(workflow)}
                            onContextMenu={(e) => { e.preventDefault(); handleQuickRecordClick(); }}
                            disabled={isExecuting}
                            className="w-full text-left p-5 bg-card border border-border/60 rounded-2xl shadow-soft hover:shadow-soft-lg hover:border-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-soft transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group animate-slide-up"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors tracking-tight">
                                  {workflow.name}
                                </h3>
                                {workflow.description && (
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                                    {workflow.description}
                                  </p>
                                )}
                              </div>
                              <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                                <svg className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Teach New Skill Button */}
                      <button
                        onClick={handleTeachMeClick}
                        onContextMenu={(e) => { e.preventDefault(); handleQuickRecordClick(); }}
                        disabled={state === 'CONNECTING'}
                        className="w-full px-5 py-4 bg-gradient-to-r from-primary/10 to-accent text-primary border border-primary/15 rounded-2xl font-medium hover:from-primary/15 hover:to-primary/10 hover:shadow-soft active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
                        title="Right-click for quick record"
                      >
                        <span className="flex items-center justify-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </div>
                          Teach new skill
                        </span>
                      </button>
                    </div>
                  )}

                  {/* No skills state */}
                  {savedWorkflows.length === 0 && (
                    <div className="py-12 text-center animate-fade-in">
                      <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-primary/10 to-accent flex items-center justify-center">
                        <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <p className="text-muted-foreground mb-5">
                        No skills yet. Teach me what you'd like automated.
                      </p>
                      <button
                        onClick={handleTeachMeClick}
                        onContextMenu={(e) => { e.preventDefault(); handleQuickRecordClick(); }}
                        className="px-6 py-3.5 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft-lg transition-all duration-200"
                        title="Right-click for quick record"
                      >
                        Teach me a skill
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        {/* After recording: Show save workflow UI */}
        {workflowSteps.length > 0 && !isRecording && !showSaveDialog && !isPostRecordingFlowActive && (
          <div className="mb-6 animate-fade-in">
            <div className="flex gap-3">
              <button
                onClick={() => {
                  clearWorkflowSteps();
                  setCurrentWorkflowVariables(null);
                }}
                className="px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                title="Cancel and go back"
              >
                Back
              </button>
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft disabled:opacity-50 transition-all duration-200"
                disabled={isDetectingVariables}
              >
                {isDetectingVariables ? 'Analyzing...' : 'Save as task'}
              </button>
            </div>
          </div>
        )}

        {/* Recorded Steps with AI Insights */}
        {workflowSteps.length > 0 && teachingMode !== 'post_recording' && !isAgentRunning && !executionSession && thinkingEvents.length === 0 && !showPostRecordingOverlay && (
          <div className="mb-6 p-5 bg-card rounded-2xl border border-border/60 shadow-soft">
            {/* Header with AI badge */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-card-foreground tracking-tight">
                I learned {workflowSteps.length} action{workflowSteps.length !== 1 ? 's' : ''}
              </h3>
              {currentWorkflowAIAnalysis && (
                <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI Enhanced
                </span>
              )}
            </div>

            {/* AI Analysis Summary Card */}
            {currentWorkflowAIAnalysis && (
              <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-purple-800 text-sm mb-1">AI Understanding</h4>
                    <p className="text-purple-700 text-sm">{currentWorkflowAIAnalysis.workflowUnderstanding.primaryGoal}</p>
                    {currentWorkflowAIAnalysis.patterns.length > 0 && (
                      <p className="text-purple-600 text-xs mt-2">
                        Detected: {currentWorkflowAIAnalysis.patterns.map(p => p.type.replace(/-/g, ' ')).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Steps with AI insights */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {workflowSteps.map((step, index) => {
                const aiGuidance = currentWorkflowAIAnalysis?.stepGuidance?.find(g => g.stepIndex === index);
                return (
                  <div key={index} className="py-2.5 px-3 bg-muted/30 rounded-xl text-sm">
                    <div className="flex items-start gap-3">
                      <span className="text-muted-foreground font-medium flex-shrink-0">{index + 1}.</span>
                      <div className="flex-1">
                        <span className="text-foreground">{getHumanDescription(step)}</span>
                        {aiGuidance && (
                          <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                            <span>💡</span>
                            <span>{aiGuidance.whyThisElement || aiGuidance.intent}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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

        {/* Variable Naming Page - shown for data-entry workflows */}
        {showVariableNamingPage && spreadsheetVariablesForNaming.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-md w-full mx-4 animate-scale-in">
              <h2 className="text-xl font-semibold mb-2 text-card-foreground tracking-tight">Name Your Input Fields</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Tell me what each field represents so I can understand this workflow better.
              </p>

              {/* Variable List */}
              <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                {spreadsheetVariablesForNaming.map((variable, index) => (
                  <div key={variable.stepId || variable.stepIndex} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/40">
                    <div className="flex-shrink-0 w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary font-medium text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={variable.fieldName}
                        onChange={(e) => {
                          // Update the variable's fieldName
                          if (!currentWorkflowVariables) return;
                          const updatedVariables = currentWorkflowVariables.variables.map((v) =>
                            v.stepId === variable.stepId ? { ...v, fieldName: e.target.value } : v
                          );
                          setCurrentWorkflowVariables({
                            ...currentWorkflowVariables,
                            variables: updatedVariables,
                          });
                        }}
                        placeholder="Field name (e.g., Name, Email, Phone)"
                        className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-sm"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Value: "{variable.defaultValue?.substring(0, 30)}{(variable.defaultValue?.length || 0) > 30 ? '...' : ''}"
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Help Text */}
              <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs text-blue-700">
                  <strong>Tip:</strong> Use descriptive names like "Customer Name", "Email Address", or "Phone Number".
                  This helps AI understand what this workflow does.
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleVariableNamingComplete}
                  className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
                >
                  Continue
                </button>
                <button
                  onClick={() => {
                    setShowVariableNamingPage(false);
                    clearWorkflowSteps();
                    setCurrentWorkflowVariables(null);
                  }}
                  className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Clarifying Questions Page */}
        {showAIQuestionsPage && aiQuestions.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-lg w-full mx-4 animate-scale-in max-h-[85vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-purple-100 rounded-xl">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-card-foreground tracking-tight">Quick Questions</h2>
                  <p className="text-sm text-muted-foreground">Help me understand this workflow better</p>
                </div>
              </div>

              {/* Questions List */}
              <div className="space-y-6 mb-6">
                {aiQuestions.map((q, qIndex) => (
                  <div key={q.id} className="p-4 bg-muted/20 rounded-xl border border-border/40">
                    <p className="font-medium text-foreground mb-1">
                      {qIndex + 1}. {q.question}
                    </p>
                    {q.why && (
                      <p className="text-xs text-muted-foreground mb-3 italic">
                        {q.why}
                      </p>
                    )}

                    {/* Options */}
                    <div className="space-y-2">
                      {q.options.map((opt) => (
                        <label
                          key={opt.label}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                            aiQuestionAnswers[q.id]?.selected === opt.value
                              ? 'bg-primary/10 border-2 border-primary/40'
                              : 'bg-background border border-border/60 hover:border-primary/30'
                          }`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={opt.value}
                            checked={aiQuestionAnswers[q.id]?.selected === opt.value}
                            onChange={() => setAiQuestionAnswers(prev => ({
                              ...prev,
                              [q.id]: { selected: opt.value }
                            }))}
                            className="sr-only"
                          />
                          <span className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold ${
                            aiQuestionAnswers[q.id]?.selected === opt.value
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/40 text-muted-foreground'
                          }`}>
                            {opt.label}
                          </span>
                          <span className="text-sm text-foreground">{opt.text}</span>
                        </label>
                      ))}

                      {/* Custom answer option */}
                      {q.allowCustom && (
                        <label
                          className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                            aiQuestionAnswers[q.id]?.selected === 'custom'
                              ? 'bg-primary/10 border-2 border-primary/40'
                              : 'bg-background border border-border/60 hover:border-primary/30'
                          }`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value="custom"
                            checked={aiQuestionAnswers[q.id]?.selected === 'custom'}
                            onChange={() => setAiQuestionAnswers(prev => ({
                              ...prev,
                              [q.id]: { selected: 'custom', customText: prev[q.id]?.customText || '' }
                            }))}
                            className="sr-only"
                          />
                          <span className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-semibold mt-0.5 ${
                            aiQuestionAnswers[q.id]?.selected === 'custom'
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/40 text-muted-foreground'
                          }`}>
                            E
                          </span>
                          <div className="flex-1">
                            <span className="text-sm text-foreground">Other:</span>
                            {aiQuestionAnswers[q.id]?.selected === 'custom' && (
                              <input
                                type="text"
                                value={aiQuestionAnswers[q.id]?.customText || ''}
                                onChange={(e) => setAiQuestionAnswers(prev => ({
                                  ...prev,
                                  [q.id]: { selected: 'custom', customText: e.target.value }
                                }))}
                                placeholder="Type your answer..."
                                className="w-full mt-2 px-3 py-2 bg-background border border-border/60 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                autoFocus
                              />
                            )}
                          </div>
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleAIQuestionsComplete}
                  disabled={aiQuestions.some(q => !aiQuestionAnswers[q.id]?.selected)}
                  className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
                <button
                  onClick={() => {
                    // Skip questions and go directly to save
                    setShowAIQuestionsPage(false);
                    setShowSaveDialog(true);
                  }}
                  className="px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isDetectingVariables && setShowSaveDialog(false)} />
            <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-md w-full mx-4 animate-scale-in">
              <h2 className="text-xl font-semibold mb-2 text-card-foreground tracking-tight">Got it!</h2>
              <p className="text-sm text-muted-foreground mb-5">What should I call this task?</p>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder={`Task ${new Date().toLocaleString()}`}
                className="w-full px-4 py-3 bg-muted/30 border border-border/60 rounded-xl mb-4 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveWorkflow();
                  } else if (e.key === 'Escape') {
                    setShowSaveDialog(false);
                  }
                }}
              />

              {/* Skill Preview - What I'll Learn */}
              {workflowSteps.length > 0 && (
                <div className="mb-4 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800">
                  <h4 className="text-xs font-medium text-purple-800 dark:text-purple-200 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    What I'll Learn
                  </h4>

                  {/* Milestones */}
                  {(() => {
                    const milestones = synthesizeMilestones(workflowSteps);
                    return milestones.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {milestones.map((m, i) => (
                            <div key={i} className="flex items-center">
                              <span className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-800/50 text-purple-700 dark:text-purple-200 rounded-full">
                                {m.name}
                              </span>
                              {i < milestones.length - 1 && (
                                <svg className="w-3 h-3 text-purple-400 mx-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Detected Inputs */}
                  {currentWorkflowVariables && currentWorkflowVariables.variables.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-purple-600 dark:text-purple-300">Inputs: </span>
                      <span className="text-xs text-purple-800 dark:text-purple-100">
                        {currentWorkflowVariables.variables.map(v => v.fieldName).join(', ')}
                      </span>
                    </div>
                  )}

                  {/* Trigger Phrases */}
                  {workflowName.trim() && (
                    <div>
                      <span className="text-xs text-purple-600 dark:text-purple-300">Say: </span>
                      <span className="text-xs text-purple-800 dark:text-purple-100 italic">
                        "{suggestTriggerPhrases(workflowName)[0] || workflowName.toLowerCase()}"
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* AI Analysis Status */}
              <div className="mb-4 p-3 rounded-xl text-sm">
                {isAnalyzingWorkflow ? (
                  <div className="flex items-center gap-2 text-purple-700 bg-purple-50 border border-purple-200 rounded-xl p-3">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>AI is analyzing your workflow...</span>
                  </div>
                ) : currentWorkflowAIAnalysis ? (
                  <div className="flex items-center gap-2 text-purple-700 bg-purple-50 border border-purple-200 rounded-xl p-3">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      AI analysis ready: {currentWorkflowAIAnalysis.patterns.length} patterns, {currentWorkflowAIAnalysis.stepGuidance.length} step insights
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Basic analysis (AI service unavailable)</span>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSaveWorkflow}
                  className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft disabled:opacity-50 transition-all duration-200"
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
                  className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                  disabled={isDetectingVariables}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Post-Recording Processing Page */}
        {showPostRecordingOverlay && (
          <div className="mb-6">
            <div className="bg-card p-8 rounded-3xl border border-purple-200 shadow-soft max-w-sm w-full mx-auto animate-scale-in">
              {/* Animated AI Brain Icon */}
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-purple-500/20 rounded-full animate-ping" />
                  <div className="relative p-4 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full">
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                </div>
              </div>

              <h2 className="text-xl font-semibold text-center mb-2 text-card-foreground">AI is Thinking</h2>
              <p className="text-sm text-center text-muted-foreground mb-6">
                Analyzing your workflow to understand patterns and intent...
              </p>

              {/* Animated progress dots */}
              <div className="flex justify-center gap-2 mb-4">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>

              {/* Analysis steps indicator */}
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Recording captured</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Variables detected</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-purple-600 font-medium">AI analyzing intent and patterns...</span>
                </div>
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
            workflowMemory={pendingExecution.workflow.memory}
            onConfirm={handleVariableFormConfirm}
            onCancel={handleVariableFormCancel}
          />
        )}

        {/* Option Confirmation Modal (Fuzzy Matching) */}
        {optionConfirmation && optionConfirmation.show && (
          <OptionConfirmationModal
            userInput={optionConfirmation.userInput}
            matches={optionConfirmation.matches}
            allOptions={optionConfirmation.allOptions}
            fieldName={optionConfirmation.fieldName}
            onConfirm={handleOptionConfirm}
            onSkip={handleOptionSkip}
          />
        )}

        {/* Safety Confirmation Dialog (Gemini Computer Use) */}
        {safetyConfirmation.show && safetyConfirmation.decision && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-md w-full mx-4 animate-scale-in">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2.5 bg-amber-100 rounded-xl">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-card-foreground tracking-tight">Confirmation Required</h2>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                The AI wants to perform an action that may be sensitive:
              </p>

              <div className="bg-muted/50 p-4 rounded-xl mb-5">
                <p className="text-sm font-medium text-foreground mb-2">
                  {safetyConfirmation.actionDescription}
                </p>
                <p className="text-xs text-muted-foreground">
                  {safetyConfirmation.decision.explanation}
                </p>
              </div>

              <p className="text-xs text-muted-foreground mb-5">
                Please confirm you want to proceed with this action.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    safetyConfirmation.onConfirm?.();
                    setSafetyConfirmation({ show: false, decision: null, actionDescription: '', onConfirm: null, onDeny: null });
                  }}
                  className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
                >
                  Yes, Proceed
                </button>
                <button
                  onClick={() => {
                    safetyConfirmation.onDeny?.();
                    setSafetyConfirmation({ show: false, decision: null, actionDescription: '', onConfirm: null, onDeny: null });
                  }}
                  className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Refresh Warning Dialog */}
        {showRefreshDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleRefreshCancel} />
            <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-md w-full mx-4 animate-scale-in">
              <h2 className="text-xl font-semibold mb-4 text-card-foreground tracking-tight">Refresh Page to Start Recording</h2>
              <p className="text-sm text-muted-foreground mb-5">
                The page needs to be refreshed to initialize recording properly. Recording will start automatically after refresh. Any unsaved work may be lost. Continue?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleRefreshConfirm}
                  className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
                >
                  Continue
                </button>
                <button
                  onClick={handleRefreshCancel}
                  className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
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

        {/* User Context Modal */}
        <UserContextModal
          isOpen={showUserContextModal}
          initialValue={userContext}
          onSave={handleSaveUserContext}
          onClose={() => setShowUserContextModal(false)}
        />

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
            userContext={userContext}
            onEditUserContext={() => setShowUserContextModal(true)}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* Skills Library Modal */}
        {showSkillsLibrary && (
          <SkillsLibrary
            onClose={() => setShowSkillsLibrary(false)}
          />
        )}

        {/* Skill Teacher Modal (AI Orchestration) */}
        {showSkillTeacher && (
          <SkillTeacher
            onClose={() => {
              setShowSkillTeacher(false);
              if (isRecording) {
                handleStopRecording();
              }
              clearWorkflowSteps();
            }}
            onStartRecording={handleSkillRecordingStart}
            onStopRecording={handleSkillRecordingStop}
            isRecording={isRecording}
            recordedSteps={workflowSteps}
            onSkillSaved={handleSkillSaved}
          />
        )}

        </div>
      </div>
    </div>
  );
}

export default App;
