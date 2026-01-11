/**
 * Selector Reliability Tracking
 * Learns which selectors work reliably per site to prioritize them during replay
 * 
 * Pattern: Follows correction-memory.ts pattern with chrome.storage.local
 */

const SELECTOR_RELIABILITY_KEY = 'ghostwriter-selector-reliability';
const MAX_SELECTOR_RECORDS = 500; // LRU eviction threshold

export interface SelectorRecord {
  selector: string;
  sitePattern: string;    // "salesforce.com", "*.hubspot.com"
  elementContext: {
    role?: string;
    label?: string;
    pageType?: string;
  };
  successCount: number;
  failureCount: number;
  lastUsed: number;
  averageResolutionMs: number;
}

export interface SelectorReliabilityDB {
  records: SelectorRecord[];
  version: number;
  lastUpdated: number;
}

export class SelectorReliability {
  /**
   * Track execution result for a selector
   */
  static async trackResult(
    selector: string,
    siteUrl: string,
    success: boolean,
    resolutionMs?: number
  ): Promise<void> {
    try {
      const db = await this.loadDatabase();
      const sitePattern = this.extractSitePattern(siteUrl);
      
      // Find existing record
      let record = db.records.find(
        r => r.selector === selector && r.sitePattern === sitePattern
      );

      if (record) {
        // Update existing record
        if (success) {
          record.successCount++;
        } else {
          record.failureCount++;
        }
        record.lastUsed = Date.now();
        
        // Update average resolution time (weighted average)
        if (resolutionMs !== undefined && success) {
          const totalAttempts = record.successCount + record.failureCount;
          record.averageResolutionMs = 
            (record.averageResolutionMs * (totalAttempts - 1) + resolutionMs) / totalAttempts;
        }
      } else {
        // Create new record
        record = {
          selector,
          sitePattern,
          elementContext: {},
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1,
          lastUsed: Date.now(),
          averageResolutionMs: resolutionMs || 0,
        };
        db.records.push(record);
      }

      // LRU eviction if needed
      if (db.records.length > MAX_SELECTOR_RECORDS) {
        db.records.sort((a, b) => b.lastUsed - a.lastUsed);
        db.records = db.records.slice(0, MAX_SELECTOR_RECORDS);
      }

      db.lastUpdated = Date.now();
      await this.saveDatabase(db);
    } catch (error) {
      console.warn('SelectorReliability: Failed to track result:', error);
    }
  }

  /**
   * Get reliability score for a selector (0-1)
   */
  static async getReliabilityScore(selector: string, siteUrl: string): Promise<number> {
    try {
      const db = await this.loadDatabase();
      const sitePattern = this.extractSitePattern(siteUrl);
      
      const record = db.records.find(
        r => r.selector === selector && r.sitePattern === sitePattern
      );

      if (!record) {
        return 0.5; // Neutral score for unknown selectors
      }

      const total = record.successCount + record.failureCount;
      if (total === 0) {
        return 0.5;
      }

      // Base score: success rate
      let score = record.successCount / total;

      // Boost for frequently used selectors (confidence)
      const confidenceBoost = Math.min(total / 10, 1.0) * 0.1;
      score += confidenceBoost;

      // Penalty for slow selectors
      if (record.averageResolutionMs > 1000) {
        score -= 0.05;
      }

      return Math.max(0, Math.min(1, score));
    } catch (error) {
      console.warn('SelectorReliability: Failed to get score:', error);
      return 0.5;
    }
  }

  /**
   * Get best selector from alternatives based on reliability
   */
  static async getBestSelector(selectors: string[], siteUrl: string): Promise<string> {
    if (selectors.length === 0) {
      throw new Error('No selectors provided');
    }
    if (selectors.length === 1) {
      return selectors[0];
    }

    try {
      // Score all selectors
      const scored = await Promise.all(
        selectors.map(async (selector) => ({
          selector,
          score: await this.getReliabilityScore(selector, siteUrl),
        }))
      );

      // Sort by score (descending)
      scored.sort((a, b) => b.score - a.score);

      return scored[0].selector;
    } catch (error) {
      console.warn('SelectorReliability: Failed to get best selector:', error);
      return selectors[0]; // Fallback to first selector
    }
  }

  /**
   * Sort selectors by reliability score (highest first)
   */
  static async sortByReliability(selectors: string[], siteUrl: string): Promise<string[]> {
    if (selectors.length <= 1) {
      return selectors;
    }

    try {
      // Score all selectors
      const scored = await Promise.all(
        selectors.map(async (selector) => ({
          selector,
          score: await this.getReliabilityScore(selector, siteUrl),
        }))
      );

      // Sort by score (descending)
      scored.sort((a, b) => b.score - a.score);

      return scored.map(s => s.selector);
    } catch (error) {
      console.warn('SelectorReliability: Failed to sort selectors:', error);
      return selectors; // Return original order on error
    }
  }

  /**
   * Batch update from execution telemetry
   */
  static async batchUpdate(
    stepResults: Array<{
      selector: string;
      siteUrl: string;
      success: boolean;
      resolutionMs?: number;
    }>
  ): Promise<void> {
    for (const result of stepResults) {
      await this.trackResult(
        result.selector,
        result.siteUrl,
        result.success,
        result.resolutionMs
      );
    }
  }

  /**
   * Prune old/unreliable records
   */
  static async pruneDatabase(): Promise<void> {
    try {
      const db = await this.loadDatabase();
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

      // Remove records that:
      // 1. Haven't been used in 30 days
      // 2. Have very low success rate (< 20%) and few attempts
      db.records = db.records.filter(record => {
        const age = now - record.lastUsed;
        const total = record.successCount + record.failureCount;
        const successRate = total > 0 ? record.successCount / total : 0;

        // Keep if used recently
        if (age < THIRTY_DAYS) {
          return true;
        }

        // Keep if reliable or well-tested
        if (successRate > 0.2 || total > 10) {
          return true;
        }

        return false;
      });

      db.lastUpdated = Date.now();
      await this.saveDatabase(db);
      console.log(`SelectorReliability: Pruned to ${db.records.length} records`);
    } catch (error) {
      console.warn('SelectorReliability: Failed to prune database:', error);
    }
  }

  /**
   * Get all records for debugging/review
   */
  static async getAllRecords(): Promise<SelectorRecord[]> {
    const db = await this.loadDatabase();
    return db.records;
  }

  /**
   * Clear all records
   */
  static async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.remove(SELECTOR_RELIABILITY_KEY);
      console.log('SelectorReliability: All records cleared');
    } catch (error) {
      console.warn('SelectorReliability: Failed to clear records:', error);
    }
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Load database from storage
   */
  private static async loadDatabase(): Promise<SelectorReliabilityDB> {
    try {
      const result = await chrome.storage.local.get(SELECTOR_RELIABILITY_KEY);
      const db = result[SELECTOR_RELIABILITY_KEY] as SelectorReliabilityDB | undefined;

      if (db && Array.isArray(db.records)) {
        return db;
      }

      // Return empty database
      return {
        records: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.warn('SelectorReliability: Failed to load database:', error);
      return {
        records: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Save database to storage
   */
  private static async saveDatabase(db: SelectorReliabilityDB): Promise<void> {
    await chrome.storage.local.set({ [SELECTOR_RELIABILITY_KEY]: db });
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
