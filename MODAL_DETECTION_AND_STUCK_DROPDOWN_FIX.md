# Modal Detection and Stuck Dropdown Fix

**Date:** December 22, 2025  
**Status:** ✅ Implemented and Built Successfully  
**Issue:** Agent getting stuck after clicking BOGO option - modal not detected, stale dropdown persisting

---

## Problem Diagnosis

After clicking BOGO, a modal appeared with 18 form fields, but the agent got stuck because:

### 🔴 Root Cause: Modal Detection Failure

**Evidence from Logs:**
```
[DOMMap] Returning 18 form fields         // ← Modal appeared! Fields 1 → 18
[DOMMap] 🔽 Active dropdown detected      // ← BUT dropdown should be closed!
// NO log: "Active modal detected"        // ← Modal detection failed!
```

**Why it failed:**
- Modal likely had `zIndex <= 100` (threshold was too strict)
- Modal might not have `role="dialog"` (many modern React modals don't)
- `findActiveModal()` required high z-index AND semantic role AND positioning

### 🔴 Secondary Issue: Stale Dropdown Detection

The old dropdown from the closed combobox was still "detected" because:
- No modal scope was active
- Dropdown detector searched entire page
- Found stale dropdown elements in DOM

### 🔴 Tertiary Issue: LLM Not Using Candidates

Despite finding 8 ranked candidates, the LLM was returning free-form targets instead of using `chooseCandidateIndex`.

---

## Implemented Fixes

### Fix 1: Lenient Multi-Signal Modal Detection ✅

**File:** `src/content/dom-map.ts`

**Old Logic:**
```typescript
// Required: zIndex > 100 AND (fixed OR absolute)
if (zIndex > 100 || position === 'fixed' || position === 'absolute') {
  return modal;
}
```

**New Logic - Scoring System:**
```typescript
let modalScore = 0;

// Positioned (fixed/absolute) +30
if (position === 'fixed' || position === 'absolute') modalScore += 30;

// Z-index > 50 (lowered from 100) +30
if (zIndex > 50) modalScore += 30;

// Has backdrop/overlay sibling +20
if (hasBackdrop) modalScore += 20;

// Has explicit role="dialog" +40
if (role === 'dialog' || role === 'alertdialog') modalScore += 40;

// Has aria-modal="true" +40
if (modal.getAttribute('aria-modal') === 'true') modalScore += 40;

// Contains many form fields (3+) +20
if (formFieldCount >= 3) modalScore += 20;

// Large size (covers >40% of viewport) +10
if (coverage > 40) modalScore += 10;

// Decision: score >= 50 means it's likely a modal
if (modalScore >= 50) return modal;
```

**Additional Heuristic:**
If no modal found but 15+ form fields exist, infer modal by finding container with 80%+ of all fields.

---

### Fix 2: UI Transition Detection ✅

**File:** `src/content/dom-map.ts`

**New Feature:** Track form field count between observations to detect UI state changes.

```typescript
// Track previous state
let previousFormFieldCount = 0;

// In generateDOMMap():
const currentFormFieldCount = map.formFields.length;
let uiTransitionDetected = false;

if (previousFormFieldCount > 0) {
  const fieldIncrease = currentFormFieldCount - previousFormFieldCount;
  const percentIncrease = (fieldIncrease / previousFormFieldCount) * 100;
  
  // If fields increased by 5+ or doubled, UI transition occurred
  if (fieldIncrease >= 5 || percentIncrease > 100) {
    uiTransitionDetected = true;
    console.log(`[DOMMap] 🔄 UI transition detected: fields ${previousFormFieldCount} → ${currentFormFieldCount}`);
  }
}

previousFormFieldCount = currentFormFieldCount;
```

**Benefits:**
- Detects modal appearing
- Detects wizard step changes
- Detects drawer/side panel opening
- Detects SPA route changes

---

### Fix 3: Skip Stale Dropdown After UI Transition ✅

**File:** `src/content/dom-map.ts`

**Logic:**
```typescript
// Skip dropdown detection if UI transition just happened
if (!uiTransitionDetected) {
  const dropdown = findActiveDropdown();
  if (dropdown) {
    map.activeDropdown = dropdown;
  }
} else {
  console.log('[DOMMap] ⏭️ Skipping dropdown detection due to UI transition');
}
```

**Why This Works:**
- After modal appears (UI transition), old dropdown is irrelevant
- Prevents agent from getting stuck in dropdown loop
- Allows agent to focus on new modal content

---

### Fix 4: Include ID Attribute in Candidates ✅

**Files:** `src/lib/ai-agent.ts`, `supabase/functions/dom_agent/index.ts`

**Changes:**
1. Include `id` field when mapping candidates to send to LLM
2. Include `id` when mapping chosen candidate back to target
3. Show `id="xxx"` in candidate list displayed to LLM

**Example Candidate Display:**
```
0: [combobox] "Reason for Uber spend"
   id="auditId" placeholder="none" scope=[Promotion > Eats Promotion Creation Tool Ver 2.8] (score: 15)
```

---

### Fix 5: Enhanced Logging for Debugging ✅

**Added logs to track:**
- Number of candidates sent to LLM
- Top 3 candidates with their IDs
- Whether candidates are received by Edge Function
- Whether LLM returns chooseCandidateIndex
- Parsed response structure

**Example:**
```
[AIAgent] 📤 Candidates: 8 sent to LLM
[AIAgent] 📤 Top 3 candidates: [combobox] "Reason for Uber spend" id="auditId"
[dom_agent] Candidates received: 8
[parseGeminiResponse] Candidates in payload: 8
[parseGeminiResponse] Parsed response has chooseCandidateIndex: number
```

---

## Expected Behavior After Fix

### Before (Stuck):
```
1. Click BOGO option ✅
2. Modal appears (18 fields)
3. findActiveModal() returns null ❌
4. findActiveDropdown() finds stale dropdown ❌
5. Agent stuck in dropdown loop ❌
6. Looking for "Reason for Uber spend" in wrong scope ❌
```

### After (Working):
```
1. Click BOGO option ✅
2. Modal appears (18 fields)
3. UI transition detected (1 → 18 fields) ✅
4. findActiveModal() detects modal (score-based) ✅
5. Skip dropdown detection (UI transition) ✅
6. DOMMap returns ONLY modal content ✅
7. Find "Reason for Uber spend" in modal scope ✅
8. Use id="auditId" as locator strategy ✅
```

---

## Key Improvements

| Aspect | Before | After |
|--------|--------|-------|
| **Modal Detection** | Strict (zIndex>100 + role) | Score-based (7 signals, threshold 50) |
| **UI Transitions** | Not tracked | Field count monitoring |
| **Dropdown After Transition** | Still detected (stale) | Skipped for 1 observation |
| **ID Usage** | Not included in candidates | Sent to LLM and used in locators |
| **Debugging** | Minimal logging | Full candidate trace |

---

## Files Modified

| File | Change | Description |
|------|--------|-------------|
| `src/content/dom-map.ts` | 60 lines | Multi-signal modal detection, UI transition tracking |
| `src/lib/ai-agent.ts` | 10 lines | Include id/placeholder in candidates, add logging |
| `supabase/functions/dom_agent/index.ts` | 20 lines | Add RankedCandidate interface, include id, logging |

---

## Testing This Fix

1. **Reload extension** with new build
2. **Test the same workflow** (select BOGO, modal appears)
3. **Watch for these logs:**
   ```
   [DOMMap] 🔔 Modal detected with score 90: {zIndex: 1000, position: 'fixed', role: 'dialog', formFields: 18}
   [DOMMap] 🔄 UI transition detected: fields 1 → 18 (+17)
   [DOMMap] ⏭️ Skipping dropdown detection due to UI transition
   [AIAgent] 📤 Candidates: 8 sent to LLM
   [dom_agent] Candidates received: 8
   [parseGeminiResponse] Parsed response has chooseCandidateIndex: number
   ```

4. **Verify:**
   - Modal is detected immediately after BOGO click
   - No dropdown detected after UI transition
   - "Reason for Uber spend" is found (using id="auditId")
   - Agent progresses through all steps

---

## Root Cause (Conceptual)

This is fundamentally a **scope transition handling** issue:
- Agent operates in a scope (page, modal, drawer, wizard step)
- When UI transitions, scope must be re-evaluated
- Without proper scope tracking, agent operates in "stale world"

**This pattern applies to:**
- Modals/dialogs
- Side drawers
- Wizard steps
- SPA route changes (soft navigation)
- Accordion expansions
- Tab panel switches

**The fix generalizes:** UI transition detection + modal detection is the first implementation of a broader "scope transition" system.

---

## Next Steps If Still Failing

If the agent still gets stuck, check:

1. **Is modal actually detected?**
   - Look for `[DOMMap] 🔔 Modal detected with score X`
   - Check what score it got and why

2. **Are candidates being sent?**
   - Look for `[AIAgent] 📤 Candidates: X sent to LLM`
   - Check if X > 0

3. **Is LLM using candidates?**
   - Look for `chooseCandidateIndex` in raw Gemini response
   - If missing, prompt may need strengthening

4. **Is validation catching it?**
   - Should see error: "LLM must return chooseCandidateIndex when candidates are provided"
   - If not, validation logic has a bug


