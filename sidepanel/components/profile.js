/**
 * Rahi - Local User Profile Memory & Semantic Field Matcher
 * Manages privacy-preserving personal profile storage in chrome.storage.local
 * and provides intelligent semantic field mapping for automated form-filling.
 */

export const DEFAULT_USER_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  college: '',
  degree: '',
  preferredTone: 'formal', // 'formal' | 'concise' | 'casual'
  skills: [],
  links: {
    github: '',
    linkedin: '',
    portfolio: '',
  },
};

/**
 * Normalizes and validates user profile data
 * @param {Object} raw
 * @returns {Object} Sanitized profile
 */
export function sanitizeProfile(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_USER_PROFILE };
  }

  const skills = Array.isArray(raw.skills)
    ? raw.skills.map((s) => String(s).trim()).filter(Boolean)
    : typeof raw.skills === 'string'
      ? raw.skills.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    fullName: String(raw.fullName || '').trim().substring(0, 100),
    email: String(raw.email || '').trim().substring(0, 120),
    phone: String(raw.phone || '').trim().substring(0, 30),
    college: String(raw.college || '').trim().substring(0, 150),
    degree: String(raw.degree || '').trim().substring(0, 150),
    preferredTone: ['formal', 'concise', 'casual'].includes(raw.preferredTone)
      ? raw.preferredTone
      : 'formal',
    skills,
    links: {
      github: String(raw.links?.github || raw.github || '').trim().substring(0, 200),
      linkedin: String(raw.links?.linkedin || raw.linkedin || '').trim().substring(0, 200),
      portfolio: String(raw.links?.portfolio || raw.portfolio || '').trim().substring(0, 200),
    },
  };
}

/**
 * Semantic Dictionary mapping common form field labels/placeholders to profile attributes.
 * Specific domains (email, phone, college, degree, links) are matched prior to general name.
 */
export const SEMANTIC_FIELD_PATTERNS = [
  {
    key: 'email',
    regex: /\b(e[-_]?mail|email\s*address|contact\s*email)\b/i,
    extract: (p) => p.email,
  },
  {
    key: 'phone',
    regex: /\b(phone|mobile|contact\s*no|contact\s*number|telephone|cell)\b/i,
    extract: (p) => p.phone,
  },
  {
    key: 'college',
    regex: /\b(college|university|institute|institution|alma\s*mater|school)\b/i,
    extract: (p) => p.college,
  },
  {
    key: 'degree',
    regex: /\b(degree|major|qualification|highest\s*education|field\s*of\s*study|branch)\b/i,
    extract: (p) => p.degree,
  },
  {
    key: 'github',
    regex: /\b(github|git\s*repo|code\s*sample|github\s*profile|github\s*url)\b/i,
    extract: (p) => p.links?.github || '',
  },
  {
    key: 'linkedin',
    regex: /\b(linkedin|linkedin\s*profile|linkedin\s*url)\b/i,
    extract: (p) => p.links?.linkedin || '',
  },
  {
    key: 'portfolio',
    regex: /\b(portfolio|personal\s*website|website|portfolio\s*url|personal\s*site)\b/i,
    extract: (p) => p.links?.portfolio || '',
  },
  {
    key: 'skills',
    regex: /\b(skills|technologies|tech\s*stack|key\s*skills|core\s*competencies)\b/i,
    extract: (p) => (p.skills || []).join(', '),
  },
  {
    key: 'fullName',
    regex: /\b(full\s*name|applicant\s*name|your\s*name|candidate\s*name|first\s*name|last\s*name|\bname\b)\b/i,
    excludeRegex: /\b(college|university|institute|school|company|org|organization|file|user)\s*name\b/i,
    extract: (p) => p.fullName,
  },
];

/**
 * Matches scanned page elements with user profile memory for automated form-filling
 * @param {Array<Object>} manifest Scanned elements manifest from scanner.js
 * @param {Object} profile Local user profile
 * @returns {Array<{ targetId: number, field: string, value: string, label: string }>} Mapped suggestions
 */
export function matchProfileToFields(manifest = [], profile = {}) {
  const sanitized = sanitizeProfile(profile);
  const mappings = [];
  const assignedKeys = new Set();

  for (const item of manifest) {
    // Only target fillable elements
    const isTextInput = item.type?.startsWith('input_') && !item.type.includes('password');
    const isTextArea = item.type === 'textarea';
    const isSelect = item.type === 'select';

    if (!isTextInput && !isTextArea && !isSelect) {
      continue;
    }

    const searchCorpus = [
      item.label || '',
      item.placeholder || '',
      item.id || '',
    ].join(' ').toLowerCase();

    // Check each semantic pattern
    for (const pattern of SEMANTIC_FIELD_PATTERNS) {
      if (pattern.regex.test(searchCorpus)) {
        if (pattern.excludeRegex && pattern.excludeRegex.test(searchCorpus)) {
          continue;
        }
        const value = pattern.extract(sanitized);
        if (value && !assignedKeys.has(`${pattern.key}_${item.id}`)) {
          mappings.push({
            targetId: item.id,
            field: pattern.key,
            value,
            label: item.label || item.placeholder || `#${item.id}`,
            elementType: item.type,
          });
          assignedKeys.add(`${pattern.key}_${item.id}`);
          break;
        }
      }
    }
  }

  return mappings;
}

/**
 * Formats user profile memory into context text for LLM injection
 * @param {Object} profile
 * @returns {string} Sanitized markdown block
 */
export function formatProfileForPrompt(profile) {
  const p = sanitizeProfile(profile);
  if (!p.fullName && !p.email && !p.college) {
    return 'No user profile memory saved.';
  }

  return [
    '=== USER PROFILE MEMORY (LOCAL) ===',
    `- Full Name: ${p.fullName || 'N/A'}`,
    `- Email: ${p.email || 'N/A'}`,
    `- Phone: ${p.phone || 'N/A'}`,
    `- College: ${p.college || 'N/A'}`,
    `- Degree/Major: ${p.degree || 'N/A'}`,
    `- Skills: ${(p.skills || []).join(', ') || 'N/A'}`,
    `- Preferred Tone: ${p.preferredTone}`,
    `- GitHub: ${p.links.github || 'N/A'}`,
    `- LinkedIn: ${p.links.linkedin || 'N/A'}`,
    `- Portfolio: ${p.links.portfolio || 'N/A'}`,
    '=== END PROFILE MEMORY ===',
  ].join('\n');
}

/**
 * Profile Controller for Side Panel UI
 */
export class ProfileController {
  constructor(options = {}) {
    this.elements = options.elements || {};
    this.onProfileSaved = options.onProfileSaved || (() => {});
    this.currentProfile = { ...DEFAULT_USER_PROFILE };

    this.init();
  }

  async init() {
    this.bindEvents();
    await this.load();
  }

  bindEvents() {
    if (this.elements.btnSaveProfile) {
      this.elements.btnSaveProfile.addEventListener('click', () => this.save());
    }
  }

  async load() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get('userProfile');
        if (data.userProfile) {
          this.currentProfile = sanitizeProfile(data.userProfile);
          this.populateForm();
        }
      }
    } catch (err) {
      console.warn('[Rahi Profile] Error loading profile:', err);
    }
  }

  populateForm() {
    const p = this.currentProfile;
    if (this.elements.profFullName) this.elements.profFullName.value = p.fullName;
    if (this.elements.profEmail) this.elements.profEmail.value = p.email;
    if (this.elements.profPhone) this.elements.profPhone.value = p.phone;
    if (this.elements.profCollege) this.elements.profCollege.value = p.college;
    if (this.elements.profDegree) this.elements.profDegree.value = p.degree;
    if (this.elements.profTone) this.elements.profTone.value = p.preferredTone;
    if (this.elements.profSkills) this.elements.profSkills.value = p.skills.join(', ');
    if (this.elements.profGithub) this.elements.profGithub.value = p.links.github;
    if (this.elements.profLinkedin) this.elements.profLinkedin.value = p.links.linkedin;
    if (this.elements.profPortfolio) this.elements.profPortfolio.value = p.links.portfolio;
  }

  async save() {
    const profile = sanitizeProfile({
      fullName: this.elements.profFullName?.value,
      email: this.elements.profEmail?.value,
      phone: this.elements.profPhone?.value,
      college: this.elements.profCollege?.value,
      degree: this.elements.profDegree?.value,
      preferredTone: this.elements.profTone?.value,
      skills: this.elements.profSkills?.value,
      github: this.elements.profGithub?.value,
      linkedin: this.elements.profLinkedin?.value,
      portfolio: this.elements.profPortfolio?.value,
    });

    this.currentProfile = profile;

    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ userProfile: profile });
      }
      this.onProfileSaved(profile);
      alert('Profile memory saved locally!');
      return profile;
    } catch (err) {
      console.error('[Rahi Profile] Save error:', err);
      alert(`Failed to save profile: ${err.message}`);
      return null;
    }
  }

  getProfile() {
    return this.currentProfile;
  }
}
