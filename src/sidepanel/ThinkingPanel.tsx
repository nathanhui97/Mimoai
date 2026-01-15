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

export function ThinkingPanel({
  events,
  currentStep,
  hints,
  isRunning,
  isStopped,
  pauseReason,
  helpContext,
  onStop,
  onResume,
  onDismiss,
}: ThinkingPanelProps) {
  // Track previous step for smooth transitions
  const [displayedStep, setDisplayedStep] = useState(currentStep.index);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevStepRef = useRef(currentStep.index);

  // Smooth step transitions
  useEffect(() => {
    if (currentStep.index !== prevStepRef.current) {
      setIsTransitioning(true);
      // Small delay for exit animation
      const timer = setTimeout(() => {
        setDisplayedStep(currentStep.index);
        prevStepRef.current = currentStep.index;
        // Allow enter animation
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [currentStep.index]);

  // Calculate progress
  const completedSteps = currentStep.index;
  const totalSteps = currentStep.total;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Get human-readable description for a workflow step
  const getStepDescription = (stepIndex: number): string | null => {
    const step = hints[stepIndex];
    if (!step) return null;

    // Prefer natural language intent if available
    if (step.naturalLanguage?.intent) {
      return step.naturalLanguage.intent;
    }

    // Fall back to description
    if (step.description) {
      return step.description;
    }

    // Generate from step type
    if ('selector' in step.payload) {
      const payload = step.payload as { label?: string; elementText?: string; value?: string };
      switch (step.type) {
        case 'CLICK':
          return `Click "${payload.elementText || payload.label || 'element'}"`;
        case 'INPUT':
          const value = payload.value?.substring(0, 20);
          return `Type "${value}${value && value.length >= 20 ? '...' : ''}" in ${payload.label || 'field'}`;
        case 'NAVIGATION':
          return 'Navigate to page';
        case 'SCROLL':
          return 'Scroll page';
        case 'KEYBOARD':
          return 'Press key';
        default:
          return step.type;
      }
    }

    return step.type;
  };

  const isComplete = events.some(e => e.type === 'complete');

  return (
    <div className="flex flex-col h-full min-h-[400px]">
      {/* Header - Fixed */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full transition-colors duration-300 ${
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

      {/* Chain of Thought - Flexible middle section with fixed height */}
      <div className="flex-1 flex flex-col justify-center py-6">
        {hints.length > 0 ? (
          <div className="h-[120px] flex flex-col justify-center overflow-hidden">
            {/* Previous step - faded */}
            <div className={`h-8 flex items-center transition-all duration-300 ease-out ${
              displayedStep > 0 ? 'opacity-40' : 'opacity-0'
            }`}>
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="truncate max-w-[260px]">
                  {displayedStep > 0 ? (getStepDescription(displayedStep - 1) || `Step ${displayedStep}`) : ''}
                </span>
              </span>
            </div>

            {/* Current step - prominent */}
            <div className={`h-10 flex items-center transition-all duration-300 ease-out ${
              isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            }`}>
              <span className="inline-flex items-center gap-2.5 text-base text-foreground font-medium">
                {isRunning && !isComplete && (
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                )}
                {isComplete && (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className="truncate max-w-[280px]">
                  {isComplete
                    ? 'All steps completed'
                    : (getStepDescription(displayedStep) || `Step ${displayedStep + 1}`)}
                </span>
              </span>
            </div>

            {/* Next step - very faded preview */}
            <div className={`h-8 flex items-center transition-all duration-300 ease-out ${
              displayedStep < hints.length - 1 && !isComplete ? 'opacity-25' : 'opacity-0'
            }`}>
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <span className="w-3.5 text-center text-xs">{displayedStep + 2}</span>
                <span className="truncate max-w-[260px]">
                  {displayedStep < hints.length - 1 ? (getStepDescription(displayedStep + 1) || `Step ${displayedStep + 2}`) : ''}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <div className="h-[120px] flex items-center justify-center">
            <span className="text-muted-foreground text-sm">Preparing workflow...</span>
          </div>
        )}
      </div>

      {/* Bottom Section - Fixed */}
      <div className="flex-shrink-0 space-y-4">
        {/* Progress Bar */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>{progressPercent}% complete</span>
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

        {/* Action Buttons */}
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
