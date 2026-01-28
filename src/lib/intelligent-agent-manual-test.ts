/**
 * Manual Test Script for Phase 1: Intelligent Agent - Fast-Path Context
 *
 * This script can be run in the browser console to verify the implementation.
 * It logs detailed information about execution context being captured and sent.
 *
 * Usage:
 * 1. Build the extension: npm run build
 * 2. Load the extension in Chrome
 * 3. Open a test page
 * 4. Open DevTools Console
 * 5. The logs will show execution context details during workflow execution
 */

/**
 * Test helper to verify ExecutionContext is being captured
 */
export function verifyExecutionContext(): void {
  console.log('='.repeat(60));
  console.log('INTELLIGENT AGENT PHASE 1: EXECUTION CONTEXT TEST');
  console.log('='.repeat(60));

  // Check feature flag
  import('./feature-flags').then(({ FeatureFlags, isFeatureEnabled }) => {
    console.log('\n📌 Feature Flags:');
    console.log(`  INTELLIGENT_AGENT_CONTEXT: ${FeatureFlags.INTELLIGENT_AGENT_CONTEXT ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  INTELLIGENT_AGENT_FLEXIBLE: ${FeatureFlags.INTELLIGENT_AGENT_FLEXIBLE ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  INTELLIGENT_AGENT_GOAL: ${FeatureFlags.INTELLIGENT_AGENT_GOAL ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`  INTELLIGENT_AGENT_VERIFY: ${FeatureFlags.INTELLIGENT_AGENT_VERIFY ? '✅ ENABLED' : '❌ DISABLED'}`);

    if (!isFeatureEnabled('INTELLIGENT_AGENT_CONTEXT')) {
      console.warn('\n⚠️ INTELLIGENT_AGENT_CONTEXT is disabled! Enable it to test Phase 1.');
    }
  });

  console.log('\n📋 What to look for during workflow execution:');
  console.log('  1. "[Hybrid] Confidence: XX%" - Fast-path confidence level');
  console.log('  2. "[AIAgent] 📤 Including executionContext:" - Context being sent to LLM');
  console.log('  3. "🔧 Execution Context:" in dom_agent logs - Server received context');
  console.log('');
  console.log('📋 Expected context fields:');
  console.log('  - fastPathAttempted: boolean');
  console.log('  - fastPathConfidence: number (0-100)');
  console.log('  - fastPathReason: NO_SELECTORS | LOW_CONFIDENCE | AMBIGUOUS | NOT_FOUND | ...');
  console.log('  - strategiesTried: string[] (recorded_selector, xpath, shadow_piercing, ...)');
  console.log('  - callReason: DISAMBIGUATION | NOT_FOUND | RECOVERY | LOW_CONFIDENCE');
  console.log('  - candidatesFound: number');
  console.log('');
  console.log('='.repeat(60));
}

/**
 * Create a mock execution context for testing
 */
export function createMockExecutionContext(scenario: 'ambiguous' | 'not_found' | 'low_confidence' | 'dropdown') {
  const scenarios = {
    ambiguous: {
      fastPathAttempted: true,
      fastPathConfidence: 55,
      fastPathReason: 'AMBIGUOUS' as const,
      strategiesTried: ['recorded_selector', 'scope_filter'],
      scrollAttempted: false,
      callReason: 'DISAMBIGUATION' as const,
      currentStepFailures: 0,
      candidatesFound: 3,
      topCandidateScore: 55,
    },
    not_found: {
      fastPathAttempted: true,
      fastPathConfidence: 0,
      fastPathReason: 'NOT_FOUND' as const,
      strategiesTried: ['recorded_selector', 'xpath', 'css_selector'],
      scrollAttempted: true,
      scrollDirection: 'down' as const,
      scrollAttempts: 3,
      callReason: 'NOT_FOUND' as const,
      currentStepFailures: 2,
      candidatesFound: 0,
    },
    low_confidence: {
      fastPathAttempted: true,
      fastPathConfidence: 30,
      fastPathReason: 'LOW_CONFIDENCE' as const,
      strategiesTried: ['recorded_selector'],
      scrollAttempted: false,
      callReason: 'LOW_CONFIDENCE' as const,
      currentStepFailures: 0,
      candidatesFound: 1,
      topCandidateScore: 30,
    },
    dropdown: {
      fastPathAttempted: true,
      fastPathConfidence: 50,
      fastPathReason: 'DROPDOWN_OPEN' as const,
      strategiesTried: ['recorded_selector'],
      scrollAttempted: false,
      callReason: 'DISAMBIGUATION' as const,
      currentStepFailures: 0,
      candidatesFound: 5,
    },
  };

  const context = scenarios[scenario];
  console.log(`\n📦 Mock ExecutionContext (${scenario}):`);
  console.log(JSON.stringify(context, null, 2));
  return context;
}

/**
 * Simulate what the dom_agent prompt section looks like
 */
export function simulatePromptSection(context: ReturnType<typeof createMockExecutionContext>): string {
  if (!context.fastPathAttempted) {
    return '';
  }

  // Cast to any to handle optional properties across different scenario types
  const ctx = context as any;

  const section = `
## 🔧 EXECUTION CONTEXT (What was already tried)

**Fast-path was attempted:** YES
**Fast-path confidence:** ${ctx.fastPathConfidence ?? 'N/A'}%
**Fast-path result:** ${ctx.fastPathReason || 'Unknown'}
**Why LLM is being called:** ${ctx.callReason}

**Strategies already tried:**
${ctx.strategiesTried.map((s: string) => `  • ${s}`).join('\n') || '  • (none)'}

**Candidates found:** ${ctx.candidatesFound}
${ctx.topCandidateScore ? `**Top candidate score:** ${ctx.topCandidateScore}%` : ''}
${ctx.scrollAttempted ? `**Scroll attempted:** YES (${ctx.scrollDirection || 'down'})` : ''}
${ctx.currentStepFailures > 0 ? `**Previous failures on this step:** ${ctx.currentStepFailures}` : ''}

⚠️ IMPORTANT - Use this context to make better decisions:
- If strategies were already tried, DON'T suggest the same approach
- If candidates were found but confidence was low, help disambiguate
- If NOT_FOUND, the element may need scrolling or may not exist
- If AMBIGUOUS, use scope/widget hints to pick the right one
`;

  console.log('\n📝 Generated Prompt Section:');
  console.log(section);
  return section;
}

/**
 * Run all manual tests
 */
export function runManualTests(): void {
  console.clear();
  verifyExecutionContext();

  console.log('\n\n🧪 Testing different scenarios:\n');

  // Test each scenario
  const scenarios: Array<'ambiguous' | 'not_found' | 'low_confidence' | 'dropdown'> = [
    'ambiguous',
    'not_found',
    'low_confidence',
    'dropdown',
  ];

  scenarios.forEach(scenario => {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`SCENARIO: ${scenario.toUpperCase()}`);
    console.log(`${'─'.repeat(40)}`);

    const context = createMockExecutionContext(scenario);
    simulatePromptSection(context);
  });

  console.log('\n\n✅ Manual tests complete!');
  console.log('Now run a real workflow to see the execution context in action.');
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
  (window as any).runIntelligentAgentTests = runManualTests;
  (window as any).verifyExecutionContext = verifyExecutionContext;
  console.log('📌 Intelligent Agent Test Helpers loaded!');
  console.log('   Run: window.runIntelligentAgentTests() to see all scenarios');
  console.log('   Run: window.verifyExecutionContext() to check feature flags');
}
