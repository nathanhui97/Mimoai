/**
 * AI Cache - Local caching layer for fast repeated lookups
 * Server-side caching handled in Supabase Edge Function
 */

import { aiConfig } from './ai-config';

export interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class AICache {
  /**
   * Generate cache key from data
   */
  static generateKey(data: any): string {
    // Create a stable hash from the data
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `ai_cache_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Get from local cache
   */
  static async getFromLocal(key: string): Promise<any | null> {
    try {
      const result = await chrome.storage.local.get(key);
      const entry = result[key] as CacheEntry | undefined;

      if (!entry) {
        return null;
      }

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        // Remove expired entry
        await chrome.storage.local.remove(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('GhostWriter: Error reading from local cache:', error);
      return null;
    }
  }

  /**
   * Save to local cache
   */
  static async saveToLocal(key: string, data: any, ttl?: number): Promise<void> {
    try {
      const cacheTTL = ttl || aiConfig.getLocalCacheTTL();
      const entry: CacheEntry = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + cacheTTL,
      };

      await chrome.storage.local.set({ [key]: entry });
    } catch (error) {
      console.warn('GhostWriter: Error saving to local cache:', error);
      // Don't throw - caching is best effort
    }
  }

  /**
   * Clear cache entry
   */
  static async clear(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.warn('GhostWriter: Error clearing cache:', error);
    }
  }

  /**
   * Clear all AI cache entries
   */
  static async clearAll(): Promise<void> {
    try {
      const all = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter(key => key.startsWith('ai_cache_'));
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.warn('GhostWriter: Error clearing all cache:', error);
    }
  }
}
