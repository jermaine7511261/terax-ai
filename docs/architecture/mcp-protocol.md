# MCP（Model Context Protocol）原生集成

Yamet 把 MCP（Model Context Protocol）实现为**内置的原生能力**（非插件式）。MCP 服务器经两种 Rust 原生传输连接，其工具直接暴露给 AI agent。宿主/传输/UI 层全原生，不依赖外部 `mcp` crate 或 Node/Python 常驻桥接。

## 架构

`src-tauri/src/modules/mcp/`：

- `protocol.rs` —— JSON-RPC 2.0 消息类型、MCP 方法常量（`initialize`、`tools/list`、`tools/call`、`resources/*`、`prompts/*`、`shutdown`、`exit`）、错误码。
- `transport.rs` —— 共享 `McpTransport` trait 之下的两种原生传输：
  - **stdio**：把服务器作为子进程启动，stdin/stdout 交换换行分隔的 JSON-RPC。spawn 用登录 shell 环境覆盖层（同 LSP），关闭时按进程组杀，stderr 镜像到日志。
  - **sse**：HTTP Server-Sent Events。base URL 上的 GET 流发现 `endpoint` 事件（POST 的去处），`message` 事件携带 JSON-RPC 响应。支持自定义 headers。
- `session.rs` —— `McpSession` 生命周期：传输 + reader 线程、`initialize` 握手、`notifications/initialized`、带超时的请求-响应配对、缓存的 capabilities 列表（tools/resources/prompts）、`shutdown`/`exit` 拆除、状态与日志事件发往前端（`yamet:mcp-status`、`yamet:mcp-log`）。
- `server.rs` —— `McpServerState` 注册表（已配置的服务器 vs 活会话）与 Tauri 命令面。

## Tauri 命令

- `mcp_server_add` / `mcp_server_remove` / `mcp_server_list` / `mcp_server_get` —— 配置与查看服务器。
- `mcp_server_connect`（带 `root` + `workspace`）—— 启动/连接传输并跑握手；`root` 经工作区注册表授权。
- `mcp_server_disconnect` / `mcp_server_refresh` —— 优雅关闭 / 重跑 `tools/list`。
- `mcp_tool_call` / `mcp_resource_read` —— 经活会话执行工具与读取资源。

## 前端

- 设置 → 集成：`McpServersGroup` —— 添加 stdio/SSE 服务器、连接/断开、状态、工具/资源计数。
- AI agent：`src/modules/ai/tools/mcp.ts` 把每个已连接服务器的每个工具（`tools/list`）注册进 AI SDK 工具面，命名空间 `mcp_<server>_<tool>`，经 `mcp_tool_call`（原生 Rust client）执行。状态由原生 store（`@/modules/mcp`）持有（旧 `ai/lib/mcp` 已删除）。

## 安全

- stdio 服务器的 `cwd` 落在已授权工作区根内（`authorize_spawn_cwd`）；注册表与 PTY/LSP spawn 共用同一个。
- SSE 端点是用户配置的；请求除配置的 headers 外不携带任何密钥。
