import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  readDir: vi.fn(async () => [] as { name: string; kind: string }[]),
  readFile: vi.fn(async () => ({ kind: "text" as const, content: "" })),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("./native", () => ({ native: nativeMock }));

import { runBackgroundCurator } from "./skillCuratorRunner";

const STALE_MS = 40 * 24 * 60 * 60 * 1000; // 40 days idle

function skillJson(name: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    name,
    prompt: "do it",
    agent_created: true,
    activity_ts: Date.now() - STALE_MS,
    ...over,
  });
}

beforeEach(() => {
  nativeMock.readDir.mockReset();
  nativeMock.readFile.mockReset();
  nativeMock.writeFile.mockReset();
  nativeMock.readDir.mockResolvedValue([]);
  nativeMock.readFile.mockResolvedValue({ kind: "text", content: "" });
  nativeMock.writeFile.mockResolvedValue(undefined);
});

describe("runBackgroundCurator", () => {
  it("skips when the hourly interval has not elapsed", async () => {
    const setLast = vi.fn();
    const res = await runBackgroundCurator("/ws", {
      now: 1_000,
      lastRunAt: 999,
      setLastRunAt: setLast,
    });
    expect(res).toEqual({ ran: false, archived: [] });
    expect(nativeMock.readDir).not.toHaveBeenCalled();
    expect(setLast).not.toHaveBeenCalled();
  });

  it("marks the run even without a workspace root", async () => {
    const setLast = vi.fn();
    const res = await runBackgroundCurator(null, {
      now: 2 * 60 * 60 * 1000, // 2h — past the 1h interval
      lastRunAt: 0,
      setLastRunAt: setLast,
    });
    expect(res).toEqual({ ran: false, archived: [] });
    expect(setLast).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
  });

  it("marks the run when the skills dir is unreadable", async () => {
    nativeMock.readDir.mockRejectedValue(new Error("ENOENT"));
    const setLast = vi.fn();
    const res = await runBackgroundCurator("/ws", {
      now: 2 * 60 * 60 * 1000, // 2h — past the 1h interval
      lastRunAt: 0,
      setLastRunAt: setLast,
    });
    expect(res).toEqual({ ran: false, archived: [] });
    expect(setLast).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
  });

  it("archives a stale agent-created skill by rewriting its file", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "old.json", kind: "file" }]);
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: skillJson("old"),
    });
    const setLast = vi.fn();
    const res = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
      setLastRunAt: setLast,
    });
    expect(res.ran).toBe(true);
    expect(res.archived).toEqual(["old"]);
    expect(nativeMock.writeFile).toHaveBeenCalledWith(
      "/ws/skills/old.json",
      expect.stringContaining('"archived": true'),
    );
    expect(setLast).toHaveBeenCalled();
  });

  it("reads a dir skill via its skill.json path", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "old", kind: "dir" }]);
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: skillJson("old"),
    });
    const res = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
    });
    expect(res.archived).toEqual(["old"]);
    expect(nativeMock.readFile).toHaveBeenCalledWith(
      "/ws/skills/old/skill.json",
    );
  });

  it("skips non-json entries and malformed payloads", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "readme.txt", kind: "file" }]);
    const res = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
    });
    expect(res).toEqual({ ran: true, archived: [] });
    expect(nativeMock.writeFile).not.toHaveBeenCalled();

    nativeMock.readDir.mockResolvedValue([{ name: "x.json", kind: "file" }]);
    nativeMock.readFile.mockResolvedValue({ kind: "text", content: "nope" });
    const res2 = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
    });
    expect(res2).toEqual({ ran: true, archived: [] });
  });

  it("leaves fresh skills alone", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "fresh", kind: "file" }]);
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: skillJson("fresh", { activity_ts: Date.now() }),
    });
    const res = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
    });
    expect(res).toEqual({ ran: true, archived: [] });
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("skips skills whose rewrite fails", async () => {
    nativeMock.readDir.mockResolvedValue([{ name: "old", kind: "file" }]);
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: skillJson("old"),
    });
    nativeMock.writeFile.mockRejectedValue(new Error("readonly"));
    const res = await runBackgroundCurator("/ws", {
      now: Date.now(),
      lastRunAt: 0,
    });
    expect(res).toEqual({ ran: true, archived: [] });
  });
});
