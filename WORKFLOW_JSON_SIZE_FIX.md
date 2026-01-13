# Workflow JSON Size Reduction - Complete

## Problem

Workflow JSON files were 2.93MB for just 8 steps due to duplicate data:
- `steps` array: 1.5MB (49.4%)
- `optimizedSteps` array: 1.5MB (49.4%) - **100% identical to steps**

This duplication occurred because the navigation optimizer was disabled, but the code still created an `optimizedSteps` array set to the same value as `steps`.

## Root Cause

In `src/sidepanel/App.tsx` around line 1047-1171:

```typescript
// When optimizer is disabled:
const optimizationResult = {
  optimizedSteps: sortedSteps,  // Same as original steps!
  metadata: {
    stepsRemoved: 0,
    // ...
  }
};

// Then when saving:
optimizedSteps: optimizationResult.metadata.stepsRemoved > 0 
  ? optimizationResult.optimizedSteps 
  : stepsWithTranslations,  // Still sets optimizedSteps even when no optimization!
```

## Solution

Changed the save logic to only include `optimizedSteps` when actual optimization occurred:

```typescript
optimizedSteps: optimizationResult.metadata.stepsRemoved > 0 
  ? optimizationResult.optimizedSteps 
  : undefined,  // Don't include if no optimization happened
```

## Impact

### File Size Reduction
- **Before**: 2.93MB (1.5MB steps + 1.5MB optimizedSteps + 50KB other)
- **After**: ~1.5MB (1.5MB steps + 50KB other)
- **Savings**: 49% reduction (1.43MB saved)

### Backward Compatibility
✅ **Fully backward compatible**
- Old workflows with both `steps` and `optimizedSteps` will continue to work
- Code that uses `workflow.optimizedSteps || workflow.steps` fallback pattern still works
- New workflows will only have `optimizedSteps` if optimization actually occurred

### Code Behavior
- **ReplayerView**: Uses `workflow.optimizedSteps || workflow.steps` - will use `steps` when no optimization
- **AI Agent (hint-extractor)**: Always uses `workflow.steps` - continues to work
- **All other code**: Either uses `steps` directly or falls back to it - no breaking changes

## Files Modified

1. **src/sidepanel/App.tsx** (line 1169)
   - Changed `optimizedSteps` to be `undefined` when no optimization occurred

2. **src/types/workflow.ts** (line 476, 483)
   - Added comments clarifying that `steps` is required and `optimizedSteps` is only set when optimization occurred

## Testing

To verify the fix works:

1. Record a new workflow
2. Save it
3. Export/download the JSON
4. Check that `optimizedSteps` field is NOT present (or only present if actual optimization occurred)

## Visual Data Untouched

✅ All visual snapshot data remains unchanged:
- `visualSnapshot.viewport`
- `visualSnapshot.elementSnippet`
- `visualSnapshot.annotated`
- `visualSnapshot.annotatedSnippet`

No changes were made to any screenshot/visual data as requested.
