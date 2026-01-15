/**
 * Notification Service - Extensible, isolated module for browser notifications
 * 
 * Design:
 * - Type registry for easy addition of new notification types
 * - Proper cleanup on click AND dismiss (prevents memory leaks)
 * - Graceful handling of closed windows
 * - All operations fail-safe with try/catch
 */

// Notification type configuration
interface NotificationTypeConfig {
  title: string;
  priority: 0 | 1 | 2;
  requireInteraction: boolean;
}

// Metadata stored per notification
interface NotificationMeta {
  windowId?: number;
  type: string;
  createdAt: number;
}

class NotificationService {
  // Registry of notification types - easy to extend
  private typeConfigs: Map<string, NotificationTypeConfig> = new Map([
    ['task_complete', {
      title: 'Task Finished',
      priority: 2,
      requireInteraction: false,  // Auto-dismiss is fine for success
    }],
    ['task_stuck', {
      title: 'Task Needs Help',
      priority: 2,
      requireInteraction: true,   // Don't auto-dismiss - user needs to see this
    }],
    ['task_failed', {
      title: 'Task Failed',
      priority: 2,
      requireInteraction: true,
    }],
    ['option_confirmation', {
      title: 'Selection Needed',
      priority: 2,
      requireInteraction: true,  // Don't auto-dismiss - user must respond
    }],
  ]);

  // Track notification metadata for cleanup and click handling
  private notificationMeta: Map<string, NotificationMeta> = new Map();

  /**
   * Initialize listeners - call once on service worker startup
   */
  initialize(): void {
    // Handle notification clicks
    chrome.notifications.onClicked.addListener((id) => this.handleClick(id));
    
    // Handle notification dismissal (auto-dismiss or user swipe)
    // CRITICAL: This prevents memory leaks in notificationMeta map
    chrome.notifications.onClosed.addListener((id) => this.handleClosed(id));
    
    console.log('[NotificationService] Initialized with types:', 
      Array.from(this.typeConfigs.keys()).join(', '));
  }

  /**
   * Register a new notification type (for future extensibility)
   */
  registerType(type: string, config: NotificationTypeConfig): void {
    this.typeConfigs.set(type, config);
  }

  /**
   * Show a notification
   * @param type - Notification type (must be registered)
   * @param message - The message body
   * @param windowId - Optional window to focus on click
   */
  async notify(
    type: string,
    message: string,
    windowId?: number
  ): Promise<string | null> {
    try {
      const config = this.typeConfigs.get(type);
      if (!config) {
        console.warn(`[NotificationService] Unknown type: ${type}`);
        return null;
      }

      const notificationId = `${type}-${Date.now()}`;

      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // 1x1 transparent PNG
        title: config.title,
        message: message,
        priority: config.priority,
        requireInteraction: config.requireInteraction,
      });

      // Store metadata for click handling and cleanup
      this.notificationMeta.set(notificationId, {
        windowId,
        type,
        createdAt: Date.now(),
      });

      console.log(`[NotificationService] Created: ${notificationId}`);
      return notificationId;
    } catch (error) {
      console.warn('[NotificationService] Failed to create notification:', error);
      return null;
    }
  }

  /**
   * Convenience method for task completion
   */
  async notifyTaskComplete(taskName: string, windowId?: number): Promise<string | null> {
    return this.notify('task_complete', taskName, windowId);
  }

  /**
   * Convenience method for stuck/needs-help notifications (future use)
   */
  async notifyTaskStuck(taskName: string, reason: string, windowId?: number): Promise<string | null> {
    return this.notify('task_stuck', `${taskName}: ${reason}`, windowId);
  }

  /**
   * Convenience method for option confirmation needed
   */
  async notifyOptionConfirmation(
    fieldName: string,
    userInput: string,
    windowId?: number
  ): Promise<string | null> {
    return this.notify(
      'option_confirmation',
      `Which "${userInput}" do you want for ${fieldName}?`,
      windowId
    );
  }

  /**
   * Test method - call from console to test notifications
   * Usage: (in service worker console) notificationService.testNotification()
   */
  async testNotification(): Promise<void> {
    console.log('[NotificationService] Testing notification...');
    const result = await this.notifyTaskComplete('Test Task', undefined);
    console.log('[NotificationService] Test result:', result);
  }

  /**
   * Handle notification click - focus window if it exists
   */
  private async handleClick(notificationId: string): Promise<void> {
    try {
      const meta = this.notificationMeta.get(notificationId);
      
      if (meta?.windowId) {
        // Check if window still exists before trying to focus
        try {
          const win = await chrome.windows.get(meta.windowId);
          if (win) {
            await chrome.windows.update(meta.windowId, { focused: true });
            console.log(`[NotificationService] Focused window ${meta.windowId}`);
          }
        } catch {
          // Window was closed - that's fine, just clear the notification
          console.log(`[NotificationService] Window ${meta.windowId} no longer exists`);
        }
      }

      // Always clear the notification on click
      await chrome.notifications.clear(notificationId);
    } catch (error) {
      console.warn('[NotificationService] Error handling click:', error);
    } finally {
      // Always cleanup metadata
      this.cleanup(notificationId);
    }
  }

  /**
   * Handle notification closed (dismissed or auto-dismissed)
   */
  private handleClosed(notificationId: string): void {
    this.cleanup(notificationId);
  }

  /**
   * Cleanup metadata for a notification
   */
  private cleanup(notificationId: string): void {
    if (this.notificationMeta.has(notificationId)) {
      this.notificationMeta.delete(notificationId);
      console.log(`[NotificationService] Cleaned up: ${notificationId}`);
    }
  }
}

// Singleton export
export const notificationService = new NotificationService();
