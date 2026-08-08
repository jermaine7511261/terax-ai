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
import { useMcpStore, useMcpStatusBridge } from "@/modules/mcp";
import {
  Delete02Icon,
  Refresh01Icon,
  Plug01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

export function McpServersGroup() {
  const { t } = useI18n();
  useMcpStatusBridge();
  const servers = useMcpStore((s) => s.servers);
  const loaded = useMcpStore((s) => s.loaded);
  const busy = useMcpStore((s) => s.busy);
  const refresh = useMcpStore((s) => s.refresh);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{t("settingsMcp.servers")}</Label>
        <AddMcpServerDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdded={() => setAddOpen(false)}
        />
      </div>
      {!loaded ? (
        <p className="text-xs text-muted-foreground">{t("settingsMcp.checking")}</p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("settingsMcp.empty")}</p>
      ) : (
        servers.map((s) => (
          <McpServerRow key={s.id} id={s.id} busy={busy[s.id] ?? false} />
        ))
      )}
      <p className="text-[11px] text-muted-foreground">{t("settingsMcp.description")}</p>
    </div>
  );
}

function McpServerRow({ id, busy }: { id: string; busy: boolean }) {
  const { t } = useI18n();
  const server = useMcpStore((s) => s.servers.find((x) => x.id === id));
  const connect = useMcpStore((s) => s.connect);
  const disconnect = useMcpStore((s) => s.disconnect);
  const remove = useMcpStore((s) => s.remove);
  const refreshServer = useMcpStore((s) => s.refreshServer);
  if (!server) return null;

  const connected = server.status === "connected";
  const connecting = server.status === "connecting";
  const statusDot = server.status === "connected" ? "bg-emerald-500" : server.status === "error" ? "bg-red-500" : server.status === "connecting" ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/40";

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-1.5">
          {server.name}
          <span className={`size-1.5 rounded-full ${statusDot}`} />
        </span>
      }
      description={`${server.transport} · ${
        server.status === "error" && server.error
          ? server.error
          : t(`settingsMcp.status.${server.status}`)
      }${
        connected
          ? ` · ${server.tools.length} ${t("settingsMcp.tools")}${
              server.resources.length > 0
                ? ` · ${server.resources.length} ${t("settingsMcp.resources")}`
                : ""
            }`
          : ""
      }`}
    >
      <div className="flex items-center gap-1.5">
        <IconButton
          title={t("settingsMcp.refresh")}
          onClick={() => void refreshServer(id)}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          title={t("settingsMcp.remove")}
          className="hover:text-destructive"
          onClick={() => void remove(id)}
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
        </IconButton>
        <Button
          variant={connected ? "outline" : "default"}
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          disabled={busy || connecting}
          onClick={() => {
            if (connected) void disconnect(id);
            else void connect(id, null);
          }}
        >
          <HugeiconsIcon icon={Plug01Icon} size={11} strokeWidth={1.75} />
          {connecting
            ? t("settingsMcp.connecting")
            : connected
              ? t("settingsMcp.disconnect")
              : t("settingsMcp.connect")}
        </Button>
      </div>
    </SettingRow>
  );
}

function AddMcpServerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const add = useMcpStore((s) => s.add);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [cwd, setCwd] = useState("");
  const formId = useId();

  const id = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const valid =
    id.length > 0 &&
    (transport === "stdio" ? command.trim().length > 0 : url.trim().length > 0);

  const save = async () => {
    if (!valid) return;
    const config = {
      id,
      name: name.trim(),
      transport,
      ...(transport === "stdio"
        ? {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
          }
        : { url: url.trim() }),
      cwd: cwd.trim() || undefined,
    };
    try {
      await add(config);
      onAdded();
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setCwd("");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
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
          {t("settingsMcp.addServer")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("settingsMcp.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          {field(t("common.name"), name, setName, "filesystem")}
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">{t("settingsMcp.transport")}</Label>
            <div className="flex gap-1.5">
              {(["stdio", "sse"] as const).map((tr) => (
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
              {field(t("settingsMcp.command"), command, setCommand, "npx")}
              {field(t("settingsMcp.args"), args, setArgs, "-y @modelcontextprotocol/server-filesystem /path")}
              {field(t("settingsMcp.cwd"), cwd, setCwd, t("settingsMcp.cwdPlaceholder"))}
            </>
          ) : (
            field(t("settingsMcp.url"), url, setUrl, "http://localhost:3001/sse")
          )}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!valid} onClick={() => void save()}>
            {t("settingsMcp.addServer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconButton({
  children,
  title,
  className,
  onClick,
}: {
  children: ReactNode;
  title: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
