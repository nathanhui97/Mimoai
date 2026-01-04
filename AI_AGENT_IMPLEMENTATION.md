# AI Agent Architecture Implementation

## Overview

The extension now has a new **AI Agent** execution mode that flips the paradigm from "extension with AI fallback" to "AI Agent that uses the extension as a tool".

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI AGENT (The Brain)                     │
│  Receives: Goal, hints, current page screenshot              │
│  Thinks: Reasons about what action to take                   │
│  Outputs: Specific action command                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                EXTENSION (The Hands)                         │
│  Provides actions: click(x,y), type(text), scroll, navigate │
│  Provides observations: screenshot, page URL, title          │
│  Does NOT make decisions - just executes                     │
└─────────────────────────────────────────────────────────────┘
```

## Core Loop (Observe-Act)

```
while (!goalAchieved && attempts < maxAttempts) {
  observation = getPageState();          // Screenshot + metadata
  action = AI.decide(observation, goal, hints, history);
  result = extension.execute(action);
  history.push({ observation, action, result });
}
```

## New Files Created

### 1. `src/lib/ai-agent.ts`
The brain of the agent system.

**Key Classes/Interfaces:**
- `AIAgent` - Main agent controller
- `AgentState` - Current execution state
- `AgentAction` - Actions the AI can decide (click, type, scroll, navigate, wait, done, fail)
- `AgentHint` - Hints derived from recorded workflow
- `AgentObservation` - Current page state (screenshot + metadata)

**Key Methods:**
- `run(workflow, variableValues)` - Main entry point
- `observe()` - Capture current page state
- `think(observation)` - Call AI to decide next action
- `act(action)` - Execute the decided action

### 2. `src/lib/agent-executor.ts`
Executes actions decided by the AI Agent.

**Supported Actions:**
- `click(x, y)` - Click at specific coordinates
- `type(text)` - Type text into focused element
- `scroll(direction, amount)` - Scroll the page
- `navigate(url)` - Navigate to a URL
- `wait(duration)` - Wait for specified time
- `done()` - Signal workflow completion
- `fail(reason)` - Signal execution failure

### 3. `supabase/functions/visual_agent/index.ts`
Edge Function that houses the AI decision logic.

**Request:**
```typescript
interface AgentRequest {
  screenshot: string;
  goal: string;
  hints: AgentHint[];
  currentHintIndex: number;
  history: HistoryEntry[];
  pageContext: { url, title, viewportSize };
  referenceScreenshot?: string;
  referenceClickPoint?: { x, y };
}
```

**Response:**
```typescript
interface AgentResponse {
  action: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'done' | 'fail';
  params: { x?, y?, text?, direction?, amount?, url?, duration?, reason? };
  reasoning: string;
  confidence: number;
  hintStepIndex?: number;
}
```

## UI Changes

### Execution Mode Toggle

The sidepanel now has an execution mode toggle:

1. **AI Agent** (default) - Observe → Think → Act loop
   - More adaptive to UI changes
   - AI makes all decisions
   - Better for complex/dynamic UIs

2. **Selectors** - CSS/XPath based execution
   - Uses recorded selectors directly
   - Faster execution
   - Less adaptive to changes

### AI Agent Log

When using AI Agent mode, a real-time log shows:
- Each action taken
- AI reasoning
- Success/failure status
- Timestamps

## Message Types Added

- `EXECUTE_WORKFLOW_AGENT` - Trigger AI Agent execution
- `AGENT_PROGRESS` - Progress updates during execution
- `AGENT_EXECUTION_COMPLETED` - Final result

## Key Differences from Old System

| Aspect | Old (Selector-based) | New (AI Agent) |
|--------|---------------------|----------------|
| Decision maker | Extension code | AI/LLM |
| AI role | Fallback for finding elements | Primary controller |
| Recorded steps | Strict instructions | Hints/guidance |
| Adaptability | Limited | Can deviate if needed |
| Error recovery | Retry same action | AI reasons about what went wrong |
| Per-step logic | Complex orchestrator code | Simple execute loop |

## Benefits

1. **Smarter**: AI reasons about the goal, not just element finding
2. **Adaptive**: AI can handle unexpected states (modals, errors, changed UI)
3. **Simpler code**: Extension just executes, no complex decision logic
4. **Better debugging**: AI explains its reasoning for each action
5. **Future-proof**: Easy to improve by updating prompts, not code

## How to Test

1. Reload the extension
2. Open a saved workflow
3. Select "AI Agent" mode (default)
4. Click "Execute"
5. Watch the AI Agent Log to see reasoning and actions

## Prompt Structure

The AI receives a comprehensive prompt for each action:

```
# AI Web Automation Agent

## Your Goal
Create a new account in Salesforce

## Workflow Hints (from recording)
✓ Step 1: Click "New" button
→ Step 2: Fill in "Account Name" field  **<-- CURRENT**
○ Step 3: Click "Save" button

## Recent Actions Taken
✓ click({"x": 561, "y": 636}) - success

## Current Page
- URL: https://salesforce.com/Account/new
- Title: New Account | Salesforce

## Available Actions
- click(x, y): Click at specific coordinates
- type(text): Type text into the focused input field
- scroll(direction, amount): Scroll the page
- wait(duration): Wait for specified milliseconds
- done(): Workflow is complete
- fail(reason): Cannot continue

## Your Task
Look at the current screenshot. Decide what action to take next.
Return JSON with action, params, reasoning, confidence.
```

## Example Execution Flow

```
Step 1: AI observes Accounts page
        AI: "I see the Accounts list. Hint says click 'New' button. 
             I found 'New' button at (561, 636)."
        Action: click(561, 636)
        Result: Success - modal opens

Step 2: AI observes New Account modal
        AI: "Modal is open. Hint says fill 'Account Name'. 
             I need to click on the Account Name field first."
        Action: click(400, 250)
        Result: Success - field focused

Step 3: AI observes focused field
        AI: "Account Name field is focused. Hint value is 'Acme Corp'.
             Now I'll type the value."
        Action: type("Acme Corp")
        Result: Success - text entered

Step 4: AI observes filled form
        AI: "All hints completed. Clicking Save button."
        Action: click(700, 500)
        Result: Success

Step 5: AI observes saved page
        AI: "All workflow hints are completed. Returning done()."
        Action: done()
        Result: Workflow complete!
```

## Files Modified

- `src/sidepanel/App.tsx` - Added execution mode toggle and agent log
- `src/content/content-script.ts` - Added EXECUTE_WORKFLOW_AGENT handler
- `src/types/messages.ts` - Added new message types





