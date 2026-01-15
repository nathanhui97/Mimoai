/**
 * Annotation Input Component
 *
 * Shows during recording to allow users to add notes/annotations.
 * Annotations are attached to workflow steps for skill extraction.
 *
 * - Press Enter to attach to most recent step
 * - Shift+Enter for workflow-level annotation
 * - Real-time pattern detection as user types
 */

import { useState, useCallback, useMemo } from 'react';
import type { StepAnnotation } from '../types/skill';
import { parseAnnotation, getPatternSummary } from '../lib/annotation-parser';

interface AnnotationInputProps {
  isRecording: boolean;
  currentStepIndex: number;
  annotations: StepAnnotation[];
  onAnnotation: (annotation: StepAnnotation) => void;
}

export function AnnotationInput({
  isRecording,
  currentStepIndex,
  annotations,
  onAnnotation,
}: AnnotationInputProps) {
  const [text, setText] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  // Parse annotation in real-time
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return parseAnnotation(text);
  }, [text]);

  // Pattern badges for display
  const patternBadges = useMemo(() => {
    if (!parsed) return [];
    return getPatternSummary(text);
  }, [parsed, text]);

  // Handle annotation submission
  const handleSubmit = useCallback(
    (isWorkflowLevel: boolean) => {
      if (!text.trim()) return;

      const annotation: StepAnnotation = {
        text: text.trim(),
        attachedToStepIndex: isWorkflowLevel ? -1 : currentStepIndex,
        timestamp: Date.now(),
        detectedPatterns: parsed?.patterns || [],
      };

      onAnnotation(annotation);
      setText('');
    },
    [text, currentStepIndex, parsed, onAnnotation]
  );

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit(e.shiftKey); // Shift+Enter = workflow-level
      }
    },
    [handleSubmit]
  );

  // Recent annotations (last 5)
  const recentAnnotations = useMemo(() => {
    return [...annotations]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [annotations]);

  // Don't render if not recording
  if (!isRecording) return null;

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden mb-4">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          <span className="text-sm font-medium text-foreground">
            Add notes while recording
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3">
          {/* Input field */}
          <div className="relative">
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type here... (Enter to attach to step)"
              className="w-full px-4 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent"
            />

            {/* Pattern badges */}
            {patternBadges.length > 0 && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                {patternBadges.slice(0, 2).map((badge, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Help text */}
          <p className="text-xs text-muted-foreground">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to attach to step {currentStepIndex + 1}
            {' | '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift+Enter</kbd> for workflow note
          </p>

          {/* Recent annotations */}
          {recentAnnotations.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <p className="text-xs text-muted-foreground font-medium">
                Recent annotations:
              </p>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {recentAnnotations.map((ann, idx) => (
                  <AnnotationItem key={idx} annotation={ann} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Single annotation item display
 */
function AnnotationItem({ annotation }: { annotation: StepAnnotation }) {
  const stepLabel =
    annotation.attachedToStepIndex === -1
      ? 'Workflow'
      : `Step ${annotation.attachedToStepIndex + 1}`;

  // Get pattern type badges
  const patternTypes = annotation.detectedPatterns.map(p => p.type);

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
        {stepLabel}
      </span>
      <span className="text-foreground break-words flex-1">
        "{annotation.text}"
      </span>
      {patternTypes.length > 0 && (
        <div className="flex gap-0.5 shrink-0">
          {patternTypes.includes('skill_start') && (
            <PatternBadge type="start" />
          )}
          {patternTypes.includes('repeatable') && (
            <PatternBadge type="repeat" />
          )}
          {(patternTypes.includes('selection_all') ||
            patternTypes.includes('selection_first')) && (
            <PatternBadge type="select" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Small pattern badge
 */
function PatternBadge({ type }: { type: 'start' | 'repeat' | 'select' }) {
  const config = {
    start: { label: 'S', bg: 'bg-blue-100', text: 'text-blue-700' },
    repeat: { label: 'R', bg: 'bg-green-100', text: 'text-green-700' },
    select: { label: 'A', bg: 'bg-amber-100', text: 'text-amber-700' },
  }[type];

  return (
    <span
      className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${config.bg} ${config.text}`}
      title={type === 'start' ? 'Skill Start' : type === 'repeat' ? 'Repeatable' : 'Selection'}
    >
      {config.label}
    </span>
  );
}
