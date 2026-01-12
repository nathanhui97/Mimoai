import { useState } from 'react';
import type { TeachingIntent } from '../types/workflow';
import { aiConfig } from '../lib/ai-config';

interface PreRecordingChatProps {
  onIntentCaptured: (intent: TeachingIntent, suggestedName: string, aiResponse: string) => void;
  onSkip: () => void;
  isLoading?: boolean;
}

interface ChatMessage {
  role: 'ai' | 'user';
  content: string;
  watchFor?: string[];
}

export function PreRecordingChat({
  onIntentCaptured,
  onSkip,
  isLoading = false,
}: PreRecordingChatProps) {
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'ai',
      content: 'What do you want to teach me?',
    },
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [capturedIntent, setCapturedIntent] = useState<{
    intent: TeachingIntent;
    suggestedName: string;
    aiResponse: string;
    watchFor: string[];
  } | null>(null);

  const handleSend = async () => {
    if (!userInput.trim() || isProcessing) return;

    const userMessage = userInput.trim();
    setUserInput('');
    setIsProcessing(true);

    // Add user message to chat
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    try {
      // Call the teaching_conversation Edge Function
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
            mode: 'pre_recording',
            userMessage,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to process intent');
      }

      const data = await response.json();

      // Add AI response to chat
      const watchFor = data.intent?.expectedVariables || [];
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: data.aiResponse,
          watchFor: watchFor.length > 0 ? watchFor : undefined,
        },
      ]);

      // Store the captured intent
      setCapturedIntent({
        intent: data.intent,
        suggestedName: data.suggestedName,
        aiResponse: data.aiResponse,
        watchFor,
      });
    } catch (error) {
      console.error('Error capturing intent:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      
      // Fallback response with error info
      const errorMessage = error instanceof Error ? ` (${error.message})` : '';
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: `Got it! I'll watch what you do${errorMessage}. Start whenever you're ready!`,
        },
      ]);
      setCapturedIntent({
        intent: {
          userDescription: userMessage,
          expectedAction: { verb: 'perform', object: 'task', isGeneric: true },
          expectedVariables: [],
          capturedAt: Date.now(),
        },
        suggestedName: 'New Task',
        aiResponse: "Got it! I'll watch what you do. Start whenever you're ready!",
        watchFor: [],
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStartRecording = () => {
    if (capturedIntent) {
      onIntentCaptured(
        capturedIntent.intent,
        capturedIntent.suggestedName,
        capturedIntent.aiResponse
      );
    }
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
              {message.watchFor && message.watchFor.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <p className="text-xs opacity-75 mb-1">I'll watch for:</p>
                  <ul className="text-xs space-y-0.5">
                    {message.watchFor.map((item, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span className="text-primary">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
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

      {/* Input Area or Start Recording Button */}
      {!capturedIntent ? (
        <div className="space-y-3">
          {/* Input */}
          <div className="relative">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., How to download a dashboard"
              disabled={isProcessing || isLoading}
              className="w-full px-4 py-3 pr-12 text-sm border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={!userInput.trim() || isProcessing || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>

          {/* Skip Link */}
          <div className="text-center">
            <button
              onClick={onSkip}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Just start recording
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Start Recording Button */}
          <button
            onClick={handleStartRecording}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
            </svg>
            Start Recording
          </button>

          {/* Change Mind Link */}
          <div className="text-center">
            <button
              onClick={() => {
                setCapturedIntent(null);
                setMessages([{ role: 'ai', content: 'What do you want to teach me?' }]);
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Let me rephrase that
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
