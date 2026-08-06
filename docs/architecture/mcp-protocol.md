# MCP (Model Context Protocol) Native Integration

Yamet implements MCP (Model Context Protocol) as a native, built-in feature (not plugin-based). MCP servers connect over two transports implemented in Rust, and their tools are exposed directly to the AI agent.

## Architecture

`src-tauri/src/modules/mcp/`:

- `protocol.rs` — JSON-RPC 2.0 message types, MCP method constants (`initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `shutdown`, `exit`), error codes.
- `transport.rs` — two native transports behind a shared `McpTransport` trait:
  - **stdio**: spawns the server as a child process, exchanges newline-delimited JSON-RPC over stdin/stdout. Spawns use the login-shell env overlay (like LSP), process-group kill on close, and mirror stderr to the log.
  - **sse**: HTTP Server-Sent Events. A GET stream on the base URL discovers the `endpoint` event (where POSTs go) and `message` events carry JSON-RPC responses. Headers supported.
- `session.rs` — `McpSession` lifecycle: transport + reader thread, `initialize` handshake, `notifications/initialized`, request/response correlation with timeouts, cached capability lists (tools/resources/prompts), `shutdown`/`exit` teardown, status + log events emitted to the frontend (`yamet:mcp-status`, `yamet:mcp-log`).
- `server.rs` — `McpServerState` registry (configured servers vs live sessions) and the Tauri command surface.

## Tauri commands

- `mcp_server_add` / `mcp_server_remove` / `mcp_server_list` / `mcp_server_get` — configure and inspect servers.
- `mcp_server_connect` (with `root` + `workspace`) — spawn/connect the transport and run the handshake; `root` is authorized against the workspace registry.
- `mcp_server_disconnect` / `mcp_server_refresh` — graceful shutdown / re-run `tools/list`.
- `mcp_tool_call` / `mcp_resource_read` — execute tools and read resources through the live session.

## Frontend

- Settings → Integrations: `McpServersGroup` — add stdio/SSE servers, connect/disconnect, status, tool/resource counts.
- The AI agent: `src/modules/ai/tools/mcp.ts` registers every tool of every connected server (`tools/list`) into the AI SDK tool surface, namespaced `mcp_<server>_<tool>`, executing through `mcp_tool_call` (native Rust client).

## Security

- stdio servers are spawned with `cwd` inside an authorized workspace root (`authorize_spawn_cwd`); the registry is the same one gating PTY/LSP spawn.
- SSE endpoints are user-configured; requests carry no secrets beyond configured headers.
