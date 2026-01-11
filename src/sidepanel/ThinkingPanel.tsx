import { useState, useEffect, useRef } from 'react';
import type { ThinkingEvent } from '../types/messages';
import type { WorkflowStep } from '../types/workflow';

interface ThinkingPanelProps {
  events: ThinkingEvent[];
  currentStep: { index: number; total: number };
  hints: WorkflowStep[];
  isRunning: boolean;
  isStopped?: boolean;
  workflowName?: string;
  onStop?: () => void;
  onResume?: () => void;
}

export function ThinkingPanel({
  events,
  currentStep,
  hints,
  isRunning,
  isStopped,
  workflowName,
  onStop,
  onResume,
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
            {isRunning && onStop && (
              <button
                onClick={onStop}
                className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
              >
                Stop
              </button>
            )}
            {isStopped && onResume && (
              <button
                onClick={onResume}
                className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
              >
                Resume
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
                  {hint.naturalLanguage?.intent || hint.description || `Step ${index + 1}`}
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
