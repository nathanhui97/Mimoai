import { useState, useEffect } from 'react';
import type { TeachingIntent, LearnedSkill, WorkflowStep } from '../types/workflow';
import { aiConfig } from '../lib/ai-config';

interface PostRecordingChatProps {
  teachingIntent: TeachingIntent;
  workflow: {
    name: string;
    steps: WorkflowStep[];
  };
  onComplete: (learnedSkill: LearnedSkill) => void;
  onSkip: () => void;
}

interface ChatMessage {
  role: 'ai' | 'user';
  content: string;
  question?: {
    id: string;
    type: string;
    quickOptions?: string[];
    allowFreeText: boolean;
  };
  skillSummary?: LearnedSkill;
}

interface Answer {
  questionId: string;
  answer: string;
}

export function PostRecordingChat({
  teachingIntent,
  workflow,
  onComplete,
  onSkip,
}: PostRecordingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<ChatMessage['question'] | null>(null);
  const [userInput, setUserInput] = useState('');
  const [learnedSkill, setLearnedSkill] = useState<LearnedSkill | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);

  // Start conversation on mount
  useEffect(() => {
    fetchNextQuestion([]);
  }, []);

  const fetchNextQuestion = async (currentAnswers: Answer[]) => {
    setIsProcessing(true);
    setCurrentQuestion(null);

    try {
      // Simplify workflow steps for the API
      const simplifiedSteps = workflow.steps.map((s) => ({
        type: s.type,
        description: s.description,
        url: s.payload && 'url' in s.payload ? (s.payload as any).url : '',
        inputValue: s.payload && 'value' in s.payload ? (s.payload as any).value : undefined,
        selectedOption: s.payload && 'context' in s.payload && (s.payload as any).context?.decisionSpace?.selectedText 
          ? (s.payload as any).context.decisionSpace.selectedText 
          : undefined,
        hasDropdown: s.payload && 'context' in s.payload && !!(s.payload as any).context?.decisionSpace,
        hasTextInput: s.type === 'INPUT',
      }));

      const config = aiConfig.getConfig();
      const response = await fetch(
        `${config.supabaseUrl}/functions/v1/teaching_conversation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.supabaseAnonKey}`,
          },
          body: JSON.stringify({
            mode: 'post_recording',
            teachingIntent,
            workflow: {
              name: workflow.name,
              stepCount: workflow.steps.length,
              steps: simplifiedSteps,
            },
            previousAnswers: currentAnswers,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to get next question');
      }

      const data = await response.json();

      if (data.isComplete && data.learnedSkill) {
        // Conversation complete - show summary
        setLearnedSkill(data.learnedSkill);
        setMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            content: data.aiResponse || "Here's what I learned:",
            skillSummary: data.learnedSkill,
          },
        ]);
      } else if (data.question) {
        // Show next question
        setCurrentQuestion(data.question);
        setMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            content: data.aiResponse || data.question.question,
            question: data.question,
          },
        ]);
      } else {
        // Unexpected state - complete with fallback
        console.warn('Unexpected response from teaching_conversation:', data);
        handleSkipToSave();
      }
    } catch (error) {
      console.error('Error fetching next question:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      
      // Show error message to user
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: `Sorry, I had trouble processing your workflow. ${error instanceof Error ? error.message : 'Unknown error'}. Let's skip to quick save.`,
        },
      ]);
      
      // On error, skip to save after a brief delay
      setTimeout(() => {
        handleSkipToSave();
      }, 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnswer = (answer: string) => {
    if (!currentQuestion) return;

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: answer }]);

    // Record answer
    const newAnswer: Answer = {
      questionId: currentQuestion.id,
      answer,
    };
    const newAnswers = [...answers, newAnswer];
    setAnswers(newAnswers);
    setUserInput('');

    // Fetch next question
    fetchNextQuestion(newAnswers);
  };

  const handleQuickOption = (option: string) => {
    handleAnswer(option);
  };

  const handleTextSubmit = () => {
    if (userInput.trim()) {
      handleAnswer(userInput.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  const handleConfirm = () => {
    if (learnedSkill) {
      // Mark as confirmed
      const confirmedSkill: LearnedSkill = {
        ...learnedSkill,
        teachingMetadata: {
          ...learnedSkill.teachingMetadata,
          userConfirmed: true,
        },
      };
      setIsConfirmed(true);
      onComplete(confirmedSkill);
    }
  };

  const handleSkipToSave = () => {
    onSkip();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              <p className="text-sm">{message.content}</p>

              {/* Skill Summary Card */}
              {message.skillSummary && (
                <div className="mt-3 p-3 bg-background rounded-lg border border-border">
                  <h4 className="font-medium text-sm mb-2">
                    {message.skillSummary.whatItDoes}
                  </h4>

                  {message.skillSummary.exampleQueries.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs text-muted-foreground mb-1">
                        You can say things like:
                      </p>
                      <ul className="text-xs space-y-0.5">
                        {message.skillSummary.exampleQueries.slice(0, 4).map((query, i) => (
                          <li key={i} className="text-foreground">
                            "{query}"
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {message.skillSummary.extractableVariables.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs text-muted-foreground mb-1">Variables:</p>
                      <ul className="text-xs space-y-0.5">
                        {message.skillSummary.extractableVariables.map((v, i) => (
                          <li key={i} className="text-foreground">
                            • {v.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {message.skillSummary.domain.application && (
                    <p className="text-xs text-muted-foreground">
                      App: {message.skillSummary.domain.application}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      {!learnedSkill && currentQuestion && !isProcessing && (
        <div className="space-y-3">
          {/* Quick Options */}
          {currentQuestion.quickOptions && currentQuestion.quickOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currentQuestion.quickOptions.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickOption(option)}
                  className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-full hover:bg-secondary/80 transition-colors"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Text Input (if allowed) */}
          {currentQuestion.allowFreeText && (
            <div className="relative">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                className="w-full px-4 py-2 pr-12 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <button
                onClick={handleTextSubmit}
                disabled={!userInput.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          )}

          {/* Skip Link */}
          <div className="text-center">
            <button
              onClick={handleSkipToSave}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip to quick save
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Buttons */}
      {learnedSkill && !isConfirmed && (
        <div className="space-y-3">
          <button
            onClick={handleConfirm}
            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Yes, save it!
          </button>
          <button
            onClick={handleSkipToSave}
            className="w-full py-2 px-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Let me correct something
          </button>
        </div>
      )}

      {/* Confirmed State */}
      {isConfirmed && (
        <div className="text-center py-4">
          <div className="inline-flex items-center gap-2 text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Saved!</span>
          </div>
        </div>
      )}
    </div>
  );
}
