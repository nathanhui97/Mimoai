# Scope Filtering Fix - Exact Widget Targeting

## Problem
The AI was clicking the wrong "More Options" button because:
1. All "More Options" buttons across different widgets had the same aria-label
2. All 15 candidates got identical scores (145 points each)
3. The AI picked the first candidate, which was from the wrong widget ("Data Reminders" instead of "RFO SPEND > 5% DROP WOW (STORE)107")
4. The system would fall back to any widget if the recorded scope wasn't found

## Solution: Three-Layer Defense

### 1. **Pre-Filter Candidates by Scope** (AI Agent Layer)
**File:** `src/lib/ai-agent.ts`

Before scoring candidates, filter to ONLY elements inside the recorded widget:

```typescript
// 🎯 PRE-FILTER: If we have a recorded scope hint, only consider elements in that widget
let candidatePool = allElements;
if (hint.recordedScopeHint) {
  const scopeHint = hint.recordedScopeHint.toLowerCase();
  const inScope = allElements.filter(el => {
    // Check widgetTitle (exact match or contains)
    if (el.widgetTitle && el.widgetTitle.toLowerCase().includes(scopeHint)) {
      return true;
    }
    // Check scopePath (element's container hierarchy)
    if (el.scopePath?.some(s => s.toLowerCase().includes(scopeHint))) {
      return true;
    }
    // Fuzzy match for titles with dynamic numbers (e.g., "STORE...119" vs "STORE...")
    if (el.widgetTitle) {
      const baseScope = scopeHint.replace(/\d+$/g, '').trim();
      const baseWidget = el.widgetTitle.toLowerCase().replace(/\d+$/g, '').trim();
      if (baseScope.length > 10 && baseWidget.includes(baseScope)) {
        return true;
      }
    }
    return false;
  });
  
  if (inScope.length > 0) {
    candidatePool = inScope;
    console.log(`[AIAgent] 🎯 Pre-filtered to ${inScope.length} elements in recorded scope "${hint.recordedScopeHint}" (from ${allElements.length} total)`);
  }
}
```

**Result:** The AI now only sees candidates from the correct widget, eliminating ambiguity.

### 2. **Prioritize Recorded Scope Over Candidate's Widget** (AI Agent Layer)
**File:** `src/lib/ai-agent.ts` (line 960)

Always use the recorded scope hint from the workflow, not the candidate's widget:

```typescript
// BEFORE (wrong):
scopeHint: resolvedTarget.scopeHint || scopeHintFromHint

// AFTER (fixed):
scopeHint: scopeHintFromHint || resolvedTarget.scopeHint
```

**Result:** Even if the AI picks the wrong candidate, the recorded scope overrides it.

### 3. **Fail Safely When Scope Not Found** (Tier1 Layer)
**File:** `src/lib/tier1-executor.ts` (line 1235-1246)

If the recorded scope container is not found, fail instead of clicking any element:

```typescript
if (inScope.length > 0) {
  scopeFiltered = inScope;
  console.log(`[Tier1] 🎯 Filtered to ${inScope.length} inside scope "${bundle.scopeHint}"`);
} else {
  // FAIL SAFELY: Don't click on wrong widget!
  console.error(`[Tier1] ❌ CRITICAL: No candidates found in recorded scope "${bundle.scopeHint}"`);
  console.error(`[Tier1] ❌ Refusing to proceed - element may be in wrong widget/container`);
  console.error(`[Tier1] 💡 Suggestion: Scroll to make the widget visible, or re-record the workflow`);
  return null; // Fail - let upstream handle the error
}
```

**Result:** The system will never click on the wrong widget. If it can't find the right one, it fails with a clear error.

## Expected Behavior

### ✅ Success Path
1. User records workflow with "More Options" in "RFO SPEND > 5% DROP WOW (STORE)107"
2. AI agent pre-filters to only elements inside that widget
3. AI picks the right "More Options" button (only option now!)
4. Tier1 verifies it's in the correct scope and clicks it

### ❌ Failure Path (Safe)
1. User scrolls but widget is not visible yet
2. AI agent can't find elements in that widget
3. Logs warning: "No elements found in recorded scope"
4. Tier1 verification fails: "No candidates found in recorded scope"
5. Workflow stops with error: "please scroll to widget or re-record"

## Logs to Watch For

**Success:**
```
[AIAgent] 🎯 Pre-filtered to 3 elements in recorded scope "RFO SPEND > 5% DROP WOW (STORE)107" (from 461 total)
[AIAgent] 📌 Using RECORDED scope hint: "RFO SPEND > 5% DROP WOW (STORE)107"
[Tier1] 🎯 Filtered to 1 inside scope "RFO SPEND > 5% DROP WOW (STORE)107"
[Tier1] ✅ Clicking element: BUTTON More Options
```

**Safe Failure:**
```
[AIAgent] ⚠️ No elements found in recorded scope "RFO SPEND > 5% DROP WOW (STORE)107" - element may not be visible yet
[Tier1] ❌ CRITICAL: No candidates found in recorded scope "RFO SPEND > 5% DROP WOW (STORE)107"
[Tier1] ❌ Refusing to proceed - element may be in wrong widget/container
```

## Testing Instructions

1. **Reload the extension** at `chrome://extensions/`
2. **Import the workflow** `/Users/nathhui/Downloads/ghostwriter-workflow-1767496754631.json`
3. **Run it** and watch the logs

The system should now:
- ✅ Scroll to the correct widget
- ✅ Find only the "More Options" button in "RFO SPEND > 5% DROP WOW (STORE)107"
- ✅ Click it and then click "Download Data"
- ✅ Download from the CORRECT widget

## Benefits

1. **Eliminates ambiguity**: AI only sees candidates from the correct widget
2. **Safety net**: Even if AI picks wrong, recorded scope overrides it
3. **Fail safely**: Never downloads from the wrong widget
4. **Clear errors**: User knows exactly what went wrong and how to fix it

## Date
January 3, 2026

