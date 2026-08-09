import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => "default",
}));

import { invoke } from "@tauri-apps/api/core";
import { native } from "./native";

const mockInvoke = vi.mocked(invoke);

describe("native workspace/fs wrappers", () => {
  it("workspaceCurrentDir calls the command", async () => {
    mockInvoke.mockResolvedValue("/cwd");
    await expect(native.workspaceCurrentDir()).resolves.toBe("/cwd");
    expect(mockInvoke).toHaveBeenCalledWith("workspace_current_dir");
  });

  it("workspaceAuthorize forwards path + workspace", async () => {
    mockInvoke.mockResolvedValue("/ws");
    await native.workspaceAuthorize("/p");
    expect(mockInvoke).toHaveBeenCalledWith("workspace_authorize", {
      path: "/p",
      workspace: "default",
    });
  });

  it("readFile / writeFile forward path and content", async () => {
    mockInvoke.mockResolvedValue({ kind: "text", content: "x", size: 1 });
    await native.readFile("/a");
    expect(mockInvoke).toHaveBeenCalledWith("fs_read_file", {
      path: "/a",
      source: "ai",
      workspace: "default",
    });

    mockInvoke.mockResolvedValue(undefined);
    await native.writeFile("/a", "hi");
    expect(mockInvoke).toHaveBeenCalledWith("fs_write_file", {
      path: "/a",
      content: "hi",
      source: "ai",
      workspace: "default",
      expectedMtime: null,
    });

    // expectedMtime passes through when provided.
    await native.writeFile("/a", "hi", { expectedMtime: 123 });
    expect(mockInvoke).toHaveBeenCalledWith("fs_write_file", {
      path: "/a",
      content: "hi",
      source: "ai",
      workspace: "default",
      expectedMtime: 123,
    });
  });

  it("createDocx / createXlsx / createPptx forward payload + source + workspace", async () => {
    mockInvoke.mockResolvedValue(42);
    await native.createDocx("/o.docx", ["# T"]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_create_docx", {
      path: "/o.docx",
      lines: ["# T"],
      source: "ai",
      workspace: "default",
    });

    await native.createXlsx("/o.xlsx", [["A"]]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_create_xlsx", {
      path: "/o.xlsx",
      rows: [["A"]],
      source: "ai",
      workspace: "default",
    });

    await native.createPptx("/o.pptx", ["S"]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_create_pptx", {
      path: "/o.pptx",
      slides: ["S"],
      source: "ai",
      workspace: "default",
    });
  });

  it("pdfMerge / pdfEncrypt forward paths + source + workspace", async () => {
    mockInvoke.mockResolvedValue(1024);
    await native.pdfMerge(["/a.pdf", "/b.pdf"], "/m.pdf");
    expect(mockInvoke).toHaveBeenCalledWith("fs_pdf_merge", {
      files: ["/a.pdf", "/b.pdf"],
      output: "/m.pdf",
      source: "ai",
      workspace: "default",
    });

    await native.pdfEncrypt("/a.pdf", "/e.pdf", "pw", "owner");
    expect(mockInvoke).toHaveBeenCalledWith("fs_pdf_encrypt", {
      input: "/a.pdf",
      output: "/e.pdf",
      user_password: "pw",
      owner_password: "owner",
      source: "ai",
      workspace: "default",
    });

    // Optional passwords default to null.
    await native.pdfEncrypt("/a.pdf", "/e.pdf");
    expect(mockInvoke).toHaveBeenLastCalledWith("fs_pdf_encrypt", {
      input: "/a.pdf",
      output: "/e.pdf",
      user_password: null,
      owner_password: null,
      source: "ai",
      workspace: "default",
    });
  });

  it("createPdf / editDocx / editXlsx / editPptx forward payload + source", async () => {
    mockInvoke.mockResolvedValue(1);
    await native.createPdf("/o.pdf", ["# T"]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_create_pdf", {
      path: "/o.pdf",
      lines: ["# T"],
      source: "ai",
      workspace: "default",
    });

    await native.editDocx("/d.docx", [["a", "b"]]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_edit_docx", {
      path: "/d.docx",
      replacements: [["a", "b"]],
      source: "ai",
      workspace: "default",
    });

    await native.editPptx("/p.pptx", [["x", "y"]]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_edit_pptx", {
      path: "/p.pptx",
      replacements: [["x", "y"]],
      source: "ai",
      workspace: "default",
    });

    await native.editXlsx("/s.xlsx", [{ sheet: 0, cell: "A1", kind: "number", value: "5" }]);
    expect(mockInvoke).toHaveBeenCalledWith("fs_edit_xlsx", {
      path: "/s.xlsx",
      cells: [{ sheet: 0, cell: "A1", kind: "number", value: "5" }],
      source: "ai",
      workspace: "default",
    });
  });

  it("readDir forces showHidden false for agent safety", async () => {
    mockInvoke.mockResolvedValue([]);
    await native.readDir("/a");
    expect(mockInvoke).toHaveBeenCalledWith("fs_read_dir", {
      path: "/a",
      source: "ai",
      showHidden: false,
      workspace: "default",
    });
  });

  it("grep forwards params with null defaults", async () => {
    mockInvoke.mockResolvedValue({ hits: [], truncated: false, files_scanned: 0 });
    await native.grep({ pattern: "x", root: "/r" });
    expect(mockInvoke).toHaveBeenCalledWith("fs_grep", {
      pattern: "x",
      root: "/r",
      glob: null,
      caseInsensitive: null,
      maxResults: null,
      source: "ai",
      workspace: "default",
    });
  });

  it("runCommand forwards cwd/timeout or nulls", async () => {
    mockInvoke.mockResolvedValue({ stdout: "", stderr: "", exit_code: 0, timed_out: false, truncated: false });
    await native.runCommand("echo hi", "/cwd", 10);
    expect(mockInvoke).toHaveBeenCalledWith("shell_run_command", {
      command: "echo hi",
      cwd: "/cwd",
      timeoutSecs: 10,
      workspace: "default",
    });

    await native.runCommand("echo hi");
    expect(mockInvoke).toHaveBeenLastCalledWith("shell_run_command", {
      command: "echo hi",
      cwd: null,
      timeoutSecs: null,
      workspace: "default",
    });
  });
});

describe("native git wrappers", () => {
  it("gitPanelSnapshot forwards cwd", async () => {
    mockInvoke.mockResolvedValue({ repo: null, status: null });
    await native.gitPanelSnapshot("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_panel_snapshot", {
      cwd: "/r",
      workspace: "default",
    });
  });

  it("gitCommit forwards message", async () => {
    mockInvoke.mockResolvedValue({ commitSha: "abc", summary: "s" });
    await native.gitCommit("/r", "feat: x");
    expect(mockInvoke).toHaveBeenCalledWith("git_commit", {
      repoRoot: "/r",
      message: "feat: x",
      workspace: "default",
    });
  });

  it("gitLog forwards optional limit/beforeSha as nulls when absent", async () => {
    mockInvoke.mockResolvedValue([]);
    await native.gitLog("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_log", {
      repoRoot: "/r",
      limit: null,
      beforeSha: null,
      workspace: "default",
    });
  });

  it("gitDiffContent forwards originalPath null default", async () => {
    mockInvoke.mockResolvedValue({ originalContent: "", modifiedContent: "", isBinary: false, fallbackPatch: "", truncated: false });
    await native.gitDiffContent("/r", "/a", true);
    expect(mockInvoke).toHaveBeenCalledWith("git_diff_content", {
      repoRoot: "/r",
      path: "/a",
      staged: true,
      originalPath: null,
      workspace: "default",
    });
  });

  it("gitPushUpstream forwards remote null default", async () => {
    mockInvoke.mockResolvedValue({ remote: null, branch: null, pushed: true });
    await native.gitPushUpstream("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_push_upstream", {
      repoRoot: "/r",
      remote: null,
      workspace: "default",
    });
  });

  it("gitPull forwards strategy null default", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.gitPull("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_pull", {
      repoRoot: "/r",
      strategy: null,
      workspace: "default",
    });
  });

  it("gitStashSave forwards message null default", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.gitStashSave("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_stash_save", {
      repoRoot: "/r",
      message: null,
      workspace: "default",
    });
  });
});

describe("native shell + misc wrappers", () => {
  it("shellBgLogs forwards sinceOffset null default", async () => {
    mockInvoke.mockResolvedValue({ bytes: "", next_offset: 0, dropped: 0, exited: false, exit_code: null });
    await native.shellBgLogs(7);
    expect(mockInvoke).toHaveBeenCalledWith("shell_bg_logs", { handle: 7, sinceOffset: null });
  });

  it("shellBgKill forwards handle", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.shellBgKill(3);
    expect(mockInvoke).toHaveBeenCalledWith("shell_bg_kill", { handle: 3 });
  });

  it("gitRemoteUrl forwards name null default", async () => {
    mockInvoke.mockResolvedValue("https://x");
    await native.gitRemoteUrl("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_remote_url", {
      repoRoot: "/r",
      name: null,
      workspace: "default",
    });
  });

  it("gitStashPop forwards index null default", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await native.gitStashPop("/r");
    expect(mockInvoke).toHaveBeenCalledWith("git_stash_pop", {
      repoRoot: "/r",
      index: null,
      workspace: "default",
    });
  });
});
