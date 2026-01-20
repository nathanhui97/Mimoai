# Workflow Memory System

## The Human Cognition Model

When humans learn a skill, we don't memorize step-by-step instructions. Instead, we form **mental models** that capture:

1. **What it's for** (purpose)
2. **How it works** (chunked into phases, not micro-steps)
3. **What it needs** (inputs)
4. **When to use it** (triggers & context)
5. **What success looks like** (outcomes)
6. **How to adapt** (flexibility)

This system creates a similar "memory" for each workflow.

---

## The Problem with Current Approach

Currently, workflow data is scattered across multiple places:

```
SavedWorkflow
├── steps[]                    // Raw recorded steps
├── variables                  // Detected inputs
├── inferredIntent             // Basic goal inference
├── learnedSkill               // Teaching conversation results
├── aiAnalysis                 // Post-recording AI analysis
│   ├── workflowUnderstanding
│   ├── stepGuidance[]
│   └── patterns[]
└── ... more scattered fields
```

When the agent needs to understand a workflow, it has to:
1. Parse multiple nested structures
2. Reconcile potentially conflicting information
3. Miss context because it's spread across different places

**The agent has no single "memory" to consult.**

---

## The Solution: Unified Workflow Memory

A single, coherent memory structure that captures everything the agent needs:

```typescript
interface WorkflowMemory {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY - Who am I?
  // ═══════════════════════════════════════════════════════════════════════════
  identity: {
    name: string;              // "Add Contact to CRM"
    purpose: string;           // "Creates a new contact record in the CRM system"
    domain: string;            // "CRM / Contact Management"
    category: TaskCategory;    // 'data_entry' | 'navigation' | 'lookup' | etc.
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UNDERSTANDING - What do I do?
  // ═══════════════════════════════════════════════════════════════════════════
  understanding: {
    // High-level phases (how humans chunk procedures)
    phases: Array<{
      name: string;            // "Fill Contact Form"
      purpose: string;         // "Enter the contact's information"
      stepRange: [number, number];  // Which steps belong to this phase
    }>;

    // One-liner for quick matching
    elevator: string;          // "Adds a new contact to the CRM with name, email, and phone"

    // What entities are involved
    entities: string[];        // ["contact", "form", "CRM"]
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUTS - What do I need?
  // ═══════════════════════════════════════════════════════════════════════════
  inputs: {
    required: InputField[];    // Must have these to execute
    optional: InputField[];    // Nice to have, use defaults if missing
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGERS - When should I be used?
  // ═══════════════════════════════════════════════════════════════════════════
  triggers: {
    // Natural language patterns that invoke this workflow
    phrases: string[];         // ["add contact", "new customer", "create contact"]

    // Page/context requirements
    pageContext?: {
      urlPatterns?: string[];  // ["/contacts", "/crm/*"]
      pageTypes?: string[];    // ["contact_list", "crm_dashboard"]
      requiredElements?: string[];  // ["Add Contact button visible"]
    };

    // When NOT to use this (disambiguation)
    notWhen?: string[];        // ["editing existing contact", "viewing contact details"]
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PATTERN - What kind of task is this?
  // ═══════════════════════════════════════════════════════════════════════════
  pattern: {
    type: PatternType;         // 'single_entry' | 'repeatable' | 'batch' | 'navigation' | 'lookup'

    // For repeatable patterns
    repetition?: {
      supportsMultiple: boolean;  // Can do "add Alice, Bob, Carol"
      separator?: string;         // How to split: "and", ",", "then"
      maxBatch?: number;          // Max items per invocation
    };

    // For data entry patterns (especially spreadsheets)
    dataEntry?: {
      targetStrategy: 'fixed_location' | 'first_empty_row' | 'append' | 'specific_row';
      rowDetection?: 'by_content' | 'by_format' | 'by_position';
      preservesExisting: boolean;  // Does it overwrite or add?
    };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SUCCESS - How do I know I'm done?
  // ═══════════════════════════════════════════════════════════════════════════
  success: {
    // What indicates completion
    indicators: SuccessIndicator[];

    // What indicates something went wrong
    failureIndicators: string[];

    // Expected state after completion
    endState: string;          // "Contact appears in list, form is closed"
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ADAPTABILITY - How flexible am I?
  // ═══════════════════════════════════════════════════════════════════════════
  adaptability: {
    // Can skip these steps in certain conditions
    optionalSteps: number[];

    // Can execute in different orders
    reorderablePhases: boolean;

    // Known variations this workflow handles
    variations: string[];      // ["with phone", "without phone", "with company"]

    // What to do if specific elements aren't found
    fallbacks: Array<{
      when: string;            // "Email field not visible"
      then: string;            // "Look for 'Contact Email' label instead"
    }>;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // LEARNING - What have I learned from experience?
  // ═══════════════════════════════════════════════════════════════════════════
  experience: {
    timesExecuted: number;
    successRate: number;
    lastExecuted?: number;

    // Steps that often need recovery
    troubleSpots: Array<{
      stepIndex: number;
      issue: string;           // "Dropdown takes time to load"
      solution: string;        // "Wait for options to appear before clicking"
    }>;

    // What's worked in the past
    provenStrategies: Array<{
      situation: string;       // "Save button disabled"
      strategy: string;        // "Check for required field indicators"
    }>;
  };
}
```

---

## Supporting Types

```typescript
// What kind of workflow is this?
type TaskCategory =
  | 'data_entry'      // Fill forms, add records
  | 'navigation'      // Go somewhere
  | 'lookup'          // Find information
  | 'modification'    // Edit existing data
  | 'deletion'        // Remove something
  | 'export'          // Download/export data
  | 'import'          // Upload/import data
  | 'verification'    // Check/validate something
  | 'communication';  // Send message, email, etc.

// What execution pattern does this follow?
type PatternType =
  | 'single_entry'    // One item at a time (add one contact)
  | 'repeatable'      // Can repeat for multiple items (add Alice, then Bob)
  | 'batch'           // Handles multiple in one go (import CSV)
  | 'navigation'      // Just getting somewhere
  | 'lookup'          // Finding information
  | 'transformation'; // Changing existing data

// Input field definition
interface InputField {
  name: string;              // "Name", "Email", "Amount"
  description: string;       // "Contact's full name"
  type: InputType;           // 'text' | 'email' | 'phone' | 'number' | 'date' | 'select'
  extractionHints: string[]; // ["name is", "called", "for"] - helps extract from "add John Smith"
  validationRules?: string[];// ["must be valid email", "required"]
  defaultValue?: string;     // Use if not provided
  exampleValues?: string[];  // ["John Smith", "Jane Doe"]
}

type InputType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'company_name'
  | 'person_name'
  | 'address';

// How to verify success
interface SuccessIndicator {
  type: 'text_appears' | 'text_disappears' | 'url_changes' | 'element_appears' |
        'element_disappears' | 'count_changes' | 'toast_appears' | 'modal_closes';
  description: string;       // Human-readable: "Success toast appears"
  pattern?: string;          // For matching: "Contact.*saved|created successfully"
  priority: 'primary' | 'secondary' | 'fallback';
}
```

---

## How It's Used

### 1. Workflow Matching

```typescript
// User says: "add John Smith to the CRM"
// Agent checks each workflow's memory:

for (const workflow of workflows) {
  const memory = workflow.memory;

  // Check triggers
  const phraseMatch = memory.triggers.phrases.some(p =>
    userQuery.toLowerCase().includes(p)
  );

  // Check context
  const contextMatch = !memory.triggers.pageContext ||
    currentPage.matches(memory.triggers.pageContext);

  // Check not-when exclusions
  const notExcluded = !memory.triggers.notWhen?.some(n =>
    situationMatches(n, currentContext)
  );

  if (phraseMatch && contextMatch && notExcluded) {
    candidates.push({ workflow, memory });
  }
}
```

### 2. Variable Extraction

```typescript
// User says: "add John Smith with email john@acme.com"
// Agent knows exactly what to extract from memory.inputs:

const extractionPrompt = `
Extract values for these fields from the user's request:
${memory.inputs.required.map(i =>
  `- ${i.name} (${i.type}): ${i.description}
   Hints: ${i.extractionHints.join(', ')}
   Examples: ${i.exampleValues?.join(', ')}`
).join('\n')}

User request: "${userQuery}"
`;

// LLM knows: extract "Name" (person_name) and "Email" (email)
// Result: { Name: "John Smith", Email: "john@acme.com" }
```

### 3. Loop Handling

```typescript
// User says: "add Alice, Bob, and Carol to the spreadsheet"

if (memory.pattern.repetition?.supportsMultiple) {
  const separator = memory.pattern.repetition.separator; // "and", ","
  const items = parseMultipleItems(userQuery, separator);

  for (const item of items) {
    await executeWorkflow(workflow, { Name: item });
  }
}
```

### 4. Dynamic Row Targeting

```typescript
// Memory says: pattern.dataEntry.targetStrategy = 'first_empty_row'

if (memory.pattern.dataEntry?.targetStrategy === 'first_empty_row') {
  // Override recorded row with first empty row
  const targetRow = await findFirstEmptyRow(spreadsheet);
  adjustStepTargets(steps, targetRow);
}
```

### 5. Success Verification

```typescript
// After execution, check memory.success.indicators

for (const indicator of memory.success.indicators) {
  if (indicator.type === 'toast_appears') {
    const found = await checkForToast(indicator.pattern);
    if (found) return { success: true, reason: indicator.description };
  }
}
```

---

## Memory Generation

Memory is generated/updated at these points:

1. **After recording stops** - Initial analysis creates the memory
2. **After teaching conversation** - Enriches with user's explanations
3. **After each execution** - Updates `experience` with what worked/failed
4. **On user edit** - User can correct/refine the memory

```typescript
async function generateWorkflowMemory(
  workflow: SavedWorkflow,
  options?: { includeTeaching?: boolean }
): Promise<WorkflowMemory> {
  // Consolidate all existing analysis
  const existing = {
    intent: workflow.inferredIntent,
    skill: workflow.learnedSkill,
    analysis: workflow.aiAnalysis,
    variables: workflow.variables,
  };

  // Generate unified memory via AI
  const memory = await analyzeForMemory(workflow.steps, existing);

  return memory;
}
```

---

## Migration Strategy

We don't remove existing fields immediately. Instead:

1. Add `memory?: WorkflowMemory` to `SavedWorkflow`
2. Generate memory for new workflows automatically
3. Generate memory lazily for existing workflows on first access
4. Gradually migrate code to use `memory` instead of scattered fields
5. Eventually deprecate redundant fields

---

## Benefits

1. **Single source of truth** - Agent consults one structure
2. **Human-like reasoning** - Matches how we think about tasks
3. **Better matching** - Triggers and context make selection accurate
4. **Targeted extraction** - Knows exactly what inputs to extract
5. **Pattern awareness** - Handles loops, batches, dynamic targeting
6. **Learning from experience** - Gets better over time
7. **Easier debugging** - Can see exactly what the agent "knows"
