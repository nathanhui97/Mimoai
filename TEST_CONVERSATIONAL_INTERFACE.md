# Testing Conversational Interface

## Quick Start (3 minutes)

### 1. Reload Extension
```bash
# In Chrome:
1. Go to chrome://extensions
2. Find "mimoai"
3. Click reload 🔄
4. Open sidepanel
```

### 2. Test Search & Run Flow

**If you have saved tasks:**
```
1. Type in the input: "create" or "account"
2. Watch suggestions appear instantly
3. Click "Run" on any suggestion
4. See chain of thought as AI executes
```

**If you have NO saved tasks yet:**
```
1. Type anything in the input
2. See: "I don't know how to do that yet"
3. Click "Show me how"
4. Perform a task (any website)
5. Click "Done"
6. See auto-generated name in save dialog
7. Save and try searching for it
```

### 3. Test Auto-Generated Names

```
1. Click "or teach me something new"
2. Navigate to any site (e.g., Google)
3. Click search box
4. Type "hello world"
5. Click "Done"
6. Save dialog appears with name pre-filled:
   "Click 'Search' in field" or similar
7. Save (can edit name first)
8. Now search for it by typing "search" or "google"
```

## What to Test

### Search Functionality
- [ ] Type partial task name - suggestions appear
- [ ] Type exact task name - best match at top
- [ ] Type unknown task - "don't know" message
- [ ] Clear input - suggestions disappear
- [ ] Press Enter - runs best match

### Conversational Feel
- [ ] Input auto-focuses on load
- [ ] Placeholder text clear: "What would you like to do?"
- [ ] Results feel instant (300ms debounce)
- [ ] Highlighted matching text in results
- [ ] Secondary action subtle: "or teach me something new"

### Recording Flow
- [ ] Click "teach me something new" starts recording
- [ ] After stopping, save dialog auto-opens
- [ ] Name is auto-generated (not empty)
- [ ] Can edit name before saving
- [ ] Name is conversational (not technical)

### Auto-Naming
- [ ] Simple tasks get short names
- [ ] AI improves name if better than auto-generated
- [ ] Name is searchable after saving

## Example Test Scenarios

### Scenario 1: Search Existing Task
```
1. Type: "account"
2. Expect: See "Create Account" task
3. Click: "Run"
4. Expect: Workflow executes with thinking panel
```

### Scenario 2: Unknown Task
```
1. Type: "download report from dashboard"
2. Expect: "I don't know how to do that yet"
3. Click: "Show me how"
4. Expect: Recording starts
5. Demonstrate task
6. Expect: Auto-name appears in save dialog
```

### Scenario 3: Teach New Task
```
1. Click: "or teach me something new"
2. Expect: Recording starts immediately
3. Do 3-5 actions on any website
4. Click: "Done"
5. Expect: Save dialog with auto-generated name
6. Save
7. Type part of the name
8. Expect: Find the task you just saved
```

## Success Criteria

The conversational interface works if:
- ✅ Main input is the first thing you see
- ✅ Typing triggers instant search
- ✅ Matching tasks appear as suggestions
- ✅ Can run task with one click from suggestions
- ✅ Unknown tasks show helpful "teach me" prompt
- ✅ Auto-generated names are meaningful
- ✅ Entire flow feels natural and conversational

## Troubleshooting

### Search not working
```javascript
// Check in console:
await WorkflowStorage.searchWorkflows('test')
// Should return array of workflows
```

### Auto-name not appearing
```javascript
// Check in console after recording stops:
// Should see: "[App] 💡 Auto-generated task name: ..."
```

### Suggestions not updating
- Check React DevTools for `suggestions` state
- Verify `handleSearch` is called on input change
- Check 300ms debounce isn't blocking

## Known Behavior

- **Empty input**: Shows no suggestions (expected)
- **1-2 char input**: May not find matches (expected)
- **Recording**: Input is disabled (expected)
- **Auto-name**: May be technical if AI analysis fails (fallback)

## Report Results

After testing, note:
1. Does search work instantly?
2. Are suggestions relevant?
3. Does "I don't know" state show correctly?
4. Are auto-generated names good?
5. Any confusing UX?
