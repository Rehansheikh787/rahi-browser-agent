/**
 * Rahi - One-Click Skills Hub Unit Tests
 * Validates built-in skills, custom skill validation, script sanitization,
 * and JSON import/export envelope integrity (rahi-skills-v1).
 */

import assert from 'node:assert';
import {
  BUILTIN_SKILLS,
  SKILLS_FORMAT_IDENTIFIER,
  sanitizeSkillText,
  validateSkill,
  validateImportedSkills,
  exportSkillsToJSON,
} from '../../sidepanel/components/skills.js';

console.log('Testing One-Click Skills Hub & Export/Import Engine...');

// Test 1: Built-in Skills Catalog
{
  assert.strictEqual(BUILTIN_SKILLS.length, 5, 'Must contain 5 built-in skills');

  const ids = BUILTIN_SKILLS.map((s) => s.id);
  assert.ok(ids.includes('builtin_exam_notes'));
  assert.ok(ids.includes('builtin_hinglish_explain'));
  assert.ok(ids.includes('builtin_polite_reply'));
  assert.ok(ids.includes('builtin_autofill_form'));
  assert.ok(ids.includes('builtin_action_points'));

  BUILTIN_SKILLS.forEach((s) => {
    assert.ok(s.name && s.description && s.target);
    assert.ok(['summary', 'chat', 'agent'].includes(s.target));
  });

  console.log('✅ Test 1: Built-in skills catalog verified');
}

// Test 2: Script Injection & HTML Sanitization
{
  const malicious = 'Analyze <script>alert("XSS")</script> this javascript:void(0) and eval(test)';
  const cleaned = sanitizeSkillText(malicious);
  assert.ok(!cleaned.includes('<script>'));
  assert.ok(!cleaned.includes('javascript:'));
  assert.ok(!cleaned.includes('eval('));
  assert.strictEqual(cleaned, 'Analyze this and');

  console.log('✅ Test 2: Script injection & XSS sanitization verified');
}

// Test 3: Skill Validation
{
  // 3a: Valid custom skill
  const valid = validateSkill({
    name: 'Grammar Checker',
    icon: '✍️',
    description: 'Fixes grammatical mistakes in page text.',
    target: 'chat',
    promptTemplate: 'Please proofread the following text for grammar and clarity: {{content}}',
  });
  assert.strictEqual(valid.valid, true);
  assert.strictEqual(valid.sanitized.name, 'Grammar Checker');
  assert.strictEqual(valid.sanitized.target, 'chat');

  // 3b: Invalid skill missing prompt template
  const invalid = validateSkill({
    name: 'Empty Skill',
    description: 'Does nothing',
    target: 'chat',
    promptTemplate: '',
  });
  assert.strictEqual(invalid.valid, false);
  assert.ok(invalid.errors.some((e) => e.includes('Prompt template cannot be empty')));

  console.log('✅ Test 3: Skill schema validation verified');
}

// Test 4: Export to JSON Envelope (rahi-skills-v1)
{
  const skillsToExport = [
    {
      name: 'Code Explainer',
      icon: '💻',
      description: 'Explains code blocks found on page.',
      target: 'chat',
      promptTemplate: 'Explain this code: {{selection}}',
    },
  ];

  const jsonStr = exportSkillsToJSON(skillsToExport);
  const parsed = JSON.parse(jsonStr);

  assert.strictEqual(parsed.format, SKILLS_FORMAT_IDENTIFIER);
  assert.strictEqual(parsed.version, '1.0');
  assert.ok(parsed.exportedAt);
  assert.strictEqual(parsed.skills.length, 1);
  assert.strictEqual(parsed.skills[0].name, 'Code Explainer');

  console.log('✅ Test 4: Skills JSON export envelope verified');
}

// Test 5: Import Validation & Security Gates
{
  // 5a: Valid import payload
  const validPayload = JSON.stringify({
    format: 'rahi-skills-v1',
    version: '1.0',
    skills: [
      {
        name: 'TLDR Generator',
        icon: '⚡',
        description: 'Generates a 3-bullet TLDR of current page.',
        target: 'summary',
        promptTemplate: 'Give a 3-bullet TLDR summary of: {{content}}',
      },
    ],
  });

  const resValid = validateImportedSkills(validPayload);
  assert.strictEqual(resValid.valid, true);
  assert.strictEqual(resValid.skills.length, 1);
  assert.strictEqual(resValid.skills[0].name, 'TLDR Generator');

  // 5b: Rejection of invalid format header
  const badFormat = JSON.stringify({ format: 'random-format', skills: [] });
  const resBadFormat = validateImportedSkills(badFormat);
  assert.strictEqual(resBadFormat.valid, false);
  assert.ok(resBadFormat.errors[0].includes('Invalid format header'));

  // 5c: File size limit rejection (>50 KB)
  const hugePayload = ' '.repeat(55 * 1024);
  const resHuge = validateImportedSkills(hugePayload);
  assert.strictEqual(resHuge.valid, false);
  assert.ok(resHuge.errors[0].includes('exceeds limit'));

  console.log('✅ Test 5: Import validation and security gates verified');
}

console.log('All skills hub unit tests passed successfully!');
