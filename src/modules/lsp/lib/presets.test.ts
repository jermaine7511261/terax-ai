import { describe, expect, it } from "vitest";
import type { LspCustomServer } from "@/modules/settings/store";
import {
  allServers,
  serverById,
  serverForLanguage,
  serversForLanguage,
} from "./presets";

const custom: LspCustomServer[] = [
  {
    id: "custom-foo",
    name: "Foo",
    command: "foo-lsp",
    args: ["--stdio"],
    languages: { py: "python" },
    rootMarkers: ["foo.toml"],
  },
];

describe("allServers", () => {
  it("returns built-in presets plus mapped custom servers", () => {
    const servers = allServers(custom);
    const builtin = allServers([]);
    expect(servers.length).toBe(builtin.length + 1);
    expect(servers[servers.length - 1]).toMatchObject({
      id: "custom-foo",
      command: "foo-lsp",
      args: ["--stdio"],
      languages: { py: "python" },
      rootMarkers: ["foo.toml"],
    });
  });

  it("maps the custom server with no install metadata", () => {
    const s = allServers(custom).find((p) => p.id === "custom-foo")!;
    expect(s.install).toBeUndefined();
    expect(s.maxMemoryMb).toBeUndefined();
  });

  it("does not mutate the built-in list when custom servers are added", () => {
    expect(allServers([])).toHaveLength(allServers(custom).length - 1);
  });
});

describe("serversForLanguage", () => {
  it("returns all presets claiming a language", () => {
    const py = serversForLanguage("py", custom);
    expect(py.map((p) => p.id).sort()).toEqual(["custom-foo", "pyright", "ruff"]);
  });

  it("returns the user-defined server alongside built-ins", () => {
    expect(serversForLanguage("py", custom)).toContainEqual(
      expect.objectContaining({ id: "custom-foo" }),
    );
  });

  it("returns an empty list for null or unknown language ids", () => {
    expect(serversForLanguage(null, custom)).toEqual([]);
    expect(serversForLanguage("nope", custom)).toEqual([]);
  });

  it("ignores custom servers that don't claim the language", () => {
    expect(serversForLanguage("ts", custom).map((p) => p.id)).not.toContain(
      "custom-foo",
    );
  });
});

describe("serverForLanguage", () => {
  it("returns null when no preset claims the language", () => {
    expect(serverForLanguage("nope", custom)).toBeNull();
    expect(serverForLanguage(null, custom)).toBeNull();
  });

  it("prefers the enabled candidate when activation is provided", () => {
    const s = serverForLanguage("py", custom, {
      "custom-foo": "enabled",
      pyright: "dismissed",
      ruff: "dismissed",
    });
    expect(s?.id).toBe("custom-foo");
  });

  it("prefers a non-dismissed candidate over preset order", () => {
    // ruff is first for py? No — pyright is the first preset in LSP_PRESETS.
    const s = serverForLanguage("py", custom, {
      pyright: "dismissed",
      ruff: "enabled",
    });
    expect(s?.id).toBe("ruff");
  });

  it("falls back to the first candidate when nothing is enabled", () => {
    const s = serverForLanguage("py", [], {});
    expect(s?.id).toBe("pyright");
  });

  it("skips dismissed candidates and picks the first fresh one", () => {
    const s = serverForLanguage("py", [], { pyright: "dismissed" });
    // ruff is next preset claiming py.
    expect(s?.id).toBe("ruff");
  });

  it("returns the first candidate when activation is omitted", () => {
    expect(serverForLanguage("py", [])?.id).toBe("pyright");
  });
});

describe("serverById", () => {
  it("finds a built-in preset by id", () => {
    expect(serverById("rust-analyzer", [])?.command).toBe("rust-analyzer");
  });

  it("finds a custom server by id", () => {
    expect(serverById("custom-foo", custom)?.name).toBe("Foo");
  });

  it("returns null for an unknown id", () => {
    expect(serverById("missing", custom)).toBeNull();
  });
});
