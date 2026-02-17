/**
 * AuthBadge — small header component when authenticated.
 *
 * Shows avatar circle (first letter of email), truncated email, and sign-out button.
 */

import type { AuthState } from '../lib/auth-service';

interface AuthBadgeProps {
  authState: AuthState;
  onSignOut: () => void;
}

export function AuthBadge({ authState, onSignOut }: AuthBadgeProps) {
  if (!authState.isAuthenticated || !authState.user) return null;

  const email = authState.user.email ?? '';
  const initial = email.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
        {initial}
      </div>
      {/* Email */}
      <span className="text-xs text-muted-foreground truncate max-w-[120px]" title={email}>
        {email}
      </span>
      {/* Sign Out */}
      <button
        onClick={onSignOut}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="Sign out"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
}
