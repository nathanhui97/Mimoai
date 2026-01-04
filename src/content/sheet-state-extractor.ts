/**
 * SheetStateExtractor - Captures full spreadsheet context for AI comprehension
 * ONLY runs on Google Sheets and Excel Online domains
 * 
 * This provides the AI agent with complete sheet structure so it can make
 * intelligent decisions about where to place data, like a human would.
 */

export interface SheetState {
  // Domain verification
  domain: 'google-sheets' | 'excel-online' | null;
  
  // Sheet metadata
  sheetName: string;
  
  // Data structure (what AI sees)
  headers: Array<{ column: string; text: string }>; // [{column: 'A', text: 'Date'}, ...]
  dataRange: {
    firstRow: number;      // First row with data
    lastRow: number;       // Last row with data
    firstColumn: string;   // 'A'
    lastColumn: string;    // 'F'
  };
  
  // Column summaries (for AI to understand structure)
  columns: Array<{
    letter: string;        // 'B'
    header: string;        // 'Sales Amount'
    dataType: 'text' | 'number' | 'date' | 'mixed' | 'empty';
    rowCount: number;      // Rows with data
    lastDataRow: number;   // Last row number with data
    firstEmptyRow: number; // First empty row
    sampleValues: string[]; // First 3 values for context
  }>;
  
  // Current selection
  activeCell: {
    reference: string;     // 'B5'
    value: string | null;
    isEmpty: boolean;
  };
}

export class SheetStateExtractor {
  /**
   * Find the first empty row using keyboard navigation
   * This is fast and reliable - uses Google Sheets' own Ctrl+Down logic
   */
  static async findFirstEmptyRowViaKeyboard(): Promise<number> {
    console.log('📊 SheetStateExtractor: Finding first empty row via keyboard navigation...');
    
    try {
      // Save current active cell to restore later
      const originalCell = this.getGoogleSheetsActiveCell().reference;
      console.log(`📊 Original active cell: ${originalCell}`);
      
      // Navigate to A1
      const nameBox = document.querySelector('#t-name-box') as HTMLInputElement;
      if (!nameBox) {
        console.warn('📊 Name Box not found, using fallback');
        return 2; // Default fallback
      }
      
      // Type A1 into Name Box
      nameBox.focus();
      await this.sleep(50);
      nameBox.value = 'A1';
      nameBox.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(50);
      
      // Press Enter to navigate
      nameBox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
      }));
      await this.sleep(150);
      
      console.log('📊 Navigated to A1, now pressing Ctrl+Down...');
      
      // Press Ctrl+Down to jump to last cell with data in column A
      const activeElement = document.activeElement || document.body;
      activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        ctrlKey: true,
        bubbles: true,
      }));
      await this.sleep(200);
      
      // Read current cell from Name Box
      const currentCell = nameBox.value || 'A1';
      console.log(`📊 After Ctrl+Down, Name Box shows: "${currentCell}"`);
      
      // Extract row number
      const rowMatch = currentCell.match(/(\d+)$/);
      const lastDataRow = rowMatch ? parseInt(rowMatch[1], 10) : 1;
      
      // If we're still at A1, that means column A is empty or has only header
      // In this case, check if A1 has data (header)
      const firstEmptyRow = lastDataRow === 1 ? 2 : lastDataRow + 1;
      
      console.log(`📊 Last data row: ${lastDataRow}, First empty row: ${firstEmptyRow}`);
      
      // Restore original cell (optional - the workflow will navigate anyway)
      // nameBox.value = originalCell;
      // nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      
      return firstEmptyRow;
    } catch (error) {
      console.error('📊 Error finding empty row via keyboard:', error);
      return 2; // Safe fallback
    }
  }
  
  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Canonical domain check - used EVERYWHERE for safeguards
   * This is the ONLY function that determines if we're on a spreadsheet
   */
  static isSpreadsheetDomain(url?: string): boolean {
    const urlToCheck = url || window.location.href;
    const urlLower = urlToCheck.toLowerCase();
    
    try {
      const hostname = new URL(urlToCheck).hostname.toLowerCase();
      
      // Google Sheets
      if (hostname.includes('docs.google.com') && urlLower.includes('/spreadsheets')) {
        return true;
      }
      
      // Excel Online / Office 365
      if (hostname.includes('excel.office.com') || 
          (hostname.includes('office.com') && urlLower.includes('/excel')) ||
          hostname.includes('onedrive.live.com')) {
        return true;
      }
      
      return false;
    } catch (e) {
      console.warn('📊 SheetStateExtractor: Invalid URL for domain check:', e);
      return false;
    }
  }
  
  /**
   * Extract full sheet state for AI comprehension
   * Returns null if not on a spreadsheet domain (SAFEGUARD)
   */
  static async extract(): Promise<SheetState | null> {
    // SAFEGUARD: Only run on spreadsheet domains
    if (!this.isSpreadsheetDomain()) {
      console.log('📊 SheetStateExtractor: Not on spreadsheet domain, skipping extraction');
      return null;
    }
    
    console.log('📊 SheetStateExtractor: Extracting sheet state...');
    
    try {
      const domain = this.detectDomain();
      
      if (domain === 'google-sheets') {
        return await this.extractGoogleSheets();
      } else if (domain === 'excel-online') {
        return await this.extractExcelOnline();
      }
      
      return null;
    } catch (error) {
      console.error('📊 SheetStateExtractor: Error extracting sheet state:', error);
      return null;
    }
  }
  
  /**
   * Detect specific spreadsheet platform
   */
  private static detectDomain(): 'google-sheets' | 'excel-online' | null {
    const url = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    
    if (hostname.includes('docs.google.com') && url.includes('/spreadsheets')) {
      return 'google-sheets';
    }
    
    if (hostname.includes('excel.office.com') || 
        (hostname.includes('office.com') && url.includes('/excel')) ||
        hostname.includes('onedrive.live.com')) {
      return 'excel-online';
    }
    
    return null;
  }
  
  /**
   * Extract state from Google Sheets
   */
  private static async extractGoogleSheets(): Promise<SheetState | null> {
    console.log('📊 SheetStateExtractor: Extracting from Google Sheets');
    
    // Get sheet name
    const sheetName = this.getGoogleSheetsName();
    
    // Get active cell
    const activeCell = this.getGoogleSheetsActiveCell();
    
    // Scan visible cells to understand structure
    const { headers, dataRange, columns } = await this.scanGoogleSheetsStructure();
    
    const sheetState: SheetState = {
      domain: 'google-sheets',
      sheetName,
      headers,
      dataRange,
      columns,
      activeCell,
    };
    
    console.log('📊 SheetStateExtractor: Extracted sheet state:', {
      sheetName,
      activeCell: activeCell.reference,
      columnCount: columns.length,
      dataRange: `${dataRange.firstColumn}${dataRange.firstRow}:${dataRange.lastColumn}${dataRange.lastRow}`,
    });
    
    return sheetState;
  }
  
  /**
   * Extract state from Excel Online
   */
  private static async extractExcelOnline(): Promise<SheetState | null> {
    console.log('📊 SheetStateExtractor: Extracting from Excel Online');
    
    // Excel Online has different DOM structure - simplified extraction
    const sheetName = document.querySelector('.font-semibold')?.textContent?.trim() || 'Sheet1';
    
    const activeCell = {
      reference: 'A1',
      value: null,
      isEmpty: true,
    };
    
    // Basic structure - Excel Online is harder to parse
    const sheetState: SheetState = {
      domain: 'excel-online',
      sheetName,
      headers: [],
      dataRange: {
        firstRow: 1,
        lastRow: 1,
        firstColumn: 'A',
        lastColumn: 'A',
      },
      columns: [],
      activeCell,
    };
    
    console.log('📊 SheetStateExtractor: Excel Online extraction (basic)');
    return sheetState;
  }
  
  /**
   * Get Google Sheets sheet name
   */
  private static getGoogleSheetsName(): string {
    // Try multiple selectors for sheet name
    const selectors = [
      '.docs-sheet-tab-name',
      '[aria-label*="Sheet"]',
      '.docs-sheet-active-tab .docs-sheet-tab-name',
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent) {
        return element.textContent.trim();
      }
    }
    
    // Extract from URL if possible
    const urlMatch = window.location.href.match(/\/d\/([^\/]+)/);
    return urlMatch ? `Sheet_${urlMatch[1].substring(0, 8)}` : 'Untitled';
  }
  
  /**
   * Get active cell in Google Sheets
   */
  private static getGoogleSheetsActiveCell(): SheetState['activeCell'] {
    // Check Name Box for active cell reference
    const nameBoxSelectors = [
      '#t-name-box-input',
      '#t-name-box',
      '.name-box-input',
      '[id*="name-box"]',
    ];
    
    for (const selector of nameBoxSelectors) {
      const nameBox = document.querySelector(selector) as HTMLInputElement;
      if (nameBox) {
        const cellRef = (nameBox.value || nameBox.textContent || '').trim();
        if (cellRef && /^[A-Z]+\d+$/i.test(cellRef)) {
          // Get cell value from formula bar
          const formulaBar = document.querySelector('#t-formula-bar-input') as HTMLInputElement;
          const value = formulaBar?.value || formulaBar?.textContent || null;
          
          return {
            reference: cellRef.toUpperCase(),
            value: value && value.trim() !== '' ? value.trim() : null,
            isEmpty: !value || value.trim() === '',
          };
        }
      }
    }
    
    // Fallback
    return {
      reference: 'A1',
      value: null,
      isEmpty: true,
    };
  }
  
  /**
   * Scan Google Sheets structure to understand data layout
   */
  private static async scanGoogleSheetsStructure(): Promise<{
    headers: Array<{ column: string; text: string }>;
    dataRange: SheetState['dataRange'];
    columns: SheetState['columns'];
  }> {
    const headers: Array<{ column: string; text: string }> = [];
    const columns: SheetState['columns'] = [];
    
    // Get all visible cells with role="gridcell"
    const cells = document.querySelectorAll('[role="gridcell"]');
    console.log(`📊 SheetStateExtractor: Found ${cells.length} gridcells`);
    
    // Parse cell references and organize by column
    const columnData = new Map<string, Array<{ row: number; value: string; isEmpty: boolean }>>();
    let minRow = Infinity;
    let maxRow = 0;
    const columnLetters = new Set<string>();
    
    for (const cell of cells) {
      const ariaLabel = cell.getAttribute('aria-label');
      if (!ariaLabel) continue;
      
      // Extract cell reference from aria-label (e.g., "Cell A1", "A1 value is...")
      const cellRefMatch = ariaLabel.match(/\b([A-Z]{1,3}\d{1,5})\b/i);
      if (!cellRefMatch) continue;
      
      const cellRef = cellRefMatch[1].toUpperCase();
      const colMatch = cellRef.match(/^([A-Z]+)/);
      const rowMatch = cellRef.match(/(\d+)$/);
      
      if (!colMatch || !rowMatch) continue;
      
      const column = colMatch[1];
      const row = parseInt(rowMatch[1], 10);
      const value = cell.textContent?.trim() || '';
      const isEmpty = !value;
      
      columnLetters.add(column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      
      if (!columnData.has(column)) {
        columnData.set(column, []);
      }
      
      // CRITICAL FIX: Store ALL cells (not just ones with values)
      // This allows us to detect columns and find first empty row
      columnData.get(column)!.push({ row, value, isEmpty });
    }
    
    console.log(`📊 SheetStateExtractor: Detected ${columnLetters.size} columns:`, Array.from(columnLetters));
    console.log(`📊 SheetStateExtractor: Row range: ${minRow} to ${maxRow}`);
    
    // Sort columns alphabetically
    const sortedColumns = Array.from(columnLetters).sort();
    
    // Analyze each column
    for (const colLetter of sortedColumns) {
      const cellsInColumn = columnData.get(colLetter) || [];
      cellsInColumn.sort((a, b) => a.row - b.row);
      
      // Assume row 1 is header
      const headerCell = cellsInColumn.find(c => c.row === 1);
      const headerText = headerCell?.value || '';
      
      if (headerText) {
        headers.push({ column: colLetter, text: headerText });
      }
      
      // Get ALL cells beyond row 1 (to detect empty rows)
      const dataCells = cellsInColumn.filter(c => c.row > 1);
      
      // Get cells with actual values
      const cellsWithData = dataCells.filter(c => !c.isEmpty);
      
      // Determine data type (only from cells with data)
      let dataType: SheetState['columns'][0]['dataType'] = 'empty';
      if (cellsWithData.length > 0) {
        const hasNumbers = cellsWithData.some(c => !isNaN(parseFloat(c.value)));
        const hasText = cellsWithData.some(c => isNaN(parseFloat(c.value)) && c.value);
        const hasDate = cellsWithData.some(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c.value));
        
        if (hasDate) dataType = 'date';
        else if (hasNumbers && hasText) dataType = 'mixed';
        else if (hasNumbers) dataType = 'number';
        else if (hasText) dataType = 'text';
      }
      
      // Find last data row and first empty row
      const lastDataRow = cellsWithData.length > 0 
        ? Math.max(...cellsWithData.map(c => c.row))
        : 1; // Default to row 1 if no data
      
      // First empty row is the row after the last data row
      const firstEmptyRow = lastDataRow + 1;
      
      // Sample values (first 3 cells with data)
      const sampleValues = cellsWithData.slice(0, 3).map(c => c.value);
      
      console.log(`📊 Column ${colLetter}: ${cellsWithData.length} cells with data, lastDataRow=${lastDataRow}, firstEmptyRow=${firstEmptyRow}`);
      
      columns.push({
        letter: colLetter,
        header: headerText,
        dataType,
        rowCount: cellsWithData.length,
        lastDataRow,
        firstEmptyRow,
        sampleValues,
      });
    }
    
    console.log(`📊 SheetStateExtractor: Built ${columns.length} column summaries`);
    
    // Determine overall data range
    const firstColumn = sortedColumns[0] || 'A';
    const lastColumn = sortedColumns[sortedColumns.length - 1] || 'A';
    const firstRow = minRow === Infinity ? 1 : minRow;
    const lastRow = maxRow || 1;
    
    return {
      headers,
      dataRange: {
        firstRow,
        lastRow,
        firstColumn,
        lastColumn,
      },
      columns,
    };
  }
}

