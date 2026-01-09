# Universal Pattern-Based Menu Detection - Implementation Complete

## Summary

Replaced 50+ hardcoded framework-specific selectors with **pattern-based detection** that works universally across any UI framework. The system now detects menus by behavioral patterns (ARIA roles, popup positioning, item structure) instead of framework-specific class names.

## What Changed

### Phase 1: Shared Utilities (Foundation)

#### 1. Created `src/content/visibility-checker.ts` (NEW FILE)
- Centralized visibility checking logic
- Special handling for CDK overlay containers (width=0 wrappers)
- Replaces duplicate implementations in 4+ files

#### 2. Enhanced `src/content/shadow-dom-utils.ts`
- Added `queryDeep()` - searches light DOM + all shadow DOMs recursively
- Added `queryDeepFirst()` - efficient first-match search
- Replaces duplicate Shadow DOM traversal code in MenuDetector and CandidateFinder

### Phase 2: Pattern-Based Detection

#### 3. Updated `src/content/menu-detector.ts`
**Before:** 50+ hardcoded selectors (`.mat-menu-panel`, `.slds-dropdown`, `.MuiMenu-paper`, etc.)

**After:** Pattern-based detection:
```typescript
isLikelyMenu(element):
  ✓ ARIA role (menu, listbox, menubar)
  ✓ Popup positioning (fixed/absolute + z-index > 1000)
  ✓ Contains 2+ clickable items

findMenuItems(menu):
  ✓ ARIA roles (menuitem, option)
  ✓ Direct li children in ul
  ✓ Clickable children (button, a, [tabindex])
```

**New Features:**
- `lastMenuOpenTime` tracking - disambiguates when multiple menus exist
- `findVisibleMenu()` now selects most recently opened menu
- Uses shared `ShadowDOMUtils` and `VisibilityChecker`

#### 4. Updated `src/content/candidate-finder.ts`
- Uses shared `ShadowDOMUtils.queryDeep()` instead of duplicate implementation
- Uses shared `VisibilityChecker.isVisible()` instead of duplicate implementation
- Dropdown fallback now uses `MenuDetector.findVisibleMenu()` instead of hardcoded selectors
- Made `findCandidates()` async to support dynamic menu detection

#### 5. Updated `src/types/scope.ts`
- Widget detection now uses `ShadowDOMUtils.traverseShadowDOM()` for deep search
- Finds widgets nested in Shadow DOMs (previously only checked immediate shadow root)
- Uses shared `VisibilityChecker.isVisible()`

#### 6. Updated `src/content/resolver.ts`
- Made `resolve()` async to support async `CandidateFinder.findCandidates()`
- Menu item filtering logic preserved (already correct)

#### 7. Updated `src/lib/tier1-executor.ts`
- Added `await` to `Resolver.resolve()` call (now async)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Shared Utilities Layer                                     │
├─────────────────────────────────────────────────────────────┤
│  • ShadowDOMUtils (queryDeep, closestDeep, traverseShadowDOM)│
│  • VisibilityChecker (isVisible, isInteractable)            │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼───────┐  ┌──────▼──────┐  ┌──────▼──────┐
│ MenuDetector  │  │CandidateFinder│  │  scope.ts   │
│ (menus only)  │  │(buttons/links)│  │  (widgets)  │
└───────────────┘  └───────────────┘  └─────────────┘
```

## Universal Rule: Menu Items Skip Widget Scope

**The Problem:**
Most UI frameworks render menus in global overlays/portals (Angular CDK, React Portals, etc.), NOT inside the widget that triggered them.

**The Solution:**
```typescript
if (bundle.role === 'menuitem' || bundle.role === 'option') {
  // Skip widget scope - menus are in portals
  // Filter by which menu is currently visible instead
  const visibleMenu = MenuDetector.findVisibleMenu();
  const candidates = MenuDetector.extractMenuItems(visibleMenu);
}
```

**Why This is Universal:**
- Angular CDK → `.cdk-overlay-container`
- React Portals → `<div id="portal-root">`
- Salesforce Lightning → `<lightning-overlay-container>`
- MUI → `<div class="MuiPopover-root">`

ALL of these render menus outside the widget DOM tree.

## Problems Fixed

| # | Problem | Solution |
|---|---------|----------|
| 1 | Menu not detected (Angular CDK) | Pattern-based `isLikelyMenu()` |
| 2 | CDK overlay `visible=false` | Check inner menu, not wrapper |
| 3 | Shadow DOM hiding menus | `ShadowDOMUtils.queryDeep()` |
| 4 | Wrong widget's menu item clicked | Skip scope for menu items, filter by visible menu |
| 5 | Multiple menus (30 items vs 5) | Track open timing, select most recent |
| 6 | Widget not found in Shadow DOM | Deep traversal in scope.ts |

## Testing Instructions

### 1. Gainsight Test (Angular CDK + Shadow DOM)

**Setup:**
1. Load extension in Chrome
2. Navigate to Gainsight dashboard with widgets
3. Record a workflow:
   - Click hamburger menu (☰) on a widget
   - Click "Download Data" menu item
   - Stop recording

**Expected Result:**
- ✅ Menu detected via pattern (ARIA role or popup pattern)
- ✅ "Download Data" clicked from correct widget's menu
- ✅ Console shows: `[MenuDetector] ✅ Found visible menu` and `[Resolver] ✅ Filtered to X candidates in visible menu`

**Replay:**
- Execute the workflow
- Should click correct menu item without errors

### 2. Salesforce Test (Lightning Components)

**Setup:**
1. Navigate to Salesforce Lightning app
2. Record a workflow:
   - Click navigation dropdown
   - Select an option from dropdown
   - Stop recording

**Expected Result:**
- ✅ Dropdown detected via pattern (ARIA `role="listbox"`)
- ✅ Option selected correctly
- ✅ Works without SFDC-specific selectors

**Replay:**
- Execute the workflow
- Should navigate correctly

### 3. Any Other App (Universal Test)

**Setup:**
1. Navigate to any web app with menus (e.g., MUI demo, Radix UI demo)
2. Record a workflow with menu interactions

**Expected Result:**
- ✅ Menus detected by ARIA roles or behavioral patterns
- ✅ No framework-specific code needed

## Benefits

- **Universal**: Works on any framework (ARIA + behavioral patterns)
- **Maintenance-free**: No need to add selectors for new frameworks
- **Self-healing**: Behavioral patterns stable even when class names change
- **No duplication**: Shared utilities eliminate redundant code
- **Extensible**: New detectors can use same shared utilities

## Files Modified

| File | Lines Changed | Type |
|------|---------------|------|
| `src/content/visibility-checker.ts` | +73 | NEW FILE |
| `src/content/shadow-dom-utils.ts` | +70 | Enhanced |
| `src/content/menu-detector.ts` | -150, +80 | Refactored |
| `src/content/candidate-finder.ts` | -35, +15 | Simplified |
| `src/types/scope.ts` | -50, +30 | Enhanced |
| `src/content/resolver.ts` | +2 | Made async |
| `src/lib/tier1-executor.ts` | +1 | Added await |

**Total:** ~200 lines removed (duplicates), ~270 lines added (shared utilities + patterns)

## Next Steps

1. **Test on Gainsight** - Verify current fix still works
2. **Test on SFDC** - Verify Lightning dropdowns work
3. **Monitor logs** - Watch for pattern detection in production
4. **Iterate** - If new patterns emerge, add to `isLikelyMenu()` logic

## Rollback Plan

If issues arise, revert these commits:
- `visibility-checker.ts` (can be deleted)
- `shadow-dom-utils.ts` (revert queryDeep additions)
- `menu-detector.ts` (restore hardcoded selectors)
- Other files (revert to use old methods)

The old hardcoded selectors are preserved in git history.


