import { useState } from 'react';
import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

interface WorkflowDetailsProps {
  workflow: SavedWorkflow;
  onExecute: () => void;
  onBack: () => void;
  onExport: () => void;
  onDelete: () => void;
  onSave: (updatedWorkflow: SavedWorkflow) => void;
  isExecuting: boolean;
}

export function WorkflowDetails({
  workflow,
  onExecute,
  onBack,
  onExport,
  onDelete,
  onSave,
  isExecuting,
}: WorkflowDetailsProps) {
  // Editing state
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  
  // Temporary edit values
  const [editedName, setEditedName] = useState(workflow.name);
  const [editedDescription, setEditedDescription] = useState(workflow.description || '');
  const [editedInstructions, setEditedInstructions] = useState(workflow.additionalInstructions || '');
  const [editedSteps, setEditedSteps] = useState<Map<number, string>>(new Map());
  
  // Track if there are unsaved changes
  const hasChanges = 
    editedName !== workflow.name ||
    editedDescription !== (workflow.description || '') ||
    editedInstructions !== (workflow.additionalInstructions || '') ||
    editedSteps.size > 0;
  
  const handleSave = () => {
    // Build updated workflow
    const updatedSteps = workflow.steps.map((step, index) => {
      const editedIntent = editedSteps.get(index);
      if (editedIntent !== undefined) {
        return {
          ...step,
          naturalLanguage: {
            ...(step.naturalLanguage || {
              intent: '',
              precondition: '',
              expectedOutcome: '',
              dependencies: [],
            }),
            intent: editedIntent,
            userEdited: true,
          },
        };
      }
      return step;
    });
    
    const updatedWorkflow: SavedWorkflow = {
      ...workflow,
      name: editedName,
      description: editedDescription || undefined,
      additionalInstructions: editedInstructions || undefined,
      steps: updatedSteps,
      updatedAt: Date.now(),
    };
    
    onSave(updatedWorkflow);
    
    // Clear editing state
    setEditingName(false);
    setEditingDescription(false);
    setEditingInstructions(false);
    setEditingStepIndex(null);
    setEditedSteps(new Map());
  };
  
  const handleCancel = () => {
    // Reset to original values
    setEditedName(workflow.name);
    setEditedDescription(workflow.description || '');
    setEditedInstructions(workflow.additionalInstructions || '');
    setEditedSteps(new Map());
    setEditingName(false);
    setEditingDescription(false);
    setEditingInstructions(false);
    setEditingStepIndex(null);
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

  return (
    <div className="mb-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          title="Back to home"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {editingName ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setEditingName(false);
              if (e.key === 'Escape') {
                setEditedName(workflow.name);
                setEditingName(false);
              }
            }}
            className="flex-1 text-xl font-semibold text-foreground bg-background border border-border rounded px-2 py-1"
            autoFocus
          />
        ) : (
          <h2 className="text-xl font-semibold text-foreground flex-1">
            {editedName}
          </h2>
        )}
        {!editingName && (
          <button
            onClick={() => setEditingName(true)}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            title="Edit name"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}
      </div>

      {/* Workflow description */}
      <div className="mb-4 p-4 bg-muted/50 rounded-lg border border-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground">What this workflow does</h3>
          {!editingDescription && (
            <button
              onClick={() => setEditingDescription(true)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Edit description"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
        {editingDescription ? (
          <textarea
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            onBlur={() => setEditingDescription(false)}
            className="w-full text-sm text-foreground bg-background border border-border rounded px-2 py-1 min-h-[60px]"
            autoFocus
            placeholder="Describe what this workflow does..."
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {editedDescription || 'No description'}
          </p>
        )}
      </div>

      {/* Additional Instructions - NEW */}
      <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100">Additional Instructions</h3>
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded">
              AI will see this
            </span>
          </div>
          {!editingInstructions && (
            <button
              onClick={() => setEditingInstructions(true)}
              className="p-1 text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
              title="Edit instructions"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
        {editingInstructions ? (
          <textarea
            value={editedInstructions}
            onChange={(e) => setEditedInstructions(e.target.value)}
            onBlur={() => setEditingInstructions(false)}
            className="w-full text-sm text-foreground bg-background border border-amber-300 dark:border-amber-600 rounded px-2 py-1 min-h-[80px]"
            autoFocus
            placeholder="Add tips, edge cases, or context for the AI (e.g., 'Always wait 2 seconds after clicking Submit')"
          />
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {editedInstructions || 'No additional instructions - click to add tips for the AI'}
          </p>
        )}
      </div>

      {/* Steps list */}
      <div className="mb-4 p-4 bg-card rounded-lg border border-border">
        <h3 className="text-sm font-medium text-foreground mb-3">
          Steps ({workflow.steps.length})
        </h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {workflow.steps.map((step, index) => {
            const isEditing = editingStepIndex === index;
            const currentDescription = editedSteps.get(index) ?? getHumanDescription(step);
            
            return (
              <div 
                key={index} 
                className="py-2 px-3 bg-muted/30 rounded border border-border/50 text-sm flex items-start gap-2"
              >
                <span className="text-muted-foreground flex-shrink-0 font-medium">
                  {index + 1}.
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={currentDescription}
                    onChange={(e) => {
                      const newMap = new Map(editedSteps);
                      newMap.set(index, e.target.value);
                      setEditedSteps(newMap);
                    }}
                    onBlur={() => setEditingStepIndex(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setEditingStepIndex(null);
                      if (e.key === 'Escape') {
                        const newMap = new Map(editedSteps);
                        newMap.delete(index);
                        setEditedSteps(newMap);
                        setEditingStepIndex(null);
                      }
                    }}
                    className="flex-1 text-foreground bg-background border border-border rounded px-2 py-1"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-foreground">
                    {currentDescription}
                  </span>
                )}
                {!isEditing && (
                  <button
                    onClick={() => setEditingStepIndex(index)}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                    title="Edit step description"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Variables info if present */}
      {workflow.variables && workflow.variables.variables.length > 0 && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
          <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
            Variables ({workflow.variables.variables.length})
          </h3>
          <div className="space-y-1">
            {workflow.variables.variables.map((variable, index) => (
              <div key={index} className="text-sm text-blue-800 dark:text-blue-200">
                • {variable.variableName || variable.fieldName}
              </div>
            ))}
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
            You'll be prompted to provide values when you run this workflow
          </p>
        </div>
      )}

      {/* Metadata */}
      <div className="mb-4 p-3 bg-muted/30 rounded border border-border">
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Created: {new Date(workflow.createdAt).toLocaleString()}</div>
          {workflow.updatedAt !== workflow.createdAt && (
            <div>Updated: {new Date(workflow.updatedAt).toLocaleString()}</div>
          )}
          {workflow.executionStats && (
            <div>
              Runs: {workflow.executionStats.successfulRuns}/{workflow.executionStats.totalRuns} successful
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        {hasChanges && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Save Changes
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        
        <button
          onClick={onExecute}
          disabled={isExecuting || hasChanges}
          className="w-full px-4 py-3 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExecuting ? 'Running...' : hasChanges ? 'Save changes to run' : 'Run this workflow'}
        </button>
        
        <div className="flex gap-2">
          <button
            onClick={onExport}
            disabled={isExecuting}
            className="flex-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/90 transition-colors disabled:opacity-50"
            title="Export as JSON"
          >
            Export
          </button>
          <button
            onClick={onDelete}
            disabled={isExecuting}
            className="flex-1 px-3 py-2 bg-destructive text-destructive-foreground rounded-md text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50"
            title="Delete workflow"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
