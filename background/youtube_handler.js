/**
 * Rahi - YouTube Video Handler
 * Parses and normalizes YouTube URLs across all formats (watch, youtu.be, shorts),
 * and prepares Gemini video summarization requests.
 */

// Regex patterns supporting all YouTube URL permutations
const YOUTUBE_REGEXES = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i,
];

/**
 * Extracts clean 11-character YouTube Video ID from any URL or string.
 * @param {string} url - Candidate URL
 * @returns {string|null} - 11-character video ID, or null if invalid
 */
export function extractYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  for (const regex of YOUTUBE_REGEXES) {
    const match = trimmed.match(regex);
    if (match && match[1] && match[1].length === 11) {
      return match[1];
    }
  }

  // Check if string is already a pure 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Builds canonical YouTube watch URL from ID
 * @param {string} videoId
 * @param {number} [timestampSeconds]
 * @returns {string} Canonical URL
 */
export function buildYouTubeWatchUrl(videoId, timestampSeconds = null) {
  if (!videoId) return '';
  let url = `https://www.youtube.com/watch?v=${videoId}`;
  if (timestampSeconds && timestampSeconds > 0) {
    url += `&t=${Math.floor(timestampSeconds)}s`;
  }
  return url;
}

/**
 * Formats seconds into human-readable MM:SS or HH:MM:SS timestamp label
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTimestampLabel(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const remainingSecs = secs % 60;

  const pad = (n) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainingSecs)}`;
  }
  return `${pad(minutes)}:${pad(remainingSecs)}`;
}

/**
 * Parses timestamps and titles directly from video description text if present
 * @param {string} description
 * @returns {Array<{ timestampSeconds: number, timestampLabel: string, title: string }>}
 */
export function parseTimestampsFromDescription(description) {
  if (!description || typeof description !== 'string') return [];
  const lines = description.split('\n');
  const chapters = [];
  const timeRegex = /(?:^|\s)(?:\[|\()?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\]|\))?(?:\s*[-–—:]\s*|\s+)(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(timeRegex);
    if (match) {
      const hours = match[1] ? parseInt(match[1], 10) : 0;
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const title = match[4].trim();
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      const label = formatTimestampLabel(totalSeconds);

      if (title.length > 0 && !chapters.some((c) => c.timestampSeconds === totalSeconds)) {
        chapters.push({
          timestampSeconds: totalSeconds,
          timestampLabel: label,
          title: title.replace(/^[-–—:]\s*/, '').trim(),
        });
      }
    }
  }

  return chapters.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

/**
 * Fetches real public YouTube video metadata and description from oEmbed and public watch HTML.
 * @param {string} videoId - 11-char YouTube video ID
 * @returns {Promise<Object>} { videoId, title, author, durationSeconds, description, keywords, detectedChapters }
 */
export async function fetchYouTubeVideoDetails(videoId) {
  if (!videoId) throw new Error('Missing video ID');

  let title = '';
  let author = '';
  let description = '';
  let durationSeconds = 0;
  let keywords = [];

  // 1. Fetch official YouTube oEmbed API for verified title and channel
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      title = data.title || '';
      author = data.author_name || '';
    }
  } catch (err) {
    console.warn('[Rahi YouTube] oEmbed fetch notice:', err.message);
  }

  // 2. Fetch watch page HTML for description, timestamps, and duration
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(watchUrl, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (res.ok) {
      const html = await res.text();

      // Fallback title from <title> tag if oEmbed didn't provide one
      if (!title) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].replace(/ - YouTube$/i, '').trim();
        }
      }

      // Extract shortDescription from page player data
      const descMatch = html.match(/"shortDescription":\s*"((?:\\.|[^"\\])*)"/);
      if (descMatch && descMatch[1]) {
        try {
          description = JSON.parse(`"${descMatch[1]}"`);
        } catch (_) {
          description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }

      // Extract lengthSeconds
      const lenMatch = html.match(/"lengthSeconds":\s*"(\d+)"/);
      if (lenMatch && lenMatch[1]) {
        durationSeconds = parseInt(lenMatch[1], 10);
      }

      // Extract keywords
      const kwMatch = html.match(/"keywords":\s*(\[.*?\])/);
      if (kwMatch && kwMatch[1]) {
        try {
          keywords = JSON.parse(kwMatch[1]);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[Rahi YouTube] Watch page fetch notice:', err.message);
  }

  const detectedChapters = parseTimestampsFromDescription(description);

  return {
    videoId,
    title: title || 'YouTube Video',
    author: author || 'YouTube Creator',
    durationSeconds,
    description: description || '',
    keywords,
    detectedChapters,
  };
}

/**
 * Constructs Gemini prompt for public YouTube video summarization
 * @param {Object} options
 * @param {string} options.videoId
 * @param {string} [options.language='en']
 * @param {Object} [options.metadata=null]
 * @returns {Object} { systemInstruction, prompt, canonicalUrl }
 */
export function buildYouTubePrompt({ videoId, language = 'en', metadata = null }) {
  const canonicalUrl = buildYouTubeWatchUrl(videoId);

  const systemInstruction = `You are Rahi, an expert video summarizer.
Your goal is to analyze YouTube videos and produce high-yield structured notes with timestamp chapters.
Rules:
1. Always output strictly valid JSON matching the requested schema. No markdown code blocks.
2. Ground all facts, topics, and takeaways strictly in the verified video information and description provided. Do NOT invent generic template placeholders.
3. The "tldr" must be a crisp 1-2 sentence overview of the video's actual thesis and practical utility.
4. In "chapters", provide chronological moments with exact "timestampSeconds", formatted "timestampLabel" (e.g. "02:15"), descriptive "title", and 1-2 sentence "summary" of what is actually taught or shown.
5. If the video description contains author timestamps, adapt and refine those real timestamps into rich chapters.
6. Include 3-5 high-value "keyTakeaways".
7. If language is 'hinglish', write chapter titles, summaries, and takeaways in natural conversational Hinglish.`;

  let prompt;
  if (metadata && (metadata.description || metadata.title)) {
    const durationLabel = metadata.durationSeconds
      ? `${metadata.durationSeconds}s (${formatTimestampLabel(metadata.durationSeconds)})`
      : 'Unknown';
    const kwText = metadata.keywords && metadata.keywords.length
      ? `\n[TOPICS/KEYWORDS]: ${metadata.keywords.slice(0, 10).join(', ')}`
      : '';
    const chaptersText = metadata.detectedChapters && metadata.detectedChapters.length
      ? `\n[CREATOR CHAPTER TIMESTAMPS]:\n${metadata.detectedChapters.map((c) => `${c.timestampLabel} ${c.title}`).join('\n')}`
      : '';

    prompt = `Analyze this YouTube video based on its verified metadata, chapters, and content breakdown:
[VIDEO TITLE]: ${metadata.title}
[CHANNEL/CREATOR]: ${metadata.author}
[VIDEO DURATION]: ${durationLabel}${kwText}${chaptersText}
[VIDEO TRANSCRIPT / DESCRIPTION & TIMESTAMPS]:
${metadata.description || 'No detailed description available.'}
[VIDEO URL]: ${canonicalUrl}

Output ONLY valid JSON matching this schema:
{
  "tldr": "1-2 sentence overview of what the video covers and its practical utility.",
  "videoTitle": ${JSON.stringify(metadata.title || 'YouTube Video')},
  "chapters": [
    {
      "timestampSeconds": 0,
      "timestampLabel": "00:00",
      "title": "Introduction",
      "summary": "Brief summary of this chapter section."
    }
  ],
  "keyTakeaways": [
    "Key takeaway point 1",
    "Key takeaway point 2",
    "Key takeaway point 3"
  ]
}`;
  } else {
    prompt = `Analyze this public YouTube video: ${canonicalUrl}

Output ONLY valid JSON matching this schema:
{
  "tldr": "1-2 sentence overview of the video's purpose and key takeaway.",
  "videoTitle": "Title or topic of the video",
  "chapters": [
    {
      "timestampSeconds": 0,
      "timestampLabel": "00:00",
      "title": "Introduction",
      "summary": "Brief summary of this chapter section."
    }
  ],
  "keyTakeaways": [
    "Key takeaway point 1",
    "Key takeaway point 2",
    "Key takeaway point 3"
  ]
}`;
  }

  return { systemInstruction, prompt, canonicalUrl };
}
