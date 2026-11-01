/**
 * Rahi - Side Panel State Coordinator & Controller
 * Manages tab switching, settings persistence, profile memory,
 * language toggle, and inter-component routing.
 */

import { summarizeCurrentPage, summarizeYouTubeVideo, renderSummaryCard, clearSummary } from './components/summary.js';
import { ChatController } from './components/chat.js';
import { AgentApprovalController } from './components/approval.js';
import { ProfileController, sanitizeProfile } from './components/profile.js';
import { SkillsController } from './components/skills.js';
import { buildContextActionPrompt } from '../background/context_menus.js';

let chatController = null;
let agentController = null;
let profileController = null;
let skillsController = null;

// Global State Cache
const state = {
  settings: {
    geminiApiKey: '',
    groqApiKey: '',
    preferredLanguage: 'en',
    defaultModel: 'gemini-3.5-flash-lite',
    maxStepLimit: 15,
    enableDryRunDefault: false,
  },
  userProfile: null,
  activeTab: null,
};

// DOM Element References
const elements = {
  // Navigation Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  tabViews: document.querySelectorAll('.tab-view'),

  // Header & Status
  headerStatus: document.getElementById('headerStatus'),
  statusDot: document.getElementById('statusDot'),
  statusLabel: document.getElementById('statusLabel'),
  chatPageTitle: document.getElementById('chatPageTitle'),
  btnRefreshContext: document.getElementById('btnRefreshContext'),
  footerModelBadge: document.getElementById('footerModelBadge'),

  // Language Toggle
  langToggle: document.getElementById('langToggle'),
  langButtons: document.querySelectorAll('#langToggle .pill-btn'),

  // Settings
  settingGeminiKey: document.getElementById('settingGeminiKey'),
  btnToggleGeminiKey: document.getElementById('btnToggleGeminiKey'),
  settingGroqKey: document.getElementById('settingGroqKey'),
  btnToggleGroqKey: document.getElementById('btnToggleGroqKey'),
  settingDefaultModel: document.getElementById('settingDefaultModel'),
  settingStepLimit: document.getElementById('settingStepLimit'),
  settingDryRunDefault: document.getElementById('settingDryRunDefault'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  btnTestApiKey: document.getElementById('btnTestApiKey'),
  settingsFeedback: document.getElementById('settingsFeedback'),

  // Profile
  profFullName: document.getElementById('profFullName'),
  profEmail: document.getElementById('profEmail'),
  profPhone: document.getElementById('profPhone'),
  profCollege: document.getElementById('profCollege'),
  profDegree: document.getElementById('profDegree'),
  profTone: document.getElementById('profTone'),
  profSkills: document.getElementById('profSkills'),
  profGithub: document.getElementById('profGithub'),
  profLinkedin: document.getElementById('profLinkedin'),
  profPortfolio: document.getElementById('profPortfolio'),
  btnSaveProfile: document.getElementById('btnSaveProfile'),

  // Skills View Elements
  skillsList: document.getElementById('skillsList'),
  btnExportSkills: document.getElementById('btnExportSkills'),
  btnImportSkills: document.getElementById('btnImportSkills'),
  skillsFileInput: document.getElementById('skillsFileInput'),
  btnOpenCreateSkill: document.getElementById('btnOpenCreateSkill'),

  // Chat View Elements
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  btnSendMessage: document.getElementById('btnSendMessage'),
  btnRefreshContext: document.getElementById('btnRefreshContext'),
  btnClearChat: document.getElementById('btnClearChat'),
  btnChatAskScreen: document.getElementById('btnChatAskScreen'),
  quickPills: document.querySelectorAll('.quick-pill'),

  // Summary View Elements
  btnSummarizePage: document.getElementById('btnSummarizePage'),
  summaryContainer: document.getElementById('summaryContainer'),
  youtubeUrlInput: document.getElementById('youtubeUrlInput'),
  btnSummarizeYoutube: document.getElementById('btnSummarizeYoutube'),
  btnResetSummary: document.getElementById('btnResetSummary'),

  // Agent View Elements
  agentGoalInput: document.getElementById('agentGoalInput'),
  btnStartAgent: document.getElementById('btnStartAgent'),
  btnFindElement: document.getElementById('btnFindElement'),
  btnScanElements: document.getElementById('btnScanElements'),
  btnClearBadges: document.getElementById('btnClearBadges'),
  agentStatusPanel: document.getElementById('agentStatusPanel'),
  actionApprovalCard: document.getElementById('actionApprovalCard'),
  approvalStepNumber: document.getElementById('approvalStepNumber'),
  approvalConsequentialBadge: document.getElementById('approvalConsequentialBadge'),
  approvalTargetPreview: document.getElementById('approvalTargetPreview'),
  approvalReason: document.getElementById('approvalReason'),
  consequentialConsentBox: document.getElementById('consequentialConsentBox'),
  chkConsequentialConsent: document.getElementById('chkConsequentialConsent'),
  btnApproveAction: document.getElementById('btnApproveAction'),
  btnDryRunAction: document.getElementById('btnDryRunAction'),
  btnSkipAction: document.getElementById('btnSkipAction'),
  btnStopAction: document.getElementById('btnStopAction'),
  agentLogList: document.getElementById('agentLogList'),
  btnClearLog: document.getElementById('btnClearLog'),
  agentHistoryList: document.getElementById('agentHistoryList'),
  btnClearHistory: document.getElementById('btnClearHistory'),
};

/**
 * Initialize Side Panel Application
 */
async function init() {
  setupTabNavigation();
  setupLanguageToggle();
  setupChatHandlers();
  setupSummaryHandlers();
  setupAgentController();
  setupProfileController();
  setupSkillsController();
  setupSettingsHandlers();
  await loadStorageData();
  await refreshActiveTabInfo();
  await checkPendingContextAction();
}

/**
 * Agent Approval Controller Initialization
 */
function setupAgentController() {
  agentController = new AgentApprovalController({
    elements,
    getSettings: () => state.settings,
    getUserProfile: () => (profileController ? profileController.getProfile() : state.userProfile),
    getActiveTab: () => state.activeTab,
  });
}

/**
 * Profile Controller Initialization
 */
function setupProfileController() {
  profileController = new ProfileController({
    elements,
    onProfileSaved: (savedProfile) => {
      state.userProfile = savedProfile;
    },
  });
}

/**
 * Skills Controller Initialization
 */
function setupSkillsController() {
  skillsController = new SkillsController({
    elements,
    getProfile: () => (profileController ? profileController.getProfile() : (state.userProfile || {})),
    getActiveTab: () => state.activeTab,
    onSwitchTab: (tabId) => switchTab(tabId),
    onExecuteInChat: async ({ prompt, skillName }) => {
      if (chatController) {
        await chatController.sendUserPrompt(prompt, {
          displayPrompt: `**[Skill: ${skillName}]**\n${prompt}`,
        });
      }
    },
    onExecuteInSummary: async ({ skillName, promptTemplate }) => {
      if (elements.btnSummarizePage) {
        elements.btnSummarizePage.click();
      }
    },
    onExecuteInAgent: async ({ goal, isFormFill }) => {
      if (elements.agentGoalInput) {
        elements.agentGoalInput.value = goal;
      }
      if (agentController) {
        await agentController.startTask(goal);
      }
    },
  });
}

/**
 * Tab Navigation Setup
 */
function setupTabNavigation() {
  elements.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTabId = tab.dataset.tab;
      switchTab(targetTabId);
    });
  });
}

function switchTab(tabId) {
  // Update Tab Button States
  elements.navTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });

  // Update View Container States
  elements.tabViews.forEach((view) => {
    view.classList.toggle('active', view.id === `view-${tabId}`);
  });
}

/**
 * Language Toggle (English <-> Hinglish)
 */
function setupLanguageToggle() {
  elements.langButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      state.settings.preferredLanguage = lang;
      
      elements.langButtons.forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
      
      await chrome.storage.local.set({ settings: state.settings });
      console.log(`[Rahi UI] Language switched to: ${lang}`);
    });
  });
}

/**
 * Chat Interaction Handlers
 */
function setupChatHandlers() {
  chatController = new ChatController({
    messagesContainer: elements.chatMessages,
    inputElement: elements.chatInput,
    sendButton: elements.btnSendMessage,
    refreshButton: elements.btnRefreshContext,
    clearButton: elements.btnClearChat,
    askScreenButton: elements.btnChatAskScreen,
    quickPills: elements.quickPills,
    getState: () => state,
    onStatusNotification: (msg) => {
      console.log('[Rahi UI]', msg);
      if (elements.statusLabel) {
        elements.statusLabel.textContent = msg;
        setTimeout(() => {
          updateStatusIndicator();
        }, 3000);
      }
    },
  });

  // Handle quick pill for switching to summary tab
  elements.quickPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const prompt = pill.dataset.prompt;
      if (prompt && prompt.toLowerCase().includes('summarize')) {
        switchTab('summary');
        if (elements.btnSummarizePage) elements.btnSummarizePage.click();
      }
    });
  });
}

/**
 * Safe HTML escaping helper
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Summary View Handlers
 */
function setupSummaryHandlers() {
  if (!elements.btnSummarizePage || !elements.summaryContainer) return;

  elements.btnSummarizePage.addEventListener('click', async () => {
    // Check if API key is configured
    if (!state.settings.geminiApiKey) {
      elements.summaryContainer.innerHTML = `
        <div class="summary-alert warning">
          <p>⚠️ <strong>API Key Required:</strong> Please configure your Google Gemini API key in <strong>Settings</strong> first.</p>
          <button class="btn-primary" style="margin-top: 8px;" id="btnGoToSettings">Open Settings</button>
        </div>
      `;
      const btnGo = elements.summaryContainer.querySelector('#btnGoToSettings');
      if (btnGo) btnGo.addEventListener('click', () => switchTab('settings'));
      return;
    }

    // Render loading indicator
    elements.summaryContainer.innerHTML = `
      <div class="summary-loader">
        <div class="spinner"></div>
        <p id="summaryStatusText">Reading page content with Readability.js...</p>
      </div>
    `;

    const statusEl = elements.summaryContainer.querySelector('#summaryStatusText');

    try {
      const summaryData = await summarizeCurrentPage({
        language: state.settings.preferredLanguage || 'en',
        onStatusUpdate: (status) => {
          if (statusEl) statusEl.textContent = status;
        },
      });

      // Render the structured card
      renderSummaryCard(elements.summaryContainer, summaryData);
    } catch (err) {
      console.error('[Rahi Summary UI] Error:', err);
      elements.summaryContainer.innerHTML = `
        <div class="summary-card" style="border-color: var(--accent-danger);">
          <div class="summary-alert warning" style="color: var(--accent-danger); background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3);">
            <p><strong>⚠️ Summarization Failed:</strong> ${escapeHtml(err.message)}</p>
          </div>
          <button class="btn-secondary" id="btnRetrySummary" style="align-self: flex-start;">🔄 Try Again</button>
        </div>
      `;

      const btnRetry = elements.summaryContainer.querySelector('#btnRetrySummary');
      if (btnRetry) {
        btnRetry.addEventListener('click', () => {
          elements.btnSummarizePage.click();
        });
      }
    }
  });

  // Dedicated YouTube URL Summarizer Button
  if (elements.btnSummarizeYoutube && elements.youtubeUrlInput) {
    elements.btnSummarizeYoutube.addEventListener('click', async () => {
      const url = elements.youtubeUrlInput.value.trim();
      if (!url) {
        alert('Please enter or paste a valid YouTube video URL.');
        return;
      }

      if (!state.settings.geminiApiKey) {
        switchTab('settings');
        return;
      }

      elements.summaryContainer.innerHTML = `
        <div class="summary-loader">
          <div class="spinner"></div>
          <p id="summaryStatusText">Connecting to YouTube video notes...</p>
        </div>
      `;

      const statusEl = elements.summaryContainer.querySelector('#summaryStatusText');

      try {
        const summaryData = await summarizeYouTubeVideo({
          videoUrlOrId: url,
          language: state.settings.preferredLanguage || 'en',
          onStatusUpdate: (st) => {
            if (statusEl) statusEl.textContent = st;
          },
        });

        renderSummaryCard(elements.summaryContainer, summaryData);
      } catch (err) {
        console.error('[Rahi YouTube UI] Error:', err);
        elements.summaryContainer.innerHTML = `
          <div class="summary-card" style="border-color: var(--accent-danger);">
            <div class="summary-alert warning" style="color: var(--accent-danger); background-color: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3);">
              <p><strong>⚠️ YouTube Summarization Failed:</strong> ${escapeHtml(err.message)}</p>
            </div>
          </div>
        `;
      }
    });

    elements.youtubeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        elements.btnSummarizeYoutube.click();
      }
    });
  }

  // Clear / Reset Summary Button
  if (elements.btnResetSummary && elements.summaryContainer) {
    elements.btnResetSummary.addEventListener('click', () => {
      clearSummary(elements.summaryContainer);
      if (elements.youtubeUrlInput) elements.youtubeUrlInput.value = '';
    });
  }
}

/**
 * Load persisted storage data on boot
 */
async function loadStorageData() {
  try {
    const data = await chrome.storage.local.get(['settings', 'userProfile']);

    if (data.settings) {
      state.settings = { ...state.settings, ...data.settings };
      // Transparent migration for deprecated 2.5 models
      if (state.settings.defaultModel === 'gemini-2.5-flash-lite' || !state.settings.defaultModel) {
        state.settings.defaultModel = 'gemini-3.5-flash-lite';
        await chrome.storage.local.set({ settings: state.settings });
      } else if (state.settings.defaultModel === 'gemini-2.5-flash') {
        state.settings.defaultModel = 'gemini-3.8-flash';
        await chrome.storage.local.set({ settings: state.settings });
      }
      populateSettingsForm();
    }

    if (data.userProfile) {
      state.userProfile = data.userProfile;
      populateProfileForm();
    }

    updateStatusIndicator();
  } catch (err) {
    console.error('[Rahi UI] Failed to load storage:', err);
  }
}

/**
 * Settings Form Handling
 */
function setupSettingsHandlers() {
  // Toggle Gemini Key Visibility
  elements.btnToggleGeminiKey.addEventListener('click', () => {
    const isPass = elements.settingGeminiKey.type === 'password';
    elements.settingGeminiKey.type = isPass ? 'text' : 'password';
    elements.btnToggleGeminiKey.textContent = isPass ? '🔒' : '👁️';
  });

  // Toggle Groq Key Visibility
  elements.btnToggleGroqKey.addEventListener('click', () => {
    const isPass = elements.settingGroqKey.type === 'password';
    elements.settingGroqKey.type = isPass ? 'text' : 'password';
    elements.btnToggleGroqKey.textContent = isPass ? '🔒' : '👁️';
  });

  // Save Settings
  elements.btnSaveSettings.addEventListener('click', async () => {
    state.settings.geminiApiKey = elements.settingGeminiKey.value.trim();
    state.settings.groqApiKey = elements.settingGroqKey.value.trim();
    state.settings.defaultModel = elements.settingDefaultModel.value;
    state.settings.maxStepLimit = parseInt(elements.settingStepLimit.value, 10) || 15;
    state.settings.enableDryRunDefault = elements.settingDryRunDefault.checked;

    try {
      await chrome.storage.local.set({ settings: state.settings });
      showFeedback('settingsFeedback', 'Settings saved successfully!', 'success');
      updateStatusIndicator();
    } catch (err) {
      showFeedback('settingsFeedback', `Error saving: ${err.message}`, 'error');
    }
  });

  // Test API Key Connection
  elements.btnTestApiKey.addEventListener('click', async () => {
    const apiKey = elements.settingGeminiKey.value.trim();
    if (!apiKey) {
      showFeedback('settingsFeedback', 'Please enter a Gemini API key first.', 'error');
      return;
    }

    showFeedback('settingsFeedback', 'Testing Gemini API key connection...', '');
    try {
      const model = elements.settingDefaultModel.value || 'gemini-3.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Ping test. Reply with: OK' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      });

      if (res.ok) {
        showFeedback('settingsFeedback', 'Connection Successful! Gemini API key is valid.', 'success');
      } else {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.error?.message || `HTTP ${res.status}`;
        showFeedback('settingsFeedback', `Connection Failed: ${msg}`, 'error');
      }
    } catch (err) {
      showFeedback('settingsFeedback', `Network error: ${err.message}`, 'error');
    }
  });
}

function populateSettingsForm() {
  elements.settingGeminiKey.value = state.settings.geminiApiKey || '';
  elements.settingGroqKey.value = state.settings.groqApiKey || '';
  elements.settingDefaultModel.value = state.settings.defaultModel || 'gemini-3.5-flash-lite';
  elements.settingStepLimit.value = state.settings.maxStepLimit || 15;
  elements.settingDryRunDefault.checked = !!state.settings.enableDryRunDefault;

  // Language buttons
  const lang = state.settings.preferredLanguage || 'en';
  elements.langButtons.forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));

  // Footer badge
  elements.footerModelBadge.textContent = state.settings.defaultModel === 'gemini-3.8-flash'
    ? 'Gemini 3.8 Flash'
    : 'Gemini 3.5 Flash-Lite';
}

/**
 * Active Tab Information
 */
async function refreshActiveTabInfo(explicitTabId = null) {
  try {
    let activeTab = null;

    if (explicitTabId && chrome.tabs?.get) {
      try {
        activeTab = await chrome.tabs.get(explicitTabId);
      } catch (_) {}
    }

    if (!activeTab && chrome.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tabs && tabs[0]) activeTab = tabs[0];
      } catch (_) {}
      if (!activeTab) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs && tabs[0]) activeTab = tabs[0];
        } catch (_) {}
      }
    }

    if (activeTab) {
      state.activeTab = activeTab;
      const title = activeTab.title || 'Untitled Tab';
      elements.chatPageTitle.textContent = title;
      elements.chatPageTitle.title = activeTab.url || title;

      if (chatController) {
        await chatController.setTab(activeTab);
      }

      // Auto-prefill YouTube URL input if viewing YouTube
      if (activeTab.url && elements.youtubeUrlInput && !elements.youtubeUrlInput.value) {
        if (/youtube\.com|youtu\.be/i.test(activeTab.url)) {
          elements.youtubeUrlInput.value = activeTab.url;
        }
      }
    } else {
      elements.chatPageTitle.textContent = 'No Active Tab';
    }
  } catch (err) {
    console.warn('[Rahi UI] Could not query active tab:', err);
    elements.chatPageTitle.textContent = 'Browser Context Active';
  }
}

// Sync active tab changes dynamically in Side Panel
try {
  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await refreshActiveTabInfo(activeInfo?.tabId);
    });
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (changeInfo.status === 'complete' && state.activeTab && state.activeTab.id === tabId) {
        await refreshActiveTabInfo(tabId);
      }
    });
  }
} catch (tabEvtErr) {
  console.warn('[Rahi UI] Could not register tab event listeners:', tabEvtErr);
}

if (elements.btnRefreshContext) {
  elements.btnRefreshContext.addEventListener('click', () => {
    refreshActiveTabInfo();
  });
}

/**
 * Checks and executes any pending context menu actions from right-clicks
 */
async function checkPendingContextAction() {
  try {
    const data = await chrome.storage.local.get('pendingContextAction');
    const pending = data.pendingContextAction;
    if (pending && pending.selectionText) {
      // Clear from storage immediately to prevent re-execution
      await chrome.storage.local.remove('pendingContextAction');

      // Switch to Chat tab
      switchTab('chat');

      const { prompt, systemInstruction, label } = buildContextActionPrompt(
        pending.mode,
        pending.selectionText,
        state.userProfile
      );

      const displayPrompt = `**${label}:**\n> "${escapeHtml(pending.selectionText)}"`;

      if (chatController) {
        await chatController.sendUserPrompt(prompt, {
          customSystemInstruction: systemInstruction,
          displayPrompt,
        });
      }
    }
  } catch (err) {
    console.warn('[Rahi UI] Error checking pending context action:', err);
  }
}

// Listen for live broadcast when Side Panel is already open
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === 'CONTEXT_ACTION_TRIGGERED') {
    checkPendingContextAction();
  }
});

/**
 * Status Indicator
 */
function updateStatusIndicator() {
  const hasKey = Boolean(state.settings.geminiApiKey);
  if (hasKey) {
    elements.statusDot.className = 'status-dot online';
    elements.statusLabel.textContent = 'Ready';
  } else {
    elements.statusDot.className = 'status-dot warning';
    elements.statusLabel.textContent = 'API Key Needed';
  }
}

/**
 * UI Feedback Helper
 */
function showFeedback(elementId, text, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.className = `status-feedback ${type}`;
}

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', init);
