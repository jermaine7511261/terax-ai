import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import type { SshTarget } from "@/modules/tabs";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (target: SshTarget) => void;
};

function parseHost(value: string): string {
  return value.trim().replace(/^ssh:\/\//, "");
}

export function SshConnectDialog({ open, onOpenChange, onConnect }: Props) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [identityFile, setIdentityFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTimeout(() => hostRef.current?.focus(), 0);
  }, [open]);

  const submit = useCallback(() => {
    const h = parseHost(host);
    if (!h) {
      setError(t("ssh.hostRequired"));
      return;
    }
    let p: number | undefined = undefined;
    const trimmedPort = port.trim();
    if (trimmedPort && trimmedPort !== "22") {
      p = Number(trimmedPort);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        setError(t("ssh.invalidPort"));
        return;
      }
    }
    onConnect({
      host: h,
      ...(p !== undefined && { port: p }),
      ...(user.trim() && { user: user.trim() }),
      ...(identityFile.trim() && { identityFile: identityFile.trim() }),
    });
    onOpenChange(false);
  }, [host, user, port, identityFile, onConnect, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ssh.title")}</DialogTitle>
          <DialogDescription>{t("ssh.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-host">{t("ssh.host")}</Label>
            <Input
              id="ssh-host"
              ref={hostRef}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssh-user">{t("ssh.user")}</Label>
              <Input
                id="ssh-user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ssh-port">{t("ssh.port")}</Label>
              <Input
                id="ssh-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ssh-identity">{t("ssh.identityFile")}</Label>
            <Input
              id="ssh-identity"
              value={identityFile}
              onChange={(e) => setIdentityFile(e.target.value)}
              placeholder="~/.ssh/id_ed25519"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit}>{t("ssh.connect")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
