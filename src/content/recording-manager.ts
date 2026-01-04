/**
 * RecordingManager - Manages event listeners and captures user interactions
 */

import { SelectorEngine } from './selector-engine';
import { LabelFinder } from './label-finder';
import { ElementContext } from './element-context';
import { ElementSimilarity } from './element-similarity';
import { ElementStateCapture } from './element-state';
import { ElementTextCapture } from './element-text';
import { ElementAnalyzer } from '../lib/element-analyzer';
// WaitConditionDeterminer removed - StateWaitEngine handles waits at execution time
import { IframeUtils } from './iframe-utils';
import { ContextScanner } from './context-scanner';
import { SheetStateExtractor } from './sheet-state-extractor';
import { VisualSnapshotService, type AnnotatedCaptureResult } from './visual-snapshot';
import { AIService } from '../lib/ai-service';
import { VisualAnalysisService } from '../lib/visual-analysis';
import { DOMDistiller } from '../lib/dom-distiller';
import { PIIScrubber } from '../lib/pii-scrubber';
import { aiConfig } from '../lib/ai-config';
import { StateWaitEngine } from './state-wait-engine';
import { capturePageSignals, generateOutcomesFromDiff } from './universal-execution/state-verifier';
import { FeatureFlags } from '../lib/feature-flags';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
import type { PageAnalysis, PageType } from '../types/visual';
// Reliable Replayer enhancements
import { buildLocatorBundle } from '../lib/locator-builder';
import { 
  inferClickIntent, 
  inferInputIntent, 
  inferKeyboardIntent,
  inferSuccessCondition,
  buildStepGoal 
} from '../lib/intent-inference';
import { WidgetIdentifierService } from '../lib/widget-identifier';
import type { LocatorBundle } from '../types/locator';
import type { Intent, StepGoal } from '../types/intent';
import type { SuggestedCondition } from '../types/conditions';

export class RecordingManager {
  // Feature flag for reliable replayer enhancements
  private readonly ENABLE_RELIABLE_RECORDING = true;
  
  private isRecording: boolean = false;
  private inputDebounceTimer: number | null = null;
  private clickHandler: ((event: MouseEvent) => void) | null = null;
  private inputHandler: ((event: Event) => void) | null = null;
  private changeHandler: ((event: Event) => void) | null = null;
  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  private focusHandler: ((event: FocusEvent) => void) | null = null;
  private mousedownHandler: ((event: MouseEvent) => void) | null = null;
  private scrollHandler: ((event: Event) => void) | null = null;
  private copyHandler: ((event: ClipboardEvent) => void) | null = null;
  private scrollDebounceTimer: number | null = null;
  private lastScrollStep: { scrollX: number; scrollY: number; timestamp: number; container?: Element } | null = null;
  private pendingScrollEvent: Event | null = null; // Store the scroll event for processing after debounce
  private currentUrl: string = window.location.href;
  private currentTabUrl: string | null = null; // Tab URL (stable identifier, not tabId)
  private currentTabTitle: string | null = null; // Tab title for context
  private readonly DEBOUNCE_DELAY = 500; // 500ms debounce for input events
  private readonly SCROLL_DEBOUNCE_DELAY = 300; // 300ms debounce for scroll events
  private readonly CLICK_DEDUP_WINDOW = 500; // 500ms - ignore duplicate clicks on same element within this window (reduced from 2s to allow rapid different clicks)
  private lastInputStep: { selector: string; value: string } | null = null; // Track last input to prevent duplicates
  private lastClickStep: { selector: string; timestamp: number } | null = null; // Track last click to prevent duplicates
  private pendingInputTimestamp: number | null = null; // Capture INPUT timestamp when event fires, not when debounce completes
  private lastStep: WorkflowStep | null = null; // Track last step for wait condition determination
  // Value Cache Pattern: Cache input values for Google Sheets (contenteditable elements that clear on blur)
  private lastInputValue: string = ''; // Cache for contenteditable values (Google Sheets)
  private currentInputElement: Element | null = null; // Track which element we're editing
  // Visual Snapshot Cache: Promise-based cache for snapshots captured on mousedown
  private pendingSnapshot: Promise<{ viewport: string; elementSnippet: string } | null> | null = null;
  // Visual Annotation: Store annotated snapshot with click markers
  private pendingAnnotatedSnapshot: Promise<AnnotatedCaptureResult | null> | null = null;
  private pendingClickPoint: { x: number; y: number } | null = null;
  // AI Validation: Track pending validations to wait before saving
  private pendingValidations: Promise<void>[] = [];
  // Track pending click processing to ensure last step is captured
  private pendingClickProcessing: Promise<void>[] = [];
  // Track pending click callbacks that can be forcibly executed on stop()
  private pendingClickCallbacks: Array<{ callback: () => Promise<void>; timeoutId?: number }> = [];
  // Phase 4: Human-like visual understanding
  private currentPageAnalysis: PageAnalysis | null = null;
  private pageAnalysisPending: boolean = false;
  // Full page snapshot at recording start (for spreadsheet column header detection)
  private initialFullPageSnapshot: string | null = null;

  /**
   * Start recording - attach event listeners
   */
  start(): void {
    if (this.isRecording) {
      console.warn('Recording already started');
      return;
    }

    this.isRecording = true;
    this.currentUrl = window.location.href;
    this.currentTabUrl = window.location.href;
    this.currentTabTitle = document.title;

    // Add visual indicator
    if (document.body) {
      document.body.setAttribute('data-ghostwriter-recording', 'true');
    }

    // Phase 4: Analyze page type for human-like understanding
    this.analyzeCurrentPage().catch((error) => {
      console.warn('🎨 GhostWriter: Page analysis failed:', error);
    });

    // Capture full page snapshot at start for spreadsheet column header detection
    // This allows AI to see all column headers even when cells are scrolled down
    const isSpreadsheet = VisualSnapshotService.isSpreadsheetDomain();
    if (isSpreadsheet) {
      console.log('📸 GhostWriter: Capturing initial full page snapshot for spreadsheet column headers');
      // Page was refreshed before recording started, so header row should be visible in viewport
      // Verify scroll position is at (0, 0) as a safety check
      const scrollY = window.scrollY || window.pageYOffset || 0;
      if (scrollY !== 0) {
        console.warn('📸 GhostWriter: Scroll position not at top, forcing scroll to (0, 0)');
        window.scrollTo(0, 0);
        // Wait for scroll to complete before capturing
        setTimeout(() => {
          VisualSnapshotService.captureFullPage(0.8).then((fullPage) => {
            if (fullPage) {
              this.initialFullPageSnapshot = fullPage.screenshot;
              console.log('📸 GhostWriter: Initial full page snapshot captured for spreadsheet headers');
            } else {
            }
          }).catch((error) => {
            console.warn('📸 GhostWriter: Failed to capture initial full page snapshot:', error);
          });
        }, 200);
      } else {
        VisualSnapshotService.captureFullPage(0.8).then((fullPage) => {
          if (fullPage) {
            this.initialFullPageSnapshot = fullPage.screenshot;
            console.log('📸 GhostWriter: Initial full page snapshot captured for spreadsheet headers');
          } else {
          }
        }).catch((error) => {
          console.warn('📸 GhostWriter: Failed to capture initial full page snapshot:', error);
        });
      }
    } else {
    }

    // Setup click handler - use CAPTURE phase to catch events before React/Base UI stops propagation
    // This is critical for dropdown options that might have stopPropagation() called
    this.clickHandler = this.handleClick.bind(this);
    document.addEventListener('click', this.clickHandler, true); // true = capture phase

    // Setup input handler - use bubble phase to avoid blocking input
    this.inputHandler = this.handleInput.bind(this);
    document.addEventListener('input', this.inputHandler, false);

    // Setup change handler (for select, checkbox, radio) - use bubble phase
    // Wrap change handler in async callback since it's now async
    this.changeHandler = ((event: Event) => {
      this.handleChange(event).catch((error) => {
        console.error('Error in change handler:', error);
      });
    }).bind(this);
    document.addEventListener('change', this.changeHandler, false);

    // Setup keyboard handler - only capture important keys (Enter, Tab, Escape)
    // Wrap in async handler since handleKeyboard is now async
    this.keyboardHandler = ((event: KeyboardEvent) => {
      this.handleKeyboard(event).catch((error) => {
        console.error('Error in keyboard handler:', error);
      });
    }) as (event: KeyboardEvent) => void;
    document.addEventListener('keydown', this.keyboardHandler, false);

    // Setup focus handler to clear cache when focusing on a new element
    this.focusHandler = this.handleFocus.bind(this);
    document.addEventListener('focus', this.focusHandler, true); // Use capture phase

    // Setup mousedown handler to cache snapshots (Guardrail 3: Prevent race condition)
    this.mousedownHandler = this.handleMousedown.bind(this);
    document.addEventListener('mousedown', this.mousedownHandler, true); // Capture phase

    // Setup scroll handler - debounced to avoid too many events
    this.scrollHandler = this.handleScroll.bind(this);
    window.addEventListener('scroll', this.scrollHandler, true); // Capture phase for all scroll events

    // Setup copy handler to track clipboard operations (Phase 6: Data lineage)
    this.copyHandler = this.handleCopy.bind(this);
    document.addEventListener('copy', this.copyHandler, false);

    console.log('Recording started');
  }

  /**
   * Stop recording - remove event listeners
   * IMPORTANT: Flushes pending debounced steps before stopping to prevent data loss
   * Waits for pending AI validations (max 10 seconds) before completing
   */
  async stop(): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    console.log('🛑 GhostWriter: Stopping recording - flushing pending steps...');

    // ============================================
    // PHASE 1: FLUSH PENDING DEBOUNCED STEPS
    // (Must happen BEFORE setting isRecording = false)
    // ============================================

    // Flush pending input (if there's a debounced input waiting)
    if (this.inputDebounceTimer !== null && this.currentInputElement) {
      console.log('🔄 GhostWriter: Flushing pending input step...');
      clearTimeout(this.inputDebounceTimer);
      this.inputDebounceTimer = null;
      
      try {
        // Capture the pending input value now
        // Use the captured timestamp if available, otherwise use current time
        await this.captureInputValue(
          this.currentInputElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
          this.pendingInputTimestamp || Date.now()
        );
        console.log('✅ GhostWriter: Pending input step flushed successfully');
      } catch (error) {
        console.warn('⚠️ GhostWriter: Failed to flush pending input:', error);
      }
    } else if (this.inputDebounceTimer !== null) {
      // Timer exists but no element tracked - just clear it
      clearTimeout(this.inputDebounceTimer);
      this.inputDebounceTimer = null;
    }

    // Flush pending scroll (if there's a debounced scroll waiting)
    if (this.scrollDebounceTimer !== null) {
      console.log('🔄 GhostWriter: Flushing pending scroll step...');
      clearTimeout(this.scrollDebounceTimer);
      this.scrollDebounceTimer = null;
      
      try {
        // Check if pending scroll event was on a container
        const event = this.pendingScrollEvent;
        let isContainerScroll = false;
        let scrollContainer: Element | null = null;
        let scrollTop = 0;
        let scrollLeft = 0;
        
        if (event && event.target && event.target !== document && event.target !== window && event.target instanceof Element) {
          const element = event.target as Element;
          const style = window.getComputedStyle(element);
          const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                              style.overflowY === 'auto' || style.overflowY === 'scroll';
          
          if (isScrollable && element.scrollHeight > element.clientHeight) {
            isContainerScroll = true;
            scrollContainer = element;
            scrollTop = element.scrollTop;
            scrollLeft = element.scrollLeft;
          }
        }
        
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        
        // Only record if there's been meaningful scroll since last recorded
        const shouldRecordScroll = !this.lastScrollStep || 
          Math.abs((isContainerScroll ? scrollLeft : scrollX) - this.lastScrollStep.scrollX) >= 50 ||
          Math.abs((isContainerScroll ? scrollTop : scrollY) - this.lastScrollStep.scrollY) >= 50;
        
        if (shouldRecordScroll && (scrollX > 0 || scrollY > 0 || scrollTop > 0)) {
          await this.flushPendingScrollStep(scrollX, scrollY, isContainerScroll, scrollContainer, scrollTop, scrollLeft);
          console.log('✅ GhostWriter: Pending scroll step flushed successfully');
        }
      } catch (error) {
        console.warn('⚠️ GhostWriter: Failed to flush pending scroll:', error);
      }
    }

    // Brief delay to allow any in-flight events to START
    // This handles the edge case where user clicks Stop right after an action
    console.log('⏳ GhostWriter: Waiting 300ms for any in-flight events to start...');
    await new Promise(resolve => setTimeout(resolve, 300));

    // ============================================
    // PHASE 1.4: FORCE-EXECUTE PENDING CLICK CALLBACKS
    // (Critical: Ensures the LAST click is processed immediately!)
    // ============================================
    if (this.pendingClickCallbacks.length > 0) {
      console.log(`⚡ GhostWriter: Force-executing ${this.pendingClickCallbacks.length} pending click callback(s)...`);
      const callbacks = [...this.pendingClickCallbacks]; // Copy array as callbacks will remove themselves
      for (const callbackEntry of callbacks) {
        try {
          // Cancel the scheduled callback (it will execute immediately instead)
          if (callbackEntry.timeoutId !== undefined) {
            if (typeof cancelIdleCallback !== 'undefined') {
              cancelIdleCallback(callbackEntry.timeoutId);
            } else {
              clearTimeout(callbackEntry.timeoutId);
            }
          }
          // Execute immediately
          await callbackEntry.callback();
        } catch (error) {
          console.warn('⚠️ GhostWriter: Error force-executing click callback:', error);
        }
      }
      console.log('✅ GhostWriter: All pending click callbacks force-executed');
      this.pendingClickCallbacks = [];
    }

    // ============================================
    // PHASE 1.5: WAIT FOR PENDING CLICK PROCESSING
    // (Critical: This captures the LAST step!)
    // ============================================
    if (this.pendingClickProcessing.length > 0) {
      console.log(`🔄 GhostWriter: Waiting for ${this.pendingClickProcessing.length} pending click(s) to complete...`);
      const waitStartTime = performance.now();
      await Promise.race([
        Promise.all(this.pendingClickProcessing).then(() => {
          const waitTime = performance.now() - waitStartTime;
          console.log(`✅ GhostWriter: All pending clicks completed in ${waitTime.toFixed(2)}ms`);
        }).catch((error) => {
          console.warn('⚠️ GhostWriter: Error waiting for pending clicks:', error);
        }),
        new Promise(resolve => setTimeout(() => {
          const waitTime = performance.now() - waitStartTime;
          console.warn(`⚠️ GhostWriter: Timeout waiting for pending clicks (waited ${waitTime.toFixed(2)}ms, ${this.pendingClickProcessing.length} still pending)`);
          resolve(undefined);
        }, 10000)) // 10 seconds max wait for click processing
      ]);
      this.pendingClickProcessing = [];
    }

    // ============================================
    // PHASE 2: MARK RECORDING AS STOPPED
    // ============================================
    this.isRecording = false;

    // Remove visual indicator
    if (document.body) {
      document.body.removeAttribute('data-ghostwriter-recording');
    }

    // ============================================
    // PHASE 3: REMOVE EVENT LISTENERS
    // ============================================

    // Remove event listeners (must match the phase used in addEventListener)
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true); // true = capture phase (matches addEventListener)
      this.clickHandler = null;
    }

    if (this.inputHandler) {
      document.removeEventListener('input', this.inputHandler, false);
      this.inputHandler = null;
    }

    if (this.changeHandler) {
      document.removeEventListener('change', this.changeHandler, false);
      this.changeHandler = null;
    }

    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler, false);
      this.keyboardHandler = null;
    }

    if (this.focusHandler) {
      document.removeEventListener('focus', this.focusHandler, true);
      this.focusHandler = null;
    }

    if (this.mousedownHandler) {
      document.removeEventListener('mousedown', this.mousedownHandler, true);
      this.mousedownHandler = null;
    }

    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler, true);
      this.scrollHandler = null;
    }

    if (this.copyHandler) {
      document.removeEventListener('copy', this.copyHandler, false);
      this.copyHandler = null;
    }

    // ============================================
    // PHASE 4: CLEANUP STATE
    // ============================================

    // Clear last input step tracking
    this.lastInputStep = null;
    this.lastClickStep = null;
    this.lastStep = null;
    this.lastInputValue = '';
    this.currentInputElement = null;
    this.pendingSnapshot = null;

    // ============================================
    // PHASE 5: WAIT FOR AI VALIDATIONS
    // ============================================
    if (this.pendingValidations.length > 0) {
      console.log(`🤖 GhostWriter: Waiting for ${this.pendingValidations.length} pending AI validation(s) to complete...`);
      const waitStartTime = performance.now();
      await Promise.race([
        Promise.all(this.pendingValidations).then(() => {
          const waitTime = performance.now() - waitStartTime;
          console.log(`🤖 GhostWriter: All AI validations completed in ${waitTime.toFixed(2)}ms`);
        }).catch((error) => {
          const waitTime = performance.now() - waitStartTime;
          console.warn(`🤖 GhostWriter: Some AI validations failed after ${waitTime.toFixed(2)}ms:`, error);
        }),
        new Promise(resolve => setTimeout(() => {
          const waitTime = performance.now() - waitStartTime;
          console.warn(`🤖 GhostWriter: Timeout waiting for AI validations (waited ${waitTime.toFixed(2)}ms, ${this.pendingValidations.length} still pending)`);
          resolve(undefined);
        }, 10000)) // 10 seconds to allow AI requests to complete
      ]);
      this.pendingValidations = [];
    }

    console.log('✅ GhostWriter: Recording stopped successfully');
  }

  /**
   * Flush a pending scroll step - helper for stop()
   * NOW SUPPORTS: Page scrolls AND container scrolls (modals, divs, etc.)
   */
  private async flushPendingScrollStep(
    scrollX: number, 
    scrollY: number,
    isContainerScroll: boolean = false,
    scrollContainer: Element | null = null,
    scrollTop: number = 0,
    scrollLeft: number = 0
  ): Promise<void> {
    const url = window.location.href;
    const currentTimestamp = Date.now();

    // Capture viewport snapshot for scroll (shows what's visible after scrolling)
    let visualSnapshot: WorkflowStepPayload['visualSnapshot'] | undefined;
    try {
      console.log('📸 GhostWriter: Capturing snapshot for flushed scroll event');
      const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
      if (response && response.data?.snapshot) {
        const viewportSnapshot = response.data.snapshot;
        visualSnapshot = {
          viewport: viewportSnapshot,
          elementSnippet: viewportSnapshot,
          timestamp: Date.now(),
          viewportSize: {
            width: window.innerWidth,
            height: window.innerHeight
          },
        };
      }
    } catch (snapshotError) {
      console.warn('📸 GhostWriter: Failed to capture snapshot for flushed scroll:', snapshotError);
    }

    // Capture viewport information (matching existing scroll step format)
    const viewport: import('../types/workflow').ViewportInfo = {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX,
      scrollY,
      // Store container scroll info if this is a container scroll
      ...(isContainerScroll && scrollContainer && {
        elementScrollContainer: {
          selector: scrollContainer.getAttribute('class') 
            ? `.${scrollContainer.getAttribute('class')?.split(' ')[0]}`
            : scrollContainer.tagName.toLowerCase(),
          scrollTop,
          scrollLeft,
        }
      }),
    };

    // Capture timing information
    const delayAfter = this.lastStep ? (currentTimestamp - this.lastStep.payload.timestamp) : undefined;
    const timing: import('../types/workflow').TimingInfo | undefined = delayAfter ? {
      delayAfter,
    } : undefined;

    // Generate selectors for the scroll target
    let selector = 'body';
    let fallbackSelectors = ['body', 'html'];
    let xpath = '/html/body';
    
    if (isContainerScroll && scrollContainer) {
      // Generate proper selectors for the container
      const containerSelectors = SelectorEngine.generateSelectors(scrollContainer, undefined);
      selector = containerSelectors.primary || 'body';
      fallbackSelectors = [
        containerSelectors.primary,
        ...containerSelectors.fallbacks,
      ].filter((s): s is string => !!s);
      xpath = containerSelectors.xpath || '/html/body';
    }

    const stepPayload: WorkflowStep['payload'] = {
      selector,
      fallbackSelectors,
      xpath,
      timestamp: currentTimestamp,
      url: url,
      tabUrl: this.currentTabUrl || undefined,
      tabTitle: this.currentTabTitle || undefined,
      tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
      viewport,
      timing,
      visualSnapshot, // Visual snapshot for AI description generation
    };

    const step: WorkflowStep = {
      type: 'SCROLL',
      payload: stepPayload,
    };

    // Update tracking
    this.lastScrollStep = {
      scrollX: isContainerScroll ? scrollLeft : scrollX,
      scrollY: isContainerScroll ? scrollTop : scrollY,
      timestamp: currentTimestamp,
      container: scrollContainer || undefined,
    };
    this.lastStep = step;

    // Send step
    await this.sendStep(step);
  }

  /**
   * Get the initial full page snapshot captured at recording start (synchronous version).
   * Used for spreadsheet column header detection.
   * @deprecated Use getInitialFullPageSnapshotAsync() instead to ensure capture is complete
   */
  getInitialFullPageSnapshot(): string | null {
    console.log('📸 GhostWriter: getInitialFullPageSnapshot called (sync)', {
      hasSnapshot: !!this.initialFullPageSnapshot,
      snapshotLength: this.initialFullPageSnapshot?.length || 0,
      isSpreadsheetDomain: VisualSnapshotService.isSpreadsheetDomain(),
    });
    return this.initialFullPageSnapshot;
  }

  /**
   * Get the initial full page snapshot captured at recording start (async version).
   * Used for spreadsheet column header detection.
   * Note: Snapshot is captured asynchronously when recording starts, so it may not be available immediately.
   */
  async getInitialFullPageSnapshotAsync(): Promise<string | null> {
    console.log('📸 GhostWriter: getInitialFullPageSnapshotAsync called', {
      hasSnapshot: !!this.initialFullPageSnapshot,
      snapshotLength: this.initialFullPageSnapshot?.length || 0,
      isSpreadsheetDomain: VisualSnapshotService.isSpreadsheetDomain(),
    });
    
    // If snapshot is already available, return it immediately
    if (this.initialFullPageSnapshot) {
      return this.initialFullPageSnapshot;
    }
    
    // Otherwise, wait a bit for the async capture to complete (max 2 seconds)
    // The capture happens in start() method asynchronously
    await new Promise(resolve => setTimeout(resolve, 100));
    
    
    return this.initialFullPageSnapshot;
  }

  /**
   * Check if element is a list item or option (for dropdown/menu items)
   */
  private isListItemOrOption(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'listitem') {
      console.log('🔍 GhostWriter: Element is list item/option (by role):', role);
      return true;
    }

    const tagName = element.tagName.toLowerCase();
    if (tagName === 'li' || tagName === 'option') {
      console.log('🔍 GhostWriter: Element is list item/option (by tag):', tagName);
      return true;
    }

    // Check class names for common patterns
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('option') || 
        className.includes('menuitem') || 
        className.includes('list-item') ||
        className.includes('dropdown-item') ||
        className.includes('select-option')) {
      console.log('🔍 GhostWriter: Element is list item/option (by class):', className.substring(0, 50));
      return true;
    }

    // CRITICAL: Check if element is inside a dropdown/listbox/menu container
    // Many React dropdowns don't set role="option" on the option elements themselves
    // They just use div elements inside a [role="listbox"] or [role="menu"] container
    const container = element.closest('[role="listbox"], [role="menu"], [role="list"], select, [data-baseui="listbox"], [data-baseui="menu"]');
    if (container && element !== container) {
      // ENHANCED LOGGING: Show container details
      const containerInfo = {
        tag: container.tagName,
        role: container.getAttribute('role'),
        label: container.getAttribute('aria-label'),
        id: container.id,
        elementTag: element.tagName,
        elementText: (element as HTMLElement).textContent?.trim().substring(0, 50),
      };
      
      // If we're inside a dropdown container, this is very likely a dropdown option
      // Be permissive: any clickable element inside a listbox/menu is probably an option
      // This catches cases where the option is a div inside a listbox without explicit roles
      if (this.isInteractiveElement(element)) {
        console.log('🔍 GhostWriter: Detected dropdown option inside container:', containerInfo);
        return true;
      }
      
      // Also check if this is a direct child of the container (even if not explicitly interactive)
      // Some dropdowns use non-interactive divs that become clickable via event handlers
      const isDirectChild = element.parentElement === container;
      if (isDirectChild) {
        console.log('🔍 GhostWriter: Detected direct child of dropdown container as option:', containerInfo);
        return true;
      }
    }

    // Check if parent has list-related role
    const parent = element.parentElement;
    if (parent) {
      const parentRole = parent.getAttribute('role');
      if (parentRole === 'listbox' || 
          parentRole === 'menu' || 
          parentRole === 'list') {
        console.log('🔍 GhostWriter: Element is list item/option (parent has list role):', parentRole);
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an element is an overlay (mask, backdrop, etc.)
   */
  private isOverlayElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const className = element.className?.toString().toLowerCase() || '';
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check tag name
    if (tagName.includes('overlay') || tagName.includes('backdrop') || tagName.includes('mask')) {
      return true;
    }
    
    // Check class names
    if (className.includes('overlay') || className.includes('backdrop') || className.includes('mask') || className.includes('modal-backdrop')) {
      return true;
    }
    
    // Check styles - invisible elements with pointer-events: none are likely overlays
    if (style.pointerEvents === 'none' && style.position === 'absolute') {
      return true;
    }
    
    return false;
  }

  /**
   * Check if an element is interactive/clickable
   * IMPORTANT: Must be permissive for modern React/Angular apps that use div/span with click handlers
   */
  private isInteractiveElement(element: Element): boolean {
    const htmlEl = element as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    const style = window.getComputedStyle(htmlEl);
    
    // 1. Widget elements are always interactive
    if (tagName.includes('widget') || tagName.includes('gs-report') || 
        element.className?.toString().includes('widget')) {
      return true;
    }
    
    // 2. Cursor pointer is a strong indicator (handles React/Angular div/span buttons)
    if (style.cursor === 'pointer' || style.cursor === 'grab') {
      return true;
    }
    
    // 3. Standard interactive tags
    if (['button', 'a', 'select', 'textarea'].includes(tagName) ||
        (tagName === 'input' && ['button', 'submit', 'checkbox', 'radio'].includes((htmlEl as HTMLInputElement).type))) {
      return true;
    }
    
    // 4. ARIA roles
    const role = element.getAttribute('role');
    if (role && ['button', 'link', 'menuitem', 'tab', 'option'].includes(role)) {
      return true;
    }
    
    // 5. Fallback: visible element with reasonable size (permissive)
    if (ElementStateCapture.isElementVisible(element)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        return true; // Assume potentially interactive
      }
    }
    
    return false;
  }

  /**
   * Find the actual clickable element when clicking on an overlay (SYNCHRONOUS version)
   * This version accepts pre-captured elements to avoid race conditions with disappearing dropdowns
   * If the element is invisible (overlay), find the widget/container underneath
   * Returns null if no visible, interactive target can be found
   */
  private findActualClickableElementSync(element: Element, event: MouseEvent, elementsAtPoint: Element[]): Element | null {
    // Check if element is visible and not an overlay
    const isVisible = ElementStateCapture.isElementVisible(element);
    const isOverlay = this.isOverlayElement(element);
    
    // If visible and not an overlay, return as-is
    if (isVisible && !isOverlay && this.isInteractiveElement(element)) {
      return element;
    }

    // Element is invisible or is an overlay, try to find the actual clickable element

    // Strategy 1: Use pre-captured elementsAtPoint (already captured synchronously)
    // This is more reliable than elementFromPoint (singular) which might return the overlay
    // PRIORITY: Prefer smaller, more specific elements (buttons, menu items) over large containers (widgets)
    try {
      // ENHANCED LOGGING: Log all elements at this point for debugging
      console.log('🔍 GhostWriter: Elements at click point (', event.clientX, ',', event.clientY, '):', 
        elementsAtPoint.slice(0, 10).map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          text: (el as HTMLElement).textContent?.trim().substring(0, 30),
          classes: el.className?.toString().substring(0, 50),
          isVisible: ElementStateCapture.isElementVisible(el),
          isOverlay: this.isOverlayElement(el),
          isListItem: this.isListItemOrOption(el),
          size: `${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height}`
        }))
      );
      
      // Filter for visible, interactive elements that are not overlays
      // CRITICAL: Be permissive for list items/options (portal elements)
      const visibleElements = elementsAtPoint.filter(el => {
        if (el === element) return false; // Skip the original overlay element
        if (this.isOverlayElement(el)) return false; // Skip other overlays
        
        // For list items/options, be more permissive with visibility
        const isListItemOrOption = this.isListItemOrOption(el);
        const isVisible = ElementStateCapture.isElementVisible(el);
        if (!isVisible && !isListItemOrOption) return false; // Must be visible (unless list item/option)
        
        return this.isInteractiveElement(el); // Must be interactive
      });
      
      console.log('🔍 GhostWriter: Filtered to', visibleElements.length, 'visible, interactive elements');
      
      if (visibleElements.length > 0) {
        // PRIORITY: Prefer smaller, more specific elements over large containers
        // Sort by: buttons/menu items first, then by size (smaller = more specific)
        const sorted = visibleElements.sort((a, b) => {
          const aTag = a.tagName.toLowerCase();
          const bTag = b.tagName.toLowerCase();
          const aRole = a.getAttribute('role');
          const bRole = b.getAttribute('role');
          
          // Prioritize buttons, menu items, links
          const aIsSpecific = aTag === 'button' || aTag === 'a' || aRole === 'button' || aRole === 'menuitem' || aRole === 'option';
          const bIsSpecific = bTag === 'button' || bTag === 'a' || bRole === 'button' || bRole === 'menuitem' || bRole === 'option';
          
          if (aIsSpecific && !bIsSpecific) return -1;
          if (!aIsSpecific && bIsSpecific) return 1;
          
          // If both are specific or both are not, prefer smaller elements (more specific)
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const aSize = aRect.width * aRect.height;
          const bSize = bRect.width * bRect.height;
          
          // Prefer smaller elements (they're more specific)
          return aSize - bSize;
        });
        
        // ENHANCED LOGGING: Show all candidates and why the selected one was chosen
        console.log('🔍 GhostWriter: Sorted candidates:', sorted.slice(0, 5).map((el, idx) => {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const rect = el.getBoundingClientRect();
          const isSpecific = tag === 'button' || tag === 'a' || role === 'button' || role === 'menuitem' || role === 'option';
          return {
            rank: idx + 1,
            tag,
            role,
            text: (el as HTMLElement).textContent?.trim().substring(0, 30),
            size: `${rect.width}x${rect.height}`,
            isSpecific,
            isListItem: this.isListItemOrOption(el),
          };
        }));
        
        const selected = sorted[0];
        const selectedTag = selected.tagName.toLowerCase();
        const selectedRole = selected.getAttribute('role');
        const selectedText = (selected as HTMLElement).textContent?.trim().substring(0, 50);
        console.log('✅ GhostWriter: Selected element from elementsFromPoint:', selectedTag, 'Role:', selectedRole, 'Text:', selectedText, 'Size:', selected.getBoundingClientRect().width, 'x', selected.getBoundingClientRect().height);
        
        // ENHANCED LOGGING: Check if there are multiple dropdown containers
        const dropdownContainers = elementsAtPoint.filter(el => 
          el.getAttribute('role') === 'listbox' || 
          el.getAttribute('role') === 'menu' ||
          el.getAttribute('role') === 'combobox'
        );
        if (dropdownContainers.length > 1) {
          console.warn('⚠️ GhostWriter: Multiple dropdown containers detected at click point!', {
            count: dropdownContainers.length,
            containers: dropdownContainers.map(el => ({
              role: el.getAttribute('role'),
              label: el.getAttribute('aria-label'),
              id: el.id,
            }))
          });
        }
        
        return selected;
      }
    } catch (error) {
      console.warn('GhostWriter: Error using elementsFromPoint:', error);
    }

    // Strategy 2: Traverse up the DOM to find interactive elements (buttons, menu items) FIRST
    // Only fall back to widget containers if no interactive element is found
    let current: Element | null = element.parentElement;
    let level = 0;
    const maxLevels = 10;
    let foundInteractiveElement: Element | null = null;
    const widgetTags = ['gs-report-widget-element', 'gs-widget', 'widget', 'gridster-item'];

    while (current && level < maxLevels && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      
      // PRIORITY: Look for actual interactive elements (buttons, menu items, etc.)
      // These should be preferred over widget containers
      const isInteractive = this.isInteractiveElement(current);
      const isButton = tagName === 'button' || role === 'button' || role === 'menuitem';
      const isMenuItem = role === 'menuitem' || role === 'option' || role === 'listitem';
      const isLink = tagName === 'a' || role === 'link';
      
      if (isInteractive && (isButton || isMenuItem || isLink)) {
        // Found an actual interactive element - prefer this over widget containers
        if (ElementStateCapture.isElementVisible(current)) {
          foundInteractiveElement = current;
          // Continue searching to see if there's a more specific element (closer to click)
        }
      }
      
      // Only check for widget containers if we haven't found an interactive element yet
      if (!foundInteractiveElement && widgetTags.some(wt => tagName.includes(wt))) {
        // Check if it's visible and interactive
        if (ElementStateCapture.isElementVisible(current) && this.isInteractiveElement(current)) {
          // Only use widget as fallback if no interactive element was found
          if (level < 3) {
            // Widget is close to the element, might be the actual target
            // But prefer interactive elements found later
            current = current.parentElement;
            level++;
            continue;
          }
        }
      }

      current = current.parentElement;
      level++;
    }
    
    // Return the interactive element if found, otherwise continue to Strategy 3
    if (foundInteractiveElement) {
      console.log('GhostWriter: Found interactive element in parent hierarchy:', foundInteractiveElement.tagName, 'Role:', foundInteractiveElement.getAttribute('role'));
      return foundInteractiveElement;
    }

    // Strategy 3: If element is an overlay, search for widget elements in parent hierarchy
    if (isOverlay) {
      let parent: Element | null = element.parentElement;
      level = 0;
      while (parent && level < 5 && parent !== document.body) {
        // Look for widget elements within the parent
        for (const widgetTag of widgetTags) {
          const widget = parent.querySelector(widgetTag);
          if (widget && ElementStateCapture.isElementVisible(widget) && this.isInteractiveElement(widget)) {
            return widget;
          }
        }
        parent = parent.parentElement;
        level++;
      }
    }

      // Strategy 4: Try to find any visible, interactive element near the click point
      // This is a last resort - look for siblings or nearby elements
      try {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Try elementsFromPoint at the center of the element
        const elementsAtCenter = document.elementsFromPoint(centerX, centerY);
        for (const el of elementsAtCenter) {
          if (el === element) continue;
          if (this.isOverlayElement(el)) continue;
          
          // Check if visible and interactive
          if (ElementStateCapture.isElementVisible(el) && this.isInteractiveElement(el)) {
            return el;
          }
        }
      } catch (error) {
        // Ignore errors in fallback strategy
      }

      // CRITICAL: If the original element is a list item/option, return it even if visibility checks fail
      // Portal elements might have visibility quirks, but we still want to record them
      if (this.isListItemOrOption(element)) {
        console.log('GhostWriter: Returning list item/option element despite visibility/overlay checks (portal element)');
        return element;
      }

      // If no better target found, return null (caller will skip recording)
      console.warn('GhostWriter: Could not find visible, interactive element for click. Original element:', element.tagName, 'Visible:', isVisible, 'Overlay:', isOverlay);
      return null;
  }

  /**
   * DEPRECATED: Find the actual clickable element when clicking on an overlay (LEGACY async version)
   * This method is no longer used - replaced by findActualClickableElementSync to avoid race conditions
   * Kept for reference only
   * @deprecated Use findActualClickableElementSync to prevent dropdown race conditions
   */
  // @ts-ignore - Deprecated method kept for reference
  private _DEPRECATED_findActualClickableElement(element: Element, event: MouseEvent): Element | null {
    // Check if element is visible and not an overlay
    const isVisible = ElementStateCapture.isElementVisible(element);
    const isOverlay = this.isOverlayElement(element);
    
    // If visible and not an overlay, return as-is
    if (isVisible && !isOverlay && this.isInteractiveElement(element)) {
      return element;
    }

    // Element is invisible or is an overlay, try to find the actual clickable element

    // Strategy 1: Use elementsFromPoint to get ALL elements at click coordinates
    // This is more reliable than elementFromPoint (singular) which might return the overlay
    // PRIORITY: Prefer smaller, more specific elements (buttons, menu items) over large containers (widgets)
    try {
      const elementsAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
      
      // ENHANCED LOGGING: Log all elements at this point for debugging
      console.log('🔍 GhostWriter: Elements at click point (', event.clientX, ',', event.clientY, '):', 
        elementsAtPoint.slice(0, 10).map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          text: (el as HTMLElement).textContent?.trim().substring(0, 30),
          classes: el.className?.toString().substring(0, 50),
          isVisible: ElementStateCapture.isElementVisible(el),
          isOverlay: this.isOverlayElement(el),
          isListItem: this.isListItemOrOption(el),
          size: `${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height}`
        }))
      );
      
      // Filter for visible, interactive elements that are not overlays
      // CRITICAL: Be permissive for list items/options (portal elements)
      const visibleElements = elementsAtPoint.filter(el => {
        if (el === element) return false; // Skip the original overlay element
        if (this.isOverlayElement(el)) return false; // Skip other overlays
        
        // For list items/options, be more permissive with visibility
        const isListItemOrOption = this.isListItemOrOption(el);
        const isVisible = ElementStateCapture.isElementVisible(el);
        if (!isVisible && !isListItemOrOption) return false; // Must be visible (unless list item/option)
        
        return this.isInteractiveElement(el); // Must be interactive
      });
      
      console.log('🔍 GhostWriter: Filtered to', visibleElements.length, 'visible, interactive elements');
      
      if (visibleElements.length > 0) {
        // PRIORITY: Prefer smaller, more specific elements over large containers
        // Sort by: buttons/menu items first, then by size (smaller = more specific)
        const sorted = visibleElements.sort((a, b) => {
          const aTag = a.tagName.toLowerCase();
          const bTag = b.tagName.toLowerCase();
          const aRole = a.getAttribute('role');
          const bRole = b.getAttribute('role');
          
          // Prioritize buttons, menu items, links
          const aIsSpecific = aTag === 'button' || aTag === 'a' || aRole === 'button' || aRole === 'menuitem' || aRole === 'option';
          const bIsSpecific = bTag === 'button' || bTag === 'a' || bRole === 'button' || bRole === 'menuitem' || bRole === 'option';
          
          if (aIsSpecific && !bIsSpecific) return -1;
          if (!aIsSpecific && bIsSpecific) return 1;
          
          // If both are specific or both are not, prefer smaller elements (more specific)
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const aSize = aRect.width * aRect.height;
          const bSize = bRect.width * bRect.height;
          
          // Prefer smaller elements (they're more specific)
          return aSize - bSize;
        });
        
        // ENHANCED LOGGING: Show all candidates and why the selected one was chosen
        console.log('🔍 GhostWriter: Sorted candidates:', sorted.slice(0, 5).map((el, idx) => {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const rect = el.getBoundingClientRect();
          const isSpecific = tag === 'button' || tag === 'a' || role === 'button' || role === 'menuitem' || role === 'option';
          return {
            rank: idx + 1,
            tag,
            role,
            text: (el as HTMLElement).textContent?.trim().substring(0, 30),
            size: `${rect.width}x${rect.height}`,
            isSpecific,
            isListItem: this.isListItemOrOption(el),
          };
        }));
        
        const selected = sorted[0];
        const selectedTag = selected.tagName.toLowerCase();
        const selectedRole = selected.getAttribute('role');
        const selectedText = (selected as HTMLElement).textContent?.trim().substring(0, 50);
        console.log('✅ GhostWriter: Selected element from elementsFromPoint:', selectedTag, 'Role:', selectedRole, 'Text:', selectedText, 'Size:', selected.getBoundingClientRect().width, 'x', selected.getBoundingClientRect().height);
        
        // ENHANCED LOGGING: Check if there are multiple dropdown containers
        const dropdownContainers = elementsAtPoint.filter(el => 
          el.getAttribute('role') === 'listbox' || 
          el.getAttribute('role') === 'menu' ||
          el.getAttribute('role') === 'combobox'
        );
        if (dropdownContainers.length > 1) {
          console.warn('⚠️ GhostWriter: Multiple dropdown containers detected at click point!', {
            count: dropdownContainers.length,
            containers: dropdownContainers.map(el => ({
              role: el.getAttribute('role'),
              label: el.getAttribute('aria-label'),
              id: el.id,
            }))
          });
        }
        
        return selected;
      }
    } catch (error) {
      console.warn('GhostWriter: Error using elementsFromPoint:', error);
    }

    // Strategy 2: Traverse up the DOM to find interactive elements (buttons, menu items) FIRST
    // Only fall back to widget containers if no interactive element is found
    let current: Element | null = element.parentElement;
    let level = 0;
    const maxLevels = 10;
    let foundInteractiveElement: Element | null = null;
    const widgetTags = ['gs-report-widget-element', 'gs-widget', 'widget', 'gridster-item'];

    while (current && level < maxLevels && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      
      // PRIORITY: Look for actual interactive elements (buttons, menu items, etc.)
      // These should be preferred over widget containers
      const isInteractive = this.isInteractiveElement(current);
      const isButton = tagName === 'button' || role === 'button' || role === 'menuitem';
      const isMenuItem = role === 'menuitem' || role === 'option' || role === 'listitem';
      const isLink = tagName === 'a' || role === 'link';
      
      if (isInteractive && (isButton || isMenuItem || isLink)) {
        // Found an actual interactive element - prefer this over widget containers
        if (ElementStateCapture.isElementVisible(current)) {
          foundInteractiveElement = current;
          // Continue searching to see if there's a more specific element (closer to click)
        }
      }
      
      // Only check for widget containers if we haven't found an interactive element yet
      if (!foundInteractiveElement && widgetTags.some(wt => tagName.includes(wt))) {
        // Check if it's visible and interactive
        if (ElementStateCapture.isElementVisible(current) && this.isInteractiveElement(current)) {
          // Only use widget as fallback if no interactive element was found
          if (level < 3) {
            // Widget is close to the element, might be the actual target
            // But prefer interactive elements found later
            current = current.parentElement;
            level++;
            continue;
          }
        }
      }

      current = current.parentElement;
      level++;
    }
    
    // Return the interactive element if found, otherwise continue to Strategy 3
    if (foundInteractiveElement) {
      console.log('GhostWriter: Found interactive element in parent hierarchy:', foundInteractiveElement.tagName, 'Role:', foundInteractiveElement.getAttribute('role'));
      return foundInteractiveElement;
    }

    // Strategy 3: If element is an overlay, search for widget elements in parent hierarchy
    if (isOverlay) {
      let parent: Element | null = element.parentElement;
      level = 0;
      while (parent && level < 5 && parent !== document.body) {
        // Look for widget elements within the parent
        for (const widgetTag of widgetTags) {
          const widget = parent.querySelector(widgetTag);
          if (widget && ElementStateCapture.isElementVisible(widget) && this.isInteractiveElement(widget)) {
            return widget;
          }
        }
        parent = parent.parentElement;
        level++;
      }
    }

      // Strategy 4: Try to find any visible, interactive element near the click point
      // This is a last resort - look for siblings or nearby elements
      try {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Try elementsFromPoint at the center of the element
        const elementsAtCenter = document.elementsFromPoint(centerX, centerY);
        for (const el of elementsAtCenter) {
          if (el === element) continue;
          if (this.isOverlayElement(el)) continue;
          
          // CRITICAL: For list items/options, be more permissive with visibility
          const isListItemOrOption = this.isListItemOrOption(el);
          const isVisible = ElementStateCapture.isElementVisible(el);
          const isInteractive = this.isInteractiveElement(el);
          
          if ((isVisible || isListItemOrOption) && isInteractive) {
            return el;
          }
        }
      } catch (error) {
        // Ignore errors in fallback strategy
      }

      // CRITICAL: If the original element is a list item/option, return it even if visibility checks fail
      // Portal elements might have visibility quirks, but we still want to record them
      if (this.isListItemOrOption(element)) {
        console.log('GhostWriter: Returning list item/option element despite visibility/overlay checks (portal element)');
        return element;
      }

      // If no better target found, return null (caller will skip recording)
      console.warn('GhostWriter: Could not find visible, interactive element for click. Original element:', element.tagName, 'Visible:', isVisible, 'Overlay:', isOverlay);
      return null;
  }

  private getActualElement(event: Event): Element | null {
    // Use composedPath to get the actual element (works across shadow boundaries)
    if ('composedPath' in event) {
      const path = event.composedPath();
      // First element in path is the actual target
      if (path.length > 0 && path[0] instanceof Element) {
        return path[0] as Element;
      }
    }
    
    // Fallback to target
    return (event.target as Element) || null;
  }

  /**
   * Find the scrollable container for an element
   */
  private findScrollContainer(element: Element): HTMLElement | null {
    let current: Element | null = element;
    const maxLevels = 10;
    let level = 0;

    while (current && level < maxLevels && current !== document.body && current !== document.documentElement) {
      if (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const overflow = style.overflow || style.overflowY || style.overflowX;
        
        // Check if element is scrollable
        if (overflow === 'auto' || overflow === 'scroll') {
          // Verify it actually scrolls
          if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
            return current;
          }
        }
      }
      
      current = current.parentElement;
      level++;
    }

    return null;
  }


  /**
   * Handle click events
   * IMPORTANT: Using capture phase (useCapture: true) to catch events before React/Base UI stops propagation
   * This is critical for dropdown options that might have stopPropagation() called
   * 
   * CRITICAL FIX: Capture element SYNCHRONOUSLY before async processing
   * This prevents race conditions where dropdowns close before element detection completes
   */
  private handleClick(event: MouseEvent): void {
    if (!this.isRecording) {
      console.log('GhostWriter: Click received but recording is not active');
      return;
    }

    // CRITICAL: Capture click timestamp SYNCHRONOUSLY before async processing
    // This ensures correct step ordering even when async processing delays occur
    const clickTimestamp = Date.now();

    console.log('GhostWriter: Click event received, processing... (timestamp:', clickTimestamp, ')');

    // CRITICAL: Capture element and all detection data SYNCHRONOUSLY before dropdown can close
    // This fixes the race condition where dropdown options disappear before async processing
    const actualElement = this.getActualElement(event);
    if (!actualElement) {
      console.warn('GhostWriter: No actual element found for click event');
      return;
    }
    
    console.log('GhostWriter: Processing click on element:', actualElement.tagName, 'Classes:', actualElement.className?.toString()?.substring(0, 50));
    
    // Pre-check if this is a list item/option (before async processing)
    let isListItemOrOption = this.isListItemOrOption(actualElement);
    
    // CRITICAL: Check if the last step was a dropdown trigger - if so, this click is likely a dropdown item
    const wasDropdownTrigger = (this.lastStep && isWorkflowStepPayload(this.lastStep.payload) && (
      this.lastStep.payload.elementRole === 'combobox' ||
      this.lastStep.payload.elementRole === 'listbox' ||
      this.lastStep.payload.selector?.includes('[role="combobox"]') ||
      this.lastStep.payload.selector?.includes('[role="listbox"]') ||
      this.lastStep.payload.selector?.includes('[role="menu"]')
    )) || false;
    
    // If last step was a dropdown trigger and this click is within 2 seconds, treat it as a dropdown item
    const timeSinceLastStep = this.lastStep ? (Date.now() - this.lastStep.payload.timestamp) : Infinity;
    if (wasDropdownTrigger && timeSinceLastStep < 2000) {
      console.log('GhostWriter: Last step was dropdown trigger - treating this click as dropdown item');
      isListItemOrOption = true; // Force treat as dropdown item
    }
    
    // Capture all elements at click point NOW (before dropdown closes)
    let elementsAtClickPoint: Element[] = [];
    try {
      elementsAtClickPoint = document.elementsFromPoint(event.clientX, event.clientY);
      console.log('🔍 GhostWriter: Captured', elementsAtClickPoint.length, 'elements at click point synchronously');
    } catch (error) {
      console.warn('GhostWriter: Error capturing elements at click point:', error);
    }
    
    // Find clickable element NOW (before dropdown closes)
    let clickableElement: Element | null;
    if (isListItemOrOption) {
      // For list items/options, use the element directly (portals might not pass visibility checks)
      // Only try overlay piercing if it's clearly an overlay
      if (this.isOverlayElement(actualElement)) {
        clickableElement = this.findActualClickableElementSync(actualElement, event, elementsAtClickPoint);
      } else {
        clickableElement = actualElement;
      }
    } else {
      clickableElement = this.findActualClickableElementSync(actualElement, event, elementsAtClickPoint);
    }
    
    if (!clickableElement) {
      console.warn('GhostWriter: No clickable element found synchronously. Original element:', actualElement.tagName);
      return;
    }
    
    console.log('GhostWriter: Clickable element found synchronously:', clickableElement.tagName, 'Text:', (clickableElement as HTMLElement).textContent?.trim()?.substring(0, 50));

    // CRITICAL: Capture visibility state SYNCHRONOUSLY (before modal/dropdown closes)
    // If we successfully found the element synchronously, it WAS visible at click time
    const wasVisibleAtClickTime = ElementStateCapture.isElementVisible(clickableElement);
    console.log('GhostWriter: Element visibility at click time:', wasVisibleAtClickTime);

    // Process asynchronously to avoid blocking the click event
    // Use requestIdleCallback or setTimeout(0) to ensure event can propagate
    // Note: We're in capture phase, so we see the event before it reaches the target
    const processClick = async () => {
      try {
        // Use the already-captured element and detection data
        // This prevents race conditions where dropdown closes before we can detect it
        // All element detection was done SYNCHRONOUSLY before dropdown could close
        
        // RE-CHECK: Verify the final clickable element is also a list item/option
        // This is important because findActualClickableElementSync might have found a different element
        const finalIsListItemOrOption = isListItemOrOption || this.isListItemOrOption(clickableElement);
        
        // CRITICAL FIX: Use the visibility state captured synchronously, not the current state
        // By the time async processing happens, modals/dropdowns may have closed
        // But if the element was visible at click time (wasVisibleAtClickTime), that's what matters
        if (!wasVisibleAtClickTime && !finalIsListItemOrOption) {
          console.warn('GhostWriter: Skipping click on element that was invisible at click time. Original element:', actualElement.tagName, 'Clickable element:', clickableElement.tagName);
          return; // Don't record elements that were invisible at click time
        }
        
        console.log('GhostWriter: Element was visible at click time, proceeding with recording...');
        
        // OUTCOME DIFFING: Capture "before" state
        const beforeSignals = FeatureFlags.OUTCOME_VERIFICATION ? 
          capturePageSignals(clickableElement) : 
          null;
        if (beforeSignals) {
          console.log('[OutcomeDiff] Before signals captured:', {
            url: beforeSignals.url,
            modals: beforeSignals.modals.length,
            toasts: beforeSignals.toasts.length,
            spinners: beforeSignals.spinnerCount,
          });
        }
        
        // Log if we're recording a list item/option (for debugging)
        if (finalIsListItemOrOption) {
          console.log('GhostWriter: Recording list item/option click:', clickableElement.tagName, 'Text:', (clickableElement as HTMLElement).textContent?.trim()?.substring(0, 50));
        }
        
        const target = clickableElement as HTMLElement;

        // Ignore clicks on extension UI elements
        if (target.closest && target.closest('[data-ghostwriter]')) {
          return;
        }

        // CRITICAL: For list items/options, log the element details for debugging
        if (finalIsListItemOrOption) {
          const role = target.getAttribute('role');
          const className = target.className?.toString() || '';
          const text = target.textContent?.trim()?.substring(0, 100) || '';
          console.log('GhostWriter: List item/option detected - Role:', role, 'Class:', className.substring(0, 50), 'Text:', text);
          
          // Find parent container to log and validate
          const container = target.closest('[role="listbox"], [role="menu"], [role="list"], ul, ol, select, [data-baseui="listbox"], [data-baseui="menu"]');
          if (container) {
            const containerInfo = {
              tag: container.tagName,
              role: container.getAttribute('role'),
              id: container.id,
              label: container.getAttribute('aria-label'),
              labelledBy: container.getAttribute('aria-labelledby'),
              expanded: container.getAttribute('aria-expanded'),
            };
            console.log('GhostWriter: Found container:', containerInfo);
            
            // VALIDATION: Check if multiple dropdown containers are visible
            const allVisibleDropdowns = Array.from(
              document.querySelectorAll('[role="listbox"], [role="menu"], [data-baseui="listbox"], [data-baseui="menu"]')
            ).filter(el => {
              const style = window.getComputedStyle(el as HTMLElement);
              return style.display !== 'none' && style.visibility !== 'hidden';
            });
            
            if (allVisibleDropdowns.length > 1) {
              console.warn('⚠️ GhostWriter: Multiple visible dropdowns detected!', {
                count: allVisibleDropdowns.length,
                thisContainerIndex: allVisibleDropdowns.indexOf(container),
                containers: allVisibleDropdowns.map(c => ({
                  role: c.getAttribute('role'),
                  label: c.getAttribute('aria-label'),
                  id: c.id,
                  text: (c as HTMLElement).textContent?.trim().substring(0, 30),
                }))
              });
            }
          } else {
            console.warn('⚠️ GhostWriter: List item/option detected but no container found! This might indicate wrong element detection.');
          }
        }

        const url = window.location.href;
        
        // Capture element text EARLY (needed for improved deduplication)
        let elementText: string | undefined = undefined;
        try {
          elementText = ElementTextCapture.captureElementText(target);
        } catch (textError) {
          console.warn('GhostWriter: Error capturing element text:', textError);
        }
        
        // Capture context and similarity information first (needed for container-scoped selectors)
        let context: import('./element-context').ElementContextData | null = null;
        let similarElements: Element[] = [];
        let uniquenessScore = 1.0;
        let disambiguationAttrs: Record<string, string> = {};
        let containerContext: import('./element-context').ContainerContext | null = null;
        
        // Capture context first to get container text
        try {
          context = ElementContext.captureContext(target);
          containerContext = ElementContext.captureContainerContext(target);
          similarElements = ElementSimilarity.findSimilarElements(target);
          uniquenessScore = ElementSimilarity.getUniquenessScore(target, similarElements);
          disambiguationAttrs = ElementSimilarity.getDisambiguationAttributes(target, similarElements);
          
          // ENHANCEMENT: For dropdown options, capture the dropdown container details
          if (finalIsListItemOrOption && context) {
            const dropdownContainer = target.closest('[role="listbox"], [role="menu"], [role="list"], select, [data-baseui="listbox"], [data-baseui="menu"]');
            if (dropdownContainer) {
              // Find the associated trigger (combobox) if available
              const containerId = dropdownContainer.id;
              const containerAriaLabel = dropdownContainer.getAttribute('aria-label');
              let triggerElement: Element | null = null;
              
              // Try to find trigger by aria-controls
              if (containerId) {
                triggerElement = document.querySelector(`[aria-controls="${containerId}"]`);
              }
              
              // Try to find trigger by labelledby relationship
              if (!triggerElement && dropdownContainer.getAttribute('aria-labelledby')) {
                const labelId = dropdownContainer.getAttribute('aria-labelledby');
                const label = labelId ? document.getElementById(labelId) : null;
                if (label) {
                  // Trigger might be near the label
                  triggerElement = label.querySelector('[role="combobox"], [role="button"]') || 
                                   label.closest('[role="combobox"], [role="button"]') ||
                                   label.parentElement?.querySelector('[role="combobox"], [role="button"]') || null;
                }
              }
              
              // Store dropdown container info in context
              if (!context.dropdownContainer) {
                context.dropdownContainer = {
                  selector: SelectorEngine.generateSelectors(dropdownContainer).primary,
                  role: dropdownContainer.getAttribute('role') || undefined,
                  id: dropdownContainer.id || undefined,
                  label: containerAriaLabel || undefined,
                  triggerLabel: triggerElement?.getAttribute('aria-label') || 
                                (triggerElement as HTMLElement)?.textContent?.trim() || undefined,
                };
                
                console.log('✅ GhostWriter: Captured dropdown container info:', context.dropdownContainer);
              }
            }
          }
        } catch (contextError) {
          console.warn('GhostWriter: Error capturing context, continuing with basic recording:', contextError);
        }
        
        // Generate selectors with container context (this is fast)
        let selectors: ReturnType<typeof SelectorEngine.generateSelectors>;
        try {
          const containerCtx = containerContext || context?.container;
          selectors = SelectorEngine.generateSelectors(target, containerCtx ? {
            text: containerCtx.text,
            type: containerCtx.type,
            selector: containerCtx.selector,
          } : undefined);
        } catch (selectorError) {
          console.warn('GhostWriter: Error generating selectors:', selectorError);
          return; // Can't record without selectors
        }

        // Deduplicate: Skip if this is the same click on the same element within the dedup window
        // IMPROVED: Check both selector AND element text to avoid false positives
        // BUT: NEVER skip list items/options - they are critical for dropdown interactions
        // NOTE: Use clickTimestamp (captured synchronously at start of handleClick) for accurate timing
        
        // CRITICAL: Always allow list items/options to be recorded, even if within dedup window
        // This ensures dropdown option clicks are never filtered out
        if (finalIsListItemOrOption) {
          console.log('GhostWriter: List item/option click - ALWAYS recording (bypassing deduplication)');
          // Continue - always record list items/options
        } else {
          // IMPROVED: Check both selector AND element text to avoid false positives
          // Different elements might have similar selectors, so we need to check element text too
          const lastElementText = (this.lastStep && isWorkflowStepPayload(this.lastStep.payload)) ? this.lastStep.payload.elementText : undefined;
          
          console.log('GhostWriter: Checking deduplication - Last click selector:', this.lastClickStep?.selector, 'Current selector:', selectors.primary);
          console.log('GhostWriter: Last element text:', lastElementText, 'Current element text:', elementText);
          console.log('GhostWriter: Time since last click:', this.lastClickStep ? (clickTimestamp - this.lastClickStep.timestamp) : 'N/A', 'ms');
          
          // Only skip if BOTH selector AND element text match (within dedup window)
          if (this.lastClickStep && 
              this.lastClickStep.selector === selectors.primary &&
              elementText === lastElementText &&
              (clickTimestamp - this.lastClickStep.timestamp) < this.CLICK_DEDUP_WINDOW) {
            console.log('GhostWriter: ⚠️ SKIPPING duplicate click on same element (selector + text match) within', this.CLICK_DEDUP_WINDOW, 'ms');
            return; // Skip duplicate click (same selector AND text, not a list item/option)
          }
          
          // If selector matches but text is different, it's likely a different element - allow it
          if (this.lastClickStep && 
              this.lastClickStep.selector === selectors.primary &&
              elementText !== lastElementText) {
            console.log('GhostWriter: ✅ Same selector but different element text - allowing click (different element)');
            // Continue - different element, record it
          }
          
          if (!this.lastClickStep || this.lastClickStep.selector !== selectors.primary) {
            console.log('GhostWriter: ✅ Different selector - allowing click');
          }
        }
        
        // Special case: If this is a list item/option and the last click was on a different selector,
        // allow it even if within the dedup window (dropdown trigger -> option is a valid sequence)
        if (finalIsListItemOrOption && this.lastClickStep && 
            this.lastClickStep.selector !== selectors.primary &&
            (clickTimestamp - this.lastClickStep.timestamp) < this.CLICK_DEDUP_WINDOW) {
          console.log('GhostWriter: Allowing list item/option click after different selector (dropdown sequence)');
          // Continue - don't skip this click
        }
        
        // EXTRA PERMISSIVE: If the last click was a dropdown trigger, be very permissive about the next click
        // This catches dropdown options that might not be detected as list items/options
        if (wasDropdownTrigger && this.lastClickStep && 
            this.lastClickStep.selector !== selectors.primary &&
            (clickTimestamp - this.lastClickStep.timestamp) < 5000) { // 5 second window for dropdown options
          console.log('GhostWriter: Last click was dropdown trigger - allowing next click as potential option');
          // Continue - don't skip this click (it's likely a dropdown option)
        }

        // Mark this click as pending to prevent duplicates during async processing
        // This prevents race conditions where two clicks pass the check before either records
        this.lastClickStep = {
          selector: selectors.primary,
          timestamp: clickTimestamp, // Use synchronously captured timestamp
        };

        let elementState: import('../types/workflow').ElementState | null = null;

        try {
          elementState = ElementStateCapture.captureElementState(target);
          // elementText already captured earlier for deduplication
        } catch (stateError) {
          console.warn('GhostWriter: Error capturing element state:', stateError);
        }

        // Capture event details (Phase 1: Critical)
        const hasModifiers = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
        const eventDetails: import('../types/workflow').EventDetails = {
          mouseButton: event.button === 0 ? 'left' : event.button === 1 ? 'middle' : event.button === 2 ? 'right' : undefined,
          // Only include modifiers if at least one is true
          modifiers: hasModifiers ? {
            ctrl: event.ctrlKey || undefined,
            shift: event.shiftKey || undefined,
            alt: event.altKey || undefined,
            meta: event.metaKey || undefined,
          } : undefined,
          coordinates: {
            x: event.clientX,
            y: event.clientY,
          },
          eventSequence: ['mousedown', 'focus', 'mouseup', 'click'], // Standard sequence for React/Angular
        };

        // Capture viewport and scroll information (Phase 1: Critical) - only if needed
        let viewport: import('../types/workflow').ViewportInfo | undefined = undefined;
        const scrollContainer = this.findScrollContainer(target);
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const hasScroll = scrollX !== 0 || scrollY !== 0;
        const hasScrollContainer = scrollContainer && (scrollContainer.scrollTop !== 0 || scrollContainer.scrollLeft !== 0);
        
        // Only include viewport if scroll exists or has scroll container with non-zero scroll
        if (hasScroll || hasScrollContainer) {
          viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
          };
          
          // Only include scrollX/scrollY if non-zero
          if (scrollX !== 0) {
            viewport.scrollX = scrollX;
          }
          if (scrollY !== 0) {
            viewport.scrollY = scrollY;
          }
          
          // Only include elementScrollContainer if it has non-zero scroll
          if (hasScrollContainer && scrollContainer) {
            const containerSelector = SelectorEngine.generateSelectors(scrollContainer).primary;
            const containerScrollTop = scrollContainer.scrollTop;
            const containerScrollLeft = scrollContainer.scrollLeft;
            
            viewport.elementScrollContainer = {
              selector: containerSelector,
            };
            
            // Only include scrollTop/scrollLeft if non-zero
            if (containerScrollTop !== 0) {
              viewport.elementScrollContainer.scrollTop = containerScrollTop;
            }
            if (containerScrollLeft !== 0) {
              viewport.elementScrollContainer.scrollLeft = containerScrollLeft;
            }
          }
        }

        // Capture element bounds (Phase 2: Important) - simplified (top/left/right/bottom removed)
        const rect = target.getBoundingClientRect();
        const elementBounds: import('../types/workflow').ElementBounds = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };

        // Capture element role (Phase 3: Minor)
        const elementRole = target.getAttribute('role') || undefined;

        // Capture page state (Phase 3: Minor) - only include if not 'complete' or for debugging
        // Omit pageState as it's usually 'complete' and loadTime is not used by replayer
        const pageState: import('../types/workflow').PageState | undefined = undefined;

        // Capture timing information (Phase 2: Important) - only include if delayAfter exists
        const delayAfter = this.lastStep ? (clickTimestamp - this.lastStep.payload.timestamp) : undefined;
        const timing: import('../types/workflow').TimingInfo | undefined = delayAfter ? {
          delayAfter,
          // animationWait and networkWait omitted when false
        } : undefined;

        // Capture iframe context (Phase 2: Important)
        const iframeContext = IframeUtils.getIframeContext(target);

        // Capture retry strategy (Phase 3: Minor) - omitted (always defaults, replayer uses fallbackSelectors)
        // Retry strategy removed - replayer uses fallbackSelectors directly with default retry logic
        const retryStrategy: import('../types/workflow').RetryStrategy | undefined = undefined;

        // Capture focus events (Phase 3: Minor) - only include if true
        const needsFocus = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
        const focusEvents: import('../types/workflow').FocusEvents | undefined = needsFocus ? {
          needsFocus: true,
          // needsBlur omitted when false
        } : undefined;

        // Capture network conditions (Phase 3: Minor) - only include if waitForRequests is true
        // Currently always false, so omit entirely
        const networkConditions: import('../types/workflow').NetworkConditions | undefined = undefined;

        // Check for navigation after a short delay
        setTimeout(async () => {
          // Don't send step if recording was stopped
          if (!this.isRecording) return;

          // Double-check deduplication here (in case another click happened during the delay)
          // IMPROVED: Be more permissive - check both selector AND element text
          const checkTimestamp = Date.now();
          // Check for duplicate, but ALWAYS allow list items/options
          // CRITICAL: Never skip list items/options - they are essential for dropdown interactions
          // Re-check on the final target element
          const isListItemOrOptionCheck = finalIsListItemOrOption || this.isListItemOrOption(target);
          if (!isListItemOrOptionCheck && this.lastClickStep && 
              this.lastClickStep.selector === selectors.primary &&
              this.lastClickStep.timestamp !== clickTimestamp && // Different click (timestamp captured synchronously)
              (checkTimestamp - this.lastClickStep.timestamp) < this.CLICK_DEDUP_WINDOW) {
            // IMPROVED: Also check element text to avoid false positives
            const currentElementText = elementText;
            const lastElementText = (this.lastStep && isWorkflowStepPayload(this.lastStep.payload)) ? this.lastStep.payload.elementText : undefined;
            
            // Only skip if BOTH selector AND element text match
            if (currentElementText === lastElementText) {
              console.log('GhostWriter: Skipping duplicate click detected during async processing (selector + text match)');
              return; // Skip duplicate click
            } else {
              console.log('GhostWriter: Same selector but different element text - allowing click (async check)');
            }
          } else if (isListItemOrOptionCheck) {
            console.log('GhostWriter: Allowing list item/option click even if within dedup window (async check)');
          }

          const newUrl = window.location.href;
          const isNavigation = newUrl !== this.currentUrl;

          // Build step payload first (without wait conditions)
          // Ensure container text includes anchor text if available
          const finalContainerContext = containerContext || context?.container;
          if (selectors.anchorText && finalContainerContext) {
            // Update container context with anchor text (widget title)
            finalContainerContext.text = selectors.anchorText;
          }

          // Generate semantic fallback selectors for grid cells
          const semanticContext = ContextScanner.scan(target);
          let enhancedFallbacks = [...selectors.fallbacks];
          
          // NEW: For spreadsheets, capture full sheet state for AI comprehension
          let spreadsheetContext: any = null;
          if (SheetStateExtractor.isSpreadsheetDomain() && semanticContext.gridCoordinates?.cellReference) {
            try {
              console.log('📊 RecordingManager: Extracting spreadsheet state...');
              const sheetState = await SheetStateExtractor.extract();
              
              if (sheetState) {
                // Determine intent based on cell state
                const cellRef = semanticContext.gridCoordinates.cellReference;
                const column = cellRef.match(/^([A-Z]+)/)?.[1] || '';
                const row = parseInt(cellRef.match(/(\d+)$/)?.[1] || '0', 10);
                
                // Find column info
                const columnInfo = sheetState.columns.find(c => c.letter === column);
                
                // Determine if cell was empty
                const wasEmpty = sheetState.activeCell.isEmpty;
                
                // Determine if this is an append position
                const wasAppendPosition = columnInfo 
                  ? (row === columnInfo.firstEmptyRow && row > 1 && columnInfo.lastDataRow > 0)
                  : false;
                
                // Generate reasoning
                let reasoning = '';
                if (wasAppendPosition) {
                  reasoning = `User clicked first empty cell (${cellRef}) after data ends at row ${columnInfo!.lastDataRow}. This is an append operation.`;
                } else if (wasEmpty && columnInfo && columnInfo.lastDataRow > 0) {
                  reasoning = `User clicked empty cell ${cellRef}, but there's a gap - likely intentional specific cell selection.`;
                } else if (!wasEmpty) {
                  reasoning = `User clicked cell ${cellRef} which has data - editing specific cell.`;
                } else {
                  reasoning = `User clicked cell ${cellRef} in ${wasEmpty ? 'empty' : 'populated'} column.`;
                }
                
                // Store minimal context (full sheet state will be extracted fresh during replay)
                spreadsheetContext = {
                  recordedIntent: {
                    cellRef,
                    columnHeader: semanticContext.gridCoordinates.columnHeader,
                    wasEmpty,
                    wasAppendPosition,
                    reasoning,
                    // Store only essential column info for intent verification
                    column: column,
                    columnDataType: columnInfo?.dataType,
                    lastDataRow: columnInfo?.lastDataRow,
                    firstEmptyRow: columnInfo?.firstEmptyRow,
                  }
                };
                
                console.log('📊 RecordingManager: Spreadsheet context captured (minimal):', reasoning);
                console.log('📊 RecordingManager: Storage optimized - full sheet state will be extracted during replay');
              }
            } catch (err) {
              console.error('📊 RecordingManager: Error extracting spreadsheet state:', err);
            }
          }
          
          if (semanticContext.gridCoordinates?.cellReference) {
            const cellRef = semanticContext.gridCoordinates.cellReference;
            // Generate semantic selectors based on cell reference
            // Google Sheets uses verbose aria-labels like "Cell A1", "Row 1, Column A"
            // So we use "contains" logic for safety
            const semanticSelectors = [
              `[aria-label*="${cellRef}"]`,                    // Contains: "Cell A1", "A1 value is..."
              `[aria-label="${cellRef}"]`,                     // Exact: "A1" (rare but possible)
              `[aria-label="Cell ${cellRef}"]`,                // Common Google pattern
              `[aria-label^="${cellRef} "]`,                   // Starts with: "A1 value..."
              `//*[@role="gridcell" and contains(@aria-label, "${cellRef}")]`, // XPath (safest)
              `[data-cell="${cellRef}"]`,                      // Data attribute fallback
              `[data-cellref="${cellRef}"]`,                  // Alternative data attribute
            ];
            
            // Add semantic selectors to the front of fallbacks (highest priority)
            enhancedFallbacks = [...semanticSelectors, ...enhancedFallbacks];
            
            console.log('🔍 RecordingManager: Generated semantic fallback selectors for cell', cellRef, ':', semanticSelectors.length, 'selectors');
          }

          // Check selector stability and log warnings
          const primaryStability = SelectorEngine.getSelectorStabilityScore(selectors.primary);
          const isPrimaryFragile = SelectorEngine.isPotentiallyFragile(selectors.primary);
          
          // Debug: Always log primary selector and stability
          console.log(`🔍 GhostWriter: Primary selector: "${selectors.primary}" | Stability: ${primaryStability.toFixed(2)} | Fragile: ${isPrimaryFragile}`);
          
          if (isPrimaryFragile || primaryStability < 0.7) {
            console.warn(`GhostWriter: Recording step with fragile primary selector (stability: ${primaryStability.toFixed(2)}):`, selectors.primary);
            console.warn('GhostWriter: Fallback selectors available:', enhancedFallbacks.length);
            if (semanticContext.gridCoordinates?.cellReference) {
              console.log('🔍 GhostWriter: Semantic fallback selectors available for cell:', semanticContext.gridCoordinates.cellReference);
            }
          }

          // Resolve the snapshot started on mousedown (Guardrail 3: Prevent race condition)
          // CRITICAL: For dropdown items, capture a FRESH snapshot on click to ensure we capture the dropdown item,
          // not the three-dot button that was clicked on mousedown
          let visualSnapshot: WorkflowStepPayload['visualSnapshot'] | undefined;
          
          // RE-CHECK: Verify if this is a dropdown item (check again in async context)
          // Also check if previous step was a dropdown trigger
          const wasDropdownTrigger = (this.lastStep && isWorkflowStepPayload(this.lastStep.payload) && (
            this.lastStep.payload.elementRole === 'combobox' ||
            this.lastStep.payload.elementRole === 'listbox' ||
            this.lastStep.payload.selector?.includes('[role="combobox"]') ||
            this.lastStep.payload.selector?.includes('[role="listbox"]') ||
            this.lastStep.payload.selector?.includes('[role="menu"]')
          )) || false;
          
          const timeSinceLastStep = this.lastStep ? (Date.now() - this.lastStep.payload.timestamp) : Infinity;
          const shouldTreatAsDropdownItem = finalIsListItemOrOption || 
            (wasDropdownTrigger && timeSinceLastStep < 2000);
          
          // Capture click coordinates for annotation
          const clickPoint = this.pendingClickPoint || { x: event.clientX, y: event.clientY };
          
          if (shouldTreatAsDropdownItem) {
            // For dropdown items, capture a fresh snapshot to ensure we get the actual dropdown item
            try {
              console.log('📸 GhostWriter: Capturing fresh annotated snapshot for dropdown item');
              console.log('📸 GhostWriter: Dropdown detection - finalIsListItemOrOption:', finalIsListItemOrOption, 'wasDropdownTrigger:', wasDropdownTrigger);
              console.log('📸 GhostWriter: Target element:', target.tagName, 'Text:', target.textContent?.trim()?.substring(0, 50));
              
              // Use captureWithAnnotation for dropdown items
              const annotatedResult = await VisualSnapshotService.captureWithAnnotation(
                target,
                clickPoint,
                'select' // Dropdown selections use 'select' action type
              );
              
              if (annotatedResult) {
                visualSnapshot = {
                  viewport: annotatedResult.viewport,
                  elementSnippet: annotatedResult.elementSnippet,
                  timestamp: annotatedResult.timestamp,
                  viewportSize: annotatedResult.viewportSize,
                  elementBounds: annotatedResult.elementBounds,
                  // Phase 7: Visual annotations for AI Visual Click
                  annotated: annotatedResult.annotatedViewport,
                  annotatedSnippet: annotatedResult.annotatedSnippet,
                  clickPoint: annotatedResult.clickPoint,
                  actionType: 'select',
                };
                console.log('📸 GhostWriter: Fresh annotated snapshot captured for dropdown item');
                console.log('📸 GhostWriter: Has annotated viewport:', !!annotatedResult.annotatedViewport);
              } else {
                console.warn('📸 GhostWriter: Annotated snapshot service returned null for dropdown item');
              }
              // Clear the pending snapshots
              this.pendingSnapshot = null;
              this.pendingAnnotatedSnapshot = null;
              this.pendingClickPoint = null;
            } catch (err) {
              console.warn('📸 GhostWriter: Failed to capture fresh annotated snapshot for dropdown item:', err);
              // Fallback to mousedown snapshot if available
              if (this.pendingAnnotatedSnapshot) {
                try {
                  const annotatedResult = await this.pendingAnnotatedSnapshot;
                  if (annotatedResult) {
                    visualSnapshot = {
                      viewport: annotatedResult.viewport,
                      elementSnippet: annotatedResult.elementSnippet,
                      timestamp: annotatedResult.timestamp,
                      viewportSize: annotatedResult.viewportSize,
                      elementBounds: annotatedResult.elementBounds,
                      annotated: annotatedResult.annotatedViewport,
                      annotatedSnippet: annotatedResult.annotatedSnippet,
                      clickPoint: annotatedResult.clickPoint,
                      actionType: 'select',
                    };
                    console.warn('📸 GhostWriter: Using fallback mousedown annotated snapshot for dropdown item');
                  }
                } catch (fallbackErr) {
                  console.warn('📸 GhostWriter: Fallback to mousedown annotated snapshot also failed:', fallbackErr);
                } finally {
                  this.pendingSnapshot = null;
                  this.pendingAnnotatedSnapshot = null;
                  this.pendingClickPoint = null;
                }
              }
            }
          } else if (this.pendingAnnotatedSnapshot) {
            // For non-dropdown items, use the mousedown annotated snapshot
            try {
              console.log('📸 GhostWriter: Awaiting annotated snapshot from mousedown...');
              const annotatedResult = await this.pendingAnnotatedSnapshot;
              if (annotatedResult) {
                visualSnapshot = {
                  viewport: annotatedResult.viewport,
                  elementSnippet: annotatedResult.elementSnippet,
                  timestamp: annotatedResult.timestamp,
                  viewportSize: annotatedResult.viewportSize,
                  elementBounds: annotatedResult.elementBounds,
                  // Phase 7: Visual annotations for AI Visual Click
                  annotated: annotatedResult.annotatedViewport,
                  annotatedSnippet: annotatedResult.annotatedSnippet,
                  clickPoint: annotatedResult.clickPoint,
                  actionType: 'click',
                };
                console.log('📸 GhostWriter: Annotated snapshot attached to click event');
                console.log('📸 GhostWriter: Has annotated viewport:', !!annotatedResult.annotatedViewport);
              } else {
                console.warn('📸 GhostWriter: Annotated snapshot promise resolved but returned null');
              }
            } catch (err) {
              console.warn('📸 GhostWriter: Failed to get cached annotated snapshot:', err);
            } finally {
              // Clear it after use
              this.pendingSnapshot = null;
              this.pendingAnnotatedSnapshot = null;
              this.pendingClickPoint = null;
            }
          } else {
            console.log('📸 GhostWriter: No pending annotated snapshot for click event');
            this.pendingClickPoint = null;
          }

          // Phase 6: Capture AI Evidence (context snapshot)
          const contextSnapshot = DOMDistiller.captureInteractionContext(actualElement as HTMLElement);

          // Capture semantic anchors (Phase 6)
          const semanticAnchors = ElementContext.getSemanticAnchors(actualElement as HTMLElement);

          // Analyze element for execution strategy
          const elementAnalysis = ElementAnalyzer.analyze(actualElement);
          console.log('🔍 GhostWriter: Element Analysis:\n' + ElementAnalyzer.formatAnalysis(elementAnalysis));

          const stepPayload: WorkflowStep['payload'] = {
            selector: selectors.primary,
            fallbackSelectors: enhancedFallbacks.length > 0 ? enhancedFallbacks : [selectors.primary], // Ensure never empty
            xpath: selectors.xpath,
            timestamp: clickTimestamp, // Use synchronously captured timestamp for correct ordering
            url: isNavigation ? this.currentUrl : url,
            tabUrl: this.currentTabUrl || undefined,
            tabTitle: this.currentTabTitle || undefined,
            tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
            shadowPath: selectors.shadowPath,
            elementState: elementState || undefined,
            elementText: elementText,
            // Phase 1: Critical fixes
            eventDetails,
            viewport,
            // Phase 2: Important fixes
            elementBounds,
            iframeContext: iframeContext || undefined,
            timing,
            visualSnapshot, // Phase 2: Visual snapshots for AI reliability
            // Phase 3: Minor enhancements
            elementRole,
            pageState,
            retryStrategy,
            focusEvents,
            networkConditions,
            context: context ? {
              // Only include siblings if they have content, omit empty arrays
              siblings: (context.siblings.before.length > 0 || context.siblings.after.length > 0) ? {
                ...(context.siblings.before.length > 0 ? { before: context.siblings.before } : {}),
                ...(context.siblings.after.length > 0 ? { after: context.siblings.after } : {}),
              } : undefined,
              parent: context.parent || undefined,
              ancestors: context.ancestors.length > 0 ? context.ancestors : undefined,
              container: finalContainerContext || undefined,
              position: context.position,
              surroundingText: context.surroundingText,
              uniqueAttributes: Object.keys(disambiguationAttrs).length > 0 ? disambiguationAttrs : undefined,
            formContext: context.formContext,
            // Capture semantic coordinates for AI interpretation (includes decisionSpace)
            ...ContextScanner.scan(target),
          } : ContextScanner.scan(target),
            similarity: similarElements.length > 0 ? {
              similarCount: similarElements.length,
              uniquenessScore,
              disambiguation: Object.keys(disambiguationAttrs).map(
                key => `${key}="${disambiguationAttrs[key]}"`
              ),
            } : undefined,
            // Phase 6: AI Evidence capture
            aiEvidence: (contextSnapshot || semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) ? {
              contextSnapshot: contextSnapshot,
              semanticAnchors: (semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) 
                ? semanticAnchors 
                : undefined
            } : undefined,
            // Element analysis for execution strategy
            elementAnalysis: {
              executionStrategy: elementAnalysis.executionStrategy,
              confidence: elementAnalysis.confidence,
              reasons: elementAnalysis.reasons,
              bestSelector: elementAnalysis.bestSelector,
              fallbackSelectors: elementAnalysis.fallbackSelectors,
            },
            // NEW: Spreadsheet context for AI comprehension
            spreadsheetContext: spreadsheetContext || undefined,
          };

          // Enrich with reliable replayer data (LocatorBundle, Intent, Success Conditions)
          const reliableData = this.enrichStepWithReliableData(actualElement, 'CLICK');
          if (reliableData) {
            stepPayload.locatorBundle = reliableData.locatorBundle;
            stepPayload.intent = reliableData.intent;
            stepPayload.stepGoal = reliableData.stepGoal;
            stepPayload.suggestedCondition = reliableData.suggestedCondition;
            stepPayload.scope = reliableData.locatorBundle.scope;
            stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
            
            // Calculate locator quality metrics
            const hasStableAttributes = reliableData.locatorBundle.strategies.some(s => s.features.hasStableAttributes);
            const hasUniqueMatch = reliableData.locatorBundle.strategies.some(s => s.features.uniqueMatchAtRecordTime);
            const hasDynamicParts = reliableData.locatorBundle.strategies.some(s => s.features.hasDynamicParts);
            
            stepPayload.locatorQuality = {
              hasStableAttributes,
              hasUniqueMatch,
              hasDynamicParts,
              strategiesAvailable: reliableData.locatorBundle.strategies.length,
              confidenceScore: hasStableAttributes && hasUniqueMatch && !hasDynamicParts ? 0.9 :
                              hasStableAttributes || hasUniqueMatch ? 0.7 :
                              reliableData.locatorBundle.strategies.length >= 3 ? 0.5 : 0.3,
            };
          }

          // Determine wait conditions based on this step and previous step
          const step: WorkflowStep = {
            type: isNavigation ? 'NAVIGATION' : 'CLICK',
            payload: stepPayload,
          };

          // OUTCOME DIFFING: Wait for stability, then capture "after" state and generate outcomes
          if (beforeSignals && FeatureFlags.OUTCOME_VERIFICATION) {
            try {
              console.log('[OutcomeDiff] Waiting for stability before capturing after state...');
              await StateWaitEngine.waitForStability({
                domQuietMs: 400,
                networkQuietMs: 600,
                maxWaitMs: 5000,
                checkSpinners: true,
              });
              
              const afterSignals = capturePageSignals(target);
              console.log('[OutcomeDiff] After signals captured:', {
                url: afterSignals.url,
                modals: afterSignals.modals.length,
                toasts: afterSignals.toasts.length,
                spinners: afterSignals.spinnerCount,
              });
              
              const outcomes = generateOutcomesFromDiff(beforeSignals, afterSignals);
              if (outcomes.length > 0) {
                stepPayload.expectedOutcomes = outcomes;
                console.log(`[OutcomeDiff] ✅ Generated ${outcomes.length} expected outcomes:`, 
                  outcomes.map(o => o.type).join(', '));
              } else {
                console.log('[OutcomeDiff] No significant changes detected');
              }
            } catch (error) {
              console.warn('[OutcomeDiff] Error during outcome capture:', error);
            }
          }

          // Debug: Log if visualSnapshot is present
          if (stepPayload.visualSnapshot) {
            console.log('📸 GhostWriter: Step includes visualSnapshot with viewport size:', stepPayload.visualSnapshot.viewport?.length || 0, 'chars, snippet size:', stepPayload.visualSnapshot.elementSnippet?.length || 0, 'chars');
          } else {
            console.warn('📸 GhostWriter: Step does NOT include visualSnapshot');
          }

          console.log('GhostWriter: ✅ Sending step to side panel - Type:', step.type, 'Selector:', selectors.primary.substring(0, 100));
          this.sendStep(step);
          this.lastStep = step;
          // Update last click timestamp (already set earlier, but update with actual step timestamp)
          this.lastClickStep = {
            selector: selectors.primary,
            timestamp: stepPayload.timestamp,
          };
          console.log('GhostWriter: Step recorded successfully. Total steps:', this.lastStep ? '1+' : '1');

          // 🎯 AI Widget Identification (DISABLED - experimental feature)
          // The DOM-based widget detection (context.container.text) is working reliably
          // Re-enable this when AI vision can consistently identify correct widget titles
          const ENABLE_AI_WIDGET_IDENTIFICATION = false;
          
          if (ENABLE_AI_WIDGET_IDENTIFICATION) {
            const widgetIdentificationPromise = (async () => {
              try {
                console.log('🎯 GhostWriter: Identifying widget context with AI Vision...');
                const widgetContext = await WidgetIdentifierService.identifyWidget(target, event);
                
                if (widgetContext && !widgetContext.noWidgetFound) {
                  stepPayload.aiWidgetContext = widgetContext;
                  console.log(`🎯 GhostWriter: ✅ AI identified widget: "${widgetContext.widgetTitle}" (confidence: ${widgetContext.confidence.toFixed(2)}, method: ${widgetContext.identifiedBy})`);
                }
              } catch (widgetError) {
                console.warn('🎯 GhostWriter: Widget identification failed:', widgetError);
              }
            })();
            
            this.pendingValidations.push(widgetIdentificationPromise);
          } else {
            console.log('🎯 GhostWriter: AI widget identification disabled, using DOM-based detection');
          }

          // Trigger AI validation if selector is fragile (non-blocking, background)
          // TEST MODE: Set to true to force AI validation on all selectors for testing
          const FORCE_AI_VALIDATION = true; // Set to true to test AI validation
          
          if (FORCE_AI_VALIDATION || isPrimaryFragile || primaryStability < 0.7) {
            if (FORCE_AI_VALIDATION) {
              console.log('🧪 TEST MODE: Forcing AI validation (even for stable selectors)');
            } else {
              console.log('🤖 GhostWriter: Triggering AI validation for fragile selector...');
            }
            const validationPromise = this.enhanceStepWithAI(step, enhancedFallbacks, target);
            this.pendingValidations.push(validationPromise);
            console.log('🤖 GhostWriter: AI validation promise added, pending count:', this.pendingValidations.length);
          } else {
            console.log('✅ GhostWriter: Selector is stable, skipping AI validation');
          }

          if (isNavigation) {
            this.currentUrl = newUrl;
            this.currentTabUrl = newUrl;
            // Update tab title if available
            this.currentTabTitle = document.title;
          }
        }, 100);
      } catch (error) {
        console.error('Error handling click:', error);
      }
    };

    // CRITICAL: Track the click processing promise to ensure it completes before stop()
    // This prevents missing the last step when user clicks Stop immediately after clicking
    const clickPromise = new Promise<void>((resolve) => {
      let callbackExecuted = false;
      const callbackEntry = { callback: processClick as () => Promise<void>, timeoutId: undefined as number | undefined };
      
      const wrappedProcessClick = async () => {
        if (callbackExecuted) return; // Prevent double execution
        callbackExecuted = true;
        
        // Remove from pending callbacks array
        const cbIndex = this.pendingClickCallbacks.indexOf(callbackEntry);
        if (cbIndex > -1) {
          this.pendingClickCallbacks.splice(cbIndex, 1);
        }
        
        try {
          await processClick();
        } finally {
          // Remove this promise from pending array
          const index = this.pendingClickProcessing.indexOf(clickPromise);
          if (index > -1) {
            this.pendingClickProcessing.splice(index, 1);
          }
          resolve();
        }
      };
      
      // Schedule the callback and store the ID so we can cancel/force-execute it later
      if (typeof requestIdleCallback !== 'undefined') {
        callbackEntry.timeoutId = requestIdleCallback(wrappedProcessClick, { timeout: 100 }) as unknown as number;
      } else {
        callbackEntry.timeoutId = setTimeout(wrappedProcessClick, 0) as unknown as number;
      }
      
      // Store the wrapped callback so stop() can force-execute it
      callbackEntry.callback = wrappedProcessClick;
      this.pendingClickCallbacks.push(callbackEntry);
    });
    
    this.pendingClickProcessing.push(clickPromise);
    console.log('🔄 GhostWriter: Click processing promise added, pending count:', this.pendingClickProcessing.length);
  }

  /**
   * Handle input events (debounced)
   */
  private handleInput(event: Event): void {
    if (!this.isRecording) return;

    // CRITICAL: Capture timestamp SYNCHRONOUSLY when event fires (not when debounce completes)
    // This ensures correct step ordering even when async processing delays occur
    const inputTimestamp = Date.now();

    try {
      // Get actual element (handles Shadow DOM)
      const actualElement = this.getActualElement(event);
      if (!actualElement) return;

      const target = actualElement as HTMLElement;
      
      // Check for standard inputs, textareas, OR contenteditable elements
      const isStandardInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      const isContentEditable = (target.isContentEditable || target.getAttribute('contenteditable') === 'true');
      
      if (!isStandardInput && !isContentEditable) {
        return;
      }

      // CACHE VALUE: Store the current value in memory (critical for Google Sheets)
      // This ensures we have the value even if Google Sheets clears the DOM on blur
      // Store on EVERY input event, regardless of whether value exists (captures empty strings too)
      if (isContentEditable) {
        this.lastInputValue = target.textContent?.trim() || target.innerText?.trim() || '';
        this.currentInputElement = target;
        if (this.lastInputValue) {
          console.log('GhostWriter: Cached input value:', this.lastInputValue);
        }
      } else if (isStandardInput) {
        // For standard inputs, also cache (though less critical)
        this.lastInputValue = (target as HTMLInputElement | HTMLTextAreaElement).value || '';
        this.currentInputElement = target;
      }

      // Ignore password fields (though user chose to record all)
      // We'll still record them but could add filtering here if needed

      // Store the input timestamp for when the debounced handler runs
      this.pendingInputTimestamp = inputTimestamp;

      // Clear previous timer
      if (this.inputDebounceTimer !== null) {
        clearTimeout(this.inputDebounceTimer);
      }

      // Set new timer
      this.inputDebounceTimer = window.setTimeout(() => {
        // Don't capture if recording was stopped
        if (!this.isRecording) return;
        this.captureInputValue(target as HTMLInputElement | HTMLTextAreaElement | HTMLElement, this.pendingInputTimestamp!);
        this.pendingInputTimestamp = null; // Clear after use
      }, this.DEBOUNCE_DELAY);
    } catch (error) {
      console.error('Error handling input:', error);
    }
  }

  /**
   * Handle change events (for select, checkbox, radio)
   */
  private async handleChange(event: Event): Promise<void> {
    if (!this.isRecording) return;

    // CRITICAL: Capture timestamp SYNCHRONOUSLY when event fires
    // This ensures correct step ordering for change events (selects, checkboxes, etc.)
    const changeTimestamp = Date.now();

    try {
      // Get actual element (handles Shadow DOM)
      const actualElement = this.getActualElement(event);
      if (!actualElement) return;

      const target = actualElement as HTMLSelectElement | HTMLInputElement;
      if (!target) return;

      // OUTCOME DIFFING: Capture "before" state (select/checkbox changes can trigger page updates)
      const beforeSignals = FeatureFlags.OUTCOME_VERIFICATION ? 
        capturePageSignals(actualElement) : 
        null;
      if (beforeSignals) {
        console.log('[OutcomeDiff:Change] Before signals captured:', {
          url: beforeSignals.url,
          modals: beforeSignals.modals.length,
          toasts: beforeSignals.toasts.length,
          spinners: beforeSignals.spinnerCount,
        });
      }

      // Capture snapshot for change events (for AI context)
      try {
        console.log('📸 GhostWriter: Capturing snapshot for change event');
        const visuals = await VisualSnapshotService.capture(actualElement);
        if (visuals) {
          // Store snapshot temporarily so captureInputValue can use it
          this.pendingSnapshot = Promise.resolve(visuals);
          console.log('📸 GhostWriter: Snapshot captured for change event');
        }
      } catch (snapshotError) {
        console.warn('📸 GhostWriter: Failed to capture snapshot for change event:', snapshotError);
      }

      // Capture immediately (no debounce for change events)
      // Pass beforeSignals so captureInputValue can add outcomes after recording
      await this.captureInputValue(target, changeTimestamp, beforeSignals);
    } catch (error) {
      console.error('Error handling change:', error);
    }
  }

  /**
   * Handle mousedown events - start capturing snapshot immediately
   * This prevents race condition by capturing before navigation/click
   */
  private handleMousedown(event: MouseEvent): void {
    if (!this.isRecording) return;
    
    const actualElement = this.getActualElement(event);
    if (!actualElement) return;
    
    // Store click coordinates for annotation
    this.pendingClickPoint = {
      x: event.clientX,
      y: event.clientY,
    };
    
    // Start capturing IMMEDIATELY with annotation. Do not await it here.
    // Store the Promise so the Click handler can await it.
    // Users can't click two things at the exact same millisecond, so single Promise is sufficient
    // Only capture if VisionClicker is enabled (annotated snapshots are expensive and only used by vision clicker)
    if (FeatureFlags.VISION_CLICKER) {
      console.log('📸 GhostWriter: Starting annotated snapshot capture on mousedown at', this.pendingClickPoint);
      
      // Use captureWithAnnotation to get both original and annotated versions
      this.pendingAnnotatedSnapshot = VisualSnapshotService.captureWithAnnotation(
        actualElement,
        this.pendingClickPoint,
        'click' // Default action type, can be refined based on element type
      );
      
      // Also keep legacy pendingSnapshot for backward compatibility
      this.pendingSnapshot = this.pendingAnnotatedSnapshot.then(result => {
        if (result) {
          return {
            viewport: result.viewport,
            elementSnippet: result.elementSnippet,
          };
        }
        return null;
      });
    } else {
      // VisionClicker disabled - don't capture expensive annotated snapshots
      console.log('📸 GhostWriter: Skipping annotated snapshot (VisionClicker disabled)');
      this.pendingAnnotatedSnapshot = null;
      this.pendingSnapshot = null;
    }
  }

  /**
   * Handle focus events - clear cache when focusing on a new element
   * This prevents accidentally using cached value from a previous element
   */
  private handleFocus(event: FocusEvent): void {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // Check if this is an input element
    const isStandardInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const isContentEditable = (target.isContentEditable || target.getAttribute('contenteditable') === 'true');
    
    if (!isStandardInput && !isContentEditable) {
      return; // Not an input element, ignore
    }

    // If we're focusing on a different element than the one we were editing, clear cache
    if (this.currentInputElement && this.currentInputElement !== target) {
      console.log('GhostWriter: Focus moved to new element, clearing input cache');
      this.lastInputValue = '';
      this.currentInputElement = null;
    }
  }

  /**
   * Handle keyboard events (Phase 2: Important)
   * Only captures important keys: Enter, Tab, Escape
   */
  private async handleKeyboard(event: KeyboardEvent): Promise<void> {
    if (!this.isRecording) return;

    // Only capture specific important keys
    const importantKeys = ['Enter', 'Tab', 'Escape'];
    if (!importantKeys.includes(event.key)) {
      return;
    }

    // Don't capture if user is typing in an input (that's handled by input handler)
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      // Only capture Enter in inputs (for form submission)
      if (event.key !== 'Enter') {
        return;
      }
    }

    try {
      // Get actual element (handles Shadow DOM)
      const actualElement = this.getActualElement(event);
      if (!actualElement) return;

      // OUTCOME DIFFING: Capture "before" state (especially important for Enter key which can cause navigation)
      const beforeSignals = FeatureFlags.OUTCOME_VERIFICATION ? 
        capturePageSignals(actualElement) : 
        null;
      if (beforeSignals) {
        console.log('[OutcomeDiff:Keyboard] Before signals captured:', {
          url: beforeSignals.url,
          modals: beforeSignals.modals.length,
          toasts: beforeSignals.toasts.length,
          spinners: beforeSignals.spinnerCount,
        });
      }

      const url = window.location.href;

      // Capture keyboard details
      const hasModifiers = event.ctrlKey || event.shiftKey || event.altKey || event.metaKey;
      const keyboardDetails: import('../types/workflow').KeyboardDetails = {
        key: event.key,
        code: event.code,
        // Only include modifiers if at least one is true
        modifiers: hasModifiers ? {
          ctrl: event.ctrlKey || undefined,
          shift: event.shiftKey || undefined,
          alt: event.altKey || undefined,
          meta: event.metaKey || undefined,
        } : undefined,
      };

      // Generate selectors for the target element
      let selectors: ReturnType<typeof SelectorEngine.generateSelectors>;
      try {
        selectors = SelectorEngine.generateSelectors(actualElement);
      } catch (selectorError) {
        console.warn('GhostWriter: Error generating selectors for keyboard event:', selectorError);
        return;
      }

      // Capture viewport and scroll information - only if needed
      let viewport: import('../types/workflow').ViewportInfo | undefined = undefined;
      const scrollContainer = this.findScrollContainer(actualElement);
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const hasScroll = scrollX !== 0 || scrollY !== 0;
      const hasScrollContainer = scrollContainer && (scrollContainer.scrollTop !== 0 || scrollContainer.scrollLeft !== 0);
      
      // Only include viewport if scroll exists or has scroll container with non-zero scroll
      if (hasScroll || hasScrollContainer) {
        viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        
        // Only include scrollX/scrollY if non-zero
        if (scrollX !== 0) {
          viewport.scrollX = scrollX;
        }
        if (scrollY !== 0) {
          viewport.scrollY = scrollY;
        }
        
        // Only include elementScrollContainer if it has non-zero scroll
        if (hasScrollContainer && scrollContainer) {
          const containerSelector = SelectorEngine.generateSelectors(scrollContainer).primary;
          const containerScrollTop = scrollContainer.scrollTop;
          const containerScrollLeft = scrollContainer.scrollLeft;
          
          viewport.elementScrollContainer = {
            selector: containerSelector,
          };
          
          // Only include scrollTop/scrollLeft if non-zero
          if (containerScrollTop !== 0) {
            viewport.elementScrollContainer.scrollTop = containerScrollTop;
          }
          if (containerScrollLeft !== 0) {
            viewport.elementScrollContainer.scrollLeft = containerScrollLeft;
          }
        }
      }

      // Capture page state (Phase 3: Minor) - omitted (usually 'complete' and loadTime not used by replayer)
      const pageState: import('../types/workflow').PageState | undefined = undefined;

      // Capture timing information - only include if delayAfter exists
      const stepTimestamp = Date.now();
      const delayAfter = this.lastStep ? (stepTimestamp - this.lastStep.payload.timestamp) : undefined;
      const timing: import('../types/workflow').TimingInfo | undefined = delayAfter ? {
        delayAfter,
        // animationWait and networkWait omitted when false
      } : undefined;

      // Generate semantic fallback selectors for grid cells (keyboard events can happen on grid cells)
      const semanticContext = ContextScanner.scan(actualElement);
      let enhancedFallbacks = [...selectors.fallbacks];
      
      if (semanticContext.gridCoordinates?.cellReference) {
        const cellRef = semanticContext.gridCoordinates.cellReference;
        const semanticSelectors = [
          `[aria-label*="${cellRef}"]`,
          `[aria-label="${cellRef}"]`,
          `[aria-label="Cell ${cellRef}"]`,
          `[aria-label^="${cellRef} "]`,
          `//*[@role="gridcell" and contains(@aria-label, "${cellRef}")]`,
          `[data-cell="${cellRef}"]`,
          `[data-cellref="${cellRef}"]`,
        ];
        enhancedFallbacks = [...semanticSelectors, ...enhancedFallbacks];
      }

      // Capture visual snapshot for keyboard events (for AI description generation)
      let visualSnapshot: WorkflowStepPayload['visualSnapshot'] | undefined;
      try {
        console.log('📸 GhostWriter: Capturing snapshot for keyboard event');
        const visuals = await VisualSnapshotService.capture(actualElement);
        if (visuals) {
          const rect = actualElement.getBoundingClientRect();
          visualSnapshot = {
            viewport: visuals.viewport,
            elementSnippet: visuals.elementSnippet,
            timestamp: Date.now(),
            viewportSize: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            elementBounds: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }
          };
          console.log('📸 GhostWriter: Snapshot captured for keyboard event');
        }
      } catch (snapshotError) {
        console.warn('📸 GhostWriter: Failed to capture snapshot for keyboard event:', snapshotError);
      }

      // Phase 6: Capture AI Evidence (context snapshot)
      const contextSnapshot = DOMDistiller.captureInteractionContext(actualElement as HTMLElement);

      // Capture semantic anchors (Phase 6)
      const semanticAnchors = ElementContext.getSemanticAnchors(actualElement as HTMLElement);

      const stepPayload: WorkflowStep['payload'] = {
        selector: selectors.primary,
        fallbackSelectors: enhancedFallbacks.length > 0 ? enhancedFallbacks : [selectors.primary],
        xpath: selectors.xpath,
        timestamp: stepTimestamp,
        url: url,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
        shadowPath: selectors.shadowPath,
        // Phase 2: Important fixes
        keyboardDetails,
        viewport,
        timing,
        visualSnapshot, // Visual snapshot for AI description generation
        // Phase 3: Minor enhancements
        pageState,
        // Phase 6: AI Evidence capture
        aiEvidence: (contextSnapshot || semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) ? {
          contextSnapshot: contextSnapshot,
          semanticAnchors: (semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) 
            ? semanticAnchors 
            : undefined
        } : undefined,
      };

      // Enrich with reliable replayer data (LocatorBundle, Intent, Success Conditions)
      const reliableData = this.enrichStepWithReliableData(actualElement, 'KEYBOARD', undefined, keyboardDetails.key);
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.stepGoal = reliableData.stepGoal;
        stepPayload.suggestedCondition = reliableData.suggestedCondition;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
        
        // Calculate locator quality metrics
        const hasStableAttributes = reliableData.locatorBundle.strategies.some(s => s.features.hasStableAttributes);
        const hasUniqueMatch = reliableData.locatorBundle.strategies.some(s => s.features.uniqueMatchAtRecordTime);
        const hasDynamicParts = reliableData.locatorBundle.strategies.some(s => s.features.hasDynamicParts);
        
        stepPayload.locatorQuality = {
          hasStableAttributes,
          hasUniqueMatch,
          hasDynamicParts,
          strategiesAvailable: reliableData.locatorBundle.strategies.length,
          confidenceScore: hasStableAttributes && hasUniqueMatch && !hasDynamicParts ? 0.9 :
                          hasStableAttributes || hasUniqueMatch ? 0.7 :
                          reliableData.locatorBundle.strategies.length >= 3 ? 0.5 : 0.3,
        };
      }

      // Determine wait conditions
      const step: WorkflowStep = {
        type: 'KEYBOARD',
        payload: stepPayload,
      };

      // OUTCOME DIFFING: Wait for stability, then capture "after" state and generate outcomes
      // Keyboard events (especially Enter) can trigger form submissions and navigation
      if (beforeSignals && FeatureFlags.OUTCOME_VERIFICATION) {
        try {
          console.log('[OutcomeDiff:Keyboard] Waiting for stability before capturing after state...');
          await StateWaitEngine.waitForStability({
            domQuietMs: 150,
            networkQuietMs: 200,
            maxWaitMs: 3000,
            checkSpinners: true,
          });
          
          const afterSignals = capturePageSignals(actualElement);
          console.log('[OutcomeDiff:Keyboard] After signals captured:', {
            url: afterSignals.url,
            modals: afterSignals.modals.length,
            toasts: afterSignals.toasts.length,
            spinners: afterSignals.spinnerCount,
          });
          
          const outcomes = generateOutcomesFromDiff(beforeSignals, afterSignals);
          if (outcomes.length > 0) {
            stepPayload.expectedOutcomes = outcomes;
            console.log(`[OutcomeDiff:Keyboard] ✅ Generated ${outcomes.length} expected outcomes:`, 
              outcomes.map(o => o.type));
          }
        } catch (diffError) {
          console.warn('[OutcomeDiff:Keyboard] Failed to generate outcomes:', diffError);
        }
      }

      this.sendStep(step);
      this.lastStep = step;
    } catch (error) {
      console.error('Error handling keyboard event:', error);
    }
  }

  /**
   * Handle scroll events (debounced)
   * Captures meaningful scroll actions with visual snapshots
   * NOW SUPPORTS: Page scrolls AND container scrolls (modals, divs, etc.)
   */
  private handleScroll(event: Event): void {
    if (!this.isRecording) return;

    // Store the event for processing after debounce
    this.pendingScrollEvent = event;

    // Clear previous timer
    if (this.scrollDebounceTimer !== null) {
      clearTimeout(this.scrollDebounceTimer);
    }

    // Set new timer - only record after scroll stops
    this.scrollDebounceTimer = window.setTimeout(async () => {
      // Don't capture if recording was stopped
      if (!this.isRecording) return;

      try {
        const event = this.pendingScrollEvent;
        if (!event) return;

        // Detect if this is a container scroll or window scroll
        const target = event.target;
        let isContainerScroll = false;
        let scrollContainer: Element | null = null;
        let scrollTop = 0;
        let scrollLeft = 0;
        
        // Check if scroll happened on a specific element (not document/window)
        if (target && target !== document && target !== window && target instanceof Element) {
          const element = target as Element;
          const style = window.getComputedStyle(element);
          const isScrollable = style.overflow === 'auto' || style.overflow === 'scroll' || 
                              style.overflowY === 'auto' || style.overflowY === 'scroll';
          
          if (isScrollable && element.scrollHeight > element.clientHeight) {
            isContainerScroll = true;
            scrollContainer = element;
            scrollTop = element.scrollTop;
            scrollLeft = element.scrollLeft;
            console.log(`📜 GhostWriter: Detected container scroll: ${element.tagName} scrollTop=${scrollTop}`);
          }
        }
        
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const currentTimestamp = Date.now();

        // Calculate scroll delta (how much the user actually scrolled)
        let scrollDeltaX = 0;
        let scrollDeltaY = 0;
        
        // Skip if scroll position hasn't changed significantly (less than 50px)
        if (this.lastScrollStep) {
          // Check if this is the same container/window as last time
          const sameTarget = isContainerScroll 
            ? this.lastScrollStep.container === scrollContainer
            : !this.lastScrollStep.container;
          
          if (sameTarget) {
            scrollDeltaX = isContainerScroll 
              ? scrollLeft - (this.lastScrollStep.scrollX || 0)
              : scrollX - this.lastScrollStep.scrollX;
            scrollDeltaY = isContainerScroll 
              ? scrollTop - (this.lastScrollStep.scrollY || 0)
              : scrollY - this.lastScrollStep.scrollY;
            
            if (Math.abs(scrollDeltaX) < 50 && Math.abs(scrollDeltaY) < 50) {
              return; // Not a meaningful scroll
            }

            // Skip if same scroll position within 1 second (debounce)
            if ((currentTimestamp - this.lastScrollStep.timestamp) < 1000 &&
                Math.abs(scrollDeltaX) < 10 && Math.abs(scrollDeltaY) < 10) {
              return; // Duplicate scroll
            }
          } else {
            // First scroll in this container - use current position as delta from 0
            scrollDeltaX = isContainerScroll ? scrollLeft : scrollX;
            scrollDeltaY = isContainerScroll ? scrollTop : scrollY;
          }
        } else {
          // First scroll ever - use current position as delta from 0
          scrollDeltaX = isContainerScroll ? scrollLeft : scrollX;
          scrollDeltaY = isContainerScroll ? scrollTop : scrollY;
        }
        
        console.log(`📜 GhostWriter: Scroll delta recorded: deltaX=${scrollDeltaX}, deltaY=${scrollDeltaY}`);

        const url = window.location.href;

        // Capture viewport snapshot for scroll (shows what's visible after scrolling)
        let visualSnapshot: WorkflowStepPayload['visualSnapshot'] | undefined;
        try {
          console.log('📸 GhostWriter: Capturing snapshot for scroll event');
          // Capture viewport snapshot (no specific element, just the viewport)
          const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VIEWPORT' });
          if (response && response.data?.snapshot) {
            const viewportSnapshot = response.data.snapshot;
            visualSnapshot = {
              viewport: viewportSnapshot,
              elementSnippet: viewportSnapshot, // Use viewport as element snippet for scroll
              timestamp: Date.now(),
              viewportSize: {
                width: window.innerWidth,
                height: window.innerHeight
              },
            };
            console.log('📸 GhostWriter: Snapshot captured for scroll event');
          }
        } catch (snapshotError) {
          console.warn('📸 GhostWriter: Failed to capture snapshot for scroll event:', snapshotError);
        }

        // Capture viewport information INCLUDING scroll delta for exact replay
        const viewport: import('../types/workflow').ViewportInfo = {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX,
          scrollY,
          // 🎯 NEW: Store scroll delta for exact replay!
          scrollDeltaX,
          scrollDeltaY,
          // Store container scroll info if this is a container scroll
          ...(isContainerScroll && scrollContainer && {
            elementScrollContainer: {
              selector: scrollContainer.getAttribute('class') 
                ? `.${scrollContainer.getAttribute('class')?.split(' ')[0]}`
                : scrollContainer.tagName.toLowerCase(),
              scrollTop,
              scrollLeft,
              // 🎯 NEW: Store delta for container scrolls too
              scrollDeltaX,
              scrollDeltaY,
            }
          }),
        };

        // Capture timing information
        const stepTimestamp = Date.now();
        const delayAfter = this.lastStep ? (stepTimestamp - this.lastStep.payload.timestamp) : undefined;
        const timing: import('../types/workflow').TimingInfo | undefined = delayAfter ? {
          delayAfter,
        } : undefined;

        // Generate selectors for the scroll target
        let selector = 'body';
        let fallbackSelectors = ['body', 'html'];
        let xpath = '/html/body';
        
        if (isContainerScroll && scrollContainer) {
          // Generate proper selectors for the container
          const containerSelectors = SelectorEngine.generateSelectors(scrollContainer, undefined);
          selector = containerSelectors.primary || 'body';
          fallbackSelectors = [
            containerSelectors.primary,
            ...containerSelectors.fallbacks,
          ].filter((s): s is string => !!s);
          xpath = containerSelectors.xpath || '/html/body';
        }

        const stepPayload: WorkflowStep['payload'] = {
          selector,
          fallbackSelectors,
          xpath,
          timestamp: stepTimestamp,
          url: url,
          tabUrl: this.currentTabUrl || undefined,
          tabTitle: this.currentTabTitle || undefined,
          tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
          viewport,
          timing,
          visualSnapshot, // Visual snapshot for AI description generation
        };

        // Determine wait conditions
        const step: WorkflowStep = {
          type: 'SCROLL',
          payload: stepPayload,
        };

        // Update last scroll step
        this.lastScrollStep = {
          scrollX: isContainerScroll ? scrollLeft : scrollX,
          scrollY: isContainerScroll ? scrollTop : scrollY,
          timestamp: currentTimestamp,
          container: scrollContainer || undefined,
        };

        this.sendStep(step);
        this.lastStep = step;
      } catch (error) {
        console.error('Error handling scroll event:', error);
      }
    }, this.SCROLL_DEBOUNCE_DELAY);
  }

  /**
   * Handle copy events to track data lineage (Phase 6)
   */
  private handleCopy(_event: ClipboardEvent): void {
    if (!this.isRecording) return;

    try {
      let selectedText: string | undefined;
      let actualElement: Element | null = null;

      // Better Text Extraction: Check if active element is input/textarea first
      const activeElement = document.activeElement;
      if (activeElement && 
          (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        const inputElement = activeElement as HTMLInputElement | HTMLTextAreaElement;
        const selectionStart = inputElement.selectionStart || 0;
        const selectionEnd = inputElement.selectionEnd || 0;
        
        if (selectionStart !== selectionEnd) {
          selectedText = inputElement.value.substring(selectionStart, selectionEnd);
          actualElement = activeElement as Element;
        }
      }

      // Fallback to window.getSelection() if not from input/textarea
      if (!selectedText || selectedText.trim().length === 0) {
        const selection = window.getSelection();
        selectedText = selection?.toString();
        
        if (!selectedText || selectedText.trim().length === 0) {
          return; // Nothing selected
        }

        // Get the source element (where the copy happened)
        if (!selection || selection.rangeCount === 0) {
          return;
        }

        const range = selection.getRangeAt(0);
        const sourceElement = range.commonAncestorContainer;
        
        // Get actual element (text nodes don't have methods we need)
        actualElement = sourceElement.nodeType === Node.TEXT_NODE 
          ? sourceElement.parentElement 
          : sourceElement as Element;
      }
      
      if (!actualElement) {
        return;
      }

      // Generate selector for source element
      const selectors = SelectorEngine.generateSelectors(actualElement);
      
      // Store to chrome.storage.local
      const clipboardData = {
        text: selectedText,
        sourceSelector: selectors.primary,
        timestamp: Date.now(),
        url: window.location.href
      };

      console.log('📋 GhostWriter Copy Detected:', selectedText, 'from', selectors.primary);

      chrome.storage.local.set({ ghostwriter_clipboard: clipboardData }, () => {
        console.log('GhostWriter: Clipboard data stored:', {
          textLength: selectedText.length,
          sourceSelector: selectors.primary.substring(0, 50),
          url: window.location.href
        });
      });
    } catch (error) {
      console.warn('GhostWriter: Failed to handle copy event:', error);
    }
  }

  /**
   * Capture the final value of an input element
   * @param element The input element
   * @param captureTimestamp The timestamp when the input event first fired (not when debounce completed)
   * @param beforeSignals Optional before signals for outcome diffing
   */
  private async captureInputValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
    captureTimestamp: number,
    beforeSignals?: ReturnType<typeof capturePageSignals> | null
  ): Promise<void> {
    try {
      // Check if element is contenteditable
      const isContentEditable = (element as HTMLElement).isContentEditable || 
                                element.getAttribute('contenteditable') === 'true';
      
      const selectors = SelectorEngine.generateSelectors(element, undefined);
      const label = LabelFinder.findLabel(element);
      console.log(`[RecordingManager] Label extracted for INPUT step:`, { label, elementTag: element.tagName, elementClass: element.className?.toString().substring(0, 50), ariaLabel: element.getAttribute('aria-label')?.substring(0, 50) });
      
      // Extract value: for contenteditable, use textContent/innerText; for standard inputs, use value
      let value: string;
      if (isContentEditable) {
        value = (element as HTMLElement).textContent?.trim() || 
                (element as HTMLElement).innerText?.trim() || '';
        
        // RECOVERY STRATEGY: If DOM is empty but we have cached value, use cache
        // This fixes the Google Sheets bug where contenteditable clears on blur/Enter
        // Don't check element equality - just use cache if DOM is empty (simpler and more reliable)
        if (!value && this.lastInputValue) {
          console.log('GhostWriter: Recovering value from cache:', this.lastInputValue);
          value = this.lastInputValue;
        }
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        value = element.value || (element as HTMLInputElement).checked?.toString() || '';
        
        // RECOVERY STRATEGY: For standard inputs too (less common but safe)
        if (!value && this.lastInputValue) {
          console.log('GhostWriter: Recovering value from cache:', this.lastInputValue);
          value = this.lastInputValue;
        }
      } else {
        value = '';
      }
      
      const url = window.location.href;

      // Deduplicate: Skip if this is the same input with the same value as the last recorded step
      if (this.lastInputStep && 
          this.lastInputStep.selector === selectors.primary && 
          this.lastInputStep.value === value) {
        return; // Skip duplicate input
      }

      // Generate semantic fallback selectors for grid cells (same as in handleClick)
      const semanticContext = ContextScanner.scan(element);
      let enhancedFallbacks = [...selectors.fallbacks];
      
      if (semanticContext.gridCoordinates?.cellReference) {
        const cellRef = semanticContext.gridCoordinates.cellReference;
        // Same semantic selectors as in handleClick (Google Sheets verbose aria-labels)
        const semanticSelectors = [
          `[aria-label*="${cellRef}"]`,                    // Contains: "Cell A1", "A1 value is..."
          `[aria-label="${cellRef}"]`,                     // Exact: "A1" (rare but possible)
          `[aria-label="Cell ${cellRef}"]`,                // Common Google pattern
          `[aria-label^="${cellRef} "]`,                   // Starts with: "A1 value..."
          `//*[@role="gridcell" and contains(@aria-label, "${cellRef}")]`, // XPath (safest)
          `[data-cell="${cellRef}"]`,                      // Data attribute fallback
          `[data-cellref="${cellRef}"]`,                  // Alternative data attribute
        ];
        enhancedFallbacks = [...semanticSelectors, ...enhancedFallbacks];
        console.log('🔍 RecordingManager: Generated semantic fallback selectors for input cell', cellRef, ':', semanticSelectors.length, 'selectors');
      }

      // Capture context for input elements too (with error handling)
      let context: import('./element-context').ElementContextData | null = null;
      let similarElements: Element[] = [];
      let uniquenessScore = 1.0;
      let disambiguationAttrs: Record<string, string> = {};
      let elementState: import('../types/workflow').ElementState | null = null;

      try {
        context = ElementContext.captureContext(element);
        similarElements = SelectorEngine.findSimilarElements(element);
        uniquenessScore = ElementSimilarity.getUniquenessScore(element, similarElements);
        disambiguationAttrs = ElementSimilarity.getDisambiguationAttributes(element, similarElements);
        elementState = ElementStateCapture.captureElementState(element);
      } catch (contextError) {
        console.warn('GhostWriter: Error capturing input context, continuing with basic recording:', contextError);
        // Continue with basic recording even if context capture fails
        // Still try to capture state even if context fails
        try {
          elementState = ElementStateCapture.captureElementState(element);
        } catch (stateError) {
          console.warn('GhostWriter: Error capturing element state:', stateError);
        }
      }

      // Capture input details (Phase 2: Important)
      // Only HTMLInputElement has min, max, pattern, step properties
      // For contenteditable, we don't have these properties
      const inputDetails: import('../types/workflow').InputDetails | undefined = 
        isContentEditable ? undefined : {
          type: (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).type || 'text',
          required: (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required || false,
          min: element instanceof HTMLInputElement ? (element.min || undefined) : undefined,
          max: element instanceof HTMLInputElement ? (element.max || undefined) : undefined,
          pattern: element instanceof HTMLInputElement ? (element.pattern || undefined) : undefined,
          step: element instanceof HTMLInputElement ? (element.step ? parseFloat(element.step) : undefined) : undefined,
        };

      // Capture viewport and scroll information (Phase 1: Critical) - only if needed
      let viewport: import('../types/workflow').ViewportInfo | undefined = undefined;
      const scrollContainer = this.findScrollContainer(element);
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const hasScroll = scrollX !== 0 || scrollY !== 0;
      const hasScrollContainer = scrollContainer && (scrollContainer.scrollTop !== 0 || scrollContainer.scrollLeft !== 0);
      
      // Only include viewport if scroll exists or has scroll container with non-zero scroll
      if (hasScroll || hasScrollContainer) {
        viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        
        // Only include scrollX/scrollY if non-zero
        if (scrollX !== 0) {
          viewport.scrollX = scrollX;
        }
        if (scrollY !== 0) {
          viewport.scrollY = scrollY;
        }
        
        // Only include elementScrollContainer if it has non-zero scroll
        if (hasScrollContainer && scrollContainer) {
          const containerSelector = SelectorEngine.generateSelectors(scrollContainer).primary;
          const containerScrollTop = scrollContainer.scrollTop;
          const containerScrollLeft = scrollContainer.scrollLeft;
          
          viewport.elementScrollContainer = {
            selector: containerSelector,
          };
          
          // Only include scrollTop/scrollLeft if non-zero
          if (containerScrollTop !== 0) {
            viewport.elementScrollContainer.scrollTop = containerScrollTop;
          }
          if (containerScrollLeft !== 0) {
            viewport.elementScrollContainer.scrollLeft = containerScrollLeft;
          }
        }
      }

      // Capture element bounds (Phase 2: Important) - simplified (top/left/right/bottom removed)
      const rect = element.getBoundingClientRect();
      const elementBounds: import('../types/workflow').ElementBounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };

      // Capture element role (Phase 3: Minor)
      const elementRole = element.getAttribute('role') || undefined;

      // Capture page state (Phase 3: Minor) - omitted (usually 'complete' and loadTime not used by replayer)
      const pageState: import('../types/workflow').PageState | undefined = undefined;

      // Capture iframe context (Phase 2: Important)
      const iframeContext = IframeUtils.getIframeContext(element);

      // Capture timing information (Phase 2: Important) - only include if delayAfter exists
      // Use the synchronously captured timestamp (when input event fired, not when debounce completed)
      const stepTimestamp = captureTimestamp;
      const delayAfter = this.lastStep ? (stepTimestamp - this.lastStep.payload.timestamp) : undefined;
      const timing: import('../types/workflow').TimingInfo | undefined = delayAfter ? {
        delayAfter,
        // animationWait and networkWait omitted when false
      } : undefined;

      // Capture retry strategy (Phase 3: Minor) - omitted (always defaults, replayer uses fallbackSelectors)
      const retryStrategy: import('../types/workflow').RetryStrategy | undefined = undefined;

      // Capture focus events (Phase 3: Minor) - inputs always need focus
      const focusEvents: import('../types/workflow').FocusEvents = {
        needsFocus: true,
        // needsBlur omitted when false
      };

      // Capture network conditions (Phase 3: Minor) - only include if waitForRequests is true
      // Currently always false, so omit entirely
      const networkConditions: import('../types/workflow').NetworkConditions | undefined = undefined;

      // ALWAYS capture snapshot for input events (for AI context)
      // Try pending snapshot first (from mousedown), but capture fresh if not available
      let visualSnapshot: WorkflowStepPayload['visualSnapshot'] | undefined;
      if (this.pendingSnapshot) {
        try {
          const visuals = await this.pendingSnapshot;
          if (visuals) {
            visualSnapshot = {
              viewport: visuals.viewport,
              elementSnippet: visuals.elementSnippet,
              timestamp: Date.now(),
              viewportSize: {
                width: window.innerWidth,
                height: window.innerHeight
              },
              elementBounds: elementBounds
            };
            console.log('📸 GhostWriter: Using pending snapshot for input');
          }
        } catch (err) {
          console.warn('GhostWriter: Failed to get cached snapshot for input:', err);
        } finally {
          this.pendingSnapshot = null;
        }
      }
      
      // If no pending snapshot, capture a fresh one
      if (!visualSnapshot) {
        try {
          console.log('📸 GhostWriter: Capturing fresh snapshot for input event');
          
          // Check if this is a spreadsheet cell - use enhanced capture if so
          // The capture() method will automatically use spreadsheet capture on spreadsheet domains
          const visuals = await VisualSnapshotService.capture(element);
          if (visuals) {
            visualSnapshot = {
              viewport: visuals.viewport,
              elementSnippet: visuals.elementSnippet,
              timestamp: Date.now(),
              viewportSize: {
                width: window.innerWidth,
                height: window.innerHeight
              },
              elementBounds: elementBounds
            };
            console.log('📸 GhostWriter: Fresh snapshot captured for input event');
          }
        } catch (snapshotError) {
          console.warn('📸 GhostWriter: Failed to capture snapshot for input event:', snapshotError);
        }
      }

      // Phase 6: Capture AI Evidence (context snapshot)
      const contextSnapshot = DOMDistiller.captureInteractionContext(element as HTMLElement);

      // Capture semantic anchors (Phase 6)
      const semanticAnchors = ElementContext.getSemanticAnchors(element as HTMLElement);

      // Phase 6: Check for clipboard data transfer (data lineage)
      let clipboardMetadata: { sourceSelector: string; copiedValue: string; timestamp: number } | undefined;
      try {
        const result = await chrome.storage.local.get('ghostwriter_clipboard');
        const clipboardData = result.ghostwriter_clipboard as {
          text: string;
          sourceSelector: string;
          timestamp: number;
          url: string;
        } | undefined;
        
        console.log('📋 Checking Clipboard Match:', { 
          currentInput: value, 
          clipboard: clipboardData ? {
            text: clipboardData.text,
            sourceSelector: clipboardData.sourceSelector,
            timestamp: clipboardData.timestamp,
            age: clipboardData ? Date.now() - clipboardData.timestamp : 'N/A'
          } : null
        });
        
        if (clipboardData && clipboardData.text) {
          // Check if clipboard data is recent (less than 10 minutes old)
          const tenMinutesInMs = 10 * 60 * 1000;
          const age = Date.now() - clipboardData.timestamp;
          
          if (age < tenMinutesInMs) {
            // Check if input value matches clipboard text
            if (value === clipboardData.text) {
              console.log('GhostWriter: Detected clipboard paste - input matches copied text');
              clipboardMetadata = {
                sourceSelector: clipboardData.sourceSelector,
                copiedValue: clipboardData.text.length > 500 
                  ? clipboardData.text.substring(0, 500) + '...' 
                  : clipboardData.text, // Truncate large values
                timestamp: clipboardData.timestamp
              };
            } else {
              console.log('📋 Clipboard text does not match input value:', {
                inputLength: value.length,
                clipboardLength: clipboardData.text.length,
                inputPreview: value.substring(0, 50),
                clipboardPreview: clipboardData.text.substring(0, 50)
              });
            }
          } else {
            console.log('📋 Clipboard data too old:', { age: age, maxAge: tenMinutesInMs });
          }
        }
      } catch (error) {
        console.warn('GhostWriter: Failed to check clipboard data:', error);
      }

      // Analyze element for execution strategy
      const elementAnalysis = ElementAnalyzer.analyze(element);
      console.log('🔍 GhostWriter: Element Analysis (INPUT):\n' + ElementAnalyzer.formatAnalysis(elementAnalysis));

      // Build step payload first (without wait conditions)
      const stepPayload: WorkflowStep['payload'] = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks,
        xpath: selectors.xpath,
        label: label || undefined,
        value: value,
        timestamp: stepTimestamp,
        url: url,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
        shadowPath: selectors.shadowPath,
        elementState: elementState || undefined,
        // Phase 2: Important fixes
        inputDetails,
        viewport,
        elementBounds,
        iframeContext: iframeContext || undefined,
        timing,
        visualSnapshot, // Phase 2: Visual snapshots for AI reliability
        // Phase 3: Minor enhancements
        elementRole,
        pageState,
        retryStrategy,
        focusEvents,
        networkConditions,
        context: context ? {
          // Only include siblings if they have content, and only include non-empty arrays
          siblings: (context.siblings.before.length > 0 || context.siblings.after.length > 0) ? {
            ...(context.siblings.before.length > 0 ? { before: context.siblings.before } : {}),
            ...(context.siblings.after.length > 0 ? { after: context.siblings.after } : {}),
          } : undefined,
          parent: context.parent || undefined,
          ancestors: context.ancestors.length > 0 ? context.ancestors : undefined,
          container: context.container || undefined,
          position: context.position,
          surroundingText: context.surroundingText,
          uniqueAttributes: Object.keys(disambiguationAttrs).length > 0 ? disambiguationAttrs : undefined,
          formContext: context.formContext,
          // Capture semantic coordinates for AI interpretation (includes decisionSpace)
          ...(function() {
            const scanned = ContextScanner.scan(element);
            console.log(`[RecordingManager] ContextScanner.scan result for INPUT step:`, { hasGridCoordinates: !!scanned.gridCoordinates, cellReference: scanned.gridCoordinates?.cellReference, columnHeader: scanned.gridCoordinates?.columnHeader, label, labelMatchesCellRef: label === scanned.gridCoordinates?.cellReference });
            return scanned;
          })(),
        } : (function() {
          const scanned = ContextScanner.scan(element);
          console.log(`[RecordingManager] ContextScanner.scan result (no context) for INPUT step:`, { hasGridCoordinates: !!scanned.gridCoordinates, cellReference: scanned.gridCoordinates?.cellReference, columnHeader: scanned.gridCoordinates?.columnHeader, label, labelMatchesCellRef: label === scanned.gridCoordinates?.cellReference });
          return scanned;
        })(),
        similarity: similarElements.length > 0 ? {
          similarCount: similarElements.length,
          uniquenessScore,
          disambiguation: Object.keys(disambiguationAttrs).map(
            key => `${key}="${disambiguationAttrs[key]}"`
          ),
        } : undefined,
        // Phase 6: AI Evidence capture
        aiEvidence: (contextSnapshot || clipboardMetadata || semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) ? {
          contextSnapshot: contextSnapshot,
          clipboardMetadata: clipboardMetadata,
          semanticAnchors: (semanticAnchors.textLabel || semanticAnchors.ariaLabel || semanticAnchors.nearbyText) 
            ? semanticAnchors 
            : undefined
        } : undefined,
        // Element analysis for execution strategy
        elementAnalysis: {
          executionStrategy: elementAnalysis.executionStrategy,
          confidence: elementAnalysis.confidence,
          reasons: elementAnalysis.reasons,
          bestSelector: elementAnalysis.bestSelector,
          fallbackSelectors: elementAnalysis.fallbackSelectors,
        },
      };

      // Enrich with reliable replayer data (LocatorBundle, Intent, Success Conditions)
      const reliableData = this.enrichStepWithReliableData(element, 'INPUT', value);
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.stepGoal = reliableData.stepGoal;
        stepPayload.suggestedCondition = reliableData.suggestedCondition;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
        
        // Calculate locator quality metrics
        const hasStableAttributes = reliableData.locatorBundle.strategies.some(s => s.features.hasStableAttributes);
        const hasUniqueMatch = reliableData.locatorBundle.strategies.some(s => s.features.uniqueMatchAtRecordTime);
        const hasDynamicParts = reliableData.locatorBundle.strategies.some(s => s.features.hasDynamicParts);
        
        stepPayload.locatorQuality = {
          hasStableAttributes,
          hasUniqueMatch,
          hasDynamicParts,
          strategiesAvailable: reliableData.locatorBundle.strategies.length,
          confidenceScore: hasStableAttributes && hasUniqueMatch && !hasDynamicParts ? 0.9 :
                          hasStableAttributes || hasUniqueMatch ? 0.7 :
                          reliableData.locatorBundle.strategies.length >= 3 ? 0.5 : 0.3,
        };
      }

      // Determine wait conditions based on this step and previous step
      const step: WorkflowStep = {
        type: 'INPUT',
        payload: stepPayload,
      };

      // Debug: Log if visualSnapshot is present
      if (stepPayload.visualSnapshot) {
        console.log('📸 GhostWriter: Input step includes visualSnapshot with viewport size:', stepPayload.visualSnapshot.viewport?.length || 0, 'chars, snippet size:', stepPayload.visualSnapshot.elementSnippet?.length || 0, 'chars');
      } else {
        console.warn('📸 GhostWriter: Input step does NOT include visualSnapshot');
      }

      // Update last input step
      this.lastInputStep = {
        selector: selectors.primary,
        value: value,
      };

      // OUTCOME DIFFING: If beforeSignals provided (from handleChange), wait for stability and generate outcomes
      // This is important for select/checkbox/radio changes that can trigger page updates
      if (beforeSignals && FeatureFlags.OUTCOME_VERIFICATION) {
        try {
          console.log('[OutcomeDiff:Input] Waiting for stability before capturing after state...');
          await StateWaitEngine.waitForStability({
            domQuietMs: 150,
            networkQuietMs: 200,
            maxWaitMs: 3000,
            checkSpinners: true,
          });
          
          const afterSignals = capturePageSignals(element);
          console.log('[OutcomeDiff:Input] After signals captured:', {
            url: afterSignals.url,
            modals: afterSignals.modals.length,
            toasts: afterSignals.toasts.length,
            spinners: afterSignals.spinnerCount,
          });
          
          const outcomes = generateOutcomesFromDiff(beforeSignals, afterSignals);
          if (outcomes.length > 0) {
            stepPayload.expectedOutcomes = outcomes;
            console.log(`[OutcomeDiff:Input] ✅ Generated ${outcomes.length} expected outcomes:`, 
              outcomes.map(o => o.type));
          }
        } catch (diffError) {
          console.warn('[OutcomeDiff:Input] Failed to generate outcomes:', diffError);
        }
      }

      this.sendStep(step);
      this.lastStep = step;

      // Clear cache after successful record
      this.lastInputValue = '';
      this.currentInputElement = null;
    } catch (error) {
      console.error('Error capturing input value:', error);
    }
  }

  /**
   * Send a workflow step to the side panel
   */
  private sendStep(step: WorkflowStep): void {
    try {
      // Debug: Verify visualSnapshot is in the step before sending
      if (isWorkflowStepPayload(step.payload)) {
        const hasVisualSnapshot = !!step.payload.visualSnapshot;
        if (hasVisualSnapshot && step.payload.visualSnapshot) {
          const snapshot = step.payload.visualSnapshot;
          console.log('📸 GhostWriter: Sending step with visualSnapshot - viewport:', snapshot.viewport?.substring(0, 50) || 'missing', '...');
        } else {
          console.warn('📸 GhostWriter: Sending step WITHOUT visualSnapshot');
        }

        // Phase 4: Add page type to step if available
        if (this.currentPageAnalysis?.pageType) {
          step.payload.pageType = this.currentPageAnalysis.pageType;
        }
      }

      chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        payload: { 
          step,
          tabUrl: this.currentTabUrl || undefined,
          tabTitle: this.currentTabTitle || undefined,
        },
      } as import('../types/messages').RecordedStepMessage);
      
      // Generate description asynchronously (non-blocking)
      this.generateStepDescription(step).catch((error) => {
        console.warn('GhostWriter: Failed to generate step description:', error);
      });
    } catch (error) {
      console.error('Error sending step:', error);
    }
  }

  /**
   * Analyze current page for human-like understanding (async, non-blocking)
   */
  private async analyzeCurrentPage(): Promise<void> {
    if (this.pageAnalysisPending) {
      return; // Avoid duplicate analysis
    }

    if (!aiConfig.isVisualAnalysisEnabled()) {
      return;
    }

    this.pageAnalysisPending = true;

    try {
      console.log('🎨 GhostWriter: Analyzing page type...');
      const analysis = await VisualAnalysisService.analyzePageType();
      
      if (analysis) {
        this.currentPageAnalysis = analysis;
        console.log('🎨 GhostWriter: Page type:', analysis.pageType?.type, 
                   'confidence:', analysis.pageType?.confidence?.toFixed(2));
      }
    } catch (error) {
      console.warn('🎨 GhostWriter: Page analysis failed:', error);
    } finally {
      this.pageAnalysisPending = false;
    }
  }

  /**
   * Get current page type (for steps that need it)
   */
  getCurrentPageType(): PageType | undefined {
    return this.currentPageAnalysis?.pageType;
  }

  /**
   * Generate natural language description for a step (async, non-blocking)
   */
  private async generateStepDescription(step: WorkflowStep): Promise<void> {
    try {
      const result = await AIService.generateStepDescription(step);
      if (result.description) {
        // Update step with description
        const stepId = step.payload.timestamp.toString();
        const updatedStep: WorkflowStep = {
          ...step,
          description: result.description,
        };
        
        // Send update message to side panel
        chrome.runtime.sendMessage({
          type: 'UPDATE_STEP',
          payload: { stepId, step: updatedStep }
        } as import('../types/messages').UpdateStepMessage);
        
        console.log(`📝 GhostWriter: Generated description for step: "${result.description}"`);
      }
    } catch (error) {
      // Fail silently - description is enhancement
      console.warn('GhostWriter: Description generation failed:', error);
    }
  }

  /**
   * Get current recording state
   */
  getRecordingState(): boolean {
    return this.isRecording;
  }

  /**
   * Enhance step with AI-suggested selectors (non-blocking, background)
   */
  private async enhanceStepWithAI(
    step: WorkflowStep,
    currentFallbacks: string[],
    element: Element
  ): Promise<void> {
    const startTime = performance.now();
    const stepId = step.payload.timestamp.toString();
    
    // Notify UI that AI validation has started
    try {
      chrome.runtime.sendMessage({
        type: 'AI_VALIDATION_STARTED',
        payload: { stepId }
      } as import('../types/messages').AIValidationStartedMessage);
    } catch (e) {
      // Fail silently - UI notification is non-critical
    }
    
    try {
      if (!isWorkflowStepPayload(step.payload)) {
        console.warn('🤖 GhostWriter: Cannot enhance TAB_SWITCH step with AI');
        return;
      }
      
      console.log('🤖 GhostWriter: enhanceStepWithAI started for selector:', step.payload.selector);
      
      // Extract context
      const contextStartTime = performance.now();
      const context = DOMDistiller.extractElementContext(element);
      const contextTime = performance.now() - contextStartTime;
      console.log(`🤖 GhostWriter: Element context extracted in ${contextTime.toFixed(2)}ms, length:`, context.length);
      
      // Scrub PII
      const scrubStartTime = performance.now();
      const scrubbed = PIIScrubber.scrub(context);
      const scrubTime = performance.now() - scrubStartTime;
      console.log(`🤖 GhostWriter: Context scrubbed in ${scrubTime.toFixed(2)}ms, calling AI validation...`);
      
      // Call AI validation
      const aiStartTime = performance.now();
      console.log('🤖 GhostWriter: Calling AIService.validateSelector...');
      const result = await AIService.validateSelector(
        step.payload.selector,
        scrubbed,
        {
          title: document.title,
          url: window.location.href
        }
      );
      const aiTime = performance.now() - aiStartTime;
      const totalTime = performance.now() - startTime;
      console.log(`🤖 GhostWriter: AI validation completed in ${aiTime.toFixed(2)}ms (total: ${totalTime.toFixed(2)}ms)`);
      console.log('🤖 GhostWriter: AI validation result:', { 
        isStable: result.isStable, 
        alternativesCount: result.alternatives.length, 
        confidence: result.confidence,
        reasoning: result.reasoning 
      });
      if (result.reasoning) {
        console.log('🤖 GhostWriter: AI reasoning:', result.reasoning);
      }
      
      if (!result.isStable && result.alternatives.length > 0) {
        const processStartTime = performance.now();
        // Create updated step with AI suggestions prepended to fallbacks
        const updatedStep: WorkflowStep = {
          ...step,
          payload: {
            ...step.payload,
            fallbackSelectors: [
              ...result.alternatives,
              ...currentFallbacks
            ]
          }
        };
        
        // Send update message to side panel to update step in store
        // Use timestamp as unique identifier (steps don't have id field)
        chrome.runtime.sendMessage({
          type: 'UPDATE_STEP',
          payload: { stepId: step.payload.timestamp.toString(), step: updatedStep }
        } as import('../types/messages').UpdateStepMessage);
        
        const processTime = performance.now() - processStartTime;
        const finalTotalTime = performance.now() - startTime;
        console.log(`🤖 GhostWriter: AI injected robust selectors for step ${step.payload.timestamp} - ${result.alternatives.length} alternatives added (processing: ${processTime.toFixed(2)}ms, total: ${finalTotalTime.toFixed(2)}ms)`);
        
        // Notify UI that step has been enhanced
        try {
          chrome.runtime.sendMessage({
            type: 'STEP_ENHANCED',
            payload: { stepId }
          });
        } catch (e) {
          // Fail silently
        }
      } else {
        const finalTotalTime = performance.now() - startTime;
        console.log(`🤖 GhostWriter: AI validation completed (no alternatives needed, total: ${finalTotalTime.toFixed(2)}ms)`);
        
        // Remove from pending even if no alternatives were added
        try {
          chrome.runtime.sendMessage({
            type: 'AI_VALIDATION_COMPLETED',
            payload: { stepId, enhanced: false }
          });
        } catch (e) {
          // Fail silently
        }
      }
    } catch (e) {
      const errorTime = performance.now() - startTime;
      // Fail silently - AI is enhancement
      console.warn(`GhostWriter: AI validation failed for step ${step.payload.timestamp} after ${errorTime.toFixed(2)}ms:`, e);
      
      // Remove from pending on error
      try {
        chrome.runtime.sendMessage({
          type: 'AI_VALIDATION_COMPLETED',
          payload: { stepId, enhanced: false }
        });
      } catch (err) {
        // Fail silently
      }
    }
  }

  /**
   * Enrich step with reliable replayer data (LocatorBundle, Intent, Success Conditions)
   */
  private enrichStepWithReliableData(
    element: Element,
    stepType: 'CLICK' | 'INPUT' | 'KEYBOARD',
    value?: string,
    key?: string
  ): {
    locatorBundle: LocatorBundle;
    intent: Intent;
    stepGoal: StepGoal;
    suggestedCondition: SuggestedCondition;
  } | null {
    if (!this.ENABLE_RELIABLE_RECORDING) {
      return null;
    }

    try {
      // Build comprehensive locator bundle with all strategies and features
      const locatorBundle = buildLocatorBundle(element, document);
      
      // Infer machine-readable intent based on step type and element context
      let intent: Intent;
      switch (stepType) {
        case 'CLICK':
          intent = inferClickIntent(element);
          break;
        case 'INPUT':
          intent = inferInputIntent(element, value || '');
          break;
        case 'KEYBOARD':
          intent = inferKeyboardIntent(key || 'Enter');
          break;
      }
      
      // Build complete step goal with description and expected outcome
      const stepGoal = buildStepGoal(intent, element);
      
      // Suggest success condition based on intent and context
      const suggestedCondition = inferSuccessCondition(intent, element);
      
      console.log('🎯 GhostWriter: Enriched step with reliable data:', {
        intent: intent.kind,
        strategiesFound: locatorBundle.strategies.length,
        hasScope: !!locatorBundle.scope,
        disambiguators: locatorBundle.disambiguators.length,
        conditionConfidence: suggestedCondition.confidence,
      });
      
      return { locatorBundle, intent, stepGoal, suggestedCondition };
    } catch (error) {
      console.warn('GhostWriter: Failed to enrich step with reliable data:', error);
      return null;
    }
  }
}

