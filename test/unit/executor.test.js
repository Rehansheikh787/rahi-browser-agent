/**
 * Rahi - Synthetic Event Executor Unit Tests
 * Validates action dispatching, click event chains, typing into inputs,
 * select dropdowns, and scroll execution.
 */

import assert from 'node:assert';

// Mock DOM elements for executor testing
class MockDOMElement {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.value = '';
    this.dispatchedEvents = [];
    this.clicked = false;
    this.focused = false;
    this.scrolled = false;
    this.options = [];
    this.selectedIndex = -1;
  }

  dispatchEvent(evt) {
    this.dispatchedEvents.push(evt.type);
    return true;
  }

  click() {
    this.clicked = true;
    this.dispatchEvent({ type: 'click' });
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {
    this.scrolled = true;
  }
}

// Global browser mocks
global.PointerEvent = class { constructor(type) { this.type = type; } };
global.MouseEvent = class { constructor(type) { this.type = type; } };
global.Event = class { constructor(type) { this.type = type; } };
global.document = {
  contains: () => true
};

let scrolledY = 0;
global.window = {
  scrollBy: ({ top }) => { scrolledY += top; },
  __rahiScannedElements: []
};

console.log('Testing Synthetic Event Executor...');

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load content/executor.js into scope
const executorScriptPath = resolve(process.cwd(), 'content/executor.js');
const executorScriptContent = readFileSync(executorScriptPath, 'utf8');
const fn = new Function('window', 'globalThis', 'document', executorScriptContent);
fn(global.window, globalThis, global.document);

const {
  rahiResolveTargetElement: resolveTargetElement,
  rahiExecuteClick: executeClick,
  rahiExecuteType: executeType,
  rahiExecuteSelect: executeSelect,
  rahiExecuteScroll: executeScroll,
  rahiDispatchBrowserAction: dispatchBrowserAction
} = globalThis;

// Test 1: Resolve Target Element from Scanned Elements
{
  const btn1 = new MockDOMElement('button', 'btn-1');
  const inp2 = new MockDOMElement('input', 'inp-2');
  global.window.__rahiScannedElements = [btn1, inp2];

  assert.strictEqual(resolveTargetElement(1), btn1);
  assert.strictEqual(resolveTargetElement(2), inp2);
  assert.strictEqual(resolveTargetElement(99), null);
  console.log('✅ Test 1: Target element resolution verified');
}

// Test 2: Synthetic Click Execution
{
  const btn = new MockDOMElement('button');
  const res = await executeClick(btn);

  assert.strictEqual(res.success, true);
  assert.strictEqual(btn.clicked, true);
  assert.strictEqual(btn.focused, true);
  assert.strictEqual(btn.scrolled, true);
  assert.ok(btn.dispatchedEvents.includes('click'));
  assert.ok(btn.dispatchedEvents.includes('mousedown'));
  console.log('✅ Test 2: Synthetic click event sequence verified');
}

// Test 3: Synthetic Typing Execution
{
  const input = new MockDOMElement('input');
  const res = await executeType(input, 'wireless keyboard');

  assert.strictEqual(res.success, true);
  assert.strictEqual(input.value, 'wireless keyboard');
  assert.strictEqual(input.focused, true);
  assert.ok(input.dispatchedEvents.includes('input'));
  assert.ok(input.dispatchedEvents.includes('change'));
  console.log('✅ Test 3: Synthetic typing with event emission verified');
}

// Test 4: Select Option Execution
{
  const select = new MockDOMElement('select');
  select.options = [
    { value: 'low', text: 'Price: Low to High' },
    { value: 'high', text: 'Price: High to Low' }
  ];

  const res = await executeSelect(select, 'high');
  assert.strictEqual(res.success, true);
  assert.strictEqual(select.selectedIndex, 1);
  assert.ok(select.dispatchedEvents.includes('change'));
  console.log('✅ Test 4: Select dropdown option update verified');
}

// Test 5: Scroll Execution
{
  scrolledY = 0;
  const resDown = await executeScroll('down', 400);
  assert.strictEqual(resDown.success, true);
  assert.strictEqual(scrolledY, 400);

  const resUp = await executeScroll('up', 150);
  assert.strictEqual(resUp.success, true);
  assert.strictEqual(scrolledY, 250);
  console.log('✅ Test 5: Smooth scroll delta calculation verified');
}

// Test 6: Dispatch Browser Action Top-Level
{
  const btn = new MockDOMElement('button');
  global.window.__rahiScannedElements = [btn];

  // Dispatch click
  const resAction = await dispatchBrowserAction({ type: 'click', targetId: 1 });
  assert.strictEqual(resAction.success, true);
  assert.strictEqual(btn.clicked, true);

  // Dispatch missing element
  const resMissing = await dispatchBrowserAction({ type: 'click', targetId: 42 });
  assert.strictEqual(resMissing.success, false);
  assert.ok(resMissing.error.includes('Could not locate target element'));

  console.log('✅ Test 6: Master browser action dispatcher verified');
}

console.log('All executor unit tests passed successfully!');
