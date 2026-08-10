import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  compactModelMessages,
  compactModelMessagesDetailed,
  createCompressionDebouncer,
  pruneToolResultsOnly,
  sanitizeModelMessages,
  selectContext,
  shouldCompress,
  PROTECT_FIRST_N,
} from "./compact";

const BIG = "x".repeat(2000);

function readCall(id: string, path: string): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: "read_file",
        input: { path },
      },
    ],
  } as unknown as ModelMessage;
}

function readResult(id: string, value: string): ModelMessage {
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, output: { type: "text", value } },
    ],
  } as unknown as ModelMessage;
}

function writeCall(id: string, path: string): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: "write_file",
        input: { path },
      },
    ],
  } as unknown as ModelMessage;
}

function toolResultMsg(id: string, value: string): ModelMessage {
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, output: { type: "text", value } },
    ],
  } as unknown as ModelMessage;
}

function outputOf(message: ModelMessage): { __elided?: boolean } {
  const parts = message.content as Array<{ output?: { __elided?: boolean } }>;
  return parts[0].output ?? {};
}

function isElided(message: ModelMessage): boolean {
  return outputOf(message).__elided === true;
}

describe("compactModelMessagesDetailed", () => {
  it("returns the input untouched when it fits the context budget", () => {
    const messages = [{ role: "user", content: "hi" }] as ModelMessage[];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("elides a read result once its file has been written", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      writeCall("c2", "/a.txt"),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(result.compacted).toBe(true);
    expect(isElided(result.messages[1])).toBe(true);
  });

  it("keeps the latest read of a path and elides the superseded one", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      readCall("c2", "/a.txt"),
      readResult("c2", BIG),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(isElided(result.messages[1])).toBe(true);
    expect(isElided(result.messages[3])).toBe(false);
  });

  it("does not elide superseded reads while under the budget", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", "tiny"),
      readCall("c2", "/a.txt"),
      readResult("c2", "tiny"),
    ];
    const result = compactModelMessagesDetailed(messages, 100_000);
    expect(result.compacted).toBe(false);
    expect(isElided(result.messages[1])).toBe(false);
  });

  it("is idempotent: re-running does not re-elide an already-elided result", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      writeCall("c2", "/a.txt"),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const once = compactModelMessagesDetailed(messages, 1000);
    const twice = compactModelMessagesDetailed(once.messages, 1000);
    expect(twice.compacted).toBe(false);
    expect(isElided(twice.messages[1])).toBe(true);
  });
});

describe("compactModelMessages", () => {
  it("returns the messages array from the detailed result", () => {
    const messages = [{ role: "user", content: "hi" }] as ModelMessage[];
    expect(compactModelMessages(messages, 1000)).toBe(messages);
  });
});

describe("shouldCompress (P2-1 1/4)", () => {
  it("compresses at/over 0.7x the context limit", () => {
    expect(shouldCompress({ approxTokens: 700, contextLimit: 1000 })).toBe(true);
    expect(shouldCompress({ approxTokens: 690, contextLimit: 1000 })).toBe(false);
  });
});

describe("selectContext (P2-1 2/4, head/tail protection)", () => {
  it("protects the first/last N messages from elision", () => {
    // Build 20 messages with oversized tool results in the middle.
    const messages: ModelMessage[] = [
      { role: "user", content: "header" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "a2" },
    ];
    for (let i = 0; i < 12; i++) {
      messages.push(toolResultMsg(`c${i}`, BIG));
    }
    messages.push({ role: "user", content: "tail" });
    const r = selectContext(messages, 500);
    // The last message (tail) must survive unelided.
    const last = r.messages[r.messages.length - 1];
    expect(last.content).toBe("tail");
    // The first PROTECT_FIRST_N messages must be intact.
    expect(r.messages[0].content).toBe("header");
    expect(r.messages[PROTECT_FIRST_N - 1].content).toBe("a2");
  });

  it("elides middle tool results under pressure (regression: tail protection must not revert middle elisions)", () => {
    // 3 protected head + 40 oversized tool results + tail = 44 messages. The
    // legacy pass elides indexes 3..19; tail protection must only restore the
    // LAST protectLast messages. Before the fix, tailIdx collapsed to a
    // constant 12 and reverted every elision past it, leaving elided=9 (only
    // 3..11 survived) and the context over budget for long conversations.
    const messages: ModelMessage[] = [
      { role: "user", content: "header" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "a2" },
    ];
    for (let i = 0; i < 40; i++) {
      messages.push(toolResultMsg(`c${i}`, BIG));
    }
    messages.push({ role: "user", content: "tail" });

    const r = selectContext(messages, 200);
    let elided = 0;
    let keptBig = 0;
    for (const m of r.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const p of m.content as Array<Record<string, unknown>>) {
        if (p.type !== "tool-result") continue;
        if ((p.output as { __elided?: boolean } | undefined)?.__elided) elided++;
        else keptBig++;
      }
    }
    expect(elided).toBeGreaterThan(10);
    expect(keptBig).toBeLessThan(30);
    // Head and tail still survive unelided.
    expect(r.messages[0].content).toBe("header");
    expect(r.messages[r.messages.length - 1].content).toBe("tail");
  });

  it("honors custom protection counts", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "x" },
      { role: "user", content: "y" },
      { role: "user", content: "z" },
      toolResultMsg("c", BIG),
    ];
    const r = selectContext(messages, 200, { protectFirst: 3, protectLast: 1 });
    expect(r.messages[0].content).toBe("x");
    expect(r.messages[1].content).toBe("y");
    expect(r.messages[2].content).toBe("z");
  });
});

describe("createCompressionDebouncer (P2-1 3/4, debounce gate)", () => {
  it("stops compressing after two low-savings compressions", () => {
    const d = createCompressionDebouncer(10);
    expect(d.shouldCompress()).toBe(true);
    d.recordCompression(5); // under 10%
    expect(d.shouldCompress()).toBe(true); // 1 low
    d.recordCompression(4); // 2 low → stop
    expect(d.shouldCompress()).toBe(false);
  });

  it("resets after a high-savings compression", () => {
    const d = createCompressionDebouncer(10);
    d.recordCompression(5);
    d.recordCompression(20); // above threshold → resets counter
    d.recordCompression(5);
    expect(d.shouldCompress()).toBe(true); // only 1 low since the reset
  });

  it("reset() clears the counter", () => {
    const d = createCompressionDebouncer(10);
    d.recordCompression(1);
    d.recordCompression(1);
    expect(d.shouldCompress()).toBe(false);
    d.reset();
    expect(d.shouldCompress()).toBe(true);
  });
});

describe("pruneToolResultsOnly (P2-1 4/4)", () => {
  it("elides oversized tool results in the middle, keeping structure", () => {
    // 10 messages: indices 0-2 = protected head, 3 = elidable, 4-9 = tail.
    const messages: ModelMessage[] = [
      { role: "user", content: "q0" },
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
      toolResultMsg("c", BIG), // index 3 — outside the protected head (3)
      { role: "user", content: "after" },
      { role: "user", content: "after2" },
      { role: "user", content: "after3" },
      { role: "user", content: "after4" },
      { role: "user", content: "after5" },
      { role: "user", content: "after6" },
    ];
    const r = pruneToolResultsOnly(messages);
    expect(r.changed).toBe(true);
    const part = (r.messages[3].content as Array<{ type: string; output?: unknown }>)[0];
    expect(part.output).toMatchObject({ type: "text", __elided: true });
    // Structure preserved.
    expect(r.messages[0].content).toBe("q0");
    expect(r.messages[4].content).toBe("after");
  });

  it("returns changed:false when nothing is oversized", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "q" },
      { role: "user", content: "small" },
    ];
    const r = pruneToolResultsOnly(messages);
    expect(r.changed).toBe(false);
    expect(r.messages).toBe(messages);
  });
});

describe("sanitizeModelMessages", () => {
  it("strips orphan tool-call parts when result is missing", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "thinking" },
          { type: "tool-call", toolCallId: "c1", toolName: "bash", input: {} },
          { type: "tool-call", toolCallId: "c2", toolName: "read", input: {} },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "c1", output: { type: "text", value: "ok" } }],
      },
    ] as unknown as ModelMessage[];
    const result = sanitizeModelMessages(messages);
    expect(result).toHaveLength(2);
    const parts = result[0].content as { type: string; toolCallId?: string }[];
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe("text");
    expect(parts[1].toolCallId).toBe("c1");
  });

  it("removes assistant message entirely if all tool-calls are orphaned", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "bash", input: {} },
        ],
      },
      { role: "user", content: "next" },
    ];
    const result = sanitizeModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("returns original array when nothing changed", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = sanitizeModelMessages(messages);
    expect(result).toBe(messages);
  });
});
