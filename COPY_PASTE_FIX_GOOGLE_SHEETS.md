# Copy/Paste Fix for Google Sheets

## Problem

Copy/paste keyboard shortcuts (Cmd+C/Cmd+V) were not being captured in Google Sheets, even though the code was correct.

## Root Cause

Google Sheets (and similar complex web apps) **prevent keyboard events from bubbling** using `stopPropagation()` or `stopImmediatePropagation()`. 

Our keyboard listener was attached to `document`, which meant:
1. User presses Cmd+C
2. Event fires on the target element
3. Google Sheets' event handler catches it and stops propagation
4. Event never reaches `document` where our listener was waiting
5. Our recorder never sees the event ❌

## Solution

Changed from `document.addEventListener` to `window.addEventListener` with capture phase:

```typescript
// BEFORE (didn't work):
document.addEventListener('keydown', this.keyboardHandler, true);

// AFTER (works!):
window.addEventListener('keydown', this.keyboardHandler, true);
```

## Why This Works

The event capture flow is:
```
window (capture) → document (capture) → target element → document (bubble) → window (bubble)
                 ↑
                 Our listener is here now!
```

By listening on `window` with capture phase (`true`), we intercept events at the **very first opportunity**, before Google Sheets can stop them.

## Files Changed

- `src/content/recording-manager.ts`:
  - Line ~171: Changed `document.addEventListener` to `window.addEventListener`
  - Line ~375: Changed `document.removeEventListener` to `window.removeEventListener`
  - Added console log confirmation

## Testing

1. **Reload Extension**: Go to `chrome://extensions` and reload
2. **Hard Refresh**: Press Cmd+Shift+R on Google Sheets
3. **Test Copy**:
   - Select text in a cell
   - Press Cmd+C
   - Console should show: `⌨️ GhostWriter: Keyboard event with modifier:`
   - Console should show: `⌨️ GhostWriter: Copy/paste shortcut detected!`
   - Console should show: `📋 GhostWriter: Copy keyboard shortcut detected`
   - Workflow should show a new KEYBOARD step

4. **Test Paste**:
   - Click another cell
   - Press Cmd+V
   - Console should show similar logs
   - Workflow should show another KEYBOARD step

## Expected Console Output

When you press Cmd+C:
```
GhostWriter: Keyboard listener registered on window with capture phase
⌨️ GhostWriter: Keyboard event with modifier: { key: 'c', code: 'KeyC', ctrlKey: false, metaKey: true, ... }
⌨️ GhostWriter: Copy/paste shortcut detected! Processing...
📋 GhostWriter: Copy Detected: [text] from [selector]
📋 GhostWriter: Copy keyboard shortcut detected, adding clipboard metadata
```

When you press Cmd+V:
```
⌨️ GhostWriter: Keyboard event with modifier: { key: 'v', code: 'KeyV', ctrlKey: false, metaKey: true, ... }
⌨️ GhostWriter: Copy/paste shortcut detected! Processing...
📋 GhostWriter: Paste keyboard shortcut detected, adding clipboard metadata
📋 GhostWriter: Paste detected: { textLength: ..., targetSelector: ..., targetTag: ... }
```

## Why This Pattern is Important

This pattern (window + capture phase) is critical for recording in **any complex web application** that uses its own event handling:
- Google Sheets
- Google Docs
- Figma
- Notion
- Slack
- Any React/Angular/Vue app with custom keyboard shortcuts

These apps often intercept keyboard events early and prevent them from reaching the document level.

## Alternative Approaches Tried

1. ❌ `document` with capture phase - Events stopped before reaching document
2. ❌ `document` with bubble phase - Events stopped even earlier
3. ✅ `window` with capture phase - **Works!** Intercepts at the absolute top level

## Related Issues

This same pattern should be considered for other event types if we encounter similar issues:
- Mouse events in complex apps
- Touch events on mobile
- Custom keyboard shortcuts in IDEs/editors



