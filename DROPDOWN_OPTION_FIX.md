# Dropdown Option Recording & Playback Fix

## Overview

This document describes the comprehensive fix for dropdown option recording and playback issues, particularly for Salesforce Lightning and similar dynamic UI frameworks.

## Root Cause Analysis

The dropdown playback failures were caused by **multiple interconnected issues**:

### 1. Visibility Check False Negatives (Fixed in `element-state.ts`)
- **Problem**: Dropdown options in portals/overlays were recorded with `visible: false` because:
  - `offsetParent` was null for portal elements
  - Viewport bounds checks were too strict
- **Solution**: Added special handling for dropdown options and portal elements with relaxed visibility checks

### 2. Harsh List Item Penalty (Fixed in `element-analyzer.ts`)
- **Problem**: List items received a flat -25 point penalty regardless of text stability
- **Solution**: Made penalty conditional on text stability:
  - Unique stable text: -5 points
  - Stable but non-unique text: -10 points
  - No stable text: -15 points

### 3. Missing Container-Scoped Selectors (Fixed in `recording-manager.ts`)
- **Problem**: Selectors like `xpath=//*[normalize-space(text())="Option"]` matched multiple elements globally
- **Solution**: Generate container-scoped selectors using:
  - Dropdown trigger label (`[aria-label="Field"] + [role="listbox"]`)
  - Container aria-label
  - Container ID
  - Role-based container scoping

### 4. No Stability Wait Before Capture (Fixed in `recording-manager.ts`)
- **Problem**: Element state was captured before dropdown fully rendered
- **Solution**: Added 50ms micro-delay for dropdown options before capturing state

### 5. Inadequate Playback Retry Logic (Fixed in `tier1-executor.ts`)
- **Problem**: Single attempt to open dropdown with no retry
- **Solution**: Added retry logic (up to 2 attempts) with proper menu detection

### 6. Missing Decision Space Fallback (Fixed in `tier1-executor.ts`)
- **Problem**: No validation that we're looking at the correct dropdown
- **Solution**: Use recorded `decisionSpace` to:
  - Validate overlap with current dropdown options
  - Find option by recorded index as fallback
  - Use fuzzy matching with decision space options

## Files Modified

### `src/content/element-state.ts`
- Added `isDropdownOptionOrMenuItem()` helper
- Enhanced `isElementVisible()` with portal/overlay handling
- Added `isElementVisiblePermissive()` for dropdown options

### `src/lib/element-analyzer.ts`
- Made list item penalty conditional on text stability
- Reduced maximum penalty from -25 to -15

### `src/content/recording-manager.ts`
- Added container-scoped selector generation for dropdown options
- Added 50ms stability wait before capturing dropdown option state
- Use permissive visibility check for dropdown options

### `src/lib/tier1-executor.ts`
- Enhanced dropdown detection using `MenuDetector`
- Added retry logic for opening dropdowns (2 attempts)
- Added decision space validation and fallback strategies
- Added visible menu item search as last resort

### `src/lib/agent/types.ts`
- Added `decisionSpace` to `AgentActionParams`
- Added `decisionSpace` and scroll fields to `AgentHint`

### `src/lib/agent/hint-extractor.ts`
- Extract and include `decisionSpace` in hints

### `src/lib/ai-agent.ts`
- Pass `decisionSpace` from hint to action params

## Selector Generation Strategy (Priority Order)

For dropdown options, selectors are now generated in this priority order:

1. **Container-scoped by trigger label**
   ```xpath
   //*[@aria-label='Field Label']//ancestor::*[@role='combobox']/following-sibling::*[@role='listbox']//*[@role='option'][contains(normalize-space(.),'Option Text')]
   ```

2. **Container-scoped by aria-label**
   ```xpath
   //*[@aria-label='Container Label']//*[@role='option'][contains(normalize-space(.),'Option Text')]
   ```

3. **Container-scoped by ID**
   ```xpath
   //*[@id='container-id']//*[@role='option'][contains(normalize-space(.),'Option Text')]
   ```

4. **Role-based container scoping**
   ```xpath
   //*[@role='listbox']//*[@role='option'][contains(normalize-space(.),'Option Text')]
   ```

5. **Generic option selector** (last resort)
   ```xpath
   //*[@role='option'][contains(normalize-space(.),'Option Text')]
   ```

## Playback Strategy (Execution Order)

1. **Ensure dropdown is open**
   - Check if menu is already visible using `MenuDetector`
   - If not, click trigger with retry logic (2 attempts)
   - Wait for menu using `MenuDetector.waitForMenu()`

2. **Search for option** (Priority Order)
   - Exact text match
   - Case-insensitive normalized match
   - Aria-label match
   - Data-value match
   - Resolver with semantic strategies

3. **Decision space fallback**
   - Validate dropdown overlap (>50% match)
   - Try recorded index
   - Try fuzzy matching

4. **Visible menu fallback**
   - Search items in currently visible menu by text

## Testing

To test the fix:

1. **Recording Test**: Record a workflow with Salesforce Lightning dropdowns
   - Verify `elementState.visible` is `true` for dropdown options
   - Verify `confidence` is reasonable (>30)
   - Verify container-scoped selectors are in `fallbackSelectors`

2. **Playback Test**: Play back the recorded workflow
   - Verify dropdown opens correctly
   - Verify correct option is selected
   - Check console logs for strategy used

## Debugging

Enable debug logging to trace dropdown handling:

```javascript
// Check recording logs
console.log('GhostWriter: Dropdown option visibility (permissive):', ...)
console.log('GhostWriter: Generated container-scoped selectors:', ...)

// Check playback logs  
console.log('[Tier1] Strategy 3: Using decision space fallback...')
console.log('[Tier1] Decision space overlap:', ...)
```

## Known Limitations

1. Very fast dropdown animations (<50ms) might still have timing issues
2. Nested dropdowns (dropdown within dropdown) may need additional handling
3. Virtual scrolling dropdowns with 1000+ options may have performance issues
