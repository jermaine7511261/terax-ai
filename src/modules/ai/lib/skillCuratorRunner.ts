import { native, type DirEntry } from "./native";
import { parseSkillJson, type SkillFile } from "./skills";
import {
  applyCurateDecision,
  curateSkills,
  DEFAULT_CURATOR_CONFIG,
  shouldRunCurator,
  type SkillLifecycle,
} from "./skillCurator";

/**
 * Background skill curator runner (P1-5). Inactivity-triggered: the caller
 * checks `shouldRunCurator` against the last-run timestamp (persisted via
 * `getLastRunAt`/`setLastRunAt`) and invokes `runBackgroundCurator` when due.
 *
 * It scans `<workspace>/skills/`, builds lifecycle records from each skill.json,
 * runs the curator decision set, and writes `archived:true` back to stale
 * agent-created skills. Archive is non-destructive (files stay on disk; they
 * just drop out of the active list via readSkillFile's archived check).
 */

const CURATOR_INTERVAL_MS = 60 * 60 * 1000; // run at most once per hour

function lifecycleFromSkill(
  name: string,
  s: SkillFile,
): SkillLifecycle {
  return {
    name,
    activityTs: s.activity_ts ?? 0,
    usageCount: s.usage_count ?? 0,
    agentCreated: s.agent_created ?? false,
    status: s.archived ? "archived" : "active",
  };
}

function skillFilePath(root: string, entry: DirEntry): string {
  return `${root}/skills/${entry.name}${entry.kind === "dir" ? "/skill.json" : ""}`;
}

function readSkillPayload(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runBackgroundCurator(
  workspaceRoot: string | null,
  opts: {
    now?: number;
    lastRunAt?: number;
    getLastRunAt?: () => number;
    setLastRunAt?: (t: number) => void;
  } = {},
): Promise<{ ran: boolean; archived: string[] }> {
  const now = opts.now ?? Date.now();
  const getLast = opts.getLastRunAt ?? (() => 0);
  const setLast = opts.setLastRunAt ?? (() => {});
  const lastRunAt = opts.lastRunAt ?? getLast();

  if (!shouldRunCurator({ lastRunAt, now, intervalMs: CURATOR_INTERVAL_MS })) {
    return { ran: false, archived: [] };
  }
  if (!workspaceRoot) {
    setLast(now);
    return { ran: false, archived: [] };
  }

  let entries: DirEntry[];
  try {
    entries = await native.readDir(`${workspaceRoot.replace(/\/$/, "")}/skills`);
  } catch {
    setLast(now);
    return { ran: false, archived: [] };
  }

  const lifecycles: SkillLifecycle[] = [];
  const files: { name: string; path: string }[] = [];
  for (const entry of entries) {
    const isDirSkill = entry.kind === "dir";
    if (!isDirSkill && !entry.name.endsWith(".json")) continue;
    const path = skillFilePath(workspaceRoot.replace(/\/$/, ""), entry);
    try {
      const r = await native.readFile(path);
      if (r.kind !== "text") continue;
      const payload = readSkillPayload(r.content);
      const skill = parseSkillJson(r.content);
      if (!payload || !skill) continue;
      lifecycles.push(lifecycleFromSkill(skill.name, skill));
      files.push({ name: skill.name, path });
    } catch {
      // Skip unreadable skills.
    }
  }

  const decisions = curateSkills(lifecycles, now, DEFAULT_CURATOR_CONFIG);
  const archived: string[] = [];
  for (const d of decisions) {
    const file = files.find((f) => f.name === d.name);
    if (!file) continue;
    const patch = applyCurateDecision({}, d);
    if (!patch) continue;
    try {
      const r = await native.readFile(file.path);
      if (r.kind !== "text") continue;
      const payload = readSkillPayload(r.content);
      if (!payload) continue;
      await native.writeFile(file.path, JSON.stringify({ ...payload, archived: true }, null, 2));
      archived.push(d.name);
    } catch {
      // Skip unreadable/unwritable skills.
    }
  }

  setLast(now);
  return { ran: true, archived };
}
