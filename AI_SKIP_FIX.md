# AI Skip Logic Fix + Step Ordering Fix - January 4, 2026

## Problems Found

### Problem 1: AI Skipping TYPE Actions
The AI agent was incorrectly skipping TYPE actions (entering values into fields) during workflow execution.

### Problem 2: Steps Recorded Out of Order (NEW!)
INPUT steps were being saved BEFORE CLICK steps in the workflow, even though the CLICK happened first. This caused the AI to try entering values into fields that didn't exist yet! 

### Symptoms
- Workflow: "Enter 1000 in Budget Amount"
- AI Response: `{"action":"skip","reasoning":"The Budget Amount field is already filled with the correct value (1000)."}`
- **Reality**: The field was actually empty or had a different value!

### Root Cause

The DOM agent prompt (in `supabase/functions/dom_agent/index.ts`) had instructions that were too aggressive about skipping filled fields:

```typescript
// BAD - Old prompt:
- Example: [spinbutton] "Budget Amount" value="1000" ← Already filled, SKIP IT
- Only type into fields that are EMPTY or need different values
```

The AI was seeing the field NAME ("Budget Amount") and assuming it was filled, without actually checking if the current value matched the target value.

---

## Solution

### 1. Updated Prompt Instructions (Lines 628-639)

**Before:**
```
- Example: [spinbutton] "Budget Amount" value="1000" ← Already filled, SKIP IT
- Only type into fields that are EMPTY or need different values
- Skip hints for fields that are already filled
```

**After:**
```
- CRITICAL: Compare CURRENT value with TARGET value from hint
- Example: Hint says "Enter 1000", field shows value="500" → MUST TYPE "1000"
- Example: Hint says "Enter 1000", field shows value="1000" → SKIP (already correct)
- NEVER skip a TYPE hint unless the field value EXACTLY matches what needs to be entered
- Skip TYPE hints ONLY if field value exactly matches the target value
```

### 2. Enhanced Skip Decision Logic (Lines 550-564)

**Before:**
```
4. If field should have value X and it ALREADY has value X → SKIP this step
```

**After:**
```
4. For TYPE actions: Compare the CURRENT field value with the TARGET value
   - Hint says "Enter 1000", DOM shows value="1000" → SKIP (already correct)
   - Hint says "Enter 1000", DOM shows value="" or value="500" → MUST TYPE
   - Hint says "Enter 1000", field not found in DOM → SKIP
   
⚠️ FOR TYPE ACTIONS: Never assume a field is filled just because you see its name - CHECK THE ACTUAL VALUE!
```

---

## Changes Made

### File: `supabase/functions/dom_agent/index.ts`

1. **Lines 628-639**: Updated "FORM FIELDS" section to emphasize value comparison
2. **Lines 550-564**: Enhanced "BEFORE ACTING" checklist with explicit TYPE action logic

---

## Testing Required

1. **Reload the extension** in Chrome (`chrome://extensions` → reload icon)

2. **Deploy DOM agent** to Supabase:
   ```bash
   supabase login
   cd "/Users/nathhui/Documents/Autoflow chrome extension"
   supabase functions deploy dom_agent --no-verify-jwt
   ```

3. **Test the promotion workflow**:
   - Open: `https://fractal.uberinternal.com/promotion-tool`
   - Run the workflow
   - Verify:
     - ✅ Opens dropdown
     - ✅ **ENTERS "1000" in Budget Amount** (was being skipped before!)
     - ✅ Clicks BOGO option
     - ✅ **ENTERS "100" in Restaurant Funding Percentage** (was being skipped before!)
     - ✅ Selects "UberEats Growth"
     - ✅ Completes workflow

---

## Expected Behavior Now

### Scenario 1: Field Empty
- Hint: "Enter 1000"
- DOM: `<input value="">`
- **Action**: TYPE "1000" ✅

### Scenario 2: Field Has Different Value
- Hint: "Enter 1000"
- DOM: `<input value="500">`
- **Action**: TYPE "1000" ✅

### Scenario 3: Field Already Has Correct Value
- Hint: "Enter 1000"
- DOM: `<input value="1000">`
- **Action**: SKIP ✅

### Scenario 4: Field Not Found
- Hint: "Enter 1000"
- DOM: (field doesn't exist)
- **Action**: SKIP ✅

---

## Impact

### Fixed Workflows
- ✅ Promotion tool (fractal.uberinternal.com)
- ✅ Any workflow with form fields that need explicit values
- ✅ Workflows where fields might have placeholder/default values

### Not Affected
- Simple click-only workflows (no TYPE actions)
- Workflows on Google Sheets/Excel (different logic)
- Navigation workflows

---

## Next Steps

1. **User must reload extension** (Chrome doesn't auto-reload)
2. **User must deploy DOM agent** (Supabase edge function needs to be updated)
3. Test the workflow again to verify the fix

---

## Deployment Commands

```bash
# Step 1: Login to Supabase (one-time)
supabase login

# Step 2: Deploy the updated DOM agent
cd "/Users/nathhui/Documents/Autoflow chrome extension"
supabase functions deploy dom_agent --no-verify-jwt

# Step 3: Reload extension in Chrome
# Go to chrome://extensions
# Find GhostWriter
# Click the refresh/reload icon
```

---

## Files Modified

1. ✅ `supabase/functions/dom_agent/index.ts` (lines 628-639, 550-564) - AI skip logic fix
2. ✅ `src/sidepanel/App.tsx` - Added timestamp sorting when saving workflows
3. ✅ `src/content/recording-manager.ts` - Added pending click processing tracking
4. ✅ Built successfully (`npm run build`)

---

## Problem 3 Details: Last Step Missing Fix

### Root Cause

Click events are processed asynchronously via `requestIdleCallback` or `setTimeout(0)`. When the user clicks "Stop Recording" immediately after their last action, the click processing hasn't even started yet!

**Timeline of what was happening:**
1. User clicks button (last action)
2. Click event captured → `processClick` scheduled for async execution
3. User clicks "Stop Recording" → stop() called
4. stop() waits 300ms (but processClick takes 1-5 seconds!)
5. stop() completes → processClick was never awaited
6. Last step is lost!

### The Fix

Added `pendingClickProcessing` tracking array in `src/content/recording-manager.ts`:

```typescript
// New property
private pendingClickProcessing: Promise<void>[] = [];

// Wrap processClick in tracked promise
const clickPromise = new Promise<void>((resolve) => {
  const wrappedProcessClick = async () => {
    try {
      await processClick();
    } finally {
      // Remove from pending array
      const index = this.pendingClickProcessing.indexOf(clickPromise);
      if (index > -1) this.pendingClickProcessing.splice(index, 1);
      resolve();
    }
  };
  // Schedule execution
  requestIdleCallback(wrappedProcessClick, { timeout: 100 });
});
this.pendingClickProcessing.push(clickPromise);
```

In stop():
```typescript
// Wait for pending click processing (up to 10 seconds)
if (this.pendingClickProcessing.length > 0) {
  await Promise.race([
    Promise.all(this.pendingClickProcessing),
    new Promise(resolve => setTimeout(resolve, 10000))
  ]);
}
```

### Expected Console Output Now

When stopping recording after a click:
```
🛑 GhostWriter: Stopping recording - flushing pending steps...
⏳ GhostWriter: Waiting 300ms for any in-flight events to start...
🔄 GhostWriter: Waiting for 1 pending click(s) to complete...
✅ GhostWriter: All pending clicks completed in 2345.67ms
✅ GhostWriter: Recording stopped successfully
```

---

## Problem 2 Details: Step Ordering Fix

### Root Cause

INPUT steps are **debounced** - the system waits for the user to finish typing before recording the step. This means:

1. User clicks dropdown (CLICK recorded immediately)
2. User clicks BOGO option (CLICK recorded immediately)  
3. User types "1000" into Budget field (INPUT recorded AFTER user stops typing)

Because of debouncing, the INPUT step arrives AFTER the CLICK steps in the state array, even though the actual INPUT action happened FIRST chronologically.

### The Fix

Added timestamp sorting in `src/sidepanel/App.tsx`:

```typescript
// CRITICAL: Sort steps by timestamp before saving
const sortedSteps = [...workflowSteps].sort((a, b) => 
  a.payload.timestamp - b.payload.timestamp
);
```

### Before Fix (Wrong Order)
```
Array Order: [CLICK "open", INPUT "1000", CLICK "BOGO", ...]
Timestamps:  [711326,       714366,       712433,      ...]
```

The AI would try to enter "1000" BEFORE clicking BOGO - impossible!

### After Fix (Correct Order)
```
Array Order: [CLICK "open", CLICK "BOGO", INPUT "1000", ...]
Timestamps:  [711326,       712433,       714366,      ...]
```

The AI now correctly opens dropdown → clicks BOGO → enters "1000"

---

## Version

- **Date**: January 4, 2026
- **Build**: Completed successfully
- **Deployment Status**: ⚠️ Needs Supabase login and deployment
- **Testing Status**: ⚠️ Waiting for user to reload + deploy + test


