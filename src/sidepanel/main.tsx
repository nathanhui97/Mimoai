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

console.log('🔧 MimoDebug available. Run: MimoDebug.testSkills()');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)














