import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  ArrowUpIcon,
  Message01Icon,
  Mic01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef } from "react";
import { STT_PROVIDER_LABELS } from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { useChatStore } from "../store/chatStore";

export function AiOpenButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-xs",
        "text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
        "animate-in slide-in-from-top-2 duration-200 ease-out",
      )}
      title={t("ai.openAiAgent")}
    >
      <span>{t("ai.openAiAgent")}</span>
      <Kbd className="h-4 min-w-4 px-1">{fmtShortcut(MOD_KEY, "I")}</Kbd>
    </button>
  );
}

export function AiStatusBarControls() {
  const { t } = useI18n();
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const miniOpen = useChatStore((s) => s.mini.open);
  const closePanel = useChatStore((s) => s.closePanel);

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title={t("ai.attachFile")}
        onClick={() => fileInputRef.current?.click()}
        disabled={c.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {c.voice.supported && (
        <IconBtn
          title={
            !c.voice.hasKey
              ? t("ai.voiceNeedsKey", {
                  provider: STT_PROVIDER_LABELS[c.voice.sttProvider],
                })
              : c.voice.recording
                ? t("ai.stopTranscribe")
                : c.voice.transcribing
                  ? t("ai.transcribing")
                  : t("ai.voiceInput")
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
          className={cn(
            c.voice.recording &&
            "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}

      <span className="mx-1 h-8 w-px bg-border" aria-hidden />
      <Button
        onClick={closePanel}
        title={t("ai.closePanel")}
        size="xs"
        variant="ghost"
        aria-label={t("ai.closePanel")}
        className="text-[11px] text-foreground/85 px-1"
      >
        <Kbd className="h-4 gap-px px-2 font-mono text-[11px]">
          {fmtShortcut(MOD_KEY, "I")}
        </Kbd>
      </Button>
      <IconBtn
        title={t("ai.toggleChatWindow", {
          action: miniOpen ? t("common.close") : t("common.open"),
          shortcut: fmtShortcut("⇧", MOD_KEY, "I"),
        })}
        onClick={toggleMini}
      >
        <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
      </IconBtn>

      {c.isBusy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={c.stop}
          className="size-6"
          aria-label={t("ai.stop")}
          title={t("ai.stop")}
        >
          <HugeiconsIcon icon={StopCircleIcon} size={13} strokeWidth={1.75} />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={c.submit}
          disabled={!c.canSend}
          className="h-5.5 w-7.5 ml-1"
          aria-label={t("ai.send")}
          title={t("ai.sendEnter")}
        >
          <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
