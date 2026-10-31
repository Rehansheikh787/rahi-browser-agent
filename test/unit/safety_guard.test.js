/**
 * Rahi - Hardcoded Security Guardrails Unit Tests (ADR-003)
 * Validates 3 Defense-in-Depth Safety Layers:
 * Layer 1: Domain Firewall (Blocks banking, financial, and authentication portals)
 * Layer 2: Sensitive Element Sentinel (Blocks passwords, OTPs, CVVs, and card numbers)
 * Layer 3: Consequential Action Detection
 */

import assert from 'node:assert';
import {
  checkDomainFirewall,
  checkElementSentinel,
  isConsequentialAction,
} from '../../lib/safety_guard.js';

console.log('Testing Hardcoded Security Guardrails (Defense in Depth)...');

// Test 1: Layer 1 — Domain Firewall
{
  // 1a: Banking & Netbanking blocks
  assert.strictEqual(checkDomainFirewall('https://netbanking.hdfcbank.com/netbanking/').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://retail.onlinesbi.sbi/retail/login.htm').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://www.chase.com/personal/banking').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://banking.axisbank.com').allowed, false);

  // 1b: Payment gateways & Wallets blocks
  assert.strictEqual(checkDomainFirewall('https://www.paypal.com/checkout/pay').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://checkout.stripe.com/c/pay/cs_live_123').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://api.razorpay.com/v1/checkout').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://pay.google.com/gp/w/u/0/home/signup').allowed, false);

  // 1c: Critical Authentication Portals
  assert.strictEqual(checkDomainFirewall('https://accounts.google.com/signin/v2/identifier').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://login.live.com/oauth20_authorize.srf').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://login.microsoftonline.com/common/oauth2').allowed, false);
  assert.strictEqual(checkDomainFirewall('https://appleid.apple.com/auth/authorize').allowed, false);

  // 1d: Browser Internal / System URLs
  assert.strictEqual(checkDomainFirewall('chrome://extensions/').allowed, false);
  assert.strictEqual(checkDomainFirewall('chrome-extension://abcdefgh/sidepanel.html').allowed, false);

  // 1e: Allowed regular web domains
  assert.strictEqual(checkDomainFirewall('https://en.wikipedia.org/wiki/Artificial_intelligence').allowed, true);
  assert.strictEqual(checkDomainFirewall('https://github.com/trending').allowed, true);
  assert.strictEqual(checkDomainFirewall('https://developer.mozilla.org/en-US/docs/Web').allowed, true);
  assert.strictEqual(checkDomainFirewall('https://news.ycombinator.com').allowed, true);

  console.log('✅ Test 1: Layer 1 Domain Firewall verified');
}

// Test 2: Layer 2 — Sensitive Element Sentinel
{
  // 2a: Password inputs
  const pwdInput = {
    type: 'password',
    tagName: 'INPUT',
    getAttribute: (a) => (a === 'type' ? 'password' : null),
  };
  const resPwd = checkElementSentinel(pwdInput);
  assert.strictEqual(resPwd.allowed, false);
  assert.strictEqual(resPwd.sensitiveType, 'password');

  // 2b: OTP / 2FA verification inputs
  const otpInput = {
    type: 'text',
    tagName: 'INPUT',
    getAttribute: (a) => {
      if (a === 'autocomplete') return 'one-time-code';
      if (a === 'name') return 'user_otp';
      return null;
    },
    placeholder: 'Enter 6-digit OTP sent to your phone',
  };
  const resOtp = checkElementSentinel(otpInput);
  assert.strictEqual(resOtp.allowed, false);
  assert.strictEqual(resOtp.sensitiveType, 'otp');

  // 2c: Credit card / CVV payment inputs
  const cardInput = {
    type: 'text',
    tagName: 'INPUT',
    getAttribute: (a) => {
      if (a === 'id') return 'cc-number';
      return null;
    },
    placeholder: 'Card number',
  };
  const resCard = checkElementSentinel(cardInput);
  assert.strictEqual(resCard.allowed, false);
  assert.strictEqual(resCard.sensitiveType, 'payment_card');

  const cvvInput = {
    type: 'text',
    tagName: 'INPUT',
    getAttribute: (a) => (a === 'name' ? 'card_cvv' : null),
    placeholder: 'CVV',
  };
  const resCvv = checkElementSentinel(cvvInput);
  assert.strictEqual(resCvv.allowed, false);
  assert.strictEqual(resCvv.sensitiveType, 'payment_card');

  // 2d: Allowed non-sensitive inputs
  const normalInput = {
    type: 'text',
    tagName: 'INPUT',
    getAttribute: (a) => (a === 'name' ? 'full_name' : null),
    placeholder: 'Enter your full name',
  };
  assert.strictEqual(checkElementSentinel(normalInput).allowed, true);

  const emailInput = {
    type: 'email',
    tagName: 'INPUT',
    getAttribute: (a) => (a === 'type' ? 'email' : null),
    placeholder: 'Email address',
  };
  assert.strictEqual(checkElementSentinel(emailInput).allowed, true);

  console.log('✅ Test 2: Layer 2 Sensitive Element Sentinel verified');
}

// Test 3: Layer 3 — Consequential Action Detection
{
  // 3a: Form submission & deletions
  assert.strictEqual(isConsequentialAction({ type: 'click' }, 'Submitting the application form', 'Submit'), true);
  assert.strictEqual(isConsequentialAction({ type: 'click' }, 'Deleting user account', 'Delete Account'), true);
  assert.strictEqual(isConsequentialAction({ type: 'click' }, 'Confirm payment and checkout', 'Pay Now'), true);
  assert.strictEqual(isConsequentialAction({ type: 'click' }, 'Remove item from cart', 'Remove Item'), true);

  // 3b: Safe navigation & search actions (non-consequential)
  assert.strictEqual(isConsequentialAction({ type: 'click' }, 'Viewing next page of results', 'Next Page'), false);
  assert.strictEqual(isConsequentialAction({ type: 'type', value: 'machine learning' }, 'Entering search query', 'Search Input'), false);
  assert.strictEqual(isConsequentialAction({ type: 'scroll', direction: 'down' }, 'Scrolling to read article'), false);

  console.log('✅ Test 3: Layer 3 Consequential Action Detection verified');
}

console.log('All hardcoded security guardrails unit tests passed successfully!');

