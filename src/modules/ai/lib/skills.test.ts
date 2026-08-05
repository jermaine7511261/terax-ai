import { describe, expect, it } from "vitest";
import { parseSkillJson, serializeSkill } from "./skills";

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
