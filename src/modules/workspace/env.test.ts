import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/settings/store", () => ({
  setLastWslDistro: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { setLastWslDistro } from "@/modules/settings/store";
import {
  currentWorkspaceEnv,
  currentWorkspaceScopeKey,
  getWslHome,
  LOCAL_WORKSPACE,
  parseWorkspaceScopeKey,
  useWorkspaceEnvStore,
  workspaceScopeKey,
} from "./env";

const mockInvoke = vi.mocked(invoke);
const mockSetLastWslDistro = vi.mocked(setLastWslDistro);

const DEFAULT_STATE = {
  env: LOCAL_WORKSPACE,
  distros: [],
  loading: false,
  error: null,
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockSetLastWslDistro.mockClear();
  useWorkspaceEnvStore.setState(DEFAULT_STATE);
});

describe("workspace scope helpers", () => {
  it("workspaceScopeKey maps local and wsl envs", () => {
    expect(workspaceScopeKey({ kind: "local" })).toBe("local");
    expect(workspaceScopeKey({ kind: "wsl", distro: "Ubuntu" })).toBe(
      "wsl:Ubuntu",
    );
  });

  it("parseWorkspaceScopeKey round-trips both forms", () => {
    expect(parseWorkspaceScopeKey("wsl:Debian")).toEqual({
      kind: "wsl",
      distro: "Debian",
    });
    expect(parseWorkspaceScopeKey("local")).toEqual(LOCAL_WORKSPACE);
    expect(parseWorkspaceScopeKey("garbage")).toEqual(LOCAL_WORKSPACE);
  });

  it("currentWorkspaceEnv / currentWorkspaceScopeKey read the store", () => {
    expect(currentWorkspaceEnv()).toEqual(LOCAL_WORKSPACE);
    expect(currentWorkspaceScopeKey()).toBe("local");
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "U" } });
    expect(currentWorkspaceEnv()).toEqual({ kind: "wsl", distro: "U" });
    expect(currentWorkspaceScopeKey()).toBe("wsl:U");
  });
});

describe("setEnv", () => {
  it("switches to local", () => {
    useWorkspaceEnvStore.getState().setEnv({ kind: "local" });
    expect(useWorkspaceEnvStore.getState().env).toEqual(LOCAL_WORKSPACE);
    expect(mockSetLastWslDistro).not.toHaveBeenCalled();
  });

  it("switches to wsl and persists the distro", () => {
    useWorkspaceEnvStore.getState().setEnv({ kind: "wsl", distro: "Ubuntu" });
    expect(useWorkspaceEnvStore.getState().env).toEqual({
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(mockSetLastWslDistro).toHaveBeenCalledWith("Ubuntu");
  });
});

describe("refreshDistros", () => {
  it("loads distros and clears loading", async () => {
    const distros = [
      { name: "Ubuntu", default: true, running: true },
      { name: "Debian", default: false, running: false },
    ];
    mockInvoke.mockResolvedValue(distros);
    const result = await useWorkspaceEnvStore.getState().refreshDistros();
    expect(result).toEqual(distros);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_list_distros");
    expect(useWorkspaceEnvStore.getState()).toMatchObject({
      distros,
      loading: false,
      error: null,
    });
  });

  it("resets to [] and records the error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("no wsl"));
    const result = await useWorkspaceEnvStore.getState().refreshDistros();
    expect(result).toEqual([]);
    expect(useWorkspaceEnvStore.getState()).toMatchObject({
      distros: [],
      loading: false,
      error: "Error: no wsl",
    });
  });
});

describe("getWslHome", () => {
  it("invokes wsl_home with the distro", async () => {
    mockInvoke.mockResolvedValue("/home/u");
    await expect(getWslHome("Ubuntu")).resolves.toBe("/home/u");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_home", { distro: "Ubuntu" });
  });
});
