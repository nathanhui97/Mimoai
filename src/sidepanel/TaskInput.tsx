import { useState, useEffect, useRef } from 'react';

interface TaskInputProps {
  onSearch: (query: string) => void;
  onSubmit: (query: string) => void;
  onShowMeHow?: () => void;
  isRecording: boolean;
  disabled: boolean;
  placeholder?: string;
}

export function TaskInput({
  onSearch,
  onSubmit,
  isRecording,
  disabled,
  placeholder = "What would you like to do?"
}: TaskInputProps) {
  const [query, setQuery] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for search
    searchTimeoutRef.current = setTimeout(() => {
      onSearch(query);
    }, 300); // 300ms debounce

    // Cleanup on unmount or when query changes
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, onSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      onSubmit(query.trim());
    }
  };

  return (
    <div className="mb-6">
      {/* Main Input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isRecording}
          className="w-full px-4 py-3 text-base border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          autoFocus
        />
        
        {/* Clear button */}
        {query && !isRecording && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Clear"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

    </div>
  );
}
