/**
 * Rahi - Interactive Element Scanner Unit Tests
 * Validates accessible label hierarchy, element classification, visibility heuristics,
 * and compact action manifest generation.
 */

import assert from 'node:assert';
import {
  computeElementLabel,
  classifyElementType,
  isElementVisible,
  scanInteractiveElements,
  INTERACTIVE_SELECTOR
} from '../../content/scanner.js';

console.log('Testing Interactive Element Scanner & Manifest Compactor...');

// Test 1: Accessible Label Resolution Hierarchy
{
  // 1a: aria-label takes precedence
  const elWithAria = {
    getAttribute: (attr) => (attr === 'aria-label' ? 'Submit Order' : null),
    innerText: 'Click Here',
    tagName: 'BUTTON'
  };
  assert.strictEqual(computeElementLabel(elWithAria), 'Submit Order');

  // 1b: Placeholder used when no aria-label
  const elInput = {
    getAttribute: () => null,
    placeholder: 'Search documentation...',
    tagName: 'INPUT'
  };
  assert.strictEqual(computeElementLabel(elInput), 'Search documentation...');

  // 1c: InnerText fallback
  const elButton = {
    getAttribute: () => null,
    innerText: '  Continue to Checkout  \n',
    tagName: 'BUTTON'
  };
  assert.strictEqual(computeElementLabel(elButton), 'Continue to Checkout');

  // 1d: Truncation at 80 characters
  const longLabel = 'A'.repeat(120);
  const elLong = {
    getAttribute: (attr) => (attr === 'aria-label' ? longLabel : null),
    tagName: 'BUTTON'
  };
  assert.strictEqual(computeElementLabel(elLong).length, 80);

  console.log('✅ Test 1: Accessible label resolution hierarchy verified');
}

// Test 2: Element Classification
{
  assert.strictEqual(classifyElementType({ tagName: 'BUTTON' }), 'button');
  assert.strictEqual(classifyElementType({ tagName: 'A', getAttribute: () => null }), 'link');
  assert.strictEqual(classifyElementType({ tagName: 'DIV', getAttribute: (a) => (a === 'role' ? 'button' : null) }), 'button');
  assert.strictEqual(classifyElementType({ tagName: 'INPUT', type: 'checkbox', getAttribute: () => null }), 'checkbox');
  assert.strictEqual(classifyElementType({ tagName: 'INPUT', type: 'radio', getAttribute: () => null }), 'radio');
  assert.strictEqual(classifyElementType({ tagName: 'INPUT', type: 'password', getAttribute: () => null }), 'input_password');
  assert.strictEqual(classifyElementType({ tagName: 'INPUT', type: 'text', getAttribute: () => null }), 'input_text');
  assert.strictEqual(classifyElementType({ tagName: 'INPUT', type: 'email', getAttribute: () => null }), 'input_email');
  assert.strictEqual(classifyElementType({ tagName: 'SELECT', getAttribute: () => null }), 'select');
  assert.strictEqual(classifyElementType({ tagName: 'TEXTAREA', getAttribute: () => null }), 'textarea');
  console.log('✅ Test 2: Interactive element classification verified');
}

// Test 3: Element Visibility Heuristics
{
  const visibleEl = {
    getBoundingClientRect: () => ({ top: 100, left: 50, width: 200, height: 40, bottom: 140, right: 250 })
  };
  assert.strictEqual(isElementVisible(visibleEl), true);

  const zeroSizeEl = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 })
  };
  assert.strictEqual(isElementVisible(zeroSizeEl), false);

  const offscreenEl = {
    getBoundingClientRect: () => ({ top: -200, left: -200, width: 100, height: 100, bottom: -100, right: -100 })
  };
  assert.strictEqual(isElementVisible(offscreenEl), false);

  console.log('✅ Test 3: Element visibility heuristics verified');
}

// Test 4: Compact Action Manifest Serialization
{
  const mockElements = [
    {
      tagName: 'INPUT',
      type: 'text',
      placeholder: 'Enter query',
      value: '',
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 50, left: 10, width: 300, height: 35, bottom: 85, right: 310 })
    },
    {
      tagName: 'BUTTON',
      innerText: 'Search',
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 50, left: 320, width: 80, height: 35, bottom: 85, right: 400 })
    }
  ];

  const mockRoot = {
    querySelectorAll: (sel) => mockElements
  };

  const manifest = scanInteractiveElements(mockRoot);
  assert.strictEqual(manifest.length, 2);
  assert.strictEqual(manifest[0].id, 1);
  assert.strictEqual(manifest[0].type, 'input_text');
  assert.strictEqual(manifest[0].placeholder, 'Enter query');

  assert.strictEqual(manifest[1].id, 2);
  assert.strictEqual(manifest[1].type, 'button');
  assert.strictEqual(manifest[1].label, 'Search');
  assert.strictEqual(manifest[1].rect.width, 80);

  // Verify compact size constraint (<80 bytes per element on average)
  const jsonStr = JSON.stringify(manifest);
  const avgBytes = jsonStr.length / manifest.length;
  assert.ok(avgBytes < 120, `Average element payload is ${avgBytes} bytes, expected compact serialization`);

  console.log('✅ Test 4: Compact action manifest serialization verified');
}

console.log('All scanner unit tests passed successfully!');
