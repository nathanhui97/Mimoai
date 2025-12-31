# Clear Visual Click Cache

The bad cached response needs to be cleared before testing again.

## Run This in Browser Console (on Salesforce page):

```javascript
// Clear all AI cache including visual click cache
(async () => {
  const all = await chrome.storage.local.get(null);
  const aiKeys = Object.keys(all).filter(key => key.startsWith('ai_cache_'));
  console.log('Found', aiKeys.length, 'AI cache entries');
  
  if (aiKeys.length > 0) {
    await chrome.storage.local.remove(aiKeys);
    console.log('✅ Cleared', aiKeys.length, 'AI cache entries');
  }
  
  console.log('✅ Cache cleared! Reload the page to test again.');
})();
```

## Then:

1. **Reload the Salesforce page**: Press F5 or Cmd+R
2. **Try executing the workflow again**
3. **Check console for new logs**:
   ```
   [AIVisualClick] Full API response: { ... }
   ```

## What's Fixed

The Edge Function now:
- ✅ Uses **Gemini 1.5 Pro** (better vision + JSON support)
- ✅ Forces **JSON response mode** (`responseMimeType: 'application/json'`)
- ✅ Handles **multiple JSON formats** (direct, nested, strings)
- ✅ Extracts coordinates from text as fallback
- ✅ Logs **raw Gemini response** for debugging
- ✅ Better **error messages** with response preview

## What You'll See

With the new logging, you'll see:

```
=== GEMINI RAW RESPONSE ===
Full response text: { "coordinates": { "x": 561, "y": 636 }, ... }
Response length: 145
===========================
Extracted JSON string: { "coordinates": { "x": 561, "y": 636 }, ... }
Parsed object: { ... }
```

This will show us exactly what Gemini is returning and whether it's finding the button correctly!




