import { describe, expect, it } from "vitest";
import { buildSshTarget, parseTarget, parseTunnelSpec } from "./sshArgs";

describe("parseTarget", () => {
  it("parses user@host", () => {
    expect(parseTarget("root@example.com")).toEqual({
      host: "example.com",
      user: "root",
    });
  });

  it("parses a bare host without a user", () => {
    expect(parseTarget("example.com")).toEqual({ host: "example.com" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseTarget("  user@host  ")).toEqual({
      host: "host",
      user: "user",
    });
  });

  it("uses the last @ when the user contains one", () => {
    expect(parseTarget("a@b@host")).toEqual({ host: "host", user: "a@b" });
  });

  it("treats a leading @ as no user", () => {
    expect(parseTarget("@host")).toEqual({ host: "@host" });
  });

  it("returns null for blank input", () => {
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("   ")).toBeNull();
  });
});

describe("buildSshTarget", () => {
  it("inherits the user from the host string", () => {
    expect(buildSshTarget("root@example.com")).toEqual({
      host: "example.com",
      user: "root",
    });
  });

  it("applies a user override", () => {
    expect(buildSshTarget("root@example.com", { user: "admin" })).toEqual({
      host: "example.com",
      user: "admin",
    });
  });

  it("applies a port when provided", () => {
    expect(buildSshTarget("example.com", { port: 2222 })).toEqual({
      host: "example.com",
      port: 2222,
    });
  });

  it("omits the port field when not provided", () => {
    expect(buildSshTarget("example.com")).toEqual({ host: "example.com" });
    expect("port" in buildSshTarget("example.com")!).toBe(false);
  });

  it("returns null for blank input", () => {
    expect(buildSshTarget("")).toBeNull();
  });
});

describe("parseTunnelSpec", () => {
  it("parses bind:host:port", () => {
    expect(parseTunnelSpec("8080:localhost:80")).toEqual({
      bind: "8080",
      host: "localhost",
      port: 80,
    });
  });

  it("accepts a non-numeric bind host like localhost:8080", () => {
    expect(parseTunnelSpec("localhost:127.0.0.1:5432")).toEqual({
      bind: "localhost",
      host: "127.0.0.1",
      port: 5432,
    });
  });

  it("trims whitespace", () => {
    expect(parseTunnelSpec("  9000:db:3306  ")).toEqual({
      bind: "9000",
      host: "db",
      port: 3306,
    });
  });

  it("rejects input without exactly three parts", () => {
    expect(parseTunnelSpec("")).toBeNull();
    expect(parseTunnelSpec("8080")).toBeNull();
    expect(parseTunnelSpec("8080:localhost")).toBeNull();
    expect(parseTunnelSpec("8080:localhost:80:extra")).toBeNull();
  });

  it("rejects empty parts", () => {
    expect(parseTunnelSpec(":localhost:80")).toBeNull();
    expect(parseTunnelSpec("8080::80")).toBeNull();
  });

  it("rejects a non-numeric or out-of-range port", () => {
    expect(parseTunnelSpec("8080:localhost:abc")).toBeNull();
    expect(parseTunnelSpec("8080:localhost:0")).toBeNull();
    expect(parseTunnelSpec("8080:localhost:65536")).toBeNull();
  });
});
