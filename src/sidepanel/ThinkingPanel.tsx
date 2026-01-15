import { useState, useEffect } from 'react';
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

export function ThinkingPanel({
  events,
  currentStep,
  isRunning,
  isStopped,
  pauseReason,
  helpContext,
  onStop,
  onResume,
  onDismiss,
}: ThinkingPanelProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  // Timer for elapsed time
  useEffect(() => {
    if (!isRunning) return;
    const startTime = Date.now() - (elapsedTime * 1000);
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Reset timer when starting fresh
  useEffect(() => {
    if (events.length === 0) {
      setElapsedTime(0);
    }
  }, [events.length]);

  // Calculate progress
  const completedSteps = currentStep.index;
  const totalSteps = currentStep.total;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Format elapsed time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Get current action details
  const getCurrentAction = () => {
    const lastEvent = events[events.length - 1];
    if (!lastEvent) return { status: 'Initializing', detail: 'Preparing to start...' };

    switch (lastEvent.type) {
      case 'observe':
        return { status: 'Observing', detail: 'Analyzing page structure...' };
      case 'decide':
        if (lastEvent.decision?.targetDescription) {
          return {
            status: lastEvent.decision.action || 'Planning',
            detail: lastEvent.decision.targetDescription
          };
        }
        return { status: 'Deciding', detail: 'Determining next action...' };
      case 'act':
        return {
          status: lastEvent.result?.success ? 'Completed' : 'Retrying',
          detail: lastEvent.result?.success ? 'Action successful' : 'Attempting again...'
        };
      case 'complete':
        return { status: 'Finished', detail: 'All steps completed successfully' };
      default:
        return { status: 'Processing', detail: 'Working...' };
    }
  };

  const isComplete = events.some(e => e.type === 'complete');
  const action = getCurrentAction();

  // Get recent activity log (last 3 events)
  const recentEvents = events.slice(-4).reverse();

  return (
    <div className="flex flex-col min-h-[400px] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`w-2.5 h-2.5 rounded-full ${
            isComplete ? 'bg-green-500' :
            isStopped ? 'bg-amber-500' :
            isRunning ? 'bg-primary animate-pulse' : 'bg-gray-300'
          }`} />
          <span className="text-sm font-medium text-muted-foreground">
            {isComplete ? 'Completed' : isStopped ? 'Paused' : isRunning ? 'Running' : 'Ready'}
          </span>
        </div>
        {totalSteps > 0 && (
          <span className="text-sm text-muted-foreground">
            Step {Math.min(completedSteps + 1, totalSteps)} of {totalSteps}
          </span>
        )}
      </div>

      {/* Main Status */}
      <div className="flex-1 flex flex-col justify-center py-8">
        {/* Current Action */}
        <div className="text-center mb-8">
          <h2 className={`text-2xl font-semibold tracking-tight mb-2 ${
            isComplete ? 'text-green-600' : 'text-foreground'
          }`}>
            {action.status}
          </h2>
          <p className="text-muted-foreground text-sm max-w-[280px] mx-auto line-clamp-2">
            {action.detail}
          </p>
        </div>

        {/* Progress Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>{progressPercent}% complete</span>
            <span>{formatTime(elapsedTime)}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ease-out rounded-full ${
                isComplete ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${Math.max(progressPercent, 2)}%` }}
            />
          </div>
        </div>

        {/* Activity Log */}
        {recentEvents.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Recent Activity
            </h3>
            <div className="space-y-2">
              {recentEvents.map((event, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 text-sm py-2 px-3 rounded-lg ${
                    i === 0 ? 'bg-muted/50' : ''
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    event.type === 'complete' ? 'bg-green-500' :
                    event.type === 'act' && event.result?.success === false ? 'bg-red-400' :
                    i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'
                  }`} />
                  <span className={`${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {event.type === 'observe' && 'Analyzed page'}
                    {event.type === 'decide' && (event.decision?.targetDescription
                      ? `${event.decision.action}: ${event.decision.targetDescription.slice(0, 40)}${event.decision.targetDescription.length > 40 ? '...' : ''}`
                      : 'Planned next action')}
                    {event.type === 'act' && (event.result?.success ? 'Action completed' : 'Action failed, retrying')}
                    {event.type === 'complete' && 'Workflow finished'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-auto space-y-3">
        <div className="flex items-center gap-3">
          <OpenWorkWindowButton variant="secondary" />

          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="flex-1 py-3.5 px-5 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
            >
              Stop
            </button>
          )}

          {isStopped && onResume && pauseReason !== 'agent_needs_help' && (
            <button
              onClick={() => onResume()}
              className="flex-1 py-3.5 px-5 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
            >
              Resume
            </button>
          )}

          {!isRunning && !isStopped && onDismiss && (
            <button
              onClick={onDismiss}
              className="flex-1 py-3.5 px-5 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Human Help Request - Only show when agent needs help */}
      {pauseReason === 'agent_needs_help' && helpContext && (
        <div className="mt-6 p-5 bg-amber-50/80 border border-amber-200/60 rounded-2xl animate-fade-in">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">
                I need your help
              </h3>
              <div className="space-y-1.5 text-sm text-amber-700">
                <p><span className="font-medium">Task:</span> {helpContext.stepDescription}</p>
                <p><span className="font-medium">Issue:</span> {helpContext.whatAgentTried}</p>
                <p><span className="font-medium">Please:</span> {helpContext.whatHumanShouldDo}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onResume?.('completed')}
              className="w-full py-3.5 px-4 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 active:scale-[0.98] shadow-soft transition-all duration-200"
            >
              I completed it - Continue
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onResume?.('retry')}
                className="flex-1 py-3 px-3 bg-white/80 border border-amber-200/60 text-amber-700 rounded-xl text-sm font-medium hover:bg-white active:scale-[0.98] transition-all duration-200"
              >
                Try again
              </button>
              <button
                onClick={() => onResume?.('skipped')}
                className="flex-1 py-3 px-3 bg-white/80 border border-amber-200/60 text-amber-600 rounded-xl text-sm font-medium hover:bg-white active:scale-[0.98] transition-all duration-200"
              >
                Skip step
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
