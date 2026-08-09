import { describe, expect, it } from "vitest";
import {
  concurrencyRank,
  isConcurrencySafe,
  isParallelSafe,
} from "./concurrency";

describe("concurrency-safe annotation (R28 #5)", () => {
  it("marks read-only tools fully safe", () => {
    expect(isConcurrencySafe("read_file")).toBe(true);
    expect(isConcurrencySafe("grep")).toBe(true);
    expect(isConcurrencySafe("git_status")).toBe(true);
    expect(isConcurrencySafe("web_search")).toBe(true);
    expect(concurrencyRank("read_file")).toBe(2);
  });

  it("marks conditional-safe write tools", () => {
    expect(concurrencyRank("write_file")).toBe(1);
    expect(concurrencyRank("edit")).toBe(1);
    expect(concurrencyRank("multi_edit")).toBe(1);
    expect(isConcurrencySafe("write_file")).toBe(false);
  });

  it("marks mutating/shell tools unsafe", () => {
    expect(concurrencyRank("bash_run")).toBe(0);
    expect(concurrencyRank("bash_background")).toBe(0);
    expect(concurrencyRank("delete_file")).toBe(0);
    expect(concurrencyRank("git_commit")).toBe(0);
    expect(concurrencyRank("run_subagent")).toBe(0);
    expect(concurrencyRank("delegate_many")).toBe(0);
  });

  it("parallel-safe only for read-only sets", () => {
    expect(isParallelSafe(["read_file", "grep", "glob"])).toBe(true);
    expect(isParallelSafe(["read_file", "write_file"])).toBe(true); // conditional
    expect(isParallelSafe(["read_file", "bash_run"])).toBe(false);
    expect(isParallelSafe([])).toBe(true);
  });
});
