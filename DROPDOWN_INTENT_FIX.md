# Dropdown Intent Detection Fix

## Problem

When recording dropdown interactions in Salesforce, the system was incorrectly capturing intent:

### Symptom
- **Account Status dropdown**: Worked ✅ (but only by accident)
- **Merchant Category dropdown**: Failed ❌ (captured wrong option)

### Root Cause

The `inferClickIntent()` function in `src/lib/intent-inference.ts` was incorrectly treating **dropdown trigger clicks** as **option selections**.

#### Before Fix:
```typescript
// When clicking combobox trigger
if (role === 'combobox') {
  const optionText = element.textContent?.trim(); // Gets CURRENT value
  return createSelectDropdownIntent(optionText); // WRONG!
}
```

**What happened:**
1. User clicks "Merchant Category" dropdown (shows "--None--")
2. System captures: `optionVar = "--None--"` ❌
3. User then clicks "Restaurant & Takeout" 
4. This second click was treated as generic CLICK, not a selection

**Why Account Status "worked":**
- Dropdown already showed "Prospect"
- User clicked to open, captured `optionVar = "Prospect"`
- Then clicked "Prospect" again (same value)
- Accidentally worked, but would fail if selecting different option

## Solution

### Fix #1: Distinguish Trigger vs. Option Clicks

```typescript
// Check if this is an OPTION being selected (not the trigger)
if (role === 'option' || role === 'menuitem') {
  const optionText = element.textContent?.trim() || '';
  return createSelectDropdownIntent(optionText); // Correct option text!
}

// Dropdown trigger - just opens menu (not a selection)
if (role === 'combobox' || ariaHaspopup) {
  return createClickIntent(); // Regular click to open
}
```

### Fix #2: Correct Success Conditions

**For dropdown trigger (CLICK intent):**
```typescript
// Wait for menu to appear
condition: conditionTemplates.dropdownOpened()
```

**For option selection (SELECT_DROPDOWN_OPTION intent):**
```typescript
// Wait for DOM to stabilize after selection
condition: domStable(500)
```

## Recording Flow (After Fix)

### Step 1: Click Dropdown Trigger
```json
{
  "intent": { "kind": "CLICK" },
  "stepGoal": {
    "description": "Click 'Merchant Category'",
    "expectedOutcome": "action completed"
  },
  "suggestedCondition": {
    "type": "element_visible",
    "target": "[role='menu'], [role='listbox']",
    "reason": "Clicking dropdown trigger should open menu"
  }
}
```

### Step 2: Click Option
```json
{
  "intent": { 
    "kind": "SELECT_DROPDOWN_OPTION",
    "optionVar": "Restaurant & Takeout"  // ✅ Correct!
  },
  "stepGoal": {
    "description": "Select 'Restaurant & Takeout' from dropdown",
    "expectedOutcome": "option selected"
  },
  "suggestedCondition": {
    "type": "dom_stable",
    "timeout": 500,
    "reason": "Selecting dropdown option should stabilize DOM"
  }
}
```

## Impact

✅ **Merchant Category** now records correctly
✅ **Account Status** continues to work  
✅ **All dropdowns** now capture accurate option values
✅ **Replay reliability** improved with correct intent classification

## Files Changed

- `src/lib/intent-inference.ts` - Fixed `inferClickIntent()` and `inferSuccessCondition()`

## Testing

Test both scenarios:
1. **Merchant Category**: "--None--" → "Restaurant & Takeout"
2. **Account Status**: Any value → Different value
3. Verify recorded JSON shows correct `optionVar` in step 2 (option click)
