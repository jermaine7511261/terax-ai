import { native } from "@/modules/ai/lib/native";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  loadPreferences,
  onPreferencesChange,
  setWorkspaceRoot,
} from "@/modules/settings/store";
import type { Tab } from "@/modules/tabs";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { homeDir, openDialog } from "@/platform";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

async function resolveEnvHome(env: WorkspaceEnv): Promise<string> {
  return env.kind === "wsl"
    ? getWslHome(env.distro)
    : (await homeDir()).replace(/\\/g, "/");
}

type Params = {
  tabsRef: RefObject<Tab[]>;
  workspaceEnv: WorkspaceEnv;
  setWorkspaceEnv: (env: WorkspaceEnv) => void;
  resetWorkspace: (home?: string) => void;
  /** Dispose live sessions and clear App-owned pane/handle ref maps. */
  clearWorkspaceState: () => void;
};

/**
 * Owns the resolved home / launch cwd. switchWorkspace runs an interactive
 * local⇄WSL switch (tears down sessions, re-authorizes home, resets tabs);
 * adoptWorkspaceEnv applies a space's env + home on restore, without teardown.
 */
export function useWorkspaceSwitcher({
  tabsRef,
  workspaceEnv,
  setWorkspaceEnv,
  resetWorkspace,
  clearWorkspaceState,
}: Params) {
  const [home, setHome] = useState<string | null>(null);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);
  const resetWorkspaceRef = useRef(resetWorkspace);
  resetWorkspaceRef.current = resetWorkspace;

  useEffect(() => {
    // Restore a user-chosen workspace root (persisted in settings) so a
    // workspace configured to another drive survives restarts. Falls back to
    // the OS user home directory.
    void (async () => {
      const prefs = await loadPreferences();
      // Restore the last-selected model so the model switcher doesn't reset
      // to the default on every launch (setSelectedModelId persists it).
      if (prefs.selectedModelId) {
        useChatStore.setState({ selectedModelId: prefs.selectedModelId });
      }
      const saved = prefs.workspaceRoot;
      homeDir()
        .then(async (p) => {
          const osHome = p.replace(/\\/g, "/");
          const normalized = saved ?? osHome;
          setHome(normalized);
          // Keep Rust's workspace_current_dir in sync with the live workspace
          // root so settings-side consumers (project memory, skills scan) see
          // the same YaMet.md the AI memory tool writes to.
          void native.workspaceSetCurrent(normalized).catch(() => {});
          try {
            await native.workspaceAuthorize(normalized);
          } catch {
            // Bootstrap already authorizes home from Rust; ignore.
          }
        })
        .catch(() => setHome(null));
    })();
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  // React to a workspace-root change made in the settings window so it takes
  // effect within the current session (no restart required). Reset the active
  // terminal to the new root and persist the selection.
  useEffect(() => {
    const apply = async (root: string) => {
      const normalized = root.replace(/\\/g, "/");
      setHome(normalized);
      setLaunchCwd(normalized);
      try {
        await native.workspaceAuthorize(normalized);
      } catch {
        // Non-fatal.
      }
      resetWorkspaceRef.current?.(normalized);
    };
    let unlisten: (() => void) | null = null;
    void onPreferencesChange((key, value) => {
      if (key === "workspaceRoot") {
        if (typeof value === "string" && value) void apply(value);
        // null resets to OS home — handled at next restart (home is derived
        // from homeDir() fallback on mount).
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const authorizeHome = useCallback(async (nextHome: string) => {
    setHome(nextHome);
    void native.workspaceSetCurrent(nextHome).catch(() => {});
    setLaunchCwd(nextHome);
    await setWorkspaceRoot(nextHome).catch(() => {});
    try {
      await native.workspaceAuthorize(nextHome);
    } catch {
      // Non-fatal — git panel will surface "not authorized" if needed.
    }
  }, []);

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv): Promise<boolean> => {
      if (
        env.kind === workspaceEnv.kind &&
        (env.kind === "local" ||
          (workspaceEnv.kind === "wsl" && env.distro === workspaceEnv.distro))
      ) {
        return false;
      }
      const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
      if (dirty) {
        window.alert(
          "Save or close unsaved editor tabs before switching workspace.",
        );
        return false;
      }

      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch (e) {
        window.alert(String(e));
        return false;
      }

      clearWorkspaceState();
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      await authorizeHome(nextHome);
      resetWorkspace(nextHome);
      return true;
    },
    [
      workspaceEnv,
      setWorkspaceEnv,
      resetWorkspace,
      tabsRef,
      clearWorkspaceState,
      authorizeHome,
    ],
  );

  const adoptWorkspaceEnv = useCallback(
    async (env: WorkspaceEnv): Promise<string | null> => {
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      let nextHome: string;
      try {
        nextHome = await resolveEnvHome(env);
      } catch {
        return null;
      }
      await authorizeHome(nextHome);
      return nextHome;
    },
    [setWorkspaceEnv, authorizeHome],
  );

  /** Pick an arbitrary local folder and adopt it as the current workspace. */
  const openFolder = useCallback(async (): Promise<boolean> => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string" || !dir) return false;
    const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
    if (dirty) {
      window.alert(
        "Save or close unsaved editor tabs before switching workspace.",
      );
      return false;
    }
    const normalized = dir.replace(/\\/g, "/");
    clearWorkspaceState();
    setWorkspaceEnv(LOCAL_WORKSPACE);
    await authorizeHome(normalized);
    resetWorkspace(normalized);
    return true;
  }, [
    tabsRef,
    clearWorkspaceState,
    setWorkspaceEnv,
    authorizeHome,
    resetWorkspace,
  ]);

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
    openFolder,
  };
}
