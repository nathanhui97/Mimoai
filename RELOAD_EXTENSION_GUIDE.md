# How to Reload Chrome Extension (Force Latest Version)

## Step 1: Open Chrome Extensions Page
1. Go to `chrome://extensions/` in your browser
2. OR right-click the extension icon → "Manage extension"

## Step 2: Enable Developer Mode
- Toggle "Developer mode" ON (top right corner)

## Step 3: Reload the Extension
**Option A: Full Reload (Recommended)**
1. Find "GhostWriter" in the list
2. Click the **circular reload icon** (🔄) next to the extension
3. Wait for it to finish reloading

**Option B: Complete Reset (If Option A doesn't work)**
1. Click **"Remove"** to uninstall the extension
2. Click **"Load unpacked"**
3. Navigate to: `/Users/nathhui/Documents/Autoflow chrome extension/dist`
4. Select the `dist` folder

## Step 4: Verify You Have the Latest Version

### Check in Console:
1. Open any webpage
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to Console tab
4. Type: `window.location.href`
5. Look for console logs that start with `GhostWriter:` or `VerifiedExecutionEngine:`

### Check Content Script Hash:
The latest build should show:
- Content script: `content-script.ts-Cbxh8Xmh.js`
- Look for logs like: `GhostWriter: Content script loaded and ready`

### Test the New Feature:
1. Record a workflow on Page A
2. Navigate to Page B (different page)
3. Try to execute the workflow
4. You should see: **"Wrong starting page! Expected: [Page A], Current: [Page B]"**

## Step 5: Clear Extension Storage (If Still Not Working)

If you're still seeing old behavior:

1. Go to `chrome://extensions/`
2. Find GhostWriter
3. Click "Details"
4. Scroll down to "Storage"
5. Click "Clear site data" or "Clear storage"

## Troubleshooting

### Still seeing old version?
1. **Hard refresh the page**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. **Close and reopen Chrome completely**
3. **Check if you have multiple Chrome profiles** - make sure you're using the right one
4. **Check the dist folder timestamp** - files should be recent (just built)

### Check Build Date:
Run this in terminal:
```bash
ls -la "/Users/nathhui/Documents/Autoflow chrome extension/dist/assets/" | grep content-script
```

The file should have a recent timestamp (just now).

## Quick Verification Script

Open browser console and run:
```javascript
// Check if extension is loaded
console.log('Extension check:', typeof chrome !== 'undefined' && chrome.runtime);

// Check content script (if you can access it)
// Look for: GhostWriter: Content script loaded and ready
```








