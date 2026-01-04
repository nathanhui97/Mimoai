# Scroll Targeting & Fuzzy Widget Matching Fix

## Problems Identified

### Problem 1: Wrong Scroll Target ❌
**The workflow is scrolling to the wrong place!**

Your recorded workflow has 3 SCROLL steps, but they ALL target `"Demand Gen"`:

```json
"selector": "//div[descendant::*[contains(normalize-space(.), \"Demand Gen\")]]//div"
```

**But you need to scroll to:** `"RFO SPEND > 5% DROP WOW (STORE)107"` widget!

**Scroll descriptions in workflow:**
1. "Scroll to 'Pizza Depot (Windsor)' in 'STORES WITH MULTIPLE ACTIVE AD CAMPAIGNS' widget."
2. "Scroll to 'Pizza Depot (Windsor)' in 'STORES WITH MULTIPLE ACTIVE AD CAMPAIGNS' widget."
3. "Scroll down to view more brand entries in the lists."

**None of them scroll to make the "RFO SPEND" widget visible!**

---

### Problem 2: Widget Title Mismatch ❌
**The widget title has dynamic numbers!**

- **Recorded:** `"RFO SPEND > 5% DROP WOW (STORE)107"` 
- **Actual on page:** `"RFO SPEND > 5% DROP WOW (STORE)"` (no "107")

The "107" is a **dynamic count** that changes, so the exact match fails.

**Old logic:**
```typescript
if (text.includes(searchTitle))  
// "STORE" includes "STORE107"? ❌ NO!
```

---

## The Fix

### ✅ Enhanced Fuzzy Matching in Scope Resolver
**File:** `src/types/scope.ts`

Added **bidirectional fuzzy matching** with number stripping:

```typescript
// BIDIRECTIONAL fuzzy matching: handles dynamic numbers like "STORE107" vs "STORE"
if (title && (title.includes(searchTitle) || searchTitle.includes(title))) {
  console.log(`[Scope] ✅ Found widget "${titleEl?.textContent?.trim()}"`);
  return widget;
}

// Strip trailing numbers for even more fuzzy matching
const baseTitle = title.replace(/\d+$/g, '').trim();
const baseSearch = searchTitle.replace(/\d+$/g, '').trim();
if (baseTitle && baseSearch && baseTitle.length > 10 && 
    (baseTitle.includes(baseSearch) || baseSearch.includes(baseTitle))) {
  console.log(`[Scope] ✅ Found widget "${titleEl?.textContent?.trim()}" (fuzzy match without numbers)`);
  return widget;
}
```

**How it works:**
1. **Bidirectional check:** `"STORE"` includes `"STORE107"`? No. But `"STORE107"` includes `"STORE"`? Yes! ✅
2. **Number stripping:** If both strings are long enough (>10 chars), strip trailing numbers and compare again

**Now matches:**
- `"RFO SPEND > 5% DROP WOW (STORE)"` ✅ matches `"RFO SPEND > 5% DROP WOW (STORE)107"`
- `"Data Reminders 123"` ✅ matches `"Data Reminders"`
- `"Sales Report"` ✅ matches `"Sales Report 456"`

---

## What to Do Now

### Option 1: Re-record the Workflow (Recommended) 🎯
To fix the scroll targeting:

1. **Delete the current workflow**
2. **Record a NEW workflow:**
   - Start at the top of the page
   - **Scroll specifically to make "RFO SPEND > 5% DROP WOW (STORE)" widget visible**
   - Click "More Options" in that widget
   - Click "Download Data"
3. **The recorder will capture the correct scroll target**

### Option 2: Test With Manual Scroll (Quick Fix)
To test if fuzzy matching works:

1. **Reload the extension** at `chrome://extensions/`
2. **Manually scroll** to make the "RFO SPEND" widget visible
3. **Run the workflow**
4. It should now **find the widget** even with the number mismatch!

---

## Expected Behavior After Fix

### ✅ With Fuzzy Matching:
```
[Scope] ✅ Found widget "RFO SPEND > 5% DROP WOW (STORE)" (fuzzy match without numbers)
[Tier1] 🎯 Filtered to 1 inside scope "RFO SPEND > 5% DROP WOW (STORE)107"
[Tier1] ✅ Clicking element: BUTTON More Options
```

### ✅ With Correct Scroll (After Re-recording):
```
[AIAgent] ✅ Scroll completed
[Scope] ✅ Found widget "RFO SPEND > 5% DROP WOW (STORE)"
[Tier1] ✅ Clicking element: BUTTON More Options
```

---

## Root Cause Analysis

### Why did the scroll target get recorded wrong?
The scroll detection logic captured the **nearest visible heading** ("Demand Gen") instead of the **target widget** ("RFO SPEND") that you were scrolling TO. This is because:
- "Demand Gen" was visible while scrolling
- "RFO SPEND" widget loaded after the scroll completed
- The recorder didn't know your intent was to reach "RFO SPEND"

### Why do widget titles have numbers?
Dashboard widgets often show **dynamic counts** in their titles:
- "STORE - NO PROMO SPEND L28 DAYS**119**" (119 stores)
- "RFO SPEND > 5% DROP WOW (STORE)**107**" (107 stores)
- These numbers change as data updates!

The fuzzy matching now handles this automatically.

---

## Testing Instructions

1. **Reload extension** at `chrome://extensions/`
2. **Test Option 2 first** (manual scroll + run workflow)
3. **If it works**, re-record for automatic scrolling
4. **Verify** the new workflow has scroll steps targeting "RFO SPEND"

You should see these logs:
```
[Scope] ✅ Found widget "RFO SPEND > 5% DROP WOW (STORE)" (fuzzy match without numbers)
[AIAgent] 🎯 Pre-filtered to 8 elements in recorded scope
[Tier1] 🎯 Filtered to 1 inside scope
[Tier1] ✅ Clicking element: BUTTON More Options
```

## Date
January 3, 2026

