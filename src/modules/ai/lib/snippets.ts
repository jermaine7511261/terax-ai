import { createStorage } from "@/platform";

export type Snippet = {
  id: string;
  /** The "#handle" used in the composer. Lowercase, [a-z0-9-]+. */
  handle: string;
  name: string;
  description: string;
  content: string;
  /** Tool ids this snippet may use (e.g. ["read_file","grep"]); absent = prompt only. */
  toolAllowlist?: string[];
  /** Scanned from `<workspace>/skills/`; can be disabled but not deleted. */
  builtin?: boolean;
};

const STORE_PATH = "yamet-ai-snippets.json";
const KEY_LIST = "snippets";
const KEY_DISABLED = "disabledBuiltinHandles";

const store = createStorage(STORE_PATH);

export async function loadSnippets(): Promise<Snippet[]> {
  return (await store.get<Snippet[]>(KEY_LIST)) ?? [];
}

export async function saveSnippets(list: Snippet[]): Promise<void> {
  // Only user-authored snippets are persisted; builtins come from the
  // skills/ scan each boot and are gated by `disabledBuiltinHandles`.
  await store.set(KEY_LIST, list.filter((s) => !s.builtin));
}

export async function loadDisabledBuiltins(): Promise<string[]> {
  return (await store.get<string[]>(KEY_DISABLED)) ?? [];
}

export async function saveDisabledBuiltins(list: string[]): Promise<void> {
  await store.set(KEY_DISABLED, list);
}

export function newSnippetId(): string {
  return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/;

export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidHandle(h: string): boolean {
  return HANDLE_RE.test(h);
}

/**
 * Replace `#handle` tokens in `text` with their snippet bodies, wrapped in
 * `<snippet name="…">…</snippet>` blocks, prepended to the message. Tokens that
 * don't match a known snippet are left as-is.
 *
 * Returns the rewritten body (with tokens stripped), the list of expanded
 * snippet blocks to prepend, and the snippets actually used (for the
 * tool-allowlist injection: only snippets that were really expanded count).
 */
export function expandSnippetTokens(
  text: string,
  snippets: readonly Snippet[],
): { body: string; blocks: string[]; used: Snippet[] } {
  const byHandle = new Map(snippets.map((s) => [s.handle, s]));
  const matched = new Map<string, Snippet>();
  // (^|\s)#handle  — handle is [a-z0-9][a-z0-9-]*
  const re = /(^|\s)#([a-z0-9][a-z0-9-]*)\b/gi;
  const body = text.replace(re, (full, lead: string, raw: string) => {
    const h = raw.toLowerCase();
    const snip = byHandle.get(h);
    if (!snip) return full;
    matched.set(snip.id, snip);
    return lead;
  });
  const blocks = Array.from(matched.values()).map(
    (s) => `<snippet name="${s.handle}">\n${s.content}\n</snippet>`,
  );
  return {
    body: body.replace(/[ \t]+\n/g, "\n").trim(),
    blocks,
    used: Array.from(matched.values()),
  };
}
