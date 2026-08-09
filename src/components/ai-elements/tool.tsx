"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { tStatic, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ArrowRight01Icon,
  CheckListIcon,
  Edit02Icon,
  EyeIcon,
  File01Icon,
  FileEditIcon,
  FilePlusIcon,
  Folder01Icon,
  FolderAddIcon,
  FolderGitTwoIcon,
  FolderOpenIcon,
  GlobalSearchIcon,
  RobotIcon,
  SparklesIcon,
  TerminalIcon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useMcpStore } from "@/modules/mcp";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, memo, useState } from "react";


export type ToolPart = ToolUIPart | DynamicToolUIPart;

const TOOL_META: Record<
  string,
  { label: string; labelKey?: TranslationKey; icon: typeof File01Icon }
> = {
  read_file: { label: "Read file", labelKey: "tool.readFile", icon: File01Icon },
  list_directory: { label: "List dir", labelKey: "tool.listDir", icon: FolderOpenIcon },
  write_file: { label: "Write file", labelKey: "tool.writeFile", icon: FilePlusIcon },
  create_directory: { label: "Create dir", labelKey: "tool.createDir", icon: FolderAddIcon },
  delete_file: { label: "Delete file", labelKey: "tool.deleteFile", icon: File01Icon },
  rename_file: { label: "Rename file", labelKey: "tool.renameFile", icon: File01Icon },
  edit: { label: "Edit", labelKey: "tool.edit", icon: FileEditIcon },
  multi_edit: { label: "Batch edit", labelKey: "tool.multiEdit", icon: Edit02Icon },
  apply_patch: { label: "Apply patch", labelKey: "tool.applyPatch", icon: Edit02Icon },
  bash_run: { label: "Run", labelKey: "tool.run", icon: TerminalIcon },
  bash_background: { label: "Spawn", labelKey: "tool.spawn", icon: TerminalIcon },
  bash_logs: { label: "Logs", labelKey: "tool.logs", icon: TerminalIcon },
  bash_list: { label: "Jobs", labelKey: "tool.jobs", icon: TerminalIcon },
  bash_kill: { label: "Kill", labelKey: "tool.kill", icon: TerminalIcon },
  grep: { label: "Search", labelKey: "tool.grep", icon: GlobalSearchIcon },
  glob: { label: "Glob", labelKey: "tool.glob", icon: Folder01Icon },
  web_search: { label: "Web search", labelKey: "tool.webSearch", icon: GlobalSearchIcon },
  fetch_url: { label: "Fetch URL", labelKey: "tool.fetchUrl", icon: GlobalSearchIcon },
  deep_search: { label: "Deep research", labelKey: "tool.deepSearch", icon: SparklesIcon },
  search_memories: { label: "Search memories", labelKey: "tool.searchMemories", icon: SparklesIcon },
  suggest_command: { label: "Suggest command", labelKey: "tool.suggestCommand", icon: SparklesIcon },
  get_terminal_output: { label: "Terminal output", labelKey: "tool.terminalOutput", icon: TerminalIcon },
  terminal_execute: { label: "Run in terminal", labelKey: "tool.terminalExecute", icon: TerminalIcon },
  terminal_type: { label: "Type in terminal", labelKey: "tool.terminalType", icon: TerminalIcon },
  open_preview: { label: "Preview", labelKey: "tool.preview", icon: EyeIcon },
  run_subagent: { label: "Subagent", labelKey: "tool.subagent", icon: RobotIcon },
  handoff: { label: "Handoff", labelKey: "tool.handoff", icon: RobotIcon },
  run_external_agent: { label: "External agent", labelKey: "tool.externalAgent", icon: RobotIcon },
  git_status: { label: "Git status", labelKey: "tool.gitStatus", icon: FolderGitTwoIcon },
  git_diff: { label: "Git diff", labelKey: "tool.gitDiff", icon: FolderGitTwoIcon },
  git_blame: { label: "Git blame", labelKey: "tool.gitBlame", icon: FolderGitTwoIcon },
  git_stage: { label: "Git stage", labelKey: "tool.gitStage", icon: FolderGitTwoIcon },
  git_commit: { label: "Git commit", labelKey: "tool.gitCommit", icon: FolderGitTwoIcon },
  git_checkpoint: { label: "Checkpoint", labelKey: "tool.checkpoint", icon: FolderGitTwoIcon },
  git_checkpoint_restore: { label: "Restore", labelKey: "tool.restore", icon: FolderGitTwoIcon },
  todo_write: { label: "Todos", labelKey: "tool.todos", icon: CheckListIcon },
  generate_image: { label: "Generate image", labelKey: "tool.generateImage", icon: SparklesIcon },
  lsp_hover: { label: "Hover", labelKey: "tool.hover", icon: SparklesIcon },
  lsp_goto: { label: "Go to def", labelKey: "tool.gotoDef", icon: SparklesIcon },
  update_project_memory: { label: "Project memory", labelKey: "tool.projectMemory", icon: SparklesIcon },
  create_docx: { label: "Create Word", labelKey: "tool.createDocx", icon: FilePlusIcon },
  create_xlsx: { label: "Create Excel", labelKey: "tool.createXlsx", icon: FilePlusIcon },
  create_pptx: { label: "Create PPT", labelKey: "tool.createPptx", icon: FilePlusIcon },
  create_pdf: { label: "Create PDF", labelKey: "tool.createPdf", icon: FilePlusIcon },
  edit_docx: { label: "Edit Word", labelKey: "tool.editDocx", icon: FileEditIcon },
  edit_xlsx: { label: "Edit Excel", labelKey: "tool.editXlsx", icon: FileEditIcon },
  edit_pptx: { label: "Edit PPT", labelKey: "tool.editPptx", icon: FileEditIcon },
  merge_pdf: { label: "Merge PDF", labelKey: "tool.mergePdf", icon: File01Icon },
  encrypt_pdf: { label: "Encrypt PDF", labelKey: "tool.encryptPdf", icon: File01Icon },
};

const STATUS_DOT: Record<ToolPart["state"], string> = {
  "approval-requested": "bg-amber-500",
  "approval-responded": "bg-sky-500",
  "input-streaming": "bg-muted-foreground/40",
  "input-available": "bg-amber-500",
  "output-available": "bg-transparent border border-muted-foreground/40",
  "output-denied": "bg-orange-500",
  "output-error": "bg-destructive",
};

const STATUS_LABEL: Record<ToolPart["state"], TranslationKey> = {
  "approval-requested": "tool.awaitingApproval",
  "approval-responded": "tool.responded",
  "input-streaming": "tool.preparing",
  "input-available": "tool.running",
  "output-available": "tool.done",
  "output-denied": "tool.denied",
  "output-error": "tool.error",
};

function deriveSummary(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const str = (k: string) =>
    typeof i[k] === "string" ? (i[k] as string) : null;

  // MCP tools: summarize the argument JSON as key=value pairs (capped).
  if (toolName.startsWith("mcp_")) {
    const parts = Object.entries(i).map(([k, v]) =>
      typeof v === "string"
        ? `${k}=${v.length > 40 ? `${v.slice(0, 39)}…` : v}`
        : `${k}=${JSON.stringify(v)}`,
    );
    const joined = parts.join(", ");
    return joined.length > 120 ? `${joined.slice(0, 119)}…` : joined;
  }

  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit":
    case "multi_edit":
    case "create_directory":
    case "list_directory":
      return str("path");
    case "bash_run":
    case "bash_background":
      return str("command");
    case "terminal_execute":
      return str("command");
    case "terminal_type":
      return str("text");
    case "get_terminal_output":
      return null;
    case "bash_logs":
    case "bash_kill":
      return str("id");
    case "grep":
      return str("pattern") ?? str("query");
    case "search_memories":
      return str("query");
    case "glob":
      return str("pattern");
    case "suggest_command":
      return str("intent") ?? str("description");
    case "open_preview":
      return str("path") ?? str("url");
    case "run_subagent":
      return str("agent") ?? str("task");
    case "run_external_agent":
      return str("agent") ?? str("prompt");
    case "git_status":
      return null;
    case "git_diff":
      return str("path") ?? (i.staged ? "staged changes" : "working tree changes");
    case "git_stage":
      return str("paths") ?? "all changes";
    case "git_commit":
      return str("message");
    case "todo_write": {
      const items = Array.isArray(i.todos) ? i.todos : null;
      return items
        ? `${items.length} item${items.length === 1 ? "" : "s"}`
        : null;
    }
    case "update_project_memory":
      return str("entry");
    default:
      return null;
  }
}

export type ToolProps = ComponentProps<typeof Collapsible> & {
  toolName: string;
  state: ToolPart["state"];
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

// Tools whose `input` carries large/streaming content (file bodies, sub-
// agent prompts, todo lists). The AI diff tab is the canonical place to
// view file changes; for the rest, the header summary + final output is
// enough. Re-rendering streamed input on every token both stalls the UI
// and duplicates information.
const HEAVY_CONTENT_TOOLS = new Set([
  "write_file",
  "edit",
  "multi_edit",
  "run_subagent",
  "todo_write",
]);

/** Cap for inline before/after pairs rendered for `multi_edit` input. */
const MAX_INLINE_EDITS = 8;

/**
 * Look up the MCP server name that a namespaced `mcp_<server>_<tool>` call
 * belongs to, for the tool-card source label. Mirrors the sanitization used
 * by `buildMcpTools` in `@/modules/mcp`.
 */
function mcpServerNameForTool(toolName: string): string | null {
  const key = (serverId: string, tool: string) =>
    `mcp_${serverId}_${tool}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60);
  for (const s of useMcpStore.getState().servers) {
    for (const t of s.tools) {
      if (key(s.id, t.name) === toolName) return s.name;
    }
  }
  return null;
}

const ToolImpl = ({
  className,
  toolName,
  state,
  input,
  output,
  errorText,
  defaultOpen,
  ...props
}: ToolProps) => {
  const isMcp = toolName.startsWith("mcp_");
  const meta = TOOL_META[toolName];
  const Icon = meta?.icon ?? ToolsIcon;
  const label = isMcp
    ? `mcp · ${mcpServerNameForTool(toolName) ?? "server"}`
    : meta?.labelKey
      ? tStatic(meta.labelKey)
      : (meta?.label ?? toolName);
  const summary = deriveSummary(toolName, input);
  const isError = state === "output-error";
  const open = defaultOpen ?? isError;
  const isHeavy = HEAVY_CONTENT_TOOLS.has(toolName);
  // During streaming, heavy tools skip rendering their input/output body
  // to avoid per-token re-renders (the memo comparison uses deriveSummary
  // for cheap diff checks). Once the tool reaches a terminal state, show
  // the body so the user can expand the card and see what was written or
  // edited (old/new content for edit, content for write_file).
  const isTerminal =
    state === "output-available" || state === "output-error";
  const showInputBody = (!isHeavy || isTerminal) && Boolean(input);
  const showOutputBody = (!isHeavy || isTerminal) && output !== undefined;
  const hasDetails =
    showInputBody || showOutputBody || Boolean(errorText);

  return (
    <Collapsible
      defaultOpen={open}
      className={cn("group/tool not-prose w-full", className)}
      {...props}
    >
      <CollapsibleTrigger
        disabled={!hasDetails}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "text-[12px] transition-colors",
          "hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[state])}
          aria-label={tStatic(STATUS_LABEL[state])}
        />
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 font-medium text-foreground">{label}</span>
        {summary ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {isError && (
          <span className="shrink-0 text-[10px] font-medium text-destructive">
            failed
          </span>
        )}
      </CollapsibleTrigger>

      {hasDetails && (
        <CollapsibleContent
          className={cn("YaMet-collapsible-content")}
        >
          <div className="ml-3 mt-1 space-y-2 border-l border-border/60 pl-3 pb-1">
            {showInputBody ? (
              <ToolInput toolName={toolName} input={input} />
            ) : null}
            {showOutputBody || errorText ? (
              <ToolOutput
                toolName={toolName}
                output={showOutputBody ? output : undefined}
                errorText={errorText}
              />
            ) : null}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

// For heavy tools, the only thing that should trigger a re-render is a
// state transition or the path summary changing — NOT every input-content
// token. We compare the cheap derived summary instead of the input ref.
export const Tool = memo(ToolImpl, (a, b) => {
  if (a.toolName !== b.toolName || a.state !== b.state) return false;
  if (a.errorText !== b.errorText) return false;
  if (a.output !== b.output) return false;
  if (a.className !== b.className) return false;
  if (HEAVY_CONTENT_TOOLS.has(a.toolName)) {
    return deriveSummary(a.toolName, a.input) ===
      deriveSummary(b.toolName, b.input);
  }
  return a.input === b.input;
});

function ToolInput({ toolName, input }: { toolName: string; input: unknown }) {
  if (input == null) return null;
  const preview = renderInputPreview(toolName, input);
  if (preview) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-muted-foreground">
          Input
        </div>
        {preview}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-muted-foreground">{tStatic("ai.input")}</div>
      <CodeBlockMini
        code={
          typeof input === "string" ? input : JSON.stringify(input, null, 2)
        }
        language="json"
      />
    </div>
  );
}

function renderInputPreview(
  toolName: string,
  input: unknown,
): ReactNode | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const str = (k: string) =>
    typeof i[k] === "string" ? (i[k] as string) : null;

  if (toolName === "bash_run" || toolName === "bash_background") {
    const cmd = str("command");
    const cwd = str("cwd");
    if (!cmd) return null;
    return (
      <div className="space-y-1">
        {cwd ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            {cwd}
          </div>
        ) : null}
        <pre className="overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
          {cmd}
        </pre>
      </div>
    );
  }
  if (
    toolName === "read_file" ||
    toolName === "list_directory" ||
    toolName === "create_directory" ||
    toolName === "open_preview"
  ) {
    const path = str("path") ?? str("url");
    if (!path) return null;
    return (
      <div className="font-mono text-[11px] text-muted-foreground">{path}</div>
    );
  }
  if (toolName === "grep") {
    const pat = str("pattern") ?? str("query");
    const path = str("path") ?? str("root");
    if (!pat) return null;
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="text-foreground">{pat}</div>
        {path ? <div className="text-muted-foreground">{path}</div> : null}
      </div>
    );
  }
  if (toolName === "write_file") {
    const content = str("content");
    if (content == null) return null;
    return <ToolCodeBlock code={content} />;
  }
  if (toolName === "edit") {
    const oldStr = str("old_string");
    const newStr = str("new_string");
    if (oldStr == null || newStr == null) return null;
    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">
            {tStatic("ai.before")}
          </div>
          <ToolCodeBlock code={oldStr} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            {tStatic("ai.after")}
          </div>
          <ToolCodeBlock code={newStr} />
        </div>
      </div>
    );
  }
  if (toolName === "multi_edit") {
    const edits = Array.isArray(i.edits)
      ? (i.edits as Array<{ old_string?: unknown; new_string?: unknown }>)
      : [];
    if (edits.length === 0) return null;
    return (
      <div className="space-y-2.5">
        {edits.slice(0, MAX_INLINE_EDITS).map((e, idx) => {
          const oldStr = typeof e.old_string === "string" ? e.old_string : "";
          const newStr = typeof e.new_string === "string" ? e.new_string : "";
          return (
            <div key={idx} className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground">
                {tStatic("ai.before")} {idx + 1}
              </div>
              <ToolCodeBlock code={oldStr} />
              <div className="pt-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {tStatic("ai.after")} {idx + 1}
              </div>
              <ToolCodeBlock code={newStr} />
            </div>
          );
        })}
        {edits.length > MAX_INLINE_EDITS ? (
          <div className="text-[10px] italic text-muted-foreground">
            +{edits.length - MAX_INLINE_EDITS} more
          </div>
        ) : null}
      </div>
    );
  }
  return null;
}

function ToolOutput({
  toolName,
  output,
  errorText,
}: {
  toolName: string;
  output: unknown;
  errorText?: string;
}) {
  if (errorText) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-destructive">{tStatic("common.error")}</div>
        <div className="rounded bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-destructive whitespace-pre-wrap">
          {errorText}
        </div>
      </div>
    );
  }
  if (output === undefined || output === null) return null;

  const custom = renderToolOutput(toolName, output);
  if (custom) return custom;

  let body: ReactNode;
  if (typeof output === "string") {
    body = <CodeBlockMini code={output} language="text" />;
  } else if (typeof output === "object" && !isValidElement(output)) {
    body = (
      <CodeBlockMini code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else {
    body = <div className="text-[12px]">{output as ReactNode}</div>;
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-muted-foreground">
        Output
      </div>
      {body}
    </div>
  );
}

function renderToolOutput(toolName: string, output: unknown): ReactNode | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;

  if (toolName === "read_file") {
    const path = typeof o.path === "string" ? o.path : "";
    const size = typeof o.size === "number" ? o.size : null;
    const content = typeof o.content === "string" ? o.content : "";
    const lines = content ? content.split("\n").length : null;
    return (
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="text-foreground">{tStatic("ai.read")}</span>
        {path ? <span className="text-muted-foreground">· {path}</span> : null}
        {lines != null ? (
          <span className="text-muted-foreground">
            ({lines} line{lines === 1 ? "" : "s"}
            {size != null ? `, ${formatBytes(size)}` : ""})
          </span>
        ) : null}
      </div>
    );
  }

  if (toolName === "list_directory") {
    const entries = Array.isArray(o.entries)
      ? (o.entries as Array<{ name: string; kind: string }>)
      : [];
    if (entries.length === 0) {
      return (
        <div className="text-[11px] italic text-muted-foreground">{tStatic("ai.emptyOutput")}</div>
      );
    }
    const dirs = entries.filter(
      (e) => e.kind === "directory" || e.kind === "dir",
    );
    const files = entries.filter(
      (e) => !(e.kind === "directory" || e.kind === "dir"),
    );
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {dirs.map((e) => (
          <div
            key={`d-${e.name}`}
            className="flex items-center gap-1.5 truncate"
          >
            <HugeiconsIcon
              icon={FolderOpenIcon}
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate text-foreground">{e.name}/</span>
          </div>
        ))}
        {files.map((e) => (
          <div
            key={`f-${e.name}`}
            className="flex items-center gap-1.5 truncate"
          >
            <HugeiconsIcon
              icon={File01Icon}
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate text-muted-foreground">{e.name}</span>
          </div>
        ))}
      </div>
    );
  }

  if (toolName === "bash_run") {
    return <BashRunOutput data={o} />;
  }

  if (toolName === "suggest_command") {
    const cmd = typeof o.command === "string" ? o.command : null;
    const explanation =
      typeof o.explanation === "string" ? o.explanation : null;
    if (!cmd) return null;
    return <SuggestCommandCard command={cmd} explanation={explanation} />;
  }

  if (toolName === "grep") {
    const hits = Array.isArray(o.hits)
      ? (o.hits as Array<{
          rel?: string;
          path?: string;
          line: number;
          text: string;
        }>)
      : [];
    const pattern = typeof o.pattern === "string" ? o.pattern : null;
    const truncated = Boolean(o.truncated);
    const filesScanned =
      typeof o.files_scanned === "number" ? o.files_scanned : null;

    if (hits.length === 0) {
      return (
        <div className="text-[11px] italic text-muted-foreground">
          no matches
          {filesScanned != null ? ` · ${filesScanned} files scanned` : ""}
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <div className="max-h-72 overflow-auto rounded bg-muted/30 font-mono text-[11px]">
          {hits.slice(0, 200).map((h, idx) => (
            <div
              key={`${h.rel ?? h.path}-${h.line}-${idx}`}
              className="flex gap-2 border-b border-border/30 px-2 py-1 last:border-b-0 hover:bg-muted/60"
            >
              <span className="shrink-0 text-muted-foreground">
                {h.rel ?? h.path}:{h.line}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {pattern ? highlightMatch(h.text, pattern) : h.text}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {hits.length} hit{hits.length === 1 ? "" : "s"}
            {filesScanned != null ? ` · ${filesScanned} files` : ""}
          </span>
          {truncated ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
              truncated
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (toolName === "glob") {
    const matches = Array.isArray(o.matches)
      ? (o.matches as string[])
      : Array.isArray(o.paths)
        ? (o.paths as string[])
        : [];
    if (matches.length === 0) {
      return (
        <div className="text-[11px] italic text-muted-foreground">
          no matches
        </div>
      );
    }
    return (
      <div className="max-h-60 overflow-auto rounded bg-muted/30 px-2 py-1 font-mono text-[11px]">
        {matches.slice(0, 300).map((p) => (
          <div key={p} className="truncate text-muted-foreground">
            {p}
          </div>
        ))}
      </div>
    );
  }

  if (toolName === "edit" || toolName === "multi_edit") {
    const ok = o.ok === true || typeof o.replacements === "number";
    if (ok) {
      const reps = typeof o.replacements === "number" ? o.replacements : null;
      const path = typeof o.path === "string" ? o.path : "";
      return (
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
          {reps != null ? (
            <span className="text-foreground">
              {reps} replacement{reps === 1 ? "" : "s"}
            </span>
          ) : null}
          {path ? (
            <span className="text-muted-foreground">· {path}</span>
          ) : null}
        </div>
      );
    }
  }

  if (toolName === "write_file" || toolName === "create_directory") {
    const path = typeof o.path === "string" ? o.path : "";
    const bytes = typeof o.bytesWritten === "number" ? o.bytesWritten : null;
    return (
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="text-foreground">
          {toolName === "create_directory" ? "created" : "wrote"}
        </span>
        {path ? <span className="text-muted-foreground">· {path}</span> : null}
        {bytes != null ? (
          <span className="text-muted-foreground">({formatBytes(bytes)})</span>
        ) : null}
      </div>
    );
  }

  if (toolName === "bash_background") {
    const handle = typeof o.handle === "string" ? o.handle : null;
    const cmd = typeof o.command === "string" ? o.command : "";
    return (
      <div className="space-y-0.5 font-mono text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {handle ? <span className="text-foreground">{handle}</span> : null}
          <span className="text-muted-foreground">{tStatic("agents.running")}</span>
        </div>
        {cmd ? (
          <div className="truncate text-muted-foreground">{cmd}</div>
        ) : null}
      </div>
    );
  }

  return null;
}

function BashRunOutput({ data }: { data: Record<string, unknown> }) {
  const stdout = typeof data.stdout === "string" ? data.stdout : "";
  const stderr = typeof data.stderr === "string" ? data.stderr : "";
  const exit = typeof data.exit_code === "number" ? data.exit_code : null;
  const cwdAfter = typeof data.cwd_after === "string" ? data.cwd_after : null;
  const truncated = Boolean(data.truncated);
  const timedOut = Boolean(data.timed_out);

  const hasStdout = stdout.length > 0;
  const hasStderr = stderr.length > 0;
  const initial = hasStdout ? "stdout" : hasStderr ? "stderr" : "stdout";
  const [tab, setTab] = useState<"stdout" | "stderr">(initial);

  const tabs: Array<{
    key: "stdout" | "stderr";
    label: string;
    count: number;
  }> = [
    { key: "stdout", label: "stdout", count: stdout.length },
    { key: "stderr", label: "stderr", count: stderr.length },
  ];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors",
              tab === t.key
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
              t.count === 0 && "opacity-40",
            )}
            disabled={t.count === 0}
          >
            {t.label}
            {t.count > 0 ? (
              <span className="ml-1 text-muted-foreground">{t.count}</span>
            ) : null}
          </button>
        ))}
        <span className="flex-1" />
        {exit != null ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px]",
              exit === 0
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/15 text-destructive",
            )}
          >
            exit {exit}
          </span>
        ) : null}
        {timedOut ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400">
            timed out
          </span>
        ) : null}
        {truncated ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400">
            truncated
          </span>
        ) : null}
      </div>
      <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {tab === "stdout" ? stdout || " " : stderr || " "}
      </pre>
      {cwdAfter ? (
        <div className="font-mono text-[10px] text-muted-foreground">
          cwd → {cwdAfter}
        </div>
      ) : null}
    </div>
  );
}

function highlightMatch(text: string, pattern: string): ReactNode {
  if (!pattern) return text;
  let re: RegExp;
  try {
    re = new RegExp(
      `(${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
  } catch {
    return text;
  }
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-amber-500/30 px-0.5 text-foreground">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function CodeBlockMini({ code }: { code: string; language: string }) {
  // Tool input/output is debug-grade detail — JSON arrives pre-formatted and
  // file content is shown in the editor diff tab. Highlighting here is not
  // worth the parser hop, but every block gets line numbers + proper wrapping
  // so expanded write/edit payloads stay scannable.
  return <ToolCodeBlock code={code} />;
}

/**
 * Line-numbered code block used for tool input/output bodies. The width of the
 * gutter is derived from the line count so every line aligns, matching the
 * chat markdown code blocks (chat-code.tsx).
 */
function ToolCodeBlock({ code }: { code: string }) {
  const body = code.replace(/\n+$/, "");
  const lines = body.length > 0 ? body.split("\n") : [""];
  const width = `${String(lines.length).length}ch`;
  return (
    <pre className="max-h-60 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            aria-hidden
            className="shrink-0 select-none pr-3 text-right text-muted-foreground/50"
            style={{ width }}
          >
            {i + 1}
          </span>
          <span className="whitespace-pre">
            {line === "" ? "\u00A0" : line}
          </span>
        </div>
      ))}
    </pre>
  );
}

function SuggestCommandCard({
  command,
  explanation,
}: {
  command: string;
  explanation: string | null;
}) {
  const [inserted, setInserted] = useState(false);
  const onInsert = () => {
    const ok = useChatStore
      .getState()
      .live.injectIntoActivePty(command);
    if (ok) setInserted(true);
  };
  return (
    <div className="space-y-1.5">
      {explanation ? (
        <div className="text-[11px] text-muted-foreground">{explanation}</div>
      ) : null}
      <div className="flex items-stretch gap-1.5 rounded bg-muted/40 overflow-hidden">
        <pre className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
          {command}
        </pre>
        <button
          type="button"
          onClick={onInsert}
          disabled={inserted}
          className={cn(
            "shrink-0 flex items-center gap-1 px-2.5 text-[11px] font-medium",
            "border-l border-border/60",
            "hover:bg-muted/80 active:bg-muted",
            "disabled:opacity-60 disabled:cursor-default disabled:hover:bg-transparent",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
          aria-label={tStatic("ai.insertIntoActiveTerminal")}
        >
          <HugeiconsIcon
            icon={inserted ? TerminalIcon : ArrowRight01Icon}
            size={12}
            strokeWidth={1.75}
          />
          <span>{inserted ? "Inserted" : "Insert"}</span>
        </button>
      </div>
    </div>
  );
}

// Compatibility re-exports — the previous API exposed these subcomponents,
// but the new compact <Tool /> takes everything via props. Kept as no-ops
// to avoid breaking accidental imports.
export const ToolHeader = () => null;
export const ToolContent = ({ children }: { children?: ReactNode }) => (
  <>{children}</>
);
export { ToolInput, ToolOutput };
