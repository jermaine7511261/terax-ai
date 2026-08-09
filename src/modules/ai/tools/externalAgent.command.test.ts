import { describe, expect, it } from "vitest";
import { buildExternalAgentCommand, type ExternalAgentId } from "./externalAgent";

describe("buildExternalAgentCommand", () => {
  it("claude: uses -p flag and output-format", () => {
    const cmd = buildExternalAgentCommand("claude", "do something", "/tmp");
    expect(cmd).toContain("claude -p");
    expect(cmd).toContain("--output-format text");
    expect(cmd).toContain("--max-turns 8");
    expect(cmd).toContain("do something");
  });

  it("codex: uses exec subcommand", () => {
    const cmd = buildExternalAgentCommand("codex", "hi", "/tmp");
    expect(cmd).toContain("codex exec");
  });

  it(": uses run subcommand", () => {
    const cmd = buildExternalAgentCommand("", "hi", "/tmp");
    expect(cmd).toContain(" run");
  });

  it("gemini: uses -p flag", () => {
    const cmd = buildExternalAgentCommand("gemini", "hi", "/tmp");
    expect(cmd).toContain("gemini -p");
  });

  it("pi: uses -p flag", () => {
    const cmd = buildExternalAgentCommand("pi", "hi", "/tmp");
    expect(cmd).toContain("pi -p");
  });

  it(": uses -p flag", () => {
    const cmd = buildExternalAgentCommand("", "hi", "/tmp");
    expect(cmd).toContain(" -p");
  });

  it("includes cd prefix when cwd is provided", () => {
    const cmd = buildExternalAgentCommand("claude", "hi", "/workspace");
    expect(cmd).toMatch(/^cd .* && claude/);
    expect(cmd).toContain("/workspace");
  });

  it("omits cd prefix when cwd is null", () => {
    const cmd = buildExternalAgentCommand("claude", "hi", null);
    expect(cmd).not.toContain("cd ");
    expect(cmd).toMatch(/^claude/);
  });

  it("all agent ids produce a valid non-empty command", () => {
    const ids: ExternalAgentId[] = [
      "claude", "codex", "", "gemini", "pi", "",
    ];
    for (const id of ids) {
      const cmd = buildExternalAgentCommand(id, "test prompt", "/tmp");
      expect(cmd.length).toBeGreaterThan(0);
      expect(cmd).toContain("test prompt");
    }
  });
});
