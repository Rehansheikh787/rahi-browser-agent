/**
 * Rahi - Background Service Worker (Manifest V3)
 * Coordinates extension lifecycle, side panel behavior, storage hydration,
 * and inter-context message passing.
 */

import { callGemini } from './ai_gateway.js';

// Initialize extension defaults on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Rahi SW] Extension installed/updated: reason = ${details.reason}`);

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

        const result = await callGemini({
          apiKey,
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

  // Fallthrough
  return false;
});

