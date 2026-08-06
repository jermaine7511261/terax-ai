import { beforeEach, describe, expect, it } from "vitest";

// agentStore is a self-contained zustand store (no lib/invoke deps), so it can
// be exercised directly with setState/getState.
import {
  nextAttentionTarget,
  useAgentStore,
} from "./agentStore";
import type {
  AgentNotification,
  AgentSource,
  NotificationKind,
} from "../lib/types";

function baseState() {
  return { sessions: {}, localAgent: null, notifications: [] };
}

function notification(
  overrides: Partial<Omit<AgentNotification, "id" | "at" | "read">> = {},
): Omit<AgentNotification, "id" | "at" | "read"> {
  return {
    source: "terminal" as AgentSource,
    leafId: 1,
    tabId: 10,
    agent: "coder",
    kind: "finished" as NotificationKind,
    ...overrides,
  };
}

beforeEach(() => {
  useAgentStore.setState(baseState());
});

describe("start", () => {
  it("creates a working session for the leaf", () => {
    useAgentStore.getState().start(1, 10, "coder");
    const s = useAgentStore.getState().sessions[1];
    expect(s).toMatchObject({
      leafId: 1,
      tabId: 10,
      agent: "coder",
      status: "working",
      attentionSince: null,
    });
    expect(s.startedAt).toEqual(expect.any(Number));
    expect(s.lastActivityAt).toEqual(s.startedAt);
  });

  it("overwrites an existing session at the same leafId", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().start(1, 20, "planner");
    expect(Object.keys(useAgentStore.getState().sessions)).toHaveLength(1);
    expect(useAgentStore.getState().sessions[1].agent).toBe("planner");
  });
});

describe("setStatus", () => {
  it("updates status and sets attentionSince when waiting", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().setStatus(1, "waiting");
    const s = useAgentStore.getState().sessions[1];
    expect(s.status).toBe("waiting");
    expect(s.attentionSince).toEqual(expect.any(Number));
    expect(s.attentionSince).not.toBeNull();
  });

  it("clears attentionSince when leaving waiting", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().setStatus(1, "waiting");
    useAgentStore.getState().setStatus(1, "working");
    expect(useAgentStore.getState().sessions[1].attentionSince).toBeNull();
  });

  it("is a no-op for an unknown leaf", () => {
    useAgentStore.getState().setStatus(999, "waiting");
    expect(useAgentStore.getState().sessions).toEqual({});
  });

  it("is a no-op when status is unchanged", () => {
    useAgentStore.getState().start(1, 10, "coder");
    const before = useAgentStore.getState().sessions[1].lastActivityAt;
    useAgentStore.getState().setStatus(1, "working");
    expect(useAgentStore.getState().sessions[1].lastActivityAt).toBe(before);
  });
});

describe("finish", () => {
  it("removes the session for the leaf", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().finish(1);
    expect(useAgentStore.getState().sessions).toEqual({});
  });

  it("is a no-op for an unknown leaf", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().finish(999);
    expect(Object.keys(useAgentStore.getState().sessions)).toEqual(["1"]);
  });
});

describe("setLocalAgent", () => {
  it("sets the local agent state", () => {
    useAgentStore.getState().setLocalAgent({ status: "working", agent: "coder" });
    expect(useAgentStore.getState().localAgent).toEqual({
      status: "working",
      agent: "coder",
    });
  });

  it("is a no-op when nothing changes", () => {
    useAgentStore.getState().setLocalAgent({ status: "working", agent: "coder" });
    const before = useAgentStore.getState().localAgent;
    useAgentStore.getState().setLocalAgent({ status: "working", agent: "coder" });
    expect(useAgentStore.getState().localAgent).toBe(before);
  });

  it("clears the local agent state when passed null", () => {
    useAgentStore.getState().setLocalAgent({ status: "working", agent: "coder" });
    useAgentStore.getState().setLocalAgent(null);
    expect(useAgentStore.getState().localAgent).toBeNull();
  });
});

describe("notifications", () => {
  it("pushNotification prepends with generated id/at/read", () => {
    useAgentStore.getState().pushNotification(notification({ leafId: 1 }));
    const n = useAgentStore.getState().notifications[0];
    expect(n).toMatchObject({ leafId: 1, agent: "coder", read: false });
    expect(n.id).toMatch(/^n\d+$/);
    expect(n.at).toEqual(expect.any(Number));
  });

  it("caps notifications at 50", () => {
    for (let i = 0; i < 60; i++)
      useAgentStore
        .getState()
        .pushNotification(notification({ leafId: i, agent: `n${i}` }));
    expect(useAgentStore.getState().notifications).toHaveLength(50);
    // oldest (pushed first) dropped from the tail
    expect(
      useAgentStore.getState().notifications.some((n) => n.agent === "n0"),
    ).toBe(false);
    // newest (pushed last) kept at the head
    expect(useAgentStore.getState().notifications[0].agent).toBe("n59");
  });

  it("markAllRead marks every notification read", () => {
    useAgentStore.getState().pushNotification(notification({ leafId: 1 }));
    useAgentStore.getState().pushNotification(notification({ leafId: 2 }));
    useAgentStore.getState().markAllRead();
    expect(useAgentStore.getState().notifications.every((n) => n.read)).toBe(
      true,
    );
  });

  it("markAllRead is a no-op when already all read", () => {
    useAgentStore.getState().pushNotification(notification({ leafId: 1 }));
    useAgentStore.getState().markAllRead();
    const before = useAgentStore.getState().notifications;
    useAgentStore.getState().markAllRead();
    expect(useAgentStore.getState().notifications).toBe(before);
  });

  it("clearNotifications empties the list", () => {
    useAgentStore.getState().pushNotification(notification({ leafId: 1 }));
    useAgentStore.getState().clearNotifications();
    expect(useAgentStore.getState().notifications).toEqual([]);
  });
});

describe("nextAttentionTarget", () => {
  it("returns the most recently waiting session", () => {
    useAgentStore.getState().start(1, 10, "coder");
    useAgentStore.getState().start(2, 20, "coder");
    useAgentStore.getState().setStatus(1, "waiting");
    useAgentStore.getState().setStatus(2, "waiting");
    // Disambiguate the tie: leaf 2 entered waiting more recently.
    const s = useAgentStore.getState();
    s.sessions[1].attentionSince = 100;
    s.sessions[2].attentionSince = 200;
    const t = nextAttentionTarget();
    expect(t).toEqual({ tabId: 20, leafId: 2 });
  });

  it("returns null when nothing is waiting", () => {
    useAgentStore.getState().start(1, 10, "coder");
    expect(nextAttentionTarget()).toBeNull();
  });

  it("returns null when there are no sessions", () => {
    expect(nextAttentionTarget()).toBeNull();
  });
});
