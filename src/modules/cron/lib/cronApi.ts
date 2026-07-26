import { invoke } from "@tauri-apps/api/core";

export type CronJob = {
  id: string;
  name: string;
  command: string;
  schedule: string;
  backend_id: string;
  work_dir: string | null;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
  last_run_success: boolean | null;
  run_count: number;
};

export type CronRunLog = {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  success: boolean | null;
  output: string;
  error: string;
};

export async function listJobs(): Promise<CronJob[]> {
  return invoke("cron_list");
}

export async function addJob(name: string, command: string, schedule: string, backendId: string, workDir?: string): Promise<CronJob> {
  return invoke("cron_add", { name, command, schedule, backendId, workDir });
}

export async function updateJob(id: string, name?: string, command?: string, schedule?: string, enabled?: boolean): Promise<void> {
  return invoke("cron_update", { id, name, command, schedule, enabled });
}

export async function deleteJob(id: string): Promise<void> {
  return invoke("cron_delete", { id });
}

export async function getLogs(jobId?: string, limit?: number): Promise<CronRunLog[]> {
  return invoke("cron_logs", { jobId, limit });
}

export async function tickJobs(): Promise<CronJob[]> {
  return invoke("cron_tick");
}
