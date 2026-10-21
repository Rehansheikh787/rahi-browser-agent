/**
 * Rahi - "Find It for Me" Unit Tests
 * Validates locator prompt generation, element serialization,
 * and JSON locator parsing.
 */

import assert from 'node:assert';
import { buildElementLocatorPrompt } from '../../sidepanel/components/find_it.js';
import { extractActionJSON } from '../../lib/schema_validator.js';

console.log('Testing "Find It for Me" Element Locator Logic...');

// Test 1: Prompt Construction
{
  const manifest = [
    { id: 1, type: 'input_text', label: 'Email', placeholder: 'user@example.com' },
    { id: 2, type: 'button', label: 'Continue' },
    { id: 3, type: 'link', label: 'Forgot Password?' }
  ];

  const query = 'Where do I enter my email address?';
  const { prompt, systemInstruction } = buildElementLocatorPrompt(query, manifest, 'en');

  assert.ok(prompt.includes('User search query: "Where do I enter my email address?"'));
  assert.ok(prompt.includes('[#1] input_text "Email" (placeholder: "user@example.com")'));
  assert.ok(prompt.includes('[#2] button "Continue"'));
  assert.ok(systemInstruction.includes('Precision Element Locator'));
  console.log('✅ Test 1: Locator prompt construction verified');
}

// Test 2: Hinglish Language Directive
{
  const manifest = [{ id: 1, type: 'button', label: 'Login' }];
  const { prompt } = buildElementLocatorPrompt('Login button kahan hai?', manifest, 'hi');
  assert.ok(prompt.includes('conversational Hindi/Hinglish'));
  console.log('✅ Test 2: Hinglish language directive verified');
}

// Test 3: Model JSON Locator Parsing
{
  const mockModelOutput = '```json\n{\n  "targetId": 1,\n  "confidence": "high",\n  "explanation": "Element #1 is the email input field matching the query."\n}\n```';
  const parsed = extractActionJSON(mockModelOutput);

  assert.strictEqual(parsed.targetId, 1);
  assert.strictEqual(parsed.confidence, 'high');
  assert.ok(parsed.explanation.includes('email input'));
  console.log('✅ Test 3: Locator model output parsing verified');
}

console.log('All "Find It for Me" unit tests passed successfully!');
