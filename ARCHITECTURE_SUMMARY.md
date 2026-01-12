# mimoai Architecture Summary

## Overview

mimoai is a Chrome Extension (Manifest V3) that records user interactions on web pages and replays them using an AI-powered execution engine. The system is designed to handle complex enterprise applications like Salesforce, Google Sheets, and Gainsight.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Chrome Extension                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐   │
│  │  Sidepanel   │◄──►│  Service Worker │◄──►│  Content Script  │   │
│  │   (React)    │    │   (Background)  │    │  (Per Tab/Frame) │   │
│  └──────────────┘    └─────────────────┘    └──────────────────┘   │
│        │                     │                       │              │
│        │                     │                       │              │
│        ▼                     ▼                       ▼              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Message Bridge                             │  │
│  │  (chrome.runtime.sendMessage / chrome.tabs.sendMessage)       │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Supabase Edge        │
                    │  Functions (AI)       │
                    │  - analyze_intent     │
                    │  - visual_click       │
                    │  - dom_agent          │
                    │  - translate_step     │
                    │  - ...18 functions    │
                    └───────────────────────┘
```

---

## Component Details

### 1. Sidepanel (`src/sidepanel/App.tsx`)

The React-based UI that users interact with.

**Key Features:**
- **Teaching Mode**: Pre-recording chat to capture user intent
- **Recording Display**: Shows recorded steps in real-time
- **Workflow Management**: Save, load, execute, export workflows
- **Variable Form**: Prompts for variable values before execution
- **Thinking Panel**: Shows AI agent's reasoning during execution
- **Execution Control**: Pause/Resume/Stop buttons

**State Management:**
- Uses Zustand store (`src/lib/store.ts`)
- Manages: recording state, workflow steps, saved workflows, execution state

---

### 2. Service Worker (`src/background/service-worker.ts`)

The persistent background process that coordinates all extension operations.

**Key Responsibilities:**

1. **Multi-Tab Recording Coordination**
   - Tracks active recording tabs (`activeRecordingTabs`)
   - Manages logical tab indexing (`sessionTabMap`)
   - Creates TAB_SWITCH steps when user switches tabs
   - Handles pending new tabs (chrome://newtab → real URL)

2. **Message Routing**
   - Routes messages between Sidepanel ↔ Content Scripts
   - Forwards RECORDED_STEP messages to sidepanel
   - Handles cross-frame execution routing

3. **Execution State Management**
   - Uses `ExecutionController` for persistent state
   - Survives page reloads and tab switches
   - Enables pause/resume from both user and AI

4. **Chrome APIs**
   - `chrome.debugger` for trusted mouse events
   - `chrome.tabs.captureVisibleTab` for screenshots
   - `chrome.sidePanel` for UI panel
   - `chrome.tabs` for tab management

---

### 3. Content Script (`src/content/content-script.ts`)

Injected into every web page, handles DOM interaction.

**Key Components:**

#### RecordingManager (`src/content/recording-manager.ts`)
The main orchestrator for recording user actions.

**Event Listeners:**
- `click` (capture phase for dropdown support)
- `input` (with 500ms debounce)
- `change` (for selects, checkboxes)
- `keydown` (Enter, Tab, Escape, copy/paste)
- `focus` (to track current input)
- `scroll` (with 300ms debounce)
- `copy/paste` (clipboard events)

**Data Captured Per Step:**
```typescript
WorkflowStepPayload {
  selector: string;              // Primary CSS selector
  fallbackSelectors: string[];   // Backup selectors
  xpath: string;                 // XPath selector
  label: string;                 // Human-readable label
  value: string;                 // Input value (for INPUT steps)
  timestamp: number;
  url: string;
  
  // Rich metadata
  elementState: { visible, enabled, readonly, checked }
  eventDetails: { mouseButton, modifiers, coordinates }
  viewport: { width, height, scrollX, scrollY }
  elementBounds: { x, y, width, height }
  iframeContext?: { selector, src, frameId }
  
  // Visual snapshots
  visualSnapshot?: {
    viewport: string;           // Base64 screenshot
    annotated: string;          // Screenshot with click marker
    clickPoint: { x, y }
  }
  
  // AI context
  aiEvidence: {
    contextSnapshot: string;    // Distilled DOM
    semanticAnchors: { textLabel, nearbyText, ariaLabel }
  }
  
  // Reliable Replayer
  locatorBundle: LocatorBundle;
  intent: Intent;
  naturalLanguage: { intent, precondition, expectedOutcome }
}
```

#### Specialized Modules:
- `ElementFinder`: Locates elements by various strategies
- `StepEnricher`: Adds metadata, screenshots, AI context
- `StepPublisher`: Sends steps to sidepanel
- `SelectorEngine`: Generates robust CSS selectors
- `LabelFinder`: Extracts human-readable labels
- `ContextScanner`: Captures surrounding DOM context
- `SheetStateExtractor`: Google Sheets cell/column detection

---

### 4. Execution Controller (`src/background/execution-controller.ts`)

Centralized state management for workflow execution.

**Session State:**
```typescript
ExecutionSession {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowSteps: WorkflowStep[];
  status: 'running' | 'paused' | 'stopped' | 'waiting_for_human' | 'completed' | 'failed';
  currentStepIndex: number;
  totalSteps: number;
  pauseReason?: 'user_requested' | 'agent_needs_help' | 'error_recovery';
  humanHelpContext?: { stepDescription, whatAgentTried, whatHumanShouldDo };
  agentState?: AgentState;
  tabId: number;
}
```

**Storage:** Uses `chrome.storage.session` (survives reloads, cleared on browser close)

---

## Execution Architecture: 3-Tier System

### Tier 1: Deterministic Executor (`src/lib/tier1-executor.ts`)

**"Hands + Reflexes"** - Fast, deterministic execution without LLM calls.

**Capabilities:**
- DOM element resolution via `Resolver`
- Interactability checks (visible, enabled, not covered)
- Safe clicking/typing with action primitives
- Stability waits (DOM settle, network idle)
- Outcome verification

**Rejection Codes (not generic errors):**
- `NOT_FOUND`: No candidates matched
- `AMBIGUOUS`: Multiple candidates, can't decide
- `NOT_INTERACTABLE`: Element not clickable/visible
- `SCOPE_FAILED`: Container scope not found
- `UNSAFE_ACTION`: Would click dangerous button
- `OUTCOME_FAILED`: Action succeeded but verification failed

```typescript
// Example flow
Tier1Executor.execute({
  type: 'click',
  params: {
    target: {
      role: 'button',
      name: 'Save',
      scopeHint: 'Account Form'
    }
  }
})
→ Resolve element
→ Check interactability
→ Execute click
→ Verify outcome
→ Return success or rejection code
```

---

### Tier 2: AI Agent (`src/lib/ai-agent.ts`)

**"Brain"** - Intelligent decision-making with observe-act loop.

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent Loop                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   1. OBSERVE                                            │
│      ├─ Capture DOM map (simplified tree)              │
│      ├─ Detect modals/dropdowns                        │
│      ├─ Check page URL/title                           │
│      └─ (Optional) Capture screenshot                  │
│                                                         │
│   2. THINK (via Supabase Edge Function)                │
│      ├─ Receive current observation                    │
│      ├─ Receive workflow hints (from recording)        │
│      ├─ Decide next action                             │
│      └─ Return action + reasoning                      │
│                                                         │
│   3. ACT (via Tier 1 Executor)                         │
│      ├─ Try recorded selectors FIRST (fast-path)       │
│      ├─ Fall back to semantic resolution               │
│      └─ Fall back to visual click if needed            │
│                                                         │
│   4. VERIFY                                             │
│      ├─ Check expected outcomes                        │
│      ├─ Detect page changes                            │
│      └─ Update hint completion status                  │
│                                                         │
│   5. LOOP until done/failed/stuck                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Agent Hints (from recorded workflow):**
```typescript
AgentHint {
  stepNumber: number;
  description: string;
  actionType: 'click' | 'type' | 'select' | 'navigate' | 'scroll';
  targetText?: string;
  targetRole?: string;
  recordedSelector?: string;
  recordedFallbackSelectors?: string[];  // CRITICAL: Tried FIRST
  recordedAriaLabel?: string;
  recordedScopeHint?: string;
  referenceScreenshot?: string;
  naturalLanguage?: { intent, precondition, expectedOutcome };
  spreadsheetContext?: { ... };  // For Google Sheets
}
```

**Stuck Detection:**
- Tracks consecutive failures per hint
- After 3 failures: marks hint as skipped, moves to next
- Can request human help for critical steps

---

### Tier 3: Vision Assist (`src/lib/tier3-vision-assist.ts`)

**"Eyes"** - Visual AI fallback when DOM resolution fails.

**How it works:**
1. Captures current viewport screenshot
2. Compares with recording-time annotated screenshot
3. Uses Gemini Vision to find matching element
4. Returns coordinates for click

**Used when:**
- Element has dynamic selectors (Salesforce Lightning)
- DOM structure changed significantly
- Feature flag `VISION_CLICKER` is enabled

---

## Universal Execution Orchestrator (`src/content/universal-execution/orchestrator.ts`)

Pattern-based execution engine that handles different component patterns.

**Supported Patterns:**
- `SIMPLE_CLICK`: Standard element clicks
- `DROPDOWN_SELECT`: Open dropdown → select option
- `TEXT_INPUT`: Focus → clear → type
- `TAB_SWITCH`: Multi-tab navigation
- `SCROLL`: Window or container scroll
- `TOGGLE`, `TAB_SELECT`, `MODAL_TRIGGER`: Specialized clicks

**Execution Strategy Selection (from recording):**
```typescript
executionStrategy: 'SIMPLE' | 'AI_RECOMMENDED' | 'AI_REQUIRED'

// SIMPLE: Use fast 2s selector timeout
// AI_RECOMMENDED: Try selectors, fall back to AI visual
// AI_REQUIRED: Use AI visual click first (annotated screenshot)
```

---

## Supabase Edge Functions

### AI-Powered Functions:

| Function | Purpose |
|----------|---------|
| `analyze_intent` | Analyzes workflow to generate description + step translations |
| `dom_agent` | AI decides next action based on DOM map + hints |
| `visual_click` | Finds element using screenshot comparison |
| `visual_agent` | Full visual agent for complex scenarios |
| `translate_step` | Converts step to natural language |
| `detect_variables` | Identifies parameterizable values |
| `recover_element` | AI-powered element recovery |
| `extract_field_label` | Gets human-readable field labels |
| `widget_identifier` | Identifies widget/container boundaries |
| `smart_input_handler` | Handles complex input patterns |

### Utility Functions:

| Function | Purpose |
|----------|---------|
| `validate_selector` | Checks selector reliability |
| `generate_step_description` | Creates step descriptions |
| `classify_page_type` | Identifies page type (form, table, dashboard) |
| `debug_step_failure` | Analyzes why a step failed |
| `analyze_navigation_steps` | Optimizes navigation sequences |

---

## Data Flow: Recording

```
User Click on Page
        │
        ▼
┌───────────────────────┐
│   Event Listener      │  (capture phase)
│   (click, input, etc) │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   ElementFinder       │  Find clicked element
│   + SelectorEngine    │  Generate robust selectors
│   + LabelFinder       │  Extract human-readable label
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   StepEnricher        │  Add metadata:
│                       │  - Visual snapshot
│                       │  - Element context
│                       │  - AI evidence
│                       │  - Locator bundle
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   StepPublisher       │  Send to service worker
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   Service Worker      │  Route to sidepanel
│                       │  Track tab context
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   Sidepanel UI        │  Display in step list
│                       │  Store in Zustand
└───────────────────────┘
```

---

## Data Flow: Execution

```
User clicks "Run" on Workflow
        │
        ▼
┌───────────────────────┐
│   Sidepanel           │  Check for variables
│                       │  Show variable form if needed
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   ExecutionController │  Create execution session
│   (Service Worker)    │  Persist to chrome.storage.session
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   Content Script      │  Receive EXECUTE_WORKFLOW_AGENT
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│   AI Agent            │  Extract hints from workflow steps
│                       │  Initialize with variable values
└───────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│                    Agent Loop                          │
│                                                        │
│   For each hint:                                       │
│   ┌────────────────────────────────────────────────┐  │
│   │ 1. FAST PATH: Try recorded selectors           │  │
│   │    - recordedFallbackSelectors (with context)  │  │
│   │    - Primary selector                          │  │
│   │    - XPath                                     │  │
│   │    → 95% success rate, 0ms LLM latency         │  │
│   └────────────────────────────────────────────────┘  │
│              │ (fails)                                 │
│              ▼                                         │
│   ┌────────────────────────────────────────────────┐  │
│   │ 2. SEMANTIC RESOLUTION                         │  │
│   │    - Use role, name, text, scopeHint           │  │
│   │    - Candidate scoring with nearbyText         │  │
│   └────────────────────────────────────────────────┘  │
│              │ (fails)                                 │
│              ▼                                         │
│   ┌────────────────────────────────────────────────┐  │
│   │ 3. AI VISUAL CLICK (if enabled)                │  │
│   │    - Send annotated screenshot to Gemini       │  │
│   │    - Get click coordinates                     │  │
│   └────────────────────────────────────────────────┘  │
│              │ (fails)                                 │
│              ▼                                         │
│   ┌────────────────────────────────────────────────┐  │
│   │ 4. STUCK DETECTION                             │  │
│   │    - 3 consecutive failures → skip hint        │  │
│   │    - Request human help for critical steps     │  │
│   └────────────────────────────────────────────────┘  │
│                                                        │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────┐
│   Completion          │  Broadcast status to sidepanel
│                       │  Show notification
└───────────────────────┘
```

---

## Key Design Decisions

### 1. Fast-Path First Strategy
- Try recorded selectors before any AI calls
- 95% of steps succeed with 0ms LLM latency
- AI only used for recovery/adaptation

### 2. Rich Recording Metadata
- Capture everything at recording time
- Visual snapshots with click annotations
- Multiple selector strategies per element
- Context/scope information for disambiguation

### 3. Centralized Execution State
- `ExecutionController` in service worker
- Survives page reloads and tab switches
- Enables pause/resume from anywhere

### 4. Semantic Element Resolution
- Not just CSS selectors - use roles, labels, text
- Scope hints for widget/container context
- Nearby text for disambiguation

### 5. Graceful Degradation
- Tier 1 → Tier 2 → Tier 3 fallback chain
- Never crash on single step failure
- Skip and continue with stuck detection

---

## File Structure Summary

```
src/
├── sidepanel/           # React UI
│   ├── App.tsx          # Main app component
│   ├── VariableInputForm.tsx
│   ├── ThinkingPanel.tsx
│   └── WorkflowDetails.tsx
│
├── background/          # Service Worker
│   ├── service-worker.ts    # Main coordinator
│   ├── execution-controller.ts
│   └── notification-service.ts
│
├── content/             # Content Script
│   ├── content-script.ts    # Entry point
│   ├── recording-manager.ts # Main recorder
│   ├── recording/           # Recording modules
│   │   ├── element-finder.ts
│   │   ├── step-enricher.ts
│   │   └── step-publisher.ts
│   ├── universal-execution/ # Pattern-based executor
│   │   ├── orchestrator.ts
│   │   ├── element-resolver.ts
│   │   └── action-primitives/
│   └── ... (other utilities)
│
├── lib/                 # Shared libraries
│   ├── ai-agent.ts      # AI Agent brain
│   ├── tier1-executor.ts # Deterministic executor
│   ├── tier3-vision-assist.ts
│   ├── ai-visual-click.ts
│   ├── ai-service.ts    # Supabase client
│   ├── storage.ts       # Workflow persistence
│   └── ... (other services)
│
├── types/               # TypeScript definitions
│   ├── workflow.ts      # Core workflow types
│   ├── messages.ts      # Extension messaging
│   └── ... (other types)
│
supabase/
└── functions/           # Edge Functions (AI backend)
    ├── analyze_intent/
    ├── dom_agent/
    ├── visual_click/
    └── ... (18 total functions)
```

---

## Feature Flags (`src/lib/feature-flags.ts`)

Control experimental features:
- `AI_AGENT_LOOP`: Enable AI agent execution
- `VISION_CLICKER`: Enable visual click fallback
- `AI_LABEL_ENHANCER`: Use AI for label extraction
- ... and others

---

## Summary

mimoai implements a sophisticated 3-tier execution architecture:

1. **Recording**: Captures rich metadata including selectors, labels, screenshots, and AI context
2. **Storage**: Workflows persisted with variables, optimization metadata, and learned skills
3. **Execution**: Fast-path selectors → Semantic resolution → Visual AI fallback
4. **State Management**: Centralized controller for pause/resume across page navigations

The design prioritizes **reliability** (multiple fallback strategies) and **speed** (fast-path first) while maintaining **adaptability** (AI recovery when DOM changes).
