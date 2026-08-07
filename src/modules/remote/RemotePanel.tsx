// Remote SSH panel: SFTP file browser + port-forwarding tunnel manager.
// Bridges to the Rust `sftp_list`/`sftp_read` and `ssh_tunnel_*` commands.

import { invoke } from "@/platform";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  File01Icon,
  Folder02Icon,
  Link03Icon,
  Link04Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SshTarget } from "@/modules/tabs";
import { parseTarget } from "./lib/sshArgs";

type SftpEntry = {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number;
};

type TunnelInfo = {
  id: number;
  kind: string;
  bind: string;
  remote: string;
  pid: number;
};

type Props = {
  onOpenRemoteFile: (target: SshTarget, path: string) => void;
};

export function RemotePanel({ onOpenRemoteFile }: Props) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [target, setTarget] = useState<SshTarget | null>(null);
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // --- SFTP browser ---
  useEffect(() => {
    if (!target) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    invoke<SftpEntry[]>("sftp_list", { target, path: cwd })
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e) => {
        if (!cancelled) toast.error(t("remote.listFailed"), { description: String(e) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, cwd, t]);

  // --- Tunnels ---
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [tunnelKind, setTunnelKind] = useState<"local" | "remote">("local");
  const [tunnelBind, setTunnelBind] = useState("8080:localhost");
  const [tunnelRemote, setTunnelRemote] = useState("127.0.0.1:80");

  const refreshTunnels = () => {
    if (!target) {
      setTunnels([]);
      return;
    }
    // Backend `ssh_tunnel_list` already reaps exited tunnels (try_wait), so
    // show the list as-is — no client-side filtering needed.
    invoke<TunnelInfo[]>("ssh_tunnel_list")
      .then((list) => setTunnels(list))
      .catch(() => {});
  };
  useEffect(() => {
    refreshTunnels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const startTunnel = async () => {
    if (!target) {
      toast.error(t("remote.needTarget"));
      return;
    }
    try {
      await invoke<number>("ssh_tunnel_start", {
        target,
        kind: tunnelKind,
        bind: tunnelBind.trim() || "8080:localhost",
        remote: tunnelRemote.trim() || "127.0.0.1:80",
      });
      toast.success(t("remote.tunnelStarted"));
      refreshTunnels();
    } catch (e) {
      toast.error(t("remote.tunnelFailed"), { description: String(e) });
    }
  };

  const killTunnel = async (id: number) => {
    try {
      await invoke("ssh_tunnel_kill", { id });
      refreshTunnels();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const connect = () => {
    const p = parseTarget(host);
    if (!p) {
      toast.error(t("remote.needTarget"));
      return;
    }
    setTarget(p);
    setCwd("/");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5">
      {/* Connection */}
      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 p-2">
        <HugeiconsIcon icon={Link03Icon} size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connect()}
          placeholder={t("remote.hostPlaceholder")}
          spellCheck={false}
          className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          onClick={connect}
          disabled={!host.trim()}
          className={cn(
            "shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors",
            host.trim() ? "hover:bg-primary/90" : "cursor-not-allowed opacity-50",
          )}
        >
          {t("remote.connect")}
        </button>
      </div>

      {target ? (
        <>
          {/* SFTP browser */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/50 bg-card/40">
            <div className="flex items-center gap-1 border-b border-border/40 px-2 py-1">
              <span className="flex-1 truncate text-[10.5px] font-medium text-muted-foreground">
                {target.user ? `${target.user}@` : ""}{target.host}:{cwd}
              </span>
              {cwd !== "/" ? (
                <button
                  type="button"
                  onClick={() => setCwd((c) => (c === "/" ? "/" : c.replace(/\/[^/]*\/?$/, "") || "/"))}
                  className="rounded p-0.5 text-muted-foreground/70 hover:bg-foreground/[0.08]"
                  title={t("remote.up")}
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
                </button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {loading ? (
                <div className="px-2 py-1 text-[10.5px] text-muted-foreground/60">{t("remote.loading")}</div>
              ) : entries.length === 0 ? (
                <div className="px-2 py-1 text-[10.5px] text-muted-foreground/60">{t("remote.emptyDir")}</div>
              ) : (
                entries.map((e) => (
                  <button
                    key={e.name}
                    type="button"
                    onClick={() => {
                      if (e.kind === "dir") {
                        setCwd((c) => (c === "/" ? `/${e.name}` : `${c}/${e.name}`));
                      } else if (e.kind === "file") {
                        onOpenRemoteFile(target, `${cwd === "/" ? "" : cwd}/${e.name}`);
                      }
                    }}
                    className="flex w-full items-center gap-1.5 px-2 py-[3px] text-left text-[11.5px] text-foreground/90 transition-colors hover:bg-foreground/[0.05]"
                  >
                    <HugeiconsIcon
                      icon={e.kind === "dir" ? Folder02Icon : File01Icon}
                      size={13}
                      strokeWidth={1.75}
                      className="shrink-0 text-muted-foreground/70"
                    />
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.kind === "file" ? (
                      <span className="shrink-0 text-[9.5px] text-muted-foreground/50">{formatSize(e.size)}</span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Tunnel manager */}
          <div className="rounded-lg border border-border/50 bg-card/40">
            <div className="border-b border-border/40 px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("remote.tunnels")}
            </div>
            <div className="flex items-center gap-1 p-1.5">
              <select
                value={tunnelKind}
                onChange={(e) => setTunnelKind(e.target.value as "local" | "remote")}
                className="shrink-0 rounded-md border border-border/60 bg-card/60 px-1 py-1 text-[11px] text-foreground outline-none"
              >
                <option value="local">-L {t("remote.local")}</option>
                <option value="remote">-R {t("remote.remote")}</option>
              </select>
              <input
                value={tunnelBind}
                onChange={(e) => setTunnelBind(e.target.value)}
                placeholder="bind:host:port"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-border/60 bg-card/60 px-1.5 py-1 text-[10.5px] outline-none placeholder:text-muted-foreground/50"
              />
              <span className="text-[10.5px] text-muted-foreground/60">:</span>
              <input
                value={tunnelRemote}
                onChange={(e) => setTunnelRemote(e.target.value)}
                placeholder="host:port"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-border/60 bg-card/60 px-1.5 py-1 text-[10.5px] outline-none placeholder:text-muted-foreground/50"
              />
              <button
                type="button"
                onClick={() => void startTunnel()}
                className="shrink-0 rounded-md bg-primary px-1.5 py-1 text-[10.5px] font-medium text-primary-foreground hover:bg-primary/90"
                title={t("remote.startTunnel")}
              >
                <HugeiconsIcon icon={Link04Icon} size={13} strokeWidth={2} />
              </button>
            </div>
            <div className="max-h-28 overflow-y-auto py-0.5">
              {tunnels.length === 0 ? (
                <div className="px-2 py-1 text-[10.5px] text-muted-foreground/60">{t("remote.noTunnels")}</div>
              ) : (
                tunnels.map((tu) => (
                  <div key={tu.id} className="flex items-center gap-1 px-2 py-[2px] font-mono text-[10px] text-foreground/85">
                    <span className="truncate">{tu.kind === "local" ? "L" : "R"}:{tu.bind}:{tu.remote}</span>
                    <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/50">pid {tu.pid}</span>
                    <button
                      type="button"
                      onClick={() => void killTunnel(tu.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground"
                      title={t("remote.stopTunnel")}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-muted-foreground/60">
          {t("remote.connectHint")}
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}
