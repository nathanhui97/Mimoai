# Clear Chrome Extension Cache - Step by Step

## The Problem
You're seeing the old build hash `BCQyALCB.js` instead of the new `DyhywIid.js`. This means Chrome is caching the old version.

## Solution: Complete Cache Clear

### Step 1: Remove the Extension Completely
1. Go to `chrome://extensions/`
2. Find "GhostWriter"
3. Click **"Remove"** (not just disable)
4. Confirm removal

### Step 2: Clear Chrome's Extension Cache
1. Close **ALL Chrome windows** completely
2. Open Chrome again
3. Go to `chrome://extensions/`
4. Make sure "Developer mode" is ON (top right toggle)

### Step 3: Load Fresh Extension
1. Click **"Load unpacked"**
2. Navigate to: `/Users/nathhui/Documents/mimoai/dist`
3. Select the `dist` folder
4. Wait for it to load

### Step 4: Hard Refresh Test Page
1. Go to any webpage where you want to test
2. Press `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
3. This clears the page cache

### Step 5: Verify New Version
1. Open DevTools (F12)
2. Go to Console tab
3. Look for: `🚀 GhostWriter: Content script loaded (v0.1.1-starting-page-validation)`
4. Look for: `📦 Build hash: content-script.ts-DyhywIid.js`

If you see `BCQyALCB.js`, the cache is still active. Try:

### Alternative: Clear Service Worker Cache
1. Go to `chrome://extensions/`
2. Find "GhostWriter"
3. Click **"service worker"** link (under "Inspect views")
4. In the DevTools that opens, click **"Application"** tab
5. Click **"Clear storage"** in the left sidebar
6. Check all boxes
7. Click **"Clear site data"**
8. Reload the extension

### Nuclear Option: Clear All Extension Data
1. Go to `chrome://extensions/`
2. Find "GhostWriter"
3. Click **"Details"**
4. Scroll to **"Storage"** section
5. Click **"Clear site data"**
6. Remove and re-add the extension

## Verification
After following these steps, you should see in the console:
- ✅ `v0.1.1-starting-page-validation`
- ✅ `content-script.ts-DyhywIid.js`
- ✅ Version `0.1.1` in chrome://extensions/

If you still see the old hash, Chrome is aggressively caching. Try:
- Restart your computer
- Use Chrome in Incognito mode (extensions work there too)
- Check if you have multiple Chrome profiles and are using the right one








