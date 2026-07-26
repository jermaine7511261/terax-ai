import { invoke } from "@tauri-apps/api/core";

export type GuardAction = "allow" | "deny" | "warn" | "require_approval";

export type GuardRule = {
  id: string;
  tool_pattern: string;
  resource_pattern: string;
  action: GuardAction;
  reason: string;
  severity: number;
  enabled: boolean;
};

export type GuardResult = {
  allowed: boolean;
  action: GuardAction;
  rule_id: string | null;
  reason: string;
};

export type GuardStats = {
  total_checks: number;
  denied_count: number;
  warned_count: number;
  approved_count: number;
  active_rules: number;
};

export async function guardCheck(tool: string, resource: string): Promise<GuardResult> {
  return invoke("guard_check", { tool, resource });
}

export async function guardListRules(): Promise<GuardRule[]> {
  return invoke("guard_list_rules");
}

export async function guardAddRule(rule: GuardRule): Promise<void> {
  return invoke("guard_add_rule", { rule });
}

export async function guardRemoveRule(id: string): Promise<void> {
  return invoke("guard_remove_rule", { id });
}

export async function guardToggleRule(id: string): Promise<void> {
  return invoke("guard_toggle_rule", { id });
}

export async function guardStats(): Promise<GuardStats> {
  return invoke("guard_stats");
}
