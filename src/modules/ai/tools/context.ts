import { homeDir } from "@tauri-apps/api/path";

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\\/g, "/").replace(/\/+$/, "");
  })
  .catch(() => {});

export type ToolContext = {
  /** Active terminal tab cwd, used to resolve relative paths. Null = home. */
  getCwd: () => string | null;
  /** Workspace root (explorer root). Used by tools that operate over the project. */
  getWorkspaceRoot: () => string | null;
  /** Last N lines of the active terminal buffer (or null if not a terminal tab). */
  getTerminalContext: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  /**
   * Type a string into the active terminal at the prompt — without executing.
   * Returns false if there is no active terminal tab to inject into.
   */
  injectIntoActivePty: (text: string) => boolean;
  /**
   * Type into the active terminal AND submit it (Enter) so the shell runs it.
   * Returns false if there is no active terminal tab.
   */
  executeInActivePty: (text: string) => boolean;
  /** Open a new preview tab (in-app iframe) at the given URL. */
  openPreview: (url: string) => boolean;
  /** Spawn a Claude Code agent in a new terminal tab, bound to this session. */
  spawnAgent: (prompt: string) => { tabId: number; leafId: number } | null;
  /** Read the terminal scrollback tail of a managed agent's leaf. */
  readAgentOutput: (leafId: number) => string | null;
  readCache: Map<string, { size: number; hash: number }>;
  /** Active chat session id — used by tools that persist per-session state (todos). */
  getSessionId: () => string | null;
};

export function resolvePath(rawPath: string, cwd: string | null): string {
  if (rawPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rawPath))
    return rawPath;
  // ~, ~/sub, ~user/... expand to the (current user's) home directory.
  if (rawPath.startsWith("~")) {
    if (!cachedHome)
      throw new Error(
        `cannot resolve "~" path "${rawPath}": home directory not available yet.`,
      );
    const rest = rawPath.slice(1);
    if (rest === "" || rest.startsWith("/")) {
      return rest ? `${cachedHome}${rest}` : cachedHome;
    }
    const slash = rest.indexOf("/");
    const user = slash >= 0 ? rest.slice(0, slash) : rest;
    const sub = slash >= 0 ? rest.slice(slash) : "";
    const parent = cachedHome.replace(/[^/]*$/, "").replace(/\/$/, "");
    return `${parent}/${user}${sub}`;
  }
  if (!cwd)
    throw new Error(
      `cannot resolve relative path "${rawPath}": no active terminal cwd. Pass an absolute path.`,
    );
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return cwd.endsWith(sep) ? `${cwd}${rawPath}` : `${cwd}${sep}${rawPath}`;
}
