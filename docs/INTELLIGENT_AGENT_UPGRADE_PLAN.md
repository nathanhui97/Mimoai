# Intelligent AI Agent Upgrade Plan

## Executive Summary

Our current execution engine is a **"hint-guided workflow repeater"** rather than a true **intelligent AI agent**. This document outlines the gaps and a phased plan to upgrade the system.

**Key Problems:**
1. **LLM doesn't know what was already tried** (fast-path context missing)
2. **LLM is constrained to pick candidates** instead of reasoning about goals

**Expected Outcome:** An agent that can adapt, recover, and achieve goals even when the recorded workflow doesn't match the current page state.

---

## Current Architecture Analysis

### Execution Flow Today

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CURRENT EXECUTION FLOW                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. FAST-PATH (70-80% of steps)                                     │
│     ├── Try recorded selectors                                      │
│     ├── Confidence >= 70%? → Execute directly, SKIP LLM             │
│     └── Confidence < 70%? → Fall through to LLM                     │
│                                                                     │
│  2. LLM CALL (20-30% of steps)                                      │
│     ├── Receives: DOM map, candidates, hints, history               │
│     ├── Prompt says: "MUST choose from candidates 0-7"              │
│     └── Returns: chooseCandidateIndex (rigid selection)             │
│                                                                     │
│  3. RECOVERY (on failure)                                           │
│     ├── Retry same step up to 3 times                               │
│     └── Ask human for help                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### What the LLM Currently Receives

| Data | Sent to LLM? | Quality |
|------|--------------|---------|
| Goal (workflow name) | ✅ Yes | Basic string |
| Analyzed Intent | ✅ Yes | Good (primaryGoal, expectedOutcome) |
| DOM Map | ✅ Yes | Excellent (shadow DOM, widgets) |
| Candidates | ✅ Yes | Pre-filtered list |
| History | ✅ Partial | Last 5 actions only |
| Hints | ✅ Yes | Step-by-step instructions |
| **Fast-path attempts** | ❌ NO | **MISSING** |
| **Strategies tried** | ❌ NO | **MISSING** |
| **Scroll attempts** | ❌ NO | **MISSING** |
| **Why LLM was called** | ❌ NO | **MISSING** |

### What the LLM is Asked to Do

**Current prompt constraint:**
```
🚨 CRITICAL INSTRUCTION 🚨
You MUST respond with "chooseCandidateIndex" selecting one of the candidates above (0-7).
DO NOT invent a new target. DO NOT return a target with role/name/text.
ONLY return chooseCandidateIndex.
```

**Problem:** LLM cannot suggest alternatives, cannot say "I need to scroll", cannot skip a bad hint.

---

## Problem 1: Missing Fast-Path Context

### The Gap

When fast-path fails and falls through to LLM, the LLM doesn't know:
- That fast-path was attempted
- What confidence level was achieved
- Which selectors/strategies were tried
- Whether scrolling was attempted
- Why the system decided to call the LLM

### Impact

1. **Duplicate work** - LLM might suggest strategies already tried
2. **No learning** - LLM can't build on previous attempts
3. **Inefficient recovery** - LLM starts from scratch every time

### Proposed Solution

Add `executionContext` to the LLM payload:

```typescript
interface ExecutionContext {
  // Fast-path attempt details
  fastPathAttempted: boolean;
  fastPathConfidence?: number;  // 0-100
  fastPathReason?: 'NO_SELECTORS' | 'LOW_CONFIDENCE' | 'AMBIGUOUS' | 'NOT_FOUND';
  
  // What was tried
  strategiesTried: string[];  // ['recorded_selector', 'scope_filter', 'text_match']
  scrollAttempted: boolean;
  scrollDirection?: 'up' | 'down';
  scrollAttempts?: number;
  
  // Why LLM is being called
  callReason: 'DISAMBIGUATION' | 'NOT_FOUND' | 'RECOVERY' | 'LOW_CONFIDENCE';
  
  // Current step context
  currentStepFailures: number;  // How many times this step has failed
  previousStepAction?: string;  // What the last successful action was
}
```

### Implementation Location

**File:** `src/lib/ai-agent.ts`
**Method:** `think()` - before calling dom_agent

**File:** `supabase/functions/dom_agent/index.ts`  
**Method:** `buildAgentPrompt()` - add context section

---

## Problem 2: Constrained Reasoning (Not Goal-Oriented)

### The Gap

The LLM is given goal/intent information but then **forced** to pick from candidates. It cannot:
- Suggest scrolling when element isn't visible
- Skip a hint that's already satisfied
- Propose an alternative approach
- Say "this hint seems wrong"
- Reason about whether the goal is already achieved

### Current vs Desired Behavior

| Scenario | Current Behavior | Desired Behavior |
|----------|------------------|------------------|
| Element not in candidates | Fail or pick wrong one | Suggest scroll/wait |
| Hint already satisfied | Execute anyway | Skip with reason |
| Ambiguous candidates | Pick first one | Ask for disambiguation or use context |
| Goal already achieved | Keep executing hints | Return done early |
| Wrong hint recorded | Fail repeatedly | Suggest alternative |

### Proposed Solution

#### Phase 2A: Flexible Response Schema

Allow LLM to return different response types:

```typescript
type AgentResponse = 
  | { type: 'SELECT_CANDIDATE'; candidateIndex: number; reasoning: string }
  | { type: 'SUGGEST_ACTION'; action: 'scroll' | 'wait' | 'dismiss_popup'; params: any; reasoning: string }
  | { type: 'SKIP_HINT'; reason: string; goalStillAchievable: boolean }
  | { type: 'GOAL_ACHIEVED'; evidence: string }
  | { type: 'NEED_HELP'; question: string; options?: string[] }
  | { type: 'ALTERNATIVE_TARGET'; target: SemanticTarget; reasoning: string };
```

#### Phase 2B: Goal-Oriented Prompting

Change the prompt from:
```
"You MUST choose from candidates"
```

To:
```
"Your goal is: ${goal}
 
The recorded hints suggest: ${hints}
Available candidates: ${candidates}

Decide the BEST action to achieve the goal:

1. If a candidate clearly matches → SELECT_CANDIDATE
2. If element might be off-screen → SUGGEST_ACTION: scroll
3. If hint outcome already satisfied → SKIP_HINT
4. If all hints done and goal achieved → GOAL_ACHIEVED
5. If genuinely stuck → NEED_HELP
6. If you see a better target → ALTERNATIVE_TARGET

Always explain your reasoning. The hints are GUIDANCE, not strict orders."
```

#### Phase 2C: Goal Verification Loop

After each action, check:
1. Is the goal already achieved? (check expectedOutcome)
2. Is the current hint's expectedOutcome satisfied?
3. Should we skip remaining hints?

```typescript
async function checkGoalProgress(): Promise<{
  goalAchieved: boolean;
  currentHintSatisfied: boolean;
  canSkipToEnd: boolean;
  evidence: string;
}> {
  // Compare page state against analyzedIntent.expectedOutcome
  // Compare page state against currentHint.naturalLanguage.expectedOutcome
}
```

---

## Implementation Plan

### Phase 1: Fast-Path Context (Low Risk, High Value)
**Effort:** 1-2 days
**Risk:** Low (additive change, doesn't break existing flow)

| Task | File | Description |
|------|------|-------------|
| 1.1 | `ai-agent.ts` | Capture fast-path attempt details |
| 1.2 | `ai-agent.ts` | Build `executionContext` object |
| 1.3 | `ai-agent.ts` | Pass context to `think()` payload |
| 1.4 | `dom_agent/index.ts` | Add context section to prompt |
| 1.5 | `dom_agent/index.ts` | Update prompt to use context |

**Success Criteria:**
- LLM logs show "Fast-path tried: YES, confidence: 45%, reason: AMBIGUOUS"
- LLM responses reference what was already tried

### Phase 2A: Flexible Responses (Medium Risk)
**Effort:** 2-3 days
**Risk:** Medium (changes response parsing, needs testing)

| Task | File | Description |
|------|------|-------------|
| 2A.1 | `dom_agent/index.ts` | Define new response schema |
| 2A.2 | `dom_agent/index.ts` | Update prompt to allow flexible responses |
| 2A.3 | `ai-agent.ts` | Parse new response types |
| 2A.4 | `ai-agent.ts` | Handle SUGGEST_ACTION responses |
| 2A.5 | `ai-agent.ts` | Handle SKIP_HINT responses |

**Success Criteria:**
- LLM can return "scroll down" when element not found
- LLM can skip hints that are already satisfied

### Phase 2B: Goal-Oriented Prompting (Medium Risk)
**Effort:** 2-3 days
**Risk:** Medium (prompt changes can affect behavior)

| Task | File | Description |
|------|------|-------------|
| 2B.1 | `dom_agent/index.ts` | Rewrite prompt for goal-oriented reasoning |
| 2B.2 | `dom_agent/index.ts` | Remove "MUST choose" constraint |
| 2B.3 | `dom_agent/index.ts` | Add goal-first decision framework |
| 2B.4 | Test | Validate with existing workflows |

**Success Criteria:**
- LLM explains decisions in terms of goal achievement
- LLM can deviate from hints when appropriate

### Phase 2C: Goal Verification (Lower Priority)
**Effort:** 3-4 days
**Risk:** Medium-High (new verification logic)

| Task | File | Description |
|------|------|-------------|
| 2C.1 | `ai-agent.ts` | Add `checkGoalProgress()` function |
| 2C.2 | `ai-agent.ts` | Call after each action |
| 2C.3 | `ai-agent.ts` | Enable early completion |
| 2C.4 | `success-verifier.ts` | Enhance outcome checking |

**Success Criteria:**
- Agent can finish early when goal is achieved
- Agent doesn't execute unnecessary steps

---

## Risk Mitigation

### Feature Flags

Add flags to enable/disable new behaviors:

```typescript
// feature-flags.ts
INTELLIGENT_AGENT_CONTEXT: true,    // Phase 1 - fast-path context ✅ SHIPPED
INTELLIGENT_AGENT_FLEXIBLE: true,   // Phase 2A - flexible responses ✅ SHIPPED
INTELLIGENT_AGENT_GOAL: true,       // Phase 2B - goal-oriented prompting ✅ SHIPPED
INTELLIGENT_AGENT_VERIFY: true,     // Phase 2C - goal verification ✅ SHIPPED
INTELLIGENT_AGENT_STEP_VERIFY: false, // Phase 3 - step outcome verification ✅ SHIPPED (off by default)
```

### Rollback Plan

1. Each phase is independent
2. Feature flags allow instant disable
3. Existing `chooseCandidateIndex` flow preserved as fallback

### Testing Strategy

1. **Unit tests:** Parse new response types
2. **Integration tests:** Run existing workflow recordings
3. **A/B testing:** Compare success rates with flags on/off

---

## Expected Outcomes

### After Phase 1 (Context)
- LLM makes better decisions with full context
- Fewer duplicate strategy attempts
- Better debugging/logging

### After Phase 2A (Flexible Responses)
- LLM can suggest scroll/wait when needed
- Fewer "stuck" situations
- Reduced human intervention

### After Phase 2B (Goal-Oriented)
- Agent adapts when UI changes
- Hints become guidance, not strict rules
- Higher success rate on varied pages

### After Phase 2C (Goal Verification)
- Agent finishes faster (no unnecessary steps)
- Better success detection
- Cleaner execution logs

---

## Metrics to Track

| Metric | Current | Target (Phase 1) | Target (Full) |
|--------|---------|------------------|---------------|
| LLM calls per workflow | ~3-5 | Same | ~2-3 |
| Average step time | ~200ms | Same | Same |
| Human intervention rate | ~15% | ~12% | ~5% |
| Workflow success rate | ~80% | ~85% | ~95% |
| "Stuck" occurrences | ~10% | ~8% | ~3% |

---

## Appendix: Code Locations

### Files to Modify

| File | Purpose | Phase |
|------|---------|-------|
| `src/lib/ai-agent.ts` | Main agent loop, `think()` method | 1, 2A, 2B, 2C |
| `src/lib/feature-flags.ts` | Feature toggles | 1 |
| `supabase/functions/dom_agent/index.ts` | LLM prompt and response parsing | 1, 2A, 2B |
| `src/lib/success-verifier.ts` | Goal verification | 2C |

### Key Methods

| Method | File | Current Purpose | Changes Needed |
|--------|------|-----------------|----------------|
| `tryFastPathExecute()` | ai-agent.ts | Fast DOM resolution | Capture attempt details |
| `think()` | ai-agent.ts | Call LLM for decision | Pass context, parse responses |
| `buildAgentPrompt()` | dom_agent | Build LLM prompt | Add context, relax constraints |
| `parseGeminiResponse()` | dom_agent | Parse LLM response | Handle new response types |

---

## Next Steps

1. ~~**Start Phase 1** (low risk, high value)~~ ✅ DONE
2. ~~**Phase 2A: Flexible Responses**~~ ✅ DONE
3. ~~**Phase 2B: Goal-Oriented Prompting**~~ ✅ DONE
4. ~~**Phase 2C: Goal Verification**~~ ✅ DONE
5. **Deploy edge function** (`supabase functions deploy dom_agent`) for Phase 2A
6. **Test Phase 2A** on https://play2.automationcamp.ir/ with flag ON

---

## Implementation Log

### 2026-01-26: Phase 1 Complete
- Added `ExecutionContext` to `ai-agent.ts` and `dom_agent/index.ts`
- LLM now receives fast-path attempt details (confidence, strategies tried, scroll attempts)
- Feature flag: `INTELLIGENT_AGENT_CONTEXT: true`
- 28 unit tests passing

### 2026-01-29: Phase 2A Complete
- **Relaxed candidate enforcement** in `parseGeminiResponse` — LLM can now return `scroll`, `wait`, `skip`, `done` even when candidates exist (when `allowFlexibleResponses=true`)
- **Flexible prompt** replaces rigid `⛔ MUST USE chooseCandidateIndex` with 5 options (A-E) when flag enabled
- **Intermediate action detection** — scroll/wait treated as intermediate so hint stays active and DOM is re-observed
- **Backward compatible** — flag off = zero behavior change
- Feature flag: `INTELLIGENT_AGENT_FLEXIBLE: true`
- 46 new Phase 2A unit tests passing (74 total intelligent agent tests)
- Files changed: `dom_agent/index.ts`, `ai-agent.ts`, `feature-flags.ts`
- **TODO**: Deploy edge function, then test with real workflows

### 2026-01-29: Phase 2B Complete
- **Goal-oriented system framing** — LLM is told it's a "GOAL-ORIENTED AI agent" with a 4-step decision framework (Goal First → Page State → Hints as Guidance → Adapt)
- **Steps header** changes from "Steps to Complete" → "Recorded Steps (GUIDANCE — not strict orders)"
- **Current focus** changes from "⭐ WORK ON THIS NEXT" → "🎯 SUGGESTED NEXT STEP" with GOAL-ORIENTED REASONING block (Goal Check, Outcome Check, Better Path)
- **Candidates section** — extracted `buildCandidatesInstruction()` helper; goal-oriented mode uses "THINK STEP BY STEP" framework without bias toward picking candidates, requires goal-framed reasoning
- **Your Task section** — adds reasoning protocol (Sub-goal → Achievement Check → Best Action → Why); priority item 4 changes from "ADAPTIVE" to "GOAL-ORIENTED" with early done support
- **Backward compatible** — flag off = zero behavior change; goal-oriented candidates require BOTH `goalOriented=true` AND `allowFlexibleResponses=true`
- Feature flag: `INTELLIGENT_AGENT_GOAL: true` (enabled)
- 40+ new Phase 2B unit tests passing
- Files changed: `dom_agent/index.ts`, `ai-agent.ts`

### 2026-01-30: Phase 2B Deployed & Enabled
- Edge function deployed (`supabase functions deploy dom_agent`)
- Feature flag `INTELLIGENT_AGENT_GOAL` set to `true`
- **Tested on** `https://play2.automationcamp.ir/` — 13-step form workflow ran successfully (steps 0-9 before pause)
- **NOTE: LLM path not yet exercised.** All steps resolved via fast-path (80-95% confidence), so the goal-oriented prompting was never triggered during this test. The test only confirmed no regressions on the fast-path.
- **DEBUGGING NOTE:** If a future workflow fails or behaves unexpectedly when the LLM is called (low-confidence steps, ambiguous candidates, skip/done decisions), Phase 2B goal-oriented prompting is a possible factor. To isolate, set `INTELLIGENT_AGENT_GOAL: false` in `feature-flags.ts` and re-test. The LLM reasoning should include `"Goal: <sub-goal>."` prefixes when 2B is active — check edge function logs for this.

### 2026-01-29: Phase 2C Complete
- **`checkGoalProgress()`** — synchronous DOM/URL check reusing `verifyWorkflowOutcome()` logic with a 30% minimum-progress threshold and confidence score (0.85–0.9)
- **`skipRemainingHints()`** — marks all incomplete hints as `skipped` when goal is achieved early
- **`checkAndHandleEarlyCompletion()`** — shared helper called at 3 execution-loop insertion points (fast-path, vision dropdown, LLM-driven completion); returns `true` when confidence ≥ 0.8
- **No extra LLM calls** — pure `document.body.innerText` + `window.location.href` checks
- **Backward compatible** — flag off = zero behavior change
- Feature flag: `INTELLIGENT_AGENT_VERIFY: true` (enabled)
- 30+ new Phase 2C unit tests
- Files changed: `ai-agent.ts`, `feature-flags.ts`

### 2026-01-29: Phase 3 Complete — Smart Step Outcome Verification
- **`verifyStepOutcome()`** — synchronous single-pass verification of each step's outcome against `successCriteria` (structured) or `expectedOutcome` (text fallback)
- **`checkStructuredCriteria()`** — handles all 10 criteria types (`modal_appears`, `text_appears`, `text_disappears`, `url_changes`, `element_appears`, `element_disappears`, `input_cleared`, `toast_appears`, `count_changes`, `dom_stabilizes`) with confidence scores 0.5–0.95
- **`checkExpectedOutcomeText()`** — keyword-to-ChangeType fallback mapping (dropdown opens → `dropdown_opened`, modal → `modal_appeared`, navigat → `url_changed`, success/saved → `success_appeared`/`toast_appeared`, error → `error_appeared`)
- **`handleStepVerificationResult()`** — retry logic: only retries on first `unverified` with confidence < 0.5; all other outcomes continue
- **Hooked into 3 execution points**: fast-path completion (with retry support), vision dropdown completion (log only), LLM-driven completion (with retry support)
- **Uses `capturePageState()` from `success-verifier.ts`** — provides `visibleText` and `toastMessages` needed for text/toast checks (~15ms per capture)
- **No extra LLM calls** — pure DOM/URL checks
- **Backward compatible** — flag off = zero behavior change
- Feature flag: `INTELLIGENT_AGENT_STEP_VERIFY: false` (disabled by default)
- 30 new Phase 3 unit tests passing
- Files changed: `ai-agent.ts`, `feature-flags.ts`
- New file: `intelligent-agent-phase3.test.ts`

---

*Document created: 2026-01-26*
*Author: AI Analysis of Execution Engine*
*Status: Phase 1 ✅ | Phase 2A ✅ | Phase 2B ✅ (deployed, LLM path untested) | Phase 2C ✅ | Phase 3 ✅*
