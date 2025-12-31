# Unlabeled Element Resolution Fix ✅

**Date:** December 20, 2025  
**Status:** Fixed

---

## Problem

The AI Agent was failing to click unlabeled elements (like unlabeled comboboxes):

```
[combobox] "(unlabeled)"
```

### Error Chain

1. **DOM Map** generates: `{ role: "combobox", name: "(unlabeled)" }`
2. **AI returns**: `{ role: "combobox", name: "(unlabeled)" }`
3. **Tier 1** builds locators:
   - `role: combobox[name="(unlabeled)"]` ← Wrong format
   - `aria: (unlabeled)` ← Tries to find `[aria-label="(unlabeled)"]`
   - `text: (unlabeled)` ← Empty selector error
4. **CandidateFinder** crashes: `querySelectorAll` error on empty selector
5. **Recovery** retries with same target ← Not actually loosening

---

## Root Causes

| Issue | Location | Problem |
|-------|----------|---------|
| Wrong role format | `tier1-executor.ts` | Used `role[name="..."]` instead of `role:name` |
| Literal "(unlabeled)" | `tier1-executor.ts` | Treated "(unlabeled)" as a real name |
| Empty selector | `candidate-finder.ts` | Tried to search for empty/unlabeled text |
| No actual loosening | `ai-agent.ts` | Recovery didn't modify target if LLM didn't provide one |

---

## Fixes Applied

### Fix 1: Handle Unlabeled Elements in Locator Builder

**File:** [`src/lib/tier1-executor.ts`](src/lib/tier1-executor.ts)

```typescript
// Check if name is actually unlabeled
const isUnlabeled = !target.name || 
                   target.name === '(unlabeled)' || 
                   target.name.trim() === '';

// For unlabeled elements, just use role (no name filter)
if (target.role && isUnlabeled) {
  strategies.push({
    type: 'role',
    value: target.role,  // Just "combobox", not "combobox:(unlabeled)"
    features: this.createFeatures(true, false, false),
  });
}

// Only add name-based strategies if actually labeled
if (target.name && !isUnlabeled) {
  strategies.push({
    type: 'role',
    value: `${target.role}:${target.name}`,  // Correct format: "button:Export"
    features: this.createFeatures(true, false, false),
  });
  
  strategies.push({
    type: 'aria',
    value: target.name,
    features: this.createFeatures(true, false, false),
  });
}
```

### Fix 2: Skip Empty Text in CandidateFinder

**File:** [`src/content/candidate-finder.ts`](src/content/candidate-finder.ts)

```typescript
private static findByText(strategy: LocatorStrategy, ...): CandidateResult[] {
  const targetText = strategy.value;
  
  // NEW: Skip empty or unlabeled text
  if (!targetText || targetText.trim() === '' || targetText === '(unlabeled)') {
    console.warn('CandidateFinder: findByText received empty or unlabeled value, skipping');
    return [];
  }
  
  // ... rest of function
}
```

### Fix 3: Manual Target Loosening in Recovery

**File:** [`src/lib/ai-agent.ts`](src/lib/ai-agent.ts)

```typescript
if (recoveryDecision.strategy === 'RETRY_LOOSER') {
  let newTarget = recoveryDecision.refinedTarget;
  
  // If LLM didn't provide a refined target, loosen manually
  if (!newTarget && currentAction.params.target) {
    const currentTarget = currentAction.params.target;
    const isUnlabeled = !currentTarget.name || 
                       currentTarget.name === '(unlabeled)' ||
                       currentTarget.name.trim() === '';
    
    if (isUnlabeled && currentTarget.role) {
      // Just use role, drop the name requirement
      newTarget = {
        role: currentTarget.role,
        scopeHint: currentTarget.scopeHint,
      };
    }
  }
  
  currentAction.params.target = newTarget || currentAction.params.target;
}
```

---

## How It Works Now

### For Unlabeled Combobox

**Before:**
```
AI: { role: "combobox", name: "(unlabeled)" }
Tier1: Tries to find [aria-label="(unlabeled)"] → NOT_FOUND
Recovery: Retries with same target → NOT_FOUND again
```

**After:**
```
AI: { role: "combobox", name: "(unlabeled)" }
Tier1: Detects unlabeled, searches [role="combobox"] (no name filter) → FOUND ✅
```

### For Labeled Elements

**Before:**
```
AI: { role: "button", name: "Export" }
Tier1: role strategy with wrong format → parsing error
```

**After:**
```
AI: { role: "button", name: "Export" }
Tier1: Correct format "button:Export" → FOUND ✅
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/tier1-executor.ts` | Detect unlabeled elements, use correct role format |
| `src/content/candidate-finder.ts` | Skip empty/unlabeled text in findByText |
| `src/lib/ai-agent.ts` | Manual target loosening in recovery loop |

---

## Build Status

✅ **0 TypeScript errors**  
✅ **0 Linter errors**  
✅ **Build successful**

---

## Testing

After reloading the extension, the agent should:

1. **Successfully click unlabeled comboboxes** using `[role="combobox"]`
2. **Not crash on empty text** - CandidateFinder skips it
3. **Actually loosen targets** on RETRY_LOOSER - removes name requirements

Expected console logs:
```
[Tier1] Building locator for unlabeled combobox
[Tier1] Resolving element with 1 strategies
[Tier1] ✅ Found via role: combobox
```

---

## Next Steps

1. **Reload the extension** in Chrome
2. **Try the workflow again** with AI Agent mode
3. **Should see successful resolution** of the unlabeled combobox

The agent should now work on pages with unlabeled form elements!

