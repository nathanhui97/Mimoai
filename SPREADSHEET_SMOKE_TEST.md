# Spreadsheet Feature Smoke Test Checklist

**Purpose:** Quick manual test to verify spreadsheet features work before deployment.  
**Time:** ~3 minutes  
**Run:** Before every deployment that touches spreadsheet code

---

## Pre-Test Setup

### 1. Prepare Test Sheet
```
Row 1: Name    Email         Phone
Row 2: test1   test1@test    111-1111  (existing data)
Row 3: (empty) (empty)       (empty)
```

### 2. Reload Extension
- Go to `chrome://extensions`
- Click reload button for Mimoai
- Verify: Green "Connected" status in side panel

---

## Test 1: Recording (30 seconds)

### Actions
1. Click "Start Recording"
2. Type in **A2**: "aaa"
3. Type in **B2**: "bbb"
4. Type in **C2**: "ccc"
5. Click "Stop Recording"

### Expected Results
✅ Recording starts instantly (no delay)  
✅ No zoom flash on page  
✅ All 3 steps recorded  
✅ Console shows: `📊 GhostWriter: Captured cell reference at input time: A2, B2, C2`  
✅ No errors in console

### Pass Criteria
- [ ] All 3 steps visible in "Recorded Steps"
- [ ] No console errors

---

## Test 2: Variable Detection (30 seconds)

### Actions
1. Check "Detected Variables" section

### Expected Results
```
✅ Detected Variables (3) - Detected instantly (<1 sec)
├─ A2: "aaa"
├─ B2: "bbb"
└─ C2: "ccc"
```

### Console Logs to Check
```
✅ [VariableDetector] ⚡ Created 3 spreadsheet variables instantly (no AI needed)
✅ [VariableDetector] 📊 Found spreadsheet INPUT at step X: {
     cellRef: "A2",
     fieldName: "A2",
     variableName: "cellA2"
   }
```

### Pass Criteria
- [ ] All 3 variables detected (A2, B2, C2)
- [ ] Detection took <1 second
- [ ] Console shows "Created 3 spreadsheet variables instantly"
- [ ] No "Could not extract cell reference" warnings

---

## Test 3: Step Descriptions (30 seconds)

### Actions
1. Check step descriptions in "Recorded Steps"

### Expected Results
```
✅ 1. INPUT  ✨ cellA2
     Enter "aaa" into cell A2
     ✨ Variable: A2 (click to rename)

✅ 2. INPUT  ✨ cellB2
     Enter "bbb" into cell B2
     ✨ Variable: B2 (click to rename)

✅ 3. INPUT  ✨ cellC2
     Enter "ccc" into cell C2
     ✨ Variable: C2 (click to rename)
```

### Console Logs to Check
```
✅ [AIService] 📊 Skipping AI for spreadsheet INPUT (cell A2) - using template
✅ [AIService] 📊 Skipping AI for spreadsheet INPUT (cell B2) - using template
✅ [AIService] 📊 Skipping AI for spreadsheet INPUT (cell C2) - using template
```

### Pass Criteria
- [ ] Descriptions say "Enter {value} into cell {cellRef}"
- [ ] NOT generic "Enter value into the field"
- [ ] Console shows "Skipping AI for spreadsheet INPUT"
- [ ] Descriptions appeared instantly (<1 sec per step)

---

## Test 4: Execution (60 seconds)

### Actions
1. Rename variables (optional):
   - A2 → "name"
   - B2 → "email"
   - C2 → "phone"
2. Enter new values:
   - name: "John"
   - email: "john@test.com"
   - phone: "555-1234"
3. Click "Execute Workflow"
4. Wait for completion

### Expected Results
```
Sheet after execution:
Row 1: Name    Email            Phone
Row 2: test1   test1@test       111-1111  (unchanged)
Row 3: John    john@test.com    555-1234  (NEW ROW!) ✅
```

### Console Logs to Check
```
✅ [AIAgent] 📝 Variable substitution: step 0 "aaa" → "John" (A2)
✅ [AIAgent] 📝 Variable substitution: step 2 "bbb" → "john@test.com" (B2)
✅ [AIAgent] 📝 Variable substitution: step 4 "ccc" → "555-1234" (C2)

✅ [SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: A2
✅ [SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: B2
✅ [SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: C2

✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: A3 = "John" (intelligent append)
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: B3 = "john@test.com" (intelligent append)
✅ [AIAgent] 📊 Executing SPREADSHEET TYPE: C3 = "555-1234" (intelligent append)
```

### Pass Criteria
- [ ] All 3 values typed correctly
- [ ] New row created (row 3)
- [ ] Existing data unchanged (row 2)
- [ ] No "Could not extract cell reference" errors
- [ ] No typing into "Menus" or other random fields

---

## Test 5: Non-Spreadsheet Compatibility (30 seconds)

### Actions
1. Navigate to any regular website (not Google Sheets)
2. Record typing in a form field
3. Stop recording
4. Check variable detection

### Expected Results
✅ AI-based variable detection still works for regular forms  
✅ No spreadsheet-specific code interferes  
✅ Descriptions use AI analysis (not templates)

### Pass Criteria
- [ ] Variables detected correctly (if applicable)
- [ ] No errors related to spreadsheetContext
- [ ] Regular form workflow still works

---

## Common Failures & Fixes

### ❌ "Could not extract cell reference"
**Cause:** `spreadsheetContext` not in payload or hint  
**Check:** Recording logs for "Adding spreadsheet context to INPUT step"  
**Fix:** Verify `recording-manager.ts` adds `spreadsheetContext` to INPUT payloads

### ❌ Variables show wrong cell (A2 for B2 step)
**Cause:** stepIndex mismatch due to extra CLICK steps  
**Check:** Variable detection logs for stepIndex vs cellRef  
**Fix:** Variables should use `stepId` (timestamp) for matching, not `stepIndex`

### ❌ Typed into "Menus" combobox instead of cell
**Cause:** Cell reference extraction failed  
**Check:** `[SpreadsheetHelpers]` logs during execution  
**Fix:** Verify `SpreadsheetHelpers.extractCellReference()` checks all sources

### ❌ Typed into wrong row (A5 instead of A2)
**Cause:** Intelligent append using wrong base row  
**Expected:** This is correct! It should append to next empty row  
**Action:** Verify row 3 was actually empty before execution

---

## Success Criteria Summary

**All tests pass if:**
1. ✅ Recording captures 3 cell references (A2, B2, C2)
2. ✅ Variables detected instantly (<1 sec)
3. ✅ Variable names are correct (A2, B2, C2 or renamed)
4. ✅ Step descriptions show cell references
5. ✅ Execution types into all 3 cells in new row
6. ✅ No "Could not extract" errors
7. ✅ Regular forms still work

---

## Timing Benchmarks

| Operation | Target | Actual | Status |
|-----------|--------|--------|--------|
| Start recording | <500ms | ___ | ⬜ |
| Variable detection | <1s | ___ | ⬜ |
| Step descriptions | <1s total | ___ | ⬜ |
| Execution (3 cells) | <10s | ___ | ⬜ |

---

## Test Log Template

```
Date: _______________
Tester: _______________
Build: _______________

Test 1 (Recording):        ☐ Pass  ☐ Fail  Notes: _______________
Test 2 (Variables):        ☐ Pass  ☐ Fail  Notes: _______________
Test 3 (Descriptions):     ☐ Pass  ☐ Fail  Notes: _______________
Test 4 (Execution):        ☐ Pass  ☐ Fail  Notes: _______________
Test 5 (Compatibility):    ☐ Pass  ☐ Fail  Notes: _______________

Overall:                   ☐ Pass  ☐ Fail

Regressions found: _______________________________________________
Action items: _____________________________________________________
```

---

## Integration with CI/CD (Future)

This checklist can be automated with:
- **Playwright** for browser automation
- **Jest** for assertions
- **GitHub Actions** for CI

But for now, **manual testing with this checklist** provides good protection!

---

## Date Created
January 7, 2026

## Last Updated
January 7, 2026

## Owner
Mimoai Team



