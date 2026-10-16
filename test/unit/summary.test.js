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

console.log('All summary unit tests passed successfully!');
