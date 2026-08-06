import { describe, expect, it } from "vitest";
import { explorerGitTextClass } from "./gitStatusColor";

describe("explorerGitTextClass", () => {
  it("colors modified files amber", () => {
    expect(explorerGitTextClass("M")).toBe("text-amber-200/85");
  });

  it("colors added and untracked files green", () => {
    expect(explorerGitTextClass("A")).toBe("text-[#73C991]/90");
    expect(explorerGitTextClass("U")).toBe("text-[#73C991]/90");
  });

  it("colors renamed files sky", () => {
    expect(explorerGitTextClass("R")).toBe("text-sky-300/85");
  });

  it("colors deleted files rose", () => {
    expect(explorerGitTextClass("D")).toBe("text-rose-200/80");
  });
});
