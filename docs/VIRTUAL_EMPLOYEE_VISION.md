# Virtual Employee Vision

> **A virtual employee that lives in your browser. You teach it, it works for you.**

This document captures the product vision and technical planning for transforming Mimo from a workflow replay tool into a true virtual assistant.

---

## Core Philosophy

### What We're Building
A browser-based virtual employee that:
- You train by demonstrating tasks (like onboarding a new hire)
- Learns skills from demonstrations
- Executes tasks intelligently, not just replaying scripts
- Adapts when things change
- Handles multiple items when asked
- Asks for help when stuck
- **Knows all the skills it has learned** (like an employee who remembers their training)

### What We're NOT Building
- A macro recorder that replays exact clicks
- A rigid automation that breaks when UI changes
- A tool that requires technical knowledge to use

---

## Key Decisions Made

### 1. Execution Model
**Decision:** Hybrid approach (Option C)
- Try recorded approach first
- Deviate/adapt when needed
- Use demonstration as guidance, not rigid script

### 2. Trigger Methods
**Decision:** Both supported
- Natural language: "Add a contact"
- Workflow selection: Pick from list of learned skills

### 3. Complex Workflows
**Decision:** Teach sequences of goals
- Multi-step workflows are sequences of sub-goals
- Each part has its own purpose and success criteria

### 4. Teaching Requirement
**Decision:** Demo is a must
- Always require demonstration to train
- This is how users "hire and train" their virtual employee
- Recording = Training session

### 5. Learning Enhancement
**Decision:** AI asks questions when uncertain
- Recording captures the WHAT
- AI asks about things it's unsure about (WHY, PURPOSE)
- Questions are targeted, not a checklist
- Feels like training a real employee who asks clarifying questions

### 6. AI Knowledge Scope
**Decision:** AI knows all learned skills
- AI has access to ALL skills it has been taught
- Can match natural language requests to relevant skills
- Knows what it can and cannot do
- Can suggest skills when relevant

---

## Mental Model Shift

| Concept | Old (Replay) | New (Virtual Employee) |
|---------|--------------|------------------------|
| Recording | Script to replay | Training session |
| Saved workflow | Automation rule | A skill they learned |
| Execution | Running a macro | "Do that thing I showed you" |
| Variables | Parameters to substitute | Instructions for the task |
| Failure | Script broken | Employee adapts or asks for help |
| Multiple items | Needs special iteration logic | Natural: "do this for each" |
| AI Knowledge | Just current workflow | All learned skills |

---

## Core Experience Flow

```
1. TEACH
   User: "Let me show you how to add a contact in Salesforce"
   *demonstrates the task*
   AI: "Got it! I have a few questions..."
   AI: "What is the Lead Source field for? You selected 'Web'."
   User: "Always use Web for contacts I add manually."
   AI: "I learned how to add contacts."

2. USE (Direct)
   User: "Add John Smith as a contact"
   AI: *knows the skill, does it*
   AI: "Done. John Smith has been added."

3. USE (Natural Language)
   User: "I need to put a new person in the CRM"
   AI: *matches to "Add Contact" skill*
   AI: "I can add a contact for you. What's their name?"

4. SCALE
   User: "Add these 5 people as contacts"
   AI: *does it 5 times using the skill*
   AI: "Done. Added all 5 contacts."

5. ADAPT
   *Salesforce UI updated slightly*
   AI: *understands goal, finds the new button location*
   AI: "Done. (The UI changed but I found the right button)"

6. KNOW LIMITATIONS
   User: "Send an email to John"
   AI: "I haven't learned how to send emails yet.
        Would you like to teach me?"
```

---

## AI Knowledge Architecture

### The AI Knows All Its Skills

When user interacts with AI (chat or execution), AI has access to:

```
┌─────────────────────────────────────────────────────────────┐
│                    AI SKILL MEMORY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Skills I Know:                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Add Contact (Salesforce)                         │   │
│  │    - Goal: Create new contact in CRM                │   │
│  │    - Inputs: name, email, phone (optional)          │   │
│  │    - Triggers: "add contact", "new person in CRM"   │   │
│  │    - Confidence: 95%                                │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. Create Invoice (QuickBooks)                      │   │
│  │    - Goal: Generate new invoice                     │   │
│  │    - Inputs: client, amount, items                  │   │
│  │    - Triggers: "create invoice", "bill client"      │   │
│  │    - Confidence: 90%                                │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. Update Spreadsheet Row (Google Sheets)           │   │
│  │    - Goal: Modify data in specific row              │   │
│  │    - Inputs: row identifier, new values             │   │
│  │    - Triggers: "update row", "change spreadsheet"   │   │
│  │    - Confidence: 85%                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  I have NOT learned:                                        │
│  - Sending emails                                           │
│  - Calendar management                                      │
│  - File uploads                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### How AI Uses This Knowledge

**During Chat:**
```
User: "Can you help me with the CRM?"

AI thinking: I know "Add Contact (Salesforce)" which is CRM-related.

AI: "Yes! I know how to add contacts in Salesforce.
     Would you like me to do that, or teach me something new?"
```

**During Execution:**
```
User: "Add a new person named John"

AI thinking:
- Match "add a new person" → "Add Contact" skill (90% match)
- Extract parameter: name = "John"
- I have this skill with 95% confidence

AI: "I'll add John as a contact." *executes skill*
```

**When Asked About Capabilities:**
```
User: "What can you do?"

AI: "I've learned these skills:
     1. Add Contact in Salesforce
     2. Create Invoice in QuickBooks
     3. Update rows in Google Sheets

     Want me to do any of these, or teach me something new?"
```

---

## Execution Model (Goal-Oriented)

### Current vs Target Execution

**Current (Step Replay):**
```
for each step in recording:
    find element matching step.selector
    execute action
    if not found: try recovery
```

**Target (Goal Pursuit):**
```
load skill knowledge (goal, inputs, success criteria, demonstration)

while goal not achieved:
    observe current page state
    think: "What should I do to achieve the goal?"
    decide next action (using skill knowledge as guidance)
    execute action
    verify: "Did this work? Am I closer to the goal?"

if success criteria met:
    report success
else if stuck:
    ask user for help
```

### What We Send to LLM During Execution

**Current (Step-Focused):**
```javascript
{
  domMap: "...",
  hint: { description: "Click Add button", targetText: "Add" },
  goal: "Add contact",
  variableValues: { name: "John" }
}
```

**Target (Knowledge-Focused):**
```javascript
{
  // Current page state
  pageState: {
    url: "https://salesforce.com/contacts",
    domMap: "...",
    screenshot: "..." // optional
  },

  // Full skill knowledge
  skill: {
    name: "Add Contact",
    goal: "Create a new contact in the CRM",

    inputs: {
      name: "John Smith",      // provided by user
      email: null,             // not provided
      phone: null              // optional anyway
    },

    successCriteria: [
      "'Contact Created' toast appears",
      "Contact visible in list"
    ],

    keyKnowledge: [
      "Lead Source should always be 'Web'",      // from Q&A
      "Phone field is optional",                  // from Q&A
      "Use 'Save', not 'Save & New'"             // from Q&A
    ],

    requiredInputs: ["name"],
    optionalInputs: ["email", "phone"]
  },

  // Demonstration as reference (not script)
  demonstration: [
    { step: 1, action: "click", what: "New Contact button", why: "Open the form" },
    { step: 2, action: "type", what: "Name field", why: "Enter contact name" },
    { step: 3, action: "select", what: "Lead Source", why: "Set to Web" },
    { step: 4, action: "click", what: "Save button", why: "Create the contact" }
  ],

  // Current progress
  progress: {
    currentState: "Contact form is open, fields are empty",
    actionsCompleted: ["Clicked New Contact button"],
    goalProgress: "25% - form open, not filled yet"
  },

  // All skills AI knows (for context)
  otherSkills: [
    { name: "Create Invoice", domain: "QuickBooks" },
    { name: "Update Spreadsheet", domain: "Google Sheets" }
  ],

  // The question
  question: "What should I do next to add John Smith as a contact?"
}
```

### LLM Response (Goal-Oriented)

```javascript
{
  reasoning: "The form is open. I need to fill in the name first.
              Based on the demonstration, the Name field should be filled.
              I see a field labeled 'Full Name' which matches.",

  action: {
    type: "type",
    target: { role: "textbox", name: "Full Name" },
    value: "John Smith"
  },

  progressUpdate: "Filling in contact name",

  goalStatus: "in_progress",  // not "step_3_complete"

  confidence: 0.95
}
```

---

## What Recording Captures vs Misses

### Captures (the WHAT)
- Sequence of actions (clicks, types, selections)
- Element information (selectors, text, roles)
- Values entered
- URLs visited
- Visual snapshots
- Page context

### Misses (the WHY)
- Why this path over alternatives?
- What's required vs optional?
- What's intentional vs incidental?
- What does success look like?
- What if something's different?
- Business rules and context

**→ AI Questions fill the gap by asking about uncertain areas**

---

## AI Questions After Recording

AI asks questions when it's **uncertain**, not as a checklist.

### When AI Asks

| AI is uncertain about... | Example Question |
|--------------------------|------------------|
| Purpose of an action | "What is the 'Archive' button for? Should I ever use it?" |
| Required vs optional | "You skipped the Phone field. Is it optional?" |
| Specific choice | "You selected 'Priority: High'. Should I always use High?" |
| Success verification | "How do I know if the save worked?" |
| Timing/waiting | "Should I wait for something after clicking Load?" |

### When AI Doesn't Ask
- Obvious actions (clicking clearly labeled buttons)
- Standard patterns (filling form fields with provided values)
- High-confidence inferences

### Q&A Flow

```
Recording ends → AI Analyzing...

AI: "I learned how to add a contact! A few things I want to clarify:"

AI: "What is the 'Lead Source' field for? You selected 'Web'."
User: "Always use Web for contacts I add manually."

AI: "Got it. I also noticed you left Rating empty - is that optional?"
User: "Yes, skip it unless I specify."

AI: "Perfect. I've saved this skill. Ready to add contacts anytime!"
```

---

## Data Model: Skill Storage

### Skill Structure

```typescript
interface LearnedSkill {
  id: string;
  name: string;                    // "Add Contact"
  createdAt: number;
  updatedAt: number;

  // Core understanding
  goal: {
    summary: string;               // "Create a new contact in Salesforce"
    domain: string;                // "CRM", "Spreadsheet", "Invoicing"
    intent: string;                // Deeper purpose from Q&A
  };

  // Inputs
  inputs: {
    required: InputField[];
    optional: InputField[];
  };

  // Success criteria
  success: {
    indicators: string[];          // What to look for
    verification: string;          // How to confirm
  };

  // Knowledge from Q&A
  clarifications: Array<{
    question: string;
    answer: string;
    appliesTo: string;             // What this clarifies
    timestamp: number;
  }>;

  // Key learnings (extracted from Q&A)
  keyKnowledge: string[];          // "Always use Web for Lead Source"

  // Natural language triggers
  triggers: {
    phrases: string[];             // "add contact", "new person"
    verbSynonyms: string[];        // "add", "create", "insert"
    objectSynonyms: string[];      // "contact", "person", "entry"
  };

  // Reference to demonstration
  demonstration: {
    workflowId: string;            // Link to original recording
    stepSummaries: StepSummary[];  // Simplified step descriptions
  };

  // Confidence and learning
  confidence: {
    overall: number;
    perArea: Record<string, number>;
    uncertainAreas: string[];
  };

  // Execution history
  experience: {
    timesExecuted: number;
    successRate: number;
    lastExecuted?: number;
    issues: string[];
    adaptations: string[];
  };
}

interface InputField {
  name: string;
  description: string;
  type: string;                    // "text", "email", "select", etc.
  exampleValues: string[];
  extractionHints: string[];       // How to extract from user input
}

interface StepSummary {
  index: number;
  action: string;
  what: string;                    // "Name field"
  why: string;                     // "Enter the contact's name"
  isCritical: boolean;
}
```

### Storage Location

```
Chrome Storage:
├── skills/                        # All learned skills
│   ├── skill_abc123.json
│   ├── skill_def456.json
│   └── ...
├── skillIndex.json                # Quick lookup: triggers → skillId
└── workflows/                     # Original recordings (demonstration reference)
    ├── workflow_xxx.json
    └── ...
```

### Skill Index (for fast matching)

```typescript
interface SkillIndex {
  // Phrase → Skill mapping
  phraseMap: Record<string, string[]>;  // "add contact" → ["skill_abc123"]

  // Domain → Skills
  domainMap: Record<string, string[]>;  // "CRM" → ["skill_abc123", "skill_def456"]

  // All skill summaries (for AI context)
  summaries: Array<{
    id: string;
    name: string;
    goal: string;
    domain: string;
    triggers: string[];
  }>;
}
```

---

## Implementation Phases

### Key Decisions (January 2025)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Data Model** | Add `getSkill()` getter | Keep SavedWorkflow as storage, add unified Skill view |
| **Milestone Detection** | AI detects from recording | Let AI identify logical phases automatically |
| **Transition Strategy** | Replace directly | No users yet, go straight to goal-oriented execution |
| **Q&A Bug** | Fixed | Clarifications now saved to `memory.clarifications` |

### Phase Dependency Graph

```
         ┌──────────────────┐
         │ Phase 1: Skill   │
         │ Foundation       │
         └────────┬─────────┘
                  │
    ┌─────────────┴─────────────┐
    ↓                           ↓
┌──────────────┐       ┌──────────────┐
│ Phase 2:     │       │ Phase 4:     │
│ Learning     │       │ Awareness    │
└──────┬───────┘       └──────────────┘
       │
       ↓
┌──────────────┐
│ Phase 3:     │
│ Execution    │
└──────┬───────┘
       │
    ┌──┴──┐
    ↓     ↓
┌──────┐ ┌──────┐
│ P5   │ │ P6   │
│ Help │ │ Multi│
└──────┘ └──────┘
```

---

### Phase 1: Skill Foundation

**Goal**: Unified Skill view over existing SavedWorkflow

| Task | Description | Status |
|------|-------------|--------|
| Define Skill interface | TypeScript types matching vision doc | [ ] |
| Create `getSkill()` method | Returns unified Skill view from SavedWorkflow | [ ] |
| Create SkillStorage helper | CRUD operations using Skill view | [ ] |
| Add SkillIndex | Fast lookup by triggers/domain | [ ] |

**Key Files**:
- `src/lib/skill/types.ts` (NEW)
- `src/lib/skill/skill-view.ts` (NEW) - getSkill() implementation
- `src/lib/skill/skill-index.ts` (NEW)

**Deliverable**: `getSkill(workflow)` returns complete Skill object

---

### Phase 2: Enhanced Learning Flow

**Goal**: Recording produces complete Skill knowledge

| Task | Description | Status |
|------|-------------|--------|
| Update generate_workflow_memory | Add milestone detection to AI prompt | [ ] |
| Wire Q&A to Skill.knowledge | Clarifications → knowledge.rules | [x] Fixed |
| Add knowledge extraction | Convert Q&A answers to actionable rules | [ ] |
| Update post-recording UI | Show skill summary after teaching | [ ] |

**Key Files**:
- `supabase/functions/generate_workflow_memory/index.ts`
- `src/sidepanel/App.tsx` (Q&A flow)

**Deliverable**: After recording + Q&A, Skill has milestones and knowledge

---

### Phase 3: Goal-Oriented Execution ← BIGGEST PIECE

**Goal**: Replace step-replay with goal-pursuit

| Task | Description | Status |
|------|-------------|--------|
| Build ExecutionEngine | Observe→Think→Act→Reflect loop | [ ] |
| Create goal-oriented prompts | LLM pursues goal, not "do step 3" | [ ] |
| Build ProgressTracker | Milestone-based progress | [ ] |
| Build SuccessVerifier | Check success criteria from Skill | [ ] |
| Build PageState builder | Combined DOM + Visual state | [ ] |
| Integrate with existing tools | Reuse dom_agent, computer_use | [ ] |

**Key Files**:
- `src/lib/execution/engine.ts` (NEW)
- `src/lib/execution/progress-tracker.ts` (NEW)
- `src/lib/execution/page-state.ts` (NEW)
- `supabase/functions/goal_execution/index.ts` (NEW)

**Deliverable**: Execute skill by pursuing goal, verify success

---

### Phase 4: Skill Awareness & Matching

**Goal**: AI knows all skills, matches natural language requests

| Task | Description | Status |
|------|-------------|--------|
| Build semantic skill matching | Natural language → right skill | [ ] |
| Implement "What can you do?" | AI lists capabilities | [ ] |
| Handle ambiguous requests | Multiple matches → clarify | [ ] |
| Handle unknown requests | "I haven't learned that" | [ ] |

**Key Files**:
- `src/lib/skill/skill-matcher.ts` (NEW)
- `supabase/functions/match_skill/index.ts` (NEW or update match_workflow)

**Deliverable**: "Add John to CRM" → AI finds and runs "Add Contact" skill

---

### Phase 5: Help System

**Goal**: AI asks for help when stuck, learns from corrections

| Task | Description | Status |
|------|-------------|--------|
| Build stuck detection | After N failed attempts | [ ] |
| Generate help requests | "I need help finding..." | [ ] |
| Process user guidance | Continue after help | [ ] |
| Learn from corrections | Remember for next time | [ ] |

**Key Files**:
- `src/lib/execution/help-system.ts` (NEW)
- `src/sidepanel/HelpRequest.tsx` (NEW)

**Deliverable**: AI asks user when stuck, continues after help

---

### Phase 6: Multi-Item Scaling

**Goal**: Handle "add Alice, Bob, Carol" naturally

| Task | Description | Status |
|------|-------------|--------|
| Array variable detection | Recognize lists in user input | [ ] |
| Batch execution | Run skill N times | [ ] |
| Batch progress UI | "Added 2/5 contacts" | [ ] |
| Handle partial failures | "Added 4/5, failed on Carol" | [ ] |

**Key Files**:
- `src/lib/variable-extractor.ts` (enhance)
- `src/lib/execution/batch-executor.ts` (NEW)

**Deliverable**: Single request handles multiple items

---

## Success Metrics

1. **Task Completion Rate**
   - Can complete tasks shown in demo
   - Can handle minor variations

2. **Natural Language Match Rate**
   - User says something → AI finds right skill

3. **Adaptation Rate**
   - Successfully adapts when UI changes
   - Doesn't break on non-critical differences

4. **User Effort**
   - Few questions (smart, targeted)
   - Teaching once is enough

5. **Time Saved**
   - Faster than doing manually
   - Handles repetitive work

---

## Open Questions

1. How many questions is too many? (Smart targeting needed)
2. Should questions be skippable? (Quick teach vs thorough)
3. How do we handle when AI learns wrong? (Correction flow)
4. Should users be able to edit skills later? (Refinement UI)
5. How to handle skill conflicts? (Two skills with similar triggers)
6. Offline capability? (Skills stored locally, but LLM needs API)

---

## Appendix: Example Full Flow

```
=== TEACHING ===

User: *starts recording*
User: *demonstrates adding a contact in Salesforce*
User: *stops recording*

AI: "Analyzing what you showed me..."

AI: "I learned how to add a contact in Salesforce!
     I have a couple questions to make sure I understand:"

AI: "You selected 'Web' for Lead Source. Should I always use that?"
User: "Yes, always Web for manual entries."

AI: "Got it. The form had a Rating field you left empty - optional?"
User: "Yes, skip unless I say otherwise."

AI: "Perfect! I've learned the 'Add Contact' skill.
     Just say 'add a contact' anytime and I'll do it."

=== USING ===

User: "Hey, add John Smith to the CRM"

AI: *thinking*
    - Match "add to CRM" → "Add Contact" skill (92% confidence)
    - Extract: name = "John Smith"
    - Missing: email (optional)

AI: "Adding John Smith as a contact..."

AI: *executing with goal-oriented approach*
    - Goal: Create contact named John Smith
    - Current state: Salesforce contacts page
    - Next action: Click "New Contact" button
    - *clicks*
    - Next action: Fill name field with "John Smith"
    - *types*
    - Next action: Set Lead Source to "Web" (learned: always Web)
    - *selects*
    - Next action: Click Save
    - *clicks*
    - Verify: Looking for "Contact Created" message
    - *found it*

AI: "Done! John Smith has been added as a contact."

=== SCALING ===

User: "Add these people: Alice, Bob, and Carol"

AI: *thinking*
    - Same skill: "Add Contact"
    - Multiple items detected: Alice, Bob, Carol
    - Will execute skill 3 times

AI: "Adding 3 contacts..."

AI: *executes skill for Alice* "Added Alice (1/3)"
AI: *executes skill for Bob* "Added Bob (2/3)"
AI: *executes skill for Carol* "Added Carol (3/3)"

AI: "Done! Added all 3 contacts."

=== KNOWING LIMITS ===

User: "Send an email to John"

AI: *thinking*
    - No skill matches "send email"
    - I don't know how to do this

AI: "I haven't learned how to send emails yet.
     Would you like to teach me? Just start recording
     and show me how you send an email."
```

---

## Research: Computer Use Models (Claude & Gemini)

### Overview

Both Anthropic (Claude) and Google (Gemini) have released "Computer Use" capabilities - models specifically designed to control computers by looking at screenshots and outputting actions.

### How Computer Use Works

```
1. Send screenshot to model
2. Model analyzes screen visually
3. Model returns action + coordinates
4. Your app executes the action
5. Capture new screenshot
6. Loop until task complete
```

### Model Comparison

| Aspect | Claude Computer Use | Gemini 2.5 Computer Use |
|--------|---------------------|-------------------------|
| **Coordinates** | Actual pixels | Normalized 0-999 grid |
| **Scope** | Desktop + Browser | Browser only (current) |
| **Mind2Web** | 61.0% | **65.7%** |
| **WebVoyager** | 69.4% | **79.9%** |
| **Safety** | Prompt injection classifiers | "User Alignment Critic" model |

**For web/browser tasks, Gemini 2.5 Computer Use is currently more accurate.**

### Available Actions

**Claude:**
- screenshot, left_click, type, key, mouse_move
- scroll, double_click, triple_click
- left_mouse_down, left_mouse_up, hold_key, wait, zoom

**Gemini:**
- open_web_browser, navigate, go_back, go_forward, search
- click_at, hover_at, type_text_at, drag_and_drop
- key_combination, scroll_document, scroll_at, wait_5_seconds

### Current Limitations

1. **Latency** - Each step needs API call (not instant)
2. **Cost** - Screenshots + API calls add up
3. **Accuracy** - 15-80% depending on complexity (raw, without context)
4. **Desktop** - Gemini is browser-only currently

### Sources
- [Anthropic Computer Use Docs](https://platform.claude.com/docs/en/docs/build-with-claude/computer-use)
- [Google Gemini Computer Use](https://ai.google.dev/gemini-api/docs/computer-use)
- [Anthropic Blog](https://www.anthropic.com/news/developing-computer-use)
- [Google Blog](https://blog.google/technology/google-deepmind/gemini-computer-use-model/)

---

## Key Insight: Users Are NOT Training the Model

### What's Actually Happening

```
User records demo → Stored locally as steps/knowledge
                  ↓
User triggers execution → We send knowledge + screenshot to LLM
                        ↓
LLM uses knowledge as CONTEXT → Makes decisions
                              ↓
(Model itself is NOT changed - no fine-tuning)
```

The "training" is really **prompt engineering at runtime**. We give the model context to make better decisions, but we don't modify the model's weights.

### Why This Matters

**Advantages:**
- No expensive training costs
- Works immediately after demonstration
- Knowledge stays private (local storage)
- Can improve by improving what we send to the model

**The Opportunity:**
- Current accuracy: ~60-70% (raw model, cold execution)
- With rich skill context: potentially 85-95%
- The model isn't guessing when it knows the goal, success criteria, and user's intent

---

## Analysis: The Knowledge Gap

### What We Currently Send to LLM (Step-Focused)

```javascript
{
  domMap: "...",                    // Current page structure
  hint: {                           // Current step to execute
    description: "Click Add button",
    targetText: "Add",
    selector: "#add-btn"
  },
  goal: "Add contact",              // Simple text
  variableValues: { name: "John" }  // User inputs
}
```

**Problem:** We're asking the model "find this element" instead of "achieve this goal."

### What We SHOULD Send (Knowledge-Focused)

```javascript
{
  // Current state
  screenshot: "...",
  domMap: "...",

  // Full skill knowledge
  skill: {
    goal: "Create a new contact in CRM",

    keyKnowledge: [                 // From Q&A
      "Lead Source should always be 'Web'",
      "Phone field is optional",
      "Success = 'Contact Created' toast appears"
    ],

    inputs: {
      required: ["name"],
      optional: ["email", "phone"],
      provided: { name: "John" }
    },

    successCriteria: [
      "'Contact Created' message appears",
      "Contact visible in list"
    ]
  },

  // Demonstration as reference
  demonstration: [
    { action: "click", what: "New Contact button", why: "Open form" },
    { action: "type", what: "Name field", why: "Enter contact name" },
    { action: "select", what: "Lead Source", why: "Set to Web (always)" },
    { action: "click", what: "Save button", why: "Create contact" }
  ],

  // Progress
  progress: {
    goalStatus: "in_progress",
    completed: ["Opened form"],
    remaining: ["Fill name", "Set lead source", "Save"]
  },

  question: "What should I do next to add John as a contact?"
}
```

### Gap Summary

| Aspect | Current | Should Be |
|--------|---------|-----------|
| Goal | Simple text | Rich understanding + success criteria |
| Guidance | "Do step 3" | "Pursue goal, here's what user showed" |
| Knowledge | None | Q&A answers, business rules |
| Progress | Step counter | Goal progress tracking |
| Verification | Basic | Learned success indicators |

---

## Recommendation: How to Use LLM Effectively

### Current State (Under-Utilizing)
- Using LLM for element matching
- Sending step hints, not skill knowledge
- Not leveraging goal-oriented reasoning

### Target State (Full Utilization)

**1. Rich Context**
Send full skill knowledge, not just steps:
- Goal and success criteria
- Q&A clarifications
- Demonstration as reference
- Current progress

**2. Goal-Oriented Questions**
Instead of: "Find element matching selector X"
Ask: "What should I do to achieve [goal] given current screen?"

**3. Success Verification**
Model verifies completion using learned success criteria, not just "all steps done."

**4. Adaptive Execution**
Model can deviate from demonstration when needed because it understands the goal, not just the steps.

### Expected Impact

```
Raw model accuracy:     60-70%
With step hints:        70-80%
With rich skill context: 85-95%

Why? Model knows:
- What the goal is
- What success looks like
- User's specific rules (from Q&A)
- What to look for
```

---

## Technology Decisions

### For Execution: Gemini 2.5 Computer Use
- Better web benchmark scores (65.7% vs 61%)
- Already integrated
- Browser-focused (matches our use case)

### For Analysis/Learning: Gemini 3.0 Flash
- Fast and cost-effective
- Good for Q&A generation, skill extraction
- Already integrated

### For Input Simulation: Chrome DevTools Protocol (CDP)
- Real input simulation (indistinguishable from human)
- Works on any site
- Available via `chrome.debugger` API

### Hybrid Approach
```
Skill Knowledge (our system)
         +
Computer Use Model (Gemini)
         +
CDP Execution (Chrome)
         =
Intelligent, Reliable Automation
```

---

## Architecture: Goal-Oriented Execution

This section details the new architecture for transforming from step-based replay to goal-oriented execution.

### Core Concepts

**Skill** = What AI knows (learned from demonstration + Q&A)
**Workflow** = Chain of actions to accomplish a goal (execution instance)

```
User demonstrates → AI learns a SKILL
User triggers → AI creates WORKFLOW instance using Skill
Workflow is dynamic → AI decides actions based on Skill + current state
```

### The Human-Like Execution Loop

```
┌─────────────────────────────────────────────────────────────┐
│              OBSERVE → THINK → ACT → REFLECT                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  OBSERVE: "What do I see on the screen?"                    │
│      ↓                                                       │
│  THINK: "Given my goal and what I learned, what should      │
│          I do next? Am I on the right track?"               │
│      ↓                                                       │
│  ACT: Execute the decided action                            │
│      ↓                                                       │
│  REFLECT: "Did that work? Am I closer to my goal?           │
│            What's my next milestone?"                       │
│      ↓                                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ EVALUATE:                                           │    │
│  │  ├─ Goal achieved → Done ✓                         │    │
│  │  ├─ On track → Continue loop                       │    │
│  │  ├─ Something wrong → Try alternative              │    │
│  │  └─ Stuck → Ask user for help                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Decisions (from discussion)

1. **Demonstration Role**: Hybrid - AI decides what's best, informed by demonstration
2. **Progress Tracking**: Milestone-based (human-like: "form open → filled → saved")
3. **Failure Handling**: Try alternatives first, ask user if still stuck
4. **Verification**: AI decides when to check if it's doing the right thing

---

## End-to-End Data Flow

The complete flow from user recording to execution completion.

### Phase A: Learning (User Trains the AI)

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP A1: User Records Demonstration                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User: Clicks "Teach Mimo" button                               │
│    ↓                                                             │
│  User: Performs the task in browser                             │
│    - Navigates to CRM                                            │
│    - Clicks "New Contact"                                        │
│    - Fills form (Name: "John", Lead Source: "Web")              │
│    - Clicks "Save"                                               │
│    ↓                                                             │
│  User: Clicks "Stop Recording"                                  │
│    ↓                                                             │
│  System captures:                                                │
│    - Steps[] (actions, selectors, values)                       │
│    - Screenshots (before/after each step)                       │
│    - DOM context (element relationships, labels)                │
│    - Timing (how long between steps)                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP A2: AI Analyzes Recording                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User sees: "🤖 AI is analyzing your demonstration..."          │
│    ↓                                                             │
│  AI Call #1: generate_workflow_memory                            │
│    Input: All recorded steps + screenshots + context             │
│    Output:                                                       │
│      - Goal: "Create a new contact in the CRM"                  │
│      - Milestones: [Open Form, Fill Fields, Save, Verify]       │
│      - Inputs detected: [name (required), email (optional)]     │
│      - Success indicators: [toast appears, form closes]         │
│      - Triggers: ["add contact", "new customer", "create"]      │
│      - Uncertainties: [Lead Source value, phone required?]      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP A3: AI Asks Clarifying Questions (if needed)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AI has uncertainties → Generates questions                      │
│    ↓                                                             │
│  AI Call #2: generate_clarifying_questions                       │
│    Input: Analysis results + uncertainties                       │
│    Output: 1-3 targeted questions                                │
│    ↓                                                             │
│  User sees:                                                      │
│    ┌────────────────────────────────────────────────────────┐   │
│    │ 🤔 "I have a few questions to understand better"       │   │
│    │                                                        │   │
│    │ Q1: "I noticed you selected 'Web' for Lead Source.    │   │
│    │      Should I always use 'Web', or does it depend?"   │   │
│    │      ○ Always use 'Web'                               │   │
│    │      ○ Ask me each time                               │   │
│    │      ○ Depends on how they found us                   │   │
│    │                                                        │   │
│    │ Q2: "Is the phone number required, or can I skip it?" │   │
│    │      ○ Required - always ask for it                   │   │
│    │      ○ Optional - skip if not given                   │   │
│    └────────────────────────────────────────────────────────┘   │
│    ↓                                                             │
│  User answers questions                                          │
│    ↓                                                             │
│  Answers stored as Knowledge:                                    │
│    - "Lead Source should always be 'Web'"                       │
│    - "Phone is optional, skip if not provided"                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP A4: Skill Created & Stored                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User sees: "What should I call this task?"                     │
│  User types: "Add Contact"                                       │
│  User clicks: "Save"                                             │
│    ↓                                                             │
│  Skill object created and stored in Chrome storage               │
│    ↓                                                             │
│  User sees: "✅ Got it! I learned how to Add Contact"           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase B: Triggering (User Asks AI to Do Something)

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP B1: User Makes Request                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Option 1: Natural Language                                      │
│    User types: "Add John Smith as a contact"                    │
│                                                                  │
│  Option 2: Direct Selection                                      │
│    User clicks: "Add Contact" from skills list                  │
│    User fills: Name = "John Smith"                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP B2: AI Matches & Clarifies (like an employee would)       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  If Natural Language:                                            │
│    AI searches skills by triggers + semantic matching            │
│      ↓                                                           │
│    If ONE clear match:                                           │
│      → Extract inputs from request ("John Smith" = name)        │
│      → Proceed to execution                                      │
│      ↓                                                           │
│    If MULTIPLE matches or AMBIGUOUS:                             │
│      AI asks: "I know a few things that might help:             │
│               - Add Contact (CRM)                                │
│               - Add Team Member (HR system)                      │
│               Which one did you mean?"                           │
│      ↓                                                           │
│    If NO match:                                                  │
│      AI says: "I don't know how to do that yet.                 │
│               Would you like to teach me?"                       │
│      ↓                                                           │
│    If MISSING inputs:                                            │
│      AI asks: "I can add a contact. What's their name?"         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP B3: Workflow Instance Created                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WorkflowInstance = {                                            │
│    skill: <Add Contact skill>,                                  │
│    inputs: { name: "John Smith" },                              │
│    progress: { current: null, completed: [], remaining: all }   │
│    state: { goalAchieved: false }                               │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase C: Execution (AI Does the Work)

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP C1: Execution Loop Starts                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User sees: "🚀 Working on: Add John Smith as a contact"        │
│             Progress: ○○○○ (milestones)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP C2: OBSERVE → THINK → ACT → REFLECT (Loop)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ITERATION 1:                                                    │
│  ─────────────                                                   │
│  OBSERVE: Capture page state (DOM + screenshot)                  │
│    → "I see CRM dashboard with 'New Contact' button"            │
│                                                                  │
│  THINK: (AI Call - goal-oriented prompt)                         │
│    → AI sees: goal, knowledge, inputs, demo steps, state        │
│    → AI thinks: "I need to open the contact form first.         │
│                  User showed me to click 'New Contact'"         │
│    → Decision: Click "New Contact" button                        │
│                                                                  │
│  ACT: Execute click on "New Contact"                             │
│    → Page updates, form opens                                    │
│                                                                  │
│  REFLECT: Did it work? Am I closer to goal?                      │
│    → "Form opened ✓ - milestone 'Open Form' complete"           │
│    → Progress: ●○○○                                             │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  ITERATION 2:                                                    │
│  ─────────────                                                   │
│  OBSERVE: "Contact form is open with empty fields"               │
│                                                                  │
│  THINK: "I need to fill the name. User provided 'John Smith'."  │
│    → Decision: Type "John Smith" in Name field                   │
│                                                                  │
│  ACT: Type "John Smith"                                          │
│                                                                  │
│  REFLECT: "Name field filled ✓ - still in 'Fill Fields' phase" │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  ITERATION 3:                                                    │
│  ─────────────                                                   │
│  OBSERVE: "Name filled, Lead Source empty, Save visible"         │
│                                                                  │
│  THINK: "I learned Lead Source should always be 'Web'.          │
│          I need to set that before saving."                     │
│    → Decision: Select "Web" for Lead Source                      │
│                                                                  │
│  ACT: Click Lead Source dropdown, select "Web"                   │
│                                                                  │
│  REFLECT: "Lead Source set ✓ - form ready to save"              │
│    → Progress: ●●○○                                             │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  ITERATION 4:                                                    │
│  ─────────────                                                   │
│  OBSERVE: "Form filled, Save button visible"                     │
│                                                                  │
│  THINK: "Form is complete. Time to save."                       │
│    → Decision: Click "Save" button                               │
│                                                                  │
│  ACT: Click "Save"                                               │
│                                                                  │
│  REFLECT: "Save clicked, waiting for confirmation..."           │
│    → Progress: ●●●○                                             │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  ITERATION 5:                                                    │
│  ─────────────                                                   │
│  OBSERVE: "Toast appeared: 'Contact Created'"                    │
│                                                                  │
│  THINK: "I see 'Contact Created' toast - that's my success      │
│          indicator! Goal achieved."                             │
│    → Decision: Verify complete, no more actions needed           │
│                                                                  │
│  REFLECT: "Success criteria met ✓ - GOAL ACHIEVED"              │
│    → Progress: ●●●●                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP C3: Completion                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User sees: "✅ Done! Added John Smith as a contact"            │
│                                                                  │
│  Skill.experience updated:                                       │
│    - timesExecuted: +1                                           │
│    - successRate: updated                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase D: When Things Go Wrong (Help Flow)

```
┌─────────────────────────────────────────────────────────────────┐
│  If AI gets stuck during execution:                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  OBSERVE: "Page looks different, can't find Save button"         │
│                                                                  │
│  THINK: "The UI changed. Let me try alternatives..."            │
│    → Try: Look for "Submit", "Create", "Done"                   │
│    → Try: Scroll to find button                                  │
│    → Still can't find it                                         │
│                                                                  │
│  STUCK DETECTED (after N attempts)                               │
│    ↓                                                             │
│  User sees:                                                      │
│    ┌────────────────────────────────────────────────────────┐   │
│    │ 🤔 "I need some help"                                  │   │
│    │                                                        │   │
│    │ I'm trying to save the contact but I can't find       │   │
│    │ the Save button.                                       │   │
│    │                                                        │   │
│    │ I tried:                                               │   │
│    │ • Looking for "Save", "Submit", "Create"              │   │
│    │ • Scrolling down the page                              │   │
│    │                                                        │   │
│    │ Can you help me find where to save?                   │   │
│    │                                                        │   │
│    │ [Type your answer...]                                 │   │
│    └────────────────────────────────────────────────────────┘   │
│    ↓                                                             │
│  User: "It's the blue button at the top that says               │
│         'Save Contact'"                                          │
│    ↓                                                             │
│  AI: "Got it! I see it now."                                    │
│    → Continues execution                                         │
│    → Optionally learns this for next time                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

| Phase | What Happens | AI Calls |
|-------|--------------|----------|
| **A1: Record** | User demonstrates task | None |
| **A2: Analyze** | AI extracts understanding | 1 (generate_workflow_memory) |
| **A3: Q&A** | AI asks clarifying questions | 1 (generate_clarifying_questions) |
| **A4: Save** | Skill stored with all knowledge | None |
| **B1: Request** | User asks to do something | None |
| **B2: Match** | AI finds skill, clarifies if needed | 1 (semantic_match) |
| **B3: Instance** | Workflow instance created | None |
| **C2: Execute** | Observe→Think→Act→Reflect loop | 1 per iteration (goal_execution) |
| **C3: Complete** | Success verified, experience updated | None |
| **D: Help** | AI asks user when stuck | 1 (generate help request) |

---

## Architecture Components

### 1. Skill Structure

How we store what AI learned from demonstration + Q&A.

```typescript
interface Skill {
  id: string;
  name: string;                    // "Add Contact"

  // GOAL - What am I trying to accomplish?
  goal: {
    description: string;           // "Create a new contact in the CRM"
    domain: string;                // "CRM", "Spreadsheet", etc.
  };

  // KNOWLEDGE - What did I learn? (from Q&A + analysis)
  knowledge: {
    rules: string[];               // ["Lead Source should always be 'Web'"]
    tips: string[];                // ["Wait for dropdown to load"]
    warnings: string[];            // ["Don't click Save twice"]
  };

  // INPUTS - What do I need from the user?
  inputs: {
    required: InputField[];        // Must have to execute
    optional: InputField[];        // Nice to have
  };

  // SUCCESS - How do I know I achieved the goal?
  successCriteria: {
    primary: SuccessCheck;         // Main indicator
    secondary: SuccessCheck[];     // Additional confirmations
  };

  // DEMONSTRATION - What did the user show me? (reference, not script)
  demonstration: {
    milestones: Milestone[];       // Logical phases
    steps: DemoStep[];             // What user did (for reference)
  };

  // TRIGGERS - How would user ask for this?
  triggers: {
    phrases: string[];             // ["add contact", "new customer"]
    verbs: string[];               // ["add", "create"]
    objects: string[];             // ["contact", "person"]
  };

  // EXPERIENCE - What have I learned from past executions?
  experience: {
    timesExecuted: number;
    successRate: number;
    commonIssues: string[];
    provenStrategies: string[];
  };
}

interface Milestone {
  name: string;                    // "Form Filled"
  description: string;             // "All required fields have values"
  stepIndices: number[];           // Which demo steps belong here
  checkCondition?: string;         // How to verify milestone reached
}

interface DemoStep {
  action: string;                  // "click", "type", "select"
  what: string;                    // "Save button"
  why: string;                     // "Submit the form"
  value?: string;                  // For type/select actions
  elementHints: ElementHints;      // How to find this element
}

interface SuccessCheck {
  type: 'toast' | 'element_appears' | 'element_disappears' |
        'url_change' | 'text_appears' | 'form_closes';
  description: string;             // "Contact Created toast appears"
  pattern?: string;                // Regex or text to match
}
```

### 2. Execution Engine

The observe→think→act→reflect loop.

```typescript
interface ExecutionEngine {
  // Initialize execution
  startExecution(skill: Skill, inputs: Record<string, string>): WorkflowInstance;

  // The main loop
  executeLoop(instance: WorkflowInstance): Promise<ExecutionResult>;
}

interface WorkflowInstance {
  id: string;
  skill: Skill;
  inputs: Record<string, string>;  // User-provided values

  // Progress tracking (milestone-based)
  progress: {
    currentMilestone: string;
    completedMilestones: string[];
    remainingMilestones: string[];
  };

  // History of what happened
  history: ActionRecord[];

  // Current state assessment
  state: {
    observation: string;           // What AI sees
    assessment: string;            // AI's interpretation
    onTrack: boolean;
    goalAchieved: boolean;
  };
}

interface ActionRecord {
  timestamp: number;
  thought: string;                 // AI's reasoning
  action: Action;                  // What was done
  outcome: string;                 // What happened
  movedTowardGoal: boolean;        // AI's assessment
}
```

**Loop Implementation (pseudocode):**

```
function executeLoop(instance):
  while not instance.state.goalAchieved:

    // 1. OBSERVE
    pageState = capturePageState()  // DOM + screenshot

    // 2. THINK (LLM call)
    decision = askLLM({
      skill: instance.skill,
      inputs: instance.inputs,
      currentState: pageState,
      progress: instance.progress,
      history: instance.history,
      question: "What should you do next to achieve the goal?"
    })

    // 3. ACT
    result = executeAction(decision.action)

    // 4. REFLECT (LLM call or rule-based)
    reflection = assessOutcome({
      expectedOutcome: decision.expectedOutcome,
      actualResult: result,
      successCriteria: instance.skill.successCriteria
    })

    // 5. UPDATE
    updateProgress(instance, reflection)
    recordHistory(instance, decision, result, reflection)

    // 6. EVALUATE
    if reflection.goalAchieved:
      return Success
    if reflection.stuck and alternativesExhausted:
      return askUserForHelp()
    if reflection.needsAlternative:
      // AI will try different approach next iteration
      continue

  return Success
```

### 3. LLM Prompts

How we ask the AI to think (goal-oriented, not step-focused).

**Main Decision Prompt:**

```
You are a virtual employee executing a learned skill.

## YOUR SKILL: {{skill.name}}
Goal: {{skill.goal.description}}

## WHAT YOU LEARNED:
{{#each skill.knowledge.rules}}
- {{this}}
{{/each}}

## INPUTS PROVIDED:
{{#each inputs}}
- {{@key}}: "{{this}}"
{{/each}}

## WHAT USER SHOWED YOU (for reference):
{{#each skill.demonstration.milestones}}
{{milestone.name}}: {{milestone.description}}
{{/each}}

## CURRENT STATE:
URL: {{pageState.url}}
What you see: {{pageState.description}}
Visible elements: {{pageState.interactiveElements}}

## YOUR PROGRESS:
Completed: {{progress.completedMilestones}}
Current milestone: {{progress.currentMilestone}}
Remaining: {{progress.remainingMilestones}}

## SUCCESS CRITERIA:
{{skill.successCriteria.primary.description}}

---

Based on your skill knowledge and the current state:
1. What do you observe?
2. Are you on track toward the goal?
3. What should you do next and why?
4. What outcome do you expect?

Think like a human employee who learned this task.
```

**Response Format:**

```typescript
interface LLMDecision {
  observation: string;        // "I see a contact form with Name filled"

  reasoning: string;          // "I learned Lead Source must be Web..."

  onTrack: boolean;           // Am I progressing toward goal?

  action: {
    type: 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'verify';
    target: SemanticTarget;   // { role, name, text }
    value?: string;
  };

  expectedOutcome: string;    // "Dropdown will close, field shows 'Web'"

  afterThis: string;          // "Then I'll click Save"

  milestone: string;          // Current milestone I'm working on
}
```

### 4. Progress Tracking

Milestone-based awareness (human-like).

```typescript
interface ProgressTracker {
  // Initialize from skill
  initializeFromSkill(skill: Skill): Progress;

  // Update after each action
  updateProgress(current: Progress, reflection: Reflection): Progress;

  // Check if milestone reached
  checkMilestone(milestone: Milestone, pageState: PageState): boolean;

  // Check if goal achieved
  checkGoal(successCriteria: SuccessCriteria, pageState: PageState): boolean;
}

interface Progress {
  // Current status
  currentMilestone: Milestone | null;

  // What's done
  completedMilestones: Milestone[];

  // What's left
  remainingMilestones: Milestone[];

  // Human-readable summary
  summary: string;  // "Form filled, ready to save"

  // For the AI's context
  asNarrative: string;  // "I've opened the form and filled in John's name..."
}
```

**Example Progress Flow:**

```
Skill: "Add Contact"
Milestones: [Open Form, Fill Fields, Save, Verify]

Start:
  Current: "Open Form"
  Completed: []
  Remaining: [Open Form, Fill Fields, Save, Verify]
  Summary: "Starting - need to open contact form"

After clicking "New Contact":
  Current: "Fill Fields"
  Completed: [Open Form]
  Remaining: [Fill Fields, Save, Verify]
  Summary: "Form open, need to fill in details"

After filling name and Lead Source:
  Current: "Save"
  Completed: [Open Form, Fill Fields]
  Remaining: [Save, Verify]
  Summary: "Form filled, ready to save"

After clicking Save and seeing toast:
  Current: null (done)
  Completed: [Open Form, Fill Fields, Save, Verify]
  Remaining: []
  Summary: "Contact created successfully"
```

### 5. Help System

When and how AI asks for help.

```typescript
interface HelpSystem {
  // Detect when stuck
  isStuck(history: ActionRecord[], attempts: number): boolean;

  // Generate help request
  generateHelpRequest(context: StuckContext): HelpRequest;

  // Process user's response
  processUserHelp(response: UserResponse): NextAction;
}

interface HelpRequest {
  situation: string;           // "I can't find the Save button"
  whatITried: string[];        // ["Looked for 'Save'", "Scrolled down"]
  whatINeed: string;           // "Where is the Save button on this page?"
  suggestedOptions?: string[]; // ["It might be called 'Submit'", "Maybe scroll up?"]
}
```

**When AI Asks for Help:**

1. **Can't find element** after trying alternatives
2. **Unexpected state** - page looks very different from demonstration
3. **Action failed** multiple times with no progress
4. **Ambiguous situation** - multiple valid paths, unsure which to take

**Help Flow:**

```
AI: "I'm trying to save the contact but I can't find the Save button.
     I tried:
     - Looking for a button labeled 'Save'
     - Looking for 'Submit' or 'Create'
     - Scrolling down to see more buttons

     Can you help me find where to save?"

User: "The Save button is in the top right corner, it's blue"

AI: "Got it! I see a blue button in the top right that says 'Save Contact'.
     Let me click that."
```

### 6. Perception System (Enhanced Hybrid)

How AI "sees" the page to make decisions. We use a hybrid approach combining DOM and Visual.

#### Why Hybrid?

| Approach | Strengths | Weaknesses |
|----------|-----------|------------|
| **DOM only** | Fast, precise, cheap | Misses visual cues (toasts, colors) |
| **Visual only** | Sees like human | Slow, expensive, less precise |
| **Hybrid** | Best of both worlds | More complex |

#### The Enhanced Hybrid Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    PERCEPTION SYSTEM                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      OBSERVE                             │    │
│  │  Capture both DOM and Visual state                       │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  DOM Layer (Primary):                                    │    │
│  │    - Interactive elements (buttons, inputs, links)      │    │
│  │    - Form field states and values                        │    │
│  │    - Element attributes (role, label, testId)           │    │
│  │    - Modal/dropdown states                               │    │
│  │    - Text content                                        │    │
│  │                                                          │    │
│  │  Visual Layer (Secondary):                               │    │
│  │    - Screenshot of current viewport                      │    │
│  │    - Visual context (layout, colors, icons)             │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                       THINK                              │    │
│  │  AI reasons primarily with DOM, visual for context       │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  DOM-based reasoning (fast, precise):                    │    │
│  │    "I see a button labeled 'Save' with role='button'"   │    │
│  │    "Form has 3 fields: Name (filled), Email (empty)..."  │    │
│  │                                                          │    │
│  │  Visual context (when helpful):                          │    │
│  │    "The Save button is blue, positioned top-right"      │    │
│  │    "I see a loading spinner appeared"                    │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                        ACT                               │    │
│  │  Execute via DOM, fallback to visual                     │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  Primary: Semantic DOM targeting                         │    │
│  │    { role: 'button', name: 'Save' }                     │    │
│  │    → Stable, works even if position changes              │    │
│  │                                                          │    │
│  │  Fallback: Visual coordinate targeting                   │    │
│  │    { x: 850, y: 120 }                                   │    │
│  │    → Used when DOM targeting fails                       │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↓                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      REFLECT                             │    │
│  │  Verify with both DOM and Visual                         │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │    │
│  │  DOM verification:                                       │    │
│  │    - Did element state change?                          │    │
│  │    - Did new elements appear?                           │    │
│  │    - Did form values update?                            │    │
│  │                                                          │    │
│  │  Visual verification:                                    │    │
│  │    - Did toast/notification appear?                     │    │
│  │    - Did modal close?                                   │    │
│  │    - Did visual feedback occur? (highlight, animation)  │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### PageState Interface

What AI receives each iteration:

```typescript
interface PageState {
  // DOM Layer (primary source of truth)
  dom: {
    url: string;
    title: string;

    // Interactive elements on page
    interactiveElements: Array<{
      role: string;              // 'button', 'textbox', 'link', etc.
      name: string;              // accessible name
      text?: string;             // visible text
      value?: string;            // current value (for inputs)
      enabled: boolean;
      visible: boolean;
      attributes: {
        id?: string;
        testId?: string;
        ariaLabel?: string;
        placeholder?: string;
      };
      location: {                // for fallback targeting
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }>;

    // Form state (quick reference)
    forms: Array<{
      name: string;
      fields: Array<{
        label: string;
        type: string;
        value: string;
        required: boolean;
        valid: boolean;
      }>;
      submitButton?: string;
    }>;

    // UI State
    modals: Array<{ title: string; isOpen: boolean }>;
    dropdowns: Array<{ label: string; isOpen: boolean; options?: string[] }>;
    toasts: Array<{ text: string; type: 'success' | 'error' | 'info' }>;
  };

  // Visual Layer (secondary, for context and verification)
  visual: {
    screenshot: string;          // base64 encoded image
    viewport: { width: number; height: number };
    // Optional: AI-generated description of what it sees
    description?: string;
  };

  // Combined summary (for quick AI understanding)
  summary: string;
  // Example: "Contact form open. Name='John Smith' (filled),
  //           Email='' (empty), Lead Source='Web' (filled).
  //           Save button visible."
}
```

#### When to Use Which

| Situation | Primary | Secondary |
|-----------|---------|-----------|
| **Finding an element** | DOM (semantic targeting) | Visual (if DOM fails) |
| **Reading form values** | DOM (exact values) | - |
| **Checking if modal open** | DOM (modal state) | Visual (confirm visually) |
| **Verifying success** | DOM (new elements) | Visual (toasts, animations) |
| **Understanding layout** | - | Visual (spatial relationships) |
| **Recovery when stuck** | DOM (try alternatives) | Visual (find by appearance) |

#### Integration with Existing Code

```
REUSE: dom_agent
  - Already captures DOM map
  - Already does semantic element matching
  - Enhance: Add form state, modal state to output

REUSE: computer_use
  - Already handles screenshot-based targeting
  - Already does visual element finding
  - Keep as fallback for when DOM fails

NEW: PageState builder
  - Combines DOM + Visual into unified state
  - Generates summary for AI context
  - Captures before/after for reflection

NEW: Verification checker
  - Uses visual to detect toasts, animations
  - Uses DOM to detect state changes
  - Combines both for success criteria checking
```

---

## What We Can Reuse

### Full Reuse (Keep As-Is)

| Component | Location | Notes |
|-----------|----------|-------|
| Recording System | `src/content/recorder/` | Captures steps, screenshots, DOM |
| computer_use | `supabase/functions/computer_use/` | Visual fallback - works well |
| Storage Layer | `src/lib/storage.ts` | Chrome storage - extend for Skills |
| UI Components | `src/sidepanel/*.tsx` | Forms, modals - keep most |

### Enhance/Extend

| Component | Location | Changes Needed |
|-----------|----------|----------------|
| Variable Detection | `src/lib/variable-detector.ts` | Map to Skill inputs |
| Q&A System | `supabase/functions/generate_clarifying_questions/` | Ensure answers stored in Skill.knowledge |
| WorkflowMemory | `src/lib/workflow-memory/types.ts` | Evolve into Skill structure |
| generate_workflow_memory | `supabase/functions/generate_workflow_memory/` | Add milestone detection |
| dom_agent | `supabase/functions/dom_agent/` | Change prompts (keep element-finding logic) |

### Major Refactor

| Component | Location | Changes Needed |
|-----------|----------|----------------|
| ai-agent.ts | `src/lib/ai-agent.ts` | Step-loop → Goal-loop (biggest change) |
| Execution orchestration | `src/content/universal-execution/` | New goal-pursuit architecture |

### New Components Needed

| Component | Purpose |
|-----------|---------|
| Skill Structure | New data model (based on WorkflowMemory) |
| Execution Engine | Observe→Think→Act→Reflect loop |
| Progress Tracker | Milestone-based progress |
| Goal Verifier | Check success criteria |
| Help System | Detect stuck, ask user |

---

## Migration Path

### Phase 1: Skill Structure
- Define Skill interface (evolve from WorkflowMemory)
- Create SkillStorage (extend WorkflowStorage)
- Converter: Workflow → Skill (for existing recordings)

### Phase 2: Enhanced Learning
- Update generate_workflow_memory to output Skill structure
- Update Q&A to populate Skill.knowledge
- Add milestone detection to analysis

### Phase 3: Goal-Oriented Execution
- Build new execution engine (observe→think→act→reflect)
- New LLM prompts (goal-focused, not step-focused)
- Progress tracker with milestones

### Phase 4: Help System
- Stuck detection
- Help request generation
- User response processing

### Phase 5: Integration
- Connect new engine to existing UI
- Update sidepanel for progress display
- Testing and refinement

---

*Document created: January 2025*
*Last updated: January 2025*
