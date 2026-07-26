// Web platform adapter — mock Tauri IPC calls for browser mode
// In production, this would connect to a WebSocket backend or REST API

type InvokeArgs = Record<string, unknown>;

const MOCK_RESPONSES: Record<string, unknown> = {
  profile_get: {
    name: "User",
    role: "developer",
    preferences: {},
    model_preference: "auto",
    agent_mode: "build",
    skill_auto_create: true,
    learning_enabled: true,
    memory_enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    traits: [],
    recent_goals: [],
  },
  cron_list: [],
  memory_search: [],
  skills_list: [],
  honcho_insights: [],
  ms_list: [],
  gateway_list: [],
};

export async function invoke(cmd: string, args?: InvokeArgs): Promise<unknown> {
  // In web mode, return mock data or try fetch from a local API server
  console.debug(`[Web] invoke: ${cmd}`, args);
  
  // Try connecting to a local HTTP API if available
  try {
    const resp = await fetch(`http://localhost:1984/api/${cmd}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
    if (resp.ok) return resp.json();
  } catch {
    // No local server — use mock data
  }
  
  // Return mock data for known commands
  if (cmd in MOCK_RESPONSES) {
    return MOCK_RESPONSES[cmd];
  }
  
  // For write commands, return void
  if (["profile_save", "profile_record_goal", "honcho_observe", "ms_create", "ms_delete",
       "cron_add", "cron_update", "cron_delete", "memory_add", "gateway_save", "gateway_delete"].includes(cmd)) {
    return undefined;
  }
  
  return null;
}

export type EventCallback = (event: { payload: unknown }) => void;

export async function listen(_event: string, _cb: EventCallback): Promise<() => void> {
  return () => {}; // no-op
}
