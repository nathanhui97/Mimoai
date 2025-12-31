# AI Reliability Enhancement Plan - Recorder & Replayer (With Implementation Todos)

## Executive Summary

This plan implements AI-powered reliability features to solve critical problems in the recorder and replayer. The AI features work alongside existing rule-based systems to catch issues proactively and enable self-healing when workflows break.

## Current Problems We're Solving

### Problem 1: Fragile Selectors Being Recorded
**Current Issue:**
- Selectors like `gridster-item:nth-of-type(8)` are recorded as primary selectors
- Dynamic IDs like `#w5` (Gridster) are sometimes used despite being unsafe
- Position-based selectors break when users rearrange dashboards
- Rule-based detection (`isUnsafeId`) catches some patterns but misses edge cases

**Impact:**
- Workflows break silently when UI changes
- Users have to manually fix selectors
- Low success rate on dynamic pages (Gainsight, Salesforce)

**How AI Solves It:**
- **AI Selector Validator** analyzes selectors during recording
- Detects fragility patterns that rule-based checks miss
- Suggests semantic alternatives (role-based, text-based, container-scoped)
- Automatically adds better selectors to fallbacks

### Problem 2: Selectors Failing During Replay
**Current Issue:**
- When all selectors fail, workflow stops with error
- No recovery mechanism exists
- UI changes (button text, moved elements, new modals) break workflows
- Similar elements (multiple "three-dot" menus) can't be disambiguated

**Impact:**
- Workflows fail completely when UI changes
- Users have to re-record workflows
- Low reliability on frequently changing UIs

**How AI Solves It:**
- **AI Element Finder** activates when all selectors fail
- Uses semantic understanding to find elements ("Submit" = "Send" = "Create")
- Matches candidates by meaning, not just exact text
- Enables self-healing workflows

### Problem 3: Context Window & Cost Issues
**Current Issue:**
- Sending full HTML (5MB+) to AI would cost $0.50+ per call
- Hits token limits
- Slow (5-10s latency)

**How We Solve It:**
- **DOM Distiller** extracts only relevant candidates and context
- Reduces payload from 5MB to ~500 tokens
- Cost drops from $0.50 to $0.001 per call

### Problem 4: PII Privacy Risk
**Current Issue:**
- Sending DOM with PII (emails, phone numbers) to OpenAI leaks sensitive data
- Enterprise tools (Uber, Gainsight) contain confidential information

**How We Solve It:**
- **PII Scrubber** scrubs sensitive data before AI calls
- Preserves labels ("Enter Email") but scrubs values ("john@example.com")
- Protects user privacy

## Implementation Plan

### Phase 1: Foundation & Privacy (Sprint 1)

#### Todo 1.1: Create DOM Distiller Utility
**File:** `src/lib/dom-distiller.ts`

**Rationale:**
- Solves context window problem (5MB → 500 tokens)
- Extracts structured candidates instead of raw HTML
- Enables cost-effective AI calls

**What it does:**
- Cleans HTML (removes scripts, styles, comments)
- Extracts candidate elements (top 5-10 matches)
- Truncates context to relevant sections (~2000 tokens max)
- Returns structured data, not HTML

**Key Methods:**
- `extractElementContext(element)` - Small snippet for selector validation
- `createFailureSnapshot(step, dom)` - Structured snapshot for element finding
- `findCandidateElements(step, doc)` - Find potential matches
- `extractRelevantContext(step, doc)` - Truncated container/form context

#### Todo 1.2: Create PII Scrubber Utility
**File:** `src/lib/pii-scrubber.ts`

**Rationale:**
- Protects user privacy
- Prevents PII leakage to AI services
- Required for enterprise compliance

**What it does:**
- Scrub emails: `john@example.com` → `[EMAIL]`
- Scrub phone numbers: `(555) 123-4567` → `[PHONE]`
- Scrub credit cards, SSN (optional)
- Preserves labels ("Enter Email" stays as-is)

**Key Methods:**
- `scrub(text)` - Scrub PII from text
- `scrubElement(element)` - Scrub element text
- `scrubSnapshot(snapshot)` - Scrub failure snapshot
- `scrubStep(step)` - Scrub workflow step

#### Todo 1.3: Create AI Service Infrastructure
**File:** `src/lib/ai-service.ts`

**Rationale:**
- Centralized AI API integration
- Handles rate limiting, retries, errors
- Supports multiple providers (OpenAI, Anthropic)

**What it does:**
- API calls to OpenAI/Anthropic
- Error handling and retries
- Model selection (cheap for simple, better for complex)
- Always scrubs PII before sending

**Key Methods:**
- `validateSelector(selector, context)` - Validate selector stability
- `findElementBySemantics(step, dom)` - Find element by meaning
- `callAI(prompt, options)` - Internal API call handler

#### Todo 1.4: Create AI Cache
**File:** `src/lib/ai-cache.ts`

**Rationale:**
- Prevents duplicate AI calls
- Reduces costs significantly
- Improves performance

**What it does:**
- Caches validation results by selector pattern
- Caches element finding results by step signature
- TTL: 7 days (workflows don't change often)
- Hash-based keys for deduplication

**Key Methods:**
- `getOrCompute(key, computeFn)` - Cache with TTL
- `generateKey(data)` - Create cache key from data

#### Todo 1.5: Create AI Configuration
**File:** `src/lib/ai-config.ts`

**Rationale:**
- Centralized configuration
- Easy to switch models/providers
- Cost tracking and limits

**What it does:**
- API keys management
- Model selection (gpt-4o-mini for cheap, gpt-4o for complex)
- Cost limits and monitoring
- Feature flags (enable/disable AI)

### Phase 2: AI Selector Validator (Sprint 2)

#### Todo 2.1: Add Fragile Selector Detection
**File:** `src/content/selector-engine.ts`

**Rationale:**
- Identifies selectors that need AI validation
- Only calls AI for flagged selectors (cost optimization)
- Works alongside existing `isUnsafeId` checks

**What it does:**
- Detects position-based selectors (`:nth-child`, `:nth-of-type`)
- Detects dynamic ID patterns (even if `isUnsafeId` misses them)
- Detects overly long CSS paths
- Flags selectors with low stability confidence

**Implementation:**
```typescript
static isPotentiallyFragile(selector: string): boolean {
  // Position-based (brittle)
  if (/:nth-(child|of-type)\(/.test(selector)) return true;
  
  // Very long CSS path (brittle)
  if (selector.split('>').length > 10) return true;
  
  // Dynamic ID patterns (even if isUnsafeId missed it)
  if (/^#[a-z][0-9]+$/i.test(selector)) return true;
  
  return false;
}
```

#### Todo 2.2: Integrate AI Selector Validator
**File:** `src/content/selector-engine.ts`

**Rationale:**
- Catches fragile selectors during recording
- Suggests better alternatives automatically
- Proactive reliability (fixes issues before they break)

**What it does:**
- After generating selectors, check if primary is fragile
- If yes, call AI validator (async, non-blocking)
- AI analyzes selector and suggests alternatives
- Add AI suggestions to fallbacks

**Integration Point:**
```typescript
// In generateSelectors(), after generating primary selector
if (this.isPotentiallyFragile(selectors.primary)) {
  // Extract small context (DOM Distiller)
  const elementContext = DOMDistiller.extractElementContext(element);
  const scrubbed = PIIScrubber.scrubElement(elementContext);
  
  // Call AI async (non-blocking)
  AIService.validateSelector(selectors.primary, scrubbed)
    .then(validation => {
      if (!validation.isStable && validation.alternatives.length > 0) {
        // Add AI suggestions to fallbacks
        selectors.fallbacks.unshift(...validation.alternatives);
      }
    })
    .catch(() => {
      // Fail silently - AI is enhancement
    });
}
```

**How it solves Problem 1:**
- Catches `gridster-item:nth-of-type(8)` and suggests text-based selector
- Detects dynamic IDs and suggests role-based alternatives
- Proactively improves selector quality during recording

### Phase 3: AI Element Finder (Sprint 3 - After Executor is Built)

#### Todo 3.1: Create Failure Snapshot in Executor
**File:** `src/content/executor.ts` (Phase 3)

**Rationale:**
- Creates structured snapshot when selectors fail
- Enables AI element finding
- Uses DOM Distiller to minimize payload

**What it does:**
- When all selectors fail, create failure snapshot
- Extract target description from step
- Find candidate elements (top 5-10)
- Extract relevant context (truncated)
- Scrub PII before sending to AI

**Implementation:**
```typescript
// In executor, when element not found
async findElement(step: WorkflowStep): Promise<Element | null> {
  // Try all selectors first (rule-based, free)
  for (const selector of [step.payload.selector, ...step.payload.fallbackSelectors]) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  
  // Only if all fail, try AI
  if (this.shouldUseAI(step)) {
    try {
      const element = await AIService.findElementBySemantics(step, document);
      if (element) {
        this.cacheRecovery(step, element);
        return element;
      }
    } catch (error) {
      // Fail gracefully
    }
  }
  
  return null;
}
```

#### Todo 3.2: Implement AI Element Finding
**File:** `src/lib/ai-service.ts`

**Rationale:**
- Enables self-healing workflows
- Finds elements by semantic meaning
- Handles UI changes automatically

**What it does:**
- Receives failure snapshot (from DOM Distiller)
- AI analyzes candidates and matches to target
- Returns best matching element or selector
- Handles semantic matching ("Submit" = "Send")

**How it solves Problem 2:**
- When `gridster-item:nth-of-type(8)` fails, AI finds widget by title
- When button text changes ("Submit" → "Send"), AI matches by meaning
- When element moves to modal, AI finds it in new location

## Cost Analysis

### Per Workflow (Recording)
- **Selector Validation**: ~200 tokens = ~$0.0005
  - Only called for 1-2 flagged selectors per workflow
  - Cached, so similar selectors are free
  - **Total**: ~$0.001 per workflow

### Per Replay Failure
- **Element Finding**: ~500 tokens = ~$0.001
  - Only when all selectors fail (< 5% of runs)
  - Cached, so similar failures are free
  - **Total**: ~$0.001 per failure

### Monthly Estimate (1000 workflows, 10% failure rate)
- **Recording**: 1000 × $0.001 = $1/month
- **Replay Failures**: 100 × $0.001 = $0.10/month
- **Total**: ~$1.10/month

**Without DOM Distiller (sending full HTML):**
- Would cost ~$0.50 per call
- Monthly: ~$500/month (not feasible)

**With DOM Distiller:**
- Costs ~$0.001 per call
- Monthly: ~$1.10/month (feasible)

## Success Metrics

### Selector Validator
- ✅ Catches > 80% of fragile selectors during recording
- ✅ Suggests better alternatives in > 70% of cases
- ✅ Average cost per workflow < $0.002
- ✅ No performance impact (async, non-blocking)

### Element Finder
- ✅ Success rate > 70% when selectors fail
- ✅ Used in < 5% of workflow runs (most succeed without AI)
- ✅ Average cost per failure < $0.002
- ✅ Recovery time < 5 seconds

## Risk Mitigation

### Cost Overruns
- **Hard limits**: Max 1 AI call per selector validation, max 1 per element finding
- **Caching**: Aggressive caching prevents duplicate calls
- **User controls**: Allow users to disable AI features
- **Monitoring**: Track costs and alert if thresholds exceeded

### Privacy
- **PII Scrubbing**: Always scrub before AI calls
- **Data minimization**: Only send relevant data (DOM Distiller)
- **Audit trail**: Log what data was sent (scrubbed version)
- **User consent**: Clear opt-in for AI features

### Performance
- **Async**: All AI calls are non-blocking
- **Timeout**: 5-second timeout for AI calls
- **Fallback**: Always have rule-based fallbacks
- **Graceful degradation**: If AI fails, continue without it

## Implementation Order

### Sprint 1: Foundation (Week 1)
1. ✅ Todo 1.1: Create DOM Distiller Utility
2. ✅ Todo 1.2: Create PII Scrubber Utility
3. ✅ Todo 1.3: Create AI Service Infrastructure
4. ✅ Todo 1.4: Create AI Cache
5. ✅ Todo 1.5: Create AI Configuration

### Sprint 2: Selector Validator (Week 2)
1. ✅ Todo 2.1: Add Fragile Selector Detection
2. ✅ Todo 2.2: Integrate AI Selector Validator

### Sprint 3: Element Finder (Week 3 - After Executor)
1. ✅ Todo 3.1: Create Failure Snapshot in Executor
2. ✅ Todo 3.2: Implement AI Element Finding

## Customer Value

**Before AI Reliability Features:**
- Fragile selectors recorded silently
- Workflows break when UI changes
- Manual fixes required
- Low success rate on dynamic pages

**After AI Reliability Features:**
- Fragile selectors caught and improved during recording
- Workflows self-heal when UI changes
- Higher success rate (70%+ recovery)
- Automatic reliability improvements
- Cost-effective: ~$1/month for 1000 workflows












