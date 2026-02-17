import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ExecutionLog, type ExecutionLogEntry, type BuildEntryParams } from './execution-log';

// Mock chrome.storage.local
const storageData: Record<string, any> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string) => Promise.resolve({ [key]: storageData[key] })),
      set: vi.fn((data: Record<string, any>) => {
        Object.assign(storageData, data);
        return Promise.resolve();
      }),
    },
  },
});

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

describe('ExecutionLog', () => {
  beforeEach(() => {
    // Clear storage
    for (const key of Object.keys(storageData)) {
      delete storageData[key];
    }
    vi.clearAllMocks();
  });

  describe('buildEntry()', () => {
    test('creates entry with all fields', () => {
      const entry = ExecutionLog.buildEntry(makeBuildParams());

      expect(entry.id).toMatch(/^log_/);
      expect(entry.startedAt).toBe(1000);
      expect(entry.completedAt).toBe(2000);
      expect(entry.userId).toBe('local');
      expect(entry.workflow).toEqual({ id: 'wf-1', name: 'Test Workflow', version: 1000 });
      expect(entry.inputs).toEqual({ name: 'Alice' });
      expect(entry.outcome).toEqual({
        success: true,
        stepsCompleted: 3,
        totalSteps: 3,
        durationMs: 1000,
        failedAtStep: undefined,
        failureReason: undefined,
      });
      expect(entry.steps).toHaveLength(3);
      expect(entry.steps[2].recoveryAttempts).toBe(1);
      expect(entry.siteUrl).toBe('https://example.com');
    });

    test('includes failure info when execution failed', () => {
      const entry = ExecutionLog.buildEntry(makeBuildParams({
        success: false,
        stepsCompleted: 2,
        failedAtStep: 2,
        failureReason: 'Element not found',
      }));

      expect(entry.outcome.success).toBe(false);
      expect(entry.outcome.failedAtStep).toBe(2);
      expect(entry.outcome.failureReason).toBe('Element not found');
    });
  });

  describe('append()', () => {
    test('stores entry and can be retrieved', async () => {
      const entry = ExecutionLog.buildEntry(makeBuildParams());
      await ExecutionLog.append(entry);

      const recent = await ExecutionLog.getRecent(10);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe(entry.id);
    });

    test('appends multiple entries', async () => {
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: 1000, completedAt: 2000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: 3000, completedAt: 4000 })));

      const recent = await ExecutionLog.getRecent(10);
      expect(recent).toHaveLength(2);
    });

    test('FIFO trims at 500 entries', async () => {
      // Pre-fill storage with 500 entries
      const entries: ExecutionLogEntry[] = [];
      for (let i = 0; i < 500; i++) {
        entries.push(ExecutionLog.buildEntry(makeBuildParams({
          workflowId: `wf-${i}`,
          startedAt: i * 1000,
          completedAt: i * 1000 + 500,
        })));
      }
      storageData['ghostwriter-execution-log'] = entries;

      // Append one more — should trim oldest
      const newEntry = ExecutionLog.buildEntry(makeBuildParams({
        workflowId: 'wf-new',
        startedAt: 600000,
        completedAt: 600500,
      }));
      await ExecutionLog.append(newEntry);

      const all = await ExecutionLog.getRecent(600);
      expect(all.length).toBeLessThanOrEqual(500);
      // Oldest entry (wf-0) should be trimmed
      expect(all.find(e => e.workflow.id === 'wf-0')).toBeUndefined();
      // New entry should be present
      expect(all.find(e => e.workflow.id === 'wf-new')).toBeDefined();
    });
  });

  describe('getByWorkflow()', () => {
    test('filters by workflow ID', async () => {
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-a', startedAt: 1000, completedAt: 2000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-b', startedAt: 3000, completedAt: 4000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-a', startedAt: 5000, completedAt: 6000 })));

      const results = await ExecutionLog.getByWorkflow('wf-a');
      expect(results).toHaveLength(2);
      results.forEach(e => expect(e.workflow.id).toBe('wf-a'));
    });

    test('returns most recent first', async () => {
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-x', startedAt: 1000, completedAt: 2000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-x', startedAt: 5000, completedAt: 6000 })));

      const results = await ExecutionLog.getByWorkflow('wf-x');
      expect(results[0].completedAt).toBeGreaterThan(results[1].completedAt);
    });

    test('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ workflowId: 'wf-z', startedAt: i * 1000, completedAt: i * 1000 + 500 })));
      }

      const results = await ExecutionLog.getByWorkflow('wf-z', 3);
      expect(results).toHaveLength(3);
    });
  });

  describe('getRecent()', () => {
    test('returns most recent entries first', async () => {
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: 1000, completedAt: 2000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: 5000, completedAt: 6000 })));
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: 3000, completedAt: 4000 })));

      const results = await ExecutionLog.getRecent(10);
      expect(results[0].completedAt).toBe(6000);
      expect(results[1].completedAt).toBe(4000);
      expect(results[2].completedAt).toBe(2000);
    });

    test('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams({ startedAt: i * 1000, completedAt: i * 1000 + 500 })));
      }

      const results = await ExecutionLog.getRecent(3);
      expect(results).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    test('append handles storage errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      // Should not throw
      await ExecutionLog.append(ExecutionLog.buildEntry(makeBuildParams()));

      consoleSpy.mockRestore();
    });

    test('getRecent returns empty array on storage error', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(new Error('Storage error'));

      const results = await ExecutionLog.getRecent(10);
      expect(results).toEqual([]);
    });
  });
});
