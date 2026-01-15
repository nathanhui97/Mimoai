/**
 * Option Confirmation Modal
 *
 * Shows when AI is unsure about which dropdown option to select.
 * Supports multi-select with checkboxes for selecting multiple variants.
 */

import { useState, useMemo } from 'react';

interface MatchedOption {
  option: string;
  confidence: number;
  preSelected: boolean;
}

export interface OptionConfirmationProps {
  userInput: string;
  matches: MatchedOption[];
  allOptions: string[];
  fieldName: string;
  onConfirm: (selectedOptions: string[]) => void;
  onSkip: () => void;
}

export function OptionConfirmationModal({
  userInput,
  matches,
  allOptions,
  fieldName,
  onConfirm,
  onSkip,
}: OptionConfirmationProps) {
  // Initialize selected options based on pre-selection
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const match of matches) {
      if (match.preSelected) {
        initial.add(match.option);
      }
    }
    return initial;
  });

  // State for "Other" option
  const [showOtherDropdown, setShowOtherDropdown] = useState(false);
  const [otherSearch, setOtherSearch] = useState('');
  const [selectedOther, setSelectedOther] = useState<string | null>(null);

  // Filter "Other" options (exclude already shown matches)
  const otherOptions = useMemo(() => {
    const matchedSet = new Set(matches.map(m => m.option));
    return allOptions.filter(opt => !matchedSet.has(opt));
  }, [matches, allOptions]);

  // Filtered other options based on search
  const filteredOtherOptions = useMemo(() => {
    if (!otherSearch.trim()) return otherOptions.slice(0, 10);
    const search = otherSearch.toLowerCase();
    return otherOptions
      .filter(opt => opt.toLowerCase().includes(search))
      .slice(0, 10);
  }, [otherOptions, otherSearch]);

  const toggleOption = (option: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(option)) {
        next.delete(option);
      } else {
        next.add(option);
      }
      return next;
    });
  };

  const handleOtherSelect = (option: string) => {
    setSelectedOther(option);
    setSelected(prev => {
      const next = new Set(prev);
      next.add(option);
      return next;
    });
    setShowOtherDropdown(false);
    setOtherSearch('');
  };

  const handleConfirm = () => {
    const selectedArray = Array.from(selected);
    if (selectedArray.length > 0) {
      onConfirm(selectedArray);
    }
  };

  const formatConfidence = (confidence: number) => {
    return `${Math.round(confidence * 100)}%`;
  };

  const hasSelections = selected.size > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onSkip}
      />

      {/* Modal */}
      <div className="relative bg-card p-6 rounded-2xl border border-border/60 shadow-soft-xl max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto animate-scale-in">
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Which option matches?
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Select the best match for <span className="font-medium text-foreground">"{userInput}"</span>
            {fieldName && <span> in {fieldName}</span>}
          </p>
        </div>

        {/* Options List */}
        <div className="space-y-2 mb-4">
          {matches.map((match, idx) => (
            <label
              key={idx}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                selected.has(match.option)
                  ? 'bg-primary/5 border-primary/40'
                  : 'bg-muted/30 border-border/60 hover:border-border'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(match.option)}
                onChange={() => toggleOption(match.option)}
                className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground break-words">
                  {match.option}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                  match.confidence >= 0.8
                    ? 'bg-green-100 text-green-700'
                    : match.confidence >= 0.5
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {formatConfidence(match.confidence)}
              </span>
            </label>
          ))}

          {/* Selected "Other" option */}
          {selectedOther && !matches.some(m => m.option === selectedOther) && (
            <label
              className="flex items-start gap-3 p-3 rounded-xl border bg-primary/5 border-primary/40 cursor-pointer transition-all duration-200"
            >
              <input
                type="checkbox"
                checked={selected.has(selectedOther)}
                onChange={() => toggleOption(selectedOther)}
                className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground break-words">
                  {selectedOther}
                </p>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">
                Other
              </span>
            </label>
          )}

          {/* Other option dropdown */}
          {otherOptions.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOtherDropdown(!showOtherDropdown)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${
                  showOtherDropdown
                    ? 'bg-muted/50 border-primary/40'
                    : 'bg-muted/30 border-border/60 hover:border-border'
                }`}
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  <svg
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      showOtherDropdown ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
                <span className="text-sm text-muted-foreground">
                  Choose from other options...
                </span>
              </button>

              {showOtherDropdown && (
                <div className="absolute left-0 right-0 mt-2 bg-card border border-border/60 rounded-xl shadow-lg z-10 overflow-hidden">
                  {/* Search input */}
                  <div className="p-2 border-b border-border/60">
                    <input
                      type="text"
                      value={otherSearch}
                      onChange={(e) => setOtherSearch(e.target.value)}
                      placeholder="Search options..."
                      className="w-full px-3 py-2 text-sm bg-muted/30 border border-border/60 rounded-lg focus:outline-none focus:border-primary/40"
                      autoFocus
                    />
                  </div>

                  {/* Options list */}
                  <div className="max-h-48 overflow-y-auto">
                    {filteredOtherOptions.length > 0 ? (
                      filteredOtherOptions.map((option, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleOtherSelect(option)}
                          className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          {option}
                        </button>
                      ))
                    ) : (
                      <p className="px-4 py-3 text-sm text-muted-foreground">
                        No matching options
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!hasSelections}
            className={`flex-1 px-5 py-3 rounded-xl font-semibold active:scale-[0.98] shadow-soft transition-all duration-200 ${
              hasSelections
                ? 'bg-primary text-primary-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            }`}
          >
            Confirm{selected.size > 1 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
