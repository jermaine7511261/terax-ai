import { invoke } from "@tauri-apps/api/core";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  entry: string;
  permissions: string[];
  hooks: string[];
  tools: PluginToolDef[];
  browser_support: boolean;
};

export type PluginToolDef = {
  name: string;
  description: string;
  input_schema: unknown;
};

export type PluginInstance = {
  manifest: PluginManifest;
  enabled: boolean;
  installed_at: string;
  config: unknown;
};

export async function registerPlugin(manifest: PluginManifest): Promise<PluginInstance> {
  return invoke("plugin_register", { manifest });
}

export async function unregisterPlugin(id: string): Promise<void> {
  return invoke("plugin_unregister", { id });
}

export async function listPlugins(): Promise<PluginInstance[]> {
  return invoke("plugin_list");
}

export async function getPlugin(id: string): Promise<PluginInstance | null> {
  return invoke("plugin_get", { id });
}

export async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  return invoke("plugin_toggle", { id, enabled });
}

export async function collectPluginTools(): Promise<PluginToolDef[]> {
  return invoke("plugin_collect_tools");
}
