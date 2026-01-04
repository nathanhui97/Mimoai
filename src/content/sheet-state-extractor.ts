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
    
    // Parse cell references and organize by column
    const columnData = new Map<string, Array<{ row: number; value: string }>>();
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
      
      columnLetters.add(column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      
      if (!columnData.has(column)) {
        columnData.set(column, []);
      }
      
      if (value) {
        columnData.get(column)!.push({ row, value });
      }
    }
    
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
      
      // Get data cells (skip row 1 if it's header)
      const dataCells = cellsInColumn.filter(c => c.row > 1);
      
      // Determine data type
      let dataType: SheetState['columns'][0]['dataType'] = 'empty';
      if (dataCells.length > 0) {
        const hasNumbers = dataCells.some(c => !isNaN(parseFloat(c.value)));
        const hasText = dataCells.some(c => isNaN(parseFloat(c.value)));
        const hasDate = dataCells.some(c => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c.value));
        
        if (hasDate) dataType = 'date';
        else if (hasNumbers && hasText) dataType = 'mixed';
        else if (hasNumbers) dataType = 'number';
        else if (hasText) dataType = 'text';
      }
      
      // Find last data row and first empty row
      const lastDataRow = dataCells.length > 0 
        ? Math.max(...dataCells.map(c => c.row))
        : 1;
      
      const firstEmptyRow = lastDataRow + 1;
      
      // Sample values (first 3 data cells)
      const sampleValues = dataCells.slice(0, 3).map(c => c.value);
      
      columns.push({
        letter: colLetter,
        header: headerText,
        dataType,
        rowCount: dataCells.length,
        lastDataRow,
        firstEmptyRow,
        sampleValues,
      });
    }
    
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

