# Intent Optimization Testing Guide

## Overview
This guide helps verify that the API optimization and intent storage are working correctly - from recording to execution.

---

## Testing Checklist

### ✅ Phase 1: Recording & Saving (Intent Analysis)

**What to Test:** Verify that `analyze_intent` returns step translations in ONE API call

**Steps:**
1. Open Chrome DevTools → Network tab
2. Filter by "analyze_intent"
3. Record a simple 3-5 step workflow (e.g., fill a form)
4. Click "Stop Recording"
5. Click "Save Workflow"

**Expected Behavior:**
- ✅ **ONE** call to `analyze_intent` (not multiple `translate_step` calls)
- ✅ Console shows: `"✨ Applying X step translations"`
- ✅ Console shows: `"Sample translation: { intent: '...', precondition: '...', expectedOutcome: '...', dependencies: [...] }"`

**Check Console Logs:**
```javascript
// Open Console and look for:
[SaveWorkflow] Analyzing workflow intent (includes step translations)...
[SaveWorkflow] Generated description: ...
[SaveWorkflow] ✨ Applying 5 step translations
[SaveWorkflow] Sample translation: { intent: "...", precondition: "...", expectedOutcome: "...", dependencies: [] }
```

**Verify in Network Tab:**
1. Click on the `analyze_intent` request
2. Go to Response tab
3. Look for `intent.stepTranslations` array
4. Should see one entry per workflow step with `intent`, `precondition`, `expectedOutcome`, `dependencies`

**Example Response:**
```json
{
  "intent": {
    "primaryGoal": "Fill out contact form and submit",
    "subGoals": ["Enter name", "Enter email", "Click submit"],
    "expectedOutcome": "Form submitted successfully",
    "confidence": 0.85,
    "stepTranslations": [
      {
        "stepIndex": 0,
        "intent": "Navigate to contact page",
        "precondition": "Browser is open",
        "expectedOutcome": "Contact page loads",
        "dependencies": []
      },
      {
        "stepIndex": 1,
        "intent": "Enter user's name",
        "precondition": "Contact form is visible",
        "expectedOutcome": "Name field contains entered value",
        "dependencies": [0]
      }
    ]
  }
}
```

---

### ✅ Phase 2: Storage Verification (Workflow Data)

**What to Test:** Verify that full intent (including stepTranslations) is saved

**Steps:**
1. After saving a workflow, open Console
2. Run this command:

```javascript
// Get the most recently saved workflow
chrome.storage.local.get('workflows', (result) => {
  const workflows = result.workflows || [];
  const latest = workflows[workflows.length - 1];
  
  console.log('=== WORKFLOW STORAGE VERIFICATION ===');
  console.log('Workflow Name:', latest.name);
  console.log('Has analyzedIntent?', !!latest.analyzedIntent);
  console.log('Primary Goal:', latest.analyzedIntent?.primaryGoal);
  console.log('Expected Outcome:', latest.analyzedIntent?.expectedOutcome);
  console.log('Sub-Goals Count:', latest.analyzedIntent?.subGoals?.length);
  console.log('Step Translations Count:', latest.analyzedIntent?.stepTranslations?.length);
  console.log('Workflow Steps Count:', latest.steps?.length);
  
  // Check if steps have naturalLanguage
  const stepsWithNL = latest.steps.filter(s => s.naturalLanguage).length;
  console.log('Steps with naturalLanguage:', stepsWithNL);
  
  // Show sample step
  if (latest.steps[0]?.naturalLanguage) {
    console.log('Sample Step NL:', latest.steps[0].naturalLanguage);
  }
  
  console.log('\n=== FULL ANALYZED INTENT ===');
  console.log(JSON.stringify(latest.analyzedIntent, null, 2));
});
```

**Expected Output:**
```
=== WORKFLOW STORAGE VERIFICATION ===
Workflow Name: Fill Contact Form
Has analyzedIntent? true
Primary Goal: Fill out contact form and submit
Expected Outcome: Form submitted successfully with confirmation
Sub-Goals Count: 3
Step Translations Count: 5
Workflow Steps Count: 5
Steps with naturalLanguage: 5
Sample Step NL: {
  intent: "Navigate to contact page",
  precondition: "Browser is open",
  expectedOutcome: "Contact page loads successfully",
  dependencies: []
}
```

---

### ✅ Phase 3: Execution (AI Agent)

**What to Test:** Verify that intent data reaches the AI agent and dom_agent Edge Function

**Steps:**
1. Select a saved workflow with variables (or without)
2. Click "Run Workflow"
3. Open Console and watch for logs

**Expected Console Logs:**

```javascript
// 1. Agent initialization with intent
[AIAgent] Starting workflow execution
[AIAgent] Goal: Fill Contact Form - Submit contact information
[AIAgent] Hints: 5 steps

// 2. State should include analyzedIntent
// Look for this in the agent state logs
```

**Verify Intent is Passed to dom_agent:**

Add this temporary logging in Console during execution:

```javascript
// Intercept fetch calls to dom_agent
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const [url, options] = args;
  
  if (url.includes('dom_agent')) {
    const body = JSON.parse(options.body);
    
    console.log('=== DOM_AGENT REQUEST ===');
    console.log('Has analyzedIntent?', !!body.analyzedIntent);
    if (body.analyzedIntent) {
      console.log('Primary Goal:', body.analyzedIntent.primaryGoal);
      console.log('Expected Outcome:', body.analyzedIntent.expectedOutcome);
      console.log('Confidence:', body.analyzedIntent.confidence);
      console.log('Sub-Goals:', body.analyzedIntent.subGoals);
      console.log('Failure Patterns:', body.analyzedIntent.failurePatterns);
    }
  }
  
  return originalFetch.apply(this, args);
};
```

**Expected Output:**
```
=== DOM_AGENT REQUEST ===
Has analyzedIntent? true
Primary Goal: Fill out contact form and submit
Expected Outcome: Form submitted successfully with confirmation
Confidence: 0.85
Sub-Goals: ["Navigate to contact page", "Enter name", "Enter email", "Click submit button"]
Failure Patterns: [{description: "Form validation error", visualIndicator: "Red error text"}]
```

---

### ✅ Phase 4: Edge Function Prompt (LLM Context)

**What to Test:** Verify that intent appears in the Gemini prompt

**Steps:**
1. Go to Supabase Dashboard → Edge Functions → Logs
2. Filter for `dom_agent` function
3. Run a workflow
4. Check the logs for the prompt sent to Gemini

**Expected in Logs:**
```
## 🧠 WORKFLOW INTENT (AI-Analyzed)
**Primary Goal:** Fill out contact form and submit
**Expected Outcome:** Form submitted successfully with confirmation
**Confidence:** 85%

**Checkpoints:**
1. Navigate to contact page
2. Enter name
3. Enter email
4. Click submit button

**Watch For:**
- Form validation error (look for: Red error text near fields)
- Page timeout (look for: Loading spinner stuck)

Use this understanding to make smarter decisions:
- Skip steps if expectedOutcome is already achieved
- Recognize failure patterns early and attempt recovery
- Prioritize actions that advance toward the primaryGoal
```

**Alternative: Add Local Logging**

To see the prompt without checking Supabase, temporarily add this to `supabase/functions/dom_agent/index.ts`:

```typescript
// After buildAgentPrompt() call (around line 360)
const prompt = buildAgentPrompt(payload);
console.log('=== FULL PROMPT TO GEMINI ===');
console.log(prompt);
console.log('=== END PROMPT ===');
```

---

### ✅ Phase 5: Outcome Verification

**What to Test:** Verify that workflow completion triggers outcome verification

**Steps:**
1. Run a workflow to completion
2. Check Console for outcome verification logs

**Expected Console Logs:**
```javascript
[AIAgent] ✅ All hints completed (5/5) or reached end of workflow
[AIAgent] Outcome verification: ✅ Found "success" on page
// OR
[AIAgent] Outcome verification: ✅ URL indicates confirmation page
// OR
[AIAgent] Outcome verification: ⚠️ Outcome not yet verified
```

---

## Quick Smoke Test (5 minutes)

**Simple workflow to test everything:**

1. **Record this workflow:**
   - Navigate to `https://httpbin.org/forms/post`
   - Enter "Test User" in "Customer name"
   - Enter "test@example.com" in "Email"
   - Click "Submit order"

2. **Save workflow** as "Test Form Submission"

3. **Check Console for:**
   ```
   ✅ [SaveWorkflow] ✨ Applying 4 step translations
   ✅ [SaveWorkflow] Sample translation: { intent: "...", ... }
   ```

4. **Verify storage:**
   ```javascript
   chrome.storage.local.get('workflows', (r) => {
     const w = r.workflows[r.workflows.length - 1];
     console.log('Has intent?', !!w.analyzedIntent);
     console.log('Has stepTranslations?', !!w.analyzedIntent?.stepTranslations);
   });
   ```

5. **Run the workflow:**
   - Watch Console for: `[AIAgent] Outcome verification: ...`

---

## Performance Comparison

**Before Optimization:**
- API Calls: 1 (intent) + N (translations) = 11 calls for 10-step workflow
- Time: ~5-6 seconds
- Tokens: ~15,000

**After Optimization:**
- API Calls: 1 (everything merged)
- Time: ~0.5 seconds
- Tokens: ~3,000

**To Measure:**
1. Open Network tab
2. Record and save a 10-step workflow
3. Count `analyze_intent` calls: Should be **1**
4. Count `translate_step` calls: Should be **0**
5. Check timing: Should complete in < 1 second

---

## Troubleshooting

### Issue: No stepTranslations in response

**Check:**
1. Is Gemini API key set? (Supabase Dashboard → Edge Functions → Secrets)
2. Check `analyze_intent` response in Network tab - does it have `stepTranslations`?
3. Check Supabase logs for errors

### Issue: Steps don't have naturalLanguage

**Check:**
1. Console should show: `"✨ Applying X step translations"`
2. If not, check if `intentAnalysis.intent.stepTranslations` is undefined
3. Verify `analyze_intent` Edge Function is returning the data

### Issue: Intent not passed to dom_agent

**Check:**
1. Run the fetch interceptor code above
2. Verify `workflow.analyzedIntent` is set in storage
3. Check if `AgentState` has `analyzedIntent` populated

---

## Success Criteria

✅ **API Optimization Working:**
- Only 1 call to `analyze_intent` (not N+1 calls)
- Network tab shows no `translate_step` calls
- Save completes in < 1 second for 10-step workflow

✅ **Data Flow Working:**
- `analyzedIntent` stored in workflow
- `stepTranslations` applied to steps
- Steps have `naturalLanguage` property

✅ **AI Agent Enhanced:**
- Intent passed to `dom_agent` Edge Function
- Prompt includes "WORKFLOW INTENT" section
- Outcome verification runs on completion

✅ **Semantic Understanding:**
- AI can describe primary goal
- AI knows expected outcome
- AI recognizes failure patterns
- AI makes context-aware decisions
