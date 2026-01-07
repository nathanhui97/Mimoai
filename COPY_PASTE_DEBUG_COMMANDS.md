# Copy/Paste Debug Commands

## Issue 1: Clear AI Cache (Fixes "mcdonalds" problem)

Run this in the console:
```javascript
window.clearAICache()
```

Then reload the page and try recording again.

## Issue 2: Test Keyboard Event Capture

Paste this entire code block into the console to test if keyboard events are being captured:

```javascript
// Test keyboard capture at window level
console.log('🧪 Starting keyboard capture test...');
console.log('Recording manager exists:', !!window.recordingManager);
console.log('Is recording:', window.recordingManager?.getRecordingState?.());

// Add test listener
window.testKeyboardListener = (e) => {
  const key = e.key?.toLowerCase();
  if ((key === 'c' || key === 'v') && (e.ctrlKey || e.metaKey)) {
    console.log('🧪 TEST PASSED: Copy/paste key captured at window level!', {
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      target: e.target?.tagName,
      timestamp: Date.now()
    });
  }
};

window.addEventListener('keydown', window.testKeyboardListener, true);
console.log('✅ Test listener active. Press Cmd+C or Cmd+V to test.');
console.log('📝 If you see "TEST PASSED" logs, events ARE reaching window level.');
console.log('❌ If you see nothing, Google Sheets is preventing ALL keyboard events.');
```

## To Remove Test Listener

```javascript
window.removeEventListener('keydown', window.testKeyboardListener, true);
console.log('✅ Test listener removed.');
```

## Check Recording State

```javascript
console.log('Is recording:', window.recordingManager?.getRecordingState?.());
console.log('Keyboard handler exists:', !!window.recordingManager?.keyboardHandler);
```

## Full Diagnostic Report

```javascript
console.log('=== DIAGNOSTIC REPORT ===');
console.log('Recording manager:', !!window.recordingManager);
console.log('Is recording:', window.recordingManager?.getRecordingState?.());
console.log('Keyboard handler:', !!window.recordingManager?.keyboardHandler);
console.log('Copy handler:', !!window.recordingManager?.copyHandler);
console.log('Paste handler:', !!window.recordingManager?.pasteHandler);
console.log('Document listeners:', {
  keydown: getEventListeners(document).keydown?.length || 0,
  copy: getEventListeners(document).copy?.length || 0,
  paste: getEventListeners(document).paste?.length || 0
});
console.log('Window listeners:', {
  keydown: getEventListeners(window).keydown?.length || 0
});
console.log('========================');
```

## Expected Results

### If Working Correctly:
1. Test listener shows "TEST PASSED" when you press Cmd+C/Cmd+V
2. You also see `⌨️ GhostWriter: Keyboard event with modifier:` logs
3. Recording manager is recording
4. KEYBOARD steps appear in the workflow list

### If Not Working:
1. No "TEST PASSED" log = Events not reaching window
2. "TEST PASSED" but no `⌨️` logs = Our handler isn't registered
3. `⌨️` logs but no steps = Issue in handleKeyboard() function
4. Steps created but no AI description = Cache issue or API problem

## After Testing

Once you know which scenario you're in, let me know and I can provide the specific fix.

