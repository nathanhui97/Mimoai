# New Tab Gap Handling - Chrome Newtab Fix

## Problem

When users open a new tab during recording (Cmd+T, Ctrl+T, or clicking +), Chrome opens `chrome://newtab` or `about:blank` first. The extension **cannot run content scripts on these restricted pages**, causing recording to break:

### What Was Happening:

```
1. User recording on Salesforce (Tab 0)
2. User opens new tab (Cmd+T) → Opens chrome://newtab
3. Service worker detects tab switch → IGNORES it (restricted page)
4. User navigates to Google Sheets
5. Tab loads, but recording was NEVER started in this tab
6. User actions on Sheets → NOT RECORDED ❌
7. Workflow is incomplete and broken
```

### The Issue:

```typescript
// Old code - silently ignored restricted pages
if (newTab.url.startsWith('chrome://') || newTab.url.startsWith('about:')) {
  return; // Just ignores it, breaks recording
}
```

**Result:**
- TAB_SWITCH not recorded
- New tab orphaned (no recording)
- User actions lost
- Silent failure (no warning)

## Solution: Pending Tab Tracking

Instead of ignoring restricted pages, we now **track them as "pending"** and start recording when they navigate to a real URL.

### Implementation

#### 1. Track Pending Tabs

Added a Set to track tabs waiting for navigation:

```typescript
// In service-worker.ts
const pendingNewTabs: Set<number> = new Set();
```

#### 2. Mark Restricted Tabs as Pending

When a tab switches to a restricted page during recording:

```typescript
// In chrome.tabs.onActivated listener:
const isRestrictedPage = newTab.url && (
  newTab.url.startsWith('chrome://') || 
  newTab.url.startsWith('chrome-extension://') || 
  newTab.url.startsWith('about:') ||
  newTab.url.startsWith('edge://')
);

if (isRestrictedPage) {
  // Mark as pending instead of ignoring
  console.log(`[ServiceWorker] New tab opened to restricted page, marking as pending`);
  pendingNewTabs.add(newTabId);
  return; // Don't record TAB_SWITCH yet
}
```

#### 3. Resume Recording on Real Navigation

When a pending tab navigates to a real URL:

```typescript
// In chrome.tabs.onUpdated listener:
if (recordingSessionId && pendingNewTabs.has(tabId) && !isRestrictedPage) {
  console.log(`[ServiceWorker] 🆕 Pending tab navigated to real page: ${tab.url}`);
  
  // Remove from pending
  pendingNewTabs.delete(tabId);
  
  // Start recording in this tab
  await startRecordingInTab(tabId, tab.url, tab.title);
  
  // Record TAB_SWITCH directly to the FINAL URL (skip chrome://newtab)
  const tabSwitchStep = {
    type: 'TAB_SWITCH',
    payload: {
      fromUrl,
      toUrl: tab.url, // Salesforce.com (not chrome://newtab!)
      isNewTab: true, // This is a new tab creation
      ...
    }
  };
  
  // Send to sidepanel
  sendTabSwitchMessages(tabSwitchStep);
}
```

#### 4. Cleanup on Tab Close

Remove pending tabs when they're closed:

```typescript
chrome.tabs.onRemoved.addListener((tabId) => {
  // Clean up from all tracking sets
  activeRecordingTabs.delete(tabId);
  pendingNewTabs.delete(tabId); // ← NEW
  sessionTabMap.delete(tabId);
  ...
});
```

## How It Works Now

### Recording Flow:

```
1. User on Salesforce (Tab 0) - recording active
2. User opens new tab (Cmd+T)
   → Chrome opens chrome://newtab
   → Service worker marks as "pending"
   → ✅ Recording continues in Tab 0

3. User navigates to Google Sheets
   → Tab loads at docs.google.com
   → Service worker detects: "pending tab → real URL"
   → ✅ Starts recording in Tab 1
   → ✅ Records TAB_SWITCH to docs.google.com
   → ✅ isNewTab=true

4. User switches back to Tab 0 (Salesforce)
   → ✅ Records TAB_SWITCH with isNewTab=false
   
5. Result: Complete workflow with correct tab tracking!
```

### Replay Flow:

```
1. Start on Salesforce (Tab 0)
2. See TAB_SWITCH to docs.google.com with isNewTab=true
   → ✅ Opens new tab directly to Sheets (skips chrome://newtab)
3. See TAB_SWITCH to Salesforce with isNewTab=false
   → ✅ Switches to existing Tab 0
4. Clean workflow - only 2 tabs, no duplicates!
```

## Benefits

✅ **Recording doesn't break** when opening new tabs
✅ **Skips unnecessary steps** - no chrome://newtab in recording
✅ **Cleaner workflows** - directly records the destination URL
✅ **Smart replay** - creates tabs to final URLs directly
✅ **Matches user intent** - user wanted to go to Sheets, not newtab
✅ **Backward compatible** - existing workflows still work

## Edge Cases Handled

### Case 1: User Opens Tab But Doesn't Navigate
```
1. User opens new tab → chrome://newtab
2. Marks as pending
3. User closes tab immediately
4. onRemoved fires → cleans up pendingNewTabs
✅ No orphaned tracking
```

### Case 2: User Opens Multiple Tabs Quickly
```
1. User opens Tab A → chrome://newtab (pending)
2. User opens Tab B → chrome://newtab (pending)
3. User navigates Tab A to Sheets
4. User navigates Tab B to Salesforce
✅ Both handled correctly with separate TAB_SWITCH steps
```

### Case 3: Recording Paused While Tab Pending
```
1. User opens new tab → chrome://newtab (pending)
2. User pauses recording
3. pendingNewTabs.clear() ← Cleanup
✅ No stale tracking when recording resumes
```

## Console Logs

### Success Indicators:

```
[ServiceWorker] New tab opened to restricted page (chrome://newtab), marking as pending
[ServiceWorker] 🆕 Pending tab 456 navigated to real page: https://sheets.google.com/...
[ServiceWorker] 📝 Recording TAB_SWITCH to real URL (skipped chrome://newtab)
```

### What You Won't See Anymore:

```
❌ "Tab activation ignored - not recording"
❌ Recording breaks silently
❌ Actions in new tab not recorded
```

## Files Modified

### 1. `src/background/service-worker.ts`
- ✅ Added `pendingNewTabs: Set<number>` to track tabs waiting for navigation
- ✅ Updated `chrome.tabs.onActivated` to mark restricted tabs as pending
- ✅ Updated `chrome.tabs.onUpdated` to handle pending→real navigation
- ✅ Updated `chrome.tabs.onRemoved` to clean up pending tabs
- ✅ Updated `pauseRecordingInAllTabs()` to clear pending tabs
- ✅ Updated `stopRecordingInAllTabs()` to clear pending tabs

## Testing

### Test Case 1: Open New Tab During Recording
1. Start recording on Salesforce
2. Press Cmd+T (opens chrome://newtab)
3. Navigate to Google Sheets
4. Perform actions on Sheets
5. **✅ Verify:** Actions are recorded
6. **✅ Verify:** TAB_SWITCH shows `toUrl: sheets.google.com` (not chrome://newtab)
7. **✅ Verify:** `isNewTab: true` in JSON

### Test Case 2: Replay New Tab Workflow
1. Record workflow with new tab creation (as above)
2. Replay workflow
3. **✅ Verify:** Tab opens directly to Sheets (no intermediate chrome://newtab)
4. **✅ Verify:** Only 2 tabs total (Salesforce + Sheets)

### Test Case 3: Multiple New Tabs
1. Start recording
2. Open multiple new tabs (Cmd+T, Cmd+T)
3. Navigate each to different URLs
4. **✅ Verify:** All tabs tracked correctly
5. **✅ Verify:** All TAB_SWITCH steps recorded with correct URLs

### Test Case 4: Close Tab Before Navigation
1. Start recording
2. Open new tab (Cmd+T) → chrome://newtab
3. Close tab immediately
4. **✅ Verify:** No errors in console
5. **✅ Verify:** Recording continues normally

## Implementation Date
January 6, 2026

## Related Documents
- `SMART_TAB_SWITCHING.md` - isNewTab field implementation
- `TAB_SWITCH_RESUMPTION_FIX.md` - Visibility listener and state persistence
- `TAB_SWITCH_STORAGE_FIX.md` - Service worker storage routing
- `MULTI_TAB_RECORDING_IMPLEMENTATION.md` - Original multi-tab recording

## Future Enhancements

### Potential Improvements
1. **Show toast notification** when pending tab becomes active
2. **Track time in pending state** for analytics
3. **Handle edge://newtab** (Edge browser)
4. **Support other browser new tab pages**

## User Experience Impact

**Before:**
- Opening new tabs during recording → broken workflows
- Users had to manually switch tabs in specific order
- Confusing behavior with no feedback

**After:**
- Opening new tabs → just works! ✅
- Natural workflow recording
- Clean, logical TAB_SWITCH steps
- No unnecessary intermediate steps

