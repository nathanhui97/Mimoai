import { useState } from 'react';
import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { StepExecutionGuidance } from '../lib/post-recording-analyzer';

interface WorkflowDetailsProps {
  workflow: SavedWorkflow;
  onExecute: () => void;
  onBack: () => void;
  onExport: () => void;
  onDelete: () => void;
  onExtractSkills: () => void;
  onSave: (updatedWorkflow: SavedWorkflow) => void;
  isExecuting: boolean;
}

export function WorkflowDetails({
  workflow,
  onExecute,
  onBack,
  onExport,
  onDelete,
  onExtractSkills,
  onSave,
  isExecuting,
}: WorkflowDetailsProps) {
  // Editing state
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  // AI insight expansion state
  const [expandedAIInsight, setExpandedAIInsight] = useState<number | null>(null);

  // Check if workflow has AI analysis
  const hasAIAnalysis = !!workflow.aiAnalysis?.stepGuidance?.length;

  // Get AI guidance for a specific step
  const getAIGuidance = (stepIndex: number): StepExecutionGuidance | undefined => {
    return workflow.aiAnalysis?.stepGuidance?.find(g => g.stepIndex === stepIndex);
  };

  // Temporary edit values
  const [editedName, setEditedName] = useState(workflow.name);
  const [editedDescription, setEditedDescription] = useState(workflow.description || '');
  const [editedSteps, setEditedSteps] = useState<Map<number, string>>(new Map());

  // Track if there are unsaved changes
  const hasChanges =
    editedName !== workflow.name ||
    editedDescription !== (workflow.description || '') ||
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
      steps: updatedSteps,
      updatedAt: Date.now(),
    };

    onSave(updatedWorkflow);

    // Clear editing state
    setEditingName(false);
    setEditingDescription(false);
    setEditingStepIndex(null);
    setEditedSteps(new Map());
  };

  const handleCancel = () => {
    // Reset to original values
    setEditedName(workflow.name);
    setEditedDescription(workflow.description || '');
    setEditedSteps(new Map());
    setEditingName(false);
    setEditingDescription(false);
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
    <div className="mb-6 animate-fade-in">
      {/* Header with back button */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl transition-all duration-200"
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
            className="flex-1 text-xl font-semibold text-foreground bg-muted/30 border border-border/60 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
            autoFocus
          />
        ) : (
          <h2
            onClick={() => setEditingName(true)}
            className="text-xl font-semibold text-foreground flex-1 cursor-pointer hover:text-primary transition-colors tracking-tight"
            title="Click to edit"
          >
            {editedName}
          </h2>
        )}
      </div>

      {/* Workflow description - click to edit */}
      <div className="mb-5 p-5 bg-card rounded-2xl border border-border/60 shadow-soft">
        <h3 className="text-sm font-semibold text-foreground mb-3">What this workflow does</h3>
        {editingDescription ? (
          <textarea
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            onBlur={() => setEditingDescription(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditedDescription(workflow.description || '');
                setEditingDescription(false);
              }
            }}
            className="w-full text-sm text-foreground bg-muted/30 border border-border/60 rounded-xl px-4 py-3 min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all resize-none"
            autoFocus
            placeholder="Describe what this workflow does..."
          />
        ) : (
          <p
            onClick={() => setEditingDescription(true)}
            className={`text-sm cursor-pointer transition-colors ${
              editedDescription ? 'text-foreground hover:text-primary' : 'text-muted-foreground italic hover:text-foreground'
            }`}
            title="Click to edit"
          >
            {editedDescription || 'Click to add description...'}
          </p>
        )}
      </div>

      {/* AI Analysis Summary - show patterns and understanding */}
      {hasAIAnalysis && workflow.aiAnalysis && (
        <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-2xl">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-sm font-semibold text-purple-800">AI Analysis</h3>
          </div>

          {/* Workflow understanding */}
          {workflow.aiAnalysis.workflowUnderstanding && (
            <div className="mb-3">
              <p className="text-sm text-purple-700">
                {workflow.aiAnalysis.workflowUnderstanding.primaryGoal}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                  {workflow.aiAnalysis.workflowUnderstanding.domain}
                </span>
                {workflow.aiAnalysis.workflowUnderstanding.entities.length > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                    {workflow.aiAnalysis.workflowUnderstanding.entities.slice(0, 2).join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Detected patterns */}
          {workflow.aiAnalysis.patterns && workflow.aiAnalysis.patterns.length > 0 && (
            <div className="border-t border-purple-200 pt-3 mt-3">
              <h4 className="text-xs font-semibold text-purple-800 mb-2">Detected Patterns</h4>
              <div className="flex flex-wrap gap-2">
                {workflow.aiAnalysis.patterns.map((pattern, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 text-xs bg-white border border-purple-200 text-purple-700 rounded-lg"
                    title={pattern.description}
                  >
                    {pattern.type.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Adaptation strategies summary */}
          {workflow.aiAnalysis.adaptationStrategies && workflow.aiAnalysis.adaptationStrategies.length > 0 && (
            <div className="border-t border-purple-200 pt-3 mt-3">
              <h4 className="text-xs font-semibold text-purple-800 mb-2">Adaptation Ready</h4>
              <p className="text-xs text-purple-600">
                This workflow can adapt to: {workflow.aiAnalysis.adaptationStrategies.map(s => s.scenario).join(', ')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Steps list - collapsible */}
      <div className="mb-5">
        <button
          onClick={() => setShowSteps(!showSteps)}
          className="w-full flex items-center justify-between p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {workflow.steps.length} steps
            </span>
            {hasAIAnalysis && (
              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                AI Enhanced
              </span>
            )}
          </div>
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
          <div className="mt-3 p-4 bg-card rounded-2xl border border-border/60 shadow-soft space-y-2 max-h-[400px] overflow-y-auto animate-fade-in">
            {workflow.steps.map((step, index) => {
              const isEditing = editingStepIndex === index;
              const currentDescription = editedSteps.get(index) ?? getHumanDescription(step);
              const aiGuidance = getAIGuidance(index);
              const isAIExpanded = expandedAIInsight === index;

              return (
                <div key={index} className="space-y-1">
                  {/* Step row */}
                  <div
                    className="group py-3 px-4 bg-muted/30 rounded-xl text-sm flex items-start gap-3 hover:bg-muted/50 transition-colors"
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
                        className="flex-1 text-foreground bg-background border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                        autoFocus
                      />
                    ) : (
                      <span
                        onClick={() => setEditingStepIndex(index)}
                        className="flex-1 text-foreground cursor-pointer hover:text-primary transition-colors"
                        title="Click to edit"
                      >
                        {currentDescription}
                      </span>
                    )}
                    {/* AI insight toggle button */}
                    {aiGuidance && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedAIInsight(isAIExpanded ? null : index);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${
                          isAIExpanded
                            ? 'bg-purple-100 text-purple-700'
                            : 'text-muted-foreground hover:text-purple-600 hover:bg-purple-50'
                        }`}
                        title="View AI analysis"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* AI Insight card - expandable */}
                  {aiGuidance && isAIExpanded && (
                    <div className="ml-8 p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs space-y-2 animate-fade-in">
                      {/* Intent */}
                      <div>
                        <span className="font-semibold text-purple-800">Why: </span>
                        <span className="text-purple-700">{aiGuidance.whyThisElement || aiGuidance.intent}</span>
                      </div>

                      {/* Expected outcome */}
                      {aiGuidance.expectedOutcome && (
                        <div>
                          <span className="font-semibold text-purple-800">Expects: </span>
                          <span className="text-purple-700">{aiGuidance.expectedOutcome}</span>
                        </div>
                      )}

                      {/* How to find element */}
                      {aiGuidance.elementFindingStrategy && (
                        <div>
                          <span className="font-semibold text-purple-800">Find by: </span>
                          <span className="text-purple-700">
                            {aiGuidance.elementFindingStrategy.lookingFor}
                            {aiGuidance.elementFindingStrategy.distinguishers.length > 0 && (
                              <> ({aiGuidance.elementFindingStrategy.distinguishers.slice(0, 2).join(', ')})</>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Criticality badge */}
                      <div className="flex items-center gap-2 pt-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          aiGuidance.criticality === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : aiGuidance.criticality === 'important'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {aiGuidance.criticality}
                        </span>
                        {aiGuidance.dependencies.length > 0 && (
                          <span className="text-purple-600">
                            Depends on step{aiGuidance.dependencies.length > 1 ? 's' : ''} {aiGuidance.dependencies.map(d => d + 1).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        {hasChanges && (
          <div className="flex gap-3 animate-fade-in">
            <button
              onClick={handleSave}
              className="flex-1 px-5 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 active:scale-[0.98] shadow-soft transition-all duration-200"
            >
              Save Changes
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
            >
              Cancel
            </button>
          </div>
        )}

        <button
          onClick={onExecute}
          disabled={isExecuting || hasChanges}
          className="w-full px-5 py-4 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {isExecuting ? 'Running...' : hasChanges ? 'Save changes to run' : 'Run this workflow'}
        </button>

        <button
          onClick={onExtractSkills}
          disabled={isExecuting}
          className="w-full px-4 py-3 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl font-medium hover:bg-blue-100 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
          title="Extract reusable skills from this workflow"
        >
          Extract Skills
        </button>

        <div className="flex gap-3">
          <button
            onClick={onExport}
            disabled={isExecuting}
            className="flex-1 px-4 py-3 bg-muted/60 text-muted-foreground rounded-xl font-medium hover:bg-muted active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
            title="Export as JSON"
          >
            Export
          </button>
          <button
            onClick={onDelete}
            disabled={isExecuting}
            className="flex-1 px-4 py-3 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
            title="Delete workflow"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
