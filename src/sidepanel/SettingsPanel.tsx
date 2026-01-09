import { CorrectionMemory } from '../lib/correction-memory';
import { EXTENSION_VERSION } from '../lib/version-checker';
import type { WorkflowStep } from '../types/workflow';
import type { CorrectionEntry } from '../types/visual';

interface SettingsPanelProps {
  workflowSteps: WorkflowStep[];
  storedCorrections: CorrectionEntry[];
  setStoredCorrections: (corrections: CorrectionEntry[]) => void;
  showCorrections: boolean;
  setShowCorrections: (show: boolean) => void;
  correctionModeStep: string | null;
  setCorrectionModeStep: (step: string | null) => void;
  handleExportJSON: (steps?: WorkflowStep[]) => void;
  clearWorkflowSteps: () => void;
  onClose: () => void;
}

export function SettingsPanel({
  workflowSteps,
  storedCorrections,
  setStoredCorrections,
  showCorrections,
  setShowCorrections,
  correctionModeStep,
  setCorrectionModeStep,
  handleExportJSON,
  clearWorkflowSteps,
  onClose,
}: SettingsPanelProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded-lg border border-border max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-card-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Advanced Actions */}
        <div className="mb-6 p-4 bg-muted rounded-lg">
          <h3 className="font-medium mb-3">Advanced Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => handleExportJSON()}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              disabled={workflowSteps.length === 0}
            >
              Export Current Steps as JSON
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all recorded steps?')) {
                  clearWorkflowSteps();
                }
              }}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
              disabled={workflowSteps.length === 0}
            >
              Clear Current Steps
            </button>
          </div>
        </div>

        {/* Learning Memory */}
        <div className="mb-6 p-4 bg-muted rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Learning Memory</h3>
            <button
              onClick={async () => {
                const corrections = await CorrectionMemory.getAllCorrections();
                setStoredCorrections(corrections);
                setShowCorrections(!showCorrections);
              }}
              className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              {showCorrections ? 'Hide' : 'Show'} ({storedCorrections.length})
            </button>
          </div>
          
          {correctionModeStep && (
            <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800 font-medium mb-2">
                🔧 Correction Mode Active
              </p>
              <p className="text-xs text-yellow-700 mb-2">
                Click on the correct element in the page. The extension will learn from your correction.
              </p>
              <button
                onClick={() => {
                  setCorrectionModeStep(null);
                  // Send message to cancel correction mode
                  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                    if (tab?.id) {
                      chrome.tabs.sendMessage(tab.id, { type: 'CANCEL_CORRECTION' });
                    }
                  });
                }}
                className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Cancel Correction
              </button>
            </div>
          )}
          
          {showCorrections && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {storedCorrections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No corrections yet. The extension will learn from your corrections when element finding fails.
                </p>
              ) : (
                storedCorrections.map((correction) => (
                  <div key={correction.id} className="p-2 bg-background rounded text-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-foreground">
                          {correction.originalDescription || 'Element correction'}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Page: {correction.pageType?.type || 'unknown'}
                        </div>
                        <div className="text-xs text-green-600 mt-1">
                          ✓ {correction.successCount} successful • ✗ {correction.failureCount} failed
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await CorrectionMemory.deleteCorrection(correction.id);
                          const updated = await CorrectionMemory.getAllCorrections();
                          setStoredCorrections(updated);
                        }}
                        className="p-1 text-red-500 hover:text-red-700"
                        title="Delete correction"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
              {storedCorrections.length > 0 && (
                <button
                  onClick={async () => {
                    if (confirm('Clear all learned corrections?')) {
                      await CorrectionMemory.clearAll();
                      setStoredCorrections([]);
                    }
                  }}
                  className="w-full px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 mt-2"
                >
                  Clear All Corrections
                </button>
              )}
            </div>
          )}
        </div>

        {/* Version Info */}
        <div className="p-4 bg-muted rounded-lg text-center">
          <p className="text-sm text-muted-foreground">
            Version <span className="font-mono">{EXTENSION_VERSION}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
