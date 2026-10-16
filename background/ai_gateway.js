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

export const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Calculates exponential backoff delay with jitter (EC-5.1)
 * @param {number} attempt - Current retry attempt index (0, 1, ...)
 * @returns {number} Delay in milliseconds
 */
export function calculateBackoffDelay(attempt) {
  const base = 1000 * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return Math.min(base + jitter, 10000);
}

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
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

    if (response.status === 429 && attempt < maxRetries) {
      const delay = calculateBackoffDelay(attempt);
      console.warn(`[Rahi Gateway] Gemini HTTP 429 rate limit. Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    break;
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

/**
 * Parses raw Server-Sent Events (SSE) buffer chunks from Gemini API
 * @param {string} buffer - Raw incoming string buffer
 * @returns {{ deltas: string[], remaining: string }} Parsed deltas and remaining incomplete buffer
 */
export function parseSSEBuffer(buffer) {
  const deltas = [];
  const lines = buffer.split(/\r?\n/);
  
  // The last item in lines is either empty (if ended with \n) or an incomplete line
  const remaining = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) {
      continue;
    }

    const dataPayload = trimmed.slice(5).trim();
    if (dataPayload === '[DONE]') {
      continue;
    }

    try {
      const parsed = JSON.parse(dataPayload);
      const candidate = parsed.candidates && parsed.candidates[0];
      if (candidate && candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            deltas.push(part.text);
          }
        }
      }
    } catch (_) {
      // Incomplete or non-JSON data chunk line, ignored
    }
  }

  return { deltas, remaining };
}

/**
 * Stream Gemini text generation via Server-Sent Events (SSE)
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} [options.model='gemini-3.5-flash-lite']
 * @param {string} [options.prompt]
 * @param {Array} [options.contents] - Multi-turn conversation contents
 * @param {string} [options.systemInstruction]
 * @param {string} [options.language='en']
 * @param {number} [options.temperature=0.2]
 * @param {number} [options.maxTokens=2048]
 * @param {AbortSignal} [options.signal]
 * @param {(delta: string) => void} options.onChunk - Callback invoked per token delta
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function streamGemini({
  apiKey,
  model = 'gemini-3.5-flash-lite',
  prompt,
  contents = null,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
  signal = null,
  onChunk = () => {},
}) {
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please add your key in Rahi Settings.');
  }

  // Build target endpoint with automatic legacy alias resolution
  let cleanModel = (model || 'gemini-3.5-flash-lite').replace(/^models\//, '');
  if (MODEL_ALIASES[cleanModel]) {
    cleanModel = MODEL_ALIASES[cleanModel];
  }

  // Prepare contents array
  let requestContents = [];
  if (contents && Array.isArray(contents) && contents.length > 0) {
    requestContents = contents;
  } else if (prompt) {
    requestContents = [{ role: 'user', parts: [{ text: prompt }] }];
  } else {
    throw new Error('Prompt or contents is required for streaming.');
  }

  const conditionedInstruction = applyLanguageConditioning(systemInstruction, language);

  const payload = {
    contents: requestContents,
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

  const url = `${GEMINI_API_BASE}/${cleanModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  let response;
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (netErr) {
      if (signal && signal.aborted) {
        throw new Error('Request was aborted by user or port disconnection.');
      }
      throw new Error(`Network failure connecting to Gemini Streaming API: ${netErr.message}`);
    }

    if (response.status === 429 && attempt < maxRetries) {
      const delay = calculateBackoffDelay(attempt);
      console.warn(`[Rahi Gateway] Gemini streaming HTTP 429. Backing off ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    break;
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error && errJson.error.message) {
        errorDetail = errJson.error.message;
      }
    } catch (_) {}

    if (response.status === 429) {
      throw new Error(`Rate limit reached (HTTP 429): ${errorDetail}`);
    } else {
      throw new Error(`Gemini Streaming API Error (${response.status}): ${errorDetail}`);
    }
  }

  if (!response.body) {
    throw new Error('Gemini response body is null or streaming is unsupported.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';
  let fullAccumulatedText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkStr = decoder.decode(value, { stream: true });
      sseBuffer += chunkStr;

      const { deltas, remaining } = parseSSEBuffer(sseBuffer);
      sseBuffer = remaining;

      for (const delta of deltas) {
        fullAccumulatedText += delta;
        onChunk(delta);
      }
    }

    // Flush any trailing buffer if present
    if (sseBuffer.length > 0) {
      const { deltas } = parseSSEBuffer(sseBuffer + '\n');
      for (const delta of deltas) {
        fullAccumulatedText += delta;
        onChunk(delta);
      }
    }
  } catch (streamErr) {
    if (signal && signal.aborted) {
      throw new Error('Streaming aborted.');
    }
    throw streamErr;
  } finally {
    reader.releaseLock();
  }

  return {
    text: fullAccumulatedText,
    model: cleanModel,
  };
}

/**
 * Execute Groq text generation (OpenAI-compatible REST client)
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} [options.model='llama-3.3-70b-versatile']
 * @param {string} [options.prompt]
 * @param {Array} [options.contents]
 * @param {string} [options.systemInstruction]
 * @param {string} [options.language='en']
 * @param {number} [options.temperature=0.2]
 * @param {number} [options.maxTokens=2048]
 * @returns {Promise<{ text: string, model: string, provider: 'groq', usage: Object }>}
 */
export async function callGroq({
  apiKey,
  model = GROQ_DEFAULT_MODEL,
  prompt,
  contents = null,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
}) {
  if (!apiKey) {
    throw new Error('Groq API key is not configured.');
  }

  const messages = [];

  const conditionedInstruction = applyLanguageConditioning(systemInstruction, language);
  if (conditionedInstruction) {
    messages.push({ role: 'system', content: conditionedInstruction });
  }

  if (contents && Array.isArray(contents) && contents.length > 0) {
    for (const item of contents) {
      const role = item.role === 'model' ? 'assistant' : item.role;
      const textPart = item.parts && item.parts.find((p) => p.text);
      if (textPart && textPart.text) {
        messages.push({ role, content: textPart.text });
      }
    }
  } else if (prompt) {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error && errJson.error.message) {
        errDetail = errJson.error.message;
      }
    } catch (_) {}
    throw new Error(`Groq API Error (${response.status}): ${errDetail}`);
  }

  const json = await response.json();
  const outputText = json.choices?.[0]?.message?.content || '';

  return {
    text: outputText.trim(),
    model,
    provider: 'groq',
    usage: json.usage || null,
  };
}

/**
 * Parses Server-Sent Events (SSE) buffer chunks from Groq API
 * @param {string} buffer
 * @returns {{ deltas: string[], remaining: string }}
 */
export function parseGroqSSEBuffer(buffer) {
  const deltas = [];
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) continue;
    const dataPayload = trimmed.slice(5).trim();
    if (dataPayload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(dataPayload);
      const deltaText = parsed.choices?.[0]?.delta?.content;
      if (deltaText) {
        deltas.push(deltaText);
      }
    } catch (_) {}
  }

  return { deltas, remaining };
}

/**
 * Stream Groq text generation via Server-Sent Events (SSE)
 */
export async function streamGroq({
  apiKey,
  model = GROQ_DEFAULT_MODEL,
  prompt,
  contents = null,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
  signal = null,
  onChunk = () => {},
}) {
  if (!apiKey) {
    throw new Error('Groq API key is not configured.');
  }

  const messages = [];
  const conditionedInstruction = applyLanguageConditioning(systemInstruction, language);
  if (conditionedInstruction) {
    messages.push({ role: 'system', content: conditionedInstruction });
  }

  if (contents && Array.isArray(contents) && contents.length > 0) {
    for (const item of contents) {
      const role = item.role === 'model' ? 'assistant' : item.role;
      const textPart = item.parts && item.parts.find((p) => p.text);
      if (textPart && textPart.text) {
        messages.push({ role, content: textPart.text });
      }
    }
  } else if (prompt) {
    messages.push({ role: 'user', content: prompt });
  }

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let errDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error && errJson.error.message) {
        errDetail = errJson.error.message;
      }
    } catch (_) {}
    throw new Error(`Groq Streaming Error (${response.status}): ${errDetail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let sseBuffer = '';
  let fullAccumulatedText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunkStr = decoder.decode(value, { stream: true });
      sseBuffer += chunkStr;

      const { deltas, remaining } = parseGroqSSEBuffer(sseBuffer);
      sseBuffer = remaining;

      for (const delta of deltas) {
        fullAccumulatedText += delta;
        onChunk(delta);
      }
    }

    if (sseBuffer.length > 0) {
      const { deltas } = parseGroqSSEBuffer(sseBuffer + '\n');
      for (const delta of deltas) {
        fullAccumulatedText += delta;
        onChunk(delta);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: fullAccumulatedText,
    model,
    provider: 'groq',
  };
}

/**
 * Unified AI Generation with automatic HTTP 429 retry and Groq failover (ADR-004)
 */
export async function callAIWithFailover({
  geminiApiKey,
  groqApiKey = null,
  model = 'gemini-3.5-flash-lite',
  prompt,
  contents = null,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
  multimodalParts = null,
}) {
  try {
    const result = await callGemini({
      apiKey: geminiApiKey,
      model,
      prompt,
      systemInstruction,
      language,
      temperature,
      maxTokens,
      multimodalParts,
    });
    return { ...result, provider: 'gemini', fallbackUsed: false };
  } catch (err) {
    const isRateLimit = err.message && (err.message.includes('429') || err.message.toLowerCase().includes('rate limit'));
    const isTextOnly = !multimodalParts || multimodalParts.length === 0;

    if (isRateLimit && isTextOnly && groqApiKey) {
      console.warn('[Rahi Gateway] Gemini rate limit reached. Triggering failover to Groq (Llama 3.3)...');
      const groqResult = await callGroq({
        apiKey: groqApiKey,
        prompt,
        contents,
        systemInstruction,
        language,
        temperature,
        maxTokens,
      });
      return { ...groqResult, fallbackUsed: true, note: 'Switched to Groq Fallback (Gemini rate limited)' };
    }

    if (isRateLimit) {
      throw new Error('Free-tier rate limit reached. Please wait 30 seconds or configure your Groq fallback key in Settings.');
    }
    throw err;
  }
}

/**
 * Unified AI Streaming with automatic HTTP 429 retry and Groq failover (ADR-004)
 */
export async function streamAIWithFailover({
  geminiApiKey,
  groqApiKey = null,
  model = 'gemini-3.5-flash-lite',
  prompt,
  contents = null,
  systemInstruction = '',
  language = 'en',
  temperature = 0.2,
  maxTokens = 2048,
  signal = null,
  onChunk = () => {},
  onProviderSwitched = () => {},
}) {
  const hasMultimodal = contents && contents.some((c) => c.parts && c.parts.some((p) => p.inlineData));

  try {
    const result = await streamGemini({
      apiKey: geminiApiKey,
      model,
      prompt,
      contents,
      systemInstruction,
      language,
      temperature,
      maxTokens,
      signal,
      onChunk,
    });
    return { ...result, provider: 'gemini', fallbackUsed: false };
  } catch (err) {
    const isRateLimit = err.message && (err.message.includes('429') || err.message.toLowerCase().includes('rate limit'));

    if (isRateLimit && !hasMultimodal && groqApiKey) {
      console.warn('[Rahi Gateway] Gemini streaming rate limited. Failing over to Groq...');
      onProviderSwitched('groq');
      const groqResult = await streamGroq({
        apiKey: groqApiKey,
        prompt,
        contents,
        systemInstruction,
        language,
        temperature,
        maxTokens,
        signal,
        onChunk,
      });
      return { ...groqResult, fallbackUsed: true, note: 'Switched to Groq Fallback (Gemini rate limited)' };
    }

    if (isRateLimit) {
      throw new Error('Free-tier rate limit reached. Please wait 30 seconds or configure your Groq fallback key in Settings.');
    }
    throw err;
  }
}


