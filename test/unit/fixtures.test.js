/**
 * Unit Test: Practice Errand Fixtures Verification
 * Validates DOM fixtures (Internship Form, Product Catalog, Editorial Article)
 * against semantic field matching, sensitive element blocking, and interactive selectors.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { matchProfileToFields } from '../../sidepanel/components/profile.js';
import { checkElementSentinel, isConsequentialAction } from '../../lib/safety_guard.js';

console.log('Testing Practice Errand Fixtures & End-to-End Environment Integrity...');

const FIXTURES_DIR = path.resolve('test/fixtures');

// 1. Test Mock Internship Form
{
  const formHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'mock_internship_form.html'), 'utf8');
  assert.ok(formHtml.length > 500, 'mock_internship_form.html must not be empty');

  // Verify key fields exist in HTML markup
  assert.ok(/name=["']applicantName["']/i.test(formHtml), 'applicantName input must exist in internship form');
  assert.ok(/name=["']applicantEmail["']/i.test(formHtml), 'applicantEmail input must exist in internship form');
  assert.ok(/name=["']applicantPhone["']/i.test(formHtml), 'applicantPhone input must exist in internship form');
  assert.ok(/name=["']applicantCollege["']/i.test(formHtml), 'applicantCollege input must exist in internship form');
  assert.ok(/name=["']applicantDegree["']/i.test(formHtml), 'applicantDegree dropdown must exist in internship form');
  assert.ok(/type=["']password["']/i.test(formHtml), 'password input must exist in internship form for safety testing');
  assert.ok(/id=["']btnSubmitApplication["']|type=["']submit["']/i.test(formHtml), 'submit button must exist in internship form');

  // Verify Sensitive Sentinel intercepts password field
  const safetyCheck = checkElementSentinel({
    type: 'password',
    name: 'accountPassword',
    id: 'accountPassword',
  });
  assert.strictEqual(safetyCheck.allowed, false, 'Sentinel must block password field in practice form');
  assert.strictEqual(safetyCheck.sensitiveType, 'password');

  // Verify Consequential Action gate flags submit
  const isConsequential = isConsequentialAction('click', 'Submit Application', 'Submit Application');
  assert.strictEqual(isConsequential, true, 'Submit Application button must be flagged as consequential');

  // Verify semantic matching on manifest representation
  const manifest = [
    { id: 1, type: 'input_text', label: 'Full Name', placeholder: 'e.g. Rehan Sheikh' },
    { id: 2, type: 'input_email', label: 'Email Address', placeholder: 'name@example.com' },
    { id: 3, type: 'input_text', label: 'Phone Number', placeholder: '+91 9876543210' },
    { id: 4, type: 'input_text', label: 'University / College Name', placeholder: 'e.g. Masai School' },
    { id: 5, type: 'select', label: 'Highest Qualification / Degree' },
  ];

  const profile = {
    fullName: 'Aditi Sharma',
    email: 'aditi@example.com',
    phone: '+91 9876543210',
    college: 'IIT Delhi',
    degree: 'B.Tech',
  };

  const matches = matchProfileToFields(manifest, profile);
  assert.strictEqual(matches.length, 5, 'All 5 fields must be matched to profile data');
  assert.strictEqual(matches.find((m) => m.targetId === 1).value, 'Aditi Sharma');
  assert.strictEqual(matches.find((m) => m.targetId === 4).value, 'IIT Delhi');

  console.log('✅ Test 1: Mock Internship Form semantic matching & safety guards verified');
}

// 2. Test Mock Product Catalog
{
  const catalogHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'mock_product_catalog.html'), 'utf8');
  assert.ok(catalogHtml.length > 500, 'mock_product_catalog.html must not be empty');

  assert.ok(/id=["']productSearch["']|type=["']search["']|placeholder=.*search/i.test(catalogHtml), 'Product search bar must exist in catalog');
  assert.ok(/type=["']checkbox["']/i.test(catalogHtml), 'Category checkboxes must exist in catalog');
  assert.ok(/id=["']sortSelect["']|<select/i.test(catalogHtml), 'Sort dropdown must exist in catalog');
  assert.ok(/btn-add-cart|Add to Cart/i.test(catalogHtml), 'Add to Cart buttons must exist in catalog');

  console.log('✅ Test 2: Mock Product Catalog interactive elements verified');
}

// 3. Test Mock Editorial Article
{
  const articleHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'mock_article.html'), 'utf8');
  assert.ok(articleHtml.length > 500, 'mock_article.html must not be empty');

  assert.ok(/<article/i.test(articleHtml), '<article> tag must exist in mock editorial page');
  assert.ok(/<h1/i.test(articleHtml), '<h1> title must exist in mock editorial page');
  assert.ok(/ad-banner|advertisement/i.test(articleHtml), 'Simulated ad container must exist for noise-stripping test');

  console.log('✅ Test 3: Mock Editorial Article layout and noise simulation verified');
}

console.log('All Practice Errand Fixtures unit tests passed successfully!\n');
