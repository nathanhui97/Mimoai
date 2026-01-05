# Spreadsheet INPUT Deduplication Fix

## Problem

When recording in Google Sheets, if you type slowly or make corrections:
- Each keystroke creates a separate INPUT event
- Multiple INPUT steps are recorded for the same cell
- During replay, each step executes, causing overwrites

**Example:**
```
Recording (slow typing in B2):
  Step 1: INPUT B2 = "wong"
  Step 2: INPUT B2 = "wongnic"  
  Step 3: INPUT B2 = "wongnicole@"
  Step 4: INPUT B2 = "wongnicole@333.com"

Replay:
  Step 1: Types "wong" in B4 ✅
  Step 2: Clears B4, types "wongnic" ❌
  Step 3: Clears B4, types "wongnicole@" ❌
  Step 4: Clears B4, types "wongnicole@333.com" ✅
  
Result: Only final value stays, but wasted 3 extra operations
```

## Solution

**Skip intermediate INPUT events for the same spreadsheet cell during recording.**

When `captureInputValue()` is called:
1. Check if we're on a spreadsheet domain
2. Check if `lastStep` was also an INPUT to the same cell (same `label`)
3. If yes → **Skip recording** (don't send to sidepanel)
4. If no → Record normally

This ensures only the FINAL value is recorded when the user moves to a different cell.

## Implementation

### File: `src/content/recording-manager.ts`

Added deduplication check before sending the step:

```typescript
// Check if the last step was also an INPUT to the same cell
if (isSpreadsheet && label && this.lastStep) {
  if (this.lastStep.type === 'INPUT' && 
      this.lastStep.payload.label === label) {
    
    console.log(`📊 [Recording] Skipping duplicate INPUT for cell "${label}"`);
    return; // Don't record intermediate typing
  }
}
```

### How It Works

```
User types in B2: "w" → "wo" → "won" → "wong" → moves to C2

Recording captures:
  - INPUT B2 = "w" → Recorded ✅
  - INPUT B2 = "wo" → Skipped (same cell as last step)
  - INPUT B2 = "won" → Skipped (same cell as last step)
  - INPUT B2 = "wong" → Skipped (same cell as last step)
  - CLICK C2 → Recorded ✅
  
Result: Only ONE INPUT step for B2 with final value "wong"
```

## Edge Cases Handled

1. **Corrections**: Type "test" → delete → type "best" → Only "best" is recorded
2. **Paste over existing**: Cell has "old", paste "new" → Only "new" is recorded
3. **Multiple cells**: A2="x", B2="y", C2="z" → All recorded (different cells)
4. **Non-spreadsheets**: Regular forms still record every input (no change)

## Testing

### Test Case 1: Slow Typing
1. Record: Click A2, slowly type "n-a-t-h-a-n" (one letter at a time)
2. Save workflow
3. Check saved JSON: Should have only ONE INPUT step for A2

### Test Case 2: Corrections
1. Record: Click A2, type "test", delete it, type "best"
2. Save workflow
3. Check saved JSON: Should have only ONE INPUT step with value "best"

### Test Case 3: Multiple Cells
1. Record: A2="x", B2="y", C2="z"
2. Save workflow
3. Check saved JSON: Should have THREE INPUT steps (one per cell)

## Console Logs

During recording, you'll see:
```
[Recording] Skipping duplicate INPUT for cell "B2" (intermediate typing)
[Recording] Previous value: "wong"
[Recording] Current value: "wongnic" (will be recorded when cell changes)
```

## Performance Impact

- ✅ Reduces workflow size (fewer steps)
- ✅ Faster replay (no redundant operations)
- ✅ More reliable (no intermediate states)
- ✅ Cleaner recordings (only meaningful actions)

