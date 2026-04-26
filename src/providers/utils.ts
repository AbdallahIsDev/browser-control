import { redactString as redactStringCentral, redactUrl as redactUrlCentral } from "../observability/redaction";

const SENSITIVE_PARAMS = new Set([
  "token",
  "apiKey",
  "apikey",
  "api_key",
  "api_token",
  "auth_token",
  "key",
  "access_token",
  "refresh_token",
  "authorization",
  "password",
  "passwd",
  "secret",
  "bearer",
  "browserless_token",
  "openrouter_api_key",
  "captcha_api_key",
]);

function isSensitiveParam(param: string): boolean {
  const lower = param.toLowerCase();
  return SENSITIVE_PARAMS.has(lower)
    || lower.endsWith("_token")
    || lower.endsWith("-token")
    || lower.endsWith("_key")
    || lower.endsWith("-key")
    || lower.endsWith("_secret")
    || lower.endsWith("-secret");
}

/**
 * Redact sensitive query parameters from URLs.
 *
 * Used to prevent credential leaks in logs, errors, metadata, and persisted state.
 */
export function redactUrl(url: string): string {
  return redactUrlCentral(url);
}

/**
 * Strip sensitive query parameters entirely from a URL string.
 *
 * Use this when you need a clean endpoint for display or metadata
 * while the full tokenized URL is kept only transiently for connect().
 */
export function stripSensitiveParams(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const param of [...parsed.searchParams.keys()]) {
      if (isSensitiveParam(param)) {
        parsed.searchParams.delete(param);
      }
    }
    return parsed.toString();
  } catch {
    return redactUrlCentral(url);
  }
}

/**
 * Sanitize arbitrary strings (e.g., error messages) by redacting sensitive
 * query parameter values that may have leaked into the text.
 */
export function sanitizeString(text: string): string {
  return redactStringCentral(text);
}
