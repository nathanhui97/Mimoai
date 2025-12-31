# Agent Loop Stuck Fix

**Date:** December 20, 2025  
**Issue:** Agent stuck repeating the same action (clicking dropdown instead of selecting option)

---

## Problem

The agent successfully clicked the dropdown/combobox, which opened it, but then:
1. DOM map showed `[option] "BOGO"` appeared
2. AI kept returning action to click the combobox again (not the option)
3. Stuck in infinite loop on the same step

---

## Root Causes

### 1. Unclear Prompt
The AI wasn't explicitly told:
- When options appear after clicking dropdown, click the option (not the dropdown again)
- How to handle dropdown -> option selection pattern

### 2. Missing Hint Progress Logging
No visibility into whether hints were being marked as completed and currentHintIndex was advancing.

---

## Fixes Applied

### Fix 1: Improved Prompt with Dropdown Pattern

**File:** [`supabase/functions/dom_agent/index.ts`](supabase/functions/dom_agent/index.ts)

Added explicit rules:
```
CRITICAL RULES:
1. CHECK "Current Focus" - this tells you EXACTLY which step to work on next
2. If a step has ✅, it is DONE - move to the next uncompleted step
3. DROPDOWN PATTERN: If you see [option] "BOGO" in the DOM map, the dropdown is OPEN:
   - Do NOT click the combobox again
   - Click the appropriate [option] instead
   - Example: {"action": "click", "target": {"role": "option", "text": "BOGO"}}
4. Use the hintStepIndex shown in "Current Focus"
5. Don't repeat completed actions
```

Also made "Current Focus" more explicit:
```
⭐ WORK ON THIS NEXT: Step 2
Description: Click BOGO option
...
YOU MUST: Return "hintStepIndex": 2 in your response
```

### Fix 2: Added Diagnostic Logging

**File:** [`src/lib/ai-agent.ts`](src/lib/ai-agent.ts)

Added logging to track hint progression:
```typescript
console.log('[AIAgent] 📍 Current hint index:', this.state.currentHintIndex);
console.log('[AIAgent] 📤 Sending: currentHintIndex =', payload.currentHintIndex);
console.log('[AIAgent] 📤 Hints status:', hints.map(h => completed ? '✅' : '⬜'));
console.log('[AIAgent] 📥 AI returned hintStepIndex:', result.hintStepIndex);
console.log('[AIAgent] ✅ Marked hint X as completed, advanced to hint Y');
```

---

## Next Steps

### 1. Redeploy Edge Function
The prompt was updated, so you need to redeploy:
```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"
supabase functions deploy dom_agent
```

### 2. Reload Extension
- Chrome extensions → Reload your extension

### 3. Test Again
Run the workflow and watch the console for:
```
[AIAgent] 📍 Current hint index: 0
[AIAgent] 📤 Sending: currentHintIndex = 0, nextIncomplete = 1
[AIAgent] 📤 Hints status: ⬜ ⬜ ⬜ ⬜
[AIAgent] 📥 AI returned hintStepIndex: 0
[Tier1] ✅ Clicking combobox
[AIAgent] ✅ Marked hint 0 as completed, advanced to hint 1
[AIAgent] 📍 Current hint index: 1
[AIAgent] 📤 Hints status: ✅ ⬜ ⬜ ⬜
[AIAgent] 📥 AI returned hintStepIndex: 1
[Tier1] ✅ Clicking option "BOGO"  ← Should work now
```

---

## What Should Happen

### Before (Stuck Loop):
```
1. Click dropdown ✅
2. See options appear
3. AI: Click dropdown again (ignores options)
4. Click dropdown ✅
5. AI: Click dropdown again (loop forever)
```

### After (Progress):
```
1. Click dropdown ✅ (hint 0 completed, move to hint 1)
2. See options appear
3. AI: "I see [option] BOGO - I should click it, not the dropdown"
4. Click option ✅ (hint 1 completed, move to hint 2)
5. Continue to next step
```

---

## Build Status

✅ **Build successful**  
⚠️ **Redeploy required** - Edge Function prompt was updated

The diagnostic logging will help identify if the issue is:
- AI not following instructions (returns wrong hintStepIndex)
- Hint completion logic not working (hint doesn't get marked completed)
- Something else

After redeploying and reloading, the agent should progress through steps correctly.

