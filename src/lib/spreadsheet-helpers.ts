/**
 * SpreadsheetHelpers - Centralized utilities for spreadsheet operations
 * 
 * This class provides a single source of truth for common spreadsheet operations
 * to prevent bugs from inconsistent cell reference extraction across the codebase.
 */

export interface CellReferenceSource {
  spreadsheetContext?: {
    recordedIntent?: {
      cellRef?: string;
      columnHeader?: string;
      column?: string;
    };
  };
  context?: {
    gridCoordinates?: {
      cellReference?: string;
      columnHeader?: string;
    };
  };
  recordedAriaLabel?: string;
  recordedFallbackSelectors?: string[];
  label?: string;
}

export class SpreadsheetHelpers {
  /**
   * Extract cell reference from any source with consistent priority order
   * 
   * PRIORITY ORDER:
   * 1. spreadsheetContext.recordedIntent.cellRef (most reliable - directly captured)
   * 2. context.gridCoordinates.cellReference (fallback - from ContextScanner)
   * 3. recordedAriaLabel (if matches cell pattern like "A2", "B10")
   * 4. recordedFallbackSelectors (extract from [aria-label="A2"])
   * 5. label (if matches cell pattern)
   * 
   * @param data - Any object that might contain cell reference data
   * @returns Cell reference (e.g., "A2", "B10") or null if not found
   */
  static extractCellReference(data: CellReferenceSource): string | null {
    // Priority 1: spreadsheetContext (added in SPREADSHEET_INPUT_CONTEXT_FIX)
    if (data.spreadsheetContext?.recordedIntent?.cellRef) {
      const cellRef = data.spreadsheetContext.recordedIntent.cellRef.toUpperCase();
      console.log(`[SpreadsheetHelpers] ✅ Extracted cell ref from spreadsheetContext: ${cellRef}`);
      return cellRef;
    }
    
    // Priority 2: gridCoordinates (legacy, from ContextScanner)
    if (data.context?.gridCoordinates?.cellReference) {
      const cellRef = data.context.gridCoordinates.cellReference.toUpperCase();
      console.log(`[SpreadsheetHelpers] ✅ Extracted cell ref from gridCoordinates: ${cellRef}`);
      return cellRef;
    }
    
    // Priority 3: recordedAriaLabel (if it matches cell pattern)
    if (data.recordedAriaLabel) {
      const match = data.recordedAriaLabel.match(/^([A-Z]+\d+)$/i);
      if (match) {
        const cellRef = match[1].toUpperCase();
        console.log(`[SpreadsheetHelpers] ✅ Extracted cell ref from recordedAriaLabel: ${cellRef}`);
        return cellRef;
      }
    }
    
    // Priority 4: fallbackSelectors (extract from aria-label attribute)
    if (data.recordedFallbackSelectors) {
      for (const selector of data.recordedFallbackSelectors) {
        const match = selector.match(/\[aria-label=["']([A-Z]+\d+)["']\]/i);
        if (match) {
          const cellRef = match[1].toUpperCase();
          console.log(`[SpreadsheetHelpers] ✅ Extracted cell ref from fallbackSelector: ${cellRef}`);
          return cellRef;
        }
      }
    }
    
    // Priority 5: label (if it matches cell pattern like "A2", "B10")
    if (data.label && /^[A-Z]+\d+$/i.test(data.label)) {
      const cellRef = data.label.toUpperCase();
      console.log(`[SpreadsheetHelpers] ✅ Extracted cell ref from label: ${cellRef}`);
      return cellRef;
    }
    
    console.log('[SpreadsheetHelpers] ❌ Could not extract cell reference from any source');
    return null;
  }
  
  /**
   * Check if a step or hint is a spreadsheet step
   * @param data - Step payload or hint data
   * @returns true if this is a spreadsheet step
   */
  static isSpreadsheetStep(data: CellReferenceSource): boolean {
    return this.extractCellReference(data) !== null;
  }
  
  /**
   * Extract column letter from cell reference
   * @param cellRef - Cell reference like "A2", "AB10", "Z99"
   * @returns Column letter(s) like "A", "AB", "Z"
   */
  static extractColumn(cellRef: string): string | null {
    const match = cellRef.match(/^([A-Z]+)/i);
    return match ? match[1].toUpperCase() : null;
  }
  
  /**
   * Extract row number from cell reference
   * @param cellRef - Cell reference like "A2", "AB10", "Z99"
   * @returns Row number like 2, 10, 99
   */
  static extractRow(cellRef: string): number | null {
    const match = cellRef.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }
  
  /**
   * Build cell reference from column and row
   * @param column - Column letter(s) like "A", "AB"
   * @param row - Row number like 2, 10
   * @returns Cell reference like "A2", "AB10"
   */
  static buildCellReference(column: string, row: number): string {
    return `${column.toUpperCase()}${row}`;
  }
  
  /**
   * Generate variable name from cell reference
   * @param cellRef - Cell reference like "A2", "B10"
   * @returns Variable name like "cellA2", "cellB10"
   */
  static generateVariableName(cellRef: string): string {
    return `cell${cellRef.replace(/[^A-Z0-9]/gi, '')}`;
  }
  
  /**
   * Extract column header from any source with consistent priority order
   * @param data - Any object that might contain column header data
   * @returns Column header text or null
   */
  static extractColumnHeader(data: CellReferenceSource): string | null {
    // Priority 1: spreadsheetContext
    if (data.spreadsheetContext?.recordedIntent?.columnHeader) {
      return data.spreadsheetContext.recordedIntent.columnHeader;
    }
    
    // Priority 2: gridCoordinates
    if (data.context?.gridCoordinates?.columnHeader) {
      return data.context.gridCoordinates.columnHeader;
    }
    
    return null;
  }
}

