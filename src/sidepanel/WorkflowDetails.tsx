import { useState } from 'react';
import type { SavedWorkflow, WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { StepExecutionGuidance } from '../lib/post-recording-analyzer';
// WorkflowMemory type is used via workflow.memory property

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

  // Memory section state
  const [showMemory, setShowMemory] = useState(false);
  const [editedTriggerPhrases, setEditedTriggerPhrases] = useState<string[]>(
    workflow.memory?.triggers?.phrases || []
  );
  const [newTriggerPhrase, setNewTriggerPhrase] = useState('');
  const [editingSupportsMultiple, setEditingSupportsMultiple] = useState(
    workflow.memory?.pattern?.repetition?.supportsMultiple || false
  );

  // Check if workflow has AI analysis
  const hasAIAnalysis = !!workflow.aiAnalysis?.stepGuidance?.length;

  // Debug: Log AI analysis status
  console.log('[WorkflowDetails] AI analysis check:', {
    hasAIAnalysis,
    aiAnalysisExists: !!workflow.aiAnalysis,
    workflowUnderstanding: workflow.aiAnalysis?.workflowUnderstanding,
    stepGuidanceLength: workflow.aiAnalysis?.stepGuidance?.length,
  });

  // Get AI guidance for a specific step
  const getAIGuidance = (stepIndex: number): StepExecutionGuidance | undefined => {
    return workflow.aiAnalysis?.stepGuidance?.find(g => g.stepIndex === stepIndex);
  };

  // Temporary edit values
  const [editedName, setEditedName] = useState(workflow.name);
  const [editedDescription, setEditedDescription] = useState(workflow.description || '');
  const [editedSteps, setEditedSteps] = useState<Map<number, string>>(new Map());

  // Check if memory has changed
  const originalTriggers = workflow.memory?.triggers?.phrases || [];
  const originalSupportsMultiple = workflow.memory?.pattern?.repetition?.supportsMultiple || false;
  const memoryChanged =
    JSON.stringify(editedTriggerPhrases) !== JSON.stringify(originalTriggers) ||
    editingSupportsMultiple !== originalSupportsMultiple;

  // Track if there are unsaved changes
  const hasChanges =
    editedName !== workflow.name ||
    editedDescription !== (workflow.description || '') ||
    editedSteps.size > 0 ||
    memoryChanged;

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

    // Build updated memory if it exists and has changes
    let updatedMemory = workflow.memory;
    if (memoryChanged && workflow.memory) {
      updatedMemory = {
        ...workflow.memory,
        triggers: {
          ...workflow.memory.triggers,
          phrases: editedTriggerPhrases,
        },
        pattern: {
          ...workflow.memory.pattern,
          repetition: {
            ...workflow.memory.pattern.repetition,
            supportsMultiple: editingSupportsMultiple,
            separators: workflow.memory.pattern.repetition?.separators || ['and', ','],
          },
        },
        generatedAt: Date.now(),
      };
    }

    const updatedWorkflow: SavedWorkflow = {
      ...workflow,
      name: editedName,
      description: editedDescription || undefined,
      steps: updatedSteps,
      memory: updatedMemory,
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
    // Reset memory edits
    setEditedTriggerPhrases(workflow.memory?.triggers?.phrases || []);
    setEditingSupportsMultiple(workflow.memory?.pattern?.repetition?.supportsMultiple || false);
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

      {/* Workflow description - prioritize Memory over AI Analysis */}
      <div className="mb-5 p-5 bg-card rounded-2xl border border-border/60 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">What this workflow does</h3>
          {(workflow.memory || workflow.aiAnalysis?.workflowUnderstanding) && (
            <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {workflow.memory ? 'Smart Memory' : 'AI Generated'}
            </span>
          )}
        </div>

        {/* Smart summary - prioritize Memory which has variable names */}
        {(workflow.memory || workflow.aiAnalysis?.workflowUnderstanding) && (
          <div className="mb-3">
            <p className="text-sm text-foreground leading-relaxed">
              {workflow.memory?.understanding?.elevator ||
               workflow.memory?.identity?.purpose ||
               workflow.aiAnalysis?.workflowUnderstanding?.summary ||
               workflow.aiAnalysis?.workflowUnderstanding?.primaryGoal}
            </p>

            {/* Required Inputs - show what fields are needed */}
            {workflow.memory?.inputs?.required && workflow.memory.inputs.required.length > 0 && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-blue-800 w-16 flex-shrink-0">Inputs:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {workflow.memory.inputs.required.map((input, i) => (
                      <span key={i} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full font-medium">
                        {input.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Goal and metadata */}
            <div className="mt-3 p-3 bg-muted/30 rounded-xl space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-medium text-muted-foreground w-16 flex-shrink-0">Goal:</span>
                <span className="text-xs text-foreground">
                  {workflow.memory?.identity?.purpose ||
                   workflow.aiAnalysis?.workflowUnderstanding?.primaryGoal}
                </span>
              </div>
              {/* Pattern info from memory */}
              {workflow.memory?.pattern && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-16 flex-shrink-0">Pattern:</span>
                  <span className="text-xs text-foreground">
                    {workflow.memory.pattern.type?.replace(/_/g, ' ')}
                    {workflow.memory.pattern.repetition?.supportsMultiple && ' (can repeat)'}
                  </span>
                </div>
              )}
              {/* Success indicator */}
              {(workflow.memory?.success?.indicators?.[0] || workflow.aiAnalysis?.workflowUnderstanding?.successIndicators?.[0]) && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-16 flex-shrink-0">Success:</span>
                  <span className="text-xs text-foreground">
                    {workflow.memory?.success?.indicators?.[0]?.description ||
                     workflow.aiAnalysis?.workflowUnderstanding?.successIndicators?.[0]}
                  </span>
                </div>
              )}
              {/* Domain */}
              {(workflow.memory?.identity?.domain || workflow.aiAnalysis?.workflowUnderstanding?.domain) &&
               (workflow.memory?.identity?.domain || workflow.aiAnalysis?.workflowUnderstanding?.domain) !== 'General' && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-16 flex-shrink-0">Domain:</span>
                  <span className="text-xs text-foreground">
                    {workflow.memory?.identity?.domain ||
                     workflow.aiAnalysis?.workflowUnderstanding?.domain}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fallback: Manual description or placeholder when no memory or AI analysis */}
        {!workflow.memory && !workflow.aiAnalysis?.workflowUnderstanding && (
          editingDescription ? (
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
          )
        )}

        {/* Optional: Allow editing description */}
        {(workflow.memory || workflow.aiAnalysis?.workflowUnderstanding) && (
          <button
            onClick={() => setEditingDescription(true)}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Edit description manually
          </button>
        )}
      </div>

      {/* AI Analysis Summary - show patterns and understanding (only if no memory) */}
      {!workflow.memory && hasAIAnalysis && workflow.aiAnalysis && (
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

      {/* Workflow Memory Section - How the agent "remembers" this workflow */}
      <div className="mb-5">
        <button
          onClick={() => setShowMemory(!showMemory)}
          className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl hover:from-blue-100 hover:to-indigo-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="text-sm font-semibold text-blue-800">Agent Memory</span>
            {workflow.memory && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                {workflow.memory.identity?.category || 'workflow'}
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-blue-600 transition-transform duration-200 ${showMemory ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showMemory && workflow.memory && (
          <div className="mt-3 p-4 bg-white rounded-2xl border border-blue-200 shadow-soft space-y-4 animate-fade-in">
            {/* Purpose / Elevator */}
            <div>
              <h4 className="text-xs font-semibold text-blue-800 mb-1 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                What it does
              </h4>
              <p className="text-sm text-gray-700">
                {workflow.memory.understanding?.elevator || workflow.memory.identity?.purpose || 'No description'}
              </p>
            </div>

            {/* Trigger Phrases - Editable */}
            <div>
              <h4 className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Trigger phrases
                <span className="text-[10px] text-blue-500 font-normal ml-1">(how to invoke)</span>
              </h4>
              <div className="flex flex-wrap gap-2 mb-2">
                {editedTriggerPhrases.map((phrase, i) => (
                  <span
                    key={i}
                    className="group px-2.5 py-1 text-xs bg-blue-50 text-blue-700 rounded-lg border border-blue-200 flex items-center gap-1"
                  >
                    "{phrase}"
                    <button
                      onClick={() => {
                        const updated = editedTriggerPhrases.filter((_, idx) => idx !== i);
                        setEditedTriggerPhrases(updated);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-red-500 transition-all"
                      title="Remove phrase"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
              {/* Add new trigger phrase */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTriggerPhrase}
                  onChange={(e) => setNewTriggerPhrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTriggerPhrase.trim()) {
                      setEditedTriggerPhrases([...editedTriggerPhrases, newTriggerPhrase.trim()]);
                      setNewTriggerPhrase('');
                    }
                  }}
                  placeholder="Add trigger phrase..."
                  className="flex-1 text-xs px-3 py-1.5 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
                <button
                  onClick={() => {
                    if (newTriggerPhrase.trim()) {
                      setEditedTriggerPhrases([...editedTriggerPhrases, newTriggerPhrase.trim()]);
                      setNewTriggerPhrase('');
                    }
                  }}
                  disabled={!newTriggerPhrase.trim()}
                  className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Required Inputs */}
            {workflow.memory.inputs && (workflow.memory.inputs.required.length > 0 || workflow.memory.inputs.optional.length > 0) && (
              <div>
                <h4 className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Required inputs
                </h4>
                <div className="space-y-1.5">
                  {workflow.memory.inputs.required.map((input, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                      <span className="text-xs font-medium text-gray-700">{input.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">{input.type}</span>
                      {input.description && (
                        <span className="text-[10px] text-gray-500 flex-1 truncate" title={input.description}>
                          {input.description}
                        </span>
                      )}
                    </div>
                  ))}
                  {workflow.memory.inputs.optional.map((input, i) => (
                    <div key={`opt-${i}`} className="flex items-center gap-2 px-3 py-2 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                      <span className="text-xs font-medium text-gray-500">{input.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{input.type}</span>
                      <span className="text-[10px] text-gray-400 italic">optional</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pattern & Capabilities */}
            <div>
              <h4 className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Pattern & capabilities
              </h4>
              <div className="space-y-2">
                {/* Pattern type */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">Type:</span>
                  <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full font-medium">
                    {workflow.memory.pattern?.type || 'single_entry'}
                  </span>
                </div>

                {/* Supports multiple toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingSupportsMultiple}
                    onChange={(e) => setEditingSupportsMultiple(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-700">
                    Supports multiple items
                    <span className="text-gray-500 ml-1">(e.g., "add Alice, Bob, Carol")</span>
                  </span>
                </label>

                {/* Data entry strategy */}
                {workflow.memory.pattern?.dataEntry && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">Data entry:</span>
                    <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded-full font-medium">
                      {workflow.memory.pattern.dataEntry.targetStrategy?.replace(/_/g, ' ') || 'fixed location'}
                    </span>
                    {workflow.memory.pattern.dataEntry.isSpreadsheet && (
                      <span className="px-2 py-0.5 text-xs bg-emerald-50 text-emerald-700 rounded-full">
                        spreadsheet
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Success indicators */}
            {workflow.memory.success?.indicators && workflow.memory.success.indicators.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Success looks like
                </h4>
                <div className="space-y-1">
                  {workflow.memory.success.indicators.slice(0, 3).map((indicator, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        indicator.priority === 'primary' ? 'bg-green-500' :
                        indicator.priority === 'secondary' ? 'bg-blue-400' : 'bg-gray-400'
                      }`} />
                      {indicator.description}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Memory metadata */}
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
              <span>Memory v{workflow.memory.version}</span>
              <span>Updated {new Date(workflow.memory.generatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        {/* No memory yet message */}
        {showMemory && !workflow.memory && (
          <div className="mt-3 p-4 bg-gray-50 rounded-2xl border border-gray-200 text-center">
            <p className="text-sm text-gray-500">
              Memory will be generated when you save the workflow.
            </p>
          </div>
        )}
      </div>

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
