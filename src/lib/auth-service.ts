/**
 * Auth Service — observable auth state singleton.
 *
 * Wraps Supabase Auth with a simple subscribe/notify pattern for React.
 * `getUserId()` returns 'local' when not authenticated (backwards compatible).
 */

import type { User, Session, AuthChangeEvent, Subscription } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

// ============================================================================
// Types
// ============================================================================

export interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export type AuthListener = (state: AuthState) => void;

// ============================================================================
// Auth Service
// ============================================================================

class AuthServiceImpl {
  private state: AuthState = {
    user: null,
    session: null,
    isLoading: true,
    isAuthenticated: false,
  };

  private listeners = new Set<AuthListener>();
  private authSubscription: Subscription | null = null;
  private initialized = false;

  // ── Initialization ──────────────────────────────────────────────────

  /**
   * Initialize auth: restore existing session and subscribe to auth changes.
   * Safe to call multiple times — only initializes once.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const supabase = getSupabaseClient();

    // Subscribe to auth state changes first so we don't miss events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        this.updateState({
          user: session?.user ?? null,
          session,
          isLoading: false,
          isAuthenticated: !!session?.user,
        });
      },
    );
    this.authSubscription = subscription;

    // Restore existing session
    try {
      const { data: { session } } = await supabase.auth.getSession();
      this.updateState({
        user: session?.user ?? null,
        session,
        isLoading: false,
        isAuthenticated: !!session?.user,
      });
    } catch (error) {
      console.warn('[AuthService] Failed to restore session:', error);
      this.updateState({ ...this.state, isLoading: false });
    }
  }

  // ── Auth Actions ────────────────────────────────────────────────────

  async signUp(email: string, password: string): Promise<{ error: string | null }> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async signIn(email: string, password: string): Promise<{ error: string | null }> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async signOut(): Promise<{ error: string | null }> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) return { error: error.message };
    this.updateState({
      user: null,
      session: null,
      isLoading: false,
      isAuthenticated: false,
    });
    return { error: null };
  }

  async resetPassword(email: string): Promise<{ error: string | null }> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return { error: error.message };
    return { error: null };
  }

  // ── Getters ─────────────────────────────────────────────────────────

  /**
   * Returns Supabase user UUID when authenticated, 'local' when not.
   * Backwards compatible with all existing ExecutionLog/storage code.
   */
  getUserId(): string {
    return this.state.user?.id ?? 'local';
  }

  /**
   * Returns the current JWT access token, or null if not authenticated.
   * For future edge function auth (Phase 2+).
   */
  getAccessToken(): string | null {
    return this.state.session?.access_token ?? null;
  }

  getState(): AuthState {
    return { ...this.state };
  }

  // ── Observable ──────────────────────────────────────────────────────

  /**
   * Subscribe to auth state changes. Returns an unsubscribe function.
   */
  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current state
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /**
   * Tear down subscriptions. Mostly useful for tests.
   */
  destroy(): void {
    this.authSubscription?.unsubscribe();
    this.authSubscription = null;
    this.listeners.clear();
    this.initialized = false;
    this.state = {
      user: null,
      session: null,
      isLoading: true,
      isAuthenticated: false,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────

  private updateState(next: AuthState): void {
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.warn('[AuthService] Listener error:', err);
      }
    }
  }
}

/** Singleton auth service instance */
export const authService = new AuthServiceImpl();
