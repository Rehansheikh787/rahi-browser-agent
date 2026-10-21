/**
 * Rahi - Main Content Script Entry Point (Manifest V3)
 * Listens for messages from Background Service Worker and Side Panel,
 * coordinating page extraction, DOM scanning, badges, and action execution.
 */

console.log('[Rahi Content Script] Initialized on:', window.location.href);

// Listen for commands from Service Worker and Side Panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  // 1. Article & Page Content Extraction
  if (message.action === 'EXTRACT_CONTENT') {
    try {
      if (typeof window.rahiExtractPageContent === 'function') {
        const result = window.rahiExtractPageContent();
        sendResponse(result);
      } else {
        sendResponse({
          success: false,
          error: 'Content extractor is initializing. Please try again in a moment.',
        });
      }
    } catch (err) {
      console.error('[Rahi Content Script] EXTRACT_CONTENT error:', err);
      sendResponse({ success: false, error: err.message });
    }
    return false;
  }

  // 2. Health check ping
  if (message.action === 'PING_CONTENT_SCRIPT') {
    sendResponse({
      status: 'ACTIVE',
      url: window.location.href,
      title: document.title,
    });
    return false;
  }

  // 3. Visual Screenshot Drag-to-Crop Overlay (ADR-006 & EC-4.1 - EC-4.4)
  if (message.action === 'SHOW_CROP_OVERLAY') {
    if (typeof window.rahiStartCropOverlay === 'function') {
      window.rahiStartCropOverlay(message.fullScreenshotUrl)
        .then((cropResult) => {
          sendResponse({ success: true, ...cropResult });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message, cancelled: err.message.includes('cancelled') });
        });
      return true; // Keep channel open for async response
    } else {
      sendResponse({ success: false, error: 'Crop overlay module not loaded.' });
      return false;
    }
  }

  // 4. Live YouTube DOM details extraction (when on watch page)
  if (message.action === 'EXTRACT_YOUTUBE_DOM') {
    try {
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                      document.querySelector('h1.title yt-formatted-string') ||
                      document.querySelector('h1.title');
      const title = titleEl ? titleEl.textContent.trim() : document.title.replace(/ - YouTube$/i, '');

      const authorEl = document.querySelector('#channel-name a') ||
                       document.querySelector('ytd-channel-name a');
      const author = authorEl ? authorEl.textContent.trim() : '';

      const descEl = document.querySelector('#description-inline-expander') ||
                     document.querySelector('#description yt-formatted-string') ||
                     document.querySelector('#description');
      const description = descEl ? descEl.innerText.trim() : '';

      sendResponse({
        success: true,
        title,
        author,
        description,
      });
    } catch (ytErr) {
      sendResponse({ success: false, error: ytErr.message });
    }
    return false;
  }

  // 5. DOM Element Scanner
  if (message.action === 'SCAN_ELEMENTS') {
    try {
      if (typeof window.rahiScanInteractiveElements === 'function') {
        const manifest = window.rahiScanInteractiveElements();
        sendResponse({ success: true, manifest });
      } else {
        sendResponse({ success: false, error: 'Scanner module not loaded' });
      }
    } catch (scanErr) {
      sendResponse({ success: false, error: scanErr.message });
    }
    return false;
  }

  // 6. Numbered Badges Overlay
  if (message.action === 'SHOW_BADGES') {
    try {
      if (typeof window.rahiShowBadges === 'function') {
        window.rahiShowBadges(message.manifest || []);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Badge overlay module not loaded' });
      }
    } catch (badgeErr) {
      sendResponse({ success: false, error: badgeErr.message });
    }
    return false;
  }

  // 7. Pulse Highlight Specific Element
  if (message.action === 'HIGHLIGHT_ELEMENT') {
    try {
      if (typeof window.rahiHighlightElement === 'function') {
        const highlighted = window.rahiHighlightElement(message.targetId);
        sendResponse({ success: true, highlighted });
      } else {
        sendResponse({ success: false, error: 'Badge overlay module not loaded' });
      }
    } catch (hlErr) {
      sendResponse({ success: false, error: hlErr.message });
    }
    return false;
  }

  // 8. Clear Numbered Badges
  if (message.action === 'CLEAR_BADGES') {
    try {
      if (typeof window.rahiRemoveBadges === 'function') {
        window.rahiRemoveBadges();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: true });
      }
    } catch (clearErr) {
      sendResponse({ success: false, error: clearErr.message });
    }
    return false;
  }

  // 9. Execute Synthetic Action
  if (message.action === 'EXECUTE_ACTION') {
    if (typeof window.rahiDispatchBrowserAction === 'function') {
      window.rahiDispatchBrowserAction(message.action)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // Keep message channel open for async execution
    } else {
      sendResponse({ success: false, error: 'Action executor module not loaded' });
      return false;
    }
  }

  return false;
});
