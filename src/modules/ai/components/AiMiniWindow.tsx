// biome-ignore-all lint/a11y/useSemanticElements: 会话项需内嵌操作按钮，只能 span+role 模式
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useI18n, tStatic } from "@/lib/i18n";
import type { PresenceState } from "@/lib/usePresence";
import { cn } from "@/lib/utils";
import { InlineInput } from "@/modules/explorer/InlineInput";
import { type UIMessage, useChat } from "@ai-sdk/react";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  Edit01Icon,
  FilterIcon,
  Search01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import type { SessionMeta } from "../lib/sessions";
import { exportSessionsAsMarkdown, clearAllSessions } from "../lib/sessions";
import { useMiniWindowGeometry } from "../lib/useMiniWindowGeometry";
import { useAgentsStore } from "../store/agentsStore";
import {
  getOrCreateChat,
  sendMessage,
} from "../store/chatRuntime";
import {
  type ApprovalOptions,
  handleApprovalDecision,
  useChatStore,
} from "../store/chatStore";
import { usePlanStore } from "../store/planStore";
import { AiChatView } from "./AiChat";
import { PlanDiffReview } from "./PlanDiffReview";
import { ResourceStatsIndicator } from "@/modules/statusbar/ResourceStatsIndicator";
import { ActivityStrip } from "./ActivityStrip";
import { AiComposerInput } from "./AiComposerInput";
import { TodoStrip } from "./TodoStrip";

const SUGGESTIONS = [
  {
    labelKey: "ai.suggestExplainLastError" as const,
    hintKey: "ai.suggestExplainLastErrorHint" as const,
    textKey: "ai.suggestExplainLastErrorText" as const,
    icon: AlertCircleIcon,
  },
  {
    labelKey: "ai.suggestGenerateCommand" as const,
    hintKey: "ai.suggestGenerateCommandHint" as const,
    textKey: "ai.suggestGenerateCommandText" as const,
    icon: TerminalIcon,
  },
  {
    labelKey: "ai.suggestSummarizeBuffer" as const,
    hintKey: "ai.suggestSummarizeBufferHint" as const,
    textKey: "ai.suggestSummarizeBufferText" as const,
    icon: FilterIcon,
  },
];

export function AiMiniWindow({ state }: { state: PresenceState }) {
  const closeMini = useChatStore((s) => s.closeMini);
  const sessionId = useChatStore((s) => s.activeSessionId);
  const openPanel = useChatStore((s) => s.openPanel);
  const expandToPanel = () => {
    closeMini();
    openPanel();
  };

  const { ref, onHeaderPointerDown, startResize, toggleMaximize, togglePin, pinned } = useMiniWindowGeometry();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        closeMini();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMini]);

  return (
    <div
      ref={ref}
      data-state={state}
      data-ai-mini-window
      className={cn(
        "no-scrollbar-deep fixed flex flex-col overflow-hidden",
        "rounded-2xl border border-border/60 bg-card text-[12px]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.45),0_8px_16px_-8px_rgba(0,0,0,0.3)]",
        "ring-1 ring-black/5 dark:ring-white/5",
        pinned ? "z-50" : "z-40",
        "duration-200 ease-out",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-foreground/[0.03] to-transparent"
      />
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onPointerDown={startResize(dir)} />
      ))}
      {sessionId ? (
        <Body
          sessionId={sessionId}
          onClose={closeMini}
          onExpand={expandToPanel}
          onHeaderPointerDown={onHeaderPointerDown}
          onDoubleClick={toggleMaximize}
          pinned={pinned}
          onTogglePin={togglePin}
        />
      ) : (
        <EmptyShell
          onClose={closeMini}
          onExpand={expandToPanel}
          onHeaderPointerDown={onHeaderPointerDown}
        />
      )}
      <PlanDiffReview />
    </div>
  );
}

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

function ResizeHandle({
  dir,
  onPointerDown,
}: {
  dir: ResizeDir;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-no-drag
      onPointerDown={onPointerDown}
      className={cn(
        "absolute z-50 touch-none select-none",
        RESIZE_HANDLE_CLASS[dir],
      )}
    />
  );
}

function Body({
  sessionId,
  onClose,
  onExpand,
  onHeaderPointerDown,
  onDoubleClick,
  pinned,
  onTogglePin,
}: {
  sessionId: string;
  onClose: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const focusInput = useChatStore((s) => s.focusInput);
  const step = useChatStore((s) => s.agentMeta.step);
  const switchSession = useChatStore((s) => s.switchSession);
  const [showHistory, setShowHistory] = useState(false);

  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy =
    helpers.status === "submitted" || helpers.status === "streaming";

  // Any manual approval decision arms auto-approve (approve only — a deny
  // never arms it). Handled centrally in handleApprovalDecision.
  const addToolApprovalResponse = useCallback(
    (arg: { id: string; approved: boolean }, opts?: ApprovalOptions) => {
      handleApprovalDecision(
        arg.id,
        arg.approved,
        opts,
        helpers.addToolApprovalResponse,
      );
    },
    [helpers.addToolApprovalResponse],
  );

  const onEditAndResend = useCallback(
    (newText: string) => {
      const msgs = helpers.messages;
      let cut = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          cut = i;
          break;
        }
      }
      if (cut < 0) return;
      helpers.setMessages(msgs.slice(0, cut));
      void sendMessage(newText);
    },
    [helpers],
  );

  return (
    <>
      <Header
        step={step}
        isBusy={isBusy}
        onClose={onClose}
        onExpand={onExpand}
        showHistory={showHistory}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onHeaderPointerDown={onHeaderPointerDown}
        onDoubleClick={onDoubleClick}
        pinned={pinned}
        onTogglePin={onTogglePin}
      />

      <PlanModeStrip />
      <ActivityStrip />

      <div className="flex min-h-0 flex-1 flex-col">
        {showHistory ? (
          <HistoryPanel
            onClose={() => setShowHistory(false)}
            onSwitch={(id) => {
              switchSession(id);
              setShowHistory(false);
            }}
          />
        ) : helpers.messages.length === 0 ? (
          <EmptyState onPick={focusInput} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px] [&_p]:leading-relaxed">
            <AiChatView
              messages={helpers.messages}
              status={helpers.status}
              error={helpers.error}
              clearError={helpers.clearError}
              addToolApprovalResponse={addToolApprovalResponse}
              stop={helpers.stop}
              onEditAndResend={onEditAndResend}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 px-2 py-1.5">
        <AiComposerInput />
      </div>
      <TodoStrip sessionId={sessionId} />
    </>
  );
}

function PlanModeStrip() {
  const { t } = useI18n();
  const active = usePlanStore((s) => s.active);
  const queueLen = usePlanStore((s) => s.queue.length);
  const disable = usePlanStore((s) => s.disable);
  if (!active) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/40 px-3 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="text-[11px] font-medium text-foreground">{t("ai.planMode")}</span>
      <span className="text-[11px] text-muted-foreground">
        {t(queueLen > 0 ? "ai.editsQueued" : "ai.noEditsQueued", { n: queueLen })}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => disable()}
        className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {t("ai.exit")}
      </button>
    </div>
  );
}

function EmptyShell({
  onClose,
  onExpand,
  onHeaderPointerDown,
}: {
  onClose: () => void;
  onExpand: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <>
      <Header
        step={null}
        isBusy={false}
        onClose={onClose}
        onExpand={onExpand}
        onHeaderPointerDown={onHeaderPointerDown}
      />
      <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
        {tStatic("ai.loadingSessions")}
      </div>
    </>
  );
}

function Header({
  step,
  isBusy,
  onClose,
  showHistory,
  onToggleHistory,
  onHeaderPointerDown,
  onDoubleClick,
  pinned,
  onTogglePin,
}: {
  step: string | null;
  isBusy: boolean;
  onClose: () => void;
  onExpand: () => void;
  showHistory?: boolean;
  onToggleHistory?: () => void;
  onHeaderPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const { t } = useI18n();
  const customAgents = useAgentsStore((s) => s.customAgents);
  void customAgents;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onHeaderPointerDown}
      onDoubleClick={onDoubleClick}
      className="relative flex h-11 shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border/60 px-3 active:cursor-grabbing"
    >
      <div className="flex min-w-0 items-center">
        <ResourceStatsIndicator />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isBusy ? (
          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Spinner className="size-2.5" />
            <span className="max-w-32 truncate">{step ?? t("ai.thinking")}</span>
          </span>
        ) : null}
        <SessionPicker />
        <button
          type="button"
          onClick={onToggleHistory}
          title={t("ai.history")}
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            showHistory && "bg-accent text-foreground",
          )}
        >
          <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onTogglePin}
          title={pinned ? t("ai.unpin") : t("ai.pinOnTop")}
          className={cn(
            "flex size-5 items-center justify-center rounded-md transition-colors hover:bg-accent",
            pinned ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <title>Pin</title>
            <path d="M12 2v8m-4 0h8m-2 0v12" />
          </svg>
        </button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="size-5"
          aria-label={t("common.close")}
          title={t("ai.closeEsc")}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

function SessionPicker() {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  if (!active) return null;

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-48 items-center gap-1 rounded-md px-1.5 py-1",
            "text-[11px] text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
          )}
          title={t("ai.switchSession")}
        >
          <span className="truncate">{active.title || t("ai.newChat")}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={10}
            strokeWidth={2}
            className="opacity-70"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem
          onSelect={() => newSession()}
          className="gap-2 text-xs"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          {t("ai.newSession")}
        </DropdownMenuItem>
        {sorted.length > 0 ? <DropdownMenuSeparator /> : null}
        {sorted.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => switchSession(s.id)}
            onDelete={() => deleteSession(s.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const renameSession = useChatStore((s) => s.renameSession);
  const [editing, setEditing] = useState(false);
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        // Don't dismiss if user clicked the trash or rename icon — handled below.
        const target = e.target as HTMLElement | null;
        if (
          target?.closest("[data-session-delete]") ||
          target?.closest("[data-session-rename]")
        ) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      className={cn(
        "group flex items-center justify-between gap-2 text-xs",
        active && "bg-accent/40",
      )}
    >
      {editing ? (
        <InlineInput
          initial={session.title || ""}
          placeholder={t("ai.sessionTitlePlaceholder")}
          onCommit={(value) => {
            const trimmed = value.trim();
            if (trimmed && trimmed !== session.title) {
              renameSession(session.id, trimmed);
            }
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {session.title || t("ai.newChat")}
        </span>
      )}
      <button
        type="button"
        data-session-rename
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        title={t("ai.renameSession")}
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Edit01Icon} size={11} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        data-session-delete
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title={t("ai.deleteSession")}
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
      </button>
    </DropdownMenuItem>
  );
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff <= 0) return tStatic("ai.today");
  if (diff === 1) return tStatic("ai.yesterday");
  return d.toLocaleDateString();
}

function timeLabel(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

function HistoryPanel({
  onClose,
  onSwitch,
}: {
  onClose: () => void;
  onSwitch: (id: string) => void;
}) {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const filtered = q
      ? sorted.filter((s) => (s.title || "").toLowerCase().includes(q))
      : sorted;
    const map = new Map<string, SessionMeta[]>();
    for (const s of filtered) {
      const key = dayKey(s.updatedAt);
      const arr = map.get(key);
      if (arr) arr.push(s);
      else map.set(key, [s]);
    }
    return [...map.entries()];
  }, [sessions, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("ai.historySearch")}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          onClick={() => exportSessionsAsMarkdown().then((md) => {
            const blob = new Blob([md], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "YaMet-sessions.md";
            a.click();
            URL.revokeObjectURL(url);
          })}
          title="Export all"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <title>Export all</title>
            <path d="M12 3v12m-4-4 4 4 4-4M4 20h16"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => { clearAllSessions(); onSwitch(""); }}
          title="Clear all"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <title>Clear all</title>
            <path d="M3 6h18M8 6V4h8v2m2 0v14H6V6"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("ai.closeEsc")}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {groups.length === 0 ? (
          <div className="py-8 text-center text-[11.5px] text-muted-foreground">
            {t("ai.historyEmpty")}
          </div>
        ) : (
          groups.map(([label, list]) => (
            <div key={label} className="mb-2">
              <div className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {label}
              </div>
              {list.map((s) => (
                <HistoryRow
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  editing={editingId === s.id}
                  onSelect={() => onSwitch(s.id)}
                  onRename={() => setEditingId(s.id)}
                  onCommitRename={(value) => {
                    const trimmed = value.trim();
                    if (trimmed && trimmed !== s.title) {
                      renameSession(s.id, trimmed);
                    }
                    setEditingId(null);
                  }}
                  onCancelRename={() => setEditingId(null)}
                  onDelete={() => deleteSession(s.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  session,
  active,
  editing,
  onSelect,
  onRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onRename: () => void;
  onCommitRename: (value: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={editing ? undefined : onSelect}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      {editing ? (
        <div className="min-w-0 flex-1">
          <InlineInput
            initial={session.title || ""}
            placeholder={t("ai.sessionTitlePlaceholder")}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
            {session.title || t("ai.newChat")}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
            {timeLabel(session.updatedAt)}
          </span>
          <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
              title={t("ai.renameSession")}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon icon={Edit01Icon} size={11} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title={t("ai.deleteSession")}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <img src="/logo.png" alt="YaMet" className="size-14 opacity-90" />
      <div className="space-y-1.5">
        <p className="text-[14px] font-semibold tracking-tight">
          {t("ai.askYamet")}
        </p>
        <p className="max-w-[18rem] text-[11.5px] leading-relaxed text-muted-foreground">
          {t("ai.terminalSeesHint")}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.labelKey}
            type="button"
            onClick={() => onPick(t(s.textKey))}
            className={cn(
              "group flex items-center gap-2.5 bg-card/70 rounded-lg px-2.5 py-2 border border-border text-left",
              "transition-colors hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground transition-colors group-hover:bg-foreground/5 group-hover:text-foreground">
              <HugeiconsIcon icon={s.icon} size={13} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {t(s.labelKey)}
              </div>
              <div className="text-[10.5px] text-muted-foreground">
                {t(s.hintKey)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
