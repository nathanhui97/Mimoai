# AI Reliability Enhancement Plan - Recorder & Replayer

## Focus: Make Recorder and Replayer More Reliable Using AI

This plan focuses exclusively on using AI to improve the reliability of workflow recording and replay, with critical fixes for cost efficiency and privacy.

## Strategic Priorities

1. **Reliability First**: Prevent failures and enable self-healing
2. **Cost Efficiency**: Minimize API costs through DOM Distiller and selective usage
3. **Privacy Protection**: Scrub PII before any AI calls
4. **Customer Experience**: Users get more reliable workflows automatically

## Critical Fixes Applied

### Fix 1: Context Window Problem (DOM Distiller)
**Problem**: Sending full HTML (5MB+) hits token limits, costs $0.50+, and is slow (5-10s).

**Solution**: DOM Distiller - Clean HTML, extract candidates, truncate context.

### Fix 2: PII Risk (Privacy Shield)
**Problem**: Sending DOM with PII (names, emails, phone numbers) to OpenAI leaks sensitive data.

**Solution**: Client-side scrubbing before AI calls - scrub values, preserve labels.

## Phase 1: AI Selector Validator (During Recording)

### Purpose
Prevent fragile selectors from being recorded. Catch issues proactively before workflows break.

### When AI is Called
- **Selective**: Only when rule-based checks detect potentially fragile selectors
- **Async**: Non-blocking, doesn't slow down recording
- **Cached**: Similar selectors cached (e.g., all `:nth-child(8)` patterns)

### Cost Optimization
- Only call AI for flagged selectors (not every element)
- Cache validation results by selector pattern
- Use cheaper model (gpt-4o-mini) for validation
- **DOM Distiller**: Only send element context snippet, not full page
- **PII Scrubbing**: Scrub any PII from element context

### Implementation

**Files to Create:**
1. `src/lib/dom-distiller.ts` - Clean HTML, extract candidates
2. `src/lib/pii-scrubber.ts` - Scrub PII before AI calls
3. `src/lib/ai-service.ts` - AI API integration
4. `src/lib/ai-cache.ts` - Caching layer
5. `src/content/ai-selector-validator.ts` - Selector validation logic

**Integration Point:**
- In `src/content/selector-engine.ts`, after generating selectors
- Check if selector is potentially fragile
- If yes, call AI validator (async, non-blocking)

**Example Flow:**
```typescript
// In selector-engine.ts
if (this.isPotentiallyFragile(selectors.primary)) {
  // Extract small context snippet (not full HTML)
  const elementContext = this.extractElementContext(element);
  const scrubbedContext = PIIScrubber.scrubElement(elementContext);
  
  // Call AI async (non-blocking)
  AIService.validateSelector(selectors.primary, scrubbedContext)
    .then(validation => {
      if (!validation.isStable && validation.alternatives.length > 0) {
        // Add AI suggestions to fallbacks
        selectors.fallbacks.unshift(...validation.alternatives);
        console.log('AI: Found better selector alternatives');
      }
    })
    .catch(() => {
      // Fail silently - AI is enhancement, not required
    });
}
```

### What AI Validates
- Selector stability (will it break if UI changes?)
- Better alternatives (semantic selectors, role-based, etc.)
- Risk factors (dynamic IDs, position-based, etc.)

### Customer Value
- Proactive reliability: catch issues before they break
- Better selectors automatically added to fallbacks
- Users get more stable workflows without manual intervention

## Phase 2: AI Element Finder (During Replay - Fallback Only)

### Purpose
Self-healing workflows - find elements when all selectors fail during replay.

### When AI is Called
- **Only on failure**: When all selectors fail to find element
- **Rare**: Most workflows won't need this (< 5% of runs)
- **Cached**: Similar failures cached

### Cost Optimization
- Only called when absolutely necessary (failure case)
- Cache successful recoveries
- Use cheaper model for simple cases
- Timeout quickly (5s) to avoid wasted calls
- **DOM Distiller**: Send failure snapshot + candidates, not full HTML
- **PII Scrubbing**: Scrub all data before sending

### Implementation

**Files to Create/Modify:**
1. `src/lib/dom-distiller.ts` - Create failure snapshot with candidates
2. `src/lib/pii-scrubber.ts` - Scrub PII from snapshot
3. `src/lib/ai-service.ts` - AI element finding
4. `src/content/executor.ts` (Phase 3) - Integration point

**Critical Implementation: DOM Distiller for Element Finding**

```typescript
// src/lib/dom-distiller.ts
export class DOMDistiller {
  /**
   * Create a failure snapshot for AI element finding
   * Instead of sending 5MB HTML, send structured candidates
   */
  static createFailureSnapshot(
    step: WorkflowStep,
    currentDOM: Document
  ): FailureSnapshot {
    // 1. Extract target description
    const targetDescription = step.payload.elementText || 
                             step.payload.label || 
                             'target element';
    
    // 2. Find candidate elements (top 5-10 matches)
    const candidates = this.findCandidateElements(step, currentDOM);
    
    // 3. Extract relevant context (form/container) - truncated to ~500 tokens
    const context = this.extractRelevantContext(step, currentDOM);
    
    // 4. Scrub PII from all data
    return PIIScrubber.scrubSnapshot({
      targetDescription,
      candidates,
      context,
    });
  }
  
  private static findCandidateElements(
    step: WorkflowStep,
    doc: Document
  ): CandidateElement[] {
    // Find elements that might match:
    // - Same tag type (button, input, etc.)
    // - Similar text content
    // - Same role
    // Limit to top 5-10 candidates
    // Return structured data, not HTML
  }
}
```

**AI Element Finder:**

```typescript
// src/lib/ai-service.ts
class AIService {
  async findElementBySemantics(
    step: WorkflowStep,
    currentDOM: Document
  ): Promise<Element | null> {
    // Use DOM Distiller instead of raw HTML
    const snapshot = DOMDistiller.createFailureSnapshot(step, currentDOM);
    
    // Send to AI: "Target: 'Submit'. Candidates: [Button1: 'Submit Invoice', Button2: 'Cancel', ...]. Which matches?"
    // Much smaller payload (~500 tokens vs 50,000+)
    const result = await this.callAI({
      prompt: `Find the element matching: "${snapshot.targetDescription}"`,
      candidates: snapshot.candidates, // Structured, not HTML
      context: snapshot.context, // Truncated
    });
    
    // AI returns: "Candidate #3 matches" or selector
    return this.findElementFromResult(result, snapshot.candidates);
  }
}
```

**Integration in Executor (Phase 3):**

```typescript
// In executor, when element not found
async findElement(step: WorkflowStep): Promise<Element | null> {
  // Try all selectors first (rule-based, free)
  for (const selector of [step.payload.selector, ...step.payload.fallbackSelectors]) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  
  // Only if all fail, try AI (costs money, but rare)
  if (this.shouldUseAI(step)) {
    try {
      const element = await AIService.findElementBySemantics(step, document);
      if (element) {
        // Cache the successful recovery
        this.cacheRecovery(step, element);
        return element;
      }
    } catch (error) {
      // Fail gracefully - AI is enhancement
    }
  }
  
  return null;
}
```

### What AI Does
- Understands semantic meaning ("Submit" = "Send" = "Create")
- Matches candidates to target description
- Suggests alternative selectors
- Handles UI changes (button text changed, moved to modal, etc.)

### Customer Value
- Self-healing workflows when UI changes
- Higher success rate (70%+ recovery when selectors fail)
- Better user experience (fewer failures)
- Cost-effective: ~$0.001 per recovery (with DOM Distiller)

## Implementation Details

### File Structure
```
src/
  lib/
    ai-service.ts              # Main AI service (API calls)
    ai-cache.ts                # Caching layer
    ai-config.ts               # Configuration (API keys, models)
    dom-distiller.ts           # NEW: DOM cleaning and candidate extraction
    pii-scrubber.ts            # NEW: PII scrubbing
  content/
    ai-selector-validator.ts   # NEW: Selector validation integration
```

### DOM Distiller Implementation

```typescript
// src/lib/dom-distiller.ts
export interface CandidateElement {
  tag: string;
  text: string;
  role?: string;
  selector: string;
  attributes: Record<string, string>;
}

export interface FailureSnapshot {
  targetDescription: string;
  targetText?: string;
  candidates: CandidateElement[];
  context: string; // Truncated relevant section
}

export class DOMDistiller {
  /**
   * Extract element context (small snippet, not full HTML)
   */
  static extractElementContext(element: Element): string {
    // Get parent form/container
    // Extract only that section
    // Remove scripts/styles
    // Truncate to ~500 tokens
  }
  
  /**
   * Find candidate elements for AI matching
   */
  static findCandidateElements(
    step: WorkflowStep,
    doc: Document,
    maxCandidates: number = 10
  ): CandidateElement[] {
    const stepType = step.type;
    const targetText = step.payload.elementText || step.payload.label;
    
    // Find elements matching criteria
    let candidates: Element[] = [];
    
    if (stepType === 'CLICK') {
      // Find buttons, links, clickable elements
      candidates = Array.from(doc.querySelectorAll('button, a, [role="button"]'));
    } else if (stepType === 'INPUT') {
      // Find inputs, textareas
      candidates = Array.from(doc.querySelectorAll('input, textarea, select'));
    }
    
    // Filter by similarity (text, role, type)
    // Sort by relevance
    // Return top N as structured data
    return candidates.slice(0, maxCandidates).map(el => ({
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.trim() || '',
      role: el.getAttribute('role') || undefined,
      selector: SelectorEngine.generateSelectors(el).primary,
      attributes: this.extractAttributes(el),
    }));
  }
  
  /**
   * Extract relevant context (form, container) - truncated
   */
  static extractRelevantContext(
    step: WorkflowStep,
    doc: Document
  ): string {
    // Find parent form/container from step context
    const containerSelector = step.payload.context?.container?.selector;
    if (containerSelector) {
      const container = doc.querySelector(containerSelector);
      if (container) {
        // Extract container HTML, clean it, truncate
        return this.cleanAndTruncate(container.outerHTML, 2000);
      }
    }
    
    // Fallback: extract form if input step
    if (step.type === 'INPUT') {
      const form = doc.querySelector('form');
      if (form) {
        return this.cleanAndTruncate(form.outerHTML, 2000);
      }
    }
    
    return '';
  }
  
  private static cleanAndTruncate(html: string, maxTokens: number): string {
    // Remove scripts, styles, comments
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    
    // Truncate to maxTokens (rough estimate: 1 token ≈ 4 chars)
    const maxChars = maxTokens * 4;
    if (html.length > maxChars) {
      html = html.substring(0, maxChars) + '...';
    }
    
    return html;
  }
}
```

### PII Scrubber Implementation

```typescript
// src/lib/pii-scrubber.ts
export class PIIScrubber {
  /**
   * Scrub PII from text before sending to AI
   * Preserves labels but scrubs values
   */
  static scrub(text: string): string {
    if (!text) return text;
    
    // Email pattern: preserve "Enter Email" but scrub "john@example.com"
    text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
    
    // Phone numbers
    text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    text = text.replace(/\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    text = text.replace(/\b\+1\s?\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    
    // Credit cards (optional, but good for enterprise)
    text = text.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]');
    
    // SSN (optional)
    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
    
    return text;
  }
  
  /**
   * Scrub PII from element text
   */
  static scrubElement(element: Element): string {
    const text = element.textContent || '';
    return this.scrub(text);
  }
  
  /**
   * Scrub PII from failure snapshot
   */
  static scrubSnapshot(snapshot: FailureSnapshot): FailureSnapshot {
    return {
      targetDescription: this.scrub(snapshot.targetDescription),
      targetText: snapshot.targetText ? this.scrub(snapshot.targetText) : undefined,
      candidates: snapshot.candidates.map(c => ({
        ...c,
        text: this.scrub(c.text),
      })),
      context: this.scrub(snapshot.context),
    };
  }
  
  /**
   * Scrub PII from workflow step
   */
  static scrubStep(step: WorkflowStep): WorkflowStep {
    const scrubbed = { ...step };
    
    // Scrub value but keep label
    if (scrubbed.payload.value) {
      scrubbed.payload.value = this.scrub(scrubbed.payload.value);
    }
    
    // Scrub element text
    if (scrubbed.payload.elementText) {
      scrubbed.payload.elementText = this.scrub(scrubbed.payload.elementText);
    }
    
    // Scrub context text
    if (scrubbed.payload.context?.surroundingText) {
      scrubbed.payload.context.surroundingText = this.scrub(
        scrubbed.payload.context.surroundingText
      );
    }
    
    return scrubbed;
  }
}
```

### AI Service Implementation

```typescript
// src/lib/ai-service.ts
export interface SelectorValidation {
  isStable: boolean;
  confidence: number; // 0-1
  riskFactors: string[];
  alternatives: string[];
}

export interface ElementFindingResult {
  candidateIndex?: number;
  selector?: string;
  confidence: number;
  reasoning: string;
}

export class AIService {
  private cache: AICache;
  private config: AIConfig;
  
  /**
   * Validate selector stability
   */
  async validateSelector(
    selector: string,
    elementContext: string
  ): Promise<SelectorValidation> {
    const cacheKey = this.cache.generateKey({ selector, context: elementContext });
    
    return this.cache.getOrCompute(cacheKey, async () => {
      // Prepare prompt
      const prompt = `Analyze this CSS selector for stability:
Selector: ${selector}
Element Context: ${elementContext}

Is this selector stable? Will it break if the UI changes?
Return JSON with: isStable (boolean), confidence (0-1), riskFactors (string[]), alternatives (string[])`;
      
      // Call AI (use cheaper model)
      const response = await this.callAI(prompt, { model: 'gpt-4o-mini' });
      
      return this.parseValidationResponse(response);
    });
  }
  
  /**
   * Find element by semantics when selectors fail
   */
  async findElementBySemantics(
    step: WorkflowStep,
    currentDOM: Document
  ): Promise<Element | null> {
    // Create failure snapshot (DOM Distiller)
    const snapshot = DOMDistiller.createFailureSnapshot(step, currentDOM);
    
    // Scrub PII
    const scrubbed = PIIScrubber.scrubSnapshot(snapshot);
    
    const cacheKey = this.cache.generateKey({ step: step.payload.selector, snapshot });
    
    return this.cache.getOrCompute(cacheKey, async () => {
      // Prepare prompt
      const prompt = `Find the element matching this description:
Target: "${scrubbed.targetDescription}"
Target Text: "${scrubbed.targetText || 'N/A'}"

Candidates:
${scrubbed.candidates.map((c, i) => `${i + 1}. ${c.tag} - "${c.text}" (role: ${c.role || 'none'})`).join('\n')}

Context: ${scrubbed.context.substring(0, 500)}

Which candidate matches the target? Return JSON with: candidateIndex (number) or selector (string), confidence (0-1), reasoning (string)`;
      
      // Call AI
      const response = await this.callAI(prompt, { model: 'gpt-4o-mini' });
      const result = this.parseElementFindingResponse(response);
      
      // Find element from result
      if (result.candidateIndex !== undefined) {
        const candidate = scrubbed.candidates[result.candidateIndex];
        return currentDOM.querySelector(candidate.selector);
      } else if (result.selector) {
        return currentDOM.querySelector(result.selector);
      }
      
      return null;
    });
  }
  
  private async callAI(prompt: string, options: { model?: string }): Promise<string> {
    // Implement OpenAI/Anthropic API call
    // Handle rate limiting, retries, errors
  }
}
```

## Cost Estimates (With Fixes Applied)

### Per Recording Session
- **Selector Validation**: ~200 tokens = ~$0.0005
  - Only called for flagged selectors (maybe 1-2 per workflow)
  - Cached, so subsequent similar selectors are free
  - **Estimated**: $0.001 per workflow (if 2 validations needed)

### Per Replay Failure
- **Element Finding**: ~500 tokens = ~$0.001
  - Only when all selectors fail (< 5% of runs)
  - Cached, so similar failures are free
  - **Estimated**: $0.001 per failure

### Monthly Estimates (1000 workflows, 10% failure rate)
- **Recording**: 1000 workflows × $0.001 = $1/month
- **Replay Failures**: 100 failures × $0.001 = $0.10/month
- **Total**: ~$1.10/month for 1000 workflows

## Success Metrics

### Phase 1: Selector Validator
- ✅ Catches > 80% of fragile selectors during recording
- ✅ Suggests better alternatives in > 70% of cases
- ✅ Average cost per workflow < $0.002
- ✅ No performance impact (async, non-blocking)

### Phase 2: Element Finder
- ✅ Success rate > 70% when selectors fail
- ✅ Used in < 5% of workflow runs (most succeed without AI)
- ✅ Average cost per failure < $0.002
- ✅ Recovery time < 5 seconds

## Implementation Order

### Sprint 1: Foundation & Privacy
1. Create DOM Distiller utility
2. Create PII Scrubber utility
3. Create AI service infrastructure
4. Create AI cache
5. Add AI configuration

### Sprint 2: Selector Validator
1. Integrate AI Selector Validator into selector-engine.ts
2. Add fragile selector detection
3. Test with real workflows
4. Monitor costs and optimize

### Sprint 3: Element Finder (After Executor is Built)
1. Integrate AI Element Finder into executor
2. Add failure snapshot creation
3. Test recovery scenarios
4. Monitor success rate and costs

## Risk Mitigation

### Cost Overruns
- **Hard limits**: Max 1 AI call per selector validation, max 1 per element finding
- **Caching**: Aggressive caching to prevent duplicate calls
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

## Customer Value

**Before AI Reliability Features:**
- Fragile selectors recorded silently
- Workflows break when UI changes
- Manual fixes required
- Low success rate on UI changes

**After AI Reliability Features:**
- Fragile selectors caught and improved during recording
- Workflows self-heal when UI changes
- Higher success rate (70%+ recovery)
- Automatic reliability improvements
- Cost-effective: ~$1/month for 1000 workflows












