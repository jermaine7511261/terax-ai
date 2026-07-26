/**
 * Glob-style pattern matching for permission rules.
 * Ported from OpenCode's `util/wildcard.ts` — lightweight, no deps.
 *
 * Supports:
 *  - `*` matches any sequence of non-slash characters
 *  - `?` matches any single non-slash character
 *  - `**` matches any sequence including slashes
 *  - Case-insensitive on Windows (normalized to forward-slash)
 */

function normalize(input: string): string {
  return input.replaceAll("\\", "/");
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a glob pattern to a RegExp.
 * Internal helper, exported for testing.
 */
export function patternToRegex(pattern: string): RegExp {
  let escaped = normalize(pattern);
  // Escape special regex chars except for * and ?
  escaped = escapeRegex(escaped);
  // `**` → match everything including slashes
  // We replace `**` with a placeholder first to avoid conflict with `*`
  // `**` must be handled: it means "anything" including path separators
  // But in our permission system, we mostly use `*` for simple matching
  // Let's handle `**` explicitly
  escaped = escaped.replace(/\*\*/g, "___DOUBLESTAR___");
  // `*` → match any non-slash characters
  escaped = escaped.replace(/\*/g, "[^/]*");
  // `?` → match any single non-slash character
  escaped = escaped.replace(/\?/g, "[^/]");
  // Restore `**`
  escaped = escaped.replace(/___DOUBLESTAR___/g, ".*");

  // If pattern ends with ` /*`, also allow end-of-string (bare directory)
  // This makes `path/*` match both `path` and `path/anything`
  if (escaped.endsWith("/[^/]*")) {
    // Also match the parent dir itself
    return new RegExp(`^${escaped.slice(0, -6)}(/[^/]*)?$`, "i");
  }

  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Match an input string against a glob pattern.
 *
 * @param input - The string to test (file path, action name, etc.)
 * @param pattern - A glob pattern (`*`, `?`, `**` supported)
 * @returns true if the input matches the pattern
 *
 * @example
 * ```ts
 * match(".env.local", ".env*")       // true
 * match("src/main.ts", "src/*.ts")   // true
 * match("git push", "git *")         // true
 * match("config.json", "*.json")     // true
 * ```
 */
export function match(input: string, pattern: string): boolean {
  return patternToRegex(pattern).test(normalize(input));
}
