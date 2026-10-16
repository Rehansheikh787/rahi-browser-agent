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

  return false;
});
