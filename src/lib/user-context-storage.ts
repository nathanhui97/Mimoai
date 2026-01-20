export interface UserContext {
  identity: string;
  focus: string;
}

const USER_CONTEXT_KEY = 'userContext';

interface UserContextResponse {
  success: boolean;
  data?: { userContext?: UserContext | null };
  error?: string;
}

async function getFromStorage(): Promise<UserContext | null> {
  const result = await chrome.storage.local.get([USER_CONTEXT_KEY]);
  const context = result[USER_CONTEXT_KEY] as UserContext | undefined;
  if (!context) return null;
  const identity = context.identity?.trim() || '';
  const focus = context.focus?.trim() || '';
  if (!identity && !focus) return null;
  return { identity, focus };
}

async function sendRuntimeMessage(type: 'GET_USER_CONTEXT' | 'SET_USER_CONTEXT' | 'CLEAR_USER_CONTEXT', payload?: any) {
  try {
    return await chrome.runtime.sendMessage({ type, payload }) as UserContextResponse;
  } catch (error) {
    console.warn('[UserContextStorage] Runtime message failed:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export class UserContextStorage {
  static async getUserContext(): Promise<UserContext | null> {
    try {
      return await getFromStorage();
    } catch (error) {
      console.warn('[UserContextStorage] Direct storage access failed, using service worker:', error);
      const response = await sendRuntimeMessage('GET_USER_CONTEXT');
      return response.success ? (response.data?.userContext ?? null) : null;
    }
  }

  static async setUserContext(context: UserContext): Promise<void> {
    try {
      await chrome.storage.local.set({ [USER_CONTEXT_KEY]: context });
    } catch (error) {
      console.warn('[UserContextStorage] Direct storage write failed, using service worker:', error);
      await sendRuntimeMessage('SET_USER_CONTEXT', { userContext: context });
    }
  }

  static async clearUserContext(): Promise<void> {
    try {
      await chrome.storage.local.remove([USER_CONTEXT_KEY]);
    } catch (error) {
      console.warn('[UserContextStorage] Direct storage clear failed, using service worker:', error);
      await sendRuntimeMessage('CLEAR_USER_CONTEXT');
    }
  }
}
