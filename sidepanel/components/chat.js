/**
 * Rahi - Grounded Page Chat Component (Manifest V3)
 * Implements real-time token streaming via long-lived runtime port (rahi-stream),
 * strict context containment prompting (no hallucinations),
 * tab-scoped sliding window history in chrome.storage.local,
 * and resilient reconnect handling.
 */

const MAX_WINDOW_MESSAGES = 20;

// Port singleton and stream callbacks map
let streamPort = null;
const streamCallbacks = new Map(); // streamId -> { onChunk, onDone, onError }

// In-memory tab page context cache: tabId -> { title, url, textContent, extractedAt }
const pageContextCache = new Map();

/**
 * Strips HTML tags and sanitizes strings to prevent XSS
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Lightweight safe markdown renderer for chat messages
 * Handles code blocks, inline code, bold, lists, and line breaks.
 * @param {string} text - Raw markdown text
 * @returns {string} Rendered HTML string
 */
export function formatMarkdown(text) {
  if (!text) return '';

  // 1. Extract and protect code blocks
  const codeBlocks = [];
  let processed = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(
      `<pre class="code-block"><code class="lang-${escapeHtml(lang)}">${escapeHtml(code.trim())}</code></pre>`
    );
    return placeholder;
  });

  // 2. Escape HTML for the rest of the text
  processed = escapeHtml(processed);

  // 3. Inline code: `code`
  processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // 4. Bold: **text** or __text__
  processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 5. Bullet items: lines starting with * or -
  const lines = processed.split('\n');
  const formattedLines = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[\*\-]\s+(.*)/.test(trimmed)) {
      const itemContent = trimmed.replace(/^[\*\-]\s+/, '');
      if (!inList) {
        formattedLines.push('<ul class="chat-list">');
        inList = true;
      }
      formattedLines.push(`<li>${itemContent}</li>`);
    } else {
      if (inList) {
        formattedLines.push('</ul>');
        inList = false;
      }
      formattedLines.push(line);
    }
  }
  if (inList) {
    formattedLines.push('</ul>');
  }

  processed = formattedLines.join('\n');

  // 6. Restore code blocks
  codeBlocks.forEach((block, idx) => {
    processed = processed.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  // 7. Double line breaks into paragraphs; single line breaks into <br>
  return processed
    .split(/\n\s*\n/)
    .map((chunk) => {
      const trimmed = chunk.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<pre') || trimmed.startsWith('<ul')) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

/**
 * Builds the strict grounded context system instruction
 * Enforces zero-hallucination and exact refusal string if info is absent.
 * @param {Object} params
 * @param {string} params.pageTitle
 * @param {string} params.pageUrl
 * @param {string} params.pageText
 * @param {string} [params.language='en']
 * @returns {string} System instruction string
 */
export function buildGroundedChatPrompt({ pageTitle, pageUrl, pageText, language = 'en' }) {
  const langRule = language === 'hinglish'
    ? '\n[LANGUAGE REQUIREMENT]: Reply in natural, conversational Hinglish (Indian English with colloquial Hindi markers like "Is page par", "Aap dekh sakte hain", "yeh button click karein").'
    : '\n[LANGUAGE REQUIREMENT]: Reply in concise, professional English.';

  const cleanContext = (pageText || '').trim();

  return `You are Rahi, an intelligent browser assistant.
The user is asking questions about the active web page:
Page Title: "${pageTitle || 'Untitled Page'}"
Page URL: ${pageUrl || 'unknown'}

[PAGE CONTEXT]
${cleanContext || 'No readable page text available.'}
[END OF PAGE CONTEXT]

STRICT GROUNDING RULES:
1. Answer the user's question using ONLY facts, numbers, and data directly mentioned in the [PAGE CONTEXT] above.
2. If the user's question cannot be answered using the [PAGE CONTEXT], reply EXACTLY:
"I couldn't find that information on this page."
3. Do NOT invent, assume, extrapolate, or introduce external world knowledge that is not directly verified by this page.
4. Keep your answers direct, structured, and easy to read.${langRule}`;
}

/**
 * Prunes sliding window history to maximum allowable messages (default: 20 messages = 10 turns)
 * @param {Array} messages
 * @param {number} [maxCount=20]
 * @returns {Array} Pruned messages array
 */
export function pruneSlidingWindow(messages, maxCount = MAX_WINDOW_MESSAGES) {
  if (!Array.isArray(messages)) return [];
  if (messages.length <= maxCount) return [...messages];
  return messages.slice(-maxCount);
}

/**
 * Connects or returns existing long-lived stream port to service worker (ADR-005 & EC-1.2)
 * @returns {chrome.runtime.Port}
 */
export function getOrCreateStreamPort() {
  if (streamPort) {
    try {
      // Test if port is still connected
      streamPort.postMessage({ ping: true });
      return streamPort;
    } catch (_) {
      streamPort = null;
    }
  }

  streamPort = chrome.runtime.connect({ name: 'rahi-stream' });
  console.log('[Rahi Chat] Connected to long-lived stream port (rahi-stream)');

  streamPort.onDisconnect.addListener(() => {
    console.warn('[Rahi Chat] Stream port disconnected. Cleaning up active streams...');
    streamPort = null;
    // Notify all active listeners of disconnect
    streamCallbacks.forEach(({ onError }) => {
      if (onError) onError(new Error('Streaming port disconnected unexpectedly.'));
    });
    streamCallbacks.clear();
  });

  streamPort.onMessage.addListener((msg) => {
    if (!msg || !msg.streamId) return;
    const callbacks = streamCallbacks.get(msg.streamId);
    if (!callbacks) return;

    if (msg.type === 'CHUNK') {
      if (callbacks.onChunk) callbacks.onChunk(msg.text || '');
    } else if (msg.type === 'PROVIDER_SWITCHED') {
      console.log('[Rahi Stream] Provider switched:', msg.provider, msg.note);
      if (callbacks.onProviderSwitched) callbacks.onProviderSwitched(msg.provider, msg.note);
    } else if (msg.type === 'DONE') {
      if (callbacks.onDone) callbacks.onDone(msg.fullText || '');
      streamCallbacks.delete(msg.streamId);
    } else if (msg.type === 'ERROR') {
      if (callbacks.onError) callbacks.onError(new Error(msg.error || 'Streaming error'));
      streamCallbacks.delete(msg.streamId);
    }
  });

  return streamPort;
}

/**
 * Checks if a tab URL is restricted by Chrome security from script injection
 * @param {string} url
 * @returns {boolean}
 */
export function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^(chrome|chrome-extension|edge|about|devtools):/i.test(url) || url.includes('chromewebstore.google.com');
}

/**
 * Extracts and caches content from active tab
 * @param {number} tabId
 * @returns {Promise<Object>}
 */
export async function getOrExtractPageContext(tabId) {
  if (!tabId) {
    throw new Error('No active browser tab found.');
  }

  if (pageContextCache.has(tabId)) {
    const cached = pageContextCache.get(tabId);
    // Cache valid for 3 minutes
    if (Date.now() - cached.extractedAt < 180000) {
      return cached;
    }
  }

  // Check if target tab is an internal or restricted browser page
  let tab = null;
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.get) {
      tab = await chrome.tabs.get(tabId);
    }
  } catch (_) {}

  const url = tab?.url || '';
  if (isRestrictedUrl(url)) {
    const restrictedContext = {
      title: tab?.title || 'System Page',
      url,
      textContent: 'Browser system/internal pages (e.g. chrome:// or extensions) are protected by browser security and cannot be scraped directly.',
      extractedAt: Date.now(),
      isRestricted: true,
    };
    pageContextCache.set(tabId, restrictedContext);
    return restrictedContext;
  }

  let extracted = null;

  // Primary method: Direct in-tab invocation via chrome.scripting.executeScript.
  // This bypasses extension messaging ports completely, eliminating any "Receiving end does not exist" errors.
  try {
    if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
      const execResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (typeof window.rahiExtractPageContent === 'function') {
            return window.rahiExtractPageContent();
          }
          return null;
        },
      });

      if (execResults && execResults[0] && execResults[0].result) {
        extracted = execResults[0].result;
      } else {
        // Content script not loaded yet (e.g. tab opened before extension installed/reloaded)
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['lib/readability.js', 'content/extractor.js', 'content/screenshot_crop.js', 'content/content.js'],
        });

        const retryResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            if (typeof window.rahiExtractPageContent === 'function') {
              return window.rahiExtractPageContent();
            }
            return null;
          },
        });

        if (retryResults && retryResults[0] && retryResults[0].result) {
          extracted = retryResults[0].result;
        }
      }
    }
  } catch (scriptErr) {
    // Non-fatal if scripting is not permitted on this specific tab
    console.log('[Rahi Chat] Script extraction note:', scriptErr.message);
  }

  // Graceful fallback if scripting produced no result
  if (!extracted) {
    try {
      extracted = await chrome.tabs.sendMessage(tabId, { action: 'EXTRACT_CONTENT' });
    } catch (_) {
      // Ignored - fallback context below
    }
  }

  if (!extracted || !extracted.success) {
    return {
      title: tab?.title || extracted?.title || 'Active Web Page',
      url: extracted?.url || url,
      textContent: extracted?.textContent || 'No readable page text available.',
      extractedAt: Date.now(),
    };
  }

  const contextData = {
    title: extracted.title || tab?.title || 'Active Web Page',
    url: extracted.url || url,
    textContent: extracted.textContent || '',
    extractedAt: Date.now(),
  };

  pageContextCache.set(tabId, contextData);
  return contextData;
}

/**
 * Load tab-scoped chat session from chrome.storage.local
 * @param {number} tabId
 * @returns {Promise<{ messages: Array, title?: string, url?: string }>}
 */
export async function loadTabChatSession(tabId) {
  if (!tabId) return { messages: [] };
  const key = `chat_session_${tabId}`;
  try {
    const data = await chrome.storage.local.get(key);
    return data[key] || { messages: [] };
  } catch (err) {
    console.warn(`[Rahi Chat] Error loading session for tab ${tabId}:`, err);
    return { messages: [] };
  }
}

/**
 * Save tab-scoped chat session to chrome.storage.local
 * @param {number} tabId
 * @param {Object} sessionData
 */
export async function saveTabChatSession(tabId, sessionData) {
  if (!tabId) return;
  const key = `chat_session_${tabId}`;
  try {
    const payload = {};
    payload[key] = {
      ...sessionData,
      messages: pruneSlidingWindow(sessionData.messages || []),
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set(payload);
  } catch (err) {
    console.warn(`[Rahi Chat] Error saving session for tab ${tabId}:`, err);
  }
}

/**
 * Chat Controller Class for UI interaction
 */
export class ChatController {
  constructor({
    messagesContainer,
    inputElement,
    sendButton,
    refreshButton,
    quickPills,
    getState,
    onStatusNotification,
  }) {
    this.container = messagesContainer;
    this.input = inputElement;
    this.sendBtn = sendButton;
    this.refreshBtn = refreshButton;
    this.quickPills = quickPills;
    this.getState = getState;
    this.notify = onStatusNotification || console.log;

    this.activeTabId = null;
    this.session = { messages: [] };
    this.isStreaming = false;

    this.initListeners();
  }

  initListeners() {
    if (this.sendBtn && this.input) {
      this.sendBtn.addEventListener('click', () => this.handleSendMessage());

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendMessage();
        }
      });
    }

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', async () => {
        await this.refreshPageContext(true);
      });
    }

    if (this.quickPills) {
      this.quickPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          if (pill.id === 'btnAskScreen') {
            this.handleAskScreen();
            return;
          }
          const prompt = pill.dataset.prompt;
          if (prompt) {
            this.sendUserPrompt(prompt);
          }
        });
      });
    }
  }

  async setTab(tab) {
    if (!tab || !tab.id) return;
    this.activeTabId = tab.id;

    // Load persisted session for this tab
    this.session = await loadTabChatSession(tab.id);
    this.renderSession();
  }

  async refreshPageContext(showFeedback = false) {
    if (!this.activeTabId) return;
    try {
      pageContextCache.delete(this.activeTabId);
      const ctx = await getOrExtractPageContext(this.activeTabId);
      const wordCount = (ctx.textContent || '').trim().split(/\s+/).length;
      if (showFeedback) {
        this.notify(`Page context refreshed (${wordCount} words extracted).`);
      }
    } catch (err) {
      if (showFeedback) {
        this.notify(`Context refresh failed: ${err.message}`);
      }
    }
  }

  renderSession() {
    if (!this.container) return;

    if (!this.session.messages || this.session.messages.length === 0) {
      // Show default greeting
      this.container.innerHTML = `
        <div class="message assistant">
          <div class="message-content">
            <p>Namaste! I am <strong>Rahi</strong>, your AI browser agent.</p>
            <p>I can answer questions grounded strictly in this page, summarize articles, or help you navigate. Select an option below to start:</p>
            <div class="quick-prompts">
              <button class="quick-pill" data-prompt="Summarize the core takeaways of this page">📌 Summarize page</button>
              <button class="quick-pill" data-prompt="What are the main actionable points mentioned here?">🎯 Action points</button>
              <button class="quick-pill" id="btnAskScreen">📷 Ask about screen</button>
            </div>
          </div>
          <span class="message-time">Just now</span>
        </div>
      `;
      // Re-attach listeners to pills
      const newPills = this.container.querySelectorAll('.quick-pill');
      newPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          if (pill.id === 'btnAskScreen') {
            this.handleAskScreen();
            return;
          }
          const prompt = pill.dataset.prompt;
          if (prompt) this.sendUserPrompt(prompt);
        });
      });
      return;
    }

    this.container.innerHTML = '';
    this.session.messages.forEach((msg) => {
      this.appendMessageToDOM(msg.role, msg.content, {
        timestamp: msg.timestamp,
        isMarkdown: true,
      });
    });
    this.scrollToBottom();
  }

  appendMessageToDOM(role, content, { timestamp = null, isMarkdown = true, isStreaming = false } = {}) {
    if (!this.container) return null;

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (isStreaming) {
      contentDiv.innerHTML = '<span class="streaming-text"></span><span class="stream-cursor">▊</span>';
    } else if (isMarkdown) {
      contentDiv.innerHTML = formatMarkdown(content);
    } else {
      contentDiv.innerHTML = `<p>${escapeHtml(content)}</p>`;
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    const time = timestamp ? new Date(timestamp) : new Date();
    timeSpan.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.appendChild(contentDiv);
    msgDiv.appendChild(timeSpan);
    this.container.appendChild(msgDiv);

    this.scrollToBottom();
    return msgDiv;
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  async handleSendMessage() {
    if (this.isStreaming || !this.input) return;
    const text = this.input.value.trim();
    if (!text) return;

    this.input.value = '';
    await this.sendUserPrompt(text);
  }

  async sendUserPrompt(promptText, { customSystemInstruction = null, displayPrompt = null } = {}) {
    if (this.isStreaming) return;

    const state = this.getState();
    const apiKey = state.settings.geminiApiKey;
    if (!apiKey) {
      this.appendMessageToDOM('user', displayPrompt || promptText);
      this.appendMessageToDOM(
        'assistant',
        '⚠️ Gemini API key is missing. Please go to the **Settings** tab and enter your Google Gemini API key to enable AI responses.'
      );
      return;
    }

    // 1. Render user message bubble
    const userBubbleText = displayPrompt || promptText;
    this.appendMessageToDOM('user', userBubbleText);

    // Record user message in session
    this.session.messages.push({
      role: 'user',
      content: userBubbleText,
      timestamp: Date.now(),
    });

    // 2. Render streaming assistant bubble
    const assistantBubble = this.appendMessageToDOM('assistant', '', { isStreaming: true });
    const contentDiv = assistantBubble.querySelector('.message-content');
    const textSpan = assistantBubble.querySelector('.streaming-text');
    const cursorSpan = assistantBubble.querySelector('.stream-cursor');

    this.isStreaming = true;

    try {
      // 3. Extract page context for grounding
      let pageContext = null;
      try {
        pageContext = await getOrExtractPageContext(this.activeTabId);
      } catch (extErr) {
        console.warn('[Rahi Chat] Context extraction note:', extErr.message);
        pageContext = {
          title: state.activeTab?.title || 'Active Tab',
          url: state.activeTab?.url || '',
          textContent: 'Could not extract full readable DOM. Answer best using available page context.',
        };
      }

      // 4. Construct grounded system instruction or use custom instruction
      const systemInstruction = customSystemInstruction || buildGroundedChatPrompt({
        pageTitle: pageContext.title,
        pageUrl: pageContext.url,
        pageText: pageContext.textContent,
        language: state.settings.preferredLanguage || 'en',
      });

      // 5. Build multi-turn Gemini contents array (sliding window)
      // Note: Gemini uses role 'model' instead of 'assistant'
      const contents = [];
      const windowMessages = pruneSlidingWindow(this.session.messages);

      windowMessages.forEach((msg) => {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      });

      // 6. Connect to long-lived stream port and stream response
      const port = getOrCreateStreamPort();
      const streamId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let accumulatedResponse = '';

      await new Promise((resolve, reject) => {
        streamCallbacks.set(streamId, {
          onChunk: (delta) => {
            accumulatedResponse += delta;
            if (textSpan) {
              textSpan.textContent = accumulatedResponse;
              this.scrollToBottom();
            }
          },
          onDone: (fullText) => {
            if (cursorSpan) cursorSpan.remove();
            if (contentDiv) {
              contentDiv.innerHTML = formatMarkdown(fullText || accumulatedResponse);
            }
            resolve(fullText || accumulatedResponse);
          },
          onError: (err) => {
            if (cursorSpan) cursorSpan.remove();
            reject(err);
          },
        });

        port.postMessage({
          action: 'STREAM_CHAT',
          streamId,
          tabId: this.activeTabId,
          pageUrl: pageContext.url,
          pageTitle: pageContext.title,
          prompt: promptText,
          contents,
          systemInstruction,
          language: state.settings.preferredLanguage || 'en',
          model: state.settings.defaultModel || 'gemini-3.5-flash-lite',
          apiKey,
        });
      });

      // Record assistant message in session and persist
      this.session.messages.push({
        role: 'assistant',
        content: accumulatedResponse,
        timestamp: Date.now(),
      });
      await saveTabChatSession(this.activeTabId, this.session);
    } catch (err) {
      console.error('[Rahi Chat] Streaming response error:', err);
      if (contentDiv) {
        contentDiv.innerHTML = `<p style="color: var(--accent-danger);">⚠️ <strong>Request Error:</strong> ${escapeHtml(err.message)}</p>`;
      }
    } finally {
      this.isStreaming = false;
      this.scrollToBottom();
    }
  }

  /**
   * Triggers viewport capture and interactive crop overlay (ADR-006 & EC-4.1 - EC-4.4)
   */
  async handleAskScreen() {
    if (this.isStreaming) return;

    const state = this.getState();
    const apiKey = state.settings.geminiApiKey;
    if (!apiKey) {
      this.appendMessageToDOM(
        'assistant',
        '⚠️ Gemini API key is missing. Please go to the **Settings** tab and enter your Google Gemini API key to enable visual queries.'
      );
      return;
    }

    this.notify('Drag on the webpage to select an area to analyze...');

    try {
      const response = await chrome.runtime.sendMessage({ action: 'CAPTURE_AND_CROP_SCREEN' });

      if (!response) {
        throw new Error('No response from screenshot capture service.');
      }

      if (response.cancelled) {
        this.notify('Screenshot cancelled.');
        return;
      }

      if (!response.success) {
        throw new Error(response.error || 'Failed to capture screenshot');
      }

      // EC-4.3: DRM protected content warning
      if (response.isDrmProtected) {
        this.appendMessageToDOM(
          'assistant',
          '⚠️ **DRM Protected Content:** The captured screen area appears black because the active media is protected by browser DRM (e.g. Netflix, Prime Video, Disney+). Visual analysis cannot be performed.'
        );
        return;
      }

      // Check if user already typed a specific question in chat input
      let question = this.input ? this.input.value.trim() : '';
      if (this.input) this.input.value = '';
      if (!question) {
        question = 'Analyze this screenshot and explain the core information, charts, or errors shown.';
      }

      // Render user bubble with screenshot preview
      const userBubble = this.appendMessageToDOM('user', question);
      const contentDiv = userBubble.querySelector('.message-content');
      if (contentDiv) {
        const previewDiv = document.createElement('div');
        previewDiv.className = 'screenshot-preview';
        previewDiv.innerHTML = `<img src="${response.croppedDataUrl}" alt="Cropped Screenshot"><span class="screenshot-badge">${response.width}×${response.height}</span>`;
        contentDiv.prepend(previewDiv);
      }

      this.session.messages.push({
        role: 'user',
        content: `[Screenshot Query]: ${question}`,
        timestamp: Date.now(),
      });

      // Render streaming assistant bubble
      const assistantBubble = this.appendMessageToDOM('assistant', '', { isStreaming: true });
      const assistantContentDiv = assistantBubble.querySelector('.message-content');
      const textSpan = assistantBubble.querySelector('.streaming-text');
      const cursorSpan = assistantBubble.querySelector('.stream-cursor');

      this.isStreaming = true;

      const base64Data = response.croppedDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');

      const contents = [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: base64Data,
              },
            },
            {
              text: question,
            },
          ],
        },
      ];

      const systemInstruction = `You are Rahi, an expert visual AI assistant.
Examine the provided screenshot image closely. Answer the user's question with precise visual grounding.
If reading a chart, diagram, formula, table, or error message, quote exact labels, values, and trends observed in the image.
Keep your response clear, well-structured, and concise.`;

      const port = getOrCreateStreamPort();
      const streamId = `vision_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      let accumulatedResponse = '';

      await new Promise((resolve, reject) => {
        streamCallbacks.set(streamId, {
          onChunk: (delta) => {
            accumulatedResponse += delta;
            if (textSpan) {
              textSpan.textContent = accumulatedResponse;
              this.scrollToBottom();
            }
          },
          onDone: (fullText) => {
            if (cursorSpan) cursorSpan.remove();
            if (assistantContentDiv) {
              assistantContentDiv.innerHTML = formatMarkdown(fullText || accumulatedResponse);
            }
            resolve(fullText || accumulatedResponse);
          },
          onError: (err) => {
            if (cursorSpan) cursorSpan.remove();
            reject(err);
          },
        });

        port.postMessage({
          action: 'STREAM_CHAT',
          streamId,
          tabId: this.activeTabId,
          prompt: question,
          contents,
          systemInstruction,
          language: state.settings.preferredLanguage || 'en',
          model: 'gemini-3.8-flash',
          apiKey,
        });
      });

      this.session.messages.push({
        role: 'assistant',
        content: accumulatedResponse,
        timestamp: Date.now(),
      });
      await saveTabChatSession(this.activeTabId, this.session);
    } catch (err) {
      console.error('[Rahi Chat] Visual query error:', err);
      this.appendMessageToDOM('assistant', `⚠️ **Screenshot Error:** ${escapeHtml(err.message)}`);
    } finally {
      this.isStreaming = false;
      this.scrollToBottom();
    }
  }
}
