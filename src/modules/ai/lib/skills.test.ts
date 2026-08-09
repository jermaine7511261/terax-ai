import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  createDir: vi.fn(async () => {}),
  readFile: vi.fn(
    async (
      _path: string,
    ): Promise<{ kind: string; content: string }> => ({ kind: "text", content: "" }),
  ),
  writeFile: vi.fn(async () => {}),
  readDir: vi.fn(async () => [] as { name: string; kind: string }[]),
}));

vi.mock("./native", () => ({ native: nativeMock }));

import {
  capSkillBody,
  convertSkillMd,
  importSkillToWorkspace,
  parseSkillJson,
  scanSkillsDir,
  serializeSkill,
  skillState,
} from "./skills";

beforeEach(() => {
  nativeMock.createDir.mockClear();
  nativeMock.readFile.mockClear();
  nativeMock.writeFile.mockClear();
  nativeMock.readDir.mockClear();
  nativeMock.readFile.mockResolvedValue({ kind: "text", content: "" });
  nativeMock.readDir.mockResolvedValue([]);
  nativeMock.createDir.mockResolvedValue(undefined);
  nativeMock.writeFile.mockResolvedValue(undefined);
});

describe("serializeSkill", () => {
  it("round-trips through parseSkillJson", () => {
    const snippet = {
      id: "builtin-review",
      handle: "review",
      name: "review",
      description: "只读审查",
      content: "Review read-only.",
      toolAllowlist: ["read_file", "grep", "glob"],
      builtin: true,
    };
    const parsed = parseSkillJson(serializeSkill(snippet));
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("review");
    expect(parsed?.description).toBe("只读审查");
    expect(parsed?.prompt).toBe("Review read-only.");
    expect(parsed?.handle).toBe("review");
    expect(parsed?.toolAllowlist).toEqual(["read_file", "grep", "glob"]);
  });

  it("omits optional fields when absent", () => {
    const raw = serializeSkill({
      id: "x",
      handle: "",
      name: "x",
      description: "",
      content: "do it",
      builtin: false,
    });
    const parsed = parseSkillJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.handle).toBeUndefined();
    expect(parsed?.toolAllowlist).toBeUndefined();
  });
});

describe("parseSkillJson", () => {
  it("parses a valid skill.json", () => {
    const skill = parseSkillJson(
      JSON.stringify({
        name: "review",
        description: "只读审查",
        prompt: "Review read-only.",
        handle: "review",
        toolAllowlist: ["read_file", "grep", "glob"],
      }),
    );
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("review");
    expect(skill?.handle).toBe("review");
    expect(skill?.toolAllowlist).toEqual(["read_file", "grep", "glob"]);
  });

  it("normalizes an odd handle and filters non-string allowlist entries", () => {
    const skill = parseSkillJson(
      JSON.stringify({
        name: "My Skill",
        prompt: "Do it.",
        handle: "  My  Skill ",
        toolAllowlist: ["read_file", 42, null],
      }),
    );
    expect(skill?.handle).toBe("my-skill");
    expect(skill?.toolAllowlist).toEqual(["read_file"]);
  });

  it("derives handle from name when omitted", () => {
    const skill = parseSkillJson(
      JSON.stringify({ name: "Code Review", prompt: "Review." }),
    );
    expect(skill?.handle).toBeUndefined();
  });

  it("rejects malformed / missing-name / missing-prompt", () => {
    expect(parseSkillJson("not json")).toBeNull();
    expect(parseSkillJson("[]")).toBeNull();
    expect(parseSkillJson(JSON.stringify({ name: "x" }))).toBeNull();
    expect(parseSkillJson(JSON.stringify({ prompt: "y" }))).toBeNull();
    expect(parseSkillJson(JSON.stringify({ name: " ", prompt: "y" }))).toBeNull();
  });

  it("rejects JSON that parses to a non-object primitive", () => {
    expect(parseSkillJson("null")).toBeNull();
    expect(parseSkillJson("42")).toBeNull();
    expect(parseSkillJson("true")).toBeNull();
    expect(parseSkillJson('"a string"')).toBeNull();
    expect(parseSkillJson("[]")).toBeNull();
  });

  it("rejects whitespace-only name or prompt", () => {
    expect(parseSkillJson(JSON.stringify({ name: "  ", prompt: "do it" }))).toBeNull();
    expect(parseSkillJson(JSON.stringify({ name: "x", prompt: "   " }))).toBeNull();
  });

  it("coerces description to an empty string when it is not a string", () => {
    const skill = parseSkillJson(
      JSON.stringify({ name: "x", prompt: "do it", description: 42 }),
    );
    expect(skill?.description).toBe("");
  });

  it("returns undefined allowlist when toolAllowlist is absent or not an array", () => {
    expect(
      parseSkillJson(JSON.stringify({ name: "x", prompt: "do it" }))?.toolAllowlist,
    ).toBeUndefined();
    expect(
      parseSkillJson(
        JSON.stringify({ name: "x", prompt: "do it", toolAllowlist: "read_file" }),
      )?.toolAllowlist,
    ).toBeUndefined();
  });

  it("keeps an empty allowlist array as-is", () => {
    expect(
      parseSkillJson(
        JSON.stringify({ name: "x", prompt: "do it", toolAllowlist: [] }),
      )?.toolAllowlist,
    ).toEqual([]);
  });

  it("filters non-string entries from the allowlist, preserving order", () => {
    const skill = parseSkillJson(
      JSON.stringify({
        name: "x",
        prompt: "do it",
        toolAllowlist: ["read_file", 42, null, "grep", {}],
      }),
    );
    expect(skill?.toolAllowlist).toEqual(["read_file", "grep"]);
  });

  it("returns an empty handle when handle normalizes to nothing", () => {
    const skill = parseSkillJson(
      JSON.stringify({ name: "x", prompt: "do it", handle: "!!!  " }),
    );
    expect(skill?.handle).toBe("");
  });
});

describe("convertSkillMd (SKILL.md → skill.json)", () => {
  it("parses frontmatter + body", () => {
    const md = `---
name: fix-ts
description: Fix TypeScript errors
handle: fixTs
toolAllowlist: bash_run, grep
---
Run pnpm check-types and fix the errors.`;
    const s = convertSkillMd(md);
    expect(s).not.toBeNull();
    expect(s?.name).toBe("fix-ts");
    expect(s?.description).toBe("Fix TypeScript errors");
    expect(s?.handle).toBe("fixts"); // normalized
    expect(s?.toolAllowlist).toEqual(["bash_run", "grep"]);
    expect(s?.prompt).toContain("pnpm check-types");
  });

  it("uses title as name fallback", () => {
    const md = `---\ntitle: My Skill\n---\nbody here`;
    expect(convertSkillMd(md)?.name).toBe("My Skill");
  });

  it("handles a markdown file with no frontmatter", () => {
    const s = convertSkillMd("Just a body with no frontmatter");
    expect(s?.prompt).toContain("Just a body");
    expect(s?.name).toBe("");
  });

  it("returns null for an empty body", () => {
    expect(convertSkillMd("---\nname: x\n---\n   ")).toBeNull();
  });

  it("strips surrounding quotes from frontmatter values", () => {
    const md = `---\nname: "quoted name"\n---\nbody`;
    expect(convertSkillMd(md)?.name).toBe("quoted name");
  });
});

function mustParseSkill(raw: string): ReturnType<typeof parseSkillJson> {
  const s = parseSkillJson(raw);
  expect(s).not.toBeNull();
  return s;
}

describe("skillState (S6 activation)", () => {
  it("returns ACTIVE when all requirements are met", () => {
    const s = mustParseSkill('{"name":"d","prompt":"p","requiresTools":["bash_run"]}');
    expect(skillState(s as never, ["bash_run"], [])).toBe("ACTIVE");
  });
  it("returns DEGRADED when a requirement is missing", () => {
    const s = mustParseSkill('{"name":"d","prompt":"p","requiresEnv":["FOO"]}');
    expect(skillState(s as never, [], [])).toBe("DEGRADED");
    const t = mustParseSkill('{"name":"d","prompt":"p","requiresTools":["git_commit"]}');
    expect(skillState(t as never, ["read_file"], [])).toBe("DEGRADED");
  });
  it("returns UNAVAILABLE when a fallback tool is missing", () => {
    const s = mustParseSkill('{"name":"d","prompt":"p","fallbackForTools":["docker"]}');
    expect(skillState(s as never, ["read_file"], [])).toBe("UNAVAILABLE");
  });
  it("returns ACTIVE for a skill with no requirements", () => {
    const s = mustParseSkill('{"name":"d","prompt":"p"}');
    expect(skillState(s as never, [], [])).toBe("ACTIVE");
  });
});

describe("capSkillBody (S6 prompt budget)", () => {
  it("keeps short bodies and truncates long ones with a marker", () => {
    expect(capSkillBody("short")).toBe("short");
    const capped = capSkillBody("x".repeat(5000));
    expect(capped).toContain("[truncated]");
    expect(capped.length).toBeLessThan(5000);
  });
});

describe("importSkillToWorkspace", () => {
  it("creates the skills dir, writes the file and reports success", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("ENOENT"));
    const res = await importSkillToWorkspace(
      "/ws",
      JSON.stringify({ name: "review", prompt: "Do it." }),
    );
    expect(res).toEqual({ ok: true, name: "review" });
    expect(nativeMock.createDir).toHaveBeenCalledWith("/ws/skills");
    expect(nativeMock.writeFile).toHaveBeenCalledWith(
      "/ws/skills/review.json",
      expect.stringContaining('"name": "review"'),
    );
  });

  it("strips a trailing slash from the root", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("ENOENT"));
    await importSkillToWorkspace(
      "/ws/",
      JSON.stringify({ name: "r", prompt: "p" }),
    );
    expect(nativeMock.createDir).toHaveBeenCalledWith("/ws/skills");
    expect(nativeMock.writeFile).toHaveBeenCalledWith(
      "/ws/skills/r.json",
      expect.any(String),
    );
  });

  it("rejects invalid payloads", async () => {
    expect(await importSkillToWorkspace("/ws", "nope")).toEqual({
      ok: false,
      error: "invalid skill.json: name and prompt are required",
    });
  });

  it("rejects when no workspace root is selected", async () => {
    expect(
      await importSkillToWorkspace(
        null,
        JSON.stringify({ name: "x", prompt: "y" }),
      ),
    ).toEqual({ ok: false, error: "no workspace root selected" });
  });

  it("refuses to clobber an existing skill", async () => {
    nativeMock.readFile.mockResolvedValue({ kind: "text", content: "{}" });
    const res = await importSkillToWorkspace(
      "/ws",
      JSON.stringify({ name: "review", prompt: "Do it." }),
    );
    expect(res).toEqual({
      ok: false,
      error: 'skill "review" already exists in skills/',
    });
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("surfaces write failures", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("ENOENT"));
    nativeMock.writeFile.mockRejectedValue(new Error("disk full"));
    const res = await importSkillToWorkspace(
      "/ws",
      JSON.stringify({ name: "review", prompt: "Do it." }),
    );
    expect(res).toEqual({ ok: false, error: "Error: disk full" });
  });

  it("tolerates createDir failure (dir already exists)", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("ENOENT"));
    nativeMock.createDir.mockRejectedValue(new Error("EEXIST"));
    const res = await importSkillToWorkspace(
      "/ws",
      JSON.stringify({ name: "r", prompt: "p" }),
    );
    expect(res).toEqual({ ok: true, name: "r" });
  });
});

describe("scanSkillsDir", () => {
  it("returns [] without a workspace root", async () => {
    expect(await scanSkillsDir(null)).toEqual([]);
    expect(nativeMock.readDir).not.toHaveBeenCalled();
  });

  it("returns [] when the skills dir is unreadable", async () => {
    nativeMock.readDir.mockRejectedValue(new Error("ENOENT"));
    expect(await scanSkillsDir("/ws")).toEqual([]);
  });

  it("scans file and dir skills, skipping archived and non-json entries", async () => {
    nativeMock.readDir.mockResolvedValue([
      { name: "a.json", kind: "file" },
      { name: "b", kind: "dir" },
      { name: "notes.txt", kind: "file" },
    ]);
    nativeMock.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("a.json")) {
        return {
          kind: "text",
          content: JSON.stringify({ name: "A", description: "d", prompt: "p" }),
        };
      }
      if (path.endsWith("skill.json")) {
        return {
          kind: "text",
          content: JSON.stringify({
            name: "B",
            prompt: "p2",
            archived: true,
          }),
        };
      }
      return { kind: "text", content: "{}" };
    });
    const out = await scanSkillsDir("/ws/");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "builtin-A", name: "A", builtin: true });
    expect(out[0].handle).toBe("a");
  });

  it("skips unreadable and non-text results", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "a", kind: "file" }]);
    nativeMock.readFile.mockRejectedValue(new Error("ENOENT"));
    expect(await scanSkillsDir("/ws")).toEqual([]);
    nativeMock.readFile.mockResolvedValue({
      kind: "binary",
      content: new Uint8Array(),
    } as never);
    expect(await scanSkillsDir("/ws")).toEqual([]);
  });
});
