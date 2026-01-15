/**
 * Skill Card Component
 *
 * Displays a skill in the library with actions for edit, delete, and test.
 */

import type { SkillSummary, SkillDefinition } from '../types/skill';

interface SkillCardProps {
  skill: SkillSummary | SkillDefinition;
  onEdit?: () => void;
  onDelete?: () => void;
  onTest?: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
  compact?: boolean;
}

export function SkillCard({
  skill,
  onEdit,
  onDelete,
  onTest,
  onSelect,
  isSelected,
  compact,
}: SkillCardProps) {
  // Get counts (handle both SkillSummary and SkillDefinition)
  const stepCount = 'stepCount' in skill ? skill.stepCount : skill.steps.length;
  const variableCount =
    'variableCount' in skill ? skill.variableCount : skill.variables.length;

  // Get verb/object (handle both types)
  const verb = 'verb' in skill ? skill.verb : skill.canonicalAction.verb;
  const object = 'object' in skill ? skill.object : skill.canonicalAction.object;

  if (compact) {
    return (
      <button
        onClick={onSelect}
        className={`w-full text-left p-3 rounded-xl border transition-all ${
          isSelected
            ? 'bg-primary/5 border-primary/40'
            : 'bg-card border-border/60 hover:border-border'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate flex-1">
            {skill.name}
          </span>
          {skill.isRepeatable && (
            <span className="text-xs text-muted-foreground">↻</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {verb} {object}
        </p>
      </button>
    );
  }

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        isSelected
          ? 'bg-primary/5 border-primary/40'
          : 'bg-card border-border/60 hover:border-border'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {skill.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{verb}</span> {object}
          </p>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {skill.isRepeatable && (
            <span
              className="w-6 h-6 flex items-center justify-center rounded-lg bg-green-100 text-green-700 text-xs font-bold"
              title="Repeatable"
            >
              ↻
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
        {skill.description}
      </p>

      {/* Stats */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          <span className="text-xs text-muted-foreground">
            {stepCount} steps
          </span>
        </div>
        {variableCount > 0 && (
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            <span className="text-xs text-muted-foreground">
              {variableCount} variables
            </span>
          </div>
        )}
      </div>

      {/* Source info */}
      <p className="text-[10px] text-muted-foreground mb-3">
        From: {skill.sourceWorkflowName}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onTest && (
          <button
            onClick={onTest}
            className="flex-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-colors"
          >
            Test
          </button>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
