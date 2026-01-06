# Tab Switch Resumption Fix

## Problem

AI agent workflows with tab switching (e.g., copying data from Google Sheets to Salesforce and back) were not working. The agent would successfully switch tabs during recording, but during replay:

1. **Tab 0 (Sheets)** → Agent starts execution, encounters TAB_SWITCH step
2. **Agent saves state** → Switches to Tab 1 (SFDC)
3. **Tab 1 (SFDC)** → ❌ Agent execution does NOT resume
4. **Workflow hangs** → User has to manually restart

## Root Causes

### Cause 1: No Tab Visibility Listener

The auto-resume logic in `content-script.ts` only ran **once on page load**:

```typescript
// Old code - only checked on page load
(async () => {
  await new Promise(resolve => setTimeout(resolve, 500));
  const result = await chrome.storage.local.get(['agentState']);
  if (savedState && savedState.status === 'running') {
    // Resume agent...
  }
})();
```

**Problem:** When switching to an already-loaded tab:
- The page doesn't reload
- Content script doesn't re-initialize  
- Auto-resume code never runs again
- Agent state sits in storage, but nothing checks for it

### Cause 2: TabManager State Not Shared Across Tabs

Each browser tab has its own isolated JavaScript context (`window` object). The TabManager was stored in each tab's `window`:

```typescript
// Old code - stored in tab-local window object
(window as any).__ghostwriter_tab_manager = new TabManager(currentTabId);
```

**Problem:** When switching tabs:
- **Tab 0**: Creates TabManager with mappings `{Tab 0 → ID 123}`
- **Tab 1**: Creates NEW TabManager with mappings `{Tab 1 → ID 456}`
  - This new TabManager doesn't know about Tab 0!
  - When trying to switch back to Tab 0, `hasTab(0)` returns false
  - Agent can't find the tab to switch to

## Solution

### Fix 1: Visibility Change Listener

Added a `visibilitychange` listener that checks for saved agent state whenever a tab becomes visible:

```typescript
// Listen for tab visibility changes (critical for tab switching!)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    console.log('[Content] 👀 Tab became visible, checking for agent state...');
    await new Promise(resolve => setTimeout(resolve, 200));
    await checkAndResumeAgent('tab_visible');
  }
});
```

**How it works:**
1. Agent in Tab 0 saves state and switches to Tab 1
2. Tab 1 becomes visible → fires `visibilitychange` event
3. Listener checks `chrome.storage.local` for saved state
4. Finds state → resumes agent execution ✅

### Fix 2: Shared TabManager State

Modified TabManager to persist state through the service worker (bypasses content script storage restrictions):

```typescript
export class TabManager {
  async initialize(): Promise<void> {
    // Load existing state via service worker (bypasses content script restrictions)
    // Google Sheets and other sites block direct chrome.storage access
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_MANAGER_STATE' });
    const savedState = response?.data;
    
    if (savedState) {
      // Restore existing mappings
      this.tabMap = new Map(savedState.tabMap);
      this.tabInfo = new Map(savedState.tabInfo);
      console.log('[TabManager] ✅ Restored state from storage');
    }
  }
  
  private async persistState(): Promise<void> {
    const state = {
      tabMap: Array.from(this.tabMap.entries()),
      tabInfo: Array.from(this.tabInfo.entries()),
      currentTabId: this.currentTabId,
    };
    await chrome.runtime.sendMessage({ 
      type: 'SET_TAB_MANAGER_STATE', 
      payload: { state } 
    });
  }
  
  // Clear state when workflow completes
  static async clearStorage(): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'CLEAR_TAB_MANAGER_STATE' });
  }
}
```

**Service Worker Handlers:**
```typescript
// Service worker handles storage operations (has full API access)
if (message.type === 'GET_TAB_MANAGER_STATE') {
  chrome.storage.local.get(['tabManagerState'], (result) => {
    sendResponse({ success: true, data: result.tabManagerState });
  });
}

if (message.type === 'SET_TAB_MANAGER_STATE') {
  chrome.storage.local.set({ tabManagerState: message.payload.state }, () => {
    sendResponse({ success: true });
  });
}
```

**How it works:**
1. **Tab 0**: Creates TabManager → saves `{Tab 0 → 123}` to `chrome.storage.session`
2. **Tab 1**: Creates TabManager → **loads from storage** → knows about Tab 0
3. **Tab 1**: Registers itself → saves `{Tab 0 → 123, Tab 1 → 456}`
4. **Switch back to Tab 0**: TabManager checks `hasTab(0)` → TRUE ✅ → switches correctly!

### Fix 3: Refactored Resume Logic

Extracted agent resumption into a reusable function with safeguards:

```typescript
// Track if agent is currently resuming to prevent duplicate resumptions
let isResumingAgent = false;

async function checkAndResumeAgent(trigger: 'page_load' | 'tab_visible'): Promise<void> {
  // Prevent duplicate resumptions
  if (isResumingAgent) {
    console.log(`[Content] ⏭️ Agent already resuming, skipping ${trigger} trigger`);
    return;
  }
  
  isResumingAgent = true;
  
  try {
    // Check for saved state and resume...
  } finally {
    isResumingAgent = false;
  }
}
```

**Benefits:**
- Single source of truth for resume logic
- Prevents race conditions (multiple visibility events)
- Used by both page load AND tab visibility triggers

## Files Modified

### 1. `src/content/content-script.ts`
- ✅ Added `checkAndResumeAgent()` function to encapsulate resume logic
- ✅ Added `isResumingAgent` flag to prevent duplicate resumptions
- ✅ Added `visibilitychange` listener to detect tab switches
- ✅ Refactored page load check to use `checkAndResumeAgent()`

### 2. `src/content/universal-execution/tab-manager.ts`
- ✅ Added `initialize()` method to load shared state from `chrome.storage.session`
- ✅ Added `persistState()` method to save state after changes
- ✅ Updated `registerTab()` to persist after registration
- ✅ Updated `switchToTab()` to persist after switching
- ✅ Updated `openNewTab()` to persist after creating

### 3. `src/lib/ai-agent.ts`
- ✅ Updated tab_switch handler to call `tabManager.initialize()` after creation
- ✅ Ensures TabManager loads shared state before use

## How It Works Now

### Successful Tab Switching Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Tab 0 (Google Sheets)                                       │
├─────────────────────────────────────────────────────────────┤
│ 1. Agent starts → creates TabManager                        │
│    - Loads from storage (empty initially)                   │
│    - Registers Tab 0 → ID 123                               │
│    - Persists: {Tab 0 → 123}                                │
│                                                             │
│ 2. Agent executes steps...                                  │
│                                                             │
│ 3. Encounters TAB_SWITCH hint to Tab 1                      │
│    - Saves agent state to chrome.storage.local              │
│    - Calls tabManager.switchToTab(1)                        │
│    - TabManager checks: hasTab(1)? → FALSE                  │
│    - Opens new tab at Salesforce URL                        │
│    - Registers Tab 1 → ID 456                               │
│    - Persists: {Tab 0 → 123, Tab 1 → 456}                   │
│    - Activates Tab 1                                        │
│    - Agent returns with finalStatus: 'running'              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Tab 1 (Salesforce) - becomes visible                        │
├─────────────────────────────────────────────────────────────┤
│ 4. visibilitychange event fires                             │
│    - checkAndResumeAgent('tab_visible') called              │
│                                                             │
│ 5. Checks chrome.storage.local                              │
│    - Finds saved agent state!                               │
│    - status: 'running'                                      │
│    - transferredToTab: true                                 │
│                                                             │
│ 6. Creates TabManager for Tab 1                             │
│    - Calls initialize()                                     │
│    - Loads from storage: {Tab 0 → 123, Tab 1 → 456}        │
│    - Now knows about BOTH tabs!                             │
│                                                             │
│ 7. Resumes agent execution                                  │
│    - Agent continues from saved state                       │
│    - Executes next steps in Salesforce...                   │
│                                                             │
│ 8. Encounters TAB_SWITCH back to Tab 0                      │
│    - Saves state again                                      │
│    - Calls tabManager.switchToTab(0)                        │
│    - TabManager checks: hasTab(0)? → TRUE ✅                │
│    - Activates Tab 0 (no new tab created!)                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Tab 0 (Google Sheets) - becomes visible again               │
├─────────────────────────────────────────────────────────────┤
│ 9. visibilitychange event fires                             │
│    - checkAndResumeAgent('tab_visible') called              │
│                                                             │
│ 10. Checks chrome.storage.local                             │
│     - Finds saved state!                                    │
│                                                             │
│ 11. Creates/reuses TabManager                               │
│     - Loads shared state: {Tab 0 → 123, Tab 1 → 456}       │
│                                                             │
│ 12. Resumes agent execution                                 │
│     - Continues with remaining steps...                     │
│     - Can switch back and forth as many times as needed!    │
└─────────────────────────────────────────────────────────────┘
```

## Testing

### Test Case 1: Simple Tab Switching
1. Record workflow: Sheets → SFDC → Sheets
2. Replay workflow
3. ✅ Verify agent switches tabs correctly
4. ✅ Verify no duplicate tabs are created

### Test Case 2: Multiple Back-and-Forth Switches
1. Record workflow with 4+ tab switches
2. Replay workflow
3. ✅ Verify all switches work
4. ✅ Check console logs show state persistence

### Test Case 3: Tab Already Open
1. Open both Sheets and SFDC tabs manually
2. Record workflow that switches between them
3. Replay workflow
4. ✅ Verify agent reuses existing tabs (doesn't create new ones)

## Benefits

✅ **Tab switching now works** - Agent can switch back and forth between tabs
✅ **No duplicate tabs** - TabManager knows about all tabs via shared storage
✅ **Fast resumption** - Visibility listener triggers immediately when tab becomes active
✅ **Robust** - Duplicate resumption prevention, error handling, proper state cleanup
✅ **Chrome storage API compliant** - Uses `chrome.storage.local` for broad compatibility
✅ **Auto cleanup** - Tab mappings cleared at start of each workflow

## Notes

### Storage API Choice
- **Originally tried `chrome.storage.session`** but discovered it's restricted in some contexts
- **Error encountered:** `Access to storage is not allowed from this context` (in Google Sheets)
- **Solution:** Switched to `chrome.storage.local` which has broader access
- Tab mappings are explicitly cleared at the start of each workflow execution
- Each workflow gets a fresh TabManager with new mappings

### Implementation Details
- The visibility listener runs in all tabs, but only resumes when there's saved state
- TabManager initialization gracefully handles storage access errors
- If storage fails, TabManager operates without persistence (for that tab only)
- State is cleared via `TabManager.clearStorage()` when workflow starts

