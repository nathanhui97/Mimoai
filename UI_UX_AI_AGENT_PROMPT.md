# UI/UX Development Prompt for AI Agent

## 🎯 Your Task
Build a modern, accessible UI component library for a Chrome extension sidepanel that will be integrated into the Autoflow extension. Create reusable, type-safe React components following the design system below.

## 📖 What You're Building UI For

**GhostWriter (Autoflow)** is an AI-powered Chrome Extension that automates repetitive browser tasks. Users:
1. **Record** their browser actions (clicks, form fills, navigation)
2. **Save** workflows that AI analyzes to detect variables
3. **Execute** workflows by filling out a simple form with new data
4. **Monitor** execution progress and status

The UI needs to support:
- Recording controls (Start/Stop/Pause)
- Workflow library (list of saved workflows)
- Variable input forms (dynamic forms based on detected variables)
- Status indicators (connection, extension state, progress)
- Step-by-step displays (workflow steps with screenshots)

**Context**: Chrome extension sidepanel (fixed width ~400-600px), non-technical users, needs to be simple and intuitive.

---

## 🛠️ Tech Stack
- **React 19.2.0+** with TypeScript
- **Tailwind CSS 3.4.0+** (utility-first)
- **CSS Variables** for theming (light/dark mode)
- **Vite** for building

---

## 🎨 Design System Rules

### Colors (ALWAYS use CSS variable classes)
```css
/* Backgrounds */
bg-background, bg-card, bg-primary, bg-secondary, bg-muted

/* Text */
text-foreground, text-card-foreground, text-primary-foreground, 
text-muted-foreground, text-destructive

/* Borders */
border-border

/* NEVER use hardcoded colors like bg-blue-500 directly */
/* Use: bg-primary, text-primary-foreground instead */
```

### Spacing
- Use Tailwind spacing: `p-4`, `px-3`, `py-2`, `gap-2`, `space-y-2`
- Standard padding: `p-4` for cards, `px-4 py-2` for buttons

### Border Radius
- `rounded-lg` (0.5rem) - cards, containers
- `rounded-md` - buttons, inputs
- `rounded-sm` - small elements

### Typography
- Headings: `text-lg font-semibold`, `text-xl font-semibold`
- Body: `text-sm`, `text-base`
- Muted: `text-muted-foreground`

---

## 📦 Required Components

### 1. Layout Components
- `Container` - Max-width wrapper with padding
- `Card` - Elevated container: `p-4 bg-card rounded-lg border border-border`
- `Section` - Content section with spacing

### 2. Form Components
- `Button` - Variants: primary, secondary, destructive, outline
  - Base: `px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed`
  - Primary: `bg-primary text-primary-foreground hover:bg-primary/90`
  - Secondary: `bg-secondary text-secondary-foreground hover:bg-secondary/90`
- `Input` - `w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:ring-2 focus:ring-ring`
- `Select`, `Textarea`, `Checkbox`, `Switch`, `Label`

### 3. Feedback Components
- `Alert` - Status messages with variants (success, error, warning, info)
- `Badge` - Small status badge: `px-2 py-0.5 text-xs rounded-full`
- `Spinner` - Loading spinner with animation
- `Progress` - Progress bar

### 4. Overlay Components
- `Modal` - Full-screen overlay with backdrop: `fixed inset-0 bg-black/50 flex items-center justify-center z-50`
- `Dialog` - Confirmation dialog
- `Tooltip` - Hover tooltip

### 5. Extension-Specific Components
- `ConnectionStatus` - Status indicator with colored dot
- `StateIndicator` - Extension state (IDLE, RECORDING, etc.)
- `WorkflowStepCard` - Step display with borders, badges, actions
- `VariableCard` - Expandable variable display
- `WorkflowCard` - Saved workflow with metadata and actions

---

## 🔑 Component Rules

### 1. TypeScript Interface (REQUIRED)
```typescript
interface ComponentNameProps {
  title: string;
  onAction?: (data: any) => void;
  disabled?: boolean;
  className?: string; // ALWAYS accept className for merging
}
```

### 2. Props Pattern
- **NO direct store access** - All data via props
- **Callback pattern** - Actions via `onClick`, `onChange`, etc.
- **Controlled components** - Form inputs use `value` + `onChange`
- **Default props** - Use default parameters: `disabled = false`

### 3. Styling Pattern
```tsx
<div className={`base-styles ${className}`}>
  {/* Always merge className */}
</div>
```

### 4. Accessibility (REQUIRED)
- Keyboard navigation support
- Focus states: `focus:outline-none focus:ring-2 focus:ring-ring`
- ARIA labels where needed
- Semantic HTML

---

## 📐 Common Patterns

### Button
```tsx
<button
  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
  disabled={disabled}
  onClick={onClick}
>
  {children}
</button>
```

### Card
```tsx
<div className="p-4 bg-card rounded-lg border border-border">
  <h2 className="text-lg font-semibold mb-2 text-card-foreground">{title}</h2>
  {children}
</div>
```

### Status Indicator
```tsx
<div className="flex items-center gap-2">
  <div className={`w-3 h-3 rounded-full ${
    status === 'connected' ? 'bg-green-500' :
    status === 'connecting' ? 'bg-yellow-500' :
    'bg-red-500'
  }`} />
  <span className="font-medium">{status.toUpperCase()}</span>
</div>
```

### Modal
```tsx
{isOpen && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-card p-6 rounded-lg border border-border max-w-md w-full mx-4">
      {children}
    </div>
  </div>
)}
```

---

## 🚫 What NOT to Do

1. ❌ **NO hardcoded colors** - Use CSS variable classes only
2. ❌ **NO direct Zustand store imports** - Use props only
3. ❌ **NO business logic** - Pure presentation components
4. ❌ **NO inline styles** - Use Tailwind classes
5. ❌ **NO missing TypeScript types** - All props must be typed
6. ❌ **NO missing disabled states** - All interactive elements need disabled styling
7. ❌ **NO missing hover states** - All interactive elements need hover styling
8. ❌ **NO missing focus states** - Accessibility requirement

---

## ✅ What TO Do

1. ✅ **Use CSS variable classes** - `bg-primary`, `text-foreground`, etc.
2. ✅ **Accept className prop** - Merge with base styles
3. ✅ **Type all props** - Full TypeScript interfaces
4. ✅ **Support dark mode** - CSS variables handle this automatically
5. ✅ **Include all states** - default, hover, focus, disabled, loading
6. ✅ **Use semantic HTML** - Proper HTML elements
7. ✅ **Add ARIA labels** - Where appropriate
8. ✅ **Export from index.ts** - Barrel exports for easy imports
9. ✅ **Document complex props** - JSDoc comments
10. ✅ **Test both themes** - Light and dark mode

---

## 📁 File Structure
```
src/
├── components/
│   ├── layout/
│   │   ├── Container.tsx
│   │   ├── Card.tsx
│   │   └── index.ts
│   ├── form/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   └── index.ts
│   ├── feedback/
│   │   ├── Alert.tsx
│   │   ├── Badge.tsx
│   │   └── index.ts
│   ├── overlay/
│   │   ├── Modal.tsx
│   │   └── index.ts
│   └── extension/
│       ├── ConnectionStatus.tsx
│       ├── WorkflowStepCard.tsx
│       └── index.ts
├── styles/
│   └── globals.css (with CSS variables)
└── types/
    └── ui.ts
```

---

## 🎯 Component Checklist

For each component, ensure:
- [ ] TypeScript interface defined
- [ ] className prop accepted and merged
- [ ] All states styled (default, hover, focus, disabled)
- [ ] Dark mode works (via CSS variables)
- [ ] Accessibility (keyboard nav, ARIA, focus states)
- [ ] Exported from index.ts
- [ ] No hardcoded colors
- [ ] No store imports
- [ ] Props documented

---

## 🔄 Integration Notes

When ready for integration:
1. Components will be copied to `src/sidepanel/components/`
2. Parent components will pass data via props
3. Callbacks will be wired to business logic
4. No modifications needed to UI components

---

## 💡 Key Principles

1. **Separation of Concerns**: UI components = presentation only
2. **Reusability**: Components work in any context with props
3. **Consistency**: Follow design system strictly
4. **Accessibility**: Keyboard navigation and screen readers
5. **Performance**: Lightweight, optimized components

---

## 🎨 Visual Reference

Current extension uses:
- **Purple accents** for variables and AI features
- **Blue** for primary actions
- **Green** for success/execute
- **Yellow** for warnings/pending
- **Red** for destructive actions
- **Gray** for neutral/disabled

Use these as accent colors when needed, but primary colors should come from CSS variables.

---

**Remember**: Build components that are **drop-in ready** - they should work immediately when integrated into the main codebase with no modifications needed.

