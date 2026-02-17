/**
 * Observer Module
 *
 * Responsible for observing the current page state (DOM map, screenshots,
 * spreadsheet state, modal/dropdown detection).
 *
 * Extracted from AIAgent to keep page observation logic self-contained.
 */

import { domMapToText, type DOMMap } from '../../content/dom-map';
import { FeatureFlags } from '../feature-flags';
import { VisualSnapshotService } from '../../content/visual-snapshot';
import { SheetStateExtractor, type SheetState } from '../../content/sheet-state-extractor';
import type { AgentObservation } from './types';

export class Observer {
  /**
   * Observe the current page state using DOM map (primary) + screenshot (optional).
   * Enhanced with PageModel for unified page understanding.
   */
  static async observe(): Promise<AgentObservation> {
    console.log('[Observer] 🔍 Observing page state...');

    // Try to get PageModel for enhanced observation (async, cached)
    let pageModel: import('../page-model/types').PageModel | undefined;
    try {
      const { getCurrentModel } = await import('../page-model');
      pageModel = await getCurrentModel();
      console.log(
        `[Observer] 📊 PageModel: ${pageModel.pageType.type} page ` +
        `(${(pageModel.pageType.confidence * 100).toFixed(0)}% confidence), ` +
        `context: ${pageModel.activeContext}`
      );
    } catch {
      console.log('[Observer] PageModel unavailable, using standard observation');
    }

    // Generate DOM map with iframe content
    const { getCurrentFrameId } = await import('../../content/content-script');
    const currentFrameId = getCurrentFrameId();

    let domMap: DOMMap;
    if (currentFrameId === 0) {
      const { generateDOMMapWithIframes } = await import('../../content/dom-map');
      domMap = await generateDOMMapWithIframes();
      console.log('[Observer] 🖼️ Generated DOM map with iframe content');
    } else {
      const { generateDOMMap } = await import('../../content/dom-map');
      domMap = generateDOMMap();
      console.log(`[Observer] Generated DOM map for iframe (frameId: ${currentFrameId})`);
    }

    let domMapText = domMapToText(domMap);

    // Append spreadsheet state if applicable
    if (SheetStateExtractor.isSpreadsheetDomain()) {
      try {
        const sheetState = await SheetStateExtractor.extract();
        if (sheetState) {
          console.log(`[Observer] 📊 Extracted spreadsheet state: ${sheetState.columns.length} columns`);
          domMapText += `\n\n${Observer.formatSheetStateForLLM(sheetState)}`;
        }
      } catch (error) {
        console.warn('[Observer] Failed to extract sheet state:', error);
      }
    }

    console.log(
      `[Observer] DOM map: ${domMap.interactiveElements.length} interactive elements, ` +
      `${domMap.formFields.length} form fields`
    );

    if (domMap.activeDropdown) {
      console.log(
        `[Observer] 🔽 DROPDOWN IS OPEN with ${domMap.activeDropdown.options.length} options:`,
        domMap.activeDropdown.options.map(o => o.name || o.text).slice(0, 5)
      );
    }

    // Only capture screenshot if VisionClicker is enabled as fallback
    let screenshot: string | undefined;
    if (FeatureFlags.VISION_CLICKER) {
      const capture = await VisualSnapshotService.captureFullPage(0.8, true);
      screenshot = capture?.screenshot;
    }

    const observation: AgentObservation = {
      url: window.location.href,
      title: document.title,
      domMapText,
      hasModal: pageModel?.uiState.hasModal ?? !!domMap.activeModal,
      modalTitle: pageModel?.uiState.modalInfo?.title ?? domMap.activeModal?.title,
      hasOpenDropdown: pageModel?.uiState.hasOpenDropdown ?? !!domMap.activeDropdown,
      dropdownOptions:
        pageModel?.uiState.dropdownInfo?.optionTexts ??
        domMap.activeDropdown?.options.map(o => o.name || o.text || '(unnamed)'),
      formFields: domMap.formFields.map(f => ({
        name: f.name,
        value: f.attrs?.value,
        type: f.attrs?.type || 'text',
      })),
      buttonCount: domMap.interactiveElements.filter(e => e.role === 'button').length,
      linkCount: domMap.interactiveElements.filter(e => e.role === 'link').length,
      inputCount: domMap.formFields.length,
      headings: domMap.headings.map(h => h.text),
      screenshot,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      timestamp: Date.now(),
    };

    // Attach internal data for downstream modules
    (observation as any)._pageModel = pageModel;
    (observation as any)._domMap = domMap;

    return observation;
  }

  /**
   * Format spreadsheet state for LLM understanding.
   */
  static formatSheetStateForLLM(sheetState: SheetState): string {
    const lines: string[] = [];

    lines.push('## 📊 SPREADSHEET DETECTED (Google Sheets / Excel Online)');
    lines.push('');
    lines.push(`Sheet: "${sheetState.sheetName}"`);
    lines.push(
      `Active Cell: ${sheetState.activeCell.reference} ` +
      `(${sheetState.activeCell.isEmpty ? 'empty' : `value: "${sheetState.activeCell.value}"`})`
    );
    lines.push('');

    if (sheetState.headers.length > 0) {
      lines.push('**Column Headers**:');
      lines.push(sheetState.headers.map(h => `  ${h.column}: "${h.text}"`).join('\n'));
      lines.push('');
    }

    if (sheetState.columns.length > 0) {
      lines.push('**Column Data**:');
      for (const col of sheetState.columns.slice(0, 10)) {
        lines.push(`  Column ${col.letter} ("${col.header}"):`);
        lines.push(`    - Data type: ${col.dataType}`);
        lines.push(`    - Last data row: ${col.lastDataRow}`);
        lines.push(`    - Next empty row: ${col.firstEmptyRow}`);
        if (col.sampleValues.length > 0) {
          lines.push(`    - Sample values: ${col.sampleValues.slice(0, 2).join(', ')}`);
        }
      }
      lines.push('');
    }

    lines.push('**📊 SPREADSHEET ACTIONS AVAILABLE**:');
    lines.push('When you need to type in a spreadsheet cell, use these specialized actions instead of regular "type":');
    lines.push('');
    lines.push('1. **type_in_cell**: Type directly into a specific cell');
    lines.push('   Example: {"action": "type_in_cell", "cellRef": "B5", "text": "Hello World"}');
    lines.push('');
    lines.push('2. **type_in_header_column**: Type in cell by finding column header');
    lines.push('   Example: {"action": "type_in_header_column", "headerText": "Email", "rowOffset": 1, "text": "john@test.com"}');
    lines.push('   Note: rowOffset 1 = first data row (row 2 if headers in row 1)');
    lines.push('');
    lines.push('3. **type_in_next_empty**: Type in next empty cell of a column');
    lines.push('   Example: {"action": "type_in_next_empty", "column": "A", "text": "New entry"}');
    lines.push('');
    lines.push('4. **read_cell**: Read value from a cell');
    lines.push('   Example: {"action": "read_cell", "cellRef": "C5"}');
    lines.push('');
    lines.push('⚠️ IMPORTANT: When working with spreadsheets, prefer these actions over regular click+type!');
    lines.push('These actions handle cell navigation, verification, and retries automatically.');

    return lines.join('\n');
  }
}
