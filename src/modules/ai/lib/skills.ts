import { native } from "./native";
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
};

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
  let entries;
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
  let result;
  try {
    result = await native.readFile(path);
  } catch {
    return null;
  }
  if (result.kind !== "text") return null;
  const skill = parseSkillJson(result.content);
  if (!skill) return null;
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
