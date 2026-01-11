# Debugging Label Extraction Issues

## Quick Checklist

If the AI doesn't know where to type:

1. ✅ **Rebuild**: `npm run build`
2. ✅ **Reload extension**: chrome://extensions → refresh icon
3. ✅ **Close and reopen** sidepanel
4. ✅ **Try workflow again**

## Console Log Locations

### Sidepanel Console (Right-click sidepanel → Inspect)

Look for these log messages when loading a workflow:

```
[HintExtractor] Using label/placeholder as targetText for INPUT: "Account Name"
```

If you DON'T see this, the label extraction is not working.

### Page Console (F12 on Salesforce page)

Look for these messages during execution:

```
[AIAgent] 📤 CURRENT HINT DETAILS: {
  description: "...",
  targetText: "...",
  recordedAriaLabel: "Account Name",  ← SHOULD BE PRESENT FOR INPUT FIELDS
  recordedScopeHint: "Account Information"
}
```

If `recordedAriaLabel` is undefined, the hint extraction failed.

### Execution Logs (What AI Sees)

When the AI tries to type:

```
[Tier1] 📝 Type action params: {
  hasFieldTarget: true,
  fieldTarget: { role: 'textbox', name: 'Account Name', ... }
}
```

If `hasFieldTarget: false` or `name: undefined`, the AI doesn't have the field label.

## What Each Log Means

### ✅ GOOD - Labels are extracted:

```
[HintExtractor] Using label/placeholder as targetText for INPUT: "Account Name"
[AIAgent] 📤 CURRENT HINT DETAILS: { recordedAriaLabel: "*Account Name" }
[Tier1] 📝 Type action params: { fieldTarget: { name: "Account Name" } }
```

### ❌ BAD - Labels are missing:

```
[AIAgent] 📤 CURRENT HINT DETAILS: { recordedAriaLabel: undefined }
[Tier1] 📝 Type action params: { fieldTarget: null }
[Tier1] ⚠️ No fieldTarget provided, using activeElement
```

## Inspection Commands

### Check if new workflow has labels:

```bash
# In Mimoai directory
cat ~/Downloads/ghostwriter-*.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, step in enumerate(data['steps']):
    if step['type'] == 'INPUT':
        p = step.get('payload', {})
        ai = p.get('aiEvidence', {})
        sa = ai.get('semanticAnchors', {})
        print(f'Step {i+1} (INPUT):')
        print(f'  textLabel: {sa.get(\"textLabel\")}')
        print(f'  ariaLabel: {sa.get(\"ariaLabel\")}')
        print(f'  payload.label: {p.get(\"label\")}')
        print()
" | head -50
```

### Check extracted hints in browser console:

In the sidepanel console, after loading a workflow, type:

```javascript
// Check what hints were extracted
chrome.storage.local.get('ghostwriter-current-workflow', (result) => {
  const hints = result['ghostwriter-current-workflow']?.hints || [];
  hints.forEach((h, i) => {
    if (h.actionType === 'type') {
      console.log(`Step ${i+1}:`, {
        actionType: h.actionType,
        recordedAriaLabel: h.recordedAriaLabel,
        targetText: h.targetText,
        value: h.value
      });
    }
  });
});
```

## Troubleshooting Steps

1. **If hints show `recordedAriaLabel: undefined`**:
   - Check the workflow JSON file - does step have `aiEvidence.semanticAnchors.textLabel` or `ariaLabel`?
   - If yes, the extraction is broken
   - If no, the recording didn't capture labels

2. **If hints show correct labels but execution fails**:
   - Check the page console for `[Tier1] 📝 Type action params`
   - If `fieldTarget` is null, check `[AIAgent]` logs for what the LLM decided
   - The LLM might not be returning a `fieldTarget` in its response

3. **If recording didn't capture labels**:
   - This is a different bug in the recording phase
   - Check `recording-manager.ts` and `label-finder.ts`

## Quick Test

After rebuilding, load your workflow and check the sidepanel console. You should see:

```
[HintExtractor] Using label/placeholder as targetText for INPUT: "<field name>"
```

If you don't see this, the issue is in hint extraction (our fix).
If you do see this, the issue is in execution (different problem).
