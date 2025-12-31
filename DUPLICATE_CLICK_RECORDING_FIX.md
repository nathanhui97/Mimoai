# Duplicate Click Recording Fix

## Issue
One click was being recorded as 4 different clicks in the side panel.

## Root Cause
The issue was caused by the message listener in `src/sidepanel/App.tsx` being re-registered multiple times due to unstable dependencies in the `useEffect` hook.

### The Problem
```typescript
useEffect(() => {
  const handleMessage = (...) => {
    if (message.type === 'RECORDED_STEP') {
      addWorkflowStep(message.payload.step);
    }
    // ...
  };
  
  chrome.runtime.onMessage.addListener(handleMessage);
  return () => {
    chrome.runtime.onMessage.removeListener(handleMessage);
  };
}, [addWorkflowStep, updateWorkflowStep, setAIValuationPending, setStepEnhanced]); // ❌ Dependencies cause re-registration
```

The dependencies `[addWorkflowStep, updateWorkflowStep, setAIValuationPending, setStepEnhanced]` were causing the useEffect to re-run, which would:
1. Register a new message listener
2. NOT properly clean up the old listener (due to closure issues)
3. Result in multiple listeners all handling the same message

This created a multiplication effect where each click message was handled by multiple listeners, causing duplicate step additions.

## Solution

### 1. Fixed Message Listener Registration (Primary Fix)
Changed the `useEffect` to use an empty dependency array and access store actions directly:

```typescript
useEffect(() => {
  const handleMessage = (...) => {
    if (message.type === 'RECORDED_STEP') {
      // Use store actions directly instead of from hook
      useExtensionStore.getState().addWorkflowStep(message.payload.step);
    }
    // ...
  };
  
  console.log('[App] Registering message listener');
  chrome.runtime.onMessage.addListener(handleMessage);
  
  return () => {
    console.log('[App] Removing message listener');
    chrome.runtime.onMessage.removeListener(handleMessage);
  };
}, []); // ✅ Empty deps - listener registered only once
```

**Benefits:**
- Listener is registered exactly once when component mounts
- Listener is properly cleaned up when component unmounts
- No stale closures - always uses latest store actions via `getState()`

### 2. Added Duplicate Prevention Guard (Defense-in-Depth)
Added a safeguard in the store to prevent duplicate step additions based on timestamp:

```typescript
addWorkflowStep: (step: WorkflowStep) => {
  set((state) => {
    // Prevent duplicate steps based on timestamp (within 100ms window)
    const stepTimestamp = step.payload.timestamp;
    const isDuplicate = state.workflowSteps.some(
      (existingStep) => Math.abs(existingStep.payload.timestamp - stepTimestamp) < 100
    );
    
    if (isDuplicate) {
      console.warn('[Store] Prevented duplicate step addition:', step.type, stepTimestamp);
      return state; // Return unchanged state
    }
    
    return {
      workflowSteps: [...state.workflowSteps, step],
    };
  });
},
```

**Benefits:**
- Provides an additional layer of protection
- Guards against any future duplicate message issues
- Uses timestamp-based deduplication (100ms window)

## Files Changed
1. `src/sidepanel/App.tsx` - Fixed message listener registration
2. `src/lib/store.ts` - Added duplicate prevention guard

## Testing
To test the fix:
1. Reload the extension (chrome://extensions → Reload)
2. Open sidepanel
3. Start recording
4. Click on a dropdown to open it
5. Click on a dropdown option
6. Stop recording
7. Verify that only 2 clicks are recorded (not 4 or more)

## Console Logs to Monitor
Look for these logs in the console:
- `[App] Registering message listener` - Should appear exactly once when sidepanel opens
- `[App] Removing message listener` - Should appear when sidepanel closes
- `[Store] Prevented duplicate step addition:` - Should NOT appear if fix works correctly

## Prevention
To prevent similar issues in the future:
1. Use empty dependency arrays `[]` for message listeners that should register once
2. Access Zustand store actions via `useExtensionStore.getState()` when in message handlers
3. Add timestamp-based deduplication guards for critical operations
4. Add console logs to track listener registration/removal during development






