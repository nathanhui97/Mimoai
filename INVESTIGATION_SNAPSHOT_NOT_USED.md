# Investigation: Why Snapshot With Headers Wasn't Used

## Executive Summary

The user recorded in Google Sheets with headers in row 1, but the AI detected generic variable names ("value", "referenceNumber", "phoneNumber") instead of the actual headers. 

**Root Cause:** The snapshot was captured but likely not analyzed correctly by the AI, OR the headers were not visible in row 1 during capture.

---

## Data Flow Analysis

### ✅ Step 1: Snapshot Captured Successfully
```
📸 GhostWriter: Zoomed out to 33% for spreadsheet capture
📸 GhostWriter: Full page captured, original: 83418 chars, compressed: 255167 chars
📸 GhostWriter: Initial snapshot captured successfully
```

**Status:** SUCCESS - Snapshot was captured at 33% zoom (~250KB)

---

### ✅ Step 2: Snapshot Returned to App.tsx
**File:** `src/content/content-script.ts:365`
```typescript
const initialSnapshot = await recordingManager.getInitialFullPageSnapshotAsync();
sendResponse({
  data: { 
    initialFullPageSnapshot: initialSnapshot || undefined,
  },
});
```

**Expected Log (in App.tsx):**
```
[App] ✅ Received initial full page snapshot for spreadsheet column header detection
```

**Status:** Likely SUCCESS (need user to confirm this log appeared)

---

### ✅ Step 3: Snapshot Passed to VariableDetector
**File:** `src/sidepanel/App.tsx:677`
```typescript
const variables = await VariableDetector.detectVariables(currentSteps, initialFullPageSnapshot);
```

**Expected Log:**
```
[VariableDetector] detectVariables called with: {
  hasInitialSnapshot: true,
  snapshotLength: ~255000
}
```

**Status:** Need user to confirm this log

---

### ✅ Step 4: Snapshot Sent to Edge Function
**File:** `src/lib/variable-detector.ts:958-972`
```typescript
const requestPayload = {
  steps: stepsForAnalysis,
  pageContext,
  initialFullPageSnapshot: initialFullPageSnapshot || undefined,
};

console.log('[VariableDetector] Request payload:', {
  hasInitialSnapshot: !!requestPayload.initialFullPageSnapshot,
  snapshotLength: requestPayload.initialFullPageSnapshot?.length,
});
```

**Expected Log:**
```
[VariableDetector] Request payload: {
  hasInitialSnapshot: true,
  snapshotLength: ~255000
}
```

**Status:** Need user to confirm this log

---

### ❓ Step 5: Edge Function Decides Whether to Include Snapshot
**File:** `supabase/functions/detect_variables/index.ts:337-350`

**Logic:**
```typescript
const isSpreadsheetStep = !!(metadata.cellReference || metadata.columnHeader);
const isSpreadsheetUrl = pageContext?.url.includes('docs.google.com/spreadsheets');
const needsSnapshot = isDataTablePage || isSpreadsheetStep || isSpreadsheetUrl;
const shouldIncludeSnapshot = !!(hasSnapshot && needsSnapshot);
```

**User's Case:**
- `cellReference`: "A11", "B11", "C11" → ✅ Present
- `isSpreadsheetStep`: Should be `true`
- `pageContext.url`: `https://docs.google.com/offline/iframeapi?ouid=...`
- `isSpreadsheetUrl`: ❌ **FALSE** (doesn't match "docs.google.com/spreadsheets")

**Expected:** `isSpreadsheetStep = true` (due to cellReference) → snapshot SHOULD be included

**Expected Log:**
```
[detect_variables] ✅ INCLUDING full page snapshot FIRST for step X (spreadsheet cell: A11, column: N/A)
```

**Status:** CRITICAL - Need to check if this log appeared in Supabase

---

### 🔴 Possible Failure Points

#### Theory 1: cellReference Not in Metadata
If `metadata.cellReference` was `undefined`, then `isSpreadsheetStep = false` and snapshot wouldn't be included.

**Evidence Needed:**
```
[VariableDetector] Spreadsheet context for step X: {
  cellReference: ???,
  columnHeader: ???,
  fromSpreadsheetContext: ???
}
```

#### Theory 2: Snapshot Included But Row 1 Empty
If the snapshot was included but row 1 had no headers, AI would guess from values.

**Evidence Needed:**
- User confirmation: Were A1, B1, C1 filled with "Name", "Email", "Phone" BEFORE recording?
- If they typed headers DURING recording but in row 11, the snapshot (captured at start) wouldn't have headers

#### Theory 3: Snapshot Included But AI Misread Headers
AI analyzed snapshot but misinterpreted the headers.

**Evidence Needed:**
```
[detect_variables] Full page snapshot image added FIRST to Gemini request for step X
```

**Gemini Response:**
```json
{
  "headersFound": "A: [what?], B: [what?], C: [what?]",
  "reasoning": "..."
}
```

---

## Critical Questions for User

### 1. Browser Console Logs
**Search for:** `[VariableDetector]`

Look for:
```
[VariableDetector] Request payload: {
  hasInitialSnapshot: ???,  // Should be true
  snapshotLength: ???       // Should be ~255000
}

[VariableDetector] Spreadsheet context for step 0: {
  cellReference: "A11",     // Should have this
  columnHeader: ???         // Might be undefined
}
```

### 2. Supabase Edge Function Logs
**Go to:** https://supabase.com/dashboard/project/jfboagngbpzollcipewh/functions/detect_variables/logs

Look for:
```
[detect_variables] Step 0 snapshot eligibility: {
  hasInitialSnapshot: ???,
  isSpreadsheetStep: ???,   // Should be true
  shouldGetSnapshot: ???    // Should be true
}

[detect_variables] ✅ INCLUDING full page snapshot FIRST for step 0
OR
[detect_variables] ⚠️ Full page snapshot available but NOT included
```

### 3. Headers Timeline
**When did you add headers?**
- [ ] Headers existed in A1, B1, C1 BEFORE you clicked "Start Recording"
- [ ] Headers were typed DURING recording (before typing in A11, B11, C11)
- [ ] Headers were typed AFTER recording stopped

**Critical:** Snapshot is captured at START of recording. If headers weren't there yet, they won't be in the snapshot!

---

## Diagnostic Commands

### In Browser Console (during next recording):
```javascript
// After stopping recording, check snapshot:
chrome.storage.local.get(['workflowSteps'], (result) => {
  console.log('Has snapshot:', result.workflowSteps?.[0]?.payload?.visualSnapshot);
});
```

### Check Metadata in Workflow JSON:
```json
{
  "type": "INPUT",
  "payload": {
    "label": "???",           // Check if this is "A11" or something else
    "spreadsheetContext": {
      "recordedIntent": {
        "cellRef": "???",     // Should be "A11"
        "columnHeader": "???" // Should have header if detected
      }
    },
    "context": {
      "gridCoordinates": {
        "cellReference": "???",  // Should be "A11"
        "columnHeader": "???"    // Should have header if detected
      }
    }
  }
}
```

---

## Most Likely Root Cause

Based on the evidence:

### 🎯 **Hypothesis: Headers Not Visible at Recording Start**

The most likely scenario:
1. User started recording
2. Snapshot was captured (showing empty row 1 or data starting at row 11)
3. User typed in cells A11, B11, C11
4. Headers in A1, B1, C1 were either:
   - Not there yet
   - Off-screen (scrolled down to row 11)
   - Not in the snapshot's zoomed-out view

**Why this explains the AI's choices:**
- Seeing `12312` in A11 → generic number → "value"
- Seeing `1232111` in B11 → looks like ID → "referenceNumber"
- Seeing `12312222` in C11 → looks like phone → "phoneNumber"

---

## Immediate Fix

### Option 1: Verify Headers Are Visible
1. Make sure A1="Name", B1="Email", C1="Phone"
2. Scroll to top (so row 1 is visible)
3. Start recording
4. Type in A2, B2, C2 (row 2, not row 11)

### Option 2: Add URL Detection for Iframe
Add iframe URL pattern to edge function:

```typescript
// In detect_variables/index.ts line 339
const isSpreadsheetUrl = pageContext?.url ? (
  pageContext.url.includes('docs.google.com/spreadsheets') ||
  pageContext.url.includes('docs.google.com/offline/iframeapi') || // ADD THIS
  pageContext.url.includes('excel.office.com') ||
  ...
) : false;
```

### Option 3: Always Include Snapshot for Steps with cellReference
```typescript
// In detect_variables/index.ts line 348
const needsSnapshot = isDataTablePage || isSpreadsheetStep || isSpreadsheetUrl;
// Change to:
const needsSnapshot = isDataTablePage || isSpreadsheetStep; // Remove URL requirement
```

This way, ANY step with a `cellReference` will get the snapshot, regardless of URL.

---

## Next Steps

1. User provides the specific logs mentioned above
2. Identify exact failure point
3. Apply appropriate fix
4. Test with new recording

---

## Date
January 7, 2026

## Status
⏳ **AWAITING USER LOGS** - Need browser console and Supabase logs to pinpoint exact failure point



