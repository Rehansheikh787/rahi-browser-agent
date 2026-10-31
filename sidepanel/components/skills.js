/**
 * Rahi - One-Click Skills Hub (`rahi-skills-v1`)
 * Manages built-in prompt recipes, custom skill creation,
 * secure JSON import/export, and routing to Chat, Summary, or Agent loops.
 */

import { matchProfileToFields } from './profile.js';

export const SKILLS_FORMAT_IDENTIFIER = 'rahi-skills-v1';
export const MAX_IMPORT_SIZE_BYTES = 50 * 1024; // 50 KB safety limit

/**
 * Standard built-in skills available out-of-the-box
 */
export const BUILTIN_SKILLS = [
  {
    id: 'builtin_exam_notes',
    name: 'Exam High-Yield Notes',
    icon: '🎓',
    description: 'Distills page into high-yield exam takeaways, key formulas, definitions, and likely questions.',
    target: 'summary',
    isBuiltin: true,
    promptTemplate: `You are an expert academic tutor. Analyze the following webpage content and generate high-yield study & exam revision notes.

Structure your response into:
1. 📌 Core Executive Summary (3-4 bullet points)
2. 🔑 Essential Definitions & Formulas (glossary format)
3. 🎯 High-Yield Exam Takeaways (concepts most likely to appear on a test)
4. ❓ 3 Practice Exam Questions with concise model answers

Webpage Content:
{{content}}`,
  },
  {
    id: 'builtin_hinglish_explain',
    name: 'Explain in Hinglish',
    icon: '🇮🇳',
    description: 'Explains page content in simple, fluent everyday Hinglish with relatable analogies.',
    target: 'chat',
    isBuiltin: true,
    promptTemplate: `Is page ke content ko simple, friendly aur natural conversational Hinglish (Indian English mixed with everyday Roman Hindi) mein explain kariye. Real-world relatable analogies use kariye taaki concept ekdum crystal clear ho jaye. Technical terms ko English mein hi rakhiye.`,
  },
  {
    id: 'builtin_polite_reply',
    name: 'Draft Polite Reply',
    icon: '✉️',
    description: 'Drafts a thoughtful, polite response to selected text or email context tailored to your tone.',
    target: 'chat',
    isBuiltin: true,
    promptTemplate: `Please draft a polite, well-structured, and courteous response to the following context/message from this page:

"{{selection}}"

Tone requirement: {{tone}} (polite and professional). Include a warm opening, addressing the key question/point constructively, and a respectful closing.`,
  },
  {
    id: 'builtin_autofill_form',
    name: 'Auto-Fill Form from Profile',
    icon: '📝',
    description: 'Inspects visible form fields and automatically maps them to your local profile memory.',
    target: 'agent',
    isBuiltin: true,
    isFormAutofill: true,
    promptTemplate: `Auto-fill the detected application/registration form fields using local profile data.`,
  },
  {
    id: 'builtin_action_points',
    name: 'Action Points & Deadlines',
    icon: '🎯',
    description: 'Extracts immediate action points, prerequisites, deadlines, and next steps into a checklist.',
    target: 'summary',
    isBuiltin: true,
    promptTemplate: `Extract all actionable tasks, prerequisites, submission requirements, and key dates/deadlines mentioned on this page into a structured, prioritized checklist.

Format:
- ⏳ Important Dates & Deadlines
- 📋 Prerequisites & Requirements
- 🚀 Immediate Action Items (Step-by-step checklist)`,
  },
];

/**
 * Sanitizes text to prevent XSS, HTML, or script injection
 * @param {string} str
 * @returns {string}
 */
export function sanitizeSkillText(str = '') {
  if (!str) return '';
  return String(str)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:[^\s"'>]*/gi, '')
    .replace(/eval\s*\([^)]*\)/gi, '')
    .replace(/onload\s*=\s*['"][^'"]*['"]/gi, '')
    .replace(/onerror\s*=\s*['"][^'"]*['"]/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validates a single skill object
 * @param {Object} skill
 * @returns {{ valid: boolean, errors: Array<string>, sanitized: Object|null }}
 */
export function validateSkill(skill) {
  const errors = [];
  if (!skill || typeof skill !== 'object') {
    return { valid: false, errors: ['Skill must be a non-null object'], sanitized: null };
  }

  const name = sanitizeSkillText(skill.name).substring(0, 60);
  if (!name) {
    errors.push('Skill name is required (max 60 characters)');
  }

  const description = sanitizeSkillText(skill.description).substring(0, 150);
  if (!description) {
    errors.push('Skill description is required (max 150 characters)');
  }

  const target = ['summary', 'chat', 'agent'].includes(skill.target)
    ? skill.target
    : 'chat';

  const promptTemplate = sanitizeSkillText(skill.promptTemplate);
  if (!promptTemplate && !skill.isFormAutofill) {
    errors.push('Prompt template cannot be empty');
  }

  const icon = String(skill.icon || '⚡').trim().substring(0, 5);

  const sanitized = {
    id: skill.id || `custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    icon,
    description,
    target,
    promptTemplate,
    isBuiltin: !!skill.isBuiltin,
    isFormAutofill: !!skill.isFormAutofill,
  };

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : null,
  };
}

/**
 * Validates and parses imported JSON skills envelope
 * @param {string} rawJsonString
 * @returns {{ valid: boolean, skills: Array<Object>, errors: Array<string> }}
 */
export function validateImportedSkills(rawJsonString) {
  const errors = [];
  if (!rawJsonString || typeof rawJsonString !== 'string') {
    return { valid: false, skills: [], errors: ['Empty file content'] };
  }

  if (rawJsonString.length > MAX_IMPORT_SIZE_BYTES) {
    return {
      valid: false,
      skills: [],
      errors: [`File size exceeds limit (${Math.round(rawJsonString.length / 1024)} KB > 50 KB)`],
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch (err) {
    return { valid: false, skills: [], errors: [`Invalid JSON: ${err.message}`] };
  }

  if (parsed.format !== SKILLS_FORMAT_IDENTIFIER) {
    return {
      valid: false,
      skills: [],
      errors: [`Invalid format header. Expected format: "${SKILLS_FORMAT_IDENTIFIER}"`],
    };
  }

  const rawSkills = Array.isArray(parsed.skills) ? parsed.skills : [];
  if (rawSkills.length === 0) {
    return { valid: false, skills: [], errors: ['No skills found in import file'] };
  }

  const validSkills = [];
  rawSkills.forEach((s, idx) => {
    const res = validateSkill(s);
    if (res.valid) {
      validSkills.push(res.sanitized);
    } else {
      errors.push(`Skill #${idx + 1} ("${s.name || 'unnamed'}"): ${res.errors.join(', ')}`);
    }
  });

  return {
    valid: validSkills.length > 0,
    skills: validSkills,
    errors,
  };
}

/**
 * Builds exportable JSON envelope
 * @param {Array<Object>} skills
 * @returns {string} JSON string
 */
export function exportSkillsToJSON(skills = []) {
  const envelope = {
    format: SKILLS_FORMAT_IDENTIFIER,
    version: '1.0',
    exportedAt: new Date().toISOString(),
    skills: skills.map((s) => ({
      name: s.name,
      icon: s.icon,
      description: s.description,
      target: s.target,
      promptTemplate: s.promptTemplate,
      isFormAutofill: !!s.isFormAutofill,
    })),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Skills Controller for Side Panel UI
 */
export class SkillsController {
  constructor(options = {}) {
    this.elements = options.elements || {};
    this.getProfile = options.getProfile || (() => ({}));
    this.getActiveTab = options.getActiveTab || (() => null);
    this.onSwitchTab = options.onSwitchTab || (() => {});
    this.onExecuteInChat = options.onExecuteInChat || (() => {});
    this.onExecuteInSummary = options.onExecuteInSummary || (() => {});
    this.onExecuteInAgent = options.onExecuteInAgent || (() => {});

    this.skills = [...BUILTIN_SKILLS];
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadCustomSkills();
    this.renderSkillsGrid();
  }

  bindEvents() {
    // Export button
    if (this.elements.btnExportSkills) {
      this.elements.btnExportSkills.addEventListener('click', () => this.handleExport());
    }

    // Import button & file input
    if (this.elements.btnImportSkills && this.elements.skillsFileInput) {
      this.elements.btnImportSkills.addEventListener('click', () => {
        this.elements.skillsFileInput.click();
      });

      this.elements.skillsFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          this.handleImportFile(file);
          e.target.value = ''; // Reset input
        }
      });
    }

    // Create New Skill button
    if (this.elements.btnOpenCreateSkill) {
      this.elements.btnOpenCreateSkill.addEventListener('click', () => {
        this.showCreateModal();
      });
    }
  }

  async loadCustomSkills() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get('customSkills');
        if (Array.isArray(data.customSkills)) {
          const validCustom = data.customSkills
            .map((s) => validateSkill(s))
            .filter((res) => res.valid)
            .map((res) => res.sanitized);

          this.skills = [...BUILTIN_SKILLS, ...validCustom];
        }
      }
    } catch (err) {
      console.warn('[Rahi Skills] Failed to load custom skills:', err);
    }
  }

  async saveCustomSkills() {
    const customOnly = this.skills.filter((s) => !s.isBuiltin);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ customSkills: customOnly });
      }
    } catch (err) {
      console.error('[Rahi Skills] Failed to save custom skills:', err);
    }
  }

  renderSkillsGrid() {
    if (!this.elements.skillsList) return;

    this.elements.skillsList.innerHTML = '';

    this.skills.forEach((skill) => {
      const card = document.createElement('div');
      card.className = 'skill-card';
      card.setAttribute('data-id', skill.id);

      card.innerHTML = `
        <div class="skill-card-top">
          <span class="skill-icon">${skill.icon || '⚡'}</span>
          <span class="skill-target-badge target-${skill.target}">${skill.target.toUpperCase()}</span>
          ${!skill.isBuiltin ? `<button class="btn-delete-skill" title="Delete Skill" data-id="${skill.id}">✕</button>` : ''}
        </div>
        <h4 class="skill-title">${skill.name}</h4>
        <p class="skill-desc">${skill.description}</p>
        <button class="btn-run-skill" data-id="${skill.id}">
          <span>Run Skill ▶</span>
        </button>
      `;

      // Run button event
      const runBtn = card.querySelector('.btn-run-skill');
      runBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.runSkill(skill);
      });

      // Delete button event (custom skills only)
      const delBtn = card.querySelector('.btn-delete-skill');
      delBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCustomSkill(skill.id);
      });

      this.elements.skillsList.appendChild(card);
    });
  }

  async runSkill(skill) {
    if (!skill) return;

    const profile = this.getProfile();
    const tab = this.getActiveTab();

    // 1. Auto-fill form skill
    if (skill.isFormAutofill) {
      this.onSwitchTab('agent');
      this.onExecuteInAgent({
        goal: 'Fill the visible application form on this page using my local user profile',
        isFormFill: true,
      });
      return;
    }

    // 2. Summary Target
    if (skill.target === 'summary') {
      this.onSwitchTab('summary');
      this.onExecuteInSummary({
        skillId: skill.id,
        skillName: skill.name,
        promptTemplate: skill.promptTemplate,
      });
      return;
    }

    // 3. Chat Target
    if (skill.target === 'chat') {
      this.onSwitchTab('chat');
      let prompt = skill.promptTemplate;

      // Replace variables
      prompt = prompt.replace(/\{\{tone\}\}/g, profile.preferredTone || 'polite');

      this.onExecuteInChat({
        prompt,
        skillName: skill.name,
      });
      return;
    }

    // 4. Agent Target
    if (skill.target === 'agent') {
      this.onSwitchTab('agent');
      this.onExecuteInAgent({
        goal: skill.promptTemplate || skill.description,
      });
    }
  }

  async addCustomSkill(newSkillData) {
    const res = validateSkill(newSkillData);
    if (!res.valid) {
      alert(`Invalid skill: ${res.errors.join(', ')}`);
      return false;
    }

    this.skills.push(res.sanitized);
    await this.saveCustomSkills();
    this.renderSkillsGrid();
    return true;
  }

  async deleteCustomSkill(id) {
    if (!confirm('Are you sure you want to delete this custom skill?')) return;

    this.skills = this.skills.filter((s) => s.id !== id);
    await this.saveCustomSkills();
    this.renderSkillsGrid();
  }

  handleExport() {
    const jsonStr = exportSkillsToJSON(this.skills.filter((s) => !s.isBuiltin));
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `rahi-skills-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async handleImportFile(file) {
    try {
      const text = await file.text();
      const result = validateImportedSkills(text);

      if (!result.valid) {
        alert(`Failed to import skills:\n${result.errors.join('\n')}`);
        return;
      }

      let addedCount = 0;
      result.skills.forEach((imported) => {
        // Avoid duplicate names
        const exists = this.skills.some((s) => s.name.toLowerCase() === imported.name.toLowerCase());
        if (!exists) {
          this.skills.push(imported);
          addedCount++;
        }
      });

      await this.saveCustomSkills();
      this.renderSkillsGrid();

      alert(`Successfully imported ${addedCount} skills!`);
    } catch (err) {
      alert(`Error reading import file: ${err.message}`);
    }
  }

  showCreateModal() {
    const name = prompt('Skill Name (e.g., Code Reviewer, Fact Checker):');
    if (!name || !name.trim()) return;

    const description = prompt('Short Description of what this skill does:');
    if (!description || !description.trim()) return;

    const target = prompt('Execution Target: enter "chat" or "summary" or "agent":', 'chat')?.toLowerCase();
    if (!['chat', 'summary', 'agent'].includes(target)) {
      alert('Target must be "chat", "summary", or "agent".');
      return;
    }

    const promptTemplate = prompt('Prompt Template instructions for the model:');
    if (!promptTemplate || !promptTemplate.trim()) return;

    this.addCustomSkill({
      name,
      icon: '✨',
      description,
      target,
      promptTemplate,
    });
  }
}
