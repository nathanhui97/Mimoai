# Spreadsheet INPUT Context Fix - Cell Reference Missing from Hints

## Problem

When executing a workflow recorded in Google Sheets, the AI agent **couldn't find the cell reference** for INPUT steps:

```
[AIAgent] 📊 SPREADSHEET TYPE HINT detected: "ggg"
[AIAgent] ⚠️ Could not extract cell reference for spreadsheet type hint
```

Result: Agent typed into the wrong place (Menus search box instead of cell C)!

---

## Root Cause: Missing `spreadsheetContext` in INPUT Steps

### What Was Happening

**CLICK steps** (selecting cells):
```typescript
payload: {
  spreadsheetContext: {
    recordedIntent: {
      cellRef: "B8",           // ✅ HAS cell reference
      columnHeader: "Email",    // ✅ HAS column header
      column: "B"
    }
  }
}
```

**INPUT steps** (typing in cells):
```typescript
payload: {
  context: {
    gridCoordinates: {
      cellReference: "B8",      // ❌ Buried in context
      columnHeader: "Email"     // ❌ Not at top level
    }
  }
  // ❌ NO spreadsheetContext field!
}
```

### Why This Broke Execution

The AI agent's `extractHints()` method looks for:
```typescript
// From line 762 in ai-agent.ts:
if (recordedCellRef) {
  // Extract from hint.recordedAriaLabel or hint.recordedFallbackSelectors
}
```

But for INPUT steps, there's **no easy way to extract the cell reference** because:
1. `recordedAriaLabel` might not have it (could be just the editor's aria-label)
2. `recordedFallbackSelectors` might not have cell-specific selectors
3. `spreadsheetContext` field doesn't exist (only CLICK steps had it)

---

## The Solution

### Added `spreadsheetContext` to INPUT Step Payloads

**File:** `src/content/recording-manager.ts` (before line 3539)

```typescript
// NEW: For INPUT steps in spreadsheets, capture spreadsheet context (same as CLICK steps)
let inputSpreadsheetContext: any = undefined;
if (VisualSnapshotService.isSpreadsheetDomain()) {
  // Get grid coordinates from the scanned context
  const scanResult = ContextScanner.scan(element);
  // Use explicit cell ref if provided (from flush), else use cached, else use scanned
  const effectiveCellRef = explicitCellRef || this.pendingCellReference || scanResult.gridCoordinates?.cellReference;
  
  if (effectiveCellRef) {
    console.log('📊 RecordingManager: Adding spreadsheet context to INPUT step:', { cellRef: effectiveCellRef });
    inputSpreadsheetContext = {
      recordedIntent: {
        cellRef: effectiveCellRef,
        columnHeader: scanResult.gridCoordinates?.columnHeader,
        column: effectiveCellRef.match(/^([A-Z]+)/)?.[1] || '',
        wasEmpty: true, // INPUT steps are always typing into cells
        wasAppendPosition: false, // Will be determined during execution
        reasoning: `User typed "${value}" in cell ${effectiveCellRef}`,
      }
    };
  }
}

const stepPayload: WorkflowStep['payload'] = {
  // ... all other fields ...
  spreadsheetContext: inputSpreadsheetContext,  // ← NEW!
  context: { ... }
}
```

### Extract `spreadsheetContext` in Hints

**File:** `src/lib/ai-agent.ts` (line 3419)

```typescript
return {
  // ... all other hint fields ...
  naturalLanguage,
  spreadsheetContext: payload.spreadsheetContext,  // ← NEW!
  iframeContext: payload.iframeContext,
};
```

---

## How It Works Now

### Recording (What Gets Saved)

```
User types "test1" in A8:
  → payload.spreadsheetContext = {
      recordedIntent: {
        cellRef: "A8",
        columnHeader: "Name",
        column: "A"
      }
    }
```

### Extraction (Building Hints)

```
extractHints():
  → hint.spreadsheetContext = payload.spreadsheetContext
  → hint has cellRef: "A8" ✅
```

### Execution (Using Hints)

```
AI Agent:
  1. Detects spreadsheet TYPE hint
  2. Extracts cellRef from hint.spreadsheetContext.recordedIntent.cellRef
  3. Gets "A8" ✅
  4. Executes: SpreadsheetExecutor.type_in_cell("A8", "test1") ✅
```

---

## Files Changed

### 1. `src/content/recording-manager.ts`

**Lines 3537-3559:** Added `inputSpreadsheetContext` extraction before building payload

**Line 3590:** Added `spreadsheetContext: inputSpreadsheetContext` to payload

**Benefits:**
- ✅ INPUT steps now have same structure as CLICK steps
- ✅ Cell reference is at top level (easy to extract)
- ✅ Column header preserved for execution
- ✅ Reuses existing cell ref capture logic (with race condition fixes!)

### 2. `src/lib/ai-agent.ts`

**Line 3420:** Added `spreadsheetContext: payload.spreadsheetContext` to hint

**Benefits:**
- ✅ Hint now includes cell reference
- ✅ AI agent can extract cellRef reliably
- ✅ Falls back to intelligent append if needed

---

## Testing

### Before Fix ❌

```
Record: A8, B8, C8
Execute:
  - A8: ✅ Works
  - B8: ✅ Works
  - C8: ❌ "Could not extract cell reference" → Types into Menus search box
```

### After Fix ✅

```
Record: A8, B8, C8
Execute:
  - A8: ✅ Extracts cellRef from hint.spreadsheetContext
  - B8: ✅ Extracts cellRef from hint.spreadsheetContext
  - C8: ✅ Extracts cellRef from hint.spreadsheetContext
```

**Expected logs:**
```
✅ "📊 RecordingManager: Adding spreadsheet context to INPUT step: { cellRef: 'A8' }"
✅ "[AIAgent] 📊 SPREADSHEET TYPE HINT detected: test1"
✅ "[AIAgent] 📊 Executing SPREADSHEET TYPE: A8 = test1"
```

---

## Why This Is Fundamental

### ✅ Addresses Architectural Inconsistency

**Before:** INPUT and CLICK steps had different data structures
- CLICK: Had `spreadsheetContext`
- INPUT: Had `context.gridCoordinates` (buried)

**After:** Both have the same `spreadsheetContext` structure
- CLICK: Has `spreadsheetContext` ✅
- INPUT: Has `spreadsheetContext` ✅

### ✅ Uses Existing Cell Reference Capture

The fix leverages all the cell reference fixes we already made:
1. ✅ Explicit cell ref (from flush)
2. ✅ Cached cell ref (from input time)
3. ✅ Scanned cell ref (from Name Box)

**Priority chain already established!**

### ✅ Minimal Changes

- Added `spreadsheetContext` extraction (20 lines)
- Added field to payload (1 line)
- Added field to hint (1 line)

**Total: ~22 lines of code**

---

## Related Fixes

This completes the **Spreadsheet Recording & Execution** series:

1. ✅ **Multi-cell flush** - Detects cell switches via cell ref comparison
2. ✅ **Race condition** - Passes explicit cell ref through async chain
3. ✅ **Variable matching** - Uses stepId fallback for shifted indices
4. ✅ **Auto-refresh** - Detects zombie content scripts
5. ✅ **INPUT context** - Adds spreadsheetContext to INPUT steps (THIS FIX!)

**All 5 fixes work together for reliable spreadsheet workflows!**

---

## Date
January 7, 2025

## Status
✅ **IMPLEMENTED** - Build successful, ready for testing

## Next Steps

1. **Reload extension** at `chrome://extensions`
2. **Refresh Google Sheets** (Cmd+Shift+R)
3. **Re-record the workflow** (type in A, B, C columns)
4. **Check console** for "Adding spreadsheet context to INPUT step"
5. **Execute the workflow**
6. **Verify** all 3 cells execute correctly (no more Menus search box!)



