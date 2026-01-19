# Mimoai Codebase Documentation

**Last Updated:** January 2026
**Version:** Complete Reference Guide

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Directory Structure](#2-directory-structure)
3. [Core Architecture](#3-core-architecture)
4. [Entry Points](#4-entry-points)
5. [Recording System](#5-recording-system)
6. [Execution System](#6-execution-system)
7. [AI & Agent Systems](#7-ai--agent-systems)
8. [Skills System](#8-skills-system)
9. [Selector & Element Finding](#9-selector--element-finding)
10. [UI Components](#10-ui-components)
11. [Messaging System](#11-messaging-system)
12. [State Management](#12-state-management)
13. [Storage & Persistence](#13-storage--persistence)
14. [Type Definitions](#14-type-definitions)
15. [External Dependencies](#15-external-dependencies)
16. [Key Algorithms](#16-key-algorithms)
17. [Error Recovery](#17-error-recovery)
18. [Build & Development](#18-build--development)

---

## 1. Project Overview

### What is Mimoai?

Mimoai is an **AI-powered browser automation Chrome extension** that:
- Records user interactions on web pages
- Creates intelligent, reusable workflows
- Replays workflows with AI-powered element recovery
- Learns from user corrections to improve over time

### Core Innovation

| Feature | Description |
|---------|-------------|
| **Semantic Recording** | Captures human context (labels, placeholders, surrounding text) instead of brittle CSS selectors |
| **AI-Powered Recovery** | Uses Google Gemini 2.5 Flash for element recovery when selectors fail |
| **Variable Auto-Detection** | Automatically identifies which values should be parameters |
| **3-Tier Execution** | Balances speed (Tier 1) with reliability (Tier 2) and AI fallback (Tier 3) |
| **Skills System** | Extract reusable, parameterized skills from workflows |

### Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Zustand
- **AI Backend:** Google Gemini 2.5 Flash via Supabase Edge Functions
- **Database:** Supabase PostgreSQL (for AI caching)
- **Extension:** Chrome Manifest V3
- **Testing:** Vitest

---

## 2. Directory Structure

```
C:\Mimoai/
├── src/                          # Main source code
│   ├── background/               # Service Worker (background execution)
│   │   ├── service-worker.ts     # Message routing, tab coordination
│   │   ├── execution-controller.ts   # Execution state management
│   │   ├── network-capture.ts    # Network request interception
│   │   └── notification-service.ts   # Chrome notifications
│   │
│   ├── content/                  # Content Scripts (run on web pages)
│   │   ├── content-script.ts     # Main entry point
│   │   ├── recording-manager.ts  # Event listener orchestration
│   │   ├── recording/            # Recording subsystem
│   │   │   ├── element-finder.ts     # DOM element analysis
│   │   │   ├── step-enricher.ts      # Semantic context addition
│   │   │   └── step-publisher.ts     # Step publication
│   │   │
│   │   ├── universal-execution/  # Execution engine
│   │   │   ├── orchestrator.ts       # Workflow coordinator
│   │   │   ├── element-resolver.ts   # Multi-strategy finding
│   │   │   ├── component-detector.ts # Dropdown/modal detection
│   │   │   └── action-primitives/    # Low-level actions
│   │   │
│   │   ├── selector-engine.ts    # Selector generation
│   │   ├── label-finder.ts       # Human-readable labels
│   │   ├── context-scanner.ts    # Surrounding context
│   │   ├── dom-map.ts            # Semantic DOM for AI
│   │   ├── visual-snapshot.ts    # Screenshots for AI
│   │   ├── shadow-dom-utils.ts   # Web Component support
│   │   ├── iframe-utils.ts       # Cross-iframe handling
│   │   ├── recovery-engine.ts    # AI-powered recovery
│   │   └── state-wait-engine.ts  # Intelligent waits
│   │
│   ├── lib/                      # Business logic & utilities
│   │   ├── ai-agent.ts           # Main AI Agent (observe-act loop)
│   │   ├── ai-orchestrator.ts    # Skill-based orchestrator
│   │   ├── ai-service.ts         # Gemini API interface
│   │   ├── ai-cache.ts           # AI response caching
│   │   ├── tier1-executor.ts     # Fast-path execution
│   │   ├── tier3-vision-assist.ts    # Vision-based fallback
│   │   ├── skill-executor.ts     # Skill execution
│   │   ├── skill-storage.ts      # Skill persistence
│   │   ├── variable-detector.ts  # Variable detection
│   │   ├── store.ts              # Zustand state
│   │   ├── storage.ts            # Chrome.storage wrapper
│   │   └── bridge.ts             # Message bridge
│   │
│   ├── sidepanel/                # Side panel React UI
│   │   ├── App.tsx               # Main component
│   │   ├── ChatExecutor.tsx      # Skill chat interface
│   │   ├── VariableInputForm.tsx # Variable collection
│   │   ├── ReplayerView.tsx      # Execution progress
│   │   ├── ThinkingPanel.tsx     # AI chain-of-thought
│   │   ├── SkillsLibrary.tsx     # Skill browser
│   │   └── SettingsPanel.tsx     # Settings
│   │
│   ├── core/                     # Shared utilities
│   │   ├── shadow-dom-utils.ts   # Shadow DOM utilities
│   │   ├── text-matcher.ts       # Text matching
│   │   └── visibility-checker.ts # Visibility checks
│   │
│   └── types/                    # TypeScript definitions
│       ├── workflow.ts           # Workflow & step types
│       ├── messages.ts           # Message types
│       ├── execution.ts          # Execution types
│       ├── skill.ts              # Skill types
│       └── ai.ts                 # AI types
│
├── public/
│   └── manifest.json             # Extension manifest
│
├── dist/                         # Built extension
└── package.json                  # Dependencies
```

---

## 3. Core Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    MIMOAI EXTENSION                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  SIDE PANEL (React UI)                             │     │
│  │  ├─ WorkflowList / SkillsLibrary                   │     │
│  │  ├─ VariableInputForm (dynamic form)               │     │
│  │  ├─ ChatExecutor (skill chat)                      │     │
│  │  └─ ReplayerView (progress)                        │     │
│  └────────────────────────────────────────────────────┘     │
│           ↑                           ↓                      │
│       Messages                    Messages                   │
│           │                           │                      │
│  ┌────────┴───────────────────────────┴─────────────┐       │
│  │  SERVICE WORKER (Background)                     │       │
│  │  ├─ Message routing                              │       │
│  │  ├─ Tab coordination                             │       │
│  │  ├─ ExecutionController                          │       │
│  │  └─ Multi-tab recording                          │       │
│  └────────┬───────────────────────────┬─────────────┘       │
│           ↑                           ↓                      │
│  ┌────────┴───────────────────────────┴─────────────┐       │
│  │  CONTENT SCRIPTS (All URLs)                      │       │
│  │  ├─ RecordingManager (event capture)             │       │
│  │  ├─ AIAgent (observe-act loop)                   │       │
│  │  ├─ Tier1Executor (fast execution)               │       │
│  │  └─ RecoveryEngine (AI fallback)                 │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  SUPABASE EDGE FUNCTIONS                         │       │
│  │  ├─ recover_element (vision-based)               │       │
│  │  ├─ parse_intent (NLP)                           │       │
│  │  └─ teaching_conversation (skill learning)       │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Three-Tier Execution System

| Tier | Module | Strategy | Success Rate | Use Case |
|------|--------|----------|--------------|----------|
| **Tier 1** | `tier1-executor.ts` | Direct selector lookup | 60-80% | Fast, simple clicks |
| **Tier 2** | `universal-execution/` | 9 resolution strategies | 90%+ | Complex interactions |
| **Tier 3** | `tier3-vision-assist.ts` | AI vision analysis | 95%+ | Last resort recovery |

---

## 4. Entry Points

### Side Panel (`src/sidepanel/App.tsx`)
- **When:** User opens extension side panel
- **Purpose:** Main UI for recording, execution, and management
- **Key state:** `useExtensionStore()` (Zustand)

### Content Script (`src/content/content-script.ts`)
- **When:** Injected into every web page
- **Purpose:** Record interactions, execute workflows
- **Key handlers:** `START_RECORDING`, `EXECUTE_WORKFLOW`

### Service Worker (`src/background/service-worker.ts`)
- **When:** Extension loads
- **Purpose:** Message routing, tab coordination, state persistence
- **Key features:** Multi-tab recording, execution controller

### Manifest (`public/manifest.json`)
- Manifest V3 configuration
- Permissions: `storage`, `tabs`, `activeTab`, `scripting`, `debugger`

---

## 5. Recording System

### Recording Flow

```
User Interaction → Event Listener → Debounce → ElementFinder
                                                    ↓
                                              Data Collection
                                                    ↓
                                              StepEnricher
                                                    ↓
                                              StepPublisher → Side Panel
```

### Events Captured

| Event | Handler | Details |
|-------|---------|---------|
| **click** | `handleClick()` | Buttons, links, options (capture phase) |
| **input** | `handleInput()` | Text entry (500ms debounce) |
| **change** | `handleChange()` | Selects, checkboxes, radios |
| **keydown** | `handleKeyboard()` | Enter, Tab, Escape |
| **scroll** | `handleScroll()` | Page/container (300ms debounce) |
| **copy** | `handleCopy()` | Clipboard copy |
| **paste** | `handlePaste()` | Clipboard paste |

### Key Modules

| Module | File | Purpose |
|--------|------|---------|
| **RecordingManager** | `recording-manager.ts` | Orchestrates event listeners |
| **ElementFinder** | `recording/element-finder.ts` | Finds & validates elements |
| **StepEnricher** | `recording/step-enricher.ts` | Adds semantic context |
| **StepPublisher** | `recording/step-publisher.ts` | Sends to side panel |
| **SelectorEngine** | `selector-engine.ts` | Generates stable selectors |
| **LabelFinder** | `label-finder.ts` | Extracts human-readable labels |
| **VisualSnapshotService** | `visual-snapshot.ts` | Captures screenshots |

### Data Captured Per Step

```typescript
{
  type: 'CLICK' | 'INPUT' | 'KEYBOARD' | ...
  payload: {
    selector: string,           // Best CSS selector
    fallbackSelectors: string[],// Backup options
    label: string,              // Human-readable label
    value: string,              // Input value (if applicable)
    elementState: { visible, enabled, checked },
    elementBounds: { x, y, width, height },
    visualSnapshot: {
      viewport: string,         // Base64 screenshot
      elementSnippet: string    // Cropped element
    },
    locatorBundle: LocatorBundle,
    aiWidgetContext: AIWidgetContext
  }
}
```

---

## 6. Execution System

### Execution Flow

```
User clicks "Run" → Variable Collection → AIAgent.execute()
                                               ↓
                    ┌─────────────────────────────────────┐
                    │           OBSERVE PHASE             │
                    │  - Screenshot                       │
                    │  - DOM map                          │
                    │  - Modal/dropdown detection         │
                    └─────────────────────────────────────┘
                                       ↓
                    ┌─────────────────────────────────────┐
                    │           DECIDE PHASE              │
                    │  - Convert step to hint             │
                    │  - AI determines HOW to fulfill     │
                    └─────────────────────────────────────┘
                                       ↓
                    ┌─────────────────────────────────────┐
                    │            ACT PHASE                │
                    │  - Tier 1 (fast, direct)            │
                    │  - Tier 2 (smart, 9 strategies)     │
                    │  - Tier 3 (vision AI fallback)      │
                    └─────────────────────────────────────┘
                                       ↓
                    ┌─────────────────────────────────────┐
                    │          VERIFY PHASE               │
                    │  - Wait for stability               │
                    │  - Check expected outcome           │
                    └─────────────────────────────────────┘
                                       ↓
                              Loop or Complete
```

### Supported Actions

| Action | Execution | Verification |
|--------|-----------|--------------|
| **click** | MouseEvent dispatch | URL/DOM change |
| **type** | Set value + input event | Value matches |
| **select** | Open dropdown → find → click | Option selected |
| **scroll** | scrollIntoView | Element in viewport |
| **navigate** | location.href = url | URL matches |
| **keyboard** | KeyboardEvent dispatch | State change |
| **copy** | Trigger copy handler | Clipboard updated |
| **paste** | Trigger paste handler | Value in field |

### Key Modules

| Module | File | Purpose |
|--------|------|---------|
| **AIAgent** | `lib/ai-agent.ts` | Observe-act loop orchestration |
| **Tier1Executor** | `lib/tier1-executor.ts` | Fast deterministic execution |
| **ElementResolver** | `universal-execution/element-resolver.ts` | Multi-strategy finding |
| **ComponentDetector** | `universal-execution/component-detector.ts` | Dropdown/modal detection |
| **StateWaitEngine** | `content/state-wait-engine.ts` | Intelligent waits |
| **RecoveryEngine** | `content/recovery-engine.ts` | Failure recovery |

---

## 7. AI & Agent Systems

### AI Agent (`lib/ai-agent.ts`)

The AI Agent implements an **observe-think-act loop**:

```typescript
class AIAgent {
  async run(steps: WorkflowStep[]): Promise<AgentResult> {
    for (const step of steps) {
      // 1. OBSERVE: Capture current page state
      const observation = await this.observe();

      // 2. THINK: Convert step to semantic hint
      const hint = HintExtractor.extractHint(step);

      // 3. ACT: Execute with tiered fallback
      const result = await this.act(hint, observation);

      // 4. VERIFY: Check outcome
      await this.verify(result, step.expectedOutcome);
    }
  }
}
```

### Agent Action Types (18 total)

```typescript
type AgentActionType =
  | 'click' | 'type' | 'select' | 'multi_select'
  | 'scroll' | 'navigate' | 'wait' | 'assert'
  | 'keyboard' | 'hover' | 'copy' | 'paste'
  | 'tab_switch' | 'open_tab'
  | 'click_cell' | 'type_in_cell' | 'read_cell' | 'batch_type';
```

### Semantic Target (How AI finds elements)

```typescript
interface SemanticTarget {
  role?: string;           // 'button', 'textbox', 'link'
  name?: string;           // aria-label or visible text
  testId?: string;         // data-testid attribute
  text?: string;           // Button/link text
  placeholder?: string;    // Input placeholder
  scopeHint?: string;      // Region context ("in the header")
  recordedFallbackSelectors?: string[];
}
```

### AI Services

| Service | File | Purpose |
|---------|------|---------|
| **AIService** | `lib/ai-service.ts` | Gemini API interface |
| **AICache** | `lib/ai-cache.ts` | Response caching |
| **AIOrchestrator** | `lib/ai-orchestrator.ts` | Skill-based execution |
| **VisualAnalysisService** | `lib/visual-analysis.ts` | Page visual analysis |

### Edge Functions (Supabase)

| Function | Purpose |
|----------|---------|
| `recover_element` | Find elements despite DOM changes |
| `validate_selector` | Check selector stability |
| `generate_step_description` | Natural language descriptions |
| `parse_intent` | User intent parsing |
| `teaching_conversation` | Skill learning dialogue |

---

## 8. Skills System

### What is a Skill?

A **Skill** is a reusable, parameterized workflow extracted from recorded steps:

```typescript
interface TeachableSkill {
  id: string;
  name: string;                    // "Add item to promotion"
  description: string;

  // Execution
  steps: WorkflowStep[];           // Recorded steps
  variables: SkillVariable[];      // Parameters

  // AI Matching
  synonyms: string[];              // ["add product", "include item"]
  requiredContext: string[];       // URL patterns

  // Chaining
  prerequisites: SkillPrerequisite[];
  provides: string[];

  // Learning
  examples: SkillExample[];
  successCount: number;
  failureCount: number;
}
```

### Skill Execution Flow

```
User: "Add honey mustard to promotion"
           ↓
   AIOrchestrator.parseIntent()
           ↓
   Match to skill: "Add item to promotion"
           ↓
   Collect variables: { itemName: "honey mustard" }
           ↓
   SkillExecutionBridge.execute()
           ↓
   AIAgent runs with variable substitution
```

### Key Modules

| Module | File | Purpose |
|--------|------|---------|
| **SkillStorage** | `lib/skill-storage.ts` | Skill persistence |
| **SkillExecutor** | `lib/skill-executor.ts` | Variable substitution |
| **SkillExtractor** | `lib/skill-extractor.ts` | Extract from workflows |
| **SkillRequestParser** | `lib/skill-request-parser.ts` | Parse user requests |

---

## 9. Selector & Element Finding

### Selector Generation Strategy

| Strategy | Priority | Best For |
|----------|----------|----------|
| **TestID** | 1 | Well-tested apps (`data-testid`) |
| **Role** | 2 | ARIA-compliant apps |
| **Aria** | 3 | Apps with `aria-label` |
| **Text** | 4 | Dynamic content (fuzzy match) |
| **CSS** | 5 | Stable styling |
| **XPath** | 6 | Complex DOM |
| **Position** | 7 | Last resort (`nth-child`) |

### Fragility Detection

```typescript
// Detected as fragile (avoided):
/^[0-9]{3,}$/           // Long numeric IDs
/-[a-z0-9]{5,}$/        // Random hash suffixes
/:nth-(child|of-type)/  // Position-based
/\.(css|_css)-[a-z0-9]/ // CSS Modules
```

### Element Resolution Flow

```
LocatorBundle (strategies + scope)
           ↓
1. Resolve scope container
           ↓
2. Find candidates per strategy
           ↓
3. Filter to visible menu (if menu item)
           ↓
4. Score candidates at runtime
           ↓
5. Disambiguate if needed
           ↓
Return: found | ambiguous | not_found
```

### Fuzzy Text Matching

Uses **Dice coefficient** (bigram overlap):
- Threshold: 0.7+ for match
- Used for dropdown options, button text

---

## 10. UI Components

### Side Panel Components

| Component | File | Purpose |
|-----------|------|---------|
| **App** | `App.tsx` | Main orchestrator (2,430 lines) |
| **PreRecordingChat** | `PreRecordingChat.tsx` | Capture intent before recording |
| **PostRecordingChat** | `PostRecordingChat.tsx` | Skill learning after recording |
| **ChatExecutor** | `ChatExecutor.tsx` | Skill-based chat interface |
| **ReplayerView** | `ReplayerView.tsx` | Execution progress |
| **ThinkingPanel** | `ThinkingPanel.tsx` | AI chain-of-thought |
| **VariableInputForm** | `VariableInputForm.tsx` | Variable collection |
| **SkillsLibrary** | `SkillsLibrary.tsx` | Skill browser |
| **SettingsPanel** | `SettingsPanel.tsx` | Settings |
| **OptionConfirmationModal** | `OptionConfirmationModal.tsx` | Fuzzy match confirmation |

### User Flow

```
1. PRE-RECORDING
   └─ PreRecordingChat → Capture intent → START_RECORDING

2. RECORDING
   └─ Event listeners → RECORDED_STEP → Display steps

3. POST-RECORDING
   └─ PostRecordingChat → Learn skill → Save workflow/skill

4. EXECUTION
   └─ Select skill → Variables → Execute → ThinkingPanel → Complete
```

---

## 11. Messaging System

### Message Flow

```
Side Panel  ←→  Service Worker  ←→  Content Script
    ↓               ↓                    ↓
 React UI      Route/Coordinate      Execute/Record
```

### Key Message Types (99 total)

**Recording:**
```typescript
'START_RECORDING' | 'STOP_RECORDING' | 'RECORDED_STEP' | 'UPDATE_STEP'
```

**Execution:**
```typescript
'EXECUTE_WORKFLOW_UNIVERSAL' | 'AGENT_THINKING' | 'AGENT_EXECUTION_COMPLETED'
'EXECUTION_CONTROL' | 'EXECUTION_STATE_CHANGED'
```

**Cross-Frame:**
```typescript
'EXECUTE_IN_FRAME' | 'GET_IFRAME_DOM_MAP' | 'GET_FRAME_ID'
```

**User Interaction:**
```typescript
'OPTION_MATCH_CONFIRMATION_NEEDED' | 'OPTION_MATCH_CONFIRMED'
```

### Runtime Bridge (`lib/bridge.ts`)

Centralized messaging with retry logic:
- 5 retries with exponential backoff
- Handles both background and tab messaging

---

## 12. State Management

### Three-Tier State System

| Tier | Location | Scope | Lifespan |
|------|----------|-------|----------|
| **Zustand** | `lib/store.ts` | UI state | Session |
| **chrome.storage.local** | Various | User data | Permanent |
| **chrome.storage.session** | ExecutionController | Execution | Browser session |

### Zustand Store State

```typescript
{
  state: ExtensionState,           // IDLE, RECORDING, EXECUTING, etc.
  connectionStatus: ConnectionStatus,
  workflowSteps: WorkflowStep[],   // Current recording
  savedWorkflows: SavedWorkflow[], // Library
  isRecording: boolean,
  executionMode: 'exact' | 'adaptive' | 'auto',
  pendingAIValidations: Set<string>,
  recordedTabs: Map<number, TabInfo>
}
```

---

## 13. Storage & Persistence

### Storage Keys

| Key | Data | Location |
|-----|------|----------|
| `ghostwriter-workflows` | SavedWorkflow[] | chrome.storage.local |
| `ghostwriter-skills` | SkillDefinition[] | chrome.storage.local |
| `ghostwriter_corrections` | CorrectionEntry[] | chrome.storage.local |
| `execution_session` | ExecutionSession | chrome.storage.session |
| `agentState` | AgentState | chrome.storage.session |

### Storage Classes

| Class | File | Purpose |
|-------|------|---------|
| **WorkflowStorage** | `lib/storage.ts` | Workflow CRUD |
| **SkillStorage** | `lib/skill-storage.ts` | Skill CRUD |
| **CorrectionMemory** | `lib/correction-memory.ts` | Learning storage |
| **ExecutionController** | `background/execution-controller.ts` | Session state |

---

## 14. Type Definitions

### Core Types (`types/workflow.ts`)

```typescript
// Step types
type WorkflowStepType = 'CLICK' | 'INPUT' | 'NAVIGATION' | 'KEYBOARD' |
                        'SCROLL' | 'TAB_SWITCH' | 'COPY' | 'PASTE';

// Workflow step
interface WorkflowStep {
  type: WorkflowStepType;
  payload: WorkflowStepPayload;
  description?: string;
  naturalLanguage?: NaturalLanguageContext;
}

// Saved workflow
interface SavedWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  variables?: WorkflowVariables;
  createdAt: number;
  updatedAt: number;
}
```

### Execution Types (`types/execution.ts`)

```typescript
interface ExecutionSession {
  id: string;
  workflowId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  currentStepIndex: number;
  totalSteps: number;
  pauseReason?: string;
  humanHelpContext?: HumanHelpContext;
}
```

### Skill Types (`types/skill.ts`)

```typescript
interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables: VariableDefinition[];
  synonyms: string[];
  isRepeatable: boolean;
}

interface VariableDefinition {
  fieldName: string;
  variableName: string;
  defaultValue: string;
  inputType?: string;
  options?: string[];
}
```

---

## 15. External Dependencies

### Google Gemini API
- **Via:** Supabase Edge Functions (server-side)
- **Used for:** Vision analysis, variable detection, intent parsing
- **API Key:** Stored in Supabase secrets

### Supabase
- **Functions:** AI calls, skill cloud storage
- **Database:** PostgreSQL for caching

### Chrome Extension APIs
- `storage` - Data persistence
- `tabs` - Tab management
- `activeTab` - Current tab access
- `scripting` - Content script injection
- `debugger` - Network capture, trusted clicks
- `sidePanel` - Side panel UI

---

## 16. Key Algorithms

### Fuzzy Text Matching (Dice Coefficient)

```typescript
function textSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  };
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  let intersection = 0;
  for (const bg of aBigrams) {
    if (bBigrams.has(bg)) intersection++;
  }
  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}
```

### Candidate Scoring

```
Total Score = 0.4 × feature_score + 0.3 × runtime_score + 0.3 × match_score

Feature score:
  +0.2: stable attributes (data-testid, aria-label)
  +0.15: unique match at record time
  -0.2: dynamic parts (random IDs)

Runtime score:
  - Element still visible?
  - Element in same scope?
  - Any duplicates?
```

---

## 17. Error Recovery

### Recovery Strategies

| Strategy | Action |
|----------|--------|
| **WAIT_FOR_STABILITY** | DOM/network/spinners settle |
| **DISMISS_POPUPS** | Escape key, safe close buttons |
| **SCROLL_INTO_VIEW** | Smart scroll with offset |
| **RETRY_LOOSER_MATCH** | Lower fuzzy thresholds |

### Tiered Fallback

```
Tier 1 fails → Tier 2 (9 strategies)
Tier 2 fails → Tier 3 (AI vision)
Tier 3 fails → RecoveryEngine actions
Still fails → Human help requested
```

### Correction Learning

```
User corrects → CorrectionMemory.save()
                       ↓
Later similar failure → CorrectionMemory.find()
                       ↓
                 Apply learned pattern
```

---

## 18. Build & Development

### Commands

```bash
npm run build          # Production build → dist/
npm run dev            # Development server
npm run lint           # ESLint check
npm run test           # Run tests
npm run test:watch     # Watch mode
```

### Installation

1. `npm install`
2. `npm run build`
3. Chrome → `chrome://extensions` → Load unpacked → Select `dist/`

### Key Config Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Build configuration |
| `tsconfig.json` | TypeScript settings |
| `tailwind.config.js` | Styling |
| `public/manifest.json` | Extension manifest |

---

## Quick Reference: File → Purpose

| File | Purpose |
|------|---------|
| `recording-manager.ts` | Event listeners, step capture |
| `tier1-executor.ts` | Fast DOM-based execution |
| `ai-agent.ts` | Observe-act loop |
| `ai-orchestrator.ts` | Skill matching & execution |
| `element-resolver.ts` | Multi-strategy element finding |
| `skill-storage.ts` | Skill persistence |
| `store.ts` | Zustand state management |
| `service-worker.ts` | Message routing |
| `App.tsx` | Main UI component |
| `ChatExecutor.tsx` | Skill chat interface |

---

*This documentation covers the complete Mimoai architecture. For specific implementation details, refer to the source files mentioned in each section.*
