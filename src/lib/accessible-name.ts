/**
 * Accessible Name Computation
 * 
 * Computes the accessible name of an element following the ARIA spec.
 * This is critical for role + accessible name matching (one of our top locator strategies).
 * 
 * Priority order (per ARIA spec):
 * 1. aria-labelledby (resolve to text of referenced elements)
 * 2. aria-label
 * 3. Associated <label for="...">
 * 4. Wrapping <label>
 * 5. title attribute (weak signal)
 * 6. placeholder (weakest signal)
 */

/**
 * Compute the accessible name for an element
 * 
 * @param element - The element to compute accessible name for
 * @param doc - Document context (defaults to global document)
 * @returns The accessible name, or null if none found
 */
export function computeAccessibleName(
  element: Element,
  doc: Document = document
): string | null {
  // 1. aria-labelledby (resolve to text of referenced elements)
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const texts: string[] = [];
    
    for (const id of ids) {
      const refElement = doc.getElementById(id);
      if (refElement) {
        const text = refElement.textContent?.trim();
        if (text) {
          texts.push(text);
        }
      }
    }
    
    if (texts.length > 0) {
      return texts.join(' ');
    }
  }
  
  // 2. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim();
  }
  
  // 3. Associated <label for="...">
  const elementId = element.id;
  if (elementId) {
    const label = doc.querySelector(`label[for="${CSS.escape(elementId)}"]`);
    if (label) {
      const labelText = label.textContent?.trim();
      if (labelText) {
        return labelText;
      }
    }
  }
  
  // 4. Wrapping <label>
  const wrappingLabel = element.closest('label');
  if (wrappingLabel) {
    // Get label text excluding the input itself
    // Clone the label so we don't modify the DOM
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    
    // Remove all input elements from the clone
    const inputsInClone = clone.querySelectorAll('input, select, textarea, button');
    inputsInClone.forEach(el => el.remove());
    
    const labelText = clone.textContent?.trim();
    if (labelText) {
      return labelText;
    }
  }
  
  // 5. title attribute (weak signal)
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    return title.trim();
  }
  
  // 6. placeholder (weakest signal)
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const placeholder = element.placeholder;
    if (placeholder && placeholder.trim()) {
      return placeholder.trim();
    }
  }
  
  // No accessible name found
  return null;
}

/**
 * Check if two accessible names match (case-insensitive, flexible)
 * 
 * @param actual - Accessible name from current page
 * @param expected - Accessible name from recorded step
 * @returns true if names match
 */
export function accessibleNamesMatch(
  actual: string | null,
  expected: string | null
): boolean {
  if (!actual || !expected) return false;
  
  const normalizedActual = actual.toLowerCase().trim();
  const normalizedExpected = expected.toLowerCase().trim();
  
  // Exact match
  if (normalizedActual === normalizedExpected) {
    return true;
  }
  
  // Contains match (for partial labels)
  if (normalizedActual.includes(normalizedExpected) || 
      normalizedExpected.includes(normalizedActual)) {
    return true;
  }
  
  return false;
}

/**
 * Get accessible name with fallback to element text
 * 
 * @param element - The element
 * @returns Accessible name, element text, or empty string
 */
export function getAccessibleNameOrText(element: Element): string {
  const accessibleName = computeAccessibleName(element);
  if (accessibleName) {
    return accessibleName;
  }
  
  // Fallback to element text content (first 100 chars)
  const text = element.textContent?.trim();
  if (text) {
    return text.length > 100 ? text.slice(0, 100) + '...' : text;
  }
  
  return '';
}



