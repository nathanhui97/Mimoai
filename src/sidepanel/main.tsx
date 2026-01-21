import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Debug: Expose skill module for console testing
import { WorkflowStorage } from '../lib/storage'
import { getSkill, getSkillSummary, buildSkillIndex, findSkillsForQuery, SkillStorage } from '../lib/skill'

// Expose for DevTools console testing
(window as any).MimoDebug = {
  WorkflowStorage,
  getSkill,
  getSkillSummary,
  buildSkillIndex,
  findSkillsForQuery,
  SkillStorage,

  // Get the most recently saved workflow
  async getLastWorkflow() {
    const workflows = await WorkflowStorage.loadWorkflows();
    if (workflows.length === 0) {
      console.log('⚠️ No workflows found. Record a workflow first!');
      return null;
    }
    // Sort by createdAt descending, return most recent
    const sorted = workflows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return sorted[0];
  },

  // Check what the edge function generated for the last workflow
  async checkPhase2() {
    console.log('\n🧪 Checking Phase 2: Enhanced Learning\n');

    const workflow = await this.getLastWorkflow();
    if (!workflow) return;

    console.log(`📋 Workflow: "${workflow.name}"`);
    console.log(`📝 Steps: ${workflow.steps?.length || 0}`);

    console.log('\n=== Memory Analysis ===');
    if (!workflow.memory) {
      console.log('❌ No memory generated (edge function may not have run)');
      return workflow;
    }

    const memory = workflow.memory;

    // Check phases (milestones)
    console.log('\n📍 Phases (Milestones):');
    if (memory.understanding?.phases?.length > 0) {
      memory.understanding.phases.forEach((p: any, i: number) => {
        console.log(`  ${i + 1}. ${p.name} (${p.criticality}) - steps: [${p.stepIndices?.join(', ')}]`);
        if (p.purpose) console.log(`     Purpose: ${p.purpose}`);
      });
    } else {
      console.log('  ⚠️ No phases found');
    }

    // Check blocks
    console.log('\n🧱 Blocks:');
    if (memory.understanding?.blocks?.length > 0) {
      memory.understanding.blocks.forEach((b: any, i: number) => {
        console.log(`  ${i + 1}. ${b.name} (${b.blockType}) - repeatable: ${b.isRepeatable}`);
      });
    } else {
      console.log('  ⚠️ No blocks found');
    }

    // Check clarifications (Q&A)
    console.log('\n❓ Clarifications (Q&A):');
    if (memory.clarifications?.items?.length > 0) {
      memory.clarifications.items.forEach((c: any) => {
        console.log(`  Q: ${c.question}`);
        console.log(`  A: ${c.answerText}${c.customAnswer ? ` (custom: ${c.customAnswer})` : ''}`);
      });
    } else {
      console.log('  ⚠️ No Q&A answers stored');
    }

    // Check triggers
    console.log('\n🎯 Triggers:');
    if (memory.triggers?.phrases?.length > 0) {
      console.log(`  Phrases: ${memory.triggers.phrases.join(', ')}`);
    } else {
      console.log('  ⚠️ No trigger phrases');
    }

    // Extract skill and show knowledge rules
    console.log('\n📚 Knowledge Rules (from Skill):');
    const skill = getSkill(workflow);
    if (skill.knowledge?.rules?.length > 0) {
      skill.knowledge.rules.forEach((r: any) => {
        console.log(`  • ${r.rule} (source: ${r.source})`);
      });
    } else {
      console.log('  ⚠️ No knowledge rules');
    }

    console.log('\n✅ Phase 2 check complete!');
    return workflow;
  },

  // Quick test function
  async testSkills() {
    console.log('\n🧪 Testing Phase 1: Skill Foundation\n');

    const workflows = await WorkflowStorage.loadWorkflows();
    console.log(`📋 Found ${workflows.length} workflow(s)\n`);

    if (workflows.length === 0) {
      console.log('⚠️ No workflows found. Record a workflow first!');
      return;
    }

    const skills = [];
    for (const w of workflows) {
      try {
        const skill = getSkill(w);
        skills.push(skill);
        console.log(`✅ ${w.name}`);
        console.log(`   Goal: ${skill.goal.description}`);
        console.log(`   Inputs: ${skill.inputs.required.map(i => i.name).join(', ') || 'none'}`);
        console.log(`   Milestones: ${skill.milestones.map(m => m.name).join(' → ') || 'auto-generated'}`);
        console.log(`   Triggers: ${skill.triggers.phrases.slice(0, 3).join(', ')}`);
        console.log('');
      } catch (e: any) {
        console.error(`❌ ${w.name}: ${e.message}`);
      }
    }

    if (skills.length > 0) {
      console.log('=== Skill Index Test ===');
      const index = buildSkillIndex(skills);
      console.log(`Index built with ${Object.keys(index.phraseMap).length} trigger phrases`);

      const testQueries = ['add', 'create', 'new'];
      for (const q of testQueries) {
        const matches = findSkillsForQuery(q, index);
        if (matches.length > 0) {
          console.log(`🔍 "${q}" → ${matches[0].skillId} (${Math.round(matches[0].confidence * 100)}% confidence)`);
        }
      }
    }

    console.log('\n✅ Phase 1 test complete!');
    return skills;
  }
};

console.log('🔧 MimoDebug available. Commands:');
console.log('   MimoDebug.checkPhase2()   - Check last workflow memory');
console.log('   MimoDebug.getLastWorkflow() - Get last saved workflow');
console.log('   MimoDebug.testSkills()    - Test skill extraction');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)














