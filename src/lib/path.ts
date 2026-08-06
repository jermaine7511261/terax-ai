/**
 * Cross-platform path helpers. Every path that may originate from OSC 7, the
 * explorer, or the OS uses backslash-aware splitting (`.split(/[\\/]/)`) so
 * Windows drive paths and UNC paths behave like Unix ones. Per the repo
 * convention in YAMET.md, the canonical path form is forward slashes.
 */

/**
 * Return the final path segment, handling both `/` and `\` separators.
 * Mirrors the OS/explorer convention: a trailing separator yields the last
 * non-empty segment (e.g. `"a/b/"` → `"b"`), matching `path.basename`.
 */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

/**
 * Return the directory portion, handling both `/` and `\` separators.
 * No trailing slash. `"a/b"` → `"a"`; a bare name → `""` (no dir).
 */
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return "";
  return p.slice(0, i);
}
