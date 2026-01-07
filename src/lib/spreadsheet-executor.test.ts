/**
 * Unit tests for SpreadsheetExecutor
 * 
 * Tests critical spreadsheet automation functionality:
 * - Domain detection
 * - Cell navigation
 * - Text input
 * - Cell reading
 * - Batch operations
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SpreadsheetExecutor, type SpreadsheetAction } from './spreadsheet-executor';

// Mock dependencies
vi.mock('../content/sheet-state-extractor', () => ({
  SheetStateExtractor: {
    isSpreadsheetDomain: vi.fn(() => true),
    extract: vi.fn(() => Promise.resolve({
      domain: 'google-sheets',
      sheetName: 'Sheet1',
      columns: [
        { index: 1, letter: 'A', header: 'Name', dataType: 'text' },
        { index: 2, letter: 'B', header: 'Email', dataType: 'text' },
      ],
    })),
  },
}));

describe('SpreadsheetExecutor - Domain Detection', () => {
  test('execute() rejects on non-spreadsheet domain', async () => {
    const { SheetStateExtractor } = await import('../content/sheet-state-extractor');
    vi.mocked(SheetStateExtractor.isSpreadsheetDomain).mockReturnValue(false);

    const action: SpreadsheetAction = {
      action: 'type_in_cell',
      cellRef: 'A1',
      text: 'test',
    };

    const result = await SpreadsheetExecutor.execute(action);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('non-spreadsheet domain');
  });

  test('execute() accepts actions on spreadsheet domain', async () => {
    const { SheetStateExtractor } = await import('../content/sheet-state-extractor');
    vi.mocked(SheetStateExtractor.isSpreadsheetDomain).mockReturnValue(true);

    const action: SpreadsheetAction = {
      action: 'type_in_cell',
      cellRef: 'A1',
      text: 'test',
    };

    // Mock internal methods to avoid actual DOM manipulation
    vi.spyOn(SpreadsheetExecutor as any, 'typeInCell').mockResolvedValue({
      success: true,
      cellRef: 'A1',
      value: 'test',
    });

    const result = await SpreadsheetExecutor.execute(action);
    
    expect(result.success).toBe(true);
  });
});

describe('SpreadsheetExecutor - Action Validation', () => {
  beforeEach(() => {
    const { SheetStateExtractor } = require('../content/sheet-state-extractor');
    vi.mocked(SheetStateExtractor.isSpreadsheetDomain).mockReturnValue(true);
  });

  test('type_in_cell requires cellRef and text', async () => {
    const action1: SpreadsheetAction = {
      action: 'type_in_cell',
      // Missing cellRef
      text: 'test',
    };

    const result1 = await SpreadsheetExecutor.execute(action1);
    expect(result1.success).toBe(false);
    expect(result1.error).toContain('cellRef');

    const action2: SpreadsheetAction = {
      action: 'type_in_cell',
      cellRef: 'A1',
      // Missing text
    };

    const result2 = await SpreadsheetExecutor.execute(action2);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('text');
  });

  test('type_in_header_column requires headerText and text', async () => {
    const action: SpreadsheetAction = {
      action: 'type_in_header_column',
      // Missing headerText
      text: 'test',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain('headerText');
  });

  test('type_in_next_empty requires column and text', async () => {
    const action: SpreadsheetAction = {
      action: 'type_in_next_empty',
      // Missing column
      text: 'test',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain('column');
  });

  test('read_cell requires cellRef', async () => {
    const action: SpreadsheetAction = {
      action: 'read_cell',
      // Missing cellRef
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cellRef');
  });

  test('click_cell requires cellRef', async () => {
    const action: SpreadsheetAction = {
      action: 'click_cell',
      // Missing cellRef
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cellRef');
  });
});

describe('SpreadsheetExecutor - Action Types', () => {
  beforeEach(() => {
    const { SheetStateExtractor } = require('../content/sheet-state-extractor');
    vi.mocked(SheetStateExtractor.isSpreadsheetDomain).mockReturnValue(true);
  });

  test('handles click_cell action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'clickCell').mockResolvedValue({
      success: true,
      cellRef: 'A1',
    });

    const action: SpreadsheetAction = {
      action: 'click_cell',
      cellRef: 'A1',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
    expect(result.cellRef).toBe('A1');
  });

  test('handles type_in_cell action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'typeInCell').mockResolvedValue({
      success: true,
      cellRef: 'A1',
      value: 'test value',
    });

    const action: SpreadsheetAction = {
      action: 'type_in_cell',
      cellRef: 'A1',
      text: 'test value',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
    expect(result.cellRef).toBe('A1');
    expect(result.value).toBe('test value');
  });

  test('handles type_in_header_column action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'typeInHeaderColumn').mockResolvedValue({
      success: true,
      cellRef: 'A2',
      value: 'test value',
    });

    const action: SpreadsheetAction = {
      action: 'type_in_header_column',
      headerText: 'Name',
      rowOffset: 1,
      text: 'test value',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
  });

  test('handles type_in_next_empty action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'typeInNextEmpty').mockResolvedValue({
      success: true,
      cellRef: 'A5',
      value: 'test value',
    });

    const action: SpreadsheetAction = {
      action: 'type_in_next_empty',
      column: 'A',
      text: 'test value',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
  });

  test('handles read_cell action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'readCell').mockResolvedValue({
      success: true,
      cellRef: 'A1',
      value: 'read value',
    });

    const action: SpreadsheetAction = {
      action: 'read_cell',
      cellRef: 'A1',
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
    expect(result.value).toBe('read value');
  });

  test('handles batch_type action', async () => {
    vi.spyOn(SpreadsheetExecutor as any, 'batchType').mockResolvedValue({
      success: true,
    });

    const action: SpreadsheetAction = {
      action: 'batch_type',
      cells: [
        { cellRef: 'A1', text: 'value1' },
        { cellRef: 'A2', text: 'value2' },
      ],
    };

    const result = await SpreadsheetExecutor.execute(action);
    expect(result.success).toBe(true);
  });
});

// Note: These are foundational tests. More comprehensive tests would require:
// - Mocking Chrome extension APIs
// - Testing actual Google Sheets DOM manipulation
// - Testing navigation strategies (Name Box, Ctrl+G, etc.)
// - Testing verification logic
// - Integration tests with real spreadsheet pages

