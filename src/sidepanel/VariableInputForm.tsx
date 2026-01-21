/**
 * Variable Input Form Component
 *
 * A clean modal for entering workflow variable values before execution.
 * Supports multi-item detection: when user types "Alice, Bob, Carol",
 * the form shows that 3 iterations will be executed.
 */

import { useMemo, useState, useEffect } from 'react';
import type { WorkflowVariables, VariableDefinition } from '../lib/variable-detector';
import type { WorkflowMemory } from '../lib/workflow-memory/types';

/**
 * Detect multiple items in a text value (e.g., "Alice, Bob, and Carol" → 3 items)
 */
function detectMultipleItems(value: string, separators: string[] = ['and', ',', ';']): {
  items: string[];
  isMultiple: boolean;
} {
  if (!value.trim()) {
    return { items: [], isMultiple: false };
  }

  // Build regex pattern for separators
  const sepPattern = separators.map(s => {
    if (s === ',') return ',\\s*';
    if (s === ';') return ';\\s*';
    return `\\s+${s}\\s+`;
  }).join('|');

  // Try to match "A, B, and C" pattern first
  const andPattern = /(.+?)\s*,\s*(.+?)\s*(?:,\s*)?(?:and|&)\s+(.+)/i;
  const match = value.match(andPattern);
  if (match) {
    const items = match.slice(1)
      .flatMap(v => v.split(/\s*,\s*/))
      .map(v => v.trim())
      .filter(v => v.length > 0);
    if (items.length > 1) {
      return { items, isMultiple: true };
    }
  }

  // Try "A and B" pattern
  const simpleAndPattern = /(.+?)\s+(?:and|&)\s+(.+)/i;
  const simpleMatch = value.match(simpleAndPattern);
  if (simpleMatch) {
    const items = simpleMatch.slice(1).map(v => v.trim()).filter(v => v.length > 0);
    if (items.length > 1) {
      return { items, isMultiple: true };
    }
  }

  // Try comma/semicolon separated
  const regex = new RegExp(sepPattern, 'gi');
  const parts = value.split(regex).map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length > 1) {
    return { items: parts, isMultiple: true };
  }

  return { items: [value], isMultiple: false };
}

interface VariableInputFormProps {
  variables: WorkflowVariables;
  workflowName: string;
  workflowMemory?: WorkflowMemory;
  onConfirm: (values: Record<string, string> | Record<string, string>[]) => void;
  onCancel: () => void;
}

/**
 * Get appropriate input type for HTML input element
 */
function getInputType(inputType?: string): string {
  switch (inputType?.toLowerCase()) {
    case 'email': return 'email';
    case 'password': return 'password';
    case 'number': return 'number';
    case 'tel':
    case 'phone': return 'tel';
    case 'url': return 'url';
    case 'date': return 'date';
    case 'datetime':
    case 'datetime-local': return 'datetime-local';
    case 'time': return 'time';
    default: return 'text';
  }
}

/**
 * Validate input value based on type
 */
function validateInput(value: string, inputType?: string, isDropdown?: boolean): string | null {
  if (!value.trim()) {
    return 'Required';
  }

  if (isDropdown) return null;

  switch (inputType?.toLowerCase()) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return 'Invalid email';
      }
      break;
    case 'url':
      try {
        new URL(value);
      } catch {
        return 'Invalid URL';
      }
      break;
    case 'tel':
    case 'phone':
      if (!/^[\d\s\-+()]+$/.test(value)) {
        return 'Invalid phone';
      }
      break;
  }

  return null;
}

export function VariableInputForm({
  variables,
  workflowName,
  workflowMemory,
  onConfirm,
  onCancel,
}: VariableInputFormProps) {
  // Determine which fields support array values
  const arrayCapableFields = useMemo(() => {
    const arrayCapable = new Set<string>();
    const inputs = [
      ...(workflowMemory?.inputs?.required || []),
      ...(workflowMemory?.inputs?.optional || []),
    ];
    for (const input of inputs) {
      // Check for isArray property (exists on InputFieldWithArraySupport)
      if ('isArray' in input && input.isArray) {
        if (input.name) arrayCapable.add(input.name);
        if ((input as any).variableName) arrayCapable.add((input as any).variableName);
      }
    }
    return arrayCapable;
  }, [workflowMemory]);

  // Helper to check if a variable supports arrays
  const isVariableArrayCapable = (variable: VariableDefinition): boolean => {
    return arrayCapableFields.has(variable.fieldName) ||
           arrayCapableFields.has(variable.variableName);
  };

  const repeatableFieldNames = useMemo(() => {
    const repeatable = new Set<string>();
    const inputs = [
      ...(workflowMemory?.inputs?.required || []),
      ...(workflowMemory?.inputs?.optional || []),
    ];
    for (const input of inputs) {
      // Check for isArray property (exists on InputFieldWithArraySupport)
      if ('isArray' in input && input.isArray) {
        if (input.name) repeatable.add(input.name);
        if ((input as any).variableName) repeatable.add((input as any).variableName);
      }
    }
    return repeatable;
  }, [workflowMemory]);

  const fixedVariables = useMemo(
    () => variables.variables.filter(v =>
      !repeatableFieldNames.has(v.fieldName) && !repeatableFieldNames.has(v.variableName)
    ),
    [variables.variables, repeatableFieldNames]
  );

  const repeatableVariables = useMemo(
    () => variables.variables.filter(v =>
      repeatableFieldNames.has(v.fieldName) || repeatableFieldNames.has(v.variableName)
    ),
    [variables.variables, repeatableFieldNames]
  );

  const hasRepeatableFields = repeatableVariables.length > 0;

  // Initialize values with defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const variable of variables.variables) {
      if (variable.isDropdown && variable.options && variable.options.length > 0) {
        const defaultInOptions = variable.options.includes(variable.defaultValue || '');
        initial[variable.stepId] = defaultInOptions ? (variable.defaultValue || '') : variable.options[0];
      } else {
        initial[variable.stepId] = variable.defaultValue || '';
      }
    }
    return initial;
  });

  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});
  const [repeatableEntries, setRepeatableEntries] = useState<Record<string, string>[]>([]);
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initialValues: Record<string, string> = {};
    for (const variable of variables.variables) {
      if (variable.isDropdown && variable.options && variable.options.length > 0) {
        const defaultInOptions = variable.options.includes(variable.defaultValue || '');
        initialValues[variable.stepId] = defaultInOptions ? (variable.defaultValue || '') : variable.options[0];
      } else {
        initialValues[variable.stepId] = variable.defaultValue || '';
      }
    }
    setValues(initialValues);

    const initialFixed: Record<string, string> = {};
    for (const variable of fixedVariables) {
      initialFixed[variable.stepId] = initialValues[variable.stepId] || '';
    }
    setFixedValues(initialFixed);

    const initialRepeatable: Record<string, string> = {};
    for (const variable of repeatableVariables) {
      initialRepeatable[variable.stepId] = initialValues[variable.stepId] || '';
    }
    setRepeatableEntries([initialRepeatable]);
    setActiveEntryIndex(0);
    setErrors({});
    setTouched({});
  }, [variables.variables, fixedVariables, repeatableVariables]);

  const handleChange = (stepId: string, value: string) => {
    setValues(prev => ({ ...prev, [stepId]: value }));
    if (errors[stepId]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[stepId];
        return next;
      });
    }
  };

  const handleBlur = (variable: VariableDefinition, value: string) => {
    setTouched(prev => ({ ...prev, [variable.stepId]: true }));
    const error = validateInput(value, variable.inputType, variable.isDropdown);
    if (error) {
      setErrors(prev => ({ ...prev, [variable.stepId]: error }));
    }
  };

  const addEntry = () => {
    const newEntry: Record<string, string> = {};
    for (const variable of repeatableVariables) {
      newEntry[variable.stepId] = variable.defaultValue || '';
    }
    setRepeatableEntries(prev => [...prev, newEntry]);
    setActiveEntryIndex(repeatableEntries.length);
  };

  const removeEntry = (index: number) => {
    if (repeatableEntries.length <= 1) return;
    setRepeatableEntries(prev => prev.filter((_, i) => i !== index));
    if (activeEntryIndex >= index && activeEntryIndex > 0) {
      setActiveEntryIndex(activeEntryIndex - 1);
    }
  };

  const transformEntry = (entry: Record<string, string>, vars: VariableDefinition[]) => {
    const result: Record<string, string> = {};
    for (const variable of vars) {
      const value = entry[variable.stepId];
      result[variable.stepId] = value;
      result[variable.variableName] = value;
    }
    return result;
  };

  const renderVariableField = (
    variable: VariableDefinition,
    value: string,
    onValueChange: (value: string) => void,
    isArrayCapable: boolean = false
  ) => {
    const inputType = getInputType(variable.inputType);
    const hasError = touched[variable.stepId] && errors[variable.stepId];

    // Check if input contains multiple items
    const multipleCheck = detectMultipleItems(value);
    const showMultipleIndicator = isArrayCapable && multipleCheck.isMultiple;

    return (
      <div key={variable.stepId}>
        <label
          htmlFor={variable.stepId}
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          {variable.fieldName}
          {isArrayCapable && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              (supports multiple items)
            </span>
          )}
        </label>

        {variable.isDropdown && variable.options && variable.options.length > 0 ? (
          <select
            id={variable.stepId}
            value={value ?? variable.options[0]}
            onChange={(e) => {
              onValueChange(e.target.value);
              if (errors[variable.stepId]) {
                setErrors(prev => {
                  const next = { ...prev };
                  delete next[variable.stepId];
                  return next;
                });
              }
            }}
            onBlur={() => handleBlur(variable, value)}
            className={`w-full px-4 py-3 border rounded-xl bg-muted/30 text-foreground transition-all duration-200 ${
              hasError
                ? 'border-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-400'
                : 'border-border/60 focus:ring-2 focus:ring-primary/20 focus:border-primary/40'
            } focus:outline-none`}
          >
            {variable.options.map((option, idx) => (
              <option key={idx} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={variable.stepId}
            type={inputType}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onBlur={() => handleBlur(variable, value)}
            placeholder={isArrayCapable
              ? `Enter ${variable.fieldName.toLowerCase()} (e.g., "Alice, Bob, Carol")`
              : `Enter ${variable.fieldName.toLowerCase()}`
            }
            className={`w-full px-4 py-3 border rounded-xl bg-muted/30 text-foreground transition-all duration-200 ${
              hasError
                ? 'border-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-400'
                : showMultipleIndicator
                  ? 'border-primary/60 focus:ring-2 focus:ring-primary/30 focus:border-primary'
                  : 'border-border/60 focus:ring-2 focus:ring-primary/20 focus:border-primary/40'
            } focus:outline-none placeholder:text-muted-foreground/50`}
          />
        )}

        {hasError && (
          <p className="text-xs text-red-500 mt-1.5">{errors[variable.stepId]}</p>
        )}

        {showMultipleIndicator && (
          <div className="mt-2 p-2 bg-primary/10 rounded-lg border border-primary/20">
            <p className="text-xs text-primary font-medium">
              Will run {multipleCheck.items.length} times:
            </p>
            <ul className="mt-1 text-xs text-muted-foreground">
              {multipleCheck.items.slice(0, 5).map((item, idx) => (
                <li key={idx} className="truncate">
                  {idx + 1}. {item}
                </li>
              ))}
              {multipleCheck.items.length > 5 && (
                <li className="text-muted-foreground/70">
                  ...and {multipleCheck.items.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasRepeatableFields) {
      // Validate all fields (single-entry mode)
      const newErrors: Record<string, string> = {};
      for (const variable of variables.variables) {
        const error = validateInput(values[variable.stepId], variable.inputType, variable.isDropdown);
        if (error) {
          newErrors[variable.stepId] = error;
        }
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        const allTouched: Record<string, boolean> = {};
        for (const variable of variables.variables) {
          allTouched[variable.stepId] = true;
        }
        setTouched(allTouched);
        return;
      }

      const valuesForParent = transformEntry(values, variables.variables);
      onConfirm(valuesForParent);
      return;
    }

    // Validate fixed values
    for (const variable of fixedVariables) {
      const error = validateInput(fixedValues[variable.stepId], variable.inputType, variable.isDropdown);
      if (error) {
        setErrors({ [variable.stepId]: error });
        return;
      }
    }

    // Validate all repeatable entries
    for (let i = 0; i < repeatableEntries.length; i++) {
      for (const variable of repeatableVariables) {
        const error = validateInput(repeatableEntries[i][variable.stepId], variable.inputType, variable.isDropdown);
        if (error) {
          setActiveEntryIndex(i);
          setErrors({ [variable.stepId]: error });
          return;
        }
      }
    }

    const fixedEntry = transformEntry(fixedValues, fixedVariables);
    const combinedEntries = repeatableEntries.map(entry => ({
      ...fixedEntry,
      ...transformEntry(entry, repeatableVariables),
    }));

    onConfirm(combinedEntries.length === 1 ? combinedEntries[0] : combinedEntries);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-card p-6 rounded-2xl border border-border/60 shadow-soft-xl max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto animate-scale-in">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            Fill in variables
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {workflowName}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!hasRepeatableFields && variables.variables.map((variable) =>
            renderVariableField(
              variable,
              values[variable.stepId],
              (nextValue) => handleChange(variable.stepId, nextValue),
              isVariableArrayCapable(variable)
            )
          )}

          {hasRepeatableFields && (
            <>
              {fixedVariables.length > 0 && (
                <div className="space-y-4 pb-4 border-b border-border/40">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    One-time settings
                  </p>
                  {fixedVariables.map((variable) =>
                    renderVariableField(
                      variable,
                      fixedValues[variable.stepId] || '',
                      (nextValue) => {
                        setFixedValues(prev => ({ ...prev, [variable.stepId]: nextValue }));
                        if (errors[variable.stepId]) {
                          setErrors(prev => {
                            const next = { ...prev };
                            delete next[variable.stepId];
                            return next;
                          });
                        }
                      },
                      false // Fixed variables don't support array input
                    )
                  )}
                </div>
              )}

              {repeatableVariables.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Items to add
                    </p>
                    <button
                      type="button"
                      onClick={addEntry}
                      className="text-sm text-primary hover:underline"
                    >
                      + Add another
                    </button>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {repeatableEntries.map((_, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg cursor-pointer ${
                          index === activeEntryIndex
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => setActiveEntryIndex(index)}
                      >
                        <span>Item {index + 1}</span>
                        {repeatableEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeEntry(index);
                            }}
                          >
                            <span className="sr-only">Remove</span>
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {repeatableVariables.map((variable) =>
                    renderVariableField(
                      variable,
                      repeatableEntries[activeEntryIndex]?.[variable.stepId] || '',
                      (nextValue) => {
                        setRepeatableEntries(prev => prev.map((entry, i) =>
                          i === activeEntryIndex ? { ...entry, [variable.stepId]: nextValue } : entry
                        ));
                        if (errors[variable.stepId]) {
                          setErrors(prev => {
                            const next = { ...prev };
                            delete next[variable.stepId];
                            return next;
                          });
                        }
                      },
                      false // Repeatable fields use manual entry adding, not array detection
                    )
                  )}

                  {repeatableEntries.length > 1 && (
                    <p className="text-sm text-muted-foreground">
                      Will run {repeatableEntries.length} times with different values
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-5 py-3 bg-muted text-muted-foreground rounded-xl font-medium hover:bg-muted/80 active:scale-[0.98] transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-5 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:opacity-90 active:scale-[0.98] shadow-soft transition-all duration-200"
            >
              Run
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
