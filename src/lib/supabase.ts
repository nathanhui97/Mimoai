/**
 * Supabase Client Singleton
 *
 * Uses chrome.storage.local instead of localStorage (service workers can't use localStorage).
 * Reuses URL + anon key from ai-config.ts constants.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { aiConfig } from './ai-config';

// ============================================================================
// Chrome Storage Adapter
// ============================================================================

/**
 * Custom storage adapter that uses chrome.storage.local.
 * Service workers (manifest v3) don't have access to localStorage,
 * so we persist Supabase auth sessions via the extension storage API.
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const result = await chrome.storage.local.get(key);
      return (result[key] as string | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch {
      console.warn('[Supabase] Failed to persist session key:', key);
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key);
    } catch {
      console.warn('[Supabase] Failed to remove session key:', key);
    }
  },
};

// ============================================================================
// Singleton
// ============================================================================

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      aiConfig.getSupabaseUrl(),
      aiConfig.getSupabaseAnonKey(),
      {
        auth: {
          storage: chromeStorageAdapter,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // No OAuth redirect in extensions
        },
      },
    );
  }
  return client;
}
