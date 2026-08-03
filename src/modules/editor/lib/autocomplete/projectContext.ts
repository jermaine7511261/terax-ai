import { native, type DirEntry } from "@/modules/ai/lib/native";

/**
 * Project context for AI completion: AGENTS.md / YAMET.md / CLAUDE.md found by
 * walking up from the edited file's directory, plus a small capped set of
 * same-directory source files. Injected into the completion prompt so
 * suggestions follow the project's symbols and conventions instead of being
 * purely generic.
 *
 * Reads are async but cached per-directory with a short TTL, because the
 * autocomplete path fires at keystroke rate and must not hit disk on every
 * edit. The caller awaits the cached result once per suggestion; subsequent
 * fires hit the cache synchronously-ish.
 */

type DirContext = {
  dir: string;
  notes: string;
  siblingSnippets: { filename: string; head: string }[];
};

type CacheEntry = { at: number; value: DirContext | null };

const CACHE_TTL_MS = 30_000;
const MAX_NOTES_CHARS = 6000;
const MAX_SIBLINGS = 8;
const MAX_SIBLING_CHARS = 1200;
const SIBLING_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".rb",
  ".php",
  ".cs",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
]);

const NOTES_NAMES = ["AGENTS.md", "YAMET.md", "CLAUDE.md"];

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DirContext | null>>();

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(0, i) : ".";
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    const r = await native.readFile(path);
    if (r.kind !== "text") return null;
    return r.content;
  } catch {
    return null;
  }
}

async function walkUpForNotes(start: string): Promise<string | null> {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    for (const name of NOTES_NAMES) {
      const content = await readFileSafe(`${dir}/${name}`);
      if (content) return content.slice(0, MAX_NOTES_CHARS);
    }
    const parent = dirOf(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function listSiblingSnippets(
  dir: string,
  selfPath: string,
): Promise<{ filename: string; head: string }[]> {
  let entries: DirEntry[] = [];
  try {
    entries = await native.readDir(dir);
  } catch {
    return [];
  }
  const self = selfPath.split(/[\\/]/).pop() ?? "";
  const files = entries
    .filter(
      (e) =>
        e.kind === "file" &&
        e.name !== self &&
        !e.name.startsWith(".") &&
        SIBLING_EXTENSIONS.has(e.name.slice(e.name.lastIndexOf(".")).toLowerCase()),
    )
    // Most-recently-edited first: files the user touched recently carry the
    // freshest conventions/symbols, so they matter more than stale ones.
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, MAX_SIBLINGS);
  const out: { filename: string; head: string }[] = [];
  for (const f of files) {
    const content = await readFileSafe(`${dir}/${f.name}`);
    if (content) {
      out.push({ filename: f.name, head: content.slice(0, MAX_SIBLING_CHARS) });
    }
  }
  return out;
}

export function getProjectContext(
  filePath: string | null,
): Promise<DirContext | null> {
  if (!filePath) return Promise.resolve(null);
  const dir = dirOf(filePath);
  const now = Date.now();
  const hit = cache.get(dir);
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);

  const pending = inflight.get(dir);
  if (pending) return pending;

  const p = (async (): Promise<DirContext | null> => {
    try {
      const [notes, siblings] = await Promise.all([
        walkUpForNotes(dir),
        listSiblingSnippets(dir, filePath),
      ]);
      const value =
        notes || siblings.length > 0
          ? { dir, notes: notes ?? "", siblingSnippets: siblings }
          : null;
      cache.set(dir, { at: Date.now(), value });
      return value;
    } catch {
      cache.set(dir, { at: Date.now(), value: null });
      return null;
    } finally {
      inflight.delete(dir);
    }
  })();
  inflight.set(dir, p);

  // Bound cache size — drop the oldest entry when it grows large.
  if (cache.size > 200) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  return p;
}
