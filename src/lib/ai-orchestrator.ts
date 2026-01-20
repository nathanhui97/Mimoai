/**
 * AI Orchestrator
 *
 * The brain of the skill-based AI assistant. Responsible for:
 * 1. Parsing user intent from natural language
 * 2. Matching intent to available skills
 * 3. Building execution plans (skill chains)
 * 4. Identifying missing variables
 * 5. Executing plans with user interaction
 */

import type {
  TeachableSkill,
  SkillVariable,
  ParsedIntent,
  ExecutionPlan,
  ExecutionState,
  SkillExample,
  SkillPrerequisite,
} from '../types/skill';
import { TeachableSkillLibrary } from './skill-storage';
import { aiConfig } from './ai-config';
import { SkillExecutionBridge, type SkillExecutionResult } from './skill-execution-bridge';
import { WorkflowStorage } from './storage';
import { SemanticMatcher, type MatchDecision } from './semantic-matcher';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorCallbacks {
  onQuestion?: (question: OrchestratorQuestion) => Promise<string>;
  onPlan?: (plan: ExecutionPlanPreview) => void;
  onProgress?: (current: number, total: number, description: string) => void;
  onSkillMissing?: (intent: string) => Promise<'teach' | 'try_anyway' | 'cancel'>;
  onError?: (error: string) => void;
  onWorkflowMatch?: (decision: MatchDecision) => Promise<'execute' | 'pick' | 'cancel'>;
  onExecuteWorkflow?: (workflowId: string, variables?: Record<string, string>) => Promise<boolean>;
}

export interface OrchestratorQuestion {
  id: string;
  text: string;
  type: 'text' | 'select' | 'confirm';
  options?: string[];
  context?: string;
}

export interface ExecutionPlanPreview {
  description: string;
  skills: Array<{ name: string; variables: string[] }>;
  estimatedSteps: number;
}

export interface SkillMatch {
  skill: TeachableSkill;
  score: number;
  matchedOn: string[];  // What triggered the match
}

export interface OrchestratorResult {
  success: boolean;
  executedSkills: string[];
  error?: string;
  examples?: SkillExample[];  // Examples to save for learning
}

// ============================================================================
// AI Orchestrator Class
// ============================================================================

export class AIOrchestrator {
  private callbacks: OrchestratorCallbacks;
  private executionBridge: SkillExecutionBridge;

  constructor(callbacks: OrchestratorCallbacks = {}) {
    this.callbacks = callbacks;
    this.executionBridge = new SkillExecutionBridge({
      onProgress: callbacks.onProgress,
      onError: (error, step) => {
        console.error(`[Orchestrator] Execution error at step ${step}:`, error);
        callbacks.onError?.(error);
      },
    });
  }

  /**
   * Main entry point - parse user request and execute
   */
  async execute(userRequest: string, pageContext?: PageContext): Promise<OrchestratorResult> {
    try {
      // 0. FIRST: Try semantic workflow matching (Phase 1 feature)
      const workflowResult = await this.tryMatchWorkflows(userRequest, pageContext);
      if (workflowResult) {
        return workflowResult;
      }

      // 1. Parse user intent
      const intent = await this.parseIntent(userRequest, pageContext);
      console.log('[Orchestrator] Parsed intent:', intent);

      // 1.5. Handle off-topic requests
      if (intent.isOffTopic) {
        const reason = intent.offTopicReason || "I can only help with browser automation tasks.";
        return {
          success: false,
          executedSkills: [],
          error: `OFF_TOPIC: ${reason}`,
        };
      }

      // 2. Match to skills
      const matches = await this.matchSkills(intent, pageContext);
      console.log('[Orchestrator] Matched skills:', matches.map(m => ({ name: m.skill.name, score: m.score })));

      // 3. Handle no matches
      if (matches.length === 0) {
        const userChoice = await this.callbacks.onSkillMissing?.(userRequest);
        if (userChoice === 'cancel') {
          return { success: false, executedSkills: [], error: 'No matching skills found' };
        }
        if (userChoice === 'teach') {
          return { success: false, executedSkills: [], error: 'TEACH_SKILL_REQUESTED' };
        }
        // try_anyway - fall through to attempt without skill
        return { success: false, executedSkills: [], error: 'No matching skills found' };
      }

      // 4. Build execution plan
      const plan = await this.buildPlan(intent, matches);
      console.log('[Orchestrator] Built plan:', plan.type, plan.skill?.name || plan.skills?.map(s => s.skill.name));

      // 5. Show plan preview to user
      this.callbacks.onPlan?.({
        description: this.describePlan(plan),
        skills: this.getSkillsFromPlan(plan).map(s => ({
          name: s.skill.name,
          variables: s.skill.variables.map(v => v.name),
        })),
        estimatedSteps: this.countStepsInPlan(plan),
      });

      // 6. Identify and collect missing variables
      const missingVars = this.findMissingVariables(plan, intent);
      if (missingVars.length > 0) {
        const answers = await this.collectMissingVariables(missingVars);
        plan.variables = { ...plan.variables, ...answers };
      }

      // 7. Execute plan
      return await this.executePlan(plan);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onError?.(errorMsg);
      return { success: false, executedSkills: [], error: errorMsg };
    }
  }

  /**
   * Try to match user request against saved workflows using semantic matching
   * Returns null if no workflow match found, result if matched and executed
   */
  private async tryMatchWorkflows(
    userRequest: string,
    pageContext?: PageContext
  ): Promise<OrchestratorResult | null> {
    console.log('[Orchestrator] ========== tryMatchWorkflows START ==========');
    console.log('[Orchestrator] User request:', userRequest);

    try {
      // Load all saved workflows
      console.log('[Orchestrator] Loading workflows from storage...');
      const workflows = await WorkflowStorage.loadWorkflows();
      console.log('[Orchestrator] Loaded workflows count:', workflows.length);

      if (workflows.length === 0) {
        console.log('[Orchestrator] ❌ No saved workflows to match against');
        return null;
      }

      console.log('[Orchestrator] 🔍 Attempting semantic workflow matching...');
      console.log('[Orchestrator] Query:', userRequest);
      console.log('[Orchestrator] Available workflows:', workflows.map(w => ({ id: w.id, name: w.name })));

      // Use semantic matcher to find matches
      const decision = await SemanticMatcher.matchAndDecide(
        userRequest,
        workflows,
        pageContext ? { url: pageContext.url, title: pageContext.title || '' } : undefined
      );

      console.log('[Orchestrator] Semantic match decision:', decision.action);

      // Handle decision
      switch (decision.action) {
        case 'AUTO_EXECUTE': {
          if (!decision.workflow) {
            console.error('[Orchestrator] AUTO_EXECUTE but no workflow');
            return null;
          }

          console.log('[Orchestrator] ✅ Auto-executing workflow:', decision.workflow.name);
          console.log('[Orchestrator] Confidence:', decision.matches?.[0]?.confidence);
          console.log('[Orchestrator] Extracted variables:', decision.extractedVariables);

          // Show plan preview
          this.callbacks.onPlan?.({
            description: `Run workflow "${decision.workflow.name}"`,
            skills: [{
              name: decision.workflow.name,
              variables: decision.workflow.variables?.variables?.map((v: { variableName: string }) => v.variableName) || [],
            }],
            estimatedSteps: decision.workflow.steps.length,
          });

          // Execute the workflow
          if (this.callbacks.onExecuteWorkflow) {
            const success = await this.callbacks.onExecuteWorkflow(
              decision.workflow.id,
              decision.extractedVariables
            );

            return {
              success,
              executedSkills: [decision.workflow.id],
              error: success ? undefined : 'Workflow execution failed',
            };
          } else {
            // No callback provided - signal that we found a match
            console.warn('[Orchestrator] onExecuteWorkflow callback not provided');
            return {
              success: false,
              executedSkills: [],
              error: 'WORKFLOW_EXECUTION_NOT_CONFIGURED',
            };
          }
        }

        case 'SHOW_PICKER':
        case 'CLARIFY': {
          if (!decision.matches || decision.matches.length === 0) {
            return null;
          }

          console.log('[Orchestrator] 🤔 Multiple matches, asking user...');
          console.log('[Orchestrator] Matches:', decision.matches.map(m => ({
            name: m.workflow.name,
            confidence: m.confidence,
          })));

          // Ask user via callback or question
          if (this.callbacks.onWorkflowMatch) {
            const userChoice = await this.callbacks.onWorkflowMatch(decision);
            if (userChoice === 'cancel') {
              return { success: false, executedSkills: [], error: 'User cancelled' };
            }
            // 'execute' or 'pick' - would need to get the selected workflow
            // For now, execute the top match
            if (userChoice === 'execute' && decision.matches[0]) {
              const workflow = decision.matches[0].workflow;
              if (this.callbacks.onExecuteWorkflow) {
                const success = await this.callbacks.onExecuteWorkflow(
                  workflow.id,
                  decision.matches[0].extractedVariables
                );
                return {
                  success,
                  executedSkills: [workflow.id],
                  error: success ? undefined : 'Workflow execution failed',
                };
              }
            }
          }

          // If callback exists for questions, ask via question
          if (this.callbacks.onQuestion && decision.clarification) {
            const answer = await this.callbacks.onQuestion({
              id: 'workflow-clarify',
              text: decision.clarification.question,
              type: 'select',
              options: decision.clarification.options.map(o => o.label),
            });

            // Find selected workflow
            const selectedOption = decision.clarification.options.find(o => o.label === answer);
            if (selectedOption && this.callbacks.onExecuteWorkflow) {
              const selectedMatch = decision.matches.find(m => m.workflowId === selectedOption.workflowId);
              const success = await this.callbacks.onExecuteWorkflow(
                selectedOption.workflowId,
                selectedMatch?.extractedVariables
              );
              return {
                success,
                executedSkills: [selectedOption.workflowId],
                error: success ? undefined : 'Workflow execution failed',
              };
            }
          }

          // No handler - fall through to skill matching
          return null;
        }

        case 'OFFER_TEACH':
        case 'NO_MATCH':
          // No workflow match - fall through to skill matching
          console.log('[Orchestrator] No semantic workflow match, trying skills...');
          return null;

        default:
          return null;
      }
    } catch (error) {
      console.error('[Orchestrator] Error in semantic workflow matching:', error);
      // Fall through to skill matching
      return null;
    }
  }

  /**
   * Parse user intent from natural language
   */
  async parseIntent(request: string, _pageContext?: PageContext): Promise<ParsedIntent> {
    const config = aiConfig.getConfig();

    // Try AI-based intent parsing first
    if (config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const skills = await TeachableSkillLibrary.getSkills();
        const skillList = skills.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          variables: s.variables.map(v => v.name),
        }));

        const response = await fetch(`${config.supabaseUrl}/functions/v1/parse_intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify({
            userRequest: request,
            availableSkills: skillList,
          }),
        });

        if (response.ok) {
          const data = await response.json();

          // Check for off-topic response
          if (data.isOffTopic) {
            return {
              action: '',
              objects: [],
              parameters: {},
              context: [],
              isOffTopic: true,
              offTopicReason: data.offTopicReason || 'This request is not related to browser automation.',
            };
          }

          return {
            action: data.action || 'perform',
            objects: data.objects || [],
            parameters: data.parameters || {},
            context: data.context || [],
            selectionMode: data.selectionMode,
            count: data.count,
            isOffTopic: false,
          };
        }
      } catch (err) {
        console.warn('[Orchestrator] AI intent parsing failed, using fallback:', err);
      }
    }

    // Fallback: Simple rule-based parsing
    return this.parseIntentFallback(request);
  }

  /**
   * Simple rule-based intent parsing (fallback)
   */
  private parseIntentFallback(request: string): ParsedIntent {
    const words = request.toLowerCase().split(/\s+/);

    // Common action verbs
    const actionVerbs = ['add', 'create', 'make', 'insert', 'submit', 'save', 'delete', 'remove', 'update', 'edit', 'change', 'open', 'close', 'click', 'select', 'fill', 'enter', 'type'];
    const action = words.find(w => actionVerbs.includes(w)) || 'perform';

    // Objects are typically nouns after the action
    const actionIndex = words.indexOf(action);
    const objects = actionIndex >= 0 ? words.slice(actionIndex + 1).filter(w => w.length > 2) : words.filter(w => w.length > 2);

    // Extract parameters from quoted strings
    const parameters: Record<string, string> = {};
    const quotedStrings = request.match(/"([^"]+)"/g) || [];
    quotedStrings.forEach((qs, i) => {
      parameters[`param${i + 1}`] = qs.replace(/"/g, '');
    });

    // Detect selection mode
    let selectionMode: ParsedIntent['selectionMode'];
    let count: number | undefined;

    if (words.includes('all')) {
      selectionMode = 'all';
    } else if (words.includes('first')) {
      selectionMode = 'first';
    } else {
      const numberMatch = request.match(/(\d+)\s*(item|product|thing|result|match)/i);
      if (numberMatch) {
        selectionMode = 'count';
        count = parseInt(numberMatch[1]);
      }
    }

    return {
      action,
      objects: objects.slice(0, 3),  // Limit to 3 objects
      parameters,
      context: [],
      selectionMode,
      count,
    };
  }

  /**
   * Match intent to available skills
   */
  async matchSkills(intent: ParsedIntent, _pageContext?: PageContext): Promise<SkillMatch[]> {
    const skills = await TeachableSkillLibrary.getSkills();
    const matches: SkillMatch[] = [];

    for (const skill of skills) {
      const match = this.scoreSkillMatch(skill, intent);
      if (match.score > 0.3) {
        matches.push(match);
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Score how well a skill matches the intent
   */
  private scoreSkillMatch(skill: TeachableSkill, intent: ParsedIntent): SkillMatch {
    let score = 0;
    const matchedOn: string[] = [];

    const intentText = `${intent.action} ${intent.objects.join(' ')}`.toLowerCase();

    // 1. Name match (highest weight)
    const nameLower = skill.name.toLowerCase();
    if (nameLower.includes(intentText) || intentText.includes(nameLower)) {
      score += 0.4;
      matchedOn.push('name');
    } else {
      // Partial name match
      const nameWords = nameLower.split(/\s+/);
      const intentWords = intentText.split(/\s+/);
      const commonWords = nameWords.filter(nw => intentWords.some(iw => iw.includes(nw) || nw.includes(iw)));
      if (commonWords.length > 0) {
        score += 0.2 * (commonWords.length / nameWords.length);
        matchedOn.push('name-partial');
      }
    }

    // 2. Synonym match
    for (const synonym of skill.synonyms) {
      if (intentText.includes(synonym.toLowerCase())) {
        score += 0.2;
        matchedOn.push(`synonym:${synonym}`);
        break;
      }
    }

    // 3. Description match
    const descLower = skill.description.toLowerCase();
    const intentWords = intentText.split(/\s+/).filter(w => w.length > 2);
    const descMatches = intentWords.filter(w => descLower.includes(w));
    if (descMatches.length > 0) {
      score += 0.1 * (descMatches.length / intentWords.length);
      matchedOn.push('description');
    }

    // 4. Example match (from successful executions)
    for (const example of skill.examples) {
      const exampleLower = example.userRequest.toLowerCase();
      if (exampleLower.includes(intentText) || intentText.includes(exampleLower)) {
        score += 0.3;
        matchedOn.push(`example:${example.userRequest}`);
        break;
      }
    }

    // 5. Usage context match
    const contextLower = skill.usageContext.toLowerCase();
    const contextMatches = intentWords.filter(w => contextLower.includes(w));
    if (contextMatches.length > 0) {
      score += 0.1 * (contextMatches.length / intentWords.length);
      matchedOn.push('usage-context');
    }

    // Cap at 1.0
    score = Math.min(score, 1.0);

    return { skill, score, matchedOn };
  }

  /**
   * Build execution plan from matched skills
   */
  async buildPlan(intent: ParsedIntent, matches: SkillMatch[]): Promise<ExecutionPlan> {
    // Single high-confidence match
    if (matches.length === 1 || (matches[0].score > 0.7 && matches[0].score > matches[1]?.score * 1.5)) {
      return {
        type: 'single',
        skill: matches[0].skill,
        variables: this.extractVariablesFromIntent(matches[0].skill, intent),
        repetition: this.determineRepetition(intent),
      };
    }

    // Multiple skills might be needed - build a chain
    // For now, just use the best match
    // TODO: Use AI to plan skill chains for complex requests
    return {
      type: 'single',
      skill: matches[0].skill,
      variables: this.extractVariablesFromIntent(matches[0].skill, intent),
      repetition: this.determineRepetition(intent),
    };
  }

  /**
   * Extract variable values from intent parameters
   */
  private extractVariablesFromIntent(skill: TeachableSkill, intent: ParsedIntent): Record<string, string> {
    const variables: Record<string, string> = {};

    // Map intent parameters to skill variables
    for (const variable of skill.variables) {
      const varNameLower = variable.name.toLowerCase();

      // Check if intent has a matching parameter
      for (const [key, value] of Object.entries(intent.parameters)) {
        if (key.toLowerCase().includes(varNameLower) || varNameLower.includes(key.toLowerCase())) {
          variables[variable.name] = value;
          break;
        }
      }

      // Check if any object matches
      if (!variables[variable.name]) {
        for (const obj of intent.objects) {
          if (variable.description?.toLowerCase().includes(obj) || variable.name.toLowerCase().includes(obj)) {
            variables[variable.name] = obj;
            break;
          }
        }
      }
    }

    return variables;
  }

  /**
   * Determine repetition from intent
   */
  private determineRepetition(intent: ParsedIntent): ExecutionPlan['repetition'] {
    if (intent.selectionMode === 'count' && intent.count) {
      return { count: intent.count };
    }
    if (intent.selectionMode === 'all') {
      return { until: 'no more matches' };
    }
    return undefined;
  }

  /**
   * Find variables that are required but not provided
   */
  private findMissingVariables(plan: ExecutionPlan, _intent: ParsedIntent): SkillVariable[] {
    const missing: SkillVariable[] = [];
    const skills = this.getSkillsFromPlan(plan);

    for (const { skill } of skills) {
      for (const variable of skill.variables) {
        if (variable.required && !plan.variables[variable.name]) {
          missing.push(variable);
        }
      }
    }

    return missing;
  }

  /**
   * Collect missing variable values from user
   */
  private async collectMissingVariables(missing: SkillVariable[]): Promise<Record<string, string>> {
    const answers: Record<string, string> = {};

    for (const variable of missing) {
      const question: OrchestratorQuestion = {
        id: variable.name,
        text: variable.description || `What is the ${variable.name}?`,
        type: variable.options?.length ? 'select' : 'text',
        options: variable.options,
        context: `Required for skill execution`,
      };

      if (this.callbacks.onQuestion) {
        const answer = await this.callbacks.onQuestion(question);
        answers[variable.name] = answer;
      }
    }

    return answers;
  }

  /**
   * Execute the plan
   */
  async executePlan(plan: ExecutionPlan): Promise<OrchestratorResult> {
    const executedSkills: string[] = [];
    const examples: SkillExample[] = [];
    const state: ExecutionState = {
      completedSkills: [],
      flags: [],
      variables: plan.variables,
    };

    const skills = this.getSkillsFromPlan(plan);
    const totalSteps = this.countStepsInPlan(plan);
    let currentStep = 0;

    for (const { skill, variables } of skills) {
      // Check prerequisites before executing
      const prereqResult = await this.checkPrerequisites(skill, state);

      if (!prereqResult.allMet) {
        // Try to satisfy prerequisites automatically
        const satisfied = await this.trySatisfyPrerequisites(prereqResult.failures, state);

        if (!satisfied) {
          // Ask user what to do
          const failureReasons = prereqResult.failures.map(f => f.reason).join('; ');
          console.warn('[Orchestrator] Prerequisites not met:', failureReasons);

          // For now, skip the skill and continue (could add callback for user choice)
          this.callbacks.onError?.(`Cannot run "${skill.name}": ${failureReasons}`);
          continue;
        }
      }

      // Report progress
      this.callbacks.onProgress?.(currentStep, totalSteps, `Running ${skill.name}`);

      // Execute the skill using skill-execution-bridge
      console.log('[Orchestrator] Executing skill:', skill.name, 'with variables:', variables);

      // Handle repetition
      const repetition = plan.repetition;
      const iterations = (repetition && 'count' in repetition) ? repetition.count : 1;

      let executionSuccess = true;
      let executionError: string | undefined;

      for (let i = 0; i < iterations; i++) {
        this.callbacks.onProgress?.(currentStep, totalSteps, `${skill.name} iteration ${i + 1}/${iterations}`);

        // Actually execute the skill using the bridge
        try {
          const result: SkillExecutionResult = await this.executionBridge.executeSkill(
            skill,
            { ...plan.variables, ...variables }
          );

          if (!result.success) {
            executionSuccess = false;
            executionError = result.error || `Failed at step ${result.failedAtStep}`;
            console.error('[Orchestrator] Skill execution failed:', executionError);
            break;
          }

          currentStep += result.stepsCompleted;
          console.log(`[Orchestrator] Skill "${skill.name}" iteration ${i + 1} completed in ${result.durationMs}ms`);
        } catch (err) {
          executionSuccess = false;
          executionError = err instanceof Error ? err.message : String(err);
          console.error('[Orchestrator] Skill execution threw error:', err);
          break;
        }
      }

      if (!executionSuccess) {
        this.callbacks.onError?.(executionError || 'Unknown execution error');
        return {
          success: false,
          executedSkills,
          error: executionError,
          examples,
        };
      }

      // Update state with completed skill
      state.completedSkills.push(skill.id);
      state.flags.push(...skill.provides);
      executedSkills.push(skill.id);

      // Record example for learning
      examples.push({
        userRequest: `Executed ${skill.name}`,
        variableValues: variables,
        success: true,
        timestamp: Date.now(),
      });
    }

    this.callbacks.onProgress?.(totalSteps, totalSteps, 'Complete');

    return {
      success: true,
      executedSkills,
      examples,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getSkillsFromPlan(plan: ExecutionPlan): Array<{ skill: TeachableSkill; variables: Record<string, string> }> {
    if (plan.type === 'single' && plan.skill) {
      return [{ skill: plan.skill, variables: plan.variables }];
    }
    if (plan.type === 'chain' && plan.skills) {
      return plan.skills;
    }
    return [];
  }

  private countStepsInPlan(plan: ExecutionPlan): number {
    const skills = this.getSkillsFromPlan(plan);
    let stepCount = 0;
    for (const { skill } of skills) {
      stepCount += skill.steps.length;
    }
    if (plan.repetition && 'count' in plan.repetition) {
      stepCount *= plan.repetition.count;
    }
    return stepCount;
  }

  private describePlan(plan: ExecutionPlan): string {
    const skills = this.getSkillsFromPlan(plan);
    if (skills.length === 0) return 'No skills to execute';

    if (skills.length === 1) {
      const s = skills[0];
      let desc = `Run "${s.skill.name}"`;
      if (plan.repetition && 'count' in plan.repetition && plan.repetition.count > 1) {
        desc += ` ${plan.repetition.count} times`;
      }
      return desc;
    }

    return `Run ${skills.length} skills: ${skills.map(s => s.skill.name).join(' → ')}`;
  }

  // ============================================================================
  // Prerequisite Checking (Phase 7)
  // ============================================================================

  /**
   * Check if all prerequisites are met for a skill
   */
  private async checkPrerequisites(
    skill: TeachableSkill,
    state: ExecutionState
  ): Promise<PrerequisiteResult> {
    const failures: PrerequisiteFailure[] = [];

    for (const prereq of skill.prerequisites) {
      const met = await this.checkSinglePrerequisite(prereq, state);
      if (!met) {
        failures.push({
          prerequisite: prereq,
          reason: prereq.errorMessage,
        });
      }
    }

    return {
      allMet: failures.length === 0,
      failures,
    };
  }

  /**
   * Check a single prerequisite
   */
  private async checkSinglePrerequisite(
    prereq: SkillPrerequisite,
    state: ExecutionState
  ): Promise<boolean> {
    switch (prereq.type) {
      case 'page':
        return this.matchesUrlPattern(window.location.href, prereq.urlPattern || '');

      case 'element':
        return this.checkElementExists(prereq.elementSelector, prereq.elementText);

      case 'skill':
        return prereq.skillId ? state.completedSkills.includes(prereq.skillId) : false;

      case 'state':
        return prereq.stateCheck ? state.flags.includes(prereq.stateCheck) : false;

      default:
        return true;
    }
  }

  /**
   * Check if a URL matches a pattern (supports * wildcards)
   */
  private matchesUrlPattern(url: string, pattern: string): boolean {
    if (!pattern) return true;

    // Convert pattern to regex: * becomes .*, escape other special chars
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*'); // Convert * to .*

    try {
      const regex = new RegExp(regexPattern, 'i');
      return regex.test(url);
    } catch {
      // Invalid pattern, do simple string match
      return url.includes(pattern);
    }
  }

  /**
   * Check if an element exists in the DOM
   */
  private checkElementExists(selector?: string, text?: string): boolean {
    if (!selector && !text) return false;

    if (selector) {
      const element = document.querySelector(selector);
      if (!element) return false;

      // If text is specified, check if element contains it
      if (text) {
        return element.textContent?.includes(text) || false;
      }
      return true;
    }

    // Text-only search
    if (text) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent?.includes(text)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Try to satisfy prerequisites automatically (e.g., navigate to required page)
   */
  private async trySatisfyPrerequisites(
    failures: PrerequisiteFailure[],
    _state: ExecutionState
  ): Promise<boolean> {
    for (const failure of failures) {
      const prereq = failure.prerequisite;

      if (prereq.type === 'page' && prereq.urlPattern) {
        // Try to find a navigation skill that would get us to the right page
        console.log('[Orchestrator] Would try to navigate to:', prereq.urlPattern);
        // For now, we can't auto-navigate - would need to find navigation skills
        return false;
      }

      if (prereq.type === 'skill' && prereq.skillId) {
        // Could try to run the required skill first
        console.log('[Orchestrator] Would try to run prerequisite skill:', prereq.skillId);
        // For now, just fail - could enhance to chain prerequisite skills
        return false;
      }

      // Other prerequisite types can't be auto-satisfied
      return false;
    }

    return true;
  }
}

/**
 * Result of checking prerequisites
 */
interface PrerequisiteResult {
  allMet: boolean;
  failures: PrerequisiteFailure[];
}

/**
 * A failed prerequisite check
 */
interface PrerequisiteFailure {
  prerequisite: SkillPrerequisite;
  reason: string;
}

// ============================================================================
// Page Context Type
// ============================================================================

export interface PageContext {
  url: string;
  title?: string;
  elements?: string[];  // Visible element descriptions
}
