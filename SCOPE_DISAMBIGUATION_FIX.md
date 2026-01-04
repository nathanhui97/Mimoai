# Scope/Container Disambiguation Fix

## Problem Summary

When recording workflows on dashboard pages with multiple similar widgets (like Gainsight), the system was clicking the wrong "More Options" button because:

1. **Missing Context in LLM Prompt**: The `recordedScopeHint` (e.g., "OFFERS EXPIRING IN NEXT 28 DAYS55") was captured during recording but NOT included in the prompt sent to the AI agent
2. **Fallback Disambiguation Logic**: When multiple buttons matched, the system fell back to picking the **last one in DOM order** instead of using container context
3. **Weak Scope Instructions**: The LLM wasn't strongly instructed to return `scopeHint` in its response

## Root Cause Analysis

### Recording Side (Working Correctly ✅)
The workflow JSON properly captures container context:
```json
{
  "context": {
    "container": {
      "text": "OFFERS EXPIRING IN NEXT 28 DAYS55",
      "type": "widget"
    }
  }
}
```

And the AI agent extracts it:
```typescript
const recordedScopeHint = payload.context?.container?.text || 
                         payload.aiEvidence?.semanticAnchors?.textLabel;
```

### Playback Side (Was Broken ❌)

**Issue 1**: Edge function's `AgentHint` interface was missing fields
- No `recordedScopeHint`, `recordedAriaLabel`, `nearbyText`, etc.
- These fields exist in the client-side TypeScript but were missing in the edge function
- ✅ **FIXED**: Added all missing fields to edge function interface

**Issue 2**: LLM prompt didn't include the scope hint
- ✅ **FIXED**: Added scope hint display in prompt

**Issue 3**: Client wasn't sending the recorded context fields
```typescript
// Before (MISSING scopeHint):
${currentHint.targetText ? `Target text: "${currentHint.targetText}"` : ''}
${currentHint.targetRole ? `Target role: ${currentHint.targetRole}` : ''}
${currentHint.targetPlaceholder ? `Placeholder: "${currentHint.targetPlaceholder}"` : ''}
```

**Issue 3**: Tier1 disambiguation picked last in DOM order
When 2 buttons matched, without `scopeHint`, it just picked the last one:
```typescript
// Tier1Executor.pickBestCandidate() line ~1136
const sortedByDomOrder = [...contextFiltered].sort((a, b) => {
  // ... sorting logic ...
});
const lastElement = sortedByDomOrder[sortedByDomOrder.length - 1];
```

## The Fix

### 1. Updated Edge Function Interface
Added missing fields to `AgentHint` interface in `supabase/functions/dom_agent/index.ts`:
```typescript
interface AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'navigate' | 'scroll' | 'other';
  targetText?: string;
  targetPlaceholder?: string;
  targetRole?: string;
  value?: string;
  completed: boolean;
  
  // NEW: Context from recording for better matching
  recordedSelector?: string;
  recordedTestId?: string;
  recordedAriaLabel?: string;
  recordedScopeHint?: string;     // ⭐ KEY FIX
  recordedRowKey?: string;
  nearbyText?: string[];
  
  naturalLanguage?: {
    intent: string;
    precondition: string;
    expectedOutcome: string;
    dependencies: number[];
  };
  
  failureCount?: number;
}
```

### 2. Added Scope Hint to LLM Prompt
Updated the "Current Focus" section to show scope information:
```typescript
${currentHint.recordedScopeHint ? `📍 LOOK IN WIDGET/SECTION: "${currentHint.recordedScopeHint}" ⚠️ CRITICAL - Element is in this container!` : ''}
${currentHint.recordedAriaLabel ? `🏷️ aria-label: "${currentHint.recordedAriaLabel}"` : ''}
${currentHint.nearbyText?.length > 0 ? `🔍 Nearby text: [${currentHint.nearbyText.join(', ')}]` : ''}
```

### 3. Added Scope Matching Instructions
New section in the prompt:
```
🎯 SCOPE/CONTAINER MATCHING (CRITICAL FOR DASHBOARDS):
- If the hint shows "📍 LOOK IN WIDGET/SECTION:", you MUST find the element in that specific container!
- Example: "📍 LOOK IN WIDGET/SECTION: OFFERS EXPIRING IN NEXT 28 DAYS"
  → Look for a widget/card/section with this title in the DOM map
  → ONLY select elements within that section
  → If multiple "More Options" buttons exist, choose the one in the CORRECT widget
- When returning target, ALWAYS include "scopeHint" with the recorded scope value
- This is essential for pages with repeated elements (dashboards, tables, lists)
```

### 4. Updated Candidate Selection Priority
Changed the semantic matching priority:
```
✅ SEMANTIC MATCHING - Choose the BEST candidate by:
   1. FIRST: Match recordedScopeHint from hint to candidate's scope/widget (HIGHEST PRIORITY!)
   2. SECOND: Match ROLE (combobox, button, textbox, etc.)
   3. THIRD: Match NAME/PLACEHOLDER (partial or fuzzy match is OK)
   4. If only ONE candidate matches both scope AND role → select it even if unlabeled
```

### 5. Enhanced Response Format Instructions
```typescript
"scopeHint": "USE THE recordedScopeHint FROM CURRENT HINT IF PROVIDED - this is critical for disambiguation!"
```

## How It Works Now

### Recording Flow
1. User clicks "More Options" in "OFFERS EXPIRING IN NEXT 28 DAYS" widget
2. Recorder captures:
   - Element: button with aria-label="More Options"
   - Container: "OFFERS EXPIRING IN NEXT 28 DAYS55"
3. Stored in workflow JSON as `recordedScopeHint`

### Playback Flow
1. AI agent loads hint with `recordedScopeHint: "OFFERS EXPIRING IN NEXT 28 DAYS55"`
2. Prompt shows: `📍 LOOK IN WIDGET/SECTION: "OFFERS EXPIRING IN NEXT 28 DAYS55"`
3. LLM sees multiple "More Options" buttons in candidates
4. LLM matches candidate with `widget="OFFERS EXPIRING IN NEXT 28 DAYS..."`
5. Returns: `{"action": "click", "target": {"role": "button", "name": "More Options", "scopeHint": "OFFERS EXPIRING IN NEXT 28 DAYS55"}}`
6. Tier1Executor uses `scopeHint` to build scope:
```typescript
const scope = target.scopeHint ? {
  kind: 'CONTAINER' as const,
  selector: `[aria-label*="${target.scopeHint}"], [data-testid*="${target.scopeHint}"]`,
  fallbackText: target.scopeHint,
} : undefined;
```
7. Resolver finds scope container first, then searches within it
8. ✅ Clicks the CORRECT "More Options" button

## Testing

To test the fix with your Gainsight workflow:

1. **Open the Gainsight page** with multiple dashboard widgets
2. **Load your workflow** (ghostwriter-workflow-1767486559749.json)
3. **Execute the workflow** and watch the logs for:
   ```
   📍 LOOK IN WIDGET/SECTION: "OFFERS EXPIRING IN NEXT 28 DAYS55"
   ```
4. **Verify** it clicks the correct "More Options" button in the right widget

### Expected Log Output
```
[AIAgent] 📍 Current hint: "Click More Options in OFFERS EXPIRING IN NEXT 28 DAYS55"
[AIAgent] 📤 Hints status: 0:⬜
[AIAgent] DOM map preview: ...
[AIAgent] Response: {"action":"click","target":{"role":"button","text":"More Options","scopeHint":"OFFERS EXPIRING IN NEXT 28 DAYS55"}}
[Tier1] Building locator bundle...
[Tier1] Scope: CONTAINER (fallbackText: "OFFERS EXPIRING IN NEXT 28 DAYS55")
[Tier1] ✅ Found via aria
```

## Benefits

1. **Dashboard Workflows**: Can now distinguish between identical buttons in different widgets
2. **Table Workflows**: Can target buttons in specific rows by row context
3. **Modal Disambiguation**: Better at finding elements within specific modals
4. **Reliability**: Fewer "clicked wrong element" errors on complex pages

## Deployment Status

✅ **FULLY DEPLOYED** - All changes are live
- **Edge Function**: `dom_agent` - Updated 2026-01-04 (interface + prompt)
- **Client Extension**: Built 2026-01-04 (payload fix)

### Changes Made:
1. ✅ Edge function `AgentHint` interface updated with `recordedScopeHint` field
2. ✅ Edge function prompt updated to show scope hint to LLM
3. ✅ Edge function instructions updated for scope-based disambiguation
4. ✅ Client-side payload fixed to include `recordedScopeHint` in hints array
5. ✅ Modal detection fixed to ignore empty false-positive modals

## Next Steps

If issues persist:
1. Check browser console for `[AIAgent]` and `[Tier1]` logs
2. Verify the workflow JSON has `context.container.text` populated
3. Check if DOM map includes widget titles/sections
4. Try re-recording the workflow to capture fresh context

## Related Files

- `/supabase/functions/dom_agent/index.ts` - Edge function (MODIFIED)
- `/src/lib/ai-agent.ts` - Client-side agent (already had fields)
- `/src/lib/tier1-executor.ts` - Execution engine (already supports scope)
- `/src/types/scope.ts` - Scope resolution (already implemented)

