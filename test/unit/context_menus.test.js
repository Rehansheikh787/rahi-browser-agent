/**
 * Rahi - Context Menus Unit Tests
 * Verifies prompt and instruction generation for Explain, Translate, and Draft Reply actions.
 */

import assert from 'node:assert';
import {
  CONTEXT_MENU_IDS,
  buildContextActionPrompt,
} from '../../background/context_menus.js';

console.log('Testing Context Menu Action Dispatcher & Prompts...');

// Test 1: Verify Context Menu IDs
{
  assert.strictEqual(CONTEXT_MENU_IDS.EXPLAIN, 'rahi_explain');
  assert.strictEqual(CONTEXT_MENU_IDS.TRANSLATE, 'rahi_translate');
  assert.strictEqual(CONTEXT_MENU_IDS.REPLY, 'rahi_reply');
  console.log('✅ Test 1: Context menu action identifier constants verified');
}

// Test 2: Explain Action Prompt & System Instruction
{
  const selection = 'Quantum entanglement occurs when a group of particles interact such that quantum states cannot be described independently.';
  const result = buildContextActionPrompt(CONTEXT_MENU_IDS.EXPLAIN, selection);

  assert.strictEqual(result.label, 'Explain Selection');
  assert.ok(result.prompt.includes('Quantum entanglement'), 'Prompt contains selection text');
  assert.ok(result.prompt.includes('simple, clear, and intuitive terms'), 'Prompt requests simple terms');
  assert.ok(result.systemInstruction.includes('relatable analogies'), 'System instruction instructs analogies');
  console.log('✅ Test 2: Explain action prompt and instruction verified');
}

// Test 3: Translate Action Prompt & System Instruction
{
  const selection = 'Artificial intelligence will transform modern education and healthcare.';
  const result = buildContextActionPrompt(CONTEXT_MENU_IDS.TRANSLATE, selection);

  assert.strictEqual(result.label, 'Translate Selection');
  assert.ok(result.prompt.includes('Artificial intelligence will transform'), 'Prompt contains selection text');
  assert.ok(result.prompt.includes('Hindi (both Devanagari script and Romanized Hinglish)'), 'Prompt covers bilingual formats');
  assert.ok(result.systemInstruction.includes('high-fidelity translator'), 'System instruction enforces translation fidelity');
  console.log('✅ Test 3: Translate action prompt and instruction verified');
}

// Test 4: Draft Reply Action Prompt with User Profile Context
{
  const selection = 'Hi Rehan, could you send over your resume and GitHub link for the frontend intern role?';
  const profile = {
    fullName: 'Rehan Sheikh',
    preferredTone: 'polite and confident',
  };

  const result = buildContextActionPrompt(CONTEXT_MENU_IDS.REPLY, selection, profile);

  assert.strictEqual(result.label, 'Draft Reply');
  assert.ok(result.prompt.includes('from Rehan Sheikh'), 'User full name incorporated in prompt');
  assert.ok(result.prompt.includes('polite and confident'), 'User preferred tone incorporated');
  assert.ok(result.prompt.includes('2 variations: a quick short reply and a complete thoughtful reply'), 'Requests 2 variations');
  assert.ok(result.systemInstruction.includes('executive communication assistant'), 'System instruction set for executive communication');
  console.log('✅ Test 4: Draft reply prompt with user profile memory verified');
}

// Test 5: Fallback & Empty Selection Handling
{
  const emptyResult = buildContextActionPrompt('unknown_mode', '   ');
  assert.strictEqual(emptyResult.label, 'Analyze Selection');
  assert.ok(emptyResult.prompt.includes('""'), 'Handles empty selection string cleanly');
  console.log('✅ Test 5: Fallback and whitespace selection handling verified');
}

console.log('All Context Menus unit tests passed successfully!');
