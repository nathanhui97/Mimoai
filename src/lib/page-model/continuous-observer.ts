/**
 * Continuous Observer - Background monitoring without latency impact
 *
 * This module provides:
 * - MutationObserver for DOM changes
 * - Throttled state polling (10fps, <5ms per check)
 * - Event emission on state changes (modal:appeared, dropdown:opened, etc.)
 *
 * Performance budget: <50ms/second overhead total
 */

import type {
  PageModelEvent,
  PageModelConfig,
} from './types';
import { PageModelManager } from './page-model';

// ============================================================================
// State Tracking Types
// ============================================================================

interface ObservedState {
  hasModal: boolean;
  modalTitle?: string;
  hasDropdown: boolean;
  dropdownTrigger?: string;
  isLoading: boolean;
  hasError: boolean;
  errorMessage?: string;
  focusedElementId?: string;
  url: string;
}

// ============================================================================
// Continuous Observer Class
// ============================================================================

export class ContinuousObserver {
  private config: PageModelConfig;
  private pageModel: PageModelManager;

  // Observers
  private mutationObserver: MutationObserver | null = null;
  private pollInterval: number | null = null;

  // State tracking
  private lastState: ObservedState | null = null;
  private isRunning: boolean = false;

  // Performance tracking
  private checkCount: number = 0;
  private totalCheckTime: number = 0;

  // Throttling
  private lastMutationTime: number = 0;
  private pendingMutationCheck: boolean = false;
  private mutationCheckTimeout: number | null = null;

  constructor(config: PageModelConfig, pageModel: PageModelManager) {
    this.config = config;
    this.pageModel = pageModel;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start the continuous observer
   */
  start(): void {
    if (this.isRunning) {
      this.log('warn', 'Observer already running');
      return;
    }

    this.isRunning = true;
    this.lastState = this.captureState();

    // Start mutation observer
    this.startMutationObserver();

    // Start polling for states that can't be detected via mutations
    this.startPolling();

    // Link to PageModel
    this.pageModel.setContinuousObserver(this);

    this.log('info', 'Continuous observer started');
  }

  /**
   * Stop the continuous observer
   */
  stop(): void {
    this.isRunning = false;

    // Stop mutation observer
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Stop polling
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Clear pending mutation check
    if (this.mutationCheckTimeout !== null) {
      clearTimeout(this.mutationCheckTimeout);
      this.mutationCheckTimeout = null;
    }

    this.log('info', `Observer stopped. Avg check time: ${(this.totalCheckTime / Math.max(this.checkCount, 1)).toFixed(2)}ms`);
  }

  /**
   * Force an immediate state check
   */
  checkNow(): void {
    this.runStateCheck();
  }

  /**
   * Get performance metrics
   */
  getMetrics(): { checkCount: number; avgCheckTimeMs: number; isRunning: boolean } {
    return {
      checkCount: this.checkCount,
      avgCheckTimeMs: this.totalCheckTime / Math.max(this.checkCount, 1),
      isRunning: this.isRunning,
    };
  }

  // ============================================================================
  // Mutation Observer
  // ============================================================================

  private startMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    // Observe the entire document for relevant changes
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-modal',
        'aria-expanded',
        'aria-hidden',
        'role',
        'class',
        'style',
        'disabled',
        'aria-disabled',
      ],
    });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    // Quick check: are any mutations relevant?
    const hasRelevantMutation = mutations.some(m => this.isRelevantMutation(m));

    if (!hasRelevantMutation) {
      return;
    }

    // Throttle mutation processing
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastMutationTime;

    if (timeSinceLastCheck < this.config.observerThrottleMs) {
      // Schedule a delayed check if not already pending
      if (!this.pendingMutationCheck) {
        this.pendingMutationCheck = true;
        this.mutationCheckTimeout = window.setTimeout(() => {
          this.pendingMutationCheck = false;
          this.runStateCheck();
        }, this.config.observerThrottleMs - timeSinceLastCheck);
      }
      return;
    }

    this.lastMutationTime = now;
    this.runStateCheck();
  }

  private isRelevantMutation(mutation: MutationRecord): boolean {
    // Check if this mutation might affect UI state
    const target = mutation.target as Element;

    // Attribute changes that indicate state changes
    if (mutation.type === 'attributes') {
      const attr = mutation.attributeName;
      if (attr === 'aria-modal' || attr === 'aria-expanded' ||
        attr === 'aria-hidden' || attr === 'role') {
        return true;
      }

      // Class changes on potential modal/dropdown elements
      if (attr === 'class') {
        const className = target.className?.toString().toLowerCase() || '';
        if (className.includes('modal') || className.includes('dropdown') ||
          className.includes('dialog') || className.includes('menu') ||
          className.includes('loading') || className.includes('error')) {
          return true;
        }
      }
    }

    // Child changes that might add/remove modals or dropdowns
    if (mutation.type === 'childList') {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          const role = node.getAttribute('role');
          if (role === 'dialog' || role === 'alertdialog' || role === 'menu' ||
            role === 'listbox' || role === 'alert') {
            return true;
          }

          const className = node.className?.toString().toLowerCase() || '';
          if (className.includes('modal') || className.includes('dropdown') ||
            className.includes('dialog') || className.includes('toast') ||
            className.includes('loading')) {
            return true;
          }
        }
      }

      // Check removed nodes
      for (const node of mutation.removedNodes) {
        if (node instanceof Element) {
          const role = node.getAttribute('role');
          if (role === 'dialog' || role === 'alertdialog' || role === 'menu' ||
            role === 'listbox' || role === 'alert') {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ============================================================================
  // Polling
  // ============================================================================

  private startPolling(): void {
    // Poll at 10fps (100ms interval) for states that can't be detected via mutations
    const pollIntervalMs = 100;

    this.pollInterval = window.setInterval(() => {
      if (!this.isRunning) return;
      this.runStateCheck();
    }, pollIntervalMs);
  }

  // ============================================================================
  // State Check
  // ============================================================================

  private runStateCheck(): void {
    if (!this.isRunning) return;

    const startTime = performance.now();

    const currentState = this.captureState();
    const events = this.diffState(this.lastState, currentState);

    // Emit events
    for (const event of events) {
      this.pageModel.emitEvent(event);

      // Invalidate cache when significant events occur
      if (this.isSignificantEvent(event)) {
        this.pageModel.invalidateCache();
      }
    }

    this.lastState = currentState;

    // Track performance
    const elapsed = performance.now() - startTime;
    this.checkCount++;
    this.totalCheckTime += elapsed;

    // Log slow checks
    if (elapsed > 5) {
      this.log('warn', `Slow state check: ${elapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Capture current UI state (fast, <5ms target)
   */
  private captureState(): ObservedState {
    // Modal detection (fast check)
    const hasModal = this.hasVisibleModal();
    const modalTitle = hasModal ? this.getModalTitle() : undefined;

    // Dropdown detection
    const hasDropdown = this.hasVisibleDropdown();
    const dropdownTrigger = hasDropdown ? this.getDropdownTrigger() : undefined;

    // Loading detection
    const isLoading = this.hasLoadingIndicator();

    // Error detection
    const hasError = this.hasVisibleError();
    const errorMessage = hasError ? this.getErrorMessage() : undefined;

    // Focus tracking
    const focusedElementId = document.activeElement?.id || undefined;

    // URL tracking
    const url = window.location.href;

    return {
      hasModal,
      modalTitle,
      hasDropdown,
      dropdownTrigger,
      isLoading,
      hasError,
      errorMessage,
      focusedElementId,
      url,
    };
  }

  /**
   * Compare states and generate events
   */
  private diffState(
    prev: ObservedState | null,
    curr: ObservedState
  ): PageModelEvent[] {
    const events: PageModelEvent[] = [];

    if (!prev) {
      return events; // First check, no diff
    }

    // Modal changes
    if (!prev.hasModal && curr.hasModal) {
      events.push({
        type: 'modal:appeared',
        modal: {
          title: curr.modalTitle,
          type: 'dialog',
          isPersistentPanel: false,
          elements: [],
        },
      });
    } else if (prev.hasModal && !curr.hasModal) {
      events.push({ type: 'modal:closed' });
    }

    // Dropdown changes
    if (!prev.hasDropdown && curr.hasDropdown) {
      events.push({
        type: 'dropdown:opened',
        dropdown: {
          triggerName: curr.dropdownTrigger,
          options: [],
          optionTexts: [],
        },
      });
    } else if (prev.hasDropdown && !curr.hasDropdown) {
      events.push({ type: 'dropdown:closed' });
    }

    // Loading changes
    if (!prev.isLoading && curr.isLoading) {
      events.push({ type: 'loading:started' });
    } else if (prev.isLoading && !curr.isLoading) {
      events.push({ type: 'loading:finished' });
    }

    // Error changes
    if (!prev.hasError && curr.hasError) {
      events.push({
        type: 'error:appeared',
        error: {
          message: curr.errorMessage || 'Unknown error',
          type: 'unknown',
        },
      });
    } else if (prev.hasError && !curr.hasError) {
      events.push({ type: 'error:cleared' });
    }

    // Focus changes
    if (prev.focusedElementId !== curr.focusedElementId) {
      events.push({
        type: 'focus:changed',
        element: {
          id: curr.focusedElementId,
        },
      });
    }

    // URL changes
    if (prev.url !== curr.url) {
      events.push({
        type: 'page:navigated',
        url: curr.url,
      });
    }

    return events;
  }

  private isSignificantEvent(event: PageModelEvent): boolean {
    return event.type === 'modal:appeared' ||
      event.type === 'modal:closed' ||
      event.type === 'dropdown:opened' ||
      event.type === 'dropdown:closed' ||
      event.type === 'page:navigated' ||
      event.type === 'dom:significant_change';
  }

  // ============================================================================
  // Fast State Detectors
  // ============================================================================

  private hasVisibleModal(): boolean {
    // Fast check for visible modals
    const modals = document.querySelectorAll(
      '[role="dialog"]:not([aria-hidden="true"]), ' +
      '[role="alertdialog"]:not([aria-hidden="true"]), ' +
      '[aria-modal="true"]:not([aria-hidden="true"])'
    );

    for (const modal of modals) {
      if (this.isVisible(modal)) {
        return true;
      }
    }

    return false;
  }

  private getModalTitle(): string | undefined {
    const modal = document.querySelector(
      '[role="dialog"]:not([aria-hidden="true"]), ' +
      '[role="alertdialog"]:not([aria-hidden="true"])'
    );

    if (!modal) return undefined;

    // Try aria-label
    const ariaLabel = modal.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Try aria-labelledby
    const labelledBy = modal.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) return labelEl.textContent.trim();
    }

    // Try heading inside modal
    const heading = modal.querySelector('h1, h2, h3, [role="heading"]');
    if (heading?.textContent) return heading.textContent.trim();

    return undefined;
  }

  private hasVisibleDropdown(): boolean {
    // Fast check for visible dropdowns
    const dropdowns = document.querySelectorAll(
      '[role="menu"]:not([aria-hidden="true"]), ' +
      '[role="listbox"]:not([aria-hidden="true"]), ' +
      '[aria-expanded="true"] + [role="menu"], ' +
      '[aria-expanded="true"] + [role="listbox"]'
    );

    for (const dropdown of dropdowns) {
      if (this.isVisible(dropdown)) {
        return true;
      }
    }

    // Check for expanded comboboxes
    const expandedComboboxes = document.querySelectorAll(
      '[role="combobox"][aria-expanded="true"]'
    );

    return expandedComboboxes.length > 0;
  }

  private getDropdownTrigger(): string | undefined {
    // Find the trigger element
    const expanded = document.querySelector('[aria-expanded="true"]');
    if (expanded) {
      return expanded.getAttribute('aria-label') ||
        expanded.textContent?.trim().substring(0, 50);
    }
    return undefined;
  }

  private hasLoadingIndicator(): boolean {
    // Check for common loading indicators
    const loadingSelectors = [
      '[role="progressbar"]',
      '[aria-busy="true"]',
      '.loading',
      '.spinner',
      '[class*="loading"]',
      '[class*="spinner"]',
    ];

    for (const selector of loadingSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (this.isVisible(el)) {
            return true;
          }
        }
      } catch {
        // Invalid selector, skip
      }
    }

    return false;
  }

  private hasVisibleError(): boolean {
    // Check for error messages
    const errors = document.querySelectorAll(
      '[role="alert"], ' +
      '.error, ' +
      '[class*="error"], ' +
      '[aria-invalid="true"]'
    );

    for (const error of errors) {
      if (this.isVisible(error)) {
        return true;
      }
    }

    return false;
  }

  private getErrorMessage(): string | undefined {
    const error = document.querySelector(
      '[role="alert"], .error, [class*="error-message"]'
    );

    if (error?.textContent) {
      return error.textContent.trim().substring(0, 200);
    }

    return undefined;
  }

  /**
   * Fast visibility check (no forced reflow)
   */
  private isVisible(element: Element): boolean {
    // Use getBoundingClientRect for fast check
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    // Check computed style (cached by browser after getBoundingClientRect)
    const style = window.getComputedStyle(element);
    if (style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0') {
      return false;
    }

    return true;
  }

  // ============================================================================
  // Logging
  // ============================================================================

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    const levels = ['debug', 'info', 'warn', 'error', 'none'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const messageLevel = levels.indexOf(level);

    if (messageLevel >= configLevel) {
      const prefix = '[ContinuousObserver]';
      switch (level) {
        case 'debug':
          console.log(prefix, message, ...args);
          break;
        case 'info':
          console.log(prefix, message, ...args);
          break;
        case 'warn':
          console.warn(prefix, message, ...args);
          break;
        case 'error':
          console.error(prefix, message, ...args);
          break;
      }
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and start a continuous observer
 */
export function createContinuousObserver(
  config: PageModelConfig,
  pageModel: PageModelManager
): ContinuousObserver {
  const observer = new ContinuousObserver(config, pageModel);
  observer.start();
  return observer;
}
