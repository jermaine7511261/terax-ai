import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  newMcpServerId,
  type McpServerConfig,
  type McpTransport,
} from "@/modules/ai/lib/mcp";
import { useMcpStore } from "@/modules/ai/store/mcpStore";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  ServerStack02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

/**
 * MCP servers settings area: add / edit / connect / disconnect / delete MCP
 * servers. Tool counts and connection state come from the backend `mcp_status`.
 * (Split out of the former SkillsMcpSection into its own settings tab.)
 */

export function McpSection() {
  const { t } = useI18n();

  // MCP servers
  const mcpServers = useMcpStore((s) => s.servers);
  const statusByServer = useMcpStore((s) => s.statusByServer);
  const hydrateMcp = useMcpStore((s) => s.hydrate);
  const upsertServer = useMcpStore((s) => s.upsert);
  const removeServer = useMcpStore((s) => s.remove);
  const connectServer = useMcpStore((s) => s.connect);
  const disconnectServer = useMcpStore((s) => s.disconnect);

  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(
    null,
  );

  useEffect(() => {
    void hydrateMcp();
  }, [hydrateMcp]);

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader title={t("mcp.title")} description={t("mcp.description")} />

      {/* ---- MCP servers ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label>
              <span className="inline-flex items-center gap-1">
                <HugeiconsIcon
                  icon={ServerStack02Icon}
                  size={11}
                  strokeWidth={1.75}
                />
                {t("mcp.mcpServers")}
              </span>
            </Label>
            <span className="text-[10.5px] text-muted-foreground">
              {t("mcp.mcpDescription")}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() =>
              setEditingServer({
                id: newMcpServerId(),
                name: "",
                transport: "stdio",
                command: "",
                args: [],
                cwd: "",
                env: {},
                url: "",
                headers: {},
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            {t("mcp.newServer")}
          </Button>
        </div>

        {mcpServers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-6 text-center text-[11px] text-muted-foreground">
            {t("mcp.emptyServers")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {mcpServers.map((s) => {
              const status = statusByServer[s.id];
              const connected = status?.connected ?? false;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      connected ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">
                        {s.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="px-1 py-0 text-[9px] font-normal"
                      >
                        {s.transport}
                      </Badge>
                    </div>
                    <span className="truncate text-[10.5px] text-muted-foreground">
                      {s.transport === "stdio"
                        ? `${s.command}${s.args.length ? ` ${s.args.join(" ")}` : ""}`
                        : s.url}
                    </span>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {status
                      ? t("mcp.toolCount", { count: status.tool_count })
                      : t("mcp.disconnected")}
                  </span>
                  <Button
                    size="sm"
                    variant={connected ? "outline" : "default"}
                    className="h-6 gap-1 px-2 text-[10.5px]"
                    onClick={() =>
                      connected
                        ? void disconnectServer(s.id)
                        : void connectServer(s.id)
                    }
                  >
                    {connected ? (
                      <>
                        <HugeiconsIcon
                          icon={CheckmarkCircle02Icon}
                          size={10}
                          strokeWidth={2}
                        />
                        {t("mcp.disconnect")}
                      </>
                    ) : (
                      t("mcp.connect")
                    )}
                  </Button>
                  <div className="flex gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      onClick={() => setEditingServer(s)}
                      title={t("common.edit")}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        size={11}
                        strokeWidth={1.75}
                      />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={() => void removeServer(s.id)}
                      title={t("common.delete")}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        size={11}
                        strokeWidth={1.75}
                      />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <McpServerDialog
        server={editingServer}
        existing={mcpServers}
        onClose={() => setEditingServer(null)}
        onSave={(s) => {
          void upsertServer(s);
          setEditingServer(null);
        }}
      />
    </div>
  );
}

function McpServerDialog({
  server,
  existing,
  onClose,
  onSave,
}: {
  server: McpServerConfig | null;
  existing: McpServerConfig[];
  onClose: () => void;
  onSave: (s: McpServerConfig) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<McpServerConfig | null>(server);
  useEffect(() => setDraft(server), [server]);
  if (!draft) return null;

  const isNew = !existing.some((s) => s.id === draft.id);
  const canSave =
    draft.name.trim().length > 0 &&
    (draft.transport === "stdio"
      ? draft.command.trim().length > 0
      : draft.url.trim().length > 0);

  return (
    <Dialog open={!!server} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {isNew ? t("mcp.newServer") : t("mcp.editServer")}
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-2 flex max-h-[calc(100vh-14rem)] flex-col gap-3 overflow-y-auto px-2">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label>{t("mcp.serverName")}</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("mcp.serverNamePlaceholder")}
                className="h-8 text-[12px]"
              />
            </div>
            <div className="flex w-32 flex-col gap-1">
              <Label>{t("mcp.transport")}</Label>
              <Select
                value={draft.transport}
                onValueChange={(v) =>
                  setDraft({ ...draft, transport: v as McpTransport })
                }
              >
                <SelectTrigger className="h-8 text-[11.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {draft.transport === "stdio" ? (
            <>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.command")}</Label>
                <Input
                  value={draft.command}
                  onChange={(e) =>
                    setDraft({ ...draft, command: e.target.value })
                  }
                  placeholder={t("mcp.commandPlaceholder")}
                  className="h-8 font-mono text-[11.5px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.args")}</Label>
                <Input
                  value={draft.args.join(", ")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      args: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="h-8 font-mono text-[11.5px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.cwd")}</Label>
                <Input
                  value={draft.cwd}
                  onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                  className="h-8 font-mono text-[11.5px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.env")}</Label>
                <Textarea
                  value={kvToText(draft.env, "=")}
                  onChange={(e) =>
                    setDraft({ ...draft, env: textToKV(e.target.value, "=") })
                  }
                  className="min-h-16 resize-y font-mono text-[11px] leading-relaxed"
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.url")}</Label>
                <Input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder={t("mcp.urlPlaceholder")}
                  className="h-8 font-mono text-[11.5px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("mcp.headers")}</Label>
                <Textarea
                  value={kvToText(draft.headers, ": ")}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      headers: textToKV(e.target.value, ": "),
                    })
                  }
                  className="min-h-16 resize-y font-mono text-[11px] leading-relaxed"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => onSave(draft)}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function kvToText(kv: Record<string, string>, sep: string): string {
  return Object.entries(kv)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");
}

function textToKV(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(sep);
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + sep.length).trim();
    if (k) out[k] = v;
  }
  return out;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

