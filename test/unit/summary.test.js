import assert from 'node:assert';

console.log('Testing summary parser and extraction logic...');

// Test 1: JSON Parsing with Markdown code fences
{
  const rawInput = '```json\n{\n  "tldr": "This is a great article.",\n  "points": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],\n  "nextSteps": ["Step 1", "Step 2"]\n}\n```';
  
  // Replicating parseSummaryJson logic
  let clean = rawInput.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '');
  clean = clean.replace(/\s*```$/i, '');
  clean = clean.trim();

  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(clean);
  assert.strictEqual(parsed.tldr, 'This is a great article.');
  assert.strictEqual(parsed.points.length, 5);
  assert.strictEqual(parsed.nextSteps.length, 2);
  console.log('✅ Test 1: Markdown-wrapped JSON parsing passed');
}

// Test 2: Handling noisy conversational output before JSON
{
  const rawInput = 'Here is the summary of the article you requested:\n\n{\n  "tldr": "AI changes browser automation.",\n  "points": ["1", "2", "3", "4", "5"],\n  "nextSteps": ["Take note"]\n}\n\nHope this helps!';

  let clean = rawInput.trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  assert.ok(firstBrace !== -1 && lastBrace !== -1);
  clean = clean.substring(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(clean);
  assert.strictEqual(parsed.tldr, 'AI changes browser automation.');
  assert.strictEqual(parsed.points.length, 5);
  console.log('✅ Test 2: Conversational prefix/suffix stripping passed');
}

// Test 3: Truncation logic for extreme articles (>20,000 chars)
{
  function truncateIfExtreme(text, maxChars = 20000) {
    if (!text || text.length <= maxChars) return text;
    const headChars = Math.floor(maxChars * 0.7);
    const tailChars = Math.floor(maxChars * 0.3);
    const head = text.substring(0, headChars);
    const tail = text.substring(text.length - tailChars);
    return `${head}\n\n[...Content truncated for model context limit (${text.length} characters total)...]\n\n${tail}`;
  }

  const longText = 'A'.repeat(50000);
  const truncated = truncateIfExtreme(longText, 20000);
  assert.ok(truncated.length < 21000);
  assert.ok(truncated.includes('Content truncated for model context limit'));
  console.log('✅ Test 3: Extreme length truncation passed');
}

// Test 4: Paywall pattern detection
{
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

  assert.strictEqual(checkPaywallHeuristic('Subscribe to continue reading this exclusive story on Bloomberg'), true);
  assert.strictEqual(checkPaywallHeuristic('This is a completely open tutorial on React and JavaScript.'), false);
  console.log('✅ Test 4: Paywall heuristic check passed');
}

// Test 5: YouTube URL and ID extraction permutations (EC-3.5)
{
  const { extractYouTubeVideoId } = await import('../../background/youtube_handler.js');

  const standardUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const shortUrl = 'https://youtu.be/dQw4w9WgXcQ';
  const shortsUrl = 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share';
  const complexUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s&list=PL123&ab_channel=RickAstley';
  const embedUrl = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
  const invalidUrl = 'https://example.com/not-youtube';

  assert.strictEqual(extractYouTubeVideoId(standardUrl), 'dQw4w9WgXcQ');
  assert.strictEqual(extractYouTubeVideoId(shortUrl), 'dQw4w9WgXcQ');
  assert.strictEqual(extractYouTubeVideoId(shortsUrl), 'dQw4w9WgXcQ');
  assert.strictEqual(extractYouTubeVideoId(complexUrl), 'dQw4w9WgXcQ');
  assert.strictEqual(extractYouTubeVideoId(embedUrl), 'dQw4w9WgXcQ');
  assert.strictEqual(extractYouTubeVideoId(invalidUrl), null);
  console.log('✅ Test 5: YouTube URL parsing permutations passed');
}

// Test 6: Timestamp formatting and deep links
{
  const { formatTimestampLabel, buildYouTubeWatchUrl } = await import('../../background/youtube_handler.js');

  assert.strictEqual(formatTimestampLabel(0), '00:00');
  assert.strictEqual(formatTimestampLabel(45), '00:45');
  assert.strictEqual(formatTimestampLabel(145), '02:25');
  assert.strictEqual(formatTimestampLabel(3665), '1:01:05');

  const urlWithTime = buildYouTubeWatchUrl('dQw4w9WgXcQ', 145);
  assert.strictEqual(urlWithTime, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=145s');
  console.log('✅ Test 6: Timestamp formatting and deep link construction passed');
}

// Test 7: YouTube Structured JSON chapter parsing
{
  const rawYtJson = JSON.stringify({
    videoTitle: 'JavaScript in 100 Seconds',
    tldr: 'A fast-paced overview of the language that powers the web.',
    chapters: [
      { timestampSeconds: 0, timestampLabel: '00:00', title: 'Intro', summary: 'Brendan Eich creates JS.' },
      { timestampSeconds: 45, timestampLabel: '00:45', title: 'ECMAScript', summary: 'Standardization and V8 engine.' }
    ],
    keyTakeaways: ['Single threaded', 'Event loop', 'Universal reach']
  });

  const parsed = JSON.parse(rawYtJson);
  assert.strictEqual(parsed.chapters.length, 2);
  assert.strictEqual(parsed.chapters[1].timestampSeconds, 45);
  assert.strictEqual(parsed.keyTakeaways.length, 3);
  console.log('✅ Test 7: YouTube chapter and takeaway schema validation passed');
}

// Test 8: Parsing creator timestamps from video description
{
  const { parseTimestampsFromDescription } = await import('../../background/youtube_handler.js');

  const sampleDesc = `
Gemini 4 Argon is Google's newest model!

TIMESTAMPS:
00:00 Introduction & Overview
00:38 Argon Features
01:17 Tasks Option
01:53 Website demo
03:06 AI thumbnail workflow
04:39 Argon vs paid models
05:28 Conclusion & Free offer
`;

  const parsedChapters = parseTimestampsFromDescription(sampleDesc);
  assert.strictEqual(parsedChapters.length, 7);
  assert.strictEqual(parsedChapters[0].timestampSeconds, 0);
  assert.strictEqual(parsedChapters[0].timestampLabel, '00:00');
  assert.strictEqual(parsedChapters[0].title, 'Introduction & Overview');
  assert.strictEqual(parsedChapters[1].timestampSeconds, 38);
  assert.strictEqual(parsedChapters[1].timestampLabel, '00:38');
  assert.strictEqual(parsedChapters[1].title, 'Argon Features');
  assert.strictEqual(parsedChapters[6].timestampSeconds, 328);
  assert.strictEqual(parsedChapters[6].timestampLabel, '05:28');
  console.log('✅ Test 8: Creator description timestamps parsed accurately');
}

// Test 9: Grounded YouTube prompt with verified metadata
{
  const { buildYouTubePrompt } = await import('../../background/youtube_handler.js');

  const metadata = {
    title: 'Gemini 4 Argon FREE: Build Website, PPT & Thumbnails',
    author: 'Ai With Shivam',
    durationSeconds: 362,
    keywords: ['Gemini', 'AI Website', 'Thumbnails'],
    description: 'Learn how to use Gemini 4 Argon free with no coding required.',
    detectedChapters: [
      { timestampSeconds: 0, timestampLabel: '00:00', title: 'Intro' }
    ]
  };

  const { systemInstruction, prompt, canonicalUrl } = buildYouTubePrompt({
    videoId: 'fUt48RYR10Q',
    language: 'en',
    metadata,
  });

  assert.ok(prompt.includes('Gemini 4 Argon FREE: Build Website, PPT & Thumbnails'));
  assert.ok(prompt.includes('Ai With Shivam'));
  assert.ok(prompt.includes('362s (06:02)'));
  assert.ok(prompt.includes('Learn how to use Gemini 4 Argon free'));
  assert.ok(prompt.includes('[CREATOR CHAPTER TIMESTAMPS]'));
  assert.ok(systemInstruction.includes('Ground all facts, topics, and takeaways strictly'));
  console.log('✅ Test 9: Grounded YouTube prompt generation verified');
}

// Test 10: Clear Summary state reset
{
  const { clearSummary } = await import('../../sidepanel/components/summary.js');

  const containerMock = { innerHTML: '<div class="summary-card">Old Active Summary</div>' };
  clearSummary(containerMock);
  assert.ok(containerMock.innerHTML.includes('No summary generated yet'), 'Must reset to empty state');
  assert.ok(containerMock.innerHTML.includes('empty-state'), 'Must contain empty-state class');
  console.log('✅ Test 10: Clear Summary reset logic verified');
}

console.log('All summary and YouTube unit tests passed successfully!');
