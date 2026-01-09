/**
 * Types for the Recording Module
 * Shared types used across click, input, keyboard, scroll, and clipboard handlers
 */

import type { WorkflowStep, WorkflowStepPayload } from '../../types/workflow';
import type { AnnotatedCaptureResult } from '../visual-snapshot';
import type { LocatorBundle } from '../../types/locator';
import type { Intent, StepGoal } from '../../types/intent';
import type { SuggestedCondition } from '../../types/conditions';

/**
 * Recording state that handlers need access to
 */
export interface RecordingState {
  isRecording: boolean;
  isCapturingHeaders: boolean;
  currentUrl: string;
  currentTabUrl: string | null;
  currentTabTitle: string | null;
  currentTabIndex: number | null;
  lastStep: WorkflowStep | null;
}

/**
 * Configuration constants for recording
 */
export interface RecordingConfig {
  DEBOUNCE_DELAY: number;
  SCROLL_DEBOUNCE_DELAY: number;
  CLICK_DEDUP_WINDOW: number;
  ENABLE_RELIABLE_RECORDING: boolean;
}

/**
 * Default recording configuration
 */
export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  DEBOUNCE_DELAY: 500,
  SCROLL_DEBOUNCE_DELAY: 300,
  CLICK_DEDUP_WINDOW: 500,
  ENABLE_RELIABLE_RECORDING: true,
};

/**
 * Click state tracking
 */
export interface ClickState {
  lastClickStep: { selector: string; timestamp: number } | null;
  pendingSnapshot: Promise<{ viewport: string; elementSnippet: string } | null> | null;
  pendingAnnotatedSnapshot: Promise<AnnotatedCaptureResult | null> | null;
  pendingClickPoint: { x: number; y: number } | null;
  pendingClickProcessing: Promise<void>[];
  pendingClickCallbacks: Array<{ callback: () => Promise<void>; timeoutId?: number }>;
}

/**
 * Input state tracking
 */
export interface InputState {
  inputDebounceTimer: number | null;
  lastInputStep: { selector: string; value: string } | null;
  lastInputValue: string;
  currentInputElement: Element | null;
  pendingInputTimestamp: number | null;
  pendingCellReference: string | null;
}

/**
 * Scroll state tracking
 */
export interface ScrollState {
  scrollDebounceTimer: number | null;
  lastScrollStep: { scrollX: number; scrollY: number; timestamp: number; container?: Element } | null;
  pendingScrollEvent: Event | null;
}

/**
 * Result from step enrichment (locator bundle, intent, etc.)
 */
export interface StepEnrichmentResult {
  locatorBundle: LocatorBundle;
  intent: Intent;
  stepGoal: StepGoal;
  suggestedCondition: SuggestedCondition;
}

/**
 * Interface for step publisher - sends steps to background
 */
export interface IStepPublisher {
  sendStep(step: WorkflowStep): void;
}

/**
 * Interface for step enricher - adds locator bundles, intents, etc.
 */
export interface IStepEnricher {
  enrichStep(
    element: Element,
    stepType: 'CLICK' | 'INPUT' | 'KEYBOARD',
    value?: string,
    key?: string
  ): StepEnrichmentResult | null;
}

/**
 * Context passed to event handlers
 */
export interface HandlerContext {
  getState: () => RecordingState;
  getConfig: () => RecordingConfig;
  getClickState: () => ClickState;
  getInputState: () => InputState;
  getScrollState: () => ScrollState;
  setLastStep: (step: WorkflowStep) => void;
  stepPublisher: IStepPublisher;
  stepEnricher: IStepEnricher;
}

/**
 * Re-export commonly used types from workflow
 */
export type { WorkflowStep, WorkflowStepPayload };
export type { AnnotatedCaptureResult };



