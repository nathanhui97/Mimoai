# AI Agent Reliability Improvements

**Date:** December 22, 2025  
**Status:** ✅ Implemented and Built Successfully

## Overview

Implemented comprehensive fixes to address the core issues preventing the AI agent from reliably replaying workflows in Salesforce/Gainsight environments. These fixes bridge the gap between what the recorder captures and what the agent uses for replay.

---

## Problem Analysis

The AI agent was failing because:

1. **Recording vs Agent Drift**: Recorder captured rich element bundles, but agent only received minimal hints - causing the LLM to "invent" targets
2. **Missing Scope Identity**: DOMMap couldn't distinguish between 10 identical "More" buttons in a table
3. **Iframe Isolation**: Content script wasn't injecting into iframes, making elements invisible
4. **Generic Recovery**: "Scroll and retry" had no structure - no target, no bounds

---

## Implemented Solutions

### 1. Iframe Injection ✅

**File:** `public/manifest.json`

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["src/content/content-script.ts"],
  "run_at": "document_idle",
  "all_frames": true  // ✅ NEW
}],
"host_permissions": [
  "<all_urls>",
  "*://*.force.com/*",              // ✅ NEW
  "*://*.salesforce.com/*",         // ✅ NEW
  "*://*.lightning.force.com/*",    // ✅ NEW
  "*://*.gainsight.com/*",          // ✅ NEW
  "*://*.gainsightcloud.com/*"      // ✅ NEW
]
```

**Frame ID Model:**
- Content script requests frameId from service worker on init
- All DOMMap elements tagged with `frameId: number` (0 = main frame)
- Future: Executor can route commands to specific frames

**Files Modified:**
- `src/content/content-script.ts` - Request frameId on init
- `src/background/service-worker.ts` - Handle GET_FRAME_ID message
- `src/types/messages.ts` - Add GET_FRAME_ID message type

---

### 2. DOMMap Scope Identity ✅

**File:** `src/content/dom-map.ts`

**New Fields Added to DOMMapElement:**
```typescript
interface DOMMapElement {
  // ... existing fields ...
  
  scopePath?: string[];      // ["Accounts Table", "Row: Pizza Depot"]
  rowKey?: string;           // "Pizza Depot | Active"
  widgetTitle?: string;      // "Q4 Sales Report"
  frameId: number;           // 0 = main frame
}
```

**New Functions Implemented:**

#### `computeScopePath(element)` - Max 2-4 Items
- Only collects from semantic containers (role=region, dialog, main, etc.)
- Extracts headings (h1-h4) from containers
- Handles Salesforce data-aura-class containers
- Deduplicates and limits to 4 items

#### `computeRowKey(element)` - Smart Identifier Detection
- Finds containing row (handles virtualized tables)
- Prefers explicit data-row-id or data-record-id
- Extracts first 2 identifier-like cells:
  - Skips icons (svg, img with short text)
  - Skips numeric-only cells
  - Skips common status words
  - Prefers Name/Account columns

#### `findWidgetTitle(element)` - Nearest Heading
- Walks up max 10 levels
- Finds h1-h6 or [role="heading"]
- Falls back to title or aria-label attributes

**Output Format Example:**
```
Before: [button] "More" id="btn-123"
After:  [button] "More" rowKey="Pizza Depot | Active" scope=[Accounts Table > Q4 Sales] widget="Sales Dashboard"
```

---

### 3. Recorded Locators with Ranked Candidates ✅

**Files:** `src/lib/ai-agent.ts`, `supabase/functions/dom_agent/index.ts`

**Enhanced AgentHint Interface:**
```typescript
interface AgentHint {
  // ... existing fields ...
  
  recordedSelector?: string;      // Primary CSS/XPath selector
  recordedTestId?: string;        // data-testid from recording
  recordedScopeHint?: string;     // Container/widget text
  recordedRowKey?: string;        // Row identifier
  nearbyText?: string[];          // Anchor text for disambiguation
}
```

**Candidate Ranking System:**

1. **findAndRankCandidates()** - Finds up to 8 matches
   - Filters by role and text (loose matching)
   - Scores each candidate (0-200+ points)
   - Returns top 8 sorted by score

2. **Scoring Algorithm:**
   - testId exact match: **100 points** (highest priority)
   - rowKey match: **40 points** (critical for tables)
   - scopePath match: **30 points**
   - widgetTitle match: **20 points**
   - nearbyText overlap: **10 points each**
   - Text match quality: **up to 15 points**

3. **LLM Forced Selection:**
   - Agent sends ranked candidates to dom_agent
   - LLM **MUST** return `chooseCandidateIndex: 0-7` or `-1`
   - Cannot invent new targets - must choose from provided list
   - Response parser validates and maps index to target

**Example Candidate List Sent to LLM:**
```
0: [button] "More" rowKey="Pizza Depot | Active" scope=[Accounts Table] (score: 110)
1: [button] "More" rowKey="Acme Corp | Inactive" scope=[Accounts Table] (score: 70)
2: [button] "More" rowKey="Widget Inc | Active" scope=[Accounts Table] (score: 70)
```

**LLM Response:**
```json
{
  "chooseCandidateIndex": 0,
  "reason": "RowKey matches Pizza Depot which is the target from hint",
  "action": "click",
  "reasoning": "Clicking More button for Pizza Depot row"
}
```

---

### 4. Structured Recovery Directives ✅

**File:** `src/content/recovery-engine.ts`

**New Types:**
```typescript
interface ScrollRecoveryDirective {
  kind: 'SCROLL_AND_RETRY';
  containerHint?: string;        // "Accounts table"
  untilTextVisible?: string;     // "Pizza Depot"
  maxScrolls: number;            // Default 10
  scrollDirection: 'down' | 'up';
  pixelsPerScroll: number;       // Default 300
}

interface DismissRecoveryDirective {
  kind: 'DISMISS_POPUP';
  popupHint?: string;            // "Cookie banner"
  dismissMethod?: 'escape' | 'click_outside' | 'close_button';
}
```

**New Methods:**

#### `executeScrollRecovery(directive, startTime)`
- Finds scroll container by hint (e.g., "Accounts table")
- Scrolls incrementally in specified direction
- Checks for target text after each scroll
- Detects end-of-scroll area
- Returns success when target found

#### `findScrollContainer(containerHint)`
- Strategy 1: Find by text/aria-label matching hint
- Strategy 2: Find first scrollable element
- Strategy 3: Fallback to document.documentElement

#### `dismissPopupStructured(directive, startTime)`
- Multiple dismiss methods: escape, click_outside, close_button
- Smart close button finding with popup context
- Waits for dismissal to complete

**Updated Recovery Prompt:**
LLM now returns structured directives:
```json
{
  "strategy": "SCROLL_AND_RETRY",
  "directive": {
    "containerHint": "Accounts table",
    "untilTextVisible": "Pizza Depot",
    "maxScrolls": 12,
    "scrollDirection": "down",
    "pixelsPerScroll": 300
  }
}
```

---

## Files Modified

| File | Lines Changed | Description |
|------|--------------|-------------|
| `public/manifest.json` | 7 | Added all_frames and host_permissions |
| `src/types/messages.ts` | 10 | Added GET_FRAME_ID message type |
| `src/content/content-script.ts` | 15 | Frame ID initialization |
| `src/background/service-worker.ts` | 10 | Frame ID handler |
| `src/content/dom-map.ts` | 140 | Scope computation functions |
| `src/lib/ai-agent.ts` | 120 | Candidate ranking and selection |
| `src/content/recovery-engine.ts` | 150 | Structured recovery execution |
| `supabase/functions/dom_agent/index.ts` | 50 | Forced candidate selection prompt |

**Total:** ~500 lines of new/modified code

---

## Key Improvements

### Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| **Element Identity** | `[button] "More"` | `[button] "More" rowKey="Pizza Depot" scope=[Accounts Table > Row: Pizza Depot]` |
| **LLM Behavior** | Invents targets from scratch | Must choose from 8 ranked candidates |
| **Iframe Support** | Elements invisible | Content script in all frames |
| **Recovery** | "Scroll somewhere" | "Scroll Accounts table down 12 times until 'Pizza Depot' appears" |
| **Disambiguation** | Guesswork | testId (100pts) + rowKey (40pts) + scope (30pts) scoring |

### Architecture Flow

```
Recording:
  User clicks → Recorder captures rich bundle → Saved with locators/context

Old Agent Flow (BROKEN):
  Hints (minimal) → LLM invents target → Wrong element → Failure

New Agent Flow (FIXED):
  Hints (with locators) → Build candidates → Rank by score → LLM picks index → Exact element → Success
```

---

## Testing Recommendations

1. **Iframe Test:** Load Salesforce page with iframes, verify DOMMap includes all elements
2. **Scope Test:** Table with 10 "More" buttons, verify each has unique rowKey
3. **Candidate Test:** Record clicking row "Pizza Depot", verify it ranks #1 in candidates
4. **Selection Test:** Verify LLM returns chooseCandidateIndex, not invented targets
5. **Scroll Test:** Element below fold, verify structured scroll finds it with max 12 scrolls

---

## Edge Cases Handled

1. **Cross-origin iframes:** Will still fail if origin not in host_permissions, but Tier 3 vision can help
2. **Virtualized tables:** computeRowKey handles non-tr rows and data attributes
3. **No candidates found:** LLM returns chooseCandidateIndex: -1 to skip
4. **Dynamic content:** Scoring prefers stable identifiers (testId > rowKey > scope)
5. **Token bloat:** Candidates limited to 8, scopePath limited to 4 items

---

## Expected Impact

These changes should significantly improve agent reliability on:
- ✅ Salesforce Lightning (multiple identical buttons in tables/lists)
- ✅ Gainsight dashboards (widgets with repeating controls)
- ✅ Any multi-frame application
- ✅ Virtualized tables with row actions
- ✅ Dynamic content requiring scrolling

The agent should now be able to distinguish between identical-looking elements by their **structural context** (which table? which row? which widget?) rather than guessing.

---

## Next Steps

1. Test on real Salesforce/Gainsight workflow
2. Monitor logs for "chooseCandidateIndex" values
3. Check if rowKey extraction works for your specific table structure
4. Verify scroll recovery finds off-screen elements
5. If still failing, check the diagnostic output:
   - How many candidates match?
   - What are their scores?
   - Which one did LLM choose?
   - Did Tier1 reject it (and why)?




