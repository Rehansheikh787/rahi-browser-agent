/**
 * Rahi - Action Decision Schema Validator Unit Tests
 * Validates JSON parsing from model outputs, structural schema checks,
 * and consequential operation detection.
 */

import assert from 'node:assert';
import {
  extractActionJSON,
  validateActionDecision,
  detectConsequentialAction
} from '../../lib/schema_validator.js';

console.log('Testing Action Decision Schema Validator...');

// Test 1: JSON Extraction
{
  // 1a: Markdown fenced JSON
  const rawMarkdown = 'Here is the next step:\n```json\n{\n  "thought": "Click search button",\n  "action": { "type": "click", "targetId": 2 }\n}\n```\nHope this helps!';
  const parsed1 = extractActionJSON(rawMarkdown);
  assert.strictEqual(parsed1.action.type, 'click');
  assert.strictEqual(parsed1.action.targetId, 2);

  // 1b: Bare JSON string
  const rawBare = '{"thought":"Type query","action":{"type":"type","targetId":1,"value":"shoes"}}';
  const parsed2 = extractActionJSON(rawBare);
  assert.strictEqual(parsed2.action.value, 'shoes');

  // 1c: Conversational text with nested JSON
  const rawConversational = 'I will execute the following: {"thought":"Scroll down to see more","action":{"type":"scroll","direction":"down"}} on the page.';
  const parsed3 = extractActionJSON(rawConversational);
  assert.strictEqual(parsed3.action.direction, 'down');

  console.log('✅ Test 1: Resilient JSON extraction verified');
}

// Test 2: Valid Action Schema Verification
{
  const manifest = [
    { id: 1, type: 'input_text', label: 'Search' },
    { id: 2, type: 'button', label: 'Submit Query' }
  ];

  // 2a: Valid click
  const clickDecision = {
    thought: 'Click the submit query button',
    action: { type: 'click', targetId: 2 }
  };
  const resClick = validateActionDecision(clickDecision, manifest);
  assert.strictEqual(resClick.valid, true);
  assert.strictEqual(resClick.sanitized.action.targetId, 2);
  assert.strictEqual(resClick.sanitized.status, 'continue');
  assert.strictEqual(resClick.sanitized.targetLabel, 'Submit Query');

  // 2b: Valid type
  const typeDecision = {
    thought: 'Type running shoes in search box',
    action: { type: 'type', targetId: 1, value: 'running shoes' }
  };
  const resType = validateActionDecision(typeDecision, manifest);
  assert.strictEqual(resType.valid, true);
  assert.strictEqual(resType.sanitized.action.value, 'running shoes');

  // 2c: Valid finish
  const finishDecision = {
    thought: 'Order tracking information found',
    action: { type: 'finish', message: 'Tracking ID is TRK-987654' }
  };
  const resFinish = validateActionDecision(finishDecision, manifest);
  assert.strictEqual(resFinish.valid, true);
  assert.strictEqual(resFinish.sanitized.status, 'done');

  console.log('✅ Test 2: Valid action decisions passed validation');
}

// Test 3: Rejection of Invalid Decision Payloads
{
  const manifest = [{ id: 1, type: 'button', label: 'OK' }];

  // 3a: Non-existent targetId
  const invalidTarget = {
    thought: 'Click item',
    action: { type: 'click', targetId: 99 }
  };
  const resInvalidTarget = validateActionDecision(invalidTarget, manifest);
  assert.strictEqual(resInvalidTarget.valid, false);
  assert.ok(resInvalidTarget.errors[0].includes('does not exist in currently scanned elements'));

  // 3b: Missing type value
  const missingValue = {
    thought: 'Fill name',
    action: { type: 'type', targetId: 1 }
  };
  const resMissingVal = validateActionDecision(missingValue, manifest);
  assert.strictEqual(resMissingVal.valid, false);
  assert.ok(resMissingVal.errors[0].includes('requires a string "value" property'));

  // 3c: Unknown action type
  const unknownAction = {
    thought: 'Execute hover',
    action: { type: 'hover', targetId: 1 }
  };
  const resUnknown = validateActionDecision(unknownAction, manifest);
  assert.strictEqual(resUnknown.valid, false);
  assert.ok(resUnknown.errors[0].includes('Invalid action.type "hover"'));

  console.log('✅ Test 3: Schema invalidity properly rejected with clear errors');
}

// Test 4: Consequential Action Keyword Detection
{
  // 4a: Direct payment keyword
  assert.strictEqual(detectConsequentialAction({ type: 'click' }, 'Pay now using credit card'), true);

  // 4b: Deletion keyword in target label
  assert.strictEqual(detectConsequentialAction({ type: 'click' }, 'Click confirmation button', 'Delete Account'), true);

  // 4c: Order checkout
  assert.strictEqual(detectConsequentialAction({ type: 'click' }, 'Finalize checkout and place order'), true);

  // 4d: Safe navigation action (not consequential)
  assert.strictEqual(detectConsequentialAction({ type: 'click' }, 'View documentation guide', 'Read More'), false);

  // 4e: Avoid false positive substring matching (e.g., 'player' does not trigger 'pay')
  assert.strictEqual(detectConsequentialAction({ type: 'click' }, 'Click video player button'), false);

  console.log('✅ Test 4: Consequential and high-stakes operation detection verified');
}

console.log('All schema validator unit tests passed successfully!');
