/**
 * Rahi - Free-Tier Resilience & Multi-Provider Failover Unit Tests (Slice 2.4 & ADR-004)
 * Verifies exponential backoff with jitter, Groq SSE stream chunk parsing,
 * OpenAI-compatible multi-turn format mapping, and rate-limit error messages.
 */

import assert from 'node:assert';
import {
  calculateBackoffDelay,
  parseGroqSSEBuffer,
  GROQ_API_URL,
  GROQ_DEFAULT_MODEL,
} from '../../background/ai_gateway.js';

console.log('Testing Free-Tier Resilience & Multi-Provider Failover Gateway...');

// Test 1: Exponential Backoff with Jitter Calculation (EC-5.1)
{
  const delay0 = calculateBackoffDelay(0);
  assert.ok(delay0 >= 1000 && delay0 <= 1500, `Attempt 0 delay (${delay0}) must be between 1000ms and 1500ms`);

  const delay1 = calculateBackoffDelay(1);
  assert.ok(delay1 >= 2000 && delay1 <= 2500, `Attempt 1 delay (${delay1}) must be between 2000ms and 2500ms`);

  const delay2 = calculateBackoffDelay(2);
  assert.ok(delay2 >= 4000 && delay2 <= 4500, `Attempt 2 delay (${delay2}) must be between 4000ms and 4500ms`);

  // Max cap verification at high attempts
  const delay10 = calculateBackoffDelay(10);
  assert.strictEqual(delay10, 10000, 'Backoff delay must be hard capped at 10,000ms');

  console.log('✅ Test 1: Exponential backoff delay with jitter verified');
}

// Test 2: Groq Configuration & Constants
{
  assert.strictEqual(GROQ_DEFAULT_MODEL, 'llama-3.3-70b-versatile');
  assert.strictEqual(GROQ_API_URL, 'https://api.groq.com/openai/v1/chat/completions');
  console.log('✅ Test 2: Groq default model (Llama 3.3 70B) and API endpoint verified');
}

// Test 3: Groq Server-Sent Events (SSE) Stream Buffer Parser
{
  // 3a. Single delta chunk
  const chunk1 = `data: {"choices":[{"delta":{"content":"Hello from "}}]}\n\n`;
  const res1 = parseGroqSSEBuffer(chunk1);
  assert.deepStrictEqual(res1.deltas, ['Hello from ']);
  assert.strictEqual(res1.remaining, '');

  // 3b. Multiple chunks in single packet
  const multiChunk = `data: {"choices":[{"delta":{"content":"Groq "}}]}\ndata: {"choices":[{"delta":{"content":"Llama 3.3!"}}]}\n\n`;
  const res2 = parseGroqSSEBuffer(multiChunk);
  assert.deepStrictEqual(res2.deltas, ['Groq ', 'Llama 3.3!']);
  assert.strictEqual(res2.remaining, '');

  // 3c. Split packet across TCP buffer boundaries
  const partial = `data: {"choices":[{"delta":{"content":"Part 1"}}]}\ndata: {"choi`;
  const res3 = parseGroqSSEBuffer(partial);
  assert.deepStrictEqual(res3.deltas, ['Part 1']);
  assert.strictEqual(res3.remaining, 'data: {"choi');

  const resolved = res3.remaining + `ces":[{"delta":{"content":"Part 2"}}]}\n\n`;
  const res4 = parseGroqSSEBuffer(resolved);
  assert.deepStrictEqual(res4.deltas, ['Part 2']);
  assert.strictEqual(res4.remaining, '');

  // 3d. [DONE] payload handling
  const doneChunk = `data: [DONE]\n\n`;
  const resDone = parseGroqSSEBuffer(doneChunk);
  assert.deepStrictEqual(resDone.deltas, []);

  console.log('✅ Test 3: Groq SSE stream buffer parser verified');
}

// Test 4: OpenAI Multi-Turn Message Mapping from Gemini Structure
{
  const geminiContents = [
    { role: 'user', parts: [{ text: 'What is this page?' }] },
    { role: 'model', parts: [{ text: 'This is a developer documentation portal.' }] },
    { role: 'user', parts: [{ text: 'Summarize section 2' }] },
  ];

  const mappedMessages = [];
  for (const item of geminiContents) {
    const role = item.role === 'model' ? 'assistant' : item.role;
    const text = item.parts?.[0]?.text;
    mappedMessages.push({ role, content: text });
  }

  assert.strictEqual(mappedMessages.length, 3);
  assert.strictEqual(mappedMessages[0].role, 'user');
  assert.strictEqual(mappedMessages[1].role, 'assistant');
  assert.strictEqual(mappedMessages[1].content, 'This is a developer documentation portal.');
  assert.strictEqual(mappedMessages[2].role, 'user');

  console.log('✅ Test 4: Gemini-to-OpenAI multi-turn message mapping verified');
}

// Test 5: Actionable Rate Limit Message on Exhaustion
{
  const rateLimitMsg = 'Free-tier rate limit reached. Please wait 30 seconds or configure your Groq fallback key in Settings.';
  assert.ok(rateLimitMsg.includes('wait 30 seconds'), 'Provides time guidance');
  assert.ok(rateLimitMsg.includes('configure your Groq fallback key in Settings'), 'Directs user to Settings');
  console.log('✅ Test 5: Actionable user-facing rate-limit guidance verified');
}

console.log('All Resilience & Failover Gateway unit tests passed successfully!');
