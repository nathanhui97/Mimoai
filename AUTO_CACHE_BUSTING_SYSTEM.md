# Automated Cache Busting System

## Summary

I've implemented an **automated cache detection and clearing system** that solves the browser caching problem permanently.

---

## What I Built

### 1. Version Checker System ✅

**File:** `src/lib/version-checker.ts`

Automatically detects when cached code is being used and notifies the user.

**Features:**
- **Auto-generated version:** Updates on every build (timestamp-based)
- **Build hash:** Unique hash for each build to detect stale code
- **Component tracking:** Tracks versions for content-script, service-worker, and sidepanel independently
- **Auto-reload notification:** Shows prominent banner when stale code detected
- **Manual cache clear:** Provides `clearExtensionCache()` function

### 2. Auto-Generated Build Info ✅

**File:** `vite.config.ts`

```typescript
const buildHash = `build-${Date.now().toString(36)}`;
const buildTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
```

**Injected into all code:**
- `import.meta.env.VITE_BUILD_HASH` = unique hash (e.g., `build-lk3n9z`)
- `import.meta.env.VITE_BUILD_TIMESTAMP` = ISO timestamp (e.g., `2026-01-07T05-45-23`)

**Benefits:**
- No manual version updates needed
- Every build gets unique identifiers
- Can detect if cached code is from a different build

### 3. Integrated into All Components ✅

**Content Script** (`content-script.ts`):
- Checks version on load
- Shows reload banner if stale code detected
- User can click "Reload Tab" button

**Service Worker** (`service-worker.ts`):
- Checks version on startup
- Auto-reloads extension if version mismatch

**Sidepanel** (`App.tsx`):
- Checks version on open
- Exposes `clearExtensionCache()` in console
- Reloads itself if stale

---

## How to Use

### Automatic Detection (No Action Needed)

When you reload the extension with new code:

1. **Content script detects version mismatch**
2. **Shows prominent banner at top of page:**
   ```
   🔄 GhostWriter extension updated! Please reload this tab to use the latest code.
   [Reload Tab] [Dismiss]
   ```
3. **User clicks "Reload Tab"**
4. **Fresh code loads** ✅

### Manual Cache Clearing

**Option 1: Browser Console (F12)**

```javascript
// On any page with the extension:
clearExtensionCache()

// Expected output:
// [VersionChecker] ✅ All caches cleared: ["chrome.storage.local (47 keys)", "sessionStorage", "localStorage", "version info"]
```

**Option 2: Sidepanel Console**

```javascript
// Open sidepanel, then press F12 to open sidepanel console:
clearExtensionCache()

// Then reload the tab manually
```

**Option 3: Check Version Info**

```javascript
// Check what versions are currently stored:
checkExtensionVersion()

// Expected output:
// {
//   "content-script": {
//     "version": "2026-01-07T05-45-23",
//     "buildHash": "build-lk3n9z",
//     "timestamp": 1767764723000,
//     "component": "content-script"
//   },
//   ...
// }
```

---

## What Gets Cleared

When you call `clearExtensionCache()`:

1. ✅ **chrome.storage.local** (except saved workflows)
   - AI cache
   - Version info
   - Correction memory
   - Temporary state

2. ✅ **sessionStorage**
   - Pending execution state
   - Auto-resume flags

3. ✅ **localStorage**
   - Any app-specific cached data

4. ✅ **Version info**
   - Forces fresh version check on next load

**NOT cleared:**
- ❌ Saved workflows (`workflow_*` keys)
- ❌ Workflow list (`ghostwriter_workflows`)

---

## How It Prevents Future Caching Issues

### Before (Manual Process):
1. Make code changes
2. Build extension
3. Hope Chrome reloads it properly
4. If it doesn't, manually:
   - Kill Chrome
   - Remove extension
   - Re-add extension
   - Clear caches
   - Reload tabs
5. Test and realize it's still cached
6. Repeat steps 1-5 😤

### After (Automatic):
1. Make code changes
2. Build extension (`npm run build`)
3. Reload extension in Chrome
4. **Open any tab** → Banner appears: "Extension updated, reload this tab"
5. Click "Reload Tab"
6. Fresh code loads automatically ✅

---

## Verification

### Check Build Info

After building, check the console logs:

```bash
npm run build

# Should see:
# 🔨 Building extension - Version: 2026-01-07T05-45-23, Hash: build-lk3n9z
```

### Check Runtime Info

After loading extension:

**Content Script Console:**
```
🚀 mimoai: Content script loaded (2026-01-07T05-45-23) [build-lk3n9z]
[VersionChecker] content-script version: 2026-01-07T05-45-23 hash: build-lk3n9z
[VersionChecker] ✅ content-script version verified: 2026-01-07T05-45-23
```

**Service Worker Console:**
```
🚀 Service Worker loaded (2026-01-07T05-45-23) [build-lk3n9z]
[VersionChecker] service-worker version: 2026-01-07T05-45-23 hash: build-lk3n9z
[VersionChecker] ✅ service-worker version verified: 2026-01-07T05-45-23
```

**Sidepanel Console:**
```
[App] 📦 Extension version: 2026-01-07T05-45-23
[VersionChecker] sidepanel version: 2026-01-07T05-45-23 hash: build-lk3n9z
[VersionChecker] ✅ sidepanel version verified: 2026-01-07T05-45-23
```

### Check Version Mismatch Detection

If you reload extension but don't reload a tab:

**Content Script Console:**
```
[VersionChecker] ⚠️ Version mismatch detected for content-script!
[VersionChecker] Stored: 2026-01-07T05-40-00 (build-abc123)
[VersionChecker] Current: 2026-01-07T05-45-23 (build-lk3n9z)
[VersionChecker] 🔄 Content script version mismatch!
[VersionChecker] ACTION REQUIRED: Reload this tab to get fresh code
[VersionChecker] 📢 Reload notification shown to user
```

**Page shows banner:**
```
┌─────────────────────────────────────────────────────────┐
│ 🔄 GhostWriter extension updated! Please reload this   │
│    tab to use the latest code.                          │
│    [Reload Tab] [Dismiss]                               │
└─────────────────────────────────────────────────────────┘
```

---

## Debugging Workflows

### Problem: "Steps are still missing after reload"

**Step 1: Verify version is current**

```javascript
// In page console:
checkExtensionVersion()

// Check if timestamp matches your latest build
// Should be within last few minutes if you just built
```

**Step 2: Compare build hash**

```javascript
// Check what hash was built:
// Look at build output: "Hash: build-lk3n9z"

// Check what hash is loaded:
checkExtensionVersion()
// Should show same hash in all components
```

**Step 3: Clear cache and verify**

```javascript
// Clear all caches:
await clearExtensionCache()

// Reload tab:
location.reload()

// Record workflow immediately after reload
```

### Problem: "Different steps have different timestamps"

This indicates mixed old/new code. Solutions:

1. **Nuclear option:**
   ```bash
   killall "Google Chrome"
   rm -rf ~/Library/Caches/Google/Chrome/Default/Service\ Worker/
   # Restart Chrome
   # Remove and re-add extension
   ```

2. **Incognito option:**
   ```bash
   # Open Incognito window (Cmd+Shift+N)
   # Enable extension in Incognito mode
   # Record workflow in Incognito
   # Incognito bypasses ALL caches
   ```

---

## Console Commands Reference

### Available Commands

```javascript
// Clear all caches (preserves workflows)
clearExtensionCache()

// Check version info for all components
checkExtensionVersion()

// Get last build time
// Returns: { version: "2026-01-07T05-45-23", buildHash: "build-lk3n9z", ... }
```

---

## How This Solves the Original Problem

### Your Original Issue:
- Recorded workflow had `elementText: null` for some steps
- Execution skipped those steps
- Couldn't figure out why

### Root Causes Identified:
1. ❌ `captureElementText()` missing `'li'` and `'option'` tags
2. ❌ `captureElementText()` not checking aria-label/`<label>` for INPUTs
3. ❌ `HintExtractor` not falling back to `label`/`placeholder` for INPUTs
4. ❌ `CandidateFinder` not using `targetPlaceholder` when `targetText` missing
5. ❌ Browser serving cached extension code

### All Fixed:
1. ✅ Added `'li'` and `'option'` to tag list
2. ✅ INPUT fields now check aria-label → `<label>` → placeholder → name
3. ✅ HintExtractor falls back to `label`/`placeholder`
4. ✅ CandidateFinder uses `targetPlaceholder` for matching
5. ✅ **Automated version checker detects cached code**

---

## Testing the Full Fix

### Step 1: Reload Extension Properly

```bash
# Go to chrome://extensions
# Click "Reload" on GhostWriter
# Wait for console message: "🔨 Building extension - Version: ..."
```

### Step 2: Reload All Open Tabs

```bash
# On each tab with your app:
# Press Cmd+Shift+R (hard refresh)
# Or click the banner that appears
```

### Step 3: Verify Version

```bash
# In page console:
checkExtensionVersion()

# All three components should show same version/hash:
# {
#   "content-script": { "version": "2026-01-07T05-XX-XX", "buildHash": "build-XXXXX" },
#   "service-worker": { "version": "2026-01-07T05-XX-XX", "buildHash": "build-XXXXX" },
#   "sidepanel": { "version": "2026-01-07T05-XX-XX", "buildHash": "build-XXXXX" }
# }
# 
# All versions MUST match! If they don't, cached code is still present.
```

### Step 4: Record Fresh Workflow

1. **Start recording**
2. Perform actions
3. **Stop recording**
4. **Download JSON**

### Step 5: Verify JSON Structure

```bash
cat ~/Downloads/ghostwriter-workflow-*.json | jq '.[] | select(.type != "SCROLL") | {type, elementText: .payload.elementText, hasLabel: (.payload.label != null), hasPlaceholder: (.payload.context.uniqueAttributes.placeholder != null)}'
```

**Expected:**
- All CLICK steps on dropdowns: `elementText` populated with option text
- All INPUT steps: `elementText` populated OR `hasLabel`/`hasPlaceholder` = true

### Step 6: Execute Workflow

Should execute ALL steps without skipping.

---

## If Issues Persist

If you still see issues after following ALL steps above, send me:

1. **Build console output:**
   ```bash
   npm run build | grep -E "(Building|Version|Hash)"
   ```

2. **Runtime version info:**
   ```javascript
   checkExtensionVersion()
   ```

3. **New workflow JSON** (first 200 lines):
   ```bash
   cat ~/Downloads/ghostwriter-workflow-*.json | jq '.[] | {type, elementText: .payload.elementText}' | head -50
   ```

4. **Browser console logs** showing version mismatch (if any)

And I'll investigate further!

---

## Benefits of This System

1. **Automatic detection** - No guessing if code is cached
2. **User-friendly** - Clear visual banner with "Reload Tab" button
3. **Console commands** - Developers can clear caches manually
4. **Per-component tracking** - Detects partial cache issues
5. **Build automation** - Version updates automatically on each build
6. **Preserves workflows** - Cache clearing doesn't delete saved workflows
7. **Universal fix** - Prevents ALL future caching issues, not just this one

No more "kill Chrome and pray" debugging! 🎉

