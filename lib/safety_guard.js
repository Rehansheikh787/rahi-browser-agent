/**
 * Rahi - Hardcoded Security Guardrails (Defense in Depth — ADR-003)
 * Provides deterministic client-side safety interceptors:
 * Layer 1: Domain Firewall (Blocks banking, payments, and sensitive auth pages)
 * Layer 2: Sensitive Element Sentinel (Blocks passwords, OTPs, CVVs, and card numbers)
 * Layer 3: Consequential Action Criteria
 */

/**
 * Domain patterns strictly prohibited from automated action execution
 */
export const RESTRICTED_DOMAIN_PATTERNS = [
  // Banking & Netbanking
  /(?:^|\.)(?:netbanking|banking|onlinebanking)(?:\.|\/)/i,
  /(?:hdfcbank|icicibank|sbi|onlinesbi|axisbank|kotak|pnbindia|bankofbaroda|hsbc|citi|chase|wellsfargo|bankofamerica)\.(?:com|in|sbi|co\.in|org)/i,

  // Payment Gateways & Wallets
  /(?:paypal|stripe|razorpay|paytm|phonepe|billdesk|cashfree)\.com/i,
  /pay\.google\.com/i,
  /pay\.amazon\./i,

  // Critical Auth & Account Sign-in
  /accounts\.google\.com\/signin/i,
  /login\.live\.com/i,
  /login\.microsoftonline\.com/i,
  /appleid\.apple\.com/i,
];

/**
 * Sensitive input element patterns strictly prohibited from interaction
 */
export const SENSITIVE_ELEMENT_PATTERNS = [
  // Password inputs
  {
    type: 'password',
    match: (el) => el.type === 'password' || el.tagName === 'INPUT' && (el.getAttribute?.('type') || '').toLowerCase() === 'password',
    reason: 'Password input field',
  },

  // One-time passwords (OTP) / MFA codes
  {
    type: 'otp',
    match: (el) => {
      const corpus = [
        el.getAttribute?.('autocomplete') || '',
        el.getAttribute?.('name') || '',
        el.getAttribute?.('id') || '',
        el.getAttribute?.('aria-label') || '',
        el.placeholder || '',
      ].join(' ').toLowerCase();

      return /\b(one-time-code|otp|2fa|mfa|auth[-_]?code|verification[-_]?code)\b/i.test(corpus);
    },
    reason: 'One-time password (OTP) / 2FA verification field',
  },

  // Credit card & CVV inputs
  {
    type: 'payment_card',
    match: (el) => {
      const corpus = [
        el.getAttribute?.('autocomplete') || '',
        el.getAttribute?.('name') || '',
        el.getAttribute?.('id') || '',
        el.getAttribute?.('aria-label') || '',
        el.placeholder || '',
      ].join(' ').toLowerCase();

      return /\b(cc-number|cc-csc|cc-exp|card[-_]?number|cvv|cvc|security[-_]?code)\b/i.test(corpus);
    },
    reason: 'Credit card / CVV financial payment field',
  },
];

/**
 * Layer 1: Evaluates whether a URL is restricted by the Domain Firewall
 * @param {string} url
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkDomainFirewall(url = '') {
  if (!url || typeof url !== 'string') {
    return { allowed: false, reason: 'Invalid or empty URL' };
  }

  // System protocols are blocked
  if (/^(chrome|chrome-extension|edge|brave|about|data|file):/i.test(url)) {
    return {
      allowed: false,
      reason: 'Browser system pages are protected and cannot be automated.',
    };
  }

  for (const pattern of RESTRICTED_DOMAIN_PATTERNS) {
    if (pattern.test(url)) {
      return {
        allowed: false,
        reason: 'Rahi actions are strictly disabled on financial, banking, and authentication portals for your security.',
      };
    }
  }

  return { allowed: true };
}

/**
 * Layer 2: Evaluates whether an element is restricted by the Sensitive Element Sentinel
 * @param {Element|Object} el DOM element or manifest item
 * @returns {{ allowed: boolean, reason?: string, sensitiveType?: string }}
 */
export function checkElementSentinel(el) {
  if (!el) {
    return { allowed: true };
  }

  // Check manifest object format (from scanner.js)
  if (el.type === 'input_password') {
    return {
      allowed: false,
      sensitiveType: 'password',
      reason: 'Rahi strictly refuses to interact with password fields.',
    };
  }

  // Check DOM element or object attributes
  for (const rule of SENSITIVE_ELEMENT_PATTERNS) {
    if (rule.match(el)) {
      return {
        allowed: false,
        sensitiveType: rule.type,
        reason: `Rahi strictly refuses to interact with ${rule.reason}.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Layer 3: Evaluates whether an action is consequential and requires secondary confirmation
 * @param {Object} action { type, targetId, value }
 * @param {string} thought Rationale from model
 * @param {string} targetLabel Label of target element
 * @returns {boolean}
 */
export function isConsequentialAction(action, thought = '', targetLabel = '') {
  if (!action) return false;

  const corpus = [
    action.type || '',
    action.value || '',
    thought || '',
    targetLabel || '',
  ].join(' ').toLowerCase();

  const consequentialKeywords = [
    'submit',
    'delete',
    'remove',
    'pay',
    'payment',
    'purchase',
    'buy',
    'order',
    'transfer',
    'terminate',
    'drop',
    'erase',
    'checkout',
    'unsubscribe',
    'confirm purchase',
  ];

  return consequentialKeywords.some((kw) => {
    const rx = new RegExp(`\\b${kw}\\b`, 'i');
    return rx.test(corpus);
  });
}
