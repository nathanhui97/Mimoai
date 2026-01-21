# Before & After: The Gap We're Closing

This document explains what Mimo does today, what it will do after the transformation, and the specific gaps we're closing.

---

## The One-Sentence Summary

**Before**: Mimo replays your recorded clicks like a video tape.
**After**: Mimo learns what you're trying to accomplish and figures out how to do it.

---

## Before: Workflow Replay Tool

### How It Works Today

```
User records: Click "New" → Type "John" → Click "Save"
                              ↓
Mimo stores: [Step 1, Step 2, Step 3] with selectors
                              ↓
User triggers: "Run workflow"
                              ↓
Mimo executes: Find element → Click → Find element → Type → Find element → Click
                              ↓
If element not found: Try recovery → Still fail → Error
```

### What the AI Sees During Execution

```javascript
{
  currentStep: 2,
  totalSteps: 3,
  hint: {
    description: "Type in Name field",
    selector: "#contact-name",
    targetText: "Name"
  },
  domMap: "... current page elements ...",
  goal: "Add contact"  // Just a label, not used for reasoning
}
```

**The AI is asked**: "Find the element matching this selector/description"

### Current Limitations

| Problem | Example |
|---------|---------|
| **Brittle to UI changes** | Button moved from left to right → workflow breaks |
| **No understanding of purpose** | Doesn't know WHY we're clicking "New" |
| **Can't adapt** | If "Save" is now called "Submit", it fails |
| **No success verification** | Completes all steps but doesn't know if goal achieved |
| **Can't handle variations** | "Add 3 contacts" requires manual loop setup |
| **Doesn't learn from Q&A** | User answers questions, but answers aren't used in execution |
| **Step-focused, not goal-focused** | "Execute step 3" instead of "achieve the goal" |

### Mental Model: VCR

```
Recording = Video tape
Execution = Press play
Problem = If the TV moved, the remote still points at the old spot
```

---

## After: Virtual Employee That Learns

### How It Will Work

```
User demonstrates: Click "New" → Type "John" → Click "Save"
                              ↓
AI analyzes: "User is creating a contact. Key steps: open form, fill name, save."
                              ↓
AI asks: "Should Lead Source always be 'Web'?" → User: "Yes"
                              ↓
Mimo stores: SKILL with goal, knowledge, milestones, success criteria
                              ↓
User triggers: "Add John Smith as a contact"
                              ↓
AI reasons: "Goal: Create contact named John Smith.
             I know: Lead Source = Web always.
             Current state: I see the contacts page.
             Next: I should click 'New Contact' to open the form."
                              ↓
AI executes: Observe → Think → Act → Reflect → Repeat until goal achieved
                              ↓
AI verifies: "I see 'Contact Created' toast. Goal achieved!"
```

### What the AI Sees During Execution

```javascript
{
  // The skill (what I learned)
  skill: {
    name: "Add Contact",
    goal: "Create a new contact in the CRM",

    knowledge: {
      rules: ["Lead Source should always be 'Web'"],  // From Q&A!
      tips: ["Wait for form to load before typing"],
      warnings: ["Don't click Save twice"]
    },

    inputs: {
      required: [{ name: "name", description: "Contact's full name" }],
      provided: { name: "John Smith" }
    },

    successCriteria: {
      primary: "'Contact Created' toast appears",
      secondary: ["Form closes", "Contact visible in list"]
    },

    milestones: [
      { name: "Form Open", description: "Contact form is displayed" },
      { name: "Fields Filled", description: "Required fields have values" },
      { name: "Saved", description: "Form submitted successfully" }
    ],

    demonstration: [
      { action: "click", what: "New Contact button", why: "Open the form" },
      { action: "type", what: "Name field", why: "Enter contact name" },
      { action: "click", what: "Save button", why: "Create the contact" }
    ]
  },

  // Current state (what I see)
  pageState: {
    url: "https://crm.example.com/contacts",
    elements: [...],
    forms: [...],
    screenshot: "..."
  },

  // My progress (where I am)
  progress: {
    currentMilestone: "Form Open",
    completed: ["Form Open"],
    remaining: ["Fields Filled", "Saved"]
  },

  // The question (what should I do?)
  question: "What should you do next to achieve the goal?"
}
```

**The AI is asked**: "Given your goal and knowledge, what should you do next?"

### New Capabilities

| Capability | How It Works |
|------------|--------------|
| **Adapts to UI changes** | Understands goal, finds elements by purpose not position |
| **Uses Q&A knowledge** | "Lead Source = Web" is used every execution |
| **Verifies success** | Checks for toast/confirmation, not just "steps done" |
| **Handles variations** | "Add 3 contacts" → runs skill 3 times automatically |
| **Asks for help when stuck** | "I can't find Save. Can you help?" |
| **Learns from experience** | Remembers what worked, avoids what failed |

### Mental Model: New Employee

```
Training = Show them how to do the task + answer their questions
Execution = They figure out how to accomplish the goal
Adaptation = If something's different, they adapt or ask
```

---

## The Gaps We're Closing

### Gap 1: Step-Focused → Goal-Focused

| Before | After |
|--------|-------|
| "Execute step 3" | "Achieve the goal" |
| AI finds elements | AI pursues objectives |
| Success = all steps done | Success = goal verified |

**Why it matters**: When UI changes, step-based execution breaks. Goal-based execution adapts.

---

### Gap 2: Q&A Answers Unused → Q&A Becomes Knowledge

| Before | After |
|--------|-------|
| User answers questions | User answers questions |
| Answers stored but ignored | Answers become execution rules |
| AI doesn't know "always use Web" | AI applies "Lead Source = Web" every time |

**Why it matters**: User invests time answering questions. That knowledge should be used.

---

### Gap 3: No Progress Awareness → Milestone-Based Progress

| Before | After |
|--------|-------|
| "Step 2 of 5" | "Form filled, ready to save" |
| Mechanical counting | Human-like understanding |
| No idea if on track | Knows if making progress toward goal |

**Why it matters**: If something goes wrong, AI can recognize it's off track and recover.

---

### Gap 4: Fail Hard → Adapt or Ask

| Before | After |
|--------|-------|
| Element not found → Error | Element not found → Try alternatives |
| No recovery options | Look for "Submit" if "Save" not found |
| User sees error message | AI asks "I can't find Save. Where is it?" |

**Why it matters**: Real employees don't give up at the first obstacle.

---

### Gap 5: Single Item → Natural Batch Handling

| Before | After |
|--------|-------|
| "Add Alice" works | "Add Alice" works |
| "Add Alice, Bob, Carol" fails | "Add Alice, Bob, Carol" → adds 3 contacts |
| Requires special iteration setup | Natural language detection |

**Why it matters**: Most real work involves multiple items.

---

### Gap 6: No Success Verification → Confirmed Completion

| Before | After |
|--------|-------|
| "All steps executed" | "Contact Created toast appeared" |
| Might have failed silently | Verifies actual success |
| User has to check manually | AI confirms goal achieved |

**Why it matters**: Completing steps ≠ achieving goal. AI should know the difference.

---

### Gap 7: Demonstration = Script → Demonstration = Reference

| Before | After |
|--------|-------|
| Recording is the execution plan | Recording teaches the AI |
| Must follow exact steps | Can deviate when needed |
| Rigid sequence | Flexible approach guided by goal |

**Why it matters**: The demonstration shows ONE way. The AI should understand the goal, not just mimic the steps.

---

## Visual Comparison

### Execution Flow: Before

```
┌─────────────┐
│ Load Steps  │
└──────┬──────┘
       ↓
┌─────────────┐     ┌─────────────┐
│ Step 1      │────→│ Find Element│────→ Execute
└──────┬──────┘     └─────────────┘
       ↓
┌─────────────┐     ┌─────────────┐
│ Step 2      │────→│ Find Element│────→ Execute
└──────┬──────┘     └─────────────┘
       ↓
┌─────────────┐     ┌─────────────┐
│ Step 3      │────→│ Find Element│────→ Execute
└──────┬──────┘     └─────────────┘
       ↓
┌─────────────┐
│ "Done"      │  ← No verification
└─────────────┘
```

### Execution Flow: After

```
┌──────────────────┐
│ Load Skill       │
│ (goal, knowledge,│
│  milestones)     │
└────────┬─────────┘
         ↓
┌────────────────────────────────────────────┐
│              EXECUTION LOOP                 │
│                                            │
│  ┌──────────┐                              │
│  │ OBSERVE  │ What do I see on the page?   │
│  └────┬─────┘                              │
│       ↓                                    │
│  ┌──────────┐                              │
│  │ THINK    │ What should I do to achieve  │
│  │          │ my goal? Am I on track?      │
│  └────┬─────┘                              │
│       ↓                                    │
│  ┌──────────┐                              │
│  │ ACT      │ Execute the decided action   │
│  └────┬─────┘                              │
│       ↓                                    │
│  ┌──────────┐                              │
│  │ REFLECT  │ Did it work? Closer to goal? │
│  └────┬─────┘                              │
│       ↓                                    │
│  ┌──────────────────────────────────────┐  │
│  │ Goal achieved? → Exit with success   │  │
│  │ On track? → Continue loop            │  │
│  │ Stuck? → Try alternative or ask user │  │
│  └──────────────────────────────────────┘  │
│                                            │
└────────────────────────────────────────────┘
         ↓
┌─────────────────┐
│ "Goal Achieved" │ ← Verified!
│ (toast appeared)│
└─────────────────┘
```

---

## What We're Building (Summary)

| Component | Purpose | Gap Closed |
|-----------|---------|------------|
| **Skill interface** | Unified view of learned task | Q&A + Recording → usable knowledge |
| **getSkill()** | Extract Skill from SavedWorkflow | Bridge old storage to new model |
| **Milestone detection** | AI identifies logical phases | Step counting → progress awareness |
| **Goal-oriented prompts** | Ask "what to do" not "find element" | Step-focused → Goal-focused |
| **ExecutionEngine** | Observe→Think→Act→Reflect loop | Rigid replay → adaptive execution |
| **SuccessVerifier** | Check success criteria | No verification → confirmed completion |
| **HelpSystem** | Ask user when stuck | Fail hard → adapt or ask |
| **Batch executor** | Handle multiple items | Single item → natural batching |

---

## The Transformation in One Picture

```
BEFORE:                              AFTER:
┌────────────────────┐              ┌────────────────────┐
│   WORKFLOW         │              │   SKILL            │
│                    │              │                    │
│   Step 1           │              │   Goal             │
│   Step 2           │              │   Knowledge        │
│   Step 3           │              │   Milestones       │
│                    │              │   Success Criteria │
│   (What to do)     │              │   Demonstration    │
│                    │              │                    │
│                    │              │   (What + Why +    │
│                    │              │    How to verify)  │
└────────────────────┘              └────────────────────┘
         ↓                                   ↓
┌────────────────────┐              ┌────────────────────┐
│   EXECUTION        │              │   EXECUTION        │
│                    │              │                    │
│   for step in      │              │   while not done:  │
│   steps:           │              │     observe()      │
│     find(step)     │              │     think()        │
│     execute(step)  │              │     act()          │
│                    │              │     reflect()      │
│   "Steps done"     │              │                    │
│                    │              │   "Goal achieved"  │
└────────────────────┘              └────────────────────┘

    MACRO PLAYER          →         VIRTUAL EMPLOYEE
```

---

## Why This Matters

1. **Reliability**: Goal-oriented execution is more robust than step replay
2. **User Investment**: Q&A answers actually get used
3. **Scalability**: Batch operations work naturally
4. **Trust**: Success is verified, not assumed
5. **Flexibility**: Adapts to changes instead of breaking
6. **Future-proof**: Foundation for more intelligent automation

This transformation takes Mimo from "automation tool" to "intelligent assistant."
