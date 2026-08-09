# DAP（Debug Adapter Protocol）原生集成

YaMet 把 DAP（Debug Adapter Protocol）实现为**内置的原生调试能力**（非插件式）。调试适配器由 Rust 侧启动或连接，前端通过真实的 DAP client 驱动。宿主/传输/UI 层全原生；适配器二进制（debugpy / node / lldb-dap / gdb / dlv）是协议固有的外部程序，不违背原生铁律。

## 架构

`src-tauri/src/modules/dap/`：

- `protocol.rs` —— DAP 消息类型（request / response / event）与 command/event 常量表。
- `transport.rs` —— 共享 `DapTransport` trait 之下的两种原生传输：
  - **stdio**：把调试适配器作为子进程启动，讲 Content-Length 基础协议（分帧与 LSP 共享，见 `src-tauri/src/modules/framing.rs`）。spawn 用登录 shell 环境覆盖层，关闭时按进程组杀，stderr 镜像到日志。
  - **tcp**：连接已在运行的适配器（`host`/`port`），同一分帧。
  - websocket 配置可解析，但连接返回显式「not implemented」错误。
- `session.rs` —— `DapSession`：传输 + reader 线程，带超时的 seq 号请求-响应配对、`initialize` 握手（缓存 capabilities）、事件经 Tauri Channel 转发、状态跟踪（`initialized`/`stopped`/`continued`/`exited`/`terminated`）、优雅 `disconnect`。`DapSessionState` 注册表 + Tauri 命令面。

## Tauri 命令

- `dap_session_create` / `dap_session_list` / `dap_session_get` —— 配置与查看适配器定义。
- `dap_session_connect`（带 `root`、`workspace`、`onEvent` channel）—— 启动/连接传输并跑 `initialize`；`root` 经工作区注册表授权。
- `dap_session_disconnect` —— 优雅关闭。
- `dap_request_send(session_id, command, arguments)` —— 发送任意 DAP 请求（`launch`、`attach`、`setBreakpoints`、`threads`、`stackTrace`、`scopes`、`variables`、`continue`、`next`、`stepIn`、`stepOut`、`pause` 等）并等待适配器响应。

## 前端

- 设置 → 集成：`DapAdaptersGroup` —— 定义适配器（stdio command/args 或 TCP host/port）。
- 编辑器：`breakpointGutter`（CodeMirror gutter）按文件 toggle 断点，并把 `setBreakpoints` 推给活动适配器。
- `DebugPanel`（编辑器工作区底部）：会话选择 + Launch（JSON launch 参数）、continue/pause/stop、步过/步入/步出、线程、调用栈、变量，以及由 `output` 事件驱动的输出控制台。

## 调试流程

1. `dap_session_connect` 跑 `initialize`；适配器回 capabilities 后发 `initialized`。
2. 收到 `initialized` 后前端发 `launch`（面板的 JSON 参数）再发 `configurationDone`。
3. 适配器事件（`stopped`、`output`、`exited` 等）经连接 channel 流式到达；`stopped` 触发 threads → stackTrace → scopes → variables 拉取。
