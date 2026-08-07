import { emit, listen } from "@/platform";
import { create } from "zustand";
import {
  loadDisabledBuiltins,
  loadSnippets,
  newSnippetId,
  saveDisabledBuiltins,
  saveSnippets,
  type Snippet,
} from "../lib/snippets";

const CHANGED_EVENT = "yamet://ai-snippets-changed";

type State = {
  hydrated: boolean;
  snippets: Snippet[];
  /** Builtin skill handles the user disabled — rescan won't revive them. */
  disabledBuiltinHandles: string[];
  hydrate: () => Promise<void>;
  upsert: (snippet: Snippet) => void;
  remove: (id: string) => void;
  /**
   * Merge scanned `skills/` snippets into the store as `builtin: true`.
   * User snippets win on handle conflict; disabled builtins are skipped.
   * Builtins are never persisted to the user store file.
   */
  mergeBuiltin: (builtins: Snippet[]) => void;
  /** Toggle a builtin skill on/off (persisted, survives restart). */
  toggleBuiltin: (handle: string, disabled: boolean) => void;
};

let initialized = false;

export const useSnippetsStore = create<State>((set, get) => ({
  hydrated: false,
  snippets: [],
  disabledBuiltinHandles: [],

  hydrate: async () => {
    if (initialized) return;
    initialized = true;
    const [snippets, disabledBuiltinHandles] = await Promise.all([
      loadSnippets(),
      loadDisabledBuiltins(),
    ]);
    set({ snippets, disabledBuiltinHandles, hydrated: true });
    void listen(CHANGED_EVENT, async () => {
      set({ snippets: await loadSnippets() });
    });
  },

  upsert: (snippet) => {
    const list = get().snippets;
    const idx = list.findIndex((s) => s.id === snippet.id);
    const next =
      idx === -1 ? [...list, snippet] : list.map((s) => (s.id === snippet.id ? snippet : s));
    set({ snippets: next });
    void saveSnippets(next).then(() => emit(CHANGED_EVENT));
  },

  remove: (id) => {
    const next = get().snippets.filter((s) => s.id !== id);
    set({ snippets: next });
    void saveSnippets(next).then(() => emit(CHANGED_EVENT));
  },

  mergeBuiltin: (builtins) => {
    const { snippets, disabledBuiltinHandles } = get();
    const disabled = new Set(disabledBuiltinHandles);
    const userHandles = new Set(
      snippets.filter((s) => !s.builtin).map((s) => s.handle),
    );
    const enabled = builtins.filter(
      (b) => !disabled.has(b.handle) && !userHandles.has(b.handle),
    );
    set({ snippets: [...snippets.filter((s) => !s.builtin), ...enabled] });
  },

  toggleBuiltin: (handle, disabled) => {
    const cur = get().disabledBuiltinHandles;
    const next = disabled
      ? [...new Set([...cur, handle])]
      : cur.filter((h) => h !== handle);
    set({ disabledBuiltinHandles: next });
    void saveDisabledBuiltins(next);
    // Enabled builtins are revived by the caller re-scanning skills/ (the
    // settings page and useAiBootstrap both call scanSkillsDir + mergeBuiltin).
  },
}));

export { newSnippetId };
