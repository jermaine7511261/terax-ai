import { describe, expect, it } from "vitest";
import { parseSkillJson } from "./skills";

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
});
