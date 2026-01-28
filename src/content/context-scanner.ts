/**
 * ContextScanner - Captures semantic coordinates during recording
 * Critical for AI to understand grid/form/table structures
 */

export interface GridCoordinates {
  rowIndex?: number;
  columnIndex?: number;
  cellReference?: string; // "A1", "B2"
  columnHeader?: string; // "Price", "Product Name"
  rowHeader?: string; // If row has header
  isHeader?: boolean;
}

export interface FormCoordinates {
  label?: string;
  fieldOrder?: number;
  fieldset?: string;
  section?: string;
}

export interface TableCoordinates {
  rowIndex?: number;
  columnIndex?: number;
  headerRow?: number;
  headerColumn?: number;
}

export interface DecisionSpace {
  type: 'LIST_SELECTION' | 'RADIO_GROUP' | 'CHECKBOX_GROUP';
  options: string[]; // All available options in the container/group
  selectedIndex: number; // 0-indexed position of selected option (for LIST_SELECTION and RADIO_GROUP)
  selectedText: string; // Text of the selected/checked option
  selectedIndices?: number[]; // For CHECKBOX_GROUP (multiple selections)
  containerSelector?: string; // Selector for the container (dropdown, list, etc.)
  groupLabel?: string; // Label for the group (e.g., "Gender:", "Choose applicable options:")
}

export interface ButtonContext {
  section?: string; // Section header (e.g., "Account Information")
  label?: string; // Button text or aria-label
  role?: string; // ARIA role if present
}

export class ContextScanner {
  /**
   * Scan element and detect context type, returning appropriate coordinates
   */
  static scan(element: Element): {
    gridCoordinates?: GridCoordinates;
    formCoordinates?: FormCoordinates;
    tableCoordinates?: TableCoordinates;
    decisionSpace?: DecisionSpace;
    buttonContext?: ButtonContext;
  } {
    // Special case: For Google Sheets cell-input elements, scan from parent input-box
    // Also handle input-box elements - they need to find the grid container
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('cell-input') && element.parentElement) {
      const parent = element.parentElement;
      const parentClass = parent.className?.toString().toLowerCase() || '';
      if (parentClass.includes('input-box')) {
        // Scan from parent instead (parent has better context)
        return this.scan(parent);
      }
    }
    
    // Special case: For input-box elements, check if they're in a grid container
    // Google Sheets cells (input-box) are NOT direct children of grid-container in the DOM
    // They're in a separate branch, but we can detect them by:
    // 1. Checking if we're on a Google Sheets page
    // 2. Looking for grid-container anywhere in the document
    // 3. Extracting cell references from aria-labels
    if (className.includes('input-box')) {
      // Check if we're on Google Sheets (by URL or document structure)
      const isGoogleSheets = window.location.href.includes('docs.google.com/spreadsheets') ||
                             document.querySelector('.grid-container, .grid-table-container') !== null;
      
      if (isGoogleSheets) {
        // This is likely a Google Sheets cell
        // Strategy: Trust the Name Box (Formula Bar Proxy approach)
        // The Name Box shows the active cell, which is reliable for clicks/inputs
        let cellRef = this.extractCellReference(element);
        
        // Try to find grid container in document (not just parent chain)
        const gridContainer = document.querySelector('.grid-container, .grid-table-container');
        
        if (gridContainer) {
          // If Name Box didn't work, try fallback strategies
          if (!cellRef) {
            // Fallback 1: Try to extract row/column indices from DOM structure
            const rowIndex = this.extractRowIndex(element, gridContainer);
            const columnIndex = this.extractColumnIndex(element);
            
            // If we have both row and column, calculate cell reference
            if (rowIndex !== undefined && columnIndex !== undefined) {
              cellRef = this.calculateCellReference(rowIndex, columnIndex);
              console.log('🔍 ContextScanner: Calculated cell reference from row/column indices:', {
                rowIndex,
                columnIndex,
                calculatedCellRef: cellRef,
              });
            } else {
              // Fallback 2: Try with a small delay (Name Box might update after click)
              // Note: This is a last resort and might not work for all cases
              console.warn('🔍 ContextScanner: Name Box and row/column extraction both failed. Cell might not be active yet.');
            }
          }
          
          // This is a Google Sheets cell, create grid coordinates
          const gridCoords: GridCoordinates = {
            cellReference: cellRef || undefined,
            // Try to extract row/column from cell reference, or use calculated values
            rowIndex: cellRef ? this.extractRowFromCellRef(cellRef) : this.extractRowIndex(element, gridContainer),
            columnIndex: cellRef ? this.extractColumnFromCellRef(cellRef) : this.extractColumnIndex(element),
            columnHeader: undefined, // Will be filled by findColumnHeader if needed
            rowHeader: undefined,
            isHeader: undefined,
          };
          
          // Log actual string values, not objects
          const cellRefStr = gridCoords.cellReference || 'NOT FOUND';
          const rowIndexStr = gridCoords.rowIndex !== undefined ? String(gridCoords.rowIndex) : 'NOT FOUND';
          const columnIndexStr = gridCoords.columnIndex !== undefined ? String(gridCoords.columnIndex) : 'NOT FOUND';
          
          console.log('🔍 ContextScanner: Detected gridCoordinates for input-box (Google Sheets):', {
            cellReference: cellRefStr,
            rowIndex: rowIndexStr,
            columnIndex: columnIndexStr,
            hasContainer: !!gridContainer,
          });
          
          // Debug: Log what we checked for cell reference
          if (!gridCoords.cellReference) {
            const ariaLabel = element.getAttribute('aria-label') || 'null';
            const parentAriaLabel = element.parentElement?.getAttribute('aria-label') || 'null';
            const nameBoxValue = this.getGoogleSheetsNameBox() || 'null';
            const rowIdx = this.extractRowIndex(element, gridContainer);
            const colIdx = this.extractColumnIndex(element);
            
            console.warn('🔍 ContextScanner: Could not extract cell reference. Checked:', {
              tag: element.tagName,
              classes: element.className?.toString() || 'null',
              elementAriaLabel: ariaLabel,
              parentAriaLabel: parentAriaLabel,
              nameBoxValue: nameBoxValue,
              id: element.id || 'null',
              extractedRowIndex: rowIdx !== undefined ? String(rowIdx) : 'null',
              extractedColumnIndex: colIdx !== undefined ? String(colIdx) : 'null',
            });
          }
          return { gridCoordinates: gridCoords };
        }
      }
    }
    
    // Check for decision space first (list items/options)
    const decisionSpace = this.scanDecisionSpace(element);
    if (decisionSpace) {
      console.log('🔍 ContextScanner: Detected decisionSpace:', decisionSpace.type, 'with', decisionSpace.options.length, 'options');
      return { decisionSpace };
    }

    // Try spreadsheet/grid first (most specific)
    const gridCoords = this.scanSpreadsheetCell(element);
    if (gridCoords) {
      // Log actual string values, not objects
      const cellRefStr = gridCoords.cellReference || 'NOT FOUND';
      const rowIndexStr = gridCoords.rowIndex !== undefined ? String(gridCoords.rowIndex) : 'NOT FOUND';
      const columnIndexStr = gridCoords.columnIndex !== undefined ? String(gridCoords.columnIndex) : 'NOT FOUND';
      const columnHeaderStr = gridCoords.columnHeader || 'NOT FOUND';
      
      console.log('🔍 ContextScanner: Detected gridCoordinates:', {
        cellReference: cellRefStr,
        columnHeader: columnHeaderStr,
        rowIndex: rowIndexStr,
        columnIndex: columnIndexStr,
        hasContainer: true, // Indicates we found spreadsheet container
      });
      return { gridCoordinates: gridCoords };
    }

    // Try table
    const tableCoords = this.scanTableCell(element);
    if (tableCoords) {
      console.log('🔍 ContextScanner: Detected tableCoordinates:', {
        rowIndex: tableCoords.rowIndex,
        columnIndex: tableCoords.columnIndex,
      });
      return { tableCoordinates: tableCoords };
    }

    // Try form
    const formCoords = this.scanFormField(element);
    if (formCoords) {
      console.log('🔍 ContextScanner: Detected formCoordinates:', {
        label: formCoords.label,
        fieldOrder: formCoords.fieldOrder,
      });
      return { formCoordinates: formCoords };
    }

    // Try button-like interactive element (Interactive Section Anchoring)
    // This handles generic div buttons in Salesforce/React apps
    const buttonCtx = this.scanButtonLikeElement(element);
    if (buttonCtx) {
      console.log('🔍 ContextScanner: Detected buttonContext:', {
        section: buttonCtx.section || 'NOT FOUND',
        label: buttonCtx.label || 'NOT FOUND',
        role: buttonCtx.role || 'NOT FOUND',
      });
      return { buttonContext: buttonCtx };
    }

    // Log when no semantic context is found (for debugging)
    // Only warn for interactive elements, not layout containers
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'div') {
      const style = window.getComputedStyle(element);
      const htmlElement = element as HTMLElement;
      const isInteractive = style.cursor === 'pointer' || 
                           element.getAttribute('role') === 'button' ||
                           element.getAttribute('role') === 'link' ||
                           htmlElement.onclick !== null ||
                           element.getAttribute('tabindex') !== null;
      
      if (isInteractive) {
        console.log('🔍 ContextScanner: No semantic context detected for interactive', tagName, 'element');
      }
      // If it's not interactive, it's just a layout container - ignore silently
    } else if (tagName === 'input' || tagName === 'textarea') {
      console.log('🔍 ContextScanner: No semantic context detected for', tagName, 'element');
    }

    return {};
  }

  /**
   * Scan for decision space (list items, options, menu items)
   * This captures all available options in a container for AI decision-making
   */
  static scanDecisionSpace(element: Element): DecisionSpace | null {
    // Check if element is a list item or option
    if (!this.isListItemOrOption(element)) {
      return null;
    }

    // Find the parent container (dropdown menu, list, etc.)
    const container = this.findListContainer(element);
    if (!container) {
      console.log('🔍 ContextScanner: No container found for dropdown item');
      return null;
    }

    // Get all siblings (all options in the container)
    const options = this.getAllSiblingOptions(container);
    if (options.length === 0) {
      console.log('🔍 ContextScanner: No options found in container');
      return null;
    }

    // Find the selected index
    const selectedIndex = this.findSelectedIndex(container, element);

    // Get the selected text - CRITICAL: This is what the AI needs to describe
    const selectedText = this.extractOptionText(element) || '';
    
    if (!selectedText) {
      console.warn('🔍 ContextScanner: Could not extract selectedText from dropdown item');
      console.warn('🔍 ContextScanner: Element:', element.tagName, 'Classes:', element.className?.toString()?.substring(0, 50));
      console.warn('🔍 ContextScanner: textContent:', element.textContent?.trim()?.substring(0, 50));
      console.warn('🔍 ContextScanner: innerText:', (element as HTMLElement).innerText?.trim()?.substring(0, 50));
    } else {
      console.log('🔍 ContextScanner: Extracted selectedText:', selectedText);
    }

    // Generate container selector
    const containerSelector = this.generateContainerSelector(container);

    const decisionSpace = {
      type: 'LIST_SELECTION' as const,
      options,
      selectedIndex,
      selectedText,
      containerSelector,
    };
    
    console.log('🔍 ContextScanner: Created decisionSpace:', {
      selectedText: decisionSpace.selectedText,
      selectedIndex: decisionSpace.selectedIndex,
      optionsCount: decisionSpace.options.length,
    });

    return decisionSpace;
  }

  /**
   * Check if element is a list item or option
   */
  private static isListItemOrOption(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'listitem') {
      return true;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'li' || tagName === 'option') {
      return true;
    }

    // Check class names for common patterns
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('option') || 
        className.includes('menuitem') || 
        className.includes('list-item') ||
        className.includes('dropdown-item') ||
        className.includes('select-option')) {
      return true;
    }

    // Check if parent has list-related role
    const parent = element.parentElement;
    if (parent) {
      const parentRole = parent.getAttribute('role');
      if (parentRole === 'listbox' || 
          parentRole === 'menu' || 
          parentRole === 'list') {
        return true;
      }
    }

    return false;
  }

  /**
   * Find the parent container (dropdown, list, etc.)
   */
  private static findListContainer(element: Element): Element | null {
    let current: Element | null = element;
    const maxLevels = 10;
    let level = 0;

    while (current && level < maxLevels) {
      const role = current.getAttribute('role');
      const tagName = current.tagName.toLowerCase();
      const className = current.className?.toString().toLowerCase() || '';

      // Check for list containers
      if (role === 'listbox' || 
          role === 'menu' || 
          role === 'list' ||
          role === 'combobox') {
        return current;
      }

      // Check for common container tags
      if (tagName === 'ul' || 
          tagName === 'ol' ||
          tagName === 'select') {
        return current;
      }

      // Check for dropdown/menu class patterns
      if (className.includes('dropdown') ||
          className.includes('menu') ||
          className.includes('listbox') ||
          className.includes('select-menu') ||
          className.includes('options-list')) {
        return current;
      }

      current = current.parentElement;
      level++;
    }

    return null;
  }

  /**
   * Get all sibling options in the container
   */
  private static getAllSiblingOptions(container: Element): string[] {
    const options: string[] = [];

    // Find all list items/options in the container
    const items = container.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="listitem"], li, option'
    );

    // If no role-based items found, try to find by class patterns
    if (items.length === 0) {
      const allChildren = Array.from(container.children);
      for (const child of allChildren) {
        const text = this.extractOptionText(child);
        if (text) {
          options.push(text);
        }
      }
    } else {
      // Extract text from each item
      for (const item of Array.from(items)) {
        const text = this.extractOptionText(item);
        if (text) {
          options.push(text);
        }
      }
    }

    return options;
  }

  /**
   * Extract text from an option element
   */
  private static extractOptionText(element: Element): string | null {
    // PRIORITY 1: Try aria-label first (most reliable for dropdown items)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim().length > 0) {
      const trimmed = ariaLabel.trim();
      // Filter out very long aria-labels that might be concatenated text
      if (trimmed.length < 100) {
        return trimmed;
      }
    }

    // PRIORITY 2: Try innerText (only visible text, excludes hidden children)
    // This is better than textContent for dropdown items
    if (element instanceof HTMLElement) {
      const innerText = element.innerText?.trim();
      if (innerText && innerText.length > 0 && innerText.length < 100) {
        return innerText;
      }
    }

    // PRIORITY 3: Try direct text nodes (not from children)
    const directText: string[] = [];
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const trimmed = node.textContent.trim();
        if (trimmed.length > 0 && trimmed.length < 100) {
          directText.push(trimmed);
        }
      }
    }
    if (directText.length > 0) {
      return directText.join(' ').trim();
    }

    // PRIORITY 4: Try text content (includes hidden text, but might be too long)
    const textContent = element.textContent?.trim();
    if (textContent && textContent.length > 0) {
      // Limit to 100 chars to avoid concatenated text
      return textContent.length > 100 ? textContent.substring(0, 100) : textContent;
    }

    // PRIORITY 5: Try value attribute (for option elements)
    const value = element.getAttribute('value');
    if (value && value.trim().length > 0) {
      return value.trim();
    }

    // PRIORITY 6: Try data attributes that might contain the text
    const dataLabel = element.getAttribute('data-label') || element.getAttribute('data-text');
    if (dataLabel && dataLabel.trim().length > 0 && dataLabel.trim().length < 100) {
      return dataLabel.trim();
    }

    return null;
  }

  /**
   * Find the selected index (0-indexed) of the target element
   */
  private static findSelectedIndex(container: Element, targetElement: Element): number {
    // Find all list items/options in the container
    const items = container.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="listitem"], li, option'
    );

    // If no role-based items found, use direct children
    const itemsToCheck = items.length > 0 
      ? Array.from(items) 
      : Array.from(container.children);

    for (let i = 0; i < itemsToCheck.length; i++) {
      const item = itemsToCheck[i];
      
      // Check if this is the target element or contains it
      if (item === targetElement || item.contains(targetElement)) {
        return i;
      }
    }

    // Fallback: return -1 if not found
    return -1;
  }

  /**
   * Generate a selector for the container
   */
  private static generateContainerSelector(container: Element): string {
    // Try ID first
    if (container.id) {
      return `#${CSS.escape(container.id)}`;
    }

    // Try role attribute
    const role = container.getAttribute('role');
    if (role) {
      return `[role="${CSS.escape(role)}"]`;
    }

    // Try class names
    const className = container.className?.toString();
    if (className) {
      const classes = className.split(/\s+/).filter(c => c && !c.includes('css-') && !c.includes('sc-'));
      if (classes.length > 0) {
        return `${container.tagName.toLowerCase()}.${classes.map(c => CSS.escape(c)).join('.')}`;
      }
    }

    // Fallback to tag name
    return container.tagName.toLowerCase();
  }

  /**
   * Scan spreadsheet cell (Google Sheets, Excel Online, etc.)
   */
  static scanSpreadsheetCell(element: Element): GridCoordinates | null {
    // Check if element is in a spreadsheet context
    const spreadsheetContainer = this.findSpreadsheetContainer(element);
    if (!spreadsheetContainer) {
      // Debug: Log why container wasn't found (only for input-box elements to reduce noise)
      const className = element.className?.toString().toLowerCase() || '';
      if (className.includes('input-box') || className.includes('cell')) {
        console.log('🔍 ContextScanner: No spreadsheet container found for', element.tagName, 'with classes:', className);
      }
      return null;
    }

    // Try to extract cell reference from element attributes
    const cellRef = this.extractCellReference(element);
    
    // Try to extract row/column indices
    const rowIndex = this.extractRowIndex(element, spreadsheetContainer);
    const columnIndex = this.extractColumnIndex(element);
    
    // Try to find column header (always attempt, even if coordinates are missing)
    // The findColumnHeader method will try multiple strategies in priority order:
    // 1. Cell reference method (most accurate: B5 → B1)
    // 2. Column index method
    // 3. Aria-label method
    // 4. Frozen header detection
    const columnHeader = this.findColumnHeader(element, spreadsheetContainer, columnIndex);
    
    // Log detection result
    if (columnHeader) {
      console.log(`🔍 ContextScanner: Column header detected: "${columnHeader}" for cell ${cellRef || 'unknown'}`);
    } else {
      console.log(`🔍 ContextScanner: No column header detected for cell ${cellRef || 'unknown'}`);
    }
    
    // Try to find row header
    const rowHeader = this.findRowHeader(spreadsheetContainer, rowIndex);
    
    // Check if this is a header cell
    const isHeader = this.isHeaderCell(element);

    // Only return if we found at least some coordinates
    // For Google Sheets, even if we don't have exact coordinates, if we found the container,
    // we should still return gridCoordinates (the AI can use the container context)
    if (cellRef || (rowIndex !== undefined && columnIndex !== undefined) || columnHeader || spreadsheetContainer) {
      const coords: GridCoordinates = {
        rowIndex,
        columnIndex,
        cellReference: cellRef || undefined,
        columnHeader: columnHeader || undefined,
        rowHeader: rowHeader || undefined,
        isHeader: isHeader || undefined,
      };
      
      // If we have at least the container, return coordinates (even if sparse)
      // This helps Phase 1 prioritize grid context over form context
      return coords;
    }

    return null;
  }

  /**
   * Find spreadsheet container (Google Sheets, Excel, etc.)
   */
  private static findSpreadsheetContainer(element: Element): Element | null {
    // First, try closest() for Google Sheets structure (most reliable)
    // Google Sheets uses: grid-container > grid-table-container > grid-scrollable-wrapper
    const gridContainer = element.closest('.grid-container, .grid-table-container, .grid-scrollable-wrapper');
    if (gridContainer) {
      return gridContainer;
    }

    // Fallback: traverse up the DOM tree
    let current: Element | null = element;
    const maxLevels = 20;
    let level = 0;

    while (current && level < maxLevels) {
      const tagName = current.tagName.toLowerCase();
      const className = current.className?.toString().toLowerCase() || '';
      const id = current.id?.toLowerCase() || '';

      // Google Sheets indicators (improved detection)
      if (className.includes('waffle') || 
          className.includes('grid-container') ||
          className.includes('grid-table-container') ||
          className.includes('grid-scrollable-wrapper') ||
          className.includes('grid4-inner-container') ||
          className.includes('grid') || 
          className.includes('spreadsheet') ||
          id.includes('spreadsheet') ||
          id.includes('grid')) {
        return current;
      }

      // Excel Online indicators
      if (className.includes('excel') || 
          className.includes('office-grid')) {
        return current;
      }

      // Generic table/grid indicators
      if (tagName === 'table' && className.includes('grid')) {
        return current;
      }

      current = current.parentElement;
      level++;
    }

    return null;
  }

  /**
   * Normalize cell reference from verbose aria-labels
   * Google Sheets uses patterns like "Cell A1", "Row 1, Column A", "A1 value is 100"
   * This extracts just the "A1" part
   */
  private static normalizeCellRef(rawText: string): string | null {
    // Regex to find "A1", "Z99", "AA1" patterns (1-3 letters, 1-5 digits)
    // We explicitly look for the pattern surrounded by word boundaries
    const match = rawText.match(/\b([A-Z]{1,3}\d{1,5})\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Get cell reference from Google Sheets Name Box (formula bar input)
   * This is the most reliable source for the active cell reference
   * Tries multiple selectors as Google Sheets may use different IDs/classes
   */
  private static getGoogleSheetsNameBox(): string | null {
    // Try multiple selectors (Google Sheets may use different IDs/classes)
    const selectors = [
      '#t-name-box-input',
      '#t-name-box',
      '.name-box-input',
      '.name-box',
      '[id*="name-box"]',
      '[class*="name-box"]',
      '[aria-label*="Name box"]',
      'input[placeholder*="A1"]', // Formula bar input
      '[role="textbox"][aria-label*="cell"]', // Alternative aria-label pattern
    ];
    
    for (const selector of selectors) {
      try {
        const nameBox = document.querySelector(selector) as HTMLInputElement | HTMLDivElement | null;
        if (nameBox) {
          // Try multiple properties (value, textContent, innerText, aria-label)
          const value = (nameBox as HTMLInputElement).value || 
                       nameBox.textContent || 
                       nameBox.innerText ||
                       nameBox.getAttribute('aria-label') ||
                       nameBox.getAttribute('title');
          
          if (value) {
            const normalized = this.normalizeCellRef(value);
            if (normalized) {
              console.log('🔍 ContextScanner: Found Name Box with selector:', selector, 'value:', normalized);
              return normalized;
            }
          }
        }
      } catch (e) {
        // Invalid selector, continue to next
        continue;
      }
    }
    
    // Debug: Log what we tried (only in verbose mode or when debugging)
    // console.warn('🔍 ContextScanner: Name Box not found. Tried selectors:', selectors);
    return null;
  }

  /**
   * Extract cell reference (A1, B2, etc.) from element
   * For Google Sheets, checks multiple sources including siblings and nearby elements
   * Strategy 0: Name Box is the most reliable for active cells
   */
  private static extractCellReference(element: Element): string | null {
    // Strategy 0: Check Google Sheets Name Box first (most reliable for active cell)
    // This works because clicking a cell makes it active, so Name Box updates
    const nameBoxRef = this.getGoogleSheetsNameBox();
    console.log(`[ContextScanner] Name Box check for extractCellReference:`, { nameBoxRef, elementTag: element.tagName, elementClass: element.className?.toString().substring(0, 50), ariaLabel: element.getAttribute('aria-label')?.substring(0, 50) });
    if (nameBoxRef) {
      console.log('🔍 ContextScanner: Using Name Box as cell reference source:', nameBoxRef);
      return nameBoxRef;
    }

    // Strategy 1: Check element's own aria-label (normalize verbose labels)
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      const normalized = this.normalizeCellRef(ariaLabel);
      if (normalized) {
        return normalized;
      }
    }

    // Strategy 2: Check parent element's aria-label (for cell-input inside input-box)
    let current: Element | null = element.parentElement;
    let level = 0;
    while (current && level < 3) {
      const parentAriaLabel = current.getAttribute('aria-label');
      if (parentAriaLabel) {
        const normalized = this.normalizeCellRef(parentAriaLabel);
        if (normalized) {
          return normalized;
        }
      }
      current = current.parentElement;
      level++;
    }

    // Strategy 3: Check siblings (Google Sheets often has cell reference on sibling elements)
    const parent = element.parentElement;
    if (parent) {
      // Check previous sibling
      let sibling: Element | null = parent.previousElementSibling;
      let checked = 0;
      while (sibling && checked < 3) {
        const siblingAria = sibling.getAttribute('aria-label');
        if (siblingAria) {
          const normalized = this.normalizeCellRef(siblingAria);
          if (normalized) {
            return normalized;
          }
        }
        sibling = sibling.previousElementSibling;
        checked++;
      }
    }

    // Strategy 4: Check data attributes on element
    const dataCell = element.getAttribute('data-cell') || 
                     element.getAttribute('data-cellref') ||
                     element.getAttribute('data-address');
    if (dataCell) {
      return dataCell.toUpperCase();
    }

    // Strategy 5: Check data attributes on parents
    current = element.parentElement;
    level = 0;
    while (current && level < 3) {
      const parentDataCell = current.getAttribute('data-cell') || 
                             current.getAttribute('data-cellref') ||
                             current.getAttribute('data-address');
      if (parentDataCell) {
        return parentDataCell.toUpperCase();
      }
      current = current.parentElement;
      level++;
    }

    // Strategy 6: Check id for cell reference pattern
    const id = element.id;
    if (id) {
      const cellRefMatch = id.match(/\b([A-Z]+)(\d+)\b/i);
      if (cellRefMatch) {
        return cellRefMatch[0].toUpperCase();
      }
    }

    // Strategy 7: Check parent's id
    current = element.parentElement;
    level = 0;
    while (current && level < 3) {
      if (current.id) {
        const cellRefMatch = current.id.match(/\b([A-Z]+)(\d+)\b/i);
        if (cellRefMatch) {
          return cellRefMatch[0].toUpperCase();
        }
      }
      current = current.parentElement;
      level++;
    }

    // Strategy 8: For Google Sheets, check for cell-input child's aria-label
    if (element.className?.toString().includes('input-box')) {
      const cellInput = element.querySelector('.cell-input, [class*="cell-input"]');
      if (cellInput) {
        const cellInputAria = cellInput.getAttribute('aria-label');
        if (cellInputAria) {
          const normalized = this.normalizeCellRef(cellInputAria);
          if (normalized) {
            return normalized;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract row number from cell reference (e.g., "A2" -> 2)
   */
  private static extractRowFromCellRef(cellRef: string): number | undefined {
    const rowMatch = cellRef.match(/\d+/);
    if (rowMatch) {
      return parseInt(rowMatch[0], 10);
    }
    return undefined;
  }

  /**
   * Extract column index from cell reference (e.g., "A2" -> 1, "B2" -> 2)
   */
  private static extractColumnFromCellRef(cellRef: string): number | undefined {
    const colMatch = cellRef.match(/^([A-Z]+)/);
    if (colMatch) {
      const colLetters = colMatch[1];
      let colIndex = 0;
      for (let i = 0; i < colLetters.length; i++) {
        colIndex = colIndex * 26 + (colLetters.charCodeAt(i) - 64);
      }
      return colIndex;
    }
    return undefined;
  }

  /**
   * Convert column index to column letter (e.g., 1 -> "A", 2 -> "B", 27 -> "AA")
   */
  private static columnIndexToLetter(colIndex: number): string {
    let result = '';
    let num = colIndex;
    while (num > 0) {
      num--; // Make it 0-based
      result = String.fromCharCode(65 + (num % 26)) + result;
      num = Math.floor(num / 26);
    }
    return result;
  }

  /**
   * Calculate cell reference from row and column indices (e.g., row 7, col 1 -> "A7")
   */
  private static calculateCellReference(rowIndex: number, columnIndex: number): string {
    const colLetter = this.columnIndexToLetter(columnIndex);
    return `${colLetter}${rowIndex}`;
  }

  /**
   * Extract row index from element
   */
  private static extractRowIndex(element: Element, container: Element): number | undefined {
    // Check data attributes
    const dataRow = element.getAttribute('data-row') || 
                    element.getAttribute('data-rowindex');
    if (dataRow) {
      const rowNum = parseInt(dataRow, 10);
      if (!isNaN(rowNum)) {
        return rowNum;
      }
    }

    // Try to count rows from container
    const allRows = container.querySelectorAll('[data-row], [role="row"], tr');
    for (let i = 0; i < allRows.length; i++) {
      if (allRows[i].contains(element) || allRows[i] === element) {
        return i + 1; // 1-indexed
      }
    }

    // Try to extract from cell reference
    const cellRef = this.extractCellReference(element);
    if (cellRef) {
      const rowMatch = cellRef.match(/\d+/);
      if (rowMatch) {
        return parseInt(rowMatch[0], 10);
      }
    }

    return undefined;
  }

  /**
   * Extract column index from element
   */
  private static extractColumnIndex(element: Element): number | undefined {
    // Check data attributes
    const dataCol = element.getAttribute('data-col') || 
                    element.getAttribute('data-column') ||
                    element.getAttribute('data-columnindex');
    if (dataCol) {
      const colNum = parseInt(dataCol, 10);
      if (!isNaN(colNum)) {
        return colNum;
      }
    }

    // Try to extract from cell reference
    const cellRef = this.extractCellReference(element);
    if (cellRef) {
      const colMatch = cellRef.match(/[A-Z]+/i);
      if (colMatch) {
        // Convert column letter to index (A=1, B=2, etc.)
        let colIndex = 0;
        const colLetters = colMatch[0].toUpperCase();
        for (let i = 0; i < colLetters.length; i++) {
          colIndex = colIndex * 26 + (colLetters.charCodeAt(i) - 64);
        }
        return colIndex;
      }
    }

    // Try to count columns from parent row
    const parentRow = element.closest('[role="row"], tr, [data-row]');
    if (parentRow) {
      const cells = parentRow.querySelectorAll('[role="cell"], td, [data-col]');
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === element || cells[i].contains(element)) {
          return i; // 0-indexed
        }
      }
    }

    return undefined;
  }

  /**
   * Find column header for a cell using multiple strategies (in priority order)
   * 1. Cell Reference Method (Highest Accuracy): B5 → B1 header lookup
   * 2. Column Index Method: Match columnIndex to header row cell
   * 3. Aria-Label Method: Parse verbose aria-labels for header text
   * 4. Frozen Header Detection: Find frozen header rows
   */
  private static findColumnHeader(element: Element, container: Element, columnIndex?: number): string | null {
    
    // Strategy 1: Cell Reference Method (Highest Accuracy)
    // If cell reference is "B5", look for header in "B1" (row 1, same column)
    const cellRef = this.extractCellReference(element);
    
    
    if (cellRef) {
      const headerFromRef = this.findHeaderByCellReference(cellRef, container);
      
      
      if (headerFromRef) {
        console.log(`🔍 ContextScanner: Found column header using cell reference method: "${headerFromRef}" from ${cellRef}`);
        return headerFromRef;
      }
    }

    // Strategy 2: Column Index Method
    // Use columnIndex to find header cell at same position in header row
    if (columnIndex !== undefined) {
      
      const headerRow = this.findSpreadsheetHeaderRow(container);
      if (headerRow) {
        const headerCells = headerRow.element.querySelectorAll('[role="columnheader"], th, [role="cell"]');
        
        
        if (headerCells[columnIndex]) {
          const headerText = headerCells[columnIndex].textContent?.trim();
          
          
          if (headerText) {
            console.log(`🔍 ContextScanner: Found column header using column index method: "${headerText}" at index ${columnIndex}`);
            return headerText;
          }
        }
      }
    }

    // Strategy 3: Aria-Label Method (Google Sheets)
    // Check element aria-label for column context
    // Example: "Cell B5, Column B, Price" → extract "Price"
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      // Try to extract header from verbose aria-labels
      // Pattern: "Cell B5, Column B, Price" or "Column B: Price"
      const headerMatch = ariaLabel.match(/(?:column\s+[a-z]+,?\s*|,\s*)([^,]+?)(?:\s*\(|$)/i);
      if (headerMatch && headerMatch[1]) {
        const extracted = headerMatch[1].trim();
        // Filter out common non-header text
        if (extracted && 
            !extracted.toLowerCase().includes('cell') &&
            !extracted.toLowerCase().includes('row') &&
            !extracted.toLowerCase().includes('column') &&
            extracted.length < 50) {
          console.log(`🔍 ContextScanner: Found column header using aria-label method: "${extracted}"`);
          return extracted;
        }
      }
      
      // Check parent elements for column information
      let current: Element | null = element.parentElement;
      let level = 0;
      while (current && level < 3) {
        const parentAria = current.getAttribute('aria-label');
        if (parentAria) {
          const parentHeaderMatch = parentAria.match(/(?:column\s+[a-z]+,?\s*|,\s*)([^,]+?)(?:\s*\(|$)/i);
          if (parentHeaderMatch && parentHeaderMatch[1]) {
            const extracted = parentHeaderMatch[1].trim();
            if (extracted && 
                !extracted.toLowerCase().includes('cell') &&
                !extracted.toLowerCase().includes('row') &&
                !extracted.toLowerCase().includes('column') &&
                extracted.length < 50) {
              console.log(`🔍 ContextScanner: Found column header using parent aria-label method: "${extracted}"`);
              return extracted;
            }
          }
        }
        current = current.parentElement;
        level++;
      }
    }

    // Strategy 4: Frozen Header Detection
    // Detect frozen header rows (always visible)
    const frozenHeader = this.findFrozenHeaderRow(container);
    if (frozenHeader && columnIndex !== undefined) {
      const headerCells = frozenHeader.element.querySelectorAll('[role="columnheader"], th, [role="cell"]');
      if (headerCells[columnIndex]) {
        const headerText = headerCells[columnIndex].textContent?.trim();
        if (headerText) {
          console.log(`🔍 ContextScanner: Found column header using frozen header method: "${headerText}"`);
          return headerText;
        }
      }
    }

    // Fallback: Try standard header row lookup (original method)
    const headerRow = container.querySelector('[role="rowheader"], thead tr, [data-row="0"], [data-row="1"]');
    if (headerRow && columnIndex !== undefined) {
      const headerCells = headerRow.querySelectorAll('[role="columnheader"], th, [role="cell"]');
      if (headerCells[columnIndex]) {
        const headerText = headerCells[columnIndex].textContent?.trim();
        if (headerText) {
          console.log(`🔍 ContextScanner: Found column header using fallback method: "${headerText}"`);
          return headerText;
        }
      }
    }

    console.log('🔍 ContextScanner: No column header found using any method');
    return null;
  }

  /**
   * Find header by cell reference (e.g., "B5" → find header in "B1")
   * This is the most accurate method for Google Sheets
   */
  private static findHeaderByCellReference(cellRef: string, container: Element): string | null {
    try {
      // Extract column letter from cell reference (e.g., "B5" → "B")
      const colMatch = cellRef.match(/^([A-Z]+)/i);
      if (!colMatch) {
        return null;
      }
      
      const columnLetter = colMatch[1].toUpperCase();
      const headerCellRef = `${columnLetter}1`;
      
      
      // Try multiple strategies to find the header cell
      // Strategy 1: Look for element with aria-label containing the header cell reference
      // Also try to find cells with data-row="1" or data-row="0" for header row
      const allCells = container.querySelectorAll('[aria-label*="' + headerCellRef + '"], [aria-label*="' + columnLetter + '1"], [data-row="1"][data-col], [data-row="0"][data-col]');
      
      for (const cell of Array.from(allCells)) {
        const ariaLabel = cell.getAttribute('aria-label') || '';
        // Check if this is row 1 (header row)
        if (ariaLabel.includes(headerCellRef) || ariaLabel.includes(`${columnLetter}1`)) {
          // Try to extract header text from aria-label
          // Pattern: "Cell B1, Column B, Price" or "B1: Price"
          const headerMatch = ariaLabel.match(/(?:column\s+[a-z]+,?\s*|,\s*|:\s*)([^,()]+?)(?:\s*\(|$)/i);
          if (headerMatch && headerMatch[1]) {
            const extracted = headerMatch[1].trim();
            if (extracted && extracted.length < 50) {
              return extracted;
            }
          }
          // Fallback: use cell text content
          const cellText = cell.textContent?.trim();
          if (cellText && cellText.length > 0 && cellText.length < 50) {
            return cellText;
          }
        }
      }
      
      
      // Strategy 2: Find header row and get cell at same column index
      const headerRow = this.findSpreadsheetHeaderRow(container);
      
      
      if (headerRow) {
        // Convert column letter to index (A=1, B=2, etc.)
        let colIndex = 0;
        for (let i = 0; i < columnLetter.length; i++) {
          colIndex = colIndex * 26 + (columnLetter.charCodeAt(i) - 64);
        }
        // Convert to 0-indexed
        colIndex = colIndex - 1;
        
        
        const headerCells = headerRow.element.querySelectorAll('[role="columnheader"], th, [role="cell"]');
        
        
        if (headerCells[colIndex]) {
          const headerText = headerCells[colIndex].textContent?.trim();
          if (headerText) {
            return headerText;
          }
        }
      }
      
      
      return null;
    } catch (err) {
      console.warn('🔍 ContextScanner: Error finding header by cell reference:', err);
      return null;
    }
  }

  /**
   * Find spreadsheet header row
   * Detects header row position (often row 0 or 1)
   * Handles frozen headers that stay visible when scrolling
   */
  private static findSpreadsheetHeaderRow(container: Element): { element: Element; rowIndex: number } | null {
    try {
      // Strategy 1: Look for standard header row selectors
      const headerRow = container.querySelector('[role="rowheader"], thead tr, [data-row="0"], [data-row="1"]');
      
      
      if (headerRow) {
        const rowIndex = parseInt(headerRow.getAttribute('data-row') || '1', 10);
        return { element: headerRow, rowIndex };
      }
      
      // Strategy 2: Look for frozen header (often has specific classes)
      const frozenHeader = container.querySelector('[class*="frozen"], [class*="header-row"], [class*="row-header"]');
      
      
      if (frozenHeader) {
        const rowIndex = parseInt(frozenHeader.getAttribute('data-row') || '1', 10);
        return { element: frozenHeader, rowIndex };
      }
      
      // Strategy 3: Find first row and check if it looks like a header
      // (has header cells or is at top of container)
      const firstRow = container.querySelector('[role="row"], tr, [data-row]');
      
      
      if (firstRow) {
        const rect = firstRow.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const hasHeaderCells = firstRow.querySelectorAll('[role="columnheader"], th').length > 0;
        
        
        // If first row is near top of container, it's likely a header
        if (rect.top <= containerRect.top + 50) {
          if (hasHeaderCells) {
            const rowIndex = parseInt(firstRow.getAttribute('data-row') || '1', 10);
            return { element: firstRow, rowIndex };
          }
        }
      }
      
      
      return null;
    } catch (err) {
      console.warn('🔍 ContextScanner: Error finding spreadsheet header row:', err);
      return null;
    }
  }

  /**
   * Find frozen header row (always visible when scrolling)
   */
  private static findFrozenHeaderRow(container: Element): { element: Element; rowIndex: number } | null {
    try {
      // Look for frozen header indicators
      const frozenHeader = container.querySelector('[class*="frozen"], [class*="sticky"], [class*="fixed"]');
      if (frozenHeader) {
        const rect = frozenHeader.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // Check if it's at the top (frozen headers stay at top)
        if (rect.top <= containerRect.top + 10) {
          const hasHeaderCells = frozenHeader.querySelectorAll('[role="columnheader"], th').length > 0;
          if (hasHeaderCells) {
            const rowIndex = parseInt(frozenHeader.getAttribute('data-row') || '1', 10);
            return { element: frozenHeader, rowIndex };
          }
        }
      }
      
      return null;
    } catch (err) {
      console.warn('🔍 ContextScanner: Error finding frozen header row:', err);
      return null;
    }
  }

  /**
   * Find row header for a cell
   */
  private static findRowHeader(container: Element, rowIndex?: number): string | null {
    // Look for header column
    const headerCol = container.querySelector('[role="columnheader"]');
    if (headerCol && rowIndex !== undefined) {
      const headerCells = container.querySelectorAll('[role="rowheader"], [data-col="0"], [data-col="1"]');
      for (const cell of Array.from(headerCells)) {
        const cellRowIndex = this.extractRowIndex(cell, container);
        if (cellRowIndex === rowIndex) {
          const headerText = cell.textContent?.trim();
          if (headerText) {
            return headerText;
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if element is a header cell
   */
  private static isHeaderCell(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'columnheader' || role === 'rowheader') {
      return true;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'th') {
      return true;
    }

    // Check if in header row/column
    const parentRow = element.closest('[role="row"], tr');
    if (parentRow) {
      const rowRole = parentRow.getAttribute('role');
      if (rowRole === 'rowheader') {
        return true;
      }
    }

    return false;
  }

  /**
   * Scan form field
   */
  static scanFormField(element: Element): FormCoordinates | null {
    // Skip if this looks like a Google Sheets cell (input-box is used for spreadsheet cells)
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('input-box') && element.closest('.grid-container, .grid-table-container')) {
      // This is likely a Google Sheets cell, not a form field
      return null;
    }
    
    // Check if element is in a form
    const form = element.closest('form');
    if (!form && !this.isFormField(element)) {
      return null;
    }

    // Find label
    const label = this.findFormLabel(element);
    
    // Find field order
    const fieldOrder = this.findFieldOrder(element, form);
    
    // Find fieldset
    const fieldset = element.closest('fieldset');
    const fieldsetName = fieldset?.querySelector('legend')?.textContent?.trim() || undefined;
    
    // Find section
    const section = element.closest('[role="group"], section, [class*="section"], [class*="group"]');
    const sectionName = section?.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent?.trim() || undefined;

    if (label || fieldOrder !== undefined || fieldsetName || sectionName) {
      return {
        label: label || undefined,
        fieldOrder: fieldOrder !== undefined ? fieldOrder : undefined,
        fieldset: fieldsetName,
        section: sectionName,
      };
    }

    return null;
  }

  /**
   * Check if element is a form field
   */
  private static isFormField(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'input' || 
           tagName === 'textarea' || 
           tagName === 'select' ||
           element.getAttribute('role') === 'textbox' ||
           element.getAttribute('role') === 'combobox';
  }

  /**
   * Find label for form field
   */
  private static findFormLabel(element: Element): string | null {
    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      // Check if this looks like a cell reference (A1, B2, etc.) - skip if so (it's a spreadsheet cell, not a form label)
      if (/^[A-Z]+\d+$/.test(ariaLabel.trim())) {
        return null; // This is a cell reference, not a form label
      }
      return ariaLabel;
    }

    // Check aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelElement = document.getElementById(labelledBy);
      if (labelElement) {
        const labelText = labelElement.textContent?.trim() || null;
        // Check if this looks like a cell reference
        if (labelText && /^[A-Z]+\d+$/.test(labelText)) {
          return null; // This is a cell reference, not a form label
        }
        return labelText;
      }
    }

    // Check for associated label element
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        const labelText = label.textContent?.trim() || null;
        // Check if this looks like a cell reference
        if (labelText && /^[A-Z]+\d+$/.test(labelText)) {
          return null; // This is a cell reference, not a form label
        }
        return labelText;
      }
    }

    // Check parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent?.trim() || null;
      // Check if this looks like a cell reference
      if (labelText && /^[A-Z]+\d+$/.test(labelText)) {
        return null; // This is a cell reference, not a form label
      }
      return labelText;
    }

    // Check placeholder
    const placeholder = (element as HTMLInputElement).placeholder;
    if (placeholder) {
      return placeholder;
    }

    return null;
  }

  /**
   * Find field order in form
   */
  private static findFieldOrder(element: Element, form: Element | null): number | undefined {
    if (!form) {
      return undefined;
    }

    const formFields = form.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"]');
    for (let i = 0; i < formFields.length; i++) {
      if (formFields[i] === element) {
        return i + 1; // 1-indexed
      }
    }

    return undefined;
  }

  /**
   * Scan table cell
   */
  static scanTableCell(element: Element): TableCoordinates | null {
    // Check if element is in a table
    const table = element.closest('table, [role="table"], [role="grid"]');
    if (!table) {
      return null;
    }

    // Find row
    const row = element.closest('tr, [role="row"]');
    if (!row) {
      return null;
    }

    // Find row index
    const rows = table.querySelectorAll('tr, [role="row"]');
    let rowIndex: number | undefined;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] === row) {
        rowIndex = i; // 0-indexed
        break;
      }
    }

    // Find column index
    const cells = row.querySelectorAll('td, th, [role="cell"], [role="columnheader"], [role="rowheader"]');
    let columnIndex: number | undefined;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === element || cells[i].contains(element)) {
        columnIndex = i; // 0-indexed
        break;
      }
    }

    // Find header row (usually first row)
    let headerRow: number | undefined;
    const firstRow = rows[0];
    if (firstRow) {
      const hasHeaderCells = firstRow.querySelectorAll('th, [role="columnheader"]').length > 0;
      if (hasHeaderCells) {
        headerRow = 0;
      }
    }

    // Find header column (usually first column)
    let headerColumn: number | undefined;
    if (rows.length > 0) {
      const firstCell = rows[0].querySelector('td, th, [role="cell"]');
      if (firstCell) {
        const firstCellRole = firstCell.getAttribute('role');
        if (firstCellRole === 'rowheader' || firstCell.tagName.toLowerCase() === 'th') {
          headerColumn = 0;
        }
      }
    }

    if (rowIndex !== undefined || columnIndex !== undefined) {
      return {
        rowIndex,
        columnIndex,
        headerRow,
        headerColumn,
      };
    }

    return null;
  }

  /**
   * Scan for button-like interactive elements (divs with cursor: pointer, role="button", etc.)
   * Uses "Interactive Section Anchoring" strategy to find section context
   * This handles generic div buttons in Salesforce/React apps
   */
  static scanButtonLikeElement(element: Element): ButtonContext | null {
    const tagName = element.tagName.toLowerCase();
    
    // Only check div, span, and other non-button elements
    // (actual buttons are handled by form detection or other methods)
    if (tagName !== 'div' && tagName !== 'span' && tagName !== 'a') {
      return null;
    }

    // Check if element is interactive (button-like)
    const style = window.getComputedStyle(element);
    const htmlElement = element as HTMLElement;
    const isInteractive = 
      style.cursor === 'pointer' || 
      element.getAttribute('role') === 'button' ||
      element.getAttribute('role') === 'link' ||
      htmlElement.onclick !== null ||
      element.getAttribute('tabindex') !== null ||
      element.getAttribute('aria-label')?.toLowerCase().includes('button') ||
      element.getAttribute('aria-label')?.toLowerCase().includes('click');

    if (!isInteractive) {
      return null; // Not interactive, skip
    }

    // Extract label/aria-label
    const label = element.getAttribute('aria-label') || 
                  element.textContent?.trim() || 
                  (element as HTMLElement).innerText?.trim() ||
                  undefined;

    // Find section header (Interactive Section Anchoring)
    const section = this.findSectionHeader(element);

    // Get role if present
    const role = element.getAttribute('role') || undefined;

    // Enhanced debug logging for interactive divs
    if (tagName === 'div') {
      if (!section && !label) {
        console.log('🔍 ContextScanner: scanButtonLikeElement - Interactive div found but no label or section:', {
          cursor: style.cursor,
          role: element.getAttribute('role'),
          hasOnclick: htmlElement.onclick !== null,
          tabindex: element.getAttribute('tabindex'),
          ariaLabel: element.getAttribute('aria-label'),
          textContent: element.textContent?.trim()?.substring(0, 50),
          className: element.className?.toString()?.substring(0, 100),
        });
      } else {
        // Log when we DO find context (for verification)
        console.log('🔍 ContextScanner: scanButtonLikeElement - Found buttonContext:', {
          section: section || 'NOT FOUND',
          label: label || 'NOT FOUND',
          role: role || 'NOT FOUND',
        });
      }
    }

    // Only return context if we found at least a label or section
    if (label || section) {
      return {
        section: section || undefined,
        label: label || undefined,
        role: role,
      };
    }

    return null;
  }

  /**
   * Find section header for an element (Interactive Section Anchoring)
   * Uses a comprehensive strategy similar to selector-engine's extractHeaderText
   * This provides semantic context for button-like divs in Salesforce/React apps
   */
  private static findSectionHeader(element: Element): string | null {
    // Strategy 1: Try to find anchor container first (like selector-engine does)
    // This handles gridster-item, card, widget, panel containers
    const anchorContainer = this.findAnchorContainer(element);
    if (anchorContainer) {
      const headerText = this.extractHeaderTextFromContainer(anchorContainer, element);
      if (headerText) {
        return headerText;
      }
    }

    // Strategy 2: Walk up the tree (max 5 levels to avoid going too far)
    let current: Element | null = element.parentElement;
    let levels = 0;
    const maxLevels = 5;

    while (current && levels < maxLevels) {
      // Look for a Header in this container
      // Try multiple selectors for common header patterns
      const headerSelectors = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        '.title', '.header', '.section-title', '.card-title',
        '.gs-widget-title', '.widget-title', '.header-title',
        '[role="heading"]',
        '[class*="title"]', '[class*="header"]', '[class*="heading"]',
      ];

      for (const selector of headerSelectors) {
        try {
          const header = current.querySelector(selector);
          if (header && header.textContent) {
            const headerText = header.textContent.trim();
            // Filter out very short or generic headers
            if (headerText.length > 2 && !/^(div|span|button)$/i.test(headerText)) {
              return headerText;
            }
          }
        } catch (e) {
          // Invalid selector, continue
          continue;
        }
      }

      // Also check if the current element itself is a header
      const currentTag = current.tagName.toLowerCase();
      if ((currentTag.startsWith('h') && /^h[1-6]$/.test(currentTag)) ||
          current.getAttribute('role') === 'heading') {
        const headerText = current.textContent?.trim();
        if (headerText && headerText.length > 2) {
          return headerText;
        }
      }

      // Enhanced: Check for section/article elements with prominent text
      // This handles Salesforce/React apps where sections don't have explicit headers
      if (currentTag === 'section' || currentTag === 'article' || 
          current.getAttribute('role') === 'region' ||
          current.className?.toString().toLowerCase().includes('section') ||
          current.className?.toString().toLowerCase().includes('card')) {
        // Look for the first significant text node or element in the section
        // This is often the section title/header even if not in an h1-h6 tag
        const firstChild = current.firstElementChild;
        if (firstChild) {
          const firstChildText = firstChild.textContent?.trim();
          // If first child has substantial text (likely a header), use it
          if (firstChildText && firstChildText.length > 2 && firstChildText.length < 100) {
            // Check if it's not just the button we're looking for
            if (!firstChild.contains(element) && firstChild !== element) {
              return firstChildText;
            }
          }
        }
        
        // Also check for aria-label or title on the section itself
        const sectionLabel = current.getAttribute('aria-label') || 
                            current.getAttribute('title') ||
                            (current as HTMLElement).title;
        if (sectionLabel && sectionLabel.trim().length > 2) {
          return sectionLabel.trim();
        }
      }

      current = current.parentElement;
      levels++;
    }

    return null;
  }

  /**
   * Find anchor container (similar to selector-engine's findAnchorContainer)
   * Looks for containers like gridster-item, card, widget, panel
   */
  private static findAnchorContainer(element: Element): Element | null {
    const containerClasses = ['gridster-item', 'card', 'widget', 'panel'];
    
    // Helper function to check if an element is a container
    const isContainer = (el: Element): boolean => {
      const tagName = el.tagName.toLowerCase();
      if (tagName === 'gridster-item' || tagName.includes('widget') || tagName.includes('card') || tagName.includes('panel')) {
        return true;
      }

      if (el.classList && el.classList.length > 0) {
        for (const containerClass of containerClasses) {
          if (el.classList.contains(containerClass)) {
            return true;
          }
        }
      }

      const className = el.className;
      if (className) {
        const classNameStr = typeof className === 'string' ? className : (className as any)?.toString() || '';
        if (classNameStr) {
          const classNames = classNameStr.split(/\s+/);
          for (const containerClass of containerClasses) {
            if (classNames.includes(containerClass)) {
              return true;
            }
          }
        }
      }

      return false;
    };

    // Walk up the tree to find container
    let current: Element | null = element;
    let levels = 0;
    const maxLevels = 10;

    while (current && levels < maxLevels) {
      if (isContainer(current)) {
        return current;
      }
      current = current.parentElement;
      levels++;
    }

    return null;
  }

  /**
   * Extract header text from container (similar to selector-engine's extractHeaderText)
   * Uses comprehensive strategy to find header text
   */
  private static extractHeaderTextFromContainer(container: Element, targetElement: Element): string | null {
    // Strategy 1: Standard header tags (h1-h6)
    for (let i = 1; i <= 6; i++) {
      const header = container.querySelector(`h${i}`);
      if (header) {
        const text = header.textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          return text;
        }
      }
    }

    // Strategy 2: Common title class selectors
    const titleSelectors = [
      '.title',
      '.card-title',
      '.gs-widget-title',
      '.widget-title',
      '.header-title',
      '[class*="title"]',
      '[class*="header"]',
      '.gs-title',
      '.report-title',
    ];
    
    for (const selector of titleSelectors) {
      try {
        const titleEl = container.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent?.trim();
          if (text && text.length > 0 && text.length < 200) {
            return text;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Strategy 3: Look for elements with role="heading"
    const headingEl = container.querySelector('[role="heading"]');
    if (headingEl) {
      const text = headingEl.textContent?.trim();
      if (text && text.length > 0 && text.length < 200) {
        return text;
      }
    }

    // Strategy 4: Check aria-label on container
    const ariaLabel = container.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim().length > 0 && ariaLabel.trim().length < 200) {
      return ariaLabel.trim();
    }

    // Strategy 5: Check title attribute
    const titleAttr = container.getAttribute('title');
    if (titleAttr && titleAttr.trim().length > 0 && titleAttr.trim().length < 200) {
      return titleAttr.trim();
    }

    // Strategy 6: Look for first visible text node (using TreeWalker like selector-engine)
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }
          
          // Skip if this text is part of the target element
          if (parent.contains(targetElement) && parent !== container) {
            return NodeFilter.FILTER_REJECT;
          }
          
          const text = node.textContent?.trim();
          if (text && text.length > 3 && text.length < 200) {
            if (!/^\d+$/.test(text) && text.length > 3) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node: Node | null;
    const texts: string[] = [];
    while ((node = walker.nextNode()) && texts.length < 5) {
      const text = node.textContent?.trim();
      if (text && text.length > 3 && text.length < 200) {
        texts.push(text);
      }
    }

    if (texts.length > 0) {
      // Return the first meaningful text (likely the header)
      return texts[0];
    }

    // Strategy 7: Check parent containers (for gridster-item)
    const tagName = container.tagName.toLowerCase();
    if (tagName === 'gridster-item' || tagName.includes('gridster')) {
      let parent = container.parentElement;
      let parentLevel = 0;
      const maxParentLevels = 3;
      
      while (parent && parentLevel < maxParentLevels && parent !== document.body) {
        const parentTitle = this.extractHeaderTextFromContainer(parent, targetElement);
        if (parentTitle) {
          return parentTitle;
        }
        parent = parent.parentElement;
        parentLevel++;
      }
    }

    // Strategy 8: Check siblings (title might be before the widget)
    let sibling = container.previousElementSibling;
    let siblingCount = 0;
    while (sibling && siblingCount < 3) {
      const siblingTitle = this.extractHeaderTextFromContainer(sibling, targetElement);
      if (siblingTitle) {
        return siblingTitle;
      }
      sibling = sibling.previousElementSibling;
      siblingCount++;
    }

    return null;
  }
}

