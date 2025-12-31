/**
 * Visual Cache - Caches visual embeddings and analysis results locally
 * Reduces API calls for similar visual queries
 */

const VISUAL_CACHE_KEY = 'ghostwriter_visual_cache';
const MAX_CACHE_ENTRIES = 50;
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface VisualCacheEntry {
  key: string;
  data: any;
  timestamp: number;
  expiresAt: number;
  type: 'page_analysis' | 'similarity' | 'importance' | 'context';
  sizeBytes: number;
}

export interface VisualCacheStats {
  totalEntries: number;
  totalSizeKB: number;
  hitCount: number;
  missCount: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

class VisualCacheManager {
  private hitCount: number = 0;
  private missCount: number = 0;

  /**
   * Generate cache key from data
   */
  generateKey(data: any): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `visual_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Get from visual cache
   */
  async get(key: string): Promise<any | null> {
    try {
      const cache = await this.loadCache();
      const entry = cache.find(e => e.key === key);

      if (!entry) {
        this.missCount++;
        return null;
      }

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        await this.remove(key);
        this.missCount++;
        return null;
      }

      this.hitCount++;
      console.log(`🖼️ GhostWriter: Visual cache hit for ${key}`);
      return entry.data;
    } catch (error) {
      console.warn('🖼️ GhostWriter: Visual cache get failed:', error);
      return null;
    }
  }

  /**
   * Set visual cache entry
   */
  async set(
    key: string,
    data: any,
    type: VisualCacheEntry['type'] = 'page_analysis',
    ttl: number = DEFAULT_TTL
  ): Promise<void> {
    try {
      const cache = await this.loadCache();
      const dataStr = JSON.stringify(data);
      const sizeBytes = new Blob([dataStr]).size;

      // Check if entry is too large (max 100KB per entry)
      if (sizeBytes > 100 * 1024) {
        console.warn(`🖼️ GhostWriter: Visual cache entry too large (${(sizeBytes / 1024).toFixed(1)}KB), skipping`);
        return;
      }

      const entry: VisualCacheEntry = {
        key,
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl,
        type,
        sizeBytes,
      };

      // Remove existing entry with same key
      const existingIndex = cache.findIndex(e => e.key === key);
      if (existingIndex > -1) {
        cache.splice(existingIndex, 1);
      }

      // Add new entry at beginning
      cache.unshift(entry);

      // Trim cache to max size
      await this.trimCache(cache);

      // Save
      await this.saveCache(cache);
      console.log(`🖼️ GhostWriter: Visual cache set for ${key} (${(sizeBytes / 1024).toFixed(1)}KB)`);
    } catch (error) {
      console.warn('🖼️ GhostWriter: Visual cache set failed:', error);
    }
  }

  /**
   * Remove cache entry
   */
  async remove(key: string): Promise<void> {
    try {
      const cache = await this.loadCache();
      const index = cache.findIndex(e => e.key === key);
      if (index > -1) {
        cache.splice(index, 1);
        await this.saveCache(cache);
      }
    } catch (error) {
      console.warn('🖼️ GhostWriter: Visual cache remove failed:', error);
    }
  }

  /**
   * Get or compute value (check cache first)
   */
  async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    type: VisualCacheEntry['type'] = 'page_analysis',
    ttl: number = DEFAULT_TTL
  ): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached as T;
    }

    const result = await computeFn();
    await this.set(key, result, type, ttl);
    return result;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<VisualCacheStats> {
    try {
      const cache = await this.loadCache();
      const totalSizeBytes = cache.reduce((sum, e) => sum + e.sizeBytes, 0);
      const timestamps = cache.map(e => e.timestamp);

      return {
        totalEntries: cache.length,
        totalSizeKB: Math.round(totalSizeBytes / 1024 * 10) / 10,
        hitCount: this.hitCount,
        missCount: this.missCount,
        oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
        newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
      };
    } catch (error) {
      return {
        totalEntries: 0,
        totalSizeKB: 0,
        hitCount: this.hitCount,
        missCount: this.missCount,
        oldestEntry: null,
        newestEntry: null,
      };
    }
  }

  /**
   * Clear all visual cache
   */
  async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.remove(VISUAL_CACHE_KEY);
      this.hitCount = 0;
      this.missCount = 0;
      console.log('🖼️ GhostWriter: Visual cache cleared');
    } catch (error) {
      console.warn('🖼️ GhostWriter: Visual cache clear failed:', error);
    }
  }

  /**
   * Clear expired entries
   */
  async clearExpired(): Promise<number> {
    try {
      const cache = await this.loadCache();
      const now = Date.now();
      const before = cache.length;

      const validEntries = cache.filter(e => e.expiresAt > now);

      if (validEntries.length < before) {
        await this.saveCache(validEntries);
        const removed = before - validEntries.length;
        console.log(`🖼️ GhostWriter: Cleared ${removed} expired visual cache entries`);
        return removed;
      }

      return 0;
    } catch (error) {
      console.warn('🖼️ GhostWriter: Clear expired failed:', error);
      return 0;
    }
  }

  /**
   * Clear entries by type
   */
  async clearByType(type: VisualCacheEntry['type']): Promise<number> {
    try {
      const cache = await this.loadCache();
      const before = cache.length;

      const filteredCache = cache.filter(e => e.type !== type);

      if (filteredCache.length < before) {
        await this.saveCache(filteredCache);
        const removed = before - filteredCache.length;
        console.log(`🖼️ GhostWriter: Cleared ${removed} ${type} cache entries`);
        return removed;
      }

      return 0;
    } catch (error) {
      console.warn('🖼️ GhostWriter: Clear by type failed:', error);
      return 0;
    }
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Load cache from storage
   */
  private async loadCache(): Promise<VisualCacheEntry[]> {
    try {
      const result = await chrome.storage.local.get(VISUAL_CACHE_KEY);
      const cache = result[VISUAL_CACHE_KEY];
      return Array.isArray(cache) ? cache : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Save cache to storage
   */
  private async saveCache(cache: VisualCacheEntry[]): Promise<void> {
    await chrome.storage.local.set({ [VISUAL_CACHE_KEY]: cache });
  }

  /**
   * Trim cache to max size and storage limits
   */
  private async trimCache(cache: VisualCacheEntry[]): Promise<void> {
    // Remove expired entries first
    const now = Date.now();
    const validEntries = cache.filter(e => e.expiresAt > now);
    cache.length = 0;
    cache.push(...validEntries);

    // Trim to max entries
    if (cache.length > MAX_CACHE_ENTRIES) {
      cache.splice(MAX_CACHE_ENTRIES);
    }

    // Check total size (max 1MB for visual cache)
    const maxSizeBytes = 1024 * 1024;
    let totalSize = cache.reduce((sum, e) => sum + e.sizeBytes, 0);

    while (totalSize > maxSizeBytes && cache.length > 0) {
      const removed = cache.pop();
      if (removed) {
        totalSize -= removed.sizeBytes;
      }
    }
  }
}

// Singleton instance
export const visualCache = new VisualCacheManager();








