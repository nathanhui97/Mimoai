import { create } from 'zustand';
import type { ExtensionState, ExtensionStateData, ConnectionStatus } from '../types/state';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';

interface ExtensionStore extends ExtensionStateData {
  // Workflow state
  workflowSteps: WorkflowStep[];
  savedWorkflows: SavedWorkflow[];
  currentWorkflowName: string | null;
  isRecording: boolean;
  executionMode: 'exact' | 'adaptive' | 'auto';
  
  // AI validation state
  pendingAIValidations: Set<string>; // Set of stepIds being validated
  enhancedSteps: Set<string>; // Set of stepIds that have been enhanced with AI

  // Multi-tab recording state
  recordedTabs: Map<number, { url: string; title: string; stepCount: number }>;
  excludedTabIndices: Set<number>; // Tabs user wants to exclude

  // Actions
  setState: (state: ExtensionState) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  setLastPingTime: (timestamp: number | null) => void;
  addWorkflowStep: (step: WorkflowStep) => void;
  updateWorkflowStep: (stepId: string, step: WorkflowStep) => void;
  setWorkflowSteps: (steps: WorkflowStep[]) => void;
  clearWorkflowSteps: () => void;
  loadWorkflow: (workflow: SavedWorkflow) => void;
  setSavedWorkflows: (workflows: SavedWorkflow[]) => void;
  addSavedWorkflow: (workflow: SavedWorkflow) => void;
  removeSavedWorkflow: (id: string) => void;
  setCurrentWorkflowName: (name: string | null) => void;
  setIsRecording: (recording: boolean) => void;
  setExecutionMode: (mode: 'exact' | 'adaptive' | 'auto') => void;
  setAIValuationPending: (stepId: string, pending: boolean) => void;
  setStepEnhanced: (stepId: string) => void;
  addRecordedTab: (tabIndex: number, url: string, title: string) => void;
  incrementTabStepCount: (tabIndex: number) => void;
  toggleTabExclusion: (tabIndex: number) => void;
  removeWorkflowStep: (index: number) => void;
  reset: () => void;
}

const initialState: ExtensionStateData = {
  state: 'IDLE',
  connectionStatus: 'disconnected',
  error: null,
  lastPingTime: null,
};

export const useExtensionStore = create<ExtensionStore>((set) => ({
  ...initialState,

  // Workflow state
  workflowSteps: [],
  savedWorkflows: [],
  currentWorkflowName: null,
  isRecording: false,
  executionMode: 'auto', // Default to auto-detect
  
  // AI validation state
  pendingAIValidations: new Set<string>(),
  enhancedSteps: new Set<string>(),

  // Multi-tab recording state
  recordedTabs: new Map<number, { url: string; title: string; stepCount: number }>(),
  excludedTabIndices: new Set<number>(),

  setState: (state: ExtensionState) => {
    set({ state, error: null }); // Clear error when state changes
  },

  setConnectionStatus: (status: ConnectionStatus) => {
    set({ connectionStatus: status });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  setLastPingTime: (timestamp: number | null) => {
    set({ lastPingTime: timestamp });
  },

  addWorkflowStep: (step: WorkflowStep) => {
    set((state) => {
      // Prevent duplicate steps based on timestamp (within 100ms window)
      const stepTimestamp = step.payload.timestamp;
      const existingIndex = state.workflowSteps.findIndex(
        (existingStep) => Math.abs(existingStep.payload.timestamp - stepTimestamp) < 100
      );
      
      if (existingIndex >= 0) {
        const existing = state.workflowSteps[existingIndex];
        
        // Check if new step has more complete data (e.g., dropdown options)
        const hasMoreData = (step.payload as any).context?.decisionSpace?.options?.length > 0 &&
                           !(existing.payload as any).context?.decisionSpace?.options;
        
        if (hasMoreData) {
          console.log('[Store] Updating duplicate step with more complete data:', step.type, stepTimestamp);
          const updated = [...state.workflowSteps];
          updated[existingIndex] = step; // Replace with more complete version
          return { workflowSteps: updated };
        }
        
        console.warn('[Store] Prevented duplicate step addition:', step.type, stepTimestamp);
        return state; // Return unchanged state
      }
      
      return {
        workflowSteps: [...state.workflowSteps, step],
      };
    });
  },

  updateWorkflowStep: (stepId: string, step: WorkflowStep) => {
    set((state) => {
      // Use timestamp as identifier (steps don't have id field)
      const index = state.workflowSteps.findIndex((s) => s.payload.timestamp.toString() === stepId);
      if (index >= 0) {
        const updated = [...state.workflowSteps];
        updated[index] = step;
        return { workflowSteps: updated };
      }
      return state; // Step not found, no update
    });
  },

  setWorkflowSteps: (steps: WorkflowStep[]) => {
    set({ workflowSteps: steps });
  },

  clearWorkflowSteps: () => {
    set({ 
      workflowSteps: [], 
      currentWorkflowName: null,
      pendingAIValidations: new Set<string>(),
      enhancedSteps: new Set<string>(),
      recordedTabs: new Map<number, { url: string; title: string; stepCount: number }>(),
      excludedTabIndices: new Set<number>(),
    });
  },

  loadWorkflow: (workflow: SavedWorkflow) => {
    set({
      workflowSteps: workflow.steps,
      currentWorkflowName: workflow.name,
    });
  },

  setSavedWorkflows: (workflows: SavedWorkflow[]) => {
    set({ savedWorkflows: workflows });
  },

  addSavedWorkflow: (workflow: SavedWorkflow) => {
    set((state) => {
      const existing = state.savedWorkflows.findIndex((w) => w.id === workflow.id);
      if (existing >= 0) {
        // Update existing
        const updated = [...state.savedWorkflows];
        updated[existing] = workflow;
        return { savedWorkflows: updated };
      }
      // Add new
      return { savedWorkflows: [...state.savedWorkflows, workflow] };
    });
  },

  removeSavedWorkflow: (id: string) => {
    set((state) => ({
      savedWorkflows: state.savedWorkflows.filter((w) => w.id !== id),
    }));
  },

  setCurrentWorkflowName: (name: string | null) => {
    set({ currentWorkflowName: name });
  },

  setIsRecording: (recording: boolean) => {
    set({ isRecording: recording });
  },

  setExecutionMode: (mode: 'exact' | 'adaptive' | 'auto') => {
    set({ executionMode: mode });
  },

  setAIValuationPending: (stepId: string, pending: boolean) => {
    set((state) => {
      const newPending = new Set(state.pendingAIValidations);
      if (pending) {
        newPending.add(stepId);
      } else {
        newPending.delete(stepId);
      }
      return { pendingAIValidations: newPending };
    });
  },

  setStepEnhanced: (stepId: string) => {
    set((state) => {
      const newEnhanced = new Set(state.enhancedSteps);
      newEnhanced.add(stepId);
      // Remove from pending when enhanced
      const newPending = new Set(state.pendingAIValidations);
      newPending.delete(stepId);
      return { 
        enhancedSteps: newEnhanced,
        pendingAIValidations: newPending
      };
    });
  },

  addRecordedTab: (tabIndex: number, url: string, title: string) => {
    set((state) => {
      const newTabs = new Map(state.recordedTabs);
      const existing = newTabs.get(tabIndex);
      if (existing) {
        // Tab already exists, just update info
        newTabs.set(tabIndex, { ...existing, url, title });
      } else {
        // New tab
        newTabs.set(tabIndex, { url, title, stepCount: 0 });
      }
      return { recordedTabs: newTabs };
    });
  },

  incrementTabStepCount: (tabIndex: number) => {
    set((state) => {
      const newTabs = new Map(state.recordedTabs);
      const existing = newTabs.get(tabIndex);
      if (existing) {
        newTabs.set(tabIndex, { ...existing, stepCount: existing.stepCount + 1 });
      }
      return { recordedTabs: newTabs };
    });
  },

  toggleTabExclusion: (tabIndex: number) => {
    set((state) => {
      const newExcluded = new Set(state.excludedTabIndices);
      if (newExcluded.has(tabIndex)) {
        newExcluded.delete(tabIndex);
      } else {
        newExcluded.add(tabIndex);
      }
      return { excludedTabIndices: newExcluded };
    });
  },

  removeWorkflowStep: (index: number) => {
    set((state) => {
      const newSteps = state.workflowSteps.filter((_, i) => i !== index);
      return { workflowSteps: newSteps };
    });
  },

  reset: () => {
    set({
      ...initialState,
      workflowSteps: [],
      savedWorkflows: [],
      pendingAIValidations: new Set<string>(),
      enhancedSteps: new Set<string>(),
      recordedTabs: new Map<number, { url: string; title: string; stepCount: number }>(),
      excludedTabIndices: new Set<number>(),
      currentWorkflowName: null,
      isRecording: false,
      executionMode: 'auto',
    });
  },
}));

