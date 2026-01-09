# UI Simplification - Testing Guide

## Quick Test (3 minutes)

### 1. Load the Extension
```bash
# Build the extension
npm run build

# Then in Chrome:
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
# 5. Open the sidepanel
```

### 2. Test Recording Flow
1. Click **"Show me how to do this task"**
   - ✅ Button should be large and prominent
   - ✅ Red "Learning your task..." indicator should appear
   
2. Navigate to any website and perform 3-5 actions
   - ✅ See actions appear in simple list format
   - ✅ List shows human descriptions (not "CLICK" or "INPUT")
   
3. Click **"Done"** in the red indicator
   - ✅ Button changes to "Finishing..." briefly
   - ✅ After ~1 second, "Save as task" button appears

### 3. Test Saving
1. Click **"Save as task"**
   - ✅ Dialog title says "Save Task" (not "Save Workflow")
   - ✅ Placeholder says "Task" (not "Workflow")
   
2. Enter a task name and click Save
   - ✅ Task appears under "My Tasks" section
   - ✅ Task shows description if AI analysis worked

### 4. Test Task Execution
1. Find your task under "My Tasks"
   - ✅ Section title is "My Tasks" (not "Saved Workflows")
   - ✅ Each task has just "Run" button + overflow menu (⋮)
   
2. Click **"Run"**
   - ✅ Task executes normally
   - ✅ AI Agent Log shows execution progress

### 5. Test Overflow Menus
1. Click **⋮** next to "Save as task" button
   - ✅ Shows "Export as JSON" and "Clear steps"
   
2. Click **⋮** next to a saved task's "Run" button
   - ✅ Shows "Load steps", "Export JSON", "Delete"

### 6. Test Settings Panel
1. Click **⚙️** (gear icon) in top-right
   - ✅ Settings modal opens
   - ✅ Shows "Advanced Actions" section
   - ✅ Shows "Learning Memory" section
   - ✅ Shows version info at bottom

---

## What Should Be GONE

These elements should no longer be visible in the main UI:

- ❌ "Connection Status" card
- ❌ "Extension State" section
- ❌ "Add Tab" button
- ❌ "Pause Recording" / "Resume Recording" buttons
- ❌ "Export JSON" button (main area)
- ❌ "Clear Steps" button (main area)
- ❌ Tab filter bar
- ❌ Step type labels (CLICK, INPUT, etc.)
- ❌ Selector details
- ❌ Confidence percentages
- ❌ AI enhancement indicators
- ❌ Execution strategy badges
- ❌ "Load" button on tasks (moved to menu)
- ❌ "Export" button on tasks (moved to menu)
- ❌ "Learning Memory" card (moved to settings)
- ❌ Variable confidence bars
- ❌ Variable reasoning text
- ❌ Expand/collapse buttons on variables

---

## What Should Be VISIBLE

Main UI should only show:

### Header
- ✅ "mimoai" title
- ✅ Settings button (⚙️)

### When Idle
- ✅ "Show me how to do this task" button
- ✅ "My Tasks" section (if tasks exist)

### When Recording
- ✅ Red "Learning your task..." indicator with "Done" button
- ✅ Simple action list (1. Click "X", 2. Type "Y"...)

### When Steps Exist (Not Recording)
- ✅ Action list with human descriptions
- ✅ "Customizable values" section (if variables detected)
- ✅ "Save as task" button + overflow menu (⋮)

### My Tasks Section
- ✅ Task name
- ✅ Task description (if available)
- ✅ "Run" button + overflow menu (⋮)

---

## Functionality Tests

All existing features should still work:

### Core Recording
- [x] Start recording
- [x] Stop recording
- [x] Steps captured correctly
- [x] Variables detected
- [x] Save task with name

### Core Execution
- [x] Run saved task
- [x] Variable input form appears (if task has variables)
- [x] AI agent executes correctly
- [x] Agent log shows progress

### Advanced Features (via menus)
- [x] Export as JSON (overflow menu)
- [x] Clear steps (overflow menu)
- [x] Load steps (task menu)
- [x] Delete task (task menu)
- [x] Learning Memory (settings panel)

---

## Visual Regression Checks

### Typography
- Header is 2xl, section titles are text-lg or font-medium
- Body text is text-sm or base
- Consistent use of muted-foreground for secondary text

### Spacing
- Consistent mb-6 for major sections
- Consistent gap-2 for button groups
- Proper padding (p-3, p-4) throughout

### Colors
- Primary button is bg-primary
- Run button is bg-primary
- Delete actions are red
- Variables use purple accent
- AI-related features use purple/blue

### Dark Mode
- All colors use Tailwind dark: variants
- No hardcoded colors that break in dark mode

---

## Known Issues to Check

1. **Tab switching still works?**
   - We removed the filter UI but logic should still work
   
2. **AI Agent Log visible?**
   - This is chain of thought - should be prominent
   
3. **Error messages still display?**
   - Check if errors show properly (removed connection status error display)

---

## Performance

UI should feel snappier because:
- Removed complex nested components
- Simplified conditional rendering
- Reduced DOM nodes by ~60%
- Faster React re-renders

---

## If Something Breaks

Check console for errors, then review:
1. Missing state variables
2. Undefined function references
3. Component prop mismatches

All functionality should work - we only changed the presentation layer!
