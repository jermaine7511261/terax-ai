import { type Channel, invoke } from "@tauri-apps/api/core";

export type DapTransportType = "stdio" | "websocket" | "tcp";

export type DapSessionInfo = {
  id: string;
  adapterType: string;
  transport: DapTransportType;
  status:
    | "inactive"
    | "initializing"
    | "initialized"
    | "running"
    | "stopped"
    | "exited"
    | "error";
  error: string | null;
};

export type DapSessionConfig = {
  id: string;
  adapterType: string;
  transport: DapTransportType;
  // stdio
  adapterCommand?: string;
  adapterArgs?: string[];
  env?: { name: string; value: string }[];
  // tcp
  host?: string;
  port?: number;
  // websocket
  url?: string;
};

export type DapEvent = {
  seq: number;
  type: "event";
  event: string;
  body?: Record<string, unknown>;
};

export type DapResponse = {
  seq: number;
  type: "response";
  requestSeq: number;
  success: boolean;
  command?: string;
  message?: string;
  body?: Record<string, unknown>;
};

export function dapSessionList(): Promise<DapSessionInfo[]> {
  return invoke("dap_session_list");
}

export function dapSessionCreate(config: DapSessionConfig): Promise<void> {
  return invoke("dap_session_create", { config });
}

export function dapSessionConnect(
  id: string,
  root: string | null,
  workspace: unknown,
  onEvent: Channel<DapEvent>,
): Promise<void> {
  return invoke("dap_session_connect", { id, root, workspace, onEvent });
}

export function dapSessionDisconnect(id: string): Promise<void> {
  return invoke("dap_session_disconnect", { id });
}

export function dapRequestSend(
  sessionId: string,
  command: string,
  args?: Record<string, unknown> | null,
): Promise<DapResponse> {
  return invoke("dap_request_send", {
    sessionId,
    command,
    arguments: args ?? null,
  });
}
