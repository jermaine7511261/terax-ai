export type TeamWorkspace = {
  id: string;
  name: string;
  description: string;
  members: string[];
  created_at: string;
  session_ids: string[];
};

export type SharedSession = {
  id: string;
  workspace_id: string;
  title: string;
  summary: string;
  shared_by: string;
  shared_at: string;
  session_data: string;
};

const STORE_PREFIX = "terax-workspace-";

export async function listWorkspaces(): Promise<TeamWorkspace[]> {
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}list`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveWorkspace(ws: TeamWorkspace): Promise<void> {
  const list = await listWorkspaces();
  const idx = list.findIndex((w) => w.id === ws.id);
  if (idx >= 0) {
    list[idx] = ws;
  } else {
    list.push(ws);
  }
  localStorage.setItem(`${STORE_PREFIX}list`, JSON.stringify(list));
}

export async function deleteWorkspace(id: string): Promise<void> {
  const list = await listWorkspaces();
  localStorage.setItem(
    `${STORE_PREFIX}list`,
    JSON.stringify(list.filter((w) => w.id !== id)),
  );
}

export async function shareSessionToWorkspace(
  workspaceId: string,
  title: string,
  summary: string,
  sessionData: string,
  sharedBy: string,
): Promise<SharedSession> {
  const session: SharedSession = {
    id: `share-${Date.now().toString(36)}`,
    workspace_id: workspaceId,
    title,
    summary,
    shared_by: sharedBy,
    shared_at: new Date().toISOString(),
    session_data: sessionData,
  };
  const key = `${STORE_PREFIX}sessions-${workspaceId}`;
  const raw = localStorage.getItem(key);
  const sessions: SharedSession[] = raw ? JSON.parse(raw) : [];
  sessions.unshift(session);
  localStorage.setItem(key, JSON.stringify(sessions.slice(0, 100)));
  return session;
}

export async function getWorkspaceSessions(
  workspaceId: string,
): Promise<SharedSession[]> {
  const key = `${STORE_PREFIX}sessions-${workspaceId}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
