/**
 * Step Converter - Converts WorkflowSteps to AgentActions
 *
 * This module handles the conversion of recorded workflow steps into
 * executable agent actions for the Tier1Executor.
 */

import type { WorkflowStep, WorkflowStepPayload, TabSwitchPayload } from '../../types/workflow';
import type { AgentAction, AgentActionType, SemanticTarget } from '../ai-agent';
import { isWorkflowStepPayload } from '../../types/workflow';
import { getElementLabel } from '../label-utils';

/**
 * Convert a WorkflowStep to an AgentAction for execution
 */
export async function convertStepToAction(
  step: WorkflowStep,
  variableValues: Record<string, string>
): Promise<AgentAction> {
  const { type, payload } = step;

  // Handle TAB_SWITCH specially
  if (type === 'TAB_SWITCH') {
    const tabPayload = payload as TabSwitchPayload;
    return {
      type: 'tab_switch',
      params: {
        toTabIndex: tabPayload.toTabIndex,
        toUrl: tabPayload.toUrl,
        toTitle: tabPayload.toTitle,
        isNewTab: tabPayload.isNewTab,
      },
      reasoning: `Switch to tab ${tabPayload.toTabIndex}`,
      confidence: 1.0,
    };
  }

  // Validate it's a WorkflowStepPayload
  if (!isWorkflowStepPayload(payload)) {
    throw new Error(`Unexpected payload type for step: ${type}`);
  }

  // Build semantic target from payload
  const target = buildSemanticTarget(payload);

  // Get action type
  const actionType = mapStepTypeToActionType(type);

  // Build action based on type
  switch (type) {
    case 'CLICK':
      return buildClickAction(payload, target);

    case 'INPUT':
      return buildInputAction(payload, target, variableValues);

    case 'KEYBOARD':
      return buildKeyboardAction(payload, target);

    case 'SCROLL':
      return buildScrollAction(payload, target);

    case 'NAVIGATION':
      return buildNavigationAction(payload, variableValues);

    case 'COPY':
      return buildCopyAction(payload, target);

    case 'PASTE':
      return buildPasteAction(payload, target, variableValues);

    default:
      return {
        type: actionType,
        params: { target },
        reasoning: step.description || `Execute ${type}`,
        confidence: 0.8,
      };
  }
}

/**
 * Map WorkflowStepType to AgentActionType
 */
function mapStepTypeToActionType(type: string): AgentActionType {
  const mapping: Record<string, AgentActionType> = {
    CLICK: 'click',
    INPUT: 'type',
    NAVIGATION: 'navigate',
    KEYBOARD: 'keyboard',
    SCROLL: 'scroll',
    TAB_SWITCH: 'tab_switch',
    COPY: 'copy',
    PASTE: 'paste',
  };
  return mapping[type] || 'click';
}

/**
 * Build semantic target from WorkflowStepPayload
 */
function buildSemanticTarget(payload: WorkflowStepPayload): SemanticTarget {
  const target: SemanticTarget = {};

  // Get label using the utility function
  const label = getElementLabel(payload.aiEvidence);
  if (label) {
    target.name = label;
  }

  // Set role from payload
  if (payload.elementRole) {
    target.role = payload.elementRole;
  }

  // Set test ID if available
  const testIdStrategy = payload.locatorBundle?.strategies?.find(s => s.type === 'testid');
  if (testIdStrategy) {
    target.testId = testIdStrategy.value;
  }

  // Set scope hint from container context
  if (payload.context?.container?.text) {
    target.scopeHint = payload.context.container.text;
  } else if (payload.aiWidgetContext?.widgetTitle) {
    target.recordedScopeHint = payload.aiWidgetContext.widgetTitle;
  }

  // Set nearby text for disambiguation
  if (payload.aiEvidence?.semanticAnchors?.nearbyText) {
    target.nearbyText = payload.aiEvidence.semanticAnchors.nearbyText;
  }

  // Set text content
  if (payload.elementText) {
    target.text = payload.elementText;
  }

  // Set placeholder for inputs
  if (payload.inputDetails && payload.label) {
    target.placeholder = payload.label;
  }

  // Add recorded fallback selectors
  if (payload.fallbackSelectors && payload.fallbackSelectors.length > 0) {
    target.recordedFallbackSelectors = payload.fallbackSelectors;
  }

  return target;
}

/**
 * Build click action
 */
function buildClickAction(payload: WorkflowStepPayload, target: SemanticTarget): AgentAction {
  const action: AgentAction = {
    type: 'click',
    params: { target },
    reasoning: `Click on ${target.name || target.text || 'element'}`,
    confidence: payload.locatorQuality?.confidenceScore || 0.8,
  };

  // Check for double-click
  if (payload.eventDetails?.eventSequence?.filter(e => e === 'click').length === 2) {
    action.type = 'double_click';
    action.reasoning = `Double-click on ${target.name || target.text || 'element'}`;
  }

  // Check for right-click
  if (payload.eventDetails?.mouseButton === 'right') {
    action.type = 'right_click';
    action.reasoning = `Right-click on ${target.name || target.text || 'element'}`;
  }

  // Add decision space for dropdowns
  if (payload.context?.decisionSpace) {
    action.params.decisionSpace = payload.context.decisionSpace;
  }

  return action;
}

/**
 * Build input/type action
 */
function buildInputAction(
  payload: WorkflowStepPayload,
  target: SemanticTarget,
  variableValues: Record<string, string>
): AgentAction {
  let value = payload.value || '';

  // Substitute variables
  for (const [varName, varValue] of Object.entries(variableValues)) {
    // Handle both {{variable}} and {variable} patterns
    value = value.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), varValue);
    value = value.replace(new RegExp(`\\{${varName}\\}`, 'g'), varValue);
  }

  return {
    type: 'type',
    params: {
      target,
      text: value,
      clearFirst: true,
    },
    reasoning: `Type "${value}" into ${target.name || 'field'}`,
    confidence: payload.locatorQuality?.confidenceScore || 0.8,
  };
}

/**
 * Build keyboard action
 */
function buildKeyboardAction(payload: WorkflowStepPayload, target: SemanticTarget): AgentAction {
  const keyDetails = payload.keyboardDetails;

  return {
    type: 'keyboard',
    params: {
      target,
      key: keyDetails?.key || 'Enter',
      modifiers: keyDetails?.modifiers ?
        Object.entries(keyDetails.modifiers)
          .filter(([, v]) => v)
          .map(([k]) => k as 'ctrl' | 'shift' | 'alt' | 'meta') :
        undefined,
    },
    reasoning: `Press ${keyDetails?.key || 'key'}`,
    confidence: 1.0,
  };
}

/**
 * Build scroll action
 */
function buildScrollAction(payload: WorkflowStepPayload, target: SemanticTarget): AgentAction {
  const viewport = payload.viewport;

  // Determine scroll direction and amount
  let direction: 'up' | 'down' | 'left' | 'right' = 'down';
  let amount = 200;

  if (viewport?.scrollDeltaY) {
    direction = viewport.scrollDeltaY > 0 ? 'down' : 'up';
    amount = Math.abs(viewport.scrollDeltaY);
  } else if (viewport?.scrollDeltaX) {
    direction = viewport.scrollDeltaX > 0 ? 'right' : 'left';
    amount = Math.abs(viewport.scrollDeltaX);
  }

  return {
    type: 'scroll',
    params: {
      target,
      direction,
      amount,
      scrollContainerSelector: viewport?.elementScrollContainer?.selector,
    },
    reasoning: `Scroll ${direction} by ${amount}px`,
    confidence: 1.0,
  };
}

/**
 * Build navigation action
 */
function buildNavigationAction(
  payload: WorkflowStepPayload,
  variableValues: Record<string, string>
): AgentAction {
  let url = payload.url || '';

  // Substitute variables in URL
  for (const [varName, varValue] of Object.entries(variableValues)) {
    url = url.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), varValue);
    url = url.replace(new RegExp(`\\{${varName}\\}`, 'g'), varValue);
  }

  return {
    type: 'navigate',
    params: { url },
    reasoning: `Navigate to ${url}`,
    confidence: 1.0,
  };
}

/**
 * Build copy action
 */
function buildCopyAction(payload: WorkflowStepPayload, target: SemanticTarget): AgentAction {
  return {
    type: 'copy',
    params: {
      target,
      selectAll: payload.clipboardDetails?.selectAll ?? true,
    },
    reasoning: `Copy text from ${target.name || 'element'}`,
    confidence: 0.9,
  };
}

/**
 * Build paste action
 */
function buildPasteAction(
  payload: WorkflowStepPayload,
  target: SemanticTarget,
  variableValues: Record<string, string>
): AgentAction {
  let text = payload.clipboardDetails?.text || '';

  // Substitute variables
  for (const [varName, varValue] of Object.entries(variableValues)) {
    text = text.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), varValue);
    text = text.replace(new RegExp(`\\{${varName}\\}`, 'g'), varValue);
  }

  return {
    type: 'paste',
    params: {
      target,
      text,
      linkedCopyStepId: payload.clipboardDetails?.linkedCopyStepId,
    },
    reasoning: `Paste "${text.substring(0, 50)}..." into ${target.name || 'field'}`,
    confidence: 0.9,
  };
}
