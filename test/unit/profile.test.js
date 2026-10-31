/**
 * Rahi - Local User Profile & Semantic Field Matcher Unit Tests
 * Validates profile normalization, semantic field matching for forms,
 * and prompt injection formatting.
 */

import assert from 'node:assert';
import {
  sanitizeProfile,
  matchProfileToFields,
  formatProfileForPrompt,
  DEFAULT_USER_PROFILE,
} from '../../sidepanel/components/profile.js';

console.log('Testing Local User Profile Memory & Semantic Field Matcher...');

// Test 1: Profile Sanitization & Normalization
{
  const raw = {
    fullName: '  Rehan Sheikh  ',
    email: 'rehan@example.com ',
    phone: ' +91 9876543210',
    skills: 'JavaScript, React, Node.js, Python ',
    preferredTone: 'concise',
    github: ' https://github.com/rehansheikh ',
  };

  const profile = sanitizeProfile(raw);
  assert.strictEqual(profile.fullName, 'Rehan Sheikh');
  assert.strictEqual(profile.email, 'rehan@example.com');
  assert.strictEqual(profile.phone, '+91 9876543210');
  assert.deepStrictEqual(profile.skills, ['JavaScript', 'React', 'Node.js', 'Python']);
  assert.strictEqual(profile.preferredTone, 'concise');
  assert.strictEqual(profile.links.github, 'https://github.com/rehansheikh');

  // Fallback tone for invalid value
  const badTone = sanitizeProfile({ preferredTone: 'super-aggressive' });
  assert.strictEqual(badTone.preferredTone, 'formal');

  console.log('✅ Test 1: Profile sanitization and normalization verified');
}

// Test 2: Semantic Form Field Matcher
{
  const mockProfile = {
    fullName: 'Rehan Sheikh',
    email: 'rehan@example.com',
    phone: '+91 9876543210',
    college: 'Masai School',
    degree: 'B.Tech Computer Science',
    skills: ['JavaScript', 'React', 'Python'],
    links: {
      github: 'https://github.com/rehansheikh',
      linkedin: 'https://linkedin.com/in/rehansheikh',
      portfolio: 'https://rehansheikh.dev',
    },
  };

  const mockManifest = [
    { id: 1, type: 'input_text', label: 'Full Name of Candidate', placeholder: 'Enter your name' },
    { id: 2, type: 'input_email', label: 'Email Address', placeholder: 'you@domain.com' },
    { id: 3, type: 'input_text', label: 'Contact Phone Number', placeholder: '+91 ...' },
    { id: 4, type: 'input_text', label: 'University / Institute Name', placeholder: 'College name' },
    { id: 5, type: 'select', label: 'Highest Qualification / Degree', placeholder: 'Select degree' },
    { id: 6, type: 'textarea', label: 'Key Technical Skills', placeholder: 'List skills' },
    { id: 7, type: 'input_text', label: 'GitHub Profile URL', placeholder: 'https://github.com/...' },
    { id: 8, type: 'button', label: 'Submit Application' }, // Should NOT match non-input
    { id: 9, type: 'input_password', label: 'Account Password' }, // Should NOT match sensitive input
  ];

  const matches = matchProfileToFields(mockManifest, mockProfile);

  assert.strictEqual(matches.length, 7, 'Expected 7 fillable fields to match');
  assert.strictEqual(matches[0].field, 'fullName');
  assert.strictEqual(matches[0].value, 'Rehan Sheikh');
  assert.strictEqual(matches[1].field, 'email');
  assert.strictEqual(matches[1].value, 'rehan@example.com');
  assert.strictEqual(matches[2].field, 'phone');
  assert.strictEqual(matches[2].value, '+91 9876543210');
  assert.strictEqual(matches[3].field, 'college');
  assert.strictEqual(matches[3].value, 'Masai School');
  assert.strictEqual(matches[4].field, 'degree');
  assert.strictEqual(matches[4].value, 'B.Tech Computer Science');
  assert.strictEqual(matches[5].field, 'skills');
  assert.strictEqual(matches[5].value, 'JavaScript, React, Python');
  assert.strictEqual(matches[6].field, 'github');
  assert.strictEqual(matches[6].value, 'https://github.com/rehansheikh');

  console.log('✅ Test 2: Semantic form field matching verified');
}

// Test 3: Prompt Formatting with Profile Memory
{
  const emptyPrompt = formatProfileForPrompt({});
  assert.strictEqual(emptyPrompt, 'No user profile memory saved.');

  const filledPrompt = formatProfileForPrompt({
    fullName: 'Rehan Sheikh',
    email: 'rehan@example.com',
    college: 'Masai School',
    preferredTone: 'formal',
  });

  assert.ok(filledPrompt.includes('=== USER PROFILE MEMORY (LOCAL) ==='));
  assert.ok(filledPrompt.includes('Rehan Sheikh'));
  assert.ok(filledPrompt.includes('rehan@example.com'));
  assert.ok(filledPrompt.includes('Masai School'));
  assert.ok(filledPrompt.includes('Preferred Tone: formal'));

  console.log('✅ Test 3: Profile memory prompt formatting verified');
}

console.log('All profile unit tests passed successfully!');

