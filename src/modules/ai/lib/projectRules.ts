/**
 * S5 rules glob activation: discover project rule files (AGENTS.md / CLAUDE.md /
 * YaMet.md) and match rule scopes to file paths. Pure, no I/O, unit-tested.
 *
 * Convention: standard rule files at the workspace root are always active.
 * `.yamet/rules/` rule files may carry a `scope:` glob in frontmatter; a rule
 * with no scope matches everything.
 */

export const STANDARD_RULE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "YaMet.md",
] as const;

/** A rule file + its activation glob (absent = active everywhere). */
export type ProjectRule = {
  /** Absolute-ish path the caller resolves; stored as workspace-relative. */
  relPath: string;
  /** Glob scope (double-star globs). Empty = active for all paths. */
  scope: string;
};

/**
 * Which standard rule files exist for a workspace (pure discovery — the caller
 * checks existence and passes the present set).
 */
export function standardRules(present: readonly string[]): ProjectRule[] {
  return STANDARD_RULE_FILES.filter((f) => present.includes(f)).map((f) => ({
    relPath: f,
    scope: "",
  }));
}

/**
 * Parse a rule file's frontmatter `scope:` glob. Returns "" when absent.
 * Frontmatter is a `---` delimited block at the top.
 */
export function parseRuleScope(content: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return "";
  const scope = /^scope:\s*(.+)$/m.exec(m[1]);
  return scope?.[1]?.trim() ?? "";
}

/**
 * Glob to regex, supporting double-star (any depth), star (within a segment),
 * and question mark. A trailing slash is treated as "any depth". Testable.
 */
export function globToRegex(glob: string): RegExp {
  let g = glob.trim();
  if (g.endsWith("/")) g = `${g}**`;
  const src = g
    .split("/")
    .map((seg) =>
      seg
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, ".*"),
    )
    .join("/");
  return new RegExp(`^${src}$`);
}

/**
 * Whether a relative path is activated by a rule's scope glob.
 * Empty scope = always active.
 */
export function ruleActivates(rule: ProjectRule, relPath: string): boolean {
  if (!rule.scope) return true;
  return globToRegex(rule.scope).test(relPath);
}

/** Sort rules so more specific scopes come first (most-specific wins). */
export function orderRules(rules: ProjectRule[]): ProjectRule[] {
  return [...rules].sort(
    (a, b) => scoreScope(b.scope) - scoreScope(a.scope),
  );
}

function scoreScope(scope: string): number {
  if (!scope) return 0; // unscoped least specific
  const stars = (scope.match(/\*/g) ?? []).length;
  const segments = scope.split("/").length;
  return segments * 10 - stars;
}
