import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingRow } from "@/settings/components/SettingRow";
import { useI18n } from "@/lib/i18n";
import { useDapStore } from "@/modules/dap";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { useEffect, useId, useState } from "react";

export function DapAdaptersGroup() {
  const { t } = useI18n();
  const sessions = useDapStore((s) => s.sessions);
  const loaded = useDapStore((s) => s.loaded);
  const refresh = useDapStore((s) => s.refresh);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{t("settingsDap.adapters")}</Label>
        <AddAdapterDialog open={addOpen} onOpenChange={setAddOpen} onAdded={() => setAddOpen(false)} />
      </div>
      {!loaded ? (
        <p className="text-xs text-muted-foreground">{t("settingsMcp.checking")}</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("settingsDap.empty")}</p>
      ) : (
        sessions.map((s) => <AdapterRow key={s.id} id={s.id} />)
      )}
      <p className="text-[11px] text-muted-foreground">{t("settingsDap.description")}</p>
    </div>
  );
}

function AdapterRow({ id }: { id: string }) {
  const { t } = useI18n();
  const session = useDapStore((s) => s.sessions.find((x) => x.id === id));
  const removeConfig = useDapStore((s) => s.removeConfig);
  if (!session) return null;
  const statusDot =
    session.status === "running" || session.status === "stopped"
      ? "bg-emerald-500"
      : session.status === "error"
        ? "bg-red-500"
        : session.status === "initializing" || session.status === "initialized"
          ? "bg-amber-400"
          : "bg-muted-foreground/40";

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-1.5">
          {session.id}
          <span className={`size-1.5 rounded-full ${statusDot}`} />
        </span>
      }
      description={`${session.adapterType} · ${session.transport} · ${
        session.status === "error" && session.error
          ? session.error
          : t(`settingsDap.status.${session.status}`)
      }`}
    >
      <button
        type="button"
        className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
        title={t("settingsDap.remove")}
        onClick={() => void removeConfig(id)}
      >
        <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
      </button>
    </SettingRow>
  );
}

function AddAdapterDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const createSession = useDapStore((s) => s.createSession);
  const [id, setId] = useState("");
  const [adapterType, setAdapterType] = useState("");
  const [transport, setTransport] = useState<"stdio" | "tcp">("stdio");
  const [adapterCommand, setAdapterCommand] = useState("");
  const [adapterArgs, setAdapterArgs] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("4711");
  const formId = useId();

  const valid =
    id.trim().length > 0 &&
    adapterType.trim().length > 0 &&
    (transport === "stdio" ? adapterCommand.trim().length > 0 : port.trim().length > 0);

  const save = async () => {
    if (!valid) return;
    const config = {
      id: id.trim(),
      adapterType: adapterType.trim(),
      transport,
      ...(transport === "stdio"
        ? {
            adapterCommand: adapterCommand.trim(),
            adapterArgs: adapterArgs.trim() ? adapterArgs.trim().split(/\s+/) : [],
          }
        : { host: host.trim(), port: Number(port) }),
    };
    try {
      await createSession(config);
      onAdded();
      setId("");
      setAdapterType("");
      setAdapterCommand("");
      setAdapterArgs("");
    } catch (e) {
      console.error("[YaMet] dap create failed", e);
      const msg = String(e instanceof Error ? e.message : e);
      try {
        const parsed = JSON.parse(msg) as { code?: string; command?: string };
        if (parsed.code === "adapter_missing") {
          toast.error(
            t("settingsDap.adapterMissing", { command: parsed.command ?? "" }),
            {
              duration: 8000,
            },
          );
          return;
        }
      } catch {
        // not the structured adapter_missing error
      }
      toast.error(msg);
    }
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${formId}-${label}`} className="text-[11px]">
        {label}
      </Label>
      <Input
        id={`${formId}-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]">
          {t("settingsDap.addAdapter")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("settingsDap.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          {field(t("settingsDap.id"), id, setId, "gdb")}
          {field(t("settingsDap.adapterType"), adapterType, setAdapterType, "gdb / lldb / debugpy")}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">{t("settingsMcp.transport")}</Label>
            <div className="flex gap-1.5">
              {(["stdio", "tcp"] as const).map((tr) => (
                <button
                  key={tr}
                  type="button"
                  className={`h-6 flex-1 rounded-md border px-2 text-[11px] ${
                    transport === tr
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                  onClick={() => setTransport(tr)}
                >
                  {tr.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {transport === "stdio" ? (
            <>
              {field(t("settingsDap.adapterCommand"), adapterCommand, setAdapterCommand, "gdb")}
              {field(t("settingsLsp.args"), adapterArgs, setAdapterArgs, "--interpreter=mi2")}
            </>
          ) : (
            <>
              {field(t("settingsDap.host"), host, setHost, "127.0.0.1")}
              {field(t("settingsDap.port"), port, setPort, "4711")}
            </>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!valid} onClick={() => void save()}>
            {t("settingsDap.addAdapter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
