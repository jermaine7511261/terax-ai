import { describe, expect, it } from "vitest";
import type { UIMessage } from "@ai-sdk/react";
import { sanitizeOrphanToolCalls } from "./transport";

function msg(id: string, role: "user" | "assistant", parts: unknown[]): UIMessage {
  return { id, role, parts: parts as UIMessage["parts"] } as UIMessage;
}

function toolCall(toolCallId: string) {
  return { type: "tool-call", toolCallId, toolName: "grep", input: {} };
}
function toolResult(toolCallId: string) {
  return { type: "tool-result", toolCallId, content: "ok" };
}
function text(content: string) {
  return { type: "text", text: content };
}

describe("sanitizeOrphanToolCalls", () => {
  it("keeps a well-formed assistant tool-call + result pair", () => {
    const messages = [
      msg("a", "assistant", [toolCall("c1"), toolResult("c1"), text("done")]),
    ];
    const out = sanitizeOrphanToolCalls(messages);
    expect(out).toHaveLength(1);
    expect(out[0].parts).toHaveLength(3);
  });

  it("strips an orphan tool-call with no matching result", () => {
    const messages = [
      msg("a", "assistant", [toolCall("c1"), text("partial")]),
    ];
    const out = sanitizeOrphanToolCalls(messages);
    expect(out).toHaveLength(1);
    const types = out[0].parts.map((p) => p.type);
    expect(types).toEqual(["text"]);
  });

  it("keeps sibling text when stripping orphan tool-call", () => {
    const messages = [
      msg("a", "assistant", [text("keep"), toolCall("c1")]),
    ];
    const out = sanitizeOrphanToolCalls(messages);
    expect(out[0].parts.map((p) => p.type)).toEqual(["text"]);
    expect((out[0].parts[0] as { text?: string }).text).toBe("keep");
  });

  it("drops an assistant message left with zero parts", () => {
    const messages = [msg("a", "assistant", [toolCall("c1")])];
    const out = sanitizeOrphanToolCalls(messages);
    expect(out).toHaveLength(0);
  });

  it("does not touch user messages", () => {
    const messages = [msg("u", "user", [text("hi")])];
    const out = sanitizeOrphanToolCalls(messages);
    expect(out).toHaveLength(1);
    expect(out[0].parts[0]).toMatchObject({ type: "text", text: "hi" });
  });

  it("keeps only orphan tool-calls, preserving valid ones", () => {
    const messages = [
      msg("a", "assistant", [
        toolCall("c1"),
        toolResult("c1"),
        toolCall("c2"), // orphan
        text("x"),
      ]),
    ];
    const out = sanitizeOrphanToolCalls(messages);
    const toolCallIds = out[0].parts
      .filter((p) => p.type === "tool-call")
      .map((p) => (p as { toolCallId?: string }).toolCallId);
    expect(toolCallIds).toEqual(["c1"]);
  });
});
