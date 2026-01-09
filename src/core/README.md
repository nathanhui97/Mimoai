# Protected Core Modules

## ⚠️ DO NOT MODIFY WITHOUT RUNNING REGRESSION TESTS

This directory contains **protected core utilities** that are used across the entire codebase. Changes here affect **ALL workflows**.

## Module Overview

### `shadow-dom-utils.ts`
**Used by:** MenuDetector, CandidateFinder, Resolver, DOMMap, ScopeResolver

**Key Features:**
- Universal deep DOM querying (light + shadow DOMs)
- Shadow-aware `closest()` traversal
- Shadow path generation for stable selectors
- Dynamic class name filtering (excludes ng-, react-, vue- prefixes)

**Critical For:**
- Gainsight widget detection (web components)
- Menu item extraction from CDK overlays
- Element detection across Shadow DOM boundaries

### `visibility-checker.ts`
**Used by:** MenuDetector, CandidateFinder, DOMMap, ScopeResolver

**Key Features:**
- Centralized visibility detection
- Special handling for CDK overlay containers (width=0 but visible)
- Interactability checks (visible + not disabled + not obscured)

**Critical For:**
- Menu visibility detection
- Filtering out hidden elements
- Detecting clickable vs non-clickable elements

### `text-matcher.ts`
**Used by:** CandidateFinder, Resolver, ScopeResolver, RecordingManager

**Key Features:**
- Fuzzy text matching (Levenshtein + Jaccard algorithms)
- Partial word matching
- Text normalization (handles &nbsp;, newlines, case)

**Critical For:**
- Widget title matching with dynamic numbers ("STORE...119" vs "STORE...")
- Element name matching when exact match fails
- Menu item text comparison

## Architecture

```
┌─────────────────────────────────────────┐
│       Execution Layer                   │
│   (Tier1 Executor, AI Agent)           │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       Adaptation Layer                  │
│  (CandidateFinder, Resolver, DOMMap)   │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│       Protected Core ← YOU ARE HERE     │
│  (ShadowDOMUtils, VisibilityChecker,   │
│   TextMatcher, MenuDetector)            │
└─────────────────────────────────────────┘
```

## Before Modifying Any File in This Directory

1. **Run integration tests:**
   ```bash
   npm run test:integration
   ```

2. **All tests must pass** - If tests fail, your changes broke a workflow

3. **Add new tests FIRST** - If adding new behavior, write the test before the implementation

## Workflow Dependencies

| Module | Gainsight | SFDC | Dropdowns | General |
|--------|-----------|------|-----------|---------|
| `shadow-dom-utils.ts` | ✅ Critical | ✅ Used | ✅ Used | ✅ Used |
| `visibility-checker.ts` | ✅ Critical | ✅ Used | ✅ Critical | ✅ Used |
| `text-matcher.ts` | ✅ Used | ❌ Not used | ✅ Used | ✅ Used |

**✅ Critical** = Workflow completely broken without this
**✅ Used** = Workflow degraded without this
**❌ Not used** = Workflow unaffected

## Known Regressions to Watch For

### Fixing Gainsight Broke SFDC (Jan 9, 2026)
**Problem:** Pattern-based menu detection worked great for Gainsight but broke SFDC button clicks.

**Root Cause:** Scope filtering was excluding correct buttons because `scopePath` didn't match.

**Fix:** Added fallback in `CandidateFinder` to include elements matching `recordedAriaLabel` even if scope doesn't match perfectly.

**Lesson:** Menu items (role=menuitem/option) should SKIP scope filtering because they render in global portals. Regular buttons (role=button) NEED scope filtering but with aria-label override.

### Widget Scope with Dynamic Numbers
**Problem:** Widget titles like "STORE LOCATION OVERVIEW 119" vs "STORE LOCATION OVERVIEW 120" should match.

**Solution:** `TextMatcher.fuzzyMatch()` with dynamic number stripping in scope filtering.

**Don't Break:** The fuzzy matching threshold is 0.8. Lowering it causes false matches.

## Testing Strategy

### Unit Tests
Test individual methods in isolation:
- `ShadowDOMUtils.queryDeep(selector)` finds elements in shadow roots
- `VisibilityChecker.isVisible(cdkOverlay)` returns true for CDK containers
- `TextMatcher.fuzzyMatch("STORE...119", "STORE...120")` returns true

### Integration Tests
Test realistic DOM patterns:
- Gainsight: Multiple widgets with same button names
- SFDC: Aria-labeled buttons with scope filtering
- Dropdowns: CDK overlay portals with menu items

**Location:** `src/content/integration-tests/`

### Fixture Files
Known-working patterns documented as JSON:
- `src/__fixtures__/gainsight-widget-menu.json`
- `src/__fixtures__/sfdc-navigation.json`
- `src/__fixtures__/dropdown-portal.json`

## Migration Guide

If you need to update imports after the move to `src/core/`:

**Old:**
```typescript
import { ShadowDOMUtils } from '../content/shadow-dom-utils';
```

**New:**
```typescript
import { ShadowDOMUtils } from '../core/shadow-dom-utils';
```

**Note:** Re-exports exist in old paths for backward compatibility, but update your imports to use the new paths.

## Questions?

If you're unsure whether a change will break workflows:
1. Run `npm run test:integration` first
2. Check the fixture files to see expected behavior
3. Look at the "Workflow Dependencies" table above
4. When in doubt, ask!
