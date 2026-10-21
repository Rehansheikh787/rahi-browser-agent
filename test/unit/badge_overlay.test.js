/**
 * Rahi - Shadow DOM Badge Overlay Unit Tests
 * Validates Shadow DOM creation, badge rendering, coordinate calculation,
 * and pulse highlighting logic.
 */

import assert from 'node:assert';

// Mock browser environment for unit test
class MockElement {
  constructor(tag, id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = '';
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.shadowRoot = null;
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] || null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  attachShadow({ mode }) {
    this.shadowRoot = new MockElement('shadow-root');
    return this.shadowRoot;
  }
  querySelector(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.find((c) => c.className?.split(' ').includes(cls)) || null;
    }
    return null;
  }
  querySelectorAll(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.filter((c) => c.className?.split(' ').includes(cls));
    }
    return [];
  }
  classList = {
    add: (cls) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      set.add(cls);
      this.className = Array.from(set).join(' ');
    },
    remove: (cls) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      set.delete(cls);
      this.className = Array.from(set).join(' ');
    },
    contains: (cls) => this.className.split(' ').includes(cls)
  };
  addEventListener(event, fn) {
    this.listeners[event] = fn;
  }
}

const mockDoc = {
  documentElement: new MockElement('html'),
  getElementById: (id) => (mockDoc.documentElement.children.find((c) => c.id === id) || null),
  createElement: (tag) => new MockElement(tag)
};

global.document = mockDoc;
global.window = {
  scrollX: 0,
  scrollY: 100,
  addEventListener: () => {},
  removeEventListener: () => {}
};

console.log('Testing Shadow DOM Numbered Badges Overlay...');

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load content/badge_overlay.js into mock window/global scope
const badgeScriptPath = resolve(process.cwd(), 'content/badge_overlay.js');
const badgeScriptContent = readFileSync(badgeScriptPath, 'utf8');
const fn = new Function('window', 'globalThis', 'document', badgeScriptContent);
fn(global.window, globalThis, mockDoc);

const {
  rahiGetOrCreateShadowRoot: getOrCreateShadowRoot,
  rahiShowBadges: showBadges,
  rahiHighlightElement: highlightElement,
  rahiRemoveBadges: removeBadges
} = globalThis;

// Test 1: Shadow Root Creation
{
  const shadow = getOrCreateShadowRoot();
  assert.ok(shadow, 'Shadow root must be created');
  const host = mockDoc.getElementById('rahi-badge-root');
  assert.ok(host, 'Host element #rahi-badge-root must exist in document');
  assert.strictEqual(host.style.position, 'absolute');
  console.log('✅ Test 1: Isolated Shadow DOM host creation verified');
}

// Test 2: Badge Pill Rendering with Coordinates
{
  const manifest = [
    { id: 1, type: 'button', label: 'Submit', rect: { top: 50, left: 120, width: 80, height: 32 } },
    { id: 2, type: 'input_text', label: 'Email', rect: { top: 120, left: 120, width: 200, height: 40 } }
  ];

  showBadges(manifest);

  const shadow = getOrCreateShadowRoot();
  const container = shadow.querySelector('.rahi-badge-container');
  assert.ok(container, 'Container exists in shadow DOM');
  assert.strictEqual(container.children.length, 2, '2 badges rendered');

  const badge1 = container.children[0];
  assert.strictEqual(badge1.textContent, 1);
  assert.strictEqual(badge1.style.top, '150px'); // 50 + scrollY(100)
  assert.strictEqual(badge1.style.left, '120px');
  assert.ok(badge1.className.includes('actionable-type-button'));

  const badge2 = container.children[1];
  assert.strictEqual(badge2.textContent, 2);
  assert.ok(badge2.className.includes('actionable-type-input'));

  console.log('✅ Test 2: Numbered badge coordinate positioning and type classes verified');
}

// Test 3: Highlight Target Element
{
  const highlighted = highlightElement(1, false);
  assert.strictEqual(highlighted, true);

  const shadow = getOrCreateShadowRoot();
  const container = shadow.querySelector('.rahi-badge-container');
  const badge1 = container.children[0];
  assert.ok(badge1.className.includes('rahi-highlight'), 'Badge 1 has pulse highlight class');

  console.log('✅ Test 3: Element pulse highlighting verified');
}

// Test 4: Remove Badges and Cleanup
{
  removeBadges();
  const host = mockDoc.getElementById('rahi-badge-root');
  assert.strictEqual(host, null, 'Host container removed from DOM');
  console.log('✅ Test 4: Badge overlay cleanup verified');
}

console.log('All badge overlay unit tests passed successfully!');
