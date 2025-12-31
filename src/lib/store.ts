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
      const isDuplicate = state.workflowSteps.some(
        (existingStep) => Math.abs(existingStep.payload.timestamp - stepTimestamp) < 100
      );
      
      if (isDuplicate) {
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

  reset: () => {
    set({
      ...initialState,
      workflowSteps: [],
      savedWorkflows: [],
      pendingAIValidations: new Set<string>(),
      enhancedSteps: new Set<string>(),
      currentWorkflowName: null,
      isRecording: false,
      executionMode: 'auto',
    });
  },
}));

