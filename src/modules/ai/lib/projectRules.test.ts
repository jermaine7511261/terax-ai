import { describe, expect, it } from "vitest";
import {
  globToRegex,
  orderRules,
  parseRuleScope,
  ruleActivates,
  standardRules,
} from "./projectRules";

describe("standardRules", () => {
  it("returns only present standard rule files, unscoped", () => {
    const rules = standardRules(["AGENTS.md", "YAMET.md"]);
    expect(rules.map((r) => r.relPath)).toEqual(["AGENTS.md", "YAMET.md"]);
    expect(rules.every((r) => r.scope === "")).toBe(true);
  });
});

describe("parseRuleScope", () => {
  it("extracts the scope glob from frontmatter", () => {
    const md = "---\nscope: src/**\n---\n# Rule\nbody";
    expect(parseRuleScope(md)).toBe("src/**");
  });
  it("returns empty for no frontmatter or no scope", () => {
    expect(parseRuleScope("# Rule\nbody")).toBe("");
    expect(parseRuleScope("---\nname: x\n---\nbody")).toBe("");
  });
});

describe("globToRegex / ruleActivates", () => {
  it("matches ** across depth and * within a segment", () => {
    expect(globToRegex("src/**").test("src/modules/ai/lib/x.ts")).toBe(true);
    expect(globToRegex("src/**").test("package.json")).toBe(false);
    expect(globToRegex("*.rs").test("main.rs")).toBe(true);
    expect(globToRegex("*.rs").test("src/main.rs")).toBe(false);
  });
  it("treats a trailing slash as /**", () => {
    expect(globToRegex("src/").test("src/a/b.ts")).toBe(true);
  });
  it("empty scope activates everything", () => {
    expect(ruleActivates({ relPath: "x.md", scope: "" }, "anything/at/all.rs")).toBe(true);
  });
  it("scoped rule activates only matching paths", () => {
    const rule = { relPath: "AGENTS.md", scope: "src/**" };
    expect(ruleActivates(rule, "src/main.ts")).toBe(true);
    expect(ruleActivates(rule, "docs/readme.md")).toBe(false);
  });
});

describe("orderRules", () => {
  it("orders most-specific scopes first, unscoped last", () => {
    const rules = [
      { relPath: "a", scope: "" },
      { relPath: "b", scope: "src/**/*.ts" },
      { relPath: "c", scope: "src/**" },
    ];
    const ordered = orderRules(rules);
    expect(ordered[0].relPath).toBe("b"); // most specific
    expect(ordered[2].relPath).toBe("a"); // unscoped last
  });
});
