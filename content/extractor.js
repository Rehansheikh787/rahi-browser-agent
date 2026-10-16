/**
 * Rahi - Content Extractor Module
 * Integrates Mozilla Readability.js to extract readable article content,
 * title, byline, and clean text, stripping navigation, ads, and page noise.
 * Includes fallback heuristics for SPAs and paywall edge cases.
 */

/**
 * Extracts readable article content from the active document.
 * @returns {Object} Extracted content object
 */
function extractPageContent() {
  try {
    const pageUrl = window.location.href;
    const pageTitle = document.title || 'Untitled Page';

    // 1. Check if Mozilla Readability is loaded
    if (typeof Readability === 'function') {
      try {
        // Clone document to avoid mutating host DOM
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone, {
          charThreshold: 80,
          nbTopCandidates: 5,
        });
        const article = reader.parse();

        if (article && article.textContent && article.textContent.trim().length > 120) {
          const rawText = article.textContent.trim();
          const cleanText = sanitizeExtractedText(rawText);
          const paywallDetected = checkPaywallHeuristic(cleanText);

          return {
            success: true,
            title: article.title || pageTitle,
            byline: article.byline || '',
            siteName: article.siteName || window.location.hostname,
            textContent: truncateIfExtreme(cleanText),
            rawLength: cleanText.length,
            isArticle: true,
            isPaywalled: paywallDetected,
            url: pageUrl,
          };
        }
      } catch (readabilityErr) {
        console.warn('[Rahi Extractor] Readability parsing failed, using fallback:', readabilityErr);
      }
    }

    // 2. Fallback Heuristic for dynamic pages, SPAs, or pages without standard article tags
    const fallbackData = extractFallbackContent();
    const paywallDetected = checkPaywallHeuristic(fallbackData.textContent);

    return {
      success: true,
      title: pageTitle,
      byline: '',
      siteName: window.location.hostname,
      textContent: truncateIfExtreme(fallbackData.textContent),
      rawLength: fallbackData.textContent.length,
      isArticle: false,
      isPaywalled: paywallDetected,
      url: pageUrl,
    };
  } catch (err) {
    console.error('[Rahi Extractor] Extraction failed:', err);
    return {
      success: false,
      error: err.message,
      title: document.title || '',
      textContent: '',
      url: window.location.href,
    };
  }
}

/**
 * Fallback cleaner: clones body, strips noise tags (scripts, styles, navs, footers)
 */
function extractFallbackContent() {
  const bodyClone = document.body ? document.body.cloneNode(true) : null;
  if (!bodyClone) {
    return { textContent: '' };
  }

  // Remove high-noise layout elements
  const noiseSelectors = [
    'script', 'style', 'noscript', 'nav', 'footer', 'header',
    'svg', 'iframe', 'canvas', 'video', 'audio',
    '.sidebar', '#sidebar', '.ad', '.ads', '.advertisement',
    '.cookie-banner', '#cookie-banner', '.nav', '#nav'
  ];

  noiseSelectors.forEach((sel) => {
    try {
      bodyClone.querySelectorAll(sel).forEach((el) => el.remove());
    } catch (_) {
      // ignore invalid selector in host page
    }
  });

  const text = (bodyClone.innerText || bodyClone.textContent || '').trim();
  return { textContent: sanitizeExtractedText(text) };
}

/**
 * Strips excessive whitespace and empty lines
 */
function sanitizeExtractedText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Edge Case EC-3.1: Paywall detection heuristic
 */
function checkPaywallHeuristic(text) {
  if (!text || text.length > 3000) return false;
  const paywallPatterns = [
    /subscribe (now|to continue|to read)/i,
    /you have reached your (free|article) limit/i,
    /become a member to read/i,
    /unlock this story/i,
    /this content is exclusive to subscribers/i,
  ];
  return paywallPatterns.some((p) => p.test(text));
}

/**
 * Edge Case EC-3.2: Smart truncation for extreme article lengths (>20,000 chars)
 * Retains 70% from start (intro/core) and 30% from end (conclusion/findings)
 */
function truncateIfExtreme(text, maxChars = 20000) {
  if (!text || text.length <= maxChars) return text;
  
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.3);

  const head = text.substring(0, headChars);
  const tail = text.substring(text.length - tailChars);

  return `${head}\n\n[...Content truncated for model context limit (${text.length} characters total)...]\n\n${tail}`;
}

// Make accessible to content script runtime
if (typeof window !== 'undefined') {
  window.rahiExtractPageContent = extractPageContent;
}
