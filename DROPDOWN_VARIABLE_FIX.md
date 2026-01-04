# Dropdown Variable Detection Fix - v0.4.4

## Problem

When recording a workflow that includes dropdown selection (e.g., "Select Promotion Type" → "BOGO"), the variable detection system was showing the wrong value in the variable input form:

**Expected:** "BOGO" (the selected option)
**Actual:** "Select\ Promotion\ Type" (the dropdown trigger text with backslash escaping)

## Root Cause

The variable detector was incorrectly identifying dropdown **triggers** as variables instead of only detecting dropdown **options**.

### The Flow:
1. User clicks "Select Promotion Type" dropdown trigger (Step 1)
2. User clicks "BOGO" option (Step 2)
3. Variable detector analyzed **both steps** and incorrectly used Step 1's text as the default value

### Why This Happened:

1. **Overly broad `isSelectableOption()` check** - The function was checking if the selector contains "select" or "option", which matched the trigger button text "Select Promotion Type"

2. **Missing role-based filtering** - Dropdown triggers typically have `role="button"` or `role="combobox"`, but the code wasn't filtering these out

3. **No fallback to elementText** - For dropdown options without explicit `value` or `decisionSpace.selectedText`, the code didn't fall back to using the element's text content

## Solution

### File: `src/lib/variable-detector.ts`

#### 1. Enhanced `isSelectableOption()` to exclude triggers (Lines 314-376)

```typescript
private static isSelectableOption(payload: WorkflowStepPayload): boolean {
  const role = (payload.elementRole || '').toLowerCase();
  
  // CRITICAL FIX: Exclude dropdown TRIGGERS (only include dropdown OPTIONS)
  if (role === 'button' || role === 'combobox') {
    console.log(`[VariableDetector] Excluding dropdown trigger with role="${role}"`);
    return false;
  }
  
  // Check if element has a selectable role (option, radio, checkbox, etc.)
  if (SELECTABLE_ROLES.includes(role)) {
    return true;
  }
  
  // Only count as selectable if it's an OPTION, not just contains "select"
  if (selector.includes('role="option"') || selector.includes("role='option'")) {
    return true;
  }
  
  // ... additional checks with trigger filtering
}
```

**Key changes:**
- Added explicit check to exclude `role="button"` and `role="combobox"` (dropdown triggers)
- Changed selector check from `includes('select')` to `includes('role="option"')` to only match actual options
- Added additional validation to prevent trigger text from being detected

#### 2. Added elementText fallback for dropdown values (Lines 464-482)

```typescript
// Extract value - try multiple sources
let extractedValue = payload.value || payload.context?.decisionSpace?.selectedText;

// For dropdown options without value, try to extract from selector
if (!extractedValue && isDropdown && payload.selector) {
  const valueMatch = payload.selector.match(/contains\([^,]+,\s*['"]([^'"]+)['"]\)/);
  if (valueMatch && valueMatch[1]) {
    extractedValue = valueMatch[1];
  }
}

// If still no value for dropdown CLICK steps, use elementText as final fallback
// This is the text of the option that was clicked (e.g., "BOGO")
if (!extractedValue && isDropdown && step.type === 'CLICK') {
  extractedValue = payload.elementText || '';
  console.log(`[VariableDetector] Using elementText as value for dropdown CLICK step`);
}
```

**Key changes:**
- Added fallback to use `payload.elementText` when no other value source is available
- This ensures dropdown option text is always captured correctly

## Testing

### Before Fix:
```
Variable Input Form shows:
- Promotion Type: "Select\ Promotion\ Type" ❌ (trigger text with escape chars)
- Budget Amount: "1000" ✓
```

### After Fix:
```
Variable Input Form should show:
- Promotion Type: "BOGO" ✓ (selected option text)
- Budget Amount: "1000" ✓
```

### Test Steps:

1. **Reload extension** (v0.4.4)
2. **Navigate to Uber Promotion Tool**
3. **Record new workflow:**
   - Click "Select Promotion Type" dropdown
   - Click "BOGO" option
   - Enter "1000" in Budget Amount
   - Stop recording
4. **Execute workflow** and check variable input form:
   - Should show "BOGO" (not "Select\ Promotion\ Type")
   - Should show "1000"

## Technical Details

### Dropdown Detection Logic

**Trigger (Should NOT be variable):**
- `role="button"` or `role="combobox"`
- Text like "Select ...", "Choose ...", etc.
- Opens dropdown menu when clicked

**Option (SHOULD be variable):**
- `role="option"` 
- Inside `[role="listbox"]` or `[role="menu"]`
- Text is the actual value to use (e.g., "BOGO", "FLAT", etc.)

### Value Extraction Priority

For dropdown CLICK steps:
1. `payload.value` (if explicitly set)
2. `payload.context.decisionSpace.selectedText` (from decision space tracking)
3. Extract from selector regex: `/contains(..., 'VALUE')/`
4. **NEW:** `payload.elementText` (fallback to element's text content)

## Files Changed

- `src/lib/variable-detector.ts` (Lines 314-376, 464-482)
- `public/manifest.json` (version bump to 0.4.4)

## Impact

- Fixes dropdown variable default values to show selected option text
- Prevents dropdown triggers from being detected as variables
- Improves user experience by showing correct default values in variable input form
- No breaking changes to existing workflows (only affects new recordings)








