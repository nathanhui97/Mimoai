# Dropdown Priority Fix - Dynamic Form Fields

**Date:** December 20, 2025  
**Issue:** Agent types into wrong field (combobox) instead of clicking dropdown option first

---

## The Real Problem

Your form has **dynamic fields** that only appear after selecting a promotion type:

```
Initial State:
- [combobox] "Select Promotion Type"
- (no other fields visible)

After Clicking Dropdown:
- [combobox] (now open)
- [option] "BOGO"
- [option] "FLAT"
- ... (still no budget fields)

After Clicking BOGO:
- [combobox] value="BOGO" (closed)
- [textbox] "Budget Amount" id="budgetAmount" ← NOW APPEARS
- [spinbutton] "Restaurant Funding" id="restFunding" ← NOW APPEARS
- ... (other BOGO-specific fields)
```

---

## What Was Happening

```
Step 0: Click dropdown ✅ (opens it, shows options)
Step 1: AI observes state
        - Sees: [combobox] (open), [option] "BOGO" (available)
        - Hint says: "Type 1000 in Budget Amount"
        - AI thinks: "I need to type 1000, let me find the budget field"
        - Doesn't see budget field (doesn't exist yet!)
        - Types into focused element (the combobox!) ← WRONG
Step 2: Dropdown closes (because typing in it selects/filters)
Step 3: Try to click BOGO ❌ (dropdown closed, option doesn't exist)
```

---

## The Fixes

### Fix 1: Prioritize Dropdown Options in Prompt

**File:** [`supabase/functions/dom_agent/index.ts`](supabase/functions/dom_agent/index.ts)

```
CRITICAL RULES (IN PRIORITY ORDER):
1. DROPDOWN OPEN? If you see [option] or [listbox] in the DOM map:
   🚨 STOP EVERYTHING - Click the option IMMEDIATELY
   - Do NOT type into fields while dropdown is open
   - Do NOT follow hints linearly
   - Once option is clicked, fields will appear
   
2. ADAPTIVE BEHAVIOR:
   - If fields don't exist yet, they may appear after selecting dropdown option
   - The hints are a GUIDE, not strict order - adapt to current page state
```

### Fix 2: Form Field Visibility Logging

**File:** [`src/content/dom-map.ts`](src/content/dom-map.ts)

Added detailed logging:
```typescript
console.log(`[DOMMap] getFormFields found ${candidates.length} candidates`);
// For each candidate, log if skipped:
if (!isVisible(el)) {
  console.log(`[DOMMap] ⏭️ Skipping invisible field:`, tag, role);
  continue;
}
```

This will show us:
- Which fields are found
- Which are being filtered out
- Why they're filtered

### Fix 3: Empty Selector Safety

**File:** [`src/content/candidate-finder.ts`](src/content/candidate-finder.ts)

```typescript
private static getTagHints(tagName: string): string[] {
  // Safety check: if tagName is empty, return empty array (will use '*')
  if (!tagName || tagName.trim() === '') {
    return [];
  }
  // ...
}
```

---

## What Should Happen Now

### Correct Flow:
```
Step 0: Click dropdown ✅ (opens it)
Step 1: AI observes: [option] "BOGO" visible
        AI thinks: "🚨 DROPDOWN OPEN! I must click BOGO immediately"
        AI returns: {"action": "click", "target": {"role": "option", "text": "BOGO"}}
Step 2: Click BOGO ✅
        → Form loads BOGO-specific fields:
          [textbox] "Budget Amount" id="budgetAmount"
          [spinbutton] "Restaurant Funding" id="restFunding"
Step 3: AI observes: budget field now exists
        AI types: "1000" into Budget Amount ✅
Step 4: Type "100" into Restaurant Funding ✅
Step 5: Continue...
```

---

## Build Status

✅ **Build successful**  
⚠️ **Redeploy Edge Function required** - Prompt updated with dropdown priority

---

## Deploy and Test

### 1. Redeploy Edge Function
```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"
supabase functions deploy dom_agent
```

### 2. Reload Extension
Chrome extensions → Reload

### 3. Test Workflow

Watch for:
```
[AIAgent] 📤 Hints status: 0:✅ 1:⬜ 2:⬜ ...
[AIAgent] DOM map preview: ... [option] "BOGO" ...
[AIAgent] Response: {"action": "click", "target": {"role": "option", "text": "BOGO"}}  ← Should see this!
[Tier1] ✅ Clicking element: LI BOGO
```

Then after BOGO is clicked:
```
[DOMMap] getFormFields found 5 candidates
[DOMMap] ✅ Form field: [textbox] "Budget Amount" id="budgetAmount"
[DOMMap] ✅ Form field: [spinbutton] "Restaurant Funding" id="restFunding"
```

The new diagnostic logs will show exactly which fields exist at each step, helping debug dynamic form loading.

---

## Key Insight

Your form uses **conditional field rendering** - fields only appear after selecting the promotion type. The AI must:
1. Recognize this pattern
2. Click dropdown option BEFORE trying to fill fields
3. Adapt to the dynamic field loading

The updated prompt teaches the AI this pattern explicitly.



