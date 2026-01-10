# Dropdown Architecture Analysis: Fundamental Design Flaw

## The Problem

The system has **fragmented dropdown detection** - each module implements its own detection logic, leading to inconsistent behavior across different websites.

## Current Architecture (Problematic)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FRAGMENTED DETECTION                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Recording Phase (element-finder.ts)                                  │
│     isListItemOrOption():                                                │
│       - role="option/menuitem/listitem"                                  │
│       - <li> or <option> tags                                            │
│       - class contains "option/menuitem/list-item"                       │
│       - inside [role="listbox/menu/list"]                                │
│                                                                          │
│  2. Variable Detection (variable-detector.ts)                            │
│     isChoiceElement():                                                   │
│       - CHOICE_ROLES = [option, radio, checkbox, menuitemradio...]       │
│       - inputType === 'radio' || 'checkbox'                              │
│       - selector contains "role=option" or "[role=listbox]"              │
│       - Salesforce-specific patterns (lightning-combobox, etc.)          │
│                                                                          │
│  3. Variable Detection (simple-variable-detector.ts)                     │
│     isDropdown():                                                        │
│       - elementRole === 'option/menuitem/listitem'                       │
│       - selector includes 'select' or '[role="listbox"]'                 │
│                                                                          │
│  4. Hint Extraction (hint-extractor.ts)                                  │
│     determineActionType():                                               │
│       - payload.context.decisionSpace.options.length > 0                 │
│                                                                          │
│  5. Execution (tier1-executor.ts)                                        │
│     isDropdownTrigger:                                                   │
│       - aria-haspopup="true"                                             │
│       - aria-expanded !== null                                           │
│       - aria-controls !== null                                           │
│       - role="button" + text includes "more/options/menu"                │
│                                                                          │
│     isDropdownOption:                                                    │
│       - role === 'option/menuitem/menuitemradio'                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Why This Fails

### Case 1: Promotion Tool Dropdown
- Recording: User clicks combobox → records CLICK with `decisionSpace.options`
- Variable Detection: Might work (if selector matches patterns)
- Hint Extraction: Correctly converts to `actionType: 'select'`
- **Execution: `option` parameter was undefined** (bug we fixed)

### Case 2: Salesforce Lightning Dropdown  
- Recording: Complex due to Shadow DOM and custom components
- Variable Detection: Needed custom Salesforce patterns
- Hint Extraction: Works if `decisionSpace.options` exists
- Execution: AI might click wrong element

### Root Cause
Each module asks "is this a dropdown?" using **different criteria**. Data captured by one module may not be recognized by another.

## Proposed Solution: Unified Interaction Type

### New Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    UNIFIED INTERACTION DETECTOR                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  InteractionDetector.detect(element, event):                             │
│    → Returns: InteractionType                                            │
│                                                                          │
│  InteractionType = {                                                     │
│    kind: 'TEXT_INPUT' | 'DROPDOWN_SELECTION' | 'CHECKBOX_TOGGLE' |       │
│          'RADIO_SELECTION' | 'BUTTON_CLICK' | 'LINK_CLICK' |             │
│          'MENU_ITEM_CLICK' | 'UNKNOWN'                                   │
│                                                                          │
│    // For DROPDOWN_SELECTION:                                            │
│    dropdown?: {                                                          │
│      triggerSelector: string;     // Selector for the combobox/trigger   │
│      containerSelector: string;   // Selector for the listbox/menu       │
│      options: string[];           // All available options               │
│      selectedOption: string;      // The option user selected            │
│      selectedIndex: number;       // Index of selected option            │
│    }                                                                     │
│                                                                          │
│    // For TEXT_INPUT:                                                    │
│    textInput?: {                                                         │
│      fieldLabel: string;                                                 │
│      fieldType: string;                                                  │
│      value: string;                                                      │
│    }                                                                     │
│                                                                          │
│    confidence: number;           // How confident we are (0-1)           │
│    detectionMethod: string;      // How we detected this                 │
│  }                                                                       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                │
                                │ Stored in payload.interactionType
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    ALL DOWNSTREAM MODULES                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Variable Detection:                                                     │
│    if (payload.interactionType?.kind === 'DROPDOWN_SELECTION') {        │
│      // Create dropdown variable with options                            │
│    }                                                                     │
│                                                                          │
│  Hint Extraction:                                                        │
│    if (payload.interactionType?.kind === 'DROPDOWN_SELECTION') {        │
│      return 'select';                                                    │
│    }                                                                     │
│                                                                          │
│  Execution:                                                              │
│    if (step.interactionType?.kind === 'DROPDOWN_SELECTION') {           │
│      // Use dropdown.options and dropdown.selectedOption                 │
│    }                                                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Detection Strategies (Universal)

The `InteractionDetector` would use a **strategy chain** that works universally:

```typescript
class InteractionDetector {
  static detect(element: Element, event?: Event): InteractionType {
    // Strategy 1: ARIA roles (most reliable, standard)
    const type = this.detectByAriaRoles(element);
    if (type.confidence > 0.8) return type;
    
    // Strategy 2: Semantic HTML elements
    const htmlType = this.detectByHTMLSemantics(element);
    if (htmlType.confidence > 0.7) return htmlType;
    
    // Strategy 3: Parent container context
    const containerType = this.detectByContainerContext(element);
    if (containerType.confidence > 0.6) return containerType;
    
    // Strategy 4: Common class name patterns
    const classType = this.detectByClassPatterns(element);
    if (classType.confidence > 0.5) return classType;
    
    // Strategy 5: Behavioral heuristics (event types, state changes)
    const behaviorType = this.detectByBehavior(element, event);
    if (behaviorType.confidence > 0.4) return behaviorType;
    
    // Fallback: Unknown
    return { kind: 'UNKNOWN', confidence: 0 };
  }
}
```

### Benefits

1. **Single Source of Truth**: One place to maintain dropdown detection logic
2. **Universal**: Same detection works for Salesforce, promotion tool, any website
3. **Extensible**: Easy to add new strategies without modifying downstream code
4. **Debuggable**: Clear `detectionMethod` shows how decision was made
5. **Forward-Compatible**: `interactionType` is stored in payload, available everywhere

## Implementation Plan

### Phase 1: Create InteractionDetector (Non-breaking)
1. Create `src/content/interaction-detector.ts`
2. Implement detection strategies
3. Add `interactionType` field to `WorkflowStepPayload`

### Phase 2: Update Recording
1. Call `InteractionDetector.detect()` during recording
2. Store result in `payload.interactionType`
3. Keep existing `decisionSpace` for backward compatibility

### Phase 3: Update Downstream Modules
1. Variable Detection: Check `interactionType.kind` first, fallback to old logic
2. Hint Extraction: Check `interactionType.kind` first
3. Execution: Use `interactionType.dropdown` data when available

### Phase 4: Remove Duplicate Logic
1. Consolidate all dropdown detection into `InteractionDetector`
2. Remove redundant checks from other modules
3. Clean up `decisionSpace` (migrate to `interactionType.dropdown`)

## Current Workaround (What We Fixed)

For now, we patched `ai-agent.ts` to ensure the `option` parameter is set:

```typescript
// Ensure option is set for ALL select actions
if (result.action === 'select' && currentHint?.actionType === 'select') {
  const optionToSelect = currentHint.value || currentHint.targetText;
  if (optionToSelect) {
    result.option = optionToSelect;
  }
}
```

This is a band-aid fix. The proper solution is the unified `InteractionDetector`.

## Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| Detection Logic | Fragmented (5+ places) | Centralized (1 place) |
| Criteria | Different per module | Unified strategy chain |
| Data Flow | Re-detect at each stage | Detect once, store, read |
| New Websites | May need custom code | Works universally |
| Debugging | Hard to trace | Clear detection method |
