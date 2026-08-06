import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import type { EditorFormatter } from "@/modules/settings/store";
import {
  FORMATTERS,
  FORMATTER_LABELS,
  applyFormattedContent,
  resolveFormatter,
  runExternalFormatter,
} from "./externalFormat";

const mockInvoke = vi.mocked(invoke);

type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
};

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const prefs = (over: Partial<{
  editorFormatter: EditorFormatter;
  editorFormatterByLang: Record<string, EditorFormatter>;
}> = {}): {
  editorFormatter: EditorFormatter;
  editorFormatterByLang: Record<string, EditorFormatter>;
} => ({
  editorFormatter: "biome",
  editorFormatterByLang: {},
  ...over,
});

describe("FORMATTERS / FORMATTER_LABELS", () => {
  it("declares a command and label for every built-in formatter", () => {
    expect(FORMATTERS.biome.command).toBe("biome format --write");
    expect(FORMATTERS.ruff.langs).toContain("py");
    expect(FORMATTERS.gofmt.langs).toContain("go");
    expect(FORMATTERS.shfmt.langs).toEqual(["sh", "bash", "zsh"]);
  });

  it("mirrors formatter labels into FORMATTER_LABELS", () => {
    for (const [id, def] of Object.entries(FORMATTERS)) {
      expect(FORMATTER_LABELS[id as keyof typeof FORMATTER_LABELS]).toBe(
        def.label,
      );
    }
    expect(FORMATTER_LABELS.lsp).toBe("Language server");
    expect(FORMATTER_LABELS.custom).toBe("Custom command");
  });
});

describe("resolveFormatter", () => {
  it("returns an explicit per-language override without consulting the global", () => {
    const p = prefs({
      editorFormatter: "lsp",
      editorFormatterByLang: { py: "ruff" },
    });
    expect(resolveFormatter("py", p)).toBe("ruff");
  });

  it("returns the global for lsp and custom defaults", () => {
    expect(resolveFormatter("py", prefs({ editorFormatter: "lsp" }))).toBe(
      "lsp",
    );
    expect(resolveFormatter("py", prefs({ editorFormatter: "custom" }))).toBe(
      "custom",
    );
  });

  it("applies a tool-based global only to languages it understands", () => {
    // biome understands ts but not py.
    expect(resolveFormatter("ts", prefs({ editorFormatter: "biome" }))).toBe(
      "biome",
    );
    expect(resolveFormatter("py", prefs({ editorFormatter: "biome" }))).toBe(
      "lsp",
    );
  });

  it("treats a null language as needing an override or lsp fallback", () => {
    expect(resolveFormatter(null, prefs({ editorFormatter: "biome" }))).toBe(
      "lsp",
    );
    expect(
      resolveFormatter(null, prefs({ editorFormatterByLang: { x: "gofmt" } })),
    ).toBe("lsp");
  });
});

describe("runExternalFormatter", () => {
  const out = (o: Partial<CommandOutput> = {}): CommandOutput => ({
    stdout: "",
    stderr: "",
    exit_code: 0,
    timed_out: false,
    ...o,
  });

  it("runs the in-place command with the quoted path and file dirname", async () => {
    mockInvoke.mockResolvedValue(out());
    const res = await runExternalFormatter("biome", "C:\\dir\\file.ts");
    expect(res).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("shell_run_command", {
      command: "biome format --write 'C:\\dir\\file.ts'",
      cwd: "C:/dir",
      timeoutSecs: 20,
      workspace: { kind: "local" },
    });
  });

  it("returns null on success", async () => {
    mockInvoke.mockResolvedValue(out());
    expect(await runExternalFormatter("gofmt", "/a/b/main.go")).toBeNull();
  });

  it("reports a timeout", async () => {
    mockInvoke.mockResolvedValue(out({ timed_out: true }));
    expect(await runExternalFormatter("rustfmt", "/a.rs")).toBe(
      "rustfmt timed out",
    );
  });

  it("surfaces a truncated stderr on non-zero exit", async () => {
    mockInvoke.mockResolvedValue(
      out({ exit_code: 1, stderr: "   syntax error near line 100  " }),
    );
    expect(await runExternalFormatter("biome", "/a.ts")).toBe(
      "syntax error near line 100",
    );
  });

  it("falls back to a generic failure message when stderr is empty", async () => {
    mockInvoke.mockResolvedValue(out({ exit_code: 2 }));
    expect(await runExternalFormatter("ruff", "/a.py")).toBe("ruff failed");
  });

  it("propagates invoke rejections as an error string", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    expect(await runExternalFormatter("gofmt", "/a.go")).toBe("Error: boom");
  });

  it("refuses a custom formatter with an empty template", async () => {
    expect(await runExternalFormatter("custom", "/a.ts", "  ")).toBe(
      "No custom format command configured in Settings.",
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("expands {file} placeholders in a custom template", async () => {
    mockInvoke.mockResolvedValue(out());
    await runExternalFormatter("custom", "/a.ts", "npx biome check {file}");
    expect(mockInvoke).toHaveBeenCalledWith("shell_run_command", {
      command: "npx biome check '/a.ts'",
      cwd: "/",
      timeoutSecs: 20,
      workspace: { kind: "local" },
    });
  });

  it("appends the quoted path when a custom template has no placeholder", async () => {
    mockInvoke.mockResolvedValue(out());
    await runExternalFormatter("custom", "/a.ts", "my-fmt --fix");
    expect(mockInvoke).toHaveBeenCalledWith("shell_run_command", {
      command: "my-fmt --fix '/a.ts'",
      cwd: "/",
      timeoutSecs: 20,
      workspace: { kind: "local" },
    });
  });
});

describe("applyFormattedContent", () => {
  function fakeView(current: string): EditorView {
    return {
      state: { doc: { toString: () => current } },
      dispatch: vi.fn(),
    } as unknown as EditorView;
  }

  it("does nothing when the document is unchanged", () => {
    const view = fakeView("same");
    applyFormattedContent(view, "same");
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches the minimal change when only a tail differs", () => {
    const view = fakeView("hello world");
    applyFormattedContent(view, "hello there");
    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 6, to: 11, insert: "there" },
    });
  });

  it("trims the common suffix so a head-only change stays minimal", () => {
    const view = fakeView("abc123");
    applyFormattedContent(view, "xyz123");
    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 3, insert: "xyz" },
    });
  });

  it("replaces the whole document when nothing is shared", () => {
    const view = fakeView("aaaa");
    applyFormattedContent(view, "bbbb");
    expect(view.dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 4, insert: "bbbb" },
    });
  });
});
