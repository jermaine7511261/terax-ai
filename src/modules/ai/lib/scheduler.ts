import { invoke } from "@/platform";

/**
 * Cron scheduler frontend (★ H3 Hermes). Mirrors
 * `src-tauri/src/modules/scheduler/mod.rs`: tasks carry a natural-language
 * prompt + a 5-field cron expression; the backend ticks every 30s and emits
 * `yamet:scheduler-fire` for the frontend to spawn the agent.
 */

export type SchedulerTarget = "notification" | "session";

export type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  /** 5-field cron: minute hour day-of-month month day-of-week. */
  cron: string;
  target: SchedulerTarget;
  enabled: boolean;
  last_fired_at: number | null;
};

export type FiredTask = {
  id: string;
  name: string;
  prompt: string;
  target: SchedulerTarget;
};

export function schedulerList(): Promise<ScheduledTask[]> {
  return invoke("scheduler_list");
}

export function schedulerUpsert(task: ScheduledTask): Promise<void> {
  return invoke("scheduler_upsert", { task });
}

export function schedulerDelete(id: string): Promise<void> {
  return invoke("scheduler_delete", { id });
}

export function schedulerToggle(id: string, enabled: boolean): Promise<void> {
  return invoke("scheduler_toggle", { id, enabled });
}

export function newSchedulerTaskId(): string {
  return `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
