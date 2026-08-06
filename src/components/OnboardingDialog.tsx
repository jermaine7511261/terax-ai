import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import {
  CodeCircleIcon,
  CodeIcon,
  Key02Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persist "onboarded" so the dialog never shows again. */
  onComplete: () => void;
};

function Feature({
  icon,
  title,
  desc,
}: {
  icon: IconSvgElement;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={icon} size={18} strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          {desc}
        </div>
      </div>
    </div>
  );
}

/** First-run welcome dialog: introduces the three core surfaces (terminal,
 *  editor, AI agent) and is shown once until dismissed. */
export function OnboardingDialog({ open, onOpenChange, onComplete }: Props) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={CodeCircleIcon} size={18} strokeWidth={1.75} />
            <span>{t("onboarding.title")}</span>
          </DialogTitle>
          <DialogDescription>{t("onboarding.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Feature
            icon={TerminalIcon}
            title={t("onboarding.terminal")}
            desc={t("onboarding.terminalDesc")}
          />
          <Feature
            icon={CodeIcon}
            title={t("onboarding.editor")}
            desc={t("onboarding.editorDesc")}
          />
          <Feature
            icon={CodeCircleIcon}
            title={t("onboarding.ai")}
            desc={t("onboarding.aiDesc")}
          />
          <Feature
            icon={Key02Icon}
            title={t("onboarding.aiKey")}
            desc={t("onboarding.aiKeyDesc")}
          />
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("onboarding.skip")}
          </Button>
          <Button onClick={() => onComplete()}>
            {t("onboarding.getStarted")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
