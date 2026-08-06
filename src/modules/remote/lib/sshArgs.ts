import type { SshTarget } from "@/modules/tabs";

/**
 * Parse a `user@host` (or bare `host`) string into an SSH target.
 * Returns `null` for blank input. A bare host yields a target with no user.
 */
export function parseTarget(host: string): SshTarget | null {
  const h = host.trim();
  if (!h) return null;
  const at = h.lastIndexOf("@");
  if (at > 0) {
    return { host: h.slice(at + 1), user: h.slice(0, at) };
  }
  return { host: h };
}

export type BuildSshTargetOptions = {
  /** Explicit user override; falls back to the `user@` part of `host`. */
  user?: string;
  /** Non-default SSH port. */
  port?: number;
};

/** Parse `user@host` and layer optional port/user overrides onto it. */
export function buildSshTarget(
  host: string,
  opts: BuildSshTargetOptions = {},
): SshTarget | null {
  const base = parseTarget(host);
  if (!base) return null;
  const target: SshTarget = {
    host: base.host,
    user: opts.user ?? base.user,
  };
  const port = opts.port ?? base.port;
  if (port != null) target.port = port;
  return target;
}

export type TunnelSpec = {
  /** Local listen spec (e.g. `8080` or `localhost:8080`). */
  bind: string;
  /** Remote host the port forwards to. */
  host: string;
  /** Remote port. */
  port: number;
};

/** Parse a `bind:host:port` tunnel spec. Returns `null` for malformed input. */
export function parseTunnelSpec(spec: string): TunnelSpec | null {
  const s = spec.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length !== 3) return null;
  const [bind, host, port] = parts;
  const p = Number(port);
  if (!bind || !host || !Number.isInteger(p) || p <= 0 || p > 65535) {
    return null;
  }
  return { bind, host, port: p };
}
