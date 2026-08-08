import { describe, expect, it } from "vitest";
import {
  detectDoomLoop,
  phaseForStep,
  pushToolCall,
  shouldExitLoop,
} from "./loop";

describe("phaseForStep (L2 think-act-observe)", () => {
  it("maps a step with tool calls to 'calling'", () => {
    expect(phaseForStep({ toolCalls: [{ toolName: "read_file" }] })).toBe(
      "calling",
    );
  });
  it("maps a step with text to 'observing'", () => {
    expect(phaseForStep({ text: "let me check" })).toBe("observing");
  });
  it("defaults to 'thinking' for a bare step", () => {
    expect(phaseForStep({})).toBe("thinking");
  });
});

describe("shouldExitLoop (robust exit)", () => {
  it("exits when the model stopped without a pending tool call", () => {
    expect(
      shouldExitLoop({
        finishReason: "stop",
        hasPendingToolCall: false,
        stepsSeen: 2,
        maxSteps: 24,
      }),
    ).toBe(true);
  });
  it("does NOT exit when a tool call is pending (must observe the result)", () => {
    expect(
      shouldExitLoop({
        finishReason: "tool-calls",
        hasPendingToolCall: true,
        stepsSeen: 2,
        maxSteps: 24,
      }),
    ).toBe(false);
  });
  it("hard-stops at the step cap regardless of finish reason", () => {
    expect(
      shouldExitLoop({
        finishReason: "tool-calls",
        hasPendingToolCall: true,
        stepsSeen: 24,
        maxSteps: 24,
      }),
    ).toBe(true);
  });
});

describe("detectDoomLoop", () => {
  it("returns true when the last 3 tool calls repeat the same tool+args", () => {
    const recent = pushToolCall([], { toolName: "read_file", args: "a" });
    recent.push({ toolName: "read_file", args: "a" });
    recent.push({ toolName: "read_file", args: "a" });
    expect(detectDoomLoop(recent)).toBe(true);
  });
  it("returns false for fewer than 3 calls or differing args", () => {
    expect(detectDoomLoop([{ toolName: "read_file", args: "a" }])).toBe(false);
    const r = [
      { toolName: "read_file", args: "a" },
      { toolName: "read_file", args: "a" },
      { toolName: "read_file", args: "b" },
    ];
    expect(detectDoomLoop(r)).toBe(false);
  });
  it("pushToolCall caps the window length", () => {
    let recent: { toolName: string; args: string }[] = [];
    for (let i = 0; i < 20; i++) {
      recent = pushToolCall(recent, { toolName: "x", args: String(i) });
    }
    expect(recent.length).toBe(12);
  });
});
