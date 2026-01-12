/**
 * Message types for communication between Side Panel, Background, and Content Scripts
 */
export type MessageType = 
  | 'PING' 
  | 'PONG'
  | 'START_RECORDING' 
  | 'STOP_RECORDING' 
  | 'EXECUTE_STEP'
  | 'RECORDED_STEP'
  | 'UPDATE_STEP'
  | 'AI_VALIDATION_STARTED'
  | 'AI_VALIDATION_COMPLETED'
  | 'STEP_ENHANCED'
  | 'ANALYZE_WORKFLOW'
  // Unified workflow execution - all three handled by same engine
  | 'EXECUTE_WORKFLOW'
  | 'EXECUTE_WORKFLOW_ADAPTIVE'  // @deprecated - alias for EXECUTE_WORKFLOW
  | 'EXECUTE_WORKFLOW_VERIFIED'  // @deprecated - alias for EXECUTE_WORKFLOW
  | 'EXECUTE_WORKFLOW_UNIVERSAL' // New Universal Execution Engine (v2)
  | 'EXECUTE_WORKFLOW_AGENT' // AI Agent execution mode (observe-act loop)
  // AI Agent progress messages
  | 'AGENT_PROGRESS'
  | 'AGENT_THINKING'
  | 'AGENT_EXECUTION_COMPLETED'
  | 'STOP_AGENT'   // Stop running AI agent execution
  | 'RESUME_AGENT' // Resume stopped AI agent execution
  // Centralized execution control
  | 'EXECUTION_CONTROL'  // Control execution (pause/resume/stop) via service worker
  | 'GET_EXECUTION_STATE' // Get current execution state
  | 'EXECUTION_STATE_CHANGED' // Broadcast when execution state changes
  | 'EXECUTION_STARTED' // Notify when execution starts
  | 'EXECUTION_PROGRESS' // Update execution progress
  | 'EXECUTION_COMPLETED' // Mark execution as completed
  // Execution progress and control messages
  | 'VERIFIED_EXECUTION_CANCEL'
  | 'VERIFIED_EXECUTION_STARTED'
  | 'VERIFIED_STEP_STARTED'
  | 'VERIFIED_STEP_COMPLETED'
  | 'VERIFIED_STEP_FAILED'
  | 'VERIFIED_EXECUTION_COMPLETED'
  | 'VERIFIED_DISAMBIGUATE_REQUEST'
  | 'VERIFIED_DISAMBIGUATE_RESPONSE'
  | 'CAPTURE_VIEWPORT'
  | 'CORRECTION_SAVED'
  | 'ELEMENT_FIND_FAILED'
  | 'CANCEL_CORRECTION'
  | 'GET_INITIAL_SNAPSHOT'
  | 'GET_COLUMN_HEADERS'
  | 'REFRESH_PAGE'
  | 'GET_ZOOM'
  | 'SET_ZOOM'
  | 'GET_FRAME_ID'
  | 'TAB_SWITCHED'
  | 'START_RECORDING_IN_TAB'
  | 'STOP_RECORDING_IN_TAB'
  | 'ADD_TAB'
  | 'RESUME_RECORDING'
  | 'DEBUGGER_CLICK'
  | 'DEBUGGER_DETACH'
  | 'EXECUTE_ACTION_IN_FRAME' // Cross-frame execution - execute action in specific iframe
  | 'FRAME_ACTION_COMPLETED' // Response from iframe after action execution
  | 'START_RECORDING_ALL_FRAMES' // Broadcast to all frames to start recording
  | 'STOP_RECORDING_ALL_FRAMES' // Broadcast to all frames to stop recording
  | 'GET_IFRAME_DOM_MAP' // Request DOM map from an iframe
  | 'IFRAME_DOM_MAP_RESPONSE' // Response with DOM map from iframe
  | 'EXECUTE_IN_FRAME' // Route action execution through service worker to specific frame
  | 'ACTIVATE_TAB' // Switch to a specific tab during multi-tab execution
  | 'CREATE_TAB' // Create a new tab during multi-tab execution
  | 'NAVIGATE_TAB' // Navigate a tab to a URL during multi-tab execution
  | 'GET_CURRENT_TAB_ID' // Get the current tab's ID (from service worker)
  // TabManager state operations (routed through service worker for reliability)
  | 'GET_TAB_MANAGER_STATE' // Get tab manager state from storage
  | 'SET_TAB_MANAGER_STATE' // Save tab manager state to storage
  | 'CLEAR_TAB_MANAGER_STATE'; // Clear tab manager state from storage

/**
 * Base message interface for all extension messages
 */
export interface ExtensionMessage {
  type: MessageType;
  payload?: any;
}

/**
 * Response interface for message handlers
 */
export interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
  frameId?: number; // For GET_FRAME_ID response
  state?: any; // For STOP_AGENT response (AgentState)
}

/**
 * PING message - used for handshake verification
 */
export interface PingMessage extends ExtensionMessage {
  type: 'PING';
  payload?: {
    timestamp: number;
  };
}

/**
 * PONG message - response to PING
 */
export interface PongMessage extends ExtensionMessage {
  type: 'PONG';
  payload: {
    timestamp: number;
    ready: boolean;
  };
}

/**
 * START_RECORDING message
 */
export interface StartRecordingMessage extends ExtensionMessage {
  type: 'START_RECORDING';
  payload?: {
    options?: Record<string, any>;
  };
}

/**
 * STOP_RECORDING message
 */
export interface StopRecordingMessage extends ExtensionMessage {
  type: 'STOP_RECORDING';
  payload?: {
    save?: boolean;
  };
}

/**
 * EXECUTE_STEP message
 */
export interface ExecuteStepMessage extends ExtensionMessage {
  type: 'EXECUTE_STEP';
  payload: {
    step: any;
    index?: number;
  };
}

/**
 * RECORDED_STEP message - sent from content script to side panel
 */
export interface RecordedStepMessage extends ExtensionMessage {
  type: 'RECORDED_STEP';
  payload: {
    step: import('./workflow').WorkflowStep;
    tabUrl?: string; // Tab URL where step was recorded (not tabId)
    tabTitle?: string; // Tab title for context
    tabIndex?: number; // Logical tab index (0, 1, 2...)
  };
}

/**
 * UPDATE_STEP message - sent from content script to side panel to update an existing step
 */
export interface UpdateStepMessage extends ExtensionMessage {
  type: 'UPDATE_STEP';
  payload: {
    stepId: string;
    step: import('./workflow').WorkflowStep;
  };
}

/**
 * AI_VALIDATION_STARTED message - sent when AI validation begins for a step
 */
export interface AIValidationStartedMessage extends ExtensionMessage {
  type: 'AI_VALIDATION_STARTED';
  payload: {
    stepId: string;
  };
}

/**
 * AI_VALIDATION_COMPLETED message - sent when AI validation completes (with or without enhancements)
 */
export interface AIValidationCompletedMessage extends ExtensionMessage {
  type: 'AI_VALIDATION_COMPLETED';
  payload: {
    stepId: string;
    enhanced: boolean;
  };
}

/**
 * STEP_ENHANCED message - sent when a step has been enhanced with AI suggestions
 */
export interface StepEnhancedMessage extends ExtensionMessage {
  type: 'STEP_ENHANCED';
  payload: {
    stepId: string;
  };
}

/**
 * ANALYZE_WORKFLOW message - request AI analysis of workflow
 */
export interface AnalyzeWorkflowMessage extends ExtensionMessage {
  type: 'ANALYZE_WORKFLOW';
  payload: {
    steps: import('./workflow').WorkflowStep[];
  };
}

/**
 * @deprecated - Use EXECUTE_WORKFLOW_UNIVERSAL instead
 * EXECUTE_WORKFLOW_ADAPTIVE message - execute workflow with intent
 */
export interface ExecuteWorkflowAdaptiveMessage extends ExtensionMessage {
  type: 'EXECUTE_WORKFLOW_ADAPTIVE';
  payload: {
    steps: import('./workflow').WorkflowStep[];
    intent?: import('./workflow').WorkflowIntent;
    // Variable substitution support
    variableValues?: Record<string, string>;
    workflowVariables?: import('../lib/variable-detector').WorkflowVariables;
  };
}

/**
 * EXECUTE_WORKFLOW_UNIVERSAL message - execute workflow using new Universal Execution Engine
 * This is the recommended way to execute workflows - handles clicks, dropdowns, and all UI patterns
 */
export interface ExecuteWorkflowUniversalMessage extends ExtensionMessage {
  type: 'EXECUTE_WORKFLOW_UNIVERSAL';
  payload: {
    steps: import('./workflow').WorkflowStep[];
    workflowId: string;
    variableValues?: Record<string, string>;
  };
}

/**
 * CORRECTION_SAVED message - sent when a user correction is saved
 */
export interface CorrectionSavedMessage extends ExtensionMessage {
  type: 'CORRECTION_SAVED';
  payload?: {
    correctionId?: string;
  };
}

/**
 * ELEMENT_FIND_FAILED message - sent when element finding fails
 */
export interface ElementFindFailedMessage extends ExtensionMessage {
  type: 'ELEMENT_FIND_FAILED';
  payload: {
    stepId: string;
  };
}

/**
 * CANCEL_CORRECTION message - sent to cancel correction mode
 */
export interface CancelCorrectionMessage extends ExtensionMessage {
  type: 'CANCEL_CORRECTION';
  payload?: {};
}

/**
 * REFRESH_PAGE message - sent to refresh the page (for spreadsheets to capture headers)
 */
export interface RefreshPageMessage extends ExtensionMessage {
  type: 'REFRESH_PAGE';
  payload?: {};
}

/**
 * GET_ZOOM message - get current zoom level of the tab
 */
export interface GetZoomMessage extends ExtensionMessage {
  type: 'GET_ZOOM';
  payload?: {};
}

/**
 * SET_ZOOM message - set zoom level of the tab
 */
export interface SetZoomMessage extends ExtensionMessage {
  type: 'SET_ZOOM';
  payload: {
    zoomFactor: number;
    tabId?: number;
  };
}

/**
 * GET_FRAME_ID message - request frame ID from service worker
 */
export interface GetFrameIdMessage extends ExtensionMessage {
  type: 'GET_FRAME_ID';
  payload?: {};
}

/**
 * TAB_SWITCHED message - sent from service worker to sidepanel when user switches tabs during recording
 */
export interface TabSwitchedMessage extends ExtensionMessage {
  type: 'TAB_SWITCHED';
  payload: {
    fromUrl: string;
    toUrl: string;
    fromTitle?: string;
    toTitle?: string;
    fromTabIndex?: number;
    toTabIndex?: number;
    timestamp: number;
  };
}

/**
 * START_RECORDING_IN_TAB message - internal message for service worker to coordinate recording in specific tab
 */
export interface StartRecordingInTabMessage extends ExtensionMessage {
  type: 'START_RECORDING_IN_TAB';
  payload: {
    tabId: number; // Runtime-only, not persisted
    tabUrl: string;
    tabTitle?: string;
    tabIndex?: number; // Logical tab index (0, 1, 2...)
  };
}

/**
 * STOP_RECORDING_IN_TAB message - internal message for service worker to stop recording in specific tab
 */
export interface StopRecordingInTabMessage extends ExtensionMessage {
  type: 'STOP_RECORDING_IN_TAB';
  payload: {
    tabId: number; // Runtime-only, not persisted
  };
}

/**
 * ADD_TAB message - sent from sidepanel to service worker to pause recording and open new tab
 */
export interface AddTabMessage extends ExtensionMessage {
  type: 'ADD_TAB';
}

/**
 * RESUME_RECORDING message - sent from sidepanel to service worker to resume recording in current tab
 */
export interface ResumeRecordingMessage extends ExtensionMessage {
  type: 'RESUME_RECORDING';
  payload: {
    tabId: number;
    tabUrl: string;
    tabTitle?: string;
    fromUrl: string; // Last recorded tab URL
    fromTabIndex?: number; // Logical index of source tab
    toTabIndex?: number; // Logical index of target tab (will be assigned)
  };
}

/**
 * START_RECORDING_ALL_FRAMES message - broadcast to all frames to start recording
 */
export interface StartRecordingAllFramesMessage extends ExtensionMessage {
  type: 'START_RECORDING_ALL_FRAMES';
  payload?: {
    options?: Record<string, any>;
  };
}

/**
 * STOP_RECORDING_ALL_FRAMES message - broadcast to all frames to stop recording
 */
export interface StopRecordingAllFramesMessage extends ExtensionMessage {
  type: 'STOP_RECORDING_ALL_FRAMES';
  payload?: {};
}

/**
 * GET_IFRAME_DOM_MAP message - request DOM map from an iframe
 */
export interface GetIframeDOMMapMessage extends ExtensionMessage {
  type: 'GET_IFRAME_DOM_MAP';
  payload?: {};
}

/**
 * IFRAME_DOM_MAP_RESPONSE message - response with DOM map from iframe
 */
export interface IframeDOMMapResponseMessage extends ExtensionMessage {
  type: 'IFRAME_DOM_MAP_RESPONSE';
  payload: {
    frameId: number;
    domMap: any; // DOMMap type from dom-map.ts
  };
}

/**
 * EXECUTE_IN_FRAME message - route action execution through service worker to specific frame
 */
export interface ExecuteInFrameMessage extends ExtensionMessage {
  type: 'EXECUTE_IN_FRAME';
  payload: {
    action: any; // AgentAction type
    targetFrameId: number;
  };
}

/**
 * ThinkingEvent - represents AI agent's chain of thought during execution
 */
export interface ThinkingEvent {
  type: 'observe' | 'decide' | 'act' | 'recover' | 'complete';
  timestamp: number;
  stepIndex: number;
  stepTotal: number;
  
  // For 'observe' phase
  observation?: {
    url: string;
    pageTitle: string;
    hasModal: boolean;
    hasDropdown: boolean;
    elementsFound: number;
  };
  
  // For 'decide' phase
  decision?: {
    action: string;
    targetDescription: string;
    reasoning: string;
    confidence: number;
    candidates?: Array<{ role: string; name: string; score: number }>;
  };
  
  // For 'act' phase
  result?: {
    success: boolean;
    error?: string;
    duration: number;
  };
}

/**
 * AGENT_THINKING message - sent from agent to show chain of thought during execution
 */
export interface AgentThinkingMessage extends ExtensionMessage {
  type: 'AGENT_THINKING';
  payload: ThinkingEvent;
}

