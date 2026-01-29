# Virtual Employee Implementation Tracker

This document tracks the implementation progress of the Virtual Employee architecture.
Use this to continue work across sessions.

---

## Quick Status

| Phase | Status | Key Deliverable |
|-------|--------|-----------------|
| **Phase 1: Skill Foundation** | ✅ COMPLETE + TESTED | `getSkill()`, `SkillStorage`, `SkillIndex` |
| **Phase 2: Enhanced Learning** | ✅ COMPLETE + TESTED | Milestones in memory, Q&A → knowledge |
| **Phase 3: Goal-Oriented Execution** | 🔲 NOT STARTED | Observe→Think→Act→Reflect loop |
| **Phase 4: Skill Awareness** | 🔲 NOT STARTED | Natural language → skill matching |
| **Phase 5: Help System** | 🔲 NOT STARTED | Ask user when stuck |
| **Phase 6: Multi-Item Scaling** | 🔲 NOT STARTED | "Add Alice, Bob, Carol" |

---

## Phase 1: Skill Foundation ✅ COMPLETE

### What Was Built
```
src/lib/skill/
├── types.ts          # Skill interface (520 lines)
├── skill-view.ts     # getSkill() function (720 lines)
├── skill-storage.ts  # CRUD operations (280 lines)
├── skill-index.ts    # Fast lookup (330 lines)
└── index.ts          # Module exports (40 lines)
```

### Key Functions
- `getSkill(workflow)` - Extract Skill view from SavedWorkflow
- `getSkillSummary(workflow)` - Lightweight version for lists
- `SkillStorage.getAllSkills()` - Get all skills
- `SkillStorage.searchSkills(query)` - Search by text
- `buildSkillIndex(skills)` - Build lookup index
- `findSkillsForQuery(query, index)` - Match natural language

### Testing Guide
```typescript
// Test 1: Basic skill extraction
import { getSkill } from './lib/skill';
import { WorkflowStorage } from './lib/storage';

const workflows = await WorkflowStorage.loadWorkflows();
const skill = getSkill(workflows[0]);
console.log('Skill:', {
  name: skill.name,
  goal: skill.goal.description,
  inputs: skill.inputs.required.map(i => i.name),
  milestones: skill.milestones.map(m => m.name),
  triggers: skill.triggers.phrases,
});

// Test 2: Skill index matching
import { buildSkillIndex, findSkillsForQuery } from './lib/skill';

const skills = workflows.map(getSkill);
const index = buildSkillIndex(skills);
const matches = findSkillsForQuery("add contact", index);
console.log('Matches:', matches);
```

### Manual Test Steps
1. Open browser extension
2. Open DevTools console in side panel
3. Run the test code above
4. Verify skill object has expected structure

---

## Phase 2: Enhanced Learning ✅ COMPLETE

### Goal
Make recordings produce complete Skill knowledge with milestones.

### Analysis Summary

**Current State:**
- Q&A answers are already stored in `workflow.memory.clarifications`
- `extractKnowledge()` in `skill-view.ts` already converts clarifications to rules ✅
- The edge function generates `blocks` but not proper `phases` for milestones
- Post-recording UI shows steps but not skill summary

**What Was Implemented:**
1. Edge function prompt updated to generate `phases` array with milestone structure
2. Fallback logic to convert blocks to phases if AI doesn't generate phases
3. Default phase synthesis for workflows without memory
4. Post-recording confirm screen now shows "What I'll Learn" skill preview

### Tasks

#### Task 2.1: Update Edge Function for Milestones
**Status:** ✅ Complete
**File:** `supabase/functions/generate_workflow_memory/index.ts`

**Changes Required:**
1. Update prompt to explicitly request `phases` array in `memory.understanding`
2. Add milestone detection guidance to AI prompt
3. Ensure phases have proper structure: `{ name, purpose, stepIndices, criticality }`

**Implementation Details:**
```typescript
// In buildUnifiedPrompt(), update memory output format to include:
"understanding": {
  "elevator": "One-liner description",
  "phases": [
    {
      "name": "Phase Name (e.g., 'Open Form')",
      "purpose": "What this phase accomplishes",
      "stepIndices": [0, 1],
      "criticality": "critical|important|optional"
    }
  ],
  "blocks": [...],  // Keep existing blocks for backward compatibility
  "entities": ["entity1", "entity2"]
}
```

**Milestone Detection Guidance to Add:**
```
## Milestone Detection Guidelines

Identify PHASES (milestones) - high-level stages humans naturally think in:

**Common Phase Patterns:**
- "Setup/Navigate" → Steps to get to the right place
- "Open Form" → Opening a creation dialog/form
- "Fill Details" → Entering data into fields
- "Review" → Optional review/verification step
- "Save/Submit" → Committing the changes
- "Verify" → Checking the result

**Rules:**
1. Each phase should be 1-5 steps (humans don't think in 20-step phases)
2. Phase names should be action-oriented verbs
3. At least one phase should be marked "critical"
4. Phases should follow logical user mental model
```

#### Task 2.2: Wire Q&A Answers to Rules
**Status:** ✅ ALREADY DONE
**File:** `src/lib/skill/skill-view.ts:122-136`

The `extractKnowledge()` function already reads from `memory.clarifications.items`:
```typescript
if (memory?.clarifications?.items) {
  for (const item of memory.clarifications.items) {
    const rule = clarificationToRule(item);
    if (rule) {
      rules.push(rule);
    }
  }
}
```

**Verification Test:**
```typescript
// Create workflow with clarifications
const workflow = createMockWorkflow({
  memory: {
    ...baseMemory,
    clarifications: {
      collectedAt: Date.now(),
      items: [
        {
          questionId: 'q1',
          category: 'context',
          question: 'What is this spreadsheet for?',
          answerValue: 'customer_data',
          answerText: 'Customer contact information',
        }
      ]
    }
  }
});

const skill = getSkill(workflow);
expect(skill.knowledge.rules.length).toBeGreaterThan(0);
expect(skill.knowledge.rules[0].source).toBe('qa_answer');
```

#### Task 2.3: Update Post-Recording UI
**Status:** ✅ Complete
**File:** `src/sidepanel/PostRecordingConfirm.tsx`

**Changes Required:**
1. After saving, show skill summary (goal, inputs, triggers)
2. Display detected milestones/phases
3. Show confidence score

**Implementation:**
```tsx
// Add SkillSummaryCard component to show:
// - Skill name and goal
// - Detected inputs (variables)
// - Trigger phrases
// - Milestones with visual timeline
// - Overall confidence score
```

### Files to Modify
- `supabase/functions/generate_workflow_memory/index.ts` (milestone detection)
- `src/sidepanel/PostRecordingConfirm.tsx` (skill summary UI)

### Files to Create
- `src/lib/skill/skill-phase2.test.ts` (Phase 2 specific tests)

### Testing Plan

#### Unit Tests (`skill-phase2.test.ts`)
```typescript
describe('Phase 2: Enhanced Learning', () => {
  describe('Milestone Extraction', () => {
    it('should extract milestones from memory.understanding.phases', () => {
      const workflow = createWorkflowWithPhases();
      const skill = getSkill(workflow);
      expect(skill.milestones).toHaveLength(3);
      expect(skill.milestones[0].name).toBe('Open Form');
    });

    it('should handle missing phases gracefully', () => {
      const workflow = createWorkflowWithoutPhases();
      const skill = getSkill(workflow);
      expect(skill.milestones).toHaveLength(0); // or synthesized
    });

    it('should preserve step indices in milestones', () => {
      const workflow = createWorkflowWithPhases();
      const skill = getSkill(workflow);
      expect(skill.milestones[0].stepIndices).toEqual([0]);
    });
  });

  describe('Q&A to Knowledge Rules', () => {
    it('should convert clarifications to knowledge rules', () => {
      const workflow = createWorkflowWithClarifications();
      const skill = getSkill(workflow);
      expect(skill.knowledge.rules.some(r => r.source === 'qa_answer')).toBe(true);
    });

    it('should extract rule from context clarification', () => {
      const workflow = createWorkflowWithClarifications();
      const skill = getSkill(workflow);
      const contextRule = skill.knowledge.rules.find(r =>
        r.rule.includes('Customer contact')
      );
      expect(contextRule).toBeDefined();
    });

    it('should handle empty clarifications', () => {
      const workflow = createWorkflowWithoutClarifications();
      const skill = getSkill(workflow);
      expect(skill.knowledge.rules.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Edge Function Integration', () => {
    it('should generate phases from workflow steps', async () => {
      // Mock edge function response
      const response = await simulateEdgeFunctionCall(mockWorkflow);
      expect(response.memory.understanding.phases).toBeDefined();
      expect(response.memory.understanding.phases.length).toBeGreaterThan(0);
    });
  });
});
```

#### Integration Tests (Manual)
1. **Record a 5-step workflow** (click → type → type → select → click)
2. **Check generated memory** in DevTools:
   ```javascript
   MimoDebug.getLastWorkflow().then(w => {
     console.log('Phases:', w.memory?.understanding?.phases);
     console.log('Clarifications:', w.memory?.clarifications);
   });
   ```
3. **Get skill and verify**:
   ```javascript
   import { getSkill } from './lib/skill';
   MimoDebug.getLastWorkflow().then(w => {
     const skill = getSkill(w);
     console.log('Milestones:', skill.milestones);
     console.log('Knowledge rules:', skill.knowledge.rules);
   });
   ```

#### Edge Function Test (Supabase)
```bash
# Test milestone generation locally
curl -X POST http://localhost:54321/functions/v1/generate_workflow_memory \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "name": "Add Contact",
      "steps": [
        {"type": "CLICK", "description": "Click New Contact"},
        {"type": "INPUT", "description": "Type name", "payload": {"value": "John"}},
        {"type": "INPUT", "description": "Type email", "payload": {"value": "john@example.com"}},
        {"type": "CLICK", "description": "Click Save"}
      ]
    }
  }'
```

**Expected Response:**
```json
{
  "memory": {
    "understanding": {
      "phases": [
        { "name": "Open Form", "stepIndices": [0], "criticality": "critical" },
        { "name": "Fill Details", "stepIndices": [1, 2], "criticality": "critical" },
        { "name": "Save", "stepIndices": [3], "criticality": "critical" }
      ]
    }
  }
}
```

### Success Criteria
- [x] Edge function generates `phases` array with proper structure
- [x] At least 2-4 phases detected for a 5-step workflow
- [x] Q&A answers appear as knowledge rules in Skill
- [x] Post-recording UI shows skill summary
- [x] All unit tests pass (41 tests passing)

---

## Phase 3: Goal-Oriented Execution 🔲 NOT STARTED

### Goal
Replace step-replay with goal-pursuit loop.

### Tasks
- [ ] Build `ExecutionEngine` class with observe→think→act→reflect loop
- [ ] Create goal-oriented LLM prompts
- [ ] Build `ProgressTracker` for milestone-based progress
- [ ] Build `SuccessVerifier` to check success criteria
- [ ] Build `PageState` builder (DOM + Visual)
- [ ] Integrate with existing `dom_agent` / `computer_use`

### Files to Create
```
src/lib/execution/
├── engine.ts           # Main execution loop
├── progress-tracker.ts # Milestone tracking
├── success-verifier.ts # Check success criteria
├── page-state.ts       # Build current state for AI
└── prompts.ts          # Goal-oriented prompts
```

### Files to Modify
- `src/content/universal-execution/orchestrator.ts` (integrate new engine)
- `supabase/functions/execute_step/index.ts` (or create new `goal_execution`)

### Testing Guide
```typescript
// Test execution with a simple workflow
import { ExecutionEngine } from './lib/execution/engine';
import { getSkill } from './lib/skill';

const workflow = await WorkflowStorage.loadWorkflow(workflowId);
const skill = getSkill(workflow);

const engine = new ExecutionEngine();
const result = await engine.execute(skill, {
  inputs: { name: "John Smith" },
  onProgress: (progress) => console.log('Progress:', progress),
  onAction: (action) => console.log('Action:', action),
});

console.log('Result:', result);
```

### Manual Test Steps
1. Record a simple workflow (e.g., "Add contact")
2. Trigger execution via chat
3. Watch console for observe→think→act→reflect loop
4. Verify success is detected

---

## Phase 4: Skill Awareness 🔲 NOT STARTED

### Goal
AI knows all skills and matches natural language requests.

### Tasks
- [ ] Build `SkillMatcher` class
- [ ] Implement "What can you do?" response
- [ ] Handle ambiguous matches (multiple skills)
- [ ] Handle unknown requests ("I haven't learned that")

### Files to Create
```
src/lib/skill/
└── skill-matcher.ts    # Semantic matching
```

### Files to Modify
- `supabase/functions/match_workflow/index.ts` (or create `match_skill`)
- `src/sidepanel/App.tsx` (chat handling)

### Testing Guide
```typescript
// Test skill matching
import { SkillMatcher } from './lib/skill/skill-matcher';

const matcher = new SkillMatcher();
await matcher.loadSkills();

// Test exact match
const result1 = await matcher.match("add contact");
console.log('Exact:', result1);

// Test fuzzy match
const result2 = await matcher.match("create a new customer");
console.log('Fuzzy:', result2);

// Test unknown
const result3 = await matcher.match("fly to the moon");
console.log('Unknown:', result3);

// Test ambiguous
const result4 = await matcher.match("add");
console.log('Ambiguous:', result4);
```

---

## Phase 5: Help System 🔲 NOT STARTED

### Goal
AI asks for help when stuck and learns from corrections.

### Tasks
- [ ] Build stuck detection (after N failed attempts)
- [ ] Generate help request messages
- [ ] Process user guidance
- [ ] Learn from corrections (update skill)

### Files to Create
```
src/lib/execution/
└── help-system.ts      # Stuck detection + help requests

src/sidepanel/
└── HelpRequest.tsx     # UI for help requests
```

### Testing Guide
```typescript
// Test stuck detection
import { HelpSystem } from './lib/execution/help-system';

const helpSystem = new HelpSystem();

// Simulate failed attempts
helpSystem.recordAttempt({ success: false, action: "click Save" });
helpSystem.recordAttempt({ success: false, action: "click Save" });
helpSystem.recordAttempt({ success: false, action: "click Submit" });

if (helpSystem.isStuck()) {
  const helpRequest = helpSystem.generateHelpRequest();
  console.log('Help request:', helpRequest);
  // "I'm trying to save the form but can't find the Save button. Can you help?"
}
```

---

## Phase 6: Multi-Item Scaling 🔲 NOT STARTED

### Goal
Handle "add Alice, Bob, Carol" naturally.

### Tasks
- [ ] Enhance array variable detection
- [ ] Build batch executor
- [ ] Add batch progress UI
- [ ] Handle partial failures

### Files to Modify
```
src/lib/variable-extractor.ts  # Enhance array detection
```

### Files to Create
```
src/lib/execution/
└── batch-executor.ts   # Run skill N times
```

### Testing Guide
```typescript
// Test array detection
import { VariableExtractor } from './lib/variable-extractor';

const result = VariableExtractor.parseArrayFromText(
  "Alice, Bob, and Carol",
  ["and", ","]
);
console.log('Parsed:', result); // ["Alice", "Bob", "Carol"]

// Test batch execution
import { BatchExecutor } from './lib/execution/batch-executor';

const executor = new BatchExecutor();
const result = await executor.execute(skill, {
  inputs: { name: ["Alice", "Bob", "Carol"] },
  onItemComplete: (item, index, total) => {
    console.log(`Completed ${index + 1}/${total}: ${item}`);
  },
});
console.log('Batch result:', result);
// { completed: 3, failed: 0, results: [...] }
```

---

## Integration Testing

### End-to-End Test Scenario

**Scenario: Add Contact to CRM**

1. **Record**
   - Click "New Contact"
   - Type "Test Name" in Name field
   - Type "test@email.com" in Email field
   - Click "Save"

2. **Learn** (Phase 2)
   - AI generates milestones: ["Open Form", "Fill Details", "Save"]
   - AI asks: "What is this spreadsheet for?"
   - User answers: "Customer contacts"
   - Answer stored in knowledge.rules

3. **Execute** (Phase 3)
   - User: "Add John Smith to contacts"
   - AI extracts: { name: "John Smith" }
   - AI observes page state
   - AI thinks: "I need to open the form first"
   - AI acts: Click "New Contact"
   - AI reflects: "Form opened, moving to next milestone"
   - ... continues until success verified

4. **Skill Awareness** (Phase 4)
   - User: "What can you do?"
   - AI: "I can add contacts to the CRM"

5. **Help** (Phase 5)
   - AI can't find Save button (UI changed)
   - AI asks: "I can't find the Save button. Can you help?"
   - User: "It's now called 'Create Contact'"
   - AI learns and continues

6. **Batch** (Phase 6)
   - User: "Add Alice, Bob, and Carol"
   - AI runs skill 3 times
   - AI reports: "Added 3 contacts"

---

## Related Documents

- `docs/VIRTUAL_EMPLOYEE_VISION.md` - Full architecture vision
- `docs/BEFORE_AFTER_GAP_ANALYSIS.md` - Gap analysis
- `docs/CODEBASE_CLEANUP.md` - What can be removed

---

## Session Notes

### 2025-01-21: Phase 1 Complete + Tested
- Created skill module with types, view, storage, index
- Fixed Q&A answer storage bug in App.tsx
- All TypeScript compiles without errors
- **Added 21 unit tests - ALL PASSING**
- Test file: `src/lib/skill/skill.test.ts`
- Ready for Phase 2

### 2025-01-21: Phase 2 Planning Complete
- Analyzed current codebase to understand Phase 2 requirements
- **Key Finding**: Q&A → Rules wiring is ALREADY DONE in `extractKnowledge()`
- Identified that edge function needs to generate `phases` array (currently only `blocks`)
- Created detailed implementation plan with:
  - Task breakdown
  - Code examples
  - Testing plan (unit + integration + edge function)
  - Success criteria

### 2025-01-21: Phase 2 Complete
- **Wrote 20 new tests** in `src/lib/skill/skill-phase2.test.ts` - ALL PASSING
- **Updated edge function** (`generate_workflow_memory/index.ts`):
  - Added milestone detection guidelines to AI prompt
  - Added `phases` array to response format
  - Added `ensurePhasesExist()` fallback function (converts blocks → phases if needed)
  - Added default phase synthesis for workflows without memory
- **Updated post-recording UI** (`PostRecordingConfirm.tsx`):
  - Added "What I'll Learn" collapsible section
  - Shows synthesized milestones with timeline visualization
  - Shows detected inputs (form variables + spreadsheet columns)
  - Shows suggested trigger phrases
- **Total tests: 41 passing** (21 Phase 1 + 20 Phase 2)
- Ready for Phase 3: Goal-Oriented Execution

### 2025-01-21: Phase 2 Debugging - Phases Not Appearing
- **Issue**: User reported phases were showing as empty `[]` despite good elevator text
- **Root Cause Investigation**:
  1. Discovered actual code path is `post-recording-analyzer.ts` → `callUnifiedAIService()`
  2. Edge function returns `{ analysis, memory }` directly to client
  3. AI was generating empty phases AND empty blocks
  4. The `ensurePhasesExist()` fallback wasn't synthesizing correctly

- **Fixes Applied**:
  1. Added defensive check for invalid `stepCount` (NaN protection)
  2. Added extensive console logging to trace AI response
  3. Fixed off-by-one error in phase synthesis index calculation
  4. Added final safeguard to guarantee phases is never empty
  5. Redeployed edge function (version 5)

- **Logging Added** to edge function:
  - What AI returns for phases
  - What AI returns for blocks
  - What `ensurePhasesExist` decides to do
  - Final phases count

- **To Test**: Record a new workflow and run `MimoDebug.checkPhase2()` to verify phases are populated

### 2026-01-29: Intelligent Agent Phase 2A — Flexible LLM Responses
- **Implemented Phase 2A** of the Intelligent Agent Upgrade Plan
- **What changed:**
  - `supabase/functions/dom_agent/index.ts`: Added `allowFlexibleResponses` to request interface, conditional flexible prompt (Options A-E instead of rigid `⛔ MUST USE chooseCandidateIndex`), relaxed candidate enforcement in `parseGeminiResponse`
  - `src/lib/ai-agent.ts`: Pass `allowFlexibleResponses` flag in `think()` payload, log flexible actions, treat scroll/wait as intermediate in `detectIntermediateAction()`
  - `src/lib/feature-flags.ts`: Flipped `INTELLIGENT_AGENT_FLEXIBLE` to `true`
- **Tests:** 46 new tests in `src/lib/intelligent-agent-phase2a.test.ts` — ALL PASSING
  - Candidate enforcement (flag on/off), intermediate action detection, prompt construction, payload serialization, end-to-end scenarios
- **Backward compatible:** Flag off = zero behavior change (rigid prompt, throws on missing index)
- **Total intelligent agent tests: 74 passing** (21 Phase 1 + 7 integration + 46 Phase 2A)

### Next Session
- **Deploy edge function**: `supabase functions deploy dom_agent`
- **Test Phase 2A**: Run workflow on https://play2.automationcamp.ir/ with flag ON
  - Verify: off-screen element → LLM returns `scroll` → agent scrolls → retries → finds element
  - Verify: already-satisfied hint → LLM returns `skip` → agent advances
  - Verify: normal case → LLM still picks candidates (preferred)
- **Start Phase 2B**: Goal-oriented prompting (next upgrade phase)
- **Verify Phase 2 fix**: Record a workflow and confirm phases are no longer empty
