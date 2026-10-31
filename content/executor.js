/**
 * Rahi - Synthetic Event Executor (Manifest V3 Content Script)
 * Executes deterministic browser actions directly within the web page context.
 * Bypasses synthetic event suppression in React, Vue, and modern frameworks
 * by invoking native property setters and firing complete event lifecycles.
 */

(function () {
  /**
   * Finds the DOM element corresponding to a 1-indexed target ID
   * @param {number|string} targetId
   * @returns {Element|null}
   */
  function resolveTargetElement(targetId) {
  const index = Number(targetId) - 1;
  if (
    typeof window !== 'undefined' &&
    window.__rahiScannedElements &&
    Array.isArray(window.__rahiScannedElements) &&
    index >= 0 &&
    index < window.__rahiScannedElements.length
  ) {
    const el = window.__rahiScannedElements[index];
    if (el && (typeof document === 'undefined' || document.contains(el))) {
      return el;
    }
  }
  return null;
}

/**
 * Executes a synthetic click with complete event dispatch sequence
 * @param {Element} el
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function executeClick(el) {
  if (!el) {
    return { success: false, error: 'Target element is null or not found' };
  }

  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    // Short pause for smooth scroll to settle
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Focus element
    if (typeof el.focus === 'function') {
      el.focus();
    }

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      view: typeof window !== 'undefined' ? window : null,
      composed: true,
    };

    // Full event sequence for modern framework compatibility
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerdown', mouseInit));
    }
    if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent('mousedown', mouseInit));
    }
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerup', mouseInit));
    }
    if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent('mouseup', mouseInit));
    }

    // Native click trigger
    if (typeof el.click === 'function') {
      el.click();
    } else if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent('click', mouseInit));
    }

    return {
      success: true,
      message: `Clicked element [${el.tagName.toLowerCase()}]`,
    };
  } catch (err) {
    return { success: false, error: `Click execution failed: ${err.message}` };
  }
}

/**
 * Executes text input typing using the native prototype setter to bypass React/Vue synthetic guards
 * @param {Element} el
 * @param {string} value Text value to enter
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function executeType(el, value) {
  if (!el) {
    return { success: false, error: 'Target element is null or not found' };
  }

  try {
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
    if (typeof el.focus === 'function') {
      el.focus();
    }

    const stringVal = String(value);

    // Apply native prototype setter hack for controlled inputs
    let setter = null;
    if (typeof window !== 'undefined') {
      if (el.tagName === 'INPUT' && window.HTMLInputElement?.prototype) {
        setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      } else if (el.tagName === 'TEXTAREA' && window.HTMLTextAreaElement?.prototype) {
        setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      }
    }

    if (setter) {
      setter.call(el, stringVal);
    } else {
      el.value = stringVal;
    }

    // Dispatch input and change events
    if (typeof Event !== 'undefined') {
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    return {
      success: true,
      message: `Typed "${stringVal.length > 25 ? stringVal.substring(0, 22) + '...' : stringVal}" into [${el.tagName.toLowerCase()}]`,
    };
  } catch (err) {
    return { success: false, error: `Typing execution failed: ${err.message}` };
  }
}

/**
 * Executes selection on a <select> element or custom dropdown
 * @param {Element} el
 * @param {string} value Option value or text to select
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function executeSelect(el, value) {
  if (!el) {
    return { success: false, error: 'Target element is null or not found' };
  }

  try {
    const stringVal = String(value).toLowerCase().trim();

    if (el.tagName === 'SELECT' && el.options) {
      let matchedIndex = -1;
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (
          opt.value.toLowerCase().trim() === stringVal ||
          opt.text.toLowerCase().trim() === stringVal
        ) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex !== -1) {
        el.selectedIndex = matchedIndex;
        if (typeof Event !== 'undefined') {
          el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
        return {
          success: true,
          message: `Selected "${el.options[matchedIndex].text}"`,
        };
      }
      return { success: false, error: `Option "${value}" not found in select element` };
    }

    // Fallback for role="listbox" or custom select
    return await executeClick(el);
  } catch (err) {
    return { success: false, error: `Select execution failed: ${err.message}` };
  }
}

/**
 * Executes page scrolling
 * @param {'up'|'down'} direction
 * @param {number} [amount=300]
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function executeScroll(direction = 'down', amount = 300) {
  try {
    const delta = direction === 'down' ? Math.abs(amount) : -Math.abs(amount);
    if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
      window.scrollBy({ top: delta, left: 0, behavior: 'smooth' });
    }
    return {
      success: true,
      message: `Scrolled ${direction} by ${Math.abs(amount)}px`,
    };
  } catch (err) {
    return { success: false, error: `Scroll failed: ${err.message}` };
  }
}

/**
 * Main Action Dispatcher
 * @param {Object} action { type, targetId, value, direction, amount }
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function dispatchBrowserAction(action) {
  if (!action || !action.type) {
    return { success: false, error: 'Action type missing' };
  }

  const { type, targetId, value, direction, amount } = action;

  if (type === 'scroll') {
    return await executeScroll(direction, amount);
  }

  if (type === 'finish') {
    return { success: true, message: action.message || 'Task completed' };
  }

  if (type === 'ask_user') {
    return { success: true, message: action.question || 'Awaiting user input' };
  }

  // Target element required for click, type, select
  const el = resolveTargetElement(targetId);
  if (!el) {
    return {
      success: false,
      error: `Could not locate target element with ID ${targetId}. The DOM may have updated or the element is no longer visible.`,
    };
  }

  // Layer 2 Safety Guard: Check for sensitive elements (passwords, OTPs, CVVs)
  const safetyChecker = (typeof window !== 'undefined' && window.rahiCheckElementSafety) ||
                        (typeof globalThis !== 'undefined' && globalThis.rahiCheckElementSafety);
  if (typeof safetyChecker === 'function') {
    const safety = safetyChecker(el);
    if (!safety.allowed) {
      return {
        success: false,
        blockedBySafety: true,
        error: safety.reason || 'Action blocked by Rahi Safety Sentinel.',
      };
    }
  }

  switch (type) {
    case 'click':
      return await executeClick(el);
    case 'type':
      return await executeType(el, value);
    case 'select':
      return await executeSelect(el, value);
    default:
      return { success: false, error: `Unsupported action type: "${type}"` };
  }
}

  // Bind to window for direct in-tab execution
  if (typeof window !== 'undefined') {
    window.rahiDispatchBrowserAction = dispatchBrowserAction;
    window.rahiExecuteClick = executeClick;
    window.rahiExecuteType = executeType;
    window.rahiExecuteSelect = executeSelect;
    window.rahiExecuteScroll = executeScroll;
    window.rahiResolveTargetElement = resolveTargetElement;
  }

  // Bind to globalThis for node test runners
  if (typeof globalThis !== 'undefined') {
    globalThis.rahiDispatchBrowserAction = dispatchBrowserAction;
    globalThis.rahiExecuteClick = executeClick;
    globalThis.rahiExecuteType = executeType;
    globalThis.rahiExecuteSelect = executeSelect;
    globalThis.rahiExecuteScroll = executeScroll;
    globalThis.rahiResolveTargetElement = resolveTargetElement;
  }
})();
