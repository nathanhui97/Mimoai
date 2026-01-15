/**
 * Post-Recording Confirmation Component
 *
 * A simple confirmation UI that replaces the complex chat-based flow.
 * Shows workflow name input, spreadsheet column naming, and collapsible steps.
 */

import { useState, useMemo } from 'react';
import type { WorkflowStep } from '../types/workflow';
import { VariableDetector } from '../lib/variable-detector';
import { isWorkflowStepPayload } from '../types/workflow';

interface PostRecordingConfirmProps {
  workflowSteps: WorkflowStep[];
  suggestedName: string;
  onSave: (name: string, editedVariables: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Get human-readable description for a step
 */
function getStepDescription(step: WorkflowStep): string {
  if (step.naturalLanguage?.intent) {
    return step.naturalLanguage.intent;
  }

  if (!isWorkflowStepPayload(step.payload)) {
    return step.description || step.type;
  }

  const payload = step.payload;

  switch (step.type) {
    case 'CLICK':
      return `Click "${payload.elementText || payload.label || 'element'}"`;
    case 'INPUT': {
      const value = payload.value?.substring(0, 20);
      const label = payload.label || 'field';
      return `Type "${value}${value && value.length >= 20 ? '...' : ''}" in ${label}`;
    }
    case 'NAVIGATION':
      try {
        return `Go to ${new URL(payload.url).hostname}`;
      } catch {
        return 'Navigate to page';
      }
    case 'TAB_SWITCH':
      return 'Switch to different tab';
    case 'SCROLL':
      return 'Scroll page';
    case 'KEYBOARD':
      return `Press ${payload.keyboardDetails?.key || 'key'}`;
    default:
      return step.description || step.type;
  }
}

export function PostRecordingConfirm({
  workflowSteps,
  suggestedName,
  onSave,
  onCancel,
}: PostRecordingConfirmProps) {
  const [workflowName, setWorkflowName] = useState(suggestedName);
  const [showSteps, setShowSteps] = useState(false);

  // Detect variables from steps
  const detectedVariables = useMemo(() => {
    return VariableDetector.detectVariablesSimplified(workflowSteps);
  }, [workflowSteps]);

  // Filter to only spreadsheet variables (those with cellReference)
  const spreadsheetVariables = useMemo(() => {
    return detectedVariables.variables.filter(v => v.cellReference);
  }, [detectedVariables]);

  // Track edited field names for spreadsheet variables
  const [editedNames, setEditedNames] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of spreadsheetVariables) {
      initial[v.stepId] = v.columnHeader || v.cellReference || v.fieldName;
    }
    return initial;
  });

  const handleNameChange = (stepId: string, name: string) => {
    setEditedNames(prev => ({ ...prev, [stepId]: name }));
  };

  const handleSave = () => {
    if (!workflowName.trim()) {
      return;
    }
    onSave(workflowName.trim(), editedNames);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
          <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Got it!</h2>
          <p className="text-sm text-muted-foreground">
            I learned {workflowSteps.length} action{workflowSteps.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Workflow Name - ON TOP */}
      <div className="p-4 bg-card rounded-xl border border-border">
        <label className="block text-sm font-medium text-foreground mb-2">
          What should I call this task?
        </label>
        <input
          type="text"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          placeholder="e.g., Fill in customer details"
          className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
          autoFocus
        />
      </div>

      {/* Spreadsheet Column Naming */}
      {spreadsheetVariables.length > 0 && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
          <h3 className="font-medium mb-2 text-blue-900 dark:text-blue-100 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Name your columns
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
            Give friendly names so you'll know what to fill in later.
          </p>

          <div className="space-y-2">
            {spreadsheetVariables.map((variable) => (
              <div key={variable.stepId} className="flex items-center gap-3">
                <span className="text-sm font-mono text-blue-800 dark:text-blue-200 w-12 flex-shrink-0">
                  {variable.cellReference}
                </span>
                <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <input
                  type="text"
                  value={editedNames[variable.stepId] || ''}
                  onChange={(e) => handleNameChange(variable.stepId, e.target.value)}
                  placeholder="e.g., Name, Email, Phone..."
                  className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-background border border-blue-300 dark:border-blue-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps - Collapsible */}
      <div>
        <button
          onClick={() => setShowSteps(!showSteps)}
          className="w-full flex items-center justify-between p-3 bg-muted/50 rounded-xl border border-border hover:bg-muted/70 transition-colors"
        >
          <span className="text-sm font-medium text-foreground">
            {workflowSteps.length} steps recorded
          </span>
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${showSteps ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSteps && (
          <div className="mt-2 p-3 bg-card rounded-xl border border-border space-y-1 max-h-48 overflow-y-auto">
            {workflowSteps.map((step, index) => (
              <div
                key={index}
                className="py-1.5 border-b border-border/50 last:border-0 text-sm flex items-start gap-2"
              >
                <span className="text-muted-foreground flex-shrink-0 w-5 text-right">{index + 1}.</span>
                <span className="flex-1 text-foreground">{getStepDescription(step)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!workflowName.trim()}
          className="flex-1 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save Task
        </button>
      </div>
    </div>
  );
}
