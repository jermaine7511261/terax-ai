import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffContentResult } from "@/modules/ai/lib/native";

const nativeMock = vi.hoisted(() => ({
  gitDiffContent: vi.fn(),
  gitCommitFileDiff: vi.fn(),
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceScopeKey: () => "local",
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock }));

import {
  commitDiffKey,
  fetchCommitDiff,
  fetchWorkingDiff,
  getCachedDiff,
  invalidateDiff,
  invalidateRepoDiffs,
  workingDiffKey,
} from "./diffCache";

function diffResult(seed: string): GitDiffContentResult {
  return {
    originalContent: `${seed} original`,
    modifiedContent: `${seed} modified`,
    isBinary: false,
    fallbackPatch: "",
    truncated: false,
  };
}

beforeEach(() => {
  nativeMock.gitDiffContent.mockReset();
  nativeMock.gitCommitFileDiff.mockReset();
});

describe("key builders", () => {
  it("formats a working diff key", () => {
    expect(workingDiffKey("/repo", "src/a.ts", "-")).toBe(
      "local|/repo|w|-|src/a.ts",
    );
  });

  it("formats a commit diff key", () => {
    expect(commitDiffKey("/repo", "abc123", "src/a.ts")).toBe(
      "local|/repo|c|abc123|src/a.ts",
    );
  });
});

describe("fetchWorkingDiff", () => {
  it("caches the result so a second call avoids the native call", async () => {
    nativeMock.gitDiffContent.mockResolvedValue(diffResult("one"));
    const first = await fetchWorkingDiff("/repo", "a.ts", "-", null);
    const second = await fetchWorkingDiff("/repo", "a.ts", "-", null);
    expect(first).toEqual(diffResult("one"));
    expect(second).toBe(first);
    expect(nativeMock.gitDiffContent).toHaveBeenCalledTimes(1);
  });

  it("invalidates a single key", async () => {
    nativeMock.gitDiffContent.mockResolvedValue(diffResult("one"));
    await fetchWorkingDiff("/inv", "a.ts", "-", null);
    const key = workingDiffKey("/inv", "a.ts", "-");
    invalidateDiff(key);
    expect(getCachedDiff(key)).toBeUndefined();
    await fetchWorkingDiff("/inv", "a.ts", "-", null);
    expect(nativeMock.gitDiffContent).toHaveBeenCalledTimes(2);
  });

  it("keeps only the most recent entries (LRU eviction)", async () => {
    nativeMock.gitDiffContent.mockResolvedValue(diffResult("x"));
    // Limit is 6; push 7 distinct keys through so the first is evicted.
    for (let i = 0; i < 7; i += 1) {
      await fetchWorkingDiff("/repo", `f${i}.ts`, "-", null);
    }
    expect(getCachedDiff(workingDiffKey("/repo", "f0.ts", "-"))).toBeUndefined();
    expect(getCachedDiff(workingDiffKey("/repo", "f6.ts", "-"))).toBeDefined();
  });
});

describe("fetchCommitDiff / invalidation", () => {
  it("fetches and caches a commit diff", async () => {
    nativeMock.gitCommitFileDiff.mockResolvedValue(diffResult("commit"));
    const res = await fetchCommitDiff("/repo", "abc", "a.ts", null);
    expect(res).toEqual(diffResult("commit"));
    expect(nativeMock.gitCommitFileDiff).toHaveBeenCalledTimes(1);
    // Second call is served from cache.
    await fetchCommitDiff("/repo", "abc", "a.ts", null);
    expect(nativeMock.gitCommitFileDiff).toHaveBeenCalledTimes(1);
  });

  it("invalidates only the matching repo's cached diffs", async () => {
    nativeMock.gitDiffContent.mockResolvedValue(diffResult("repo"));
    await fetchWorkingDiff("/repoA", "a.ts", "-", null);
    await fetchWorkingDiff("/repoB", "b.ts", "-", null);

    invalidateRepoDiffs("/repoA");

    expect(getCachedDiff(workingDiffKey("/repoA", "a.ts", "-"))).toBeUndefined();
    expect(getCachedDiff(workingDiffKey("/repoB", "b.ts", "-"))).toBeDefined();
  });
});
