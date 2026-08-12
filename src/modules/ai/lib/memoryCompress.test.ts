import { describe, expect, it } from "vitest";
import {
  compressMemory,
  isSummaryLine,
  MEMORY_CAP,
  MEMORY_SUMMARY_PREFIX,
  type CompressibleLine,
} from "./memoryCompress";

function line(content: string, createdAt?: number): CompressibleLine {
  return createdAt === undefined ? { content } : { content, createdAt };
}

const DEFAULT_OPTS = {
  thresholdRatio: 0.5, // cap 100 → trigger at > 50
  targetRatio: 0.2, // settle near 20 entries
  protectRecent: 20,
};

describe("compressMemory (R32.5 ratio model)", () => {
  it("no-ops below threshold (≤ cap × thresholdRatio)", () => {
    const entries = Array.from({ length: 50 }, (_, i) => line(`f-${i}`));
    const r = compressMemory(entries, DEFAULT_OPTS);
    expect(r.kept).toBe(entries);
    expect(r.summary).toBe("");
    expect(r.compressed).toBe(0);
  });

  it("merges oldest beyond settle target, protecting recent 20", () => {
    // 55 entries (exceeds 50 trigger). Pool = 55 − 20 protected = 35.
    // keepFromPool = round(100 × 0.2) − 20 = 0 → merge all 35 oldest.
    const entries: CompressibleLine[] = [];
    for (let i = 0; i < 35; i++) entries.push(line(`old-${i}`));
    for (let i = 0; i < 20; i++) entries.push(line(`new-${i}`, 1_000 + i));
    const r = compressMemory(entries, DEFAULT_OPTS);
    expect(r.compressed).toBe(35);
    expect(r.summary.startsWith(MEMORY_SUMMARY_PREFIX)).toBe(true);
    // 55 − 35 merged = 20 kept (summary appended by caller).
    expect(r.kept.length).toBe(20);
    expect(r.kept.some((e) => e.content === "old-0")).toBe(false);
    // All protected newest entries survive.
    for (let i = 0; i < 20; i++) {
      expect(r.kept.some((e) => e.content === `new-${i}`)).toBe(true);
    }
  });

  it("keeps cap × targetRatio − protectRecent pool entries when target exceeds protect", () => {
    // cap 100, targetRatio 0.5 → settle 50; protect 10 → keep 40 from pool.
    const entries: CompressibleLine[] = [];
    for (let i = 0; i < 60; i++) entries.push(line(`old-${i}`, i));
    const r = compressMemory(entries, {
      thresholdRatio: 0.3, // trigger at > 30
      targetRatio: 0.5,
      protectRecent: 10,
    });
    // pool = 60 − 10 = 50; keep newest 40, merge 10 oldest.
    expect(r.compressed).toBe(10);
    expect(r.kept.some((e) => e.content === "old-0")).toBe(false);
    expect(r.kept.some((e) => e.content === "old-9")).toBe(false);
    expect(r.kept.some((e) => e.content === "old-10")).toBe(true);
  });

  it("never re-merges an existing summary line", () => {
    const entries: CompressibleLine[] = [
      line("first"),
      line(`${MEMORY_SUMMARY_PREFIX} 旧记忆摘要：earlier stuff`),
      ...Array.from({ length: 55 }, (_, i) => line(`fact-${i}`, i)),
    ];
    const r = compressMemory(entries, DEFAULT_OPTS);
    expect(
      r.kept.some((e) => e.content.startsWith(MEMORY_SUMMARY_PREFIX)),
    ).toBe(true);
    // The pre-existing summary must not be merged into the new one.
    expect(r.summary).not.toContain("earlier stuff");
  });

  it("protectRecent >= entries → nothing merges", () => {
    const entries = Array.from({ length: 60 }, (_, i) => line(`f-${i}`, i));
    const r = compressMemory(entries, {
      thresholdRatio: 0.2,
      targetRatio: 0.2,
      protectRecent: 100,
    });
    expect(r.compressed).toBe(0);
    expect(r.summary).toBe("");
  });

  it("empty pool after protection → no-op", () => {
    const entries = Array.from({ length: 60 }, (_, i) => line(`f-${i}`, i));
    const r = compressMemory(entries, {
      thresholdRatio: 0.2,
      targetRatio: 0.2,
      protectRecent: 60,
    });
    expect(r.compressed).toBe(0);
  });

  it("file lines without createdAt sort oldest-first by position", () => {
    // 55 plain lines: pool = 55 − 20 protected = 35 → all 35 merge (keep 0).
    const entries = Array.from({ length: 55 }, (_, i) => line(`plain-${i}`));
    const r = compressMemory(entries, DEFAULT_OPTS);
    expect(r.compressed).toBe(35);
    expect(r.kept.some((e) => e.content === "plain-0")).toBe(false);
    expect(r.kept.some((e) => e.content === "plain-35")).toBe(true);
  });

  it("bounded summary length", () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      line(`very long fact number ${i} about the project repeated words words`, i),
    );
    const r = compressMemory(entries, DEFAULT_OPTS);
    expect(r.summary.length).toBeLessThanOrEqual(700);
    expect(isSummaryLine({ content: r.summary })).toBe(true);
  });

  it("MEMORY_CAP is 100 (ratio base)", () => {
    expect(MEMORY_CAP).toBe(100);
  });
});
