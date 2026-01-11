/**
 * Site Knowledge Base
 * Extracts and stores navigation patterns, common element selectors, and page structures per site
 * 
 * Pattern: Follows correction-memory.ts pattern with chrome.storage.local
 */

import type { SavedWorkflow } from '../types/workflow';
import type { PageType } from '../types/visual';

const SITE_KNOWLEDGE_KEY = 'ghostwriter-site-knowledge';
const MAX_SITES = 50; // Maximum sites to track

export interface SiteKnowledge {
  sitePattern: string;          // "salesforce.com"
  
  // Navigation patterns (how users get to common pages)
  navigationPaths: {
    [destination: string]: {    // "New Lead Form"
      steps: string[];          // ["Click Leads tab", "Click New button"]
      confidence: number;
      usageCount: number;
    };
  };
  
  // Common element patterns
  elementPatterns: {
    saveButton?: string[];      // ['[title="Save"]', 'button.save-btn']
    cancelButton?: string[];
    searchInput?: string[];
    navigationMenu?: string[];
  };
  
  // Page type mappings
  pageTypes: {
    [urlPattern: string]: PageType;  // "/lead/new" -> "form"
  };
  
  lastUpdated: number;
}

export interface SiteKnowledgeDB {
  sites: SiteKnowledge[];
  version: number;
  lastUpdated: number;
}

export class SiteKnowledgeBase {
  /**
   * Extract patterns from completed workflow
   */
  static async learnFromWorkflow(workflow: SavedWorkflow): Promise<void> {
    try {
      if (!workflow.steps || workflow.steps.length === 0) {
        return;
      }

      const db = await this.loadDatabase();
      
      // Extract site pattern from first step
      const firstStep = workflow.steps[0];
      const firstPayload = 'url' in firstStep.payload ? firstStep.payload : null;
      if (!firstPayload?.url) {
        return;
      }
      
      const sitePattern = this.extractSitePattern(firstPayload.url);
      
      // Find or create site knowledge entry
      let siteKnowledge = db.sites.find(s => s.sitePattern === sitePattern);
      if (!siteKnowledge) {
        siteKnowledge = {
          sitePattern,
          navigationPaths: {},
          elementPatterns: {},
          pageTypes: {},
          lastUpdated: Date.now(),
        };
        db.sites.push(siteKnowledge);
      }

      // Extract navigation path
      const navigationSteps = workflow.steps
        .filter(s => s.type === 'CLICK' || s.type === 'NAVIGATION')
        .map(s => {
          if ('label' in s.payload) {
            return s.payload.label || s.description || 'Unknown step';
          }
          return s.description || 'Unknown step';
        })
        .filter(Boolean);

      if (navigationSteps.length > 0) {
        const destination = workflow.name;
        if (siteKnowledge.navigationPaths[destination]) {
          // Increment usage count
          siteKnowledge.navigationPaths[destination].usageCount++;
        } else {
          // Create new path
          siteKnowledge.navigationPaths[destination] = {
            steps: navigationSteps,
            confidence: 0.7,
            usageCount: 1,
          };
        }
      }

      // Extract common button patterns
      const saveButtons: string[] = [];
      const cancelButtons: string[] = [];
      
      for (const step of workflow.steps) {
        if (step.type !== 'CLICK') continue;
        if (!('label' in step.payload) || !('selector' in step.payload)) continue;
        
        const label = step.payload.label?.toLowerCase() || '';
        const selector = step.payload.selector;
        
        if (label.includes('save') && selector) {
          saveButtons.push(selector);
        } else if (label.includes('cancel') || label.includes('close')) {
          cancelButtons.push(selector);
        }
      }

      // Merge patterns (avoid duplicates)
      if (saveButtons.length > 0) {
        const existing = siteKnowledge.elementPatterns.saveButton || [];
        siteKnowledge.elementPatterns.saveButton = [
          ...new Set([...existing, ...saveButtons])
        ].slice(0, 10); // Keep top 10
      }

      if (cancelButtons.length > 0) {
        const existing = siteKnowledge.elementPatterns.cancelButton || [];
        siteKnowledge.elementPatterns.cancelButton = [
          ...new Set([...existing, ...cancelButtons])
        ].slice(0, 10); // Keep top 10
      }

      // Extract page type mappings
      for (const step of workflow.steps) {
        if (!('url' in step.payload) || !('pageType' in step.payload)) continue;
        
        const url = step.payload.url;
        const pageType = step.payload.pageType;
        
        if (url && pageType) {
          const urlPattern = this.extractUrlPattern(url);
          siteKnowledge.pageTypes[urlPattern] = pageType;
        }
      }

      siteKnowledge.lastUpdated = Date.now();

      // LRU eviction if needed
      if (db.sites.length > MAX_SITES) {
        db.sites.sort((a, b) => b.lastUpdated - a.lastUpdated);
        db.sites = db.sites.slice(0, MAX_SITES);
      }

      db.lastUpdated = Date.now();
      await this.saveDatabase(db);
      
      console.log(`SiteKnowledgeBase: Learned from workflow "${workflow.name}" for site ${sitePattern}`);
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to learn from workflow:', error);
    }
  }

  /**
   * Get navigation path to destination
   */
  static async getNavigationPath(site: string, destination: string): Promise<string[] | null> {
    try {
      const db = await this.loadDatabase();
      const siteKnowledge = db.sites.find(s => s.sitePattern === site);
      
      if (!siteKnowledge) {
        return null;
      }

      const path = siteKnowledge.navigationPaths[destination];
      return path ? path.steps : null;
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to get navigation path:', error);
      return null;
    }
  }

  /**
   * Get common selectors for element type
   */
  static async getCommonSelectors(site: string, elementType: string): Promise<string[]> {
    try {
      const db = await this.loadDatabase();
      const siteKnowledge = db.sites.find(s => s.sitePattern === site);
      
      if (!siteKnowledge) {
        return [];
      }

      const patterns = siteKnowledge.elementPatterns;
      
      switch (elementType) {
        case 'saveButton':
          return patterns.saveButton || [];
        case 'cancelButton':
          return patterns.cancelButton || [];
        case 'searchInput':
          return patterns.searchInput || [];
        case 'navigationMenu':
          return patterns.navigationMenu || [];
        default:
          return [];
      }
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to get common selectors:', error);
      return [];
    }
  }

  /**
   * Reinforce patterns from successful execution
   */
  static async reinforcePatterns(site: string, _usedPatterns: string[]): Promise<void> {
    try {
      const db = await this.loadDatabase();
      let siteKnowledge = db.sites.find(s => s.sitePattern === site);
      
      if (!siteKnowledge) {
        siteKnowledge = {
          sitePattern: site,
          navigationPaths: {},
          elementPatterns: {},
          pageTypes: {},
          lastUpdated: Date.now(),
        };
        db.sites.push(siteKnowledge);
      }

      // Patterns are already tracked via learnFromWorkflow
      // This method can be used for runtime reinforcement in the future
      
      siteKnowledge.lastUpdated = Date.now();
      db.lastUpdated = Date.now();
      await this.saveDatabase(db);
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to reinforce patterns:', error);
    }
  }

  /**
   * Get all site knowledge (for debugging)
   */
  static async getAllSites(): Promise<SiteKnowledge[]> {
    const db = await this.loadDatabase();
    return db.sites;
  }

  /**
   * Clear all site knowledge
   */
  static async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.remove(SITE_KNOWLEDGE_KEY);
      console.log('SiteKnowledgeBase: All site knowledge cleared');
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to clear site knowledge:', error);
    }
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Load database from storage
   */
  private static async loadDatabase(): Promise<SiteKnowledgeDB> {
    try {
      const result = await chrome.storage.local.get(SITE_KNOWLEDGE_KEY);
      const db = result[SITE_KNOWLEDGE_KEY] as SiteKnowledgeDB | undefined;

      if (db && Array.isArray(db.sites)) {
        return db;
      }

      // Return empty database
      return {
        sites: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.warn('SiteKnowledgeBase: Failed to load database:', error);
      return {
        sites: [],
        version: 1,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Save database to storage
   */
  private static async saveDatabase(db: SiteKnowledgeDB): Promise<void> {
    await chrome.storage.local.set({ [SITE_KNOWLEDGE_KEY]: db });
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

  /**
   * Extract URL pattern (domain + path pattern with wildcards)
   */
  private static extractUrlPattern(url: string): string {
    try {
      const parsed = new URL(url);
      // Create pattern: domain + path with wildcards for IDs
      const pathPattern = parsed.pathname
        .replace(/\/\d+/g, '/*') // Replace numeric IDs
        .replace(/\/[a-f0-9-]{20,}/g, '/*'); // Replace UUIDs
      return `${parsed.hostname}${pathPattern}`;
    } catch (e) {
      return '*';
    }
  }
}
