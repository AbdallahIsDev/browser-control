const SENSITIVE_PARAMS = [
  "token",
  "apiKey",
  "apikey",
  "api_key",
  "key",
  "access_token",
  "authorization",
  "password",
  "secret",
];

/**
 * Redact sensitive query parameters from URLs.
 *
 * Used to prevent credential leaks in logs, errors, metadata, and persisted state.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const param of SENSITIVE_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "***REDACTED***");
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
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
    for (const param of SENSITIVE_PARAMS) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Sanitize arbitrary strings (e.g., error messages) by redacting sensitive
 * query parameter values that may have leaked into the text.
 */
export function sanitizeString(text: string): string {
  let result = text;
  for (const param of SENSITIVE_PARAMS) {
    // Match param=value or param="value" or param='value' in URLs or text
    const regex = new RegExp(`([?&;]${param}=)([^&\\s"']+)`, "gi");
    result = result.replace(regex, "$1***REDACTED***");
  }
  return result;
}
