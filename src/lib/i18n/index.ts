import { useCallback } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  enMessages,
  zhMessages,
  type Lang,
  type TranslationKey,
} from "./translations";

export type { TranslationKey } from "./translations";

type MessageTable = Record<string, string>;

function flatten(dict: Record<string, unknown>, prefix = ""): MessageTable {
  const out: MessageTable = {};
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v as Record<string, unknown>, key));
  }
  return out;
}

const flatZh = flatten(zhMessages);
const flatEn = flatten(enMessages);

/** Read the current language without a React hook (module scope / lib code). */
export function getLanguage(): Lang {
  return usePreferencesStore.getState().language ?? "zh";
}

export type Interpolations = Record<string, string | number>;

export function translate(
  lang: Lang,
  key: TranslationKey,
  params?: Interpolations,
): string {
  const table = lang === "zh" ? flatZh : flatEn;
  let s = table[key] ?? flatZh[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** Non-hook translation using the current language at call time. */
export function tStatic(key: TranslationKey, params?: Interpolations): string {
  return translate(getLanguage(), key, params);
}

/** Hook: re-renders when the language preference changes. */
export function useI18n(): { lang: Lang; t: typeof tStatic } {
  const lang = usePreferencesStore((s) => s.language ?? "zh");
  const t = useCallback(
    (key: TranslationKey, params?: Interpolations) =>
      translate(lang, key, params),
    [lang],
  );
  return { lang, t };
}
