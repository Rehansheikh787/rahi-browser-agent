/**
 * Rahi - Background Service Worker (Manifest V3)
 * Coordinates extension lifecycle, side panel behavior, storage hydration,
 * and inter-context message passing.
 */

import { callGemini, streamGemini, callAIWithFailover, streamAIWithFailover } from './ai_gateway.js';
import { setupContextMenus, handleContextMenuClick } from './context_menus.js';

// Initialize extension defaults on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Rahi SW] Extension installed/updated: reason = ${details.reason}`);

  // Register context menu items
  setupContextMenus();

  try {
    // Enable side panel opening on extension action toolbar click
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      console.log('[Rahi SW] Side panel openPanelOnActionClick enabled.');
    }
  } catch (err) {
    console.warn('[Rahi SW] Failed to set side panel behavior:', err);
  }

  // Hydrate default storage settings if absent or outdated
  try {
    const existing = await chrome.storage.local.get(['settings', 'userProfile', 'savedSkills']);
    const updates = {};

    let currentSettings = existing.settings || {};
    let settingsChanged = false;

    if (!currentSettings.defaultModel || currentSettings.defaultModel.includes('2.5')) {
      currentSettings.defaultModel = 'gemini-3.5-flash-lite';
      settingsChanged = true;
    }
    if (!currentSettings.preferredLanguage) {
      currentSettings.preferredLanguage = 'en';
      settingsChanged = true;
    }
    if (typeof currentSettings.maxStepLimit !== 'number') {
      currentSettings.maxStepLimit = 15;
      settingsChanged = true;
    }
    if (typeof currentSettings.enableDryRunDefault !== 'boolean') {
      currentSettings.enableDryRunDefault = false;
      settingsChanged = true;
    }
    // Pre-seed developer keys if not yet entered
    if (!currentSettings.geminiApiKey) {
      currentSettings.geminiApiKey = '';
      settingsChanged = true;
    }
    if (!currentSettings.groqApiKey) {
      currentSettings.groqApiKey = '';
      settingsChanged = true;
    }

    if (!existing.settings || settingsChanged) {
      updates.settings = currentSettings;
    }

    if (!existing.userProfile) {
      updates.userProfile = {
        fullName: '',
        email: '',
        phone: '',
        college: '',
        degree: '',
        skills: [],
        links: { github: '', linkedin: '', portfolio: '' },
        preferredTone: 'formal',
      };
    }

    if (!existing.savedSkills) {
      updates.savedSkills = [
        {
          id: 'skill_exam_notes',
          name: 'Exam Notes',
          description: 'Convert page content into high-yield exam bullet points',
          promptTemplate: 'Summarize the following page content as concise, high-yield exam preparation notes with key formulas, definitions, and questions.',
          outputType: 'summary',
          isBuiltin: true,
        },
        {
          id: 'skill_hinglish_breakdown',
          name: 'Explain in Hinglish',
          description: 'Break down complex page content in simple conversational Hinglish',
          promptTemplate: 'Explain this page concept in clear, easy-to-understand Hinglish so anyone can grasp it immediately.',
          outputType: 'chat',
          isBuiltin: true,
        },
        {
          id: 'skill_polite_reply',
          name: 'Draft Polite Reply',
          description: 'Draft a polite, professional reply to selected text/message',
          promptTemplate: 'Draft a polite, professional, and helpful reply to the selected message using the user profile tone.',
          outputType: 'chat',
          isBuiltin: true,
        },
        {
          id: 'skill_form_filler',
          name: 'Fill Form from Profile',
          description: 'Auto-fill form inputs using stored local user profile',
          promptTemplate: 'Analyze the active form fields and match them with the user profile information.',
          outputType: 'action',
          isBuiltin: true,
        },
      ];
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('[Rahi SW] Default storage populated:', Object.keys(updates));
    }
  } catch (err) {
    console.error('[Rahi SW] Failed to initialize storage:', err);
  }
});

// Context Menu Actions Handler (Explain, Translate, Draft Reply)
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
}

// General runtime message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Rahi SW] Received message:', message?.action || message?.type, 'from:', sender.tab ? `tab ${sender.tab.id}` : 'extension context');

  // Ping health-check
  if (message.action === 'PING') {
    sendResponse({ status: 'OK', timestamp: Date.now(), serviceWorkerActive: true });
    return false;
  }

  // Active tab retrieval helper
  if (message.action === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then((tabs) => {
        const activeTab = tabs && tabs[0] ? tabs[0] : null;
        sendResponse({ tab: activeTab });
      })
      .catch((err) => {
        sendResponse({ error: err.message });
      });
    return true; // Keep channel open for async response
  }

  // Settings query helper
  if (message.action === 'GET_SETTINGS') {
    chrome.storage.local.get('settings')
      .then((data) => sendResponse({ settings: data.settings || {} }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // AI Text Generation via ai_gateway
  if (message.action === 'AI_GENERATE_TEXT') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get('settings');
        const settings = stored.settings || {};
        const apiKey = message.apiKey || settings.geminiApiKey;
        const model = message.model || settings.defaultModel || 'gemini-3.5-flash-lite';
        const language = message.language || settings.preferredLanguage || 'en';

        const result = await callAIWithFailover({
          geminiApiKey: apiKey,
          groqApiKey: settings.groqApiKey || null,
          model,
          prompt: message.prompt,
          systemInstruction: message.systemInstruction || '',
          language,
          temperature: message.temperature ?? 0.2,
          maxTokens: message.maxTokens ?? 2048,
          multimodalParts: message.multimodalParts || null,
        });

        sendResponse({ success: true, ...result });
      } catch (err) {
        console.error('[Rahi SW] AI_GENERATE_TEXT error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Viewport Capture and Interactive Crop (Slice 2.3 & ADR-006)
  if (message.action === 'CAPTURE_AND_CROP_SCREEN') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs && tabs[0] ? tabs[0] : null;
        if (!activeTab || !activeTab.id) {
          throw new Error('No active browser tab found to capture.');
        }

        // EC-1.3 Check internal URLs
        if (/^(chrome|edge|about|chromewebstore):/i.test(activeTab.url || '')) {
          throw new Error('Screenshots cannot be captured on browser internal pages.');
        }

        // Capture visible tab
        const fullScreenshotUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
          format: 'png',
        });

        // Send to content script to display crop overlay
        let cropResponse = null;
        try {
          cropResponse = await chrome.tabs.sendMessage(activeTab.id, {
            action: 'SHOW_CROP_OVERLAY',
            fullScreenshotUrl,
          });
        } catch (_) {
          // If content script was not ready, inject dynamically
          console.log('[Rahi SW] Content script not pre-loaded on tab for crop, injecting dynamically...');
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content/screenshot_crop.js', 'content/content.js'],
          });
          await new Promise((r) => setTimeout(r, 150));
          cropResponse = await chrome.tabs.sendMessage(activeTab.id, {
            action: 'SHOW_CROP_OVERLAY',
            fullScreenshotUrl,
          });
        }

        sendResponse(cropResponse || { success: false, error: 'No response from crop overlay' });
      } catch (err) {
        console.error('[Rahi SW] CAPTURE_AND_CROP_SCREEN error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Fallthrough
  return false;
});

// ==========================================
// Long-Lived Message Port for Streaming (ADR-005 & EC-1.2)
// ==========================================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rahi-stream') return;

  console.log('[Rahi SW] Long-lived stream port connected:', port.name);
  let activeAbortController = null;

  // Handle port disconnect: abort in-flight fetch immediately to prevent zombie connections (EC-1.2)
  port.onDisconnect.addListener(() => {
    console.log('[Rahi SW] Stream port disconnected.');
    if (activeAbortController) {
      console.log('[Rahi SW] Aborting in-flight streaming fetch due to port disconnect.');
      activeAbortController.abort();
      activeAbortController = null;
    }
  });

  // Handle incoming stream requests from Side Panel
  port.onMessage.addListener(async (msg) => {
    if (msg.action === 'STREAM_CHAT') {
      const streamId = msg.streamId || `stream_${Date.now()}`;
      activeAbortController = new AbortController();

      try {
        const stored = await chrome.storage.local.get('settings');
        const settings = stored.settings || {};
        const apiKey = msg.apiKey || settings.geminiApiKey;
        const model = msg.model || settings.defaultModel || 'gemini-3.5-flash-lite';
        const language = msg.language || settings.preferredLanguage || 'en';

        const result = await streamAIWithFailover({
          geminiApiKey: apiKey,
          groqApiKey: settings.groqApiKey || null,
          model,
          prompt: msg.prompt,
          contents: msg.contents || null,
          systemInstruction: msg.systemInstruction || '',
          language,
          temperature: msg.temperature ?? 0.2,
          maxTokens: msg.maxTokens ?? 2048,
          signal: activeAbortController.signal,
          onChunk: (delta) => {
            try {
              port.postMessage({
                type: 'CHUNK',
                streamId,
                text: delta,
              });
            } catch (_) {
              // Port may have closed during postMessage
            }
          },
          onProviderSwitched: (newProvider) => {
            try {
              port.postMessage({
                type: 'PROVIDER_SWITCHED',
                streamId,
                provider: newProvider,
                note: 'Switched to Groq Fallback (Gemini busy)',
              });
            } catch (_) {}
          },
        });

        try {
          port.postMessage({
            type: 'DONE',
            streamId,
            fullText: result.text,
            model: result.model,
          });
        } catch (_) {}
      } catch (err) {
        if (activeAbortController && activeAbortController.signal.aborted) {
          console.log('[Rahi SW] Stream was cleanly aborted.');
        } else {
          console.error('[Rahi SW] Streaming error:', err);
          try {
            port.postMessage({
              type: 'ERROR',
              streamId,
              error: err.message,
            });
          } catch (_) {}
        }
      } finally {
        activeAbortController = null;
      }
    }
  });
});

// Clean up tab-scoped chat session on tab close to prevent memory/storage leaks
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const sessionKey = `chat_session_${tabId}`;
    await chrome.storage.local.remove(sessionKey);
    console.log(`[Rahi SW] Cleaned up chat session for closed tab ${tabId}`);
  } catch (err) {
    console.warn(`[Rahi SW] Failed to cleanup session for tab ${tabId}:`, err);
  }
});


