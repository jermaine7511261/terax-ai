import { describe, expect, it } from "vitest";
import {
  compactModelMessages,
  compactModelMessagesDetailed,
  pruneToolResultsOnly,
  PROTECT_FIRST_N,
} from "./compact";
import type { ModelMessage } from "ai";

function toolResultMsg(id: string, output: unknown): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-result", toolCallId: id, output }],
  } as unknown as ModelMessage;
}

function textMsg(role: string, text: string): ModelMessage {
  return { role, content: text } as unknown as ModelMessage;
}

describe("compactModelMessagesDetailed edge cases", () => {
  it("returns empty array unchanged", () => {
    const r = compactModelMessagesDetailed([], 1000);
    expect(r.messages).toEqual([]);
    expect(r.compacted).toBe(false);
    expect(r.droppedCount).toBe(0);
  });

  it("returns short messages unchanged when under 70% threshold", () => {
    const msgs = [textMsg("user", "hi")];
    const r = compactModelMessagesDetailed(msgs, 10_000);
    expect(r.messages).toBe(msgs);
    expect(r.compacted).toBe(false);
  });

  it("elides tool results when over threshold", () => {
    // Need > KEEP_TAIL (24) messages for the legacy path to elide.
    const msgs: ModelMessage[] = [];
    for (let i = 0; i < 30; i++) msgs.push(toolResultMsg(`r${i}`, "x".repeat(5000)));
    const r = compactModelMessagesDetailed(msgs, 5000);
    expect(r.droppedCount).toBeGreaterThan(0);
  });

  it("keeps system messages unelided", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "you are helpful" } as ModelMessage,
      toolResultMsg("r1", "x".repeat(5000)),
      toolResultMsg("r2", "y".repeat(5000)),
    ];
    const r = compactModelMessagesDetailed(msgs, 2000);
    expect(r.messages[0].content).toBe("you are helpful");
  });
});

describe("pruneToolResultsOnly", () => {
  it("elides tool results in the middle, preserves head/tail", () => {
    const msgs: ModelMessage[] = [
      textMsg("user", "q0"),
      textMsg("assistant", "a0"),
      toolResultMsg("r1", "z".repeat(3000)),
      toolResultMsg("r2", "z".repeat(3000)),
      textMsg("user", "tail"),
    ];
    const r = pruneToolResultsOnly(msgs, {
      protectFirst: 2,
      protectLast: 1,
    });
    expect(r.changed).toBe(true);
    expect(r.messages[0].content).toBe("q0"); // head preserved
    expect(r.messages[4].content).toBe("tail"); // tail preserved
  });

  it("returns unchanged when no tool results present", () => {
    const msgs = [textMsg("user", "q"), textMsg("assistant", "a")];
    const r = pruneToolResultsOnly(msgs);
    expect(r.changed).toBe(false);
    expect(r.messages).toBe(msgs);
  });

  it("does not touch head or tail zone results", () => {
    const msgs: ModelMessage[] = [
      toolResultMsg("h1", "x".repeat(3000)), // head (index 0)
      textMsg("user", "q"),
      toolResultMsg("m1", "x".repeat(3000)), // middle
      textMsg("assistant", "a"),
      toolResultMsg("t1", "x".repeat(3000)), // tail (last)
    ];
    const r = pruneToolResultsOnly(msgs, {
      protectFirst: 1,
      protectLast: 1,
    });
    // Head and tail tool results should NOT be elided.
    // Only middle (index 2) should be.
    expect(r.changed).toBe(true);
    const headPart = (r.messages[0].content as Array<Record<string, unknown>>)[0];
    expect(headPart.__elided).toBeUndefined();
    const tailPart = (r.messages[4].content as Array<Record<string, unknown>>)[0];
    expect(tailPart.__elided).toBeUndefined();
  });
});

describe("compactModelMessages wrapper", () => {
  it("returns same array when no compression needed", () => {
    const msgs = [textMsg("user", "hi")];
    const r = compactModelMessages(msgs, 10_000);
    expect(r).toBe(msgs);
  });
});
