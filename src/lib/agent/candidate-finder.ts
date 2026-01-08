/**
 * CandidateFinder - Finds and ranks DOM elements that match agent hints
 * 
 * Extracted from AIAgent to provide focused candidate matching logic.
 * Used during the observe-act loop to find elements to interact with.
 */

import type { DOMMap, DOMMapElement } from '../../content/dom-map';
import type { AgentHint } from './types';

/**
 * CandidateFinder scores and ranks DOM elements to find the best match for a hint
 */
export class CandidateFinder {
  /**
   * Find and rank candidates that match the current hint
   * Returns max 15 candidates sorted by score
   */
  findAndRankCandidates(hint: AgentHint, domMap: DOMMap): Array<DOMMapElement & { index: number; score: number }> {
    // Infer expected role from hint description if not explicit
    const expectedRole = this.inferRoleFromHint(hint);
    
    // 🚨 DROPDOWN PRIORITY: If a dropdown is open, prioritize dropdown options
    const dropdownIsOpen = !!domMap.activeDropdown;
    
    // Score ALL interactive elements (don't filter first - let scoring decide)
    const allElements = [...domMap.interactiveElements, ...domMap.formFields];
    
    // 🎯 PRE-FILTER: If we have a recorded scope hint, only consider elements in that widget
    // CRITICAL: For menu items, skip scope filtering - they're in portals/overlays outside widget DOM
    // CRITICAL: If dropdown is open, check if hint wants to select from it
    const isMenuItem = hint.targetRole === 'menuitem' || hint.targetRole === 'option' ||
                       hint.description?.toLowerCase().includes('from menu') ||
                       hint.description?.toLowerCase().includes('from dropdown');
    
    let candidatePool = allElements;
    if (dropdownIsOpen) {
      const isDropdownOption = (el: DOMMapElement) => 
        el.role === 'option' || el.role === 'menuitem' || el.role === 'menuitemradio' || el.role === 'menuitemcheckbox';
      
      // 🧠 SMART FILTERING: Only filter to dropdown options if hint is about selecting
      // If hint is about typing, scrolling, or other actions, DON'T filter!
      const hintIsAboutDropdownSelection = 
        hint.actionType === 'click' || 
        hint.actionType === 'other';  // Unknown action might be selection
      
      const hintIsAboutTyping = hint.actionType === 'type';
      const hintIsAboutScrolling = hint.actionType === 'scroll';
      const hintIsAboutNavigation = hint.actionType === 'navigate';
      
      if (hintIsAboutTyping || hintIsAboutScrolling || hintIsAboutNavigation) {
        // ⚠️ Hint is NOT about dropdown selection - include ALL elements
        // Don't filter! The agent may need to close dropdown or type elsewhere
        console.log(`[CandidateFinder] 🔽 Dropdown is open BUT hint action is "${hint.actionType}" - including ALL ${allElements.length} elements`);
        console.log(`[CandidateFinder] 💡 Hint description: "${hint.description}"`);
        console.log(`[CandidateFinder] 💡 The AI should handle closing dropdown or working around it`);
        // candidatePool stays as allElements
      } else if (hintIsAboutDropdownSelection) {
        // ✅ Hint IS about selection - filter to dropdown options only
        candidatePool = allElements.filter(isDropdownOption);
        console.log(`[CandidateFinder] 🔽 Dropdown is open AND hint is about clicking/selecting - filtered to ${candidatePool.length} dropdown options ONLY (ignoring ${allElements.length - candidatePool.length} non-dropdown elements)`);
      } else {
        // Unknown action type - be conservative and include all elements
        console.log(`[CandidateFinder] 🔽 Dropdown is open with unknown hint action "${hint.actionType}" - including ALL ${allElements.length} elements to be safe`);
      }
    } else if (hint.recordedScopeHint && !isMenuItem) {
      // 🎯 CRITICAL: Skip scope filtering for menu items - they're in portals/overlays
      // Menu items are rendered outside the widget DOM tree, so scope filtering would exclude them
      // Normal scope filtering when no dropdown
      const scopeHint = hint.recordedScopeHint.toLowerCase();
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'candidate-finder.ts:63',message:'CANDIDATE_SCOPE_FILTER',data:{scopeHint:hint.recordedScopeHint,allElementsCount:allElements.length,uniqueWidgets:[...new Set(allElements.filter(e=>e.widgetTitle).map(e=>e.widgetTitle))].slice(0,10)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      const inScope = allElements.filter(el => {
        // Check widgetTitle (exact match or contains)
        if (el.widgetTitle && el.widgetTitle.toLowerCase().includes(scopeHint)) {
          return true;
        }
        // Check scopePath (element's container hierarchy)
        if (el.scopePath?.some(s => s.toLowerCase().includes(scopeHint))) {
          return true;
        }
        // Fuzzy match for titles with dynamic numbers (e.g., "STORE...119" vs "STORE...")
        if (el.widgetTitle) {
          const baseScope = scopeHint.replace(/\d+$/g, '').trim();
          const baseWidget = el.widgetTitle.toLowerCase().replace(/\d+$/g, '').trim();
          if (baseScope.length > 10 && baseWidget.includes(baseScope)) {
            return true;
          }
        }
        return false;
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'candidate-finder.ts:85',message:'CANDIDATE_SCOPE_RESULT',data:{inScopeCount:inScope.length,scopeHint:hint.recordedScopeHint,targetText:hint.targetText?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      if (inScope.length > 0) {
        candidatePool = inScope;
        console.log(`[CandidateFinder] 🎯 Pre-filtered to ${inScope.length} elements in recorded scope "${hint.recordedScopeHint}" (from ${allElements.length} total)`);
      } else {
        console.warn(`[CandidateFinder] ⚠️ No elements found in recorded scope "${hint.recordedScopeHint}" - element may not be visible yet. Using all ${allElements.length} elements as fallback.`);
      }
    } else if (isMenuItem) {
      // Menu items are in portals/overlays - don't filter by scope, search document-wide
      console.log(`[CandidateFinder] 🎯 Menu item detected - skipping scope filter, searching document-wide (menus are in portals/overlays)`);
      // candidatePool stays as allElements (document-wide)
    }
    
    // DEBUG: Log hint details
    console.log(`[CandidateFinder] 🔍 Scoring ${candidatePool.length} elements for hint:`, {
      targetText: hint.targetText,
      targetRole: hint.targetRole,
      recordedAriaLabel: hint.recordedAriaLabel,
      recordedScopeHint: hint.recordedScopeHint,
      expectedRole,
    });
    
    const scored = candidatePool.map(el => ({
      ...el,
      score: this.computeCandidateScore(el, hint, expectedRole, dropdownIsOpen),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    // Take top 15 candidates (increased from 8 to give LLM more options)
    // Don't filter by score - let the LLM decide even if scores are low
    const topCandidates = scored.slice(0, 15);
    
    console.log(`[CandidateFinder] Found ${topCandidates.length} candidates, top 3 scores: [${topCandidates.slice(0, 3).map(c => c.score).join(', ')}]`);
    
    // DEBUG: If all scores are 0, log first 3 candidates to diagnose
    if (topCandidates.length > 0 && topCandidates[0].score === 0) {
      console.warn('[CandidateFinder] ⚠️ All candidates scored 0! First 3 candidates:', topCandidates.slice(0, 3).map(c => ({
        role: c.role,
        name: c.name,
        text: c.text,
        widgetTitle: c.widgetTitle,
        scopePath: c.scopePath,
      })));
    }
    
    return topCandidates.map((s, i) => ({
      ...s,
      index: i,
    }));
  }
  
  /**
   * Infer expected role from hint description
   */
  inferRoleFromHint(hint: AgentHint): string | null {
    // If explicit role, use it
    if (hint.targetRole) return hint.targetRole;
    
    const desc = (hint.description || '').toLowerCase();
    const text = (hint.targetText || '').toLowerCase();
    
    // Infer from description keywords
    if (desc.includes('dropdown') || desc.includes('select') || text.includes('select')) {
      return 'combobox';
    }
    if (desc.includes('button') || desc.includes('click') && (desc.includes('submit') || desc.includes('continue') || desc.includes('save'))) {
      return 'button';
    }
    if (desc.includes('enter') || desc.includes('type') || hint.actionType === 'type') {
      return 'textbox'; // or spinbutton, searchbox
    }
    if (desc.includes('link')) {
      return 'link';
    }
    if (desc.includes('checkbox')) {
      return 'checkbox';
    }
    
    return null;
  }
  
  /**
   * Compute score for a candidate element
   * Higher score = better match
   */
  computeCandidateScore(el: DOMMapElement, hint: AgentHint, expectedRole: string | null, dropdownIsOpen: boolean = false): number {
    let score = 0;
    
    // ============================================================
    // DROPDOWN CONTEXT: If dropdown is open, massively boost options
    // ============================================================
    const isDropdownOption = el.role === 'option' || el.role === 'menuitem' || el.role === 'menuitemradio';
    if (dropdownIsOpen && isDropdownOption) {
      score += 150; // Massive boost for dropdown options when dropdown is open!
      console.log(`[CandidateFinder] 🔽 Boosting dropdown option: "${el.text || el.name}" (+150 points)`);
    }
    
    // ============================================================
    // ROLE MATCHING (Critical - 50 points)
    // ============================================================
    const roleAliases: Record<string, string[]> = {
      'combobox': ['combobox', 'listbox', 'select'],
      'textbox': ['textbox', 'searchbox', 'spinbutton', 'input'],
      'button': ['button', 'link', 'menuitem', 'option'], // ← Add 'option' for dropdown clicks recorded as button
      'link': ['link', 'button'],
      'checkbox': ['checkbox', 'switch'],
    };
    
    if (expectedRole) {
      const validRoles = roleAliases[expectedRole] || [expectedRole];
      if (validRoles.includes(el.role)) {
        score += 50; // Role match!
      } else if (dropdownIsOpen && isDropdownOption) {
        // Don't penalize options when dropdown is open, even if hint expects button
        score += 0; // Neutral (already got +150 boost above)
      } else {
        // Role mismatch - significant penalty
        score -= 20;
      }
    }
    
    // ============================================================
    // testId exact match (highest priority - 100 points)
    // ============================================================
    if (hint.recordedTestId && el.attrs?.testId === hint.recordedTestId) {
      score += 100;
    }
    
    // ============================================================
    // ARIA-LABEL exact match (highest priority - 100 points)
    // ============================================================
    // aria-label is one of the most reliable identifiers
    // It's used for accessibility and is usually stable
    if (hint.recordedAriaLabel) {
      const recordedAriaLabel = hint.recordedAriaLabel.toLowerCase().trim();
      const elAriaLabel = el.name?.toLowerCase().trim(); // name comes from computeAccessibleName which uses aria-label
      
      if (elAriaLabel === recordedAriaLabel) {
        score += 100; // Exact aria-label match - highest priority!
        console.log(`[CandidateFinder] 🎯 Exact aria-label match: "${hint.recordedAriaLabel}" (+100 points)`);
      } else if (elAriaLabel && elAriaLabel.includes(recordedAriaLabel)) {
        score += 50; // Partial match (aria-label contains recorded value)
      } else if (recordedAriaLabel.includes(elAriaLabel || '')) {
        score += 30; // Reverse partial match
      }
    }
    
    // ============================================================
    // NAME/TEXT MATCHING (30 points for match)
    // ============================================================
    const hintText = (hint.targetText || '').toLowerCase();
    const hintPlaceholder = (hint.targetPlaceholder || '').toLowerCase();
    const elName = (el.name || '').toLowerCase();
    const elText = (el.text || '').toLowerCase();
    const placeholder = (el.attrs?.placeholder || '').toLowerCase();
    
    // Match by targetText (if available)
    if (hintText && hintText.length > 0) {
      // Check for meaningful matches (not empty strings!)
      if (elName && elName.length > 0 && (elName.includes(hintText) || hintText.includes(elName))) {
        score += 30;
      } else if (elText && elText.length > 0 && (elText.includes(hintText) || hintText.includes(elText))) {
        score += 30;
      } else if (placeholder && placeholder.length > 0 && placeholder.includes(hintText)) {
        score += 25;
      }
    }
    
    // CRITICAL: If no targetText, try matching by targetPlaceholder (for INPUT fields)
    // This handles cases where elementText wasn't captured but label/placeholder was
    if (!hintText && hintPlaceholder && hintPlaceholder.length > 0) {
      console.log(`[CandidateFinder] 🔍 No targetText, using targetPlaceholder for matching: "${hint.targetPlaceholder}"`);
      
      // Match placeholder against element's name, text, or placeholder
      if (elName && elName.length > 0 && (elName.includes(hintPlaceholder) || hintPlaceholder.includes(elName))) {
        score += 30;
        console.log(`[CandidateFinder] ✅ Placeholder matched element name: "${elName}"`);
      } else if (elText && elText.length > 0 && (elText.includes(hintPlaceholder) || hintPlaceholder.includes(elText))) {
        score += 30;
        console.log(`[CandidateFinder] ✅ Placeholder matched element text: "${elText}"`);
      } else if (placeholder && placeholder.length > 0 && (placeholder.includes(hintPlaceholder) || hintPlaceholder.includes(placeholder))) {
        score += 25;
        console.log(`[CandidateFinder] ✅ Placeholder matched element placeholder: "${placeholder}"`);
      }
    }
    
    // Unlabeled elements get a small bonus if they match the role
    // (they might be the only element of that type)
    if ((!elName || elName === '(unlabeled)') && expectedRole) {
      const validRoles = roleAliases[expectedRole] || [expectedRole];
      if (validRoles.includes(el.role)) {
        score += 10; // Small bonus for matching role even when unlabeled
      }
    }
    
    // ============================================================
    // CONTEXT MATCHING (Secondary signals)
    // ============================================================
    
    // rowKey match (40 points) - critical for table rows
    if (hint.recordedRowKey && el.rowKey === hint.recordedRowKey) {
      score += 40;
    }
    
    // scopePath match to recordedScopeHint (30 points)
    if (hint.recordedScopeHint && el.scopePath) {
      const scopeMatch = el.scopePath.some(s => 
        s.toLowerCase().includes(hint.recordedScopeHint!.toLowerCase())
      );
      if (scopeMatch) {
        score += 30;
      }
    }
    
    // widgetTitle match (20 points)
    if (hint.recordedScopeHint && el.widgetTitle) {
      if (el.widgetTitle.toLowerCase().includes(hint.recordedScopeHint.toLowerCase())) {
        score += 20;
      }
    }
    
    // nearbyText overlap (10 points per match)
    if (hint.nearbyText && el.scopePath) {
      const overlap = hint.nearbyText.filter(t => 
        el.scopePath?.some(s => s.toLowerCase().includes(t.toLowerCase()))
      ).length;
      score += overlap * 10;
    }
    
    // Text match quality (up to 15 points)
    if (hint.targetText && (el.name || el.text)) {
      const hintTextLower = hint.targetText.toLowerCase();
      const elTextLower = ((el.name || el.text) || '').toLowerCase();
      
      if (elTextLower === hintTextLower) {
        // Exact match
        score += 15;
      } else if (elTextLower.includes(hintTextLower) || hintTextLower.includes(elTextLower)) {
        // Partial match
        score += 8;
      }
    }
    
    // Placeholder match (10 points)
    if (hint.targetPlaceholder && el.attrs?.placeholder) {
      if (el.attrs.placeholder.toLowerCase().includes(hint.targetPlaceholder.toLowerCase())) {
        score += 10;
      }
    }
    
    return score;
  }
}

// Export singleton for convenience
export const candidateFinder = new CandidateFinder();

