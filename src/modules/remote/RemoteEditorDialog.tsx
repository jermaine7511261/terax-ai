import { useCallback, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { invoke } from "@/platform";
import type { SshTarget } from "@/modules/tabs";
import { toast } from "sonner";

interface Props {
  target: SshTarget;
  path: string;
  initialContent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Remote file editor — loads content via `sftp_read` (passed in as
 * `initialContent`), lets the user edit it with CodeMirror, and writes it
 * back to the remote host via `sftp_write`. This closes the read-only
 * preview gap for SFTP browsing.
 */
export function RemoteEditorDialog({
  target,
  path,
  initialContent,
  open,
  onOpenChange,
}: Props) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await invoke("sftp_write", { target, path, content });
      toast.success(t("remote.saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error(t("remote.saveFailed"), { description: String(e) });
    } finally {
      setSaving(false);
    }
  }, [target, path, content, onOpenChange, t]);

  const title = `${t("remote.editTitle")} — ${path}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[85vw] max-w-none flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate text-sm font-medium">
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60">
          <CodeMirror
            value={content}
            onChange={(v) => setContent(v)}
            height="100%"
            className="h-full"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              searchKeymap: true,
            }}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t("remote.saving") : t("remote.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
