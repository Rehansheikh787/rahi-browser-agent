/**
 * Rahi - Interactive Element Scanner (Manifest V3 Content Script)
 * Scans the visible DOM for interactive/actionable elements, computes labels
 * and positions, assigns stable 1-indexed IDs, and serializes an ultra-compact
 * action manifest for model reasoning.
 */

// Global in-memory storage of scanned elements for direct DOM manipulation
if (typeof window !== 'undefined') {
  window.__rahiScannedElements = [];
}

/**
 * Standard CSS selector matching all interactive candidates
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Computes the best human-readable label for an interactive element
 * using an accessible hierarchy: aria-label -> label -> text -> placeholder -> title.
 * @param {Element} el
 * @returns {string}
 */
function computeElementLabel(el) {
  if (!el) return '';

  // 1. Explicit aria-label
  const ariaLabel = el.getAttribute?.('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim().substring(0, 80);
  }

  // 2. aria-labelledby lookup
  const labelledBy = el.getAttribute?.('aria-labelledby');
  if (labelledBy && typeof document !== 'undefined') {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl && labelEl.textContent && labelEl.textContent.trim()) {
      return labelEl.textContent.trim().substring(0, 80);
    }
  }

  // 3. Associated <label> element
  if (el.id && typeof document !== 'undefined') {
    try {
      const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelFor && labelFor.textContent && labelFor.textContent.trim()) {
        return labelFor.textContent.trim().substring(0, 80);
      }
    } catch (_) {}
  }
  const parentLabel = el.closest?.('label');
  if (parentLabel && parentLabel.textContent && parentLabel.textContent.trim()) {
    // Avoid double counting child input text
    const text = parentLabel.innerText || parentLabel.textContent;
    if (text && text.trim()) {
      return text.trim().substring(0, 80);
    }
  }

  // 4. Placeholder for text inputs
  if (el.placeholder && el.placeholder.trim()) {
    return el.placeholder.trim().substring(0, 80);
  }

  // 5. Value for submit/button inputs
  if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
    return el.value.trim().substring(0, 80);
  }

  // 6. Direct inner text or textContent
  const inner = (el.innerText || el.textContent || '').trim();
  if (inner) {
    return inner.replace(/\s+/g, ' ').substring(0, 80);
  }

  // 7. Title or name attribute
  const title = el.getAttribute?.('title') || el.getAttribute?.('name');
  if (title && title.trim()) {
    return title.trim().substring(0, 80);
  }

  // 8. Alt tag (for images inside links/buttons)
  const imgChild = el.querySelector?.('img[alt]');
  if (imgChild && imgChild.alt) {
    return imgChild.alt.trim().substring(0, 80);
  }

  return el.tagName.toLowerCase();
}

/**
 * Classifies the element into clean agent action types
 * @param {Element} el
 * @returns {string}
 */
function classifyElementType(el) {
  if (!el || !el.tagName) return 'unknown';
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute?.('role')?.toLowerCase();

  if (tag === 'button' || role === 'button') return 'button';
  if (tag === 'a' || role === 'link') return 'link';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';

  if (tag === 'input') {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
    if (type === 'radio' || role === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    if (type === 'password') return 'input_password';
    if (type === 'number') return 'input_number';
    if (type === 'email') return 'input_email';
    return 'input_text';
  }

  if (role === 'checkbox' || role === 'switch') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'menuitem' || role === 'tab') return 'button';

  return 'interactive';
}

/**
 * Verifies if an element is currently visible and interactable in viewport
 * @param {Element} el
 * @returns {boolean}
 */
function isElementVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;

  // Check dimensions
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  // Check computed styles
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      if (style.pointerEvents === 'none') return false;
    } catch (_) {}
  }

  // Check if completely offscreen outside document bounds
  if (rect.bottom < 0 || rect.right < 0) return false;

  return true;
}

/**
 * Main DOM scanner: scans candidates, filters invisible items, assigns sequential IDs
 * @param {Element|Document} [root=document]
 * @returns {Array<Object>} Compact action manifest
 */
function scanInteractiveElements(root = typeof document !== 'undefined' ? document : null) {
  if (!root || !root.querySelectorAll) {
    return [];
  }

  const rawElements = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
  const validElements = [];
  const compactManifest = [];

  let nextId = 1;

  for (const el of rawElements) {
    // Avoid scanning Rahi's own UI elements if accidentally matched
    if (el.closest?.('#rahi-badge-root') || el.id?.startsWith('rahi-')) {
      continue;
    }

    if (!isElementVisible(el)) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const type = classifyElementType(el);
    const label = computeElementLabel(el);

    // Grab current value if input/select/textarea
    let value = undefined;
    if (type === 'checkbox' || type === 'radio') {
      value = el.checked ? 'true' : 'false';
    } else if (el.value !== undefined && el.value !== '') {
      value = String(el.value).substring(0, 50);
    }

    const item = {
      id: nextId,
      type,
      label,
      placeholder: el.placeholder || undefined,
      value,
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };

    validElements.push(el);
    compactManifest.push(item);
    nextId++;
  }

  // Cache in-memory references for direct action execution
  if (typeof window !== 'undefined') {
    window.__rahiScannedElements = validElements;
  }

  return compactManifest;
}

// Bind to window for in-tab access
if (typeof window !== 'undefined') {
  window.rahiScanInteractiveElements = scanInteractiveElements;
  window.rahiComputeElementLabel = computeElementLabel;
  window.rahiClassifyElementType = classifyElementType;
  window.rahiIsElementVisible = isElementVisible;
  window.INTERACTIVE_SELECTOR = INTERACTIVE_SELECTOR;
}

// Bind to globalThis for node test runners
if (typeof globalThis !== 'undefined') {
  globalThis.rahiScanInteractiveElements = scanInteractiveElements;
  globalThis.rahiComputeElementLabel = computeElementLabel;
  globalThis.rahiClassifyElementType = classifyElementType;
  globalThis.rahiIsElementVisible = isElementVisible;
  globalThis.INTERACTIVE_SELECTOR = INTERACTIVE_SELECTOR;
}
