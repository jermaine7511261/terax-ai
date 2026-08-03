import { useChat, type UIMessage } from "@ai-sdk/react";
import { useCallback, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAutoApproveTools } from "@/modules/settings/store";
import { useChatStore } from "../store/chatStore";
import { getOrCreateChat } from "../store/chatRuntime";
import { AiChatView } from "./AiChat";

/**
 * Full-screen chat view, rendered as the default home tab. Conversation and
 * message status live in the chat store; the composer input is provided by the
 * workspace input bar below this surface.
 */
export function AiChatPanel() {
  const sessionId = useChatStore((s) => s.activeSessionId);
  if (!sessionId) return <PanelPlaceholder />;
  return <ChatBody sessionId={sessionId} />;
}

function ChatBody({ sessionId }: { sessionId: string }) {
  const focusInput = useChatStore((s) => s.focusInput);
  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });

  // Any manual approval decision arms "auto-approve the rest of this session".
  const addToolApprovalResponse = useCallback(
    (arg: { id: string; approved: boolean }) => {
      useChatStore.getState().markFirstApprovalResolved();
      helpers.addToolApprovalResponse(arg);
    },
    [helpers.addToolApprovalResponse],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader />
      <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[13px] [&_p]:leading-relaxed">
        {helpers.messages.length === 0 ? (
          <EmptyState onPick={focusInput} />
        ) : (
          <AiChatView
            messages={helpers.messages}
            status={helpers.status}
            error={helpers.error}
            clearError={helpers.clearError}
            addToolApprovalResponse={addToolApprovalResponse}
            stop={helpers.stop}
          />
        )}
      </div>
    </div>
  );
}

function PanelHeader() {
  const { t } = useI18n();
  const autoApprove = usePreferencesStore((s) => s.autoApproveTools);
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border/40 px-1 pb-2">
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground">
              <Switch
                checked={autoApprove}
                onCheckedChange={(v) => void setAutoApproveTools(v)}
                className="scale-75"
              />
              <span>{t("ai.autoApproveLabel")}</span>
            </label>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-[11px]">
            {t("ai.autoApproveHint")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function PanelPlaceholder() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center text-[12px] text-muted-foreground">
      …
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/[0.05]">
        <img
          src="/logo.png"
          alt=""
          className="size-9 opacity-90"
          draggable={false}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold tracking-tight">
          {t("ai.askYamet")}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {t("ai.emptyHint")}
        </span>
      </div>
      <button
        type="button"
        onClick={onPick}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {t("ai.startConversation")}
      </button>
    </div>
  );
}
