# Snapshot Investigation & Fix - Headers Not Detected

## Problem

User recorded in Google Sheets with headers in row 1, but AI detected generic names:
- "value" instead of actual header
- "referenceNumber" instead of actual header  
- "phoneNumber" instead of actual header

---

## Investigation Results

### ✅ Data Flow Was Correct

1. ✅ Snapshot captured successfully (255KB, zoomed to 33%)
2. ✅ Passed from recording-manager to content-script
3. ✅ Passed from content-script to App.tsx
4. ✅ Passed from App.tsx to VariableDetector
5. ✅ Passed from VariableDetector to edge function

### 🔴 Issue Found: URL Pattern Mismatch

**User's recording URL:**
```
https://docs.google.com/offline/iframeapi?ouid=...
```

**Edge function check:**
```typescript
const isSpreadsheetUrl = pageContext?.url.includes('docs.google.com/spreadsheets');
// ❌ DOESN'T MATCH!
```

**Result:** `isSpreadsheetUrl = false`

### 🟡 Secondary Check Should Have Worked

The code also checks:
```typescript
const isSpreadsheetStep = !!(metadata.cellReference || metadata.columnHeader);
const needsSnapshot = isDataTablePage || isSpreadsheetStep || isSpreadsheetUrl;
```

Since user had `cellReference: "A11", "B11", "C11"`, this SHOULD have been `true`.

**Possible issue:** If `cellReference` wasn't in the metadata for some reason, snapshot wouldn't be included.

---

## Fixes Implemented

### Fix 1: Add Iframe URL Pattern

**File:** `supabase/functions/detect_variables/index.ts`

**Before:**
```typescript
const isSpreadsheetUrl = pageContext?.url ? (
  pageContext.url.includes('docs.google.com/spreadsheets') ||
  pageContext.url.includes('excel.office.com') ||
  ...
) : false;
```

**After:**
```typescript
const isSpreadsheetUrl = pageContext?.url ? (
  pageContext.url.includes('docs.google.com/spreadsheets') ||
  pageContext.url.includes('docs.google.com/offline/iframeapi') || // ← NEW!
  pageContext.url.includes('excel.office.com') ||
  ...
) : false;
```

### Fix 2: Simplify needsSnapshot Check

**Before:**
```typescript
const needsSnapshot = isDataTablePage || isSpreadsheetStep || isSpreadsheetUrl;
```

**After:**
```typescript
const needsSnapshot = isDataTablePage || isSpreadsheetStep;
// Removed URL requirement - if it has cellReference, include snapshot!
```

**Impact:** ANY step with a `cellReference` will now get the snapshot, regardless of URL pattern.

### Fix 3: Enhanced Logging

Added more detailed logging to diagnose future issues:

```typescript
console.log(`[detect_variables] analyzeStep for step ${metadata.stepIndex} - Full page snapshot check:`, {
  hasInitialSnapshot: hasSnapshot,
  snapshotLength: initialFullPageSnapshot?.length || 0,  // ← Full length now
  cellReference: metadata.cellReference,
  columnHeader: metadata.columnHeader,
  label: metadata.label,     // ← NEW!
  value: metadata.value,     // ← NEW!
  shouldIncludeSnapshot,
});
```

---

## Testing Instructions

### 1. Clear Browser Cache
- Go to Google Sheets
- Press Cmd+Shift+R (hard refresh)

### 2. Prepare Sheet
```
Row 1:  Name    Email    Phone
Row 2:  (empty) (empty)  (empty)  ← Type here
```

**CRITICAL:** Headers must be in row 1 BEFORE you start recording!

### 3. Record Workflow
1. Start recording
2. Type in **A2**: "test1"
3. Type in **B2**: "test2"
4. Type in **C2**: "test3"
5. Stop recording

### 4. Check Logs

**Browser Console** (F12):
```
[VariableDetector] Spreadsheet context for step 0: {
  cellReference: "A2",        // ← Should be A2, not A11
  columnHeader: "Name",       // ← Might be undefined (will be fetched)
  fromSpreadsheetContext: true
}

[VariableDetector] Request payload: {
  hasInitialSnapshot: true,   // ← MUST be true
  snapshotLength: ~255000     // ← Should be large
}
```

**Supabase Dashboard** (https://supabase.com/dashboard/project/jfboagngbpzollcipewh/functions/detect_variables/logs):
```
[detect_variables] Step 0 snapshot eligibility: {
  hasInitialSnapshot: true,   // ← MUST be true
  isSpreadsheetStep: true,    // ← MUST be true
  shouldIncludeSnapshot: true // ← MUST be true
}

[detect_variables] ✅ INCLUDING full page snapshot FIRST for step 0
```

### 5. Expected Result

Variable detection should show:
```
✅ Name: "test1"
✅ Email: "test2"
✅ Phone: "test3"
```

NOT:
```
❌ value: "test1"
❌ referenceNumber: "test2"
❌ phoneNumber: "test3"
```

---

## If It Still Doesn't Work

### Check 1: Were Headers Visible?

The snapshot is captured **at the start of recording**. If you:
- Scrolled down to row 11 before clicking "Start Recording"
- Row 1 was off-screen

Then the snapshot won't have the headers!

**Solution:** Always scroll to top before recording.

### Check 2: cellReference in Metadata?

Check browser console for:
```
[VariableDetector] Spreadsheet context for step 0: {
  cellReference: undefined,  // ← BAD!
  ...
}
```

If `cellReference` is undefined, the snapshot won't be included.

**Solution:** File a bug report with full logs.

### Check 3: Snapshot Included But AI Misread?

Check Supabase logs for:
```
[detect_variables] ✅ INCLUDING full page snapshot FIRST for step 0
```

If this appears but AI still gave wrong names, the issue is with AI analysis.

Check Gemini's response in logs:
```json
{
  "headersFound": "A: [?], B: [?], C: [?]",
  "reasoning": "..."
}
```

**Solution:** The snapshot image quality or prompt may need improvement.

---

## Files Changed

1. **`supabase/functions/detect_variables/index.ts`**
   - Added iframe URL pattern
   - Simplified `needsSnapshot` check
   - Enhanced logging

---

## Deployment

✅ **Deployed to Supabase** - January 7, 2026

Edge function URL: https://jfboagngbpzollcipewh.supabase.co/functions/v1/detect_variables

---

## Next Steps

1. User tests with new recording
2. Check logs to verify snapshot is included
3. If still fails, collect full logs for further investigation

---

## Status

✅ **FIX DEPLOYED** - Ready for testing

⏳ **AWAITING USER TEST** - Need confirmation that headers are now detected correctly



