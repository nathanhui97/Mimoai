# Workflow Task Summary Implementation

## Overview

This implementation adds AI-generated task summaries to workflows, providing both users and the AI agent with richer context about the overall purpose and intent of each workflow. This is especially valuable for Excel and Google Sheets workflows where the AI needs to understand the semantic intent (e.g., "append to next empty row") rather than just literal actions.

## What Was Implemented

### 1. Extended SavedWorkflow Type

**File:** `src/types/workflow.ts`

Added a `description` field to store the AI-generated task summary:

```typescript
export interface SavedWorkflow {
  id: string;
  name: string;
  description?: string;  // AI-generated task summary explaining what the workflow does
  // ... other fields
}
```

### 2. Intent Summary Generation

**File:** `src/lib/intent-analyzer.ts`

Added a new method `formatIntentAsSummary()` that converts analyzed intent into a human-readable summary:

```typescript
static formatIntentAsSummary(intent: AnalyzedIntent): string {
  const parts: string[] = [];
  
  // Primary goal
  parts.push(intent.primaryGoal);
  
  // Add sub-goals if available (limit to 3 for brevity)
  if (intent.subGoals && intent.subGoals.length > 0) {
    const topSubGoals = intent.subGoals.slice(0, 3);
    parts.push(`Steps: ${topSubGoals.join(', ')}`);
    
    if (intent.subGoals.length > 3) {
      parts.push(`... and ${intent.subGoals.length - 3} more`);
    }
  }
  
  // Expected outcome
  if (intent.expectedOutcome && intent.expectedOutcome !== 'Unknown outcome') {
    parts.push(`Expected result: ${intent.expectedOutcome}`);
  }
  
  return parts.join('. ') + '.';
}
```

### 3. Automatic Summary Generation During Save

**File:** `src/sidepanel/App.tsx`

Modified `handleSaveWorkflow()` to:
- Call `IntentAnalyzer.analyzeWorkflowIntent()` to analyze the workflow
- Format the analysis result into a summary using `formatIntentAsSummary()`
- Store the summary in the `workflow.description` field
- Handle failures gracefully with local analysis fallback

```typescript
// Generate task summary using IntentAnalyzer
console.log('[SaveWorkflow] Analyzing workflow intent for summary...');
setLearningFeedback('📝 Generating task summary...');
let workflowDescription: string | undefined;

try {
  const intentAnalysis = await IntentAnalyzer.analyzeWorkflowIntent(tempWorkflow);
  if (intentAnalysis?.intent) {
    workflowDescription = IntentAnalyzer.formatIntentAsSummary(intentAnalysis.intent);
    console.log('[SaveWorkflow] Generated description:', workflowDescription);
  } else {
    // Fallback to local analysis
    const localIntent = IntentAnalyzer.analyzeIntentLocally(workflowSteps);
    workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
    console.log('[SaveWorkflow] Generated description (local):', workflowDescription);
  }
} catch (error) {
  console.warn('[SaveWorkflow] Failed to generate description:', error);
  // Fallback to local analysis
  const localIntent = IntentAnalyzer.analyzeIntentLocally(workflowSteps);
  workflowDescription = IntentAnalyzer.formatIntentAsSummary(localIntent);
}
```

### 4. UI Display of Summary

**File:** `src/sidepanel/App.tsx`

Added description display in the workflow list, showing below the workflow name:

```tsx
{workflow.description && (
  <div className="text-sm text-muted-foreground mt-1 italic">
    {workflow.description}
  </div>
)}
```

### 5. Enhanced AI Agent Goal Context

**File:** `src/lib/ai-agent.ts`

Modified `inferGoal()` to combine workflow name and description for richer context:

```typescript
private inferGoal(workflow: SavedWorkflow): string {
  // Prefer workflow name + description for richer context
  if (workflow.name && workflow.description) {
    return `${workflow.name} - ${workflow.description}`;
  }
  
  // Use workflow name as primary goal
  if (workflow.name) {
    return workflow.name;
  }
  
  // ... other fallbacks
}
```

### 6. Task Summary in DOM Agent Prompt

**File:** `supabase/functions/dom_agent/index.ts`

Added a dedicated "TASK SUMMARY" section at the top of the AI prompt when a description is available:

```typescript
// Extract task summary from goal if it contains a dash separator (name - description format)
let taskSummarySection = '';
if (goal.includes(' - ')) {
  const [taskName, taskDescription] = goal.split(' - ', 2);
  taskSummarySection = `
## 🎯 TASK SUMMARY
**Workflow:** ${taskName}
**Purpose:** ${taskDescription}

This context helps you understand the OVERALL INTENT of the workflow, especially important for spreadsheets and adaptive tasks where you need to make intelligent decisions about where to place data or how to handle changes in the page state.
`;
}
```

## Benefits

### For Users

1. **Better Workflow Organization:** Users can now see at a glance what each workflow does without opening it
2. **Natural Language Description:** The AI-generated summary explains the workflow in plain English
3. **Automatic Generation:** No manual effort required - the summary is created automatically when saving

### For AI Agent

1. **Richer Context:** The AI now understands the overall purpose of the workflow, not just individual steps
2. **Better Decision Making:** Especially important for spreadsheets where the AI needs to adapt (e.g., "append to next empty row" instead of "click B5")
3. **Improved Reliability:** Understanding intent helps the AI recover from failures and adapt to page changes

### For Spreadsheets (Excel/Sheets)

The AI now receives:
- **Task name:** "Enter Monthly Sales"
- **Task summary:** "Enter data into spreadsheet. Steps: Enter data in cell A1, Enter data in cell B1, ... and 2 more. Expected result: Data saved in cells."
- **Spreadsheet context:** Column headers, data types, empty rows
- **Recorded intent:** "User clicked first empty cell after data"

This combination allows the AI to make human-like decisions about where to place data based on the current sheet state.

## Example Output

**Workflow Name:** "Enter Monthly Sales"

**Generated Summary:**
> "Enter data into spreadsheet. Steps: Click cell, Enter data in Sales Amount, Enter data in Date. Expected result: Data saved in cells."

**AI Agent Receives:**
```
🎯 TASK SUMMARY
Workflow: Enter Monthly Sales
Purpose: Enter data into spreadsheet. Steps: Click cell, Enter data in Sales Amount, Enter data in Date. Expected result: Data saved in cells.

This context helps you understand the OVERALL INTENT of the workflow...

📊 SPREADSHEET CONTEXT (Google Sheets / Excel)
You are working in a spreadsheet. You can see the full sheet structure...

Recorded Action:
User clicked: B5 (was empty)
Column header: "Monthly Sales"
>>> This was an APPEND operation (first empty after data)
Reasoning: User is appending new data to existing column
```

## Testing Recommendations

1. **Record a new workflow** with multiple steps
2. **Save it** and observe the generated summary in the workflow list
3. **Execute the workflow** and check browser console for the enhanced goal being passed to the AI agent
4. **Record a spreadsheet workflow** (in Google Sheets or Excel Online) and verify the summary mentions spreadsheet-specific context
5. **Compare AI behavior** before and after - the AI should show better understanding of overall task intent

## Future Enhancements

1. **Editable Summaries:** Allow users to edit the AI-generated summary
2. **Summary Preview:** Show the summary in the save dialog before saving
3. **Multi-language Support:** Generate summaries in different languages
4. **Summary Regeneration:** Add a button to regenerate the summary for existing workflows

