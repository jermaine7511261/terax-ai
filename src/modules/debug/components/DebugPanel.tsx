import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Bug01Icon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  debugLaunch,
  type DebugHandle,
  type DebugLaunchConfig,
} from "../lib/client";

type Props = {
  root: string | null;
  onOpen: (path: string, line: number) => void;
};

type Session = {
  handle: DebugHandle;
  state: "running" | "stopped" | "exited";
  threads: { id: number; name: string }[];
  activeThreadId?: number;
  frames: { id: number; name: string; source?: { path?: string; name?: string }; line: number; column: number }[];
  variables: { name: string; value: string; type?: string; variablesReference: number }[];
  output: string[];
};

function VarRow({ v, onExpand, depth }: { v: { name: string; value: string; variablesReference: number }; onExpand: (ref: number) => void; depth: number }) {
  return (
    <button
      type="button"
      onClick={() => v.variablesReference > 0 && onExpand(v.variablesReference)}
      className="flex w-full items-center gap-1 truncate px-2 py-[2px] text-left font-mono text-[10.5px] leading-snug text-foreground/90 transition-colors hover:bg-foreground/[0.05]"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <span className="shrink-0 text-muted-foreground/70">{v.name}</span>
      <span className="shrink-0 text-muted-foreground/40">=</span>
      <span className="min-w-0 flex-1 truncate text-foreground/85">{v.value}</span>
      {v.variablesReference > 0 ? (
        <span className="shrink-0 text-[9px] text-muted-foreground/50">›</span>
      ) : null}
    </button>
  );
}

export function DebugPanel({ root, onOpen }: Props) {
  const { t } = useI18n();
  const [program, setProgram] = useState("");
  const [adapter, setAdapter] = useState("auto");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (s: Session, fn: (draft: Session) => void): Session => {
    const clone: Session = {
      handle: s.handle,
      state: s.state,
      threads: [...s.threads],
      frames: [...s.frames],
      variables: [...s.variables],
      output: [...s.output],
      activeThreadId: s.activeThreadId,
    };
    fn(clone);
    return clone;
  };

  const handleInbound = (cur: Session | null) => (e: { kind: string; method?: string; params?: unknown; code?: number | null; body?: unknown; requestSeq?: number }) => {
    setSession((prev) => {
      if (!prev) return prev;
      if (e.kind === "exit") {
        return apply(prev, (d) => { d.state = "exited"; });
      }
      if (e.kind === "response") {
        // Response to a frontend-driven request (threads/stackTrace/variables).
        const resp = (e.body ?? {}) as { command?: string; body?: unknown; success?: boolean };
        if (resp.success === false) return prev;
        const body = (resp.body ?? {}) as Record<string, unknown>;
        if (resp.command === "threads") {
          const threads = (body.threads ?? []) as { id: number; name: string }[];
          return apply(prev, (d) => { d.threads = threads; });
        }
        if (resp.command === "stackTrace") {
          const frames = (body.stackFrames ?? []) as { id: number; name: string; source?: { path?: string; name?: string }; line: number; column: number }[];
          return apply(prev, (d) => {
            d.frames = frames;
            // Auto-fetch scopes for the top frame.
            if (frames[0]) void prev.handle.scopes(frames[0].id);
          });
        }
        if (resp.command === "scopes") {
          const scopes = (body.scopes ?? []) as { name: string; variablesReference: number }[];
          // Fetch variables of the first scope that has references.
          const target = scopes.find((s) => s.variablesReference > 0);
          if (target) void prev.handle.variables(target.variablesReference);
          return prev;
        }
        if (resp.command === "variables") {
          const vars = (body.variables ?? []) as { name: string; value: string; type?: string; variablesReference: number }[];
          return apply(prev, (d) => {
            d.variables = vars.map((v) => ({
              name: v.name,
              value: v.value,
              type: v.type,
              variablesReference: v.variablesReference ?? 0,
            }));
          });
        }
        return prev;
      }
      if (e.kind !== "event") return prev;
      const method = e.method ?? "";
      const params = (e.params ?? {}) as Record<string, unknown>;
      if (method === "stopped") {
        return apply(prev, (d) => {
          d.state = "stopped";
          if (typeof params.threadId === "number") d.activeThreadId = params.threadId;
          // Request threads + stack.
          void prev.handle.threads();
          if (typeof params.threadId === "number") void prev.handle.stackTrace(params.threadId);
        });
      }
      if (method === "continued") {
        return apply(prev, (d) => { d.state = "running"; });
      }
      if (method === "terminated" || method === "exited") {
        return apply(prev, (d) => { d.state = "exited"; });
      }
      if (method === "output") {
        const text = String(params.output ?? "");
        if (text) {
          return apply(prev, (d) => {
            d.output.push(text);
            if (d.output.length > 500) d.output.shift();
          });
        }
      }
      return prev;
    });
    void cur;
  };

  const launch = async (): Promise<void> => {
    if (!program.trim()) {
      toast.error(t("debug.needProgram"));
      return;
    }
    setBusy(true);
    try {
      const config: DebugLaunchConfig = {
        program: program.trim(),
        cwd: root ?? undefined,
        args: { program: program.trim(), cwd: root ?? undefined, outputCapture: "std" },
      };
      if (adapter !== "auto") config.adapter = adapter;
      const handle = await debugLaunch(config, handleInbound(null));
      setSession({
        handle,
        state: "running",
        threads: [],
        frames: [],
        variables: [],
        output: [t("debug.launched") + "\n"],
      });
    } catch (e) {
      toast.error(t("debug.launchFailed"), { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    await session?.handle.kill();
    setSession((prev) => (prev ? apply(prev, (d) => { d.state = "exited"; }) : prev));
  };

  const reqVars = async (ref: number): Promise<void> => {
    await session?.handle.variables(ref);
  };

  const runStep = async (fn: (h: DebugHandle) => Promise<void>, after?: (d: Session) => void): Promise<void> => {
    const s = session;
    if (!s) return;
    await fn(s.handle);
    if (after) setSession((prev) => (prev ? apply(prev, after) : prev));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5">
      {/* Launch config */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/70 p-2">
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon icon={Bug01Icon} size={14} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
          <input
            value={program}
            onChange={(e) => setProgram(e.target.value)}
            placeholder={t("debug.programPlaceholder")}
            spellCheck={false}
            className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border/60 bg-card/60 px-1.5 py-1 text-[11px] text-foreground outline-none"
          >
            <option value="auto">{t("debug.adapterAuto")}</option>
            <option value="debugpy">debugpy (Python)</option>
            <option value="node-inspect">node (JS/TS)</option>
            <option value="lldb-dap">lldb-dap (C/C++/Rust)</option>
            <option value="gdb">gdb (C/C++)</option>
            <option value="dlv">dlv (Go)</option>
          </select>
          {session ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="flex shrink-0 items-center gap-1 rounded-md bg-foreground/10 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-foreground/15"
            >
              <HugeiconsIcon icon={StopIcon} size={13} strokeWidth={2} />
              {t("debug.stop")}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !program.trim()}
              onClick={() => void launch()}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors",
                busy || !program.trim() ? "cursor-not-allowed opacity-50" : "hover:bg-primary/90",
              )}
            >
              <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
              {t("debug.start")}
            </button>
          )}
        </div>
      </div>

      {/* Status + step controls */}
      {session ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            session.state === "running" ? "bg-emerald-500" : session.state === "stopped" ? "bg-amber-500" : "bg-muted-foreground/50",
          )} />
          <span className="min-w-0 flex-1 truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {session.state === "running" ? t("debug.running") : session.state === "stopped" ? t("debug.stopped") : t("debug.exited")}
          </span>
          {session.state === "stopped" ? (
            <>
              <button type="button" onClick={() => void runStep((h) => h.continue_())} title={t("debug.continue")} className="rounded p-1 text-foreground/80 hover:bg-foreground/[0.08]">
                <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
              </button>
              <button type="button" onClick={() => void runStep((h) => h.next())} title={t("debug.stepOver")} className="rounded p-1 text-foreground/80 hover:bg-foreground/[0.08]">↓</button>
              <button type="button" onClick={() => void runStep((h) => h.stepIn())} title={t("debug.stepInto")} className="rounded p-1 text-foreground/80 hover:bg-foreground/[0.08]">↘</button>
              <button type="button" onClick={() => void runStep((h) => h.stepOut())} title={t("debug.stepOut")} className="rounded p-1 text-foreground/80 hover:bg-foreground/[0.08]">↑</button>
            </>
          ) : null}
          {session.state === "running" ? (
            <button type="button" onClick={() => void runStep((h) => h.pause())} title={t("debug.pause")} className="rounded p-1 text-foreground/80 hover:bg-foreground/[0.08]">
              <HugeiconsIcon icon={PauseIcon} size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {/* Console output */}
        {session && session.output.length > 0 ? (
          <div className="rounded-lg border border-border/50 bg-card/40 p-2 font-mono text-[10.5px] leading-snug text-foreground/85">
            {session.output.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
            ))}
          </div>
        ) : null}

        {/* Threads / stack / variables */}
        {session && session.state === "stopped" ? (
          <>
            <Section title={t("debug.callStack")}>
              {session.frames.length === 0 ? (
                <div className="px-2 py-1 text-[10.5px] text-muted-foreground/60">{t("debug.noFrames")}</div>
              ) : (
                session.frames.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (f.source?.path) onOpen(f.source.path, Math.max(0, f.line - 1));
                    }}
                    className="flex w-full items-center gap-1 px-2 py-[2px] text-left font-mono text-[10.5px] leading-snug text-foreground/90 transition-colors hover:bg-foreground/[0.05]"
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto shrink-0 text-[9.5px] text-muted-foreground/60">
                      {f.source?.name ?? ""}:{f.line}
                    </span>
                  </button>
                ))
              )}
            </Section>
            <Section title={t("debug.variables")}>
              {session.variables.length === 0 ? (
                <div className="px-2 py-1 text-[10.5px] text-muted-foreground/60">{t("debug.noVariables")}</div>
              ) : (
                session.variables.map((v, i) => (
                  <VarRow key={i} v={v} depth={0} onExpand={(ref) => void reqVars(ref)} />
                ))
              )}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40">
      <div className="border-b border-border/40 px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="py-1">{children}</div>
    </div>
  );
}
