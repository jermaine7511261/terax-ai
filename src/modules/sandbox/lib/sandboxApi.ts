import { invoke } from "@tauri-apps/api/core";

export type SandboxLevel = "Off" | "Workspace" | "Strict" | "ReadOnly";

export type SandboxConfig = {
  level: SandboxLevel;
  workspace_dir: string | null;
  allow_network: boolean;
  allow_write: boolean;
};

export async function getSandboxConfig(): Promise<SandboxConfig> {
  return invoke("sandbox_get_config");
}

export async function setSandboxConfig(config: SandboxConfig): Promise<void> {
  return invoke("sandbox_set_config", { config });
}

export async function canRead(path: string): Promise<boolean> {
  return invoke("sandbox_can_read", { path });
}

export async function canWrite(path: string): Promise<boolean> {
  return invoke("sandbox_can_write", { path });
}

export async function canNetwork(): Promise<boolean> {
  return invoke("sandbox_can_network");
}
