# Force Chrome Extension to Load New Code

The duplicate click bug fix is NOT loading because Chrome is caching the old extension code.

## Steps to FORCE Chrome to Use New Code:

### Option 1: Complete Clean Reload

1. **Completely quit Chrome** (Cmd+Q on Mac, don't just close the window)
2. Delete Chrome's extension cache:
   ```bash
   rm -rf ~/Library/Caches/Google/Chrome/Default/Extensions
   ```
3. Reopen Chrome
4. Go to `chrome://extensions/`
5. Remove "Autoflow" extension
6. Click "Load unpacked"
7. Select your extension folder

### Option 2: Verify New Build is Loaded

1. Go to `chrome://extensions/`
2. Find "Autoflow"
3. Look at the "Inspect views" section
4. Click on any link (e.g., "service worker")
5. In the DevTools console, type: `chrome.runtime.getManifest()`
6. Check the version number - does it match your manifest.json?

### Option 3: Add a Version Bump

Edit `manifest.json`:
```json
{
  "version": "1.0.1"  // Change this! (was probably 1.0.0)
}
```

Then:
1. Run `npm run build`
2. Go to `chrome://extensions/`
3. Remove old "Autoflow"
4. Load unpacked again

---

## How to Verify the Fix is Active

After reloading, **open the browser console BEFORE recording**:

1. Press F12 → Console tab
2. Start recording
3. Click the dropdown once
4. You should see in console:
   ```
   GhostWriter: ⚠️ BLOCKING duplicate click (timestamp + coordinates match)
   Time diff: 0ms, Coords: (910, 501)
   ```

If you see this message, the fix is working!

If you DON'T see it, Chrome is still using old code.

---

## Nuclear Option: Different Extension ID

If nothing works, rename the extension folder and load it as a completely new extension:

1. Copy extension folder: `Autoflow chrome extension 2`
2. Load the NEW folder as unpacked
3. Remove the old "Autoflow" extension
4. Test with the new one

This forces Chrome to treat it as a completely different extension.









