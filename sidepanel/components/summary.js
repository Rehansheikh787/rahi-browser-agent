/**
 * Rahi - Article Summarizer Controller
 * Coordinates content extraction via Mozilla Readability, prompts Gemini with
 * structured schema, and renders TL;DR, 5 key points, and actionable next steps.
 */

/**
 * Generates structured article summary for the current active tab
 * @param {Object} options
 * @param {string} [options.language] - 'en' | 'hinglish'
 * @param {Function} [options.onStatusUpdate] - Status callback for UI loaders
 * @returns {Promise<Object>} The parsed summary data
 */
export async function summarizeCurrentPage({ language = 'en', onStatusUpdate = null } = {}) {
  // 1. Get active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs && tabs[0] ? tabs[0] : null;

  if (!activeTab || !activeTab.id) {
    throw new Error('No active browser tab detected.');
  }

  // Check for restricted URLs (chrome://, edge://, about:blank, store)
  const url = activeTab.url || '';
  if (/^(chrome|edge|about|chrome-extension):/i.test(url) || url.includes('chromewebstore.google.com')) {
    throw new Error('Rahi cannot operate on browser internal or Web Store pages.');
  }

  if (onStatusUpdate) onStatusUpdate('Extracting readable article content...');

  // 2. Request extracted content from content script
  let extracted = null;
  try {
    extracted = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CONTENT' });
  } catch (msgErr) {
    // If content script was not already loaded (e.g. pre-existing tab), inject dynamically
    console.warn('[Rahi Summary] Content script not responding, injecting scripts dynamically...', msgErr);
    if (onStatusUpdate) onStatusUpdate('Injecting content reader...');

    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['lib/readability.js', 'content/extractor.js', 'content/content.js'],
      });

      // Brief delay to allow scripts to initialize
      await new Promise((r) => setTimeout(r, 200));
      extracted = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CONTENT' });
    } catch (injErr) {
      throw new Error(`Failed to extract page content: ${injErr.message}. Try reloading the webpage.`);
    }
  }

  if (!extracted || !extracted.success) {
    const reason = extracted?.error || 'Empty content returned';
    throw new Error(`Could not extract readable content from this page (${reason}).`);
  }

  const textContent = (extracted.textContent || '').trim();
  if (textContent.length < 50) {
    throw new Error('The extracted page content is too short to generate a meaningful summary.');
  }

  if (onStatusUpdate) onStatusUpdate('Rahi AI is generating structured summary...');

  // 3. Construct prompt with strict JSON output schema
  const systemInstruction = `You are Rahi, an expert browser summarizer.
Your goal is to extract the core ideas from web pages and output a clean, accurate structured summary.
Rules:
1. Always adhere strictly to the requested JSON schema. Do NOT include markdown code blocks.
2. The "tldr" must be exactly 1 punchy sentence.
3. The "points" array must contain exactly 5 concise, high-value bullet points.
4. The "nextSteps" array must contain 2-3 practical, actionable takeaways or implications.
5. If language is 'hinglish', write the points in natural conversational Hinglish.`;

  const prompt = `Analyze and summarize the following extracted article:
[PAGE TITLE]: ${extracted.title || 'Untitled'}
[SOURCE URL]: ${extracted.url || ''}
[ARTICLE CONTENT]:
${textContent}

Output ONLY valid JSON matching this schema:
{
  "tldr": "One sentence summary capturing the primary takeaway.",
  "points": [
    "Key point 1",
    "Key point 2",
    "Key point 3",
    "Key point 4",
    "Key point 5"
  ],
  "nextSteps": [
    "Actionable next step 1",
    "Actionable next step 2"
  ]
}`;

  // 4. Dispatch to Background AI Gateway
  const aiResponse = await chrome.runtime.sendMessage({
    action: 'AI_GENERATE_TEXT',
    prompt,
    systemInstruction,
    language,
    temperature: 0.1,
    maxTokens: 2048,
  });

  if (!aiResponse || !aiResponse.success) {
    throw new Error(aiResponse?.error || 'AI text generation failed.');
  }

  // 5. Parse and sanitize JSON output
  const summaryJson = parseSummaryJson(aiResponse.text);

  return {
    ...summaryJson,
    articleTitle: extracted.title || activeTab.title,
    siteName: extracted.siteName || '',
    url: extracted.url || activeTab.url,
    isPaywalled: !!extracted.isPaywalled,
    rawLength: extracted.rawLength || textContent.length,
  };
}

/**
 * Strips markdown formatting code blocks (```json ... ```) and parses JSON
 */
function parseSummaryJson(rawText) {
  if (!rawText) throw new Error('Received empty response from AI model.');

  // Strip code block fences if present
  let clean = rawText.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');
  clean = clean.trim();

  // Find outermost JSON object
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  try {
    const data = JSON.parse(clean);
    return {
      tldr: data.tldr || 'No TL;DR provided.',
      points: Array.isArray(data.points) ? data.points : ['Summary points unavailable.'],
      nextSteps: Array.isArray(data.nextSteps) ? data.nextSteps : [],
    };
  } catch (err) {
    console.warn('[Rahi Summary] JSON parse failed, returning raw text format:', err, clean);
    // Graceful fallback for non-JSON model output
    return {
      tldr: clean.substring(0, 150) + '...',
      points: clean.split('\n').filter((l) => l.trim().length > 10).slice(0, 5),
      nextSteps: [],
    };
  }
}

/**
 * Renders the structured summary card into the DOM container
 * @param {HTMLElement} container
 * @param {Object} summaryData
 */
export function renderSummaryCard(container, summaryData) {
  if (!container) return;

  const pointsListHtml = (summaryData.points || [])
    .map((pt) => `<li><span class="bullet-dot">▪</span><span>${escapeHtml(pt)}</span></li>`)
    .join('');

  const nextStepsHtml = (summaryData.nextSteps && summaryData.nextSteps.length > 0)
    ? `<div class="summary-section next-steps-section">
        <h4 class="section-heading">🎯 What to do next:</h4>
        <ul class="steps-list">
          ${summaryData.nextSteps.map((step) => `<li><span class="step-check">✓</span><span>${escapeHtml(step)}</span></li>`).join('')}
        </ul>
      </div>`
    : '';

  const paywallAlert = summaryData.isPaywalled
    ? `<div class="summary-alert warning">
        <span>⚠️ This page appears paywalled or restricted. Summary is based on accessible text.</span>
      </div>`
    : '';

  container.innerHTML = `
    <div class="summary-card">
      <div class="summary-card-header">
        <h3 class="summary-article-title" title="${escapeHtml(summaryData.url)}">${escapeHtml(summaryData.articleTitle)}</h3>
        <span class="summary-domain-badge">${escapeHtml(summaryData.siteName || 'Web Page')}</span>
      </div>

      ${paywallAlert}

      <div class="summary-section tldr-section">
        <span class="tldr-label">TL;DR</span>
        <p class="tldr-text">${escapeHtml(summaryData.tldr)}</p>
      </div>

      <div class="summary-section points-section">
        <h4 class="section-heading">📌 5 Key Points:</h4>
        <ul class="points-list">
          ${pointsListHtml}
        </ul>
      </div>

      ${nextStepsHtml}

      <div class="summary-card-footer">
        <button class="btn-ghost-sm" id="btnCopySummary">📋 Copy Summary</button>
        <button class="btn-ghost-sm" id="btnExportMarkdown">📝 Export Markdown</button>
      </div>
    </div>
  `;

  // Bind Copy Buttons
  const btnCopy = container.querySelector('#btnCopySummary');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const textToCopy = `TL;DR:\n${summaryData.tldr}\n\nKey Points:\n${summaryData.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nNext Steps:\n${(summaryData.nextSteps || []).map((s) => `- ${s}`).join('\n')}`;
      navigator.clipboard.writeText(textToCopy);
      btnCopy.textContent = '✅ Copied!';
      setTimeout(() => { btnCopy.textContent = '📋 Copy Summary'; }, 2000);
    });
  }

  const btnExport = container.querySelector('#btnExportMarkdown');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const md = `# Summary: ${summaryData.articleTitle}\nSource: ${summaryData.url}\n\n> **TL;DR:** ${summaryData.tldr}\n\n## Key Takeaways\n${summaryData.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n## Actionable Next Steps\n${(summaryData.nextSteps || []).map((s) => `- ${s}`).join('\n')}\n`;
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `summary-${(summaryData.articleTitle || 'article').substring(0, 20).replace(/\W+/g, '_')}.md`;
      a.click();
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
