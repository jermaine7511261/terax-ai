import { type RefObject, useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { native } from "@/modules/ai/lib/native";
import type { Tab } from "@/modules/tabs";
import {
  getWslHome,
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
} from "@/modules/workspace";

/** localStorage key for the user-chosen workspace root (persisted across restarts). */
const WS_ROOT_KEY = "yamet.workspace.root";

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

  useEffect(() => {
    // Restore a user-chosen workspace root from localStorage if one exists,
    // so a workspace configured to another drive survives restarts. Falls
    // back to the OS user home directory.
    const saved = localStorage.getItem(WS_ROOT_KEY);
    homeDir()
      .then(async (p) => {
        const osHome = p.replace(/\\/g, "/");
        const normalized = saved ?? osHome;
        setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const authorizeHome = useCallback(async (nextHome: string) => {
    setHome(nextHome);
    setLaunchCwd(nextHome);
    localStorage.setItem(WS_ROOT_KEY, nextHome);
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
  }, [tabsRef, clearWorkspaceState, setWorkspaceEnv, authorizeHome, resetWorkspace]);

  return {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
    openFolder,
  };
}
