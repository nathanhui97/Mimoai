# Integration Test Suite

## Purpose

These tests verify that element detection works correctly for known UI patterns across different frameworks. They serve as:

1. **Regression prevention** - Catch when fixing Workflow A breaks Workflow B
2. **Documentation** - Show expected behavior for common patterns
3. **Validation** - Ensure core utilities work as designed

## Test Coverage

### Gainsight Patterns (`gainsight-patterns.test.ts`)

Tests widget-scoped element detection and Shadow DOM traversal:

- ✅ Widget scope filtering with multiple widgets
- ✅ CDK overlay portal menu detection
- ✅ Menu disambiguation (selecting most recently opened)
- ✅ Shadow DOM element finding

**Critical Features Tested:**
- `CandidateFinder` correctly filters by widget scope
- `MenuDetector` finds menus in CDK overlays
- `ShadowDOMUtils` traverses shadow roots
- `VisibilityChecker` handles CDK containers (width=0 but visible)

### SFDC Patterns (`sfdc-patterns.test.ts`)

Tests aria-label based detection and scope handling:

- ✅ Aria-label button matching
- ✅ NEAREST_SECTION scope filtering
- ✅ Button disambiguation (not confusing similar buttons)
- ✅ Icon-only buttons with aria-labels

**Critical Features Tested:**
- `CandidateFinder` matches by `recordedAriaLabel`
- Scope filtering includes aria-label override
- Button selection doesn't confuse "Remove favorite" with "Show Navigation Menu"

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npx vitest run src/content/integration-tests/gainsight-patterns.test.ts

# Watch mode for development
npm run test:watch
```

## Current Limitations

**jsdom DOM querying limitations:**
- `querySelectorAll('[role="menu"]')` may not work reliably in jsdom
- CDK overlay visibility detection requires actual browser rendering
- Shadow DOM attachment in tests may behave differently than real browsers

**Workaround:**
- Tests document expected behavior
- Manual testing required for full validation
- Fixture files provide the "ground truth"

## When Tests Fail

### Step 1: Identify What Broke
Look at the test name and fixture file to understand expected behavior.

### Step 2: Check the Logs
Tests log detailed information about what was found vs. expected:
```
[CandidateFinder] ✅ Including element (aria-label matches): "Show Navigation Menu"
[MenuDetector] ⚠️ No visible menu found
```

### Step 3: Verify Manually
Since jsdom has limitations, validate in an actual browser:
1. Load the extension
2. Navigate to the real app (Gainsight/SFDC)
3. Run the workflow
4. Check console logs for the same patterns

### Step 4: Update Tests or Fix Code
- If behavior changed intentionally, update the test
- If regression occurred, fix the code and re-run tests

## Adding New Tests

### 1. Create Fixture File
Document the pattern in `src/__fixtures__/`:

```json
{
  "description": "New UI pattern description",
  "expectedBehavior": {},
  "domPattern": {},
  "criticalFeatures": [],
  "regressionTests": []
}
```

### 2. Write Test
Add test case to appropriate file or create new file:

```typescript
test('descriptive test name', async () => {
  // Setup: Create mock DOM
  container.innerHTML = `...`;
  
  // Execute: Run the actual code
  const result = await CandidateFinder.findCandidates(bundle, document);
  
  // Assert: Verify expected behavior
  expect(result.length).toBeGreaterThan(0);
});
```

### 3. Document in README
Add entry to "Test Coverage" section above.

## Pre-Commit Hook

The `precommit` script runs integration tests automatically:

```bash
npm run precommit
```

This ensures no commits break existing workflows.

**Note:** Currently disabled by default due to jsdom limitations. Enable when tests are fully working.
