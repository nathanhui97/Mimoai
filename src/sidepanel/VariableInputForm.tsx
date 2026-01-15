/**
 * Variable Input Form Component
 *
 * A clean modal for entering workflow variable values before execution.
 */

import { useState } from 'react';
import type { WorkflowVariables, VariableDefinition } from '../lib/variable-detector';

interface VariableInputFormProps {
  variables: WorkflowVariables;
  workflowName: string;
  onConfirm: (values: Record<string, string>) => void;
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
  onConfirm,
  onCancel,
}: VariableInputFormProps) {
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

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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

  const handleBlur = (variable: VariableDefinition) => {
    setTouched(prev => ({ ...prev, [variable.stepId]: true }));
    const error = validateInput(values[variable.stepId], variable.inputType, variable.isDropdown);
    if (error) {
      setErrors(prev => ({ ...prev, [variable.stepId]: error }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
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

    // Transform values to include both stepId and variableName keys
    const valuesForParent: Record<string, string> = {};
    for (const variable of variables.variables) {
      const value = values[variable.stepId];
      valuesForParent[variable.stepId] = value;
      valuesForParent[variable.variableName] = value;
    }

    onConfirm(valuesForParent);
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
          {variables.variables.map((variable) => {
            const inputType = getInputType(variable.inputType);
            const hasError = touched[variable.stepId] && errors[variable.stepId];

            return (
              <div key={variable.stepId}>
                <label
                  htmlFor={variable.stepId}
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  {variable.fieldName}
                </label>

                {variable.isDropdown && variable.options && variable.options.length > 0 ? (
                  <select
                    id={variable.stepId}
                    value={values[variable.stepId] ?? variable.options[0]}
                    onChange={(e) => {
                      setValues(prev => ({ ...prev, [variable.stepId]: e.target.value }));
                      if (errors[variable.stepId]) {
                        setErrors(prev => {
                          const next = { ...prev };
                          delete next[variable.stepId];
                          return next;
                        });
                      }
                    }}
                    onBlur={() => handleBlur(variable)}
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
                    value={values[variable.stepId]}
                    onChange={(e) => handleChange(variable.stepId, e.target.value)}
                    onBlur={() => handleBlur(variable)}
                    placeholder={`Enter ${variable.fieldName.toLowerCase()}`}
                    className={`w-full px-4 py-3 border rounded-xl bg-muted/30 text-foreground transition-all duration-200 ${
                      hasError
                        ? 'border-red-400 focus:ring-2 focus:ring-red-200 focus:border-red-400'
                        : 'border-border/60 focus:ring-2 focus:ring-primary/20 focus:border-primary/40'
                    } focus:outline-none placeholder:text-muted-foreground/50`}
                  />
                )}

                {hasError && (
                  <p className="text-xs text-red-500 mt-1.5">{errors[variable.stepId]}</p>
                )}
              </div>
            );
          })}

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
