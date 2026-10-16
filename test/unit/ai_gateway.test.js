import assert from 'node:assert';
import { applyLanguageConditioning, callGemini } from '../../background/ai_gateway.js';

console.log('Testing ai_gateway.js...');

// Test 1: Language conditioning for English
{
  const result = applyLanguageConditioning('You are an assistant.', 'en');
  assert.ok(result.includes('clear, concise, professional English'), 'English conditioning failed');
  console.log('✅ Test 1: English language conditioning passed');
}

// Test 2: Language conditioning for Hinglish
{
  const result = applyLanguageConditioning('You are an assistant.', 'hinglish');
  assert.ok(result.includes('conversational Hinglish'), 'Hinglish conditioning failed');
  assert.ok(result.includes('page par'), 'Hinglish sample phrases failed');
  console.log('✅ Test 2: Hinglish language conditioning passed');
}

// Test 3: API key validation
{
  let threw = false;
  try {
    await callGemini({ apiKey: '', prompt: 'Hello' });
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('API key is not configured'), 'Error message mismatch');
  }
  assert.ok(threw, 'Expected callGemini without apiKey to throw');
  console.log('✅ Test 3: Missing API key check passed');
}

// Test 4: Empty prompt validation
{
  let threw = false;
  try {
    await callGemini({ apiKey: 'dummy_key', prompt: '' });
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('Prompt or multimodal content is required'), 'Error message mismatch');
  }
  assert.ok(threw, 'Expected callGemini without prompt to throw');
  console.log('✅ Test 4: Empty prompt check passed');
}

console.log('All ai_gateway unit tests passed successfully!');
