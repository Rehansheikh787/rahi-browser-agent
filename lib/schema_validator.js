/**
 * Rahi - Action Decision Schema Validator
 * Enforces strict deterministic schema checks for model-generated browser actions.
 * Detects consequential/destructive operations (payments, deletions, purchases)
 * to enforce user approval gates.
 */

export const VALID_ACTION_TYPES = [
  'click',
  'type',
  'select',
  'scroll',
  'finish',
  'ask_user',
];

export const VALID_STATUSES = [
  'continue',
  'done',
  'need_clarification',
  'blocked',
];

// Consequential action keywords that require explicit user warning
export const CONSEQUENTIAL_KEYWORDS = [
  'delete',
  'remove',
  'pay',
  'payment',
  'purchase',
  'buy',
  'checkout',
  'order',
  'transfer',
  'unsubscribe',
  'drop',
  'terminate',
  'wipe',
  'erase',
  'authorize',
];

/**
 * Extracts and parses JSON from raw LLM output (handles ```json fences or conversational text)
 * @param {string} rawText
 * @returns {Object} Parsed JSON object
 */
export function extractActionJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Action response is empty or not a string');
  }

  const cleaned = rawText.trim();

  // 1. Try markdown code block match
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch (_) {}
  }

  // 2. Direct JSON parse
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // 3. Fallback: match outermost { ... }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonSubstring = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSubstring);
    } catch (err) {
      throw new Error(`Failed to parse extracted JSON substring: ${err.message}`);
    }
  }

  throw new Error('No valid JSON action object found in model output');
}

/**
 * Evaluates whether an action is consequential (financial, destructive, irreversible)
 * @param {Object} action The action object
 * @param {string} [thought=''] The model reasoning string
 * @param {string} [targetLabel=''] Label of the element being interacted with
 * @returns {boolean}
 */
export function detectConsequentialAction(action, thought = '', targetLabel = '') {
  if (!action) return false;

  const combinedText = [
    action.type || '',
    action.value || '',
    thought || '',
    targetLabel || '',
  ].join(' ').toLowerCase();

  return CONSEQUENTIAL_KEYWORDS.some((kw) => {
    // Regex for word boundary to avoid matching words like 'player' for 'pay'
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(combinedText);
  });
}

/**
 * Validates the raw action decision against Rahi's schema
 * @param {Object} decision
 * @param {Array<Object>} [manifest=[]] Scanned elements manifest for targetId validation
 * @returns {{ valid: boolean, errors: Array<string>, sanitized: Object }}
 */
export function validateActionDecision(decision, manifest = []) {
  const errors = [];

  if (!decision || typeof decision !== 'object') {
    return { valid: false, errors: ['Action decision must be a non-null object'], sanitized: null };
  }

  // Validate thought
  const thought = typeof decision.thought === 'string' ? decision.thought.trim() : '';
  if (!thought) {
    errors.push('Action decision must include a non-empty "thought" explanation');
  }

  // Validate action object
  const action = decision.action;
  if (!action || typeof action !== 'object') {
    errors.push('Action decision must contain an "action" object');
    return { valid: false, errors, sanitized: null };
  }

  const actionType = action.type;
  if (!VALID_ACTION_TYPES.includes(actionType)) {
    errors.push(`Invalid action.type "${actionType}". Allowed types: ${VALID_ACTION_TYPES.join(', ')}`);
  }

  // Validate specific action types
  let targetLabel = '';
  if (actionType === 'click' || actionType === 'type' || actionType === 'select') {
    const targetId = Number(action.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      errors.push(`Action "${actionType}" requires a positive integer targetId, received "${action.targetId}"`);
    } else if (manifest.length > 0) {
      const found = manifest.find((m) => Number(m.id) === targetId);
      if (!found) {
        errors.push(`targetId ${targetId} does not exist in currently scanned elements (range: 1-${manifest.length})`);
      } else {
        targetLabel = found.label || '';
      }
    }

    if ((actionType === 'type' || actionType === 'select') && typeof action.value !== 'string') {
      errors.push(`Action "${actionType}" requires a string "value" property`);
    }
  } else if (actionType === 'scroll') {
    const direction = action.direction;
    if (direction !== 'up' && direction !== 'down') {
      errors.push('Action "scroll" requires direction to be "up" or "down"');
    }
  } else if (actionType === 'finish') {
    if (typeof action.message !== 'string' || !action.message.trim()) {
      errors.push('Action "finish" requires a non-empty "message" string');
    }
  } else if (actionType === 'ask_user') {
    if (typeof action.question !== 'string' || !action.question.trim()) {
      errors.push('Action "ask_user" requires a non-empty "question" string');
    }
  }

  // Validate or set default status
  let status = decision.status;
  if (!status || !VALID_STATUSES.includes(status)) {
    if (actionType === 'finish') {
      status = 'done';
    } else if (actionType === 'ask_user') {
      status = 'need_clarification';
    } else {
      status = 'continue';
    }
  }

  const isConsequential = detectConsequentialAction(action, thought, targetLabel);

  const sanitized = {
    thought,
    action: {
      type: actionType,
      targetId: action.targetId !== undefined ? Number(action.targetId) : undefined,
      value: action.value !== undefined ? String(action.value) : undefined,
      direction: action.direction || undefined,
      amount: action.amount !== undefined ? Number(action.amount) : (actionType === 'scroll' ? 300 : undefined),
      message: action.message || undefined,
      question: action.question || undefined,
    },
    status,
    isConsequential,
    targetLabel,
  };

  return {
    valid: errors.length === 0,
    errors,
    sanitized: errors.length === 0 ? sanitized : null,
  };
}
