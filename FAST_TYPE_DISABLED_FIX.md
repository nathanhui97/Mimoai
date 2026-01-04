# Fast-Type Disabled for AI Agent + Text Strategy Fix ✅

**Date:** December 20, 2025  
**Issue:** Agent skipped clicking BOGO because fast-type closed the dropdown

---

## Problem

The workflow recording order was:
1. Click dropdown (opens it)
2. Type budget amount (closes dropdown!)
3. Click BOGO (dropdown now closed - option doesn't exist!)

The **fast-type path** was executing step 2 without letting the AI observe and decide, causing:
- Budget field got typed before BOGO was clicked
- Typing closed the dropdown
- BOGO option was no longer in DOM
- Agent failed to find BOGO

---

## Root Cause

```typescript
// BEFORE: Fast-type would execute without AI observation
if (currentHint && currentHint.actionType === 'type') {
  const fastResult = await this.tryFastType(currentHint);
  if (fastResult.success) {
    // Skips AI - just types using recorded selector
    // This closes dropdown before AI can click the option!
  }
}
```

This violated the **observe → decide → act** principle of the AI Agent.

---

## Fix: Disabled Fast-Type for AI Agent

**File:** [`src/lib/ai-agent.ts`](src/lib/ai-agent.ts)

```typescript
// FAST PATH DISABLED FOR AI AGENT
// The agent needs to observe state at each step and make decisions
// Fast-type would skip observation and blindly execute based on recorded selectors
// This causes issues like:
// - Typing in field that closes an open dropdown before clicking the option
// - Not adapting to current page state
//
// Fast-type is only useful for "replay mode" (selector-based execution)
// For AI Agent mode, we always observe → decide → act
```

Now the agent:
1. Always observes the page state
2. Lets AI decide the next action based on current state
3. Can adapt to out-of-order steps

---

## Additional Fixes

### Fix 1: Text Strategy Safety

**File:** [`src/lib/tier1-executor.ts`](src/lib/tier1-executor.ts)

```typescript
// Validate text before using
const hasValidText = target.text && 
                    target.text !== '(unlabeled)' && 
                    target.text.trim() !== '' &&
                    target.text.trim().length > 1 &&  // Skip single chars
                    !/^\d+$/.test(target.text.trim());  // Skip pure numbers

if (hasValidText && target.text) {
  strategies.push({
    type: 'text',
    value: target.text.trim(),  // Trim whitespace
    features: this.createFeatures(false, false, false),
  });
}
```

### Fix 2: Recovery Keeps Text Property

```typescript
if (isUnlabeled && currentTarget.role) {
  // Keep role AND text (if available)
  newTarget = {
    role: currentTarget.role,
    text: currentTarget.text,  // Don't drop this!
    scopeHint: currentTarget.scopeHint,
  };
}
```

### Fix 3: Strategy Debugging

Added logging to see exactly what strategies are built:
```typescript
console.log(`[Tier1] Built locator bundle with ${strategies.length} strategies:`, 
  strategies.map(s => `${s.type}:${s.value.substring(0, 20)}`));
```

---

## What Will Happen Now

### Before (Wrong Order):
```
Step 0: Click dropdown ✅ (opens it, shows BOGO option)
Step 1: Fast-type "1000" in budget ✅ (closes dropdown!)
Step 2: Click BOGO ❌ (dropdown closed, option doesn't exist)
```

### After (AI Adapts):
```
Step 0: Click dropdown ✅ (opens it, shows BOGO option)
Step 1: AI observes → sees [option] "BOGO" in DOM
        AI decides: "I should click BOGO now while dropdown is open"
Step 2: Click BOGO ✅
Step 3: AI observes → sees budget field
        AI decides: "Now I'll type 1000"
Step 4: Type "1000" ✅
```

The AI now adapts to the current page state instead of blindly following recorded order.

---

## Build Status

✅ **Build successful**  
✅ **Fast-type disabled for AI Agent**  
✅ **Text strategy safety improved**

---

## Next Steps

### 1. Redeploy Edge Function (if not already)
```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"
supabase functions deploy dom_agent
```

### 2. Reload Extension
Chrome extensions → Reload

### 3. Test Workflow
The agent should now:
- Click dropdown
- See BOGO option appear
- Click BOGO immediately (adapts to state)
- Then type budget amount
- Continue with rest of workflow

Expected console:
```
[AIAgent] 📍 Current hint index: 1
[AIAgent] ⏭️ Skipping fast-type: would skip observation  
[AIAgent] 🔍 Observing page state...
[DOMMap] Generated: 22 interactive elements (listbox + options visible)
[AIAgent] 🎯 Action: click option "BOGO"  ← Adapts to current state
[Tier1] ✅ Found via text: BOGO
[Tier1] ✅ Clicking element: LI BOGO
```

The agent is now truly adaptive and will reorder steps based on current page state!



