import type { SavedWorkflow } from '../types/workflow';

interface TaskSuggestionsProps {
  query: string;
  suggestions: SavedWorkflow[];
  onSelect: (workflow: SavedWorkflow) => void;
  onShowMeHow: () => void;
  isExecuting: boolean;
}

export function TaskSuggestions({
  query,
  suggestions,
  onSelect,
  onShowMeHow,
  isExecuting
}: TaskSuggestionsProps) {
  // Helper to highlight matching text
  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) => 
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800">{part}</mark>
      ) : (
        part
      )
    );
  };

  // Show suggestions if we have matches
  if (suggestions.length > 0) {
    return (
      <div className="mb-6 space-y-2">
        <div className="text-xs text-muted-foreground mb-2">
          {suggestions.length === 1 ? '1 task found' : `${suggestions.length} tasks found`}
        </div>
        
        {suggestions.map((workflow) => (
          <div
            key={workflow.id}
            className="p-3 bg-card rounded-lg border border-border hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground truncate">
                  {highlightMatch(workflow.name, query)}
                </div>
                {workflow.description && (
                  <div className="text-sm text-muted-foreground mt-0.5 truncate">
                    {highlightMatch(workflow.description, query)}
                  </div>
                )}
              </div>
              <button
                onClick={() => onSelect(workflow)}
                disabled={isExecuting}
                className="px-4 py-1.5 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {isExecuting ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
        ))}
        
        {/* Fallback option */}
        <div className="pt-2 text-center">
          <button
            onClick={onShowMeHow}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Don't see what you need? Show me how to do it
          </button>
        </div>
      </div>
    );
  }

  // No matches found
  if (query.trim()) {
    return (
      <div className="mb-6 p-6 bg-muted rounded-lg border border-border text-center">
        <p className="text-foreground mb-3">
          I don't know how to do that yet.
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Would you like to teach me?
        </p>
        <button
          onClick={onShowMeHow}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Show me how
        </button>
      </div>
    );
  }

  // Empty state (no query)
  return null;
}
