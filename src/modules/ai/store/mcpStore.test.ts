import { beforeEach, describe, expect, it, vi } from "vitest";

// mcpStore imports ../lib/mcp, which pulls in @tauri-apps/api/core and
// @tauri-apps/plugin-store (LazyStore) — neither loads cleanly under
// vitest/node. Mock the whole lib module so the store mounts and every
// backend interaction can be asserted against controllable fakes.
vi.mock("../lib/mcp", () => ({
  loadMcpServers: vi.fn(),
  saveMcpServers: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpToolsList: vi.fn(),
  mcpStatus: vi.fn(),
  sanitizeMcpToolName: (serverId: string, name: string) =>
    `mcp_${serverId}_${name}`,
}));

import {
  loadMcpServers,
  mcpConnect,
  mcpDisconnect,
  mcpStatus,
  mcpToolsList,
  saveMcpServers,
} from "../lib/mcp";
import { useMcpStore } from "./mcpStore";

const m = {
  loadMcpServers: vi.mocked(loadMcpServers),
  saveMcpServers: vi.mocked(saveMcpServers),
  mcpConnect: vi.mocked(mcpConnect),
  mcpDisconnect: vi.mocked(mcpDisconnect),
  mcpToolsList: vi.mocked(mcpToolsList),
  mcpStatus: vi.mocked(mcpStatus),
};

function server(id: string, name = `server-${id}`) {
  return {
    id,
    name,
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", `@modelcontextprotocol/server-${id}`],
    cwd: "",
    env: {} as Record<string, string>,
    url: "",
    headers: {} as Record<string, string>,
  };
}

function tool(serverId: string, serverName: string, name: string) {
  return {
    server_id: serverId,
    server_name: serverName,
    name,
    description: `tool ${name}`,
    input_schema: { type: "object" as const },
  };
}

function status(id: string, connected = true) {
  return {
    id,
    name: `server-${id}`,
    connected,
    tool_count: 1,
    stderr_tail: "",
    error: null,
  };
}

beforeEach(() => {
  useMcpStore.setState({
    hydrated: false,
    servers: [],
    statusByServer: {},
    tools: [],
    toolServerByKey: {},
  });
  for (const fn of Object.values(m)) fn.mockReset();
  m.mcpConnect.mockResolvedValue(undefined);
  m.mcpDisconnect.mockResolvedValue(undefined);
  m.mcpToolsList.mockResolvedValue([]);
  m.mcpStatus.mockResolvedValue([]);
  m.loadMcpServers.mockResolvedValue([]);
  m.saveMcpServers.mockResolvedValue(undefined);
});

describe("useMcpStore initial state", () => {
  it("starts unhydrated with empty collections", () => {
    const s = useMcpStore.getState();
    expect(s.hydrated).toBe(false);
    expect(s.servers).toEqual([]);
    expect(s.statusByServer).toEqual({});
    expect(s.tools).toEqual([]);
    expect(s.toolServerByKey).toEqual({});
  });
});

describe("hydrate", () => {
  it("loads persisted servers, marks hydrated, and refreshes tools/status", async () => {
    m.loadMcpServers.mockResolvedValue([server("a"), server("b")]);
    m.mcpToolsList.mockResolvedValue([tool("a", "server-a", "read")]);
    m.mcpStatus.mockResolvedValue([status("a")]);

    await useMcpStore.getState().hydrate();

    const s = useMcpStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.servers.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.tools).toHaveLength(1);
    expect(s.statusByServer["a"].connected).toBe(true);
    expect(m.mcpToolsList).toHaveBeenCalled();
    expect(m.mcpStatus).toHaveBeenCalled();
  });

  it("is idempotent — a second call does not reload", async () => {
    m.loadMcpServers.mockResolvedValue([server("a")]);

    const { hydrate } = useMcpStore.getState();
    await hydrate();
    await hydrate();

    expect(m.loadMcpServers).toHaveBeenCalledTimes(1);
    expect(m.mcpToolsList).toHaveBeenCalledTimes(1);
  });
});

describe("upsert", () => {
  it("adds a new server and persists the list", async () => {
    const cfg = server("a");
    await useMcpStore.getState().upsert(cfg);

    const s = useMcpStore.getState();
    expect(s.servers).toEqual([cfg]);
    expect(m.saveMcpServers).toHaveBeenCalledWith([cfg]);
  });

  it("replaces an existing server by id (dedupes, no duplicate)", async () => {
    const original = server("a", "old");
    await useMcpStore.getState().upsert(original);
    const updated = { ...original, name: "new" };
    await useMcpStore.getState().upsert(updated);

    const s = useMcpStore.getState();
    expect(s.servers).toHaveLength(1);
    expect(s.servers[0]).toEqual(updated);
    expect(m.saveMcpServers).toHaveBeenLastCalledWith([updated]);
  });
});

describe("remove", () => {
  it("disconnects, drops the server, persists, and refreshes", async () => {
    await useMcpStore.getState().upsert(server("a"));
    m.saveMcpServers.mockClear();
    m.mcpToolsList.mockResolvedValue([tool("b", "server-b", "read")]);
    m.mcpStatus.mockResolvedValue([status("b")]);

    await useMcpStore.getState().remove("a");

    expect(m.mcpDisconnect).toHaveBeenCalledWith("a");
    expect(useMcpStore.getState().servers).toEqual([]);
    expect(m.saveMcpServers).toHaveBeenCalledWith([]);
    // refresh ran against the backend afterwards
    expect(m.mcpToolsList).toHaveBeenCalled();
  });

  it("tolerates a failing disconnect and still removes the server", async () => {
    await useMcpStore.getState().upsert(server("a"));
    m.mcpDisconnect.mockRejectedValue(new Error("backend down"));
    m.saveMcpServers.mockClear();

    await useMcpStore.getState().remove("a");

    expect(useMcpStore.getState().servers).toEqual([]);
    expect(m.saveMcpServers).toHaveBeenCalledWith([]);
  });
});

describe("connect", () => {
  it("connects the matching server then refreshes", async () => {
    const cfg = server("a");
    await useMcpStore.getState().upsert(cfg);
    m.mcpToolsList.mockResolvedValue([tool("a", "server-a", "read")]);

    await useMcpStore.getState().connect("a");

    expect(m.mcpConnect).toHaveBeenCalledWith(cfg);
    expect(m.mcpToolsList).toHaveBeenCalled();
  });

  it("is a no-op for an unknown server id", async () => {
    await useMcpStore.getState().connect("missing");
    expect(m.mcpConnect).not.toHaveBeenCalled();
  });
});

describe("disconnect", () => {
  it("disconnects the server then refreshes", async () => {
    await useMcpStore.getState().disconnect("a");

    expect(m.mcpDisconnect).toHaveBeenCalledWith("a");
    expect(m.mcpToolsList).toHaveBeenCalled();
  });

  it("tolerates a failing disconnect and still refreshes", async () => {
    m.mcpDisconnect.mockRejectedValue(new Error("boom"));
    await useMcpStore.getState().disconnect("a");
    expect(m.mcpDisconnect).toHaveBeenCalledWith("a");
    expect(m.mcpToolsList).toHaveBeenCalled();
  });
});

describe("refresh", () => {
  it("builds statusByServer, tools, and toolServerByKey", async () => {
    m.mcpToolsList.mockResolvedValue([
      tool("fs", "filesystem", "list"),
      tool("fs", "filesystem", "read"),
    ]);
    m.mcpStatus.mockResolvedValue([status("fs"), status("db", false)]);

    await useMcpStore.getState().refresh();

    const s = useMcpStore.getState();
    expect(s.tools).toHaveLength(2);
    expect(s.statusByServer).toEqual({
      fs: expect.objectContaining({ connected: true }),
      db: expect.objectContaining({ connected: false }),
    });
    // sanitized tool key -> server name
    expect(s.toolServerByKey).toEqual({
      mcp_fs_list: "filesystem",
      mcp_fs_read: "filesystem",
    });
  });

  it("resets collections to empty on backend failure", async () => {
    useMcpStore.setState({
      tools: [tool("a", "s", "x")],
      statusByServer: { a: status("a") },
    });
    m.mcpToolsList.mockRejectedValue(new Error("boom"));
    m.mcpStatus.mockRejectedValue(new Error("boom"));

    await useMcpStore.getState().refresh();

    const s = useMcpStore.getState();
    expect(s.tools).toEqual([]);
    expect(s.statusByServer).toEqual({});
    expect(s.toolServerByKey).toEqual({});
  });
});
