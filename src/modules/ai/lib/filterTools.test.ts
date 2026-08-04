import { describe, expect, it } from "vitest";
import { filterTools } from "./agent";

const tools = { read_file: 1, write_file: 2, grep: 3, bash_run: 4 } as const;

describe("filterTools (skill allowlist)", () => {
  it("returns the full toolset when allowlist is undefined or empty", () => {
    expect(filterTools(tools, undefined)).toBe(tools);
    expect(filterTools(tools, [])).toBe(tools);
  });

  it("keeps only allowed tools", () => {
    const out = filterTools(tools, ["read_file", "grep"]);
    expect(Object.keys(out)).toEqual(["read_file", "grep"]);
  });

  it("ignores unknown ids in the allowlist without crashing", () => {
    const out = filterTools(tools, ["read_file", "does_not_exist"]);
    expect(Object.keys(out)).toEqual(["read_file"]);
  });

  it("returns an empty registry when nothing matches", () => {
    expect(Object.keys(filterTools(tools, ["nope"]))).toEqual([]);
  });
});
