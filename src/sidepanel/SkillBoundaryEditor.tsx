/**
 * Skill Boundary Editor
 *
 * Visual timeline editor for adjusting skill boundaries after recording.
 * Shows step blocks with colored skill segments that can be adjusted.
 */

import { useState, useCallback, useMemo } from 'react';
import type { WorkflowStep, SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { SuggestedSkill, SkillDefinition } from '../types/skill';
import { createSkillsWithDependencies } from '../lib/skill-extractor';

interface SkillBoundaryEditorProps {
  workflow: SavedWorkflow;
  suggestedSkills: SuggestedSkill[];
  onSave: (skills: SkillDefinition[]) => void;
  onCancel: () => void;
}

// Color palette for skills
const SKILL_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700' },
  { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-700' },
  { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-700' },
  { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700' },
  { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-700' },
  { bg: 'bg-cyan-100', border: 'border-cyan-300', text: 'text-cyan-700' },
];

export function SkillBoundaryEditor({
  workflow,
  suggestedSkills: initialSkills,
  onSave,
  onCancel,
}: SkillBoundaryEditorProps) {
  // Local state for editing
  const [skills, setSkills] = useState<SuggestedSkill[]>(initialSkills);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Currently selected skill
  const selectedSkill = skills[selectedIndex] || null;

  // Steps in the selected skill
  const selectedSteps = useMemo(() => {
    if (!selectedSkill) return [];
    return workflow.steps.slice(
      selectedSkill.startStep,
      selectedSkill.endStep + 1
    );
  }, [selectedSkill, workflow.steps]);

  // Update a skill's properties
  const updateSkill = useCallback(
    (updates: Partial<SuggestedSkill>) => {
      setSkills(prev => {
        const next = [...prev];
        next[selectedIndex] = { ...next[selectedIndex], ...updates };
        return next;
      });
    },
    [selectedIndex]
  );

  // Merge selected skill with next
  const mergeWithNext = useCallback(() => {
    if (selectedIndex >= skills.length - 1) return;

    setSkills(prev => {
      const next = [...prev];
      const current = next[selectedIndex];
      const nextSkill = next[selectedIndex + 1];

      // Merge into current
      next[selectedIndex] = {
        ...current,
        endStep: nextSkill.endStep,
        name: current.name, // Keep current name
        isRepeatable: current.isRepeatable || nextSkill.isRepeatable,
        variables: [...new Set([...current.variables, ...nextSkill.variables])],
        confidence: (current.confidence + nextSkill.confidence) / 2,
        reasoning: 'Merged skills',
      };

      // Remove the next skill
      next.splice(selectedIndex + 1, 1);
      return next;
    });
  }, [selectedIndex, skills.length]);

  // Split selected skill at a step
  const splitAt = useCallback(
    (stepIndex: number) => {
      if (!selectedSkill) return;
      if (
        stepIndex <= selectedSkill.startStep ||
        stepIndex > selectedSkill.endStep
      )
        return;

      setSkills(prev => {
        const next = [...prev];
        const current = next[selectedIndex];

        // Create two skills from one
        const firstHalf: SuggestedSkill = {
          ...current,
          endStep: stepIndex - 1,
          name: current.name,
        };

        const secondHalf: SuggestedSkill = {
          ...current,
          startStep: stepIndex,
          name: `${current.name} (continued)`,
        };

        // Replace current with first half, insert second half after
        next.splice(selectedIndex, 1, firstHalf, secondHalf);
        return next;
      });
    },
    [selectedIndex, selectedSkill]
  );

  // Handle save
  const handleSave = useCallback(() => {
    const fullSkills = createSkillsWithDependencies(
      skills,
      workflow,
      workflow.variables?.variables
    );
    onSave(fullSkills);
  }, [skills, workflow, onSave]);

  // Get color for a skill
  const getSkillColor = (index: number) =>
    SKILL_COLORS[index % SKILL_COLORS.length];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl border border-border/60 shadow-soft-xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Skill Boundary Editor
            </h2>
            <p className="text-sm text-muted-foreground">
              Adjust skill boundaries for "{workflow.name}"
            </p>
          </div>
          <button
            onClick={onCancel}
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
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Timeline visualization */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Timeline (click segment to select):
            </p>
            <div className="flex h-12 rounded-lg overflow-hidden border border-border/60">
              {skills.map((skill, idx) => {
                const color = getSkillColor(idx);
                const width =
                  ((skill.endStep - skill.startStep + 1) /
                    workflow.steps.length) *
                  100;
                const isSelected = idx === selectedIndex;

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className={`relative flex items-center justify-center px-2 ${
                      color.bg
                    } ${isSelected ? 'ring-2 ring-primary ring-inset' : ''} hover:opacity-90 transition-all`}
                    style={{ width: `${width}%` }}
                    title={`${skill.name} (steps ${skill.startStep + 1}-${skill.endStep + 1})`}
                  >
                    <span
                      className={`text-xs font-medium truncate ${color.text}`}
                    >
                      {skill.name}
                      {skill.isRepeatable && ' ↻'}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Step numbers */}
            <div className="flex text-[10px] text-muted-foreground px-1">
              {workflow.steps.map((_, idx) => (
                <div
                  key={idx}
                  className="flex-1 text-center"
                  style={{
                    width: `${100 / workflow.steps.length}%`,
                  }}
                >
                  {idx + 1}
                </div>
              ))}
            </div>
          </div>

          {/* Selected skill editor */}
          {selectedSkill && (
            <div className="space-y-4 p-4 rounded-xl border border-border/60 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Selected: "{selectedSkill.name}" (steps{' '}
                  {selectedSkill.startStep + 1}-{selectedSkill.endStep + 1})
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    getSkillColor(selectedIndex).bg
                  } ${getSkillColor(selectedIndex).text}`}
                >
                  Skill {selectedIndex + 1}
                </span>
              </div>

              {/* Name input */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Name:</label>
                <input
                  type="text"
                  value={selectedSkill.name}
                  onChange={e => updateSkill({ name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              {/* Flags */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSkill.isRepeatable}
                    onChange={e =>
                      updateSkill({ isRepeatable: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <span className="text-foreground">
                    Repeatable (for each item)
                  </span>
                </label>
              </div>

              {/* Selection behavior */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Selection behavior:
                </label>
                <div className="flex gap-4">
                  {(['first', 'all', 'ask', null] as const).map(opt => (
                    <label key={opt || 'none'} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="selection"
                        checked={selectedSkill.selectionBehavior === opt}
                        onChange={() => updateSkill({ selectionBehavior: opt })}
                        className="w-3.5 h-3.5 border-border text-primary focus:ring-primary/20"
                      />
                      <span className="text-foreground">
                        {opt === null ? 'N/A' : opt === 'ask' ? 'Ask user' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Steps in this skill */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Steps in this skill:
                </p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {selectedSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/30"
                    >
                      <span className="text-muted-foreground">
                        {selectedSkill.startStep + idx + 1}.
                      </span>
                      <span className="text-foreground flex-1 truncate">
                        {describeStep(step)}
                      </span>
                      {/* Split button (not on first step) */}
                      {idx > 0 && (
                        <button
                          onClick={() =>
                            splitAt(selectedSkill.startStep + idx)
                          }
                          className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          title="Split here"
                        >
                          Split
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {selectedIndex < skills.length - 1 && (
                  <button
                    onClick={mergeWithNext}
                    className="px-3 py-1.5 text-xs bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors"
                  >
                    Merge with Next
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Skills summary */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Skills to extract ({skills.length}):
            </p>
            <div className="space-y-1">
              {skills.map((skill, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                    idx === selectedIndex
                      ? `${getSkillColor(idx).bg} ${getSkillColor(idx).border}`
                      : 'border-border/60 hover:bg-muted/30'
                  }`}
                  onClick={() => setSelectedIndex(idx)}
                >
                  <span
                    className={`w-5 h-5 flex items-center justify-center rounded text-xs font-medium ${
                      getSkillColor(idx).bg
                    } ${getSkillColor(idx).text}`}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-sm text-foreground flex-1">
                    {skill.name}
                  </span>
                  {skill.isRepeatable && (
                    <span className="text-xs text-muted-foreground">↻</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {skill.endStep - skill.startStep + 1} steps
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/60 bg-muted/20">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-sm bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2.5 text-sm bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 shadow-soft transition-all"
          >
            Save Skills to Library
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Describe a step for display
 */
function describeStep(step: WorkflowStep): string {
  if (step.description) return step.description;

  const payload = step.payload;
  if (isWorkflowStepPayload(payload)) {
    const label = payload.label || payload.elementText || 'element';
    const value = payload.value ? ` = "${payload.value}"` : '';

    switch (step.type) {
      case 'CLICK':
        return `Click "${label}"`;
      case 'INPUT':
        return `Type "${label}"${value}`;
      case 'NAVIGATION':
        return `Navigate to ${new URL(payload.url).hostname}`;
      case 'KEYBOARD':
        return `Press ${payload.keyboardDetails?.key || 'key'}`;
      case 'SCROLL':
        return 'Scroll';
      default:
        return `${step.type} on "${label}"`;
    }
  }

  return `${step.type}`;
}
