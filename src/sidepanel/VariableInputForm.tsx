/**
 * Variable Input Form Component
 * 
 * A modal form that allows users to enter values for detected workflow variables
 * before executing a workflow. Supports validation and "Use Defaults" functionality.
 */

import { useState } from 'react';
import type { WorkflowVariables, VariableDefinition } from '../lib/variable-detector';

interface VariableInputFormProps {
  variables: WorkflowVariables;
  workflowName: string;
  workflowDescription?: string; // AI-generated summary
  onConfirm: (values: Record<string, string>, editedDescription?: string) => void;
  onCancel: () => void;
}

/**
 * Get appropriate input type for HTML input element
 */
function getInputType(inputType?: string): string {
  switch (inputType?.toLowerCase()) {
    case 'email':
      return 'email';
    case 'password':
      return 'password';
    case 'number':
      return 'number';
    case 'tel':
    case 'phone':
      return 'tel';
    case 'url':
      return 'url';
    case 'date':
      return 'date';
    case 'datetime':
    case 'datetime-local':
      return 'datetime-local';
    case 'time':
      return 'time';
    default:
      return 'text';
  }
}

/**
 * Validate input value based on type
 */
function validateInput(value: string, inputType?: string, isDropdown?: boolean): string | null {
  if (!value.trim()) {
    return 'This field is required';
  }

  // Dropdowns don't need validation (they're selecting from predefined options)
  if (isDropdown) {
    return null;
  }

  switch (inputType?.toLowerCase()) {
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return 'Please enter a valid email address';
      }
      break;
    case 'url':
      try {
        new URL(value);
      } catch {
        return 'Please enter a valid URL';
      }
      break;
    case 'tel':
    case 'phone':
      if (!/^[\d\s\-+()]+$/.test(value)) {
        return 'Please enter a valid phone number';
      }
      break;
  }

  return null;
}

export function VariableInputForm({
  variables,
  workflowName,
  workflowDescription,
  onConfirm,
  onCancel,
}: VariableInputFormProps) {
  // Initialize values with defaults
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const variable of variables.variables) {
      initial[variable.variableName] = variable.defaultValue || '';
    }
    return initial;
  });

  // Track validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Track if form has been touched
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  // Track workflow description (user can edit)
  const [description, setDescription] = useState(workflowDescription || '');
  const [showDescriptionEdit, setShowDescriptionEdit] = useState(false);

  /**
   * Handle input change
   */
  const handleChange = (variableName: string, value: string) => {
    setValues(prev => ({ ...prev, [variableName]: value }));
    
    // Clear error when user types
    if (errors[variableName]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[variableName];
        return next;
      });
    }
  };

  /**
   * Handle input blur - validate on blur
   */
  const handleBlur = (variable: VariableDefinition) => {
    setTouched(prev => ({ ...prev, [variable.variableName]: true }));
    
    const error = validateInput(values[variable.variableName], variable.inputType, variable.isDropdown);
    if (error) {
      setErrors(prev => ({ ...prev, [variable.variableName]: error }));
    }
  };

  /**
   * Fill all fields with default values
   */
  const handleUseDefaults = () => {
    const defaults: Record<string, string> = {};
    for (const variable of variables.variables) {
      defaults[variable.variableName] = variable.defaultValue || '';
    }
    setValues(defaults);
    setErrors({});
    setTouched({});
  };

  /**
   * Validate all fields and submit
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    for (const variable of variables.variables) {
      const error = validateInput(values[variable.variableName], variable.inputType, variable.isDropdown);
      if (error) {
        newErrors[variable.variableName] = error;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Mark all as touched to show errors
      const allTouched: Record<string, boolean> = {};
      for (const variable of variables.variables) {
        allTouched[variable.variableName] = true;
      }
      setTouched(allTouched);
      return;
    }

    // Pass edited description if different from original
    const editedDesc = description !== workflowDescription ? description : undefined;
    onConfirm(values, editedDesc);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card p-6 rounded-lg border border-border max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-card-foreground">
            Run Workflow
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Workflow: <span className="font-medium">{workflowName}</span>
          </p>
          
          {/* AI Summary / Description */}
          {workflowDescription && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium text-blue-700 mb-1">
                    🤖 AI Understanding
                  </p>
                  {showDescriptionEdit ? (
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full text-sm text-blue-900 bg-white border border-blue-300 rounded p-2 min-h-[60px]"
                      placeholder="Describe what this workflow does..."
                    />
                  ) : (
                    <p className="text-sm text-blue-900 italic">
                      "{description}"
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowDescriptionEdit(!showDescriptionEdit)}
                  className="ml-2 text-blue-600 hover:text-blue-800 text-xs"
                  title={showDescriptionEdit ? 'Done editing' : 'Edit description'}
                >
                  {showDescriptionEdit ? '✓ Done' : '✏️ Edit'}
                </button>
              </div>
              {description !== workflowDescription && (
                <p className="text-xs text-blue-600 mt-1">
                  ✨ Your edits will be used to guide the AI
                </p>
              )}
            </div>
          )}
          
          <p className="text-xs text-muted-foreground mt-2">
            {variables.variables.length} variable{variables.variables.length !== 1 ? 's' : ''} detected
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {variables.variables.map((variable) => {
            const inputType = getInputType(variable.inputType);
            const hasError = touched[variable.variableName] && errors[variable.variableName];
            
            return (
              <div key={variable.variableName} className="space-y-1">
                <label 
                  htmlFor={variable.variableName}
                  className="block text-sm font-medium text-foreground"
                >
                  {variable.fieldName}
                  {variable.isDropdown && variable.options && (
                    <span className="ml-2 text-xs text-purple-600" title="Dropdown with options">
                      📋 Dropdown
                    </span>
                  )}
                  {variable.confidence >= 0.8 && (
                    <span className="ml-2 text-xs text-green-600" title={`AI confidence: ${Math.round(variable.confidence * 100)}%`}>
                      ✓ High confidence
                    </span>
                  )}
                </label>
                
                {/* Show dropdown if options are available, otherwise show input */}
                {variable.isDropdown && variable.options && variable.options.length > 0 ? (
                  <select
                    id={variable.variableName}
                    value={values[variable.variableName]}
                    onChange={(e) => handleChange(variable.variableName, e.target.value)}
                    onBlur={() => handleBlur(variable)}
                    className={`w-full px-3 py-2 border rounded-md bg-background text-foreground ${
                      hasError 
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                        : 'border-border focus:ring-primary focus:border-primary'
                    }`}
                  >
                    {variable.options.map((option, idx) => (
                      <option key={idx} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={variable.variableName}
                    type={inputType}
                    value={values[variable.variableName]}
                    onChange={(e) => handleChange(variable.variableName, e.target.value)}
                    onBlur={() => handleBlur(variable)}
                    placeholder={variable.defaultValue || `Enter ${variable.fieldName.toLowerCase()}`}
                    className={`w-full px-3 py-2 border rounded-md bg-background text-foreground ${
                      hasError 
                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                        : 'border-border focus:ring-primary focus:border-primary'
                    }`}
                  />
                )}
                
                {hasError && (
                  <p className="text-xs text-red-500">{errors[variable.variableName]}</p>
                )}
                
                {variable.isDropdown && variable.options && (
                  <p className="text-xs text-muted-foreground">
                    {variable.options.length} option{variable.options.length !== 1 ? 's' : ''} available
                  </p>
                )}
                
                {variable.reasoning && (
                  <p className="text-xs text-muted-foreground" title={variable.reasoning}>
                    AI: {variable.reasoning.substring(0, 80)}{variable.reasoning.length > 80 ? '...' : ''}
                  </p>
                )}
                
                {variable.defaultValue && values[variable.variableName] !== variable.defaultValue && (
                  <p className="text-xs text-muted-foreground">
                    Default: <span className="font-mono">{variable.defaultValue.substring(0, 30)}{variable.defaultValue.length > 30 ? '...' : ''}</span>
                  </p>
                )}
              </div>
            );
          })}

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleUseDefaults}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 text-sm"
            >
              Use Defaults
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Execute Workflow
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}










