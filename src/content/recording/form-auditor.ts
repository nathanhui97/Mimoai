/**
 * Form Auditor Module
 *
 * Captures a complete snapshot of ALL form fields on a page when the user
 * first interacts with a form element. This provides:
 *
 * - Full field inventory (not just the fields the user touches)
 * - Default/pre-filled values
 * - Required field detection
 * - Field types and constraints
 *
 * On form submission, generates a FormCompletionDiff showing which fields
 * were filled, which were skipped, and why (optional, had default, hidden).
 *
 * This data feeds into the Skill Model for field-level knowledge.
 */

// ============================================================================
// Types
// ============================================================================

export interface FormFieldSnapshot {
  /** Field label (from <label>, aria-label, placeholder, or inferred) */
  label: string;
  /** Input name attribute */
  name: string;
  /** Best CSS selector for this field */
  selector: string;
  /** Field type */
  type: 'text' | 'email' | 'phone' | 'date' | 'select' | 'checkbox' | 'radio' | 'textarea' | 'number' | 'password' | 'url' | 'search' | 'file' | 'hidden' | 'other';
  /** Is this field required? */
  required: boolean;
  /** Validation pattern if any */
  pattern?: string;
  /** Available options (for select/radio) */
  options?: string[];
  /** Current value at time of audit */
  currentValue: string;
  /** Whether the field is empty */
  isEmpty: boolean;
  /** Whether the field is enabled */
  isEnabled: boolean;
  /** Whether the field is visible */
  isVisible: boolean;
  /** Section/fieldset this field belongs to */
  section?: string;
  /** Position in DOM order */
  fieldOrder: number;
  /** Placeholder text */
  placeholder?: string;
}

export interface FormAudit {
  /** When the audit was captured */
  capturedAt: number;
  /** URL where the form was found */
  url: string;
  /** All fields on the form */
  fields: FormFieldSnapshot[];
  /** Form-level metadata */
  formId?: string;
  formAction?: string;
  /** Summary counts */
  totalFields: number;
  requiredFields: number;
  prefilledFields: number;
  /** Which form element triggered the audit */
  triggerFieldSelector?: string;
}

export interface FormCompletionDiff {
  /** Fields the user interacted with */
  filledFields: Array<{
    label: string;
    selector: string;
    value: string;
    interactionType: 'typed' | 'selected' | 'checked' | 'cleared';
  }>;
  /** Fields the user skipped */
  skippedFields: Array<{
    label: string;
    selector: string;
    hadDefault: boolean;
    defaultValue?: string;
    wasRequired: boolean;
    wasVisible: boolean;
    inferredReason: 'optional' | 'had_default' | 'not_applicable' | 'hidden' | 'unknown';
  }>;
  /** Completion summary */
  completionRate: number;
  requiredFieldsComplete: boolean;
}

// ============================================================================
// Form Auditor
// ============================================================================

export class FormAuditor {
  /** Active form audit for the current page */
  private currentAudit: FormAudit | null = null;
  /** Selectors of fields the user has interacted with */
  private interactedFields: Map<string, { value: string; type: string }> = new Map();
  /** URL when audit was taken (to detect page changes) */
  private auditUrl: string = '';

  /**
   * Called when the user first interacts with a form field.
   * Captures a snapshot of ALL form fields on the page.
   * Returns the FormAudit if this is the first interaction on this page.
   */
  onFormFieldInteraction(element: Element): FormAudit | null {
    const currentUrl = window.location.href;

    // Reset if URL changed (new page)
    if (currentUrl !== this.auditUrl) {
      this.reset();
    }

    // Only audit once per page
    if (this.currentAudit) {
      // Track this interaction
      this.trackInteraction(element);
      return null;
    }

    // Capture full form audit
    this.auditUrl = currentUrl;
    this.currentAudit = this.captureFormAudit(element);
    this.trackInteraction(element);

    console.log(
      `[FormAuditor] Captured form audit: ${this.currentAudit.totalFields} fields ` +
      `(${this.currentAudit.requiredFields} required, ${this.currentAudit.prefilledFields} pre-filled)`
    );

    return this.currentAudit;
  }

  /**
   * Track that the user interacted with a specific field.
   */
  trackInteraction(element: Element): void {
    const selector = this.getSimpleSelector(element);
    const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const type = this.getInteractionType(element);
    const value = this.getFieldValue(input);

    this.interactedFields.set(selector, { value, type });
  }

  /**
   * Called when a submit button is clicked.
   * Generates a diff between the form audit and what the user actually filled.
   */
  generateCompletionDiff(): FormCompletionDiff | null {
    if (!this.currentAudit) return null;

    const filledFields: FormCompletionDiff['filledFields'] = [];
    const skippedFields: FormCompletionDiff['skippedFields'] = [];

    for (const field of this.currentAudit.fields) {
      // Skip hidden and disabled fields
      if (field.type === 'hidden' || !field.isEnabled) continue;

      const interaction = this.interactedFields.get(field.selector);

      if (interaction) {
        filledFields.push({
          label: field.label,
          selector: field.selector,
          value: interaction.value,
          interactionType: interaction.type as 'typed' | 'selected' | 'checked' | 'cleared',
        });
      } else {
        // Field was skipped — determine why
        let inferredReason: FormCompletionDiff['skippedFields'][0]['inferredReason'];

        if (!field.isVisible) {
          inferredReason = 'hidden';
        } else if (!field.isEmpty) {
          inferredReason = 'had_default';
        } else if (!field.required) {
          inferredReason = 'optional';
        } else {
          inferredReason = 'unknown';
        }

        skippedFields.push({
          label: field.label,
          selector: field.selector,
          hadDefault: !field.isEmpty,
          defaultValue: !field.isEmpty ? field.currentValue : undefined,
          wasRequired: field.required,
          wasVisible: field.isVisible,
          inferredReason,
        });
      }
    }

    const visibleFields = this.currentAudit.fields.filter(
      f => f.type !== 'hidden' && f.isEnabled
    );
    const completionRate = visibleFields.length > 0
      ? filledFields.length / visibleFields.length
      : 1;

    const requiredFieldsComplete = this.currentAudit.fields
      .filter(f => f.required && f.isVisible && f.isEnabled)
      .every(f => {
        const interaction = this.interactedFields.get(f.selector);
        return interaction || !f.isEmpty; // Filled or had default
      });

    const diff: FormCompletionDiff = {
      filledFields,
      skippedFields,
      completionRate,
      requiredFieldsComplete,
    };

    console.log(
      `[FormAuditor] Completion diff: ${filledFields.length} filled, ` +
      `${skippedFields.length} skipped, ${(completionRate * 100).toFixed(0)}% completion`
    );

    return diff;
  }

  /** Get the current form audit (if any). */
  getAudit(): FormAudit | null {
    return this.currentAudit;
  }

  /** Reset state (e.g., on page navigation). */
  reset(): void {
    this.currentAudit = null;
    this.interactedFields.clear();
    this.auditUrl = '';
  }

  // ── Private: Form Capture ───────────────────────────────────────

  private captureFormAudit(triggerElement: Element): FormAudit {
    // Find the containing form, or scan all forms on the page
    const form = triggerElement.closest('form');
    const formFields = form
      ? this.scanFormFields(form)
      : this.scanAllPageFields();

    const formId = form?.id || form?.getAttribute('name') || undefined;
    const formAction = form?.getAttribute('action') || undefined;
    const requiredCount = formFields.filter(f => f.required).length;
    const prefilledCount = formFields.filter(f => !f.isEmpty).length;

    return {
      capturedAt: Date.now(),
      url: window.location.href,
      fields: formFields,
      formId,
      formAction,
      totalFields: formFields.length,
      requiredFields: requiredCount,
      prefilledFields: prefilledCount,
      triggerFieldSelector: this.getSimpleSelector(triggerElement),
    };
  }

  private scanFormFields(form: HTMLFormElement): FormFieldSnapshot[] {
    const fields: FormFieldSnapshot[] = [];
    const elements = form.querySelectorAll(
      'input, select, textarea, [contenteditable="true"]'
    );

    elements.forEach((el, index) => {
      const snapshot = this.captureFieldSnapshot(el, index);
      if (snapshot) fields.push(snapshot);
    });

    return fields;
  }

  private scanAllPageFields(): FormFieldSnapshot[] {
    const fields: FormFieldSnapshot[] = [];

    // Scan all forms
    const forms = document.querySelectorAll('form');
    if (forms.length > 0) {
      forms.forEach(form => {
        const formFields = this.scanFormFields(form as HTMLFormElement);
        fields.push(...formFields);
      });
    } else {
      // No forms — scan all interactive elements on the page
      const elements = document.querySelectorAll(
        'input, select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"]'
      );
      elements.forEach((el, index) => {
        const snapshot = this.captureFieldSnapshot(el, index);
        if (snapshot) fields.push(snapshot);
      });
    }

    return fields;
  }

  private captureFieldSnapshot(element: Element, index: number): FormFieldSnapshot | null {
    const input = element as HTMLInputElement;

    // Skip submit/button/reset inputs
    const inputType = input.type?.toLowerCase() || '';
    if (['submit', 'button', 'reset', 'image'].includes(inputType)) return null;

    const label = this.getFieldLabel(element);
    const name = input.name || input.id || '';
    const selector = this.getSimpleSelector(element);
    const type = this.mapFieldType(element);
    const required = this.isFieldRequired(element);
    const value = this.getFieldValue(input);
    const isEmpty = !value || value.trim() === '';
    const isEnabled = !input.disabled && !input.readOnly;
    const isVisible = this.isElementVisible(element);
    const section = this.getFieldSection(element);
    const placeholder = input.placeholder || undefined;
    const pattern = input.pattern || undefined;

    let options: string[] | undefined;
    if (element.tagName === 'SELECT') {
      const select = element as HTMLSelectElement;
      options = Array.from(select.options).map(o => o.text.trim()).filter(Boolean);
    }

    return {
      label,
      name,
      selector,
      type,
      required,
      pattern,
      options,
      currentValue: value,
      isEmpty,
      isEnabled,
      isVisible,
      section,
      fieldOrder: index,
      placeholder,
    };
  }

  // ── Private: Field Introspection ────────────────────────────────

  private getFieldLabel(element: Element): string {
    const input = element as HTMLInputElement;

    // 1. Explicit <label for="...">
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return label.textContent?.trim() || '';
    }

    // 2. Wrapping <label>
    const wrappingLabel = element.closest('label');
    if (wrappingLabel) {
      // Get label text excluding the input's own text
      const clone = wrappingLabel.cloneNode(true) as HTMLElement;
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(i => i.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }

    // 3. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // 4. aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim() || '';
    }

    // 5. Placeholder
    if (input.placeholder) return input.placeholder;

    // 6. Name attribute as fallback
    if (input.name) {
      return input.name
        .replace(/([A-Z])/g, ' $1')  // camelCase to words
        .replace(/[_-]/g, ' ')        // snake/kebab to words
        .trim();
    }

    return '';
  }

  private mapFieldType(element: Element): FormFieldSnapshot['type'] {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'select') return 'select';
    if (tagName === 'textarea') return 'textarea';

    if (tagName === 'input') {
      const type = (element as HTMLInputElement).type?.toLowerCase() || 'text';
      const typeMap: Record<string, FormFieldSnapshot['type']> = {
        text: 'text', email: 'email', tel: 'phone', date: 'date',
        number: 'number', password: 'password', url: 'url',
        search: 'search', file: 'file', hidden: 'hidden',
        checkbox: 'checkbox', radio: 'radio',
        'datetime-local': 'date', month: 'date', week: 'date', time: 'date',
      };
      return typeMap[type] || 'other';
    }

    // contenteditable or role-based
    if (element.getAttribute('contenteditable') === 'true') return 'text';
    if (element.getAttribute('role') === 'combobox') return 'select';
    if (element.getAttribute('role') === 'textbox') return 'text';

    return 'other';
  }

  private isFieldRequired(element: Element): boolean {
    const input = element as HTMLInputElement;

    // Direct attributes
    if (input.required) return true;
    if (element.getAttribute('aria-required') === 'true') return true;

    // Check for asterisk in label
    const label = this.getFieldLabel(element);
    if (label.includes('*')) return true;

    // Check for "required" class on parent form group
    const formGroup = element.closest(
      '.form-group, .slds-form-element, [class*="required"], [class*="mandatory"]'
    );
    if (formGroup) {
      const classes = formGroup.className || '';
      if (classes.includes('required') || classes.includes('mandatory')) return true;
    }

    return false;
  }

  private getFieldValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | Element): string {
    if ('value' in element && element.value !== undefined) {
      if ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio') {
        return (element as HTMLInputElement).checked ? 'checked' : '';
      }
      return String((element as HTMLInputElement).value);
    }
    // contenteditable
    if (element.getAttribute('contenteditable') === 'true') {
      return element.textContent?.trim() || '';
    }
    return '';
  }

  private getFieldSection(element: Element): string | undefined {
    // Check for fieldset legend
    const fieldset = element.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return legend.textContent?.trim();
    }

    // Check for section heading
    const section = element.closest('section, [class*="section"], [class*="group"], .slds-section');
    if (section) {
      const heading = section.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
      if (heading) return heading.textContent?.trim();
    }

    return undefined;
  }

  private isElementVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private getSimpleSelector(element: Element): string {
    // ID selector (most stable)
    if (element.id) return `#${CSS.escape(element.id)}`;

    // data-testid
    const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    // name attribute for form fields
    const name = (element as HTMLInputElement).name;
    if (name) return `[name="${CSS.escape(name)}"]`;

    // aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

    // Fallback: tag + nth-of-type
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
      const index = siblings.indexOf(element) + 1;
      return `${element.tagName.toLowerCase()}:nth-of-type(${index})`;
    }

    return element.tagName.toLowerCase();
  }

  private getInteractionType(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'select') return 'selected';
    if (tagName === 'input') {
      const type = (element as HTMLInputElement).type?.toLowerCase();
      if (type === 'checkbox' || type === 'radio') return 'checked';
    }
    return 'typed';
  }
}
