import { beforeEach, describe, expect, it, vi } from "vitest";

// agentsStore imports @tauri-apps/api/event (emit/listen) and ../lib/agents,
// which constructs a LazyStore from @tauri-apps/plugin-store at import time and
// reads/writes it via entries()/set()/save(). Neither Tauri module loads cleanly
// under vitest/node, so mock @tauri-apps/plugin-store at module level — the real
// ../lib/agents persistence functions run against a controllable fake, letting
// us assert the store's set/save persistence calls.
const { storeMock } = vi.hoisted(() => {
  const storeInstance = {
    entries: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  };
  return {
    storeMock: {
      LazyStore: vi.fn(function (this: unknown) {
        return storeInstance;
      }),
      storeInstance,
    },
  };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: storeMock.LazyStore,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { BUILTIN_AGENTS, type Agent } from "../lib/agents";
import { useAgentsStore } from "./agentsStore";

const { emit } = await import("@tauri-apps/api/event");

const emitMock = emit as ReturnType<typeof vi.fn>;
const { storeInstance } = storeMock;

function customAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a-1",
    name: "Custom",
    description: "desc",
    instructions: "instr",
    icon: "coder",
    builtIn: false,
    ...overrides,
  };
}

const FLUSH = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  // Reset store state (module-level `initialized` stays true after hydrate —
  // tests that touch it avoid re-calling hydrate).
  useAgentsStore.setState({
    hydrated: false,
    customAgents: [],
    activeId: BUILTIN_AGENTS[0].id,
  });
  for (const k of ["entries", "set", "save"] as const)
    storeInstance[k].mockReset();
  storeInstance.entries.mockResolvedValue([]);
  storeInstance.set.mockResolvedValue(undefined);
  storeInstance.save.mockResolvedValue(undefined);
  emitMock.mockReset();
});

describe("default state", () => {
  it("starts unhydrated with the first builtin agent active", () => {
    const s = useAgentsStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.customAgents).toEqual([]);
    expect(s.activeId).toBe(BUILTIN_AGENTS[0].id);
  });

  it("all() returns builtins first, then custom agents", () => {
    useAgentsStore.setState({ customAgents: [customAgent()] });
    const all = useAgentsStore.getState().all();
    expect(all.slice(0, BUILTIN_AGENTS.length).map((a) => a.builtIn)).toEqual(
      BUILTIN_AGENTS.map(() => true),
    );
    expect(all[all.length - 1].id).toBe("a-1");
    expect(all[all.length - 1].builtIn).toBe(false);
  });
});

describe("hydrate", () => {
  it("loads custom agents and active id from the store", async () => {
    storeInstance.entries.mockResolvedValue([
      ["customAgents", [customAgent({ id: "loaded" })]],
      ["activeAgentId", "loaded"],
    ]);

    await useAgentsStore.getState().hydrate();

    const s = useAgentsStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.customAgents.map((a) => a.id)).toEqual(["loaded"]);
    expect(s.activeId).toBe("loaded");
  });
});

describe("setActiveId", () => {
  it("updates activeId and persists it", async () => {
    useAgentsStore.getState().setActiveId("a-1");
    expect(useAgentsStore.getState().activeId).toBe("a-1");

    expect(storeInstance.set).toHaveBeenCalledWith("activeAgentId", "a-1");
    await FLUSH();
    expect(storeInstance.save).toHaveBeenCalled();
    // broadcast fires after the async save resolves
    await FLUSH();
    expect(emitMock).toHaveBeenCalledWith("yamet://ai-agents-changed");
  });
});

describe("upsert", () => {
  it("adds a new custom agent and persists the list", async () => {
    const agent = customAgent();
    useAgentsStore.getState().upsert(agent);

    expect(useAgentsStore.getState().customAgents).toEqual([agent]);
    expect(storeInstance.set).toHaveBeenCalledWith("customAgents", [agent]);
    await FLUSH();
    expect(storeInstance.save).toHaveBeenCalled();
    await FLUSH();
    expect(emitMock).toHaveBeenCalledWith("yamet://ai-agents-changed");
  });

  it("updates an existing agent in place by id", () => {
    useAgentsStore.setState({ customAgents: [customAgent({ id: "a-1" })] });

    useAgentsStore
      .getState()
      .upsert(customAgent({ id: "a-1", name: "Renamed" }));

    const list = useAgentsStore.getState().customAgents;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Renamed");
  });

  it("ignores builtin agents (no-op)", async () => {
    const builtin = { ...customAgent(), builtIn: true };
    useAgentsStore.getState().upsert(builtin);

    expect(useAgentsStore.getState().customAgents).toEqual([]);
    expect(storeInstance.set).not.toHaveBeenCalled();
    await FLUSH();
    expect(storeInstance.save).not.toHaveBeenCalled();
  });
});

describe("remove", () => {
  it("removes a custom agent and persists the list", async () => {
    useAgentsStore.setState({
      customAgents: [customAgent({ id: "a-1" }), customAgent({ id: "a-2" })],
    });

    useAgentsStore.getState().remove("a-1");

    expect(useAgentsStore.getState().customAgents.map((a) => a.id)).toEqual([
      "a-2",
    ]);
    expect(storeInstance.set).toHaveBeenCalledWith(
      "customAgents",
      expect.arrayContaining([]),
    );
    await FLUSH();
    expect(storeInstance.save).toHaveBeenCalled();
  });

  it("resets activeId to the first builtin when the active agent is removed", async () => {
    useAgentsStore.setState({
      customAgents: [customAgent({ id: "a-1" })],
      activeId: "a-1",
    });

    useAgentsStore.getState().remove("a-1");

    expect(useAgentsStore.getState().activeId).toBe(BUILTIN_AGENTS[0].id);
    expect(storeInstance.set).toHaveBeenCalledWith(
      "activeAgentId",
      BUILTIN_AGENTS[0].id,
    );
  });

  it("leaves activeId untouched when removing a non-active agent", async () => {
    useAgentsStore.setState({
      customAgents: [customAgent({ id: "a-1" })],
      activeId: "keep",
    });

    useAgentsStore.getState().remove("a-1");

    expect(useAgentsStore.getState().activeId).toBe("keep");
  });
});
