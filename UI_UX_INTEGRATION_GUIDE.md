# UI/UX Integration Guide for Separate Repository

This document provides comprehensive instructions for building the UI/UX in a separate repository that will be integrated into the main Autoflow Chrome Extension codebase.

## 🎯 Purpose

Build a clean, modern UI/UX layer that can be seamlessly integrated into the existing extension without disrupting the core logic. The UI should be component-based, maintainable, and follow consistent design patterns.

---

## 📖 Product Overview

**GhostWriter (Autoflow)** is an AI-powered Chrome Extension that transforms repetitive browser tasks into reusable, intelligent workflows. Users record their browser actions once, and the extension creates a smart form interface for repeating that task with different data—even when websites update their UI.

### Key User Flows
1. **Recording**: User clicks "Start Recording", performs actions in browser, clicks "Stop Recording"
2. **Variable Detection**: AI automatically detects which values should be variables (e.g., client names, amounts)
3. **Workflow Management**: Users see their saved workflows in a library, can load, execute, or delete them
4. **Execution**: User fills out a form with new variable values, clicks "Execute", workflow runs automatically
5. **Monitoring**: Users see connection status, extension state (IDLE, RECORDING, EXECUTING), and step-by-step progress

### UI Context
- **Chrome Extension Sidepanel**: Fixed-width panel (typically 400-600px)
- **Primary Users**: Non-technical users who want to automate repetitive tasks
- **Key Interactions**: Recording controls, workflow library, variable forms, execution monitoring
- **Visual Feedback**: Status indicators, progress bars, step-by-step displays, screenshot viewers

### Design Goals
- **Simple & Intuitive**: Non-technical users should understand immediately
- **Visual**: Show workflow steps, screenshots, status clearly
- **Responsive Feedback**: Loading states, success/error messages, progress indicators
- **Professional**: Clean, modern design that feels trustworthy

---

## 📋 Tech Stack Requirements

### Core Technologies
- **React 19.2.0+** - Component framework
- **TypeScript** - Type safety
- **Tailwind CSS 3.4.0+** - Utility-first styling
- **Zustand 5.0.9+** - State management (if needed for UI state only)

### Build Tools
- **Vite 7.2.4+** - Build tool and dev server
- **PostCSS** - CSS processing
- **Autoprefixer** - Browser compatibility

### Development Tools
- **ESLint** - Code linting
- **TypeScript ESLint** - TypeScript-specific linting

---

## 🎨 Design System

### Color Palette (HSL-based)

The extension uses a CSS variable-based color system that supports light and dark modes. All colors are defined in HSL format.

#### Light Mode Colors
```css
--background: 0 0% 100%           /* White */
--foreground: 222.2 84% 4.9%      /* Dark blue-gray */
--card: 0 0% 100%                 /* White */
--card-foreground: 222.2 84% 4.9%  /* Dark blue-gray */
--primary: 222.2 47.4% 11.2%      /* Dark blue */
--primary-foreground: 210 40% 98%  /* Light gray */
--secondary: 210 40% 96.1%        /* Light gray */
--secondary-foreground: 222.2 47.4% 11.2% /* Dark blue */
--muted: 210 40% 96.1%            /* Light gray */
--muted-foreground: 215.4 16.3% 46.9% /* Medium gray */
--destructive: 0 84.2% 60.2%      /* Red */
--destructive-foreground: 210 40% 98% /* Light gray */
--border: 214.3 31.8% 91.4%       /* Light gray border */
--input: 214.3 31.8% 91.4%        /* Light gray input */
--ring: 222.2 84% 4.9%            /* Dark blue focus ring */
--radius: 0.5rem                   /* Border radius */
```

#### Dark Mode Colors
```css
--background: 222.2 84% 4.9%      /* Dark blue-gray */
--foreground: 210 40% 98%         /* Light gray */
--card: 222.2 84% 4.9%            /* Dark blue-gray */
--card-foreground: 210 40% 98%    /* Light gray */
--primary: 210 40% 98%            /* Light gray */
--primary-foreground: 222.2 47.4% 11.2% /* Dark blue */
--secondary: 217.2 32.6% 17.5%    /* Dark gray */
--secondary-foreground: 210 40% 98% /* Light gray */
--muted: 217.2 32.6% 17.5%        /* Dark gray */
--muted-foreground: 215 20.2% 65.1% /* Medium gray */
--destructive: 0 62.8% 30.6%      /* Dark red */
--destructive-foreground: 210 40% 98% /* Light gray */
--border: 217.2 32.6% 17.5%       /* Dark gray border */
--input: 217.2 32.6% 17.5%        /* Dark gray input */
--ring: 212.7 26.8% 83.9%         /* Light gray focus ring */
```

### Semantic Color Usage

- **Primary**: Main actions, buttons, links
- **Secondary**: Secondary actions, alternative buttons
- **Destructive**: Delete actions, errors, warnings
- **Muted**: Disabled states, subtle text
- **Card**: Container backgrounds
- **Border**: Borders, dividers
- **Input**: Form input backgrounds

### Accent Colors (Used in Current UI)

- **Purple** (`purple-600`, `purple-700`): Variables, AI features, special highlights
- **Blue** (`blue-600`, `blue-700`): Primary actions, links
- **Green** (`green-600`, `green-700`): Success states, execute actions
- **Yellow** (`yellow-500`, `yellow-600`): Warnings, pending states
- **Red** (`red-600`, `red-700`): Delete actions, errors
- **Gray** (`gray-500`, `gray-600`): Neutral states, disabled

---

## 🏗️ Component Architecture

### Component Structure

All components should follow this structure:

```typescript
// ComponentName.tsx
import { useState, useEffect } from 'react';
import type { ComponentProps } from '../types/ui';

interface ComponentNameProps {
  // Props interface
  title: string;
  onAction?: (data: any) => void;
  disabled?: boolean;
  className?: string;
}

export function ComponentName({ 
  title, 
  onAction, 
  disabled = false,
  className = '' 
}: ComponentNameProps) {
  // Component logic
  
  return (
    <div className={`base-styles ${className}`}>
      {/* Component JSX */}
    </div>
  );
}
```

### Component Guidelines

1. **Props Interface**: Always define a clear TypeScript interface for props
2. **Default Props**: Use default parameters for optional props
3. **ClassName Merging**: Accept `className` prop and merge with base styles
4. **Accessibility**: Include ARIA labels, keyboard navigation, focus states
5. **Responsive**: Design for Chrome extension sidepanel (typically 400-600px wide)
6. **Dark Mode**: Support both light and dark themes using CSS variables

### Required Component Categories

#### 1. Layout Components
- `Container` - Main wrapper with max-width and padding
- `Card` - Elevated container with border and padding
- `Section` - Content section with spacing
- `Grid` - Grid layout system
- `Stack` - Vertical/horizontal stack layout

#### 2. Form Components
- `Button` - Primary button component with variants
- `Input` - Text input with label and error states
- `Textarea` - Multi-line text input
- `Select` - Dropdown select component
- `Checkbox` - Checkbox input
- `Radio` - Radio button group
- `Switch` - Toggle switch
- `Label` - Form label component

#### 3. Feedback Components
- `Alert` - Alert/notification component
- `Badge` - Small status badge
- `Spinner` - Loading spinner
- `Progress` - Progress bar
- `Toast` - Toast notification (optional)

#### 4. Display Components
- `Typography` - Text components (Heading, Body, Caption)
- `List` - List component
- `Table` - Table component (if needed)
- `Code` - Code block display
- `Divider` - Horizontal/vertical divider

#### 5. Overlay Components
- `Modal` - Modal dialog
- `Dialog` - Confirmation dialog
- `Popover` - Popover component
- `Tooltip` - Tooltip component
- `Dropdown` - Dropdown menu

#### 6. Specialized Components (Extension-Specific)
- `ConnectionStatus` - Connection status indicator
- `StateIndicator` - Extension state indicator (IDLE, RECORDING, etc.)
- `WorkflowStepCard` - Individual workflow step display
- `VariableCard` - Variable display card
- `WorkflowCard` - Saved workflow card
- `ScreenshotViewer` - Screenshot/image viewer modal

---

## 📐 Styling Conventions

### Tailwind CSS Usage

1. **Use Design Tokens**: Always use CSS variable-based classes:
   - `bg-background`, `text-foreground`
   - `bg-card`, `text-card-foreground`
   - `bg-primary`, `text-primary-foreground`
   - `border-border`
   - `text-muted-foreground`

2. **Spacing**: Use Tailwind spacing scale (0.25rem increments)
   - `p-4`, `px-3`, `py-2`, `gap-2`, `space-y-2`

3. **Border Radius**: Use semantic radius classes
   - `rounded-lg` (0.5rem)
   - `rounded-md` (calc(0.5rem - 2px))
   - `rounded-sm` (calc(0.5rem - 4px))

4. **Responsive**: Design for fixed-width sidepanel (no responsive breakpoints needed)

5. **Hover States**: Always include hover states for interactive elements
   - `hover:bg-primary/90`
   - `hover:text-foreground`

6. **Disabled States**: Use opacity for disabled states
   - `disabled:opacity-50`
   - `disabled:cursor-not-allowed`

7. **Focus States**: Include focus rings for accessibility
   - `focus:outline-none`
   - `focus:ring-2`
   - `focus:ring-ring`

### Component-Specific Patterns

#### Buttons
```tsx
// Primary button
<button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
  Action
</button>

// Secondary button
<button className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90">
  Action
</button>

// Destructive button
<button className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90">
  Delete
</button>
```

#### Cards
```tsx
<div className="p-4 bg-card rounded-lg border border-border">
  <h2 className="text-lg font-semibold mb-2 text-card-foreground">Title</h2>
  {/* Content */}
</div>
```

#### Input Fields
```tsx
<input
  type="text"
  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  placeholder="Enter text..."
/>
```

#### Status Indicators
```tsx
// Connection status
<div className="flex items-center gap-2">
  <div className={`w-3 h-3 rounded-full ${
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-yellow-500' :
    'bg-red-500'
  }`} />
  <span className="font-medium">{status.toUpperCase()}</span>
</div>
```

---

## 🔌 Integration Points

### State Management

The main extension uses Zustand for state management. UI components should:

1. **Accept Props**: Components should receive data via props, not directly access store
2. **Callback Pattern**: Use callback props for actions (`onClick`, `onChange`, etc.)
3. **Controlled Components**: Make form components controlled (value + onChange)
4. **No Direct Store Access**: UI components should NOT import or use the Zustand store directly

### Component Props Pattern

```typescript
interface WorkflowStepCardProps {
  step: WorkflowStep;
  index: number;
  isPending?: boolean;
  isEnhanced?: boolean;
  onEdit?: (index: number) => void;
  onViewScreenshot?: (step: WorkflowStep) => void;
  className?: string;
}
```

### Event Handling

```typescript
// Parent component handles business logic
const handleAction = async (data: any) => {
  // Business logic here
  await someAsyncOperation(data);
};

// UI component just calls the callback
<Component onAction={handleAction} />
```

---

## 📁 File Structure

### Recommended Structure for UI Repository

```
ui-repo/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Container.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Section.tsx
│   │   │   └── index.ts
│   │   ├── form/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   └── index.ts
│   │   ├── feedback/
│   │   │   ├── Alert.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Spinner.tsx
│   │   │   └── index.ts
│   │   ├── display/
│   │   │   ├── Typography.tsx
│   │   │   ├── List.tsx
│   │   │   └── index.ts
│   │   ├── overlay/
│   │   │   ├── Modal.tsx
│   │   │   ├── Dialog.tsx
│   │   │   └── index.ts
│   │   └── extension/
│   │       ├── ConnectionStatus.tsx
│   │       ├── StateIndicator.tsx
│   │       ├── WorkflowStepCard.tsx
│   │       ├── VariableCard.tsx
│   │       └── index.ts
│   ├── styles/
│   │   ├── globals.css
│   │   └── variables.css
│   ├── types/
│   │   ├── ui.ts
│   │   └── extension.ts
│   └── utils/
│       ├── cn.ts (className utility)
│       └── constants.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── package.json
```

### Export Pattern

Use barrel exports for easy importing:

```typescript
// components/layout/index.ts
export { Container } from './Container';
export { Card } from './Card';
export { Section } from './Section';
```

---

## 🎯 Key UI Patterns from Current Implementation

### 1. Connection Status Display
- Shows connection status with colored dot indicator
- Displays last ping time
- Shows error messages when connection fails

### 2. Extension State Indicator
- Visual state indicator (IDLE, RECORDING, CONNECTING, EXECUTING)
- Color-coded dots with pulse animation
- Shows current workflow name
- Displays pending AI validations count

### 3. Workflow Steps List
- Numbered list of recorded steps
- Color-coded borders for different states:
  - Purple: Variable detected
  - Blue: AI enhanced
  - Yellow: Pending AI validation
  - Transparent: Normal
- Shows step type, description, selector
- Editable AI instructions
- Screenshot viewer button
- Execution strategy indicators

### 4. Variable Display
- Expandable variable cards
- Shows field name, variable name, default value
- Dropdown options display
- Confidence score with progress bar
- AI reasoning display

### 5. Saved Workflows List
- Workflow cards with metadata
- Variable count badges
- Optimization badges
- Action buttons (Load, Execute, Export, Delete)
- Confirmation dialog for delete

### 6. Action Buttons
- Primary actions: Start Recording, Save Workflow
- Secondary actions: Stop Recording, Clear Steps
- Special actions: Add Tab, Resume Recording
- Disabled states during operations

### 7. Modals/Dialogs
- Save workflow dialog
- Variable input form modal
- Refresh warning dialog
- Delete confirmation dialog
- Screenshot viewer modal

---

## 🔄 Integration Checklist

When integrating the UI components back into the main repo:

- [ ] Copy component files to `src/sidepanel/components/`
- [ ] Copy type definitions to `src/types/ui.ts`
- [ ] Ensure Tailwind config matches (CSS variables)
- [ ] Verify CSS imports in `src/sidepanel/index.css`
- [ ] Update `App.tsx` to use new components
- [ ] Test all interactive states (hover, focus, disabled)
- [ ] Verify dark mode support
- [ ] Check accessibility (keyboard navigation, ARIA labels)
- [ ] Test with actual extension state/data
- [ ] Verify no direct store imports in UI components
- [ ] Ensure all callbacks are properly wired

---

## 🎨 Design Principles

### 1. Clarity
- Clear visual hierarchy
- Obvious interactive elements
- Readable typography
- Sufficient contrast

### 2. Consistency
- Consistent spacing and sizing
- Uniform button styles
- Standardized color usage
- Predictable component behavior

### 3. Feedback
- Loading states for async operations
- Success/error messages
- Hover and focus states
- Disabled state indicators

### 4. Efficiency
- Compact layout for sidepanel
- Scrollable sections for long lists
- Collapsible/expandable sections
- Quick actions accessible

### 5. Accessibility
- Keyboard navigation
- Focus indicators
- ARIA labels
- Screen reader support
- Color contrast compliance

---

## 📝 Component API Examples

### Button Component
```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}
```

### Card Component
```typescript
interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  border?: boolean;
  padding?: 'sm' | 'md' | 'lg';
}
```

### Modal Component
```typescript
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
}
```

---

## 🚀 Development Workflow

1. **Create Component**: Build component in isolation
2. **Style with Tailwind**: Use design system tokens
3. **Add TypeScript Types**: Define clear prop interfaces
4. **Test States**: Test all states (default, hover, focus, disabled, loading)
5. **Document Props**: Add JSDoc comments for complex props
6. **Export**: Add to barrel export file
7. **Integration Ready**: Component should be ready to drop into main repo

---

## ⚠️ Important Notes

1. **No Business Logic**: UI components should be pure presentation components
2. **No Store Imports**: Don't import Zustand store in UI components
3. **Props Only**: All data and actions come via props
4. **CSS Variables**: Always use CSS variable-based Tailwind classes
5. **Dark Mode**: Test both light and dark themes
6. **Extension Context**: Remember this is a Chrome extension sidepanel (fixed width)
7. **Performance**: Keep components lightweight and optimized
8. **Accessibility**: Always include proper ARIA labels and keyboard support

---

## 📚 Additional Resources

- Current extension codebase structure
- Tailwind CSS documentation: https://tailwindcss.com/docs
- React TypeScript patterns: https://react-typescript-cheatsheet.netlify.app/
- Chrome Extension UI guidelines: https://developer.chrome.com/docs/extensions/

---

## 🎯 Success Criteria

The UI/UX repository is ready for integration when:

1. ✅ All components follow the design system
2. ✅ Components are fully typed with TypeScript
3. ✅ Components accept props and callbacks (no direct store access)
4. ✅ Dark mode is fully supported
5. ✅ All interactive states are styled and tested
6. ✅ Components are accessible (keyboard navigation, ARIA labels)
7. ✅ File structure is organized and exportable
8. ✅ Documentation is clear and complete
9. ✅ Components can be imported and used without modification
10. ✅ No breaking changes to existing functionality

---

**Last Updated**: [Current Date]
**Version**: 1.0.0

