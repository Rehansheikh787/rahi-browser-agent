/**
 * Rahi - In-Tab Safety Guard (Manifest V3 Content Script)
 * Intercepts actions directly inside the DOM execution pipeline,
 * enforcing the Element Sentinel and Domain Firewall locally before synthetic dispatch.
 */

(function () {
  const SENSITIVE_PATTERNS = [
    {
      type: 'password',
      match: (el) => el.type === 'password' || (el.getAttribute && (el.getAttribute('type') || '').toLowerCase() === 'password'),
      reason: 'Password input field',
    },
    {
      type: 'otp',
      match: (el) => {
        const corpus = [
          el.getAttribute ? el.getAttribute('autocomplete') || '' : '',
          el.getAttribute ? el.getAttribute('name') || '' : '',
          el.getAttribute ? el.getAttribute('id') || '' : '',
          el.getAttribute ? el.getAttribute('aria-label') || '' : '',
          el.placeholder || '',
        ].join(' ').toLowerCase();

        return /\b(one-time-code|otp|2fa|mfa|auth[-_]?code|verification[-_]?code)\b/i.test(corpus);
      },
      reason: 'One-time password (OTP) / 2FA field',
    },
    {
      type: 'payment_card',
      match: (el) => {
        const corpus = [
          el.getAttribute ? el.getAttribute('autocomplete') || '' : '',
          el.getAttribute ? el.getAttribute('name') || '' : '',
          el.getAttribute ? el.getAttribute('id') || '' : '',
          el.getAttribute ? el.getAttribute('aria-label') || '' : '',
          el.placeholder || '',
        ].join(' ').toLowerCase();

        return /\b(cc-number|cc-csc|cc-exp|card[-_]?number|cvv|cvc|security[-_]?code)\b/i.test(corpus);
      },
      reason: 'Credit card / CVV payment field',
    },
  ];

  function checkElementSafety(el) {
    if (!el) return { allowed: true };

    for (const rule of SENSITIVE_PATTERNS) {
      try {
        if (rule.match(el)) {
          return {
            allowed: false,
            sensitiveType: rule.type,
            reason: `Action blocked: Rahi strictly refuses to interact with ${rule.reason}.`,
          };
        }
      } catch (_) {}
    }

    return { allowed: true };
  }

  // Attach to window and globalThis
  if (typeof window !== 'undefined') {
    window.rahiCheckElementSafety = checkElementSafety;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.rahiCheckElementSafety = checkElementSafety;
  }
})();

