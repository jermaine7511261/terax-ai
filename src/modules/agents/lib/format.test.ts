import { describe, expect, it } from "vitest";
import { displayAgent } from "./format";

describe("displayAgent", () => {
  it("labels known agents with their canonical product name", () => {
    expect(displayAgent("claude")).toBe("Claude Code");
    expect(displayAgent("codex")).toBe("Codex");
    expect(displayAgent("gemini")).toBe("Gemini");
    expect(displayAgent("opencode")).toBe("OpenCode");
    expect(displayAgent("grok")).toBe("Grok");
  });

  it("is case-insensitive for known agents", () => {
    expect(displayAgent("CLAUDE")).toBe("Claude Code");
    expect(displayAgent("CodeX")).toBe("Codex");
  });

  it("title-cases unknown agents", () => {
    expect(displayAgent("openai")).toBe("Openai");
    expect(displayAgent("my-agent")).toBe("My-agent");
  });

  it("falls back to a neutral label for empty input", () => {
    expect(displayAgent("")).toBe("Agent");
    expect(displayAgent(undefined as unknown as string)).toBe("Agent");
  });
});
