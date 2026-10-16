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
 * Constructs Gemini prompt for public YouTube video summarization
 * @param {Object} options
 * @param {string} options.videoId
 * @param {string} [options.language='en']
 * @returns {Object} { systemInstruction, prompt }
 */
export function buildYouTubePrompt({ videoId, language = 'en' }) {
  const canonicalUrl = buildYouTubeWatchUrl(videoId);

  const systemInstruction = `You are Rahi, an expert video summarizer.
Your goal is to analyze public YouTube videos and produce high-yield structured notes with timestamp chapters.
Rules:
1. Always output strictly valid JSON matching the requested schema. No markdown code blocks.
2. The "tldr" must be a crisp 1-2 sentence overview of the video's core thesis.
3. In "chapters", provide chronological moments with exact "timestampSeconds", formatted "timestampLabel" (e.g. "02:15"), descriptive "title", and 1-2 sentence "summary".
4. Include 3-5 high-value "keyTakeaways".
5. If language is 'hinglish', write chapter titles, summaries, and takeaways in natural conversational Hinglish.`;

  const prompt = `Analyze this public YouTube video: ${canonicalUrl}

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

  return { systemInstruction, prompt, canonicalUrl };
}
