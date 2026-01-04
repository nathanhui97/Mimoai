/**
 * ScreenshotModal Component
 * 
 * Displays the visual screenshot for a workflow step with the ability to toggle
 * between the annotated version (with red circle/markers) and the original version.
 */

import { useState } from 'react';
import type { WorkflowStep } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';

interface ScreenshotModalProps {
  step: WorkflowStep;
  stepIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

export function ScreenshotModal({ step, stepIndex, isOpen, onClose }: ScreenshotModalProps) {
  const [showAnnotated, setShowAnnotated] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  if (!isOpen) return null;

  // Extract snapshot data from the step
  const snapshot = isWorkflowStepPayload(step.payload) ? step.payload.visualSnapshot : null;
  
  if (!snapshot) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-card-foreground">
              Step {stepIndex + 1}: {step.type}
            </h2>
            <button
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-muted-foreground text-center py-8">
            No screenshot available for this step.
          </p>
        </div>
      </div>
    );
  }

  // Determine which screenshot to show
  const hasAnnotated = !!snapshot.annotated;
  const currentScreenshot = showAnnotated && hasAnnotated 
    ? snapshot.annotated 
    : snapshot.viewport || snapshot.elementSnippet;

  if (!currentScreenshot) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground text-center py-8">
            No screenshot data available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-card rounded-lg border border-border max-w-5xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Step {stepIndex + 1}: {step.type}
            </h2>
            {step.description && (
              <p className="text-sm text-blue-600 mt-1">{step.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Screenshot Display */}
        <div className="p-6">
          {/* Toggle Button */}
          {hasAnnotated && (
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={() => setShowAnnotated(!showAnnotated)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  showAnnotated
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {showAnnotated ? '🎯 Showing Markers' : '📷 Show Markers'}
              </button>
              {showAnnotated && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="8" />
                  </svg>
                  <span>Red circle shows where you clicked</span>
                </div>
              )}
            </div>
          )}

          {/* Screenshot Image */}
          <div className="bg-gray-100 rounded-lg overflow-hidden border border-gray-300">
            {imageLoading && (
              <div className="flex items-center justify-center p-12">
                <svg className="animate-spin h-8 w-8 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
            {imageError ? (
              <div className="p-12 text-center">
                <p className="text-destructive">Failed to load screenshot</p>
              </div>
            ) : (
              <img
                src={currentScreenshot}
                alt={`Screenshot for step ${stepIndex + 1}`}
                className={`w-full h-auto ${imageLoading ? 'hidden' : 'block'}`}
                onLoad={() => setImageLoading(false)}
                onError={() => {
                  setImageError(true);
                  setImageLoading(false);
                }}
              />
            )}
          </div>

          {/* Metadata */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Element Info */}
            <div className="space-y-2">
              <h3 className="font-semibold text-card-foreground text-sm">Element Information</h3>
              <div className="text-sm space-y-1">
                {isWorkflowStepPayload(step.payload) && (
                  <>
                    {step.payload.elementText && (
                      <div>
                        <span className="text-muted-foreground">Text:</span>{' '}
                        <span className="font-mono text-foreground">{step.payload.elementText}</span>
                      </div>
                    )}
                    {step.payload.label && (
                      <div>
                        <span className="text-muted-foreground">Label:</span>{' '}
                        <span className="font-mono text-foreground">{step.payload.label}</span>
                      </div>
                    )}
                    {step.payload.value && (
                      <div>
                        <span className="text-muted-foreground">Value:</span>{' '}
                        <span className="font-mono text-foreground">{step.payload.value}</span>
                      </div>
                    )}
                    {step.payload.elementRole && (
                      <div>
                        <span className="text-muted-foreground">Role:</span>{' '}
                        <span className="font-mono text-foreground">{step.payload.elementRole}</span>
                      </div>
                    )}
                    {step.payload.selector && (
                      <div className="mt-2">
                        <span className="text-muted-foreground">Selector:</span>
                        <div className="mt-1 p-2 bg-muted rounded font-mono text-xs break-all">
                          {step.payload.selector}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Visual Info */}
            <div className="space-y-2">
              <h3 className="font-semibold text-card-foreground text-sm">Visual Information</h3>
              <div className="text-sm space-y-1">
                {snapshot.clickPoint && (
                  <div>
                    <span className="text-muted-foreground">Click Point:</span>{' '}
                    <span className="font-mono text-foreground">
                      ({snapshot.clickPoint.x}, {snapshot.clickPoint.y})
                    </span>
                  </div>
                )}
                {snapshot.actionType && (
                  <div>
                    <span className="text-muted-foreground">Action Type:</span>{' '}
                    <span className="font-mono text-foreground capitalize">{snapshot.actionType}</span>
                  </div>
                )}
                {snapshot.viewportSize && (
                  <div>
                    <span className="text-muted-foreground">Viewport:</span>{' '}
                    <span className="font-mono text-foreground">
                      {snapshot.viewportSize.width}×{snapshot.viewportSize.height}
                    </span>
                  </div>
                )}
                {snapshot.elementBounds && (
                  <div>
                    <span className="text-muted-foreground">Element Bounds:</span>{' '}
                    <span className="font-mono text-foreground text-xs">
                      {Math.round(snapshot.elementBounds.width)}×{Math.round(snapshot.elementBounds.height)} 
                      {' '}at ({Math.round(snapshot.elementBounds.x)}, {Math.round(snapshot.elementBounds.y)})
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Captured:</span>{' '}
                  <span className="font-mono text-foreground text-xs">
                    {new Date(snapshot.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Annotation Legend */}
          {hasAnnotated && showAnnotated && (
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h3 className="font-semibold text-sm mb-2 text-blue-900 dark:text-blue-100">Visual Marker Guide</h3>
              <div className="text-sm space-y-1 text-blue-800 dark:text-blue-200">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white"></div>
                  <span><strong>Red Circle + Crosshair:</strong> Click action</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-4 border-2 border-blue-500 bg-blue-100"></div>
                  <span><strong>Blue Rectangle:</strong> Text input field</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-4 border-2 border-orange-500 bg-orange-100"></div>
                  <span><strong>Orange Highlight:</strong> Dropdown selection</span>
                </div>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-3">
                💡 These markers help AI identify the exact element when replaying workflows
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}






