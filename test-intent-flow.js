/**
 * Intent Flow Verification Script
 * 
 * Paste this into Chrome DevTools Console to verify the intent optimization
 * is working correctly throughout the entire data flow.
 * 
 * Usage:
 * 1. Open Chrome DevTools (F12)
 * 2. Go to Console tab
 * 3. Copy/paste this entire script
 * 4. Run testIntentFlow()
 */

async function testIntentFlow() {
  console.clear();
  console.log('%c=== INTENT OPTIMIZATION TEST ===', 'font-size: 16px; font-weight: bold; color: #4CAF50');
  console.log('This will verify the complete intent data flow\n');
  
  const results = {
    storage: false,
    stepTranslations: false,
    analyzedIntent: false,
    naturalLanguage: false,
  };
  
  // Test 1: Check if latest workflow has analyzedIntent
  console.log('%c📦 Test 1: Storage Verification', 'font-weight: bold; color: #2196F3');
  
  try {
    const storage = await chrome.storage.local.get('workflows');
    const workflows = storage.workflows || [];
    
    if (workflows.length === 0) {
      console.warn('❌ No workflows found. Please record and save a workflow first.');
      return;
    }
    
    const latestWorkflow = workflows[workflows.length - 1];
    console.log(`Found workflow: "${latestWorkflow.name}"`);
    console.log(`Created: ${new Date(latestWorkflow.createdAt).toLocaleString()}`);
    console.log(`Steps: ${latestWorkflow.steps?.length || 0}`);
    
    // Check analyzedIntent
    if (latestWorkflow.analyzedIntent) {
      results.analyzedIntent = true;
      console.log('✅ Has analyzedIntent');
      console.log('  Primary Goal:', latestWorkflow.analyzedIntent.primaryGoal);
      console.log('  Expected Outcome:', latestWorkflow.analyzedIntent.expectedOutcome);
      console.log('  Confidence:', (latestWorkflow.analyzedIntent.confidence * 100).toFixed(0) + '%');
      console.log('  Sub-Goals:', latestWorkflow.analyzedIntent.subGoals?.length || 0);
      
      // Check stepTranslations
      if (latestWorkflow.analyzedIntent.stepTranslations?.length > 0) {
        results.stepTranslations = true;
        console.log('✅ Has stepTranslations:', latestWorkflow.analyzedIntent.stepTranslations.length);
        console.log('  Sample:', latestWorkflow.analyzedIntent.stepTranslations[0]);
      } else {
        console.warn('❌ No stepTranslations found in analyzedIntent');
      }
    } else {
      console.warn('❌ No analyzedIntent found');
      console.log('  This workflow may have been saved before the optimization was implemented.');
    }
    
    // Check naturalLanguage on steps
    const stepsWithNL = latestWorkflow.steps?.filter(s => s.naturalLanguage) || [];
    if (stepsWithNL.length > 0) {
      results.naturalLanguage = true;
      console.log('✅ Steps have naturalLanguage:', stepsWithNL.length, '/', latestWorkflow.steps.length);
      console.log('  Sample:', stepsWithNL[0].naturalLanguage);
    } else {
      console.warn('❌ No steps have naturalLanguage property');
    }
    
    results.storage = latestWorkflow.analyzedIntent !== undefined;
    
  } catch (error) {
    console.error('❌ Error checking storage:', error);
  }
  
  console.log('\n');
  
  // Test 2: Network monitoring setup
  console.log('%c🌐 Test 2: Network Monitoring Setup', 'font-weight: bold; color: #2196F3');
  console.log('To verify API optimization during recording:');
  console.log('1. Open Network tab');
  console.log('2. Filter by "analyze_intent"');
  console.log('3. Record and save a new workflow');
  console.log('4. You should see ONLY 1 call to analyze_intent (not multiple translate_step calls)');
  console.log('5. Check the response - it should contain stepTranslations array');
  
  console.log('\n');
  
  // Test 3: Execution monitoring
  console.log('%c▶️ Test 3: Execution Monitoring', 'font-weight: bold; color: #2196F3');
  console.log('To verify intent is passed to AI agent:');
  console.log('1. Run a workflow that has analyzedIntent');
  console.log('2. Watch console for these logs:');
  console.log('   - "[AIAgent] 🧠 Workflow Intent Available:"');
  console.log('   - "[AIAgent] 📤 Including analyzedIntent:"');
  console.log('   - "[AIAgent] Outcome verification:"');
  
  console.log('\n');
  
  // Summary
  console.log('%c📊 RESULTS SUMMARY', 'font-size: 14px; font-weight: bold; color: #FF9800');
  console.log('Storage has analyzedIntent:', results.storage ? '✅' : '❌');
  console.log('Has stepTranslations:', results.stepTranslations ? '✅' : '❌');
  console.log('Steps have naturalLanguage:', results.naturalLanguage ? '✅' : '❌');
  
  const allPassed = results.storage && results.stepTranslations && results.naturalLanguage;
  
  console.log('\n');
  if (allPassed) {
    console.log('%c🎉 ALL CHECKS PASSED!', 'font-size: 16px; font-weight: bold; color: #4CAF50; background: #E8F5E9; padding: 8px;');
    console.log('The intent optimization is working correctly!');
  } else {
    console.log('%c⚠️ SOME CHECKS FAILED', 'font-size: 16px; font-weight: bold; color: #FF5722; background: #FFEBEE; padding: 8px;');
    console.log('Please check the warnings above.');
    console.log('\nPossible solutions:');
    console.log('- Record and save a NEW workflow to test the optimization');
    console.log('- Check Supabase Edge Function logs for errors');
    console.log('- Verify GEMINI_API_KEY is set in Edge Functions');
  }
  
  console.log('\n');
  console.log('%cFor detailed testing instructions, see INTENT_OPTIMIZATION_TESTING.md', 'color: #666; font-style: italic');
}

// Helper function to monitor fetch calls to dom_agent
function monitorDomAgentCalls() {
  console.log('%c🔍 Setting up dom_agent call monitor...', 'font-weight: bold; color: #9C27B0');
  console.log('Run a workflow to see intent data being sent to dom_agent');
  console.log('Call stopMonitoring() to disable\n');
  
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [url, options] = args;
    
    if (typeof url === 'string' && url.includes('dom_agent')) {
      try {
        const body = JSON.parse(options?.body || '{}');
        
        console.log('%c📤 DOM_AGENT REQUEST', 'font-weight: bold; background: #E3F2FD; padding: 4px;');
        console.log('Has analyzedIntent:', !!body.analyzedIntent);
        
        if (body.analyzedIntent) {
          console.log('Primary Goal:', body.analyzedIntent.primaryGoal);
          console.log('Expected Outcome:', body.analyzedIntent.expectedOutcome);
          console.log('Confidence:', (body.analyzedIntent.confidence * 100).toFixed(0) + '%');
          console.log('Sub-Goals:', body.analyzedIntent.subGoals);
          if (body.analyzedIntent.failurePatterns?.length) {
            console.log('Failure Patterns:', body.analyzedIntent.failurePatterns);
          }
        } else {
          console.warn('⚠️ No analyzedIntent in request');
        }
        console.log('---');
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    return originalFetch.apply(this, args);
  };
  
  window.stopMonitoring = () => {
    window.fetch = originalFetch;
    delete window.stopMonitoring;
    console.log('✅ Monitoring stopped');
  };
}

// Auto-run if script is pasted into console
console.log('%c🚀 Intent Flow Test Script Loaded!', 'font-size: 14px; font-weight: bold; color: #2196F3');
console.log('\nAvailable commands:');
console.log('  testIntentFlow()        - Verify intent data in storage');
console.log('  monitorDomAgentCalls()  - Monitor intent being sent to AI agent');
console.log('\nRun testIntentFlow() to start!\n');
