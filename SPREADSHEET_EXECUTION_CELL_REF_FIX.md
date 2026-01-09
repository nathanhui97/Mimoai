# Spreadsheet Execution: Cell Reference Extraction Fix

## Problem

During workflow execution, the AI agent couldn't extract cell references for INPUT steps (A2, C2), causing it to type into wrong elements (Menus combobox instead of cells).

### Execution Results ❌
```
Step 0 (A2 INPUT): "nathan" → Typed into "Menus" combobox ❌
Step 1 (B2 CLICK): Clicked B2 correctly ✅
Step 2 (B2 INPUT): "hui" → Typed into B3 (intelligent append) ✅
Step 3 (C2 CLICK): Clicked C2 correctly ✅
Step 4 (C2 INPUT): "1234" → Typed into combobox ❌
```

**Result:** Only 1 of 3 INPUT steps worked (B2)!

### Error Logs
```
[AIAgent] 📊 SPREADSHEET TYPE HINT detected: "nathan"
[AIAgent] ⚠️ Could not extract cell reference for spreadsheet type hint

[AIAgent] 📊 SPREADSHEET TYPE HINT detected: "1234"
[AIAgent] ⚠️ Could not extract cell reference for spreadsheet type hint
```

---

## Root Cause

The cell reference extraction code in `ai-agent.ts` was checking:
1. `hint.recordedAriaLabel`
2. `hint.recordedFallbackSelectors`

But **NOT** checking `hint.spreadsheetContext.recordedIntent.cellRef`, which we added in the previous fix!

```typescript
// OLD CODE (incomplete)
let recordedCellRef: string | undefined;

if (currentHint.recordedAriaLabel) {
  const match = currentHint.recordedAriaLabel.match(/^([A-Z]+\d+)$/i);
  if (match) {
    recordedCellRef = match[1].toUpperCase();
  }
}

// ❌ Never checks hint.spreadsheetContext!
```

**Result:** Even though `spreadsheetContext` was in the hint, the agent didn't look for it!

---

## The Fix

### Added spreadsheetContext as Priority 1

**File:** `src/lib/ai-agent.ts`

**For INPUT steps (lines 741-771):**
```typescript
// Extract cell reference from hint
let recordedCellRef: string | undefined;

// PRIORITY 1: Try spreadsheetContext first (most reliable!)
if (currentHint.spreadsheetContext?.recordedIntent?.cellRef) {
  recordedCellRef = currentHint.spreadsheetContext.recordedIntent.cellRef.toUpperCase();
  console.log(`[AIAgent] 📊 Extracted cell ref from spreadsheetContext: ${recordedCellRef}`);
}

// PRIORITY 2: Try recordedAriaLabel (e.g., "A2", "B3")
if (!recordedCellRef && currentHint.recordedAriaLabel) {
  const match = currentHint.recordedAriaLabel.match(/^([A-Z]+\d+)$/i);
  if (match) {
    recordedCellRef = match[1].toUpperCase();
    console.log(`[AIAgent] 📊 Extracted cell ref from recordedAriaLabel: ${recordedCellRef}`);
  }
}

// PRIORITY 3: Try fallback selectors (e.g., [aria-label="A2"])
if (!recordedCellRef && currentHint.recordedFallbackSelectors) {
  for (const selector of currentHint.recordedFallbackSelectors) {
    const ariaMatch = selector.match(/\[aria-label=["']([A-Z]+\d+)["']\]/i);
    if (ariaMatch) {
      recordedCellRef = ariaMatch[1].toUpperCase();
      console.log(`[AIAgent] 📊 Extracted cell ref from fallbackSelector: ${recordedCellRef}`);
      break;
    }
  }
}
```

**For CLICK steps (lines 854-882):**
Same logic - check `spreadsheetContext` first!

---

## Why This Fix Works

### Chain of Data Flow

**Recording:**
```
1. User types in A2
2. spreadsheetContext.recordedIntent.cellRef = "A2" ✅
3. Saved to workflow JSON
```

**Hint Extraction:**
```
4. extractHints() reads workflow
5. hint.spreadsheetContext = payload.spreadsheetContext ✅
6. Hint has cellRef available
```

**Execution (NEW FIX):**
```
7. Check hint.spreadsheetContext.recordedIntent.cellRef ✅
8. Extract "A2"
9. Execute: type in A3 (intelligent append) ✅
```

**Before fix:** Step 7 didn't happen, so extraction failed!

---

## Expected Results After Fix

### Execution
```
Step 0 (A2 INPUT): "nathan" → Types into A3 ✅ (intelligent append)
Step 1 (B2 CLICK): Clicks B2 → Nothing visible happens ✅
Step 2 (B2 INPUT): "hui" → Types into B3 ✅ (intelligent append)
Step 3 (C2 CLICK): Clicks C2 → Nothing visible happens ✅
Step 4 (C2 INPUT): "1234" → Types into C3 ✅ (intelligent append)
```

**Result:** New row created (row 3) with all 3 values!

### Console Logs
```
✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: A2
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: A3 = "nathan" (recorded: A2, intelligent append)

✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: B2
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: B3 = "hui" (recorded: B2, intelligent append)

✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: C2
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: C3 = "1234" (recorded: C2, intelligent append)
```

**No more "Could not extract cell reference"!**

---

## How Intelligent Append Works

### Recorded:
```
Row 1: Name    Email    Phone  (headers)
Row 2: 123     3455     22222  (your recorded data)
```

### Execution:
```
Row 1: Name    Email    Phone  (headers)
Row 2: 123     3455     22222  (existing data)
Row 3: nathan  hui      1234   (NEW - appended!) ✅
```

**Why this is good:**
- ✅ Doesn't overwrite existing data
- ✅ Adds new row each time workflow runs
- ✅ Perfect for data entry workflows

---

## Files Modified

1. **`src/lib/ai-service.ts`**
   - Skip AI for spreadsheet step descriptions
   - Use template: "Enter {value} into cell {cellRef}"

2. **`src/lib/ai-agent.ts`**
   - **Line 745-748:** Added spreadsheetContext as PRIORITY 1 for INPUT steps
   - **Line 858-861:** Added spreadsheetContext as PRIORITY 1 for CLICK steps
   - Kept intelligent append feature (working as intended)

3. **`src/sidepanel/App.tsx`**
   - Simplified step display for spreadsheets
   - Hide technical details

4. **`src/lib/variable-detector.ts`**
   - Skip AI for spreadsheet variables
   - Create variables instantly from cell references

---

## Testing

### 1. Reload Extension
`chrome://extensions` → Reload

### 2. Setup Sheet
```
Row 1: Name    Email    Phone
Row 2: test    test     test   (existing data)
```

### 3. Record
- Type in A2: "222"
- Type in B2: "1111"
- Type in C2: "44444"

### 4. Execute with Variables
```
cellA2: "nathan"
cellB2: "hui"
cellC2: "1234"
```

### 5. Expected Result
```
Row 1: Name    Email    Phone
Row 2: test    test     test   (unchanged)
Row 3: nathan  hui      1234   (NEW ROW!) ✅
```

### 6. Expected Console Logs
```
✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: A2
✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: B2
✅ [AIAgent] 📊 Extracted cell ref from spreadsheetContext: C2

✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: A3 = "nathan"
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: B3 = "hui"
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: C3 = "1234"
```

**No more "Could not extract cell reference"!**

---

## Why Only B2 Worked Before

Looking at your logs, only step 2 (B2) succeeded. Why?

**Possible reasons:**
1. B2 had `recordedAriaLabel="B2"` or fallback selector with B2
2. A2 and C2 didn't have these (maybe timing issue during recording)
3. `spreadsheetContext` wasn't checked, so only B2's aria-label worked

**Now:** All 3 will work because we check `spreadsheetContext` first!

---

## Date
January 7, 2026

## Status
✅ **FIXED & BUILT** - Ready for testing

## Key Insight
The intelligent append feature (B2 → B3) is **correct and intentional**. The bug was that cell references weren't being extracted for all INPUT steps due to missing `spreadsheetContext` check.

## Author
AI Assistant (with user nathhui)



