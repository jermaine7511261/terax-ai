import { describe, expect, it } from "vitest";
import { buildExternalAgentCommand } from "./externalAgent";

describe("buildExternalAgentCommand", () => {
  it("builds a claude command with quoted prompt", () => {
    const cmd = buildExternalAgentCommand("claude", "fix the bug", null);
    expect(cmd).toContain("claude -p");
    expect(cmd).toContain("fix the bug");
    expect(cmd).toContain("--max-turns 8");
  });

  it("builds codex exec command", () => {
    const cmd = buildExternalAgentCommand("codex", "refactor", null);
    expect(cmd).toContain("codex exec");
    expect(cmd).toContain("refactor");
  });

  it("builds opencode run command", () => {
    const cmd = buildExternalAgentCommand("opencode", "test", null);
    expect(cmd).toContain("opencode run");
  });

  it("builds gemini command", () => {
    const cmd = buildExternalAgentCommand("gemini", "explain", null);
    expect(cmd).toContain("gemini -p");
  });

  it("builds pi and grok commands", () => {
    expect(buildExternalAgentCommand("pi", "x", null)).toContain("pi -p");
    expect(buildExternalAgentCommand("grok", "x", null)).toContain("grok -p");
  });

  it("prepends cd when cwd is provided", () => {
    const cmd = buildExternalAgentCommand("claude", "fix", "/home/user/proj");
    expect(cmd).toContain("cd");
    expect(cmd).toContain("/home/user/proj");
    expect(cmd).toContain("&&");
  });

  it("does not prepend cd when cwd is null", () => {
    const cmd = buildExternalAgentCommand("claude", "fix", null);
    expect(cmd).not.toContain("cd ");
  });

  it("quotes prompt with special characters", () => {
    const cmd = buildExternalAgentCommand("claude", 'has "quotes" and spaces', null);
    expect(cmd).toContain('has');
  });
});
