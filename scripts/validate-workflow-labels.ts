#!/usr/bin/env tsx
/**
 * Workflow Label Validation Script
 * 
 * Validates that a workflow JSON file has proper label extraction.
 * Usage: tsx scripts/validate-workflow-labels.ts <workflow.json>
 */

import { HintExtractor } from '../src/lib/agent/hint-extractor';
import { readFileSync } from 'fs';

const workflowPath = process.argv[2];
if (!workflowPath) {
  console.error('Usage: tsx scripts/validate-workflow-labels.ts <workflow.json>');
  console.error('Example: tsx scripts/validate-workflow-labels.ts ~/Downloads/ghostwriter-*.json');
  process.exit(1);
}

try {
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf-8'));
  const extractor = new HintExtractor();
  const hints = extractor.extractHints(workflow);

  console.log('=== Workflow Label Validation ===');
  console.log(`Workflow: ${workflow.name}`);
  console.log(`Total steps: ${workflow.steps.length}`);
  console.log(`Total hints: ${hints.length}`);
  console.log();

  let issues = 0;
  let warnings = 0;

  hints.forEach((hint, i) => {
    const step = workflow.steps[i];
    const payload = step?.payload;
    const hasLabel = !!hint.recordedAriaLabel;
    const needsLabel = hint.actionType === 'type' || hint.actionType === 'select';
    
    // Check if label should be present
    if (needsLabel && !hasLabel) {
      console.error(`❌ Step ${i+1} (${hint.actionType}): MISSING LABEL!`);
      console.error(`   Description: ${hint.description}`);
      console.error(`   Available sources:`);
      console.error(`     - textLabel: ${payload?.aiEvidence?.semanticAnchors?.textLabel || '(none)'}`);
      console.error(`     - ariaLabel: ${payload?.aiEvidence?.semanticAnchors?.ariaLabel || '(none)'}`);
      console.error(`     - payloadLabel: ${payload?.label || '(none)'}`);
      console.error(`     - attr[aria-label]: ${payload?.context?.uniqueAttributes?.['aria-label'] || '(none)'}`);
      console.error();
      issues++;
    } else if (needsLabel && hasLabel) {
      console.log(`✅ Step ${i+1} (${hint.actionType}): "${hint.recordedAriaLabel}"`);
      
      // Show which source was used
      const sources = [];
      if (payload?.aiEvidence?.semanticAnchors?.ariaLabel === hint.recordedAriaLabel) {
        sources.push('aiEvidence.semanticAnchors.ariaLabel');
      }
      if (payload?.aiEvidence?.semanticAnchors?.textLabel === hint.recordedAriaLabel) {
        sources.push('aiEvidence.semanticAnchors.textLabel');
      }
      if (payload?.label === hint.recordedAriaLabel) {
        sources.push('payload.label');
      }
      
      if (sources.length > 0) {
        console.log(`   Source: ${sources.join(' = ')}`);
      }
    } else {
      console.log(`⚪ Step ${i+1} (${hint.actionType}): ${hint.recordedAriaLabel || '(no label needed)'}`);
    }
    
    // Check for scope
    if (hint.recordedScopeHint) {
      console.log(`   Scope: "${hint.recordedScopeHint}"`);
    }
    
    // Warn if action needs a label but relies on fallback
    if (needsLabel && hasLabel && !payload?.aiEvidence?.semanticAnchors) {
      console.warn(`   ⚠️ Warning: Using fallback label source (no semanticAnchors)`);
      warnings++;
    }
  });

  console.log();
  console.log('=== Summary ===');
  console.log(`Total steps: ${hints.length}`);
  console.log(`Steps needing labels: ${hints.filter(h => h.actionType === 'type' || h.actionType === 'select').length}`);
  console.log(`Labels extracted: ${hints.filter(h => h.recordedAriaLabel).length}`);
  console.log(`Issues: ${issues}`);
  console.log(`Warnings: ${warnings}`);
  console.log();

  if (issues > 0) {
    console.error(`❌ Validation failed with ${issues} issue(s)!`);
    process.exit(1);
  } else {
    console.log('✅ All labels extracted correctly!');
    if (warnings > 0) {
      console.log(`⚠️ ${warnings} warning(s) - workflow may work but uses fallback sources`);
    }
  }
} catch (error) {
  console.error('Error validating workflow:', error);
  process.exit(1);
}
