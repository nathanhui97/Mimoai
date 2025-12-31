/**
 * ElementSimilarity - Detects similar elements and generates disambiguation strategies
 */

export interface SimilarityResult {
  similarElements: Element[];
  similarityScore: number;
  uniquenessScore: number;
  disambiguationAttributes: Record<string, string>;
}

export class ElementSimilarity {
  /**
   * Find all elements similar to the given element
   */
  static findSimilarElements(element: Element): Element[] {
    const similar: Element[] = [];
    const elementSignature = this.getElementSignature(element);

    // Search through document
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el === element) continue;
      
      const signature = this.getElementSignature(el);
      if (this.areSignaturesSimilar(elementSignature, signature)) {
        similar.push(el);
      }
    }

    return similar;
  }

  /**
   * Get a signature for an element (for comparison)
   */
  private static getElementSignature(element: Element): {
    tagName: string;
    classes: string[];
    attributes: Record<string, string>;
    text: string;
    role: string | null;
  } {
    const classes = element.className && typeof element.className === 'string'
      ? element.className.split(/\s+/).filter(c => c.length > 0)
      : [];

    const attributes: Record<string, string> = {};
    const importantAttrs = ['data-testid', 'data-cy', 'aria-label', 'role', 'type', 'name'];
    for (const attr of importantAttrs) {
      const value = element.getAttribute(attr);
      if (value) {
        attributes[attr] = value;
      }
    }

    return {
      tagName: element.tagName.toLowerCase(),
      classes: classes.slice(0, 3), // First 3 classes
      attributes,
      text: element.textContent?.trim().substring(0, 50) || '',
      role: element.getAttribute('role'),
    };
  }

  /**
   * Check if two element signatures are similar
   */
  private static areSignaturesSimilar(
    sig1: ReturnType<typeof this.getElementSignature>,
    sig2: ReturnType<typeof this.getElementSignature>
  ): boolean {
    // Same tag name
    if (sig1.tagName !== sig2.tagName) return false;

    // Similar classes (at least one class in common)
    if (sig1.classes.length > 0 && sig2.classes.length > 0) {
      const commonClasses = sig1.classes.filter(c => sig2.classes.includes(c));
      if (commonClasses.length === 0) return false;
    }

    // Similar text content (if both have text)
    if (sig1.text && sig2.text && sig1.text.length > 5) {
      const similarity = this.textSimilarity(sig1.text, sig2.text);
      if (similarity > 0.8) return true;
    }

    // Same role
    if (sig1.role && sig2.role && sig1.role === sig2.role) {
      return true;
    }

    // Similar attributes
    const commonAttrs = Object.keys(sig1.attributes).filter(
      key => sig1.attributes[key] === sig2.attributes[key]
    );
    if (commonAttrs.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Calculate text similarity (simple Levenshtein-like)
   */
  private static textSimilarity(text1: string, text2: string): number {
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get uniqueness score (0-1, where 1 is completely unique)
   */
  static getUniquenessScore(element: Element, similarElements: Element[]): number {
    if (similarElements.length === 0) return 1.0;

    // More similar elements = lower uniqueness
    const baseScore = 1.0 / (1 + similarElements.length);

    // Check if element has unique attributes
    const uniqueAttrs = this.getUniqueAttributes(element, similarElements);
    const attrBonus = Object.keys(uniqueAttrs).length > 0 ? 0.3 : 0;

    return Math.min(1.0, baseScore + attrBonus);
  }

  /**
   * Get attributes that make this element unique compared to similar ones
   */
  static getDisambiguationAttributes(
    element: Element,
    similarElements: Element[]
  ): Record<string, string> {
    const unique: Record<string, string> = {};

    if (similarElements.length === 0) return unique;

    // Check all attributes
    for (const attr of element.attributes) {
      const value = attr.value;
      if (!value) continue;

      // Check if this attribute value is unique
      const isUnique = similarElements.every(
        similar => similar.getAttribute(attr.name) !== value
      );

      if (isUnique) {
        unique[attr.name] = value;
      }
    }

    // Check ID
    if (element.id) {
      const isUnique = similarElements.every(similar => similar.id !== element.id);
      if (isUnique) {
        unique.id = element.id;
      }
    }

    return unique;
  }

  /**
   * Get unique attributes (alias for getDisambiguationAttributes)
   */
  static getUniqueAttributes(
    element: Element,
    similarElements: Element[]
  ): Record<string, string> {
    return this.getDisambiguationAttributes(element, similarElements);
  }
}












