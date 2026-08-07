import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { InlineInput } from "@/modules/explorer/InlineInput";
import type { SessionMeta } from "../lib/sessions";
import { useChatStore } from "../store/chatStore";
import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Edit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

/** Shared session-picker + new-session button. Used by both the main window and
 *  the mini window header. */
export function SessionBar({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 border-b border-border/40 px-3 py-1",
        compact ? "h-8" : "h-9",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => newSession()}
        title={t("ai.newSession")}
        className="h-6 gap-1 rounded-md px-1.5 text-[11px]"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
        <span className="hidden sm:inline">{t("ai.newSession")}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1",
              "text-[11px] text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
            )}
            title={t("ai.switchSession")}
          >
            <span className="truncate">{active?.title || "New chat"}</span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={10}
              strokeWidth={2}
              className="shrink-0 opacity-70"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-48">
          <DropdownMenuItem
            onSelect={() => newSession()}
            className="gap-2 text-xs"
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            {t("ai.newSession")}
          </DropdownMenuItem>
          {sorted.length > 0 ? <DropdownMenuSeparator /> : null}
          {sorted.map((s) => (
            <SessionBarRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              editing={editingId === s.id}
              onSelect={() => switchSession(s.id)}
              onStartEdit={() => setEditingId(s.id)}
              onCommitEdit={(value) => {
                const trimmed = value.trim();
                if (trimmed && trimmed !== s.title)
                  renameSession(s.id, trimmed);
                setEditingId(null);
              }}
              onCancelEdit={() => setEditingId(null)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SessionBarRow({
  session,
  active,
  editing,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: (v: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuItem
      onSelect={(e) => {
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
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {session.title || "New chat"}
        </span>
      )}
      <button
        type="button"
        data-session-rename
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit();
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
