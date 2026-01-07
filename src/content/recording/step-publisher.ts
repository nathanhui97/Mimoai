/**
 * StepPublisher - Sends recorded workflow steps to the side panel
 * 
 * Handles the communication between content script and extension UI,
 * including step messages and description updates.
 */

import type { WorkflowStep } from '../../types/workflow';
import { isWorkflowStepPayload } from '../../types/workflow';
import type { RecordedStepMessage, UpdateStepMessage } from '../../types/messages';
import { AIService } from '../../lib/ai-service';

export interface StepPublisherContext {
  currentTabUrl: string | null;
  currentTabTitle: string | null;
  currentTabIndex: number | null;
}

/**
 * StepPublisher handles sending workflow steps to the extension UI
 * and generating AI descriptions asynchronously.
 */
export class StepPublisher {
  private getContext: () => StepPublisherContext;

  constructor(getContext: () => StepPublisherContext) {
    this.getContext = getContext;
  }

  /**
   * Send a workflow step to the side panel
   */
  sendStep(step: WorkflowStep): void {
    try {
      const context = this.getContext();
      
      // Debug: Verify visualSnapshot is in the step before sending
      if (isWorkflowStepPayload(step.payload)) {
        const hasVisualSnapshot = !!step.payload.visualSnapshot;
        if (hasVisualSnapshot && step.payload.visualSnapshot) {
          const snapshot = step.payload.visualSnapshot;
          console.log('📸 GhostWriter: Sending step with visualSnapshot - viewport:', snapshot.viewport?.substring(0, 50) || 'missing', '...');
        } else {
          console.warn('📸 GhostWriter: Sending step WITHOUT visualSnapshot');
        }
      }

      chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        payload: { 
          step,
          tabUrl: context.currentTabUrl || undefined,
          tabTitle: context.currentTabTitle || undefined,
          tabIndex: context.currentTabIndex !== null ? context.currentTabIndex : undefined,
        },
      } as RecordedStepMessage);
      
      // Generate description asynchronously (non-blocking)
      this.generateStepDescription(step).catch((error) => {
        console.warn('GhostWriter: Failed to generate step description:', error);
      });
    } catch (error) {
      console.error('Error sending step:', error);
    }
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
        } as UpdateStepMessage);
        
        console.log(`📝 GhostWriter: Generated description for step: "${result.description}"`);
      }
    } catch (error) {
      // Fail silently - description is enhancement
      console.warn('GhostWriter: Description generation failed:', error);
    }
  }
}

