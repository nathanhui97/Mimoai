# Debug Element Interactivity Issue

## Issue
When typing on a column in the promotion setup page, getting error:
```
GhostWriter: Could not find visible, interactive element for click. 
Original element: INPUT 
Visible: true 
Overlay: false
```

## Root Cause
The element IS visible but is not being considered "interactive" by the `isInteractiveElement()` method.

Looking at the code in `src/content/recording/element-finder.ts` (lines 121-169), the `isInteractiveElement()` method only considers these INPUT types as interactive:
- `button`
- `submit`
- `checkbox`
- `radio`

**Regular text inputs (type="text", type="email", etc.) are NOT included!**

## Debug Steps

### Step 1: Inspect the Element in Browser Console

While on the promotion setup page, open DevTools Console and paste this:

```javascript
// Click on the input field, then immediately run this in console:
const el = document.activeElement;
console.log('Element Details:', {
  tagName: el.tagName,
  type: el.type,
  className: el.className,
  id: el.id,
  computedStyle: {
    cursor: getComputedStyle(el).cursor,
    display: getComputedStyle(el).display,
    visibility: getComputedStyle(el).visibility,
    opacity: getComputedStyle(el).opacity,
    pointerEvents: getComputedStyle(el).pointerEvents,
  },
  role: el.getAttribute('role'),
  rect: el.getBoundingClientRect(),
  offsetParent: el.offsetParent,
  disabled: el.disabled,
  readOnly: el.readOnly,
});
```

### Step 2: Test Interactivity Check

This will show you why the element is not being considered interactive:

```javascript
const el = document.activeElement;
const tagName = el.tagName.toLowerCase();
const style = getComputedStyle(el);

console.log('Interactivity Checks:', {
  isInput: tagName === 'input',
  inputType: el.type,
  isButton: ['button', 'submit', 'checkbox', 'radio'].includes(el.type),
  hasPointerCursor: style.cursor === 'pointer' || style.cursor === 'grab',
  hasRole: el.getAttribute('role'),
  isTextarea: tagName === 'textarea',
  isSelect: tagName === 'select',
  isAnchor: tagName === 'a',
});
```

### Step 3: Full Visibility + Interactivity Analysis

```javascript
const el = document.activeElement;
const style = getComputedStyle(el);
const rect = el.getBoundingClientRect();

console.log('Full Analysis:', {
  // Visibility checks
  visibility: {
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    width: rect.width,
    height: rect.height,
    offsetParent: el.offsetParent !== null,
    inViewport: rect.top < window.innerHeight && rect.bottom > 0,
  },
  
  // Interactivity checks (current logic)
  interactivity: {
    tagName: el.tagName.toLowerCase(),
    inputType: el.type,
    cursor: style.cursor,
    role: el.getAttribute('role'),
    passesCurrentCheck: (
      ['button', 'a', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
      (el.tagName.toLowerCase() === 'input' && ['button', 'submit', 'checkbox', 'radio'].includes(el.type)) ||
      style.cursor === 'pointer' || 
      style.cursor === 'grab' ||
      ['button', 'link', 'menuitem', 'tab', 'option'].includes(el.getAttribute('role'))
    ),
  },
  
  // What the check SHOULD include
  shouldBeInteractive: {
    isTextInput: el.tagName.toLowerCase() === 'input' && !['button', 'submit'].includes(el.type),
    isContentEditable: el.contentEditable === 'true',
  },
});
```

## Expected Output

You should see something like:
```
interactivity: {
  tagName: "input",
  inputType: "text",  // or "email", "number", etc.
  cursor: "text",     // NOT "pointer"
  role: null,
  passesCurrentCheck: false  // ❌ This is the problem!
}

shouldBeInteractive: {
  isTextInput: true,  // ✅ This should make it interactive!
  isContentEditable: false,
}
```

## The Fix

The `isInteractiveElement()` method in `src/content/recording/element-finder.ts` needs to include ALL input types, not just buttons/checkboxes/radios.

**Current code (line 153-156):**
```typescript
// 3. Standard interactive tags
if (['button', 'a', 'select', 'textarea'].includes(tagName) ||
    (tagName === 'input' && ['button', 'submit', 'checkbox', 'radio'].includes((htmlEl as HTMLInputElement).type))) {
  return true;
}
```

**Should be:**
```typescript
// 3. Standard interactive tags
if (['button', 'a', 'select', 'textarea', 'input'].includes(tagName)) {
  return true;
}
```

Or more specifically, exclude only hidden inputs:
```typescript
// 3. Standard interactive tags
if (['button', 'a', 'select', 'textarea'].includes(tagName) ||
    (tagName === 'input' && (htmlEl as HTMLInputElement).type !== 'hidden')) {
  return true;
}
```

## Next Steps

1. Run the debug commands above to confirm the diagnosis
2. Share the output with me
3. We'll apply the fix to include text inputs as interactive elements
