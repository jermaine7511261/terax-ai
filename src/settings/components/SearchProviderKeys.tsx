import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  clearSearchKey,
  getSearchKey,
  setSearchKey,
  type SearchProvider,
} from "@/modules/ai/lib/searchKeys";
import {
  ArrowUpRight01Icon,
  Cancel01Icon,
  Edit02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@/platform";
import { useEffect, useState } from "react";

type ProviderMeta = {
  label: string;
  consoleUrl: string;
};

const SEARCH_PROVIDERS: Record<SearchProvider, ProviderMeta> = {
  exa: {
    label: "Exa",
    consoleUrl: "https://dashboard.exa.ai/api-keys",
  },
  parallel: {
    label: "Parallel",
    consoleUrl: "https://platform.parallel.ai",
  },
};

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(8)}${key.slice(-4)}`;
}

type RowProps = {
  which: SearchProvider;
  currentKey: string | null;
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
};

function SearchProviderRow({ which, currentKey, onSave, onClear }: RowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(!currentKey);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SEARCH_PROVIDERS[which];

  useEffect(() => {
    setEditing(!currentKey);
  }, [currentKey]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("settingsSearchProvider.enterKey"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setValue("");
      setReveal(false);
    } catch (e) {
      setError(t("settingsSearchProvider.failedToSave", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium">{meta.label}</span>
        <Badge
          variant="outline"
          className={cn(
            "ml-1 h-4 gap-1 border-border/60 px-1.5 text-[10px] font-normal",
            currentKey
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              currentKey ? "bg-emerald-500" : "bg-muted-foreground/50",
            )}
          />
          {currentKey
            ? t("settingsSearchProvider.configured")
            : t("settingsSearchProvider.notConfigured")}
        </Badge>
        <button
          type="button"
          onClick={() => void openUrl(meta.consoleUrl)}
          className="ml-auto inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("settingsSearchProvider.getKey")}
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={11} strokeWidth={1.75} />
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("settingsSearchProvider.pasteKey")}
                value={value}
                disabled={saving}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  } else if (e.key === "Escape" && currentKey) {
                    setValue("");
                    setReveal(false);
                    setError(null);
                    setEditing(false);
                  }
                }}
                className="h-8 pr-7 font-mono text-[11.5px]"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                tabIndex={-1}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                aria-label={
                  reveal
                    ? t("settingsSearchProvider.hideKey")
                    : t("settingsSearchProvider.showKey")
                }
              >
                <HugeiconsIcon
                  icon={reveal ? ViewOffSlashIcon : ViewIcon}
                  size={12}
                  strokeWidth={1.75}
                />
              </button>
            </div>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={saving || !value.trim()}
              className="h-8 gap-1 px-3 text-[11px]"
            >
              {saving ? <Spinner className="size-3" /> : null}
              {t("settingsSearchProvider.save")}
            </Button>
          </div>
          {error ? (
            <p className="text-[10.5px] text-destructive">{error}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {maskKey(currentKey ?? "")}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setEditing(true)}
            title={t("settingsSearchProvider.replace")}
            className="size-7"
          >
            <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={1.75} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void onClear()}
            title={t("settingsSearchProvider.clear")}
            className="size-7 text-muted-foreground hover:text-destructive"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Search provider API-key management (Exa / Parallel). Keys are stored in the OS
 * keyring via searchKeys.ts and are used by the Rust web_search backend. Rendered
 * under the provider fallback chain in the Models settings section.
 */
export function SearchProviderKeys() {
  const { t } = useI18n();
  const [keys, setKeys] = useState<Record<SearchProvider, string | null>>({
    exa: null,
    parallel: null,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [exa, parallel] = await Promise.all([
        getSearchKey("exa"),
        getSearchKey("parallel"),
      ]);
      if (!alive) return;
      setKeys({ exa, parallel });
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSave = async (which: SearchProvider, value: string) => {
    await setSearchKey(which, value);
    setKeys((prev) => ({ ...prev, [which]: value }));
  };

  const onClear = async (which: SearchProvider) => {
    await clearSearchKey(which);
    setKeys((prev) => ({ ...prev, [which]: null }));
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-foreground">
          {t("settingsSearchProvider.title")}
        </span>
        <span className="text-[10.5px] text-muted-foreground">
          {t("settingsSearchProvider.description")}
        </span>
      </div>
      {!loaded ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          {t("settingsSearchProvider.loading")}
        </div>
      ) : (
        <>
          <SearchProviderRow
            which="exa"
            currentKey={keys.exa}
            onSave={(v) => onSave("exa", v)}
            onClear={() => onClear("exa")}
          />
          <SearchProviderRow
            which="parallel"
            currentKey={keys.parallel}
            onSave={(v) => onSave("parallel", v)}
            onClear={() => onClear("parallel")}
          />
        </>
      )}
    </div>
  );
}
