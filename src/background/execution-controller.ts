/**
 * Execution Controller - Centralized state management for agent execution
 * 
 * This service manages the execution lifecycle across all extension components:
 * - Persists state in chrome.storage.session (survives reloads)
 * - Coordinates between sidepanel, content script, and service worker
 * - Enables pause/resume from both user and agent
 * - Supports future features like human intervention
 */

import type { AgentState } from '../lib/ai-agent';

/** Reasons why execution might be paused */
export type PauseReason = 'user_requested' | 'agent_needs_help' | 'error_recovery' | 'confirmation_needed';

/** Context for when agent needs human help */
export interface HumanHelpContext {
  stepDescription: string;
  whatAgentTried: string;
  whatHumanShouldDo: string;
  errorDetails?: string;
}

/** Execution session state - persisted across reloads */
export interface ExecutionSession {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowSteps: any[]; // Store workflow steps for UI display
  status: 'running' | 'paused' | 'stopped' | 'waiting_for_human' | 'completed' | 'failed';
  currentStepIndex: number;
  totalSteps: number;
  pauseReason?: PauseReason;
  humanHelpContext?: HumanHelpContext;
  agentState?: AgentState; // Serializable snapshot of agent state
  tabId: number;
  startedAt: number;
  pausedAt?: number;
  completedAt?: number;
}

/** Storage key for execution session */
const EXECUTION_SESSION_KEY = 'execution_session';

/**
 * ExecutionController - Single source of truth for execution state
 */
export class ExecutionController {
  private session: ExecutionSession | null = null;
  private listeners: Set<(session: ExecutionSession | null) => void> = new Set();

  /**
   * Initialize controller and restore any existing session
   */
  async initialize(): Promise<void> {
    try {
      const stored = await chrome.storage.session.get(EXECUTION_SESSION_KEY);
      if (stored[EXECUTION_SESSION_KEY]) {
        this.session = stored[EXECUTION_SESSION_KEY] as ExecutionSession;
        console.log('[ExecutionController] Restored session:', this.session?.id);
      }
    } catch (error) {
      console.error('[ExecutionController] Failed to restore session:', error);
    }
  }

  /**
   * Save execution session to storage
   */
  async saveSession(session: ExecutionSession): Promise<void> {
    try {
      this.session = session;
      await chrome.storage.session.set({ [EXECUTION_SESSION_KEY]: session });
      console.log('[ExecutionController] Session saved:', session.id, 'status:', session.status);
      this.notifyListeners();
    } catch (error) {
      console.error('[ExecutionController] Failed to save session:', error);
      throw error;
    }
  }

  /**
   * Get current execution session
   */
  async getSession(): Promise<ExecutionSession | null> {
    // Return in-memory session if available, otherwise try to restore from storage
    if (this.session) {
      return this.session;
    }

    try {
      const stored = await chrome.storage.session.get(EXECUTION_SESSION_KEY);
      if (stored[EXECUTION_SESSION_KEY]) {
        this.session = stored[EXECUTION_SESSION_KEY] as ExecutionSession;
        return this.session;
      }
    } catch (error) {
      console.error('[ExecutionController] Failed to get session:', error);
    }

    return null;
  }

  /**
   * Clear execution session (called on completion/cancellation)
   */
  async clearSession(): Promise<void> {
    try {
      this.session = null;
      await chrome.storage.session.remove(EXECUTION_SESSION_KEY);
      console.log('[ExecutionController] Session cleared');
      this.notifyListeners();
    } catch (error) {
      console.error('[ExecutionController] Failed to clear session:', error);
    }
  }

  /**
   * Request pause of current execution
   */
  async requestPause(reason: PauseReason, helpContext?: HumanHelpContext): Promise<boolean> {
    const session = await this.getSession();
    if (!session) {
      console.warn('[ExecutionController] No active session to pause');
      return false;
    }

    if (session.status !== 'running') {
      console.warn('[ExecutionController] Cannot pause - not running (status:', session.status, ')');
      return false;
    }

    // Update session status
    session.status = helpContext ? 'waiting_for_human' : 'paused';
    session.pauseReason = reason;
    session.pausedAt = Date.now();
    
    if (helpContext) {
      session.humanHelpContext = helpContext;
    }

    await this.saveSession(session);
    
    // Notify content script to pause agent
    try {
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'EXECUTION_CONTROL',
        payload: {
          action: 'pause',
          reason,
        },
      });
    } catch (error) {
      console.error('[ExecutionController] Failed to notify content script:', error);
    }

    return true;
  }

  /**
   * Request resume of paused/stopped execution
   */
  async requestResume(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) {
      console.warn('[ExecutionController] No session to resume');
      return false;
    }

    // Allow resuming from paused, stopped, or waiting_for_human
    if (session.status !== 'paused' && session.status !== 'stopped' && session.status !== 'waiting_for_human') {
      console.warn('[ExecutionController] Cannot resume - invalid status:', session.status);
      return false;
    }

    // Update session status
    console.log('[ExecutionController] Resuming session, changing status from', session.status, 'to running');
    session.status = 'running';
    session.pauseReason = undefined;
    session.pausedAt = undefined;
    session.humanHelpContext = undefined;

    await this.saveSession(session);
    
    console.log('[ExecutionController] Session saved with status: running, broadcasting...');
    this.broadcastStatus(session);

    // Notify content script to resume agent
    try {
      console.log('[ExecutionController] Sending EXECUTION_CONTROL resume to tab:', session.tabId);
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'EXECUTION_CONTROL',
        payload: {
          action: 'resume',
        },
      });
      console.log('[ExecutionController] Resume message sent successfully');
    } catch (error) {
      console.error('[ExecutionController] Failed to notify content script:', error);
      return false;
    }

    return true;
  }

  /**
   * Request stop of current execution
   */
  async requestStop(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) {
      console.warn('[ExecutionController] No session to stop');
      return false;
    }

    // Update session status
    session.status = 'stopped';
    session.completedAt = Date.now();

    await this.saveSession(session);

    // Notify content script to stop agent
    try {
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'EXECUTION_CONTROL',
        payload: {
          action: 'stop',
        },
      });
    } catch (error) {
      console.error('[ExecutionController] Failed to notify content script:', error);
    }

    // Clear session after a delay (to allow UI to show final state)
    setTimeout(() => this.clearSession(), 1000);

    return true;
  }

  /**
   * Update session progress
   */
  async updateProgress(stepIndex: number, agentState?: AgentState): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      console.warn('[ExecutionController] No session to update');
      return;
    }

    session.currentStepIndex = stepIndex;
    if (agentState) {
      session.agentState = agentState;
    }

    await this.saveSession(session);
    
    // Broadcast progress update to UI
    this.broadcastStatus(session);
  }

  /**
   * Mark execution as completed
   */
  async markCompleted(success: boolean): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      return;
    }

    session.status = success ? 'completed' : 'failed';
    session.completedAt = Date.now();

    await this.saveSession(session);
    
    // CRITICAL: Broadcast the completion status to UI
    this.broadcastStatus(session);

    // Clear session after a delay
    setTimeout(() => this.clearSession(), 3000);
  }

  /**
   * Broadcast session state to all listeners
   */
  broadcastStatus(session: ExecutionSession | null): void {
    console.log('[ExecutionController] Broadcasting status:', {
      hasSession: !!session,
      sessionId: session?.id,
      status: session?.status,
      currentStep: session?.currentStepIndex,
      totalSteps: session?.totalSteps,
    });
    
    // Send to sidepanel (if open)
    chrome.runtime.sendMessage({
      type: 'EXECUTION_STATE_CHANGED',
      session,
    }).catch((err) => {
      console.warn('[ExecutionController] Failed to broadcast (sidepanel might not be open):', err);
    });

    this.notifyListeners();
  }

  /**
   * Add listener for session changes (for local use in service worker)
   */
  addListener(listener: (session: ExecutionSession | null) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove listener
   */
  removeListener(listener: (session: ExecutionSession | null) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Notify all registered listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.session);
      } catch (error) {
        console.error('[ExecutionController] Listener error:', error);
      }
    });
  }

  /**
   * Create a new execution session
   */
  async createSession(params: {
    workflowId: string;
    workflowName: string;
    workflowSteps: any[];
    totalSteps: number;
    tabId: number;
    agentState: AgentState;
  }): Promise<ExecutionSession> {
    const session: ExecutionSession = {
      id: `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      workflowSteps: params.workflowSteps,
      status: 'running',
      currentStepIndex: 0,
      totalSteps: params.totalSteps,
      tabId: params.tabId,
      startedAt: Date.now(),
      agentState: params.agentState,
    };

    await this.saveSession(session);
    this.broadcastStatus(session);

    return session;
  }
}

// Singleton instance
let controllerInstance: ExecutionController | null = null;

/**
 * Get the singleton ExecutionController instance
 */
export function getExecutionController(): ExecutionController {
  if (!controllerInstance) {
    controllerInstance = new ExecutionController();
  }
  return controllerInstance;
}
