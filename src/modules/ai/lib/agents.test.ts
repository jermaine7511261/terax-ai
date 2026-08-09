import { describe, expect, it } from "vitest";
import {
  type Agent,
  BUILTIN_AGENTS,
  findAgent,
  mergeAgentOverrides,
  selectablePrimaryAgents,
  selectableSubagentAgents,
} from "./agents";

const custom: Agent = {
  id: "a-1",
  name: "Mine",
  description: "",
  instructions: "",
  icon: "spark",
  builtIn: false,
};

const all = [...BUILTIN_AGENTS, custom];

describe("BUILTIN_AGENTS", () => {
  it("all carry unique ids and the builtIn flag", () => {
    const ids = BUILTIN_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_AGENTS.every((a) => a.builtIn)).toBe(true);
  });
});

describe("findAgent", () => {
  it("returns the agent whose id matches", () => {
    expect(findAgent(all, "a-1")).toBe(custom);
  });

  it("falls back to the first builtin for a missing id", () => {
    expect(findAgent(all, "does-not-exist")).toBe(BUILTIN_AGENTS[0]);
  });

  it("falls back to the first builtin for null, undefined, or empty id", () => {
    expect(findAgent(all, null)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, undefined)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, "")).toBe(BUILTIN_AGENTS[0]);
  });
});

describe("mergeAgentOverrides (P1-0 agent schema)", () => {
  const builtins: readonly Agent[] = [
    {
      id: "builtin:coder",
      name: "Coder",
      description: "d",
      instructions: "i",
      icon: "coder",
      builtIn: true,
    },
  ];

  it("appends a new custom agent when the name is unknown", () => {
    const merged = mergeAgentOverrides(builtins, [
      { name: "Helper", instructions: "hi" },
    ]);
    expect(merged.length).toBe(2);
    expect(merged[1].name).toBe("Helper");
    expect(merged[1].builtIn).toBe(false);
  });

  it("overrides a builtin of the same name ( same-name override)", () => {
    const merged = mergeAgentOverrides(builtins, [
      { name: "Coder", instructions: "new instructions", mode: "all" },
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0].instructions).toBe("new instructions");
    expect(merged[0].mode).toBe("all");
    expect(merged[0].builtIn).toBe(true);
  });

  it("disabled:true removes the builtin of that name", () => {
    const merged = mergeAgentOverrides(builtins, [
      { name: "Coder", disabled: true },
    ]);
    expect(merged.length).toBe(0);
  });

  it("does not mutate the input builtins", () => {
    const before = builtins[0].instructions;
    mergeAgentOverrides(builtins, [{ name: "Coder", instructions: "x" }]);
    expect(builtins[0].instructions).toBe(before);
  });
});

describe("selectable agents (mode/hidden filtering)", () => {
  const sample: Agent[] = [
    { id: "a", name: "A", description: "", instructions: "", icon: "spark", builtIn: true, mode: "all" },
    { id: "b", name: "B", description: "", instructions: "", icon: "spark", builtIn: true, mode: "subagent" },
    { id: "c", name: "C", description: "", instructions: "", icon: "spark", builtIn: true, mode: "primary" },
    { id: "d", name: "D", description: "", instructions: "", icon: "spark", builtIn: true, hidden: true },
    { id: "e", name: "E", description: "", instructions: "", icon: "spark", builtIn: true },
  ];

  it("primary picker excludes subagent-only + hidden agents", () => {
    const ids = selectablePrimaryAgents(sample).map((a) => a.id);
    expect(ids).toEqual(["a", "c", "e"]);
  });

  it("subagent picker excludes primary-only + hidden agents", () => {
    const ids = selectableSubagentAgents(sample).map((a) => a.id);
    expect(ids).toEqual(["a", "b", "e"]);
  });
});
