/**
 * Teaching Refinement Component (Phase D)
 *
 * After recording + AI analysis, shows a structured summary of what the AI
 * learned and lets the user correct it. User corrections become high-confidence
 * overrides stored as TeachingCorrection[] in WorkflowMemory.
 *
 * Shows:
 * - Goal summary (editable)
 * - Phase breakdown with names (editable)
 * - Field requirements: required vs optional (toggleable)
 * - Success criteria
 */

import { useState, useMemo, useCallback } from 'react';
import type { WorkflowStep } from '../types/workflow';
import type { WorkflowAnalysis } from '../lib/post-recording-analyzer';
import type { WorkflowMemory, TeachingCorrection } from '../lib/workflow-memory/types';

// ============================================================================
// Types
// ============================================================================

interface TeachingRefinementProps {
  /** AI analysis of the workflow (may not be available) */
  aiAnalysis?: WorkflowAnalysis | null;
  /** Generated workflow memory (may not be available) */
  memory?: WorkflowMemory | null;
  /** Recorded workflow steps */
  steps: WorkflowStep[];
  /** Called when user confirms, with any corrections */
  onConfirm: (corrections: TeachingCorrection[]) => void;
  /** Called to skip refinement */
  onSkip: () => void;
}

interface EditableField {
  name: string;
  variableName: string;
  isRequired: boolean;
  defaultValue?: string;
  type: string;
}

interface EditablePhase {
  name: string;
  purpose: string;
  stepCount: number;
  criticality: 'critical' | 'important' | 'optional';
}

// ============================================================================
// Component
// ============================================================================

export function TeachingRefinement({
  aiAnalysis,
  memory,
  steps,
  onConfirm,
  onSkip,
}: TeachingRefinementProps) {
  // Derive initial state from analysis/memory
  const initialGoal = useMemo(() => {
    return aiAnalysis?.workflowUnderstanding?.primaryGoal
      || memory?.identity?.purpose
      || '';
  }, [aiAnalysis, memory]);

  const initialPhases = useMemo((): EditablePhase[] => {
    if (memory?.understanding?.phases?.length) {
      return memory.understanding.phases.map(p => ({
        name: p.name,
        purpose: p.purpose,
        stepCount: p.stepIndices.length,
        criticality: p.criticality,
      }));
    }
    if (aiAnalysis?.workflowUnderstanding?.subGoals?.length) {
      return aiAnalysis.workflowUnderstanding.subGoals.map((g, _i) => ({
        name: g,
        purpose: g,
        stepCount: Math.ceil(steps.length / aiAnalysis.workflowUnderstanding.subGoals.length),
        criticality: 'important' as const,
      }));
    }
    return [];
  }, [memory, aiAnalysis, steps]);

  const initialFields = useMemo((): EditableField[] => {
    const fields: EditableField[] = [];

    // From memory inputs
    if (memory?.inputs) {
      for (const f of memory.inputs.required) {
        fields.push({
          name: f.name,
          variableName: f.variableName,
          isRequired: true,
          defaultValue: f.defaultValue,
          type: f.type,
        });
      }
      for (const f of memory.inputs.optional) {
        fields.push({
          name: f.name,
          variableName: f.variableName,
          isRequired: false,
          defaultValue: f.defaultValue,
          type: f.type,
        });
      }
    }

    // Fallback: extract from steps if no memory
    if (fields.length === 0) {
      for (const step of steps) {
        if (step.type === 'INPUT' && step.payload && 'label' in step.payload) {
          const label = (step.payload as any).label || (step.payload as any).fieldName || '';
          if (label && !fields.find(f => f.name === label)) {
            fields.push({
              name: label,
              variableName: label.toLowerCase().replace(/\s+/g, '_'),
              isRequired: true, // Default to required
              type: 'text',
            });
          }
        }
      }
    }

    return fields;
  }, [memory, steps]);

  const initialSuccessIndicators = useMemo((): string[] => {
    if (memory?.success?.indicators?.length) {
      return memory.success.indicators.map(i => i.description);
    }
    if (aiAnalysis?.workflowUnderstanding?.successIndicators?.length) {
      return aiAnalysis.workflowUnderstanding.successIndicators;
    }
    return [];
  }, [memory, aiAnalysis]);

  // Editable state
  const [goal, setGoal] = useState(initialGoal);
  const [phases, setPhases] = useState(initialPhases);
  const [fields, setFields] = useState(initialFields);
  const [expandedSection, setExpandedSection] = useState<string | null>('fields');

  // Track what was changed
  const hasChanges = useMemo(() => {
    if (goal !== initialGoal) return true;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i]?.isRequired !== initialFields[i]?.isRequired) return true;
      if (fields[i]?.name !== initialFields[i]?.name) return true;
    }
    for (let i = 0; i < phases.length; i++) {
      if (phases[i]?.name !== initialPhases[i]?.name) return true;
    }
    return false;
  }, [goal, initialGoal, fields, initialFields, phases, initialPhases]);

  // Build corrections from changes
  const buildCorrections = useCallback((): TeachingCorrection[] => {
    const corrections: TeachingCorrection[] = [];
    const now = Date.now();

    if (goal !== initialGoal && goal.trim()) {
      corrections.push({
        type: 'goal',
        target: 'primaryGoal',
        correction: goal.trim(),
        confidence: 1.0,
        timestamp: now,
      });
    }

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const initial = initialFields[i];
      if (!field || !initial) continue;

      if (field.isRequired !== initial.isRequired) {
        corrections.push({
          type: field.isRequired ? 'field_required' : 'field_optional',
          target: field.name,
          correction: field.isRequired
            ? `${field.name} is required`
            : `${field.name} is optional`,
          confidence: 1.0,
          timestamp: now,
        });
      }

      if (field.name !== initial.name) {
        corrections.push({
          type: 'field_name',
          target: initial.name,
          correction: field.name,
          confidence: 1.0,
          timestamp: now,
        });
      }
    }

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const initial = initialPhases[i];
      if (!phase || !initial) continue;

      if (phase.name !== initial.name) {
        corrections.push({
          type: 'phase_name',
          target: initial.name,
          correction: phase.name,
          confidence: 1.0,
          timestamp: now,
        });
      }
    }

    return corrections;
  }, [goal, initialGoal, fields, initialFields, phases, initialPhases]);

  const handleConfirm = () => {
    const corrections = buildCorrections();
    onConfirm(corrections);
  };

  const toggleFieldRequired = (index: number) => {
    setFields(prev => prev.map((f, i) =>
      i === index ? { ...f, isRequired: !f.isRequired } : f
    ));
  };

  const updateFieldName = (index: number, name: string) => {
    setFields(prev => prev.map((f, i) =>
      i === index ? { ...f, name } : f
    ));
  };

  const updatePhaseName = (index: number, name: string) => {
    setPhases(prev => prev.map((p, i) =>
      i === index ? { ...p, name } : p
    ));
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  // If no analysis data available, don't show refinement
  if (!aiAnalysis && !memory) {
    return null;
  }

  const domain = aiAnalysis?.workflowUnderstanding?.domain
    || memory?.identity?.domain
    || '';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-full">
          <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Here's what I learned</h2>
          <p className="text-sm text-muted-foreground">
            Review and correct anything that's wrong
          </p>
        </div>
      </div>

      {/* Goal */}
      <div className="p-3 bg-card rounded-xl border border-border">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          Goal
        </label>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What does this workflow accomplish?"
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary"
        />
        {domain && (
          <span className="inline-block mt-1.5 px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded-full">
            {domain}
          </span>
        )}
      </div>

      {/* Fields - Required vs Optional */}
      {fields.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => toggleSection('fields')}
            className="w-full flex items-center justify-between p-3 bg-card hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-foreground flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Fields ({fields.filter(f => f.isRequired).length} required, {fields.filter(f => !f.isRequired).length} optional)
            </span>
            <svg
              className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedSection === 'fields' ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'fields' && (
            <div className="border-t border-border divide-y divide-border/50">
              {fields.map((field, index) => (
                <div key={index} className="flex items-center gap-2 px-3 py-2 bg-card">
                  {/* Toggle required/optional */}
                  <button
                    onClick={() => toggleFieldRequired(index)}
                    className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full transition-colors ${
                      field.isRequired
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title={field.isRequired ? 'Click to mark as optional' : 'Click to mark as required'}
                  >
                    {field.isRequired ? 'Required' : 'Optional'}
                  </button>

                  {/* Field name (editable) */}
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateFieldName(index, e.target.value)}
                    className="flex-1 px-2 py-1 text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
                  />

                  {/* Default value indicator */}
                  {field.defaultValue && (
                    <span className="text-xs text-muted-foreground" title={`Default: ${field.defaultValue}`}>
                      = {field.defaultValue.length > 10
                        ? field.defaultValue.substring(0, 10) + '...'
                        : field.defaultValue}
                    </span>
                  )}
                </div>
              ))}
              <div className="px-3 py-1.5 bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Click Required/Optional to toggle. Edit field names inline.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phases */}
      {phases.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => toggleSection('phases')}
            className="w-full flex items-center justify-between p-3 bg-card hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-foreground flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              Phases ({phases.length})
            </span>
            <svg
              className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedSection === 'phases' ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'phases' && (
            <div className="border-t border-border divide-y divide-border/50">
              {phases.map((phase, index) => (
                <div key={index} className="flex items-center gap-2 px-3 py-2 bg-card">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                    <span className="text-xs font-medium text-primary">{index + 1}</span>
                  </span>
                  <input
                    type="text"
                    value={phase.name}
                    onChange={(e) => updatePhaseName(index, e.target.value)}
                    className="flex-1 px-2 py-1 text-sm bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {phase.stepCount} steps
                  </span>
                </div>
              ))}
              <div className="px-3 py-1.5 bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  Edit phase names inline to clarify what each step accomplishes.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Success Criteria */}
      {initialSuccessIndicators.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => toggleSection('success')}
            className="w-full flex items-center justify-between p-3 bg-card hover:bg-muted/50 transition-colors"
          >
            <span className="text-sm font-medium text-foreground flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Success Indicators ({initialSuccessIndicators.length})
            </span>
            <svg
              className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedSection === 'success' ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSection === 'success' && (
            <div className="border-t border-border p-3 bg-card space-y-1">
              {initialSuccessIndicators.map((indicator, index) => (
                <div key={index} className="flex items-start gap-2 text-sm">
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-foreground">{indicator}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSkip}
          className="flex-1 px-4 py-2.5 text-sm bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
        >
          Looks Good
        </button>
        <button
          onClick={handleConfirm}
          disabled={!hasChanges}
          className={`flex-1 px-4 py-2.5 text-sm rounded-xl font-medium transition-colors ${
            hasChanges
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
          }`}
        >
          Save Corrections ({buildCorrections().length})
        </button>
      </div>
    </div>
  );
}
