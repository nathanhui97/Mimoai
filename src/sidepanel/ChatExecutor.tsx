/**
 * ChatExecutor Component
 *
 * Provides a chat interface for executing skills via natural language.
 * Integrates with the AI Orchestrator to parse intents and execute skills.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TeachableSkill } from '../types/skill';
import type { SavedWorkflow } from '../types/workflow';
import { AIOrchestrator, type OrchestratorQuestion, type ExecutionPlanPreview } from '../lib/ai-orchestrator';
import { TeachableSkillLibrary } from '../lib/skill-storage';
import { WorkflowStorage } from '../lib/storage';

interface ChatExecutorProps {
  onTeachSkill?: () => void;  // Called when user wants to teach a new skill
  onClose?: () => void;
  onExecuteWorkflow?: (workflow: SavedWorkflow, variables?: Record<string, string>) => Promise<boolean>;  // Called to execute a matched workflow
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type?: 'text' | 'question' | 'plan' | 'progress' | 'result' | 'error';
  data?: unknown;
  timestamp: number;
}

interface PendingQuestion {
  question: OrchestratorQuestion;
  resolve: (answer: string) => void;
}

// Helper component for rendering plan details
function PlanDetails({ data }: { data: ExecutionPlanPreview }) {
  return (
    <div className="mt-2 pt-2 border-t border-blue-200/50 text-xs">
      {(data.skills || []).map((skill, i) => (
        <div key={i} className="flex items-center gap-1 mt-1">
          <span className="text-blue-500">•</span>
          <span>{skill.name}</span>
          {skill.variables.length > 0 && (
            <span className="text-blue-400">
              ({skill.variables.join(', ')})
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// Helper component for rendering progress bar
function ProgressBar({ data }: { data: { current: number; total: number } }) {
  const percentage = data.total > 0 ? (data.current / data.total) * 100 : 0;
  return (
    <div className="mt-2">
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function ChatExecutor({ onTeachSkill, onClose, onExecuteWorkflow }: ChatExecutorProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: "What would you like me to do? I can help you with tasks I've learned.",
      type: 'text',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [availableSkills, setAvailableSkills] = useState<TeachableSkill[]>([]);
  const [showSkillList, setShowSkillList] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      const skills = await TeachableSkillLibrary.getSkills();
      setAvailableSkills(skills);
    };
    loadSkills();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when not executing
  useEffect(() => {
    if (!isExecuting && !pendingQuestion) {
      inputRef.current?.focus();
    }
  }, [isExecuting, pendingQuestion]);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [
      ...prev,
      {
        ...msg,
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || isExecuting) return;

    const userMessage = input.trim();
    setInput('');
    addMessage({ role: 'user', content: userMessage, type: 'text' });

    // If answering a question
    if (pendingQuestion) {
      pendingQuestion.resolve(userMessage);
      setPendingQuestion(null);
      return;
    }

    // Start execution
    setIsExecuting(true);

    const orchestrator = new AIOrchestrator({
      onQuestion: async (question) => {
        return new Promise<string>((resolve) => {
          addMessage({
            role: 'assistant',
            content: question.text,
            type: 'question',
            data: question,
          });
          setPendingQuestion({ question, resolve });
        });
      },

      onPlan: (plan: ExecutionPlanPreview) => {
        addMessage({
          role: 'assistant',
          content: `I'll ${plan.description.toLowerCase()}`,
          type: 'plan',
          data: plan,
        });
      },

      onProgress: (current, total, description) => {
        // Update the last progress message or add a new one
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.type === 'progress') {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                content: `${description} (${current}/${total})`,
                data: { current, total, description },
              },
            ];
          }
          return [
            ...prev,
            {
              id: `progress-${Date.now()}`,
              role: 'system' as const,
              content: `${description} (${current}/${total})`,
              type: 'progress' as const,
              data: { current, total, description },
              timestamp: Date.now(),
            },
          ];
        });
      },

      onSkillMissing: async (intent) => {
        addMessage({
          role: 'assistant',
          content: `I don't know how to "${intent}" yet. Would you like to teach me?`,
          type: 'question',
          data: { type: 'teach_skill', intent },
        });

        return new Promise<'teach' | 'try_anyway' | 'cancel'>((resolve) => {
          setPendingQuestion({
            question: {
              id: 'teach-skill',
              text: '',
              type: 'select',
              options: ['Yes, teach me', 'Skip for now'],
            },
            resolve: (answer) => {
              if (answer.toLowerCase().includes('yes') || answer.toLowerCase().includes('teach')) {
                resolve('teach');
              } else {
                resolve('cancel');
              }
            },
          });
        });
      },

      onError: (error) => {
        addMessage({
          role: 'assistant',
          content: `Sorry, something went wrong: ${error}`,
          type: 'error',
        });
      },

      // Handle workflow execution from semantic matching
      onExecuteWorkflow: async (workflowId, variables) => {
        if (!onExecuteWorkflow) {
          console.warn('[ChatExecutor] onExecuteWorkflow prop not provided');
          return false;
        }

        try {
          // Load the workflow
          const workflow = await WorkflowStorage.loadWorkflow(workflowId);
          if (!workflow) {
            console.error('[ChatExecutor] Workflow not found:', workflowId);
            return false;
          }

          console.log('[ChatExecutor] Executing matched workflow:', workflow.name);
          console.log('[ChatExecutor] With variables:', variables);

          // Execute via the parent's handler
          const success = await onExecuteWorkflow(workflow, variables);
          return success;
        } catch (error) {
          console.error('[ChatExecutor] Workflow execution error:', error);
          return false;
        }
      },
    });

    try {
      const result = await orchestrator.execute(userMessage, {
        url: window.location.href,
      });

      if (result.error === 'TEACH_SKILL_REQUESTED') {
        onTeachSkill?.();
      } else if (result.success) {
        addMessage({
          role: 'assistant',
          content: 'Done!',
          type: 'result',
          data: result,
        });

        // Update examples for learning
        // TODO: Link examples to specific skills for learning
        // if (result.examples) { ... }
      } else if (result.error) {
        // Handle off-topic requests with a friendly message
        if (result.error.startsWith('OFF_TOPIC:')) {
          const reason = result.error.replace('OFF_TOPIC:', '').trim();
          addMessage({
            role: 'assistant',
            content: `${reason}\n\nI can help you with browser automation tasks like clicking buttons, filling forms, or running skills you've taught me.`,
            type: 'text',
          });
        } else if (result.error === 'No matching skills found') {
          addMessage({
            role: 'assistant',
            content: "I don't know how to do that yet. Would you like to teach me?",
            type: 'error',
          });
        } else {
          addMessage({
            role: 'assistant',
            content: `Failed: ${result.error}`,
            type: 'error',
          });
        }
      }
    } catch (err) {
      console.error('[ChatExecutor] Execution error:', err);
      addMessage({
        role: 'assistant',
        content: `An error occurred: ${err instanceof Error ? err.message : 'Unknown error'}`,
        type: 'error',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleQuickAction = (skillName: string) => {
    setInput(skillName);
    setShowSkillList(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <span className="font-medium text-foreground">Chat</span>
          {availableSkills.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({availableSkills.length} skills available)
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : msg.type === 'error'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : msg.type === 'progress'
                  ? 'bg-muted/50 text-muted-foreground text-sm'
                  : msg.type === 'plan'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-muted text-foreground'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

              {/* Plan details */}
              {msg.type === 'plan' && msg.data != null && (
                <PlanDetails data={msg.data as ExecutionPlanPreview} />
              )}

              {/* Progress bar */}
              {msg.type === 'progress' && msg.data != null && (
                <ProgressBar data={msg.data as { current: number; total: number }} />
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator when executing */}
        {isExecuting && !pendingQuestion && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions (available skills) */}
      {showSkillList && availableSkills.length > 0 && (
        <div className="absolute bottom-20 left-4 right-4 bg-card border border-border rounded-xl shadow-lg max-h-48 overflow-y-auto">
          <div className="p-2 space-y-1">
            {availableSkills.map((skill) => (
              <button
                key={skill.id}
                onClick={() => handleQuickAction(skill.name)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted text-sm transition-colors"
              >
                <span className="font-medium text-foreground">{skill.name}</span>
                {skill.description && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    - {skill.description.slice(0, 40)}...
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t border-border/60">
        {/* Pending question options */}
        {pendingQuestion?.question.options && (
          <div className="flex flex-wrap gap-2 mb-3">
            {pendingQuestion.question.options.map((option, i) => (
              <button
                key={i}
                onClick={() => {
                  pendingQuestion.resolve(option);
                  setPendingQuestion(null);
                  addMessage({ role: 'user', content: option, type: 'text' });
                }}
                className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Skill list toggle */}
          {availableSkills.length > 0 && (
            <button
              onClick={() => setShowSkillList(!showSkillList)}
              className={`p-2 rounded-lg transition-colors ${
                showSkillList
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="Show available skills"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Text input */}
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingQuestion
                  ? 'Type your answer...'
                  : isExecuting
                  ? 'Processing...'
                  : 'What would you like me to do?'
              }
              disabled={isExecuting && !pendingQuestion}
              className="w-full px-4 py-2.5 pr-12 text-sm border border-border rounded-full bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || (isExecuting && !pendingQuestion)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>

        {/* No skills hint */}
        {availableSkills.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            No skills yet.{' '}
            <button onClick={onTeachSkill} className="text-primary hover:underline">
              Teach me one
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
