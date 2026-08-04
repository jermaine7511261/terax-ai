import { describe, expect, it } from "vitest";
import {
  buildSkillPayload,
  validateSkillFields,
} from "./createSkill";

describe("validateSkillFields", () => {
  it("accepts valid fields", () => {
    expect(
      validateSkillFields({ name: "deploy", prompt: "run the deploy script" }),
    ).toBeNull();
  });

  it("rejects empty name", () => {
    expect(validateSkillFields({ name: "  ", prompt: "x" })).toContain(
      "name",
    );
  });

  it("rejects empty prompt", () => {
    expect(validateSkillFields({ name: "x", prompt: "  " })).toContain(
      "prompt",
    );
  });

  it("accepts a valid handle", () => {
    expect(
      validateSkillFields({
        name: "x",
        prompt: "y",
        handle: "deploy-flow",
      }),
    ).toBeNull();
  });

  it("rejects invalid handle with uppercase", () => {
    expect(
      validateSkillFields({ name: "x", prompt: "y", handle: "Deploy" }),
    ).toContain("handle");
  });

  it("rejects invalid handle with spaces", () => {
    expect(
      validateSkillFields({ name: "x", prompt: "y", handle: "my skill" }),
    ).toContain("handle");
  });

  it("rejects toolAllowlist with empty entries", () => {
    expect(
      validateSkillFields({
        name: "x",
        prompt: "y",
        toolAllowlist: ["bash_run", " "],
      }),
    ).toContain("toolAllowlist");
  });

  it("accepts valid toolAllowlist", () => {
    expect(
      validateSkillFields({
        name: "x",
        prompt: "y",
        toolAllowlist: ["bash_run", "read_file"],
      }),
    ).toBeNull();
  });
});

describe("buildSkillPayload", () => {
  it("builds a minimal payload", () => {
    const p = buildSkillPayload({
      name: "deploy",
      description: "",
      prompt: "run deploy",
    });
    expect(p.name).toBe("deploy");
    expect(p.prompt).toBe("run deploy");
    expect(p.toolAllowlist).toBeUndefined();
    expect(p.handle).toBeUndefined();
  });

  it("adds handle and toolAllowlist when provided", () => {
    const p = buildSkillPayload({
      name: "deploy",
      description: "desc",
      prompt: "run",
      handle: "Deploy-Flow",
      toolAllowlist: ["bash_run"],
    });
    expect(p.handle).toBe("deploy-flow");
    expect(p.toolAllowlist).toEqual(["bash_run"]);
    expect(p.description).toBe("desc");
  });

  it("omits handle when blank", () => {
    const p = buildSkillPayload({
      name: "x",
      description: "",
      prompt: "y",
      handle: "   ",
    });
    expect(p.handle).toBeUndefined();
  });

  it("trims name and prompt", () => {
    const p = buildSkillPayload({
      name: "  deploy  ",
      description: "",
      prompt: "  run  ",
    });
    expect(p.name).toBe("deploy");
    expect(p.prompt).toBe("run");
  });
});
