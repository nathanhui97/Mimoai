/**
 * ReplayerView - Unified replayer using Universal Execution Engine
 * 
 * Shows:
 * - Step goals and verification status
 * - Recovery actions taken
 * - Disambiguation prompts
 * - Execution metrics
 */

import { useEffect, useState } from 'react';
import type { SavedWorkflow } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { StepMetrics, InstrumentationSummary } from '../lib/step-instrumentation';
import { StepInstrumentation } from '../lib/step-instrumentation';

interface ReplayerViewProps {
  workflow: SavedWorkflow;
  variableValues?: Record<string, string>;
  onClose?: () => void;
}

interface StepStatus {
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'needs_input';
  error?: string;
  metrics?: Partial<StepMetrics>;
  winningStrategy?: string;
  recoveryUsed?: boolean;
}

/**
 * Disambiguation Modal Component
 */
function DisambiguationModal({
  candidates,
  stepDescription,
  onSelect,
  onCancel,
}: {
  candidates: Array<{ element: string; text: string; index: number }>;
  stepDescription: string;
  onSelect: (index: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded-lg border border-border max-w-lg w-full mx-4">
        <h3 className="text-lg font-semibold mb-2 text-card-foreground">
          Multiple Matches Found
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Found {candidates.length} elements matching step: <strong>{stepDescription}</strong>
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Please select the correct element:
        </p>
        
        <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
          {candidates.map((candidate, index) => (
            <button
              key={index}
              onClick={() => onSelect(candidate.index)}
              className="w-full p-3 text-left border border-border rounded-md hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <div className="font-medium text-foreground">{candidate.element}</div>
              <div className="text-sm text-muted-foreground truncate">{candidate.text}</div>
            </button>
          ))}
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Cancel Execution
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Metrics Panel Component
 */
function MetricsPanel({ summary }: { summary: InstrumentationSummary }) {
  return (
    <div className="p-3 bg-muted rounded-md text-sm space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Success Rate:</span>
        <span className={`font-medium ${
          summary.successRate >= 0.9 ? 'text-green-600' :
          summary.successRate >= 0.7 ? 'text-yellow-600' : 'text-red-600'
        }`}>
          {Math.round(summary.successRate * 100)}%
        </span>
      </div>
      
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Steps:</span>
        <span className="text-foreground">
          {summary.successfulSteps}/{summary.totalSteps} passed
        </span>
      </div>
      
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Avg Time/Step:</span>
        <span className="text-foreground">{Math.round(summary.avgTotalTimeMs)}ms</span>
      </div>
      
      {summary.topStrategies.length > 0 && (
        <div>
          <span className="text-muted-foreground">Top Strategy: </span>
          <span className="text-foreground">{summary.topStrategies[0].strategy}</span>
        </div>
      )}
      
      {summary.topRecoveryActions.length > 0 && (
        <div>
          <span className="text-muted-foreground">Recovery Used: </span>
          <span className="text-foreground">{summary.topRecoveryActions[0].action}</span>
        </div>
      )}
    </div>
  );
}

/**
 * ReplayerView Component
 */
export function ReplayerView({
  workflow,
  variableValues,
  onClose,
}: ReplayerViewProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Map<number, StepStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState<InstrumentationSummary | null>(null);
  const [disambiguationData, setDisambiguationData] = useState<{
    candidates: Array<{ element: string; text: string; index: number }>;
    stepDescription: string;
    resolve: (index: number | null) => void;
  } | null>(null);
  
  const stepsToDisplay = workflow.optimizedSteps || workflow.steps;
  
  // Initialize step statuses
  useEffect(() => {
    const initialStatuses = new Map<number, StepStatus>();
    stepsToDisplay.forEach((_, index) => {
      initialStatuses.set(index, { status: 'pending' });
    });
    setStepStatuses(initialStatuses);
  }, [workflow]);
  
  // Listen for execution progress messages
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'VERIFIED_EXECUTION_STARTED') {
        setIsExecuting(true);
        setError(null);
        setCurrentStepIndex(null);
        
        const newStatuses = new Map<number, StepStatus>();
        stepsToDisplay.forEach((_, index) => {
          newStatuses.set(index, { status: 'pending' });
        });
        setStepStatuses(newStatuses);
        
      } else if (message.type === 'VERIFIED_STEP_STARTED') {
        const { stepIndex } = message.payload;
        setCurrentStepIndex(stepIndex);
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, { status: 'executing' });
          return next;
        });
        
      } else if (message.type === 'VERIFIED_STEP_COMPLETED') {
        const { stepIndex, metrics: stepMetrics } = message.payload;
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, {
            status: 'completed',
            metrics: stepMetrics,
            winningStrategy: stepMetrics?.resolution?.winningStrategy,
            recoveryUsed: stepMetrics?.recovery?.attemptCount > 0,
          });
          return next;
        });
        
      } else if (message.type === 'VERIFIED_STEP_FAILED') {
        const { stepIndex, error: stepError, metrics: stepMetrics } = message.payload;
        setStepStatuses(prev => {
          const next = new Map(prev);
          next.set(stepIndex, {
            status: 'failed',
            error: stepError,
            metrics: stepMetrics,
          });
          return next;
        });
        setError(stepError);
        
      } else if (message.type === 'VERIFIED_EXECUTION_COMPLETED') {
        setIsExecuting(false);
        setCurrentStepIndex(null);
        
        // Check if execution failed due to wrong starting page
        if (!message.payload.success && message.payload.error) {
          setError(message.payload.error);
        }
        
        // Update metrics
        const summary = StepInstrumentation.getSummary();
        setMetrics(summary);
        
      } else if (message.type === 'VERIFIED_DISAMBIGUATE_REQUEST') {
        const { candidates, stepDescription } = message.payload;
        
        // Show disambiguation modal
        setDisambiguationData({
          candidates,
          stepDescription,
          resolve: (index) => {
            // Send response back
            chrome.runtime.sendMessage({
              type: 'VERIFIED_DISAMBIGUATE_RESPONSE',
              payload: { selectedIndex: index },
            });
            setDisambiguationData(null);
          },
        });
      }
    };
    
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [workflow]);
  
  const handleStart = async () => {
    try {
      setError(null);
      setIsExecuting(true);
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      // Get starting URL
      const startingUrl = workflow.steps.length > 0 && isWorkflowStepPayload(workflow.steps[0].payload)
        ? workflow.steps[0].payload.url
        : undefined;
      
      // Navigate to starting page OR refresh if already there (to reset page state)
      if (startingUrl) {
        const needsNavigation = tab.url !== startingUrl;
        const needsRefresh = tab.url === startingUrl;
        
        if (needsNavigation) {
          console.log('[ReplayerView] Navigating to starting page:', startingUrl);
          await chrome.tabs.update(tab.id, { url: startingUrl });
        } else if (needsRefresh) {
          console.log('[ReplayerView] Refreshing page to reset state');
          await chrome.tabs.reload(tab.id);
        }
        
        if (needsNavigation || needsRefresh) {
          // Wait for page load
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error('Page load timeout'));
            }, 15000);
            
            const listener = (tabId: number, changeInfo: { status?: string }) => {
              if (tabId === tab.id && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => resolve(), 1000);
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          
          console.log(`[ReplayerView] Page ${needsNavigation ? 'loaded' : 'refreshed'} successfully`);
        }
      }
      
      // Start execution using Universal Execution Engine
      const stepsToExecute = workflow.optimizedSteps || workflow.steps;
      
      console.log('[ReplayerView] Starting Universal Execution with', stepsToExecute.length, 'steps');
      
      const response = await chrome.tabs.sendMessage(tab.id!, {
        type: 'EXECUTE_WORKFLOW_UNIVERSAL',
        payload: {
          steps: stepsToExecute,
          workflowId: workflow.id,
          variableValues: variableValues || {},
        },
      });
      
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to start execution');
      }
    } catch (err) {
      console.error('Start execution error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start execution');
      setIsExecuting(false);
    }
  };
  
  const handleStop = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'VERIFIED_EXECUTION_CANCEL',
        });
      }
    } catch (err) {
      console.error('Stop execution error:', err);
    }
    setIsExecuting(false);
    setCurrentStepIndex(null);
  };
  
  const handleDisambiguationSelect = (index: number) => {
    disambiguationData?.resolve(index);
  };
  
  const handleDisambiguationCancel = () => {
    disambiguationData?.resolve(null);
    handleStop();
  };
  
  const progress = stepsToDisplay.length > 0 && currentStepIndex !== null
    ? ((currentStepIndex + 1) / stepsToDisplay.length) * 100
    : 0;
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{workflow.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">
              {stepsToDisplay.length} step{stepsToDisplay.length !== 1 ? 's' : ''}
            </p>
            <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full font-medium">
              Universal Engine
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowMetrics(!showMetrics)}
            className="px-3 py-1 text-sm bg-muted text-muted-foreground rounded hover:bg-muted/80"
            title="Show execution metrics"
          >
            📊
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
              disabled={isExecuting}
            >
              Close
            </button>
          )}
        </div>
      </div>
      
      {/* Metrics Panel */}
      {showMetrics && metrics && <MetricsPanel summary={metrics} />}
      
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {currentStepIndex !== null ? `Step ${currentStepIndex + 1} of ${stepsToDisplay.length}` : 'Ready'}
          </span>
          <span className="text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      
      {/* Execution Controls */}
      <div className="flex gap-2">
        {!isExecuting ? (
          <button
            onClick={handleStart}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium"
          >
            ▶️ Run Workflow
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium"
          >
            Stop Execution
          </button>
        )}
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
      
      {/* Step List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {stepsToDisplay.map((step, index) => {
          const status = stepStatuses.get(index) || { status: 'pending' };
          const isCurrent = currentStepIndex === index;
          const stepId = isWorkflowStepPayload(step.payload)
            ? String(step.payload.timestamp)
            : `step-${index}`;
          
          return (
            <div
              key={stepId}
              className={`p-3 rounded-md border-l-4 ${
                isCurrent
                  ? 'bg-blue-50 border-blue-500'
                  : status.status === 'completed'
                  ? 'bg-green-50 border-green-500'
                  : status.status === 'failed'
                  ? 'bg-red-50 border-red-500'
                  : 'bg-muted border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex-shrink-0">
                    {status.status === 'completed' ? (
                      <svg className="h-5 w-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : status.status === 'failed' ? (
                      <svg className="h-5 w-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    ) : isCurrent ? (
                      <svg className="h-5 w-5 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground flex items-center gap-2">
                      {index + 1}. {step.type}
                      {status.winningStrategy && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded" title={`Found via ${status.winningStrategy}`}>
                          {status.winningStrategy}
                        </span>
                      )}
                      {status.recoveryUsed && (
                        <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded" title="Recovery actions were used">
                          🔧
                        </span>
                      )}
                      {isCurrent && <span className="text-blue-600 text-sm">(Executing...)</span>}
                    </div>
                    {step.description && (
                      <div className="text-sm text-muted-foreground mt-1">{step.description}</div>
                    )}
                    {status.error && (
                      <div className="text-sm text-red-600 mt-1">{status.error}</div>
                    )}
                    {status.metrics?.totalTimeMs && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {status.metrics.totalTimeMs}ms
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Disambiguation Modal */}
      {disambiguationData && (
        <DisambiguationModal
          candidates={disambiguationData.candidates}
          stepDescription={disambiguationData.stepDescription}
          onSelect={handleDisambiguationSelect}
          onCancel={handleDisambiguationCancel}
        />
      )}
    </div>
  );
}

