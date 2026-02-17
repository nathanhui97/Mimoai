/**
 * Post-Recording Confirmation Component
 *
 * A simple confirmation UI that replaces the complex chat-based flow.
 * Shows workflow name input, spreadsheet column naming, skill preview, and collapsible steps.
 */

import { useState, useMemo } from 'react';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';
import type { WorkflowAnalysis } from '../lib/post-recording-analyzer';
import type { WorkflowMemory, TeachingCorrection } from '../lib/workflow-memory/types';
import { VariableDetector } from '../lib/variable-detector';
import { isWorkflowStepPayload } from '../types/workflow';
import { TeachingRefinement } from './TeachingRefinement';
import type { MergeCandidate } from '../lib/multi-recording-merge';

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
      // Stop if we hit an INPUT step
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
    if (step.type === 'CLICK') {
      const payload = step.payload as any;
      const text = (payload?.elementText || payload?.label || '').toLowerCase();
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

  // If no milestones detected, create a single one
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

  // Extract action and object
  const actionWords = ['add', 'create', 'new', 'update', 'edit', 'delete', 'remove', 'fill', 'enter', 'submit'];
  const phrases: string[] = [];

  // Add the name itself as a trigger
  if (normalized.length > 0) {
    phrases.push(normalized);
  }

  // Generate variations
  for (const action of actionWords) {
    if (normalized.includes(action)) {
      // The name already contains an action word, it's probably good
      break;
    }
  }

  // Add "do [name]" variant if name doesn't start with an action
  const startsWithAction = actionWords.some(a => normalized.startsWith(a));
  if (!startsWithAction && normalized.length > 0) {
    phrases.push(`do ${normalized}`);
  }

  return phrases.slice(0, 3);
}

interface PostRecordingConfirmProps {
  workflowSteps: WorkflowStep[];
  suggestedName: string;
  onSave: (name: string, editedVariables: Record<string, string>, corrections?: TeachingCorrection[], mergeTargetId?: string) => void;
  onCancel: () => void;
  /** AI analysis of the workflow (for teaching refinement) */
  aiAnalysis?: WorkflowAnalysis | null;
  /** Generated workflow memory (for teaching refinement) */
  memory?: WorkflowMemory | null;
  /** Merge candidates: existing workflows that match this recording */
  mergeCandidates?: MergeCandidate[];
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
  aiAnalysis,
  memory,
  mergeCandidates,
}: PostRecordingConfirmProps) {
  const [workflowName, setWorkflowName] = useState(suggestedName);
  const [showSteps, setShowSteps] = useState(false);
  const [showSkillPreview, setShowSkillPreview] = useState(true);
  const [showRefinement, setShowRefinement] = useState(false);
  const [pendingCorrections, setPendingCorrections] = useState<TeachingCorrection[]>([]);
  const [selectedMergeTarget, setSelectedMergeTarget] = useState<string | null>(null);

  // Detect variables from steps
  const detectedVariables = useMemo(() => {
    return VariableDetector.detectVariablesSimplified(workflowSteps);
  }, [workflowSteps]);

  // Synthesize milestones for preview
  const milestones = useMemo(() => {
    return synthesizeMilestones(workflowSteps);
  }, [workflowSteps]);

  // Generate trigger phrase suggestions
  const triggerPhrases = useMemo(() => {
    return suggestTriggerPhrases(workflowName);
  }, [workflowName]);

  // Get non-spreadsheet variables (form inputs)
  const formVariables = useMemo(() => {
    return detectedVariables.variables.filter(v => !v.cellReference);
  }, [detectedVariables]);

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
    onSave(
      workflowName.trim(),
      editedNames,
      pendingCorrections.length > 0 ? pendingCorrections : undefined,
      selectedMergeTarget || undefined,
    );
  };

  const hasRefinementData = !!(aiAnalysis || memory);
  const topMergeCandidate = mergeCandidates && mergeCandidates.length > 0 ? mergeCandidates[0] : null;

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

      {/* Merge Suggestion */}
      {topMergeCandidate && (
        <div className={`p-3 rounded-xl border transition-colors ${
          selectedMergeTarget
            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
            : 'bg-card border-border'
        }`}>
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                Similar to "{topMergeCandidate.workflow.name}"
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {topMergeCandidate.reason} ({Math.round(topMergeCandidate.similarity * 100)}% match)
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setSelectedMergeTarget(
                    selectedMergeTarget ? null : topMergeCandidate.workflow.id
                  )}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    selectedMergeTarget
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60'
                  }`}
                >
                  {selectedMergeTarget ? 'Will Merge' : 'Merge with it'}
                </button>
                <button
                  onClick={() => setSelectedMergeTarget(null)}
                  className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Save as new
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Skill Preview - Collapsible */}
      <div>
        <button
          onClick={() => setShowSkillPreview(!showSkillPreview)}
          className="w-full flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          <span className="text-sm font-medium text-purple-900 dark:text-purple-100 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            What I'll Learn
          </span>
          <svg
            className={`w-4 h-4 text-purple-500 transition-transform duration-200 ${showSkillPreview ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSkillPreview && (
          <div className="mt-2 p-4 bg-card rounded-xl border border-border space-y-4">
            {/* Milestones Timeline */}
            {milestones.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Milestones
                </h4>
                <div className="flex items-center gap-1">
                  {milestones.map((milestone, index) => (
                    <div key={index} className="flex items-center">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
                          <span className="text-xs font-medium text-primary">{index + 1}</span>
                        </div>
                        <span className="text-xs text-foreground mt-1 text-center max-w-[70px] truncate">
                          {milestone.name}
                        </span>
                      </div>
                      {index < milestones.length - 1 && (
                        <div className="w-6 h-0.5 bg-primary/30 mx-1 mb-4" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Detected Inputs */}
            {(formVariables.length > 0 || spreadsheetVariables.length > 0) && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Inputs I'll Need
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {formVariables.map((v, i) => (
                    <span
                      key={`form-${i}`}
                      className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-full"
                    >
                      {v.fieldName}
                    </span>
                  ))}
                  {spreadsheetVariables.map((v, i) => (
                    <span
                      key={`sheet-${i}`}
                      className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-full"
                    >
                      {editedNames[v.stepId] || v.fieldName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Trigger Phrases */}
            {triggerPhrases.length > 0 && workflowName.trim() && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  You Can Say
                </h4>
                <div className="space-y-1">
                  {triggerPhrases.map((phrase, index) => (
                    <p key={index} className="text-sm text-foreground">
                      "{phrase}"
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Teaching Refinement - Review AI Understanding */}
      {hasRefinementData && (
        <div>
          <button
            onClick={() => setShowRefinement(!showRefinement)}
            className="w-full flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            <span className="text-sm font-medium text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Review What I Learned
              {pendingCorrections.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-amber-200 dark:bg-amber-800 rounded-full">
                  {pendingCorrections.length} correction{pendingCorrections.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>
            <svg
              className={`w-4 h-4 text-amber-500 transition-transform duration-200 ${showRefinement ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showRefinement && (
            <div className="mt-2 p-4 bg-card rounded-xl border border-border">
              <TeachingRefinement
                aiAnalysis={aiAnalysis}
                memory={memory}
                steps={workflowSteps}
                onConfirm={(corrections) => {
                  setPendingCorrections(corrections);
                  setShowRefinement(false);
                }}
                onSkip={() => setShowRefinement(false)}
              />
            </div>
          )}
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
