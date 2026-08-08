import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  historyCommands,
  historyList,
  historyRecord,
  historySuggest,
} from "./history";

const mockInvoke = vi.mocked(invoke);

describe("history", () => {
  it("historySuggest forwards the line and resolves the match", async () => {
    mockInvoke.mockResolvedValue("pnpm dev");
    await expect(historySuggest("pnpm d")).resolves.toBe("pnpm dev");
    expect(mockInvoke).toHaveBeenCalledWith("history_suggest", { line: "pnpm d" });
  });

  it("historySuggest resolves null on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(historySuggest("x")).resolves.toBeNull();
  });

  it("historyCommands forwards prefix and default limit", async () => {
    mockInvoke.mockResolvedValue(["a", "b"]);
    await expect(historyCommands("gi")).resolves.toEqual(["a", "b"]);
    expect(mockInvoke).toHaveBeenCalledWith("history_commands", {
      prefix: "gi",
      limit: 50,
    });
  });

  it("historyCommands forwards an explicit limit and falls back to []", async () => {
    mockInvoke.mockResolvedValue(["x"]);
    await historyCommands("gi", 10);
    expect(mockInvoke).toHaveBeenCalledWith("history_commands", {
      prefix: "gi",
      limit: 10,
    });
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(historyCommands("gi")).resolves.toEqual([]);
  });

  it("historyList forwards query and default limit", async () => {
    mockInvoke.mockResolvedValue(["c"]);
    await expect(historyList("git")).resolves.toEqual(["c"]);
    expect(mockInvoke).toHaveBeenCalledWith("history_list", {
      query: "git",
      limit: 200,
    });
  });

  it("historyList falls back to [] on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("boom"));
    await expect(historyList("x")).resolves.toEqual([]);
  });

  it("historyRecord fires and swallows errors", async () => {
    mockInvoke.mockResolvedValue(undefined);
    historyRecord("echo hi");
    await vi.waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("history_record", {
        command: "echo hi",
      }),
    );
    mockInvoke.mockRejectedValue(new Error("boom"));
    historyRecord("bad");
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
  });
});
