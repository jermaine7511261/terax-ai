import { beforeEach, describe, expect, it } from "vitest";
import {
  linesFor,
  stoppedAtFor,
  toggleBreakpoint,
  useBreakpointStore,
} from "./breakpoints";

describe("breakpoint store", () => {
  beforeEach(() => {
    // Reset the singleton store between tests.
    useBreakpointStore.setState({ byPath: {}, stoppedAt: null });
  });

  it("toggles a breakpoint on and off for a path", () => {
    toggleBreakpoint("/a/b.py", 5);
    expect(linesFor("/a/b.py")).toEqual([5]);
    toggleBreakpoint("/a/b.py", 5);
    expect(linesFor("/a/b.py")).toEqual([]);
  });

  it("sorts lines", () => {
    toggleBreakpoint("/a/b.py", 10);
    toggleBreakpoint("/a/b.py", 3);
    expect(linesFor("/a/b.py")).toEqual([3, 10]);
  });

  it("scopes breakpoints per path", () => {
    toggleBreakpoint("/a/b.py", 5);
    toggleBreakpoint("/a/c.ts", 8);
    expect(linesFor("/a/b.py")).toEqual([5]);
    expect(linesFor("/a/c.ts")).toEqual([8]);
  });

  it("tracks stoppedAt per path", () => {
    useBreakpointStore.getState().setStoppedAt({ path: "/a/b.py", line: 12 });
    expect(stoppedAtFor("/a/b.py")).toBe(12);
    expect(stoppedAtFor("/a/c.ts")).toBeNull();
    useBreakpointStore.getState().setStoppedAt(null);
    expect(stoppedAtFor("/a/b.py")).toBeNull();
  });
});
