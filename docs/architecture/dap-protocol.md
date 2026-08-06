# DAP (Debug Adapter Protocol) Native Integration

Yamet implements DAP (Debug Adapter Protocol) as a native, built-in debugging feature (not plugin-based). Debug adapters are spawned or connected from Rust, and the frontend drives them through a real DAP client.

## Architecture

`src-tauri/src/modules/dap/`:

- `protocol.rs` — DAP message types (request/response/event) and the command/event constant table.
- `transport.rs` — two native transports behind a shared `DapTransport` trait:
  - **stdio**: spawns the debug adapter as a child process and speaks the Content-Length base protocol (framing shared with LSP via `src-tauri/src/modules/framing.rs`). Spawn uses the login-shell env overlay, process-group kill on close, and mirrors stderr to the log.
  - **tcp**: connects to an already-running adapter (`host`/`port`), same framing.
  - websocket config is parsed but connecting returns an explicit "not implemented" error.
- `session.rs` — `DapSession`: transport + reader thread, seq-numbered request/response correlation with timeouts, `initialize` handshake (capabilities cached), event forwarding to a Tauri channel, status tracking (`initialized`/`stopped`/`continued`/`exited`/`terminated`), graceful `disconnect`. `DapSessionState` registry + Tauri command surface.

## Tauri commands

- `dap_session_create` / `dap_session_list` / `dap_session_get` — configure and inspect adapter definitions.
- `dap_session_connect` (with `root`, `workspace`, `onEvent` channel) — spawn/connect the transport and run `initialize`; `root` is authorized against the workspace registry.
- `dap_session_disconnect` — graceful shutdown.
- `dap_request_send(session_id, command, arguments)` — send any DAP request (`launch`, `attach`, `setBreakpoints`, `threads`, `stackTrace`, `scopes`, `variables`, `continue`, `next`, `stepIn`, `stepOut`, `pause`, ...) and await the adapter's response.

## Frontend

- Settings → Integrations: `DapAdaptersGroup` — define adapters (stdio command/args or TCP host/port).
- Editor: `breakpointGutter` (CodeMirror gutter) toggles breakpoints per file and pushes `setBreakpoints` to the active adapter.
- `DebugPanel` (bottom of the editor workspace): session select + Launch (JSON launch args), continue/pause/stop, step over/into/out, threads, call stack, variables, and an output console fed by `output` events.

## Debug flow

1. `dap_session_connect` runs `initialize`; the adapter replies with capabilities then emits `initialized`.
2. On `initialized` the frontend sends `launch` (from the panel's JSON args) then `configurationDone`.
3. Adapter events (`stopped`, `output`, `exited`, ...) stream over the connect channel; `stopped` triggers threads → stackTrace → scopes → variables fetching.
