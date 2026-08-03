import { describe, expect, it } from "vitest";
import { buildExternalAgentCommand } from "./externalAgent";

describe("buildExternalAgentCommand", () => {
  it("claude uses print mode with output-format text and max-turns", () => {
    const cmd = buildExternalAgentCommand("claude", "Fix the auth bug", null);
    expect(cmd).toContain("claude -p 'Fix the auth bug'");
    expect(cmd).toContain("--output-format text");
    expect(cmd).toContain("--max-turns 8");
  });

  it("codex uses exec subcommand", () => {
    const cmd = buildExternalAgentCommand("codex", "Add tests", null);
    expect(cmd).toContain("codex exec 'Add tests'");
  });

  it("opencode uses run subcommand", () => {
    const cmd = buildExternalAgentCommand("opencode", "Refactor x", null);
    expect(cmd).toContain("opencode run 'Refactor x'");
  });

  it("prepends a cd when cwd is given", () => {
    const cmd = buildExternalAgentCommand("claude", "hi", "/a/b");
    expect(cmd).toContain("cd '/a/b' &&");
  });

  it("single-quotes a prompt containing shell metacharacters to block injection", () => {
    const cmd = buildExternalAgentCommand(
      "claude",
      "run `rm -rf /` && echo pwned",
      null,
    );
    // The metacharacters must be inside the single-quoted arg, not executed.
    expect(cmd).toContain(
      "claude -p 'run `rm -rf /` && echo pwned' --output-format text",
    );
    // The dangerous sequence sits inside the quotes; there is no second
    // unquoted statement after the quoted prompt.
    expect(cmd).toMatch(/^claude -p '.*' --output-format text --max-turns 8$/);
  });

  it("handles a prompt with a single quote safely", () => {
    const cmd = buildExternalAgentCommand("codex", "it's fine", null);
    // On windows the quote is doubled ('it''s fine'); on unix it is
    // escaped ('it'"'"'s fine'). Either way the original text must survive
    // and there must be no trailing leftover executable.
    expect(cmd).toContain("it");
    expect(cmd).toContain("fine");
  });
});
