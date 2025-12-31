# Salesforce Lightning Page Load Fix

## Issue

When executing workflows on Salesforce Lightning after navigation, the "New" button click fails with:
```
Element not interactable: Element has zero dimensions (width or height is 0)
Resolved element: { tag: "BODY", height: 0 }
```

## Root Cause

**Salesforce Lightning uses a special layout where BODY always has height: 0!**

The content is rendered in absolutely positioned containers (`.slds-scope`, `.oneOne`, etc.), not in the body element itself.

The previous wait logic was checking for `body.height > 0`, which never happens in Lightning apps.

## The Fix

Changed the wait logic to:
1. Look for Lightning app container (`.slds-scope`, `[class*="oneOne"]`, etc.)
2. Wait for that container to have proper dimensions
3. Wait for buttons to be present in the container
4. Additional 1s wait for dynamic content

```typescript
// Wait for Lightning app container
const appContainer = document.querySelector('.slds-scope, [class*="oneOne"], [class*="desktop"], main, [role="main"]');

if (appContainer) {
  const appRect = appContainer.getBoundingClientRect();
  if (appRect.height > 100 && appRect.width > 100) {
    // Check that interactive elements are present
    const buttons = appContainer.querySelectorAll('button, a[role="button"], [role="button"]');
    if (buttons.length > 0) {
      // App is ready!
    }
  }
}
```

## Files Modified

- `src/content/content-script.ts` - Enhanced Salesforce Lightning wait logic

## Testing

### 1. Reload Extension
```
New build: content-script.ts-8x4rC0Rt.js
```

### 2. Clear Session & Refresh
```javascript
sessionStorage.clear()
```

### 3. Execute Workflow

Watch for:
```
🚀 Detected Salesforce Lightning, waiting for full render...
🚀 Lightning app container dimensions: 998 x 1234
🚀 Found 15 buttons in app container
🚀 Salesforce Lightning app fully loaded!
🚀 Salesforce Lightning ready for execution
[UniversalOrchestrator] Resolved element: { tag: "A", role: "button", text: "New" }
```

## Next Steps

If this still doesn't work, implement **Visual AI Click** as fallback:
1. Capture screenshot
2. Send to AI: "Find the 'New' button"
3. AI returns coordinates
4. Click at those coordinates





