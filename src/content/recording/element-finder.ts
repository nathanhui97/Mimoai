/**
 * ElementFinder - Detects clickable elements, handles overlays, and finds actual targets
 * 
 * Extracted from RecordingManager to provide focused element detection logic.
 * Used by ClickHandler and other handlers that need to find the "real" interactive element.
 */

import { ElementStateCapture } from '../element-state';

/**
 * ElementFinder provides methods to determine if elements are interactive,
 * handle overlay/portal scenarios, and find the actual clickable target.
 */
export class ElementFinder {
  /**
   * Check if element is a list item or option (for dropdown/menu items)
   */
  isListItemOrOption(element: Element): boolean {
    const role = element.getAttribute('role');
    if (role === 'option' || role === 'menuitem' || role === 'listitem') {
      console.log('🔍 GhostWriter: Element is list item/option (by role):', role);
      return true;
    }

    const tagName = element.tagName.toLowerCase();

    // CRITICAL: Skip native <option> elements inside native <select>
    // Native SELECTs fire a 'change' event when selecting options, which is recorded as INPUT
    // Recording the CLICK on OPTION would create duplicate steps without decisionSpace
    if (tagName === 'option') {
      const parentSelect = element.closest('select');
      if (parentSelect) {
        console.log('🔍 GhostWriter: Skipping native <option> inside <select> - will be recorded via change event');
        return false;
      }
      // Non-native option (ARIA-based custom dropdown)
      console.log('🔍 GhostWriter: Element is list item/option (by tag):', tagName);
      return true;
    }

    if (tagName === 'li') {
      console.log('🔍 GhostWriter: Element is list item/option (by tag):', tagName);
      return true;
    }

    // Check class names for common patterns
    const className = element.className?.toString().toLowerCase() || '';
    if (className.includes('option') || 
        className.includes('menuitem') || 
        className.includes('list-item') ||
        className.includes('dropdown-item') ||
        className.includes('select-option')) {
      console.log('🔍 GhostWriter: Element is list item/option (by class):', className.substring(0, 50));
      return true;
    }

    // CRITICAL: Check if element is inside a dropdown/listbox/menu container
    // Many React dropdowns don't set role="option" on the option elements themselves
    // They just use div elements inside a [role="listbox"] or [role="menu"] container
    // Use traditional selector for synchronous operation during recording
    // NOTE: Exclude native <select> from this check - those are handled by change events
    const container = element.closest('[role="listbox"], [role="menu"], [role="list"], ul, ol');
    if (container && element !== container) {
      // ENHANCED LOGGING: Show container details
      const containerInfo = {
        tag: container.tagName,
        role: container.getAttribute('role'),
        label: container.getAttribute('aria-label'),
        id: container.id,
        elementTag: element.tagName,
        elementText: (element as HTMLElement).textContent?.trim().substring(0, 50),
      };

      // If we're inside a dropdown container, this is very likely a dropdown option
      // Be permissive: any clickable element inside a listbox/menu is probably an option
      // This catches cases where the option is a div inside a listbox without explicit roles
      if (this.isInteractiveElement(element)) {
        console.log('🔍 GhostWriter: Detected dropdown option inside container:', containerInfo);
        return true;
      }

      // Also check if this is a direct child of the container (even if not explicitly interactive)
      // Some dropdowns use non-interactive divs that become clickable via event handlers
      const isDirectChild = element.parentElement === container;
      if (isDirectChild) {
        console.log('🔍 GhostWriter: Detected direct child of dropdown container as option:', containerInfo);
        return true;
      }
    }

    // CRITICAL: Skip elements inside native <select> - they are handled by change events
    // This is a separate check to ensure we don't record CLICK on options inside native selects
    const nativeSelectParent = element.closest('select');
    if (nativeSelectParent) {
      console.log('🔍 GhostWriter: Element is inside native <select> - skipping (will be recorded via change event)');
      return false;
    }

    // Check if parent has list-related role
    const parent = element.parentElement;
    if (parent) {
      const parentRole = parent.getAttribute('role');
      if (parentRole === 'listbox' || 
          parentRole === 'menu' || 
          parentRole === 'list') {
        console.log('🔍 GhostWriter: Element is list item/option (parent has list role):', parentRole);
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an element is an overlay (mask, backdrop, etc.)
   */
  isOverlayElement(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    const className = element.className?.toString().toLowerCase() || '';
    const style = window.getComputedStyle(element as HTMLElement);
    
    // Check tag name
    if (tagName.includes('overlay') || tagName.includes('backdrop') || tagName.includes('mask')) {
      return true;
    }
    
    // Check class names
    if (className.includes('overlay') || className.includes('backdrop') || className.includes('mask') || className.includes('modal-backdrop')) {
      return true;
    }
    
    // Check styles - invisible elements with pointer-events: none are likely overlays
    if (style.pointerEvents === 'none' && style.position === 'absolute') {
      return true;
    }
    
    return false;
  }

  /**
   * Check if an element is interactive/clickable
   * IMPORTANT: Must be permissive for modern React/Angular apps that use div/span with click handlers
   * BUT: Must NOT be too permissive - icons, SVGs, and decorative elements should NOT be considered interactive
   */
  isInteractiveElement(element: Element): boolean {
    const htmlEl = element as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    const style = window.getComputedStyle(htmlEl);
    
    // 0. CRITICAL: Exclude decorative/non-semantic elements (icons, SVGs, etc.)
    // These should NEVER be recorded - we should record their parent button instead
    const isDecorativeElement = tagName === 'svg' || 
                                tagName === 'path' || 
                                tagName === 'g' ||
                                tagName.includes('icon') ||  // lightning-primitive-icon, mat-icon, etc.
                                tagName.includes('-svg') ||
                                element.getAttribute('role') === 'img' ||
                                element.getAttribute('role') === 'presentation';
    
    if (isDecorativeElement) {
      console.log('🔍 GhostWriter: Skipping decorative element:', tagName, '- will find parent button');
      return false;  // Force parent traversal to find the actual button
    }
    
    // 1. Widget elements are always interactive
    if (tagName.includes('widget') || tagName.includes('gs-report') || 
        element.className?.toString().includes('widget')) {
      return true;
    }
    
    // 2. Cursor pointer is a strong indicator (handles React/Angular div/span buttons)
    if (style.cursor === 'pointer' || style.cursor === 'grab') {
      return true;
    }
    
    // 3. Standard interactive tags
    // CRITICAL FIX: Include ALL input types (text, email, number, etc.) except hidden
    // Previously only included button/submit/checkbox/radio which caused text inputs to be ignored
    if (['button', 'a', 'select', 'textarea'].includes(tagName)) {
      return true;
    }
    
    // All input types are interactive except hidden
    if (tagName === 'input' && (htmlEl as HTMLInputElement).type !== 'hidden') {
      return true;
    }
    
    // Contenteditable elements are interactive (rich text editors, etc.)
    if (htmlEl.isContentEditable) {
      return true;
    }
    
    // 4. ARIA roles
    const role = element.getAttribute('role');
    if (role && ['button', 'link', 'menuitem', 'tab', 'option'].includes(role)) {
      return true;
    }
    
    // 5. Fallback: visible element with reasonable size (permissive)
    // REMOVED: This was TOO permissive and recorded icons/decorative elements
    // Only use explicit indicators above (cursor, tag, role)
    
    return false;
  }

  /**
   * Get the actual element from an event (handles Shadow DOM)
   */
  getActualElement(event: Event): Element | null {
    // Use composedPath to get the actual element (works across shadow boundaries)
    if ('composedPath' in event) {
      const path = event.composedPath();
      // First element in path is the actual target
      if (path.length > 0 && path[0] instanceof Element) {
        return path[0] as Element;
      }
    }
    
    // Fallback to target
    return (event.target as Element) || null;
  }

  /**
   * Find the scrollable container for an element
   */
  findScrollContainer(element: Element): HTMLElement | null {
    let current: Element | null = element;
    const maxLevels = 10;
    let level = 0;

    while (current && level < maxLevels && current !== document.body && current !== document.documentElement) {
      if (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const overflow = style.overflow || style.overflowY || style.overflowX;
        
        // Check if element is scrollable
        if (overflow === 'auto' || overflow === 'scroll') {
          // Verify it actually scrolls
          if (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth) {
            return current;
          }
        }
      }
      
      current = current.parentElement;
      level++;
    }

    return null;
  }

  /**
   * Find the actual clickable element when clicking on an overlay (SYNCHRONOUS version)
   * This version accepts pre-captured elements to avoid race conditions with disappearing dropdowns
   * If the element is invisible (overlay), find the widget/container underneath
   * Returns null if no visible, interactive target can be found
   */
  findActualClickableElementSync(element: Element, event: MouseEvent, elementsAtPoint: Element[]): Element | null {
    // Check if element is visible and not an overlay
    const isVisible = ElementStateCapture.isElementVisible(element);
    const isOverlay = this.isOverlayElement(element);
    
    // If visible and not an overlay, return as-is
    if (isVisible && !isOverlay && this.isInteractiveElement(element)) {
      return element;
    }

    // Element is invisible or is an overlay, try to find the actual clickable element

    // Strategy 1: Use pre-captured elementsAtPoint (already captured synchronously)
    // This is more reliable than elementFromPoint (singular) which might return the overlay
    // PRIORITY: Prefer smaller, more specific elements (buttons, menu items) over large containers (widgets)
    try {
      // ENHANCED LOGGING: Log all elements at this point for debugging
      console.log('🔍 GhostWriter: Elements at click point (', event.clientX, ',', event.clientY, '):', 
        elementsAtPoint.slice(0, 10).map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          text: (el as HTMLElement).textContent?.trim().substring(0, 30),
          classes: el.className?.toString().substring(0, 50),
          isVisible: ElementStateCapture.isElementVisible(el),
          isOverlay: this.isOverlayElement(el),
          isListItem: this.isListItemOrOption(el),
          size: `${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height}`
        }))
      );
      
      // Filter for visible, interactive elements that are not overlays
      // CRITICAL: Be permissive for list items/options (portal elements)
      const visibleElements = elementsAtPoint.filter(el => {
        if (el === element) return false; // Skip the original overlay element
        if (this.isOverlayElement(el)) return false; // Skip other overlays
        
        // For list items/options, be more permissive with visibility
        const isListItemOrOption = this.isListItemOrOption(el);
        const isElVisible = ElementStateCapture.isElementVisible(el);
        if (!isElVisible && !isListItemOrOption) return false; // Must be visible (unless list item/option)
        
        return this.isInteractiveElement(el); // Must be interactive
      });
      
      console.log('🔍 GhostWriter: Filtered to', visibleElements.length, 'visible, interactive elements');
      
      if (visibleElements.length > 0) {
        // PRIORITY: Prefer smaller, more specific elements over large containers
        // Sort by: buttons/menu items first, then by size (smaller = more specific)
        const sorted = visibleElements.sort((a, b) => {
          const aTag = a.tagName.toLowerCase();
          const bTag = b.tagName.toLowerCase();
          const aRole = a.getAttribute('role');
          const bRole = b.getAttribute('role');
          
          // Prioritize buttons, menu items, links
          const aIsSpecific = aTag === 'button' || aTag === 'a' || aRole === 'button' || aRole === 'menuitem' || aRole === 'option';
          const bIsSpecific = bTag === 'button' || bTag === 'a' || bRole === 'button' || bRole === 'menuitem' || bRole === 'option';
          
          if (aIsSpecific && !bIsSpecific) return -1;
          if (!aIsSpecific && bIsSpecific) return 1;
          
          // If both are specific or both are not, prefer smaller elements (more specific)
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const aSize = aRect.width * aRect.height;
          const bSize = bRect.width * bRect.height;
          
          // Prefer smaller elements (they're more specific)
          return aSize - bSize;
        });
        
        // ENHANCED LOGGING: Show all candidates and why the selected one was chosen
        console.log('🔍 GhostWriter: Sorted candidates:', sorted.slice(0, 5).map((el, idx) => {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const rect = el.getBoundingClientRect();
          const isSpecific = tag === 'button' || tag === 'a' || role === 'button' || role === 'menuitem' || role === 'option';
          return {
            rank: idx + 1,
            tag,
            role,
            text: (el as HTMLElement).textContent?.trim().substring(0, 30),
            size: `${rect.width}x${rect.height}`,
            isSpecific,
            isListItem: this.isListItemOrOption(el),
          };
        }));
        
        const selected = sorted[0];
        const selectedTag = selected.tagName.toLowerCase();
        const selectedRole = selected.getAttribute('role');
        const selectedText = (selected as HTMLElement).textContent?.trim().substring(0, 50);
        console.log('✅ GhostWriter: Selected element from elementsFromPoint:', selectedTag, 'Role:', selectedRole, 'Text:', selectedText, 'Size:', selected.getBoundingClientRect().width, 'x', selected.getBoundingClientRect().height);
        
        // ENHANCED LOGGING: Check if there are multiple dropdown containers
        const dropdownContainers = elementsAtPoint.filter(el => 
          el.getAttribute('role') === 'listbox' || 
          el.getAttribute('role') === 'menu' ||
          el.getAttribute('role') === 'combobox'
        );
        if (dropdownContainers.length > 1) {
          console.warn('⚠️ GhostWriter: Multiple dropdown containers detected at click point!', {
            count: dropdownContainers.length,
            containers: dropdownContainers.map(el => ({
              role: el.getAttribute('role'),
              label: el.getAttribute('aria-label'),
              id: el.id,
            }))
          });
        }
        
        return selected;
      }
    } catch (error) {
      console.warn('GhostWriter: Error using elementsFromPoint:', error);
    }

    // Strategy 2: Traverse up the DOM to find interactive elements (buttons, menu items) FIRST
    // Only fall back to widget containers if no interactive element is found
    let current: Element | null = element.parentElement;
    let level = 0;
    const maxLevels = 10;
    let foundInteractiveElement: Element | null = null;
    const widgetTags = ['gs-report-widget-element', 'gs-widget', 'widget', 'gridster-item'];

    while (current && level < maxLevels && current !== document.body) {
      const tagName = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      
      // PRIORITY: Look for actual interactive elements (buttons, menu items, etc.)
      // These should be preferred over widget containers
      const isInteractive = this.isInteractiveElement(current);
      const isButton = tagName === 'button' || role === 'button' || role === 'menuitem';
      const isMenuItem = role === 'menuitem' || role === 'option' || role === 'listitem';
      const isLink = tagName === 'a' || role === 'link';
      
      if (isInteractive && (isButton || isMenuItem || isLink)) {
        // Found an actual interactive element - prefer this over widget containers
        if (ElementStateCapture.isElementVisible(current)) {
          foundInteractiveElement = current;
          // Continue searching to see if there's a more specific element (closer to click)
        }
      }
      
      // Only check for widget containers if we haven't found an interactive element yet
      if (!foundInteractiveElement && widgetTags.some(wt => tagName.includes(wt))) {
        // Check if it's visible and interactive
        if (ElementStateCapture.isElementVisible(current) && this.isInteractiveElement(current)) {
          // Only use widget as fallback if no interactive element was found
          if (level < 3) {
            // Widget is close to the element, might be the actual target
            // But prefer interactive elements found later
            current = current.parentElement;
            level++;
            continue;
          }
        }
      }

      current = current.parentElement;
      level++;
    }
    
    // Return the interactive element if found, otherwise continue to Strategy 3
    if (foundInteractiveElement) {
      console.log('GhostWriter: Found interactive element in parent hierarchy:', foundInteractiveElement.tagName, 'Role:', foundInteractiveElement.getAttribute('role'));
      return foundInteractiveElement;
    }

    // Strategy 3: If element is an overlay, search for widget elements in parent hierarchy
    if (isOverlay) {
      let parent: Element | null = element.parentElement;
      level = 0;
      while (parent && level < 5 && parent !== document.body) {
        // Look for widget elements within the parent
        for (const widgetTag of widgetTags) {
          const widget = parent.querySelector(widgetTag);
          if (widget && ElementStateCapture.isElementVisible(widget) && this.isInteractiveElement(widget)) {
            return widget;
          }
        }
        parent = parent.parentElement;
        level++;
      }
    }

    // Strategy 4: Try to find any visible, interactive element near the click point
    // This is a last resort - look for siblings or nearby elements
    try {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      // Try elementsFromPoint at the center of the element
      const elementsAtCenter = document.elementsFromPoint(centerX, centerY);
      for (const el of elementsAtCenter) {
        if (el === element) continue;
        if (this.isOverlayElement(el)) continue;
        
        // Check if visible and interactive
        if (ElementStateCapture.isElementVisible(el) && this.isInteractiveElement(el)) {
          return el;
        }
      }
    } catch (error) {
      // Ignore errors in fallback strategy
    }

    // CRITICAL: If the original element is a list item/option, return it even if visibility checks fail
    // Portal elements might have visibility quirks, but we still want to record them
    if (this.isListItemOrOption(element)) {
      console.log('GhostWriter: Returning list item/option element despite visibility/overlay checks (portal element)');
      return element;
    }

    // If no better target found, return null (caller will skip recording)
    console.warn('GhostWriter: Could not find visible, interactive element for click. Original element:', element.tagName, 'Visible:', isVisible, 'Overlay:', isOverlay);
    return null;
  }
}

// Export singleton for convenience
export const elementFinder = new ElementFinder();

