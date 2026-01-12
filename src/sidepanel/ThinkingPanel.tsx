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
  workflowName,
  pauseReason,
  helpContext,
  onStop,
  onResume,
  onDismiss,
}: ThinkingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
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

  return (
    <div className="mb-6 p-4 bg-card rounded-lg border border-purple-200">
      {/* Header */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <svg className="h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            {workflowName ? `Running: ${workflowName}` : 'AI Assistant'}
            {isRunning && (
              <span className="flex items-center gap-1 text-sm text-purple-600">
                <span className="animate-pulse">●</span>
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {/* Open Work Window button - always visible during execution */}
            <OpenWorkWindowButton variant="text" />
            {/* Show Stop button when running */}
            {isRunning && onStop && (
              <button
                onClick={onStop}
                className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                title="Stop execution"
              >
                Stop
              </button>
            )}
            {/* Show Resume button when stopped (but not waiting for help) */}
            {isStopped && onResume && pauseReason !== 'agent_needs_help' && (
              <button
                onClick={() => onResume()}
                className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                title="Resume execution from where it stopped"
              >
                Resume
              </button>
            )}
            {/* Show Back to Home button when execution is complete/orphaned */}
            {!isRunning && !isStopped && onDismiss && (
              <button
                onClick={onDismiss}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                title="Back to home"
              >
                ← Back to Home
              </button>
            )}
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Step {completedSteps} of {totalSteps}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple-600 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Human Help Request */}
      {pauseReason === 'agent_needs_help' && helpContext && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2 mb-2">
            <svg className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-800 mb-1">
                I Need Your Help
              </h3>
              <div className="space-y-2 text-sm text-yellow-700">
                <div>
                  <span className="font-medium">What I'm trying to do:</span>
                  <div className="mt-1">{helpContext.stepDescription}</div>
                </div>
                <div>
                  <span className="font-medium">What I tried:</span>
                  <div className="mt-1">{helpContext.whatAgentTried}</div>
                </div>
                <div>
                  <span className="font-medium">What you should do:</span>
                  <div className="mt-1">{helpContext.whatHumanShouldDo}</div>
                </div>
                {helpContext.errorDetails && (
                  <div>
                    <span className="font-medium">Error:</span>
                    <div className="mt-1 text-xs font-mono">{helpContext.errorDetails}</div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onResume?.('completed')}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors font-medium"
                >
                  ✓ I Did It - Continue
                </button>
                <button
                  onClick={() => onResume?.('skipped')}
                  className="flex-1 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                >
                  Skip This Step
                </button>
                <button
                  onClick={() => onResume?.('retry')}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  🔄 Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step Checklist */}
      <div className="mb-3">
        <h3 className="text-sm font-medium text-card-foreground mb-2">Steps</h3>
        <div className="space-y-1 max-h-32 overflow-y-auto text-sm">
          {hints.slice(0, totalSteps).map((hint, index) => {
            const status = getStepStatus(index);
            return (
              <div key={index} className="flex items-center gap-2 py-1">
                {status === 'completed' && (
                  <span className="text-green-600 flex-shrink-0">✓</span>
                )}
                {status === 'current' && (
                  <span className="text-purple-600 flex-shrink-0">→</span>
                )}
                {status === 'pending' && (
                  <span className="text-gray-400 flex-shrink-0">○</span>
                )}
                <span className={`flex-1 truncate ${
                  status === 'completed' ? 'text-muted-foreground line-through' :
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

      {/* Current Thinking */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-sm font-medium text-card-foreground hover:text-purple-600 transition-colors"
        >
          <span>Current Thinking</span>
          <svg 
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <div ref={thinkingRef} className="mt-3 space-y-2 max-h-64 overflow-y-auto text-sm">
            {/* Show all events in chronological order */}
            {events.map((event, index) => {
              // Observation event
              if (event.type === 'observe' && event.observation) {
                return (
                  <div key={index} className="p-2.5 bg-muted rounded border border-border">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm">👁</span>
                      <span className="text-xs font-medium text-foreground">Observing page (step {event.stepIndex + 1})</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5 ml-6">
                      <div>{new URL(event.observation.url).pathname}</div>
                      {event.observation.hasModal && <div>Modal is open</div>}
                      {event.observation.hasDropdown && <div>Dropdown is open</div>}
                      <div>{event.observation.elementsFound} interactive elements</div>
                    </div>
                  </div>
                );
              }
              
              // Decision event
              if (event.type === 'decide' && event.decision) {
                return (
                  <div key={index} className="p-2.5 bg-muted rounded border border-border">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm">🧠</span>
                      <span className="text-xs font-medium text-foreground">
                        Decision: {event.decision.action}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5 ml-6">
                      {event.decision.targetDescription && (
                        <div>Target: {event.decision.targetDescription}</div>
                      )}
                      <div>Confidence: {Math.round(event.decision.confidence * 100)}%</div>
                      {event.decision.reasoning && (
                        <div className="mt-1 italic">"{event.decision.reasoning}"</div>
                      )}
                    </div>
                  </div>
                );
              }
              
              // Action result event
              if (event.type === 'act' && event.result) {
                return (
                  <div key={index} className="p-2.5 bg-muted rounded border border-border">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm">{event.result.success ? '⚡' : '❌'}</span>
                      <span className="text-xs font-medium text-foreground">
                        {event.result.success ? 'Action completed' : 'Action failed'}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground ml-6">
                      <div>Duration: {event.result.duration}ms</div>
                      {event.result.error && (
                        <div className="mt-1">Error: {event.result.error}</div>
                      )}
                    </div>
                  </div>
                );
              }
              
              // Complete event
              if (event.type === 'complete' && event.result) {
                return (
                  <div key={index} className="p-2.5 bg-muted rounded border border-border">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">✅</span>
                      <span className="text-xs font-medium text-foreground">
                        Workflow completed
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {Math.round(event.result.duration / 1000)}s total
                      </span>
                    </div>
                  </div>
                );
              }
              
              return null;
            })}

            {/* Loading state when no events yet */}
            {events.length === 0 && isRunning && (
              <div className="p-3 bg-muted rounded border border-border text-center">
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Starting AI agent...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
