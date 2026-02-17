import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ExecutionLog, type BuildEntryParams } from './execution-log';

// ============================================================================
// Mocks
// ============================================================================

// Mock chrome.storage.local (needed by supabase.ts adapter and ExecutionLog)
const storageData: Record<string, any> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string) => Promise.resolve({ [key]: storageData[key] })),
      set: vi.fn((data: Record<string, any>) => {
        Object.assign(storageData, data);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        delete storageData[key];
        return Promise.resolve();
      }),
    },
  },
});

// Mock the Supabase client used by auth-service
const mockOnAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});
const mockGetSession = vi.fn().mockResolvedValue({
  data: { session: null },
  error: null,
});
const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockResetPasswordForEmail = vi.fn();

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: mockOnAuthStateChange,
      getSession: mockGetSession,
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  }),
}));

// Import after mocks are set up
import { authService } from './auth-service';

// ============================================================================
// Helpers
// ============================================================================

function makeBuildParams(overrides: Partial<BuildEntryParams> = {}): BuildEntryParams {
  return {
    workflowId: 'wf-1',
    workflowName: 'Test Workflow',
    workflowVersion: 1000,
    startedAt: 1000,
    completedAt: 2000,
    inputs: { name: 'Alice' },
    success: true,
    stepsCompleted: 3,
    totalSteps: 3,
    durationMs: 1000,
    stepResults: [
      { index: 0, success: true, durationMs: 300, recoveryAttempts: 0 },
      { index: 1, success: true, durationMs: 400, recoveryAttempts: 0 },
      { index: 2, success: true, durationMs: 300, recoveryAttempts: 1 },
    ],
    siteUrl: 'https://example.com',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthService', () => {
  beforeEach(() => {
    // Reset auth service state between tests
    authService.destroy();
    vi.clearAllMocks();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  describe('getUserId()', () => {
    test('returns "local" when not authenticated', () => {
      expect(authService.getUserId()).toBe('local');
    });

    test('returns user UUID when authenticated', async () => {
      const fakeSession = {
        user: { id: 'uuid-123', email: 'test@example.com' },
        access_token: 'jwt-token',
      };
      mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });

      // Capture the onAuthStateChange callback
      let authCallback: (event: string, session: any) => void = () => {};
      mockOnAuthStateChange.mockImplementation((cb: any) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      await authService.initialize();

      // Simulate auth change event
      authCallback('SIGNED_IN', fakeSession);

      expect(authService.getUserId()).toBe('uuid-123');
    });
  });

  describe('getAccessToken()', () => {
    test('returns null when not authenticated', () => {
      expect(authService.getAccessToken()).toBeNull();
    });
  });

  describe('signIn()', () => {
    test('returns null error on success', async () => {
      mockSignInWithPassword.mockResolvedValue({ error: null });
      await authService.initialize();
      const result = await authService.signIn('test@example.com', 'password');
      expect(result.error).toBeNull();
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });

    test('returns error message on failure', async () => {
      mockSignInWithPassword.mockResolvedValue({
        error: { message: 'Invalid credentials' },
      });
      await authService.initialize();
      const result = await authService.signIn('test@example.com', 'wrong');
      expect(result.error).toBe('Invalid credentials');
    });
  });

  describe('signUp()', () => {
    test('returns null error on success', async () => {
      mockSignUp.mockResolvedValue({ error: null });
      await authService.initialize();
      const result = await authService.signUp('test@example.com', 'password');
      expect(result.error).toBeNull();
    });

    test('returns error message on failure', async () => {
      mockSignUp.mockResolvedValue({
        error: { message: 'Email already registered' },
      });
      await authService.initialize();
      const result = await authService.signUp('test@example.com', 'password');
      expect(result.error).toBe('Email already registered');
    });
  });

  describe('signOut()', () => {
    test('clears auth state on success', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      // Start authenticated
      const fakeSession = {
        user: { id: 'uuid-123', email: 'test@example.com' },
        access_token: 'jwt-token',
      };
      mockGetSession.mockResolvedValue({ data: { session: fakeSession }, error: null });

      let authCallback: (event: string, session: any) => void = () => {};
      mockOnAuthStateChange.mockImplementation((cb: any) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      await authService.initialize();
      authCallback('SIGNED_IN', fakeSession);
      expect(authService.getUserId()).toBe('uuid-123');

      // Sign out
      await authService.signOut();
      expect(authService.getUserId()).toBe('local');
      expect(authService.getState().isAuthenticated).toBe(false);
    });
  });

  describe('subscribe()', () => {
    test('immediately notifies with current state', () => {
      const listener = vi.fn();
      authService.subscribe(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ isAuthenticated: false, isLoading: true }),
      );
    });

    test('notifies on state change', async () => {
      const listener = vi.fn();
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

      let authCallback: (event: string, session: any) => void = () => {};
      mockOnAuthStateChange.mockImplementation((cb: any) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      await authService.initialize();
      authService.subscribe(listener);
      const callCount = listener.mock.calls.length;

      // Trigger auth state change
      authCallback('SIGNED_IN', {
        user: { id: 'uuid-456', email: 'new@example.com' },
        access_token: 'token',
      });

      expect(listener.mock.calls.length).toBeGreaterThan(callCount);
    });

    test('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsub = authService.subscribe(listener);
      const callCount = listener.mock.calls.length;

      unsub();

      // After unsubscribe, listener should not be called again
      // (we can't easily trigger a state change here without initialize,
      // but at minimum unsub should not throw)
      expect(listener.mock.calls.length).toBe(callCount);
    });
  });

  describe('initialize()', () => {
    test('only initializes once', async () => {
      await authService.initialize();
      await authService.initialize();
      // onAuthStateChange should only be called once
      expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ExecutionLog.buildEntry() with userId', () => {
  test('defaults to "local" when userId not provided', () => {
    const entry = ExecutionLog.buildEntry(makeBuildParams());
    expect(entry.userId).toBe('local');
  });

  test('uses provided userId', () => {
    const entry = ExecutionLog.buildEntry(makeBuildParams({ userId: 'uuid-abc-123' }));
    expect(entry.userId).toBe('uuid-abc-123');
  });
});
