import { describe, expect, it } from "vitest";
import { deriveTitle, newSessionId } from "./sessions";
import type { UIMessage } from "@ai-sdk/react";

function userText(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

function assistantText(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

describe("newSessionId", () => {
  it("starts with 's-'", () => {
    expect(newSessionId()).toMatch(/^s-/);
  });

  it("has the format s-<base36>-<base36>", () => {
    const id = newSessionId();
    expect(id).toMatch(/^s-[a-z0-9]+-[a-z0-9]+$/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSessionId()));
    expect(ids.size).toBe(50);
  });
});

describe("deriveTitle", () => {
  it('returns "New chat" for an empty message list', () => {
    expect(deriveTitle([])).toBe("New chat");
  });

  it('returns "New chat" when no user messages exist', () => {
    expect(deriveTitle([assistantText("hello")])).toBe("New chat");
  });

  it("extracts the first line of a plain text user message", () => {
    expect(deriveTitle([userText("Fix the login bug")])).toBe(
      "Fix the login bug",
    );
  });

  it("skips assistant messages and uses the first user message", () => {
    const messages = [
      assistantText("How can I help?"),
      userText("Deploy the app"),
    ];
    expect(deriveTitle(messages)).toBe("Deploy the app");
  });

  it("strips <terminal-context> tags before extracting title", () => {
    const text =
      "<terminal-context>\n$ ls\nfile.ts\n</terminal-context>\nRefactor the router";
    expect(deriveTitle([userText(text)])).toBe("Refactor the router");
  });

  it("strips <selection> tags before extracting title", () => {
    const text =
      "<selection>\nconst x = 1;\n</selection>\nRename this variable";
    expect(deriveTitle([userText(text)])).toBe("Rename this variable");
  });

  it("strips <file> tags before extracting title", () => {
    const text =
      "<file path=\"src/main.ts\">\nexport const a = 1;\n</file>\nAdd error handling";
    expect(deriveTitle([userText(text)])).toBe("Add error handling");
  });

  it("strips multiple tag types from a single message", () => {
    const text =
      "<terminal-context>\n$ pwd\n</terminal-context>\n<selection>\nx = 1\n</selection>\n<file path=\"a.ts\">\ncode\n</file>\nActual request";
    expect(deriveTitle([userText(text)])).toBe("Actual request");
  });

  it("truncates long titles to 40 characters with ellipsis", () => {
    const longText =
      "Please refactor the authentication module to use the new session tokens and update all dependent endpoints accordingly";
    const title = deriveTitle([userText(longText)]);
    expect(title.length).toBe(41); // 40 chars + ellipsis
    expect(title).toBe(
      "Please refactor the authentication modul…",
    );
  });

  it("does not truncate titles of 40 characters or fewer", () => {
    const exactly40 = "a".repeat(40);
    expect(deriveTitle([userText(exactly40)])).toBe(exactly40);
  });

  it("skips text parts that become empty after tag stripping", () => {
    const text = "<terminal-context>\n$ ls\n</terminal-context>";
    const messages = [
      userText(text),
      userText("Actual message after stripped content"),
    ];
    expect(deriveTitle(messages)).toBe(
      "Actual message after stripped content",
    );
  });

  it("skips non-text parts", () => {
    const msg = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [
        { type: "tool-invocation", toolInvocation: {} },
        { type: "text", text: "The real title" },
      ],
    } as unknown as UIMessage;
    expect(deriveTitle([msg])).toBe("The real title");
  });
});
