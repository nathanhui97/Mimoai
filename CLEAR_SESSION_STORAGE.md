# Clear Session Storage to Fix Workflow Caching

## Problem
Old workflow is cached in browser's `sessionStorage` and keeps running instead of your new workflow.

## Solution

### Option 1: Quick Fix (Clear Session Storage)
1. Open Gainsight in your browser
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Run this command:
```javascript
sessionStorage.clear();
localStorage.clear();
```
5. **Refresh the page** (Ctrl+R or Cmd+R)
6. Close DevTools
7. Try running your workflow again from the extension

### Option 2: Clear All Extension Data (Nuclear Option)
1. Go to `chrome://extensions/`
2. Find "AutoFlow Chrome Extension"
3. Click **Details**
4. Scroll down and click **"Remove extension"**
5. Click **"Load unpacked"** and select the extension folder again
6. This will clear ALL saved workflows and caches

### Option 3: Add Clear Cache Button (Permanent Fix)
Run this in the DevTools Console on the Gainsight page:
```javascript
if (window.clearAICache) {
  window.clearAICache();
}
sessionStorage.clear();
console.log('✅ All caches cleared!');
```

## Verify It Worked
After clearing, the console should show:
- NO more `ghostwriter_pending_execution` messages
- The correct workflow ID when you run it
- Scroll container should be detected: `[AIAgent] ✅ Found scroll container: ".gs-home-renderer__content"`

## Debug: Check What's Cached
To see what's currently cached, run in Console:
```javascript
console.log('Pending execution:', sessionStorage.getItem('ghostwriter_pending_execution'));
console.log('All sessionStorage:', Object.entries(sessionStorage));
```

