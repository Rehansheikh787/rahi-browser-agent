/**
 * Rahi - Context Menus Module (Manifest V3)
 * Registers right-click menu actions on selected page text (Explain, Translate, Draft Reply)
 * and dispatches actions to Side Panel with pending storage fallbacks.
 */

export const CONTEXT_MENU_IDS = {
  EXPLAIN: 'rahi_explain',
  TRANSLATE: 'rahi_translate',
  REPLY: 'rahi_reply',
};

/**
 * Builds user prompt and system instruction based on selected context menu action
 * @param {string} mode - 'rahi_explain' | 'rahi_translate' | 'rahi_reply'
 * @param {string} selectionText - The text selected by user
 * @param {Object} [userProfile] - Optional user profile memory for reply tone
 * @returns {{ prompt: string, systemInstruction: string, label: string }}
 */
export function buildContextActionPrompt(mode, selectionText, userProfile = null) {
  const cleanSelection = (selectionText || '').trim();

  switch (mode) {
    case CONTEXT_MENU_IDS.EXPLAIN:
      return {
        label: 'Explain Selection',
        prompt: `Explain the following selected text in simple, clear, and intuitive terms:\n\n"${cleanSelection}"`,
        systemInstruction: `You are Rahi, an expert tutor and AI browser assistant. Explain concepts clearly, concisely, and with relatable analogies. Avoid unnecessary fluff or jargon.`,
      };

    case CONTEXT_MENU_IDS.TRANSLATE:
      return {
        label: 'Translate Selection',
        prompt: `Translate the following text. If it is in English, translate it accurately into Hindi (both Devanagari script and Romanized Hinglish). If it is in Hindi or another language, translate it into natural, fluent English:\n\n"${cleanSelection}"`,
        systemInstruction: `You are Rahi, a high-fidelity translator. Provide clean, faithful translations preserving nuance and tone without commentary.`,
      };

    case CONTEXT_MENU_IDS.REPLY: {
      const tone = userProfile?.preferredTone || 'polite and professional';
      const senderInfo = userProfile?.fullName ? `from ${userProfile.fullName}` : '';
      return {
        label: 'Draft Reply',
        prompt: `Draft a concise, ${tone} reply ${senderInfo} to the following message or email snippet:\n\n"${cleanSelection}"\n\nProvide 2 variations: a quick short reply and a complete thoughtful reply.`,
        systemInstruction: `You are Rahi, an executive communication assistant. Draft clear, polite, and effective replies adhering to the requested tone.`,
      };
    }

    default:
      return {
        label: 'Analyze Selection',
        prompt: `Analyze the following text from the web page:\n\n"${cleanSelection}"`,
        systemInstruction: `You are Rahi, an intelligent browser assistant.`,
      };
  }
}

/**
 * Register Chrome context menu items for text selection
 */
export function setupContextMenus() {
  if (!chrome.contextMenus) return;

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.EXPLAIN,
      title: '💡 Explain with Rahi',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.TRANSLATE,
      title: '🌐 Translate with Rahi',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.REPLY,
      title: '✉️ Draft Reply with Rahi',
      contexts: ['selection'],
    });

    console.log('[Rahi Context Menus] 3 context menus registered.');
  });
}

/**
 * Handle context menu item click
 * Opens side panel and dispatches pending action
 * @param {chrome.contextMenus.OnClickData} info
 * @param {chrome.tabs.Tab} [tab]
 */
export async function handleContextMenuClick(info, tab) {
  if (!info || !info.selectionText) return;

  const mode = info.menuItemId;
  const selectionText = info.selectionText.trim();
  const tabId = tab ? tab.id : null;

  console.log(`[Rahi Context Menus] Action triggered: ${mode} on tab ${tabId}`);

  // 1. Programmatically open Side Panel on the active window/tab
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      if (tabId) {
        await chrome.sidePanel.open({ tabId });
      } else if (tab && tab.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    }
  } catch (panelErr) {
    console.warn('[Rahi Context Menus] Could not open side panel programmatically:', panelErr);
  }

  // 2. Persist pending action in storage so Side Panel picks it up upon mount
  const pendingPayload = {
    id: `context_${Date.now()}`,
    mode,
    selectionText,
    tabId,
    timestamp: Date.now(),
  };

  try {
    await chrome.storage.local.set({ pendingContextAction: pendingPayload });
  } catch (stErr) {
    console.warn('[Rahi Context Menus] Failed to write pending action:', stErr);
  }

  // 3. Also send runtime broadcast in case Side Panel is already open and running
  try {
    await chrome.runtime.sendMessage({
      action: 'CONTEXT_ACTION_TRIGGERED',
      payload: pendingPayload,
    });
  } catch (_) {
    // Side panel might still be opening, payload in storage ensures retrieval
  }
}
