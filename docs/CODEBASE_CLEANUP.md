# Codebase Cleanup Analysis

This document analyzes what can be removed or consolidated from the current Mimo codebase as we transition to the new goal-oriented "virtual employee" architecture.

---

## Executive Summary

The current codebase has accumulated technical debt from iterative development:
- **Deprecated backward-compatibility shims** that are no longer needed
- **Overlapping AI vision systems** (3+ approaches to visual element finding)
- **Duplicate variable/intent analysis** (4+ edge functions doing similar work)
- **Dead code** in various files
- **Low-usage wrapper modules** that add complexity without value

---

## 1. Deprecated Files (Safe to Remove)

These files exist for backward compatibility but are no longer actively used:

### `src/lib/shadow-dom-utils.ts`
- **Purpose**: Legacy shadow DOM handling
- **Status**: Functionality merged into main DOM utilities
- **Action**: Can remove after verifying no imports

### `src/lib/text-matcher.ts`
- **Purpose**: Legacy fuzzy text matching
- **Status**: Replaced by AI-based element finding
- **Action**: Can remove

### `src/lib/visibility-checker.ts`
- **Purpose**: Legacy element visibility checks
- **Status**: DOM utilities now handle this
- **Action**: Can remove

---

## 2. Overlapping Vision Systems (Consolidate)

We have 3+ approaches to visual element finding that should be consolidated:

### Edge Functions
| Function | Purpose | Recommendation |
|----------|---------|----------------|
| `visual_click` | Click element using screenshot | **Keep** - Active use |
| `visual_agent` | Multi-step visual automation | **Remove** - Superseded by computer_use |
| `computer_use` | Claude computer-use API | **Keep** - Primary vision system |
| `screenshot_router` | Route screenshot requests | **Evaluate** - May be redundant |

### Recommendation
- Keep `computer_use` as primary visual system
- Keep `visual_click` for single-element operations
- Remove `visual_agent` - functionality covered by computer_use
- Evaluate if `screenshot_router` can be merged into computer_use

---

## 3. Duplicate Variable/Intent Analysis (Consolidate)

Multiple edge functions do similar variable/intent work:

### Current Functions
| Function | Purpose | Lines | Recommendation |
|----------|---------|-------|----------------|
| `detect_variables` | Find variables in workflow | ~150 | **Merge** into generate_workflow_memory |
| `extract_variables` | Extract variable values | ~200 | **Merge** into generate_workflow_memory |
| `parse_intent` | Parse user intent | ~180 | **Merge** into match_workflow |
| `analyze_intent` | Analyze user command | ~220 | **Remove** - Duplicate of parse_intent |
| `match_workflow` | Match query to workflow | ~250 | **Keep** - Primary matching |
| `generate_workflow_memory` | Unified workflow analysis | ~500 | **Keep** - Primary analysis |

### Recommendation
The unified `generate_workflow_memory` function should absorb:
- Variable detection (already partially done)
- Variable extraction (move to client-side or merge)
- Intent analysis (keep in match_workflow)

Remove `analyze_intent` as it duplicates `parse_intent`.

---

## 4. Dead Code in Active Files

### `src/lib/post-recording-analyzer.ts`
```typescript
// Lines ~150-200: Unused legacy analysis methods
// - analyzeStepPatterns() - never called
// - detectFormBoundaries() - replaced by AI
// - groupStepsByUrl() - functionality in workflow-memory
```
**Action**: Remove unused methods

### `src/background/message-handler.ts`
```typescript
// Deprecated message types still handled:
// - 'LEGACY_EXECUTE_STEP'
// - 'OLD_WORKFLOW_FORMAT'
// - 'COMPAT_*' messages
```
**Action**: Remove deprecated message handlers after confirming no usage

### `src/content/universal-execution/orchestrator.ts`
```typescript
// ~30 lines of commented-out legacy execution code
// Legacy retry logic that's been replaced
```
**Action**: Remove commented code

---

## 5. Low-Usage Wrapper Modules

These modules add indirection without significant value:

| Module | Purpose | Usage Count | Recommendation |
|--------|---------|-------------|----------------|
| `src/lib/api-wrapper.ts` | Wrap fetch calls | 2 | **Remove** - Use fetch directly |
| `src/lib/storage-compat.ts` | Storage compatibility | 1 | **Remove** - Legacy |
| `src/lib/event-emitter-lite.ts` | Lightweight events | 0 | **Remove** - Unused |
| `src/lib/retry-helper.ts` | Retry logic | 3 | **Keep** - Useful utility |
| `src/lib/timeout-wrapper.ts` | Timeout promises | 2 | **Merge** into retry-helper |

---

## 6. Edge Functions to Remove or Consolidate

### Remove Entirely
| Function | Reason |
|----------|--------|
| `analyze_intent` | Duplicate of parse_intent |
| `visual_agent` | Superseded by computer_use |
| `legacy_*` functions | If any exist |

### Consolidate Into Others
| Function | Merge Into |
|----------|------------|
| `detect_variables` | `generate_workflow_memory` |
| `extract_variables` | Client-side VariableExtractor |

### Keep As-Is
| Function | Reason |
|----------|--------|
| `generate_workflow_memory` | Primary analysis |
| `generate_clarifying_questions` | Q&A system |
| `match_workflow` | Skill matching |
| `computer_use` | Visual execution |
| `visual_click` | Element clicking |
| `execute_step` | Step execution |

---

## 7. Message Types to Deprecate

In `src/types/messages.ts`, these can be removed:

```typescript
// Legacy message types (if present)
type LegacyMessages =
  | 'EXECUTE_WORKFLOW_OLD'
  | 'COMPAT_MODE_*'
  | 'LEGACY_*'
  | 'V1_*';
```

---

## 8. Components to Simplify

### `src/sidepanel/App.tsx`
- Complex state management could be simplified
- Multiple overlapping "analysis" states
- Consider using a state machine for recording/analysis flow

### `src/content/universal-execution/`
- `orchestrator.ts` has grown large (~800 lines)
- Could split into: `block-executor.ts`, `step-executor.ts`, `iteration-handler.ts`

---

## 9. Migration Path

### Phase 1: Safe Removals (No Risk)
1. Remove commented-out code
2. Remove unused imports
3. Remove deprecated shim files

### Phase 2: Consolidate Edge Functions
1. Merge variable detection into generate_workflow_memory
2. Remove analyze_intent (keep parse_intent)
3. Evaluate visual_agent removal

### Phase 3: Simplify Architecture
1. Reduce message type sprawl
2. Simplify state management
3. Split large files

---

## 10. Files to Keep (Core Architecture)

These are essential and should NOT be removed:

### Core Execution
- `src/content/universal-execution/orchestrator.ts`
- `src/content/universal-execution/dom-analyzer.ts`
- `src/lib/agent/strategic-reasoner.ts`

### Workflow Memory
- `src/lib/workflow-memory/types.ts`
- `src/lib/workflow-memory/memory-manager.ts`

### Variable Handling
- `src/lib/variable-extractor.ts`

### Storage
- `src/lib/storage.ts`
- `src/lib/indexed-db.ts`

### Edge Functions (Core)
- `generate_workflow_memory`
- `generate_clarifying_questions`
- `match_workflow`
- `execute_step`
- `computer_use`
- `visual_click`

---

## Estimated Impact

| Category | Files/Functions | Lines Removable |
|----------|-----------------|-----------------|
| Deprecated shims | 3 files | ~400 lines |
| Dead code in active files | 5 files | ~200 lines |
| Duplicate edge functions | 2 functions | ~400 lines |
| Low-usage wrappers | 4 files | ~300 lines |
| **Total** | **14 items** | **~1,300 lines** |

This cleanup would reduce codebase complexity by ~10-15% and make the transition to the new architecture cleaner.

---

## Next Steps

1. **Verify** each removal candidate has no active imports
2. **Test** after each removal phase
3. **Document** any breaking changes for future reference
4. **Prioritize** based on new architecture needs

This cleanup should happen BEFORE implementing the new virtual employee architecture to reduce confusion and technical debt.
