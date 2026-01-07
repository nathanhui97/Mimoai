# Copy/Paste Recording - Testing Guide

## Overview

This guide provides comprehensive testing instructions for the new copy/paste keyboard shortcut recording feature.

## Prerequisites

1. **Reload Extension**: Go to `chrome://extensions` and click the reload button for your extension
2. **Hard Refresh**: Open a test webpage and do a hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
3. **Open DevTools**: Press F12 to monitor console logs

## Test Scenarios

### Test 1: Copy from Regular Text (Basic)

**Steps:**
1. Start recording in the extension
2. Navigate to any webpage with text
3. Select some text (e.g., an email address, phone number, or name)
4. Press `Ctrl+C` (Windows/Linux) or `Cmd+C` (Mac)
5. Stop recording

**Expected Results:**
- ✅ Console shows: `📋 GhostWriter Copy Detected: [text]`
- ✅ Console shows: `📋 GhostWriter: Copy keyboard shortcut detected, adding clipboard metadata`
- ✅ A KEYBOARD step appears in the workflow list
- ✅ Step should have an AI-generated description like:
  - "Copy email address from contact field" (if email)
  - "Copy contact name" (if name)
  - "Copy phone number" (if phone)
  - "Copy text: [first 20 chars]" (if generic text)

### Test 2: Copy from Input Field

**Steps:**
1. Start recording
2. Navigate to a form with input fields
3. Type or paste text into an input field
4. Select the text in the input field
5. Press `Ctrl+C` / `Cmd+C`
6. Stop recording

**Expected Results:**
- ✅ KEYBOARD step recorded with copy metadata
- ✅ AI description includes semantic meaning of the data

### Test 3: Paste into Input Field

**Steps:**
1. Start recording
2. Copy some text first (outside recording or during recording)
3. Navigate to a form
4. Click on an input field
5. Press `Ctrl+V` (Windows/Linux) or `Cmd+V` (Mac)
6. Stop recording

**Expected Results:**
- ✅ Console shows: `📋 GhostWriter: Paste keyboard shortcut detected, adding clipboard metadata`
- ✅ Console shows: `📋 GhostWriter: Paste detected` (from paste event listener)
- ✅ A KEYBOARD step appears in the workflow list
- ✅ Step includes clipboard metadata linking to previously copied data
- ✅ AI description should be like:
  - "Paste email address into contact form"
  - "Paste copied name into name field"
  - "Paste phone number into phone field"

### Test 4: Copy-Paste Sequence

**Steps:**
1. Start recording
2. Navigate to a page with text (e.g., contact information)
3. Select and copy an email address (`Ctrl+C` / `Cmd+C`)
4. Navigate to a form
5. Click on an email input field
6. Paste (`Ctrl+V` / `Cmd+V`)
7. Stop recording

**Expected Results:**
- ✅ Two KEYBOARD steps recorded (one for copy, one for paste)
- ✅ Both steps include clipboard metadata
- ✅ Paste step references the same clipboard data as the copy step
- ✅ AI descriptions are semantically meaningful:
  - Copy step: "Copy email address from contact section"
  - Paste step: "Paste email address into email field"

### Test 5: Cross-Platform Testing

**Windows/Linux:**
- Test with `Ctrl+C` and `Ctrl+V`
- Verify modifiers are recorded as `ctrl: true`

**Mac:**
- Test with `Cmd+C` and `Cmd+V`
- Verify modifiers are recorded as `meta: true`

**Expected Results:**
- ✅ Both platforms create KEYBOARD steps correctly
- ✅ Correct modifier keys are captured
- ✅ AI descriptions are identical across platforms

### Test 6: Edge Cases

#### Test 6a: Shift+Ctrl+C / Shift+Cmd+C (Should NOT Record)
**Steps:**
1. Start recording
2. Select text
3. Press `Shift+Ctrl+C` (or `Shift+Cmd+C`)

**Expected Results:**
- ❌ No KEYBOARD step should be created (this is a different shortcut)

#### Test 6b: Ctrl+Shift+V / Cmd+Shift+V (Paste without formatting - Should NOT Record)
**Steps:**
1. Start recording
2. Copy some text
3. Press `Ctrl+Shift+V` (or `Cmd+Shift+V`)

**Expected Results:**
- ❌ No KEYBOARD step should be created

#### Test 6c: Copy with No Selection
**Steps:**
1. Start recording
2. Press `Ctrl+C` / `Cmd+C` without selecting any text

**Expected Results:**
- ✅ KEYBOARD step may still be created
- ⚠️ Clipboard metadata may be empty or missing

#### Test 6d: Paste into Non-Editable Element
**Steps:**
1. Start recording
2. Copy some text
3. Click on regular page content (not an input)
4. Press `Ctrl+V` / `Cmd+V`

**Expected Results:**
- ✅ KEYBOARD step should still be created
- ✅ Clipboard metadata should be present

### Test 7: Data Lineage Tracking

**Steps:**
1. Start recording
2. Copy text from Element A
3. Wait 1 minute
4. Paste into Element B
5. Copy the same text again
6. Paste into Element C (within 10 minutes of second copy)

**Expected Results:**
- ✅ First paste links to first copy
- ✅ Second paste links to second copy
- ✅ Clipboard metadata includes timestamp
- ✅ Clipboard data expires after 10 minutes

### Test 8: Long Text Truncation

**Steps:**
1. Start recording
2. Copy a very long text (>500 characters)
3. Paste it somewhere

**Expected Results:**
- ✅ Clipboard metadata truncates text to 500 chars
- ✅ Truncated text ends with "..."
- ✅ AI description still provides semantic reasoning

### Test 9: Multi-Tab Copy/Paste

**Steps:**
1. Start recording
2. On Tab 1: Copy text
3. Switch to Tab 2
4. Paste the text
5. Stop recording

**Expected Results:**
- ✅ Copy step recorded on Tab 1
- ✅ Paste step recorded on Tab 2
- ✅ Both steps linked via clipboard metadata
- ✅ Tab switching step recorded between them

## Console Log Checks

When testing, verify these console messages appear:

### For Copy Operations:
```
📋 GhostWriter Copy Detected: [text] from [selector]
GhostWriter: Clipboard data stored: { textLength: ..., sourceSelector: ..., url: ... }
📋 GhostWriter: Copy keyboard shortcut detected, adding clipboard metadata
```

### For Paste Operations:
```
📋 GhostWriter: Paste keyboard shortcut detected, adding clipboard metadata
📋 GhostWriter: Paste detected: { textLength: ..., targetSelector: ..., targetTag: ... }
```

### For AI Description Generation:
```
📝 GhostWriter: Generated description for step: "[description]"
```

## Verifying AI Descriptions

Good AI descriptions should:
- ✅ Be specific about what data was copied/pasted
- ✅ Include semantic meaning (email, phone, name, etc.)
- ✅ For paste: Include both WHAT and WHERE
- ✅ Be concise (5-15 words)

**Examples of Good Descriptions:**
- "Copy email address from contact field"
- "Copy phone number"
- "Paste copied email into email field"
- "Paste name into name field"

**Examples of Bad Descriptions (Should NOT See):**
- "Copy" (too generic)
- "Paste" (too generic)
- "Press c" (misses the semantic meaning)
- "Press v" (misses the semantic meaning)

## Workflow Replay Testing

After recording a workflow with copy/paste:

1. **Save the workflow**
2. **Replay the workflow**
3. **Verify:**
   - ✅ Copy operation executes correctly
   - ✅ Paste operation uses the copied data
   - ✅ Data is transferred correctly between source and destination

## Troubleshooting

### No KEYBOARD Step Created

**Check:**
- Did you use pure `Ctrl+C`/`Cmd+C` (no Shift or Alt)?
- Is the extension actually recording?
- Check console for any errors

### No Clipboard Metadata

**Check:**
- Did you wait 100ms after copy before the keyboard handler checked storage?
- Check console for "Failed to get clipboard data" warnings
- Verify clipboard event listener is working

### Generic AI Descriptions

**Check:**
- Is clipboard metadata actually in the step payload?
- Check the Supabase Edge Function logs
- Verify API key is configured correctly

## Success Criteria Checklist

- [ ] Copy keyboard shortcuts (`Ctrl+C`/`Cmd+C`) are recorded as KEYBOARD steps
- [ ] Paste keyboard shortcuts (`Ctrl+V`/`Cmd+V`) are recorded as KEYBOARD steps
- [ ] Steps include correct modifiers (`ctrl: true` or `meta: true`)
- [ ] Steps include clipboard metadata in `aiEvidence.clipboardMetadata`
- [ ] AI generates semantic descriptions (not just "Copy" or "Paste")
- [ ] Steps appear in the workflow list in the sidepanel with meaningful descriptions
- [ ] No duplicate steps are created when both keyboard and clipboard events fire
- [ ] Existing functionality (Enter, Tab, Escape) continues to work unchanged
- [ ] Copy and paste operations are semantically linked via clipboard metadata

## Reporting Issues

If you find any issues, please include:
1. Browser and OS version
2. Exact steps to reproduce
3. Console logs (with errors)
4. Screenshots of the workflow steps
5. The saved workflow JSON (if applicable)

