/**
 * RecordingManager - Manages event listeners and captures user interactions
 * 
 * This is the main orchestrator for recording user actions.
 * Delegates to specialized modules for element finding, step enrichment, and publishing.
 */

import { SelectorEngine } from './selector-engine';
import { LabelFinder } from './label-finder';
// DropdownOptionScanner - options now captured directly via MenuDetector + DOM scanning
import { ElementContext } from './element-context';
import { ElementSimilarity } from './element-similarity';
import { ElementStateCapture } from './element-state';
import { ElementTextCapture } from './element-text';
import { ShadowDOMUtils } from './shadow-dom-utils';
import { ElementAnalyzer } from '../lib/element-analyzer';
// WaitConditionDeterminer removed - StateWaitEngine handles waits at execution time
import { IframeUtils } from './iframe-utils';
import { ContextScanner } from './context-scanner';
import { SheetStateExtractor } from './sheet-state-extractor';
import { VisualSnapshotService, type AnnotatedCaptureResult } from './visual-snapshot';
import { AIService } from '../lib/ai-service';
import { aiLabelEnhancer } from '../lib/ai-label-enhancer';
import { aiConfig } from '../lib/ai-config';
// import { VisualAnalysisService } from '../lib/visual-analysis'; // Removed to prevent zoom issues
import { DOMDistiller } from '../lib/dom-distiller';
import { PIIScrubber } from '../lib/pii-scrubber';
// import { aiConfig } from '../lib/ai-config'; // Removed - not needed anymore
import { StateWaitEngine } from './state-wait-engine';
import { capturePageSignals, generateOutcomesFromDiff } from './universal-execution/state-verifier';
import { FeatureFlags } from '../lib/feature-flags';
import type { WorkflowStep, WorkflowStepPayload } from '../types/workflow';
import { isWorkflowStepPayload } from '../types/workflow';
// import type { PageAnalysis, PageType } from '../types/visual'; // Removed - not needed anymore
// Reliable Replayer enhancements - now in StepEnricher module
import { WidgetIdentifierService } from '../lib/widget-identifier';
import type { LocatorBundle } from '../types/locator';
import type { Intent, StepGoal } from '../types/intent';
import type { SuggestedCondition } from '../types/conditions';

// Extracted recording modules
import { ElementFinder } from './recording/element-finder';
import { StepPublisher } from './recording/step-publisher';
import { StepEnricher } from './recording/step-enricher';
import { MenuDetector, UNIVERSAL_MENU_SELECTORS } from './menu-detector';
import { InteractionDetector } from './interaction-detector';
import { FormAuditor } from './recording/form-auditor';

export class RecordingManager {
  // Feature flag for reliable replayer enhancements
  private readonly ENABLE_RELIABLE_RECORDING = true;
  
  // Extracted modules
  private readonly elementFinder: ElementFinder;
  private readonly stepPublisher: StepPublisher;
  private readonly stepEnricher: StepEnricher;
  
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
  private pasteHandler: ((event: ClipboardEvent) => void) | null = null;
  private dblclickHandler: ((event: MouseEvent) => void) | null = null;
  private contextmenuHandler: ((event: MouseEvent) => void) | null = null;
  private dragstartHandler: ((event: DragEvent) => void) | null = null;
  private dropHandler: ((event: DragEvent) => void) | null = null;
  private mouseenterHandler: ((event: MouseEvent) => void) | null = null;
  // Drag-drop state tracking
  private pendingDragSource: { element: Element; selector: string; coordinates: { x: number; y: number } } | null = null;
  // Hover state tracking
  private hoverDebounceTimer: number | null = null;
  private readonly HOVER_TRIGGER_DELAY = 500; // 500ms hover before recording (matches tooltip delay)
  private scrollDebounceTimer: number | null = null;
  // Modal/container scroll support: Track scroll listeners on elements
  private elementScrollListeners: Map<Element, (event: Event) => void> = new Map();
  private scrollableMutationObserver: MutationObserver | null = null;
  private lastScrollStep: { scrollX: number; scrollY: number; timestamp: number; container?: Element } | null = null;
  private pendingScrollEvent: Event | null = null; // Store the scroll event for processing after debounce
  private currentUrl: string = window.location.href;
  private currentTabUrl: string | null = null; // Tab URL (stable identifier, not tabId)
  private currentTabTitle: string | null = null; // Tab title for context
  private currentTabIndex: number | null = null; // Logical tab index (0, 1, 2...)
  private readonly DEBOUNCE_DELAY = 500; // 500ms debounce for input events
  private readonly SCROLL_DEBOUNCE_DELAY = 300; // 300ms debounce for scroll events
  private readonly CLICK_DEDUP_WINDOW = 500; // 500ms - ignore duplicate clicks on same element within this window (reduced from 2s to allow rapid different clicks)
  private lastInputStep: { selector: string; value: string } | null = null; // Track last input to prevent duplicates
  private lastClickStep: { selector: string; timestamp: number } | null = null; // Track last click to prevent duplicates
  private pendingInputTimestamp: number | null = null; // Capture INPUT timestamp when event fires, not when debounce completes
  private pendingCellReference: string | null = null; // Capture cell reference when input fires, not when debounce completes (fixes C→E bug)
  private isCapturingHeaders: boolean = false; // Flag to skip recording during header capture (prevents Name Box navigation from being recorded)
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
  // NOTE: Removed currentPageAnalysis and pageAnalysisPending to prevent zoom issues
  // NOTE: Removed initialFullPageSnapshot and initialSnapshotPromise
  // Snapshot-based header detection was unreliable - now using cell references as default variable names
  // private initialFullPageSnapshot: string | null = null;
  // private initialSnapshotPromise: Promise<void> | null = null;

  // Copy/Paste Intent Detection: Track COPY steps in session for PASTE matching
  private copyStepsInSession: Map<string, {
    stepId: string;
    text: string;           // Original text (preserved for execution)
    normalizedText: string; // Normalized for matching
    sourceSelector: string;
    timestamp: number;
    stepIndex: number;
  }> = new Map();

  // Deduplication for copy/paste events (we listen on both document and window)
  private lastCopyEventTime: number = 0;
  private lastPasteEventTime: number = 0;
  private readonly CLIPBOARD_EVENT_DEDUP_MS = 50; // Ignore same event within 50ms

  // Form audit: captures full form state on first field interaction
  private readonly formAuditor: FormAuditor;
  private formAuditAttached: boolean = false; // Track whether audit was attached to a step

  constructor() {
    // Initialize extracted modules
    this.elementFinder = new ElementFinder();
    this.stepEnricher = new StepEnricher({ enableReliableRecording: this.ENABLE_RELIABLE_RECORDING });
    this.stepPublisher = new StepPublisher(() => ({
      currentTabUrl: this.currentTabUrl,
      currentTabTitle: this.currentTabTitle,
      currentTabIndex: this.currentTabIndex,
    }));
    this.formAuditor = new FormAuditor();
  }

  /**
   * Start recording - attach event listeners
   */
  start(tabIndex?: number): void {
    if (this.isRecording) {
      console.warn('Recording already started');
      return;
    }

    this.isRecording = true;
    this.currentUrl = window.location.href;
    this.currentTabUrl = window.location.href;
    this.currentTabTitle = document.title;
    this.currentTabIndex = tabIndex !== undefined ? tabIndex : null;

    // Clear copy tracker for new recording session (intent detection)
    this.copyStepsInSession.clear();
    this.lastCopyEventTime = 0;
    this.lastPasteEventTime = 0;

    // Reset form auditor for new recording session
    this.formAuditor.reset();
    this.formAuditAttached = false;

    // Add visual indicator
    if (document.body) {
      document.body.setAttribute('data-ghostwriter-recording', 'true');
    }

    // NOTE: Disabled page type analysis during recording start to prevent zoom/flash
    // The page analysis captures a full page screenshot which zooms out on spreadsheets
    // console.log('🎨 GhostWriter: Skipping page type analysis to prevent zoom issues');

    // Snapshot capture disabled - using cell references as variable names instead
    // This is more reliable than trying to detect headers from screenshots
    // Users can rename variables in the UI after recording
    console.log('📸 GhostWriter: Snapshot-based header detection disabled (using cell references)');

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
    // Use capture phase (true) to catch events even if they're stopped from bubbling
    this.keyboardHandler = ((event: KeyboardEvent) => {
      this.handleKeyboard(event).catch((error) => {
        console.error('Error in keyboard handler:', error);
      });
    }) as (event: KeyboardEvent) => void;
    // Use capture phase on WINDOW (not document) to catch events even earlier
    // This is critical for apps like Google Sheets that prevent event bubbling
    window.addEventListener('keydown', this.keyboardHandler, true);
    
    console.log('GhostWriter: Keyboard listener registered on window with capture phase');

    // Setup focus handler to clear cache when focusing on a new element
    this.focusHandler = this.handleFocus.bind(this);
    document.addEventListener('focus', this.focusHandler, true); // Use capture phase

    // Setup mousedown handler to cache snapshots (Guardrail 3: Prevent race condition)
    this.mousedownHandler = this.handleMousedown.bind(this);
    document.addEventListener('mousedown', this.mousedownHandler, true); // Capture phase

    // Setup scroll handler - debounced to avoid too many events
    this.scrollHandler = this.handleScroll.bind(this);
    window.addEventListener('scroll', this.scrollHandler, true); // Capture phase for window scroll
    
    // 🎯 MODAL SCROLL FIX: Also listen for scroll events on scrollable elements (modals, dialogs, etc.)
    // Scroll events do NOT bubble, so window listener won't catch scrolls inside modal containers
    this.attachScrollListenersToScrollableElements();
    this.startScrollableMutationObserver();

    // Setup copy handler to track clipboard operations (Phase 6: Data lineage)
    // Use capture phase (true) to ensure we catch events even if page stops propagation
    // Wrap in async handler with proper error catching (like keyboard handler)
    this.copyHandler = ((event: ClipboardEvent) => {
      this.handleCopy(event).catch((error) => {
        console.error('📋 GhostWriter: Error in copy handler:', error);
      });
    }) as (event: ClipboardEvent) => void;
    document.addEventListener('copy', this.copyHandler, true);

    // Setup paste handler to track paste operations (for additional context)
    // Use capture phase (true) to ensure we catch events even if page stops propagation
    // Wrap in async handler with proper error catching (like keyboard handler)
    this.pasteHandler = ((event: ClipboardEvent) => {
      this.handlePaste(event).catch((error) => {
        console.error('📋 GhostWriter: Error in paste handler:', error);
      });
    }) as (event: ClipboardEvent) => void;
    document.addEventListener('paste', this.pasteHandler, true);

    // Setup double-click handler - capture phase for consistency
    this.dblclickHandler = ((event: MouseEvent) => {
      this.handleDoubleClick(event).catch((error) => {
        console.error('Error in double-click handler:', error);
      });
    }) as (event: MouseEvent) => void;
    document.addEventListener('dblclick', this.dblclickHandler, true);

    // Setup context menu (right-click) handler - capture phase
    this.contextmenuHandler = ((event: MouseEvent) => {
      this.handleRightClick(event).catch((error) => {
        console.error('Error in context menu handler:', error);
      });
    }) as (event: MouseEvent) => void;
    document.addEventListener('contextmenu', this.contextmenuHandler, true);

    // Setup drag-drop handlers
    this.dragstartHandler = ((event: DragEvent) => {
      this.handleDragStart(event);
    }) as (event: DragEvent) => void;
    document.addEventListener('dragstart', this.dragstartHandler, true);

    this.dropHandler = ((event: DragEvent) => {
      this.handleDrop(event).catch((error) => {
        console.error('Error in drop handler:', error);
      });
    }) as (event: DragEvent) => void;
    document.addEventListener('drop', this.dropHandler, true);

    // Setup hover handler - track significant hovers (e.g., triggering tooltips)
    this.mouseenterHandler = ((event: MouseEvent) => {
      this.handleMouseEnter(event);
    }) as (event: MouseEvent) => void;
    document.addEventListener('mouseenter', this.mouseenterHandler, true);

    console.log('Recording started - including double-click, right-click, drag-drop, and hover');
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
        // Pass lastInputValue AND pendingCellReference explicitly to prevent race conditions
        await this.captureInputValue(
          this.currentInputElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
          this.pendingInputTimestamp || Date.now(),
          null, // no beforeSignals
          this.lastInputValue, // CRITICAL: Pass cached value explicitly
          this.pendingCellReference || undefined // CRITICAL: Pass cached cell ref explicitly
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
      window.removeEventListener('keydown', this.keyboardHandler, true); // true = capture phase (matches addEventListener)
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
    
    // 🎯 MODAL SCROLL FIX: Clean up element scroll listeners and mutation observer
    this.stopScrollableTracking();

    if (this.copyHandler) {
      document.removeEventListener('copy', this.copyHandler, true);
      this.copyHandler = null;
    }

    if (this.pasteHandler) {
      document.removeEventListener('paste', this.pasteHandler, true);
      this.pasteHandler = null;
    }

    if (this.dblclickHandler) {
      document.removeEventListener('dblclick', this.dblclickHandler, true);
      this.dblclickHandler = null;
    }

    if (this.contextmenuHandler) {
      document.removeEventListener('contextmenu', this.contextmenuHandler, true);
      this.contextmenuHandler = null;
    }

    if (this.dragstartHandler) {
      document.removeEventListener('dragstart', this.dragstartHandler, true);
      this.dragstartHandler = null;
    }

    if (this.dropHandler) {
      document.removeEventListener('drop', this.dropHandler, true);
      this.dropHandler = null;
    }

    if (this.mouseenterHandler) {
      document.removeEventListener('mouseenter', this.mouseenterHandler, true);
      this.mouseenterHandler = null;
    }

    // Clear hover timer if pending
    if (this.hoverDebounceTimer !== null) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }

    // Clear pending drag source
    this.pendingDragSource = null;

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

    // 🎯 Detect if this is a dropdown/menu scroll (for MenuDetector replay)
    let isDropdownScroll = false;
    if (scrollContainer) {
      const role = scrollContainer.getAttribute('role');
      isDropdownScroll = role === 'listbox' || role === 'menu' || 
                        scrollContainer.closest('[role="listbox"], [role="menu"]') !== null;
      if (isDropdownScroll) {
        console.log('📜 GhostWriter: Detected DROPDOWN/MENU scroll (flush) - will use MenuDetector on replay');
      }
    }

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
          // 🎯 NEW: Flag for dropdown/menu scrolls (uses MenuDetector on replay)
          isDropdownScroll,
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
      tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
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
   * Capture initial full page snapshot for spreadsheet column header detection
   * DISABLED: Snapshot-based header detection was unreliable
   * Now using cell references as default variable names (users can rename in UI)
   */
  // private async captureInitialSnapshot(): Promise<void> {
  //   try {
  //     console.log('📸 GhostWriter: Capturing initial snapshot for column headers...');
  //     
  //     // Capture full page at current zoom level (don't zoom out to avoid flash)
  //     // The AI will analyze the entire page to read column headers
  //     const fullPageResult = await VisualSnapshotService.captureFullPage(0.7);
  //     const snapshot = fullPageResult?.screenshot;
  //     
  //     if (snapshot) {
  //       this.initialFullPageSnapshot = snapshot;
  //       console.log('📸 GhostWriter: Initial snapshot captured successfully:', {
  //         length: snapshot.length,
  //         sizeMB: (snapshot.length / 1024 / 1024).toFixed(2),
  //       });
  //     } else {
  //       console.warn('📸 GhostWriter: Failed to capture initial snapshot - snapshot is null');
  //     }
  //   } catch (error) {
  //     console.error('📸 GhostWriter: Error capturing initial snapshot:', error);
  //     // Don't throw - recording should continue even if snapshot fails
  //   }
  // }

  /**
   * Get the initial full page snapshot captured at recording start (synchronous version).
   * DISABLED: Snapshot-based header detection disabled for reliability
   * @deprecated Snapshot capture is disabled, returns null
   */
  getInitialFullPageSnapshot(): string | null {
    console.log('📸 GhostWriter: Snapshot capture disabled - using cell references for variables');
    return null;
  }

  /**
   * Get the initial full page snapshot captured at recording start (async version).
   * DISABLED: Snapshot-based header detection disabled for reliability
   * @deprecated Snapshot capture is disabled, returns null
   */
  async getInitialFullPageSnapshotAsync(): Promise<string | null> {
    console.log('📸 GhostWriter: Snapshot capture disabled - using cell references for variables');
    return null;
  }

  /**
   * Check if element is a list item or option (for dropdown/menu items)
   * Delegates to ElementFinder module
   */
  private isListItemOrOption(element: Element): boolean {
    return this.elementFinder.isListItemOrOption(element);
  }

  /**
   * Check if an element is an overlay (mask, backdrop, etc.)
   * Delegates to ElementFinder module
   */
  private isOverlayElement(element: Element): boolean {
    return this.elementFinder.isOverlayElement(element);
  }


  /**
   * Find the actual clickable element when clicking on an overlay (SYNCHRONOUS version)
   * Delegates to ElementFinder module
   */
  private findActualClickableElementSync(element: Element, event: MouseEvent, elementsAtPoint: Element[]): Element | null {
    return this.elementFinder.findActualClickableElementSync(element, event, elementsAtPoint);
  }

  /**
   * Get the actual element from an event (handles Shadow DOM)
   * Delegates to ElementFinder module
   */
  private getActualElement(event: Event): Element | null {
    return this.elementFinder.getActualElement(event);
  }

  /**
   * Find the scrollable container for an element
   * Delegates to ElementFinder module
   */
  private findScrollContainer(element: Element): HTMLElement | null {
    return this.elementFinder.findScrollContainer(element);
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
    
    // Skip recording during header capture (Name Box navigation)
    if (this.isCapturingHeaders) {
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

    // CRITICAL: Skip native <option> elements inside native <select>
    // Native SELECTs fire a 'change' event when selecting options, which is recorded as INPUT with decisionSpace
    // Recording the CLICK would create duplicate steps without the dropdown options
    if (actualElement.tagName === 'OPTION' && actualElement.closest('select')) {
      console.log('🔍 GhostWriter: Skipping CLICK on native <option> inside <select> - will be recorded via change event with dropdown options');
      return;
    }

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
          const container = MenuDetector.findParentMenu(target);
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
              document.querySelectorAll(UNIVERSAL_MENU_SELECTORS.join(', '))
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
            const dropdownContainer = MenuDetector.findParentMenu(target);
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
          // CRITICAL FIX: For dropdown options, wait a moment for dropdown to stabilize
          // Portal elements and dynamically rendered options may still be animating/rendering
          // This micro-delay ensures we capture accurate visibility state
          if (finalIsListItemOrOption) {
            console.log('GhostWriter: Dropdown option detected - waiting for dropdown to stabilize...');
            await new Promise(resolve => setTimeout(resolve, 50));
            console.log('GhostWriter: Dropdown stabilization wait complete, capturing element state');
          }
          
          // For dropdown options, use the permissive visibility check
          if (finalIsListItemOrOption) {
            const isVisiblePermissive = ElementStateCapture.isElementVisiblePermissive(target);
            elementState = {
              visible: isVisiblePermissive, // Use permissive check for dropdown options
              enabled: ElementStateCapture.captureElementState(target).enabled,
              readonly: ElementStateCapture.captureElementState(target).readonly,
              checked: ElementStateCapture.captureElementState(target).checked,
            };
            console.log('GhostWriter: Dropdown option visibility (permissive):', isVisiblePermissive);
          } else {
            elementState = ElementStateCapture.captureElementState(target);
          }
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
        // Use getCurrentFrameContext to properly detect if we're inside an iframe
        const { getCurrentFrameId } = await import('./content-script');
        const frameId = getCurrentFrameId();
        const iframeContext = IframeUtils.getCurrentFrameContext(frameId);

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
          
          // CRITICAL FIX: Generate container-scoped selectors for dropdown options
          // This ensures we can find the option within its specific dropdown, not globally
          if (finalIsListItemOrOption && context?.dropdownContainer) {
            console.log('🔍 GhostWriter: Generating container-scoped selectors for dropdown option');
            const dropdownInfo = context.dropdownContainer;
            const optionText = elementText || target.textContent?.trim() || '';
            const escapedText = optionText.replace(/'/g, "\\'").replace(/"/g, '\\"');
            
            // Generate highly specific container-scoped selectors
            const containerScopedSelectors: string[] = [];
            
            // Strategy 1: If dropdown has trigger label, use it for scoping
            // e.g., [aria-label="Merchant Category"] + [role="listbox"] [role="option"]:contains("Value")
            if (dropdownInfo.triggerLabel) {
              const escapedTriggerLabel = dropdownInfo.triggerLabel.replace(/'/g, "\\'").replace(/"/g, '\\"');
              // XPath: Find listbox associated with the trigger, then find option by text
              containerScopedSelectors.push(
                `//*[@aria-label='${escapedTriggerLabel}']//ancestor::*[contains(@class,'combobox') or @role='combobox']/following-sibling::*[@role='listbox']//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
              );
              // Simpler: Just find option with text in any visible listbox (most common pattern)
              containerScopedSelectors.push(
                `//*[@role='listbox']//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
              );
            }
            
            // Strategy 2: If dropdown container has aria-label, use it
            if (dropdownInfo.label) {
              const escapedLabel = dropdownInfo.label.replace(/'/g, "\\'").replace(/"/g, '\\"');
              containerScopedSelectors.push(
                `//*[@aria-label='${escapedLabel}']//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
              );
              containerScopedSelectors.push(
                `//*[@aria-label='${escapedLabel}']//li[contains(normalize-space(.),'${escapedText}')]`
              );
            }
            
            // Strategy 3: If dropdown container has ID, use it for precise scoping
            if (dropdownInfo.id) {
              containerScopedSelectors.push(
                `//*[@id='${dropdownInfo.id}']//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
              );
              containerScopedSelectors.push(
                `//*[@id='${dropdownInfo.id}']//li[contains(normalize-space(.),'${escapedText}')]`
              );
            }
            
            // Strategy 4: Use role-based container scoping (most reliable fallback)
            if (dropdownInfo.role === 'listbox' || dropdownInfo.role === 'menu') {
              containerScopedSelectors.push(
                `//*[@role='${dropdownInfo.role}']//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
              );
              containerScopedSelectors.push(
                `//*[@role='${dropdownInfo.role}']//li[contains(normalize-space(.),'${escapedText}')]`
              );
            }
            
            // Strategy 5: Generic option selector by text (last resort, but within visible menu)
            containerScopedSelectors.push(
              `//*[@role='option'][contains(normalize-space(.),'${escapedText}')]`
            );
            containerScopedSelectors.push(
              `//*[@role='menuitem'][contains(normalize-space(.),'${escapedText}')]`
            );
            
            // Prepend container-scoped selectors to fallbacks (highest priority)
            console.log(`🔍 GhostWriter: Generated ${containerScopedSelectors.length} container-scoped selectors for dropdown option "${optionText.substring(0, 30)}"`);
            enhancedFallbacks = [...containerScopedSelectors, ...enhancedFallbacks];
          }
          
          // CRITICAL FIX: Generate section-scoped selectors for ALL elements with a scope hint
          // This ensures we can disambiguate between identical elements in different sections
          // Works universally across all web frameworks (React, Angular, Vue, Salesforce, etc.)
          const sectionTitle = selectors.anchorText || finalContainerContext?.text;
          if (sectionTitle && !finalIsListItemOrOption) {
            console.log(`🔍 GhostWriter: Generating section-scoped selectors for section "${sectionTitle}"`);
            const escapedSectionTitle = sectionTitle.replace(/'/g, "\\'").replace(/"/g, '\\"');
            const sectionScopedSelectors: string[] = [];
            
            // Get element identifiers for scoping
            const ariaLabel = target.getAttribute('aria-label');
            const role = target.getAttribute('role');
            
            // Strategy 1: Section container + aria-label (most reliable, works universally)
            if (ariaLabel) {
              const escapedAriaLabel = ariaLabel.replace(/'/g, "\\'").replace(/"/g, '\\"');
              
              // Priority 1: Find section/card/panel containing the title, then find element by aria-label
              // This is the most robust pattern that works across frameworks
              sectionScopedSelectors.push(
                `//*[contains(normalize-space(.), '${escapedSectionTitle}')]/ancestor-or-self::*[contains(@class, 'section') or contains(@class, 'card') or contains(@class, 'panel') or contains(@class, 'form') or @role='region' or @role='group' or @role='form']//*[@aria-label='${escapedAriaLabel}']`
              );
              
              // Priority 2: Simpler - find any div containing the title, then find element
              // Works when section classes aren't present
              sectionScopedSelectors.push(
                `//div[descendant::*[contains(normalize-space(.), '${escapedSectionTitle}')]]//*[@aria-label='${escapedAriaLabel}']`
              );
              
              // Priority 3: Even simpler - any element containing title as ancestor
              sectionScopedSelectors.push(
                `//*[contains(normalize-space(.), '${escapedSectionTitle}')]//*[@aria-label='${escapedAriaLabel}']`
              );
            }
            
            // Strategy 2: Section header + role + aria-label (for comboboxes, buttons, etc.)
            if (role && ariaLabel) {
              const escapedAriaLabel = ariaLabel.replace(/'/g, "\\'").replace(/"/g, '\\"');
              sectionScopedSelectors.push(
                `//div[descendant::*[contains(normalize-space(.), '${escapedSectionTitle}')]]//*[@role='${role}'][@aria-label='${escapedAriaLabel}']`
              );
              // Also try with just role in case aria-label varies
              sectionScopedSelectors.push(
                `//*[contains(normalize-space(.), '${escapedSectionTitle}')]//*[@role='${role}'][contains(@aria-label, '${escapedAriaLabel.split(' ')[0]}')]`
              );
            }
            
            // Strategy 3: Section header + element text (fallback for elements without aria-label)
            const elementTextContent = elementText || target.textContent?.trim();
            if (elementTextContent && elementTextContent.length > 0 && elementTextContent.length < 50) {
              const escapedElementText = elementTextContent.replace(/'/g, "\\'").replace(/"/g, '\\"');
              sectionScopedSelectors.push(
                `//div[descendant::*[contains(normalize-space(.), '${escapedSectionTitle}')]]//*[contains(normalize-space(.), '${escapedElementText}')]`
              );
            }
            
            if (sectionScopedSelectors.length > 0) {
              console.log(`🔍 GhostWriter: Generated ${sectionScopedSelectors.length} section-scoped selectors for "${sectionTitle}"`);
              // Prepend section-scoped selectors (high priority, but after any dropdown-specific ones)
              enhancedFallbacks = [...sectionScopedSelectors, ...enhancedFallbacks];
            }
          }
          
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
          
          // CAPTURE DROPDOWN OPTIONS: Get all available options when selecting from a dropdown
          let dropdownOptions: string[] | undefined;
          
          if (shouldTreatAsDropdownItem) {
            try {
              console.log('📋 GhostWriter: Scanning for dropdown options...');
              
              // Find the parent dropdown menu/listbox that contains this option
              const dropdownContainer = MenuDetector.findParentMenu(target);
              
              if (dropdownContainer) {
                console.log('📋 GhostWriter: Found dropdown container:', dropdownContainer.tagName, dropdownContainer.className?.toString().substring(0, 50));
                
                // Scan for options ONLY within this specific dropdown container
                const options: string[] = [];
                const optionElements = dropdownContainer.querySelectorAll('[role="option"], li[role="presentation"]');
                
                console.log('📋 GhostWriter: Found', optionElements.length, 'option elements in container');
                
                optionElements.forEach(opt => {
                  const text = opt.textContent?.trim();
                  if (text && text.length > 0 && text.length < 200) {
                    options.push(text);
                  }
                });
                
                if (options.length > 0 && options.length < 100) { // Sanity check: max 100 options per dropdown
                  dropdownOptions = Array.from(new Set(options)); // Deduplicate
                  console.log(`📋 GhostWriter: Captured ${dropdownOptions.length} unique dropdown options:`, dropdownOptions.slice(0, 5));
                } else if (options.length >= 100) {
                  console.warn('📋 GhostWriter: Too many options detected (', options.length, '), likely capturing all page dropdowns - skipping');
                } else {
                  console.log('📋 GhostWriter: No valid options found');
                }
              } else {
                console.log('📋 GhostWriter: No dropdown container found for option');
              }
            } catch (optionErr) {
              console.warn('📋 GhostWriter: Error scanning dropdown options:', optionErr);
            }
            
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

          // UNIFIED INTERACTION DETECTION: Detect interaction type once
          const interactionType = InteractionDetector.detect(target, event, dropdownOptions);
          console.log('[RecordingManager] Detected interaction type:', interactionType);

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
            tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
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
            ...(() => {
              const scanned = ContextScanner.scan(target);
              console.log('📋 GhostWriter: Building context - dropdownOptions available:', !!dropdownOptions, 'count:', dropdownOptions?.length || 0);
              // ENHANCEMENT: Add captured dropdown options to decisionSpace
              if (dropdownOptions && dropdownOptions.length > 0) {
            if (!scanned.decisionSpace) {
              scanned.decisionSpace = {
                type: 'LIST_SELECTION',
                selectedText: elementText || '',
                selectedIndex: dropdownOptions.indexOf(elementText || '') !== -1 ? dropdownOptions.indexOf(elementText || '') : 0,
                options: dropdownOptions,
              };
            } else {
              scanned.decisionSpace.options = dropdownOptions;
              scanned.decisionSpace.selectedIndex = dropdownOptions.indexOf(elementText || '') !== -1 ? dropdownOptions.indexOf(elementText || '') : 0;
            }
                console.log('📋 GhostWriter: Added dropdown options to decisionSpace:', dropdownOptions.length);
              }
              return scanned;
            })(),
          } : (() => {
            const scanned = ContextScanner.scan(target);
            console.log('📋 GhostWriter: Building context (no context) - dropdownOptions available:', !!dropdownOptions, 'count:', dropdownOptions?.length || 0);
            // ENHANCEMENT: Add captured dropdown options to decisionSpace
            if (dropdownOptions && dropdownOptions.length > 0) {
              if (!scanned.decisionSpace) {
                scanned.decisionSpace = {
                  type: 'LIST_SELECTION',
                  selectedText: elementText || '',
                  selectedIndex: dropdownOptions.indexOf(elementText || '') !== -1 ? dropdownOptions.indexOf(elementText || '') : 0,
                  options: dropdownOptions,
                };
              } else {
                scanned.decisionSpace.options = dropdownOptions;
                scanned.decisionSpace.selectedIndex = dropdownOptions.indexOf(elementText || '') !== -1 ? dropdownOptions.indexOf(elementText || '') : 0;
              }
              console.log('📋 GhostWriter: Added dropdown options to decisionSpace (no context):', dropdownOptions.length);
            }
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
            // Unified Interaction Type Detection
            interactionType: interactionType,
          };

          // Enrich with reliable replayer data (LocatorBundle, Intent, Success Conditions)
          // CRITICAL: Use clickableElement (target), not actualElement!
          // actualElement might be an icon/SVG, but clickableElement is the button after traversal
          const reliableData = this.enrichStepWithReliableData(target, 'CLICK');
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

          // DISABLED: PageModel context capture during recording causes lag
          // AI analysis now runs AFTER recording stops (in App.tsx handleStopRecording)
          // The post-recording analyzer provides richer analysis without impacting recording performance
          //
          // try {
          //   const pageModelContext = await this.enrichStepWithPageModelContext(target, 'CLICK');
          //   if (pageModelContext) {
          //     stepPayload.pageModelContext = pageModelContext;
          //   }
          // } catch (error) {
          //   console.warn('GhostWriter: Failed to capture PageModel context:', error);
          // }

          // Form Audit: generate completion diff on submit
          // Detect submit by intent OR element characteristics (type="submit", Save/Submit button text)
          const isSubmitIntent = stepPayload.intent?.kind === 'SUBMIT_FORM';
          const isSubmitElement = (target as HTMLButtonElement).type === 'submit' ||
            target.closest('button[type="submit"], input[type="submit"]') !== null;
          const submitText = (elementText || '').toLowerCase();
          const isSubmitText = /\b(submit|save|create|send|confirm|apply|update|next|finish|done|complete)\b/.test(submitText);
          if ((isSubmitIntent || isSubmitElement || isSubmitText) && this.formAuditor.getAudit()) {
            const diff = this.formAuditor.generateCompletionDiff();
            if (diff) {
              stepPayload.formCompletionDiff = diff;
              console.log(`[FormAuditor] Attached completion diff to submit step: ${diff.filledFields.length} filled, ${diff.skippedFields.length} skipped`);
            }
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
          console.log('GhostWriter: Step details:', {
            elementText: elementText || '(none)',
            role: target.getAttribute('role'),
            ariaLabel: target.getAttribute('aria-label'),
            isInShadowDOM: ShadowDOMUtils.isInShadowDOM(target),
            scope: stepPayload.scope,
            isListItem: finalIsListItemOrOption,
          });
          console.log('📋 GhostWriter: Final step check before sending - has decisionSpace:', !!stepPayload.context?.decisionSpace, 'has options:', !!stepPayload.context?.decisionSpace?.options, 'count:', stepPayload.context?.decisionSpace?.options?.length || 0);
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
            // Reset form auditor on navigation (new page = new form)
            this.formAuditor.reset();
            this.formAuditAttached = false;
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
    
    // CRITICAL: Skip recording during header capture
    // The header capture types into the Name Box, which would be recorded as user input
    if (this.isCapturingHeaders) {
      return;
    }

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

      // Form Audit: track form field interaction
      this.formAuditor.onFormFieldInteraction(target);

      // ============================================
      // CRITICAL FIX: Flush previous element's input BEFORE updating state
      // This prevents losing values when user rapidly types across cells
      // Must happen BEFORE we update lastInputValue and currentInputElement!
      // ============================================
      
      // For spreadsheets, check if cell reference changed (not just element, since sheets reuse same editor)
      // Use robust Name Box detection with fallback selectors (same strategy as ContextScanner)
      let currentCellRef: string | null = null;
      if (VisualSnapshotService.isSpreadsheetDomain()) {
        // Try multiple Name Box selectors (Google Sheets may change their DOM structure)
        const nameBoxSelectors = [
          '#t-name-box', // Most common (Google Sheets)
          '#t-name-box-input', // Alternative (some Google Sheets versions)
          '[id*="name-box"]', // Partial match fallback
        ];
        
        for (const selector of nameBoxSelectors) {
          try {
            const nameBox = document.querySelector(selector) as HTMLInputElement;
            if (nameBox && nameBox.value && /^[A-Z]+\d+$/i.test(nameBox.value)) {
              currentCellRef = nameBox.value.toUpperCase();
              break; // Found it, stop searching
            }
          } catch (e) {
            // Invalid selector or DOM access error, try next
            continue;
          }
        }
      }
      
      const elementChanged = this.currentInputElement && this.currentInputElement !== target;
      const cellChanged = currentCellRef && this.pendingCellReference && currentCellRef !== this.pendingCellReference;
      const shouldFlush = this.inputDebounceTimer !== null && (elementChanged || cellChanged);
      
      if (shouldFlush) {
        console.log('📊 GhostWriter: User switched cells - flushing previous input before starting new timer', {
          elementChanged,
          cellChanged,
          previousCell: this.pendingCellReference,
          currentCell: currentCellRef,
        });
        clearTimeout(this.inputDebounceTimer!); // Non-null assertion: shouldFlush guarantees this is not null
        this.inputDebounceTimer = null;
        
        // The previous element data is still in the instance variables (not yet overwritten)
        const previousElement = this.currentInputElement;
        const previousTimestamp = this.pendingInputTimestamp;
        const previousValue = this.lastInputValue;
        const previousCellRef = this.pendingCellReference; // Save before clearing
        
        // Flush the previous input synchronously
        // Pass previousCellRef explicitly to prevent Name Box race condition
        // (Name Box is already updated to NEW cell by the time flush runs)
        if (previousValue && previousElement) {
          console.log('📊 GhostWriter: Flushing previous cell input:', { previousValue, cellRef: previousCellRef });
          this.captureInputValue(
            previousElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement,
            previousTimestamp || Date.now(),
            null, // no beforeSignals
            previousValue, // CRITICAL: Pass explicit value so it doesn't get overwritten
            previousCellRef || undefined // CRITICAL: Pass explicit cell ref (Name Box is already updated!)
          );
        }
        
        // Clear the previous state AFTER flushing
        this.pendingCellReference = null;
        this.pendingInputTimestamp = null;
      } else if (this.inputDebounceTimer !== null) {
        // Same element AND same cell - just clear the timer to restart debounce
        clearTimeout(this.inputDebounceTimer);
      }

      // ============================================
      // NOW update state for the current element
      // ============================================
      
      // CACHE VALUE: Store the current value in memory (critical for Google Sheets)
      // This ensures we have the value even if Google Sheets clears the DOM on blur
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

      // Store the input timestamp for when the debounced handler runs
      this.pendingInputTimestamp = inputTimestamp;
      
      // CRITICAL: Capture cell reference SYNCHRONOUSLY for Google Sheets
      // This prevents the C→E bug where clicking away updates the Name Box before we capture
      // Reuse the currentCellRef we already captured above (no need to read DOM again)
      if (VisualSnapshotService.isSpreadsheetDomain() && currentCellRef) {
        this.pendingCellReference = currentCellRef;
        console.log('📊 GhostWriter: Captured cell reference at input time:', this.pendingCellReference);
      }

      // Set new timer for current element
      this.inputDebounceTimer = window.setTimeout(() => {
        // Don't capture if recording was stopped
        if (!this.isRecording) return;
        
        // CRITICAL: Pass pending cell ref explicitly (captured at input time)
        // Don't rely on reading Name Box later (it might have changed)
        const cellRefToUse = this.pendingCellReference || undefined;
        
        this.captureInputValue(
          target as HTMLInputElement | HTMLTextAreaElement | HTMLElement, 
          this.pendingInputTimestamp!,
          null, // no beforeSignals
          undefined, // no fallbackValue
          cellRefToUse // Pass cell ref captured at input time
        );
        this.pendingInputTimestamp = null; // Clear after use
        this.pendingCellReference = null; // Clear after use
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

      // Form Audit: track form field interaction
      this.formAuditor.onFormFieldInteraction(target);

      // Debug logging for SELECT elements
      console.log(`[GhostWriter] 🔄 Change event on ${target.tagName}, type: ${(target as HTMLSelectElement).type}, value: ${target.value?.substring(0, 30)}`);
      if (target.tagName === 'SELECT') {
        console.log(`[GhostWriter] 📋 SELECT change detected - will record as INPUT with type: ${(target as HTMLSelectElement).type}`);
      }

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

    // Check for copy/paste shortcuts (check both lowercase and uppercase, as some browsers/apps send uppercase with modifiers)
    const isCopy = (event.key.toLowerCase() === 'c' || event.code === 'KeyC') && 
                   (event.ctrlKey || event.metaKey) &&
                   !event.shiftKey && !event.altKey; // Only pure Ctrl+C/Cmd+C
    const isPaste = (event.key.toLowerCase() === 'v' || event.code === 'KeyV') && 
                    (event.ctrlKey || event.metaKey) &&
                    !event.shiftKey && !event.altKey; // Only pure Ctrl+V/Cmd+V
    
    // Copy/paste shortcuts are handled by dedicated copy/paste handlers
    // Skip creating KEYBOARD steps for these - the COPY/PASTE steps will be created instead
    if (isCopy || isPaste) {
      console.log('⌨️ GhostWriter: Copy/paste shortcut detected - letting copy/paste handler create step');
      return;
    }

    // Only capture specific important keys
    const importantKeys = ['Enter', 'Tab', 'Escape'];
    const isImportantKey = importantKeys.includes(event.key);

    if (!isImportantKey) {
      return;
    }

    // Don't capture if user is typing in an input (that's handled by input handler)
    // EXCEPTION: Allow Enter in inputs (for form submission)
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
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
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
        
        // 🎯 Detect if this is a dropdown/menu scroll (for MenuDetector replay)
        let isDropdownScroll = false;
        if (scrollContainer) {
          const role = scrollContainer.getAttribute('role');
          isDropdownScroll = role === 'listbox' || role === 'menu' || 
                            scrollContainer.closest('[role="listbox"], [role="menu"]') !== null;
          if (isDropdownScroll) {
            console.log('📜 GhostWriter: Detected DROPDOWN/MENU scroll - will use MenuDetector on replay');
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
              // 🎯 NEW: Flag for dropdown/menu scrolls (uses MenuDetector on replay)
              isDropdownScroll,
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
          tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
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
   * 🎯 MODAL & DROPDOWN SCROLL FIX: Find and attach scroll listeners to scrollable elements
   * This captures scrolls inside modals, dialogs, dropdowns, and other scrollable containers
   */
  private attachScrollListenersToScrollableElements(): void {
    const scrollableSelectors = [
      // Modals and dialogs
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.modal',
      '[class*="Modal"]',
      '[class*="modal"]',
      '[class*="dialog"]',
      '[class*="Dialog"]',
      '[class*="popup"]',
      '[class*="Popup"]',
      // Dropdowns and menus - CRITICAL for capturing dropdown scrolls!
      '[role="listbox"]',
      '[role="menu"]',
      '[role="menubar"]',
      '[role="combobox"]',
      '[class*="dropdown"]',
      '[class*="Dropdown"]',
      '[class*="select"]',
      '[class*="Select"]',
      '[class*="listbox"]',
      '[class*="Listbox"]',
      '[class*="menu"]',
      '[class*="Menu"]',
      // MUI/Ant/Chakra specific
      '.MuiMenu-list',
      '.MuiAutocomplete-listbox',
      '.ant-select-dropdown',
      '.ant-dropdown-menu',
      '.chakra-menu__menu-list',
    ];

    for (const selector of scrollableSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          this.attachScrollListenerToElement(element);
        }
      } catch {
        // Selector might be invalid
      }
    }

    // Check for any element with scrollable overflow
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      const style = window.getComputedStyle(element);
      const isScrollable = (style.overflow === 'auto' || style.overflow === 'scroll' || 
                           style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                           element.scrollHeight > element.clientHeight + 50;
      
      if (isScrollable && !this.elementScrollListeners.has(element)) {
        this.attachScrollListenerToElement(element);
      }
    }

    console.log(`📜 GhostWriter: Attached scroll listeners to ${this.elementScrollListeners.size} scrollable elements`);
  }

  private attachScrollListenerToElement(element: Element): void {
    if (this.elementScrollListeners.has(element)) {
      return;
    }

    const listener = (event: Event) => {
      if (!this.isRecording) return;
      this.handleScroll(event);
    };

    element.addEventListener('scroll', listener, { passive: true });
    this.elementScrollListeners.set(element, listener);
  }

  private startScrollableMutationObserver(): void {
    if (this.scrollableMutationObserver) {
      return;
    }

    this.scrollableMutationObserver = new MutationObserver((mutations) => {
      if (!this.isRecording) return;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              this.checkAndAttachScrollListener(node);
              const children = node.querySelectorAll('*');
              for (const child of children) {
                this.checkAndAttachScrollListener(child);
              }
            }
          }
        }
      }
    });

    this.scrollableMutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log('📜 GhostWriter: Started MutationObserver for new scrollable elements');
  }

  private checkAndAttachScrollListener(element: Element): void {
    const style = window.getComputedStyle(element);
    const role = element.getAttribute('role');
    const className = element.className?.toString() || '';

    // Check for modals/dialogs
    const isModalType = role === 'dialog' || element.getAttribute('aria-modal') === 'true' ||
                       className.includes('modal') || className.includes('Modal') ||
                       className.includes('dialog') || className.includes('Dialog');

    // Check for dropdowns/menus - CRITICAL for capturing dropdown scrolls!
    const isDropdownType = role === 'listbox' || role === 'menu' || role === 'menubar' ||
                          className.includes('dropdown') || className.includes('Dropdown') ||
                          className.includes('listbox') || className.includes('Listbox') ||
                          className.includes('menu') || className.includes('Menu') ||
                          className.includes('select') || className.includes('Select') ||
                          className.includes('MuiMenu') || className.includes('ant-select') ||
                          className.includes('ant-dropdown');

    // Check if element is scrollable
    const isScrollable = (style.overflow === 'auto' || style.overflow === 'scroll' || 
                         style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                         element.scrollHeight > element.clientHeight + 10; // Lower threshold for dropdowns

    if ((isModalType || isDropdownType || isScrollable) && !this.elementScrollListeners.has(element)) {
      this.attachScrollListenerToElement(element);
      const typeLabel = isDropdownType ? 'dropdown' : isModalType ? 'modal' : 'scrollable';
      console.log(`📜 GhostWriter: Attached scroll listener to new ${typeLabel}: ${element.tagName}.${className.split(' ')[0]}`);
    }
  }

  private stopScrollableTracking(): void {
    if (this.scrollableMutationObserver) {
      this.scrollableMutationObserver.disconnect();
      this.scrollableMutationObserver = null;
    }

    for (const [element, listener] of this.elementScrollListeners) {
      element.removeEventListener('scroll', listener);
    }
    this.elementScrollListeners.clear();

    console.log('📜 GhostWriter: Stopped scrollable element tracking');
  }

  /**
   * Handle copy events - creates COPY workflow step
   */
  private async handleCopy(_event: ClipboardEvent): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    // Deduplication: Ignore duplicate events
    const now = Date.now();
    if (now - this.lastCopyEventTime < this.CLIPBOARD_EVENT_DEDUP_MS) {
      return;
    }
    this.lastCopyEventTime = now;

    console.log('📋 GhostWriter: Processing copy event');

    try {
      let selectedText: string | undefined;
      let actualElement: Element | null = null;
      let selectionRange: { start: number; end: number } | undefined;
      let selectAll = false;

      // Try multiple methods to get the copied text
      // Method 1: Get from clipboardData (most reliable)
      const clipboardText = _event.clipboardData?.getData('text/plain');

      // Method 2: Check if active element is input/textarea
      const activeElement = document.activeElement;

      if (activeElement &&
          (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        const inputElement = activeElement as HTMLInputElement | HTMLTextAreaElement;
        const selectionStart = inputElement.selectionStart || 0;
        const selectionEnd = inputElement.selectionEnd || 0;

        if (selectionStart !== selectionEnd) {
          selectedText = inputElement.value.substring(selectionStart, selectionEnd);
          actualElement = activeElement as Element;

          // Check if entire content was selected
          if (selectionStart === 0 && selectionEnd === inputElement.value.length) {
            selectAll = true;
          } else {
            selectionRange = { start: selectionStart, end: selectionEnd };
          }
        } else {
          // No selection in input - try clipboardData
          if (clipboardText) {
            selectedText = clipboardText;
            actualElement = activeElement as Element;
            selectAll = true;
          }
        }
      }

      // Fallback to window.getSelection() if not from input/textarea
      if (!selectedText || selectedText.trim().length === 0) {
        const selection = window.getSelection();
        selectedText = selection?.toString();

        // If still no text, try clipboardData as final fallback
        if ((!selectedText || selectedText.trim().length === 0) && clipboardText) {
          selectedText = clipboardText;
          actualElement = _event.target as Element;
          selectAll = true;
        }

        // GOOGLE SHEETS FALLBACK: If still no text, try navigator.clipboard.readText()
        // Google Sheets and similar apps use custom clipboard handling that doesn't populate standard APIs
        if (!selectedText || selectedText.trim().length === 0) {
          try {
            // Small delay to let the clipboard be populated
            await new Promise(resolve => setTimeout(resolve, 50));
            const clipboardApiText = await navigator.clipboard.readText();
            if (clipboardApiText && clipboardApiText.trim().length > 0) {
              selectedText = clipboardApiText;
              actualElement = _event.target as Element || activeElement as Element;
              selectAll = true;
            }
          } catch {
            // Clipboard API failed - will abort below
          }
        }

        if (!selectedText || selectedText.trim().length === 0) {
          return; // Nothing to copy
        }

        // Get the source element (where the copy happened)
        if (!actualElement) {
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const sourceElement = range.commonAncestorContainer;

            // Get actual element (text nodes don't have methods we need)
            actualElement = sourceElement.nodeType === Node.TEXT_NODE
              ? sourceElement.parentElement
              : sourceElement as Element;
          } else {
            // Use event target as fallback
            actualElement = _event.target as Element;
          }
        }

        // For non-input elements, we typically select all visible text
        selectAll = true;
      }

      if (!actualElement) {
        return;
      }

      // Generate selector for source element
      const selectors = SelectorEngine.generateSelectors(actualElement);

      // Store to chrome.storage.local for CROSS-TAB paste matching
      // This is critical because each tab has its own content script instance
      const normalizedForStorage = this.normalizeClipboardText(selectedText);
      const clipboardData = {
        text: selectedText,
        normalizedText: normalizedForStorage,
        sourceSelector: selectors.primary,
        timestamp: Date.now(),
        url: window.location.href
      };

      chrome.storage.local.set({ ghostwriter_clipboard: clipboardData });

      // Create COPY workflow step
      const stepTimestamp = Date.now();

      // For spreadsheets, capture the active cell reference for reliable replay
      let spreadsheetCellRef: string | undefined;
      if (SheetStateExtractor.isSpreadsheetDomain()) {
        try {
          const sheetState = await SheetStateExtractor.extract();
          spreadsheetCellRef = sheetState?.activeCell?.reference;
          console.log('📋 GhostWriter: COPY on spreadsheet - captured cell ref:', spreadsheetCellRef);
        } catch (e) {
          console.warn('📋 GhostWriter: Failed to capture spreadsheet cell ref for COPY:', e);
        }
      }

      const stepPayload: WorkflowStep['payload'] = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
        xpath: selectors.xpath,
        timestamp: stepTimestamp,
        url: window.location.href,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
        tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
        shadowPath: selectors.shadowPath,
        elementText: actualElement.textContent?.substring(0, 100) || undefined,
        clipboardDetails: {
          text: selectedText,
          sourceSelector: selectors.primary,
          selectAll,
          selectionRange,
          cellRef: spreadsheetCellRef, // For spreadsheet COPY - cell reference for reliable replay
        },
      };

      // Capture visual snapshot
      try {
        const visuals = await VisualSnapshotService.capture(actualElement);
        if (visuals) {
          const rect = actualElement.getBoundingClientRect();
          stepPayload.visualSnapshot = {
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
        }
      } catch (snapshotError) {
        console.warn('📸 GhostWriter: Failed to capture snapshot for copy event:', snapshotError);
      }

      // Enrich with reliable replayer data
      const reliableData = this.enrichStepWithReliableData(actualElement, 'COPY');
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
      }

      const step: WorkflowStep = {
        type: 'COPY',
        payload: stepPayload,
        description: `Copy "${selectedText.substring(0, 30)}${selectedText.length > 30 ? '...' : ''}"`,
      };

      this.sendStep(step);
      this.lastStep = step;

      // Track COPY for intent detection when PASTE happens
      const normalizedText = this.normalizeClipboardText(selectedText);
      this.copyStepsInSession.set(normalizedText, {
        stepId: `${stepTimestamp}`,
        text: selectedText,
        normalizedText,
        sourceSelector: selectors.primary,
        timestamp: stepTimestamp,
        stepIndex: this.copyStepsInSession.size, // Approximate index
      });

      console.log('📋 GhostWriter: COPY step created');
    } catch (error) {
      console.warn('GhostWriter: Failed to handle copy event:', error);
    }
  }

  /**
   * Handle paste events with INTENT DETECTION:
   * - If pasted text matches a COPY in this session → Create linked PASTE step (data transfer)
   * - If no matching COPY → Create INPUT step with isExternalPaste flag (variable)
   */
  private async handlePaste(_event: ClipboardEvent): Promise<void> {
    if (!this.isRecording) {
      return;
    }

    // Deduplication: Ignore duplicate events
    const now = Date.now();
    if (now - this.lastPasteEventTime < this.CLIPBOARD_EVENT_DEDUP_MS) {
      return;
    }
    this.lastPasteEventTime = now;

    try {
      // Get the target element where paste is happening
      const target = _event.target as HTMLElement;

      if (!target) {
        return;
      }

      // Try to get clipboard data from the event
      const pastedText = _event.clipboardData?.getData('text/plain');

      if (!pastedText || pastedText.trim().length === 0) {
        return;
      }

      console.log('📋 GhostWriter: Processing paste event');

      // Generate selector for target element
      const selectors = SelectorEngine.generateSelectors(target);

      // INTENT DETECTION: Check if this paste matches a COPY from this session (cross-tab aware)
      const matchingCopy = await this.findMatchingCopy(pastedText);
      const stepTimestamp = Date.now();

      if (matchingCopy) {
        // DATA TRANSFER: Linked COPY+PASTE pair (user copied from within recording session)

        const stepPayload: WorkflowStep['payload'] = {
          selector: selectors.primary,
          fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
          xpath: selectors.xpath,
          timestamp: stepTimestamp,
          url: window.location.href,
          tabUrl: this.currentTabUrl || undefined,
          tabTitle: this.currentTabTitle || undefined,
          tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
          tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
          shadowPath: selectors.shadowPath,
          label: target.getAttribute('aria-label') || target.getAttribute('placeholder') || undefined,
          value: pastedText,
          clipboardDetails: {
            text: pastedText,
            linkedCopyStepId: matchingCopy.stepId,
            linkedCopyStepIndex: matchingCopy.stepIndex,
            isExternalPaste: false,
          },
        };

        // Capture visual snapshot
        await this.captureVisualSnapshotForStep(target, stepPayload);

        // Enrich with reliable replayer data
        const reliableData = this.enrichStepWithReliableData(target, 'PASTE');
        if (reliableData) {
          stepPayload.locatorBundle = reliableData.locatorBundle;
          stepPayload.intent = reliableData.intent;
          stepPayload.scope = reliableData.locatorBundle.scope;
          stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
        }

        const step: WorkflowStep = {
          type: 'PASTE',
          payload: stepPayload,
          description: `Paste "${pastedText.substring(0, 30)}${pastedText.length > 30 ? '...' : ''}" (from copied data)`,
        };

        this.sendStep(step);
        this.lastStep = step;
        console.log('📋 GhostWriter: PASTE step created (linked to COPY)');

      } else {
        // EXTERNAL PASTE: Convert to INPUT with variable hint (user pasted from external source)

        const stepPayload: WorkflowStep['payload'] = {
          selector: selectors.primary,
          fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
          xpath: selectors.xpath,
          timestamp: stepTimestamp,
          url: window.location.href,
          tabUrl: this.currentTabUrl || undefined,
          tabTitle: this.currentTabTitle || undefined,
          tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
          tabInfo: this.currentTabUrl ? { url: this.currentTabUrl, title: this.currentTabTitle || '' } : undefined,
          shadowPath: selectors.shadowPath,
          label: target.getAttribute('aria-label') || target.getAttribute('placeholder') || undefined,
          value: pastedText,
          // Mark as external paste for variable detection
          clipboardDetails: {
            text: pastedText,
            isExternalPaste: true,
          },
          // Add input details for proper variable detection
          inputDetails: {
            type: (target as HTMLInputElement).type || 'text',
            required: (target as HTMLInputElement).required,
          },
        };

        // Capture visual snapshot
        await this.captureVisualSnapshotForStep(target, stepPayload);

        // Enrich with reliable replayer data (as INPUT, not PASTE)
        const reliableData = this.enrichStepWithReliableData(target, 'INPUT');
        if (reliableData) {
          stepPayload.locatorBundle = reliableData.locatorBundle;
          stepPayload.intent = reliableData.intent;
          stepPayload.scope = reliableData.locatorBundle.scope;
          stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
        }

        const step: WorkflowStep = {
          type: 'INPUT',  // NOT PASTE - treat as variable input
          payload: stepPayload,
          description: `Enter "${pastedText.substring(0, 30)}${pastedText.length > 30 ? '...' : ''}" (example value)`,
        };

        this.sendStep(step);
        this.lastStep = step;
        console.log('📋 GhostWriter: INPUT step created from external paste (will be variable)');
      }
    } catch (error) {
      console.warn('GhostWriter: Failed to handle paste event:', error);
    }
  }

  /**
   * Helper to capture visual snapshot for a step payload
   */
  private async captureVisualSnapshotForStep(
    target: HTMLElement,
    stepPayload: WorkflowStepPayload
  ): Promise<void> {
    try {
      const visuals = await VisualSnapshotService.capture(target);
      if (visuals) {
        const rect = target.getBoundingClientRect();
        stepPayload.visualSnapshot = {
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
      }
    } catch (snapshotError) {
      console.warn('📸 GhostWriter: Failed to capture snapshot:', snapshotError);
    }
  }

  /**
   * Capture the final value of an input element
   * @param element The input element
   * @param captureTimestamp The timestamp when the input event first fired (not when debounce completed)
   * @param beforeSignals Optional before signals for outcome diffing
   * @param fallbackValue Optional explicit value to use (for flush scenarios where cached value might be stale)
   * @param explicitCellRef Optional explicit cell reference (for flush scenarios where Name Box has already been updated)
   */
  private async captureInputValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement,
    captureTimestamp: number,
    beforeSignals?: ReturnType<typeof capturePageSignals> | null,
    fallbackValue?: string,
    explicitCellRef?: string
  ): Promise<void> {
    try {
      // Check if element is contenteditable
      const isContentEditable = (element as HTMLElement).isContentEditable || 
                                element.getAttribute('contenteditable') === 'true';
      
      const selectors = SelectorEngine.generateSelectors(element, undefined);
      
      // Use enhanced label finder with confidence scoring
      const labelResult = LabelFinder.findLabelWithConfidence(element as HTMLElement);
      const label = labelResult.label !== 'Unknown Field' ? labelResult.label : null;
      console.log(`[RecordingManager] Label extracted for INPUT step:`, { 
        label, 
        confidence: labelResult.confidence, 
        source: labelResult.source,
        elementTag: element.tagName, 
        elementClass: element.className?.toString().substring(0, 50), 
        ariaLabel: element.getAttribute('aria-label')?.substring(0, 50),
        needsAIEnhancement: LabelFinder.needsAIEnhancement(labelResult)
      });
      
      // Extract value: for contenteditable, use textContent/innerText; for standard inputs, use value
      let value: string;
      if (isContentEditable) {
        value = (element as HTMLElement).textContent?.trim() || 
                (element as HTMLElement).innerText?.trim() || '';
        
        // RECOVERY STRATEGY: If DOM is empty but we have cached value, use cache
        // This fixes the Google Sheets bug where contenteditable clears on blur/Enter
        // Prefer explicit fallbackValue (from flush) over this.lastInputValue (which may be stale)
        if (!value) {
          const cachedValue = fallbackValue !== undefined ? fallbackValue : this.lastInputValue;
          if (cachedValue) {
            console.log('GhostWriter: Recovering value from cache:', cachedValue);
            value = cachedValue;
          }
        }
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        value = element.value || (element as HTMLInputElement).checked?.toString() || '';
        
        // RECOVERY STRATEGY: For standard inputs too (less common but safe)
        if (!value) {
          const cachedValue = fallbackValue !== undefined ? fallbackValue : this.lastInputValue;
          if (cachedValue) {
            console.log('GhostWriter: Recovering value from cache:', cachedValue);
            value = cachedValue;
          }
        }
      } else {
        // Custom web components (Salesforce Lightning, etc.)
        // Try to find the actual input element inside the custom component
        console.log('GhostWriter: Element is not a standard input, checking for custom component:', element.tagName);
        
        // Salesforce picklist special handling
        const isSalesforcePicklist = element.tagName === 'RECORDS-RECORD-PICKLIST' ||
                                     element.tagName === 'LIGHTNING-PICKLIST' ||
                                     element.tagName === 'LIGHTNING-COMBOBOX';
        
        if (isSalesforcePicklist) {
          console.log('GhostWriter: Detected Salesforce picklist, extracting value...');
          console.log('GhostWriter: Cached lastInputValue:', this.lastInputValue?.substring(0, 30));
          console.log('GhostWriter: Fallback value:', fallbackValue?.substring(0, 30));
          
          // CRITICAL: For Salesforce picklists, ALWAYS use cached value first
          // The picklist component updates asynchronously, so the value might not be in the DOM yet
          value = fallbackValue !== undefined ? fallbackValue : (this.lastInputValue || '');
          
          // If we have cached value, use it
          if (value) {
            console.log('GhostWriter: ✅ Using cached value for Salesforce picklist:', value.substring(0, 30));
          } else {
            // Try to extract from DOM as fallback
            // Strategy 1: Check for data-value attribute
            value = element.getAttribute('data-value') || 
                    element.getAttribute('value') ||
                    '';
            
            // Strategy 2: Check shadowRoot for input
            if (!value && (element as any).shadowRoot) {
              const shadowInput = (element as any).shadowRoot.querySelector('input, select, [role="combobox"], [role="textbox"]');
              if (shadowInput) {
                value = shadowInput.value || 
                       shadowInput.getAttribute('value') || 
                       shadowInput.textContent?.trim() || '';
                console.log('GhostWriter: Extracted from shadowRoot input:', value.substring(0, 30));
              }
            }
            
            // Strategy 3: Check regular DOM
            if (!value) {
              const domInput = element.querySelector('input, select, [role="combobox"], [role="textbox"]');
              if (domInput) {
                value = (domInput as HTMLInputElement).value || 
                       domInput.getAttribute('value') ||
                       domInput.textContent?.trim() || '';
                console.log('GhostWriter: Extracted from DOM input:', value.substring(0, 30));
              }
            }
            
            console.log('GhostWriter: Final picklist value:', value || '(empty)');
          }
        } else {
          // Generic custom component handling
          // Try to find input inside custom element (Shadow DOM or regular)
          let actualInput: HTMLInputElement | HTMLTextAreaElement | null = null;
          
          // Check if element has shadowRoot
          if ((element as any).shadowRoot) {
            actualInput = (element as any).shadowRoot.querySelector('input, textarea');
            console.log('GhostWriter: Found input in shadowRoot:', !!actualInput);
          }
          
          // If not in shadowRoot, check in regular DOM
          if (!actualInput) {
            actualInput = element.querySelector('input, textarea');
            console.log('GhostWriter: Found input in regular DOM:', !!actualInput);
          }
          
          // Extract value from the actual input
          if (actualInput) {
            value = actualInput.value || '';
            console.log('GhostWriter: Extracted value from nested input:', value.substring(0, 30));
          } else {
            // Last resort: use cached value if available
            value = fallbackValue !== undefined ? fallbackValue : (this.lastInputValue || '');
            console.log('GhostWriter: No input found, using fallback value:', value.substring(0, 30));
          }
        }
      }
      
      const url = window.location.href;

      // Deduplicate: Skip if this is the same input with the same value as the last recorded step
      if (this.lastInputStep && 
          this.lastInputStep.selector === selectors.primary && 
          this.lastInputStep.value === value) {
        return; // Skip duplicate input
      }
      
      // ============================================================================
      // 📊 SPREADSHEET DEDUPLICATION: Skip if typing in same cell as last step
      // This handles slow typing, corrections, and incremental edits
      // Only record the FINAL value when user moves to a different cell
      // ============================================================================
      const isSpreadsheet = url.includes('docs.google.com/spreadsheets') || 
                           url.includes('excel.office.com');
      
      if (isSpreadsheet && label && this.lastStep) {
        // Check if the last step was also an INPUT to the same cell
        if (this.lastStep.type === 'INPUT' && 
            isWorkflowStepPayload(this.lastStep.payload) &&
            this.lastStep.payload.label === label) {
          
          console.log(`📊 [Recording] Skipping duplicate INPUT for cell "${label}" (intermediate typing)`);
          console.log(`📊 [Recording] Previous value: "${this.lastStep.payload.value}"`);
          console.log(`📊 [Recording] Current value: "${value}" (will be recorded when cell changes)`);
          
          // Skip this step entirely - don't record intermediate typing
          return;
        }
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
      
      // NEW: Generate semantic fallback selectors for labeled form fields (Salesforce, etc.)
      // This enables faster element location by using the field's label
      if (label && label.length > 0 && label.length < 50) {
        const cleanLabel = label.replace(/\*/g, '').trim(); // Remove asterisks from required fields
        const elementRole = element.getAttribute('role') || '';
        
        // Create semantic selectors based on the clean label
        const labelBasedSelectors: string[] = [];
        
        // Primary strategies: aria-label based (most reliable)
        if (cleanLabel.length >= 3) {
          labelBasedSelectors.push(`[aria-label="${cleanLabel}"]`);           // Exact match
          labelBasedSelectors.push(`[aria-label*="${cleanLabel}"]`);          // Contains
          labelBasedSelectors.push(`[aria-label^="${cleanLabel}"]`);          // Starts with
          
          // Role-specific selectors (very reliable for Salesforce Lightning)
          if (elementRole === 'textbox' || elementRole === 'combobox' || elementRole === 'spinbutton') {
            labelBasedSelectors.push(`[role="${elementRole}"][aria-label*="${cleanLabel}"]`);
          }
          
          // Custom element label attributes (Salesforce Lightning)
          labelBasedSelectors.push(`[label="${cleanLabel}"]`);
          labelBasedSelectors.push(`[field-label="${cleanLabel}"]`);
          labelBasedSelectors.push(`[data-label="${cleanLabel}"]`);
          
          // Input with name containing label (snake_case conversion)
          const snakeCase = cleanLabel.toLowerCase().replace(/\s+/g, '_');
          labelBasedSelectors.push(`input[name*="${snakeCase}"]`);
          labelBasedSelectors.push(`input[name*="${cleanLabel.toLowerCase().replace(/\s+/g, '')}"]`);
          
          // XPath selectors (safest, most flexible)
          if (elementRole) {
            labelBasedSelectors.push(`//*[@role="${elementRole}" and contains(@aria-label, "${cleanLabel}")]`);
          }
          labelBasedSelectors.push(`//input[contains(@aria-label, "${cleanLabel}")]`);
          labelBasedSelectors.push(`//*[contains(@aria-label, "${cleanLabel}")][@contenteditable="true"]`);
          
          // SLDS-specific selectors (Salesforce Lightning Design System)
          labelBasedSelectors.push(`.slds-form-element:has(.slds-form-element__label:contains("${cleanLabel}")) input`);
        }
        
        // Add label-based selectors to front (higher priority)
        enhancedFallbacks = [...labelBasedSelectors, ...enhancedFallbacks];
        console.log('🔍 RecordingManager: Generated', labelBasedSelectors.length, 'semantic selectors for labeled input:', cleanLabel);
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
      const elementType = (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).type || 'text';
      const inputDetails: import('../types/workflow').InputDetails | undefined =
        isContentEditable ? undefined : {
          type: elementType,
          required: (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required || false,
          min: element instanceof HTMLInputElement ? (element.min || undefined) : undefined,
          max: element instanceof HTMLInputElement ? (element.max || undefined) : undefined,
          pattern: element instanceof HTMLInputElement ? (element.pattern || undefined) : undefined,
          step: element instanceof HTMLInputElement ? (element.step ? parseFloat(element.step) : undefined) : undefined,
        };

      // Debug: Log for SELECT elements
      if (elementType === 'select-one' || elementType === 'select-multiple') {
        console.log(`[GhostWriter] 📋 Recording SELECT element with inputDetails.type: "${elementType}"`);
      }

      // Capture SELECT options for dropdown variables
      let selectOptions: string[] | undefined;
      let groupLabel: string | undefined;

      if (element.tagName === 'SELECT') {
        const selectEl = element as HTMLSelectElement;
        selectOptions = Array.from(selectEl.options).map(opt => opt.textContent?.trim() || opt.value).filter(Boolean);
        console.log(`[GhostWriter] 📋 Captured ${selectOptions.length} SELECT options:`, selectOptions);
      }
      // Capture RADIO button group options
      else if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'radio') {
        const radioEl = element as HTMLInputElement;
        const radioName = radioEl.name;
        if (radioName) {
          // Find all radio buttons with the same name in the document
          const radioGroup = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(radioName)}"]`);
          selectOptions = [];
          radioGroup.forEach((radio) => {
            // Get label for this radio button
            const radioInput = radio as HTMLInputElement;
            let optionLabel = '';

            // Try to find associated label
            const labelElement = radioInput.labels?.[0] || document.querySelector(`label[for="${CSS.escape(radioInput.id)}"]`);
            if (labelElement) {
              optionLabel = labelElement.textContent?.trim() || '';
            }
            // Fallback to value
            if (!optionLabel) {
              optionLabel = radioInput.value || '';
            }
            if (optionLabel) {
              selectOptions!.push(optionLabel);
            }
          });

          // Find group label (fieldset legend or parent group label)
          const fieldset = element.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) {
              groupLabel = legend.textContent?.trim();
            }
          }
          // Also check for a parent element with a label-like text (common pattern)
          if (!groupLabel) {
            const parent = element.closest('.form-group, .radio-group, [role="radiogroup"]');
            if (parent) {
              const labelEl = parent.querySelector('label:not([for]), .label, .group-label, [class*="label"]');
              if (labelEl && !labelEl.querySelector('input')) {
                groupLabel = labelEl.textContent?.trim();
              }
            }
          }

          console.log(`[GhostWriter] 📋 Captured ${selectOptions.length} RADIO options for group "${radioName}":`, selectOptions, 'groupLabel:', groupLabel);
        }
      }
      // Capture CHECKBOX group options
      else if (element.tagName === 'INPUT' && (element as HTMLInputElement).type === 'checkbox') {
        const checkboxEl = element as HTMLInputElement;
        const checkboxName = checkboxEl.name;

        // Try to find all checkboxes in the same group
        let checkboxGroup: NodeListOf<Element> | Element[];

        if (checkboxName) {
          // If there's a name, find all checkboxes with the same name
          checkboxGroup = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(checkboxName)}"]`);
        } else {
          // If no name, look for checkboxes in the same fieldset or parent container
          const fieldset = element.closest('fieldset');
          if (fieldset) {
            checkboxGroup = fieldset.querySelectorAll('input[type="checkbox"]');
          } else {
            // Fall back to immediate container
            const container = element.closest('.checkbox-group, .form-group, [role="group"]');
            if (container) {
              checkboxGroup = container.querySelectorAll('input[type="checkbox"]');
            } else {
              checkboxGroup = [element]; // Only this checkbox
            }
          }
        }

        if (checkboxGroup.length > 1) {
          selectOptions = [];
          checkboxGroup.forEach((checkbox) => {
            const checkboxInput = checkbox as HTMLInputElement;
            let optionLabel = '';

            // Try to find associated label
            const labelElement = checkboxInput.labels?.[0] || document.querySelector(`label[for="${CSS.escape(checkboxInput.id)}"]`);
            if (labelElement) {
              optionLabel = labelElement.textContent?.trim() || '';
            }
            // Fallback to value
            if (!optionLabel) {
              optionLabel = checkboxInput.value || '';
            }
            if (optionLabel) {
              selectOptions!.push(optionLabel);
            }
          });

          // Find group label (fieldset legend or parent group label)
          const fieldset = element.closest('fieldset');
          if (fieldset) {
            const legend = fieldset.querySelector('legend');
            if (legend) {
              groupLabel = legend.textContent?.trim();
            }
          }
          // Also check for a parent element with a label-like text
          if (!groupLabel) {
            const parent = element.closest('.form-group, .checkbox-group, [role="group"]');
            if (parent) {
              const labelEl = parent.querySelector('label:not([for]), .label, .group-label, [class*="label"]');
              if (labelEl && !labelEl.querySelector('input')) {
                groupLabel = labelEl.textContent?.trim();
              }
            }
          }

          console.log(`[GhostWriter] 📋 Captured ${selectOptions.length} CHECKBOX options for group "${checkboxName || '(unnamed)'}":`, selectOptions, 'groupLabel:', groupLabel);
        }
      }

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
      // Use getCurrentFrameContext to properly detect if we're inside an iframe
      const { getCurrentFrameId } = await import('./content-script');
      const frameId = getCurrentFrameId();
      const iframeContext = IframeUtils.getCurrentFrameContext(frameId);

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

      // UNIFIED INTERACTION DETECTION: Detect interaction type for INPUT
      // Pass inputDetails to help detect Shadow DOM inputs (Salesforce Lightning)
      const interactionType = InteractionDetector.detect(element, undefined, undefined, inputDetails);
      console.log('[RecordingManager] Detected interaction type (INPUT):', interactionType);

      // NEW: For INPUT steps in spreadsheets, capture spreadsheet context (same as CLICK steps)
      let inputSpreadsheetContext: any = undefined;
      if (VisualSnapshotService.isSpreadsheetDomain()) {
        // Get grid coordinates from the scanned context
        const scanResult = ContextScanner.scan(element);
        // Use explicit cell ref if provided (from flush), else use cached, else use scanned
        const effectiveCellRef = explicitCellRef || this.pendingCellReference || scanResult.gridCoordinates?.cellReference;
        
        if (effectiveCellRef) {
          console.log('📊 RecordingManager: Adding spreadsheet context to INPUT step:', { cellRef: effectiveCellRef });
          inputSpreadsheetContext = {
            recordedIntent: {
              cellRef: effectiveCellRef,
              columnHeader: scanResult.gridCoordinates?.columnHeader,
              column: effectiveCellRef.match(/^([A-Z]+)/)?.[1] || '',
              wasEmpty: true, // INPUT steps are always typing into cells
              wasAppendPosition: false, // Will be determined during execution
              reasoning: `User typed "${value}" in cell ${effectiveCellRef}`,
            }
          };
        }
      }

      // Build step payload first (without wait conditions)
      // CRITICAL FIX: Use enhancedFallbacks (with semantic selectors) instead of raw selectors.fallbacks
      // Also ensure fallbackSelectors is never empty (same safety check as CLICK handler)
      const stepPayload: WorkflowStep['payload'] = {
        selector: selectors.primary,
        fallbackSelectors: enhancedFallbacks.length > 0 ? enhancedFallbacks : [selectors.primary],
        xpath: selectors.xpath,
        label: label || undefined,
        value: value,
        timestamp: stepTimestamp,
          url: url,
          tabUrl: this.currentTabUrl || undefined,
          tabTitle: this.currentTabTitle || undefined,
          tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
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
        // NEW: Spreadsheet context for intelligent cell targeting during execution
        spreadsheetContext: inputSpreadsheetContext,
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
          ...((() => {
            const scanned = ContextScanner.scan(element);
            // CRITICAL FIX: If we have a cached cell reference from input time, use it instead of current Name Box
            // This fixes the C→E bug where clicking away updates Name Box before we capture
          // CRITICAL: Use explicit cell ref if provided (from flush), else use cached, else use scanned
          // Priority: explicitCellRef > this.pendingCellReference > scanned.gridCoordinates.cellReference
          const effectiveCellRef = explicitCellRef || this.pendingCellReference || scanned.gridCoordinates?.cellReference;
          if (scanned.gridCoordinates && effectiveCellRef && effectiveCellRef !== scanned.gridCoordinates.cellReference) {
            console.log(`📊 GhostWriter: Overriding cell reference "${scanned.gridCoordinates.cellReference}" → "${effectiveCellRef}" (explicit: ${!!explicitCellRef}, cached: ${!!this.pendingCellReference})`);
            scanned.gridCoordinates.cellReference = effectiveCellRef;
          }
          // ADD SELECT/RADIO/CHECKBOX OPTIONS TO DECISION SPACE
          if (selectOptions && selectOptions.length > 0) {
            // Determine the type based on input type
            const inputType = inputDetails?.type;
            let decisionType: 'LIST_SELECTION' | 'RADIO_GROUP' | 'CHECKBOX_GROUP' = 'LIST_SELECTION';
            if (inputType === 'radio') {
              decisionType = 'RADIO_GROUP';
            } else if (inputType === 'checkbox') {
              decisionType = 'CHECKBOX_GROUP';
            }

            scanned.decisionSpace = {
              type: decisionType,
              selectedText: value || '',
              selectedIndex: selectOptions.indexOf(value || ''),
              options: selectOptions,
              ...(groupLabel ? { groupLabel } : {}),
            };
            console.log(`[RecordingManager] 📋 Added ${decisionType} options to decisionSpace:`, selectOptions.length, 'options, groupLabel:', groupLabel);
          }
          // NOTE: Previously looked up column headers here, but removed for simplicity
          // Users will rename variables in the UI instead
          // Cell reference (e.g., "A5", "B10") will be used as the default variable name
          console.log(`[RecordingManager] ContextScanner.scan result for INPUT step:`, { hasGridCoordinates: !!scanned.gridCoordinates, cellReference: scanned.gridCoordinates?.cellReference, columnHeader: scanned.gridCoordinates?.columnHeader, label, labelMatchesCellRef: label === scanned.gridCoordinates?.cellReference, usedCachedRef: !!this.pendingCellReference, usedExplicitRef: !!explicitCellRef, hasSelectOptions: !!selectOptions });
          return scanned;
          })()),
        } : ((() => {
          const scanned = ContextScanner.scan(element);
          // CRITICAL: Use explicit cell ref if provided (from flush), else use cached, else use scanned
          // Priority: explicitCellRef > this.pendingCellReference > scanned.gridCoordinates.cellReference
          const effectiveCellRef = explicitCellRef || this.pendingCellReference || scanned.gridCoordinates?.cellReference;
          if (scanned.gridCoordinates && effectiveCellRef && effectiveCellRef !== scanned.gridCoordinates.cellReference) {
            console.log(`📊 GhostWriter: Overriding cell reference "${scanned.gridCoordinates.cellReference}" → "${effectiveCellRef}" (explicit: ${!!explicitCellRef}, cached: ${!!this.pendingCellReference})`);
            scanned.gridCoordinates.cellReference = effectiveCellRef;
          }
          // ADD SELECT/RADIO/CHECKBOX OPTIONS TO DECISION SPACE
          if (selectOptions && selectOptions.length > 0) {
            // Determine the type based on input type
            const inputType = inputDetails?.type;
            let decisionType: 'LIST_SELECTION' | 'RADIO_GROUP' | 'CHECKBOX_GROUP' = 'LIST_SELECTION';
            if (inputType === 'radio') {
              decisionType = 'RADIO_GROUP';
            } else if (inputType === 'checkbox') {
              decisionType = 'CHECKBOX_GROUP';
            }

            scanned.decisionSpace = {
              type: decisionType,
              selectedText: value || '',
              selectedIndex: selectOptions.indexOf(value || ''),
              options: selectOptions,
              ...(groupLabel ? { groupLabel } : {}),
            };
            console.log(`[RecordingManager] 📋 Added ${decisionType} options to decisionSpace (no context):`, selectOptions.length, 'options, groupLabel:', groupLabel);
          }
          // NOTE: Previously looked up column headers here, but removed for simplicity
          // Users will rename variables in the UI instead
          // Cell reference (e.g., "A5", "B10") will be used as the default variable name
          console.log(`[RecordingManager] ContextScanner.scan result (no context) for INPUT step:`, { hasGridCoordinates: !!scanned.gridCoordinates, cellReference: scanned.gridCoordinates?.cellReference, columnHeader: scanned.gridCoordinates?.columnHeader, label, labelMatchesCellRef: label === scanned.gridCoordinates?.cellReference, usedCachedRef: !!this.pendingCellReference, usedExplicitRef: !!explicitCellRef, hasSelectOptions: !!selectOptions });
          return scanned;
        })()),
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
        // Unified Interaction Type Detection
        interactionType: interactionType,
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

      // DISABLED: PageModel context capture during recording causes lag
      // AI analysis now runs AFTER recording stops (in App.tsx handleStopRecording)
      // The post-recording analyzer provides richer analysis without impacting recording performance
      //
      // try {
      //   const pageModelContext = await this.enrichStepWithPageModelContext(element, 'INPUT', value);
      //   if (pageModelContext) {
      //     stepPayload.pageModelContext = pageModelContext;
      //   }
      // } catch (error) {
      //   console.warn('GhostWriter: Failed to capture PageModel context for INPUT:', error);
      // }

      // Form Audit: attach full form snapshot to the first INPUT step that triggered it
      const pendingAudit = this.formAuditor.getAudit();
      if (pendingAudit && !this.formAuditAttached) {
        stepPayload.formAudit = pendingAudit;
        this.formAuditAttached = true;
        console.log(`[FormAuditor] Attached form audit to INPUT step: ${pendingAudit.totalFields} fields`);
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

      // Queue for AI label enhancement if confidence is low and AI is enabled
      if (LabelFinder.needsAIEnhancement(labelResult) && 
          aiConfig.isAILabelEnhancementEnabled() && 
          visualSnapshot?.viewport) {
        console.log(`[RecordingManager] Queueing step for AI label enhancement:`, {
          stepId: stepPayload.timestamp.toString(),
          currentLabel: label,
          confidence: labelResult.confidence,
          source: labelResult.source
        });
        
        // Queue async - doesn't block recording
        aiLabelEnhancer.queueForEnhancement(
          stepPayload.timestamp.toString(),
          visualSnapshot.viewport,
          {
            elementBounds: elementBounds,
            domLabelHint: label || undefined,
            placeholderHint: (element as HTMLInputElement).placeholder || undefined,
            inputType: inputDetails?.type,
            pageTitle: document.title,
            pageUrl: url,
            nearbyText: semanticAnchors.nearbyText,
          }
        );
      }

      // Clear cache after successful record
      this.lastInputValue = '';
      this.currentInputElement = null;
    } catch (error) {
      console.error('Error capturing input value:', error);
    }
  }

  /**
   * Send a workflow step to the side panel
   * Delegates to StepPublisher module
   */
  private sendStep(step: WorkflowStep): void {
    this.stepPublisher.sendStep(step);
  }

  // ============================================================
  // Copy/Paste Intent Detection Helpers
  // ============================================================

  /**
   * Normalize text for clipboard matching (handles whitespace, formatting artifacts)
   */
  private normalizeClipboardText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ')                         // Collapse multiple whitespace
      .replace(/[\u200B-\u200D\uFEFF]/g, '');       // Remove zero-width chars
  }

  /**
   * Find a matching COPY step for the given pasted text
   * Uses cached clipboard data for CROSS-TAB matching
   */
  private async findMatchingCopy(pastedText: string | undefined): Promise<{
    stepId: string;
    text: string;
    normalizedText: string;
    sourceSelector: string;
    timestamp: number;
    stepIndex: number;
  } | null> {
    if (!pastedText) return null;

    const normalized = this.normalizeClipboardText(pastedText);
    if (!normalized) return null;

    // Check cached clipboard from chrome.storage (set during COPY)
    // Use Promise with timeout to prevent hanging
    try {
      const storedClipboard = await Promise.race([
        chrome.storage.local.get('ghostwriter_clipboard').then(r => r.ghostwriter_clipboard as {
          text: string;
          normalizedText: string;
          sourceSelector: string;
          timestamp: number;
          url: string;
        } | undefined),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 100)) // 100ms timeout
      ]);

      if (storedClipboard?.normalizedText) {
        // Check exact match
        if (storedClipboard.normalizedText === normalized) {
          console.log('📋 GhostWriter: Found COPY match!');
          return {
            stepId: `${storedClipboard.timestamp}`,
            text: storedClipboard.text,
            normalizedText: storedClipboard.normalizedText,
            sourceSelector: storedClipboard.sourceSelector,
            timestamp: storedClipboard.timestamp,
            stepIndex: 0,
          };
        }

        // Check fuzzy match (>95% similarity)
        if (this.textSimilarity(normalized, storedClipboard.normalizedText) > 0.95) {
          console.log('📋 GhostWriter: Found COPY match (fuzzy)!');
          return {
            stepId: `${storedClipboard.timestamp}`,
            text: storedClipboard.text,
            normalizedText: storedClipboard.normalizedText,
            sourceSelector: storedClipboard.sourceSelector,
            timestamp: storedClipboard.timestamp,
            stepIndex: 0,
          };
        }
      }
    } catch {
      // Storage read failed - continue without match
    }

    // Fallback: check local Map (same-tab scenario)
    const exactMatch = this.copyStepsInSession.get(normalized);
    if (exactMatch) return exactMatch;

    for (const [, copyInfo] of this.copyStepsInSession) {
      if (this.textSimilarity(normalized, copyInfo.normalizedText) > 0.95) {
        return copyInfo;
      }
    }

    return null;
  }

  /**
   * Calculate text similarity using Dice coefficient (bigram overlap)
   * Returns 0-1 where 1 is identical
   */
  private textSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const bigrams = (s: string): Set<string> => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        set.add(s.slice(i, i + 2));
      }
      return set;
    };

    const aBigrams = bigrams(a);
    const bBigrams = bigrams(b);
    let intersection = 0;
    for (const bg of aBigrams) {
      if (bBigrams.has(bg)) intersection++;
    }

    return (2 * intersection) / (aBigrams.size + bBigrams.size);
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
  /**
   * Enrich step with reliable replayer data (LocatorBundle, Intent, Success Conditions)
   * Delegates to StepEnricher module
   */
  private enrichStepWithReliableData(
    element: Element,
    stepType: 'CLICK' | 'INPUT' | 'KEYBOARD' | 'COPY' | 'PASTE' | 'DOUBLE_CLICK' | 'RIGHT_CLICK' | 'HOVER' | 'DRAG_DROP',
    value?: string,
    key?: string
  ): {
    locatorBundle: LocatorBundle;
    intent: Intent;
    stepGoal: StepGoal;
    suggestedCondition: SuggestedCondition;
  } | null {
    return this.stepEnricher.enrichStep(element, stepType, value, key);
  }

  // ============================================
  // DOUBLE-CLICK HANDLER
  // ============================================

  /**
   * Handle double-click events (e.g., opening editors, selecting words)
   */
  private async handleDoubleClick(event: MouseEvent): Promise<void> {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // Find the actual clickable element - for double-click, capture elements at click point
    const elementsAtClickPoint = document.elementsFromPoint(event.clientX, event.clientY);
    const clickableElement = this.elementFinder.findActualClickableElementSync(target, event, elementsAtClickPoint);
    if (!clickableElement) return;

    console.log('🖱️ GhostWriter: Double-click detected on:', clickableElement.tagName);

    try {
      const selectors = SelectorEngine.generateSelectors(clickableElement);
      const labelResult = LabelFinder.findLabelWithConfidence(clickableElement as HTMLElement);
      const label = labelResult.label !== 'Unknown Field' ? labelResult.label : null;

      const stepPayload: WorkflowStepPayload = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
        xpath: selectors.xpath,
        timestamp: Date.now(),
        url: window.location.href,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
        shadowPath: selectors.shadowPath,
        label: label || undefined,
        elementText: clickableElement.textContent?.trim().substring(0, 100) || undefined,
        eventDetails: {
          coordinates: { x: event.clientX, y: event.clientY },
          modifiers: this.captureModifiers(event),
        },
      };

      // Capture visual snapshot
      await this.captureVisualSnapshotForStep(clickableElement as HTMLElement, stepPayload);

      // Enrich with reliable replayer data
      const reliableData = this.enrichStepWithReliableData(clickableElement as HTMLElement, 'DOUBLE_CLICK');
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
      }

      const step: WorkflowStep = {
        type: 'DOUBLE_CLICK',
        payload: stepPayload,
        description: `Double-click on ${label || clickableElement.tagName.toLowerCase()}`,
      };

      this.sendStep(step);
      this.lastStep = step;
      console.log('✅ GhostWriter: DOUBLE_CLICK step created');

    } catch (error) {
      console.warn('GhostWriter: Failed to handle double-click:', error);
    }
  }

  // ============================================
  // RIGHT-CLICK (CONTEXT MENU) HANDLER
  // ============================================

  /**
   * Handle right-click events (context menu triggers)
   */
  private async handleRightClick(event: MouseEvent): Promise<void> {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // Find the actual element - for right-click, capture elements at click point
    const elementsAtClickPoint = document.elementsFromPoint(event.clientX, event.clientY);
    const clickableElement = this.elementFinder.findActualClickableElementSync(target, event, elementsAtClickPoint);
    if (!clickableElement) return;

    console.log('🖱️ GhostWriter: Right-click detected on:', clickableElement.tagName);

    try {
      const selectors = SelectorEngine.generateSelectors(clickableElement);
      const labelResult = LabelFinder.findLabelWithConfidence(clickableElement as HTMLElement);
      const label = labelResult.label !== 'Unknown Field' ? labelResult.label : null;

      const stepPayload: WorkflowStepPayload = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
        xpath: selectors.xpath,
        timestamp: Date.now(),
        url: window.location.href,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
        shadowPath: selectors.shadowPath,
        label: label || undefined,
        elementText: clickableElement.textContent?.trim().substring(0, 100) || undefined,
        eventDetails: {
          mouseButton: 'right',
          coordinates: { x: event.clientX, y: event.clientY },
          modifiers: this.captureModifiers(event),
        },
      };

      // Capture visual snapshot
      await this.captureVisualSnapshotForStep(clickableElement as HTMLElement, stepPayload);

      // Enrich with reliable replayer data
      const reliableData = this.enrichStepWithReliableData(clickableElement as HTMLElement, 'RIGHT_CLICK');
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
      }

      const step: WorkflowStep = {
        type: 'RIGHT_CLICK',
        payload: stepPayload,
        description: `Right-click on ${label || clickableElement.tagName.toLowerCase()}`,
      };

      this.sendStep(step);
      this.lastStep = step;
      console.log('✅ GhostWriter: RIGHT_CLICK step created');

    } catch (error) {
      console.warn('GhostWriter: Failed to handle right-click:', error);
    }
  }

  // ============================================
  // DRAG AND DROP HANDLERS
  // ============================================

  /**
   * Handle drag start - capture the source element
   */
  private handleDragStart(event: DragEvent): void {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    console.log('🖱️ GhostWriter: Drag started on:', target.tagName);

    try {
      const selectors = SelectorEngine.generateSelectors(target);

      // Store the drag source for when drop happens
      this.pendingDragSource = {
        element: target,
        selector: selectors.primary,
        coordinates: { x: event.clientX, y: event.clientY },
      };

    } catch (error) {
      console.warn('GhostWriter: Failed to handle drag start:', error);
    }
  }

  /**
   * Handle drop - create DRAG_DROP step with source and target
   */
  private async handleDrop(event: DragEvent): Promise<void> {
    if (!this.isRecording) return;

    // Must have a pending drag source
    if (!this.pendingDragSource) {
      console.warn('GhostWriter: Drop without drag start');
      return;
    }

    const dropTarget = event.target as HTMLElement;
    if (!dropTarget) {
      this.pendingDragSource = null;
      return;
    }

    console.log('🖱️ GhostWriter: Drop on:', dropTarget.tagName);

    try {
      const targetSelectors = SelectorEngine.generateSelectors(dropTarget);
      const sourceLabelResult = LabelFinder.findLabelWithConfidence(this.pendingDragSource.element as HTMLElement);
      const targetLabelResult = LabelFinder.findLabelWithConfidence(dropTarget);

      const stepPayload: WorkflowStepPayload = {
        selector: this.pendingDragSource.selector,
        fallbackSelectors: [targetSelectors.primary],
        timestamp: Date.now(),
        url: window.location.href,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
        dragDropDetails: {
          sourceSelector: this.pendingDragSource.selector,
          sourceCoordinates: this.pendingDragSource.coordinates,
          targetSelector: targetSelectors.primary,
          targetCoordinates: { x: event.clientX, y: event.clientY },
          dataTransfer: event.dataTransfer ? {
            types: Array.from(event.dataTransfer.types),
          } : undefined,
        },
      };

      // Capture visual snapshot of drop target
      await this.captureVisualSnapshotForStep(dropTarget, stepPayload);

      // Enrich with reliable replayer data
      const reliableData = this.enrichStepWithReliableData(dropTarget, 'DRAG_DROP');
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
      }

      const sourceLabel = sourceLabelResult.label !== 'Unknown Field' ? sourceLabelResult.label : 'element';
      const targetLabel = targetLabelResult.label !== 'Unknown Field' ? targetLabelResult.label : 'target';

      const step: WorkflowStep = {
        type: 'DRAG_DROP',
        payload: stepPayload,
        description: `Drag ${sourceLabel} to ${targetLabel}`,
      };

      this.sendStep(step);
      this.lastStep = step;
      console.log('✅ GhostWriter: DRAG_DROP step created');

    } catch (error) {
      console.warn('GhostWriter: Failed to handle drop:', error);
    } finally {
      // Clear pending drag source
      this.pendingDragSource = null;
    }
  }

  // ============================================
  // HOVER HANDLER
  // ============================================

  /**
   * Handle mouseenter - track significant hovers (those that trigger tooltips/popups)
   */
  private handleMouseEnter(event: MouseEvent): void {
    if (!this.isRecording) return;

    const target = event.target as HTMLElement;
    if (!target) return;

    // Clear any existing hover timer
    if (this.hoverDebounceTimer !== null) {
      clearTimeout(this.hoverDebounceTimer);
    }

    // Only track hovers on elements that might show tooltips
    const hasTooltipIndicator = target.hasAttribute('title') ||
                                target.hasAttribute('data-tooltip') ||
                                target.hasAttribute('aria-describedby') ||
                                target.closest('[data-tooltip]') ||
                                target.closest('[title]');

    if (!hasTooltipIndicator) {
      return; // Skip elements unlikely to trigger tooltips
    }

    // Set debounce timer - only record if user hovers for significant time
    this.hoverDebounceTimer = window.setTimeout(() => {
      this.recordHoverStep(target, event).catch((error) => {
        console.warn('GhostWriter: Failed to record hover step:', error);
      });
    }, this.HOVER_TRIGGER_DELAY);
  }

  /**
   * Record a hover step after debounce
   */
  private async recordHoverStep(target: HTMLElement, event: MouseEvent): Promise<void> {
    if (!this.isRecording) return;

    console.log('🖱️ GhostWriter: Significant hover detected on:', target.tagName);

    try {
      const selectors = SelectorEngine.generateSelectors(target);
      const labelResult = LabelFinder.findLabelWithConfidence(target);
      const label = labelResult.label !== 'Unknown Field' ? labelResult.label : null;

      // Check if a popup appeared
      const popup = document.querySelector('[role="tooltip"], .tooltip, [data-tooltip-content]');
      const triggeredPopup = popup && popup.textContent?.trim().length > 0;

      const stepPayload: WorkflowStepPayload = {
        selector: selectors.primary,
        fallbackSelectors: selectors.fallbacks.length > 0 ? selectors.fallbacks : [selectors.primary],
        xpath: selectors.xpath,
        timestamp: Date.now(),
        url: window.location.href,
        tabUrl: this.currentTabUrl || undefined,
        tabTitle: this.currentTabTitle || undefined,
        tabIndex: this.currentTabIndex !== null ? this.currentTabIndex : undefined,
        shadowPath: selectors.shadowPath,
        label: label || undefined,
        elementText: target.textContent?.trim().substring(0, 100) || undefined,
        hoverDetails: {
          duration: this.HOVER_TRIGGER_DELAY,
          triggeredPopup: !!triggeredPopup,
        },
        eventDetails: {
          coordinates: { x: event.clientX, y: event.clientY },
        },
      };

      // Capture visual snapshot
      await this.captureVisualSnapshotForStep(target, stepPayload);

      // Enrich with reliable replayer data
      const reliableData = this.enrichStepWithReliableData(target, 'HOVER');
      if (reliableData) {
        stepPayload.locatorBundle = reliableData.locatorBundle;
        stepPayload.intent = reliableData.intent;
        stepPayload.scope = reliableData.locatorBundle.scope;
        stepPayload.disambiguators = reliableData.locatorBundle.disambiguators;
      }

      const step: WorkflowStep = {
        type: 'HOVER',
        payload: stepPayload,
        description: `Hover on ${label || target.tagName.toLowerCase()}${triggeredPopup ? ' (shows tooltip)' : ''}`,
      };

      this.sendStep(step);
      this.lastStep = step;
      console.log('✅ GhostWriter: HOVER step created');

    } catch (error) {
      console.warn('GhostWriter: Failed to record hover:', error);
    }
  }

  /**
   * Helper to capture modifier keys from mouse event
   */
  private captureModifiers(event: MouseEvent): { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } | undefined {
    const modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {};
    if (event.ctrlKey) modifiers.ctrl = true;
    if (event.shiftKey) modifiers.shift = true;
    if (event.altKey) modifiers.alt = true;
    if (event.metaKey) modifiers.meta = true;

    // Only return if at least one modifier is set
    return Object.keys(modifiers).length > 0 ? modifiers : undefined;
  }

  // DISABLED: PageModel context capture during recording causes lag
  // AI analysis now runs AFTER recording stops (in App.tsx handleStopRecording)
  // Keeping this method for potential future use with lighter-weight capture
  //
  // private async enrichStepWithPageModelContext(
  //   element: Element,
  //   stepType: 'CLICK' | 'INPUT' | 'KEYBOARD' | 'COPY' | 'PASTE',
  //   value?: string
  // ): Promise<import('../lib/page-model/types').PageModelRecordingContext | null> {
  //   try {
  //     return await this.stepEnricher.enrichWithPageModelContext(element, stepType, value);
  //   } catch (error) {
  //     console.warn('GhostWriter: Failed to enrich step with PageModel context:', error);
  //     return null;
  //   }
  // }
}

