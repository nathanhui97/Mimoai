import { useState, useEffect, useRef } from 'react';
import type { ThinkingEvent } from '../types/messages';
import type { WorkflowStep } from '../types/workflow';
import { OpenWorkWindowButton } from './OpenWorkWindowButton';

interface HumanHelpContext {
  stepDescription: string;
  whatAgentTried: string;
  whatHumanShouldDo: string;
  errorDetails?: string;
}

interface ThinkingPanelProps {
  events: ThinkingEvent[];
  currentStep: { index: number; total: number };
  hints: WorkflowStep[];
  isRunning: boolean;
  isStopped?: boolean;
  workflowName?: string;
  pauseReason?: 'user_requested' | 'agent_needs_help' | 'error_recovery' | 'confirmation_needed';
  helpContext?: HumanHelpContext;
  onStop?: () => void;
  onResume?: (choice?: 'completed' | 'skipped' | 'retry') => void;
  onDismiss?: () => void;
}

// Status icons as components for cleaner rendering
const StatusIcons = {
  completed: (
    <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
      <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    </div>
  ),
  current: (
    <div className="w-5 h-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
      <div className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
    </div>
  ),
  pending: (
    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center flex-shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
    </div>
  ),
};

export function ThinkingPanel({
  events,
  currentStep,
  hints,
  isRunning,
  isStopped,
  workflowName,
  pauseReason,
  helpContext,
  onStop,
  onResume,
  onDismiss,
}: ThinkingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest thinking when new events arrive
  useEffect(() => {
    if (thinkingRef.current && events.length > 0) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [events]);

  // Calculate progress
  const completedSteps = currentStep.index;
  const totalSteps = currentStep.total;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Helper to get step status
  const getStepStatus = (index: number) => {
    if (index < currentStep.index) return 'completed';
    if (index === currentStep.index) return 'current';
    return 'pending';
  };

  // Get simplified status message from latest event
  const getLatestStatus = () => {
    const lastEvent = events[events.length - 1];
    if (!lastEvent) return isRunning ? 'Starting...' : 'Ready';

    switch (lastEvent.type) {
      case 'observe':
        return 'Analyzing page...';
      case 'decide':
        return lastEvent.decision?.targetDescription
          ? `Planning: ${lastEvent.decision.targetDescription}`
          : 'Deciding next action...';
      case 'act':
        return lastEvent.result?.success ? 'Action completed' : 'Retrying...';
      case 'complete':
        return 'Workflow completed!';
      default:
        return 'Working...';
    }
  };

  return (
    <div className="mb-6 p-4 bg-card rounded-xl border border-purple-200 dark:border-purple-800">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="h-4 w-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="truncate">{workflowName || 'Running Task'}</span>
            {isRunning && (
              <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
            )}
          </h2>
          <div className="flex items-center gap-2">
            <OpenWorkWindowButton variant="text" />
            {isRunning && onStop && (
              <button
                onClick={onStop}
                className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                Stop
              </button>
            )}
            {isStopped && onResume && pauseReason !== 'agent_needs_help' && (
              <button
                onClick={() => onResume()}
                className="px-3 py-1.5 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
              >
                Resume
              </button>
            )}
            {!isRunning && !isStopped && onDismiss && (
              <button
                onClick={onDismiss}
                className="px-3 py-1.5 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors"
              >
                ← Home
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium">Step {completedSteps} of {totalSteps}</span>
            <span className="text-muted-foreground">{getLatestStatus()}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Human Help Request */}
      {pauseReason === 'agent_needs_help' && helpContext && (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center flex-shrink-0">
              <svg className="h-4 w-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                I need your help
              </h3>
              <div className="space-y-2 text-sm text-yellow-700 dark:text-yellow-300">
                <p><span className="font-medium">Task:</span> {helpContext.stepDescription}</p>
                <p><span className="font-medium">Issue:</span> {helpContext.whatAgentTried}</p>
                <p><span className="font-medium">Please:</span> {helpContext.whatHumanShouldDo}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onResume?.('completed')}
              className="w-full py-3 px-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
            >
              I completed it - Continue
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onResume?.('retry')}
                className="flex-1 py-2 px-3 bg-muted text-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => onResume?.('skipped')}
                className="flex-1 py-2 px-3 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
              >
                Skip step
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step Checklist */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-card-foreground mb-2">Progress</h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {hints.slice(0, totalSteps).map((hint, index) => {
            const status = getStepStatus(index);
            return (
              <div key={index} className="flex items-center gap-3 py-1.5">
                {StatusIcons[status]}
                <span className={`flex-1 truncate text-sm ${
                  status === 'completed' ? 'text-muted-foreground' :
                  status === 'current' ? 'text-foreground font-medium' :
                  'text-muted-foreground'
                }`}>
                  {(hint as any).description || hint.naturalLanguage?.intent || `Step ${index + 1}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Details (Collapsed by default) */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>Details</span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <div ref={thinkingRef} className="mt-3 space-y-2 max-h-48 overflow-y-auto text-sm">
            {events.map((event, index) => {
              // Simplified event rendering
              if (event.type === 'observe' && event.observation) {
                return (
                  <div key={index} className="flex items-center gap-3 p-2.5 bg-muted/50 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" />
                      </svg>
                    </div>
                    <span className="text-muted-foreground">Analyzing page...</span>
                  </div>
                );
              }

              if (event.type === 'decide' && event.decision) {
                return (
                  <div key={index} className="flex items-center gap-3 p-2.5 bg-muted/50 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <span className="text-foreground truncate">
                      {event.decision.action}: {event.decision.targetDescription || 'element'}
                    </span>
                  </div>
                );
              }

              if (event.type === 'act' && event.result) {
                return (
                  <div key={index} className="flex items-center gap-3 p-2.5 bg-muted/50 rounded-lg">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      event.result.success
                        ? 'bg-green-100 dark:bg-green-900/30'
                        : 'bg-red-100 dark:bg-red-900/30'
                    }`}>
                      {event.result.success ? (
                        <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                    <span className={event.result.success ? 'text-muted-foreground' : 'text-red-600'}>
                      {event.result.success ? 'Done' : 'Retrying...'}
                    </span>
                  </div>
                );
              }

              if (event.type === 'complete' && event.result) {
                return (
                  <div key={index} className="flex items-center gap-3 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-green-700 dark:text-green-400 font-medium">Completed!</span>
                  </div>
                );
              }

              return null;
            })}

            {events.length === 0 && isRunning && (
              <div className="p-3 bg-muted/50 rounded-lg text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Starting...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
