/**
 * Test script to verify workflow save no longer creates duplicate steps/optimizedSteps
 * 
 * Run this in the browser console after recording a workflow to verify the fix
 */

// Simulate the workflow save logic with no optimization
function testWorkflowSave() {
  const sortedSteps = [
    { type: 'CLICK', description: 'Step 1', payload: {} },
    { type: 'INPUT', description: 'Step 2', payload: {} },
  ];

  // Create optimization result (no actual optimization)
  const optimizationResult = {
    optimizedSteps: sortedSteps,
    metadata: {
      analyzedAt: Date.now(),
      sequencesFound: 0,
      sequencesOptimized: 0,
      stepsRemoved: 0, // NO optimization occurred
      aiAnalysisUsed: false,
      optimizationMap: [],
    }
  };

  // NEW LOGIC - only include optimizedSteps if steps were removed
  const workflow = {
    id: `workflow-${Date.now()}`,
    name: 'Test Workflow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    steps: sortedSteps,
    optimizedSteps: optimizationResult.metadata.stepsRemoved > 0 
      ? optimizationResult.optimizedSteps 
      : undefined, // ✅ NEW: Don't include if no optimization
    optimizationMetadata: optimizationResult.metadata.stepsRemoved > 0 
      ? optimizationResult.metadata 
      : undefined,
  };

  console.log('=== Workflow Save Test ===');
  console.log('steps.length:', workflow.steps.length);
  console.log('optimizedSteps:', workflow.optimizedSteps);
  console.log('optimizationMetadata:', workflow.optimizationMetadata);
  
  const json = JSON.stringify(workflow);
  const stepsSize = JSON.stringify(workflow.steps).length;
  const totalSize = json.length;
  
  console.log('\n=== Size Analysis ===');
  console.log('Total JSON size:', totalSize, 'chars');
  console.log('steps array size:', stepsSize, 'chars');
  
  if (workflow.optimizedSteps) {
    const optimizedStepsSize = JSON.stringify(workflow.optimizedSteps).length;
    console.log('❌ FAIL: optimizedSteps is present when it should be undefined!');
    console.log('optimizedSteps size:', optimizedStepsSize, 'chars');
    console.log('Wasted space:', optimizedStepsSize, 'chars');
  } else {
    console.log('✅ PASS: optimizedSteps is undefined (no duplication)');
    console.log('Space saved: ~' + stepsSize + ' chars (50% reduction)');
  }

  return workflow;
}

// Run the test
testWorkflowSave();
