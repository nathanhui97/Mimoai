# Hybrid Spreadsheet Engine (v2 - Fixed Skip Bug)

## The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     RECORDING                                │
│  User clicks A2 → types "nathan" → clicks B2 → types email  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   RECORDED HINT                              │
│                                                              │
│  Hint 1: actionType="type", value="nathan", ariaLabel="A2"  │
│  Hint 2: actionType="click", ariaLabel="B2"                 │
│  Hint 3: actionType="type", value="email", ariaLabel="B2"   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│        HARDCODED ENGINE (IGNORES AI, USES HINT)             │
│                                                              │
│  Checks: Is hint.actionType === 'type'? YES                 │
│  Extracts: cellRef from ariaLabel = "A2"                    │
│  Extracts: text from hint.value = "nathan"                  │
│  Executes: SpreadsheetExecutor.typeInCell("A2", "nathan")   │
│                                                              │
│  - IGNORES what AI says (even if AI says "skip")           │
│  - Uses HINT data directly                                   │
│  - Just types reliably using execCommand                     │
└─────────────────────────────────────────────────────────────┘
```

## The Bug That Was Fixed (v2)

**Problem:** AI was returning `{"action":"skip"}` for type actions, thinking the cell already had data.

```
Hint: "Enter 'nathan' in A2"
AI Response: {"action": "skip", "reasoning": "A2 already contains 'nathan'"}
                       ^^^^
Old code checked: currentAction.type === 'type' → FALSE (it's 'skip')
Result: Hardcoded engine never fired!
```

**Solution:** Check the **HINT**, not the AI's action:

```typescript
// OLD (broken): Check AI's action
if (currentAction.type === 'type' && ...) { ... }

// NEW (fixed): Check the HINT's action type
const hintIsType = currentHint?.actionType === 'type';
const textToType = currentAction.params.text || currentHint?.value;
if (hintIsType && textToType && cellRef) { ... }
```

Now AI can't skip spreadsheet type actions - we execute from the hint!

## What Changed

### 1. AI Prompt (dom_agent edge function)
- Simplified prompt for spreadsheets
- AI MUST return `cellRef` for all spreadsheet actions
- Format: `{"action": "type", "cellRef": "A2", "text": "nathan"}`

### 2. act() Method (ai-agent.ts)
Added hardcoded spreadsheet engine BEFORE the recovery loop:

```typescript
// If we're on a spreadsheet and have cellRef + text → type directly!
if (cellRef && currentAction.type === 'type' && currentAction.params.text) {
  const result = await SpreadsheetExecutor.execute({
    action: 'type_in_cell',
    cellRef: cellRef,
    text: currentAction.params.text,
    clearFirst: true
  });
  if (result.success) return { success: true };
}
```

### 3. Cell Reference Extraction
The engine tries multiple sources for cellRef:
1. AI's returned `cellRef` (preferred)
2. `recordedAriaLabel` from hint (e.g., "A2")
3. Fallback selectors with `[aria-label="B2"]` pattern

## Why This Works

| Problem Before | Solution Now |
|----------------|--------------|
| AI saw "nathan" scope → Skipped thinking A2 already filled | No skip logic - if hint says type, we type |
| Interception was complex and buggy | Simple: AI provides cellRef, engine types |
| Duplicate clicks and wrong cells | Deterministic execution based on cellRef |

## Test It Now

1. **Reload extension**: `chrome://extensions` → Reload Autoflow
2. **Refresh Google Sheets**: Cmd+Shift+R
3. **Clear cells** in your spreadsheet
4. **Execute your workflow**

### Expected Console Logs

```
[AIAgent] 📊 HARDCODED SPREADSHEET TYPE: A2 = "nathan"
[AIAgent] ✅ Successfully typed via hardcoded spreadsheet engine

[AIAgent] 📊 HARDCODED SPREADSHEET TYPE: B2 = "email@test.com"
[AIAgent] ✅ Successfully typed via hardcoded spreadsheet engine
```

## Flow Summary

1. **AI thinks**: Extracts cellRef from hint, returns `type` action with cellRef
2. **Hardcoded engine intercepts**: Sees cellRef + text on spreadsheet
3. **SpreadsheetExecutor executes**: 
   - Navigates to cell via Name Box
   - Presses F2 to enter edit mode
   - Uses `execCommand('insertText')` to type
   - Presses Enter to commit
4. **Success**: Next hint

No AI skip logic. No complex interception. Just reliable typing!

