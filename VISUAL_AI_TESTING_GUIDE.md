# Visual AI Testing Guide

## Quick Start Testing

### 1. **Basic Visual Features Test** (5 minutes)

1. **Load the extension** and open the sidepanel
2. **Navigate to a form page** (e.g., Google Forms, a login page, or any form)
3. **Start recording** and perform a few actions:
   - Click a button
   - Fill in an input field
   - Submit the form
4. **Check the console** for visual analysis logs:
   - Look for: `🎨 GhostWriter: Analyzing page type...`
   - Look for: `🎨 GhostWriter: Page type: form confidence: 0.XX`
5. **Verify in sidepanel**: Steps should show page type information

**Expected Results:**
- Page type should be detected (form, dashboard, etc.)
- Visual snapshots should be captured
- No errors in console

---

### 2. **Visual Similarity Matching Test** (10 minutes)

**Scenario:** Element selector changes but element looks the same

1. **Record a workflow** on a page with dynamic selectors (e.g., React app)
2. **Stop recording** and note the selector used
3. **Refresh the page** (this may change selectors)
4. **Execute the workflow**
5. **Watch console** for:
   - `GhostWriter: Found element via visual similarity`
   - Strategy 10, 11, or 12 being used

**Expected Results:**
- Element should be found even if selector changed
- Visual similarity should match based on appearance
- Console should show which visual strategy succeeded

---

### 3. **Correction Memory & Learning Test** (15 minutes)

**Scenario:** Teach the extension to find elements correctly

1. **Record a workflow** with a step that might fail
2. **Execute the workflow** - let it fail to find an element
3. **In sidepanel**, check the "Learning Memory" section
4. **Manually correct** the element (if correction UI is triggered):
   - Click "Wrong element?" or similar
   - Select the correct element on the page
5. **Re-execute the workflow**
6. **Check console** for:
   - `GhostWriter: Found element via correction memory`
   - Strategy 8.5 being used

**Expected Results:**
- Correction should be saved
- Next execution should use the learned correction
- Success count should increment in Learning Memory

---

### 4. **Visual Wait Conditions Test** (10 minutes)

**Scenario:** Wait for visual changes after actions

1. **Record a workflow** that triggers:
   - A modal/dialog to appear
   - A loading spinner
   - A page transition
2. **Execute the workflow**
3. **Watch console** for:
   - `🔄 GhostWriter: Visual stability timeout` or success
   - `GhostWriter: Waiting for animation complete`

**Expected Results:**
- Execution should wait for visual stability
- Should not proceed too quickly after clicks
- Should handle animations gracefully

---

### 5. **Page Type Classification Test** (10 minutes)

**Test different page types:**

1. **Form Page:**
   - Navigate to a form (Google Forms, contact form, etc.)
   - Start recording
   - Check console: Should detect `page type: form`

2. **Dashboard Page:**
   - Navigate to a dashboard (analytics, admin panel, etc.)
   - Start recording
   - Check console: Should detect `page type: dashboard`

3. **Data Table:**
   - Navigate to a table/list page
   - Start recording
   - Check console: Should detect `page type: data_table`

**Expected Results:**
- Each page type should be correctly classified
- Confidence scores should be reasonable (>0.5)
- Page type should be stored in workflow steps

---

### 6. **Edge Functions Test** (Requires Supabase setup)

**Test each Edge Function:**

1. **Page Type Classification:**
   ```bash
   # Check Supabase logs after recording starts
   # Should see classify_page_type function called
   ```

2. **Visual Similarity:**
   - Trigger element finding with visual strategies
   - Check Supabase logs for `visual_similarity` calls

3. **Visual Analysis:**
   - Trigger importance scoring or context extraction
   - Check Supabase logs for `visual_analysis` calls

4. **Intent Analysis:**
   - Save a workflow
   - Check if intent analysis runs (may be async)

**Expected Results:**
- Edge Functions should be called
- Responses should be cached
- No 500 errors in Supabase logs

---

## Advanced Testing

### 7. **Performance & Caching Test**

1. **First run:** Record and execute a workflow
   - Note the time for visual analysis
   - Check console for API calls

2. **Second run:** Execute the same workflow again
   - Should see: `GhostWriter: Using cached AI recovery result`
   - Should see: `🖼️ GhostWriter: Visual cache hit`
   - Should be faster

**Expected Results:**
- Second run should be significantly faster
- Cache hits should be logged
- Visual cache should store results

---

### 8. **Error Handling & Graceful Degradation**

1. **Disable AI** in config:
   - Set `visualAnalysisEnabled: false`
   - Execute workflow
   - Should still work with fallback strategies

2. **Simulate API failure:**
   - Block Supabase requests (dev tools > Network > Block)
   - Execute workflow
   - Should fall back to non-visual strategies

3. **Test with slow network:**
   - Throttle network to "Slow 3G"
   - Execute workflow
   - Should handle timeouts gracefully

**Expected Results:**
- Should not crash on errors
- Should fall back to basic strategies
- Should show appropriate warnings

---

### 9. **Integration Test: Full Workflow**

**End-to-end test:**

1. **Record a complex workflow:**
   - Multiple page types
   - Forms, buttons, inputs
   - Navigation between pages

2. **Save the workflow**

3. **Execute the workflow:**
   - Should use visual strategies
   - Should use correction memory if available
   - Should wait for visual stability
   - Should handle page transitions

4. **Check all features:**
   - Page type classification ✓
   - Visual similarity matching ✓
   - Correction memory ✓
   - Visual wait conditions ✓
   - Intent analysis (if implemented) ✓

**Expected Results:**
- Workflow should execute successfully
- All visual features should be utilized
- Console should show comprehensive logging

---

## Debugging Tips

### Console Commands

```javascript
// Check visual cache
chrome.storage.local.get('ghostwriter_visual_cache', console.log);

// Check correction memory
chrome.storage.local.get('ghostwriter_corrections', console.log);

// Check AI config
chrome.storage.local.get('ghostwriter_ai_config', console.log);
```

### Key Logs to Watch For

**Success indicators:**
- `🎨 GhostWriter: Page type: [type] confidence: [0-1]`
- `GhostWriter: Found element via visual similarity`
- `GhostWriter: Found element via correction memory`
- `🖼️ GhostWriter: Visual cache hit`
- `✅ GhostWriter: Selector is stable`

**Warning indicators:**
- `⚠️ GhostWriter: Visual analysis failed` (fallback should work)
- `GhostWriter: AI recovery disabled` (if disabled)
- `Timeout waiting for visual condition` (may be expected)

**Error indicators:**
- `❌ GhostWriter: [error message]` (should investigate)
- Uncaught exceptions (should not happen)

---

## Common Issues & Solutions

### Issue: "Page type not detected"
**Solution:**
- Check if `visualAnalysisEnabled` is true in config
- Check Supabase Edge Function is deployed
- Check network tab for API calls
- Verify Gemini API key is set

### Issue: "Visual similarity not working"
**Solution:**
- Ensure visual snapshots are being captured
- Check `visual_similarity` Edge Function is deployed
- Verify candidates are being passed correctly
- Check console for specific errors

### Issue: "Correction memory not saving"
**Solution:**
- Check `correctionLearningEnabled` is true
- Verify chrome.storage.local permissions
- Check console for storage errors
- Ensure correction UI is properly triggered

### Issue: "Visual wait conditions timing out"
**Solution:**
- May be expected for slow-loading pages
- Check timeout values in visual-wait.ts
- Verify page is actually changing
- Check for JavaScript errors blocking execution

---

## Test Checklist

- [ ] Page type classification works
- [ ] Visual snapshots are captured
- [ ] Visual similarity matching finds elements
- [ ] Visual importance scoring works
- [ ] Visual context extraction works
- [ ] Correction memory saves corrections
- [ ] Correction memory applies learned patterns
- [ ] Visual wait conditions work
- [ ] Visual flow tracking captures before/after
- [ ] Caching reduces API calls
- [ ] Error handling works gracefully
- [ ] UI shows correction memory
- [ ] Edge Functions are called correctly
- [ ] Performance is acceptable
- [ ] No console errors

---

## Next Steps After Testing

1. **If all tests pass:** Ready for production! 🎉
2. **If issues found:** 
   - Check specific error messages
   - Review relevant code sections
   - Test individual components in isolation
   - Check Supabase logs for Edge Function issues

3. **Performance optimization:**
   - Monitor cache hit rates
   - Adjust timeout values if needed
   - Optimize screenshot quality/compression
   - Batch requests where possible








