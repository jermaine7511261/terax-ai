// biome-ignore-all lint/style/noNonNullAssertion: 测试断言数据必然存在
import { beforeEach, describe, expect, it } from "vitest";

// managedAgentsStore is a self-contained zustand store (no lib/invoke deps),
// so it can be exercised directly with setState/getState.
import {
  DEFAULT_MAX_ROUNDS,
  useManagedAgentsStore,
} from "./managedAgentsStore";

beforeEach(() => {
  useManagedAgentsStore.setState({ agents: {} });
});

function register(opts: { leafId?: number; maxRounds?: number } = {}) {
  useManagedAgentsStore.getState().register({
    leafId: opts.leafId ?? 1,
    tabId: 10,
    sessionId: "sess-1",
    task: "write tests",
    cwd: "/work",
    ...(opts.maxRounds !== undefined ? { maxRounds: opts.maxRounds } : {}),
  });
}

describe("register", () => {
  it("creates a spawning agent with default max rounds", () => {
    register();
    const a = useManagedAgentsStore.getState().get(1)!;
    expect(a).toMatchObject({
      leafId: 1,
      tabId: 10,
      sessionId: "sess-1",
      task: "write tests",
      cwd: "/work",
      rounds: 0,
      phase: "spawning",
      reviewedAtRound: -1,
      pendingReview: false,
    });
    expect(a.maxRounds).toBe(DEFAULT_MAX_ROUNDS);
  });

  it("honors a custom maxRounds", () => {
    register({ maxRounds: 7 });
    expect(useManagedAgentsStore.getState().get(1)?.maxRounds).toBe(7);
  });

  it("allows cwd to be null", () => {
    useManagedAgentsStore.getState().register({
      leafId: 1,
      tabId: 10,
      sessionId: "s",
      task: "t",
      cwd: null,
    });
    expect(useManagedAgentsStore.getState().get(1)?.cwd).toBeNull();
  });
});

describe("setPhase", () => {
  it("updates the phase", () => {
    register();
    useManagedAgentsStore.getState().setPhase(1, "working");
    expect(useManagedAgentsStore.getState().get(1)?.phase).toBe("working");
  });

  it("is a no-op for an unknown leaf", () => {
    useManagedAgentsStore.getState().setPhase(999, "done");
    expect(useManagedAgentsStore.getState().agents).toEqual({});
  });

  it("is a no-op when the phase is unchanged", () => {
    register();
    useManagedAgentsStore.getState().setPhase(1, "spawning");
    expect(useManagedAgentsStore.getState().get(1)?.phase).toBe("spawning");
  });
});

describe("markReviewed", () => {
  it("records the reviewed round and clears pendingReview", () => {
    register();
    useManagedAgentsStore.getState().bumpRound(1);
    useManagedAgentsStore.getState().setPendingReview(1, true);
    useManagedAgentsStore.getState().markReviewed(1);
    const a = useManagedAgentsStore.getState().get(1)!;
    expect(a.reviewedAtRound).toBe(1);
    expect(a.pendingReview).toBe(false);
  });

  it("is a no-op for an unknown leaf", () => {
    useManagedAgentsStore.getState().markReviewed(999);
    expect(useManagedAgentsStore.getState().agents).toEqual({});
  });
});

describe("setPendingReview", () => {
  it("sets pendingReview true", () => {
    register();
    useManagedAgentsStore.getState().setPendingReview(1, true);
    expect(useManagedAgentsStore.getState().get(1)?.pendingReview).toBe(true);
  });

  it("is a no-op when unchanged", () => {
    register();
    useManagedAgentsStore.getState().setPendingReview(1, false);
    expect(useManagedAgentsStore.getState().get(1)?.pendingReview).toBe(false);
  });

  it("is a no-op for an unknown leaf", () => {
    useManagedAgentsStore.getState().setPendingReview(999, true);
    expect(useManagedAgentsStore.getState().agents).toEqual({});
  });
});

describe("bumpRound", () => {
  it("increments rounds and sets phase working", () => {
    register();
    useManagedAgentsStore.getState().setPhase(1, "reviewing");
    useManagedAgentsStore.getState().bumpRound(1);
    const a = useManagedAgentsStore.getState().get(1)!;
    expect(a.rounds).toBe(1);
    expect(a.phase).toBe("working");
  });

  it("is a no-op for an unknown leaf", () => {
    useManagedAgentsStore.getState().bumpRound(999);
    expect(useManagedAgentsStore.getState().agents).toEqual({});
  });
});

describe("remove", () => {
  it("removes the agent by leafId", () => {
    register({ leafId: 1 });
    register({ leafId: 2 });
    useManagedAgentsStore.getState().remove(1);
    expect(Object.keys(useManagedAgentsStore.getState().agents)).toEqual(["2"]);
  });

  it("is a no-op for an unknown leaf", () => {
    register();
    useManagedAgentsStore.getState().remove(999);
    expect(Object.keys(useManagedAgentsStore.getState().agents)).toEqual(["1"]);
  });
});

describe("get / getBySessionId", () => {
  it("get returns the matching agent or undefined", () => {
    register({ leafId: 1 });
    expect(useManagedAgentsStore.getState().get(1)?.leafId).toBe(1);
    expect(useManagedAgentsStore.getState().get(999)).toBeUndefined();
  });

  it("getBySessionId finds an agent by session id", () => {
    register({ leafId: 1 });
    const a = useManagedAgentsStore.getState().getBySessionId("sess-1");
    expect(a?.leafId).toBe(1);
    expect(
      useManagedAgentsStore.getState().getBySessionId("missing"),
    ).toBeUndefined();
  });
});
