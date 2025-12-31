# Phase 2: AI Selector Validator - Testing Guide

## Prerequisites

Before testing, ensure:

1. ✅ **Edge Function is deployed**:
   ```bash
   npx supabase functions deploy validate_selector
   ```
   Verify in Supabase dashboard: Functions > validate_selector should show "Active"

2. ✅ **GEMINI_API_KEY is set**:
   ```bash
   npx supabase secrets list
   ```
   Should show `GEMINI_API_KEY` in the list

3. ✅ **Extension is built**:
   ```bash
   npm run build
   ```

4. ✅ **Extension is loaded** in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder (or your build output)

## Test 1: Basic Fragile Selector Detection

### Goal
Verify that fragile selectors trigger AI validation.

### Steps

1. **Open a test page** with multiple similar elements (e.g., a list, dashboard with widgets)
   - Good test sites: 
     - A page with a list of items (each item has similar structure)
     - A dashboard with multiple cards/widgets
     - A form with multiple input fields

2. **Open Chrome DevTools** (F12) and go to Console tab

3. **Start recording** in the GhostWriter side panel

4. **Click on an element** that will likely generate a fragile selector:
   - An element in a list (e.g., 5th item in a list)
   - A button in a grid (e.g., 3rd button in a row)
   - An element with a dynamic ID (e.g., `#w5`, `#react-123`)

5. **Check console logs** for:
   ```
   GhostWriter: Recording step with fragile primary selector (stability: 0.XX): [selector]
   GhostWriter: Fallback selectors available: X
   ```

6. **Wait 1-2 seconds** and check for AI validation logs:
   ```
   GhostWriter: AI injected robust selectors for step [timestamp] - X alternatives added
   ```

### Expected Results

- ✅ Console shows fragile selector warning
- ✅ AI validation is triggered (check Network tab for request to `validate_selector`)
- ✅ Console shows success message with number of alternatives added
- ✅ Step in side panel shows updated fallback selectors

### Verification

1. **Check Network tab** in DevTools:
   - Filter by "validate_selector"
   - Should see POST request to Supabase Edge Function
   - Response should contain `{ isStable: false, alternatives: [...] }`

2. **Check side panel**:
   - Click on the recorded step
   - Check `fallbackSelectors` array
   - AI suggestions should be at the front of the array

3. **Export workflow JSON**:
   - Stop recording
   - Export the workflow
   - Check JSON: `fallbackSelectors` should include AI-suggested selectors

## Test 2: Stable Selector (No AI Validation)

### Goal
Verify that stable selectors don't trigger unnecessary AI calls.

### Steps

1. **Start recording**

2. **Click on an element** with a stable selector:
   - Element with a unique, semantic ID (e.g., `#submit-button`)
   - Element with unique text (e.g., button with text "Submit")
   - Element with stable data attribute (e.g., `[data-testid="submit"]`)

3. **Check console logs**:
   - Should NOT see "fragile primary selector" warning
   - Should NOT see AI validation logs
   - Should NOT see network request to `validate_selector`

### Expected Results

- ✅ No fragile selector warning
- ✅ No AI validation triggered
- ✅ No network request to `validate_selector`
- ✅ Step recorded normally

## Test 3: AI Validation Timing (Reference Mutation Pattern)

### Goal
Verify that steps are sent immediately and updated later when AI returns.

### Steps

1. **Start recording**

2. **Click on fragile element** (e.g., 5th item in a list)

3. **Immediately check side panel**:
   - Step should appear instantly (before AI returns)
   - Step should have original fallback selectors

4. **Wait 1-2 seconds**:
   - Step should update (AI suggestions added)
   - Check console for "AI injected robust selectors" message

5. **Stop recording**:
   - Should wait up to 2 seconds for pending validations
   - Check console for "Recording stopped" message

### Expected Results

- ✅ Step appears immediately in side panel
- ✅ Step updates after AI returns (1-2 seconds later)
- ✅ Stop recording waits for validations (check timing in console)

### Verification

1. **Check console timing**:
   ```
   [timestamp] GhostWriter: Sending step...
   [timestamp + 50ms] GhostWriter: AI validation triggered
   [timestamp + 1500ms] GhostWriter: AI injected robust selectors...
   [timestamp + 2000ms] GhostWriter: Recording stopped
   ```

## Test 4: Multiple Fragile Selectors

### Goal
Verify that multiple fragile selectors are validated correctly.

### Steps

1. **Start recording**

2. **Click on 3-5 fragile elements** in sequence:
   - Each should trigger AI validation
   - Each should update independently

3. **Check console logs**:
   - Should see multiple "AI injected robust selectors" messages
   - Each with different step timestamps

4. **Stop recording**:
   - Should wait for all pending validations
   - All steps should have AI suggestions

### Expected Results

- ✅ Multiple AI validations triggered
- ✅ All steps updated with AI suggestions
- ✅ Stop recording waits for all validations

## Test 5: Network Error Handling

### Goal
Verify that AI validation failures don't break recording.

### Steps

1. **Disable network** (or block Supabase domain):
   - Chrome DevTools > Network tab > Throttling > Offline
   - Or use extension to block `*.supabase.co`

2. **Start recording**

3. **Click on fragile element**

4. **Check console logs**:
   - Should see fragile selector warning
   - Should see AI validation attempt
   - Should see error/warning (but not crash)
   - Recording should continue normally

5. **Re-enable network**

6. **Click another fragile element**:
   - Should work normally now

### Expected Results

- ✅ Recording continues even if AI fails
- ✅ Error logged but doesn't crash
- ✅ Subsequent validations work after network restored

## Test 6: Cache Verification

### Goal
Verify that caching works (second validation should be faster).

### Steps

1. **Start recording**

2. **Click on fragile element A** (e.g., 5th list item)
   - Note the timestamp in console
   - Wait for AI validation to complete

3. **Click on similar fragile element B** (e.g., 6th list item with similar structure)
   - Note the timestamp

4. **Check console logs**:
   - First validation: Should see network request
   - Second validation: Should see "Using cached selector validation result"

### Expected Results

- ✅ First validation makes network request
- ✅ Second validation uses cache (faster, no network request)
- ✅ Console shows "Using cached selector validation result"

## Test 7: Stop Recording Guardrail

### Goal
Verify that `stop()` waits for pending validations.

### Steps

1. **Start recording**

2. **Click on fragile element**

3. **Immediately click "Stop Recording"** (before AI returns)

4. **Check console logs**:
   - Should see "Recording stopped" message
   - Should wait up to 2 seconds for validation
   - Should see "AI injected robust selectors" before final stop

5. **Export workflow**:
   - Check that step has AI suggestions (even though stop was clicked quickly)

### Expected Results

- ✅ Stop waits for pending validations (max 2s)
- ✅ AI suggestions are captured before save
- ✅ Step in exported workflow includes AI suggestions

## Test 8: AI Disabled (Feature Flag)

### Goal
Verify graceful degradation when AI is disabled.

### Steps

1. **Disable AI** in `src/lib/ai-config.ts`:
   ```typescript
   enabled: false,
   ```

2. **Rebuild extension**:
   ```bash
   npm run build
   ```

3. **Reload extension** in Chrome

4. **Start recording**

5. **Click on fragile element**

6. **Check console logs**:
   - Should see fragile selector warning
   - Should see "AI validation disabled" message
   - Should NOT see AI validation attempt

### Expected Results

- ✅ No AI validation triggered
- ✅ Recording continues normally
- ✅ No errors or crashes

## Test 9: Edge Function Response Parsing

### Goal
Verify that AI suggestions are correctly parsed and added.

### Steps

1. **Start recording**

2. **Click on fragile element**

3. **Check Network tab**:
   - Find request to `validate_selector`
   - Check response payload:
     ```json
     {
       "isStable": false,
       "alternatives": ["selector1", "selector2", "selector3"],
       "reasoning": "...",
       "confidence": 0.8
     }
     ```

4. **Check side panel**:
   - Step's `fallbackSelectors` should start with AI alternatives
   - Original fallbacks should follow

### Expected Results

- ✅ Response contains valid alternatives array
- ✅ Alternatives are prepended to fallback selectors
- ✅ Original fallbacks preserved

## Test 10: Integration with Phase 3 (Element Finder)

### Goal
Verify that Phase 2 and Phase 3 work together.

### Steps

1. **Record workflow** with fragile selectors (Phase 2 improves them)

2. **Modify UI** (change button text, move elements)

3. **Replay workflow**:
   - Original selectors should work (improved by Phase 2)
   - If they fail, Phase 3 should recover

### Expected Results

- ✅ Phase 2 improves selectors during recording
- ✅ Improved selectors work during replay
- ✅ If they still fail, Phase 3 recovers

## Debugging Tips

### Console Logs to Watch For

**Success indicators:**
```
GhostWriter: Recording step with fragile primary selector...
GhostWriter: AI injected robust selectors for step [timestamp] - X alternatives added
GhostWriter: Using cached selector validation result
```

**Error indicators:**
```
GhostWriter: Selector validation failed: [error]
GhostWriter: AI validation disabled
GhostWriter: Supabase Edge Function error: [error]
```

### Network Tab Checks

1. **Filter by "validate_selector"**:
   - Should see POST requests when fragile selectors detected
   - Status should be 200 (success)
   - Response should contain `alternatives` array

2. **Check request payload**:
   ```json
   {
     "selector": "button:nth-child(8)",
     "elementContext": "<button>...</button>",
     "pageContext": {
       "title": "Page Title",
       "url": "https://example.com"
     }
   }
   ```

3. **Check response**:
   ```json
   {
     "isStable": false,
     "alternatives": ["selector1", "selector2"],
     "reasoning": "This selector is fragile because...",
     "confidence": 0.8
   }
   ```

### Common Issues

1. **No AI validation triggered**:
   - Check that selector is actually fragile (`isPotentiallyFragile()` returns true)
   - Check console for fragile selector warning
   - Verify AI is enabled in config

2. **AI validation fails**:
   - Check Network tab for Edge Function errors
   - Verify Edge Function is deployed
   - Check GEMINI_API_KEY is set
   - Check console for error messages

3. **Step not updating**:
   - Check that `UPDATE_STEP` message is sent (Network tab)
   - Verify side panel handler is working
   - Check store `updateWorkflowStep()` method

4. **Stop recording hangs**:
   - Check that `pendingValidations` array is cleared
   - Verify timeout (2s) is working
   - Check console for validation completion

## Success Criteria Checklist

- [ ] Fragile selectors trigger AI validation
- [ ] Stable selectors don't trigger AI validation
- [ ] Steps sent immediately, updated when AI returns
- [ ] Multiple fragile selectors validated correctly
- [ ] Network errors handled gracefully
- [ ] Caching works (second validation faster)
- [ ] Stop recording waits for validations
- [ ] AI disabled gracefully
- [ ] AI suggestions correctly parsed and added
- [ ] Integration with Phase 3 works

## Next Steps After Testing

1. **If all tests pass**: Deploy to production
2. **If issues found**: 
   - Check console logs for errors
   - Verify Edge Function deployment
   - Check Supabase configuration
   - Review implementation against plan

3. **Monitor in production**:
   - Track AI validation success rate
   - Monitor costs (should be < $0.002 per workflow)
   - Check console for errors
   - Verify selectors are actually improved

---

**Testing Date**: [Fill in when testing]
**Tester**: [Your name]
**Results**: [Pass/Fail for each test]








