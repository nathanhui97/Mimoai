/**
 * SkillTeacher Component
 *
 * Provides the UI flow for teaching new skills:
 * 1. Name the skill
 * 2. Describe what it does and when to use it
 * 3. Record the steps
 * 4. Review and confirm variables
 * 5. Save to skill library
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorkflowStep } from '../types/workflow';
import type { SkillTeachingState, SkillVariable, TeachableSkill } from '../types/skill';
import { TeachableSkillLibrary, generateSkillId } from '../lib/skill-storage';
import { VariableDetector } from '../lib/variable-detector';
import { isWorkflowStepPayload } from '../types/workflow';

interface SkillTeacherProps {
  onClose: () => void;
  onStartRecording: () => Promise<void>;
  onStopRecording: () => Promise<void>;
  isRecording: boolean;
  recordedSteps: WorkflowStep[];
  onSkillSaved?: (skill: TeachableSkill) => void;
}

export function SkillTeacher({
  onClose,
  onStartRecording,
  onStopRecording,
  isRecording,
  recordedSteps,
  onSkillSaved,
}: SkillTeacherProps) {
  const [state, setState] = useState<SkillTeachingState>({
    mode: 'naming',
    skillName: '',
    skillDescription: '',
    usageContext: '',
    recordedSteps: [],
    detectedVariables: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update recorded steps when they change
  useEffect(() => {
    if (state.mode === 'recording') {
      setState(prev => ({ ...prev, recordedSteps }));
    }
  }, [recordedSteps, state.mode]);

  // Detect when recording stops and move to reviewing
  useEffect(() => {
    if (state.mode === 'recording' && !isRecording && recordedSteps.length > 0) {
      // Recording stopped - detect variables and move to review
      detectVariablesAndReview();
    }
  }, [isRecording, state.mode, recordedSteps]);

  const detectVariablesAndReview = useCallback(async () => {
    try {
      // Use simplified variable detection
      const variables = VariableDetector.detectVariablesSimplified(recordedSteps);

      // Convert to SkillVariable format
      const skillVariables: SkillVariable[] = variables.variables.map(v => ({
        name: v.variableName || v.fieldName,
        type: detectVariableType(v.defaultValue || ''),
        description: v.fieldName,
        required: true,
        defaultValue: v.defaultValue,
      }));

      setState(prev => ({
        ...prev,
        mode: 'reviewing',
        recordedSteps,
        detectedVariables: skillVariables,
      }));
    } catch (err) {
      console.error('[SkillTeacher] Error detecting variables:', err);
      // Still move to review even if detection fails
      setState(prev => ({
        ...prev,
        mode: 'reviewing',
        recordedSteps,
        detectedVariables: [],
      }));
    }
  }, [recordedSteps]);

  const detectVariableType = (value: string): SkillVariable['type'] => {
    if (/^\d+$/.test(value)) return 'number';
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    return 'text';
  };

  const handleStartRecording = async () => {
    if (!state.skillName.trim()) {
      setError('Please enter a skill name');
      return;
    }
    setError(null);
    setState(prev => ({ ...prev, mode: 'recording' }));
    await onStartRecording();
  };

  const handleStopRecording = async () => {
    await onStopRecording();
    // The useEffect above will handle moving to review
  };

  const handleSave = async () => {
    if (state.detectedVariables.some(v => !v.name.trim())) {
      setError('Please name all variables');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const skill: TeachableSkill = {
        id: generateSkillId(),
        name: state.skillName.trim(),
        description: state.skillDescription.trim(),
        usageContext: state.usageContext.trim(),
        steps: state.recordedSteps,
        variables: state.detectedVariables,
        synonyms: generateSynonyms(state.skillName),
        requiredContext: [],
        prerequisites: [],
        provides: [],
        createdAt: Date.now(),
        successCount: 0,
        failureCount: 0,
        examples: [],
      };

      await TeachableSkillLibrary.saveSkill(skill);

      setState(prev => ({ ...prev, mode: 'saved' }));
      onSkillSaved?.(skill);

      // Close after brief delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('[SkillTeacher] Error saving skill:', err);
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setIsSaving(false);
    }
  };

  const generateSynonyms = (name: string): string[] => {
    // Generate basic synonyms from the skill name
    const words = name.toLowerCase().split(/\s+/);
    const synonyms: string[] = [];

    // Add verb variations
    const verbVariations: Record<string, string[]> = {
      add: ['insert', 'create', 'make'],
      create: ['add', 'make', 'generate'],
      delete: ['remove', 'clear', 'erase'],
      update: ['edit', 'modify', 'change'],
      submit: ['send', 'save', 'confirm'],
    };

    for (const word of words) {
      if (verbVariations[word]) {
        synonyms.push(...verbVariations[word]);
      }
    }

    return [...new Set(synonyms)];
  };

  const handleVariableUpdate = (index: number, updates: Partial<SkillVariable>) => {
    setState(prev => ({
      ...prev,
      detectedVariables: prev.detectedVariables.map((v, i) =>
        i === index ? { ...v, ...updates } : v
      ),
    }));
  };

  const handleRemoveVariable = (index: number) => {
    setState(prev => ({
      ...prev,
      detectedVariables: prev.detectedVariables.filter((_, i) => i !== index),
    }));
  };

  const handleAddVariable = () => {
    setState(prev => ({
      ...prev,
      detectedVariables: [
        ...prev.detectedVariables,
        {
          name: '',
          type: 'text' as const,
          description: '',
          required: true,
        },
      ],
    }));
  };

  // Render different modes
  const renderContent = () => {
    switch (state.mode) {
      case 'naming':
        return renderNamingMode();
      case 'describing':
        return renderDescribingMode();
      case 'recording':
        return renderRecordingMode();
      case 'reviewing':
        return renderReviewingMode();
      case 'saved':
        return renderSavedMode();
    }
  };

  const renderNamingMode = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          What should I call this skill?
        </h3>
        <p className="text-sm text-muted-foreground">
          Give it a clear, action-oriented name like "Add item to promotion" or "Submit order form"
        </p>
      </div>

      <div>
        <input
          type="text"
          value={state.skillName}
          onChange={e => setState(prev => ({ ...prev, skillName: e.target.value }))}
          placeholder="e.g., Add item to promotion"
          className="w-full px-4 py-3 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter' && state.skillName.trim()) {
              setState(prev => ({ ...prev, mode: 'describing' }));
            }
          }}
        />
      </div>

      <button
        onClick={() => setState(prev => ({ ...prev, mode: 'describing' }))}
        disabled={!state.skillName.trim()}
        className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Continue
      </button>
    </div>
  );

  const renderDescribingMode = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Describe "{state.skillName}"
        </h3>
        <p className="text-sm text-muted-foreground">
          Help me understand when to use this skill
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            What does it do?
          </label>
          <textarea
            value={state.skillDescription}
            onChange={e => setState(prev => ({ ...prev, skillDescription: e.target.value }))}
            placeholder="e.g., Adds a product to an existing BOGO promotion by searching and selecting it"
            rows={2}
            className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            When should I use it?
          </label>
          <textarea
            value={state.usageContext}
            onChange={e => setState(prev => ({ ...prev, usageContext: e.target.value }))}
            placeholder="e.g., When you need to add products to a deal or promotion"
            rows={2}
            className="w-full px-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setState(prev => ({ ...prev, mode: 'naming' }))}
          className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleStartRecording}
          className="flex-1 py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
          Start Recording
        </button>
      </div>
    </div>
  );

  const renderRecordingMode = () => (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
          <div className="w-8 h-8 bg-red-500 rounded-full animate-pulse" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Recording "{state.skillName}"
        </h3>
        <p className="text-sm text-muted-foreground">
          Perform the steps you want to teach me. I'm watching!
        </p>
      </div>

      <div className="p-4 rounded-lg bg-muted/30 border border-border/60">
        <p className="text-sm text-muted-foreground mb-2">
          Steps recorded:
        </p>
        <p className="text-2xl font-bold text-foreground">
          {recordedSteps.length}
        </p>
      </div>

      {recordedSteps.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1">
          {recordedSteps.slice(-5).map((step, idx) => (
            <div
              key={idx}
              className="px-3 py-2 text-xs bg-muted/20 rounded border border-border/40"
            >
              <span className="font-medium">{step.type}</span>
              {isWorkflowStepPayload(step.payload) && step.payload.label && (
                <span className="text-muted-foreground ml-1">
                  on "{step.payload.label}"
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleStopRecording}
        disabled={recordedSteps.length === 0}
        className="w-full py-3 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        Stop Recording
      </button>
    </div>
  );

  const renderReviewingMode = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          Review "{state.skillName}"
        </h3>
        <p className="text-sm text-muted-foreground">
          {state.recordedSteps.length} steps recorded. Configure any variables below.
        </p>
      </div>

      {/* Variables section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">
            Variables ({state.detectedVariables.length})
          </label>
          <button
            onClick={handleAddVariable}
            className="text-xs text-primary hover:text-primary/80 transition-colors"
          >
            + Add variable
          </button>
        </div>

        {state.detectedVariables.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No variables detected. Add one if this skill needs input values.
          </p>
        ) : (
          <div className="space-y-2">
            {state.detectedVariables.map((variable, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-muted/30 border border-border/60"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={variable.name}
                      onChange={e =>
                        handleVariableUpdate(idx, { name: e.target.value })
                      }
                      placeholder="Variable name"
                      className="w-full px-3 py-1.5 text-sm border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <input
                      type="text"
                      value={variable.description}
                      onChange={e =>
                        handleVariableUpdate(idx, { description: e.target.value })
                      }
                      placeholder="Description (optional)"
                      className="w-full px-3 py-1.5 text-xs border border-border rounded bg-background text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex items-center gap-3 text-xs">
                      <select
                        value={variable.type}
                        onChange={e =>
                          handleVariableUpdate(idx, {
                            type: e.target.value as SkillVariable['type'],
                          })
                        }
                        className="px-2 py-1 border border-border rounded bg-background text-foreground text-xs"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="option">Option</option>
                      </select>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={variable.required}
                          onChange={e =>
                            handleVariableUpdate(idx, { required: e.target.checked })
                          }
                          className="rounded border-border"
                        />
                        <span className="text-muted-foreground">Required</span>
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveVariable(idx)}
                    className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Steps preview */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Steps Preview
        </label>
        <div className="max-h-32 overflow-y-auto space-y-1 p-3 rounded-lg bg-muted/20 border border-border/40">
          {state.recordedSteps.map((step, idx) => (
            <div key={idx} className="text-xs text-muted-foreground">
              {idx + 1}. {step.type}
              {isWorkflowStepPayload(step.payload) && step.payload.label && (
                <span className="ml-1">→ {step.payload.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Skill'}
        </button>
      </div>
    </div>
  );

  const renderSavedMode = () => (
    <div className="space-y-6 text-center py-8">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
        <svg
          className="w-8 h-8 text-green-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground">
        Skill Saved!
      </h3>
      <p className="text-sm text-muted-foreground">
        I've learned "{state.skillName}". You can now use it by asking me to do it!
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={state.mode === 'recording' ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl border border-border/60 shadow-soft-xl w-full max-w-md max-h-[90vh] overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Teach New Skill
            </h2>
          </div>
          {state.mode !== 'recording' && (
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
