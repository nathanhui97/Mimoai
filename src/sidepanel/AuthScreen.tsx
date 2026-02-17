/**
 * AuthScreen — full-screen auth overlay for sign-in / sign-up.
 *
 * Matches existing UI patterns: Tailwind, rounded-2xl, bg-card, shadow-soft-xl.
 * Includes "Continue without account" for local-first flow.
 */

import { useState } from 'react';
import { authService } from '../lib/auth-service';

type AuthTab = 'signin' | 'signup';
type AuthFlow = 'form' | 'reset' | 'reset-sent';

interface AuthScreenProps {
  onClose: () => void;
}

export function AuthScreen({ onClose }: AuthScreenProps) {
  const [tab, setTab] = useState<AuthTab>('signin');
  const [flow, setFlow] = useState<AuthFlow>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleTabSwitch = (newTab: AuthTab) => {
    setTab(newTab);
    setFlow('form');
    resetForm();
  };

  const handleSignIn = async () => {
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await authService.signIn(email, password);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      onClose();
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await authService.signUp(email, password);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      onClose();
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError('Please enter your email address.');
      return;
    }
    setIsLoading(true);
    setError(null);
    const result = await authService.resetPassword(email);
    setIsLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setFlow('reset-sent');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (flow === 'reset') {
      handleResetPassword();
    } else if (tab === 'signin') {
      handleSignIn();
    } else {
      handleSignUp();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card p-7 rounded-3xl border border-border/50 shadow-soft-xl max-w-md w-full mx-4 animate-scale-in">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-card-foreground tracking-tight">
            {flow === 'reset' ? 'Reset Password' : flow === 'reset-sent' ? 'Check Your Email' : 'Welcome to mimoai'}
          </h2>
          {flow === 'form' && (
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to sync workflows across devices
            </p>
          )}
        </div>

        {/* Reset sent confirmation */}
        {flow === 'reset-sent' && (
          <div className="text-center space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200/60 rounded-xl">
              <p className="text-sm text-emerald-800">
                Password reset link sent to <strong>{email}</strong>. Check your inbox.
              </p>
            </div>
            <button
              onClick={() => { setFlow('form'); setTab('signin'); resetForm(); }}
              className="w-full px-5 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 active:scale-[0.98] transition-all duration-200"
            >
              Back to Sign In
            </button>
          </div>
        )}

        {/* Auth form */}
        {flow !== 'reset-sent' && (
          <>
            {/* Tab Toggle (only in form flow) */}
            {flow === 'form' && (
              <div className="flex gap-1 p-1 bg-muted/50 rounded-xl mb-5">
                <button
                  onClick={() => handleTabSwitch('signin')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    tab === 'signin'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => handleTabSwitch('signup')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                    tab === 'signup'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 bg-muted/30 border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {/* Password (not shown in reset flow) */}
              {flow === 'form' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full px-4 py-2.5 bg-muted/30 border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                  />
                </div>
              )}

              {/* Confirm Password (signup only) */}
              {flow === 'form' && tab === 'signup' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full px-4 py-2.5 bg-muted/30 border border-border/60 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    autoComplete="new-password"
                  />
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200/60 rounded-xl">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full px-5 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 active:scale-[0.98] shadow-soft disabled:opacity-50 transition-all duration-200"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading...
                  </span>
                ) : flow === 'reset' ? 'Send Reset Link' : tab === 'signin' ? 'Sign In' : 'Create Account'}
              </button>

              {/* Forgot password link (sign in only) */}
              {flow === 'form' && tab === 'signin' && (
                <button
                  type="button"
                  onClick={() => { setFlow('reset'); setError(null); setPassword(''); }}
                  className="w-full text-center text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              )}

              {/* Back to sign in (from reset flow) */}
              {flow === 'reset' && (
                <button
                  type="button"
                  onClick={() => { setFlow('form'); setError(null); }}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                >
                  Back to Sign In
                </button>
              )}
            </form>

            {/* Divider */}
            {flow === 'form' && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-border/60" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>

                {/* Continue without account */}
                <button
                  onClick={onClose}
                  className="w-full px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
                >
                  Continue without account
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
