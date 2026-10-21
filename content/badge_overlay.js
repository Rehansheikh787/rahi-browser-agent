/**
 * Rahi - Shadow DOM Numbered Badges Overlay (Manifest V3 Content Script)
 * Renders numbered badge pills over scanned interactive elements using an isolated
 * Shadow DOM root to prevent host page CSS leaking in or extension styles leaking out.
 */

// Host container ID
const BADGE_ROOT_ID = 'rahi-badge-root';

// Cached references
let badgeRoot = null;
let shadowRoot = null;
let activeBadges = [];
let scrollListenerAttached = false;

/**
 * Isolated CSS styles injected directly into Shadow DOM
 */
const OVERLAY_STYLES = `
  :host {
    all: initial;
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 2147483647;
  }

  .rahi-badge-container {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .rahi-badge {
    position: absolute;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 4px;
    border-radius: 10px;
    background: #4f46e5;
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    text-align: center;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35), 0 0 0 1.5px #ffffff;
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
    transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
  }

  .rahi-badge:hover {
    transform: translate(-50%, -50%) scale(1.25);
    background: #4338ca;
    z-index: 100;
  }

  .rahi-badge.actionable-type-input {
    background: #0284c7;
  }

  .rahi-badge.actionable-type-button {
    background: #16a34a;
  }

  .rahi-badge.actionable-type-link {
    background: #4f46e5;
  }

  /* High-visibility pulse animation for Find It for Me */
  .rahi-badge.rahi-highlight {
    background: #f59e0b;
    box-shadow: 0 0 0 3px #ffffff, 0 0 0 6px #f59e0b, 0 4px 12px rgba(245, 158, 11, 0.6);
    transform: translate(-50%, -50%) scale(1.35);
    animation: rahi-pulse 1.4s infinite cubic-bezier(0.4, 0, 0.6, 1);
    z-index: 99999;
  }

  @keyframes rahi-pulse {
    0%, 100% {
      transform: translate(-50%, -50%) scale(1.35);
      box-shadow: 0 0 0 3px #ffffff, 0 0 0 6px #f59e0b, 0 4px 12px rgba(245, 158, 11, 0.6);
    }
    50% {
      transform: translate(-50%, -50%) scale(1.55);
      box-shadow: 0 0 0 4px #ffffff, 0 0 0 10px rgba(245, 158, 11, 0.4), 0 6px 18px rgba(245, 158, 11, 0.8);
    }
  }

  /* Element bounding ring for highlighted targets */
  .rahi-element-ring {
    position: absolute;
    border: 2.5px solid #f59e0b;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.12);
    pointer-events: none;
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.5);
    animation: rahi-ring-glow 1.4s infinite ease-in-out;
    z-index: 99998;
  }

  @keyframes rahi-ring-glow {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 0.35; }
  }
`;

/**
 * Initializes or retrieves the Shadow DOM root container
 * @returns {ShadowRoot}
 */
export function getOrCreateShadowRoot() {
  if (typeof document === 'undefined') return null;

  let host = document.getElementById(BADGE_ROOT_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = BADGE_ROOT_ID;
    host.style.position = 'absolute';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '100%';
    host.style.height = '0';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';

    document.documentElement.appendChild(host);
  }

  badgeRoot = host;
  if (!host.shadowRoot) {
    shadowRoot = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_STYLES;
    shadowRoot.appendChild(styleEl);

    const container = document.createElement('div');
    container.className = 'rahi-badge-container';
    shadowRoot.appendChild(container);
  } else {
    shadowRoot = host.shadowRoot;
  }

  return shadowRoot;
}

/**
 * Renders numbered badge overlay given an array of scanned elements or manifest items
 * @param {Array<Object>} manifest Array of { id, rect, type, label }
 * @param {Array<Element>} [elementsRef] Optional direct DOM element references
 */
export function showBadges(manifest = [], elementsRef = null) {
  const shadow = getOrCreateShadowRoot();
  if (!shadow) return;

  const container = shadow.querySelector('.rahi-badge-container');
  if (!container) return;

  // Clear previous badges
  container.innerHTML = '';
  activeBadges = [];

  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  manifest.forEach((item, index) => {
    const el = elementsRef ? elementsRef[index] : (window.__rahiScannedElements ? window.__rahiScannedElements[index] : null);
    
    // Compute current position relative to page document
    let top = 0;
    let left = 0;
    if (el && el.getBoundingClientRect) {
      const rect = el.getBoundingClientRect();
      top = rect.top + scrollY;
      left = rect.left + scrollX;
    } else if (item.rect) {
      top = item.rect.top + scrollY;
      left = item.rect.left + scrollX;
    }

    const badge = document.createElement('div');
    badge.className = 'rahi-badge';
    badge.setAttribute('data-id', item.id);
    badge.textContent = item.id;

    // Type styling
    if (item.type?.startsWith('input')) {
      badge.classList.add('actionable-type-input');
    } else if (item.type === 'button') {
      badge.classList.add('actionable-type-button');
    } else if (item.type === 'link') {
      badge.classList.add('actionable-type-link');
    }

    badge.style.top = `${top}px`;
    badge.style.left = `${left}px`;
    badge.title = `${item.id}: [${item.type}] ${item.label || ''}`;

    // Optional click to notify side panel or focus
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el && typeof el.focus === 'function') {
        el.focus();
      }
      highlightElement(item.id);
    });

    container.appendChild(badge);
    activeBadges.push({ id: item.id, badgeEl: badge, targetEl: el });
  });

  // Attach scroll & resize handler to keep positions in sync if not already attached
  if (!scrollListenerAttached && typeof window !== 'undefined') {
    window.addEventListener('scroll', updateBadgePositions, { passive: true });
    window.addEventListener('resize', updateBadgePositions, { passive: true });
    scrollListenerAttached = true;
  }
}

/**
 * Recalculates badge coordinates on page scroll or resize
 */
export function updateBadgePositions() {
  if (!activeBadges.length || typeof window === 'undefined') return;

  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  activeBadges.forEach(({ badgeEl, targetEl }) => {
    if (targetEl && targetEl.getBoundingClientRect) {
      const rect = targetEl.getBoundingClientRect();
      badgeEl.style.top = `${rect.top + scrollY}px`;
      badgeEl.style.left = `${rect.left + scrollX}px`;
    }
  });

  // Update element ring if active
  const ring = shadowRoot?.querySelector('.rahi-element-ring');
  if (ring && ring.__targetEl) {
    const rect = ring.__targetEl.getBoundingClientRect();
    ring.style.top = `${rect.top + scrollY - 2}px`;
    ring.style.left = `${rect.left + scrollX - 2}px`;
    ring.style.width = `${rect.width + 4}px`;
    ring.style.height = `${rect.height + 4}px`;
  }
}

/**
 * Highlights a specific element ID with pulse animation and glowing bounding ring.
 * Automatically scrolls the element into viewport smoothly.
 * @param {number|string} targetId
 * @param {boolean} [scrollIntoView=true]
 */
export function highlightElement(targetId, scrollIntoView = true) {
  if (!shadowRoot) return false;

  const idNum = Number(targetId);
  const container = shadowRoot.querySelector('.rahi-badge-container');
  if (!container) return false;

  // Remove existing highlight
  const existingHighlights = shadowRoot.querySelectorAll('.rahi-highlight');
  existingHighlights.forEach((el) => el.classList.remove('rahi-highlight'));

  const existingRing = shadowRoot.querySelector('.rahi-element-ring');
  if (existingRing) existingRing.remove();

  // Find badge
  const badgeObj = activeBadges.find((b) => Number(b.id) === idNum);
  if (!badgeObj) return false;

  badgeObj.badgeEl.classList.add('rahi-highlight');

  // Find underlying element
  const targetEl = badgeObj.targetEl || 
    (window.__rahiScannedElements ? window.__rahiScannedElements[idNum - 1] : null);

  if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const rect = targetEl.getBoundingClientRect();

    // Create glowing bounding ring
    const ring = document.createElement('div');
    ring.className = 'rahi-element-ring';
    ring.__targetEl = targetEl;
    ring.style.top = `${rect.top + scrollY - 2}px`;
    ring.style.left = `${rect.left + scrollX - 2}px`;
    ring.style.width = `${rect.width + 4}px`;
    ring.style.height = `${rect.height + 4}px`;
    shadowRoot.appendChild(ring);

    if (scrollIntoView && typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
    return true;
  }

  return true;
}

/**
 * Removes all badges, highlights, and cleans up event listeners
 */
export function removeBadges() {
  if (shadowRoot) {
    const container = shadowRoot.querySelector('.rahi-badge-container');
    if (container) container.innerHTML = '';
    const ring = shadowRoot.querySelector('.rahi-element-ring');
    if (ring) ring.remove();
  }

  activeBadges = [];

  if (scrollListenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('scroll', updateBadgePositions);
    window.removeEventListener('resize', updateBadgePositions);
    scrollListenerAttached = false;
  }

  const host = document?.getElementById?.(BADGE_ROOT_ID);
  if (host) {
    host.remove();
  }
  badgeRoot = null;
  shadowRoot = null;
}

// Attach to window for in-tab script execution
if (typeof window !== 'undefined') {
  window.rahiShowBadges = showBadges;
  window.rahiHighlightElement = highlightElement;
  window.rahiRemoveBadges = removeBadges;
}
