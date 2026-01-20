import { useEffect, useState } from 'react';
import type { UserContext } from '../lib/user-context-storage';

interface UserContextModalProps {
  isOpen: boolean;
  initialValue?: UserContext | null;
  onSave: (context: UserContext | null) => void;
  onClose: () => void;
}

export function UserContextModal({
  isOpen,
  initialValue,
  onSave,
  onClose,
}: UserContextModalProps) {
  const [identity, setIdentity] = useState('');
  const [focus, setFocus] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIdentity(initialValue?.identity || '');
    setFocus(initialValue?.focus || '');
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmedIdentity = identity.trim();
    const trimmedFocus = focus.trim();
    if (!trimmedIdentity && !trimmedFocus) {
      onSave(null);
      return;
    }
    onSave({
      identity: trimmedIdentity,
      focus: trimmedFocus,
    });
  };

  const handleClear = () => {
    setIdentity('');
    setFocus('');
    onSave(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-lg w-full mx-4 animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-card-foreground tracking-tight">Role & Work Context</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Share what you do so the AI can interpret tasks more accurately.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-xl transition-all duration-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Field 1: The Identity (Who)</label>
            <input
              type="text"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              placeholder='I work as a... (e.g., Recruiter, Day Trader)'
              className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Why: This tells the AI which keywords are important on a page.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Field 2: The Focus (What)</label>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder='Most of my tasks involve... (e.g., Finding email addresses for CEOs)'
              rows={4}
              className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all text-sm resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Why: This tells the AI the success state of a task.
            </p>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
          >
            Save
          </button>
          <button
            onClick={handleClear}
            className="px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
