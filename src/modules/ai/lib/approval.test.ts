import { describe, expect, it } from "vitest";
import {
  applyApproval,
  createApprovalMemory,
  resetApprovalMemory,
  resolveApproval,
} from "./approval";

describe("resolveApproval (cascade auto-approve)", () => {
  it("returns auto:false when nothing is remembered", () => {
    const mem = createApprovalMemory();
    expect(
      resolveApproval(mem, { target: "run_command", scope: "s1" }).auto,
    ).toBe(false);
  });

  it("auto-approves a target previously set to always", () => {
    const mem = createApprovalMemory();
    applyApproval(mem, { target: "run_command", scope: "s1" }, "always");
    const r = resolveApproval(mem, { target: "run_command", scope: "s1" });
    expect(r.auto).toBe(true);
    if (r.auto) expect(r.outcome.decision).toBe("always");
  });

  it("cascade-approves a child request in an always-approved scope", () => {
    const mem = createApprovalMemory();
    applyApproval(mem, { target: "edit", scope: "graph-run-1" }, "always");
    // A descendant tool in the same graph scope auto-approves.
    const r = resolveApproval(mem, { target: "bash_run", scope: "graph-run-1" });
    expect(r.auto).toBe(true);
  });
});

describe("applyApproval (tri-state)", () => {
  it("always remembers target + scope; once/reject remember nothing", () => {
    const mem = createApprovalMemory();
    applyApproval(mem, { target: "t", scope: "s" }, "always");
    expect(mem.always.has("t")).toBe(true);
    expect(mem.alwaysScopes.has("s")).toBe(true);

    applyApproval(mem, { target: "u", scope: "s2" }, "once");
    expect(mem.always.has("u")).toBe(false);
  });

  it("reject returns feedback to feed back to the model", () => {
    const mem = createApprovalMemory();
    const out = applyApproval(
      mem,
      { target: "t", scope: "s" },
      "reject",
      "do not use rm -rf",
    );
    expect(out.decision).toBe("reject");
    expect(out.feedback).toBe("do not use rm -rf");
    // Reject must not arm any auto-approve.
    expect(mem.always.has("t")).toBe(false);
  });

  it("always returns empty feedback", () => {
    const mem = createApprovalMemory();
    const out = applyApproval(mem, { target: "t", scope: "s" }, "always", "x");
    expect(out.feedback).toBe("");
  });
});

describe("resetApprovalMemory", () => {
  it("clears all always memory", () => {
    const mem = createApprovalMemory();
    applyApproval(mem, { target: "t", scope: "s" }, "always");
    resetApprovalMemory(mem);
    expect(mem.always.size).toBe(0);
    expect(mem.alwaysScopes.size).toBe(0);
  });
});
