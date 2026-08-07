import { describe, expect, it } from "vitest";
import {
  checkboxValue,
  dirname,
  entryPathLabel,
  statusAccent,
  upstreamBadgeLabel,
} from "./format";
import type { SourceControlFileEntry } from "../useSourceControlPanel";

describe("dirname", () => {
  it("returns the parent directory", () => {
    expect(dirname("src/foo/bar.ts")).toBe("src/foo");
    expect(dirname("foo.ts")).toBe("");
  });

  it("normalizes windows separators", () => {
    expect(dirname("src\\foo\\bar.ts")).toBe("src/foo");
  });
});

describe("entryPathLabel", () => {
  it("shows rename arrow when originalPath exists", () => {
    const entry = {
      path: "new.ts",
      originalPath: "old.ts",
    } as SourceControlFileEntry;
    expect(entryPathLabel(entry)).toBe("old.ts → new.ts");
  });

  it("falls back to the containing directory", () => {
    const entry = { path: "src/foo.ts" } as SourceControlFileEntry;
    expect(entryPathLabel(entry)).toBe("src");
  });
});

describe("upstreamBadgeLabel", () => {
  it("returns the upstream name verbatim", () => {
    expect(upstreamBadgeLabel("origin/main", (k) => k)).toBe("origin/main");
  });

  it("localizes the no-upstream case", () => {
    expect(upstreamBadgeLabel(null, (k) => k)).toBe("git.noUpstream");
    expect(upstreamBadgeLabel(undefined, (k) => k)).toBe("git.noUpstream");
  });
});

describe("statusAccent", () => {
  it("maps known statuses to accents", () => {
    expect(statusAccent("A")).toBe("bg-emerald-500/85");
    expect(statusAccent("M")).toBe("bg-amber-500/85");
    expect(statusAccent("D")).toBe("bg-rose-500/85");
    expect(statusAccent("R")).toBe("bg-sky-500/85");
    expect(statusAccent("U")).toBe("bg-teal-500/85");
  });

  it("falls back for unknown codes", () => {
    expect(statusAccent("?")).toBe("bg-muted-foreground/40");
  });
});

describe("checkboxValue", () => {
  it("maps CheckState to checkbox props", () => {
    expect(checkboxValue("checked")).toBe(true);
    expect(checkboxValue("indeterminate")).toBe("indeterminate");
    expect(checkboxValue("unchecked")).toBe(false);
  });
});
