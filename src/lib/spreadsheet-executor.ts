/**
 * SpreadsheetExecutor - Executes spreadsheet-specific actions
 * ONLY operates on Google Sheets and Excel Online domains
 * 
 * Handles dynamic cell finding and clicking based on AI decisions
 */

import { SheetStateExtractor } from '../content/sheet-state-extractor';

export interface SpreadsheetActionResult {
  success: boolean;
  cellRef?: string;
  error?: string;
  message?: string;
}

export class SpreadsheetExecutor {
  /**
   * Execute a spreadsheet action
   * SAFEGUARD: Verifies we're on a spreadsheet domain before execution
   */
  static async execute(action: any): Promise<SpreadsheetActionResult> {
    // SAFEGUARD: Verify we're on a spreadsheet domain
    if (!SheetStateExtractor.isSpreadsheetDomain()) {
      console.error('🚫 SpreadsheetExecutor: Called on non-spreadsheet domain');
      return {
        success: false,
        error: 'Spreadsheet executor called on non-spreadsheet domain',
      };
    }
    
    console.log('📊 SpreadsheetExecutor: Executing action:', action.action);
    
    try {
      switch (action.action) {
        case 'click_cell':
          return await this.clickCell(action.cellRef);
          
        case 'find_and_click_empty':
          const cellRef = await this.findNextEmptyInColumn(action.column);
          if (!cellRef) {
            return {
              success: false,
              error: `Could not find empty cell in column ${action.column}`,
            };
          }
          return await this.clickCell(cellRef);
          
        case 'find_by_header':
          const targetCell = await this.findCellByHeader(action.headerText, action.rowOffset || 1);
          if (!targetCell) {
            return {
              success: false,
              error: `Could not find column with header "${action.headerText}"`,
            };
          }
          return await this.clickCell(targetCell);
          
        default:
          return {
            success: false,
            error: `Unknown spreadsheet action: ${action.action}`,
          };
      }
    } catch (error) {
      console.error('📊 SpreadsheetExecutor: Error executing action:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Find the next empty cell in a column
   */
  private static async findNextEmptyInColumn(column: string): Promise<string | null> {
    console.log(`📊 SpreadsheetExecutor: Finding next empty cell in column ${column}`);
    
    // Extract current sheet state
    const sheetState = await SheetStateExtractor.extract();
    if (!sheetState) {
      console.error('📊 SpreadsheetExecutor: Could not extract sheet state');
      return null;
    }
    
    // Find column info
    const columnInfo = sheetState.columns.find(c => c.letter === column);
    if (!columnInfo) {
      console.error(`📊 SpreadsheetExecutor: Column ${column} not found in sheet state`);
      return null;
    }
    
    // Return first empty row
    const cellRef = `${column}${columnInfo.firstEmptyRow}`;
    console.log(`📊 SpreadsheetExecutor: Found next empty cell: ${cellRef}`);
    return cellRef;
  }
  
  /**
   * Find a cell by column header and row offset
   */
  private static async findCellByHeader(headerText: string, rowOffset: number): Promise<string | null> {
    console.log(`📊 SpreadsheetExecutor: Finding cell by header "${headerText}", offset ${rowOffset}`);
    
    // Extract current sheet state
    const sheetState = await SheetStateExtractor.extract();
    if (!sheetState) {
      console.error('📊 SpreadsheetExecutor: Could not extract sheet state');
      return null;
    }
    
    // Find column with matching header (case-insensitive)
    const headerLower = headerText.toLowerCase();
    const columnInfo = sheetState.columns.find(c => 
      c.header.toLowerCase().includes(headerLower) || 
      headerLower.includes(c.header.toLowerCase())
    );
    
    if (!columnInfo) {
      console.error(`📊 SpreadsheetExecutor: Column with header "${headerText}" not found`);
      return null;
    }
    
    // Calculate target row (1 = header row, so offset 1 = row 2)
    const targetRow = 1 + rowOffset;
    const cellRef = `${columnInfo.letter}${targetRow}`;
    
    console.log(`📊 SpreadsheetExecutor: Found cell by header: ${cellRef}`);
    return cellRef;
  }
  
  /**
   * Click a specific cell by reference (e.g., "B5")
   */
  private static async clickCell(cellRef: string): Promise<SpreadsheetActionResult> {
    console.log(`📊 SpreadsheetExecutor: Clicking cell ${cellRef}`);
    
    // Strategy 1: Use Name Box to navigate to cell (most reliable for Google Sheets)
    const nameBoxSuccess = await this.clickCellViaNameBox(cellRef);
    if (nameBoxSuccess) {
      return {
        success: true,
        cellRef,
        message: `Successfully clicked cell ${cellRef} via Name Box`,
      };
    }
    
    // Strategy 2: Find cell by aria-label and click directly
    const directClickSuccess = await this.clickCellDirectly(cellRef);
    if (directClickSuccess) {
      return {
        success: true,
        cellRef,
        message: `Successfully clicked cell ${cellRef} directly`,
      };
    }
    
    // Strategy 3: Use keyboard navigation (fallback)
    const keyboardSuccess = await this.clickCellViaKeyboard(cellRef);
    if (keyboardSuccess) {
      return {
        success: true,
        cellRef,
        message: `Successfully clicked cell ${cellRef} via keyboard`,
      };
    }
    
    return {
      success: false,
      cellRef,
      error: `Could not click cell ${cellRef} - all strategies failed`,
    };
  }
  
  /**
   * Click cell using Name Box (Google Sheets)
   */
  private static async clickCellViaNameBox(cellRef: string): Promise<boolean> {
    try {
      // Find Name Box
      const nameBoxSelectors = [
        '#t-name-box-input',
        '#t-name-box',
        '.name-box-input',
        '[id*="name-box"]',
      ];
      
      let nameBox: HTMLInputElement | null = null;
      for (const selector of nameBoxSelectors) {
        nameBox = document.querySelector(selector) as HTMLInputElement;
        if (nameBox) break;
      }
      
      if (!nameBox) {
        console.log('📊 SpreadsheetExecutor: Name Box not found');
        return false;
      }
      
      // Set value and trigger events
      nameBox.value = cellRef;
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      nameBox.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Press Enter to navigate
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
      });
      nameBox.dispatchEvent(enterEvent);
      
      // Wait for navigation
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log(`📊 SpreadsheetExecutor: Successfully navigated to ${cellRef} via Name Box`);
      return true;
    } catch (error) {
      console.error('📊 SpreadsheetExecutor: Error using Name Box:', error);
      return false;
    }
  }
  
  /**
   * Click cell directly by finding it in the DOM
   */
  private static async clickCellDirectly(cellRef: string): Promise<boolean> {
    try {
      // Try multiple selectors for the cell
      const selectors = [
        `[aria-label*="${cellRef}"]`,
        `[aria-label="Cell ${cellRef}"]`,
        `[aria-label^="${cellRef} "]`,
        `[data-cell="${cellRef}"]`,
        `[data-cellref="${cellRef}"]`,
      ];
      
      for (const selector of selectors) {
        const cells = document.querySelectorAll(selector);
        for (const cell of cells) {
          // Verify this is actually the right cell
          const ariaLabel = cell.getAttribute('aria-label') || '';
          if (ariaLabel.includes(cellRef)) {
            // Click the cell
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
            });
            cell.dispatchEvent(clickEvent);
            
            // Also focus it
            if (cell instanceof HTMLElement) {
              cell.focus();
            }
            
            console.log(`📊 SpreadsheetExecutor: Successfully clicked cell ${cellRef} directly`);
            return true;
          }
        }
      }
      
      console.log('📊 SpreadsheetExecutor: Could not find cell in DOM');
      return false;
    } catch (error) {
      console.error('📊 SpreadsheetExecutor: Error clicking cell directly:', error);
      return false;
    }
  }
  
  /**
   * Click cell using keyboard navigation (fallback)
   */
  private static async clickCellViaKeyboard(cellRef: string): Promise<boolean> {
    try {
      // Parse cell reference
      const colMatch = cellRef.match(/^([A-Z]+)/);
      const rowMatch = cellRef.match(/(\d+)$/);
      
      if (!colMatch || !rowMatch) {
        return false;
      }
      
      // Use Ctrl+Home to go to A1, then navigate
      const ctrlHome = new KeyboardEvent('keydown', {
        key: 'Home',
        code: 'Home',
        ctrlKey: true,
        bubbles: true,
      });
      document.activeElement?.dispatchEvent(ctrlHome);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Use Ctrl+G (Go To) if available
      const ctrlG = new KeyboardEvent('keydown', {
        key: 'g',
        code: 'KeyG',
        ctrlKey: true,
        bubbles: true,
      });
      document.activeElement?.dispatchEvent(ctrlG);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Type cell reference
      for (const char of cellRef) {
        const charEvent = new KeyboardEvent('keypress', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          bubbles: true,
        });
        document.activeElement?.dispatchEvent(charEvent);
      }
      
      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
      });
      document.activeElement?.dispatchEvent(enterEvent);
      
      console.log(`📊 SpreadsheetExecutor: Attempted keyboard navigation to ${cellRef}`);
      return true;
    } catch (error) {
      console.error('📊 SpreadsheetExecutor: Error using keyboard navigation:', error);
      return false;
    }
  }
}

