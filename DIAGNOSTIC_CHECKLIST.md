# Content Script Diagnostic Checklist

Please check the following and share what you find:

## 1. Browser Console (Page Context)
**Steps:**
- Open the Gainsight page (or any page you're testing)
- Press `F12` or `Cmd+Option+I` to open DevTools
- Go to the **Console** tab
- Look for messages starting with `GhostWriter:`

**What to look for:**
- ✅ `GhostWriter: Content script file is executing...` - This means the script loaded
- ✅ `GhostWriter: Early message listener registered` - Listener was set up
- ❌ Any red error messages
- ❌ Messages about "Failed to load" or "Cannot find module"

**Please share:** All console messages (screenshot or copy/paste)

---

## 2. Extension Service Worker Console
**Steps:**
- Go to `chrome://extensions`
- Find "GhostWriter"
- Click on **"service worker"** or **"background page"** link (should open a new DevTools window)
- Check the Console tab

**What to look for:**
- ❌ Any errors about content script injection
- ❌ Any errors about manifest parsing

**Please share:** Any error messages you see

---

## 3. Extension Errors Page
**Steps:**
- Go to `chrome://extensions`
- Find "GhostWriter"
- Look for any red error badges or error messages
- Click "Errors" if there's an error badge

**Please share:** Any errors shown

---

## 4. Content Script Injection Test
**Steps:**
- On the Gainsight page, open Console (F12)
- Run this command:
  ```javascript
  document.body.getAttribute('data-ghostwriter-ready')
  ```
- Also check:
  ```javascript
  chrome.runtime.id
  ```

**Expected results:**
- `data-ghostwriter-ready` should return `"true"` if script loaded
- `chrome.runtime.id` should return the extension ID (proves extension context is available)

**Please share:** What these commands return

---

## 5. Manual Content Script Test
**Steps:**
- On the Gainsight page, open Console (F12)
- Try to manually send a message:
  ```javascript
  chrome.runtime.sendMessage({type: 'PING', payload: {timestamp: Date.now()}}, (response) => {
    console.log('Response:', response);
  });
  ```

**Please share:** What response you get (or any errors)

---

## 6. Extension Reload Status
**Please confirm:**
- [ ] Did you reload the extension after the last build?
- [ ] Did you refresh the page after reloading the extension?
- [ ] What URL are you testing on? (e.g., `https://uberpremier.gainsightcloud.com/...`)

---

## Quick Test
Run this in the page console to see if content script context exists:
```javascript
console.log('Extension ID:', chrome?.runtime?.id);
console.log('Has chrome.runtime:', typeof chrome?.runtime !== 'undefined');
```

Please share all the information you find!














