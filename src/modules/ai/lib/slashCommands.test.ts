import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  YAMET_CMD_RE,
  wrapWithCommandMarker,
  SLASH_COMMANDS,
  tryRunSlashCommand,
} from "./slashCommands";

// ---------------------------------------------------------------------------
// Mock the plan store so the /plan branch doesn't hit real Zustand state.
// We control the mock per-test via the returned object.
// ---------------------------------------------------------------------------
const mockPlanStore = {
  active: false,
  toggle: vi.fn(),
  disable: vi.fn(),
};

vi.mock("../store/planStore", () => ({
  usePlanStore: {
    getState: () => mockPlanStore,
  },
}));

beforeEach(() => {
  mockPlanStore.active = false;
  mockPlanStore.toggle.mockImplementation(() => {
    mockPlanStore.active = !mockPlanStore.active;
  });
  mockPlanStore.disable.mockImplementation(() => {
    mockPlanStore.active = false;
  });
  vi.clearAllMocks();
});

// ===================================================================
// YAMET_CMD_RE
// ===================================================================

describe("YAMET_CMD_RE", () => {
  it("matches a bare command with no state", () => {
    const m = '<yamet-command name="init" />'.match(YAMET_CMD_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("init");
    expect(m?.[2]).toBeUndefined();
  });

  it("matches a command with a state attribute", () => {
    const m = '<yamet-command name="review" state="active" />'.match(
      YAMET_CMD_RE,
    );
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("review");
    expect(m?.[2]).toBe("active");
  });

  it("requires the trailing /> (not >)", () => {
    expect('<yamet-command name="init" >'.match(YAMET_CMD_RE)).toBeNull();
  });

  it("requires the trailing newline or end-of-string", () => {
    expect(
      '<yamet-command name="init" />\n'.match(YAMET_CMD_RE),
    ).not.toBeNull();
    expect(
      '<yamet-command name="init" />'.match(YAMET_CMD_RE),
    ).not.toBeNull();
    // No trailing newline and nothing after should still match (end-of-string).
  });

  it("allows multiple trailing newlines", () => {
    const m = '<yamet-command name="fix" />\n\n\n'.match(YAMET_CMD_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("fix");
  });

  it("does not match a name with uppercase letters", () => {
    expect(
      '<yamet-command name="Init" />'.match(YAMET_CMD_RE),
    ).toBeNull();
  });

  it("does not match a name with spaces", () => {
    expect(
      '<yamet-command name="claude code" />'.match(YAMET_CMD_RE),
    ).toBeNull();
  });

  it("does not match a name with special characters", () => {
    expect(
      '<yamet-command name="init!" />'.match(YAMET_CMD_RE),
    ).toBeNull();
  });

  it("matches hyphenated names like claude-code", () => {
    const m = '<yamet-command name="claude-code" />'.match(YAMET_CMD_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("claude-code");
  });

  it("matches numeric names", () => {
    const m = '<yamet-command name="cmd123" />'.match(YAMET_CMD_RE);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("cmd123");
  });
});

// ===================================================================
// wrapWithCommandMarker
// ===================================================================

describe("wrapWithCommandMarker", () => {
  it("wraps a prompt with the given command name", () => {
    const result = wrapWithCommandMarker("do something", "init");
    expect(result).toBe(
      '<yamet-command name="init" />\n\ndo something',
    );
  });

  it("works with hyphenated command names", () => {
    const result = wrapWithCommandMarker("my request", "claude-code");
    expect(result).toBe(
      '<yamet-command name="claude-code" />\n\nmy request',
    );
  });

  it("preserves the original prompt verbatim", () => {
    const long = "Line one\nLine two\nLine three";
    const result = wrapWithCommandMarker(long, "review");
    expect(result).toContain(long);
    expect(result).toMatch(/^<yamet-command name="review" \/>\n\n/);
  });

  it("works with an empty prompt", () => {
    const result = wrapWithCommandMarker("", "test");
    expect(result).toBe('<yamet-command name="test" />\n\n');
  });
});

// ===================================================================
// SLASH_COMMANDS constant
// ===================================================================

describe("SLASH_COMMANDS", () => {
  const expectedKeys = [
    "init",
    "plan",
    "claude-code",
    "review",
    "commit",
    "test",
    "fix",
  ];

  it("contains all expected command keys", () => {
    expect(Object.keys(SLASH_COMMANDS).sort()).toEqual(expectedKeys.sort());
  });

  it("each command has name, invocation, label, and icon", () => {
    for (const [key, cmd] of Object.entries(SLASH_COMMANDS)) {
      expect(cmd.name).toBe(key);
      expect(cmd.invocation).toBe(`/${key}`);
      expect(typeof cmd.label).toBe("string");
      expect(cmd.label.length).toBeGreaterThan(0);
      expect(cmd.icon).toBeDefined();
    }
  });

  it("invocations start with /", () => {
    for (const cmd of Object.values(SLASH_COMMANDS)) {
      expect(cmd.invocation.startsWith("/")).toBe(true);
    }
  });
});

// ===================================================================
// tryRunSlashCommand — non-command inputs
// ===================================================================

describe("tryRunSlashCommand — non-command inputs", () => {
  it("returns none for plain text", () => {
    expect(tryRunSlashCommand("hello world")).toEqual({ kind: "none" });
  });

  it("returns none for empty string", () => {
    expect(tryRunSlashCommand("")).toEqual({ kind: "none" });
  });

  it("returns none for whitespace-only string", () => {
    expect(tryRunSlashCommand("   ")).toEqual({ kind: "none" });
  });

  it("returns none for unknown slash commands", () => {
    expect(tryRunSlashCommand("/unknown")).toEqual({ kind: "none" });
  });

  it("returns none for / without a command name", () => {
    expect(tryRunSlashCommand("/")).toEqual({ kind: "none" });
  });

  it("trims whitespace before parsing", () => {
    expect(tryRunSlashCommand("  /review  ")).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining("Review the current"),
      commandName: "review",
    });
  });
});

// ===================================================================
// tryRunSlashCommand — # prefix (hashtag shorthand)
// ===================================================================

describe("tryRunSlashCommand — # prefix", () => {
  it("matches known commands with # prefix", () => {
    expect(tryRunSlashCommand("#init")).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining("Scan this workspace"),
      commandName: "init",
    });
  });

  it("returns none for unknown # command", () => {
    expect(tryRunSlashCommand("#nope")).toEqual({ kind: "none" });
  });

  it("returns none for bare #", () => {
    expect(tryRunSlashCommand("#")).toEqual({ kind: "none" });
  });

  it("handles # with trailing args", () => {
    const result = tryRunSlashCommand("#review extra stuff");
    expect(result.kind).toBe("send-prompt");
    expect((result as { kind: "send-prompt"; commandName?: string }).commandName).toBe("review");
  });
});

// ===================================================================
// tryRunSlashCommand — /plan
// ===================================================================

describe("tryRunSlashCommand — /plan", () => {
  it("toggles plan mode when called without arguments", () => {
    const result = tryRunSlashCommand("/plan");
    expect(mockPlanStore.toggle).toHaveBeenCalled();
    expect(result).toEqual({ kind: "handled", toast: expect.any(String) });
  });

  it("shows 'Plan mode on' after toggling from off", () => {
    mockPlanStore.active = false;
    mockPlanStore.toggle.mockImplementation(() => {
      mockPlanStore.active = true;
    });
    const result = tryRunSlashCommand("/plan");
    expect(result).toEqual({ kind: "handled", toast: "Plan mode on" });
  });

  it("shows 'Plan mode off' after toggling from on", () => {
    mockPlanStore.active = true;
    mockPlanStore.toggle.mockImplementation(() => {
      mockPlanStore.active = false;
    });
    const result = tryRunSlashCommand("/plan");
    expect(result).toEqual({ kind: "handled", toast: "Plan mode off" });
  });

  it("disables plan mode with /plan off", () => {
    const result = tryRunSlashCommand("/plan off");
    expect(mockPlanStore.disable).toHaveBeenCalled();
    expect(result).toEqual({ kind: "handled", toast: "Plan mode off" });
  });

  it("disables plan mode with /plan exit", () => {
    const result = tryRunSlashCommand("/plan exit");
    expect(mockPlanStore.disable).toHaveBeenCalled();
    expect(result).toEqual({ kind: "handled", toast: "Plan mode off" });
  });

  it("treats any other tail as a plain toggle", () => {
    mockPlanStore.active = false;
    mockPlanStore.toggle.mockImplementation(() => {
      mockPlanStore.active = true;
    });
    const result = tryRunSlashCommand("/plan blah");
    expect(mockPlanStore.toggle).toHaveBeenCalled();
    expect(result).toEqual({ kind: "handled", toast: "Plan mode on" });
  });
});

// ===================================================================
// tryRunSlashCommand — /init
// ===================================================================

describe("tryRunSlashCommand — /init", () => {
  it("returns send-prompt with init prompt", () => {
    const result = tryRunSlashCommand("/init");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining("Scan this workspace"),
      commandName: "init",
    });
  });

  it("ignores trailing arguments", () => {
    const result = tryRunSlashCommand("/init --force");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining("Scan this workspace"),
      commandName: "init",
    });
  });
});

// ===================================================================
// tryRunSlashCommand — /claude-code
// ===================================================================

describe("tryRunSlashCommand — /claude-code", () => {
  it("returns a usage toast when no request is provided", () => {
    const result = tryRunSlashCommand("/claude-code");
    expect(result).toEqual({
      kind: "handled",
      toast: "Usage: /claude-code <request>",
    });
  });

  it("returns a send-prompt with the request wrapped in the directive", () => {
    const result = tryRunSlashCommand("/claude-code fix the login bug");
    expect(result.kind).toBe("send-prompt");
    if (result.kind === "send-prompt") {
      expect(result.commandName).toBe("claude-code");
      expect(result.prompt).toContain("fix the login bug");
      expect(result.prompt).toContain(
        "The user wants to drive a Claude Code agent",
      );
      expect(result.prompt).toContain("<request>");
      expect(result.prompt).toContain("</request>");
    }
  });

  it("preserves multi-word requests", () => {
    const result = tryRunSlashCommand("/claude-code refactor auth module");
    if (result.kind === "send-prompt") {
      expect(result.prompt).toContain("refactor auth module");
    }
  });

  it("handles requests with special characters", () => {
    const result = tryRunSlashCommand(
      '/claude-code fix "quoted" & special <chars>',
    );
    if (result.kind === "send-prompt") {
      expect(result.prompt).toContain('fix "quoted" & special <chars>');
    }
  });
});

// ===================================================================
// tryRunSlashCommand — /review
// ===================================================================

describe("tryRunSlashCommand — /review", () => {
  it("returns send-prompt with the review prompt", () => {
    const result = tryRunSlashCommand("/review");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining("Review the current set of uncommitted"),
      commandName: "review",
    });
  });
});

// ===================================================================
// tryRunSlashCommand — /commit
// ===================================================================

describe("tryRunSlashCommand — /commit", () => {
  it("returns send-prompt with the commit prompt", () => {
    const result = tryRunSlashCommand("/commit");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining(
        "Generate a conventional, well-formed git commit",
      ),
      commandName: "commit",
    });
  });
});

// ===================================================================
// tryRunSlashCommand — /test
// ===================================================================

describe("tryRunSlashCommand — /test", () => {
  it("returns send-prompt with the test prompt", () => {
    const result = tryRunSlashCommand("/test");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining(
        "Find and run the tests most relevant",
      ),
      commandName: "test",
    });
  });
});

// ===================================================================
// tryRunSlashCommand — /fix
// ===================================================================

describe("tryRunSlashCommand — /fix", () => {
  it("returns send-prompt with the fix prompt", () => {
    const result = tryRunSlashCommand("/fix");
    expect(result).toEqual({
      kind: "send-prompt",
      prompt: expect.stringContaining(
        "Locate and fix the most recent error",
      ),
      commandName: "fix",
    });
  });
});

// ===================================================================
// Edge cases
// ===================================================================

describe("tryRunSlashCommand — edge cases", () => {
  it("handles leading newlines and spaces", () => {
    const result = tryRunSlashCommand("\n  \n/review");
    expect(result.kind).toBe("send-prompt");
    expect((result as { kind: "send-prompt"; commandName?: string }).commandName).toBe("review");
  });

  it("handles tab characters in input", () => {
    const result = tryRunSlashCommand("\t/test\t");
    expect(result.kind).toBe("send-prompt");
    expect((result as { kind: "send-prompt"; commandName?: string }).commandName).toBe("test");
  });

  it("case-sensitive: /Plan is not /plan", () => {
    expect(tryRunSlashCommand("/Plan")).toEqual({ kind: "none" });
  });

  it("does not match commands embedded in larger strings", () => {
    expect(tryRunSlashCommand("say /init please")).toEqual({ kind: "none" });
    expect(tryRunSlashCommand("prefix/test")).toEqual({ kind: "none" });
  });

  it("matches the last command-like token when multiple / are present", () => {
    // The first / triggers parsing, so /a /b -> head is "a", tail is "/b"
    const result = tryRunSlashCommand("/a /b");
    expect(result).toEqual({ kind: "none" }); // "a" is not a known command
  });
});
