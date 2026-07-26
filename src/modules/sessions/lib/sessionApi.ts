import { invoke } from "@tauri-apps/api/core";

export type SessionStatus =
  | "Idle" | "Running" | "Paused"
  | "AwaitingApproval" | "Error" | "Completed";

export type AgentSession = {
  id: string;
  name: string;
  agent_type: string;
  model_id: string;
  status: SessionStatus;
  progress: string;
  step_count: number;
  max_steps: number;
  created_at: string;
  updated_at: string;
  tool_counts: Record<string, number>;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
};

export async function createSession(
  name: string,
  agentType: string = "build",
  modelId: string = "",
  maxSteps: number = 50,
): Promise<AgentSession> {
  return invoke("sess_create", { name, agentType, modelId, maxSteps });
}

export async function listSessions(): Promise<AgentSession[]> {
  return invoke("sess_list");
}

export async function getSession(id: string): Promise<AgentSession | null> {
  return invoke("sess_get", { id });
}

export async function deleteSession(id: string): Promise<void> {
  return invoke("sess_delete", { id });
}

export async function setActiveSession(id: string): Promise<void> {
  return invoke("sess_set_active", { id });
}

export async function getActiveSession(): Promise<AgentSession | null> {
  return invoke("sess_get_active");
}

export async function updateSessionStatus(
  id: string,
  status: string,
  progress: string,
): Promise<AgentSession> {
  return invoke("sess_update_status", { id, status, progress });
}

export async function cleanupSessions(): Promise<number> {
  return invoke("sess_cleanup");
}
