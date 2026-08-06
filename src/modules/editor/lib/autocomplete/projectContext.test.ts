import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ai/lib/native", () => ({
  native: { readFile: vi.fn(), readDir: vi.fn() },
}));

import { native } from "@/modules/ai/lib/native";
import { getProjectContext } from "./projectContext";

const mockNative = vi.mocked(native);

const text = (content: string) => ({ kind: "text" as const, content, size: content.length });
const fileEntry = (
  name: string,
  mtime?: number,
): {
  name: string;
  kind: "file";
  size: number;
  mtime: number;
  gitignored: boolean;
} => ({
  name,
  kind: "file",
  size: 0,
  mtime: mtime ?? 0,
  gitignored: false,
});

beforeEach(() => {
  mockNative.readFile.mockReset();
  mockNative.readDir.mockReset();
  mockNative.readDir.mockResolvedValue([]); // default: no siblings
  vi.useRealTimers();
});

describe("getProjectContext", () => {
  it("resolves null for a null file path without touching disk", async () => {
    await expect(getProjectContext(null)).resolves.toBeNull();
    expect(mockNative.readFile).not.toHaveBeenCalled();
  });

  it("walks up for AGENTS/YAMET/CLAUDE notes and caps them at 6000 chars", async () => {
    const big = "x".repeat(9000);
    mockNative.readFile.mockResolvedValue(text(big));

    const ctx = await getProjectContext("C:\\p1\\src\\deep\\file.ts");
    expect(ctx).not.toBeNull();
    expect(ctx!.notes).toHaveLength(6000);
    expect(ctx!.dir).toBe("C:\\p1\\src\\deep");
  });

  it("prefers AGENTS.md over the later candidates on the same dir", async () => {
    mockNative.readFile.mockImplementation(async (path: string) =>
      path.endsWith("AGENTS.md") ? text("agents") : text("other"),
    );
    const ctx = await getProjectContext("/p2/AGENTS.md");
    expect(ctx!.notes).toBe("agents");
  });

  it("collects sibling source files, most-recently-edited first, capped at 8", async () => {
    mockNative.readDir.mockResolvedValue([
      fileEntry("a.ts", 1),
      fileEntry("b.ts", 3),
      fileEntry("c.ts", 2),
      fileEntry("self.ts", 5), // same as selfPath -> excluded
      fileEntry(".hidden.ts", 4), // dotfile -> excluded
      fileEntry("readme.md", 10), // unsupported ext -> excluded
      ...Array.from({ length: 10 }, (_, i) => fileEntry(`z${i}.rs`, 0)),
    ]);
    mockNative.readFile.mockResolvedValue(text("head"));

    const ctx = await getProjectContext("/p3/src/self.ts");
    // 8 capped; most recent first => b.ts (mtime 3) before a.ts.
    expect(ctx!.siblingSnippets).toHaveLength(8);
    expect(ctx!.siblingSnippets[0].filename).toBe("b.ts");
    expect(
      ctx!.siblingSnippets.every((s) => s.head === "head"),
    ).toBe(true);
  });

  it("caches a directory result so a repeat call skips disk", async () => {
    mockNative.readDir.mockResolvedValue([fileEntry("a.ts", 1)]);
    mockNative.readFile.mockResolvedValue(text("a"));

    await getProjectContext("/p4/a.ts");
    expect(mockNative.readDir).toHaveBeenCalledTimes(1);

    await getProjectContext("/p4/b.ts");
    expect(mockNative.readDir).toHaveBeenCalledTimes(1);
    expect(mockNative.readFile).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cache once the TTL elapses", async () => {
    vi.useFakeTimers();
    mockNative.readDir.mockResolvedValue([fileEntry("a.ts", 1)]);
    mockNative.readFile.mockResolvedValue(text("a"));

    await getProjectContext("/p5/a.ts");
    expect(mockNative.readDir).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    await getProjectContext("/p5/b.ts");
    expect(mockNative.readDir).toHaveBeenCalledTimes(2);
  });

  it("handles a readDir failure as no siblings", async () => {
    mockNative.readDir.mockRejectedValue(new Error("nope"));
    mockNative.readFile.mockResolvedValue(text("n"));
    const ctx = await getProjectContext("/p6/a.ts");
    expect(ctx).not.toBeNull();
    expect(ctx!.siblingSnippets).toEqual([]);
  });

  it("returns null when neither notes nor siblings are found", async () => {
    mockNative.readDir.mockResolvedValue([]);
    mockNative.readFile.mockRejectedValue(new Error("missing"));
    await expect(getProjectContext("/p7/a.ts")).resolves.toBeNull();
  });
});
