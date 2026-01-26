# Intelligent Agent Architecture Diagrams

## Current State: "Hint-Guided Workflow Repeater"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Workflow Recording                    Execution                           │
│   ══════════════════                    ═════════                           │
│                                                                             │
│   ┌──────────────┐                      ┌──────────────────────────┐        │
│   │ Step 1: Click│                      │ For each hint:           │        │
│   │ Step 2: Type │  ──────────────────▶ │   1. Try fast-path       │        │
│   │ Step 3: Click│     (Hints)          │   2. If fail → call LLM  │        │
│   │ Step 4: Save │                      │   3. LLM picks candidate │        │
│   └──────────────┘                      │   4. Execute             │        │
│                                         │   5. Repeat              │        │
│                                         └──────────────────────────┘        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │                    LLM CONSTRAINTS                           │           │
│   │                                                              │           │
│   │   Prompt: "You MUST choose from candidates 0-7"              │           │
│   │           "DO NOT invent a new target"                       │           │
│   │           "ONLY return chooseCandidateIndex"                 │           │
│   │                                                              │           │
│   │   Result: LLM is a SELECTOR, not a THINKER                   │           │
│   └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
│   Problems:                                                                 │
│   ─────────                                                                 │
│   ❌ LLM doesn't know what fast-path tried                                  │
│   ❌ LLM can't suggest scroll/wait/skip                                     │
│   ❌ LLM follows hints rigidly, not goal                                    │
│   ❌ When stuck → ask human (no creative recovery)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Target State: "Intelligent Goal-Seeking Agent"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TARGET ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Workflow Recording                    Execution                           │
│   ══════════════════                    ═════════                           │
│                                                                             │
│   ┌──────────────┐                                                          │
│   │ Step 1: Click│                      ┌──────────────────────────┐        │
│   │ Step 2: Type │  ─────┐              │       AI AGENT           │        │
│   │ Step 3: Click│       │              │                          │        │
│   │ Step 4: Save │       │              │  Goal: "Create account"  │        │
│   └──────────────┘       │              │                          │        │
│         │                │              │  ┌────────────────────┐  │        │
│         │                │              │  │ OBSERVE            │  │        │
│         ▼                │              │  │ - Page state       │  │        │
│   ┌──────────────┐       │              │  │ - What was tried   │  │        │
│   │    GOAL      │───────┴─────────────▶│  │ - Goal progress    │  │        │
│   │   INTENT     │     (Guidance)       │  └─────────┬──────────┘  │        │
│   │  EXPECTED    │                      │            │             │        │
│   │   OUTCOME    │                      │            ▼             │        │
│   └──────────────┘                      │  ┌────────────────────┐  │        │
│                                         │  │ REASON             │  │        │
│                                         │  │ - What's best      │  │        │
│                                         │  │   action to        │  │        │
│                                         │  │   achieve GOAL?    │  │        │
│                                         │  │ - Hints = guidance │  │        │
│                                         │  │   not commands     │  │        │
│                                         │  └─────────┬──────────┘  │        │
│                                         │            │             │        │
│                                         │            ▼             │        │
│                                         │  ┌────────────────────┐  │        │
│                                         │  │ DECIDE             │  │        │
│                                         │  │ - Click candidate  │  │        │
│                                         │  │ - OR scroll        │  │        │
│                                         │  │ - OR skip hint     │  │        │
│                                         │  │ - OR try alternate │  │        │
│                                         │  │ - OR goal done!    │  │        │
│                                         │  └─────────┬──────────┘  │        │
│                                         │            │             │        │
│                                         │            ▼             │        │
│                                         │  ┌────────────────────┐  │        │
│                                         │  │ ACT & VERIFY       │  │        │
│                                         │  │ - Execute action   │  │        │
│                                         │  │ - Check goal       │  │        │
│                                         │  │   progress         │  │        │
│                                         │  └────────────────────┘  │        │
│                                         │                          │        │
│                                         └──────────────────────────┘        │
│                                                                             │
│   Improvements:                                                             │
│   ─────────────                                                             │
│   ✅ LLM knows full context (what was tried, why called)                    │
│   ✅ LLM can suggest scroll/wait/skip/alternative                           │
│   ✅ LLM reasons about GOAL, uses hints as guidance                         │
│   ✅ LLM can finish early when goal achieved                                │
│   ✅ Creative recovery before asking human                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Information Flow: Before vs After

### BEFORE (Current)

```
Fast-Path ──(fail)──▶ LLM
                      │
                      │  Receives:
                      │  ├── candidates
                      │  ├── hints (rigid steps)
                      │  ├── history (last 5 only)
                      │  └── DOM map
                      │
                      │  MISSING:
                      │  ├── ❌ what fast-path tried
                      │  ├── ❌ why LLM was called
                      │  ├── ❌ scroll attempts
                      │  └── ❌ confidence levels
                      │
                      ▼
              "Pick candidate 0-7"
                      │
                      ▼
              Execute (rigid)
```

### AFTER (Target)

```
Fast-Path ──(fail)──▶ Build Context
                      │
                      │  Captures:
                      │  ├── strategies tried
                      │  ├── confidence level
                      │  ├── why calling LLM
                      │  └── scroll attempts
                      │
                      ▼
                     LLM
                      │
                      │  Receives:
                      │  ├── candidates
                      │  ├── goal + intent
                      │  ├── hints (as GUIDANCE)
                      │  ├── full history
                      │  └── execution context ← NEW!
                      │
                      ▼
              "How to achieve goal?"
                      │
                      ├──▶ Click candidate
                      ├──▶ Scroll to find
                      ├──▶ Skip satisfied hint
                      ├──▶ Try alternative
                      └──▶ Goal already done!
```

## Phase Implementation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION PHASES                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PHASE 1: Fast-Path Context                                                │
│   ═══════════════════════════                                               │
│   Risk: LOW    Effort: 1-2 days    Value: HIGH                              │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │  • Capture fast-path attempt details                            │       │
│   │  • Pass execution context to LLM                                │       │
│   │  • Update prompt to show what was tried                         │       │
│   └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│   PHASE 2A: Flexible Responses                                              │
│   ════════════════════════════                                              │
│   Risk: MEDIUM    Effort: 2-3 days    Value: HIGH                           │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │  • Allow LLM to return: scroll, wait, skip, alternative         │       │
│   │  • Parse new response types                                     │       │
│   │  • Handle each response type in agent                           │       │
│   └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│   PHASE 2B: Goal-Oriented Prompting                                         │
│   ═════════════════════════════════                                         │
│   Risk: MEDIUM    Effort: 2-3 days    Value: HIGH                           │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │  • Rewrite prompt: "achieve goal" not "pick candidate"          │       │
│   │  • Remove "MUST choose" constraint                              │       │
│   │  • Add goal-first decision framework                            │       │
│   └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│   PHASE 2C: Goal Verification (Optional)                                    │
│   ══════════════════════════════════════                                    │
│   Risk: MEDIUM-HIGH    Effort: 3-4 days    Value: MEDIUM                    │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │  • Check goal progress after each action                        │       │
│   │  • Enable early completion                                      │       │
│   │  • Skip unnecessary remaining steps                             │       │
│   └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Success Metrics

```
                    CURRENT         PHASE 1         FULL IMPL
                    ───────         ───────         ─────────
Success Rate:         80%      →      85%      →      95%

Human Help Rate:      15%      →      12%      →       5%

"Stuck" Rate:         10%      →       8%      →       3%

LLM Calls/Workflow:   3-5      →       3-5     →       2-3

Avg Step Time:       200ms     →      200ms    →      200ms
```

---

*For full implementation details, see: INTELLIGENT_AGENT_UPGRADE_PLAN.md*
