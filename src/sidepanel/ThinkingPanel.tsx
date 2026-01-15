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
  const [dots, setDots] = useState('');

  // Animate dots for "thinking" effect
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Calculate progress
  const completedSteps = currentStep.index;
  const totalSteps = currentStep.total;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Get AI status message from latest event
  const getAIStatus = () => {
    const lastEvent = events[events.length - 1];
    if (!lastEvent) return isRunning ? 'Starting' : 'Ready';

    switch (lastEvent.type) {
      case 'observe':
        return 'Analyzing page';
      case 'decide':
        if (lastEvent.decision?.targetDescription) {
          const action = lastEvent.decision.action || 'Planning';
          const target = lastEvent.decision.targetDescription;
          // Truncate long descriptions
          const shortTarget = target.length > 30 ? target.substring(0, 30) + '...' : target;
          return `${action}: ${shortTarget}`;
        }
        return 'Deciding next action';
      case 'act':
        return lastEvent.result?.success ? 'Action completed' : 'Retrying';
      case 'complete':
        return 'Workflow completed!';
      default:
        return 'Working';
    }
  };

  const isComplete = events.some(e => e.type === 'complete');

  return (
    <div className="mb-6">
      {/* Main Card */}
      <div className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl border border-purple-100 shadow-sm">
        {/* AI Brain Header */}
        <div className="flex items-center justify-center mb-6">
          <div className="relative">
            {/* Outer glow ring */}
            {isRunning && (
              <div className="absolute inset-0 w-16 h-16 rounded-full bg-purple-400/20 animate-ping" />
            )}
            {/* Brain icon container */}
            <div className={`relative w-16 h-16 rounded-full flex items-center justify-center ${
              isComplete
                ? 'bg-green-100'
                : isRunning
                  ? 'bg-purple-100'
                  : isStopped
                    ? 'bg-yellow-100'
                    : 'bg-gray-100'
            }`}>
              {isComplete ? (
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className={`w-8 h-8 ${isRunning ? 'text-purple-600' : isStopped ? 'text-yellow-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Status Text */}
        <div className="text-center mb-6">
          <p className={`text-base font-medium ${isComplete ? 'text-green-600' : isStopped ? 'text-yellow-600' : 'text-purple-600'}`}>
            {isComplete ? 'Completed!' : isStopped ? 'Paused' : getAIStatus()}{isRunning && !isComplete && dots}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="h-2 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ease-out rounded-full ${
                isComplete ? 'bg-green-500' : 'bg-purple-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <OpenWorkWindowButton variant="secondary" />

          {isRunning && onStop && (
            <button
              onClick={onStop}
              className="flex-1 py-3 px-4 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          )}

          {isStopped && onResume && pauseReason !== 'agent_needs_help' && (
            <button
              onClick={() => onResume()}
              className="flex-1 py-3 px-4 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
            >
              Resume
            </button>
          )}

          {!isRunning && !isStopped && onDismiss && (
            <button
              onClick={onDismiss}
              className="flex-1 py-3 px-4 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Human Help Request - Only show when agent needs help */}
      {pauseReason === 'agent_needs_help' && helpContext && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-800 mb-2">
                I need your help
              </h3>
              <div className="space-y-1.5 text-sm text-yellow-700">
                <p><span className="font-medium">Task:</span> {helpContext.stepDescription}</p>
                <p><span className="font-medium">Issue:</span> {helpContext.whatAgentTried}</p>
                <p><span className="font-medium">Please:</span> {helpContext.whatHumanShouldDo}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onResume?.('completed')}
              className="w-full py-3 px-4 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
            >
              I completed it - Continue
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onResume?.('retry')}
                className="flex-1 py-2.5 px-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => onResume?.('skipped')}
                className="flex-1 py-2.5 px-3 bg-white border border-gray-200 text-gray-500 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
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
