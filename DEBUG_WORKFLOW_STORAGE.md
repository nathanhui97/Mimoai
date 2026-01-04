# Debug Workflow Storage Issue

## Check What's Actually in Storage

On the Gainsight page, open DevTools Console and run:

```javascript
// Check what workflows are stored
chrome.storage.local.get('ghostwriter-workflows', (result) => {
  const workflows = result['ghostwriter-workflows'] || [];
  console.log('📁 Stored workflows:', workflows.length);
  
  workflows.forEach((w, i) => {
    console.log(`\n${i + 1}. Workflow:`, {
      id: w.id,
      name: w.name,
      created: new Date(w.createdAt).toLocaleString(),
      steps: w.steps.length,
      optimizedSteps: w.optimizedSteps?.length || 'none',
      firstStepType: w.steps[0]?.type,
      firstStepHasPayload: !!w.steps[0]?.payload,
      firstStepPayloadKeys: w.steps[0]?.payload ? Object.keys(w.steps[0].payload) : [],
    });
    
    // Check SCROLL steps specifically
    const scrollSteps = w.steps.filter(s => s.type === 'SCROLL');
    console.log(`   SCROLL steps: ${scrollSteps.length}`);
    scrollSteps.forEach((s, idx) => {
      const payload = s.payload || {};
      console.log(`   SCROLL ${idx + 1}:`, {
        hasElementScrollContainer: !!payload.elementScrollContainer,
        hasScrollContainer: !!payload.scrollContainer,
        payloadKeys: Object.keys(payload),
        isEmpty: Object.keys(payload).length === 0,
      });
    });
  });
});
```

## Expected vs Actual

### If Storage is Correct
You should see:
- **ONE workflow** with ID ending in `...630359`
- SCROLL steps with `hasElementScrollContainer: true`
- `payloadKeys: ["elementScrollContainer", "selector", ...]`

### If Storage is Corrupted
You might see:
- Multiple workflows with different IDs
- OLD workflow ID `...594596` still there
- SCROLL steps with `isEmpty: true` or `payloadKeys: []`

## Fix Based on Results

### If OLD workflow is still there:
```javascript
// Nuclear option: Delete ALL workflows
chrome.storage.local.remove('ghostwriter-workflows', () => {
  console.log('✅ All workflows deleted from storage');
  location.reload();
});
```

### If payload is empty in storage:
The workflow was saved wrong - you need to re-record with the extension fully reloaded.

