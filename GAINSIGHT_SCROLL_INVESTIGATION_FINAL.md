# Gainsight Scroll Investigation - Final Report

**Date**: January 7, 2026  
**Status**: ✅ ALL TECHNICAL ISSUES FIXED + 🔍 DIAGNOSTIC LOGGING ADDED

## Summary of All Fixes Applied

### Fix 1: Shadow Host Selector - Remove Dynamic Angular Classes
**File**: `src/content/shadow-dom-utils.ts`

**Problem**: Selectors like `gs-report-widget-element.ng-star-inserted` failed because `.ng-star-inserted` is dynamically added by Angular.

**Solution**: Custom elements now use tag name only:
```typescript
if (tagName.includes('-')) {
  return tagName;  // "gs-report-widget-element" instead of "gs-report-widget-element.ng-star-inserted"
}
```

### Fix 2: Shadow Host Selector Normalization at Execution
**Files**: `src/lib/ai-agent.ts`, `src/lib/tier1-executor.ts`

**Problem**: Even if recorded with dynamic classes, execution failed.

**Solution**: Strip dynamic classes at execution time:
```typescript
private normalizeShadowHostSelector(selector: string): string {
  // Remove .ng-*, .react-*, .vue-*, .css-*, etc.
  return normalized;
}
```

### Fix 3: Conditional scrollIntoView - Prevent Scrolling Past Target
**Files**: `src/lib/ai-agent.ts`, `src/lib/tier1-executor.ts`

**Problem**: Every click called `scrollIntoView({ block: 'center' })`, scrolling the page past the widget.

**Solution**: Only scroll if element is NOT in viewport AND NOT in shadow DOM:
```typescript
const isInShadowDOM = element.getRootNode() instanceof ShadowRoot;
const isInViewport = (/* check bounds */);

if (!isInShadowDOM && !isInViewport) {
  element.scrollIntoView({ block: 'center' });
} else if (isInShadowDOM) {
  console.log('Element in shadow DOM - NEVER scroll page');
}
```

**This was the KEY fix** - buttons inside shadow roots should never trigger page scrolls!

### Fix 4: Diagnostic Logging - Show All Widgets After Scroll
**Files**: `src/lib/ai-agent.ts`, `src/types/scope.ts`

**Problem**: No visibility into what widgets are actually on the page after scrolling.

**Solution**: Added `findAllWidgetTitles()` function and logging:
```typescript
const visibleWidgets = findAllWidgetTitles(document);
console.log(`[AIAgent] 🔍 Found ${visibleWidgets.length} widgets: ${visibleWidgets.join(', ')}`);
```

This will help you verify:
1. ✅ Did the scroll work? (widgets loaded)
2. ✅ Is the target widget on the page?
3. ❌ If not, workflow was recorded on different page

## How to Use the Diagnostic Logging

After rebuilding and reloading the extension, when you run a workflow you'll see:

```
[AIAgent] ✅ Scroll completed, advanced to hint X
[AIAgent] 🔍 Checking what widgets are visible after scroll...
[AIAgent] 🔍 Found 8 widgets: STORE LIST - PORTFOLIO, OPEN CHURN TRACKER CTAS7, "How To" Guide, ...
```

**If your target widget is in the list** → Scrolling worked! ✅  
**If your target widget is NOT in the list** → Wrong page or widget doesn't exist ❌

## Testing Instructions

1. **Reload the extension** in `chrome://extensions`
2. **Navigate to your Gainsight dashboard**
3. **Run the workflow**
4. **Check the console** for the diagnostic logs
5. **Look for**: `[AIAgent] 🔍 Found X widgets: ...`

### What to Look For:

**Good (workflow should work)**:
```
[AIAgent] 🔍 Found 8 widgets: ..., BRAND SALES OVERVIEW (SELECTED TIME PERIOD), ...
[AIAgent] ✅ Widget "BRAND SALES OVERVIEW (SELECTED TIME PERIOD)" is now visible
[Tier1] ⚠️ Element in shadow DOM - NEVER scroll page (widget already visible)
[Tier1] ✅ Clicking element: BUTTON More Options
```

**Bad (workflow incompatible with page)**:
```
[AIAgent] 🔍 Found 6 widgets: STORE LIST - PORTFOLIO, OPEN CHURN TRACKER CTAS7, ...
[AIAgent] ⚠️ Widget "BRAND SALES OVERVIEW (SELECTED TIME PERIOD)" not found after 5000ms
[AIAgent] 🔍 Available widgets: STORE LIST - PORTFOLIO, ...
```

## Root Cause Analysis

The original issue "it used to work before we refactor it" was caused by:

1. **Unconditional `scrollIntoView`** - Every click scrolled the page, even for elements already visible in shadow roots
2. **Dynamic Angular classes in selectors** - `.ng-star-inserted` caused selector failures
3. **No diagnostic logging** - Impossible to see what widgets were actually on the page

All three issues are now fixed!

## Files Modified

1. `src/content/shadow-dom-utils.ts` - Shadow host selector generation
2. `src/lib/ai-agent.ts` - Selector normalization + conditional scroll + diagnostics
3. `src/lib/tier1-executor.ts` - Selector normalization + conditional scroll
4. `src/types/scope.ts` - Added `findAllWidgetTitles()` helper
5. `src/content/modal-detector.ts` - Increased full-screen penalty (previous fix)

## Next Steps

1. Reload extension
2. Run workflow
3. Check console for `[AIAgent] 🔍 Found X widgets: ...`
4. Verify your target widget is in the list
5. If not, you're on the wrong page or need to re-record

The system will now tell you exactly what widgets it sees after each scroll!



