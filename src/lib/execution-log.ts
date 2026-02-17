/**
 * Execution Log — structured, append-only audit trail.
 *
 * Separate from ExecutionTelemetry's raw events (LRU-evicted at 100).
 * Designed for future team features: audit trails, analytics, compliance.
 *
 * Storage key: `ghostwriter-execution-log`
 * Max entries: 500 (FIFO trim)
 */

const EXECUTION_LOG_KEY = 'ghostwriter-execution-log';
const MAX_LOG_ENTRIES = 500;

// ============================================================================
// Types
// ============================================================================

export interface ExecutionLogEntry {
  /** Unique log entry ID */
  id: string;
  /** When execution started (epoch ms) */
  startedAt: number;
  /** When execution completed (epoch ms) */
  completedAt: number;
  /** User identifier ('local' for now, future: Supabase auth user ID) */
  userId: string;

  /** Workflow reference */
  workflow: {
    id: string;
    name: string;
    /** Workflow version — uses updatedAt timestamp */
    version: number;
  };

  /** Variable values supplied for this execution */
  inputs: Record<string, string>;

  /** Execution outcome */
  outcome: {
    success: boolean;
    stepsCompleted: number;
    totalSteps: number;
    durationMs: number;
    failedAtStep?: number;
    failureReason?: string;
  };

  /** Per-step results */
  steps: ExecutionLogStep[];

  /** The site URL where execution happened */
  siteUrl: string;
}

export interface ExecutionLogStep {
  index: number;
  success: boolean;
  durationMs: number;
  foundBy?: string;
  recoveryAttempts: number;
}

// ============================================================================
// Build helpers
// ============================================================================

export interface BuildEntryParams {
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  startedAt: number;
  completedAt: number;
  inputs: Record<string, string>;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  durationMs: number;
  failedAtStep?: number;
  failureReason?: string;
  stepResults: Array<{
    index: number;
    success: boolean;
    durationMs: number;
    recoveryAttempts: number;
    foundBy?: string;
  }>;
  siteUrl: string;
  /** User identifier. Defaults to 'local' when not provided. */
  userId?: string;
}

// ============================================================================
// ExecutionLog
// ============================================================================

export class ExecutionLog {
  /**
   * Build an ExecutionLogEntry from execution context.
   */
  static buildEntry(params: BuildEntryParams): ExecutionLogEntry {
    return {
      id: `log_${params.startedAt}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      userId: params.userId ?? 'local',
      workflow: {
        id: params.workflowId,
        name: params.workflowName,
        version: params.workflowVersion,
      },
      inputs: params.inputs,
      outcome: {
        success: params.success,
        stepsCompleted: params.stepsCompleted,
        totalSteps: params.totalSteps,
        durationMs: params.durationMs,
        failedAtStep: params.failedAtStep,
        failureReason: params.failureReason,
      },
      steps: params.stepResults.map(sr => ({
        index: sr.index,
        success: sr.success,
        durationMs: sr.durationMs,
        foundBy: sr.foundBy,
        recoveryAttempts: sr.recoveryAttempts,
      })),
      siteUrl: params.siteUrl,
    };
  }

  /**
   * Append an entry to the execution log.
   * FIFO trims to MAX_LOG_ENTRIES.
   */
  static async append(entry: ExecutionLogEntry): Promise<void> {
    try {
      const entries = await this.loadEntries();
      entries.push(entry);

      // FIFO trim — remove oldest entries first
      while (entries.length > MAX_LOG_ENTRIES) {
        entries.shift();
      }

      await chrome.storage.local.set({ [EXECUTION_LOG_KEY]: entries });
      console.log(`[ExecutionLog] Appended entry ${entry.id} (${entries.length} total)`);
    } catch (error) {
      console.warn('[ExecutionLog] Failed to append entry:', error);
    }
  }

  /**
   * Get log entries for a specific workflow, most recent first.
   */
  static async getByWorkflow(workflowId: string, limit = 50): Promise<ExecutionLogEntry[]> {
    const entries = await this.loadEntries();
    return entries
      .filter(e => e.workflow.id === workflowId)
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);
  }

  /**
   * Get recent log entries across all workflows, most recent first.
   */
  static async getRecent(limit = 20): Promise<ExecutionLogEntry[]> {
    const entries = await this.loadEntries();
    return entries
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);
  }

  // ── Private ────────────────────────────────────────────────────────

  private static async loadEntries(): Promise<ExecutionLogEntry[]> {
    try {
      const result = await chrome.storage.local.get(EXECUTION_LOG_KEY);
      const entries = result[EXECUTION_LOG_KEY];
      if (Array.isArray(entries)) {
        return entries;
      }
      return [];
    } catch (error) {
      console.warn('[ExecutionLog] Failed to load entries:', error);
      return [];
    }
  }
}
