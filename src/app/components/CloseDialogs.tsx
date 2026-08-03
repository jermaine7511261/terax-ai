import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AppCloseBlocker } from "@/app/hooks/useAppCloseGuard";
import {
  useI18n,
  type Interpolations,
  type TranslationKey,
} from "@/lib/i18n";
import type { Tab } from "@/modules/tabs";

type Props = {
  tabs: Tab[];
  pendingCloseTab: number | null;
  onCancelClose: () => void;
  onConfirmClose: () => void;
  pendingTerminalCloseTab: number | null;
  onCancelTerminalClose: () => void;
  onConfirmTerminalClose: () => void;
  pendingDeleteTabs: number[] | null;
  onCancelDeleteClose: () => void;
  onConfirmDeleteClose: () => void;
  pendingAppClose: AppCloseBlocker | null;
  onCancelAppClose: () => void;
  onConfirmAppClose: () => void;
};

/** Confirmation dialogs for closing dirty editors and terminals with live processes. */
export function CloseDialogs({
  tabs,
  pendingCloseTab,
  onCancelClose,
  onConfirmClose,
  pendingTerminalCloseTab,
  onCancelTerminalClose,
  onConfirmTerminalClose,
  pendingDeleteTabs,
  onCancelDeleteClose,
  onConfirmDeleteClose,
  pendingAppClose,
  onCancelAppClose,
  onConfirmAppClose,
}: Props) {
  const { t } = useI18n();

  return (
    <>
      <AlertDialog
        open={pendingCloseTab !== null}
        onOpenChange={(open) => !open && onCancelClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogs.unsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const title = tabs.find((t) => t.id === pendingCloseTab)?.title;
                return title
                  ? t("dialogs.unsavedBody", { name: title })
                  : t("dialogs.unsavedBodyGeneric");
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelClose}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmClose}>
              {t("dialogs.closeAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingTerminalCloseTab !== null}
        onOpenChange={(open) => !open && onCancelTerminalClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("dialogs.closeTerminalTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("dialogs.closeTerminalBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelTerminalClose}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmTerminalClose}>
              {t("dialogs.closeAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteTabs !== null}
        onOpenChange={(open) => !open && onCancelDeleteClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogs.unsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                if (pendingDeleteTabs?.length === 1) {
                  const title = tabs.find(
                    (t) => t.id === pendingDeleteTabs[0],
                  )?.title;
                  return title
                    ? t("dialogs.deletedUnsavedBody", { name: title })
                    : t("dialogs.deletedUnsavedBodyGeneric");
                }
                return t("dialogs.deletedFilesBody", {
                  count: String(pendingDeleteTabs?.length ?? 0),
                });
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelDeleteClose}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDeleteClose}>
              {t("dialogs.closeAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingAppClose !== null}
        onOpenChange={(open) => !open && onCancelAppClose()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogs.quitTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAppClose
                ? appCloseMessage(t, pendingAppClose)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onCancelAppClose}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmAppClose}>
              {t("dialogs.quitAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function appCloseMessage(
  t: (key: TranslationKey, params?: Interpolations) => string,
  blocker: AppCloseBlocker,
): string {
  const dirty: Interpolations = {
    dirty:
      blocker.dirtyEditors === 1
        ? t("dialogs.dirtyOneFile")
        : t("dialogs.dirtyFiles", {
            count: String(blocker.dirtyEditors),
          }),
  };
  if (blocker.dirtyEditors > 0 && blocker.busyTerminal) {
    return t("dialogs.closeAppBoth", dirty);
  }
  if (blocker.dirtyEditors > 0) {
    return t("dialogs.closeAppDirty");
  }
  return t("dialogs.closeAppProcess");
}
