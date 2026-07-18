/**
 * FocusGuard — Password Policy Configuration and Validation (ES Module)
 *
 * This module is the single source of truth for password validation logic.
 * It is UI-agnostic and shared between the settings page (frontend) and background service worker.
 */

/**
 * Descriptive constants for password strength levels.
 */
export const PASSWORD_STRENGTH = {
  WEAK: 'weak',
  FAIR: 'fair',
  GOOD: 'good',
  STRONG: 'strong'
};

/**
 * The centralized password policy rules.
 * Adding or modifying a rule here automatically updates the UI checklist and backend validation.
 * @type {Array<{id: string, label: string, validator: (password: string) => boolean, required: boolean}>}
 */
export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    validator: (pw) => pw.length >= 8,
    required: true
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter (A–Z)',
    validator: (pw) => /[A-Z]/.test(pw),
    required: true
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter (a–z)',
    validator: (pw) => /[a-z]/.test(pw),
    required: true
  },
  {
    id: 'number',
    label: 'One number (0–9)',
    validator: (pw) => /[0-9]/.test(pw),
    required: true
  },
  {
    id: 'special',
    label: 'One special character (!@#$%^&*)',
    validator: (pw) => /[!@#$%^&*()_+{}\[\]:;"'<>,.?/~`|\\-]/.test(pw),
    required: true
  }
];

/**
 * Validates a password against the centralized policy.
 * @param {string} password - The password to evaluate.
 * @returns {{ isValid: boolean, ruleStatus: Array<{id: string, label: string, passed: boolean, required: boolean}> }}
 *          An object containing the overall validity and the status of each rule.
 */
export function validatePassword(password) {
  const pw = password || '';
  let isValid = true;
  const ruleStatus = PASSWORD_RULES.map(rule => {
    const passed = rule.validator(pw);
    if (rule.required && !passed) {
      isValid = false;
    }
    return {
      id: rule.id,
      label: rule.label,
      passed,
      required: rule.required
    };
  });

  return { isValid, ruleStatus };
}

/**
 * Estimates the strength of a password independent of the strict validation policy.
 * A password may pass all required rules but still only be "good".
 * @param {string} password - The password to evaluate.
 * @returns {string} One of the PASSWORD_STRENGTH constants ("weak", "fair", "good", "strong").
 */
export function calculatePasswordStrength(password) {
  const pw = password || '';
  if (pw.length === 0) return PASSWORD_STRENGTH.WEAK;

  let score = 0;

  // Complexity points
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[!@#$%^&*()_+{}\[\]:;"'<>,.?/~`|\\-]/.test(pw)) score++;

  // Length points
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;

  if (score < 3 || pw.length < 8) return PASSWORD_STRENGTH.WEAK;
  if (score === 3 || (score === 4 && pw.length < 10)) return PASSWORD_STRENGTH.FAIR;
  if (score >= 4 && pw.length >= 10 && pw.length < 12) return PASSWORD_STRENGTH.GOOD;
  if (score >= 5 && pw.length >= 12) return PASSWORD_STRENGTH.STRONG;

  return PASSWORD_STRENGTH.GOOD; // fallback
}
