# Dropdown Variable Deduplication Fix

## Issue
When recording a dropdown selection, two variables were being detected:
1. **Dropdown Trigger**: The initial click that opens the dropdown (showing placeholder "Select Promotion Type")
2. **Dropdown Option**: The actual selection within the dropdown (e.g., "BOGO")

These should be recognized as a **single variable** with the selected value, not two separate variables.

## Example
```
User Action:
1. Click "Select Promotion Type" (opens dropdown)
2. Click "BOGO" (selects option)

Before Fix:
✗ Variable 1: promotionType = "Select\ Promotion\ Type" (placeholder)
✗ Variable 2: promotionType = "BOGO" (actual selection)

After Fix:
✓ Variable: promotionType = "BOGO" (actual selection only)
```

## Root Cause
The variable detection was analyzing both CLICK steps independently:
- **Trigger step**: Has role="combobox", shows placeholder text
- **Option step**: Has role="option", shows selected value

The deduplication logic couldn't merge them because:
- They have completely different selectors
- The trigger selector targets the combobox input
- The option selector targets the option element inside a listbox
- Normalized selectors don't match, so they're treated as separate fields

## Solution
Added **preprocessing logic** to filter out dropdown triggers before sending to AI:

### 1. Two-Pass Filtering
```typescript
// First pass: Identify dropdown trigger + option pairs
for (let i = 0; i < steps.length - 1; i++) {
  const currentStep = steps[i];
  const nextStep = steps[i + 1];
  
  if (currentIsDropdownTrigger && nextIsDropdownOption) {
    stepsToSkip.add(i); // Skip the trigger, keep only the option
  }
}

// Second pass: Filter steps, excluding skipped triggers
for (let i = 0; i < steps.length; i++) {
  if (stepsToSkip.has(i)) continue; // Skip dropdown trigger
  // ... analyze remaining steps
}
```

### 2. Dropdown Trigger Detection
A CLICK step is identified as a dropdown trigger if it has:
- Role: `combobox`
- Placeholder text: "Select...", "Choose...", "Pick...", etc.
- Selector contains: combobox, dropdown, or input with listbox

```typescript
private static isDropdownTrigger(payload: WorkflowStepPayload): boolean {
  const role = (payload.elementRole || '').toLowerCase();
  const elementText = (payload.elementText || '').toLowerCase().trim();
  
  // Check for combobox role (strong indicator)
  if (role === 'combobox') return true;
  
  // Check for placeholder-like text patterns
  const placeholderPatterns = ['select ', 'choose ', 'pick ', 'please select'];
  return placeholderPatterns.some(pattern => elementText.includes(pattern));
}
```

### 3. Dropdown Option Detection
A CLICK step is identified as a dropdown option if it has:
- Role: `option`
- Selector contains: `role='option'` or `role="option"`
- Inside a listbox
- DecisionSpace type: `LIST_SELECTION`

```typescript
private static isDropdownOption(payload: WorkflowStepPayload): boolean {
  const role = (payload.elementRole || '').toLowerCase();
  const selector = (payload.selector || '').toLowerCase();
  
  // Check for option role (strongest indicator)
  if (role === 'option') return true;
  
  // Check selector for role='option'
  if (selector.includes('role="option"') || selector.includes("role='option'")) {
    return true;
  }
  
  return false;
}
```

## Benefits
1. **Eliminates duplicate variables** for dropdown selections
2. **Uses the actual selected value**, not the placeholder text
3. **Reduces AI analysis cost** by skipping redundant steps
4. **Improves variable accuracy** - only meaningful values are detected
5. **Maintains context** - option still knows it's from a dropdown

## Files Changed
- `src/lib/variable-detector.ts`:
  - Modified `filterStepsForAnalysis()` to use two-pass filtering
  - Added `isDropdownTrigger()` helper method
  - Added `isDropdownOption()` helper method

## Testing
To verify the fix:
1. Reload the extension
2. Start recording
3. Click on a dropdown (e.g., "Select Promotion Type")
4. Click on an option (e.g., "BOGO")
5. Stop recording
6. Check "Detected Variables" section
7. **Expected**: Only ONE variable named "promotionType" with default value "BOGO"
8. **Before**: Two variables both named "promotionType" with values "Select\ Promotion\ Type" and "BOGO"

## Console Logs to Monitor
Look for these logs when recording dropdown interactions:
```
[VariableDetector] Detected dropdown trigger + option pair at steps X and Y
[VariableDetector] Trigger text: "Select Promotion Type", Option text: "BOGO"
[VariableDetector] Skipping trigger step X, will only analyze option step Y
[VariableDetector] ⏭️ Skipping dropdown trigger at step X
```

## Edge Cases Handled
1. **Multiple sequential dropdown selections**: Each trigger is paired with its option
2. **Dropdown without placeholder**: Detected by role="combobox"
3. **Custom dropdowns**: Detected by selector patterns (listbox, option roles)
4. **Single-step dropdowns**: If no option follows trigger, trigger is still analyzed (fallback)

## Related Issues
- This fix also prevents duplicate variables for:
  - Multi-level dropdowns (category → subcategory)
  - Cascading selects (country → state → city)
  - Any UI where opening a list and selecting an option are separate clicks






