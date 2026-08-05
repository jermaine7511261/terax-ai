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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { scanSkillsDir } from "@/modules/ai/lib/skills";
import {
  isValidHandle,
  normalizeHandle,
  type Snippet,
} from "@/modules/ai/lib/snippets";
import {
  newSnippetId,
  useSnippetsStore,
} from "@/modules/ai/store/snippetsStore";
import { useSchedulerStore } from "@/modules/ai/store/schedulerStore";
import {
  newSchedulerTaskId,
  type ScheduledTask,
  type SchedulerTarget,
} from "@/modules/ai/lib/scheduler";
import { TOOL_REGISTRY } from "@/modules/ai/tools/registry";
import {
  Add01Icon,
  Delete02Icon,
  Edit02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";

/**
 * Skills settings area (split out of the former SkillsMcpSection into its own
 * settings tab):
 *  - Snippets / Skills: the snippet editor with a tool-allowlist multi-select.
 *  - Built-in skills: from `<workspace>/skills/`, listed with an enable/disable
 *    switch + a rescan button.
 *  - Scheduled tasks (cron): cron-triggered agent tasks.
 */

export function SkillsSection() {
  const { t } = useI18n();

  // Snippets / skills
  const snippets = useSnippetsStore((s) => s.snippets);
  const upsertSnippet = useSnippetsStore((s) => s.upsert);
  const removeSnippet = useSnippetsStore((s) => s.remove);
  const hydrateSnippets = useSnippetsStore((s) => s.hydrate);
  const disabledBuiltinHandles = useSnippetsStore(
    (s) => s.disabledBuiltinHandles,
  );
  const toggleBuiltin = useSnippetsStore((s) => s.toggleBuiltin);

  // Scheduled tasks (★ H3 Hermes cron)
  const tasks = useSchedulerStore((s) => s.tasks);
  const hydrateScheduler = useSchedulerStore((s) => s.hydrate);
  const upsertTask = useSchedulerStore((s) => s.upsert);
  const removeTask = useSchedulerStore((s) => s.remove);
  const toggleTask = useSchedulerStore((s) => s.toggle);

  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);

  useEffect(() => {
    void hydrateSnippets();
    void hydrateScheduler();
  }, [hydrateSnippets, hydrateScheduler]);

  const rescan = async () => {
    const root = (await native.workspaceCurrentDir().catch(() => "")) || null;
    const builtins = await scanSkillsDir(root);
    useSnippetsStore.getState().mergeBuiltin(builtins);
    toast.success(t("skillsMcp.rescanDone"));
  };

  const userSnippets = snippets.filter((s) => !s.builtin);
  const builtinSnippets = snippets.filter((s) => s.builtin);

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title={t("skills.title")}
        description={t("skills.description")}
      />

      {/* ---- Snippets / Skills ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label>{t("skillsMcp.snippets")}</Label>
            <span className="text-[10.5px] text-muted-foreground">
              {t("skillsMcp.snippetsDescription")}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() =>
              setEditingSnippet({
                id: newSnippetId(),
                handle: "",
                name: "",
                description: "",
                content: "",
                toolAllowlist: undefined,
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            {t("skillsMcp.newSnippet")}
          </Button>
        </div>

        {userSnippets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-6 text-center text-[11px] text-muted-foreground">
            {t("agents.noSnippets")}
            <code className="font-mono">#handle</code>
            {t("common.periodSuffix")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {userSnippets.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  #{s.handle}
                </code>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-medium">
                    {s.name}
                  </span>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {s.description ||
                      (s.toolAllowlist?.length
                        ? `${t("skillsMcp.allowlist")}: ${s.toolAllowlist.join(", ")}`
                        : "")}
                  </span>
                </div>
                {s.toolAllowlist?.length ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 px-1 py-0 text-[9px] font-normal"
                  >
                    {s.toolAllowlist.length}
                  </Badge>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => setEditingSnippet(s)}
                  title={t("common.edit")}
                >
                  <HugeiconsIcon
                    icon={Edit02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeSnippet(s.id)}
                  title={t("common.delete")}
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Built-in skills (skills/ directory) ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label>{t("skillsMcp.builtinSkills")}</Label>
            <span className="text-[10.5px] text-muted-foreground">
              {t("skillsMcp.builtinSkillsHint")}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => void rescan()}
          >
            <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={1.75} />
            {t("skillsMcp.rescan")}
          </Button>
        </div>

        {builtinSnippets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-4 text-center text-[11px] text-muted-foreground">
            {t("agents.noSnippets")}
            <code className="font-mono">skills/</code>
            {t("common.periodSuffix")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {builtinSnippets.map((s) => {
              const disabled = disabledBuiltinHandles.includes(s.handle);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2",
                    disabled && "opacity-50",
                  )}
                >
                  <Badge className="shrink-0 bg-muted px-1.5 py-0 text-[9px] font-normal text-muted-foreground">
                    {t("skillsMcp.builtin")}
                  </Badge>
                  <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    #{s.handle}
                  </code>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] font-medium">
                      {s.name}
                    </span>
                    {s.description ? (
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {s.description}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {s.toolAllowlist?.length
                      ? t("skillsMcp.toolCount", { count: s.toolAllowlist.length })
                      : ""}
                  </span>
                  <Switch
                    checked={!disabled}
                    onCheckedChange={(on) => toggleBuiltin(s.handle, !on)}
                    aria-label={s.name}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Scheduled tasks (cron, ★ H3 Hermes) ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <Label>{t("scheduler.title")}</Label>
            <span className="text-[10.5px] text-muted-foreground">
              {t("scheduler.description")}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() =>
              setEditingTask({
                id: newSchedulerTaskId(),
                name: "",
                prompt: "",
                cron: "0 9 * * *",
                target: "notification",
                enabled: true,
                last_fired_at: null,
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
            {t("scheduler.newTask")}
          </Button>
        </div>

        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-4 text-center text-[11px] text-muted-foreground">
            {t("scheduler.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2",
                  !task.enabled && "opacity-50",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-medium">
                    {task.name}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {task.cron} ·{" "}
                    {t(
                      task.target === "notification"
                        ? "scheduler.notification"
                        : "scheduler.session",
                    )}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={() => setEditingTask(task)}
                  title={t("common.edit")}
                >
                  <HugeiconsIcon icon={Edit02Icon} size={11} strokeWidth={1.75} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => void removeTask(task.id)}
                  title={t("scheduler.deleteTask")}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
                </Button>
                <Switch
                  checked={task.enabled}
                  onCheckedChange={(on) => void toggleTask(task.id, on)}
                  aria-label={task.name}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <SchedulerTaskDialog
        task={editingTask}
        existing={tasks}
        onClose={() => setEditingTask(null)}
        onSave={(task) => {
          void upsertTask(task);
          setEditingTask(null);
        }}
      />
      <SnippetEditorDialog
        snippet={editingSnippet}
        existing={userSnippets}
        onClose={() => setEditingSnippet(null)}
        onSave={(s) => {
          upsertSnippet(s);
          setEditingSnippet(null);
        }}
      />
    </div>
  );
}

function SnippetEditorDialog({
  snippet,
  existing,
  onClose,
  onSave,
}: {
  snippet: Snippet | null;
  existing: Snippet[];
  onClose: () => void;
  onSave: (s: Snippet) => void;
}) {
  const [draft, setDraft] = useState<Snippet | null>(snippet);
  useEffect(() => setDraft(snippet), [snippet]);
  const { t } = useI18n();
  if (!draft) return null;

  const handleErr = !draft.handle
    ? t("agents.required")
    : !isValidHandle(draft.handle)
      ? t("agents.handleInvalid")
      : existing.some((s) => s.id !== draft.id && s.handle === draft.handle)
        ? t("agents.handleTaken")
        : null;
  const canSave =
    !handleErr &&
    draft.name.trim().length > 0 &&
    draft.content.trim().length > 0;

  const toggleTool = (id: string) => {
    const cur = draft.toolAllowlist ?? [];
    setDraft({
      ...draft,
      toolAllowlist: cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id],
    });
  };

  return (
    <Dialog open={!!snippet} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {existing.some((s) => s.id === draft.id)
              ? t("agents.editSnippet")
              : t("agents.newSnippet")}
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-2 flex max-h-[calc(100vh-14rem)] flex-col gap-3 overflow-y-auto px-2">
          <div className="flex gap-2">
            <div className="flex w-32 flex-col gap-1">
              <Label>{t("agents.handle")}</Label>
              <div className="relative">
                <span className="absolute top-1/2 left-2 -translate-y-1/2 font-mono text-[11.5px] text-muted-foreground">
                  #
                </span>
                <Input
                  value={draft.handle}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      handle: normalizeHandle(e.target.value),
                    })
                  }
                  placeholder="review"
                  className="h-8 pl-5 font-mono text-[11.5px]"
                />
              </div>
              {handleErr ? (
                <span className="text-[10px] text-destructive">
                  {handleErr}
                </span>
              ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label>{t("common.name")}</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("agents.snippetNamePlaceholder")}
                className="h-8 text-[12px]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("agents.description")}</Label>
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
              placeholder={t("agents.snippetDescriptionPlaceholder")}
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("skillsMcp.allowlist")}</Label>
            <span className="text-[10px] text-muted-foreground">
              {t("skillsMcp.allowlistHint")}
            </span>
            <div className="grid max-h-40 grid-cols-1 gap-0.5 overflow-y-auto rounded-md border border-border/60 bg-card/40 p-1.5 sm:grid-cols-2">
              {TOOL_REGISTRY.map((toolDef) => {
                const checked = (draft.toolAllowlist ?? []).includes(toolDef.id);
                return (
                  <label
                    key={toolDef.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 text-[10.5px] hover:bg-muted/50",
                      checked && "bg-muted/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTool(toolDef.id)}
                      className="mt-0.5 size-3 accent-foreground"
                    />
                    <span className="min-w-0">
                      <code className="font-mono">{toolDef.id}</code>
                      <span className="ml-1 text-muted-foreground">
                        {toolDef.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("agents.content")}</Label>
            <Textarea
              value={draft.content}
              onChange={(e) =>
                setDraft({ ...draft, content: e.target.value })
              }
              placeholder={t("agents.snippetContentPlaceholder")}
              className="min-h-40 resize-y font-mono text-[11.5px] leading-relaxed"
            />
          </div>
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

function SchedulerTaskDialog({
  task,
  existing,
  onClose,
  onSave,
}: {
  task: ScheduledTask | null;
  existing: ScheduledTask[];
  onClose: () => void;
  onSave: (t: ScheduledTask) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ScheduledTask | null>(task);
  useEffect(() => setDraft(task), [task]);
  if (!draft) return null;

  const isNew = !existing.some((s) => s.id === draft.id);
  const canSave =
    draft.name.trim().length > 0 && draft.prompt.trim().length > 0;

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {isNew ? t("scheduler.newTask") : t("scheduler.editTask")}
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-2 flex max-h-[calc(100vh-14rem)] flex-col gap-3 overflow-y-auto px-2">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label>{t("scheduler.name")}</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("scheduler.namePlaceholder")}
                className="h-8 text-[12px]"
              />
            </div>
            <div className="flex w-40 flex-col gap-1">
              <Label>{t("scheduler.target")}</Label>
              <Select
                value={draft.target}
                onValueChange={(v) =>
                  setDraft({ ...draft, target: v as SchedulerTarget })
                }
              >
                <SelectTrigger className="h-8 text-[11.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="notification">
                    {t("scheduler.notification")}
                  </SelectItem>
                  <SelectItem value="session">{t("scheduler.session")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("scheduler.cron")}</Label>
            <Input
              value={draft.cron}
              onChange={(e) => setDraft({ ...draft, cron: e.target.value })}
              className="h-8 font-mono text-[11.5px]"
            />
            <span className="text-[10px] text-muted-foreground">
              {t("scheduler.cronHint")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("scheduler.prompt")}</Label>
            <Textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              placeholder={t("scheduler.promptPlaceholder")}
              className="min-h-28 resize-y text-[11.5px] leading-relaxed"
            />
          </div>
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
