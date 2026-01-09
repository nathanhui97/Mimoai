# Spreadsheet Data Flow - Complete Architecture

**Purpose:** Document the complete flow of spreadsheet data through the system  
**Audience:** Developers working on spreadsheet features  
**Last Updated:** January 7, 2026

---

## 🎯 Overview

Spreadsheet workflows follow a 4-phase lifecycle:
1. **Recording** - Capture user actions and cell references
2. **Variable Detection** - Identify which cells should be parameterized
3. **Hint Extraction** - Prepare steps for execution
4. **Execution** - Type values into cells (with intelligent append)

---

## Phase 1: Recording 📹

### Entry Point
**File:** `src/content/recording-manager.ts`  
**Trigger:** User types in a Google Sheets cell

### Data Capture Flow

```
User types "123" in cell A2
  ↓
handleInput() detects input event
  ↓
Debounce (800ms) - wait for complete typing
  ↓
captureInputValue(element, timestamp, explicitCellRef)
  ↓
┌─────────────────────────────────────────┐
│ CRITICAL: Cell Reference Capture        │
│                                          │
│ 1. ContextScanner.scan(element)         │
│    → gridCoordinates.cellReference = ? │
│                                          │
│ 2. Get effective cell ref:              │
│    Priority:                             │
│    - explicitCellRef (from flush)       │
│    - this.pendingCellReference (cached) │
│    - scanned.cellReference (fresh scan) │
│                                          │
│ 3. Override if needed:                  │
│    scanned.gridCoordinates.cellReference│
│    = effectiveCellRef                   │
└─────────────────────────────────────────┘
  ↓
Build spreadsheetContext:
  {
    recordedIntent: {
      cellRef: "A2",
      columnHeader: null,  // Rarely available
      column: "A",
      wasEmpty: true,
      wasAppendPosition: false,
      reasoning: "User typed in A2"
    }
  }
  ↓
Create step payload:
  {
    type: "INPUT",
    payload: {
      value: "123",
      label: "A2",
      spreadsheetContext: { ... },  ← CRITICAL!
      context: {
        gridCoordinates: {
          cellReference: "A2",
          columnHeader: null
        }
      },
      ...
    }
  }
  ↓
sendStep() → Side panel receives step
```

### Key Functions
- `handleInput()` - Detects cell switches, flushes previous cell
- `captureInputValue()` - Captures final value with correct cell ref
- `ContextScanner.scan()` - Extracts cell reference from Name Box

### Data Created
- `payload.spreadsheetContext.recordedIntent.cellRef` ✅ **Primary source**
- `payload.context.gridCoordinates.cellReference` ✅ **Backup source**
- `payload.label` ✅ **Tertiary source**

---

## Phase 2: Variable Detection 🔍

### Entry Point
**File:** `src/lib/variable-detector.ts`  
**Trigger:** Recording stops → `handleStopRecording()` in `App.tsx`

### Detection Flow

```
handleStopRecording()
  ↓
VariableDetector.detectVariables(steps, null)
  ↓
┌─────────────────────────────────────────┐
│ FAST PATH: Spreadsheet Variables        │
│                                          │
│ for (step in steps) {                   │
│   if (step.type === 'INPUT') {          │
│     // Use centralized helper!          │
│     cellRef = SpreadsheetHelpers        │
│       .extractCellReference(payload);   │
│                                          │
│     if (cellRef) {                      │
│       variables.push({                  │
│         stepIndex: i,                   │
│         stepId: timestamp,              │
│         fieldName: cellRef,  // "A2"    │
│         variableName: "cellA2",         │
│         defaultValue: "123",            │
│         confidence: 1.0                 │
│       });                               │
│     }                                   │
│   }                                     │
│ }                                       │
│                                          │
│ return variables (NO AI CALL!)          │
└─────────────────────────────────────────┘
  ↓
Return to App.tsx:
  {
    variables: [
      { fieldName: "A2", variableName: "cellA2", ... },
      { fieldName: "B2", variableName: "cellB2", ... },
      { fieldName: "C2", variableName: "cellC2", ... }
    ],
    analysisCount: 0  // No AI!
  }
  ↓
setCurrentWorkflowVariables(variables)
  ↓
UI shows variables in "Detected Variables" section
```

### Key Functions
- `VariableDetector.detectVariables()` - Entry point
- `SpreadsheetHelpers.extractCellReference()` - **Centralized extraction**
- `SpreadsheetHelpers.generateVariableName()` - Generate "cellA2" from "A2"

### Data Created
- `VariableDefinition[]` with `fieldName` = cell reference
- Stored in `currentWorkflowVariables` state

### Performance
- **Before:** 10-15 seconds (AI analysis)
- **After:** ~10ms (direct extraction)
- **Improvement:** 1000x faster!

---

## Phase 3: Hint Extraction 🎯

### Entry Point
**File:** `src/lib/ai-agent.ts` → `extractHints()`  
**Trigger:** User clicks "Execute Workflow"

### Hint Building Flow

```
executeWorkflowWithVariables(variableValues)
  ↓
AIAgent.run(workflow, variableValues)
  ↓
extractHints(workflow, variableValues)
  ↓
┌─────────────────────────────────────────┐
│ Variable Substitution                    │
│                                          │
│ 1. Build variable maps:                 │
│    stepToVariable.set(0, {              │
│      variableName: "cellA2",            │
│      fieldName: "A2",                   │
│      stepId: "1767759967536"            │
│    });                                   │
│                                          │
│ 2. For each step:                       │
│    matchedVar = stepToVariable.get(i)   │
│    OR stepIdToVariable.get(stepId)      │
│                                          │
│ 3. Substitute value:                    │
│    payload.value = variableValues[      │
│      matchedVar.variableName            │
│    ]                                     │
│    // "123" → "John"                    │
│                                          │
│ 4. Pass through spreadsheetContext:    │
│    hint.spreadsheetContext =            │
│      payload.spreadsheetContext         │
└─────────────────────────────────────────┘
  ↓
Create AgentHint:
  {
    stepNumber: 1,
    description: "Enter 'John' in field",
    actionType: "type",
    value: "John",  // Substituted!
    spreadsheetContext: {
      recordedIntent: {
        cellRef: "A2"  ← CRITICAL!
      }
    },
    ...
  }
  ↓
Return hints[] array
```

### Key Functions
- `extractHints()` - Builds hints from workflow steps
- Variable substitution logic (stepToVariable, stepIdToVariable maps)
- `hint.spreadsheetContext = payload.spreadsheetContext` - **Pass through**

### Data Flow
- `workflow.variables` → Variable maps
- `variableValues` → User-entered values
- `payload.spreadsheetContext` → `hint.spreadsheetContext` ✅ **Critical handoff**

---

## Phase 4: Execution ▶️

### Entry Point
**File:** `src/lib/ai-agent.ts` → `run()` → main execution loop  
**Trigger:** Agent processes each hint sequentially

### Execution Flow

```
for (hint in hints) {
  ↓
  Check if spreadsheet domain
  ↓
  if (hint.actionType === 'type') {
    ↓
    ┌─────────────────────────────────────────┐
    │ Cell Reference Extraction                │
    │                                          │
    │ // Use centralized helper!               │
    │ recordedCellRef = SpreadsheetHelpers    │
    │   .extractCellReference(hint);          │
    │                                          │
    │ // Returns "A2" from:                    │
    │ // - hint.spreadsheetContext.cellRef    │
    │ // - hint.recordedAriaLabel              │
    │ // - hint.recordedFallbackSelectors      │
    └─────────────────────────────────────────┘
    ↓
    if (recordedCellRef) {
      ↓
      Extract column: "A2" → column = "A"
      ↓
      ┌─────────────────────────────────────────┐
      │ Intelligent Append                       │
      │                                          │
      │ 1. Check memory for cached target row   │
      │    memory.spreadsheetTargetRow = ?      │
      │                                          │
      │ 2. If not cached:                       │
      │    targetRow = findFirstEmptyRow()      │
      │    // Uses Ctrl+Down keyboard nav       │
      │    // Returns 3 (first empty row)       │
      │                                          │
      │ 3. Cache for next cells:                │
      │    memory.spreadsheetTargetRow = 3      │
      │                                          │
      │ 4. Build actual cell:                   │
      │    actualCellRef = "A" + 3 = "A3"       │
      └─────────────────────────────────────────┘
      ↓
      SpreadsheetExecutor.execute({
        action: 'type_in_cell',
        cellRef: 'A3',
        text: 'John',
        clearFirst: true
      })
      ↓
      ┌─────────────────────────────────────────┐
      │ SpreadsheetExecutor Implementation      │
      │                                          │
      │ 1. Navigate to cell via Name Box:       │
      │    nameBox.value = "A3"                 │
      │    nameBox.dispatchEvent('input')       │
      │    Press Enter                          │
      │                                          │
      │ 2. Enter edit mode:                     │
      │    Press F2 or double-click             │
      │                                          │
      │ 3. Type value:                          │
      │    editor.execCommand('insertText',     │
      │      'John')                             │
      │                                          │
      │ 4. Commit:                              │
      │    Press Enter or click away            │
      └─────────────────────────────────────────┘
      ↓
      Mark hint as completed
      ↓
      Continue to next hint
    }
  }
}
```

### Key Functions
- `SpreadsheetHelpers.extractCellReference(hint)` - **Centralized extraction**
- `SpreadsheetHelpers.extractColumn(cellRef)` - Get column letter
- `SheetStateExtractor.findFirstEmptyRowViaKeyboard()` - Intelligent append
- `SpreadsheetExecutor.execute()` - Actual typing

### Data Flow
- `hint.spreadsheetContext.recordedIntent.cellRef` → Cell reference
- `hint.value` → Value to type (already substituted!)
- `memory.spreadsheetTargetRow` → Cached row for consistent append

### Memory State
```typescript
this.state.memory = {
  spreadsheetTargetRow: 3  // Cached after first cell
  // All subsequent cells use row 3
}
```

---

## 🔧 Critical Integration Points

### Point 1: Recording → Variable Detection
**Data Passed:** `payload.spreadsheetContext`

```typescript
// recording-manager.ts creates:
payload.spreadsheetContext = { recordedIntent: { cellRef: "A2" } }

// variable-detector.ts reads:
const cellRef = SpreadsheetHelpers.extractCellReference(payload);
```

**If this breaks:** Variables won't be detected

---

### Point 2: Variable Detection → Hint Extraction
**Data Passed:** `workflow.variables`

```typescript
// variable-detector.ts creates:
variables: [{ stepIndex: 0, stepId: "xxx", fieldName: "A2", ... }]

// ai-agent.ts reads:
stepToVariable.set(0, { variableName: "cellA2", fieldName: "A2", stepId: "xxx" });
```

**If this breaks:** Variable substitution won't work

---

### Point 3: Recording → Hint Extraction
**Data Passed:** `payload.spreadsheetContext`

```typescript
// recording-manager.ts creates:
payload.spreadsheetContext = { recordedIntent: { cellRef: "A2" } }

// ai-agent.ts passes through:
hint.spreadsheetContext = payload.spreadsheetContext
```

**If this breaks:** Execution can't extract cell reference

---

### Point 4: Hint Extraction → Execution
**Data Passed:** `hint.spreadsheetContext`

```typescript
// ai-agent.extractHints() creates:
hint.spreadsheetContext = { recordedIntent: { cellRef: "A2" } }

// ai-agent.run() reads:
const cellRef = SpreadsheetHelpers.extractCellReference(hint);
```

**If this breaks:** Execution types into wrong element

---

## 🔑 Centralized Helper Usage

### SpreadsheetHelpers.extractCellReference()

**Used in 3 places:**

1. **Variable Detection** (`variable-detector.ts:143`)
```typescript
const cellRef = SpreadsheetHelpers.extractCellReference(payload);
if (cellRef) {
  // Create variable
}
```

2. **Hint Extraction** (`variable-detector.ts:600`)
```typescript
const cellReference = SpreadsheetHelpers.extractCellReference(payload);
// Add to metadata
```

3. **Execution - INPUT** (`ai-agent.ts:748`)
```typescript
const recordedCellRef = SpreadsheetHelpers.extractCellReference(currentHint);
if (recordedCellRef) {
  // Execute type in cell
}
```

4. **Execution - CLICK** (`ai-agent.ts:858`)
```typescript
const cellRef = SpreadsheetHelpers.extractCellReference(currentHint);
if (cellRef) {
  // Execute click cell
}
```

**Why this is critical:**
- ✅ Single source of truth
- ✅ Consistent priority order
- ✅ Change once, affects everywhere
- ✅ Easy to debug (one log location)

---

## 📊 Data Structure Evolution

### Step Payload (What's Recorded)
```typescript
WorkflowStepPayload {
  type: "INPUT",
  value: "123",
  label: "A2",
  timestamp: 1767759967536,
  
  // NEW (SPREADSHEET_INPUT_CONTEXT_FIX):
  spreadsheetContext: {
    recordedIntent: {
      cellRef: "A2",        ← PRIMARY SOURCE
      columnHeader: null,
      column: "A",
      wasEmpty: true,
      wasAppendPosition: false,
      reasoning: "User typed in A2"
    }
  },
  
  // LEGACY (still kept for compatibility):
  context: {
    gridCoordinates: {
      cellReference: "A2",  ← BACKUP SOURCE
      columnHeader: null
    }
  }
}
```

### Variable Definition (What's Detected)
```typescript
VariableDefinition {
  stepIndex: 0,
  stepId: "1767759967536",  ← Used for matching!
  stepType: "INPUT",
  fieldName: "A2",           ← Shown in UI
  variableName: "cellA2",    ← Used in code
  defaultValue: "123",
  isVariable: true,
  confidence: 1.0,
  cellReference: "A2"
}
```

### Agent Hint (What's Executed)
```typescript
AgentHint {
  stepNumber: 1,
  description: "Enter '123' in field",
  actionType: "type",
  value: "John",  ← Substituted from variableValues!
  
  // Passed through from payload:
  spreadsheetContext: {
    recordedIntent: {
      cellRef: "A2"  ← CRITICAL for execution!
    }
  },
  
  // Other recorded data:
  recordedAriaLabel: "A2",
  recordedFallbackSelectors: ['[aria-label="A2"]'],
  ...
}
```

---

## 🛡️ Defensive Coding Patterns

### 1. Priority Chain (Always Check All Sources)
```typescript
// ✅ GOOD - uses centralized helper
const cellRef = SpreadsheetHelpers.extractCellReference(data);

// ❌ BAD - only checks one source
const cellRef = data.spreadsheetContext?.recordedIntent?.cellRef;
```

### 2. Null Safety (Always Handle Missing Data)
```typescript
// ✅ GOOD - handles null
const cellRef = SpreadsheetHelpers.extractCellReference(hint);
if (cellRef) {
  // Execute with cellRef
} else {
  console.warn('Could not extract cell reference');
  // Fall back to AI or skip
}

// ❌ BAD - assumes cellRef exists
const cellRef = hint.spreadsheetContext.recordedIntent.cellRef;
execute(cellRef); // Crashes if undefined!
```

### 3. Logging (Always Log Extraction)
```typescript
// ✅ GOOD - centralized helper logs automatically
const cellRef = SpreadsheetHelpers.extractCellReference(data);
// Logs: "[SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: A2"

// ❌ BAD - silent extraction
const cellRef = data.spreadsheetContext?.recordedIntent?.cellRef;
// No log - hard to debug!
```

---

## 🐛 Common Breakage Scenarios

### Scenario 1: New Field Added to Recording
**What breaks:** Variable detection and execution don't use new field

**Example:**
```typescript
// recording-manager.ts adds:
payload.newCellData = { cellRef: "A2", ... };

// But variable-detector.ts still uses old field:
const cellRef = payload.spreadsheetContext?.recordedIntent?.cellRef;
// ❌ Doesn't check newCellData!
```

**Prevention:** Use `SpreadsheetHelpers.extractCellReference()` which checks all sources

---

### Scenario 2: Extraction Logic Changes
**What breaks:** Different parts of codebase extract differently

**Example:**
```typescript
// ai-agent.ts checks in order: spreadsheetContext → ariaLabel
// variable-detector.ts checks in order: gridCoordinates → spreadsheetContext
// ❌ Different priority orders!
```

**Prevention:** Use `SpreadsheetHelpers.extractCellReference()` everywhere

---

### Scenario 3: Data Not Passed Through
**What breaks:** Execution can't find cell reference

**Example:**
```typescript
// extractHints() forgets to pass spreadsheetContext:
return {
  ...hint,
  // ❌ MISSING: spreadsheetContext: payload.spreadsheetContext
};

// Execution fails:
const cellRef = hint.spreadsheetContext?.cellRef; // undefined!
```

**Prevention:** 
- Document required fields in this diagram
- Use TypeScript strict mode
- Run smoke tests

---

## 📝 Checklist: Adding New Spreadsheet Features

When adding features that touch spreadsheet data:

- [ ] Use `SpreadsheetHelpers.extractCellReference()` for cell refs
- [ ] Use `SpreadsheetHelpers.extractColumnHeader()` for headers
- [ ] Pass `spreadsheetContext` through all data transformations
- [ ] Add logging with `[ComponentName]` prefix
- [ ] Update this data flow diagram
- [ ] Run smoke test checklist (`SPREADSHEET_SMOKE_TEST.md`)
- [ ] Check all 4 phases still work

---

## 🔍 Debugging Guide

### Problem: "Could not extract cell reference"

**Check in order:**

1. **Recording:** Did `spreadsheetContext` get created?
```
Look for: "📊 RecordingManager: Adding spreadsheet context to INPUT step"
```

2. **Variable Detection:** Did helper find the cell ref?
```
Look for: "[SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: A2"
```

3. **Hint Extraction:** Was `spreadsheetContext` passed through?
```
Look for hint object in console, check: hint.spreadsheetContext.recordedIntent.cellRef
```

4. **Execution:** Did helper extract from hint?
```
Look for: "[SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: A2"
```

### Problem: Variables detected but execution fails

**Check:**
- Variable `stepId` matches step `timestamp`?
- `hint.value` has substituted value (not original)?
- `hint.spreadsheetContext` exists?

### Problem: Typed into wrong cell

**Check:**
- Intelligent append: Is typing into row+1 intentional?
- Cell ref extracted correctly?
- Multiple cells sharing same target row?

---

## 🎓 Developer Onboarding

**New to spreadsheet features? Read these in order:**

1. **This file** - Understand the data flow
2. `src/lib/spreadsheet-helpers.ts` - See centralized utilities
3. `SPREADSHEET_SMOKE_TEST.md` - Learn how to test
4. `SPREADSHEET_INPUT_CONTEXT_FIX.md` - Context for recent fixes
5. `SMART_SPREADSHEET_SYSTEM.md` - Original design doc

---

## 🏗️ Architecture Principles

### 1. Single Source of Truth
Cell reference extraction → `SpreadsheetHelpers.extractCellReference()`

### 2. Data Immutability
Once recorded, `spreadsheetContext` should pass through unchanged

### 3. Fail-Safe Defaults
If cell ref can't be extracted → Don't execute (don't guess!)

### 4. Comprehensive Logging
Every extraction logs which source succeeded

### 5. TypeScript Strictness
Use typed interfaces, avoid `any` where possible

---

## Date Created
January 7, 2026

## Author
AI Assistant (with user nathhui)

## Version
1.0 - Initial comprehensive documentation



