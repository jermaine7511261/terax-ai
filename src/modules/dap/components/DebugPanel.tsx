// biome-ignore-all lint/suspicious/noTemplateCurlyInString: launch.json 模板占位符（${file} 等）需要字面保留
import { invoke } from "@/platform";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useDapStore } from "@/modules/dap";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  Cancel01Icon,
  PauseIcon,
  PlayIcon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function DebugPanel({ rootPath }: { rootPath: string | null }) {
  const { t } = useI18n();
  const sessions = useDapStore((s) => s.sessions);
  const loaded = useDapStore((s) => s.loaded);
  const activeId = useDapStore((s) => s.activeSessionId);
  const busy = useDapStore((s) => s.busy);
  const threads = useDapStore((s) => s.threads);
  const frames = useDapStore((s) => s.frames);
  const variables = useDapStore((s) => s.variables);
  const output = useDapStore((s) => s.output);
  const launchArgs = useDapStore((s) => s.launchArgs);
  const refresh = useDapStore((s) => s.refresh);
  const start = useDapStore((s) => s.start);
  const stop = useDapStore((s) => s.stop);
  const pause = useDapStore((s) => s.pause);
  const continueRun = useDapStore((s) => s.continueRun);
  const step = useDapStore((s) => s.step);
  const selectThread = useDapStore((s) => s.selectThread);
  const selectFrame = useDapStore((s) => s.selectFrame);
  const clearOutput = useDapStore((s) => s.clearOutput);
  const setLaunchArgs = useDapStore((s) => s.setLaunchArgs);
  const hide = useDapStore((s) => s.hide);

  const [editingArgs, setEditingArgs] = useState(false);
  const [argsDraft, setArgsDraft] = useState(launchArgs);
  const consoleRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId);
  const connected =
    activeSession != null && activeSession.status !== "inactive" && activeSession.status !== "error";
  const stopped = activeSession?.status === "stopped";
  const adapterMissing =
    activeSession?.error != null && /adapter_missing/.test(activeSession.error);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lastOutput = output[output.length - 1];
  useEffect(() => {
    const el = consoleRef.current;
    if (el && lastOutput) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastOutput]);

  const commitLaunchArgs = () => {
    try {
      JSON.parse(argsDraft);
      setLaunchArgs(argsDraft);
      setEditingArgs(false);
    } catch {
      // keep editing on invalid JSON
    }
  };

  const createSampleConfig = async () => {
    if (!rootPath) return;
    const path = `${rootPath}/.yamet/launch.json`;
    const ws = currentWorkspaceEnv();
    const exists = await invoke("fs_stat", { path, workspace: ws })
      .then(() => true)
      .catch(() => false);
    if (exists) {
      toast.info(t("settingsDap.sampleExists"));
      return;
    }
    // Detect the project language from workspace markers to pick a sensible
    // default template (falls back to Python/debugpy).
    const markers: Array<[string, () => unknown]> = [
      ["Cargo.toml", () => invoke("fs_stat", { path: `${rootPath}/Cargo.toml`, workspace: ws }).then(() => true).catch(() => false)],
      ["go.mod", () => invoke("fs_stat", { path: `${rootPath}/go.mod`, workspace: ws }).then(() => true).catch(() => false)],
      ["package.json", () => invoke("fs_stat", { path: `${rootPath}/package.json`, workspace: ws }).then(() => true).catch(() => false)],
    ];
    let template: "python" | "node" | "rust" | "go" = "python";
    for (const [marker, probe] of markers) {
      if (await probe()) {
        template = marker === "Cargo.toml" ? "rust" : marker === "go.mod" ? "go" : "node";
        break;
      }
    }
    const configs = {
      python: {
        name: "Python (debugpy)",
        type: "debugpy",
        request: "launch",
        program: "${file}",
        console: "integratedTerminal",
      },
      node: {
        name: "Node.js (node)",
        type: "node",
        request: "launch",
        program: "${file}",
      },
      rust: {
        name: "Rust (lldb-dap)",
        type: "lldb-dap",
        request: "launch",
        program: "${workspaceFolder}/target/debug/${input:binary}",
      },
      go: {
        name: "Go (delve)",
        type: "dlv-dap",
        request: "launch",
        mode: "debug",
        program: "${fileDirname}",
      },
    }[template];
    await invoke("fs_write_file", {
      path,
      content: JSON.stringify(
        {
          version: "0.2.0",
          configurations: [configs],
        },
        null,
        2,
      ),
      workspace: ws,
      source: "dap-sample",
    });
    toast.success(t("settingsDap.sampleCreated"));
  };

  const toolbarButton = (
    label: string,
    onClick: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) => (
    <Button
      variant="outline"
      size="sm"
      className={`h-6 px-2 text-[11px] ${opts.danger ? "text-destructive hover:text-destructive" : ""}`}
      disabled={opts.disabled ?? false}
      onClick={onClick}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border/70 bg-card/60">
      {/* toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1">
        <select
          className="h-6 max-w-48 rounded-md border border-border bg-background px-1.5 text-[11px] outline-none"
          value={activeId ?? ""}
          onChange={(e) => useDapStore.setState({ activeSessionId: e.target.value || null })}
        >
          <option value="">{t("settingsDap.noSession")}</option>
          {loaded &&
            sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} ({s.status})
              </option>
            ))}
        </select>

        {rootPath && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void createSampleConfig()}
          >
            {t("settingsDap.createSample")}
          </Button>
        )}

        <Button
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          disabled={!activeId || busy}
          onClick={() => {
            if (activeId) void start(activeId, rootPath);
          }}
        >
          <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={1.75} />
          {t("settingsDap.launch")}
        </Button>

        {connected && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              disabled={busy || stopped}
              onClick={() => void continueRun()}
            >
              <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={1.75} />
              {t("settingsDap.continue")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              disabled={busy || stopped}
              onClick={() => void pause()}
            >
              <HugeiconsIcon icon={PauseIcon} size={11} strokeWidth={1.75} />
              {t("settingsDap.pause")}
            </Button>
            {toolbarButton(t("settingsDap.stepOver"), () => void step("next"), { disabled: busy || !stopped })}
            {toolbarButton(t("settingsDap.stepInto"), () => void step("stepIn"), { disabled: busy || !stopped })}
            {toolbarButton(t("settingsDap.stepOut"), () => void step("stepOut"), { disabled: busy || !stopped })}
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-destructive hover:text-destructive"
              onClick={() => void stop()}
            >
              <HugeiconsIcon icon={StopCircleIcon} size={11} strokeWidth={1.75} />
              {t("settingsDap.stop")}
            </Button>
          </>
        )}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => setEditingArgs((v) => !v)}
        >
          {t("settingsDap.launchArgs")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={clearOutput}
        >
          {t("settingsDap.clearConsole")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={hide}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>

      {editingArgs && (
        <div className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5">
          <textarea
            className="h-16 flex-1 resize-none rounded-md border border-border bg-background p-1.5 font-mono text-[11px] outline-none"
            value={argsDraft}
            onChange={(e) => setArgsDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="flex flex-col gap-1">
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={commitLaunchArgs}>
              {t("common.ok")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setArgsDraft(launchArgs);
                setEditingArgs(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* body */}
      {adapterMissing && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          <span className="font-medium">{t("settingsDap.adapterMissingBanner")}</span>
          <span className="text-muted-foreground">{activeSession?.error}</span>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.2fr_1.6fr]">
        <div className="flex min-h-0 flex-col border-r border-border/50">
          <SectionTitle>{t("settingsDap.threads")}</SectionTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {threads.map((th) => (
              <button
                key={th.id}
                type="button"
                className="block w-full cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:bg-accent"
                onClick={() => void selectThread(th.id)}
              >
                {th.name}
              </button>
            ))}
            {threads.length === 0 && (
              <p className="px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t("settingsDap.noThreads")}
              </p>
            )}
          </div>
          <div className="border-t border-border/50" />
          <SectionTitle>{t("settingsDap.callStack")}</SectionTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {frames.map((f) => (
              <button
                key={f.id}
                type="button"
                className="block w-full cursor-pointer truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:bg-accent"
                onClick={() => void selectFrame(f.id)}
              >
                {f.name} — {f.source?.name ?? "?"}:{f.line}
              </button>
            ))}
            {frames.length === 0 && (
              <p className="px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t("settingsDap.noFrames")}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col border-r border-border/50">
          <SectionTitle>{t("settingsDap.variables")}</SectionTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-1 font-mono text-[11px]">
            {variables.map((v) => (
              <div key={v.name} className="flex gap-2 px-1.5 py-0.5">
                <span className="shrink-0 text-primary">{v.name}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">{v.value}</span>
                {v.type && <span className="shrink-0 text-muted-foreground">{v.type}</span>}
              </div>
            ))}
            {variables.length === 0 && (
              <p className="px-1.5 py-0.5 text-muted-foreground">{t("settingsDap.noVariables")}</p>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <SectionTitle>{t("settingsDap.console")}</SectionTitle>
          <div
            ref={consoleRef}
            className="min-h-0 flex-1 overflow-y-auto p-1 font-mono text-[11px]"
          >
            {output.length === 0 && (
              <p className="px-1.5 py-0.5 text-muted-foreground">{t("settingsDap.noOutput")}</p>
            )}
            {output.map((l) => (
              <div
                key={l.id}
                className={
                  l.category === "stderr"
                    ? "px-1.5 py-0.5 text-destructive"
                    : "px-1.5 py-0.5 text-foreground/90"
                }
              >
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}
