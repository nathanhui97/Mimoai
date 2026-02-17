# Skill-Based Architecture: From Step Replayer to Trained Employee

## Overview

This document describes the next evolution of Mimoai's AI agent — moving from **step-by-step replay** to **skill-based execution** with a **per-page planning model** that preserves speed while adding real intelligence.

The core principle: **AI thinks once per page, code executes per step.**

---

## Part 1: The Planning Architecture

### The Problem Today

The current agent calls the LLM **per step** when the fast-path fails. Each LLM call costs 1-3 seconds. For a 12-step workflow where 6 steps need LLM help, that's 6-18 seconds of just waiting for AI.

### The Solution: Two-Level Planning

```
SKILL PLAN (set once, spans entire workflow):
  Phase 1: Navigate to new contact form     -> Page 1
  Phase 2: Fill contact details             -> Page 2
  Phase 3: Verify contact was created       -> Page 3

PAGE PLAN (regenerated on each page load):
  "I'm on Page 2. I see a form. Here are the fields mapped to DOM elements."
```

The **skill plan** is the roadmap — it knows the full journey across pages. The **page plan** is the GPS — recalculated for wherever you are right now.

### Execution Flow

```
Workflow starts
  |
  v
Skill Plan loaded: 3 phases
  |
  v
PAGE 1: Contacts List
  +-- Page Planner (AI, 1 call): "List page with New button"
  +-- Plan: [{ click: "New" button }]
  +-- Executor: click (50ms)
  +-- Detects navigation
  |
  v
PAGE 2: Contact Form
  +-- Page Planner (AI, 1 call): "Form with 8 fields"
  +-- Plan: [
  |     { field: "First Name", value: "John", selector: "...", strategy: type },
  |     { field: "Last Name", value: "Smith", selector: "...", strategy: type },
  |     { field: "Email", value: "john@acme.com", selector: "...", strategy: type },
  |     { submit: "Save", selector: "..." }
  |   ]
  +-- Executor: type, type, type, click (200ms total)
  +-- Detects navigation
  |
  v
PAGE 3: Contact Detail
  +-- Page Planner (AI, 1 call): "Detail page shows John Smith"
  +-- Plan: [{ verify: success }]
  +-- Done
```

**Result: 3 LLM calls instead of 6-12. Same execution speed.**

### When to Re-Plan

The page planner fires on **meaningful state changes**, not per step:

| Trigger | Re-plan? | Why |
|---------|----------|-----|
| URL changes (navigation) | Yes | New page, new context |
| Modal opens/closes | Yes | New UI scope |
| Major DOM shift (AJAX content load) | Yes | Page content replaced |
| Filling a field | No | Same form, same context |
| Scrolling | No | Same page |
| Dropdown opens | No | Ephemeral UI, executor handles it |

Detection heuristic for "major DOM shift": >50% of interactive elements are new compared to the last DOM map snapshot.

### PagePlan Type

```typescript
interface PagePlan {
  // What the AI sees
  pageType: 'form' | 'list' | 'detail' | 'confirmation' | 'error' | 'navigation';

  // The primary output: mapped fields -> DOM elements
  fieldActions: FieldAction[];

  // Navigation actions (click buttons, follow links)
  navigationActions: NavigationAction[];

  // Submit/save action
  submitAction?: {
    elementIndex: number;
    selector: string;
    waitAfterMs: number;
  };

  // What to verify after all actions
  successCheck: {
    type: 'toast' | 'url_change' | 'element_appears' | 'text_visible';
    pattern: string;
  };
}

interface FieldAction {
  fieldName: string;        // Semantic: "Email", "First Name"
  value: string;            // From skill inputs or variables
  elementIndex: number;     // Index in DOM map (AI-resolved)
  selector: string;         // Best selector (AI picks from candidates)
  strategy: 'type' | 'select' | 'click' | 'checkbox' | 'date_picker';
  required: boolean;        // From skill's field model
}

interface NavigationAction {
  description: string;      // "Click New button"
  elementIndex: number;
  selector: string;
  expectsNavigation: boolean;
  expectsModal: boolean;
}
```

### What the Planner Receives

```typescript
interface PlannerInput {
  // FROM SKILL (persists across pages)
  currentPhase: string;         // "Fill contact details"
  phaseGoal: string;            // "Enter all required contact information"
  inputValues: Record<string, string>;  // { firstName: "John", ... }
  fieldModel: FieldModel[];     // Known fields with types, required status

  // FROM CURRENT PAGE (fresh)
  domMap: string;               // Current DOM map text
  url: string;
  formFields: FormField[];      // Detected form fields with current values

  // FROM EXPERIENCE (learned over time)
  fieldMappings: Record<string, {
    lastSelector: string;
    reliability: number;        // 0-1
  }>;
}
```

### Speed Comparison

For a 12-step workflow across 3 pages:

| Approach | LLM Calls | Execution | Total |
|----------|-----------|-----------|-------|
| Today (per-step LLM) | 4-8 | ~600ms | ~8-14s |
| Per-page planning | 3 | ~600ms | ~5-6s |
| After learning (5+ runs) | 0-1 | ~600ms | ~1-2s |

After learning, most page plans are **cached** — the learned field mappings from execution history become the plan without any LLM call.

### SPA / No-Navigation Page Changes

For SPAs (React, Angular, Salesforce Lightning) where content changes without URL change:

```
After each action:
  1. URL changed?                              -> re-plan
  2. Modal appeared/disappeared?               -> re-plan (scoped to modal)
  3. DOM changed significantly?                -> re-plan
     - Same form, field updated               -> don't re-plan
     - New content section loaded             -> re-plan
```

### The Three Execution Layers

```
+---------------------------------------------+
|  PLANNER (AI) -- once per page              |  ~1.5s
|  Maps skill knowledge to current DOM        |
+---------------------------------------------+
|  EXECUTOR (Code) -- per step                |  ~50ms each
|  Deterministic: DOM queries, events,        |
|  value setting, verification                |
+---------------------------------------------+
|  RECOVERY (AI) -- only when stuck           |  ~1.5s, <5% of steps
|  Element not found, unexpected state        |
+---------------------------------------------+
```

### Read vs Write Strategy

| Operation | Method | Speed |
|-----------|--------|-------|
| Read field values | `input.value`, DOM inspection | Instant |
| Check page state | DOM queries, URL check | Instant |
| Fill text fields | `focus -> type events -> blur` | Fast, triggers validation |
| Select dropdowns | Click to open -> click option | Fast, triggers handlers |
| Click buttons | Simulated click | Fast, triggers listeners |
| Verify outcomes | DOM inspection, URL check | Instant |

**Read with code, write with interaction simulation.** Direct value assignment (`input.value = "foo"`) skips framework change handlers and breaks React/Angular apps. But reading is always safe.

---

## Part 2: Enhanced Teaching Session

### What the Recording Already Captures Well

The current recording system is surprisingly rich:

- **Selectors**: 7-strategy LocatorBundle with quality scoring
- **Context**: Siblings, parents, ancestors, container/widget scope
- **Decision space**: All dropdown options, not just selected
- **Semantic anchors**: Labels, aria-labels, nearby text
- **Before/after signals**: DOM diffing for expected outcomes
- **Intent inference**: CLICK, TYPE, SUBMIT_FORM, SELECT_DROPDOWN_OPTION
- **Step goals**: Intent + description + expected outcome
- **Visual snapshots**: Annotated screenshots of viewport + element
- **Spreadsheet context**: Cell references, column headers, data types

### What's Missing

Despite the rich per-step capture, the recording misses **cross-step understanding** that would make skill extraction much more accurate.

#### Gap 1: No Full Form Audit

The recording captures each field as the user interacts with it, but never takes a snapshot of ALL fields on the form. This means:

- We don't know which fields the user **skipped** (optional vs didn't notice)
- We don't know which fields had **default values** (didn't need changing)
- We don't know the **total field count** (can't calculate % completion)

**Fix: Form Snapshot at Phase Boundaries**

When the user first interacts with a form field on a page, capture a `FormAudit`:

```typescript
interface FormAudit {
  capturedAt: number;
  url: string;

  // ALL fields on the form, not just the one being filled
  fields: FormFieldSnapshot[];

  // Form-level metadata
  formId?: string;
  formAction?: string;
  totalFields: number;
  requiredFields: number;
  prefilledFields: number;
}

interface FormFieldSnapshot {
  // Identity
  label: string;              // From label element, aria-label, placeholder
  name: string;               // input name attribute
  selector: string;           // Best selector

  // Type and constraints
  type: 'text' | 'email' | 'phone' | 'date' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'number';
  required: boolean;          // Has required attr, aria-required, or asterisk in label
  pattern?: string;           // Validation pattern
  options?: string[];         // For select/radio: all available options

  // Current state (at time of audit)
  currentValue: string;       // Pre-filled value, default, or empty
  isEmpty: boolean;
  isEnabled: boolean;
  isVisible: boolean;

  // Section grouping
  section?: string;           // Fieldset legend, form section heading
  fieldOrder: number;         // Position in DOM order
}
```

**When to capture:** First form interaction on a page triggers the audit. This is a synchronous DOM scan — no AI needed, ~10ms.

**Value:** After recording, the AI knows "the form has 15 fields, user filled 5, 3 had defaults, 7 were left empty." It can then infer which are truly optional.

#### Gap 2: No Negative Space Tracking

Related to the form audit — we need to explicitly track what the user **didn't** do.

**Fix: End-of-Phase Diff**

When the user clicks a submit/save button, diff the form audit against the interactions:

```typescript
interface FormCompletionDiff {
  // Fields the user interacted with
  filledFields: Array<{
    label: string;
    value: string;
    interactionType: 'typed' | 'selected' | 'checked' | 'cleared';
  }>;

  // Fields the user skipped
  skippedFields: Array<{
    label: string;
    hadDefault: boolean;
    defaultValue?: string;
    wasRequired: boolean;
    wasVisible: boolean;
    inferredReason: 'optional' | 'had_default' | 'not_applicable' | 'hidden';
  }>;

  // Summary
  completionRate: number;     // 5/15 = 0.33
  requiredFieldsComplete: boolean;
}
```

**Value:** The skill model learns "Phone is always optional" and "Country always has a default of 'US'" — so it can skip these during execution.

#### Gap 3: No Page-Level DOM Map During Recording

During execution, the agent gets a full DOM map. But during recording, no equivalent is captured. The post-recording AI analysis works from per-step context (siblings, ancestors) but doesn't see the full page structure.

**Fix: Lightweight DOM Map at Page Transitions**

When the URL changes during recording, capture a simplified DOM map:

```typescript
interface RecordingPageSnapshot {
  url: string;
  timestamp: number;

  // Page structure (lightweight, not full DOM map)
  headings: string[];
  formCount: number;
  interactiveElementCount: number;
  pageType: 'form' | 'list' | 'detail' | 'dashboard' | 'login' | 'other';

  // Navigation context
  breadcrumbs?: string[];
  activeTab?: string;
  menuItems?: string[];
}
```

**Value:** The post-recording AI can reason about page structure: "Page 1 is a list view, Page 2 is a form, Page 3 is a detail view." This improves phase detection.

#### Gap 4: No Interactive Teaching Refinement

The AI analyzes the recording once and that's it. If it misinterprets something, the error persists.

**Fix: Show-and-Confirm Loop**

After recording and AI analysis, show the user a structured summary:

```
I learned this workflow:

Goal: Create a new contact in Salesforce
Pages: 3 (Contact List -> New Contact Form -> Contact Detail)

Phase 1: Navigate to Form
  - Click "New" button on contacts list

Phase 2: Fill Contact Details
  Required: First Name, Last Name, Email
  Optional: Phone, Title, Department (you skipped these)
  Default kept: Account = "Acme Corp" (was pre-filled)

Phase 3: Save and Verify
  - Click "Save" button
  - Success: Contact detail page loads

Is this correct? [Yes] [Edit]
```

If the user edits, their corrections become **high-confidence overrides** stored in `WorkflowMemory.clarifications`:

```typescript
interface TeachingCorrection {
  type: 'field_required' | 'field_optional' | 'phase_name' | 'success_criteria' | 'goal';
  target: string;         // Field name, phase name, etc.
  correction: string;     // "Phone is actually required for external contacts"
  confidence: 1.0;        // User corrections are always highest confidence
}
```

#### Gap 5: No Multi-Recording Skill Building

Recording once creates one understanding. But real skills have variations.

**Fix: Allow Multiple Teaching Sessions**

Let users record the SAME workflow multiple times with different scenarios:

```
Recording 1: Create contact with all fields
Recording 2: Create contact with just required fields
Recording 3: Create contact that triggers a validation error
```

The system merges these into one enriched skill model:

- Fields filled in ALL recordings -> definitely required
- Fields filled in SOME recordings -> conditionally required
- Fields filled in NO recordings (after first) -> truly optional
- Error handling from recording 3 -> adds recovery knowledge

```typescript
interface MultiRecordingMerge {
  recordings: number;
  fieldConfidence: Record<string, {
    filledCount: number;
    totalRecordings: number;
    inferredRequired: boolean;
    variations: string[];  // Different values used across recordings
  }>;
  pathVariations: Array<{
    description: string;     // "Error path when email is invalid"
    steps: number[];         // Which steps differ
  }>;
}
```

#### Gap 6: No Teaching Context / Notes

The user can't annotate the recording with domain knowledge.

**Fix: Contextual Annotations**

During or after recording, let users add notes:

- "This field is required for external contacts only"
- "Wait here — the page loads slowly"
- "Sometimes this dropdown has different options depending on record type"

These annotations attach to specific steps and become part of the skill model, giving the AI domain knowledge it can't infer from DOM events alone.

---

## Part 3: Implementation Roadmap

### Phase A: Form Audit (recording enhancement)

**Effort:** Small (~200 lines)
**Impact:** High — enables negative space tracking and field model building

1. Add `FormAuditor` module in `src/content/recording/`
2. Trigger on first form field interaction per page
3. Scan all form fields, capture `FormAudit`
4. On submit button click, generate `FormCompletionDiff`
5. Attach both to the `SavedWorkflow` for post-recording analysis

### Phase B: Page Planner (new execution model)

**Effort:** Medium (~500 lines)
**Impact:** High — reduces LLM calls from per-step to per-page

1. Create `PagePlanner` module in `src/lib/agent/`
2. Takes DOM map + skill knowledge, calls LLM once, returns `PagePlan`
3. Create `PlanExecutor` module that loops through `PagePlan.fieldActions`
4. Add page-change detection (URL change, modal, major DOM shift)
5. Wire into execution loop: planner fires on page change, executor handles steps

### Phase C: Skill Model Extraction (data model)

**Effort:** Medium (~400 lines)
**Impact:** Medium — creates the field-level knowledge the planner needs

1. Define `Skill` type that represents field-level procedural knowledge
2. Auto-generate from `WorkflowMemory` + `FormAudit` + `FormCompletionDiff`
3. Refine after each execution (field mappings, timing, reliability)
4. Store alongside `WorkflowMemory` in workflow storage

### Phase D: Teaching Refinement UI (recording enhancement)

**Effort:** Medium (~400 lines, includes UI)
**Impact:** Medium — user corrections = highest confidence data

1. After recording + AI analysis, show structured summary in sidepanel
2. Let user confirm, edit field requirements, correct phase names
3. Store corrections as `TeachingCorrection[]` in workflow memory
4. Post-recording AI uses corrections as constraints

### Phase E: Multi-Recording Merge (advanced)

**Effort:** Large (~600 lines)
**Impact:** High (but requires multiple recordings per skill)

1. Detect when user records a workflow for the same app/page combination
2. Offer to merge with existing skill
3. Run `MultiRecordingMerge` to identify field confidence, path variations
4. Update skill model with merged knowledge

### Phase F: Plan Caching / Learning (optimization)

**Effort:** Small (~200 lines)
**Impact:** High after 3+ runs — eliminates LLM calls entirely

1. Cache successful `PagePlan` per (url_pattern + phase)
2. On subsequent runs, try cached plan first
3. If cached plan fails (field not found), re-plan with LLM
4. After 5+ successful cached plans, mark as "mastered"

### Recommended Order

```
Phase A (Form Audit)       -- immediate, improves everything downstream
     |
Phase B (Page Planner)     -- the core speed improvement
     |
Phase C (Skill Model)      -- enables plan caching and field-level knowledge
     |
Phase D (Teaching UI)      -- user corrections improve accuracy
     |
Phase E (Multi-Recording)  -- advanced, for power users
     |
Phase F (Plan Caching)     -- the final speed win, near-zero LLM calls
```

Phase A can ship independently and immediately improves post-recording analysis accuracy. Phase B is the biggest single improvement. Phases C-F build on each other.

---

## Design Principles

1. **AI thinks, code executes.** LLM calls happen at page boundaries, not step boundaries.
2. **Recordings are teaching sessions.** They create skill models, not step lists.
3. **Speed is non-negotiable.** Per-step execution must stay <100ms. LLM calls are batched.
4. **Learn from every run.** Each execution refines the skill model. After 5 runs, LLM calls approach zero.
5. **User corrections are gold.** When a user says "this field is required," that's higher confidence than any AI inference.
6. **Scoped to taught workflows.** The agent only does what it was taught. It's an employee following training, not a general-purpose explorer.
