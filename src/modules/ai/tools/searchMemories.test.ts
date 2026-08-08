import { describe, expect, it } from "vitest";
import {
  extractSessionText,
  scoreHit,
  searchEntries,
  snippetAround,
  type MemorySearchEntry,
} from "./searchMemories";

describe("extractSessionText", () => {
  it("flattens text parts with role labels and skips empty/non-text parts", () => {
    const out = extractSessionText([
      {
        role: "user",
        parts: [
          { type: "text", text: "how do we deploy?" },
          { type: "text", text: "  " },
        ],
      },
      { role: "assistant", parts: [{ type: "text", text: "use pnpm" }] },
    ]);
    expect(out).toContain("[user] how do we deploy?");
    expect(out).toContain("[assistant] use pnpm");
  });
});

describe("scoreHit", () => {
  it("counts occurrences of each query word", () => {
    expect(scoreHit("deploy deploy", ["deploy"])).toBe(2);
    expect(scoreHit("Deploy and deploy", ["deploy"])).toBe(2);
    expect(scoreHit("nothing here", ["deploy"])).toBe(0);
    expect(scoreHit("a b a", ["a", "b"])).toBe(3);
  });
});

describe("snippetAround", () => {
  it("slices around the first hit with ellipses", () => {
    const text = `${"x".repeat(30)}needle${"y".repeat(30)}`;
    const s = snippetAround(text, ["needle"], 30);
    expect(s).toContain("needle");
    expect(s.length).toBeLessThanOrEqual(30 + 2);
    expect(s.startsWith("…") || s.endsWith("…")).toBe(true);
  });

  it("returns a head slice when nothing matches", () => {
    expect(snippetAround("abcdef", ["zzz"], 4)).toBe("abcd");
  });
});

describe("searchEntries", () => {
  const entries: MemorySearchEntry[] = [
    { kind: "session", title: "部署排查", time: 2, text: "讨论了 deploy 流程和回滚" },
    { kind: "session", title: "无关会话", time: 3, text: "闲聊天气" },
    { kind: "memory", title: "项目记忆", time: 1, text: "我们使用 pnpm 部署" },
  ];

  it("ranks by hit count and returns top N with snippets", () => {
    const res = searchEntries(entries, "deploy pnpm");
    expect(res.length).toBe(2);
    expect(res[0].kind).toBe("session"); // "deploy" hit
    expect(res[0].score).toBeGreaterThan(0);
    expect(res[0].snippet).toContain("deploy");
    // memory entry contains "pnpm" but not "deploy" — one word hit
    expect(res.some((r) => r.kind === "memory")).toBe(true);
  });

  it("returns empty for empty query or no match", () => {
    expect(searchEntries(entries, "")).toEqual([]);
    expect(searchEntries(entries, "   ")).toEqual([]);
    expect(searchEntries(entries, "不存在词xyz")).toEqual([]);
  });

  it("caps results at topN", () => {
    const many: MemorySearchEntry[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "session",
      title: `s${i}`,
      time: i,
      text: `hit${i} needle`,
    }));
    expect(searchEntries(many, "needle", 5)).toHaveLength(5);
  });
});
