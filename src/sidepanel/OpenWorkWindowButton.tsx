interface OpenWorkWindowButtonProps {
  variant?: 'icon' | 'text' | 'secondary';
  className?: string;
}

/**
 * OpenWorkWindowButton - Isolated component for opening a new Chrome window
 *
 * This allows users to work in a separate window while automation executes.
 * Completely isolated from other codebase to avoid side effects.
 */
export function OpenWorkWindowButton({
  variant = 'text',
  className = ''
}: OpenWorkWindowButtonProps) {
  const handleClick = () => {
    chrome.windows.create({});
  };

  if (variant === 'icon') {
    // Icon-only button for header (compact, matches settings button style)
    return (
      <button
        onClick={handleClick}
        className={`p-2 text-muted-foreground hover:text-foreground transition-colors ${className}`}
        title="Open a new window to work in"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"
          />
        </svg>
      </button>
    );
  }

  if (variant === 'secondary') {
    // Secondary button style - white with border, for execution panel
    return (
      <button
        onClick={handleClick}
        className={`py-3 px-4 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 ${className}`}
        title="Open a new window to work in"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        New Window
      </button>
    );
  }

  // Text button for execution page (matches Stop/Resume button style)
  return (
    <button
      onClick={handleClick}
      className={`px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors ${className}`}
      title="Open a new window to work in"
    >
      Open Work Window
    </button>
  );
}
