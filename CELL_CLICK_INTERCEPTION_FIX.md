# Cell Click Interception Fix

## Problem
When replaying Name Box workflows, cells B2 and C2 content was being typed into the wrong cells because:

1. **Clicks on cells weren't actually selecting them**:
   - The tier1-executor would click a DIV with `aria-label="B2"`
   - But Google Sheets wouldn't register this as selecting that cell
   - Active cell remained on the previous cell

2. **Type interception was working, but click interception wasn't**:
   - Type actions were being intercepted and converted to `type_in_cell(B2)` ✅
   - But click actions weren't being intercepted ❌
   - This caused cells to be typed into without being clicked first

## Root Cause
The click interception code existed but wasn't triggering because:

```typescript
// OLD - Only checked direct recordedAriaLabel
const recordedAriaLabel = currentHint?.recordedAriaLabel;
```

**Problem**: For clicks, `recordedAriaLabel` is often not set directly. Instead, it's captured in **fallback selectors** like:
```
['[aria-label="B2"]', '[aria-label="Cell B2"]']
```

## Solution
Extract aria-label from fallback selectors when direct `recordedAriaLabel` isn't available:

```typescript
// NEW - Also check fallback selectors
let recordedAriaLabel = currentHint?.recordedAriaLabel;

if (!recordedAriaLabel && currentHint?.recordedFallbackSelectors) {
  for (const selector of currentHint.recordedFallbackSelectors) {
    const ariaLabelMatch = selector.match(/\[aria-label=["']([^"']+)["']\]/i);
    if (ariaLabelMatch) {
      recordedAriaLabel = ariaLabelMatch[1];  // Extract "B2" from [aria-label="B2"]
      console.log(`[AIAgent] 📊 Extracted aria-label from fallback selector: "${recordedAriaLabel}"`);
      break;
    }
  }
}
```

**Benefits**:
- ✅ Clicks on cells B2, C2, etc. now trigger interception
- ✅ Converted to `click_cell(B2)` which uses SpreadsheetExecutor
- ✅ Cells are properly selected before typing
- ✅ Content goes into correct cells

---

## What Changed
- **File**: `src/lib/ai-agent.ts` - Spreadsheet interception logic
- **Change**: Extract aria-label from fallback selectors (lines ~1461-1471)
- **Impact**: Click actions on spreadsheet cells now properly intercepted

---

## Test Instructions

1. **Reload extension**: `chrome://extensions` → Reload Autoflow
2. **Refresh Google Sheets**: Cmd+Shift+R
3. **Execute your Name Box workflow**

**Expected behavior**:
- Console shows: `📊 Extracted aria-label from fallback selector: "B2"`
- Console shows: `✅ Converted to: click_cell(B2)`
- Cells B2 and C2 are properly clicked before typing
- Content goes into correct cells

**Check results in spreadsheet**:
- A2 should have "nathan"
- B2 should have "nathhui@gmail.com"  
- C2 should have "928372"

---

## Why Name Box Workflows Need This

When you record a workflow using Name Box:
1. Click Name Box → type "A2" → Enter (navigates to A2)
2. Type "nathan" into A2
3. Click Name Box → type "B2" → Enter (navigates to B2)  
4. Type "nathhui@gmail.com" into B2

The **clicks** on cells (or clicks to select Name Box entries) have `aria-label` in fallback selectors, but not in the direct `recordedAriaLabel` field. This fix ensures those clicks are properly intercepted and converted to `click_cell()` actions that use the SpreadsheetExecutor's reliable navigation.

