// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => {
  const memory = new Map<string, unknown>();
  class LazyStore {
    static _memory = memory;
    async entries() {
      return Array.from(memory.entries());
    }
    async set(k: string, v: unknown) {
      memory.set(k, v);
    }
    async get(k: string) {
      return memory.get(k);
    }
    async delete(k: string) {
      memory.delete(k);
    }
  }
  return { LazyStore };
});

import type { UIMessage } from "@ai-sdk/react";
import {
  clearAllSessions,
  exportSessionsAsMarkdown,
  loadAll,
  saveMessages,
  saveSessionsList,
  type SessionMeta,
} from "./sessions";

const textMsg = (role: UIMessage["role"], text: string): UIMessage => ({
  id: `m-${role}`,
  role,
  parts: [{ type: "text", text }],
});

const session = (id: string, title: string): SessionMeta => ({
  id,
  title,
  createdAt: 1000,
  updatedAt: 2000,
});

beforeEach(async () => {
  const mod = vi.mocked(await import("@tauri-apps/plugin-store"));
  // @ts-expect-error private test hook
  mod.LazyStore._memory.clear();
});

describe("exportSessionsAsMarkdown", () => {
  it("returns an empty string when there are no sessions", async () => {
    await saveSessionsList([]);
    expect(await exportSessionsAsMarkdown()).toBe("");
  });

  it("renders each session as a markdown section with role + text content", async () => {
    await saveSessionsList([session("s-1", "My Chat")]);
    await saveMessages("s-1", [
      textMsg("user", "Hello"),
      textMsg("assistant", "Hi there"),
    ]);

    const md = await exportSessionsAsMarkdown();
    expect(md).toContain("# My Chat");
    expect(md).toContain("id: s-1");
    expect(md).toContain("created: 1970-01-01T00:00:01.000Z");
    expect(md).toContain("### user");
    expect(md).toContain("Hello");
    expect(md).toContain("### assistant");
    expect(md).toContain("Hi there");
  });

  it("falls back to the session id for the title and marks empty sessions", async () => {
    await saveSessionsList([session("s-42", "")]);
    const md = await exportSessionsAsMarkdown();
    expect(md).toContain("# s-42");
    expect(md).toContain("_No messages._");
  });
});

describe("clearAllSessions", () => {
  it("removes every session's messages and resets the session list", async () => {
    await saveSessionsList([session("s-1", "A"), session("s-2", "B")]);
    await saveMessages("s-1", [textMsg("user", "hi")]);
    await saveMessages("s-2", [textMsg("assistant", "yo")]);

    await clearAllSessions();

    expect(await loadAll()).toEqual({ sessions: [], activeId: null });
    const mod = vi.mocked(await import("@tauri-apps/plugin-store"));
    // @ts-expect-error private test hook
    const entries = mod.LazyStore._memory;
    expect(entries.has("messages:s-1")).toBe(false);
    expect(entries.has("messages:s-2")).toBe(false);
  });

  it("is a no-op when there are no sessions", async () => {
    await saveSessionsList([]);
    await expect(clearAllSessions()).resolves.toBeUndefined();
    expect(await loadAll()).toEqual({ sessions: [], activeId: null });
  });
});
