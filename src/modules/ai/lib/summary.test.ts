import { describe, expect, it } from "vitest";
import {
  capSummary,
  cutAtBoundary,
  isStructuredOutput,
  PROSE_SUMMARY_CAP,
  STRUCTURED_SUMMARY_CAP,
} from "./summary";

describe("isStructuredOutput", () => {
  it("detects JSON objects and arrays", () => {
    expect(isStructuredOutput('{"claims": []}')).toBe(true);
    expect(isStructuredOutput("[1, 2, 3]")).toBe(true);
  });

  it("detects fenced code blocks", () => {
    expect(isStructuredOutput("```json\n{}\n```")).toBe(true);
    expect(isStructuredOutput("```yaml\nx: 1\n```")).toBe(true);
  });

  it("does not treat prose as structured", () => {
    expect(isStructuredOutput("The fix was straightforward.")).toBe(false);
    expect(isStructuredOutput("- found a bug in src/main.ts")).toBe(false);
    expect(isStructuredOutput("  indented prose")).toBe(false);
  });
});

describe("capSummary", () => {
  it("passes short summaries through unchanged", () => {
    expect(capSummary("short")).toEqual({ text: "short", truncated: false });
  });

  it("never truncates structured output under the structured cap", () => {
    const json = `{"claims":${'["x",'.repeat(4000)}[]]}`;
    expect(json.length).toBeGreaterThan(PROSE_SUMMARY_CAP);
    const r = capSummary(json, 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(json);
  });

  it("cuts a runaway structured blob at the structured cap", () => {
    const huge = `[${"x".repeat(STRUCTURED_SUMMARY_CAP + 10)}]`;
    const r = capSummary(huge, 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(STRUCTURED_SUMMARY_CAP + 20);
  });

  it("truncates prose at a sentence boundary, not mid-word", () => {
    const prose = ("First finding sentence. " + "Second finding sentence. " + "Third finding sentence. ")
      .repeat(50);
    const r = capSummary(prose, 500);
    expect(r.truncated).toBe(true);
    expect(r.text).toMatch(/…\[truncated\]$/);
    // Never ends mid-word: the char before the marker is a space or period.
    const cut = r.text.replace(/…\[truncated\]$/, "");
    expect(/\s$|\.$/.test(cut)).toBe(true);
    // The excerpt must be substantially within the cap (boundary-aware).
    expect(cut.length).toBeLessThanOrEqual(500);
  });

  it("falls back to a hard cut when no boundary exists before the cap", () => {
    const noBoundary = "abcdefghij".repeat(100);
    const r = capSummary(noBoundary, 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(100 + "…[truncated]".length);
  });
});

describe("cutAtBoundary", () => {
  it("prefers the last paragraph break within the floor window", () => {
    const s = `${"a".repeat(100)}\n\n${"b".repeat(500)}`;
    const idx = cutAtBoundary(s, 150, 0.6);
    expect(idx).toBe(101);
  });

  it("returns the limit when no boundary is found", () => {
    expect(cutAtBoundary("aaaa".repeat(100), 200, 0.9)).toBe(200);
  });
});
