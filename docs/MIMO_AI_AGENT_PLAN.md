# Mimo AI Agent - Consolidated Implementation Plan

> **A virtual employee that lives in your browser. You teach it with DOM-rich recording, it executes with vision-only AI.**

This document consolidates the **Virtual Employee Vision** and **Vision Execution Architecture** into a single unified plan.

---

## Core Philosophy

### The Hybrid Approach

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MIMO AI AGENT ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────────────────────┐   │
│  │    RECORDING        │         │           EXECUTION                  │   │
│  │   (DOM-Rich)        │         │         (Vision-Only)                │   │
│  ├─────────────────────┤         ├─────────────────────────────────────┤   │
│  │                     │         │                                      │   │
│  │ • Full DOM access   │   →→→   │ • Screenshot only (no DOM)          │   │
│  │ • Selectors         │         │ • AI vision to understand screen    │   │
│  │ • Element context   │         │ • CDP for actions (real input)      │   │
│  │ • Page model        │         │ • Human-like execution              │   │
│  │ • Spreadsheet ctx   │         │ • Works on any website              │   │
│  │                     │         │                                      │   │
│  │ OUTPUT:             │         │ INPUT:                               │   │
│  │ • WorkflowMemory    │   →→→   │ • WorkflowMemory (FULL knowledge)   │   │
│  │ • WorkflowAnalysis  │         │ • Variables (user values)           │   │
│  │ • AI-generated      │         │ • Screenshots (from recording)      │   │
│  │   phases/blocks     │         │                                      │   │
│  │ • Step guidance     │         │ Uses: VisionAgent + OTAR loop       │   │
│  │ • Success criteria  │         │                                      │   │
│  │                     │         │                                      │   │
│  └─────────────────────┘         └─────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Insight: Intelligence Already Exists!

After recording, `generate_workflow_memory` calls AI to produce rich understanding:

```typescript
// What we ALREADY HAVE after recording:
{
  analysis: {
    workflowUnderstanding: {
      summary: "Create a new contact in CRM",
      primaryGoal: "Add contact to Salesforce",
      successIndicators: ["Contact Created toast"],
      failureIndicators: ["Error message"]
    },
    stepGuidance: [{
      stepIndex: 0,
      intent: "Open the contact creation form",
      whyThisElement: "New Contact button starts the flow",
      elementFindingStrategy: {
        lookingFor: "Button labeled 'New Contact'",
        searchContext: "Top navigation area",
        distinguishers: ["Blue button", "Plus icon"]
      },
      preconditions: ["On contacts page"],
      expectedOutcome: "Form opens",
      alternatives: ["Look for + icon", "Use keyboard shortcut"]
    }],
    adaptationStrategies: [{
      scenario: "Button position changed",
      howToAdapt: "Search for similar text/icon in visible area"
    }]
  },

  memory: {
    identity: { purpose, domain },
    understanding: { phases, blocks },
    success: { indicators, failureIndicators, endState },
    adaptability: { fallbacks },
    experience: { timesExecuted, successRate, troubleSpots }
  }
}
```

**THE PROBLEM**: This rich data was NOT being passed to VisionAgent during execution!

---

## Implementation Status

### What's DONE

| Component | Status | Notes |
|-----------|--------|-------|
| Recording System | ✅ Done | DOM-rich capture |
| `generate_workflow_memory` | ✅ Done | AI analyzes recording, produces rich understanding |
| WorkflowMemory types | ✅ Done | Rich data structure |
| Q&A Clarifications | ✅ Done | User rules captured |
| VisionAgent | ✅ Done | OTAR loop implemented |
| Eyes/Brain/Hands | ✅ Done | All vision components |
| `vision_analyze` edge function | ✅ Done | Claude Sonnet vision API |
| StuckDetector | ✅ Done | Detects stuck, triggers callback |

### What's NOT Connected (The Gap)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THE DISCONNECTED PIPE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   RECORDING produces:                                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ WorkflowMemory + WorkflowAnalysis                                    │   │
│   │ • stepGuidance (intent, whyThisElement, elementFindingStrategy)     │   │
│   │ • successIndicators / failureIndicators                              │   │
│   │ • adaptationStrategies                                               │   │
│   │ • Q&A rules ("Lead Source always Web")                              │   │
│   │ • experience (past executions)                                       │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              │  ❌ NOT CONNECTED                             │
│                              ▼                                               │
│   EXECUTION receives (currently):                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ Minimal context only:                                                │   │
│   │ • task: { name, description, currentPhase }                         │   │
│   │ • variables: { name: "John" }                                       │   │
│   │ • recentHistory: [last 5 actions]                                   │   │
│   │                                                                      │   │
│   │ MISSING:                                                             │   │
│   │ • stepGuidance ❌                                                    │   │
│   │ • successIndicators ❌                                               │   │
│   │ • adaptationStrategies ❌                                            │   │
│   │ • Q&A rules ❌                                                       │   │
│   │ • experience ❌                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Vision Integration (Current Focus)

### 4.1 Create Rich Execution Context Type

Define a new type that captures ALL the intelligence for execution:

```typescript
// src/lib/vision/types/execution-context.ts

export interface VisionExecutionContext {
  // Task identity
  task: {
    name: string;
    description: string;
    domain: string;
    goal: string;
  };

  // Current phase with FULL guidance
  currentPhase: {
    name: string;
    intent: string;
    stepIndices: number[];

    // Per-step guidance for this phase
    stepGuidance: Array<{
      stepIndex: number;
      intent: string;
      whyThisElement: string;
      elementFindingStrategy: {
        lookingFor: string;
        searchContext: string;
        distinguishers: string[];
        textPatterns: string[];
        elementType: string;
      };
      preconditions: string[];
      expectedOutcome: string;
      alternatives: string[];
    }>;
  };

  // User-taught rules (from Q&A)
  knowledge: {
    rules: string[];        // "Lead Source should always be 'Web'"
    tips: string[];         // "Wait for dropdown to load"
    warnings: string[];     // "Don't click Save twice"
  };

  // Success/failure criteria
  successCriteria: {
    indicators: Array<{
      type: string;         // 'toast_appears', 'url_changes', etc.
      description: string;
      pattern?: string;
    }>;
    failureIndicators: string[];
    endState: string;
  };

  // Adaptation strategies
  adaptations: Array<{
    scenario: string;       // "Button not found"
    howToAdapt: string;     // "Scroll down or look for similar text"
    affectedSteps: number[];
  }>;

  // How user demonstrated it (reference, not script)
  demonstration: Array<{
    stepIndex: number;
    action: string;
    target: string;
    value?: string;
    context?: string;
  }>;

  // Past experience
  experience: {
    timesExecuted: number;
    successRate: number;
    commonIssues: string[];
    provenFixes: string[];
  };

  // User-provided data
  variables: Record<string, string>;

  // Execution state
  phaseIndex: number;
  totalPhases: number;
  recentHistory: Array<{
    action: string;
    reasoning: string;
    success: boolean;
  }>;
}
```

### 4.2 Create Adapter: WorkflowMemory → VisionExecutionContext

```typescript
// src/lib/vision/adapters/memory-adapter.ts

export function createVisionExecutionContext(
  workflow: SavedWorkflow,
  currentPhaseIndex: number,
  variables: Record<string, string>,
  history: ActionRecord[]
): VisionExecutionContext {
  const memory = workflow.memory;
  const analysis = workflow.aiAnalysis;
  const currentPhase = memory?.understanding?.phases?.[currentPhaseIndex];

  return {
    task: {
      name: memory?.identity?.name || workflow.name,
      description: memory?.identity?.purpose || workflow.description || '',
      domain: memory?.identity?.domain || 'Web Application',
      goal: analysis?.workflowUnderstanding?.primaryGoal || memory?.identity?.purpose || '',
    },

    currentPhase: {
      name: currentPhase?.name || `Phase ${currentPhaseIndex + 1}`,
      intent: currentPhase?.purpose || '',
      stepIndices: currentPhase?.stepIndices || [],
      stepGuidance: extractStepGuidanceForPhase(analysis?.stepGuidance, currentPhase?.stepIndices),
    },

    knowledge: extractKnowledge(workflow),

    successCriteria: {
      indicators: memory?.success?.indicators || [],
      failureIndicators: memory?.success?.failureIndicators || [],
      endState: memory?.success?.endState || 'Task completed',
    },

    adaptations: analysis?.adaptationStrategies || memory?.adaptability?.fallbacks?.map(f => ({
      scenario: f.when,
      howToAdapt: f.then,
      affectedSteps: f.forStep ? [f.forStep] : [],
    })) || [],

    demonstration: workflow.steps.map((step, i) => ({
      stepIndex: i,
      action: step.type,
      target: step.payload?.label || step.payload?.elementText || step.description || '',
      value: step.payload?.value,
      context: step.payload?.pageModelContext?.pageContext?.regionName,
    })),

    experience: {
      timesExecuted: memory?.experience?.timesExecuted || 0,
      successRate: memory?.experience?.successRate || 0,
      commonIssues: memory?.experience?.troubleSpots?.map(t => t.issue) || [],
      provenFixes: memory?.experience?.provenStrategies || [],
    },

    variables,
    phaseIndex: currentPhaseIndex,
    totalPhases: memory?.understanding?.phases?.length || 1,
    recentHistory: history.slice(-5).map(h => ({
      action: JSON.stringify(h.decision.action),
      reasoning: h.decision.reasoning,
      success: h.verification.success,
    })),
  };
}

function extractStepGuidanceForPhase(
  allGuidance: StepGuidance[] | undefined,
  stepIndices: number[] | undefined
): VisionExecutionContext['currentPhase']['stepGuidance'] {
  if (!allGuidance || !stepIndices) return [];

  return allGuidance
    .filter(g => stepIndices.includes(g.stepIndex))
    .map(g => ({
      stepIndex: g.stepIndex,
      intent: g.intent,
      whyThisElement: g.whyThisElement,
      elementFindingStrategy: g.elementFindingStrategy || {
        lookingFor: '',
        searchContext: '',
        distinguishers: [],
        textPatterns: [],
        elementType: 'element',
      },
      preconditions: g.preconditions || [],
      expectedOutcome: g.expectedOutcome || '',
      alternatives: g.alternatives || [],
    }));
}

function extractKnowledge(workflow: SavedWorkflow): VisionExecutionContext['knowledge'] {
  const rules: string[] = [];
  const tips: string[] = [];
  const warnings: string[] = [];

  // Extract from Q&A clarifications
  const clarifications = workflow.memory?.clarifications || workflow.clarifications || [];
  for (const c of clarifications) {
    if (c.answer) {
      // Convert Q&A to rule
      rules.push(`${c.question} → ${c.answer}`);
    }
  }

  // Extract from learned skill knowledge
  if (workflow.learnedSkill?.keyKnowledge) {
    rules.push(...workflow.learnedSkill.keyKnowledge);
  }

  // Extract from adaptability
  const adaptability = workflow.memory?.adaptability;
  if (adaptability?.tips) {
    tips.push(...adaptability.tips);
  }

  return { rules, tips, warnings };
}
```

### 4.3 Update Reasoner to Use Rich Context

```typescript
// Update src/lib/vision/brain/reasoner.ts

export async function decideNextAction(
  screenshot: Screenshot,
  screenState: ScreenUnderstanding,
  executionContext: VisionExecutionContext  // NEW: Rich context instead of minimal
): Promise<Decision> {
  const config = await getVisionConfig();

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify({
      type: 'decide_action',
      screenshot: extractBase64(screenshot),
      context: {
        // What we see
        screenState: {
          pageType: screenState.pageType,
          pageDescription: screenState.pageDescription,
          components: screenState.components.slice(0, 20),
          formState: screenState.formState,
          state: screenState.state,
        },

        // FULL task context (NEW!)
        task: executionContext.task,

        // Current phase with step guidance (NEW!)
        currentPhase: executionContext.currentPhase,

        // User-taught rules (NEW!)
        knowledge: executionContext.knowledge,

        // Success criteria (NEW!)
        successCriteria: executionContext.successCriteria,

        // Adaptation strategies (NEW!)
        adaptations: executionContext.adaptations,

        // Demonstration reference (NEW!)
        demonstration: executionContext.demonstration,

        // Experience (NEW!)
        experience: executionContext.experience,

        // Data to use
        variables: executionContext.variables,

        // What we've done
        recentHistory: executionContext.recentHistory,

        // Progress
        phaseIndex: executionContext.phaseIndex,
        totalPhases: executionContext.totalPhases,
      },
    }),
  });

  // ... rest of function
}
```

### 4.4 Update vision_analyze Edge Function Prompts

The edge function needs to USE this rich context in its prompts:

```typescript
// Update decide_action prompt to leverage rich context
const prompt = `You are a virtual employee executing a learned task.

## YOUR TASK
Name: ${context.task.name}
Goal: ${context.task.goal}
Domain: ${context.task.domain}

## CURRENT PHASE: ${context.currentPhase.name}
Intent: ${context.currentPhase.intent}

## WHAT USER TAUGHT YOU (Step Guidance)
${context.currentPhase.stepGuidance.map(g => `
Step ${g.stepIndex}: ${g.intent}
- Look for: ${g.elementFindingStrategy.lookingFor}
- Where: ${g.elementFindingStrategy.searchContext}
- Distinguishers: ${g.elementFindingStrategy.distinguishers.join(', ')}
- Expected outcome: ${g.expectedOutcome}
- Alternatives if not found: ${g.alternatives.join(', ')}
`).join('\n')}

## RULES YOU MUST FOLLOW (from user training)
${context.knowledge.rules.map(r => `• ${r}`).join('\n')}

## SUCCESS CRITERIA
${context.successCriteria.indicators.map(i => `• ${i.description}`).join('\n')}

## IF THINGS GO WRONG
${context.adaptations.map(a => `• If "${a.scenario}" → ${a.howToAdapt}`).join('\n')}

## PAST EXPERIENCE
- Executed ${context.experience.timesExecuted} times
- Success rate: ${(context.experience.successRate * 100).toFixed(0)}%
${context.experience.commonIssues.length > 0 ? `- Common issues: ${context.experience.commonIssues.join(', ')}` : ''}
${context.experience.provenFixes.length > 0 ? `- What worked before: ${context.experience.provenFixes.join(', ')}` : ''}

## CURRENT DATA
${Object.entries(context.variables).map(([k, v]) => `• ${k}: "${v}"`).join('\n')}

## WHAT YOU SEE NOW
${context.screenState.pageDescription}
Form state: ${JSON.stringify(context.screenState.formState)}

## RECENT ACTIONS
${context.recentHistory.map(h => `• ${h.action} - ${h.success ? '✓' : '✗'}`).join('\n')}

Based on your training and what you see, what should you do next?
Return JSON with: action, reasoning, confidence, expectedOutcome
`;
```

### 4.5 Wire VisionAgent in Bridge

```typescript
// Update src/lib/skill-execution-bridge.ts

import { VisionAgent } from './vision/agent';
import { createVisionExecutionContext } from './vision/adapters/memory-adapter';

// Add to executeSkill method:
if (aiConfig.getConfig().useVisionExecution) {
  const agent = new VisionAgent({
    onProgress: this.callbacks.onProgress,
    onAction: (action) => console.log('[Vision] Action:', action),
  });

  // Pass the full workflow so VisionAgent can create rich context
  return agent.executeWithWorkflow(tabId, workflow, variables);
}
```

### 4.6 Add Feature Flag

```typescript
// Update src/lib/ai-config.ts

interface AIConfig {
  // ... existing fields
  useVisionExecution: boolean;
}

const DEFAULT_CONFIG: AIConfig = {
  // ... existing defaults
  useVisionExecution: false,  // Start disabled, enable when ready
};
```

---

## What's Still Missing (Future Phases)

### Phase 5: Screenshot Capture During Recording
- Capture before/after screenshots per step
- Store with workflow for visual reference
- VisionAgent can compare current screen to reference

### Phase 6: Experience Learning Loop
- After execution, update WorkflowMemory.experience
- Track what worked, what didn't
- Build up `provenFixes` over time

### Phase 7: Help System UI
- When stuck, show rich help request
- Include what agent tried, what it knows
- User can point/type to help

### Phase 8: Multi-Item Execution
- "Add Alice, Bob, Carol"
- Batch progress tracking

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/lib/vision/types.ts` | Add `VisionExecutionContext` type |
| `src/lib/vision/adapters/memory-adapter.ts` | **NEW** - Create rich context from WorkflowMemory |
| `src/lib/vision/brain/reasoner.ts` | Accept `VisionExecutionContext`, pass to API |
| `src/lib/vision/agent/vision-agent.ts` | Add `executeWithWorkflow()` method |
| `supabase/functions/vision_analyze/index.ts` | Update prompts to use rich context |
| `src/lib/skill-execution-bridge.ts` | Wire VisionAgent path |
| `src/lib/ai-config.ts` | Add `useVisionExecution` flag |

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Context passed to vision AI | ~100 tokens | ~2000 tokens |
| Includes step guidance | No | Yes |
| Includes success criteria | No | Yes |
| Includes Q&A rules | No | Yes |
| Includes adaptation strategies | No | Yes |
| Includes experience | No | Yes |

---

*Document created: January 2025*
*Last updated: January 2025*
*Status: Phase 4 Implementation In Progress*
