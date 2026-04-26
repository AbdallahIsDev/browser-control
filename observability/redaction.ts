/**
 * Redaction Helpers — Security-sensitive data filtering for observability.
 *
 * Redacts secrets from console entries, network entries, URLs, and generic strings.
 * Used by console_capture, network_capture, and debug_bundle to prevent
 * leaking credentials into stored evidence.
 */

// ── Secret Patterns ────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  // API keys and tokens
  /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /api[_-]?token\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /auth[_-]?token\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /bearer\s+[a-zA-Z0-9._~+/-]+=*/gi,
  /access[_-]?token\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /refresh[_-]?token\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  // Browserless
  /browserless[_-]?token\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  // Deterministic Browser Control test tokens used in E2E proofs
  /bc_secret_test_token_[a-zA-Z0-9_-]+/gi,
  // OpenRouter
  /openrouter[_-]?api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  // CAPTCHA
  /captcha[_-]?api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  // Generic secrets
  /secret\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi,
  /[a-zA-Z0-9_-]*cookie[a-zA-Z0-9_-]*\s*[:=]\s*["']?[^"'\s;]{4,}["']?/gi,
  /password\s*[:=]\s*["']?[^"'\s]{4,}["']?/gi,
  /passwd\s*[:=]\s*["']?[^"'\s]{4,}["']?/gi,
];

const REDACTION_TOKEN = "[REDACTED]";
const URL_PATTERN = /\b(?:https?|wss?|ws):\/\/[^\s"'<>]+/gi;
const AUTHORIZATION_HEADER_PATTERN = /(\bauthorization\s*:\s*)(?:bearer|basic)\s+[^\s"'\r\n]+/gi;
const COOKIE_HEADER_PATTERN = /(\b(?:set-)?cookie\s*:\s*)[^\r\n"']+/gi;

// ── URL Redaction ──────────────────────────────────────────────────────

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "api_key",
  "apikey",
  "api_token",
  "auth_token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "passwd",
  "key",
  "bearer",
  "browserless_token",
  "openrouter_api_key",
  "captcha_api_key",
]);

/**
 * Redact sensitive query parameters from a URL.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = REDACTION_TOKEN;
    if (parsed.password) parsed.password = REDACTION_TOKEN;
    for (const param of parsed.searchParams.keys()) {
      const lower = param.toLowerCase();
      if (SENSITIVE_QUERY_PARAMS.has(lower) || lower.endsWith("_token") || lower.endsWith("_key") || lower.endsWith("_secret")) {
        parsed.searchParams.set(param, REDACTION_TOKEN);
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(
      /([?&](?:token|api[_-]?key|apikey|key|secret|password|auth|access_token|refresh_token)=)([^&\s"'<>]+)/gi,
      `$1${REDACTION_TOKEN}`,
    );
  }
}

// ── String Redaction ───────────────────────────────────────────────────

/**
 * Redact known secret patterns from an arbitrary string.
 */
export function redactString(input: string): string {
  let result = input.replace(URL_PATTERN, (match) => redactUrl(match));
  result = result.replace(AUTHORIZATION_HEADER_PATTERN, `$1${REDACTION_TOKEN}`);
  result = result.replace(COOKIE_HEADER_PATTERN, `$1${REDACTION_TOKEN}`);
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Keep the key name, redact the value
      const colonIndex = match.indexOf(":");
      const eqIndex = match.indexOf("=");
      const sepIndex = colonIndex !== -1 && eqIndex !== -1
        ? Math.min(colonIndex, eqIndex)
        : Math.max(colonIndex, eqIndex);
      if (sepIndex > 0) {
        return `${match.slice(0, sepIndex + 1)} ${REDACTION_TOKEN}`;
      }
      // For patterns like "Bearer token", redact the whole thing
      return REDACTION_TOKEN;
    });
  }
  result = result.replace(
    /(\b(?:token|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|browserless[_-]?token|secret|password|passwd|bearer)\s*=\s*)[^&\s"'<>]+/gi,
    `$1${REDACTION_TOKEN}`,
  );
  result = result.replace(
    /(\b[a-zA-Z0-9_-]*cookie[a-zA-Z0-9_-]*\s*=\s*)[^&\s"'<>;]+/gi,
    `$1${REDACTION_TOKEN}`,
  );
  return result;
}

// ── Header Redaction ───────────────────────────────────────────────────

/**
 * Redact sensitive HTTP headers.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "x-api-key" ||
      lower.endsWith("-token") ||
      lower.endsWith("-secret") ||
      lower.endsWith("-key")
    ) {
      redacted[key] = REDACTION_TOKEN;
    } else {
      redacted[key] = redactString(value);
    }
  }
  return redacted;
}

// ── Console Entry Redaction ────────────────────────────────────────────

import type { ConsoleEntry } from "./types";

/**
 * Redact secrets from a console entry.
 */
export function redactConsoleEntry(entry: ConsoleEntry): ConsoleEntry {
  return {
    ...entry,
    message: redactString(entry.message),
    ...(entry.source ? { source: redactString(entry.source) } : {}),
    ...(entry.pageUrl ? { pageUrl: redactUrl(entry.pageUrl) } : {}),
  };
}

// ── Network Entry Redaction ────────────────────────────────────────────

import type { NetworkEntry } from "./types";

/**
 * Redact secrets from a network entry.
 */
export function redactNetworkEntry(entry: NetworkEntry): NetworkEntry {
  return {
    ...entry,
    url: redactUrl(entry.url),
    ...(entry.error ? { error: redactString(entry.error) } : {}),
    ...(entry.pageUrl ? { pageUrl: redactUrl(entry.pageUrl) } : {}),
    redacted: true,
  };
}

// ── Object Redaction (deep) ────────────────────────────────────────────

/**
 * Recursively redact secrets from a plain object.
 * Useful for debug bundle params and metadata.
 */
export function redactObject(obj: unknown, depth = 0): unknown {
  if (depth > 10) return "[MAX_DEPTH]";

  if (typeof obj === "string") {
    return redactString(obj);
  }

  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  if (obj instanceof URL) {
    return redactUrl(obj.toString());
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, depth + 1));
  }

  const prototype = Object.getPrototypeOf(obj);
  if (prototype !== Object.prototype && prototype !== null) {
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const normalizedKey = lowerKey.replace(/[^a-z0-9]/gu, "");
    if (
      lowerKey === "password" ||
      lowerKey === "secret" ||
      lowerKey === "token" ||
      lowerKey === "apikey" ||
      lowerKey === "api_key" ||
      lowerKey === "auth_token" ||
      lowerKey === "cookie" ||
      lowerKey === "authorization" ||
      lowerKey.endsWith("_token") ||
      lowerKey.endsWith("-token") ||
      lowerKey.endsWith("_key") ||
      lowerKey.endsWith("-key") ||
      lowerKey.endsWith("_secret") ||
      lowerKey.endsWith("-secret") ||
      normalizedKey.includes("apikey") ||
      normalizedKey.includes("authkey") ||
      normalizedKey.includes("privatekey") ||
      normalizedKey.includes("passphrase") ||
      normalizedKey.endsWith("token") ||
      normalizedKey.endsWith("secret") ||
      normalizedKey.endsWith("password") ||
      normalizedKey.endsWith("cookie") ||
      normalizedKey.endsWith("credential")
    ) {
      result[key] = REDACTION_TOKEN;
    } else {
      result[key] = redactObject(value, depth + 1);
    }
  }
  return result;
}
