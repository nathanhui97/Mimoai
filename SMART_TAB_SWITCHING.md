# Smart Tab Switching - isNewTab Field

## Problem Statement

When recording workflows that switch between tabs, the system needs to know:
- **When to CREATE a new tab** (user opened a new tab during recording)
- **When to SWITCH to an existing tab** (user switched between already-open tabs)

Without this information, the replay system would always try to open new tabs, resulting in duplicate tabs instead of intelligently reusing existing ones.

## Solution: `isNewTab` Field

Added an `isNewTab` boolean field to the `TabSwitchPayload` to capture whether the recorded tab switch was:
- `true` - User created a NEW tab (e.g., Ctrl+Click, "Open in new tab")
- `false` - User switched to an EXISTING tab (e.g., clicked on tab bar)
- `undefined` - Legacy recording (no data available)

## How It Works

### During Recording

The service worker detects whether a tab is new or existing:

```typescript
// In service-worker.ts
const isNewTab = !activeRecordingTabs.has(newTabId);

const tabSwitchStep = {
  type: 'TAB_SWITCH',
  payload: {
    fromUrl,
    toUrl: newTab.url,
    fromTitle,
    toTitle: newTab.title,
    fromTabIndex,
    toTabIndex,
    isNewTab, // ✨ NEW: Record whether this was a new tab
    timestamp: Date.now(),
  },
};
```

### During Replay

The AI agent uses the `isNewTab` field to decide whether to create or switch:

```typescript
// In ai-agent.ts
if (isNewTab === true) {
  // Recording shows this was a NEW tab creation
  console.log(`[AIAgent] 🆕 Creating new tab ${toTabIndex}`);
  await tabManager.openNewTab(toTabIndex, toUrl);
  
} else if (isNewTab === false) {
  // Recording shows this was a SWITCH to existing tab
  console.log(`[AIAgent] 🔄 Switching to existing tab ${toTabIndex}`);
  
  // First time switching to this tab? Create it
  if (!tabManager.hasTab(toTabIndex)) {
    await tabManager.openNewTab(toTabIndex, toUrl);
  } else {
    // Tab already exists, just switch
    await tabManager.switchToTab(toTabIndex);
  }
  
} else {
  // Legacy: fallback to old behavior for old recordings
  console.log(`[AIAgent] ⚠️ Legacy TAB_SWITCH (no isNewTab field)`);
  // ... existing fallback logic
}
```

## Example Scenarios

### Scenario 1: User Opens New Tab

**Recording:**
```
1. User is on Tab 0 (Salesforce)
2. User Ctrl+Clicks a link → Opens Tab 1 (Google Sheets) - NEW TAB
3. Records: { type: 'TAB_SWITCH', payload: { toTabIndex: 1, isNewTab: true } }
```

**Replay:**
```
1. Agent starts on Tab 0
2. Sees TAB_SWITCH with isNewTab=true
3. Creates NEW Tab 1 ✅
4. Switches to Tab 1
```

### Scenario 2: User Switches Between Existing Tabs

**Recording:**
```
1. User has Tab 0 (Salesforce) and Tab 1 (Sheets) already open
2. User clicks on Tab 1 (already exists)
3. Records: { type: 'TAB_SWITCH', payload: { toTabIndex: 1, isNewTab: false } }
4. User clicks back on Tab 0
5. Records: { type: 'TAB_SWITCH', payload: { toTabIndex: 0, isNewTab: false } }
```

**Replay:**
```
1. Agent starts on Tab 0
2. Sees TAB_SWITCH to Tab 1 with isNewTab=false
3. Tab 1 doesn't exist yet → Creates it (first time)
4. Sees TAB_SWITCH to Tab 0 with isNewTab=false
5. Tab 0 already exists → Just switches (no duplicate) ✅
```

### Scenario 3: Back-and-Forth Between Two Tabs

**Recording:**
```
1. Tab 0 (Salesforce) - starting tab
2. Switch to Tab 1 (Sheets) - isNewTab=true (first time opening)
3. Switch to Tab 0 - isNewTab=false (returning to existing)
4. Switch to Tab 1 - isNewTab=false (returning to existing)
5. Switch to Tab 0 - isNewTab=false (returning to existing)
```

**Replay:**
```
1. Start with Tab 0
2. Create Tab 1 (isNewTab=true)
3. Switch to Tab 0 (exists, just switch)
4. Switch to Tab 1 (exists, just switch) ✅ No duplicates!
5. Switch to Tab 0 (exists, just switch)
Result: Only 2 tabs total (Tab 0 and Tab 1)
```

## Benefits

✅ **No Duplicate Tabs** - System reuses tabs intelligently
✅ **Faster Replay** - Switching is faster than creating new tabs
✅ **User Intent Preserved** - Replay matches what user actually did
✅ **Backward Compatible** - Legacy recordings still work with fallback logic

## Technical Details

### Files Modified

1. **`src/types/workflow.ts`**
   - Added `isNewTab?: boolean` to `TabSwitchPayload` interface

2. **`src/background/service-worker.ts`**
   - Capture `isNewTab` value during recording
   - Added to both auto-detected tab switches and manual RESUME_RECORDING

3. **`src/lib/ai-agent.ts`**
   - Added `isNewTab?: boolean` to `AgentActionParams` interface
   - Updated TAB_SWITCH hint handler to extract and pass `isNewTab`
   - Updated tab_switch executor to use `isNewTab` for decision making
   - Added legacy fallback for old recordings without `isNewTab`

### Console Logs

**Recording:**
```
[ServiceWorker] Tab activated: { newTabId: 456, isNewTab: true }
[ServiceWorker] TAB_SWITCH detected: new tab 456
```

**Replay with New Tab:**
```
[AIAgent] 🔄 Switching to tab 1: Google Sheets (new tab)
[AIAgent] 🆕 Creating new tab 1 at https://docs.google.com/... (recorded as new)
[TabManager] Created new tab 650349059 for logical index 1
```

**Replay with Existing Tab:**
```
[AIAgent] 🔄 Switching to tab 0: Salesforce (existing tab)
[AIAgent] 🔄 Switching to existing tab 0 (recorded as existing)
[TabManager] Switching from tab 650349059 to tab 650349029 (logical 0)
[TabManager] Successfully switched to tab 0
```

## Testing

### Test Case 1: Single Tab Switch
1. **Record:** Start on Salesforce, open new Sheets tab
2. **Expected:** `isNewTab: true` in JSON
3. **Replay:** Should create 1 new tab

### Test Case 2: Back-and-Forth
1. **Record:** Tab 0 → Tab 1 (new) → Tab 0 → Tab 1 → Tab 0
2. **Expected:** First switch `isNewTab: true`, rest `isNewTab: false`
3. **Replay:** Should end with only 2 tabs total

### Test Case 3: Legacy Recording
1. **Load:** Old recording without `isNewTab` field
2. **Expected:** Fallback logic kicks in (logs show "Legacy TAB_SWITCH")
3. **Replay:** Should still work correctly

## Future Enhancements

### Potential Improvements
1. **Tab Pooling** - Reuse closed tabs instead of always creating new ones
2. **URL Matching** - If Tab 1 already has the target URL, reuse it
3. **Tab Ordering** - Preserve tab order from recording
4. **Window Management** - Handle multi-window workflows

## Migration Notes

### For Existing Recordings
- Old recordings without `isNewTab` field will continue to work
- Fallback logic provides same behavior as before
- Recommend re-recording workflows to take advantage of smart switching

### For New Recordings
- All new recordings automatically include `isNewTab` field
- No user action required
- Better tab management out of the box

## Implementation Date
January 6, 2026

## Related Documents
- `TAB_SWITCH_RESUMPTION_FIX.md` - Visibility listener and state sharing
- `TAB_SWITCH_STORAGE_FIX.md` - Service worker storage routing
- `MULTI_TAB_RECORDING_IMPLEMENTATION.md` - Original multi-tab recording



