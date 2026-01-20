/**
 * Universal Execution Orchestrator
 * 
 * Coordinates execution of workflow steps using the appropriate
 * action primitives based on detected component patterns.
 */

import type {
  UniversalStep,
  WorkflowResult,
  StepResult,
  WorkflowOptions,
  ComponentPattern,
  ElementSignature,
} from '../../types/universal-types';
import type { TabSwitchPayload } from '../../types/workflow';
import { resolveElement, resolveAcrossBoundaries } from './element-resolver';
import { waitForDOMStable } from './state-verifier';
import { executeHumanClick } from './action-primitives/human-click';
import { executeDropdownSelect } from './action-primitives/dropdown-select';
import { getElementLabel } from '../../lib/label-utils';
import { executeTextInput } from './action-primitives/text-input';
import { isDropdownPattern, isSimpleClickPattern, isTextInputPattern } from './component-detector';
import { aiConfig } from '../../lib/ai-config';
import { AIVisualClickService, type WorkflowContext } from '../../lib/ai-visual-click';
import { FeatureFlags } from '../../lib/feature-flags';
import { TabManager } from './tab-manager';

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Execute a complete workflow
 */
export async function executeWorkflow(
  steps: UniversalStep[],
  options: WorkflowOptions = {}
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const {
    stopOnFailure = true,
    stepTimeout = 10000,
    onStepProgress,
    onStepError,
    variableValues = {},
  } = options;

  const stepResults: StepResult[] = [];
  let stepsCompleted = 0;

  // Initialize TabManager for multi-tab workflow execution
  // Get current tab ID from chrome API
  let currentTabId: number;
  try {
    const tabs = await chrome.tabs.getCurrent();
    currentTabId = tabs?.id || 0;
    console.log(`[UniversalOrchestrator] Current tab ID: ${currentTabId}`);
  } catch (error) {
    console.warn('[UniversalOrchestrator] Failed to get current tab ID, using 0:', error);
    currentTabId = 0;
  }
  
  const tabManager = new TabManager(currentTabId);

  console.log(`[UniversalOrchestrator] Starting workflow with ${steps.length} steps`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStartTime = Date.now();

    // Notify progress
    onStepProgress?.(i, 'starting');

    try {
      // Wait for DOM to be stable before each step
      await waitForDOMStable(2000, 150);

      // Build workflow context for this step
      const workflowContext: WorkflowContext = {
        currentStepNumber: i + 1,
        totalSteps: steps.length,
        previousSteps: stepResults
          .filter(r => r.success)
          .map((r, idx) => ({
            stepNumber: idx + 1,
            description: steps[idx].description || `${steps[idx].pattern.type}`,
            success: r.success,
            resultUrl: window.location.href, // Current URL after step completed
            resultPageTitle: document.title,
          })),
        workflowGoal: inferWorkflowGoal(steps),
        isOptimized: steps.length < 5, // Heuristic: likely optimized if < 5 steps
      };
      
      // Execute step
      const result = await executeStep(step, {
        timeout: stepTimeout,
        variableValues,
      }, workflowContext, tabManager);

      // Record result
      stepResults.push({
        ...result,
        stepIndex: i,
        patternType: step.pattern.type,
      });

      if (result.success) {
        stepsCompleted++;
        onStepProgress?.(i, 'completed');
        console.log(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} completed: ${step.pattern.type}`);
      } else {
        onStepProgress?.(i, 'failed');
        onStepError?.(i, result.error || 'Unknown error');
        console.error(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} failed: ${result.error}`);

        if (stopOnFailure) {
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      stepResults.push({
        stepIndex: i,
        success: false,
        patternType: step.pattern.type,
        elapsedMs: Date.now() - stepStartTime,
        error: errorMessage,
      });

      onStepProgress?.(i, 'failed');
      onStepError?.(i, errorMessage);
      console.error(`[UniversalOrchestrator] Step ${i + 1}/${steps.length} threw error:`, error);

      if (stopOnFailure) {
        break;
      }
    }

    // Brief pause between steps
    await sleep(100);
  }

  const success = stepsCompleted === steps.length;
  const totalElapsedMs = Date.now() - startTime;

  console.log(`[UniversalOrchestrator] Workflow ${success ? 'completed' : 'failed'}: ${stepsCompleted}/${steps.length} steps`);

  return {
    success,
    stepsCompleted,
    totalSteps: steps.length,
    stepResults,
    totalElapsedMs,
    failureSummary: success ? undefined : generateFailureSummary(stepResults),
  };
}

// ============================================================================
// Step Execution
// ============================================================================

interface StepOptions {
  timeout: number;
  variableValues: Record<string, string>;
}

/**
 * Execute a single step based on its pattern type
 */
async function executeStep(
  step: UniversalStep,
  options: StepOptions,
  workflowContext?: WorkflowContext,
  tabManager?: TabManager
): Promise<Omit<StepResult, 'stepIndex' | 'patternType'>> {
  const startTime = Date.now();
  const { pattern, domPath, expectedOutcomes } = step;

  // Handle TAB_SWITCH steps before the normal pattern switch
  if ((pattern as any).type === 'TAB_SWITCH') {
    // Handle tab switching
    console.log('[UniversalOrchestrator] Executing TAB_SWITCH step');
    
    if (!tabManager) {
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'TabManager not initialized for multi-tab workflow',
      };
    }

    const tabSwitchData = (pattern as any).data;
    const toTabIndex = tabSwitchData.toTabIndex;
    const toUrl = tabSwitchData.toUrl;
    
    if (toTabIndex === undefined) {
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'TAB_SWITCH step missing toTabIndex',
      };
    }

    // Check if tab already exists
    if (tabManager.hasTab(toTabIndex)) {
      // Switch to existing tab
      console.log(`[UniversalOrchestrator] Switching to existing tab ${toTabIndex}`);
      const switchSuccess = await tabManager.switchToTab(toTabIndex);
      
      if (!switchSuccess) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: `Failed to switch to tab ${toTabIndex}`,
        };
      }
    } else {
      // Open new tab
      console.log(`[UniversalOrchestrator] Opening new tab ${toTabIndex} at ${toUrl}`);
      const newTabId = await tabManager.openNewTab(toTabIndex, toUrl);
      
      if (!newTabId) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: `Failed to open new tab at ${toUrl}`,
        };
      }
    }

    return {
      success: true,
      elapsedMs: Date.now() - startTime,
      action: {
        success: true,
        actionType: 'tab-switch',
        elapsedMs: Date.now() - startTime,
        strategiesTried: ['tab-switch'],
        successfulStrategy: 'tab-switch',
        details: { tabIndex: toTabIndex, url: toUrl },
      },
    };
  }

  // Handle different pattern types
  switch (pattern.type) {
    case 'DROPDOWN_SELECT': {
      if (!isDropdownPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid dropdown pattern data',
        };
      }

      // Inject variables into option text if needed
      let optionText = pattern.data.selection.optionText;
      optionText = substituteVariables(optionText, options.variableValues);
      
      const modifiedPattern = {
        ...pattern.data,
        selection: {
          ...pattern.data.selection,
          optionText,
        },
      };

      const actionResult = await executeDropdownSelect(modifiedPattern);
      
      return {
        success: actionResult.success,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'SIMPLE_CLICK':
    case 'TOGGLE':
    case 'TAB_SELECT':
    case 'MODAL_TRIGGER': {
      if (!isSimpleClickPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid click pattern data',
        };
      }

      // ===================================================================
      // EXECUTION STRATEGY SELECTION (Based on Recording-Time Analysis)
      // ===================================================================
      const elementAnalysis = step.metadata?.elementAnalysis as any;
      const executionStrategy = elementAnalysis?.executionStrategy || 'AI_RECOMMENDED';
      
      console.log(`[UniversalOrchestrator] 🎯 Execution Strategy: ${executionStrategy}`);
      if (elementAnalysis) {
        console.log(`[UniversalOrchestrator]    Confidence: ${elementAnalysis.confidence}/100`);
        console.log(`[UniversalOrchestrator]    Reasons: ${elementAnalysis.reasons.slice(0, 3).join(', ')}`);
      }

      // ===================================================================
      // SMART PRIORITY: Check if we have annotated screenshot
      // If YES → Try AI Visual Click FIRST (95%+ accuracy)
      // If NO → Use standard selectors first
      // ===================================================================
      const visualSnapshotData = step.metadata?.visualSnapshot as any;
      const hasAnnotatedScreenshot = !!visualSnapshotData?.annotated;
      
      console.log(`[UniversalOrchestrator] Smart Priority - Has annotated screenshot: ${hasAnnotatedScreenshot}`);
      
      let resolution: any = null;
      
      // PRIORITY PATH: AI Visual Click First (if required OR if we have annotated screenshot)
      // Gate behind feature flag
      const shouldUseAI = FeatureFlags.VISION_CLICKER && (
        executionStrategy === 'AI_REQUIRED' || 
        (executionStrategy === 'AI_RECOMMENDED' && hasAnnotatedScreenshot)
      );
      
      if (shouldUseAI && aiConfig.isEnabled()) {
        console.log(`[UniversalOrchestrator] 🎯 Trying AI Visual Click FIRST (annotated screenshot available)...`);
        console.log(`[UniversalOrchestrator] 📍 Current URL: ${window.location.href}`);
        console.log(`[UniversalOrchestrator] 📍 Recorded URL: ${step.metadata?.url || 'unknown'}`);
        
        // Log screenshot metadata to verify we're using the right step's screenshot
        console.log(`[UniversalOrchestrator] 📸 Screenshot from this step:`);
        console.log(`[UniversalOrchestrator]    - Timestamp: ${visualSnapshotData.timestamp ? new Date(visualSnapshotData.timestamp).toLocaleTimeString() : 'N/A'}`);
        console.log(`[UniversalOrchestrator]    - Has annotated: ${!!visualSnapshotData.annotated}`);
        console.log(`[UniversalOrchestrator]    - Has viewport: ${!!visualSnapshotData.viewport}`);
        console.log(`[UniversalOrchestrator]    - Click point: ${visualSnapshotData.clickPoint ? `(${visualSnapshotData.clickPoint.x}, ${visualSnapshotData.clickPoint.y})` : 'N/A'}`);
        console.log(`[UniversalOrchestrator]    - Action type: ${visualSnapshotData.actionType || 'N/A'}`);
        
        // Warn if URLs don't match - AI might fail due to different page state
        const currentUrl = window.location.href;
        const recordedUrl = step.metadata?.url || '';
        const urlsMatch = currentUrl === recordedUrl || 
                          currentUrl.split('?')[0] === recordedUrl.split('?')[0]; // Ignore query params
        
        if (!urlsMatch) {
          console.warn(`[UniversalOrchestrator] ⚠️ URL MISMATCH! Current page doesn't match recorded page.`);
          console.warn(`[UniversalOrchestrator] ⚠️ This means AI is comparing screenshots from DIFFERENT pages!`);
          console.warn(`[UniversalOrchestrator] ⚠️ Element may not exist on current page.`);
          console.warn(`[UniversalOrchestrator] ⚠️ Expected: ${recordedUrl}`);
          console.warn(`[UniversalOrchestrator] ⚠️ Current:  ${currentUrl}`);
        }
        
        try {
          const visualTarget = AIVisualClickService.targetFromSignature(
            pattern.data.target,
            step.description
          );
          
          console.log(`[UniversalOrchestrator] 🎯 Visual target for this step:`, {
            text: visualTarget.text,
            role: visualTarget.role,
            description: visualTarget.description,
          });
          
          const visualHints = AIVisualClickService.hintsFromMetadata(
            step.metadata?.coordinates,
            step.metadata?.elementBounds,
            pattern.data.target.visual?.nearbyLabels
          );
          
          // Add annotated screenshot info
          visualHints.annotatedScreenshot = visualSnapshotData.annotated;
          visualHints.recordedClickPoint = visualSnapshotData.clickPoint;
          visualHints.actionType = visualSnapshotData.actionType;
          
          console.log(`[UniversalOrchestrator] 📸 Sending to AI:`, {
            hasAnnotatedScreenshot: !!visualHints.annotatedScreenshot,
            clickPoint: visualHints.recordedClickPoint,
            actionType: visualHints.actionType,
            recordedBounds: visualHints.recordedBounds,
          });
          
          const recordedSnapshot = visualSnapshotData.annotated || visualSnapshotData.viewport;
          
          const visualResult = await AIVisualClickService.findAndClick(
            visualTarget,
            visualHints,
            recordedSnapshot,
            workflowContext
          );
          
          if (visualResult.success && visualResult.element) {
            console.log(`[UniversalOrchestrator] ✅ AI Visual Click succeeded (primary)! Confidence: ${Math.round(visualResult.confidence * 100)}%`);
            
            return {
              success: true,
              resolution: { 
                status: 'found', 
                element: visualResult.element,
                confidence: visualResult.confidence,
                method: 'ai-visual',
              },
              action: {
                success: true,
                actionType: 'ai-visual-click-primary',
                elapsedMs: visualResult.elapsedMs,
                successfulStrategy: visualResult.method,
                strategiesTried: [`ai-visual-primary-attempt-${visualResult.attempts}`],
              },
              elapsedMs: Date.now() - startTime,
              aiRecovery: {
                used: true,
                method: 'ai-visual',
                confidence: visualResult.confidence,
                reasoning: `Primary strategy (annotated screenshot): ${visualResult.reasoning}`,
              },
            };
          } else {
            console.log(`[UniversalOrchestrator] AI Visual Click failed, falling back to selectors...`);
          }
        } catch (visualError) {
          console.warn(`[UniversalOrchestrator] AI Visual Click error, falling back to selectors:`, visualError);
        }
      }
      
      // FALLBACK PATH: Standard selector resolution
      // For SIMPLE strategy, use fast timeout (2s instead of 10s)
      const selectorTimeout = executionStrategy === 'SIMPLE' ? 2000 : options.timeout;
      
      console.log(`[UniversalOrchestrator] Using standard selector resolution (timeout: ${selectorTimeout}ms)...`);
      resolution = domPath.boundaryType !== 'none'
        ? resolveAcrossBoundaries(domPath, pattern.data.target, { timeout: selectorTimeout })
        : await resolveElement(pattern.data.target, { timeout: selectorTimeout });

      // Check for zero-dimension elements (Salesforce Lightning issue)
      if (resolution.status === 'found') {
        const rect = resolution.element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          console.log(`[UniversalOrchestrator] Element found but has zero dimensions, waiting...`);
          
          const maxWait = 3000;
          const waitStart = Date.now();
          
          while (Date.now() - waitStart < maxWait) {
            await sleep(200);
            const newRect = resolution.element.getBoundingClientRect();
            if (newRect.width > 0 && newRect.height > 0) {
              console.log(`[UniversalOrchestrator] Element now has dimensions: ${newRect.width}x${newRect.height}`);
              break;
            }
          }
          
          const finalRect = resolution.element.getBoundingClientRect();
          if (finalRect.width === 0 || finalRect.height === 0) {
            console.warn(`[UniversalOrchestrator] ❌ Element still zero dimensions - treating as not found`);
            const previousMethod = resolution.method;
            resolution = { 
              status: 'not_found', 
              triedMethods: [previousMethod, 'dimension-check-failed'], 
              lastError: 'Element has zero dimensions (likely wrong element)' 
            };
          }
        }
      }

      // Try AI Visual Click as FALLBACK if element not found AND we didn't already try it as primary
      // Skip AI fallback for SIMPLE strategy (fast path only)
      // Gate behind feature flag
      const shouldTryAIFallback = FeatureFlags.VISION_CLICKER && 
                                   executionStrategy !== 'SIMPLE' && 
                                   resolution.status !== 'found' && 
                                   aiConfig.isEnabled() && 
                                   !hasAnnotatedScreenshot;
      
      if (shouldTryAIFallback) {
        console.log(`[UniversalOrchestrator] 🔍 Trying AI Visual Click as fallback (strategy: ${executionStrategy})...`);
        
        try {
          const visualTarget = AIVisualClickService.targetFromSignature(
            pattern.data.target,
            step.description
          );
          
          console.log('[UniversalOrchestrator] Visual target:', {
            text: visualTarget.text,
            role: visualTarget.role,
            description: visualTarget.description,
          });
          
          // Get visual snapshot with annotations from metadata
          const visualSnapshotData = step.metadata?.visualSnapshot as any;
          
          const visualHints = AIVisualClickService.hintsFromMetadata(
            step.metadata?.coordinates,
            step.metadata?.elementBounds,
            pattern.data.target.visual?.nearbyLabels
          );
          
          // Add annotated screenshot info to hints if available
          if (visualSnapshotData?.annotated) {
            visualHints.annotatedScreenshot = visualSnapshotData.annotated;
            console.log('[UniversalOrchestrator] Using annotated screenshot with visual markers');
          }
          if (visualSnapshotData?.clickPoint) {
            visualHints.recordedClickPoint = visualSnapshotData.clickPoint;
          }
          if (visualSnapshotData?.actionType) {
            visualHints.actionType = visualSnapshotData.actionType;
          }
          
          console.log('[UniversalOrchestrator] Visual hints:', {
            coords: visualHints.approximateCoordinates,
            bounds: visualHints.recordedBounds,
            hasAnnotated: !!visualHints.annotatedScreenshot,
            clickPoint: visualHints.recordedClickPoint,
          });
          
          // Use annotated or original viewport snapshot as reference
          const recordedSnapshot = visualSnapshotData?.annotated || 
                                    visualSnapshotData?.viewport ||
                                    (step.metadata?.viewport as any)?.screenshot;
          
          const visualResult = await AIVisualClickService.findAndClick(
            visualTarget,
            visualHints,
            recordedSnapshot,
            workflowContext
          );
          
          if (visualResult.success && visualResult.element) {
            console.log(`[UniversalOrchestrator] ✅ AI Visual Click succeeded! Confidence: ${Math.round(visualResult.confidence * 100)}%`);
            
            return {
              success: true,
              resolution: { 
                status: 'found', 
                element: visualResult.element,
                confidence: visualResult.confidence,
                method: `visual-ai-${visualResult.method}`,
              },
              action: {
                success: true,
                actionType: 'ai-visual-click',
                elapsedMs: visualResult.elapsedMs,
                successfulStrategy: visualResult.method,
                strategiesTried: [`visual-ai-attempt-${visualResult.attempts}`],
              },
              elapsedMs: Date.now() - startTime,
              aiRecovery: {
                used: true,
                method: 'ai-visual',
                confidence: visualResult.confidence,
                reasoning: visualResult.reasoning,
              },
            };
          }
        } catch (visualError) {
          console.warn(`[UniversalOrchestrator] AI Visual Click error:`, visualError);
        }
      }

      if (resolution.status !== 'found') {
        return {
          success: false,
          resolution,
          elapsedMs: Date.now() - startTime,
          error: `Element not found: ${resolution.status === 'not_found' 
            ? resolution.lastError 
            : 'Ambiguous match'}`,
        };
      }

      const actionResult = await executeHumanClick(resolution.element, pattern.data.target, {
        timeout: Math.max(options.timeout - (Date.now() - startTime), 1000),
        expectedOutcomes,
      });

      return {
        success: actionResult.success,
        resolution,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'TEXT_INPUT': {
      if (!isTextInputPattern(pattern)) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: 'Invalid text input pattern data',
        };
      }

      // Resolve element
      const resolution = domPath.boundaryType !== 'none'
        ? resolveAcrossBoundaries(domPath, pattern.data.input, { timeout: options.timeout })
        : await resolveElement(pattern.data.input, { timeout: options.timeout });

      if (resolution.status !== 'found') {
        return {
          success: false,
          resolution,
          elapsedMs: Date.now() - startTime,
          error: `Input element not found: ${resolution.status === 'not_found' 
            ? resolution.lastError 
            : 'Ambiguous match'}`,
        };
      }

      // Substitute variables in value
      let value = pattern.data.value;
      value = substituteVariables(value, options.variableValues);

      const actionResult = await executeTextInput(resolution.element, value, {
        timeout: Math.max(options.timeout - (Date.now() - startTime), 1000),
        clearFirst: pattern.data.clearFirst,
      });

      return {
        success: actionResult.success,
        resolution,
        action: actionResult,
        elapsedMs: Date.now() - startTime,
        error: actionResult.error,
      };
    }

    case 'AUTOCOMPLETE': {
      // Autocomplete is handled as: type + wait for suggestions + select
      // For now, treat as text input followed by dropdown select
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'Autocomplete pattern not yet implemented',
      };
    }

    case 'MENU_NAVIGATION': {
      // Menu navigation: sequence of hovers/clicks through nested menus
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: 'Menu navigation pattern not yet implemented',
      };
    }

    case 'SCROLL': {
      // Handle scroll step - replay the scroll from recording
      const viewport = step.metadata?.viewport as any;

      try {
        // Check if this is a container scroll or window scroll
        if (viewport?.elementScrollContainer) {
          // Container scroll - find the container and scroll it
          const containerInfo = viewport.elementScrollContainer;
          const containerSelector = containerInfo.selector;
          const scrollTop = containerInfo.scrollTop || 0;
          const scrollLeft = containerInfo.scrollLeft || 0;
          const scrollDeltaX = containerInfo.scrollDeltaX;
          const scrollDeltaY = containerInfo.scrollDeltaY;
          const isDropdownScroll = containerInfo.isDropdownScroll || false;

          // Prefer delta scrolling (relative) when available for more accurate replay
          const useDelta = scrollDeltaX !== undefined || scrollDeltaY !== undefined;

          console.log(`[UniversalOrchestrator] 📜 Replaying container scroll: ${containerSelector} ${useDelta ? `delta=(${scrollDeltaX || 0}, ${scrollDeltaY || 0})` : `to top=${scrollTop}, left=${scrollLeft}`}${isDropdownScroll ? ' (DROPDOWN)' : ''}`);

          // 🎯 For dropdown scrolls, use MenuDetector instead of selector
          let container: Element | null = null;
          if (isDropdownScroll) {
            const { MenuDetector } = await import('../menu-detector');
            const visibleMenu = MenuDetector.findVisibleMenu();

            if (visibleMenu) {
              console.log(`[UniversalOrchestrator] 📜 Found visible dropdown/menu using MenuDetector`);
              container = visibleMenu;
            } else {
              console.warn(`[UniversalOrchestrator] ⚠️ No visible menu found via MenuDetector, falling back to selector`);
            }
          }

          // Fall back to selector-based approach if MenuDetector didn't find anything
          if (!container) {
            try {
              container = document.querySelector(containerSelector);
            } catch (err) {
              // Selector might be invalid, try fallback selectors from payload
              const fallbackSelectors = (step as any).pattern?.data?.fallbackSelectors || [];
              for (const selector of fallbackSelectors) {
                try {
                  container = document.querySelector(selector);
                  if (container) break;
                } catch (e) {
                  // Continue to next selector
                }
              }
            }
          }

          // 🎯 NEW: If container still not found, try modal/popup detection
          // This handles cases where modals are portaled or have dynamic selectors
          if (!container) {
            console.log(`[UniversalOrchestrator] 📜 Selector failed, trying modal/popup detection...`);

            const modalSelectors = [
              '[role="dialog"]',
              '[aria-modal="true"]',
              '.modal',
              '[class*="Modal"]',
              '[class*="dialog"]',
              '[class*="Dialog"]',
              '[class*="popup"]',
              '[class*="Popup"]',
              '[class*="overlay"]',
              '[class*="Overlay"]',
            ];

            // Find all potential modals and check for scrollable containers
            for (const modalSelector of modalSelectors) {
              try {
                const modals = Array.from(document.querySelectorAll(modalSelector));
                for (const modal of modals) {
                  const style = window.getComputedStyle(modal);
                  const isVisible = style.display !== 'none' &&
                                   style.visibility !== 'hidden' &&
                                   style.opacity !== '0';
                  const zIndex = parseInt(style.zIndex) || 0;

                  if (isVisible && zIndex > 50) {
                    // Found an active modal - look for scrollable container within it
                    const scrollableContainer = findScrollableContainerInModal(modal);
                    if (scrollableContainer) {
                      container = scrollableContainer;
                      console.log(`[UniversalOrchestrator] 📜 Found scrollable container inside modal (${modalSelector})`);
                      break;
                    }
                  }
                }
              } catch (e) {
                // Continue to next selector
              }
              if (container) break;
            }
          }

          if (!container) {
            console.warn(`[UniversalOrchestrator] Container not found: ${containerSelector}`);
            return {
              success: false,
              elapsedMs: Date.now() - startTime,
              error: `Scroll container not found: ${containerSelector}`,
            };
          }

          // Validate container is actually scrollable
          const containerStyle = window.getComputedStyle(container);
          const isScrollable = container.scrollHeight > container.clientHeight ||
                              container.scrollWidth > container.clientWidth ||
                              containerStyle.overflow === 'auto' ||
                              containerStyle.overflow === 'scroll' ||
                              containerStyle.overflowY === 'auto' ||
                              containerStyle.overflowY === 'scroll';

          if (!isScrollable) {
            console.warn(`[UniversalOrchestrator] ⚠️ Container found but not scrollable, attempting scroll anyway`);
          }

          // Scroll the container - prefer delta (relative) scrolling when available
          if (useDelta) {
            container.scrollBy({
              top: scrollDeltaY || 0,
              left: scrollDeltaX || 0,
              behavior: 'smooth',
            });
          } else {
            container.scrollTop = scrollTop;
            container.scrollLeft = scrollLeft;
          }

          // Wait for scroll to complete
          await sleep(300);

          return {
            success: true,
            elapsedMs: Date.now() - startTime,
          };
        } else {
          // Window scroll - but first check if there's an active modal/popup
          // If a modal is open, the scroll should happen within it, not on the window
          const scrollX = viewport?.scrollX || 0;
          const scrollY = viewport?.scrollY || 0;
          const scrollDeltaX = viewport?.scrollDeltaX;
          const scrollDeltaY = viewport?.scrollDeltaY;
          const useDelta = scrollDeltaX !== undefined || scrollDeltaY !== undefined;

          // Check for active modals/popups first
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

          let modalScrollContainer: Element | null = null;
          for (const modalSelector of modalSelectors) {
            try {
              const modals = Array.from(document.querySelectorAll(modalSelector));
              for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                const isVisible = style.display !== 'none' &&
                                 style.visibility !== 'hidden' &&
                                 style.opacity !== '0';
                const zIndex = parseInt(style.zIndex) || 0;

                if (isVisible && zIndex > 50) {
                  const scrollableContainer = findScrollableContainerInModal(modal);
                  if (scrollableContainer) {
                    modalScrollContainer = scrollableContainer;
                    console.log(`[UniversalOrchestrator] 📜 Found active modal with scrollable content, scrolling modal instead of window`);
                    break;
                  }
                }
              }
            } catch (e) {
              // Continue
            }
            if (modalScrollContainer) break;
          }

          if (modalScrollContainer) {
            // Scroll within the modal instead of the window
            if (useDelta) {
              modalScrollContainer.scrollBy({
                top: scrollDeltaY || 0,
                left: scrollDeltaX || 0,
                behavior: 'smooth',
              });
            } else {
              modalScrollContainer.scrollTop = scrollY;
              modalScrollContainer.scrollLeft = scrollX;
            }
            await sleep(300);
            return {
              success: true,
              elapsedMs: Date.now() - startTime,
            };
          }

          // No modal found, proceed with window scroll
          console.log(`[UniversalOrchestrator] 📜 Replaying window scroll ${useDelta ? `delta=(${scrollDeltaX || 0}, ${scrollDeltaY || 0})` : `to x=${scrollX}, y=${scrollY}`}`);

          if (useDelta) {
            window.scrollBy({
              top: scrollDeltaY || 0,
              left: scrollDeltaX || 0,
              behavior: 'smooth',
            });
          } else {
            window.scrollTo({
              top: scrollY,
              left: scrollX,
              behavior: 'smooth',
            });
          }

          // Wait for scroll to complete
          await sleep(500);

          return {
            success: true,
            elapsedMs: Date.now() - startTime,
          };
        }
      } catch (error) {
        return {
          success: false,
          elapsedMs: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Scroll execution failed',
        };
      }
    }

    default:
      return {
        success: false,
        elapsedMs: Date.now() - startTime,
        error: `Unknown pattern type: ${(pattern as any).type}`,
      };
  }
}

// ============================================================================
// Variable Substitution
// ============================================================================

/**
 * Substitute {{variable}} patterns in a string
 */
function substituteVariables(
  text: string,
  variables: Record<string, string>
): string {
  if (!text || Object.keys(variables).length === 0) {
    return text;
  }

  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in variables) {
      return variables[varName];
    }
    return match; // Keep original if not found
  });
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Generate failure summary from step results
 */
function generateFailureSummary(stepResults: StepResult[]): string {
  const failedSteps = stepResults.filter(r => !r.success);
  
  if (failedSteps.length === 0) {
    return 'No failures';
  }

  const summaries = failedSteps.map(step => {
    const stepNum = step.stepIndex + 1;
    const pattern = step.patternType;
    const error = step.error || 'Unknown error';
    return `Step ${stepNum} (${pattern}): ${error}`;
  });

  return summaries.join('; ');
}

// ============================================================================
// Legacy Step Conversion
// ============================================================================

/**
 * Convert a legacy WorkflowStep to UniversalStep
 * This allows gradual migration to the new system
 */
export function convertLegacyStep(
  legacyStep: {
    type: string;
    payload: any;
    description?: string;
  }
): UniversalStep {
  const payload = legacyStep.payload;
  
  // Handle TAB_SWITCH steps specially - they don't have element signatures
  if (legacyStep.type === 'TAB_SWITCH') {
    const tabSwitchPayload = payload as TabSwitchPayload;
    return {
      type: 'TAB_SWITCH',
      description: legacyStep.description || `Switch to tab: ${tabSwitchPayload.toTitle || tabSwitchPayload.toUrl}`,
      pattern: {
        type: 'TAB_SWITCH',
        data: {
          fromTabIndex: tabSwitchPayload.fromTabIndex,
          toTabIndex: tabSwitchPayload.toTabIndex,
          toUrl: tabSwitchPayload.toUrl,
          toTitle: tabSwitchPayload.toTitle,
        },
      } as any,
      domPath: {
        boundaryType: 'none',
        steps: [],
      },
      metadata: {
        timestamp: tabSwitchPayload.timestamp || Date.now(),
        url: tabSwitchPayload.toUrl,
      },
    };
  }
  
  // Build a basic signature from legacy data
  const signature: ElementSignature = {
    identity: {
      testId: payload.context?.uniqueAttributes?.['data-testid'],
      ariaLabel: getElementLabel(
        payload.aiEvidence, 
        payload.label, 
        payload.context?.uniqueAttributes,
        payload.context?.formCoordinates,
        payload.context?.uniqueAttributes?.placeholder
      ),
      role: payload.elementRole,
      name: payload.label,
    },
    text: {
      exact: payload.elementText,
      normalized: payload.elementText?.toLowerCase(),
    },
    structure: {
      tagName: payload.selector?.split(/[.#\[\s]/)[0]?.toUpperCase() || 'DIV',
    },
    visual: {
      landmark: payload.aiEvidence?.semanticAnchors?.nearbyText?.[0],
      formContext: payload.context?.formContext?.formId,
      nearbyLabels: payload.aiEvidence?.semanticAnchors?.nearbyText,
    },
    selectors: {
      stable: payload.selector,
      specific: payload.fallbackSelectors?.[0],
      xpath: payload.xpath,
    },
  };

  // Determine pattern based on step type and context
  let pattern: ComponentPattern;
  
  if (legacyStep.type === 'INPUT') {
    pattern = {
      type: 'TEXT_INPUT',
      data: {
        input: signature,
        value: payload.value || '',
        clearFirst: true,
        inputType: payload.inputDetails?.type || 'text',
      },
    };
  } else if (legacyStep.type === 'SCROLL') {
    // Handle scroll steps - store the scroll info in pattern data
    pattern = {
      type: 'SCROLL',
      data: {
        selector: payload.selector || 'body',
        fallbackSelectors: payload.fallbackSelectors || ['body', 'html'],
        viewport: payload.viewport,
      },
    } as any; // Cast as any since SCROLL is not a standard ComponentPattern type
  } else if (legacyStep.type === 'CLICK' && payload.elementRole === 'combobox') {
    // This might be a dropdown trigger
    pattern = {
      type: 'DROPDOWN_SELECT',
      data: {
        trigger: signature,
        selection: {
          optionText: payload.elementText || '',
        },
      },
    };
  } else {
    pattern = {
      type: 'SIMPLE_CLICK',
      data: {
        target: signature,
      },
    };
  }

  return {
    type: legacyStep.type,
    description: legacyStep.description,
    pattern,
    domPath: {
      boundaryType: payload.shadowPath?.length > 0 ? 'shadow' : 'none',
      steps: [],
    },
    metadata: {
      timestamp: payload.timestamp || Date.now(),
      url: payload.url || window.location.href,
      viewport: payload.viewport,
      // Include coordinates for AI Visual Click fallback
      coordinates: payload.eventDetails?.coordinates,
      elementBounds: payload.elementBounds,
      // Include visual snapshot for AI Visual Click with annotations
      visualSnapshot: payload.visualSnapshot,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a scrollable container within a modal element.
 * Searches for the most likely scroll container by checking overflow CSS and actual scrollability.
 */
function findScrollableContainerInModal(modal: Element): Element | null {
  // First check if the modal itself is scrollable
  const modalStyle = window.getComputedStyle(modal);
  const modalScrollable = modal.scrollHeight > modal.clientHeight ||
                          modalStyle.overflow === 'auto' ||
                          modalStyle.overflow === 'scroll' ||
                          modalStyle.overflowY === 'auto' ||
                          modalStyle.overflowY === 'scroll';

  if (modalScrollable && modal.scrollHeight > modal.clientHeight) {
    return modal;
  }

  // Search for scrollable children within the modal
  const candidates = modal.querySelectorAll('*');
  let bestCandidate: Element | null = null;
  let maxScrollHeight = 0;

  for (const el of Array.from(candidates)) {
    const style = window.getComputedStyle(el);
    const hasOverflow = style.overflow === 'auto' ||
                       style.overflow === 'scroll' ||
                       style.overflowY === 'auto' ||
                       style.overflowY === 'scroll';

    if (hasOverflow && el.scrollHeight > el.clientHeight) {
      // Prefer larger scroll areas (likely the main content)
      if (el.scrollHeight > maxScrollHeight) {
        maxScrollHeight = el.scrollHeight;
        bestCandidate = el;
      }
    }
  }

  return bestCandidate;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Infer the overall workflow goal from step descriptions
 */
function inferWorkflowGoal(steps: UniversalStep[]): string | undefined {
  if (steps.length === 0) return undefined;
  
  // Look for common patterns in step descriptions
  const descriptions = steps.map(s => s.description || '').join(' ').toLowerCase();
  
  if (descriptions.includes('create') && descriptions.includes('account')) {
    return 'Create new account';
  }
  if (descriptions.includes('new account')) {
    return 'Create new account';
  }
  if (descriptions.includes('edit') || descriptions.includes('update')) {
    return 'Edit/update record';
  }
  if (descriptions.includes('delete')) {
    return 'Delete record';
  }
  if (descriptions.includes('search') || descriptions.includes('find')) {
    return 'Search for record';
  }
  
  // Generic goal based on first step
  const firstStep = steps[0].description;
  if (firstStep && firstStep.length > 0) {
    return firstStep;
  }
  
  return undefined;
}

