import type { UIMessage } from "@ai-sdk/react";
import { createStorage } from "@/platform";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  incompleteTurn?: boolean;
  /**
   * Parent session id (H2 parentID tree, opencode semantics). A sub-session
   * (created by createSubSession) carries an independent message history but
   * inherits its parent's approval/permission scope. `undefined` = a root
   * (top-level) session.
   */
  parentId?: string;
};

const STORE_PATH = "yamet-ai-sessions.json";
const KEY_SESSIONS = "sessions";
const KEY_ACTIVE = "activeId";
const messagesKey = (id: string) => `messages:${id}`;

const store = createStorage(STORE_PATH);

export type LoadedSessions = {
  sessions: SessionMeta[];
  activeId: string | null;
};

export async function loadAll(): Promise<LoadedSessions> {
  // One IPC roundtrip via entries() rather than two parallel get()s. Per-
  // session messages are loaded lazily via `loadMessages` only when a
  // session is opened, so cold boot stays at a single store call.
  const entries = await store.entries();
  let sessions: SessionMeta[] | undefined;
  let activeId: string | null | undefined;
  for (const [k, v] of entries) {
    if (k === KEY_SESSIONS) sessions = v as SessionMeta[];
    else if (k === KEY_ACTIVE) activeId = v as string | null;
  }
  return { sessions: sessions ?? [], activeId: activeId ?? null };
}

export async function loadMessages(id: string): Promise<UIMessage[] | null> {
  return (await store.get<UIMessage[]>(messagesKey(id))) ?? null;
}

export async function saveSessionsList(sessions: SessionMeta[]): Promise<void> {
  await store.set(KEY_SESSIONS, sessions);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export async function saveMessages(
  id: string,
  messages: UIMessage[],
): Promise<void> {
  await store.set(messagesKey(id), messages);
}

export async function deleteSessionData(id: string): Promise<void> {
  await store.delete(messagesKey(id));
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "text") continue;
      const text = (p as { text: string }).text
        .replace(/<terminal-context[\s\S]*?<\/terminal-context>\s*/g, "")
        .replace(/<selection[\s\S]*?<\/selection>\s*/g, "")
        .replace(/<file[\s\S]*?<\/file>\s*/g, "")
        .trim();
      if (!text) continue;
      const first = text.split("\n")[0].trim();
      return first.length > 40 ? `${first.slice(0, 40)}…` : first;
    }
  }
  return "New chat";
}

/** Flatten a message's text parts into markdown content; empty when it has none. */
function messageToMarkdown(m: UIMessage): string {
  const blocks: string[] = [];
  for (const p of m.parts) {
    if (p.type !== "text") continue;
    const text = (p as { text: string }).text.trim();
    if (text) blocks.push(text);
  }
  if (blocks.length === 0) return "";
  return `### ${m.role}\n\n${blocks.join("\n\n")}`;
}

/**
 * Export every stored AI session as a single Markdown document: one section
 * per session (title or id, timestamps, then each message's role + content).
 */
export async function exportSessionsAsMarkdown(): Promise<string> {
  const { sessions } = await loadAll();
  const sections: string[] = [];
  for (const s of sessions) {
    const title = s.title || s.id;
    const messages = (await loadMessages(s.id)) ?? [];
    const body = messages.map(messageToMarkdown).filter(Boolean);
    sections.push(
      [
        `# ${title}`,
        "",
        `- id: ${s.id}`,
        `- created: ${new Date(s.createdAt).toISOString()}`,
        `- updated: ${new Date(s.updatedAt).toISOString()}`,
        "",
        body.length > 0 ? body.join("\n\n") : "_No messages._",
      ].join("\n"),
    );
  }
  return sections.join("\n\n---\n\n");
}

/** Delete every stored session's messages and reset the session list. */
export async function clearAllSessions(): Promise<void> {
  const { sessions } = await loadAll();
  for (const s of sessions) {
    await deleteSessionData(s.id);
  }
  await saveSessionsList([]);
}
