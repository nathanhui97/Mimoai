# Workflow Compatibility Issue ⚠️

**Date**: January 7, 2026  
**Status**: ⚠️ WORKFLOW INCOMPATIBLE WITH CURRENT PAGE  
**Issue**: Workflow recorded on different page configuration

## Problem Summary

The Gainsight workflow is failing because **the page content has changed** since recording.

### Evidence from Console Logs:

```
[Scope] ❌ Widget with title "BRAND SALES OVERVIEW (SELECTED TIME PERIOD)" not found
[Scope] 🔍 Unique titles found: STORE LIST - PORTFOLIO, OPEN CHURN TRACKER CTAS7, "How To" Guide, Data Reminders, Soft and Hard Churn Details, Widget Summary
```

The workflow is looking for a widget called **"BRAND SALES OVERVIEW (SELECTED TIME PERIOD)"** but it doesn't exist on the current page.

## What's Happening:

1. Workflow scrolls the page ✅
2. System looks for the target widget ❌ **Widget not found**
3. System waits 5 seconds for lazy-loading ❌ **Widget never appears**
4. System falls back to document-wide search
5. Finds "More Options" buttons in **different widgets** (wrong ones)
6. Keeps clicking "Cancel" on modals
7. Repeats forever because target widget never exists

## Why This Happens:

**Gainsight dashboards are dynamic and customizable:**
- Different users see different widgets
- Widgets can be added/removed/rearranged
- Dashboard configuration changes over time
- Workflow was recorded on Dashboard A, but replaying on Dashboard B

## Solutions:

### Option 1: Navigate to Correct Dashboard
Make sure you're on the same dashboard where the workflow was originally recorded.

### Option 2: Re-record the Workflow
Record a new workflow on the current page with the current widgets:
1. Navigate to the dashboard you want to automate
2. Click "Record" in the extension
3. Perform the actions (click "More Options" on an existing widget)
4. Stop and save

### Option 3: Update Workflow Target
If you know which widget you want to target, you could manually edit the workflow JSON to change:
- From: `"BRAND SALES OVERVIEW (SELECTED TIME PERIOD)"`
- To: One of the existing widgets like `"STORE LIST - PORTFOLIO"`

## Technical Details:

The shadow DOM fixes and scroll fixes are **working correctly**. The logs show:

```
[Hybrid] 🔍 DEBUG: Normalized host selector: "gs-report-widget-element"
[Hybrid] 🔍 DEBUG: Found 20 shadow hosts for "gs-report-widget-element"
[Hybrid] 🔍 DEBUG: Found 1 elements in shadow root
```

The system IS finding "More Options" buttons inside shadow roots, but they're in the **wrong widgets** because the target widget doesn't exist.

## Verification:

To verify the page content, check the browser console for:
```
[Scope] 🔍 Unique titles found: ...
```

This shows all the widgets currently on the page. Your workflow must target one of these widgets.

## Recommendation:

**Re-record the workflow** on the current page. This is the fastest and most reliable solution.



