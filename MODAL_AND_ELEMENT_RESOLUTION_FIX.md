# Modal and Element Resolution Fix ✅

**Date:** December 20, 2025  
**Issues Fixed:**
1. Agent getting stuck on modal/popup - couldn't find elements
2. Empty selector crashes (`text: "0"` or single characters)
3. TypeError in DOM map generation (`toLowerCase()` on undefined)
4. Modal form fields not shown to AI
5. TestID and ID attributes not being used

---

## Root Causes

### 1. Empty/Invalid Text Values
AI was returning:
- `text: "0"` (pure number)
- `text: ""` (empty)
- `text: "Continue"` but value was actually "Continue\n" or had whitespace

These caused `querySelectorAll('')` → crash

### 2. Modal Form Fields Hidden
Modal detection worked, but:
- Form fields from page were mixed with modal fields
- AI couldn't see the modal form fields clearly
- No distinction between modal content and page content

### 3. TypeError in getInputRole
```typescript
const type = el.type.toLowerCase();  // el.type was undefined
```

### 4. TestID Not Prioritized
Workflow has `testid="promotionContinue"` for Continue button, but:
- Not shown prominently in DOM map
- Not told to AI that testid is most reliable
- tier1-executor wasn't using it properly

---

## Fixes Applied

### Fix 1: Skip Invalid Text Values

**File:** [`src/lib/tier1-executor.ts`](src/lib/tier1-executor.ts)

```typescript
// Text content (only if valid and not a number/single char)
if (target.text && 
    target.text !== '(unlabeled)' && 
    target.text.trim() !== '' &&
    target.text.length > 1 &&        // Skip single characters
    !/^\d+$/.test(target.text)) {    // Skip pure numbers like "0", "100"
  strategies.push({
    type: 'text',
    value: target.text,
    features: this.createFeatures(false, false, false),
  });
}
```

### Fix 2: Proper Modal Isolation

**File:** [`src/content/dom-map.ts`](src/content/dom-map.ts)

```typescript
const modal = findActiveModal();
if (modal) {
  // Get modal-specific content
  const modalFormFields = getFormFields(modal);
  const modalInteractiveElements = getInteractiveElements(modal);
  
  map.activeModal = { title, elements: modalInteractiveElements };
  
  // When modal is active, ONLY return modal content
  map.formFields = modalFormFields;          // Only modal fields
  map.interactiveElements = modalInteractiveElements;  // Only modal actions
} else {
  // No modal - get page content
  map.formFields = getFormFields(document.body);
  map.interactiveElements = getInteractiveElements(document.body);
}
```

### Fix 3: Safe Type Access

**File:** [`src/content/dom-map.ts`](src/content/dom-map.ts)

```typescript
function getInputRole(el: HTMLInputElement): string {
  const type = (el.type || 'text').toLowerCase();  // Default to 'text' if undefined
  // ... rest
}
```

### Fix 4: TestID and ID Support

**Added to SemanticTarget:**
```typescript
export interface SemanticTarget {
  testId?: string;  // data-testid (highest priority)
  id?: string;      // id attribute (also very stable)
  // ... rest
}
```

**Updated tier1-executor:**
```typescript
// ID attribute (also very stable)
if (target.id) {
  strategies.push({
    type: 'css',
    value: `#${target.id}`,  // #budgetAmount, #restFunding
    features: this.createFeatures(true, true, false),
  });
}
```

**Updated DOM map format:**
```typescript
function formatElement(el: DOMMapElement): string {
  let line = `[${el.role}] "${el.name}"`;
  
  // Show testid FIRST (most stable)
  if (el.attrs?.testId) {
    line += ` testid="${el.attrs.testId}"`;
  }
  
  if (el.attrs?.id) {
    line += ` id="${el.attrs.id}"`;
  }
  
  // ... rest
}
```

**Updated Edge Function prompt:**
```
IMPORTANT: If the DOM map shows testid="..." USE IT - it's the most reliable!

{
  "target": {
    "testId": "promotionContinue",  // Use this if available!
    "role": "button",
    "name": "Continue"
  }
}
```

### Fix 5: Better Modal Element Capture

```typescript
const interactiveSelector = [
  'button', '[role="button"]',
  // ... existing ...
  
  // Modal-specific
  '[data-dismiss]', '[data-close]',
  '[aria-label*="close" i]',
  '[aria-label*="confirm" i]',
  '[class*="btn"]',          // Common button classes
  '[class*="Button"]',
].join(', ');
```

---

## What Will Happen Now

### Before (Fails on Modal):
```
1. Modal appears with form
2. DOM map shows: "14 interactive elements, 1 form fields"  (page content mixed in)
3. AI tries to click "Continue" → text: "Continue"
4. Text strategy: empty selector → crash
5. NOT_FOUND x3 → Give up
```

### After (Handles Modal):
```
1. Modal appears with form
2. DOM map shows: "=== ACTIVE MODAL: dialog ===
   ## Form Fields in Modal
   [textbox] "Budget Amount" id="budgetAmount"
   [spinbutton] "Restaurant Funding" id="restFunding"
   
   ## Modal Actions
   [button] "Continue" testid="promotionContinue"
   [button] "Cancel"
```

3. AI sees testid, returns: `{ testId: "promotionContinue", role: "button", name: "Continue" }`
4. Tier1 tries testid strategy first: `#promotionContinue` → Found ✅
5. Clicks Continue → Success
```

---

## Build Status

✅ **Build successful**  
⚠️ **Redeploy required** - Edge Function prompt updated

---

## Next Steps

### 1. Redeploy Edge Function
```bash
cd "/Users/nathhui/Documents/Autoflow chrome extension"
supabase functions deploy dom_agent
```

### 2. Reload Extension
- Chrome extensions → Reload

### 3. Test Workflow
The agent should now:
- See modal form fields properly
- Use testid/id attributes (most reliable)
- Skip invalid text values (no crashes)
- Successfully click Continue button in modal
- Complete the full workflow

Expected console logs:
```
[DOMMap] 🔔 Active modal detected: "dialog" with 3 interactive elements and 17 form fields
[AIAgent] 🎯 Action: click Target: {testId: 'promotionContinue', role: 'button', name: 'Continue'}
[Tier1] Resolving element with 4 strategies
[Tier1] ✅ Found via testid
[Tier1] ✅ Clicking element: BUTTON Continue
[AIAgent] ✅ Action succeeded
```

The agent should now complete the full workflow without getting stuck on modals!

