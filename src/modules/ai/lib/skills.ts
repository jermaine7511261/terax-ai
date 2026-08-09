import { native, type DirEntry, type ReadResult } from "./native";
import { normalizeHandle, type Snippet } from "./snippets";

/**
 * Builtin skills — LangBot-style `skills/` directory convention (★ L4).
 *
 * A skill lives at `<workspaceRoot>/skills/<name>/skill.json` (or
 * `<name>.json`) with fields `{ name, description, prompt, handle?,
 * toolAllowlist? }`. Scanning is triggered at app boot (`useAiBootstrap`)
 * and by the settings page's "重新扫描" button; disabled builtins (tracked in
 * `snippetsStore.disabledBuiltinHandles`) are skipped so they don't revive.
 */

export type SkillFile = {
  name: string;
  description: string;
  prompt: string;
  handle?: string;
  toolAllowlist?: string[];
  /** P1-5 lifecycle metadata (curator). */
  agent_created?: boolean;
  created_at?: number;
  activity_ts?: number;
  usage_count?: number;
  /** Archived by the curator — the skill still exists but is hidden from the
   * active list (archive-only, never deleted). */
  archived?: boolean;
};

/** Serialize a snippet as a shareable skill.json payload (bundle export). */
export function serializeSkill(s: Snippet): string {
  const payload: SkillFile = {
    name: s.name,
    description: s.description,
    prompt: s.content,
    handle: s.handle || undefined,
    toolAllowlist: s.toolAllowlist,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Import a skill.json payload into `<workspaceRoot>/skills/<name>.json`.
 * Validates first; refuses to clobber an existing file (mirrors theme-import
 * behavior — no silent overwrite).
 */
export async function importSkillToWorkspace(
  workspaceRoot: string | null,
  raw: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const skill = parseSkillJson(raw);
  if (!skill) {
    return { ok: false, error: "invalid skill.json: name and prompt are required" };
  }
  if (!workspaceRoot) {
    return { ok: false, error: "no workspace root selected" };
  }
  const root = workspaceRoot.replace(/\/$/, "");
  const dir = `${root}/skills`;
  try {
    await native.createDir(dir);
  } catch {
    // Directory already exists — the common case.
  }
  const target = `${dir}/${skill.name}.json`;
  try {
    await native.readFile(target);
    return { ok: false, error: `skill "${skill.name}" already exists in skills/` };
  } catch {
    // Target does not exist; proceed.
  }
  try {
    await native.writeFile(target, JSON.stringify(skill, null, 2));
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  return { ok: true, name: skill.name };
}

/**
 * Convert a SKILL.md (frontmatter + body) into a skill.json payload
 * (agentskills 兼容性评估 建议 3). Frontmatter supports: name, description,
 * handle, toolAllowlist (YAML-ish `name: value` lines or a comma/space list).
 * Returns null when the body is empty.
 */
export function convertSkillMd(md: string): SkillFile | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  const front = m?.[1] ?? "";
  const body = (m?.[2] ?? md).trim();
  if (!body) return null;

  const fm: Record<string, string> = {};
  for (const line of front.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    fm[key] = val.replace(/^["']|["']$/g, "");
  }

  const name = (fm.name || fm.title || "").trim();
  const description = (fm.description || "").trim();
  const handle = (fm.handle || "").trim();
  const toolAllowlist = (fm.toolallowlist || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    name,
    description,
    prompt: body,
    handle: handle ? normalizeHandle(handle) : undefined,
    toolAllowlist: toolAllowlist.length > 0 ? toolAllowlist : undefined,
  };
}

/** Parse + validate a skill.json payload; returns null when malformed. */
export function parseSkillJson(raw: string): SkillFile | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!name || !prompt) return null;
  return {
    name,
    description: typeof o.description === "string" ? o.description : "",
    prompt,
    handle: typeof o.handle === "string" ? normalizeHandle(o.handle) : undefined,
    toolAllowlist: Array.isArray(o.toolAllowlist)
      ? o.toolAllowlist.filter((x): x is string => typeof x === "string")
      : undefined,
    agent_created: o.agent_created === true,
    created_at: typeof o.created_at === "number" ? o.created_at : undefined,
    activity_ts: typeof o.activity_ts === "number" ? o.activity_ts : undefined,
    usage_count: typeof o.usage_count === "number" ? o.usage_count : 0,
    archived: o.archived === true,
  };
}

/**
 * Scan `<workspaceRoot>/skills/` for builtin skills and map them to
 * `builtin: true` Snippets. Absent directory / unreadable entries are
 * silently skipped (a workspace without `skills/` is the normal case).
 */
export async function scanSkillsDir(
  workspaceRoot: string | null,
): Promise<Snippet[]> {
  if (!workspaceRoot) return [];
  const root = workspaceRoot.replace(/\/$/, "");
  let entries: DirEntry[];
  try {
    entries = await native.readDir(`${root}/skills`);
  } catch {
    return [];
  }

  const out: Snippet[] = [];
  for (const entry of entries) {
    if (entry.kind === "dir") {
      const skill = await readSkillFile(`${root}/skills/${entry.name}/skill.json`);
      if (skill) out.push(skill);
    } else if (entry.kind === "file" && entry.name.endsWith(".json")) {
      const skill = await readSkillFile(`${root}/skills/${entry.name}`);
      if (skill) out.push(skill);
    }
  }
  return out;
}

async function readSkillFile(path: string): Promise<Snippet | null> {
  let result: ReadResult;
  try {
    result = await native.readFile(path);
  } catch {
    return null;
  }
  if (result.kind !== "text") return null;
  const skill = parseSkillJson(result.content);
  if (!skill) return null;
  // Archived skills still exist on disk but are hidden from the active set.
  if (skill.archived) return null;
  return {
    id: `builtin-${skill.name}`,
    handle: skill.handle ?? normalizeHandle(skill.name),
    name: skill.name,
    description: skill.description,
    content: skill.prompt,
    toolAllowlist: skill.toolAllowlist,
    builtin: true,
  };
}
