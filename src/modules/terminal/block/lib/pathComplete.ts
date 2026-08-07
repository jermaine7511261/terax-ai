import { currentWorkspaceEnv } from "@/modules/workspace";
import { type Completion, startCompletion } from "@codemirror/autocomplete";
import { invoke } from "@/platform";
import { homeDir } from "@tauri-apps/api/path";

type DirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  mtime: number;
};

export type PathResult = { fromOffset: number; options: Completion[] };

function joinRel(cwd: string, rel: string): string {
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  const clean = rel.replace(/^\/+|\/+$/g, "");
  return clean ? `${base}/${clean}` : base;
}

// Module-level cache of the user's home directory, primed eagerly so the
// first `~` completion is instant. Falls back to an empty string (treated
// as "no home known" -> completion disabled for `~`) if Tauri can't resolve.
let cachedHome: string | null = null;
let homePromise: Promise<string> | null = null;

function getHome(): Promise<string> {
  if (cachedHome !== null) return Promise.resolve(cachedHome);
  if (!homePromise) {
    homePromise = homeDir()
      .then((h) => {
        cachedHome = h.replace(/\\/g, "/").replace(/\/+$/, "");
        return cachedHome;
      })
      .catch(() => {
        cachedHome = "";
        return "";
      });
  }
  return homePromise;
}

/**
 * Expand a directory part (the `a/b/` prefix of a completion token) into an
 * absolute path. Handles `~`, `~/sub/`, `~user/...`, absolute paths and
 * relative-to-cwd paths.
 */
export function resolveDir(
  dirPart: string,
  cwd: string,
  home: string,
): string | null {
  if (dirPart.startsWith("~")) {
    if (!home) return null;
    const rest = dirPart.slice(1);
    // `~` or `~/`
    if (rest === "" || rest.startsWith("/")) return joinRel(home, rest);
    // `~user` / `~user/...` -> sibling of the current user's home.
    const slash = rest.indexOf("/");
    const user = slash >= 0 ? rest.slice(0, slash) : rest;
    const sub = slash >= 0 ? rest.slice(slash) : "";
    const parent = home.replace(/[^/]*$/, "").replace(/\/$/, "");
    const userHome = joinRel(parent, user);
    return sub ? joinRel(userHome, sub) : userHome;
  }
  if (dirPart.startsWith("/")) return dirPart || "/";
  return joinRel(cwd, dirPart);
}

// Completes the argument token against the terminal's live cwd. Directories get
// a trailing slash and re-trigger completion so the next level opens on accept.
export async function pathCompletions(
  token: string,
  cwd: string,
): Promise<PathResult | null> {
  const slash = token.lastIndexOf("/");
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : "";
  const base = slash >= 0 ? token.slice(slash + 1) : token;
  const home = await getHome();
  const dir = resolveDir(dirPart, cwd, home);
  if (!dir) return null;

  let entries: DirEntry[];
  try {
    entries = await invoke<DirEntry[]>("fs_read_dir", {
      path: dir,
      showHidden: base.startsWith("."),
      workspace: currentWorkspaceEnv(),
    });
  } catch {
    return null;
  }

  const lower = base.toLowerCase();
  const dirs: Completion[] = [];
  const files: Completion[] = [];
  for (const e of entries) {
    if (lower && !e.name.toLowerCase().startsWith(lower)) continue;
    const isDir = e.kind === "dir";
    if (isDir) {
      dirs.push({
        label: `${e.name}/`,
        type: "type",
        apply: (view, _c, from, to) => {
          const insert = `${e.name}/`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          });
          startCompletion(view);
        },
      });
    } else {
      files.push({ label: e.name, type: "variable" });
    }
    if (dirs.length + files.length >= 200) break;
  }

  return { fromOffset: dirPart.length, options: [...dirs, ...files] };
}
