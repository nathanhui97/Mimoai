# Lazy-Loading Widget Fix ✅

## Problem

When running Gainsight workflows with widgets that require scrolling:
- ❌ **Inconsistent behavior**: Sometimes clicks correct widget, sometimes wrong one
- ❌ **Root cause**: Scroll only waited 500ms, not enough for lazy-loaded widgets to render
- ❌ **Symptom**: After scroll, the DOM map didn't have time to update with newly loaded widgets

## Solution

### 1. Enhanced Scroll Stability Wait
**Before**:
```typescript
// Fixed 500ms delay - not enough!
await new Promise(resolve => setTimeout(resolve, 500));
```

**After**:
```typescript
// Wait for scroll animation (300ms)
await new Promise(resolve => setTimeout(resolve, 300));

// Wait for lazy-loaded content to actually render
await StateWaitEngine.waitForStability({
  domQuietMs: 800,      // Wait for 800ms of no DOM changes
  networkQuietMs: 1000, // Wait for 1s of no network activity
  maxWaitMs: 5000,      // Max 5s total
  checkSpinners: true,  // Wait for loading spinners to disappear
});
```

### 2. Shadow DOM Widget Title Resolution
The widget titles were inside shadow roots, so scope resolution couldn't find them.

**Fixed**:
```typescript
// Check light DOM
let titleEl = widget.querySelector('h4, h5, h6...');

// NEW: Check shadow DOM too!
if (!titleEl && widget.shadowRoot) {
  titleEl = widget.shadowRoot.querySelector('h4, h5, h6...');
}
```

### 3. Shadow DOM Candidate Finding
The CandidateFinder was using `querySelectorAll()` which doesn't traverse shadow roots.

**Fixed**:
```typescript
// NEW: Shadow-aware search
querySelectorAllDeep(container, selector) {
  // Phase 1: Light DOM
  const results = container.querySelectorAll(selector);
  
  // Phase 2: Shadow DOM (traverse into web components!)
  ShadowDOMUtils.traverseShadowDOM(document, (el) => {
    if (el.matches(selector) && isInContainer) {
      results.push(el);
    }
  });
  
  return results;
}
```

## Expected Behavior Now

### Step 1: SCROLL
```
[Tier1] 📜 Scrolling page down by 709px
[Tier1] 📜 Post-scroll stability: ✅ DOM stable ✅ No spinners
```
- Scrolls to bring widget into view
- **Waits up to 5 seconds** for lazy-loaded widgets to render
- Checks for DOM mutations, network activity, and spinners

### Step 2: CLICK "More Options"
```
[AIAgent] 🔍 Extracted candidate index 2 from reasoning
[AIAgent] 🎯 Using candidate 2: widget="ADS CAMPAIGNS EXPIRED LAST 7 DAYS"
[Scope] ✅ Found widget "ADS CAMPAIGNS EXPIRED LAST 7 DAYS"
[CandidateFinder] Found 1 additional elements in shadow DOM
[Tier1] ✅ Clicking element: BUTTON
```
- Now has time to find the correct widget (because we waited!)
- Searches shadow DOM for the button
- Clicks the correct "More Options" button

### Step 3: CLICK "Download Data"
```
[Tier1] ✅ Found via role
[Tier1] ✅ Clicking element: LI
[AIAgent] ✅ Action succeeded
```
- Finds "Download Data" menu item
- Clicks it
- File downloads! ✅

## Why It Works Now

### Timeline Comparison

**Before (500ms wait)**:
```
0ms:    Scroll completes
500ms:  Continue to next step ← TOO EARLY!
        Widget still loading... ⏳
        DOM map shows old state
        Picks wrong button ❌
```

**After (smart wait)**:
```
0ms:    Scroll completes
300ms:  Scroll animation done
300ms-5s: Wait for DOM stability
        - Monitor DOM mutations
        - Monitor network requests
        - Monitor loading spinners
2.5s:   ✅ All stable! Widgets fully loaded
        DOM map shows fresh state with correct widgets
        Picks correct button ✅
```

## How to Use

### 1. Reload Extension
```
chrome://extensions/ → Refresh GhostWriter
```

### 2. Test Your Workflow
Load and run: `ghostwriter-workflow-1767493091622.json`

The workflow should now:
1. ✅ Scroll down (waits for lazy-load)
2. ✅ Click correct "More Options" in "ADS CAMPAIGNS EXPIRED LAST 7 DAYS"
3. ✅ Click "Download Data"
4. ✅ File downloads!

## Troubleshooting

### If Still Inconsistent

Check the console for:

**Good (should work)**:
```
[Tier1] 📜 Post-scroll stability: ✅ DOM stable ✅ No spinners
[AIAgent] 🎯 Using candidate 2: widget="ADS CAMPAIGNS EXPIRED..."
[Scope] ✅ Found widget "ADS CAMPAIGNS EXPIRED..."
```

**Bad (needs more wait time)**:
```
[Tier1] 📜 Post-scroll stability: ⚠️ DOM changing ⚠️ Loading
[AIAgent] 🎯 Using candidate 0: widget="Data Reminders"  ← WRONG!
```

If you see "DOM changing" or "Loading", the widgets are taking longer than 5s to load. You can:
- Increase `maxWaitMs` to 8000ms (8 seconds)
- Check your network - slow connections need more time
- Check for browser console errors (might indicate loading failures)

### If Widget Still Not Found

1. **Verify widget title**:
   - Open DevTools → Elements
   - Find `<gs-report-widget-element>`
   - Look inside `#shadow-root` → find the `<h4>` or `<h5>` with the title
   - Make sure the title text matches what's in the workflow

2. **Check Shadow DOM**:
   ```
   [Scope] ✅ Found widget "ADS CAMPAIGNS EXPIRED..."  ← Should see this!
   ```
   If you see "❌ Widget not found", the title might be in a different element or the widget structure changed.

## Performance Impact

- **Scroll action**: Was 500ms, now ~1-3 seconds (depends on page load)
- **Trade-off**: Slower but **much more reliable**
- **Why it's worth it**: Fixes intermittent failures that were frustrating!

## Files Modified

- `/src/lib/tier1-executor.ts` - Enhanced scroll stability wait
- `/src/types/scope.ts` - Shadow DOM title resolution
- `/src/content/candidate-finder.ts` - Shadow DOM candidate search
- `/src/lib/ai-agent.ts` - Reasoning parser for candidate index
- `/src/content/dom-map.ts` - Reduced verbose logging

---

## Summary

Three key improvements for lazy-loaded widgets:

1. ✅ **Scroll waits for actual stability** (not just 500ms fixed delay)
2. ✅ **Widget titles found in shadow DOM** (Gainsight uses web components)
3. ✅ **Buttons found in shadow DOM** (comprehensive shadow traversal)

**Result**: Reliable workflow execution even with lazy-loaded dashboard widgets! 🎯

Try it now - it should work consistently every time! 🚀


