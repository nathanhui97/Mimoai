import { useState } from 'react';
import { CorrectionMemory } from '../lib/correction-memory';
import type { UserContext } from '../lib/user-context-storage';
import type { AuthState } from '../lib/auth-service';
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
  userContext?: UserContext | null;
  onEditUserContext: () => void;
  authState: AuthState;
  onSignIn: () => void;
  onSignOut: () => void;
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
  userContext,
  onEditUserContext,
  authState,
  onSignIn,
  onSignOut,
  onClose,
}: SettingsPanelProps) {
  const [showDevOptions, setShowDevOptions] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-card-foreground tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl transition-all duration-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Account */}
        <div className="mb-5 p-5 bg-muted/30 rounded-2xl">
          <h3 className="font-semibold text-foreground mb-3">Account</h3>
          {authState.isAuthenticated && authState.user ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground truncate mr-3">{authState.user.email}</span>
              <button
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs bg-muted text-muted-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors shrink-0"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={onSignIn}
              className="w-full px-4 py-2.5 text-sm bg-primary/10 text-primary rounded-xl font-medium hover:bg-primary/20 transition-colors"
            >
              Sign in to sync workflows
            </button>
          )}
        </div>

        {/* Role & Work Context */}
        <div className="mb-5 p-5 bg-muted/30 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">Role & Work Context</h3>
            <button
              onClick={onEditUserContext}
              className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg font-medium hover:bg-primary/20 transition-colors"
            >
              {userContext ? 'Edit' : 'Set'}
            </button>
          </div>
          {userContext ? (
            <div className="space-y-2 text-sm text-foreground">
              <div>
                <span className="text-muted-foreground">Identity:</span> {userContext.identity}
              </div>
              <div>
                <span className="text-muted-foreground">Focus:</span> {userContext.focus}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not set. Add your role and typical tasks to improve AI context.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="mb-5 p-5 bg-muted/50 rounded-2xl">
          <h3 className="font-semibold mb-4 text-foreground">Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => handleExportJSON()}
              className="w-full px-5 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 active:scale-[0.98] shadow-soft disabled:opacity-50 transition-all duration-200"
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
              className="w-full px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] disabled:opacity-50 transition-all duration-200"
              disabled={workflowSteps.length === 0}
            >
              Clear Current Steps
            </button>
          </div>
        </div>

        {/* Developer Options - Collapsible */}
        <div className="mb-5">
          <button
            onClick={() => setShowDevOptions(!showDevOptions)}
            className="w-full flex items-center justify-between p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors"
          >
            <span className="font-medium text-muted-foreground">Developer Options</span>
            <svg
              className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${showDevOptions ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDevOptions && (
            <div className="mt-3 p-5 bg-muted/30 rounded-2xl animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-foreground">Learning Memory</h3>
                <button
                  onClick={async () => {
                    const corrections = await CorrectionMemory.getAllCorrections();
                    setStoredCorrections(corrections);
                    setShowCorrections(!showCorrections);
                  }}
                  className="px-4 py-2 text-sm bg-primary/10 text-primary rounded-lg font-medium hover:bg-primary/20 transition-colors"
                >
                  {showCorrections ? 'Hide' : 'Show'} ({storedCorrections.length})
                </button>
              </div>

              {correctionModeStep && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200/60 rounded-xl">
                  <p className="text-sm text-amber-800 font-medium mb-2">
                    Correction Mode Active
                  </p>
                  <p className="text-xs text-amber-700 mb-3">
                    Click on the correct element in the page. The extension will learn from your correction.
                  </p>
                  <button
                    onClick={() => {
                      setCorrectionModeStep(null);
                      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
                        if (tab?.id) {
                          chrome.tabs.sendMessage(tab.id, { type: 'CANCEL_CORRECTION' });
                        }
                      });
                    }}
                    className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors"
                  >
                    Cancel Correction
                  </button>
                </div>
              )}

              {showCorrections && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {storedCorrections.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No corrections yet. The extension will learn from your corrections when element finding fails.
                    </p>
                  ) : (
                    storedCorrections.map((correction) => (
                      <div key={correction.id} className="p-3 bg-card rounded-xl border border-border/60 text-sm">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-foreground">
                              {correction.originalDescription || 'Element correction'}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Page: {correction.pageType?.type || 'unknown'}
                            </div>
                            <div className="text-xs text-green-600 mt-1">
                              {correction.successCount} successful / {correction.failureCount} failed
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              await CorrectionMemory.deleteCorrection(correction.id);
                              const updated = await CorrectionMemory.getAllCorrections();
                              setStoredCorrections(updated);
                            }}
                            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
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
                      className="w-full px-4 py-2.5 text-sm bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 active:scale-[0.98] transition-all duration-200 mt-3"
                    >
                      Clear All Corrections
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Version Info */}
        <div className="p-4 bg-muted/30 rounded-xl text-center">
          <p className="text-sm text-muted-foreground">
            Version <span className="font-mono font-medium">{EXTENSION_VERSION}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
