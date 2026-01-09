# Testing Chain of Thought Display

## Quick Test (2 minutes)

### 1. Reload Extension
```bash
# In Chrome:
1. Go to chrome://extensions
2. Find "mimoai"
3. Click the reload icon 🔄
```

### 2. Record a Simple Workflow
```
1. Open the sidepanel
2. Navigate to any website (e.g., Google, GitHub)
3. Click "Show me how to do this task"
4. Perform 3-5 actions:
   - Click a button
   - Type in a search box
   - Click another link
5. Click "Done"
6. Save the workflow with any name
```

### 3. Run and Watch the AI Think
```
1. Click "Run" on your saved workflow
2. Watch the ThinkingPanel appear
3. You should see:
   ✓ Progress bar updating (0% → 100%)
   ✓ Step checklist with indicators (✓ → ○)
   ✓ "Observing page..." with URL and element counts
   ✓ "Decision: click/type" with confidence %
   ✓ "Action completed" with timing
```

## What to Look For

### ✅ Good Signs
- Panel appears immediately when clicking "Run"
- Progress bar animates smoothly
- Step indicators update in real-time
- Observations show current URL
- Decisions show what AI plans to do
- Actions show success/failure
- Panel stays visible for 3 seconds after completion

### ⚠️ Potential Issues
- Panel doesn't appear → Check browser console for errors
- Events don't update → Check thinking events in console: `message.type === 'AGENT_THINKING'`
- Steps stuck at 0% → Check if `stepIndex` and `stepTotal` are correct

## Console Verification

Open DevTools Console and check for:
```javascript
// You should see these logs:
[AIAgent] 🔍 Observing page state...
[AIAgent] Action: click
[AIAgent] Reasoning: ...
```

## Example Test Workflow

### Google Search Test
1. Go to google.com
2. Record:
   - Click search box
   - Type "chrome extensions"
   - Click "Google Search" button
3. Save as "Google Search Test"
4. Run and watch:
   - Observe: "Found X input fields"
   - Decide: "Type 'chrome extensions'" (confidence ~95%)
   - Act: "Action completed (150ms)"

## Troubleshooting

### Panel doesn't show
```bash
# Check if events are being sent:
# In sidepanel console:
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_THINKING') {
    console.log('Thinking event:', msg.payload);
  }
});
```

### Build failed
```bash
cd /Users/nathhui/Mimoai
npm run build
# Should complete without TypeScript errors
```

### Events arrive but UI doesn't update
- Check React DevTools
- Verify `thinkingEvents` state is updating
- Check if `ThinkingPanel` is rendered
- Verify `isAgentRunning` is true

## Success Criteria

✅ You successfully tested Chain of Thought if:
1. ThinkingPanel appears when running a workflow
2. You can see the AI's observations
3. You can see the AI's decisions with reasoning
4. You can see action results (success/failure)
5. Progress bar updates from 0% to 100%
6. Step checklist shows which steps are done/current/pending

## Next: Report Results

After testing, let the developer know:
- Did it work? (Yes/No)
- What did you see?
- Any errors in console?
- Any unexpected behavior?
