import { native } from "@/modules/ai/lib/native";
import {
  CONTENT_SEARCH_MIN_QUERY,
  useContentSearch,
  type ContentHit,
} from "@/modules/command-palette/hooks/useContentSearch";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { highlightRanges } from "./lib/filter";

type Props = {
  root: string | null;
  onOpen: (path: string, line: number) => void;
};

/** Highlight `term` occurrences inside `text` (case-insensitive). */
function Highlight({
  text,
  term,
}: {
  text: string;
  term: string;
}): React.ReactElement {
  if (!term) return <>{text}</>;
  const ranges = highlightRanges(text, term);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let i = 0;
  ranges.forEach((r, key) => {
    if (r.start > i) parts.push(text.slice(i, r.start));
    parts.push(
      <mark key={key} className="rounded-[2px] bg-primary/25 text-foreground">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    i = r.end;
  });
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export function SearchPanel({ root, onOpen }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const { results: hits, loading } = useContentSearch(root, query, true);

  const byFile = useMemo(() => {
    const m = new Map<string, ContentHit[]>();
    for (const h of hits) {
      const arr = m.get(h.rel) ?? [];
      arr.push(h);
      m.set(h.rel, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [hits]);

  const canReplace =
    query.trim().length >= CONTENT_SEARCH_MIN_QUERY && !!replace;

  const doReplaceAll = async (): Promise<void> => {
    if (!canReplace) return;
    const files = [...new Set(hits.map((h) => h.path))];
    let count = 0;
    for (const f of files) {
      try {
        const r = await native.readFile(f);
        if (r.kind !== "text") continue;
        const next = r.content.split(query).join(replace);
        if (next === r.content) continue;
        await native.writeFile(f, next);
        count += r.content.split(query).length - 1;
      } catch {
        // Skip unreadable/unwritable files; report the rest.
      }
    }
    toast.success(t("search.replaceDone", { count }));
  };

  const showPlaceholder = query.trim().length < CONTENT_SEARCH_MIN_QUERY;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2.5">
      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: search input intentionally focuses on open
          autoFocus
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="shrink-0 px-1 text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="clear search"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("search.replace")}
        </span>
        <input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder={t("search.replacePlaceholder")}
          className="w-full min-w-0 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
        />
        <button
          type="button"
          disabled={!canReplace}
          onClick={() => void doReplaceAll()}
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
            canReplace
              ? "bg-foreground/10 text-foreground hover:bg-foreground/15"
              : "cursor-not-allowed text-muted-foreground/40",
          )}
        >
          {t("search.replaceAll")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showPlaceholder ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground/70">
            {t("search.typeToSearch")}
          </div>
        ) : byFile.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground/70">
            {loading ? t("search.searching") : t("search.noResults")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {byFile.map(([rel, fileHits]) => (
              <div
                key={rel}
                className="rounded-lg border border-border/50 bg-card/40"
              >
                <div className="border-b border-border/40 px-2 py-1 text-[10.5px] font-medium text-muted-foreground">
                  {rel}
                  <span className="ml-1 text-[9.5px] text-muted-foreground/60">
                    {fileHits.length}
                  </span>
                </div>
                {fileHits.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpen(h.path, h.line)}
                    className="block w-full cursor-pointer truncate px-2 py-[3px] text-left font-mono text-[10.5px] leading-snug text-foreground/90 transition-colors hover:bg-foreground/[0.05]"
                  >
                    <span className="mr-1.5 inline-block w-8 shrink-0 text-right tabular-nums text-muted-foreground/60">
                      {h.line}
                    </span>
                    <Highlight text={h.text.trim()} term={query} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
