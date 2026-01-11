/**
 * Execution Telemetry
 * Tracks execution results to feed learning systems
 * 
 * Pattern: Follows correction-memory.ts pattern with chrome.storage.local
 */

import { SelectorReliability } from './selector-reliability';
import { SiteKnowledgeBase } from './site-knowledge';
import { WorkflowStorage } from './storage';

const EXECUTION_EVENTS_KEY = 'ghostwriter-execution-events';
const MAX_EVENTS = 100; // Keep last 100 execution events

export interface StepResult {
  index: number;
  selector: string;
  success: boolean;
  resolutionMs: number;
  recoveryAttempts: number;
}

export interface ExecutionEvent {
  workflowId: string;
  timestamp: number;
  success: boolean;
  durationMs: number;
  stepsCompleted: number;
  totalSteps: number;
  failedStepIndex?: number;
  failureReason?: string;
  siteUrl: string;
  
  // Per-step telemetry
  stepResults: StepResult[];
}

export interface ExecutionEventsDB {
  events: ExecutionEvent[];
  version: number;
  lastUpdated: number;
}

export class ExecutionTelemetry {
  /**
   * Record execution completion
   */
  static async recordExecution(event: ExecutionEvent): Promise<void> {
    try {
      const db = await this.loadDatabase();
      
      // Add event
      db.events.unshift(event);
      
      // LRU eviction if needed
      if (db.events.length > MAX_EVENTS) {
        db.events = db.events.slice(0, MAX_EVENTS);
      }
      
      db.lastUpdated = Date.now();
      await this.saveDatabase(db);
      
      console.log(`ExecutionTelemetry: Recorded ${event.success ? 'successful' : 'failed'} execution of workflow ${event.workflowId}`);
      
      // Feed to learning systems (async, non-blocking)
      this.processForLearning(event).catch(err => {
        console.warn('ExecutionTelemetry: Failed to process for learning:', err);
      });
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to record execution:', error);
    }
  }

  /**
   * Update workflow statistics
   */
  static async updateWorkflowStats(workflowId: string, event: ExecutionEvent): Promise<void> {
    try {
      const workflow = await WorkflowStorage.loadWorkflow(workflowId);
      if (!workflow) {
        console.warn('ExecutionTelemetry: Workflow not found:', workflowId);
        return;
      }

      // Initialize or update execution stats
      if (!workflow.executionStats) {
        workflow.executionStats = {
          totalRuns: 0,
          successfulRuns: 0,
          lastRun: 0,
          averageDurationMs: 0,
          commonFailurePoints: [],
        };
      }

      const stats = workflow.executionStats;
      
      // Update counters
      stats.totalRuns++;
      if (event.success) {
        stats.successfulRuns++;
      }
      stats.lastRun = event.timestamp;
      
      // Update average duration (weighted average)
      if (stats.totalRuns === 1) {
        stats.averageDurationMs = event.durationMs;
      } else {
        stats.averageDurationMs = 
          (stats.averageDurationMs * (stats.totalRuns - 1) + event.durationMs) / stats.totalRuns;
      }
      
      // Track failure points
      if (!event.success && event.failedStepIndex !== undefined) {
        if (!stats.commonFailurePoints.includes(event.failedStepIndex)) {
          stats.commonFailurePoints.push(event.failedStepIndex);
        }
      }
      
      // Save updated workflow
      await WorkflowStorage.saveWorkflow(workflow);
      console.log(`ExecutionTelemetry: Updated stats for workflow ${workflowId}`);
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to update workflow stats:', error);
    }
  }

  /**
   * Feed learning systems
   */
  static async processForLearning(event: ExecutionEvent): Promise<void> {
    try {
      // Batch update selector reliability
      const selectorResults = event.stepResults.map(step => ({
        selector: step.selector,
        siteUrl: event.siteUrl,
        success: step.success,
        resolutionMs: step.resolutionMs,
      }));
      
      await SelectorReliability.batchUpdate(selectorResults);
      
      // Reinforce site patterns (for successful executions)
      if (event.success) {
        const site = this.extractSitePattern(event.siteUrl);
        const usedPatterns = event.stepResults
          .filter(s => s.success)
          .map(s => s.selector);
        
        await SiteKnowledgeBase.reinforcePatterns(site, usedPatterns);
      }
      
      console.log(`ExecutionTelemetry: Processed ${event.stepResults.length} steps for learning`);
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to process for learning:', error);
    }
  }

  /**
   * Get recent execution events (for debugging)
   */
  static async getRecentEvents(limit: number = 10): Promise<ExecutionEvent[]> {
    const db = await this.loadDatabase();
    return db.events.slice(0, limit);
  }

  /**
   * Get execution stats for a workflow
   */
  static async getWorkflowStats(workflowId: string): Promise<{
    totalRuns: number;
    successfulRuns: number;
    successRate: number;
    averageDurationMs: number;
  } | null> {
    try {
      const db = await this.loadDatabase();
      const workflowEvents = db.events.filter(e => e.workflowId === workflowId);
      
      if (workflowEvents.length === 0) {
        return null;
      }
      
      const totalRuns = workflowEvents.length;
      const successfulRuns = workflowEvents.filter(e => e.success).length;
      const successRate = successfulRuns / totalRuns;
      const averageDurationMs = workflowEvents.reduce((sum, e) => sum + e.durationMs, 0) / totalRuns;
      
      return {
        totalRuns,
        successfulRuns,
        successRate,
        averageDurationMs,
      };
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to get workflow stats:', error);
      return null;
    }
  }

  /**
   * Clear all execution events
   */
  static async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.remove(EXECUTION_EVENTS_KEY);
      console.log('ExecutionTelemetry: All execution events cleared');
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to clear execution events:', error);
    }
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Load database from storage
   */
  private static async loadDatabase(): Promise<ExecutionEventsDB> {
    try {
      const result = await chrome.storage.local.get(EXECUTION_EVENTS_KEY);
      const db = result[EXECUTION_EVENTS_KEY] as ExecutionEventsDB | undefined;

      if (db && Array.isArray(db.events)) {
        return db;
      }

      // Return empty database
      return {
        events: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.warn('ExecutionTelemetry: Failed to load database:', error);
      return {
        events: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Save database to storage
   */
  private static async saveDatabase(db: ExecutionEventsDB): Promise<void> {
    await chrome.storage.local.set({ [EXECUTION_EVENTS_KEY]: db });
  }

  /**
   * Extract site pattern from URL (domain only)
   */
  private static extractSitePattern(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (e) {
      return '*';
    }
  }
}
