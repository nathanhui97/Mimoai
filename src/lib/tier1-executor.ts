/**
 * Tier 1 Executor - Deterministic "Hands + Reflexes"
 * 
 * Responsibilities:
 * - Resolve targets in DOM using existing Resolver
 * - Scope/container resolution
 * - Interactability checks
 * - Safe clicking/typing with action primitives
 * - Stability waits
 * - Outcome verification
 * - Recovery actions
 * 
 * NEVER calls LLM - only returns structured rejection codes.
 */

import type { AgentAction, SemanticTarget, ExpectedOutcome } from './ai-agent';
import { Resolver, type ResolveResult } from '../content/resolver';
import { StateWaitEngine } from '../content/state-wait-engine';
import type { LocatorBundle, LocatorStrategy } from '../types/locator';
import type { Intent } from '../types/intent';
import { SelectorReliability } from './selector-reliability';
import { findBestMatch } from './fuzzy-option-matcher';
import { SheetStateExtractor } from '../content/sheet-state-extractor';
import { SpreadsheetExecutor } from './spreadsheet-executor';
import { getCurrentModel } from './page-model';
import { ExpectationEngine, generateExpectations } from './page-model/expectation-engine';

// ============================================================================
// Types
// ============================================================================

/**
 * Explicit rejection codes (not generic errors)
 */
export type RejectionCode =
  | 'NOT_FOUND'        // No candidates matched
  | 'AMBIGUOUS'        // Multiple candidates, can't decide
  | 'NOT_INTERACTABLE' // Element found but not clickable/visible
  | 'SCOPE_FAILED'     // Scope container not found
  | 'UNSAFE_ACTION'    // Would click delete/confirm in popup
  | 'OUTCOME_FAILED'   // Action succeeded but outcome verification failed
  | 'OPTION_CONFIRMATION_NEEDED' // Dropdown option needs user confirmation (fuzzy match)
  | 'COORDINATE_CLICK_FAILED';   // Coordinate-based click failed

/**
 * Execution result with explicit rejection codes
 */
export interface Tier1ExecutionResult {
  status: 'success' | 'rejected';
  code?: RejectionCode;
  details: {
    // For NOT_FOUND / AMBIGUOUS
    matchCount?: number;
    candidates?: Array<{ role: string; name: string; text?: string }>;
    triedStrategies?: string[];
    
    // For SCOPE_FAILED
    scopeStatus?: string;
    
    // For NOT_INTERACTABLE
    interactabilityIssue?: string;
    
    // For OUTCOME_FAILED
    outcomeResult?: string;
    expectedOutcome?: ExpectedOutcome;
    
    // For UNSAFE_ACTION
    dangerousPattern?: string;
    
    // General
    element?: Element;
    resolveMetrics?: any;
    
    // For read action
    value?: string | boolean | number;

    // For OPTION_CONFIRMATION_NEEDED (fuzzy match)
    fuzzyMatchResult?: {
      userInput: string;
      suggestedOption: string | null;
      confidence: number;
      alternatives: Array<{ option: string; confidence: number; preSelected: boolean }>;
      allOptions: string[];
      fieldName: string;
    };

    // For multi_select action
    selectedCount?: number;
    elements?: Element[];
    selectionMode?: 'first' | 'all' | 'matching' | 'count';
  };
  message?: string;
}

// ============================================================================
// Tier 1 Executor
// ============================================================================

export class Tier1Executor {
  /**
   * Execute an action with full deterministic safety checks
   */
  static async execute(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.log(`[Tier1] 🎯 Executing: ${action.type}`, action.params.target || action.params);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:80',message:'TIER1_EXECUTE_START',data:{actionType:action.type,targetRole:action.params.target?.role,targetName:action.params.target?.name?.substring(0,50),scopeHint:action.params.target?.scopeHint},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    try {
      switch (action.type) {
        case 'click':
          return await this.executeClick(action);
        
        case 'double_click':
          return await this.executeDoubleClick(action);
        
        case 'right_click':
          return await this.executeRightClick(action);
        
        case 'type':
          return await this.executeType(action);
        
        case 'select':
          return await this.executeSelect(action);

        case 'multi_select':
          return await this.executeMultiSelect(action);

        case 'scroll':
          return await this.executeScroll(action);
        
        case 'navigate':
          return await this.executeNavigate(action);
        
        case 'wait':
          return await this.executeWait(action);
        
        case 'assert':
          return await this.executeAssert(action);
        
        case 'read':
          return await this.executeRead(action);
        
        case 'keyboard':
          return await this.executeKeyboard(action);
        
        case 'hover':
          return await this.executeHover(action);

        case 'copy':
          return await this.executeCopy(action);

        case 'paste':
          return await this.executePaste(action);

        case 'done':
          return { status: 'success', details: {} };
        
        case 'fail':
          return {
            status: 'rejected',
            code: 'NOT_FOUND',
            details: {},
            message: action.params.reason || 'Agent decided to fail',
          };
        
        default:
          return {
            status: 'rejected',
            code: 'UNSAFE_ACTION',
            details: { dangerousPattern: `Unknown action type: ${action.type}` },
          };
      }
    } catch (error) {
      console.error('[Tier1] Error:', error);
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute click with full resolution pipeline
   */
  private static async executeClick(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, expectedOutcome } = action.params;

    if (typeof action.params.x === 'number' && typeof action.params.y === 'number') {
      const { VisionClicker } = await import('./vision-clicker');
      const result = await VisionClicker.clickAt(
        action.params.x,
        action.params.y,
        action.params.description
      );
      return {
        status: result.success ? 'success' : 'rejected',
        code: result.success ? undefined : 'COORDINATE_CLICK_FAILED',
        details: {
          element: undefined,
          resolveMetrics: { method: 'coordinate' },
        },
        message: result.error,
      };
    }
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified',
      };
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:160',message:'TIER1_CLICK_START',data:{targetRole:target.role,targetName:target.name?.substring(0,50),scopeHint:target.scopeHint},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' };
    
    // Resolve element using Resolver
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      // Track selector failures (async, non-blocking)
      if (target.recordedFallbackSelectors) {
        const url = window.location.href;
        for (const selector of target.recordedFallbackSelectors) {
          SelectorReliability.trackResult(selector, url, false).catch(() => {});
        }
      }
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Check interactability
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }
    
    // Check if this is a dangerous action (delete/confirm in popup)
    const safetyCheck = this.checkActionSafety(element, 'click');
    if (!safetyCheck.safe) {
      return {
        status: 'rejected',
        code: 'UNSAFE_ACTION',
        details: {
          dangerousPattern: safetyCheck.reason,
          element,
        },
        message: safetyCheck.reason,
      };
    }
    
    // CRITICAL: Verify we're clicking the RIGHT element (exact text match for options)
    // This prevents clicking "BOGA" when AI wanted "BOGO" or "DISCOUNTED" when AI wanted "BOGO"
    if (target.role === 'option' || target.role === 'menuitem') {
      const actualText = element.textContent?.trim() || '';
      const targetText = target.text || target.name || '';
      
      if (targetText && actualText.toLowerCase() !== targetText.toLowerCase()) {
        console.warn(`[Tier1] ❌ Text mismatch: AI wanted "${targetText}", but would click "${actualText}"`);
        return {
          status: 'rejected',
          code: 'AMBIGUOUS',
          details: {
            matchCount: 1,
            candidates: [{ role: target.role, name: actualText, text: actualText }],
            element,
          },
          message: `Element text "${actualText}" doesn't match requested "${targetText}"`,
        };
      }
    }
    
    // Execute click
    const actualElementText = element.textContent?.trim().substring(0, 50) || '';
    console.log(`[Tier1] ✅ Clicking element: ${element.tagName} ${actualElementText}`);
    this.clickElement(element);
    
    // CRITICAL: If this is a dropdown trigger (e.g., "More Options"), wait for menu to appear
    // This ensures menu items are visible before the next step tries to click them
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const elementText = element.textContent?.toLowerCase() || '';
    const role = element.getAttribute('role');
    
    const isDropdownTrigger = element.getAttribute('aria-haspopup') === 'true' ||
                             element.getAttribute('aria-expanded') !== null ||
                             element.getAttribute('aria-controls') !== null ||
                             ((element.tagName === 'BUTTON' || role === 'button') && 
                              (ariaLabel.includes('more') || 
                               ariaLabel.includes('options') ||
                               ariaLabel.includes('menu') ||
                               elementText.includes('more') || 
                               elementText.includes('options')));
    
    console.log(`[Tier1] 🔍 Dropdown trigger check: role=${role}, ariaLabel="${ariaLabel.substring(0,30)}", text="${elementText.substring(0,30)}", isDropdownTrigger=${isDropdownTrigger}`);
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:250',message:'DROPDOWN_TRIGGER_CHECK',data:{role,ariaLabel:ariaLabel.substring(0,50),elementText:elementText.substring(0,50),isDropdownTrigger},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'MENU'})}).catch(()=>{});
    // #endregion
    
    if (isDropdownTrigger) {
      console.log(`[Tier1] 🔽 Dropdown trigger detected, waiting for menu to appear...`);
      const { waitForDropdownMenu } = await import('../content/universal-execution/state-verifier');
      const menu = await waitForDropdownMenu(2000); // Wait up to 2 seconds for menu
      if (menu) {
        console.log(`[Tier1] ✅ Dropdown menu appeared with ${menu.querySelectorAll('[role="menuitem"], [role="option"]').length} options`);
      } else {
        console.warn(`[Tier1] ⚠️ Dropdown menu didn't appear within 2 seconds, continuing anyway`);
      }
    }
    
    // Wait for stability using expectation-based verification when possible
    const waitResult = await this.waitForOutcome(action, expectedOutcome);

    // If expectation-based wait was used and failed, return the result
    if (waitResult && !waitResult.success) {
      return {
        status: 'rejected',
        code: 'OUTCOME_FAILED',
        details: {
          outcomeResult: waitResult.message,
          expectedOutcome,
          element,
        },
        message: waitResult.message,
      };
    }
    
    // Track selector reliability (async, non-blocking)
    if (target.recordedFallbackSelectors && target.recordedFallbackSelectors.length > 0) {
      const selector = target.recordedFallbackSelectors[0];
      const url = window.location.href;
      SelectorReliability.trackResult(selector, url, true).catch(() => {});
    }
    
    return {
      status: 'success',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
    };
  }

  private static async executeDoubleClick(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target } = action.params;

    if (typeof action.params.x === 'number' && typeof action.params.y === 'number') {
      const { VisionClicker } = await import('./vision-clicker');
      const result = await VisionClicker.doubleClickAt(
        action.params.x,
        action.params.y,
        action.params.description
      );
      return {
        status: result.success ? 'success' : 'rejected',
        code: result.success ? undefined : 'COORDINATE_CLICK_FAILED',
        details: {
          element: undefined,
          resolveMetrics: { method: 'coordinate' },
        },
        message: result.error,
      };
    }

    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified',
      };
    }

    const bundle = this.buildLocatorBundle(target);
    const intent: Intent = { kind: 'CLICK' };
    const resolveResult = await this.resolveElement(bundle, intent);
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }

    const element = resolveResult.details.element!;
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }

    const safetyCheck = this.checkActionSafety(element, 'click');
    if (!safetyCheck.safe) {
      return {
        status: 'rejected',
        code: 'UNSAFE_ACTION',
        details: {
          dangerousPattern: safetyCheck.reason,
          element,
        },
        message: safetyCheck.reason,
      };
    }

    const rect = (element as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const { VisionClicker } = await import('./vision-clicker');
    const result = await VisionClicker.doubleClickAt(x, y, action.params.description);

    return {
      status: result.success ? 'success' : 'rejected',
      code: result.success ? undefined : 'COORDINATE_CLICK_FAILED',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
      message: result.error,
    };
  }

  private static async executeRightClick(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target } = action.params;

    if (typeof action.params.x === 'number' && typeof action.params.y === 'number') {
      const { VisionClicker } = await import('./vision-clicker');
      const result = await VisionClicker.rightClickAt(
        action.params.x,
        action.params.y,
        action.params.description
      );
      return {
        status: result.success ? 'success' : 'rejected',
        code: result.success ? undefined : 'COORDINATE_CLICK_FAILED',
        details: {
          element: undefined,
          resolveMetrics: { method: 'coordinate' },
        },
        message: result.error,
      };
    }

    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified',
      };
    }

    const bundle = this.buildLocatorBundle(target);
    const intent: Intent = { kind: 'CLICK' };
    const resolveResult = await this.resolveElement(bundle, intent);
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }

    const element = resolveResult.details.element!;
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }

    const safetyCheck = this.checkActionSafety(element, 'click');
    if (!safetyCheck.safe) {
      return {
        status: 'rejected',
        code: 'UNSAFE_ACTION',
        details: {
          dangerousPattern: safetyCheck.reason,
          element,
        },
        message: safetyCheck.reason,
      };
    }

    const rect = (element as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const { VisionClicker } = await import('./vision-clicker');
    const result = await VisionClicker.rightClickAt(x, y, action.params.description);

    return {
      status: result.success ? 'success' : 'rejected',
      code: result.success ? undefined : 'COORDINATE_CLICK_FAILED',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
      message: result.error,
    };
  }

  /**
   * Execute type action
   */
  private static async executeType(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { text, fieldTarget, clearFirst } = action.params;
    
    // Debug logging
    console.log('[Tier1] 📝 Type action params:', {
      hasFieldTarget: !!fieldTarget,
      fieldTarget: fieldTarget ? { role: fieldTarget.role, name: fieldTarget.name, id: fieldTarget.id } : null,
      text: text?.substring(0, 20),
    });

    if (typeof action.params.x === 'number' && typeof action.params.y === 'number') {
      const { VisionClicker } = await import('./vision-clicker');
      const clickResult = await VisionClicker.clickAt(
        action.params.x,
        action.params.y,
        action.params.description
      );
      if (!clickResult.success) {
        return {
          status: 'rejected',
          code: 'COORDINATE_CLICK_FAILED',
          details: {
            element: undefined,
            resolveMetrics: { method: 'coordinate' },
          },
          message: clickResult.error,
        };
      }
      await this.sleep(50);
    }
    
    if (!text) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No text specified',
      };
    }
    
    let element: Element | null = null;
    
    // If fieldTarget specified, resolve it
    if (fieldTarget) {
      console.log('[Tier1] 🎯 Resolving fieldTarget:', fieldTarget.name || fieldTarget.role);
      const bundle = this.buildLocatorBundle(fieldTarget);
      const intent: Intent = { kind: 'TYPE', valueVar: 'value' };
      const resolveResult = await this.resolveElement(bundle, intent);
      
      if (resolveResult.status !== 'success') {
        console.log('[Tier1] ❌ Failed to resolve fieldTarget, falling back to activeElement');
        // Track selector failures (async, non-blocking)
        if (fieldTarget.recordedFallbackSelectors) {
          const url = window.location.href;
          for (const selector of fieldTarget.recordedFallbackSelectors) {
            SelectorReliability.trackResult(selector, url, false).catch(() => {});
          }
        }
        // Fall back to activeElement instead of failing
        element = document.activeElement as Element;
        if (!element || element === document.body) {
          return resolveResult;
        }
      } else {
        element = resolveResult.details.element!;
        // Track selector success (async, non-blocking)
        if (fieldTarget.recordedFallbackSelectors && fieldTarget.recordedFallbackSelectors.length > 0) {
          const selector = fieldTarget.recordedFallbackSelectors[0];
          const url = window.location.href;
          SelectorReliability.trackResult(selector, url, true).catch(() => {});
        }
      }
    } else {
      // Use focused element
      console.log('[Tier1] ⚠️ No fieldTarget provided, using activeElement');
      element = document.activeElement;
      if (!element || element === document.body) {
        return {
          status: 'rejected',
          code: 'NOT_FOUND',
          details: {},
          message: 'No field focused and no fieldTarget specified',
        };
      }
    }
    
    // Check if element accepts input
    const isInput = element instanceof HTMLInputElement ||
                   element instanceof HTMLTextAreaElement ||
                   element.getAttribute('contenteditable') === 'true';
    
    if (!isInput) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: `Element ${element.tagName} does not accept text input`,
          element,
        },
      };
    }
    
    // Log which element we're typing into
    const elementId = (element as HTMLElement).id || 'no-id';
    const elementName = element.getAttribute('aria-label') || element.getAttribute('name') || 'no-name';
    console.log(`[Tier1] ⌨️ Typing into: ${element.tagName} id="${elementId}" name="${elementName}"`);
    
    // Focus element
    (element as HTMLElement).focus();
    await this.sleep(50);  // Brief pause after focus
    
    // Clear if requested
    if (clearFirst && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(50);
    }
    
    // Type using native setter (React-friendly)
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, text);
      } else {
        element.value = text;
      }
      
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));  // Some fields need blur to commit
    } else {
      // Contenteditable
      (element as HTMLElement).textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
    
    console.log('[Tier1] ⌨️ Typed:', text.substring(0, 50), '→ Final value:', (element as any).value || (element as HTMLElement).textContent?.substring(0, 50));
    
    return {
      status: 'success',
      details: { element },
    };
  }

  /**
   * Execute select (dropdown)
   * 
   * ENHANCED: This function now properly handles the two-step dropdown selection:
   * 1. First, ensure the dropdown is open (click trigger if needed)
   * 2. Wait for the dropdown menu to appear with retry logic
   * 3. Search for the option using multiple strategies including decision space
   */
  private static async executeSelect(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, option, decisionSpace } = action.params;
    
    console.log('[Tier1] 🎯 Executing SELECT for dropdown');
    console.log('[Tier1] Option to select:', option);
    console.log('[Tier1] Target:', target);
    console.log('[Tier1] Decision space available:', !!decisionSpace);
    
    if (!option) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No option specified',
      };
    }
    
    // ENHANCED: Use MenuDetector to properly check for visible dropdown
    const { MenuDetector } = await import('../content/menu-detector');

    // Check if dropdown is already open using proper menu detection
    let visibleMenu = MenuDetector.findVisibleMenu();
    let dropdownAlreadyOpen = !!visibleMenu;

    // UNIVERSAL: Distinguish between actual dropdowns and always-visible listboxes
    // Key insight: Real dropdown menus are POSITIONED (absolute/fixed) overlays
    // Always-visible listboxes (dual-pickers, multi-selects) are positioned normally (static/relative)
    if (!dropdownAlreadyOpen) {
      // Search for positioned overlay elements that contain options
      // This works across all frameworks: React, Angular, Vue, vanilla HTML, etc.
      const allOptionContainers = document.querySelectorAll(
        '[role="listbox"], [role="menu"], [role="presentation"]'
      );
      
      for (const container of allOptionContainers) {
        const rect = container.getBoundingClientRect();
        const style = window.getComputedStyle(container as HTMLElement);
        
        // UNIVERSAL PATTERN: Real dropdown overlays are absolutely/fixed positioned
        // This distinguishes them from inline listboxes that are part of the page flow
        const isOverlay = style.position === 'absolute' || style.position === 'fixed';
        const isVisible = rect.width > 0 && rect.height > 0 && 
                         style.display !== 'none' && 
                         style.visibility !== 'hidden' &&
                         style.opacity !== '0';
        
        if (isOverlay && isVisible) {
          const options = container.querySelectorAll('[role="option"], [role="menuitem"], li');
          if (options.length > 0) {
            console.log(`[Tier1] 🔍 Found overlay dropdown (${style.position}) with ${options.length} options`);
            dropdownAlreadyOpen = true;
            visibleMenu = container as HTMLElement;
            break;
          }
        }
      }
    }
    
    // UNIVERSAL: Check if the TARGET's dropdown is open (not just any dropdown)
    // Uses standard ARIA attributes that work across all accessible web applications
    if (target?.name) {
      const triggerLabel = target.name;
      
      // Find trigger using universal ARIA patterns
      // These patterns work on any ARIA-compliant website
      let targetTrigger: Element | null = null;
      
      // Try multiple universal selector patterns
      const triggerSelectors = [
        `[aria-label="${triggerLabel}"]`,
        `[aria-label*="${triggerLabel}"]`,
        `[role="combobox"][aria-label*="${triggerLabel}"]`,
        `button[aria-label*="${triggerLabel}"]`,
      ];
      
      for (const selector of triggerSelectors) {
        try {
          targetTrigger = document.querySelector(selector);
          if (targetTrigger) break;
        } catch (e) {
          // Invalid selector, try next
        }
      }
      
      if (targetTrigger) {
        // UNIVERSAL: Check aria-expanded attribute (standard ARIA pattern)
        const ariaExpanded = targetTrigger.getAttribute('aria-expanded');
        const ariaControls = targetTrigger.getAttribute('aria-controls');
        
        if (ariaExpanded === 'true') {
          // Trigger says it's expanded - verify the controlled element has content
          if (ariaControls) {
            const controlledDropdown = document.getElementById(ariaControls);
            if (controlledDropdown) {
              const controlledOptions = controlledDropdown.querySelectorAll('[role="option"], [role="menuitem"], li');
              if (controlledOptions.length === 0) {
                console.log(`[Tier1] 🔍 Target says expanded but controlled element ${ariaControls} is empty - will open`);
                dropdownAlreadyOpen = false;
              } else {
                console.log(`[Tier1] ✅ Target dropdown ${ariaControls} is expanded with ${controlledOptions.length} options`);
                dropdownAlreadyOpen = true;
                visibleMenu = controlledDropdown as HTMLElement;
              }
            }
          }
        } else if (ariaExpanded === 'false' || ariaExpanded === null) {
          // Trigger is NOT expanded - we need to open it
          // Even if another dropdown is open, we need OUR target's dropdown
          console.log(`[Tier1] 🔍 Target trigger "${triggerLabel}" is NOT expanded (aria-expanded=${ariaExpanded}) - need to open it`);
          dropdownAlreadyOpen = false;
        }
      } else {
        console.log(`[Tier1] 🔍 Could not find trigger for "${triggerLabel}" - will attempt to open dropdown`);
      }
    }

    console.log('[Tier1] Dropdown already open:', dropdownAlreadyOpen);
    
    // ENHANCED: Open dropdown with retry logic if not already open
    if (!dropdownAlreadyOpen && target) {
      console.log('[Tier1] Opening dropdown first...');
      
      // Try up to 2 times to open the dropdown
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[Tier1] Opening dropdown attempt ${attempt}/2...`);
        
        const clickResult = await this.executeClick({
          ...action,
          type: 'click',
          params: { target, description: 'Open dropdown' },
        });
        
        if (clickResult.status !== 'success') {
          if (attempt === 2) {
            return clickResult;
          }
          console.log('[Tier1] Click failed, retrying...');
          await this.sleep(200);
          continue;
        }
        
        // Wait for dropdown to open using MenuDetector
        console.log('[Tier1] Waiting for dropdown menu to appear...');
        const menuResult = await MenuDetector.waitForMenu(2000);
        
        if (menuResult.menu) {
          visibleMenu = menuResult.menu;
          console.log(`[Tier1] ✅ Dropdown opened via ${menuResult.method} (${menuResult.confidence} confidence) in ${menuResult.elapsedMs}ms`);
          break;
        } else if (attempt === 2) {
          // Last attempt - check if options are visible even if menu wasn't detected
          const postClickOptions = document.querySelectorAll('[role="option"]');
          if (postClickOptions.length > 0) {
            console.log(`[Tier1] ⚠️ Menu not detected but ${postClickOptions.length} options found - continuing`);
            break;
          }
          console.warn('[Tier1] ❌ Dropdown menu never appeared after 2 attempts');
        } else {
          console.log('[Tier1] Menu not detected, retrying dropdown open...');
          await this.sleep(200);
        }
      }
    } else if (dropdownAlreadyOpen) {
      console.log('[Tier1] ✅ Dropdown already open, skipping trigger click');
    }
    
    // Find and click option - use ONLY the option text, ignore recorded selectors
    console.log('[Tier1] Searching for dropdown option with text:', option);
    
    // Helper: Normalize text for comparison (lowercase, collapse whitespace, trim)
    const normalizeText = (text: string | undefined | null): string => {
      if (!text) return '';
      return text.toLowerCase().replace(/\s+/g, ' ').trim();
    };
    
    const normalizedSearchText = normalizeText(option);
    console.log('[Tier1] Normalized search text:', normalizedSearchText);
    
    // 🎯 STRATEGY 0: Find the CORRECT dropdown using aria-controls matching
    // This prevents selecting from the wrong dropdown when multiple are open
    let targetDropdownId: string | null = null;
    let targetDropdownContainer: Element | null = null;
    
    // Try to find the dropdown trigger and get its aria-controls
    const triggerLabel = target?.name || target?.text;
    if (triggerLabel) {
      console.log(`[Tier1] 🎯 Looking for dropdown trigger with label: "${triggerLabel}"`);
      
      // Find combobox/button with matching aria-label
      const triggers = document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]');
      for (const trigger of triggers) {
        const ariaLabel = trigger.getAttribute('aria-label');
        const triggerTextContent = trigger.textContent?.trim();
        
        if (ariaLabel?.toLowerCase() === triggerLabel.toLowerCase() ||
            triggerTextContent?.toLowerCase().includes(triggerLabel.toLowerCase())) {
          targetDropdownId = trigger.getAttribute('aria-controls');
          console.log(`[Tier1] 🎯 Found matching trigger with aria-controls="${targetDropdownId}"`);
          break;
        }
      }
      
      // Also search in Shadow DOM for triggers
      if (!targetDropdownId) {
        try {
          const { ShadowDOMUtils } = await import('../content/shadow-dom-utils');
          const shadowTriggers = ShadowDOMUtils.queryDeep('[role="combobox"], button[aria-haspopup="listbox"]', document.body);
          for (const trigger of shadowTriggers) {
            const ariaLabel = trigger.getAttribute('aria-label');
            const triggerTextContent = trigger.textContent?.trim();
            
            if (ariaLabel?.toLowerCase() === triggerLabel.toLowerCase() ||
                triggerTextContent?.toLowerCase().includes(triggerLabel.toLowerCase())) {
              targetDropdownId = trigger.getAttribute('aria-controls');
              console.log(`[Tier1] 🎯 Found matching trigger in Shadow DOM with aria-controls="${targetDropdownId}"`);
              break;
            }
          }
        } catch (e) {
          console.warn('[Tier1] Shadow DOM trigger search failed:', e);
        }
      }
    }
    
    // If we found the dropdown ID, get the container
    if (targetDropdownId) {
      targetDropdownContainer = document.getElementById(targetDropdownId);
      if (!targetDropdownContainer) {
        // Try Shadow DOM
        try {
          const { ShadowDOMUtils } = await import('../content/shadow-dom-utils');
          const containers = ShadowDOMUtils.queryDeep(`#${targetDropdownId}`, document.body);
          if (containers.length > 0) {
            targetDropdownContainer = containers[0];
          }
        } catch (e) {
          console.warn('[Tier1] Shadow DOM container search failed:', e);
        }
      }
      
      if (targetDropdownContainer) {
        console.log(`[Tier1] 🎯 Found correct dropdown container: #${targetDropdownId} with ${targetDropdownContainer.querySelectorAll('[role="option"]').length} options`);
      }
    }
    
    // STRATEGY 1: Search for options - prioritize the correct dropdown container
    console.log('[Tier1] Strategy 1: Searching for [role="option"] elements...');
    
    let allOptions: Element[] = [];
    
    // If we found the correct dropdown container, search ONLY within it first
    if (targetDropdownContainer) {
      console.log('[Tier1] 🎯 Searching within the correct dropdown container first');
      const containerOptions = Array.from(targetDropdownContainer.querySelectorAll('[role="option"]'));
      
      // Also check Shadow DOM within the container
      try {
        const { ShadowDOMUtils } = await import('../content/shadow-dom-utils');
        const shadowOptions = ShadowDOMUtils.queryDeep('[role="option"]', targetDropdownContainer);
        const allContainerOptions = new Set([...containerOptions, ...shadowOptions]);
        allOptions = Array.from(allContainerOptions);
        console.log(`[Tier1] 🎯 Found ${allOptions.length} options in correct dropdown container`);
      } catch (e) {
        allOptions = containerOptions;
      }
    }
    
    // Fallback: search entire page if no container found or no options in container
    if (allOptions.length === 0) {
      console.log('[Tier1] ⚠️ No options in target container, falling back to page-wide search');
      
      // Get options from regular DOM
      const regularOptions = Array.from(document.querySelectorAll('[role="option"]'));
      
      // Get options from Shadow DOM using deep search
      let shadowOptions: Element[] = [];
      try {
        const { ShadowDOMUtils } = await import('../content/shadow-dom-utils');
        shadowOptions = ShadowDOMUtils.queryDeep('[role="option"]', document.body);
      } catch (e) {
        console.warn('[Tier1] Shadow DOM search failed:', e);
      }
      
      // Combine and deduplicate options
      const allOptionsSet = new Set([...regularOptions, ...shadowOptions]);
      allOptions = Array.from(allOptionsSet);
    }
    
    console.log('[Tier1] Found', allOptions.length, 'option elements total');
    
    let matchedOption: Element | null = null;
    let matchType = '';
    
    // Pass 1: Exact match (fastest, most reliable)
    for (const opt of allOptions) {
      const optText = opt.textContent?.trim();
      if (optText === option) {
        matchedOption = opt;
        matchType = 'exact';
        console.log('[Tier1] ✅ Exact match found:', optText);
        break;
      }
    }
    
    // Pass 2: Case-insensitive + whitespace-normalized match (safe improvement)
    if (!matchedOption) {
      console.log('[Tier1] No exact match, trying case-insensitive normalized match...');
      for (const opt of allOptions) {
        const optText = opt.textContent;
        const normalizedOptText = normalizeText(optText);
        if (normalizedOptText === normalizedSearchText) {
          matchedOption = opt;
          matchType = 'case-insensitive';
          console.log('[Tier1] ✅ Case-insensitive match found:', optText?.trim(), '→', normalizedOptText);
          break;
        }
      }
    }
    
    // Pass 3: Check aria-label attribute (some dropdowns use this instead of text content)
    if (!matchedOption) {
      console.log('[Tier1] No text match, trying aria-label match...');
      for (const opt of allOptions) {
        const ariaLabel = opt.getAttribute('aria-label');
        const normalizedAriaLabel = normalizeText(ariaLabel);
        if (normalizedAriaLabel === normalizedSearchText) {
          matchedOption = opt;
          matchType = 'aria-label';
          console.log('[Tier1] ✅ Aria-label match found:', ariaLabel);
          break;
        }
      }
    }
    
    // Pass 4: Check data-value attribute (Salesforce Lightning uses this)
    if (!matchedOption) {
      console.log('[Tier1] No aria-label match, trying data-value match...');
      for (const opt of allOptions) {
        const dataValue = opt.getAttribute('data-value');
        const normalizedDataValue = normalizeText(dataValue);
        if (normalizedDataValue === normalizedSearchText) {
          matchedOption = opt;
          matchType = 'data-value';
          console.log('[Tier1] ✅ Data-value match found:', dataValue);
          break;
        }
      }
    }
    
    // Log available options for debugging if no match found
    if (!matchedOption) {
      console.log('[Tier1] ⚠️ No DOM match found. Available options:');
      allOptions.slice(0, 20).forEach((opt, i) => {
        console.log(`  ${i}: text="${opt.textContent?.trim()?.substring(0, 50)}" aria-label="${opt.getAttribute('aria-label')}" data-value="${opt.getAttribute('data-value')}"`);
      });
      if (allOptions.length > 20) {
        console.log(`  ... and ${allOptions.length - 20} more`);
      }
    } else {
      console.log(`[Tier1] ✅ Found option via ${matchType} match`);
    }
    
    // STRATEGY 2: Use resolver as fallback (only if DOM search failed)
    if (!matchedOption) {
      console.log('[Tier1] Strategy 2: Using resolver...');
      const optionTarget: SemanticTarget = {
        role: 'option',
        text: option,
      };
      
      const bundle = this.buildLocatorBundle(optionTarget);
      bundle.recordedFallbackSelectors = []; // Clear recorded selectors
      console.log('[Tier1] Cleared recorded fallback selectors (using fresh search)');
      
      const intent: Intent = { kind: 'SELECT_DROPDOWN_OPTION', optionVar: 'option' };
      const resolveResult = await this.resolveElement(bundle, intent);
      
      if (resolveResult.status === 'success') {
        matchedOption = resolveResult.details.element!;
        // Track selector success (async, non-blocking)
        if (optionTarget.recordedFallbackSelectors && optionTarget.recordedFallbackSelectors.length > 0) {
          const selector = optionTarget.recordedFallbackSelectors[0];
          const url = window.location.href;
          SelectorReliability.trackResult(selector, url, true).catch(() => {});
        }
      } else {
        console.log('[Tier1] ⚠️ Resolver failed to find option, trying decision space...');
      }
    }
    
    // STRATEGY 3: Use decision space as fallback
    // The decision space contains all options that were available when the step was recorded
    // This helps validate we're looking at the right dropdown and can find the option by index
    if (!matchedOption && decisionSpace?.options && decisionSpace.options.length > 0) {
      console.log('[Tier1] Strategy 3: Using decision space fallback...');
      console.log('[Tier1] Decision space has', decisionSpace.options.length, 'recorded options');
      
      // First, verify we're looking at the right dropdown by checking overlap with available options
      const availableTexts = allOptions.map(opt => normalizeText(opt.textContent)).filter(Boolean);
      const recordedTexts = decisionSpace.options.map((opt: string) => normalizeText(opt));
      
      // Count how many recorded options match available options
      const matchCount = recordedTexts.filter((rt: string) => availableTexts.includes(rt)).length;
      const matchRatio = matchCount / recordedTexts.length;
      
      console.log(`[Tier1] Decision space overlap: ${matchCount}/${recordedTexts.length} (${(matchRatio * 100).toFixed(0)}%)`);
      
      if (matchRatio >= 0.5) {
        // Good overlap - this is likely the correct dropdown
        console.log('[Tier1] ✅ Decision space validates this is the correct dropdown');
        
        // Try to find the option by recorded index if available
        if (decisionSpace.selectedIndex !== undefined && decisionSpace.selectedIndex >= 0) {
          const recordedOptionText = decisionSpace.options[decisionSpace.selectedIndex];
          console.log(`[Tier1] Trying recorded index ${decisionSpace.selectedIndex}: "${recordedOptionText}"`);
          
          // Search for this option in allOptions
          for (const opt of allOptions) {
            const optText = normalizeText(opt.textContent);
            if (optText === normalizeText(recordedOptionText)) {
              matchedOption = opt;
              matchType = 'decision-space-index';
              console.log('[Tier1] ✅ Found option via decision space index');
              break;
            }
          }
        }
        
        // If index didn't work, try fuzzy matching with all decision space options
        if (!matchedOption) {
          for (const recordedOpt of decisionSpace.options) {
            const normalizedRecorded = normalizeText(recordedOpt);
            if (normalizedRecorded.includes(normalizedSearchText) || normalizedSearchText.includes(normalizedRecorded)) {
              // Found a fuzzy match - now find this in the DOM
              for (const opt of allOptions) {
                const optText = normalizeText(opt.textContent);
                if (optText === normalizedRecorded) {
                  matchedOption = opt;
                  matchType = 'decision-space-fuzzy';
                  console.log(`[Tier1] ✅ Found option via decision space fuzzy match: "${recordedOpt}"`);
                  break;
                }
              }
              if (matchedOption) break;
            }
          }
        }
      } else {
        console.log('[Tier1] ⚠️ Low decision space overlap - may be wrong dropdown');
      }
    }
    
    // STRATEGY 4: Last resort - click by position in the visible menu
    if (!matchedOption && visibleMenu) {
      console.log('[Tier1] Strategy 4: Trying to click by text in visible menu...');
      const menuItems = MenuDetector.extractMenuItems(visibleMenu);
      console.log(`[Tier1] Visible menu has ${menuItems.length} items`);
      
      for (const item of menuItems) {
        const itemText = normalizeText(item.textContent);
        if (itemText === normalizedSearchText || itemText.includes(normalizedSearchText)) {
          matchedOption = item;
          matchType = 'menu-item-text';
          console.log(`[Tier1] ✅ Found option in visible menu: "${item.textContent?.trim()}"`);
          break;
        }
      }
    }
    
    // STRATEGY 5: Fuzzy matching as final fallback before giving up
    // Uses intelligent matching to handle typos, partial matches, multilingual content
    if (!matchedOption && allOptions.length > 0) {
      console.log('[Tier1] Strategy 5: Trying fuzzy option matching...');

      // Extract option texts from DOM elements
      const optionTexts = allOptions
        .map(opt => opt.textContent?.trim())
        .filter((text): text is string => !!text);

      if (optionTexts.length > 0) {
        const fuzzyResult = findBestMatch(option, optionTexts);
        console.log('[Tier1] Fuzzy match result:', {
          matchedOption: fuzzyResult.matchedOption,
          confidence: fuzzyResult.confidence,
          matchType: fuzzyResult.matchType,
          needsLLM: fuzzyResult.needsLLM,
          needsConfirmation: fuzzyResult.needsConfirmation,
        });

        // HIGH CONFIDENCE: Auto-select if match is very strong
        if (fuzzyResult.matchedOption && fuzzyResult.confidence >= 0.85 && !fuzzyResult.needsConfirmation) {
          console.log(`[Tier1] ✅ High confidence fuzzy match (${(fuzzyResult.confidence * 100).toFixed(0)}%): "${fuzzyResult.matchedOption}"`);

          // Find the element for this option
          for (const opt of allOptions) {
            if (opt.textContent?.trim() === fuzzyResult.matchedOption) {
              matchedOption = opt;
              matchType = 'fuzzy-high-confidence';
              break;
            }
          }
        }
        // MEDIUM/LOW CONFIDENCE: Request user confirmation
        else if (fuzzyResult.needsConfirmation || fuzzyResult.needsLLM || fuzzyResult.confidence < 0.85) {
          console.log('[Tier1] 🔄 Fuzzy match needs confirmation, returning OPTION_CONFIRMATION_NEEDED');

          // Build alternatives list with pre-selection flag
          const alternatives = fuzzyResult.allScores
            .filter(s => s.score >= 0.30) // Only show reasonable matches
            .slice(0, 5) // Limit to top 5
            .map(s => ({
              option: s.option,
              confidence: s.score,
              preSelected: s.score >= 0.80, // Pre-check items above 80%
            }));

          // Close dropdown before returning (we'll reopen after user confirms)
          await this.closeAnyOpenDropdown();

          return {
            status: 'rejected',
            code: 'OPTION_CONFIRMATION_NEEDED',
            details: {
              fuzzyMatchResult: {
                userInput: option,
                suggestedOption: fuzzyResult.matchedOption,
                confidence: fuzzyResult.confidence,
                alternatives,
                allOptions: optionTexts,
                fieldName: target?.name || target?.text || 'dropdown',
              },
            },
            message: `Option "${option}" needs confirmation (best match: "${fuzzyResult.matchedOption}" at ${(fuzzyResult.confidence * 100).toFixed(0)}%)`,
          };
        }
      }
    }

    if (!matchedOption) {
      console.error('[Tier1] ❌ Failed to find option after all strategies:', option);
      console.error('[Tier1] Available options:', Array.from(allOptions).map(o => o.textContent?.trim()));
      // CLEANUP: Close dropdown before returning failure
      await this.closeAnyOpenDropdown();
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: `Option "${option}" not found in dropdown`,
      };
    }
    
    console.log('[Tier1] ✅ Found option element, clicking:', option);
    this.clickElement(matchedOption);
    
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });
    
    return {
      status: 'success',
      details: { element: matchedOption },
    };
  }

  /**
   * Execute multi-select operation
   * Handles selecting multiple items based on different selection modes:
   * - first: Click first matching element (default)
   * - all: Click ALL matching elements (checkboxes, multi-select lists)
   * - matching: Click elements whose text matches a pattern
   * - count: Click exactly N items
   */
  private static async executeMultiSelect(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, selectionMode = 'first', matchPattern = 'contains', selectCount, option } = action.params;

    console.log('[Tier1] 🎯 Executing MULTI_SELECT');
    console.log('[Tier1] Selection mode:', selectionMode);
    console.log('[Tier1] Match pattern:', matchPattern);
    console.log('[Tier1] Select count:', selectCount);
    console.log('[Tier1] Target value:', option || target?.text || target?.name);

    // Find all candidate elements
    const candidates = await this.findMultiSelectCandidates(target, option);
    console.log(`[Tier1] Found ${candidates.length} candidates`);

    if (candidates.length === 0) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: { triedStrategies: ['multi-select candidate search'] },
        message: 'No matching elements found for multi-select',
      };
    }

    let selectedCount = 0;
    const selectedElements: Element[] = [];

    switch (selectionMode) {
      case 'first':
        // Click first match only
        this.clickElement(candidates[0]);
        selectedCount = 1;
        selectedElements.push(candidates[0]);
        console.log('[Tier1] ✅ Selected first item');
        break;

      case 'all':
        // Click ALL matching elements
        for (const candidate of candidates) {
          this.clickElement(candidate);
          selectedElements.push(candidate);
          selectedCount++;
          await this.sleep(100); // Brief pause between clicks
        }
        console.log(`[Tier1] ✅ Selected all ${selectedCount} items`);
        break;

      case 'matching':
        // Click elements whose text matches the pattern
        const targetText = option || target?.text || target?.name || '';
        const matchingElements = this.filterByPattern(candidates, targetText, matchPattern);

        for (const match of matchingElements) {
          this.clickElement(match);
          selectedElements.push(match);
          selectedCount++;
          await this.sleep(100);
        }
        console.log(`[Tier1] ✅ Selected ${selectedCount} matching items (pattern: ${matchPattern})`);
        break;

      case 'count':
        // Click exactly N items
        const count = selectCount || 1;
        const maxToSelect = Math.min(count, candidates.length);

        for (let i = 0; i < maxToSelect; i++) {
          this.clickElement(candidates[i]);
          selectedElements.push(candidates[i]);
          selectedCount++;
          await this.sleep(100);
        }
        console.log(`[Tier1] ✅ Selected ${selectedCount}/${count} items`);
        break;

      default:
        // Default to first
        this.clickElement(candidates[0]);
        selectedCount = 1;
        selectedElements.push(candidates[0]);
    }

    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });

    return {
      status: 'success',
      details: {
        selectedCount,
        elements: selectedElements,
        selectionMode,
      },
    };
  }

  /**
   * Find candidate elements for multi-select operations
   */
  private static async findMultiSelectCandidates(
    target: SemanticTarget | undefined,
    optionText: string | undefined
  ): Promise<Element[]> {
    const candidates: Element[] = [];

    // Common selectors for multi-select patterns
    const selectors = [
      '[role="checkbox"]',
      '[role="option"]',
      '[role="listitem"]',
      'input[type="checkbox"]',
      'li[data-selectable]',
      '[data-selectable="true"]',
    ];

    // If target has a scope hint, search within that container
    const scopeContainer = target?.scopeHint
      ? document.querySelector(`[aria-label*="${target.scopeHint}"], [data-testid*="${target.scopeHint.toLowerCase().replace(/\s+/g, '-')}"]`)
      : document.body;

    for (const selector of selectors) {
      const elements = (scopeContainer || document.body).querySelectorAll(selector);
      candidates.push(...Array.from(elements));
    }

    // Filter by option text if provided
    if (optionText) {
      const normalizedOption = optionText.toLowerCase().trim();
      return candidates.filter(el => {
        const text = el.textContent?.toLowerCase().trim() || '';
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase().trim() || '';
        return text.includes(normalizedOption) || ariaLabel.includes(normalizedOption);
      });
    }

    // Remove duplicates
    return [...new Set(candidates)];
  }

  /**
   * Filter elements by text pattern match
   */
  private static filterByPattern(
    elements: Element[],
    pattern: string,
    matchType: 'exact' | 'contains' | 'startsWith' | 'regex'
  ): Element[] {
    const normalizedPattern = pattern.toLowerCase().trim();

    return elements.filter(el => {
      const text = el.textContent?.toLowerCase().trim() || '';
      const ariaLabel = el.getAttribute('aria-label')?.toLowerCase().trim() || '';
      const combined = `${text} ${ariaLabel}`;

      switch (matchType) {
        case 'exact':
          return text === normalizedPattern || ariaLabel === normalizedPattern;
        case 'contains':
          return combined.includes(normalizedPattern);
        case 'startsWith':
          return text.startsWith(normalizedPattern) || ariaLabel.startsWith(normalizedPattern);
        case 'regex':
          try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(text) || regex.test(ariaLabel);
          } catch {
            console.warn('[Tier1] Invalid regex pattern:', pattern);
            return combined.includes(normalizedPattern);
          }
        default:
          return combined.includes(normalizedPattern);
      }
    });
  }

  /**
   * Execute scroll
   * MODAL-AWARE: Scrolls within modal if one is open, otherwise scrolls the page
   */
  private static async executeScroll(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { direction, amount = 300, scrollContainerSelector } = action.params;
    
    const scrollOptions: ScrollToOptions = { behavior: 'smooth' };
    let scrollTarget: Element | Window = window;
    
    // PRIORITY 1: Use recorded scroll container selector if provided
    // This is what the user recorded, so it should be used first!
    if (scrollContainerSelector) {
      try {
        const container = document.querySelector(scrollContainerSelector);
        if (container) {
          // Check if container is scrollable:
          // 1. Has overflow CSS allowing scroll, OR
          // 2. Has scrollable content (scrollHeight > clientHeight)
          const style = window.getComputedStyle(container);
          const hasOverflowCSS = style.overflow === 'auto' || style.overflow === 'scroll' || 
                                style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                                style.overflow === 'hidden'; // hidden can still be scrolled via JS
          const hasScrollableContent = container.scrollHeight > container.clientHeight;
          
          if (hasOverflowCSS || hasScrollableContent) {
            scrollTarget = container;
            console.log(`[Tier1] 📜 Using recorded scroll container: "${scrollContainerSelector}" (scrollHeight: ${container.scrollHeight}, clientHeight: ${container.clientHeight})`);
          } else {
            console.warn(`[Tier1] ⚠️ Recorded container "${scrollContainerSelector}" found but not scrollable`);
          }
        } else {
          console.warn(`[Tier1] ⚠️ Recorded scroll container "${scrollContainerSelector}" not found in DOM`);
        }
      } catch (e) {
        console.warn(`[Tier1] ⚠️ Invalid scroll container selector: "${scrollContainerSelector}"`);
      }
    }
    
    // PRIORITY 2: Check for ACTIVE DROPDOWN first - this takes precedence over everything!
    // Dropdowns are overlays that appear when user clicks a combobox/select
    if (scrollTarget === window) {
      const dropdownScrollTarget = this.findActiveDropdownForScroll();
      if (dropdownScrollTarget) {
        scrollTarget = dropdownScrollTarget;
        console.log('[Tier1] 📜 PRIORITY 2: Found active dropdown to scroll within');
      }
    }
    
    // PRIORITY 3: Check for ACTIVE MODAL - also takes precedence over auto-detection
    if (scrollTarget === window) {
      const modalScrollTarget = this.findActiveModalForScroll();
      if (modalScrollTarget) {
        scrollTarget = modalScrollTarget;
        console.log('[Tier1] 📜 PRIORITY 3: Found active modal to scroll within');
      }
    }
    
    // PRIORITY 4: Auto-detect scrollable container using SMART heuristics (FALLBACK)
    if (scrollTarget === window) {
      console.log('[Tier1] 📜 Auto-detecting scrollable container (fallback)...');
      
      // Strategy 1: Find ALL potentially scrollable elements
      const allElements = document.querySelectorAll('*');
      const scrollableCandidates: Array<{ element: Element; score: number; reason: string }> = [];
      
      for (const el of Array.from(allElements)) {
        const style = window.getComputedStyle(el);
        const hasScrollableContent = el.scrollHeight > el.clientHeight + 10; // +10px tolerance
        
        if (!hasScrollableContent) continue;
        
        // Check if it has overflow that allows scrolling
        const canScroll = style.overflow === 'auto' || style.overflow === 'scroll' || 
                         style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                         style.overflow === 'hidden'; // hidden can still be JS scrolled
        
        if (!canScroll) continue;
        
        // Score this candidate
        let score = 0;
        const className = el.className?.toString() || '';
        const tagName = el.tagName.toLowerCase();
        const rect = el.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        
        // CRITICAL: Heavily favor viewport-sized containers
        // Elements taking up most of the viewport are almost always the main scroll area
        const viewportCoverage = rect.height / viewportHeight;
        if (viewportCoverage > 0.8) score += 100; // Covers 80%+ of viewport
        else if (viewportCoverage > 0.6) score += 80; // Covers 60%+ of viewport
        else if (viewportCoverage > 0.4) score += 50; // Covers 40%+ of viewport
        else if (viewportCoverage > 0.2) score += 20; // Covers 20%+ of viewport
        
        // CRITICAL: Penalize tiny visible areas (e.g., dropdowns, small widgets)
        // If clientHeight < 100px, it's probably not the main scroll container
        if (el.clientHeight < 100) score -= 50;
        else if (el.clientHeight < 200) score -= 20;
        
        // Prefer elements with content-related classes
        if (className.includes('content')) score += 50;
        if (className.includes('main')) score += 40;
        if (className.includes('scroll')) score += 30;
        if (className.includes('wrapper')) score += 10; // Reduced - too generic
        if (className.includes('container')) score += 10;
        if (className.includes('page')) score += 15;
        if (className.includes('app')) score += 10;
        if (className.includes('viewer')) score += 25;
        if (className.includes('renderer')) score += 25;
        
        // Gainsight-specific: gridster is the main dashboard container
        if (className.includes('gridster')) score += 60;
        
        // Prefer semantic elements
        if (tagName === 'main') score += 60;
        if (el.getAttribute('role') === 'main') score += 55;
        
        // Prefer elements with large scrollable area (actual content)
        const scrollableHeight = el.scrollHeight - el.clientHeight;
        if (scrollableHeight > 500) score += 30;
        else if (scrollableHeight > 200) score += 20;
        else if (scrollableHeight > 100) score += 10;
        
        // Deprioritize body (too generic)
        if (tagName === 'body') score -= 20;
        
        // Deprioritize filter/dropdown/navigation elements
        if (className.includes('filter') || className.includes('dropdown') || className.includes('nav')) {
          score -= 30;
        }
        
        // Only consider elements with reasonable score
        if (score > 0) {
          scrollableCandidates.push({
            element: el,
            score,
            reason: `${tagName}.${className.split(' ')[0] || 'no-class'} (scrollHeight: ${el.scrollHeight}, clientHeight: ${el.clientHeight})`,
          });
        }
      }
      
      // Sort by score and pick the best
      if (scrollableCandidates.length > 0) {
        scrollableCandidates.sort((a, b) => b.score - a.score);
        scrollTarget = scrollableCandidates[0].element;
        console.log(`[Tier1] 📜 Smart-detected scrollable container (score: ${scrollableCandidates[0].score}): ${scrollableCandidates[0].reason}`);
        
        // Log top 3 candidates for debugging
        if (scrollableCandidates.length > 1) {
          console.log(`[Tier1] 📜 Other candidates:`, scrollableCandidates.slice(1, 3).map(c => `${c.reason} (score: ${c.score})`));
        }
      } else {
        console.log('[Tier1] ⚠️ No scrollable container detected, will scroll window');
      }
    }
    
    // Perform scroll
    if (scrollTarget === window) {
      console.log(`[Tier1] 📜 Scrolling window ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          window.scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          window.scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          window.scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          window.scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    } else {
      const targetName = scrollContainerSelector || 'container';
      console.log(`[Tier1] 📜 Scrolling ${targetName} ${direction} by ${amount}px`);
      switch (direction) {
        case 'down':
          (scrollTarget as Element).scrollBy({ top: amount, ...scrollOptions });
          break;
        case 'up':
          (scrollTarget as Element).scrollBy({ top: -amount, ...scrollOptions });
          break;
        case 'right':
          (scrollTarget as Element).scrollBy({ left: amount, ...scrollOptions });
          break;
        case 'left':
          (scrollTarget as Element).scrollBy({ left: -amount, ...scrollOptions });
          break;
      }
    }
    
    // Wait for scroll animation to complete (optimized from 300ms)
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Wait for lazy-loaded content to render (critical for dashboards like Gainsight!)
    // Use StateWaitEngine to wait for actual DOM stability
    try {
      const { StateWaitEngine } = await import('../content/state-wait-engine');
      const stabilityResult = await StateWaitEngine.waitForStability({
        domQuietMs: 800,      // Wait 800ms of no DOM changes
        networkQuietMs: 1000, // Wait 1s of no network activity  
        maxWaitMs: 5000,      // Max 5s total wait
        checkSpinners: true,  // Wait for loading spinners
      });
      console.log('[Tier1] 📜 Post-scroll stability:', 
        stabilityResult.domStable ? '✅ DOM stable' : '⚠️ DOM changing',
        stabilityResult.spinnersGone ? '✅ No spinners' : '⚠️ Loading'
      );
    } catch (e) {
      // Fallback if StateWaitEngine not available
      console.log('[Tier1] ⚠️ StateWaitEngine not available, using 2s delay');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return { status: 'success', details: {} };
  }
  
  /**
   * Find active dropdown for scrolling
   * Checks for visible listbox/menu elements that are scrollable
   */
  private static findActiveDropdownForScroll(): Element | null {
    const dropdownSelectors = [
      '[role="listbox"]',
      '[role="menu"]',
      '[role="menubar"]',
      '.MuiMenu-list',
      '.MuiAutocomplete-listbox',
      '.ant-select-dropdown',
      '.ant-dropdown-menu',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
      '[class*="listbox"]',
      '[class*="Listbox"]',
    ];
    
    for (const selector of dropdownSelectors) {
      try {
        const dropdowns = Array.from(document.querySelectorAll(selector));
        for (const dropdown of dropdowns) {
          const style = window.getComputedStyle(dropdown);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          const rect = dropdown.getBoundingClientRect();
          const hasSize = rect.width > 50 && rect.height > 30;
          
          if (isVisible && hasSize) {
            // Check if this dropdown is scrollable
            const isScrollable = (style.overflow === 'auto' || style.overflow === 'scroll' || 
                                 style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                 dropdown.scrollHeight > dropdown.clientHeight + 10;
            
            if (isScrollable) {
              console.log(`[Tier1] 📜 Found scrollable dropdown (${selector}): scrollHeight=${dropdown.scrollHeight}, clientHeight=${dropdown.clientHeight}`);
              return dropdown;
            }
            
            // Also check children for scrollable container
            const scrollableChild = this.findScrollableContainer(dropdown);
            if (scrollableChild) {
              console.log(`[Tier1] 📜 Found scrollable container inside dropdown`);
              return scrollableChild;
            }
          }
        }
      } catch {
        // Invalid selector
      }
    }
    return null;
  }
  
  /**
   * Find active modal for scrolling
   * Checks for visible dialog/modal elements that have scrollable content
   */
  private static findActiveModalForScroll(): Element | null {
    const modalSelectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '[class*="Modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
      '[class*="popup"]',
      '[class*="Popup"]',
    ];
    
    for (const selector of modalSelectors) {
      try {
        const modals = Array.from(document.querySelectorAll(selector));
        for (const modal of modals) {
          const style = window.getComputedStyle(modal);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          const zIndex = parseInt(style.zIndex) || 0;
          
          if (isVisible && zIndex > 50) {
            // Found an active modal - look for scrollable container within it
            const scrollableContainer = this.findScrollableContainer(modal);
            if (scrollableContainer) {
              console.log('[Tier1] 📜 Found scrollable modal container');
              return scrollableContainer;
            }
          }
        }
      } catch {
        // Invalid selector
      }
    }
    return null;
  }

  /**
   * Find scrollable container within an element
   */
  private static findScrollableContainer(element: Element): Element | null {
    // Check if element itself is scrollable
    const style = window.getComputedStyle(element);
    const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                        style.overflowY === 'auto' || style.overflowY === 'scroll';
    
    if (isScrollable && element.scrollHeight > element.clientHeight) {
      return element;
    }
    
    // Look for scrollable children
    const children = Array.from(element.querySelectorAll('*'));
    for (const child of children) {
      const childStyle = window.getComputedStyle(child);
      const isChildScrollable = childStyle.overflow === 'auto' || childStyle.overflow === 'scroll' || 
                               childStyle.overflowY === 'auto' || childStyle.overflowY === 'scroll';
      
      if (isChildScrollable && child.scrollHeight > child.clientHeight) {
        return child;
      }
    }
    
    return null;
  }

  /**
   * Execute navigation
   * @deprecated Direct URL navigation is deprecated - use click-through instead.
   * All NAVIGATION steps should be converted to CLICK actions in the agent.
   * This prevents navigating to stale URLs (e.g., wrong account IDs).
   */
  private static async executeNavigate(action: AgentAction): Promise<Tier1ExecutionResult> {
    console.warn('[Tier1] ⚠️ Direct navigation is DEPRECATED - should use click-through instead');
    console.warn('[Tier1] ⚠️ NAVIGATION steps should be converted to CLICK in extractHints()');
    
    const { url } = action.params;
    
    if (!url) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No URL specified (direct navigation is deprecated - use click-through)',
      };
    }
    
    // Still allow it for backwards compatibility, but warn
    console.warn(`[Tier1] ⚠️ Navigating directly to: ${url} (this should not happen in normal operation)`);
    window.location.href = url;
    
    return { status: 'success', details: {} };
  }

  /**
   * Execute wait
   */
  private static async executeWait(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { duration = 1000, waitFor } = action.params;
    
    if (waitFor) {
      const startTime = Date.now();
      const timeout = duration || 5000;
      
      while (Date.now() - startTime < timeout) {
        if (document.body.textContent?.includes(waitFor)) {
          return { status: 'success', details: {} };
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      return {
        status: 'rejected',
        code: 'OUTCOME_FAILED',
        details: { outcomeResult: `Timeout waiting for: ${waitFor}` },
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, duration));
    return { status: 'success', details: {} };
  }

  /**
   * Execute assertion
   */
  private static async executeAssert(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { assertion } = action.params;
    
    if (!assertion) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No assertion specified',
      };
    }
    
    if (document.body.textContent?.includes(assertion)) {
      return { status: 'success', details: {} };
    }
    
    return {
      status: 'rejected',
      code: 'OUTCOME_FAILED',
      details: { outcomeResult: `Assertion failed: "${assertion}" not found` },
    };
  }

  /**
   * Execute read action - query element values
   */
  private static async executeRead(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, attribute = 'value', x, y } = action.params;
    
    let element: Element | null = null;
    let resolveMetrics: any = undefined;
    const hasTarget = Boolean(target);

    if (typeof x === 'number' && typeof y === 'number') {
      element = document.elementFromPoint(x, y);
      resolveMetrics = { method: 'coordinate' };
    } else {
      if (!target) {
        return {
          status: 'rejected',
          code: 'NOT_FOUND',
          details: {},
          message: 'No target specified for read action',
        };
      }

      // Build locator bundle from semantic target
      const bundle = this.buildLocatorBundle(target);
      
      // Build intent for resolver
      const intent: Intent = { kind: 'CLICK' }; // Use CLICK intent for resolution
      
      // Resolve element
      const resolveResult = await this.resolveElement(bundle, intent);
      
      if (resolveResult.status !== 'success') {
        return resolveResult;
      }
      
      element = resolveResult.details.element!;
      resolveMetrics = resolveResult.details.resolveMetrics;
    }

    if (!element) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No element found for read action',
      };
    }
    
    // Read value based on attribute
    let value: string | boolean | number;
    try {
      switch (attribute) {
        case 'value':
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            value = element.value;
          } else {
            value = element.getAttribute('value') || '';
          }
          break;
        
        case 'text':
          value = element.textContent?.trim() || '';
          break;
        
        case 'checked':
          if (element instanceof HTMLInputElement) {
            value = element.checked;
          } else {
            value = element.getAttribute('aria-checked') === 'true';
          }
          break;
        
        case 'selected':
          if (element instanceof HTMLOptionElement) {
            value = element.selected;
          } else {
            value = element.getAttribute('aria-selected') === 'true';
          }
          break;
        
        case 'count':
          if (hasTarget) {
            const selector = target?.testId ? `[data-testid="${target.testId}"]` : 
                            target?.id ? `#${target.id}` : 
                            target?.role ? `[role="${target.role}"]` : '*';
            value = document.querySelectorAll(selector).length;
          } else if (element instanceof HTMLSelectElement) {
            value = element.options.length;
          } else {
            value = element.querySelectorAll ? element.querySelectorAll('*').length : 0;
          }
          break;

        case 'disabled':
          if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
            value = element.disabled;
          } else {
            value = element.getAttribute('aria-disabled') === 'true';
          }
          break;

        case 'visible': {
          if (!(element instanceof HTMLElement)) {
            value = false;
            break;
          }
          const style = window.getComputedStyle(element);
          value = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          break;
        }
        
        default:
          value = '';
      }
      
      console.log(`[Tier1] 📖 Read ${attribute} from element: ${value}`);
      
      return {
        status: 'success',
        details: {
          element,
          value, // Store the read value in details
          resolveMetrics,
        },
      };
    } catch (error) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: error instanceof Error ? error.message : 'Failed to read value',
      };
    }
  }

  /**
   * Execute keyboard action - Tab, Enter, Escape, shortcuts
   */
  private static async executeKeyboard(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { key, modifiers = [], repeat = 1, target } = action.params;
    
    if (!key) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No key specified for keyboard action',
      };
    }
    
    // Focus target element if specified
    if (target) {
      const bundle = this.buildLocatorBundle(target);
      const result = await this.resolveElement(bundle, { kind: 'CLICK' });
      if (result.status === 'success' && result.details.element instanceof HTMLElement) {
        result.details.element.focus();
        await this.sleep(50);
      }
    }
    
    // Dispatch keyboard events
    const eventInit: KeyboardEventInit = {
      key,
      code: this.keyToCode(key),
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers.includes('ctrl'),
      shiftKey: modifiers.includes('shift'),
      altKey: modifiers.includes('alt'),
      metaKey: modifiers.includes('meta'),
    };
    
    console.log(`[Tier1] ⌨️ Pressing key: ${key}${modifiers.length > 0 ? ' with ' + modifiers.join('+') : ''} (${repeat}x)`);
    
    for (let i = 0; i < repeat; i++) {
      const activeElement = document.activeElement || document.body;
      activeElement.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      activeElement.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      activeElement.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      await this.sleep(50);
    }
    
    // Wait for stability after keyboard action
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });
    
    return {
      status: 'success',
      details: {},
    };
  }

  /**
   * Write text to clipboard with fallback for content scripts
   * Uses Clipboard API first, falls back to execCommand with temp textarea
   */
  private static async writeToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      console.log('[Tier1] 📋 Text written to clipboard via Clipboard API');
      return true;
    } catch {
      console.log('[Tier1] 📋 Clipboard API failed, using execCommand fallback');
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      console.log(`[Tier1] 📋 execCommand copy result: ${success}`);
      return success;
    }
  }

  /**
   * Execute copy action - select text and copy to clipboard
   */
  private static async executeCopy(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, text, selectAll, selectionRange, cellRef } = action.params;

    // SPREADSHEET FAST PATH: If we have a cell reference, use SpreadsheetExecutor
    if (cellRef && SheetStateExtractor.isSpreadsheetDomain()) {
      console.log(`[Tier1] 📋 COPY with cellRef ${cellRef} - using SpreadsheetExecutor`);
      try {
        const spreadsheetResult = await SpreadsheetExecutor.execute({
          action: 'read_cell',
          cellRef: cellRef,
        });

        if (spreadsheetResult.success && spreadsheetResult.value) {
          // Write the cell value to clipboard
          const cellValue = spreadsheetResult.value;
          console.log(`[Tier1] 📋 Read cell ${cellRef} value: "${cellValue.substring(0, 50)}"`);

          await this.writeToClipboard(cellValue);
          return { status: 'success', details: { value: cellValue } };
        } else {
          console.warn('[Tier1] 📋 SpreadsheetExecutor read_cell failed:', spreadsheetResult.error);
          // Fall through to element-based copy
        }
      } catch (error) {
        console.warn('[Tier1] 📋 SpreadsheetExecutor error:', error);
        // Fall through to element-based copy
      }
    }

    if (!target && !text) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target or text specified for copy action',
      };
    }

    let element: HTMLElement | null = null;

    // Resolve target element if specified
    if (target) {
      const bundle = this.buildLocatorBundle(target);
      const result = await this.resolveElement(bundle, { kind: 'CLICK' });
      if (result.status === 'success' && result.details.element instanceof HTMLElement) {
        element = result.details.element;
      } else {
        // Element not found - for spreadsheets, try using keyboard shortcut on current selection
        const isSpreadsheet = window.location.hostname.includes('docs.google.com') ||
                              window.location.hostname.includes('sheets.google.com') ||
                              window.location.hostname.includes('excel.');
        if (isSpreadsheet && text) {
          console.log('[Tier1] 📋 COPY element not found on spreadsheet - using Ctrl+C on current selection');
          // Try keyboard copy on current selection
          document.execCommand('copy');
          await this.sleep(100);
          // Verify clipboard has content
          try {
            const clipboardText = await navigator.clipboard.readText();
            if (clipboardText && clipboardText.trim()) {
              console.log('[Tier1] 📋 Keyboard copy succeeded:', clipboardText.substring(0, 30));
              return { status: 'success', details: { value: clipboardText } };
            }
          } catch {
            // Clipboard read failed, continue to use stored text
          }
          // If keyboard copy didn't work, fall back to stored text
          console.log('[Tier1] 📋 Falling back to stored text for clipboard');
          await this.writeToClipboard(text);
          return { status: 'success', details: { value: text } };
        }
        return result;
      }
    }

    // If we have an element, focus it and select text
    if (element) {
      element.focus();
      await this.sleep(50);

      // Select text based on selection mode
      if (selectAll !== false) {
        // Select all content by default
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.select();
        } else {
          // Use Selection API for other elements
          const range = document.createRange();
          range.selectNodeContents(element);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        }
      } else if (selectionRange) {
        // Select specific range
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.setSelectionRange(selectionRange.start, selectionRange.end);
        }
      }
      await this.sleep(50);
    }

    // Copy to clipboard
    const textToCopy = text || window.getSelection()?.toString() || '';

    if (!textToCopy) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No text to copy',
      };
    }

    console.log(`[Tier1] 📋 Copying text: "${textToCopy.substring(0, 50)}${textToCopy.length > 50 ? '...' : ''}"`);

    // Use universal clipboard helper (handles Clipboard API + execCommand fallback)
    await this.writeToClipboard(textToCopy);

    // Wait for stability
    await StateWaitEngine.waitForStability({
      domQuietMs: 100,
      maxWaitMs: 1000,
    });

    return {
      status: 'success',
      details: { value: textToCopy },
    };
  }

  /**
   * Execute paste action
   * - Linked PASTE (has linkedCopyStepId): Read from system clipboard (COPY step should have populated it)
   * - Standalone PASTE: Use stored text value
   */
  private static async executePaste(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, text, linkedCopyStepId } = action.params;

    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified for paste action',
      };
    }

    // Resolve target element
    const bundle = this.buildLocatorBundle(target);
    const result = await this.resolveElement(bundle, { kind: 'TYPE', valueVar: text || '' });

    if (result.status !== 'success' || !(result.details.element instanceof HTMLElement)) {
      return result;
    }

    const element = result.details.element;
    element.focus();
    await this.sleep(50);

    // Get text to paste based on whether this is a linked paste or standalone
    let textToPaste = '';

    if (linkedCopyStepId) {
      // LINKED PASTE: The preceding COPY step should have populated the clipboard
      console.log(`[Tier1] 📋 Linked PASTE (copy step: ${linkedCopyStepId}) - reading from clipboard`);
      try {
        textToPaste = await navigator.clipboard.readText();
        console.log('[Tier1] 📋 Read from clipboard:', textToPaste.substring(0, 50));
      } catch (clipboardError) {
        console.warn('[Tier1] 📋 Clipboard read failed for linked paste:', clipboardError);
        // For linked paste, fall back to stored text if available
        if (text) {
          console.log('[Tier1] 📋 Falling back to stored text');
          textToPaste = text;
        } else {
          return {
            status: 'rejected',
            code: 'UNSAFE_ACTION',
            details: { dangerousPattern: 'Clipboard access denied for linked paste' },
            message: 'Failed to read clipboard for linked paste - COPY step may not have executed',
          };
        }
      }
    } else {
      // STANDALONE PASTE: Use stored text, fall back to clipboard
      textToPaste = text || '';
      if (!textToPaste) {
        try {
          textToPaste = await navigator.clipboard.readText();
          console.log('[Tier1] 📋 Read text from clipboard (standalone paste)');
        } catch (clipboardError) {
          console.log('[Tier1] 📋 Clipboard read failed, no stored text available');
          return {
            status: 'rejected',
            code: 'NOT_FOUND',
            details: {},
            message: 'No text available to paste (clipboard access denied and no stored text)',
          };
        }
      }
    }

    console.log(`[Tier1] 📋 Pasting text: "${textToPaste.substring(0, 50)}${textToPaste.length > 50 ? '...' : ''}"`);

    // Insert text based on element type
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      // For input/textarea: set value using native setter (React-friendly)
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, textToPaste);
      } else {
        element.value = textToPaste;
      }

      // Dispatch input events
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } else if (element.isContentEditable) {
      // For contenteditable: use execCommand
      document.execCommand('insertText', false, textToPaste);
    } else {
      // Generic fallback
      element.textContent = textToPaste;
    }

    // Wait for stability
    await StateWaitEngine.waitForStability({
      domQuietMs: 150,
      maxWaitMs: 2000,
    });

    return {
      status: 'success',
      details: { value: textToPaste },
    };
  }

  /**
   * Execute hover action - reveal hover-activated menus
   */
  private static async executeHover(action: AgentAction): Promise<Tier1ExecutionResult> {
    const { target, hoverDuration = 500, waitForMenu = true } = action.params;
    
    if (!target) {
      return {
        status: 'rejected',
        code: 'NOT_FOUND',
        details: {},
        message: 'No target specified for hover action',
      };
    }
    
    // Build locator bundle from semantic target
    const bundle = this.buildLocatorBundle(target);
    
    // Build intent for resolver
    const intent: Intent = { kind: 'CLICK' };
    
    // Resolve element
    const resolveResult = await this.resolveElement(bundle, intent);
    
    if (resolveResult.status !== 'success') {
      return resolveResult;
    }
    
    const element = resolveResult.details.element!;
    
    // Check interactability
    const interactabilityCheck = await this.checkInteractability(element);
    if (!interactabilityCheck.success) {
      return {
        status: 'rejected',
        code: 'NOT_INTERACTABLE',
        details: {
          interactabilityIssue: interactabilityCheck.reason,
          element,
        },
        message: interactabilityCheck.reason,
      };
    }
    
    // Get element coordinates
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    console.log(`[Tier1] 🖱️ Hovering over element for ${hoverDuration}ms`);
    
    // Dispatch mouse events for hover
    element.dispatchEvent(new MouseEvent('mouseenter', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    element.dispatchEvent(new MouseEvent('mouseover', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    element.dispatchEvent(new MouseEvent('mousemove', { 
      bubbles: true, 
      cancelable: true,
      view: window,
      clientX: x, 
      clientY: y 
    }));
    
    // Hold hover for duration
    await this.sleep(hoverDuration);
    
    // Optionally wait for menu to appear
    if (waitForMenu) {
      await StateWaitEngine.waitForStability({ 
        domQuietMs: 200, 
        maxWaitMs: 2000 
      });
    }
    
    return {
      status: 'success',
      details: {
        element,
        resolveMetrics: resolveResult.details.resolveMetrics,
      },
    };
  }

  // ============================================================================
  // Helper Methods - Integration with Reliable Replayer
  // ============================================================================

  /**
   * Resolve element using the Resolver with proper scoping
   */
  private static async resolveElement(
    bundle: LocatorBundle,
    intent: Intent
  ): Promise<Tier1ExecutionResult> {
    console.log('[Tier1] Resolving element with', bundle.strategies.length, 'strategies');
    
      // PRIORITY 1: Try recorded fallback selectors FIRST!
      // But sort them by SPECIFICITY - specific selectors should come before broad container XPaths
      // NOTE: 2 days ago, this worked for menu items with fuzzy text matching - we should try it first
      
      // CRITICAL: For menu items, check if dropdown menu is visible first
      const targetRole = bundle.strategies.find(s => s.type === 'role')?.value;
      const rolePart = targetRole?.split(':')[0];
      const isMenuItem = rolePart === 'menuitem' || rolePart === 'option';
      
      if (isMenuItem) {
        const { MenuDetector } = await import('../content/menu-detector');
        
        // CRITICAL: First check if menu is already visible (menu might already be open)
        let menu = MenuDetector.findVisibleMenu();
        
        // #region agent log
        const nameStrategy = bundle.strategies.find(s => (s.type as string) === 'name' || (s.type as string) === 'text' || (s.type as string) === 'aria-label');
        fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1083',message:'MENU_ITEM_RESOLVE_START',data:{menuFound:!!menu,menuOptionsCount:menu ? MenuDetector.extractMenuItems(menu).length : 0,targetName:nameStrategy?.value?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        if (menu) {
          const items = MenuDetector.extractMenuItems(menu);
          console.log(`[Tier1] ✅ Menu already visible: ${menu.tagName}.${menu.className.substring(0, 30)} with ${items.length} items`);
        } else {
          console.warn(`[Tier1] ⚠️ Menu item resolution attempted but no dropdown menu is visible! Waiting for menu...`);
          // Menu not visible yet - wait for it to appear (e.g., after clicking trigger)
          const waitResult = await MenuDetector.waitForMenu(2000);
          menu = waitResult.menu;
          if (menu) {
            console.log(`[Tier1] ✅ Menu found via ${waitResult.method} (${waitResult.confidence} confidence) with ${MenuDetector.extractMenuItems(menu).length} items`);
          } else {
            console.error(`[Tier1] ❌ Menu never appeared - menu items won't be findable!`);
          }
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1075',message:'RESOLVE_ELEMENT_START',data:{hasFallbackSelectors:!!bundle.recordedFallbackSelectors,fallbackCount:bundle.recordedFallbackSelectors?.length || 0,strategiesCount:bundle.strategies.length,scopeHint:bundle.scopeHint,isMenuItem},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    if (bundle.recordedFallbackSelectors && bundle.recordedFallbackSelectors.length > 0) {
      console.log(`[Tier1] 🎯 Trying ${bundle.recordedFallbackSelectors.length} recorded fallback selectors...`);
      
      // 🎯 HYBRID SORTING: First by reliability (learned success rate), then by specificity
      // This ensures we try selectors that have worked before AND are specific
      const url = window.location.href;
      const selectorsWithScores = await Promise.all(
        bundle.recordedFallbackSelectors.map(async (selector) => ({
          selector,
          reliabilityScore: await SelectorReliability.getReliabilityScore(selector, url),
        }))
      );
      
      const sortedSelectors = selectorsWithScores.sort((a, b) => {
        const scoreSelector = (sel: string): number => {
          // Highest priority: Shadow-piercing selectors with aria-label (very specific)
          // These target a specific element inside a specific shadow host
          if (sel.includes(' >> ') && sel.includes('[aria-label=')) return 110;
          if (sel.includes(' >> ')) return 105;
          
          // High priority: Attribute-based selectors (very specific)
          if (sel.includes('[aria-label=')) return 100;
          if (sel.includes('[title=')) return 95;
          if (sel.includes('[data-testid=') || sel.includes('[data-test-id=')) return 90;
          if (sel.includes('[id=')) return 85;
          if (sel.includes('[name=')) return 80;
          
          // Medium priority: XPath with exact text match
          if (sel.includes('[normalize-space(text())=') || sel.includes('[text()=')) return 70;
          if (sel.includes("normalize-space(.)=\"") || sel.includes("text()=\"")) return 65;
          
          // Lower priority: Contains-based selectors (can match multiple)
          if (sel.includes('contains(normalize-space(.)') && !sel.includes('//button') && !sel.includes('//a')) return 50;
          
          // Lowest priority: Container + element type (e.g., //section[...]//button)
          // These are the MOST DANGEROUS - they match the first element in a container!
          if ((sel.includes('//section') || sel.includes('//div')) && 
              (sel.includes('//button') || sel.includes('//a') || sel.includes('//input'))) {
            return 10; // Very low - try last
          }
          
          // Default: medium-low priority
          return 40;
        };
        
        // Hybrid scoring: Reliability (0-1) * 100 + Specificity (0-110)
        // This gives reliability slightly more weight than specificity
        const scoreA = a.reliabilityScore * 100 + scoreSelector(a.selector);
        const scoreB = b.reliabilityScore * 100 + scoreSelector(b.selector);
        
        return scoreB - scoreA; // Higher score first
      }).map(s => s.selector); // Extract just the selector string
      
      console.log(`[Tier1] 📊 Sorted selectors by reliability + specificity (first 3):`, sortedSelectors.slice(0, 3).map(s => s.substring(0, 50)));
      
      // 🎯 CRITICAL: Get expected text from bundle for verification
      // Fallback selectors can match the wrong element (e.g., first button in a section)
      // We MUST verify the element text/aria-label matches before accepting!
      const expectedText = bundle.strategies
        .filter(s => s.type === 'aria' || s.type === 'text')
        .map(s => s.value.toLowerCase().trim())
        .filter(Boolean);
      
      for (const selector of sortedSelectors) {
        try {
          let element: Element | null = null;
          
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1109',message:'TRYING_FALLBACK_SELECTOR',data:{selector:selector.substring(0,100),selectorIndex:sortedSelectors.indexOf(selector),totalSelectors:sortedSelectors.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          
          if (selector.startsWith('//') || selector.startsWith('(//')) {
            // XPath selector
            const result = document.evaluate(
              selector,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null
            );
            element = result.singleNodeValue as Element | null;
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1118',message:'XPATH_SELECTOR_RESULT',data:{found:!!element,elementText:element?.textContent?.trim()?.substring(0,50),elementTag:element?.tagName},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          } else if (selector.includes(' >> ')) {
            // Shadow-piercing selector (e.g., "gs-report-widget-element >> [aria-label='More Options']")
            console.log(`[Tier1] 🌑 Trying shadow-piercing selector: ${selector.substring(0, 60)}`);
            const parts = selector.split(' >> ');
            if (parts.length === 2) {
              let [hostSelector, innerSelector] = parts;
              
              // CRITICAL: Normalize host selector - remove dynamic framework classes
              // This handles selectors like "gs-report-widget-element.ng-star-inserted"
              hostSelector = this.normalizeShadowHostSelector(hostSelector);
              console.log(`[Tier1] 🌑 Normalized host selector: "${hostSelector}"`);
              
              // Find all shadow hosts matching the first part
              let hosts: NodeListOf<Element>;
              try {
                hosts = document.querySelectorAll(hostSelector);
              } catch (selectorError) {
                console.log(`[Tier1] 🌑 Host selector invalid, trying tag-only fallback`);
                // Extract just the tag name as last resort
                const tagMatch = hostSelector.match(/^([a-z][-a-z0-9]*)/i);
                if (tagMatch) {
                  hosts = document.querySelectorAll(tagMatch[1]);
                } else {
                  continue;
                }
              }
              console.log(`[Tier1] 🌑 Found ${hosts.length} shadow hosts`);
              
              // CRITICAL: If there's a scope hint, find ALL matching elements, then filter by widget title
              // Don't just return the first match!
              const allMatches: Array<{ element: Element; host: Element }> = [];
              
              for (const host of Array.from(hosts)) {
                if (host.shadowRoot) {
                  const innerElements = host.shadowRoot.querySelectorAll(innerSelector);
                  for (const innerElement of Array.from(innerElements)) {
                    allMatches.push({ element: innerElement, host });
                  }
                }
              }
              
              console.log(`[Tier1] 🌑 Found ${allMatches.length} total elements across ${hosts.length} shadow hosts`);
              
              // If there's a scope hint, filter by widget title
              if (bundle.scopeHint && allMatches.length > 1) {
                console.log(`[Tier1] 🎯 Filtering ${allMatches.length} shadow elements by widget title: "${bundle.scopeHint}"`);
                
                for (const match of allMatches) {
                  // Check if this host's widget title matches the scope
                  let hostTitle = '';
                  if (match.host.shadowRoot) {
                    const titleEl = match.host.shadowRoot.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"]');
                    hostTitle = titleEl?.textContent?.trim() || '';
                  }
                  
                  // Fuzzy match (strip numbers and compare)
                  const hostTitleLower = hostTitle.toLowerCase();
                  const scopeHintLower = bundle.scopeHint.toLowerCase();
                  const hostTitleStripped = hostTitleLower.replace(/\d+$/g, '').trim();
                  const scopeStripped = scopeHintLower.replace(/\d+$/g, '').trim();
                  
                  if (hostTitleLower.includes(scopeStripped) || scopeHintLower.includes(hostTitleStripped)) {
                    console.log(`[Tier1] ✅ Found element in widget with matching title: "${hostTitle.substring(0, 50)}"`);
                    element = match.element;
                    break;
                  }
                }
              } else if (allMatches.length > 0) {
                // No scope hint or only one match - use first
                element = allMatches[0].element;
                console.log(`[Tier1] 🌑 Using first shadow element (no scope filtering needed)`);
              }
            }
          } else {
            // CSS selector
            element = document.querySelector(selector);
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1168',message:'CSS_SELECTOR_RESULT',data:{found:!!element,elementText:element?.textContent?.trim()?.substring(0,50),elementTag:element?.tagName},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          }
          
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1174',message:'FALLBACK_ELEMENT_CHECK',data:{found:!!element,isVisible:element ? this.isElementVisible(element) : false,elementText:element?.textContent?.trim()?.substring(0,50),expectedTextCount:expectedText.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          
          if (element && this.isElementVisible(element)) {
            // 🛡️ VERIFICATION: Check if element matches expected text
            // This prevents fallback selectors from picking wrong elements!
            if (expectedText.length > 0) {
              const elementText = (element.textContent || '').toLowerCase().trim();
              const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase().trim();
              const title = (element.getAttribute('title') || '').toLowerCase().trim();
              
              // CRITICAL: For dropdown options, use FUZZY matching (bidirectional)
              // Example: Dropdown says "Accounts", but expected is "AM - My Accounts"
              // Both "accounts".includes("accounts") AND "am - my accounts".includes("accounts") should match
              const role = element.getAttribute('role');
              const isDropdownOption = role === 'option' || role === 'menuitem' || role === 'menuitemradio';
              
              const textMatches = expectedText.some(expected => {
                // 🛡️ CRITICAL: Reject elements with excessively long text (likely containers, not the target element)
                // Example: DIV with textContent = "Skip to Navigation...New...Accounts..." (entire page)
                // should NOT match when looking for "New" button
                const MAX_TEXT_LENGTH = 200; // Buttons/links/inputs rarely exceed this
                if (elementText.length > MAX_TEXT_LENGTH) {
                  console.log(`[Tier1] ⚠️ Element text too long (${elementText.length} chars) - likely a container, not target element`);
                  return false;
                }
                
                // Exact or contains match (forward direction)
                const forwardMatch = 
                  elementText === expected ||
                  elementText.includes(expected) ||
                  ariaLabel === expected ||
                  ariaLabel.includes(expected) ||
                  title === expected ||
                  title.includes(expected);
                
                if (forwardMatch) return true;
                
                // For dropdown options: Also check reverse (element text is subset of expected)
                // This handles: Dropdown option "Accounts" vs expected "AM - My Accounts"
                if (isDropdownOption && elementText.length >= 3) {
                  const reverseMatch = expected.includes(elementText);
                  if (reverseMatch) {
                    console.log(`[Tier1] ✅ Fuzzy match for dropdown option: "${elementText}" is contained in expected "${expected}"`);
                    return true;
                  }
                }
                
                return false;
              });
              
              if (!textMatches) {
                console.log(`[Tier1] ⚠️ Fallback selector found element but text doesn't match. Expected: "${expectedText[0]}", found: "${ariaLabel || elementText.substring(0, 50)}"`);
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1226',message:'FALLBACK_TEXT_MISMATCH',data:{expectedText:expectedText[0],foundText:ariaLabel || elementText.substring(0,50),elementText:elementText.substring(0,50),isDropdownOption},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                continue; // Try next fallback selector
              }
            }
            
            // 🎯 SCOPE VERIFICATION: Skip for shadow-piercing selectors
            // Shadow-piercing selectors (e.g., "gs-report-widget-element >> [aria-label='More Options']")
            // already encode the widget context in the selector itself, so distance-based
            // verification is incorrect (it would measure from the wrong widget)
            const isShadowPiercingSelector = selector.includes(' >> ');
            
            if (bundle.scopeHint && !isShadowPiercingSelector) {
              const { resolveScopeContainer } = await import('../types/scope');
              const widgetElement = resolveScopeContainer({
                kind: 'WIDGET',
                title: bundle.scopeHint,
              }, document);
              
              if (widgetElement) {
                // Check if element is within the widget or near it (for menu items in portals)
                const widgetRect = widgetElement.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                
                // Calculate distance from widget
                const widgetCenterX = widgetRect.left + widgetRect.width / 2;
                const widgetCenterY = widgetRect.top + widgetRect.height / 2;
                const elementCenterX = elementRect.left + elementRect.width / 2;
                const elementCenterY = elementRect.top + elementRect.height / 2;
                const distanceX = Math.abs(elementCenterX - widgetCenterX);
                const distanceY = Math.abs(elementCenterY - widgetCenterY);
                const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
                
                // For menu items, allow up to 500px distance (menus are in portals)
                // Check both element's role attribute AND target role from bundle
                const elementRole = element.getAttribute('role');
                const targetRoleStrategy = bundle.strategies.find(s => s.type === 'role')?.value;
                const targetRolePart = targetRoleStrategy?.split(':')[0]; // Extract role part (e.g., "menuitem" from "menuitem:Download Data")
                const isMenuItem = elementRole === 'menuitem' || elementRole === 'option' || 
                                  targetRolePart === 'menuitem' || targetRolePart === 'option';
                const maxDistance = isMenuItem ? 500 : 100;
                
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1239',message:'FALLBACK_SCOPE_CHECK',data:{scopeHint:bundle.scopeHint,elementText:element.textContent?.trim()?.substring(0,50),elementRole,targetRole:targetRolePart,isMenuItem,distance:Math.round(distance),maxDistance},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                
                if (distance > maxDistance) {
                  console.log(`[Tier1] ⚠️ Fallback selector found element but it's ${Math.round(distance)}px from widget "${bundle.scopeHint}" (max: ${maxDistance}px) - trying next selector`);
                  // #region agent log
                  fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1242',message:'FALLBACK_SCOPE_REJECTED',data:{scopeHint:bundle.scopeHint,elementText:element.textContent?.trim()?.substring(0,50),distance:Math.round(distance),maxDistance},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
                  // #endregion
                  continue; // Try next fallback selector
                }
              } else {
                // #region agent log
                fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1250',message:'FALLBACK_SCOPE_WIDGET_NOT_FOUND',data:{scopeHint:bundle.scopeHint,elementText:element.textContent?.trim()?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
              }
            } else if (isShadowPiercingSelector) {
              console.log(`[Tier1] 🔍 Shadow-piercing selector - skipping distance-based scope verification (widget context encoded in selector)`);
            }
            
            console.log(`[Tier1] ✅ Found via recorded fallback selector: "${selector.substring(0, 60)}..."`);
            
            // CRITICAL: For menu triggers (e.g., "More Options"), wait for menu to appear!
            // Check if this is a dropdown trigger and if so, wait for the menu
            const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
            const elementText = element.textContent?.toLowerCase() || '';
            const role = element.getAttribute('role');
            const isDropdownTrigger = element.getAttribute('aria-haspopup') === 'true' ||
                                     element.getAttribute('aria-expanded') !== null ||
                                     element.getAttribute('aria-controls') !== null ||
                                     (role === 'button' && 
                                      (ariaLabel.includes('more') || 
                                       ariaLabel.includes('options') ||
                                       ariaLabel.includes('menu') ||
                                       elementText.includes('more') || 
                                       elementText.includes('options')));
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1297',message:'FALLBACK_DROPDOWN_CHECK',data:{isDropdownTrigger,role,ariaLabel:ariaLabel.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'MENU'})}).catch(()=>{});
            // #endregion
            
            if (isDropdownTrigger) {
              console.log(`[Tier1] 🔽 Dropdown trigger detected (fallback path), waiting for menu...`);
              const { waitForDropdownMenu } = await import('../content/universal-execution/state-verifier');
              const menu = await waitForDropdownMenu(2000);
              if (menu) {
                console.log(`[Tier1] ✅ Menu appeared with ${menu.querySelectorAll('[role="menuitem"], [role="option"]').length} options`);
              } else {
                console.warn(`[Tier1] ⚠️ Menu didn't appear within 2s`);
              }
            }
            
            return {
              status: 'success',
              details: {
                element,
                resolveMetrics: { method: 'recorded_fallback_selector' },
              },
            };
          }
        } catch (e) {
          // Invalid selector, try next
          console.warn(`[Tier1] ⚠️ Invalid fallback selector: "${selector.substring(0, 40)}..."`);
        }
      }
      
      console.log('[Tier1] ℹ️ Recorded fallback selectors didn\'t find element, trying semantic strategies...');
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1282',message:'FALLBACK_SELECTORS_FAILED',data:{fallbackCount:bundle.recordedFallbackSelectors?.length || 0},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1286',message:'NO_FALLBACK_SELECTORS',data:{strategiesCount:bundle.strategies.length,scopeHint:bundle.scopeHint},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    }
    
    // PRIORITY 2: Use Resolver.resolve() with semantic strategies
    const result: ResolveResult = await Resolver.resolve(bundle, intent);
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1294',message:'SEMANTIC_RESOLVER_RESULT',data:{status:result.status,candidateCount:result.status === 'ambiguous' ? result.candidates.length : 0,winningStrategy:result.status === 'found' ? result.winningStrategy : undefined},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    if (result.status === 'found') {
      console.log(`[Tier1] ✅ Found via ${result.winningStrategy}`);
      return {
        status: 'success',
        details: {
          element: result.element,
          resolveMetrics: result.metrics,
        },
      };
    }
    
    if (result.status === 'ambiguous') {
      console.warn(`[Tier1] ⚠️ Ambiguous: ${result.candidates.length} candidates`);
      
      // AUTO-DISAMBIGUATE: Use deterministic heuristics to pick the best candidate
      // This mimics what a human would do: click the visible one, ignore hidden copies
      const bestCandidate = await this.pickBestCandidate(
        result.candidates,
        bundle,
        intent
      );
      
      if (bestCandidate) {
        console.log(`[Tier1] ✅ Auto-disambiguated (${bestCandidate.reason})`);
        return {
          status: 'success',
          details: {
            element: bestCandidate.element,
            resolveMetrics: result.metrics,
          },
        };
      }
      
      // Only reject if truly ambiguous after all heuristics
      return {
        status: 'rejected',
        code: 'AMBIGUOUS',
        details: {
          matchCount: result.candidates.length,
          candidates: result.candidates.map(c => ({
            role: c.element.getAttribute('role') || c.element.tagName.toLowerCase(),
            name: c.element.textContent?.trim().substring(0, 50) || '',
            text: c.matchedText,
          })),
          resolveMetrics: result.metrics,
        },
        message: `Found ${result.candidates.length} matching elements, cannot decide which one`,
      };
    }
    
    // not_found
    console.warn(`[Tier1] ❌ Not found. Tried: ${result.triedStrategies.join(', ')}`);
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      details: {
        matchCount: 0,
        triedStrategies: result.triedStrategies,
        resolveMetrics: result.metrics,
      },
      message: `Element not found after trying ${result.triedStrategies.length} strategies`,
    };
  }

  /**
   * AUTO-DISAMBIGUATION: Pick the best candidate when multiple elements match
   * 
   * This implements human-like intuition:
   * - Click the visible BOGO in the open dropdown, not hidden ones
   * - Click the "Submit" button in the modal, not the one behind it
   * - Click the interactive element, not the disabled one
   * 
   * Priority order:
   * 1. VISIBILITY - must be actually visible to user
   * 2. CONTEXT - prefer elements in semantically relevant containers
   * 3. INTERACTABILITY - must be clickable/typeable
   * 4. Z-INDEX - prefer elements on top
   * 5. DOM ORDER - prefer later elements (more recent renders)
   */
  private static async pickBestCandidate(
    candidates: Array<{ element: Element; matchedText?: string }>,
    bundle: LocatorBundle,
    intent: Intent
  ): Promise<{ element: Element; reason: string } | null> {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { element: candidates[0].element, reason: 'only one' };
    
    console.log(`[Tier1] 🔍 Disambiguating ${candidates.length} candidates...`);
    
    // STEP 1: Filter to VISIBLE elements only
    // Remove display:none, visibility:hidden, opacity:0, zero-size
    const visibleCandidates = candidates.filter(c => {
      const el = c.element;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (parseFloat(style.opacity) === 0) return false;
      if (rect.width === 0 && rect.height === 0) return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After visibility filter: ${visibleCandidates.length}/${candidates.length}`);
    if (visibleCandidates.length === 0) return null;
    if (visibleCandidates.length === 1) return { element: visibleCandidates[0].element, reason: 'only visible one' };
    
    // STEP 1.5: SCOPE-AWARE filtering - use recorded container/widget context!
    // This is CRITICAL for distinguishing between identical elements in different widgets
    let scopeFiltered = visibleCandidates;
    if (bundle.scopeHint) {
      console.log(`[Tier1] 🎯 Filtering by scope hint: "${bundle.scopeHint}"`);
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1337',message:'SCOPE_FILTER_START',data:{scopeHint:bundle.scopeHint,candidateCount:visibleCandidates.length,role:bundle.strategies?.find((s:any)=>s.type==='role')?.value,name:bundle.strategies?.find((s:any)=>s.type==='name')?.value?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // Helper function for fuzzy title matching (handles dynamic numbers like "STORE48" vs "STORE")
      const fuzzyTitleMatch = (recorded: string, actual: string): boolean => {
        if (!recorded || !actual) return false;
        const r = recorded.toLowerCase().trim();
        const a = actual.toLowerCase().trim();
        
        // Exact match
        if (r === a) return true;
        
        // One contains the other
        if (r.includes(a) || a.includes(r)) return true;
        
        // Strip trailing numbers and compare (e.g., "STORE48" -> "STORE")
        const rStripped = r.replace(/\d+$/, '').trim();
        const aStripped = a.replace(/\d+$/, '').trim();
        
        if (rStripped && aStripped) {
          if (rStripped === aStripped) return true;
          if (rStripped.includes(aStripped) || aStripped.includes(rStripped)) return true;
        }
        
        return false;
      };
      
      // TOP-DOWN APPROACH: First, find ALL elements that contain the scope text
      // This is more reliable than bottom-up walking for complex frameworks like Salesforce
      const scopeContainers: Element[] = [];
      
      // Search for elements whose text content matches the scope hint
      // Use TreeWalker for efficiency
      const treeWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const el = node as Element;
            const text = el.textContent?.trim() || '';
            // Look for elements with short text that matches scope hint
            if (text.length > 5 && text.length < 200 && fuzzyTitleMatch(bundle.scopeHint!, text)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      
      let scopeEl: Element | null;
      while ((scopeEl = treeWalker.nextNode() as Element | null)) {
        // Find the container that holds this scope text element
        // Walk up to find a reasonable container (section, card, panel, etc.)
        let container = scopeEl.parentElement;
        let levelsUp = 0;
        while (container && levelsUp < 10) {
          const tagLower = container.tagName?.toLowerCase() || '';
          const classLower = container.className?.toString()?.toLowerCase() || '';
          
          // Stop at section-like containers
          if (tagLower.includes('section') || tagLower.includes('card') || 
              tagLower.includes('panel') || tagLower.includes('flexipage') ||
              classLower.includes('section') || classLower.includes('card') ||
              classLower.includes('panel') || classLower.includes('form') ||
              container.getAttribute('role') === 'region' ||
              container.getAttribute('role') === 'group') {
            if (!scopeContainers.includes(container)) {
              scopeContainers.push(container);
              console.log(`[Tier1] 🔍 Found scope container: ${container.tagName} with class "${container.className?.toString()?.substring(0, 50)}"`);
            }
            break;
          }
          container = container.parentElement;
          levelsUp++;
        }
      }
      
      console.log(`[Tier1] 🔍 Found ${scopeContainers.length} containers for scope "${bundle.scopeHint}"`);
      
      const inScope = visibleCandidates.filter((c, idx) => {
        const isFirstCandidate = idx === 0;
        
        // TOP-DOWN: Check if candidate is inside any of the scope containers we found
        if (scopeContainers.length > 0) {
          for (const container of scopeContainers) {
            if (container.contains(c.element)) {
              console.log(`[Tier1] ✅ Candidate ${idx} is inside scope container (top-down match)`);
              return true;
            }
          }
        }
        
        // BOTTOM-UP: Walk up the DOM tree to find a container that matches the scope hint
        let current: Element | null = c.element;
        const maxLevels = 20;
        let level = 0;
        const scopeHint = bundle.scopeHint!;
        
        while (current && level < maxLevels) {
          // Check headers in this element (light DOM)
          const headers = current.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [role="heading"]');
          for (const header of Array.from(headers)) {
            const headerText = header.textContent?.trim() || '';
            if (fuzzyTitleMatch(scopeHint, headerText)) {
              console.log(`[Tier1] ✅ Candidate matched scope via header: "${headerText.substring(0, 50)}"`);
              return true;
            }
          }
          
          // UNIVERSAL: Check direct children for text matching scope
          for (const child of Array.from(current.children || [])) {
            const childText = child.textContent?.trim() || '';
            if (childText.length > 5 && childText.length < 150) {
              // Check if child's text matches scope
              if (fuzzyTitleMatch(scopeHint, childText)) {
                console.log(`[Tier1] ✅ Candidate matched scope via child text: "${childText.substring(0, 50)}"`);
                return true;
              }
            }
          }
          
          // Check shadow DOM for titles
          if (current.shadowRoot) {
            // Method 1: Check headers
            const shadowHeaders = current.shadowRoot.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [role="heading"]');
            if (isFirstCandidate) {
              console.log(`[Tier1] 🔍 Checking ${shadowHeaders.length} headers in shadowRoot of ${current.tagName}`);
            }
            for (const header of Array.from(shadowHeaders)) {
              const headerText = header.textContent?.trim() || '';
              if (isFirstCandidate && headerText.length > 0) {
                console.log(`[Tier1] 🔍 Shadow header found: "${headerText.substring(0, 60)}"`);
              }
              if (fuzzyTitleMatch(scopeHint, headerText)) {
                console.log(`[Tier1] ✅ Candidate matched scope via shadow header: "${headerText.substring(0, 50)}"`);
                return true;
              }
            }
            
            // Method 2: Check all text content in shadow root for widget title
            // Some frameworks put titles in spans or divs, not headers
            const allTextElements = current.shadowRoot.querySelectorAll('span, div, p, label');
            for (const el of Array.from(allTextElements)) {
              const text = el.textContent?.trim() || '';
              // Only check elements with short text (likely labels/titles, not content blocks)
              if (text.length > 5 && text.length < 100) {
                if (fuzzyTitleMatch(scopeHint, text)) {
                  console.log(`[Tier1] ✅ Candidate matched scope via shadow text: "${text.substring(0, 50)}"`);
                  return true;
                }
              }
            }
          } else if (isFirstCandidate && current.tagName?.toLowerCase().includes('widget')) {
            console.log(`[Tier1] ⚠️ ${current.tagName} has no accessible shadowRoot (may be closed)`);
          }
          
          // Move up - handle shadow DOM boundaries!
          // If current element is in a shadow root, we need to go to the shadow host
          const rootNode = current.getRootNode();
          if (rootNode instanceof ShadowRoot) {
            // We're in a shadow DOM - jump to the host element
            current = rootNode.host;
            console.log(`[Tier1] 🔍 Crossed shadow boundary to host: ${current.tagName}`);
          } else {
            // Normal DOM traversal
            current = current.parentElement;
          }
          level++;
        }
        return false;
      });
      
      if (inScope.length > 0) {
        scopeFiltered = inScope;
        console.log(`[Tier1] 🎯 Filtered to ${inScope.length} inside scope "${bundle.scopeHint}"`);
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1440',message:'SCOPE_FILTER_SUCCESS',data:{inScopeCount:inScope.length,scopeHint:bundle.scopeHint},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        if (inScope.length === 1) {
          return { element: inScope[0].element, reason: `only one in scope "${bundle.scopeHint}"` };
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1449',message:'SCOPE_FILTER_FAILED',data:{scopeHint:bundle.scopeHint,visibleCount:visibleCandidates.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Scope hint not found - check if this is a menu item in a portal/overlay
        // Menu items are often rendered outside the widget DOM tree
        const role = bundle.strategies.find(s => s.type === 'role')?.value;
        const isMenuItem = role === 'menuitem' || role === 'option';
        
        if (isMenuItem) {
          // For menu items, search globally but try to find the menu that belongs to the widget
          // by looking for the trigger button that was just clicked
          console.log(`[Tier1] 🔍 Menu item detected - searching globally (menu may be in portal/overlay)`);
          
          // Try to find the menu overlay and associate it with the widget
          // Look for the widget first, then find menu items near it
          const { resolveScopeContainer } = await import('../types/scope');
          const widgetElement = resolveScopeContainer({
            kind: 'WIDGET',
            title: bundle.scopeHint,
          }, document);
          
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1461',message:'MENU_ITEM_SEARCH',data:{scopeHint:bundle.scopeHint,widgetFound:!!widgetElement,visibleCandidatesCount:visibleCandidates.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          
          if (widgetElement) {
            // Find menu items that are visible and might belong to this widget
            // Menu overlays are often positioned near the widget
            const widgetRect = widgetElement.getBoundingClientRect();
            const widgetCenterX = widgetRect.left + widgetRect.width / 2;
            const widgetCenterY = widgetRect.top + widgetRect.height / 2;
            
            // Get target text/name for matching
            const targetText = bundle.strategies.find(s => s.type === 'text')?.value?.toLowerCase() || 
                              bundle.strategies.find(s => s.type === 'role')?.value?.split(':')[1]?.toLowerCase() || '';
            
            // Score candidates by: 1) Text match, 2) Proximity to widget
            const scoredCandidates = visibleCandidates.map(c => {
              const rect = c.element.getBoundingClientRect();
              const candidateCenterX = rect.left + rect.width / 2;
              const candidateCenterY = rect.top + rect.height / 2;
              
              // Calculate distance from widget center
              const distanceX = Math.abs(candidateCenterX - widgetCenterX);
              const distanceY = Math.abs(candidateCenterY - widgetCenterY);
              const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
              
              // Prefer candidates within 500px of widget (menu overlays are usually close)
              const isNearWidget = distance < 500;
              
              // Check text match (exact or contains)
              const candidateText = c.element.textContent?.trim().toLowerCase() || '';
              const textMatch = targetText && candidateText.includes(targetText);
              
              return { candidate: c, distance, isNearWidget, textMatch };
            });
            
            // Sort by: 1) Text match, 2) Proximity to widget
            scoredCandidates.sort((a, b) => {
              // First: prioritize text match
              if (a.textMatch && !b.textMatch) return -1;
              if (!a.textMatch && b.textMatch) return 1;
              // Second: prioritize proximity
              if (a.isNearWidget && !b.isNearWidget) return -1;
              if (!a.isNearWidget && b.isNearWidget) return 1;
              return a.distance - b.distance;
            });
            
            scopeFiltered = scoredCandidates.map(sc => sc.candidate);
            console.log(`[Tier1] 🎯 Menu item search: Found ${scopeFiltered.length} candidates, prioritized by text match + proximity to widget "${bundle.scopeHint}"`);
            
            // #region agent log
            fetch('http://127.0.0.1:7243/ingest/b7c604f8-b184-4e55-ac51-a3e1794329f3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tier1-executor.ts:1495',message:'MENU_ITEM_SEARCH_RESULT',data:{scopeHint:bundle.scopeHint,filteredCount:scopeFiltered.length,topCandidateText:scopeFiltered[0]?.element?.textContent?.trim()?.substring(0,50),topCandidateDistance:scoredCandidates[0]?.distance},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
          } else {
            // Widget not found, but continue with all candidates
            console.warn(`[Tier1] ⚠️ Widget "${bundle.scopeHint}" not found for menu item - searching globally`);
            scopeFiltered = visibleCandidates;
          }
        } else {
          // FAIL SAFELY: Don't click on wrong widget!
          // This is CRITICAL - if we can't find the element in the recorded scope, we should fail
          // rather than clicking a random element
          console.error(`[Tier1] ❌ CRITICAL: No candidates found in recorded scope "${bundle.scopeHint}"`);
          console.error(`[Tier1] ❌ Refusing to proceed - element may be in wrong widget/container`);
          console.error(`[Tier1] 💡 Suggestion: Scroll to make the widget visible, or re-record the workflow`);
          return null; // Fail - let upstream handle the error
        }
      }
    }
    
    // STEP 2: CONTEXT-AWARE filtering based on element role/type
    const role = bundle.strategies.find(s => s.type === 'role')?.value;
    let contextFiltered = scopeFiltered;
    
    // For dropdown options: prefer elements inside open listbox/menu
    if (role === 'option' || role === 'menuitem') {
      const { MenuDetector } = await import('../content/menu-detector');
      const inListbox = scopeFiltered.filter(c => {
        return MenuDetector.isInsideMenu(c.element);
      });
      
      if (inListbox.length > 0) {
        contextFiltered = inListbox;
        console.log(`[Tier1] 🎯 Filtered to ${inListbox.length} inside open listbox/menu`);
      }
    }
    
    // For modal/dialog buttons: prefer elements inside modal
    const modal = document.querySelector('[role="dialog"][aria-modal="true"], .modal:not([style*="display: none"])');
    if (modal) {
      const inModal = contextFiltered.filter(c => modal.contains(c.element));
      if (inModal.length > 0) {
        contextFiltered = inModal;
        console.log(`[Tier1] 🎯 Filtered to ${inModal.length} inside active modal`);
      }
    }
    
    if (contextFiltered.length === 1) return { element: contextFiltered[0].element, reason: 'only one in context' };
    
    // STEP 3: INTERACTABILITY - prefer elements that are actually interactive
    const interactiveCandidates = contextFiltered.filter(c => {
      const el = c.element as HTMLElement;
      const style = window.getComputedStyle(el);
      
      // Not disabled
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
      
      // Can receive pointer events
      if (style.pointerEvents === 'none') return false;
      
      // Not readonly (for inputs) - but allow readonly if we're just reading the value
      if (el instanceof HTMLInputElement && el.readOnly && intent.kind === 'TYPE') return false;
      
      return true;
    });
    
    console.log(`[Tier1] 📊 After interactability filter: ${interactiveCandidates.length}/${contextFiltered.length}`);
    if (interactiveCandidates.length === 0) {
      // Fallback: if no interactive ones, keep all contextFiltered
      console.log(`[Tier1] ⚠️ No interactive candidates, keeping all ${contextFiltered.length}`);
    } else if (interactiveCandidates.length === 1) {
      return { element: interactiveCandidates[0].element, reason: 'only interactive one' };
    } else {
      contextFiltered = interactiveCandidates;
    }
    
    // STEP 4: Z-INDEX - prefer elements on top (higher z-index)
    const withZIndex = contextFiltered.map(c => {
      const style = window.getComputedStyle(c.element);
      const zIndex = parseInt(style.zIndex) || 0;
      return { ...c, zIndex };
    });
    
    const maxZIndex = Math.max(...withZIndex.map(c => c.zIndex));
    const topLayerCandidates = withZIndex.filter(c => c.zIndex === maxZIndex);
    
    if (topLayerCandidates.length === 1) {
      return { element: topLayerCandidates[0].element, reason: `highest z-index (${maxZIndex})` };
    }
    
    console.log(`[Tier1] 📊 After z-index filter: ${topLayerCandidates.length} at z-index ${maxZIndex}`);
    
    // STEP 5: VIEWPORT POSITION - prefer elements in viewport center (more likely to be interactive)
    const inViewport = topLayerCandidates.filter(c => {
      const rect = c.element.getBoundingClientRect();
      return rect.top >= 0 && 
             rect.left >= 0 && 
             rect.bottom <= window.innerHeight && 
             rect.right <= window.innerWidth;
    });
    
    if (inViewport.length > 0 && inViewport.length < topLayerCandidates.length) {
      console.log(`[Tier1] 📊 Filtered to ${inViewport.length} in viewport`);
      if (inViewport.length === 1) {
        return { element: inViewport[0].element, reason: 'only one in viewport' };
      }
      contextFiltered = inViewport.map(c => ({ element: c.element, matchedText: c.matchedText }));
    } else {
      contextFiltered = topLayerCandidates.map(c => ({ element: c.element, matchedText: c.matchedText }));
    }
    
    // STEP 6: EXACT TEXT MATCH - prefer elements that EXACTLY match the target text
    // This is critical for dropdowns where you want "BOGO" not "BOGA" or "BOGO 2"
    const targetText = bundle.strategies.find(s => s.type === 'text')?.value;
    const targetRole = bundle.strategies.find(s => s.type === 'role')?.value;
    
    // Extract name from role strategy (e.g., "option:BOGO" -> "BOGO")
    let targetName: string | undefined;
    if (targetRole && targetRole.includes(':')) {
      targetName = targetRole.split(':')[1];
    }
    
    // Try exact text match
    const exactTextMatches = contextFiltered.filter(c => {
      const elText = c.element.textContent?.trim();
      const matchTarget = targetText || targetName;
      
      if (!matchTarget || !elText) return false;
      
      // Exact match (case-insensitive)
      return elText.toLowerCase() === matchTarget.toLowerCase();
    });
    
    if (exactTextMatches.length > 0) {
      console.log(`[Tier1] 📊 Filtered to ${exactTextMatches.length} with exact text match`);
      if (exactTextMatches.length === 1) {
        return { element: exactTextMatches[0].element, reason: 'exact text match' };
      }
      // Use exact matches for next steps
      contextFiltered = exactTextMatches;
    }
    
    // STEP 7: DOM ORDER - prefer later elements (more recent React renders)
    // Elements later in DOM tree are typically more recent
    const sortedByDomOrder = [...contextFiltered].sort((a, b) => {
      const comparison = a.element.compareDocumentPosition(b.element);
      if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // a comes before b
      if (comparison & Node.DOCUMENT_POSITION_PRECEDING) return 1;  // a comes after b
      return 0;
    });
    
    // Take the LAST one (most recent)
    const lastElement = sortedByDomOrder[sortedByDomOrder.length - 1];
    console.log(`[Tier1] 📊 Picked last in DOM order out of ${sortedByDomOrder.length}`);
    
    return { 
      element: lastElement.element, 
      reason: `last of ${sortedByDomOrder.length} (most recent)` 
    };
  }

  /**
   * Build locator bundle from semantic target
   */
  private static buildLocatorBundle(target: SemanticTarget): LocatorBundle {
    const strategies: LocatorStrategy[] = [];
    
    // Check if name is actually unlabeled
    const isUnlabeled = !target.name || 
                       target.name === '(unlabeled)' || 
                       target.name.trim() === '';
    
    // Test ID (highest priority)
    if (target.testId) {
      strategies.push({
        type: 'testid',
        value: target.testId,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // ID attribute (also very stable)
    if (target.id) {
      strategies.push({
        type: 'css',
        value: `#${target.id}`,
        features: this.createFeatures(true, true, false),
      });
    }
    
    // Role strategy - use correct format: "role:accessibleName" or just "role"
    if (target.role) {
      if (isUnlabeled) {
        // No name filter, just role
        console.log(`[Tier1] Building locator for unlabeled ${target.role}`);
        strategies.push({
          type: 'role',
          value: target.role,  // Just "combobox", no name part
          features: this.createFeatures(true, false, false),
        });
      } else {
        // Role with name filter
        strategies.push({
          type: 'role',
          value: `${target.role}:${target.name}`,  // Correct format: "role:name"
          features: this.createFeatures(true, false, false),
        });
      }
    }
    
    // ARIA label (only if not unlabeled)
    if (target.name && !isUnlabeled) {
      strategies.push({
        type: 'aria',
        value: target.name,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // Text content (only if valid and not a number/single char)
    const hasValidText = target.text && 
                        target.text !== '(unlabeled)' && 
                        target.text.trim() !== '' &&
                        target.text.trim().length > 1 &&  // Skip single characters
                        !/^\d+$/.test(target.text.trim());  // Skip pure numbers like "0", "100"
    
    if (hasValidText && target.text) {
      console.log(`[Tier1] Adding text strategy with value: "${target.text}"`);
      strategies.push({
        type: 'text',
        value: target.text.trim(),  // Trim to avoid whitespace issues
        features: this.createFeatures(false, false, false),
      });
    }
    
    // Placeholder (for inputs)
    if (target.placeholder) {
      strategies.push({
        type: 'css',
        value: `[placeholder="${target.placeholder}"]`,
        features: this.createFeatures(true, false, false),
      });
    }
    
    // If no strategies were added, add a basic CSS selector for the role
    if (strategies.length === 0 && target.role) {
      console.warn('[Tier1] No valid strategies, adding fallback role selector');
      strategies.push({
        type: 'css',
        value: `[role="${target.role}"]`,
        features: this.createFeatures(false, false, false),
      });
    }

    // Add recordedFallbackSelectors as CSS strategies if we have no other strategies
    // These are the actual selectors captured during recording
    if (strategies.length === 0 && target.recordedFallbackSelectors && target.recordedFallbackSelectors.length > 0) {
      console.log('[Tier1] Using recordedFallbackSelectors as primary strategies');
      for (const selector of target.recordedFallbackSelectors) {
        if (selector && typeof selector === 'string' && selector.trim()) {
          // Determine if it's XPath or CSS
          const isXPath = selector.startsWith('//') || selector.startsWith('(//');
          strategies.push({
            type: isXPath ? 'xpath' : 'css',
            value: selector,
            features: this.createFeatures(false, false, true), // Dynamic parts likely
          });
        }
      }
    }

    // Final safety check - must have at least one strategy
    if (strategies.length === 0) {
      console.error('[Tier1] Cannot build locator bundle - no valid strategies for target:', target);
      // Add a dummy strategy that will fail gracefully
      strategies.push({
        type: 'css',
        value: '[data-ghostwriter-impossible-selector]',
        features: this.createFeatures(false, false, false),
      });
    }
    
    console.log(`[Tier1] Built locator bundle with ${strategies.length} strategies:`, strategies.map(s => `${s.type}:${s.value.substring(0, 20)}`));
    
    // Build scope if recordedScopeHint or scopeHint provided - use WIDGET scope for better widget title matching
    // recordedScopeHint comes from hint (has recorded scope), scopeHint comes from LLM
    const scopeTitle = target.recordedScopeHint || target.scopeHint;
    const scope = scopeTitle ? {
      kind: 'WIDGET' as const,
      title: scopeTitle,
    } : undefined;
    
    if (scope) {
      console.log(`[Tier1] 🎯 Using WIDGET scope: "${scope.title}"`);
    }
    
    // CRITICAL: Include recorded fallback selectors - these contain container context!
    // e.g., "//div[descendant::*[contains(normalize-space(.), 'Widget Title')]]//button"
    if (target.recordedFallbackSelectors && target.recordedFallbackSelectors.length > 0) {
      console.log(`[Tier1] 📋 Including ${target.recordedFallbackSelectors.length} recorded fallback selectors with container context`);
    }
    
    return {
      strategies,
      scope,
      disambiguators: target.nearbyText || [],
      tagName: target.role || '',
      role: target.role,
      // CRITICAL: Pass fallback selectors for reliable disambiguation
      recordedFallbackSelectors: target.recordedFallbackSelectors,
      scopeHint: target.recordedScopeHint || target.scopeHint,  // Use recorded first, fall back to LLM-provided
    };
  }

  /**
   * Create locator features
   */
  private static createFeatures(
    hasStableAttributes: boolean,
    uniqueMatchAtRecordTime: boolean,
    hasDynamicParts: boolean
  ) {
    return {
      hasStableAttributes,
      uniqueMatchAtRecordTime,
      matchCountAtRecordTime: uniqueMatchAtRecordTime ? 1 : 0,
      hasDynamicParts,
      textStabilityHint: 'unknown' as const,
      isWithinShadowDOM: false,
      recordedTagName: '',
    };
  }

  /**
   * Quick check if element is visible (for fallback selector validation)
   */
  private static isElementVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    
    if (rect.width === 0 && rect.height === 0) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    
    return true;
  }

  /**
   * Check if element is interactable
   */
  private static async checkInteractability(element: Element): Promise<{ success: boolean; reason?: string }> {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check visibility
    if (rect.width === 0 || rect.height === 0) {
      return { success: false, reason: 'Element has zero size' };
    }
    
    if (style.visibility === 'hidden') {
      return { success: false, reason: 'Element visibility is hidden' };
    }
    
    if (style.display === 'none') {
      return { success: false, reason: 'Element display is none' };
    }
    
    if (parseFloat(style.opacity) === 0) {
      return { success: false, reason: 'Element opacity is 0' };
    }
    
    // Check if disabled
    if ((element as HTMLButtonElement).disabled) {
      return { success: false, reason: 'Element is disabled' };
    }
    
    if (element.getAttribute('aria-disabled') === 'true') {
      return { success: false, reason: 'Element is aria-disabled' };
    }
    
    return { success: true };
  }

  /**
   * Check if action is safe (not delete/confirm in dangerous context)
   */
  private static checkActionSafety(element: Element, action: 'click' | 'type'): { safe: boolean; reason?: string } {
    if (action !== 'click') {
      return { safe: true };
    }
    
    const text = element.textContent?.toLowerCase().trim() || '';
    const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
    const combinedText = `${text} ${ariaLabel}`;
    
    // Check if we're in a modal/dialog
    const modal = element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal');
    
    if (modal) {
      // In modal: block ONLY highly dangerous patterns
      // "continue", "proceed", "submit", "save" are legitimate workflow progression buttons
      const highlyDangerousPatterns = [
        'delete', 'remove', 'destroy', 'purge', 'erase', 'terminate',
      ];
      
      // Additional checks for confirm/yes (only block if NOT part of normal flow)
      const contextuallyDangerousPatterns = [
        'confirm delete', 'confirm removal', 'yes, delete', 'yes, remove',
      ];
      
      const safePatterns = ['cancel', 'close', 'dismiss', 'no', 'back'];
      
      // If it's a safe pattern, allow
      if (safePatterns.some(p => combinedText.includes(p))) {
        return { safe: true };
      }
      
      // Check contextually dangerous (e.g., "Confirm Delete" but not just "Confirm")
      if (contextuallyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive confirmation)`,
        };
      }
      
      // If it's highly dangerous, block
      if (highlyDangerousPatterns.some(p => combinedText.includes(p))) {
        return {
          safe: false,
          reason: `Unsafe: Would click "${text}" in modal (destructive action)`,
        };
      }
    }
    
    return { safe: true };
  }

  /**
   * Close any open dropdown by pressing Escape and clicking body
   * Called when select action fails to prevent blocking subsequent actions
   */
  private static async closeAnyOpenDropdown(): Promise<void> {
    console.log('[Tier1] 🧹 Cleaning up: Closing any open dropdown...');
    
    // Method 1: Press Escape to close dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }));
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Method 2: Click on document body to dismiss
    document.body.click();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify dropdown closed
    const remainingOptions = document.querySelectorAll('[role="option"]');
    const remainingMenus = document.querySelectorAll('[role="listbox"]:not([hidden]), [role="menu"]:not([hidden])');
    
    if (remainingOptions.length > 0 || remainingMenus.length > 0) {
      console.log('[Tier1] ⚠️ Dropdown may still be open, trying harder...');
      
      // Method 3: Click outside any focused element
      const activeEl = document.activeElement;
      if (activeEl && activeEl !== document.body) {
        (activeEl as HTMLElement).blur?.();
      }
      
      // Method 4: Press Escape on active element
      if (activeEl) {
        activeEl.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        }));
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const finalCheck = document.querySelectorAll('[role="option"]').length;
    console.log(`[Tier1] 🧹 Dropdown cleanup complete. Remaining options: ${finalCheck}`);
  }

  /**
   * Click element with proper event dispatching
   */
  private static clickElement(element: Element): void {
    const rect = element.getBoundingClientRect();
    
    // CRITICAL: Check if element is in a shadow root
    // Elements inside shadow roots should NEVER trigger page scrolls!
    // This is because the shadow host (widget) is already visible
    const isInShadowDOM = element.getRootNode() instanceof ShadowRoot;
    
    // Check if element is in viewport
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
    
    // Only scroll if:
    // 1. NOT in shadow DOM (buttons inside widgets should never scroll the page!)
    // 2. NOT already in viewport
    if (!isInShadowDOM && !isInViewport) {
      console.log('[Tier1] Element not in viewport, scrolling into view');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (isInShadowDOM) {
      console.log('[Tier1] ⚠️ Element in shadow DOM - NEVER scroll page (widget already visible)');
    } else {
      console.log('[Tier1] Element already in viewport, skipping scroll');
    }
    
    // Focus
    if (element instanceof HTMLElement) {
      element.focus();
    }
    
    // Dispatch events
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
    
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
    }));
  }

  /**
   * Verify outcome using SuccessVerifier
   */
  private static async verifyOutcome(expected: ExpectedOutcome): Promise<{ success: boolean; message?: string }> {
    // Wait if specified
    if (expected.waitMs) {
      await new Promise(resolve => setTimeout(resolve, expected.waitMs));
    }
    
    if (expected.urlContains) {
      if (!window.location.href.includes(expected.urlContains)) {
        return {
          success: false,
          message: `URL does not contain: ${expected.urlContains}`,
        };
      }
    }
    
    if (expected.urlEquals) {
      if (window.location.href !== expected.urlEquals) {
        return {
          success: false,
          message: `URL mismatch: expected ${expected.urlEquals}`,
        };
      }
    }
    
    if (expected.textAppears) {
      if (!document.body.textContent?.includes(expected.textAppears)) {
        return {
          success: false,
          message: `Text not found: ${expected.textAppears}`,
        };
      }
    }
    
    if (expected.textDisappears) {
      if (document.body.textContent?.includes(expected.textDisappears)) {
        return {
          success: false,
          message: `Text still present: ${expected.textDisappears}`,
        };
      }
    }
    
    if (expected.modalAppears !== undefined) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (expected.modalAppears && !modal) {
        return {
          success: false,
          message: 'Modal did not appear',
        };
      }
      if (!expected.modalAppears && modal) {
        return {
          success: false,
          message: 'Modal appeared unexpectedly',
        };
      }
    }
    
    if (expected.modalCloses !== undefined && expected.modalCloses) {
      const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
      if (modal) {
        return {
          success: false,
          message: 'Modal did not close',
        };
      }
    }
    
    return { success: true };
  }
  
  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for expected outcome using PageModel expectation engine
   * This provides predictive verification based on page type + action
   *
   * The method will:
   * 1. Try to get the current PageModel (fast, usually cached)
   * 2. Generate expectations based on the action and page type
   * 3. Wait for the first matching expectation OR fall back to stability wait
   *
   * Returns null if expectations are soft (warnings only), or result if hard verification needed
   */
  private static async waitForOutcome(
    action: AgentAction,
    expectedOutcome?: ExpectedOutcome
  ): Promise<{ success: boolean; message: string } | null> {
    try {
      // Try to get PageModel for expectation-based verification
      const pageModel = await getCurrentModel();

      // Generate expectations based on action and page type
      const expectations = generateExpectations(action, pageModel);

      if (expectations.length > 0) {
        console.log(`[Tier1] 🔮 Generated ${expectations.length} expectations for ${action.type} action`);
        console.log(`[Tier1] 🔮 Top expectation: ${expectations[0].expectedOutcome.type} (${(expectations[0].confidence * 100).toFixed(0)}% confidence)`);

        // Use expectation engine for smart waiting
        const expectationEngine = new ExpectationEngine({
          cacheTTLMs: 200,
          enableContinuousObserver: true,
          enableRelationshipGraph: true,
          enableExpectationEngine: true,
          observerThrottleMs: 100,
          maxRelationshipsPerElement: 10,
          logLevel: 'warn',
        });

        const result = await expectationEngine.waitForExpectations(expectations, {
          maxWaitMs: Math.max(...expectations.map(e => e.timeoutMs), 3000),
        });

        if (result.matched) {
          console.log(`[Tier1] ✅ Expectation matched: ${result.matched.expectedOutcome.type}`);
        } else if (result.timedOut) {
          // Soft failure - log warning but don't fail
          console.log(`[Tier1] ⚠️ No expectations matched within timeout, continuing anyway`);
        }
      } else {
        // No expectations generated - fall back to stability wait
        console.log(`[Tier1] 💤 No expectations for ${action.type}, using stability wait`);
        await StateWaitEngine.waitForStability({
          domQuietMs: 150,
          networkQuietMs: 200,
          maxWaitMs: 3000,
        });
      }

      // Verify explicit outcome if specified (hard verification)
      if (expectedOutcome) {
        const outcomeResult = await this.verifyOutcome(expectedOutcome);
        if (!outcomeResult.success) {
          return {
            success: false,
            message: outcomeResult.message || 'Outcome verification failed',
          };
        }
      }

      return null; // Success or soft constraints only
    } catch (error) {
      // PageModel failed - fall back to stability wait
      console.log(`[Tier1] ⚠️ PageModel unavailable, using stability wait:`, error);
      await StateWaitEngine.waitForStability({
        domQuietMs: 150,
        networkQuietMs: 200,
        maxWaitMs: 3000,
      });

      // Still verify explicit outcome if specified
      if (expectedOutcome) {
        const outcomeResult = await this.verifyOutcome(expectedOutcome);
        if (!outcomeResult.success) {
          return {
            success: false,
            message: outcomeResult.message || 'Outcome verification failed',
          };
        }
      }

      return null;
    }
  }

  /**
   * Normalize a shadow host selector by removing dynamic framework classes
   * Handles selectors like "gs-report-widget-element.ng-star-inserted" -> "gs-report-widget-element"
   */
  private static normalizeShadowHostSelector(selector: string): string {
    // Dynamic class patterns that should be stripped
    const dynamicPatterns = [
      /\.ng-[a-z-]+/gi,          // Angular: .ng-star-inserted, .ng-scope, etc.
      /\.react-[a-z0-9-]+/gi,    // React
      /\.v-[a-z0-9-]+/gi,        // Vue: .v-leave, .v-enter, etc.
      /\.vue-[a-z0-9-]+/gi,      // Vue
      /\.css-[a-z0-9]+/gi,       // CSS-in-JS
      /\._css-[a-z0-9]+/gi,      // CSS Modules
      /\.sc-[a-z0-9]+/gi,        // styled-components
      /\.emotion-[a-z0-9]+/gi,   // Emotion
      /\.jss\d+-[a-z0-9]+/gi,    // JSS
      /\.Mui[A-Z][a-zA-Z0-9-]+/g, // Material-UI
      /\.[a-z]+-[a-z0-9]{6,}/gi, // Generic random hash classes
    ];
    
    let normalized = selector;
    for (const pattern of dynamicPatterns) {
      normalized = normalized.replace(pattern, '');
    }
    
    // Clean up any trailing dots or malformed selectors
    normalized = normalized.replace(/\.+/g, '.').replace(/\.$/, '');
    
    return normalized;
  }
  
  /**
   * Convert key name to key code for keyboard events
   */
  private static keyToCode(key: string): string {
    const keyCodeMap: Record<string, string> = {
      'Tab': 'Tab',
      'Enter': 'Enter',
      'Escape': 'Escape',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Space': 'Space',
      ' ': 'Space',
    };
    
    return keyCodeMap[key] || key;
  }
}

