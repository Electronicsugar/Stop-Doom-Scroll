/**
 * FocusGuard — Universal Website Blocker Engine
 * 
 * Centralized, UI-agnostic module for URL matching, normalization, and validation.
 * Uses a strategy pattern for extensibility and compiles rules for performance.
 */

// ── Validation ──────────────────────────────────────────────────────────────

export const RULE_TYPES = ['domain', 'path', 'exact', 'wildcard'];

/**
 * Validates a rule before it can be stored.
 * @param {Object} rule 
 * @returns {Object} { valid: boolean, error: string }
 */
export function validateRule(rule) {
  if (!rule || typeof rule !== 'object') {
    return { valid: false, error: 'Rule must be an object' };
  }
  if (!rule.id || typeof rule.id !== 'string') {
    return { valid: false, error: 'Rule must have a string id' };
  }
  if (!rule.pattern || typeof rule.pattern !== 'string') {
    return { valid: false, error: 'Rule must have a string pattern' };
  }
  if (!RULE_TYPES.includes(rule.type)) {
    return { valid: false, error: `Invalid rule type: ${rule.type}` };
  }
  return { valid: true, error: null };
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalizes a raw URL string into a predictable format.
 * - Parses via URL() to handle punycode/IDN automatically.
 * - Strips protocol and 'www.'
 * - Trims trailing slashes.
 * @param {string} urlString 
 * @returns {string|null} Normalized URL or null if invalid
 */
export function normalizeUrl(urlString) {
  try {
    let parsedUrl = urlString;
    // Add dummy protocol if missing to allow URL() to parse
    if (!/^https?:\/\//i.test(parsedUrl)) {
      parsedUrl = 'http://' + parsedUrl;
    }
    const u = new URL(parsedUrl);
    
    // hostname handles punycode automatically
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);

    let path = u.pathname;
    let search = u.search;
    let hash = u.hash;

    // Combine
    let normalized = host + path + search + hash;
    // Trim trailing slashes from the final string
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized;
  } catch (e) {
    return null;
  }
}

/**
 * Normalizes a rule pattern.
 * For exact, it normalizes fully.
 * For domain/path/wildcard, it trims protocol, www., and trailing slashes.
 */
export function normalizePattern(pattern, type) {
  let p = pattern.trim().toLowerCase();
  
  if (p.startsWith('http://')) p = p.slice(7);
  if (p.startsWith('https://')) p = p.slice(8);
  if (p.startsWith('www.')) p = p.slice(4);
  
  while (p.endsWith('/')) {
    p = p.slice(0, -1);
  }

  // Handle Punycode implicitly if it's a valid host-like string
  try {
    if (type === 'domain' || type === 'path' || type === 'exact') {
      const u = new URL('http://' + p);
      let host = u.hostname;
      if (host.startsWith('www.')) host = host.slice(4);
      p = host + u.pathname + u.search + u.hash;
      while (p.endsWith('/')) p = p.slice(0, -1);
    }
  } catch (e) {
    // Ignore URL parse errors for patterns, just use string fallback
  }

  return p;
}

// ── Compilation ─────────────────────────────────────────────────────────────

/**
 * Compiles a wildcard string (e.g., "*.youtube.com/*") into a RegExp string.
 */
function wildcardToRegex(pattern) {
  // Escape regex specials except '*'
  let escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // If the pattern starts with '*.', make the subdomain optional to match the root domain (which has 'www.' stripped)
  if (escaped.startsWith('*\\.')) {
    escaped = '(?:.*\\.)?' + escaped.slice(3);
  }
  // Replace remaining '*' with '.*'
  const regexStr = escaped.replace(/\*/g, '.*');
  return `^${regexStr}$`;
}

/**
 * Prepares a rule for fast matching.
 */
export function compileRule(rule) {
  const compiled = { ...rule };
  compiled.normalizedPattern = normalizePattern(rule.pattern, rule.type);
  
  if (rule.type === 'wildcard') {
    try {
      compiled.regex = new RegExp(wildcardToRegex(compiled.normalizedPattern));
    } catch (e) {
      compiled.regex = /.^/; // matches nothing if invalid
    }
  }
  return compiled;
}

// ── Matching Strategies ─────────────────────────────────────────────────────

const Strategies = {
  domain: (rule, normalizedUrl) => {
    // Exact domain match OR subdomain match
    // normalizedUrl: example.com/path
    // rule.normalizedPattern: example.com
    const pattern = rule.normalizedPattern;
    return normalizedUrl === pattern || 
           normalizedUrl.startsWith(pattern + '/') || 
           normalizedUrl.endsWith('.' + pattern) ||
           normalizedUrl.includes('.' + pattern + '/');
  },
  path: (rule, normalizedUrl) => {
    // e.g., example.com/shorts
    const pattern = rule.normalizedPattern;
    return normalizedUrl === pattern || normalizedUrl.startsWith(pattern + '/');
  },
  exact: (rule, normalizedUrl) => {
    return normalizedUrl === rule.normalizedPattern;
  },
  wildcard: (rule, normalizedUrl) => {
    if (!rule.regex) return false;
    return rule.regex.test(normalizedUrl);
  }
};

/**
 * Checks if a specific rule matches a normalized URL.
 */
function matches(rule, normalizedUrl) {
  const strategy = Strategies[rule.type];
  if (!strategy) return false;
  return strategy(rule, normalizedUrl);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluates a URL against an array of compiled rules.
 * @param {string} url - The raw URL to check
 * @param {Array} rules - Array of rules (should be pre-compiled and enabled)
 * @returns {Object|null} The matching rule object, or null if allowed.
 */
export function isBlocked(url, rules) {
  if (!url || !rules || rules.length === 0) return null;

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  // Find the first rule that matches
  for (const rule of rules) {
    if (rule.enabled !== false && matches(rule, normalizedUrl)) {
      return rule;
    }
  }

  return null;
}
