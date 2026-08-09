// WebUI M1 smoke test: exercises the registry + handlers without a real
// WebSocket by invoking execute() directly (the registry is the same code the
// server's WS loop dispatches to). Covers workspace/fs/shell domains.
import { describe, expect, it } from "vitest";
import "./handlers/workspace";
import "./handlers/fs";
import "./handlers/shell";
import "./handlers/git";
import "./handlers/history";
import { listCommands, execute } from "./registry";
import { setInitialRoot } from "./handlers/workspace";
import { _resetHistoryForTests } from "./handlers/history";

describe("web server registry (WebUI M1)", () => {
  it("registers the workspace/fs/shell command surface", () => {
    const cmds = listCommands();
    expect(cmds).toContain("workspace_current_dir");
    expect(cmds).toContain("workspace_authorize");
    expect(cmds).toContain("fs_read_file");
    expect(cmds).toContain("fs_write_file");
    expect(cmds).toContain("fs_read_dir");
    expect(cmds).toContain("fs_grep");
    expect(cmds).toContain("fs_canonicalize");
    expect(cmds).toContain("fs_create_dir");
    expect(cmds).toContain("fs_delete");
    expect(cmds).toContain("fs_rename");
    expect(cmds).toContain("shell_run_command");
    // WebUI 服务端域扩展.
    expect(cmds).toContain("git_resolve_repo");
    expect(cmds).toContain("git_status");
    expect(cmds).toContain("git_log");
    expect(cmds).toContain("git_diff");
    expect(cmds).toContain("git_list_branches");
    expect(cmds).toContain("history_record");
    expect(cmds).toContain("history_list");
    expect(cmds).toContain("history_suggest");
  });

  it("git handlers work against the repo (read-only)", async () => {
    setInitialRoot(".");
    // This repo is a git repo, so status/log resolve without error.
    const status = await execute("git_status", { cwd: "." });
    expect((status as { entries: unknown[] }).entries).toBeInstanceOf(Array);
    const log = await execute("git_log", { cwd: ".", limit: 5 });
    expect((log as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });

  it("git commands outside a repo error cleanly", async () => {
    setInitialRoot("/");
    await expect(execute("git_resolve_repo", { cwd: "/" })).rejects.toThrow();
  });

  it("history record/list/suggest round-trip", async () => {
    _resetHistoryForTests();
    await execute("history_record", { command: "pnpm build" });
    await execute("history_record", { command: "pnpm test" });
    const list = (await execute("history_list", { limit: 10 })) as string[];
    expect(list).toEqual(["pnpm build", "pnpm test"]);
    const sug = (await execute("history_suggest", { prefix: "pnpm t" })) as string[];
    expect(sug).toEqual(["pnpm test"]);
  });

  it("workspace_current_dir returns the initial root", () => {
    setInitialRoot("/fake/ws");
    return expect(execute("workspace_current_dir", {})).resolves.toBe("/fake/ws");
  });

  it("workspace_authorize validates the path is a directory", async () => {
    setInitialRoot("/tmp");
    // Non-existent path → error.
    await expect(
      execute("workspace_authorize", { path: "/no/such/dir/xyz" }),
    ).rejects.toThrow();
  });

  it("fs_read_file returns text content for a real file", async () => {
    setInitialRoot(".");
    const out = await execute("fs_read_file", { path: "package.json" });
    expect(out).toMatchObject({ kind: "text" });
    expect((out as { content: string }).content).toContain('"name"');
  });

  it("fs_read_dir lists entries with kind/size/mtime", async () => {
    setInitialRoot(".");
    const out = (await execute("fs_read_dir", { path: "." })) as Array<{
      name: string;
      kind: string;
      size: number;
    }>;
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((e) => e.name === "package.json" && e.kind === "file")).toBe(true);
    expect(out.some((e) => e.name === "src" && e.kind === "dir")).toBe(true);
  });

  it("fs_write_file then fs_read_file round-trips", async () => {
    setInitialRoot(".");
    await execute("fs_write_file", { path: ".web-smoke.txt", content: "hi" });
    const out = await execute("fs_read_file", { path: ".web-smoke.txt" });
    expect(out).toMatchObject({ kind: "text", content: "hi" });
    // Clean up.
    await execute("fs_delete", { path: ".web-smoke.txt" });
  });

  it("fs_grep finds matches in the repo", async () => {
    setInitialRoot(".");
    const out = await execute("fs_grep", {
      pattern: "workspace_current_dir",
      root: "src/platform/web/server",
      maxResults: 10,
    });
    expect((out as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
  });

  it("shell_run_command returns stdout and exit code", async () => {
    setInitialRoot(".");
    const out = await execute("shell_run_command", {
      command: "node -e \"process.stdout.write('web-ok')\"",
      cwd: ".",
      timeoutSecs: 10,
    });
    expect(out).toMatchObject({ stdout: "web-ok", exit_code: 0 });
  });

  it("unknown command throws", async () => {
    await expect(execute("nope", {})).rejects.toThrow(/Unknown command/);
  });
});

describe("web server security (MUST, round-25 全量优化)", () => {
  it("rejects paths that escape the workspace", async () => {
    setInitialRoot(".");
    await expect(execute("fs_read_file", { path: "../package.json" })).rejects.toThrow(
      /escapes workspace/,
    );
    await expect(execute("fs_read_file", { path: "/etc/passwd" })).rejects.toThrow(
      /escapes workspace/,
    );
    await expect(execute("fs_write_file", { path: "../x.txt", content: "x" })).rejects.toThrow(
      /escapes workspace/,
    );
  });

  it("refuses sensitive files on read and write", async () => {
    setInitialRoot(".");
    // .env / .ssh are inside the workspace but still refused.
    await expect(execute("fs_read_file", { path: "src/.env" })).rejects.toThrow(/sensitive/);
    await expect(execute("fs_read_file", { path: ".ssh/id_rsa" })).rejects.toThrow(/sensitive/);
    await expect(execute("fs_write_file", { path: "x/.env", content: "k=v" })).rejects.toThrow(
      /sensitive/,
    );
  });

  it("does not expose mutating git/shell commands", async () => {
    await expect(execute("git_commit", {})).rejects.toThrow(/not allowed in web mode/);
    await expect(execute("git_stage", {})).rejects.toThrow(/not allowed in web mode/);
    await expect(execute("git_push", {})).rejects.toThrow(/not allowed in web mode/);
    await expect(execute("shell_bg_spawn", {})).rejects.toThrow(/not allowed in web mode/);
    await expect(execute("pty_open", {})).rejects.toThrow(/not allowed in web mode/);
  });

  it("rejects a cwd outside the workspace for shell", async () => {
    setInitialRoot(".");
    await expect(
      execute("shell_run_command", { command: "echo hi", cwd: "..", timeoutSecs: 5 }),
    ).rejects.toThrow(/escapes workspace/);
  });

  it("caps oversized writes", async () => {
    setInitialRoot(".");
    const big = "x".repeat(5 * 1024 * 1024);
    await expect(execute("fs_write_file", { path: "big.txt", content: big })).rejects.toThrow(
      /exceeds/,
    );
  });

  it("clamps git_log limit so negative values can't reach the shell", async () => {
    setInitialRoot(".");
    const neg = await execute("git_log", { cwd: ".", limit: -5 });
    expect((neg as { entries: unknown[] }).entries).toBeInstanceOf(Array);
    const huge = await execute("git_log", { cwd: ".", limit: 99999 });
    expect((huge as { entries: unknown[] }).entries.length).toBeLessThanOrEqual(500);
  });

  it("reports truncated=true when grep hits the cap", async () => {
    setInitialRoot(".");
    const out = await execute("fs_grep", {
      pattern: "register",
      root: "src/platform/web/server",
      maxResults: 1,
    });
    expect((out as { truncated: boolean }).truncated).toBe(true);
  });
});
