# Mimo AI Agent - Hybrid Execution Architecture

> **A virtual employee that lives in your browser. You teach it with DOM-rich recording, it executes with AI vision + DOM reliability.**

---

## Core Philosophy

### The Hybrid Approach

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MIMO AI AGENT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐         ┌─────────────────────────────────────┐   │
│  │    RECORDING        │         │           EXECUTION                  │   │
│  │   (DOM-Rich)        │         │    (Vision AI + DOM Reliability)     │   │
│  ├─────────────────────┤         ├─────────────────────────────────────┤   │
│  │                     │         │                                      │   │
│  │ • Full DOM access   │   →→→   │ OBSERVE: Screenshot + DOM state      │   │
│  │ • Selectors         │         │ THINK:   Vision AI decides action    │   │
│  │ • Element context   │         │ ACT:     DOM execution (reliable!)   │   │
│  │ • Page model        │         │ VERIFY:  Screenshot confirms result  │   │
│  │ • Spreadsheet ctx   │         │                                      │   │
│  │                     │         │ Execution strategies:                │   │
│  │ OUTPUT:             │         │ 1. Selector-based (fast)             │   │
│  │ • WorkflowMemory    │   →→→   │ 2. Coordinate-to-DOM (vision backup) │   │
│  │ • WorkflowAnalysis  │         │ 3. Vision re-identify (last resort)  │   │
│  │ • AI-generated      │         │                                      │   │
│  │   phases/blocks     │         │ Uses: OTAR loop + Tier1Executor      │   │
│  │ • Step guidance     │         │                                      │   │
│  │ • Success criteria  │         │                                      │   │
│  └─────────────────────┘         └─────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Insight: Separate THINKING from DOING

**Vision AI is great for:**
- Understanding what's on screen
- Deciding what action to take next
- Finding elements when selectors fail
- Verifying if actions succeeded

**DOM execution is great for:**
- Actually clicking elements (reliable!)
- Typing into fields (reliable!)
- Works without window focus
- No coordinate calibration issues

**The Hybrid combines both:**
```
┌─────────────────────────────────────────────────────────────────┐
│  OBSERVE                                                        │
│  ├── Screenshot (Vision AI sees the page)                       │
│  └── DOM state (element tree, form values)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  THINK (Vision AI decides)                                      │
│  "Based on what I see and the user's goal, I should click the   │
│   'Add Contact' button in the top navigation"                   │
│                                                                 │
│  Output: { action: 'click', target: 'Add Contact button',       │
│            coordinates: {x: 450, y: 120} (backup) }             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ACT (DOM executes - with fallback chain)                       │
│                                                                 │
│  Strategy 1: Find by semantic target                            │
│    → Tier1Executor finds "Add Contact button" in DOM → click()  │
│    → ✅ Success? Done!                                          │
│                                                                 │
│  Strategy 2: Coordinate-to-DOM bridge                           │
│    → elementFromPoint(450, 120) → click()                       │
│    → ✅ Success? Done!                                          │
│                                                                 │
│  Strategy 3: Vision re-identify                                 │
│    → Ask Vision AI to find element again with more context      │
│    → Get new coordinates → elementFromPoint → click()           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  VERIFY (Screenshot comparison)                                 │
│  "Contact form is now open - action succeeded"                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Why Not CDP (Chrome DevTools Protocol)?

We tried pure CDP-based execution (mouse/keyboard events). **It doesn't work reliably:**

| Issue | Impact |
|-------|--------|
| Requires browser window focus | Fails when user switches tabs |
| Coordinate calibration | Device pixel ratio, scroll offset issues |
| Platform-specific | Different behavior on Windows/Mac/Linux |
| Silent failures | Events sent but nothing happens |

**DOM execution is battle-tested and reliable.**

---

## Execution Tiers

### Tier 1: DOM Executor (Primary)
**File:** `src/lib/tier1-executor.ts`

Fast, deterministic, reliable. Uses selectors and accessibility APIs.

```typescript
class Tier1Executor {
  execute(action: AgentAction): Tier1ExecutionResult {
    // 1. Resolve target in DOM (selector, text, role)
    // 2. Check interactability
    // 3. Check safety (don't click delete!)
    // 4. Execute: element.click(), input.value = x
    // 5. Verify outcome
  }
}
```

### Tier 2: Coordinate-to-DOM Bridge (NEW)
**File:** `src/lib/coordinate-executor.ts` (to be created)

When Vision AI gives coordinates but selector fails:

```typescript
async function executeAtCoordinates(
  action: 'click' | 'type',
  x: number,
  y: number,
  value?: string
): Promise<{ success: boolean; element?: Element }> {
  // Find element at coordinates
  const element = document.elementFromPoint(x, y);
  if (!element) return { success: false };

  // Scroll into view if needed
  element.scrollIntoView({ block: 'center' });

  if (action === 'click') {
    // Verify it's clickable
    if (isClickable(element)) {
      (element as HTMLElement).click();
      return { success: true, element };
    }
  }

  if (action === 'type' && value) {
    // Focus and type
    const input = element as HTMLInputElement;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, element };
  }

  return { success: false };
}
```

### Tier 3: Vision Re-identify (Fallback)
**File:** `src/lib/tier3-vision-assist.ts`

When both selector and coordinates fail, ask Vision AI to look again:

```typescript
async function visionReidentify(
  screenshot: string,
  targetDescription: string,
  context: string
): Promise<{ x: number; y: number; confidence: number }> {
  // Call vision_analyze edge function
  // "Find the 'Add Contact' button, it should be in the top nav"
  // Returns coordinates to try with Tier 2
}
```

---

## Unified Action Executor

**File:** `src/lib/unified-executor.ts` (to be created)

```typescript
export async function executeAction(
  action: AgentAction,
  context: ExecutionContext
): Promise<ExecutionResult> {

  // Strategy 1: DOM-based (fast, reliable)
  if (action.target?.selector || action.target?.text || action.target?.role) {
    const result = await Tier1Executor.execute(action);
    if (result.status === 'success') {
      return { success: true, method: 'dom' };
    }
    // Continue to next strategy on rejection
  }

  // Strategy 2: Coordinate-to-DOM (vision backup)
  if (action.coordinates) {
    const result = await executeAtCoordinates(
      action.type,
      action.coordinates.x,
      action.coordinates.y,
      action.value
    );
    if (result.success) {
      return { success: true, method: 'coordinate-dom', element: result.element };
    }
  }

  // Strategy 3: Vision re-identify (last resort)
  if (action.target?.description) {
    const screenshot = await captureScreenshot();
    const location = await visionReidentify(
      screenshot,
      action.target.description,
      context.pageDescription
    );

    if (location.confidence > 0.7) {
      const result = await executeAtCoordinates(
        action.type,
        location.x,
        location.y,
        action.value
      );
      if (result.success) {
        return { success: true, method: 'vision-reidentify' };
      }
    }
  }

  return { success: false, error: 'All strategies failed' };
}
```

---

## OTAR Execution Loop

**File:** `src/lib/execution/engine.ts`

The Goal-Oriented execution engine uses the OTAR loop:

```typescript
class ExecutionEngine {
  async execute(skill: Skill, inputs: Record<string, string>): Promise<ExecutionResult> {
    while (!done && cycles < maxCycles) {
      // OBSERVE
      const screenshot = await captureScreenshot();
      const pageState = await PageStateBuilder.capture();

      // THINK (Vision AI decides)
      const decision = await this.think(screenshot, pageState, executionContext);

      // ACT (DOM executes with fallback chain)
      const result = await executeAction(decision.action, {
        pageDescription: pageState.description,
        // ... context
      });

      // REFLECT
      const verification = await this.verify(screenshot, decision, result);

      if (verification.goalAchieved) {
        done = true;
      } else if (verification.stuck) {
        // Try recovery or ask for help
      }

      cycles++;
    }
  }
}
```

---

## Rich Execution Context

Vision AI needs full context to make good decisions:

```typescript
interface VisionExecutionContext {
  // Task identity
  task: {
    name: string;
    description: string;
    goal: string;
  };

  // Current phase with guidance
  currentPhase: {
    name: string;
    intent: string;
    stepGuidance: Array<{
      intent: string;
      whyThisElement: string;
      elementFindingStrategy: {
        lookingFor: string;
        searchContext: string;
        distinguishers: string[];
      };
      expectedOutcome: string;
      alternatives: string[];
    }>;
  };

  // User-taught rules (from Q&A)
  knowledge: {
    rules: string[];    // "Lead Source should always be 'Web'"
    tips: string[];     // "Wait for dropdown to load"
  };

  // Success criteria
  successCriteria: {
    indicators: string[];        // "Toast shows 'Contact Created'"
    failureIndicators: string[]; // "Error message appears"
  };

  // Adaptation strategies
  adaptations: Array<{
    scenario: string;     // "Button not found"
    howToAdapt: string;   // "Scroll down or look for + icon"
  }>;

  // User-provided data
  variables: Record<string, string>;

  // Recent history
  recentHistory: Array<{
    action: string;
    success: boolean;
  }>;
}
```

---

## Implementation Checklist

### Phase 1: Coordinate-to-DOM Bridge
- [ ] Create `src/lib/coordinate-executor.ts`
- [ ] Add `elementFromPoint` based clicking
- [ ] Add `elementFromPoint` based typing
- [ ] Add scroll-into-view handling
- [ ] Add interactability checks

### Phase 2: Unified Executor
- [ ] Create `src/lib/unified-executor.ts`
- [ ] Implement fallback chain: DOM → Coordinates → Vision
- [ ] Add logging for debugging
- [ ] Add metrics for which strategy succeeded

### Phase 3: Wire to Execution Engine
- [ ] Update `ExecutionEngine.act()` to use unified executor
- [ ] Update `SkillExecutionBridge` to use unified executor
- [ ] Remove CDP-based execution path

### Phase 4: Vision AI Integration
- [ ] Ensure Vision AI returns both semantic target AND coordinates
- [ ] Update `vision_analyze` prompts to always include coordinates
- [ ] Add confidence threshold for coordinate fallback

### Phase 5: Testing
- [ ] Test on forms (click input, type, submit)
- [ ] Test on dropdowns
- [ ] Test on complex UIs (modals, tabs)
- [ ] Test fallback chain (break selectors, verify coordinate backup works)

---

## File Changes Summary

| File | Status | Change |
|------|--------|--------|
| `src/lib/coordinate-executor.ts` | NEW | Coordinate-to-DOM bridge |
| `src/lib/unified-executor.ts` | NEW | Fallback chain orchestrator |
| `src/lib/tier1-executor.ts` | EXISTS | Keep as primary DOM executor |
| `src/lib/tier3-vision-assist.ts` | EXISTS | Keep for vision re-identify |
| `src/lib/execution/engine.ts` | UPDATE | Use unified executor |
| `src/lib/skill-execution-bridge.ts` | UPDATE | Use unified executor |
| `src/lib/vision/agent/vision-agent.ts` | DEPRECATE | Remove CDP execution path |
| `src/lib/vision/hands/mouse.ts` | DEPRECATE | CDP mouse (unreliable) |
| `src/lib/vision/hands/keyboard.ts` | DEPRECATE | CDP keyboard (unreliable) |

---

## Success Metrics

| Metric | Before (CDP) | After (Hybrid) |
|--------|--------------|----------------|
| Click reliability | ~30% | ~95% |
| Type reliability | ~30% | ~95% |
| Works without focus | No | Yes |
| Fallback options | None | 3 strategies |

---

## Summary

**OLD approach (Vision-Only with CDP):**
```
Vision AI → coordinates → CDP events → ❌ Unreliable
```

**NEW approach (Hybrid):**
```
Vision AI → decision → DOM execution → ✅ Reliable
                    ↘ coordinates (backup) → elementFromPoint → DOM → ✅ Reliable
```

The intelligence is in the Vision AI. The reliability is in the DOM execution.
Best of both worlds.

---

*Document updated: January 2025*
*Status: Hybrid Architecture - Phase 1 Implementation*
