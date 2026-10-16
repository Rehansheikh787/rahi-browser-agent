/**
 * Rahi - Grounded Chat & Streaming Unit Tests
 * Verifies strict context containment prompts, sliding window history pruning,
 * Server-Sent Events (SSE) stream buffer parsing, and safe markdown rendering.
 */

import assert from 'node:assert';
import {
  buildGroundedChatPrompt,
  pruneSlidingWindow,
  formatMarkdown,
  escapeHtml,
} from '../../sidepanel/components/chat.js';
import { parseSSEBuffer } from '../../background/ai_gateway.js';

console.log('Testing Grounded Page Chat & Streaming Logic...');

// Test 1: Grounded Prompt Context Containment & Refusal Rule
{
  const prompt = buildGroundedChatPrompt({
    pageTitle: 'Wikipedia: Artificial Intelligence',
    pageUrl: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    pageText: 'Artificial intelligence is intelligence demonstrated by machines.',
    language: 'en',
  });

  assert.ok(prompt.includes('Wikipedia: Artificial Intelligence'), 'Must contain page title');
  assert.ok(prompt.includes('https://en.wikipedia.org/wiki/Artificial_intelligence'), 'Must contain page URL');
  assert.ok(prompt.includes('demonstrated by machines'), 'Must contain page text content');
  assert.ok(
    prompt.includes("I couldn't find that information on this page."),
    'Must include exact zero-hallucination refusal string'
  );
  assert.ok(
    prompt.includes('STRICT GROUNDING RULES'),
    'Must specify strict grounding rules header'
  );
  console.log('✅ Test 1: Grounded prompt context containment & exact refusal string verified');
}

// Test 2: Language Conditioning in Grounding Prompt (English vs Hinglish)
{
  const enPrompt = buildGroundedChatPrompt({
    pageTitle: 'Test Page',
    pageUrl: 'https://example.com',
    pageText: 'Sample content',
    language: 'en',
  });
  assert.ok(enPrompt.includes('Reply in concise, professional English.'), 'English rule verified');

  const hinglishPrompt = buildGroundedChatPrompt({
    pageTitle: 'Test Page',
    pageUrl: 'https://example.com',
    pageText: 'Sample content',
    language: 'hinglish',
  });
  assert.ok(hinglishPrompt.includes('Reply in natural, conversational Hinglish'), 'Hinglish rule verified');
  assert.ok(hinglishPrompt.includes('Is page par'), 'Hinglish colloquial cues present');
  console.log('✅ Test 2: English and Hinglish language prompt conditioning verified');
}

// Test 3: Tab-Scoped Sliding Window History Pruning (Max 20 messages)
{
  const dummyMessages = [];
  for (let i = 1; i <= 25; i++) {
    dummyMessages.push({
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: `Message ${i}`,
    });
  }

  const pruned = pruneSlidingWindow(dummyMessages, 20);
  assert.strictEqual(pruned.length, 20, 'Window should prune down to exactly 20 messages');
  assert.strictEqual(pruned[0].content, 'Message 6', 'Oldest messages 1-5 should be pruned');
  assert.strictEqual(pruned[19].content, 'Message 25', 'Latest message should be preserved');

  // Short history should remain unpruned
  const shortHistory = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Namaste' }];
  const kept = pruneSlidingWindow(shortHistory, 20);
  assert.strictEqual(kept.length, 2);
  console.log('✅ Test 3: Sliding window history pruning (20 messages cap) verified');
}

// Test 4: Server-Sent Events (SSE) Stream Buffer Parsing (parseSSEBuffer)
{
  // 4a. Complete SSE chunk
  const chunk1 = `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n`;
  const res1 = parseSSEBuffer(chunk1);
  assert.deepStrictEqual(res1.deltas, ['Hello']);
  assert.strictEqual(res1.remaining, '');

  // 4b. Multiple chunks in single TCP packet
  const multiChunk = `data: {"candidates":[{"content":{"parts":[{"text":" World"}]}}]}\ndata: {"candidates":[{"content":{"parts":[{"text":" from Rahi!"}]}}]}\n\n`;
  const res2 = parseSSEBuffer(multiChunk);
  assert.deepStrictEqual(res2.deltas, [' World', ' from Rahi!']);
  assert.strictEqual(res2.remaining, '');

  // 4c. Partial / split chunk across stream reads
  const partial = `data: {"candidates":[{"content":{"parts":[{"text":"Part 1"}]}}]}\ndata: {"candid`;
  const res3 = parseSSEBuffer(partial);
  assert.deepStrictEqual(res3.deltas, ['Part 1']);
  assert.strictEqual(res3.remaining, 'data: {"candid');

  // Resolving remaining buffer with next chunk
  const continuation = res3.remaining + `ates":[{"content":{"parts":[{"text":"Part 2"}]}}]}\n\n`;
  const res4 = parseSSEBuffer(continuation);
  assert.deepStrictEqual(res4.deltas, ['Part 2']);
  assert.strictEqual(res4.remaining, '');

  // 4d. [DONE] payload handling
  const doneChunk = `data: [DONE]\n\n`;
  const resDone = parseSSEBuffer(doneChunk);
  assert.deepStrictEqual(resDone.deltas, []);
  console.log('✅ Test 4: Server-Sent Events (SSE) stream buffer parser verified');
}

// Test 5: Safe Markdown Rendering & XSS Protection
{
  const rawInput = '**Important:** Check `<script>alert(1)</script>` on this page.';
  const rendered = formatMarkdown(rawInput);

  assert.ok(rendered.includes('<strong>Important:</strong>'), 'Bold markdown tags formatted');
  assert.ok(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'HTML tags properly escaped');
  assert.ok(!rendered.includes('<script>'), 'Raw script tags must never be present');

  // Code block rendering
  const codeInput = 'Here is code:\n```js\nconst greeting = "Hello";\n```';
  const renderedCode = formatMarkdown(codeInput);
  assert.ok(renderedCode.includes('<pre class="code-block"><code class="lang-js">'), 'Code block rendered');
  assert.ok(renderedCode.includes('const greeting = &quot;Hello&quot;;'), 'Code block content escaped');

  // Bullet list rendering
  const listInput = '* Point A\n* Point B';
  const renderedList = formatMarkdown(listInput);
  assert.ok(renderedList.includes('<ul class="chat-list">'), 'Unordered list rendered');
  assert.ok(renderedList.includes('<li>Point A</li>'), 'List item A rendered');
  assert.ok(renderedList.includes('<li>Point B</li>'), 'List item B rendered');

  console.log('✅ Test 5: Safe markdown formatting and XSS protection verified');
}

console.log('All Grounded Chat and Streaming unit tests passed successfully!');
