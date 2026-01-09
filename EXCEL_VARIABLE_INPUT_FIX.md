# Excel Variable Input Fix

## Problem
When executing workflows with variables on Excel sheets, the AI was not correctly using the user-provided variable values. Instead of typing the new value entered in the extension side panel, it was either:
1. Skipping the step
2. Using the recorded value instead of the new value
3. Not including the text value in the response at all

## Root Cause
The DOM agent (AI) was not being explicitly instructed to use the `currentHint.value` field (which contains the substituted variable value) as the `text` parameter in its response. The AI was:
1. Extracting values from the description text instead of the "Value to enter" field
2. Not always including the `text` field in spreadsheet type actions
3. Not understanding that the "Value to enter" field is the authoritative source for what to type

## Solution
Updated the DOM agent prompt (`supabase/functions/dom_agent/index.ts`) to explicitly instruct the AI:

### 1. Enhanced Spreadsheet Section
Added clear instructions that the AI MUST:
- Extract the cell reference from `recordedAriaLabel`
- Use the EXACT value from the "Value to enter" field as the `text` parameter
- Return both `cellRef` AND `text` in the response

```typescript
### 🚨 CRITICAL: YOU MUST RETURN cellRef AND text FOR ALL SPREADSHEET TYPE ACTIONS

When the hint says "Enter X" or "Type Y" on a spreadsheet:
1. **Extract the cell reference** from the hint's recordedAriaLabel (like "A2", "B3", "C5")
2. **Use the EXACT value from "Value to enter" field** as the text parameter
3. **Return both cellRef AND text** in your response

CRITICAL: The "text" field MUST be the EXACT value from the hint's "Value to enter" field.
DO NOT extract the value from the description - use the "Value to enter" field!
```

### 2. Enhanced Type Action Instructions
Added specific instructions for TYPE actions:
```typescript
- **type**: Type text into an input field
  - ⚠️ CRITICAL: For TYPE actions, you MUST use the value from "Value to enter" field in the current hint
  - DO NOT extract the value from the description - use the "Value to enter" field exactly as shown
  - Example: If hint shows "Value to enter: john@example.com", your response must have "text": "john@example.com"
```

### 3. Updated Response Format Requirements
Made the `text` field requirement explicit:
```typescript
REQUIRED FIELDS:
- "text": "EXACT value from 'Value to enter' field" (REQUIRED if action is type - use the exact value shown in the hint!)
```

## How It Works Now

### Recording Phase
1. User types "nathan" in cell A2
2. Variable detected: `{ variableName: "name", defaultValue: "nathan", stepIndex: 0 }`

### Execution Phase
1. User enters "john" in Variable Input Form
2. `variableValues: { name: "john" }`
3. `extractHints()` substitutes: step 0 value = "john" (not "nathan")
4. Hint sent to AI: `"Value to enter: john"`, `recordedAriaLabel: "A2"`
5. AI response: `{"action": "type", "cellRef": "A2", "text": "john"}`
6. SpreadsheetExecutor types "john" into cell A2

## Testing
To test the fix:
1. Record a workflow typing values into Excel cells (e.g., Name, Email, Phone)
2. Variables should be auto-detected
3. In the Variable Input Form, enter different values
4. Execute the workflow
5. Verify that the NEW values (not recorded values) are typed into the cells

## Files Changed
- `supabase/functions/dom_agent/index.ts` - Enhanced prompt with explicit instructions for using hint values

## Deployment
```bash
npx supabase functions deploy dom_agent --no-verify-jwt
```

## Related Systems
This fix works in conjunction with:
- **Variable Detection** (`supabase/functions/detect_variables/index.ts`) - Detects which fields are variables
- **Variable Substitution** (`src/lib/ai-agent.ts` - `extractHints()`) - Replaces recorded values with user-provided values
- **Spreadsheet Executor** (`src/lib/spreadsheet-executor.ts`) - Types values into cells
- **DOM Agent** (`supabase/functions/dom_agent/index.ts`) - AI decision making (NOW FIXED)

## Key Insight
The issue wasn't in the variable substitution logic (which was working correctly) or the spreadsheet executor (which was also working correctly). The problem was in the **communication** between the AI agent and the executor - the AI wasn't being told clearly enough to use the hint's value field as the source of truth for what to type.



