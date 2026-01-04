# Name Box Workflow Fix - Don't Intercept Name Box Actions

## Problem
When recording workflows using the Name Box method:
1. Click Name Box (id="t-name-box")
2. Type "B2" (to navigate to cell B2)
3. Press Enter
4. Type actual data "nathhui@gmail.com"

During replay:
- ❌ Name Box clicks were intercepted as `click_cell(B2)`
- ❌ Typing "B2" was intercepted as `type_in_cell(B2, "B2")`
- ❌ The Name Box navigation steps were completely skipped
- ❌ All data ended up in B2 (cells B2 and C2 content both in B2)

**Result**: 
- A2 was empty (should have "nathan")
- B2 had "928372" (should have "nathhui@gmail.com")
- C2 was empty (should have "928372")

---

## Root Cause

The spreadsheet interception was **too aggressive**:

```typescript
// OLD - Intercepted EVERYTHING with a cell reference aria-label
if (recordedAriaLabel && cellRefMatch) {
  // Convert click → click_cell
  // Convert type → type_in_cell
}
```

**Problem**: The Name Box element (id="t-name-box") displays the current cell in its aria-label (like "A2", "B2"). When you click it, the interception saw the cell reference and thought "this is clicking cell B2!" and converted it to `click_cell(B2)`, completely bypassing the Name Box interaction.

---

## Solution

Added two checks to **skip Name Box actions**:

### Check 1: Detect Name Box Element
```typescript
const isNameBox = currentHint?.recordedFallbackSelectors?.some(sel => 
  sel.includes('#t-name-box') || 
  sel.includes('name-box') ||
  sel.includes('[id="t-name-box"]')
);

if (isNameBox) {
  console.log(`⏭️ Skipping interception - this is a Name Box action`);
  return action; // Don't intercept - replay Name Box workflow as-is
}
```

### Check 2: Detect Cell Reference Typing
When typing text like "B2", "A2", "C2" - these are cell references being typed INTO the Name Box, not data:

```typescript
if (action.type === 'type' && action.params.text) {
  const typingCellRef = action.params.text.match(/^[A-Z]+\d+$/i);
  if (typingCellRef) {
    console.log(`⏭️ Skipping interception - typing cell reference "${action.params.text}"`);
    return action; // Let it type into Name Box
  }
}
```

---

## What Changed

**File**: `src/lib/ai-agent.ts` - Spreadsheet interception logic (lines ~1474-1505)

**Behavior**:
- ✅ Name Box clicks → **NOT intercepted** (replays as regular click)
- ✅ Typing "B2" into Name Box → **NOT intercepted** (replays as regular type)
- ✅ Typing data "nathhui@gmail.com" → **Intercepted** (converts to `type_in_cell`)

This allows both workflows to work:
1. **Name Box workflow**: Click Name Box → Type "B2" → Enter → Type data
2. **Direct cell click workflow**: Click cell B2 → Type data (gets intercepted to `type_in_cell`)

---

## Test Now

1. **Reload extension**: `chrome://extensions` → Reload Autoflow
2. **Refresh Google Sheets**: Cmd+Shift+R
3. **Execute your Name Box workflow**

**Watch for these logs**:
```
⏭️ Skipping interception - this is a Name Box action
⏭️ Skipping interception - typing cell reference "B2"
🚀 SPREADSHEET INTERCEPTION: Converting "type" → "type_in_cell"
✅ Converted to: type_in_cell(B2, "nathhui@gmail.com")
```

**Expected results in spreadsheet**:
- A2 should have "nathan"
- B2 should have "nathhui@gmail.com"
- C2 should have "928372"

---

## Why This Matters

Users should be able to record workflows ANY WAY they want:
- ✅ Name Box method (type cell ref in Name Box)
- ✅ Direct cell click method (click cells in grid)
- ✅ Tab navigation method (Tab between cells)
- ✅ Keyboard shortcuts method (Ctrl+G, arrow keys)

The system should **replay what was recorded**, not force one specific method. This fix ensures Name Box workflows work correctly while still providing the benefits of spreadsheet interception for direct cell clicks.

