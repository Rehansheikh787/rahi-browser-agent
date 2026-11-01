/**
 * Rahi - "Find It for Me" Element Locator & Pulse Highlighter
 * Enables users to ask natural language questions ("Where is the sign up button?", "Find search")
 * and visually highlights the matching interactive element with pulse animations.
 */

import { callAIWithFailover } from '../../background/ai_gateway.js';
import { extractActionJSON } from '../../lib/schema_validator.js';

/**
 * Builds the element locator system prompt and input
 * @param {string} userQuery Natural language target description
 * @param {Array<Object>} manifest Scanned interactive elements manifest
 * @param {string} [language='en']
 * @returns {{ prompt: string, systemInstruction: string }}
 */
export function buildElementLocatorPrompt(userQuery, manifest, language = 'en') {
  const elementsSummary = (manifest || []).slice(0, 150).map((m) => {
    let line = `[#${m.id}] ${m.type} "${m.label || ''}"`;
    if (m.placeholder) line += ` (placeholder: "${m.placeholder}")`;
    if (m.value) line += ` (value: "${m.value}")`;
    return line;
  }).join('\n');

  const systemInstruction = `You are Rahi's Precision Element Locator.
Your goal is to inspect a list of numbered interactive elements from the user's active browser page and identify the SINGLE element ID that best matches their search query.
If multiple elements could match, choose the primary or most standard one.
If no element matches, select the closest candidate or return targetId: null.

Output STRICT JSON only with this schema:
{
  "targetId": number | null,
  "confidence": "high" | "medium" | "low",
  "explanation": "Brief 1-sentence explanation of why this element was selected"
}`;

  const langDirective = language === 'hi'
    ? '\nNote: Provide the explanation in conversational Hindi/Hinglish.'
    : '';

  const prompt = `User search query: "${userQuery}"\n\nNumbered Interactive Elements on Page:\n${elementsSummary}${langDirective}\n\nRespond with strict JSON only.`;

  return { prompt, systemInstruction };
}

/**
 * Executes the complete Find It for Me flow on the active tab
 * @param {Object} params
 * @param {number} params.tabId
 * @param {string} params.query User query
 * @param {string} params.apiKey Gemini/Groq API key
 * @param {string} [params.model='gemini-3.5-flash-lite']
 * @param {string} [params.language='en']
 * @returns {Promise<{ success: boolean, targetId?: number, explanation?: string, label?: string, error?: string }>}
 */
export async function findAndHighlightElement({
  tabId,
  query,
  apiKey,
  tabUrl = null,
  groqApiKey = null,
  model = 'gemini-3.5-flash-lite',
  language = 'en',
}) {
  if (!tabId) {
    throw new Error('No active browser tab specified');
  }
  if (tabUrl && (/^(chrome|edge|about|chrome-extension):/i.test(tabUrl) || tabUrl.includes('chromewebstore.google.com'))) {
    throw new Error('Rahi cannot operate on browser internal pages (chrome://, etc.). Please switch to a web page.');
  }
  if (!query || !query.trim()) {
    throw new Error('Please enter an element or button name to find');
  }

  // 1. Scan interactive elements (Message passing first, executeScript fallback)
  let manifest = null;

  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'SCAN_ELEMENTS' });
    if (res && res.success && Array.isArray(res.manifest) && res.manifest.length > 0) {
      manifest = res.manifest;
      await chrome.tabs.sendMessage(tabId, { action: 'SHOW_BADGES', manifest }).catch(() => {});
    }
  } catch (_) {}

  if (!manifest) {
    let isLoaded = false;
    try {
      const check = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof window.rahiScanInteractiveElements === 'function' && typeof window.rahiShowBadges === 'function',
      });
      isLoaded = check?.[0]?.result === true;
    } catch (_) {}

    if (!isLoaded) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/scanner.js', 'content/badge_overlay.js', 'content/safety_guard.js', 'content/executor.js'],
        });
      } catch (_) {}
    }

    const scanResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.rahiScanInteractiveElements === 'function') {
          const items = window.rahiScanInteractiveElements();
          if (typeof window.rahiShowBadges === 'function') {
            window.rahiShowBadges(items);
          }
          return items;
        }
        return [];
      },
    });

    manifest = scanResults?.[0]?.result || [];
  }

  if (!manifest || manifest.length === 0) {
    throw new Error('No visible interactive elements (buttons, links, inputs) were detected on this page.');
  }

  // 3. Build prompt and query AI Gateway
  const { prompt, systemInstruction } = buildElementLocatorPrompt(query, manifest, language);

  const aiResult = await callAIWithFailover({
    geminiApiKey: apiKey,
    groqApiKey: groqApiKey || null,
    model,
    prompt,
    systemInstruction,
    language,
    temperature: 0.1, // High determinism
  });

  const responseText = aiResult.text;

  // 4. Parse JSON decision
  const decision = extractActionJSON(responseText);
  const targetId = Number(decision?.targetId ?? decision?.id ?? decision?.elementId);
  if (!targetId || isNaN(targetId)) {
    throw new Error(decision?.explanation || `Could not find an element matching "${query}" on this page.`);
  }

  const matchedElement = manifest.find((m) => Number(m.id) === targetId);

  // 5. Highlight element with pulse ring on page
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (id) => {
      if (typeof window.rahiHighlightElement === 'function') {
        return window.rahiHighlightElement(id, true);
      }
      return false;
    },
    args: [targetId],
  });

  return {
    success: true,
    targetId,
    explanation: decision.explanation || `Highlighted element #${targetId}`,
    label: matchedElement ? `[#${targetId}] ${matchedElement.type}: ${matchedElement.label}` : `#${targetId}`,
    manifest,
  };
}
