/**
 * Rahi - AI Gateway Module
 * Direct REST API client for Google Gemini API (v1beta) and Groq fallback.
 * Handles request construction, language conditioning, response parsing, and error normalization.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Model Aliases for transparent migration away from deprecated model endpoints
 */
const MODEL_ALIASES = {
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.8-flash',
  'gemini-2.0-flash': 'gemini-3.5-flash-lite',
  'gemini-1.5-flash': 'gemini-3.5-flash-lite',
};

/**
 * Decorates system instruction with language rules (English vs Hinglish)
 * @param {string} baseInstruction - The core system instruction
 * @param {string} language - 'en' | 'hinglish'
 * @returns {string} - Language-conditioned instruction
 */
export function applyLanguageConditioning(baseInstruction = '', language = 'en') {
  const langRule = language === 'hinglish'
    ? `\n\n[LANGUAGE REQUIREMENT]: Respond in fluent, conversational Hinglish (Indian English mixed naturally with everyday conversational Hindi in Roman script). Use words like "aap", "kariye", "yeh", "page par", "button click karke". Keep technical terms like "button", "input", "submit", "browser", "link" in English.`
    : `\n\n[LANGUAGE REQUIREMENT]: Respond in clear, concise, professional English.`;

  return `${baseInstruction.trim()}${langRule}`;
}

/**
 * Execute Gemini REST text generation
 * @param {Object} options
 * @param {string} options.apiKey - Google Gemini API Key
 * @param {string} options.model - Model name (e.g. 'gemini-3.5-flash-lite', 'gemini-3.8-flash')
 * @param {string} options.prompt - User prompt text
 * @param {string} [options.systemInstruction] - Optional system instructions
 * @param {string} [options.language] - 'en' | 'hinglish'
 * @param {number} [options.temperature] - Generation temperature (0.0 to 1.0)
 * @param {number} [options.maxTokens] - Max output tokens
 * @param {Array} [options.multimodalParts] - Optional multimodal parts (images)
 * @returns {Promise<{ text: string, model: string, usage?: Object }>}
 */
export async function callGemini({
  apiKey,
  model = 'gemini-3.5-flash-lite',
  prompt,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
  multimodalParts = null,
}) {
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please add your key in Rahi Settings.');
  }

  if (!prompt && (!multimodalParts || multimodalParts.length === 0)) {
    throw new Error('Prompt or multimodal content is required.');
  }

  // Construct parts: text prompt + any multimodal media
  const parts = [];
  if (multimodalParts && Array.isArray(multimodalParts)) {
    parts.push(...multimodalParts);
  }
  if (prompt) {
    parts.push({ text: prompt });
  }

  // Apply language styling to system instruction
  const conditionedInstruction = applyLanguageConditioning(systemInstruction, language);

  const payload = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (conditionedInstruction) {
    payload.systemInstruction = {
      parts: [{ text: conditionedInstruction }],
    };
  }

  // Build target endpoint with automatic legacy alias resolution
  let cleanModel = (model || 'gemini-3.5-flash-lite').replace(/^models\//, '');
  if (MODEL_ALIASES[cleanModel]) {
    console.log(`[Rahi Gateway] Upgraded legacy model "${cleanModel}" -> "${MODEL_ALIASES[cleanModel]}"`);
    cleanModel = MODEL_ALIASES[cleanModel];
  }
  const url = `${GEMINI_API_BASE}/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (netErr) {
    throw new Error(`Network failure connecting to Gemini API: ${netErr.message}`);
  }

  // Handle HTTP error statuses
  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error && errJson.error.message) {
        errorDetail = errJson.error.message;
      }
    } catch (_) {
      // ignore json parse error on body
    }

    if (response.status === 429) {
      throw new Error(`Rate limit reached (HTTP 429): ${errorDetail}`);
    } else if (response.status === 400 || response.status === 403) {
      throw new Error(`Gemini Authentication/Request Error (${response.status}): ${errorDetail}`);
    } else if (response.status === 404) {
      throw new Error(`Model not found (${cleanModel}): ${errorDetail}`);
    } else {
      throw new Error(`Gemini API Error (${response.status}): ${errorDetail}`);
    }
  }

  const result = await response.json();

  // Validate response structure
  const candidate = result.candidates && result.candidates[0];
  if (!candidate) {
    if (result.promptFeedback && result.promptFeedback.blockReason) {
      throw new Error(`Prompt blocked by safety filters: ${result.promptFeedback.blockReason}`);
    }
    throw new Error('Gemini returned an empty response with no candidates.');
  }

  const textPart = candidate.content && candidate.content.parts && candidate.content.parts[0];
  const outputText = textPart && textPart.text ? textPart.text.trim() : '';

  return {
    text: outputText,
    model: cleanModel,
    usage: result.usageMetadata || null,
    finishReason: candidate.finishReason || 'STOP',
  };
}
