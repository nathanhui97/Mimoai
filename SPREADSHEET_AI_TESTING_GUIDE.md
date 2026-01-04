# Spreadsheet AI Comprehension - Testing Guide

## Overview

This guide covers testing the new AI-powered spreadsheet comprehension feature. The system now understands spreadsheet context and makes intelligent decisions about where to place data, like a human would.

---

## Architecture Summary

```
Recording Phase:
  User clicks cell → ContextScanner → SheetStateExtractor → Captures full sheet state

Replay Phase:
  Load workflow → AI sees sheet state → AI decides best cell → SpreadsheetExecutor clicks it
```

**Key Feature**: The AI can see the entire spreadsheet structure (headers, data ranges, column types) and adapt to changes.

---

## Test 1: Domain Safeguard Verification

**Purpose**: Ensure spreadsheet logic ONLY runs on Google Sheets/Excel Online

### Steps:
1. Open a regular website (e.g., google.com)
2. Open DevTools Console (F12)
3. Start recording a workflow
4. Click around on the page
5. Stop recording

### Expected Results:
- ✅ Console should NOT show any `📊 SpreadsheetExecutor` or `📊 SheetStateExtractor` logs
- ✅ Saved workflow JSON should have NO `spreadsheetContext` field
- ✅ No spreadsheet-related errors in console

### How to Check:
```javascript
// In console, run:
SheetStateExtractor.isSpreadsheetDomain()
// Should return: false
```

---

## Test 2: Sheet State Extraction (Google Sheets)

**Purpose**: Verify the system can extract full sheet context

### Setup:
1. Create a new Google Sheets document
2. Add sample data:
   ```
   A1: Date        B1: Sales Amount    C1: Product
   A2: 1/1/2024    B2: 1000           C2: Widget A
   A3: 1/2/2024    B3: 1500           C3: Widget B
   A4: 1/3/2024    B4: 2000           C4: Widget C
   A5: 1/4/2024    B5: 1200           C5: Widget D
   ```

### Steps:
1. Open the Google Sheet
2. Open DevTools Console
3. Run extraction command

### Expected Results:
```javascript
// In console, run:
await SheetStateExtractor.extract()

// Should return something like:
{
  domain: "google-sheets",
  sheetName: "Sheet1",
  headers: [
    { column: "A", text: "Date" },
    { column: "B", text: "Sales Amount" },
    { column: "C", text: "Product" }
  ],
  dataRange: {
    firstRow: 1,
    lastRow: 5,
    firstColumn: "A",
    lastColumn: "C"
  },
  columns: [
    {
      letter: "B",
      header: "Sales Amount",
      dataType: "number",
      rowCount: 4,
      lastDataRow: 5,
      firstEmptyRow: 6,
      sampleValues: ["1000", "1500", "2000"]
    },
    // ... other columns
  ],
  activeCell: {
    reference: "B6",  // or whatever cell is active
    value: null,
    isEmpty: true
  }
}
```

---

## Test 3: Intent Detection During Recording

**Purpose**: Verify the system captures the semantic intent behind cell clicks

### Setup:
Use the same Google Sheet from Test 2

### Test 3A: Append Operation
1. Start recording
2. Click cell **B6** (first empty cell after data in column B)
3. Stop recording

**Expected Console Logs:**
```
📊 RecordingManager: Extracting spreadsheet state...
📊 RecordingManager: Spreadsheet context captured: User clicked first empty cell (B6) after data ends at row 5. This is an append operation.
```

**Check Workflow JSON:**
```javascript
// Last step should have:
{
  "spreadsheetContext": {
    "recordedIntent": {
      "cellRef": "B6",
      "columnHeader": "Sales Amount",
      "wasEmpty": true,
      "wasAppendPosition": true,
      "reasoning": "User clicked first empty cell (B6) after data ends at row 5. This is an append operation."
    }
  }
}
```

### Test 3B: Literal Cell Click
1. Start recording
2. Click cell **B3** (cell WITH data)
3. Stop recording

**Expected:**
```javascript
{
  "recordedIntent": {
    "cellRef": "B3",
    "wasEmpty": false,
    "wasAppendPosition": false,
    "reasoning": "User clicked cell B3 which has data - editing specific cell."
  }
}
```

---

## Test 4: AI Decision Making (The Main Feature!)

**Purpose**: Verify AI adapts to current sheet state and finds the correct cell

### Setup:
1. Use the same Google Sheet from Test 2
2. Record a simple workflow:
   - Click cell B6 (first empty after data)
   - You should see the append intent captured

### Steps:
1. **Manually add more data** to cells B6, B7, B8:
   ```
   B6: 3000
   B7: 2500
   B8: 4000
   ```
2. Now the "next empty" is B9, not B6
3. **Replay the workflow**

### Expected Results:
- ✅ Console shows: `📊 SpreadsheetExecutor: Finding next empty cell in column B`
- ✅ Console shows: `📊 SpreadsheetExecutor: Found next empty cell: B9`
- ✅ **The AI should click B9** (not the recorded B6)
- ✅ Cell B9 becomes active (selected)

**Why This Works:**
The AI sees that:
- Original intent: "append to column B"
- Recorded cell: B6 (was empty at recording time)
- Current state: B6-B8 now have data
- Decision: "User wants to append, so find NEW next empty = B9"

---

## Test 5: Literal Cell Preservation

**Purpose**: Verify AI doesn't "fix" cells that were intentionally specific

### Setup:
1. Use the same Google Sheet
2. Record a workflow:
   - Click cell B3 (cell WITH data, not append)

### Steps:
1. Replay the workflow

### Expected Results:
- ✅ AI should click **B3 exactly** (not find a different cell)
- ✅ Console shows: `📊 SpreadsheetExecutor: Clicking cell B3`
- ✅ B3 becomes active

**Why:** The AI recognized that B3 had data during recording, so this was NOT an append operation. It respects the user's explicit choice.

---

## Test 6: Column Header Navigation

**Purpose**: Verify AI can find cells by column header name

### This feature will be tested when the AI agent makes decisions using `find_by_header` action.

---

## Test 7: Excel Online Compatibility

**Purpose**: Verify the system works on Excel Online

### Setup:
1. Open Excel Online (office.com or onedrive.live.com)
2. Create a new spreadsheet
3. Add sample data

### Steps:
Same as Test 2-5, but on Excel Online

### Expected Results:
- ✅ Domain detection works
- ✅ Extraction returns `domain: "excel-online"`
- ✅ Basic functionality works

**Note:** Excel Online has limited DOM access, so some features may be simplified.

---

## Debugging Commands

### Check if on spreadsheet domain:
```javascript
SheetStateExtractor.isSpreadsheetDomain()
```

### Extract full sheet state:
```javascript
await SheetStateExtractor.extract()
```

### Test cell clicking:
```javascript
await SpreadsheetExecutor.execute({
  action: 'click_cell',
  cellRef: 'B9'
})
```

### Test finding next empty:
```javascript
await SpreadsheetExecutor.execute({
  action: 'find_and_click_empty',
  column: 'B'
})
```

### Check what AI sees:
Look for DOM agent requests in Network tab:
- Filter for `dom_agent`
- Check request payload for `spreadsheetContext`

---

## Common Issues & Solutions

### Issue: "SheetStateExtractor is not defined"
**Solution:** The code hasn't loaded yet. Refresh the page and try again.

### Issue: No spreadsheet logs appear
**Solution:** Check that you're actually on a Google Sheets or Excel Online domain.

### Issue: AI always clicks the recorded cell, not the new empty one
**Solution:** 
1. Check the workflow JSON - does it have `spreadsheetContext.recordedIntent.wasAppendPosition: true`?
2. If not, try recording again, making sure to click the first empty cell after data.

### Issue: Cell clicking doesn't work
**Solution:** 
1. Google Sheets uses complex DOM - the Name Box strategy is most reliable
2. Check console for errors from SpreadsheetExecutor
3. Try clicking the cell manually to see if it's actually clickable

---

## Success Criteria

✅ **All Tests Pass**
✅ **No console errors related to spreadsheets**
✅ **Domain safeguards prevent execution on non-spreadsheet sites**
✅ **AI adapts to current sheet state (Test 4)**
✅ **AI respects literal cell clicks (Test 5)**

---

## Next Steps

After basic testing passes:
1. Test with larger spreadsheets (100+ rows)
2. Test with multiple columns
3. Test with complex formulas
4. Test with protected sheets
5. Test with shared sheets (multiple users)

---

## Reporting Issues

When reporting issues, include:
1. Browser console logs (filter for `📊`)
2. Workflow JSON (the `spreadsheetContext` field)
3. Screenshot of the spreadsheet state
4. Steps to reproduce

