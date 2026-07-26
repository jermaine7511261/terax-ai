import { invoke } from "@tauri-apps/api/core";

export type HookType = "pre_command" | "post_command" | "on_error" | "on_startup" | "on_shutdown";

export type ShellHook = {
  id: string;
  name: string;
  hook_type: HookType;
  command: string;
  pattern: string;
  enabled: boolean;
  run_count: number;
};

export async function hooksList(): Promise<ShellHook[]> {
  return invoke("hooks_list");
}

export async function hooksRegister(hook: ShellHook): Promise<void> {
  return invoke("hooks_register", { hook });
}

export async function hooksUnregister(id: string): Promise<void> {
  return invoke("hooks_unregister", { id });
}

export async function hooksRun(id: string): Promise<string> {
  return invoke("hooks_run", { id });
}

export async function hooksToggle(id: string): Promise<void> {
  return invoke("hooks_toggle", { id });
}
