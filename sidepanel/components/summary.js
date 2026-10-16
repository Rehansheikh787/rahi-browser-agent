/**
 * Rahi - Article & YouTube Summarizer Controller
 * Coordinates content extraction via Mozilla Readability for web articles
 * and native Gemini URL analysis for public YouTube videos with clickable timestamps.
 */

import {
  extractYouTubeVideoId,
  buildYouTubeWatchUrl,
  formatTimestampLabel,
  buildYouTubePrompt,
  fetchYouTubeVideoDetails,
} from '../../background/youtube_handler.js';

/**
 * Generates structured summary for the current active tab (Article or YouTube)
 * @param {Object} options
 * @param {string} [options.language='en'] - 'en' | 'hinglish'
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

  const url = activeTab.url || '';

  // Check for restricted URLs (chrome://, edge://, about:blank, store)
  if (/^(chrome|edge|about|chrome-extension):/i.test(url) || url.includes('chromewebstore.google.com')) {
    throw new Error('Rahi cannot operate on browser internal or Web Store pages.');
  }

  // Check if active tab is a YouTube video
  const ytVideoId = extractYouTubeVideoId(url);
  if (ytVideoId) {
    return summarizeYouTubeVideo({ videoUrlOrId: ytVideoId, language, onStatusUpdate });
  }

  if (onStatusUpdate) onStatusUpdate('Extracting readable article content...');

  // 2. Request extracted content from content script
  let extracted = null;
  try {
    extracted = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CONTENT' });
  } catch (_) {
    // If content script was not already loaded (e.g. pre-existing tab), inject dynamically
    console.log('[Rahi Summary] Content script not pre-loaded on tab, injecting reader dynamically...');
    if (onStatusUpdate) onStatusUpdate('Injecting content reader...');

    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ['lib/readability.js', 'content/extractor.js', 'content/screenshot_crop.js', 'content/content.js'],
      });

      // Brief delay to allow scripts to initialize
      await new Promise((r) => setTimeout(r, 150));
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
    type: 'article',
    ...summaryJson,
    articleTitle: extracted.title || activeTab.title,
    siteName: extracted.siteName || '',
    url: extracted.url || activeTab.url,
    isPaywalled: !!extracted.isPaywalled,
    rawLength: extracted.rawLength || textContent.length,
  };
}

/**
 * Summarizes a public YouTube video using Gemini URL analysis
 * @param {Object} options
 * @param {string} options.videoUrlOrId - URL or 11-char ID
 * @param {string} [options.language='en']
 * @param {Function} [options.onStatusUpdate]
 * @returns {Promise<Object>}
 */
export async function summarizeYouTubeVideo({ videoUrlOrId, language = 'en', onStatusUpdate = null } = {}) {
  const videoId = extractYouTubeVideoId(videoUrlOrId);
  if (!videoId) {
    throw new Error('Please enter a valid YouTube video URL (e.g. https://www.youtube.com/watch?v=...) or video ID.');
  }

  if (onStatusUpdate) onStatusUpdate('Fetching YouTube video details and chapters...');

  // 1. Fetch real video metadata and description from oEmbed and watch page
  let metadata = null;
  try {
    metadata = await fetchYouTubeVideoDetails(videoId);
  } catch (metaErr) {
    console.warn('[Rahi Summary] Could not fetch detailed YouTube metadata, falling back:', metaErr);
  }

  // 2. If active tab is currently open to this YouTube video, grab fresh DOM elements
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0] ? tabs[0] : null;
    if (activeTab && activeTab.id && activeTab.url && extractYouTubeVideoId(activeTab.url) === videoId) {
      const pageData = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_YOUTUBE_DOM' }).catch(() => null);
      if (pageData && pageData.success) {
        metadata = {
          videoId,
          title: pageData.title || metadata?.title || 'YouTube Video',
          author: pageData.author || metadata?.author || '',
          description: pageData.description || metadata?.description || '',
          durationSeconds: metadata?.durationSeconds || 0,
          keywords: metadata?.keywords || [],
          detectedChapters: metadata?.detectedChapters || [],
        };
      }
    }
  } catch (_) {
    // Non-fatal if active tab query or message fails
  }

  if (onStatusUpdate) onStatusUpdate('Rahi AI is generating high-yield video summary...');

  const { systemInstruction, prompt, canonicalUrl } = buildYouTubePrompt({
    videoId,
    language,
    metadata,
  });

  let aiResponse;
  try {
    aiResponse = await chrome.runtime.sendMessage({
      action: 'AI_GENERATE_TEXT',
      prompt,
      systemInstruction,
      language,
      temperature: 0.1,
      maxTokens: 2048,
    });
  } catch (err) {
    throw new Error(`Failed to contact AI service: ${err.message}`);
  }

  if (!aiResponse || !aiResponse.success) {
    const errMsg = aiResponse?.error || 'Video summarization failed.';
    if (/private|restricted|404|400|supported/i.test(errMsg)) {
      throw new Error('This video is not supported for summarization. It may be private, age-restricted, or requires login.');
    }
    throw new Error(errMsg);
  }

  const parsed = parseYouTubeSummaryJson(aiResponse.text, videoId);

  // If parsed title is generic fallback, prefer the verified metadata title
  if ((!parsed.videoTitle || parsed.videoTitle === 'YouTube Video') && metadata?.title) {
    parsed.videoTitle = metadata.title;
  }

  // If chapters were empty from AI output but we detected real chapters from description, use them
  if ((!parsed.chapters || parsed.chapters.length === 0) && metadata?.detectedChapters?.length) {
    parsed.chapters = metadata.detectedChapters.map((c) => ({
      timestampSeconds: c.timestampSeconds,
      timestampLabel: c.timestampLabel,
      title: c.title,
      summary: '',
    }));
  }

  return {
    type: 'youtube',
    videoId,
    canonicalUrl,
    author: metadata?.author || '',
    ...parsed,
  };
}

/**
 * Strips markdown code blocks and parses Article JSON
 */
function parseSummaryJson(rawText) {
  if (!rawText) throw new Error('Received empty response from AI model.');

  let clean = rawText.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');
  clean = clean.trim();

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
    console.warn('[Rahi Summary] Article JSON parse failed, returning fallback:', err);
    return {
      tldr: clean.substring(0, 150) + '...',
      points: clean.split('\n').filter((l) => l.trim().length > 10).slice(0, 5),
      nextSteps: [],
    };
  }
}

/**
 * Strips markdown code blocks and parses YouTube JSON
 */
function parseYouTubeSummaryJson(rawText, videoId) {
  if (!rawText) throw new Error('Received empty response from AI model.');

  let clean = rawText.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');
  clean = clean.trim();

  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  try {
    const data = JSON.parse(clean);
    const rawChapters = Array.isArray(data.chapters) ? data.chapters : [];
    
    const chapters = rawChapters.map((ch, idx) => {
      const seconds = typeof ch.timestampSeconds === 'number'
        ? ch.timestampSeconds
        : parseSecondsFromLabel(ch.timestampLabel);
      return {
        timestampSeconds: seconds,
        timestampLabel: ch.timestampLabel || formatTimestampLabel(seconds),
        title: ch.title || `Chapter ${idx + 1}`,
        summary: ch.summary || '',
      };
    });

    return {
      videoTitle: data.videoTitle || 'YouTube Video',
      tldr: data.tldr || 'Video summary generated.',
      chapters,
      keyTakeaways: Array.isArray(data.keyTakeaways) ? data.keyTakeaways : [],
    };
  } catch (err) {
    console.warn('[Rahi Summary] YouTube JSON parse failed, returning fallback:', err);
    return {
      videoTitle: 'YouTube Video',
      tldr: clean.substring(0, 180) + '...',
      chapters: [
        {
          timestampSeconds: 0,
          timestampLabel: '00:00',
          title: 'Full Video',
          summary: clean,
        },
      ],
      keyTakeaways: [],
    };
  }
}

function parseSecondsFromLabel(label) {
  if (!label || typeof label !== 'string') return 0;
  const parts = label.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Renders the structured summary card into the DOM container
 * @param {HTMLElement} container
 * @param {Object} summaryData
 */
export function renderSummaryCard(container, summaryData) {
  if (!container) return;

  if (summaryData.type === 'youtube') {
    renderYouTubeSummaryCard(container, summaryData);
    return;
  }

  // Article Summary Rendering
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

/**
 * Renders the structured YouTube Video Summary Card with clickable timestamp links
 * @param {HTMLElement} container
 * @param {Object} data
 */
function renderYouTubeSummaryCard(container, data) {
  const chaptersHtml = (data.chapters || [])
    .map(
      (ch) => `
      <div class="yt-chapter-row">
        <button class="yt-timestamp-btn" data-time="${ch.timestampSeconds}" data-vid="${data.videoId}" title="Jump to ${ch.timestampLabel}">
          ⏱️ ${escapeHtml(ch.timestampLabel)}
        </button>
        <div class="yt-chapter-details">
          <span class="yt-chapter-title">${escapeHtml(ch.title)}</span>
          <span class="yt-chapter-summary">${escapeHtml(ch.summary)}</span>
        </div>
      </div>
    `
    )
    .join('');

  const takeawaysHtml = (data.keyTakeaways && data.keyTakeaways.length > 0)
    ? `<div class="summary-section">
        <h4 class="section-heading">💡 Key Takeaways:</h4>
        <ul class="points-list">
          ${data.keyTakeaways.map((t) => `<li><span class="bullet-dot">▪</span><span>${escapeHtml(t)}</span></li>`).join('')}
        </ul>
      </div>`
    : '';

  container.innerHTML = `
    <div class="summary-card yt-summary-card">
      <div class="summary-card-header">
        <div class="yt-title-group">
          <span class="yt-badge">▶ YouTube</span>
          <h3 class="summary-article-title">${escapeHtml(data.videoTitle)}</h3>
        </div>
        <a href="${data.canonicalUrl}" target="_blank" class="helper-link" title="Open on YouTube">Watch ↗</a>
      </div>

      <div class="summary-section tldr-section">
        <span class="tldr-label">TL;DR</span>
        <p class="tldr-text">${escapeHtml(data.tldr)}</p>
      </div>

      <div class="summary-section">
        <h4 class="section-heading">📑 Chapters & Timestamps (Click to jump):</h4>
        <div class="yt-chapters-list">
          ${chaptersHtml || '<p class="field-hint">No chapters extracted.</p>'}
        </div>
      </div>

      ${takeawaysHtml}

      <div class="summary-card-footer">
        <button class="btn-ghost-sm" id="btnCopyYtSummary">📋 Copy Notes</button>
        <button class="btn-ghost-sm" id="btnExportYtMarkdown">📝 Export Markdown</button>
      </div>
    </div>
  `;

  // Bind Timestamp Clicks
  container.querySelectorAll('.yt-timestamp-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const seconds = parseFloat(btn.dataset.time) || 0;
      const vid = btn.dataset.vid;
      const deepLinkUrl = buildYouTubeWatchUrl(vid, seconds);

      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs && tabs[0] ? tabs[0] : null;

        if (activeTab && activeTab.url && activeTab.url.includes(vid)) {
          // Video is currently active in tab: seek directly via scripting
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (seekTime) => {
              const video = document.querySelector('video');
              if (video) {
                video.currentTime = seekTime;
                video.play();
              }
            },
            args: [seconds],
          });
        } else {
          // Open or navigate to the deep link
          chrome.tabs.create({ url: deepLinkUrl });
        }
      } catch (err) {
        console.warn('[Rahi YouTube] Seek failed, opening deep-link:', err);
        window.open(deepLinkUrl, '_blank');
      }
    });
  });

  // Bind Copy Button
  const btnCopy = container.querySelector('#btnCopyYtSummary');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const textToCopy = `Video: ${data.videoTitle}\n${data.canonicalUrl}\n\nTL;DR:\n${data.tldr}\n\nChapters:\n${(data.chapters || []).map((ch) => `${ch.timestampLabel} - ${ch.title}: ${ch.summary}`).join('\n')}\n\nKey Takeaways:\n${(data.keyTakeaways || []).map((t) => `- ${t}`).join('\n')}`;
      navigator.clipboard.writeText(textToCopy);
      btnCopy.textContent = '✅ Copied!';
      setTimeout(() => { btnCopy.textContent = '📋 Copy Notes'; }, 2000);
    });
  }

  // Bind Markdown Export
  const btnExport = container.querySelector('#btnExportYtMarkdown');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const md = `# ${data.videoTitle}\nSource: [Watch on YouTube](${data.canonicalUrl})\n\n> **TL;DR:** ${data.tldr}\n\n## Chapters\n${(data.chapters || []).map((ch) => `- [${ch.timestampLabel}](${buildYouTubeWatchUrl(data.videoId, ch.timestampSeconds)}) **${ch.title}**: ${ch.summary}`).join('\n')}\n\n## Key Takeaways\n${(data.keyTakeaways || []).map((t) => `- ${t}`).join('\n')}\n`;
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `youtube-notes-${data.videoId}.md`;
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
