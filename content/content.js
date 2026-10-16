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

  return false;
});
