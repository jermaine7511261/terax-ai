/**
 * Pure display helpers for the source-control panel, extracted so the
 * label/status logic can be unit tested without mounting the panel.
 */
import type { Interpolations, TranslationKey } from "@/lib/i18n";
import type { CheckState, SourceControlFileEntry } from "../useSourceControlPanel";

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

export function entryPathLabel(entry: SourceControlFileEntry): string {
  if (entry.originalPath) return `${entry.originalPath} → ${entry.path}`;
  return dirname(entry.path);
}

export function upstreamBadgeLabel(
  upstream: string | null | undefined,
  t: (key: TranslationKey, params?: Interpolations) => string,
): string {
  if (!upstream) return t("git.noUpstream");
  return upstream;
}

export function statusAccent(code: string): string {
  switch (code) {
    case "A":
      return "bg-emerald-500/85";
    case "U":
      return "bg-teal-500/85";
    case "M":
      return "bg-amber-500/85";
    case "D":
      return "bg-rose-500/85";
    case "R":
      return "bg-sky-500/85";
    default:
      return "bg-muted-foreground/40";
  }
}

export function checkboxValue(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}
