# 多端接入架构

YaMet 通过统一的 Agent Runtime Layer 支持多个前端形态共享同一 Rust 核心。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│               Agent Runtime Layer (Rust)                      │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ AgentDef │ │ Registry │ │ Lifecycle│ │  Trace   │       │
│  │ Schema   │ │ (3源合并) │ │ (6状态机) │ │ (span树) │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ToolBridge│ │  Memory  │ │  Skills  │ │ Security │       │
│  │(46工具)   │ │(三层+召回)│ │(策展+生命周期)│ │(双层门)  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├──────────────────────────────────────────────────────────────┤
│                   Platform Adapter Layer                      │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐       │
│  │ Tauri │ │ WebUI │ │  CLI  │ │Gateway│ │  MCP  │       │
│  │Desktop│ │Browser│ │ stdio │ │IM 6平台│ │Server │       │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘       │
└──────────────────────────────────────────────────────────────┘
```

## 各端详细映射

### Tauri Desktop（全量端）

- **入口**：`src-tauri/src/lib.rs` → `generate_handler!` 注册 147+ 命令
- **状态管理**：`AgentPlatformState` + `PtyState` + `LspState` + `DapState`
- **PTY**：portable-pty 原生，ConPTY（Windows）+ helper 常驻进程
- **FS**：Rust fs + workspace 授权注册表 + 密钥拒绝名单
- **安全**：security.ts（前端）+ policy.rs（后端）双层

### WebUI（受限端）

- **入口**：`scripts/dev-web.mjs` → Node 后端 WS :127.0.0.1:31219
- **命令面子集**：21 命令（fs 读写 + git 只读 + shell_run + history）
- **PTY**：不支持（降级为只读终端）
- **安全门**：WS token + Origin 白名单 + 回环绑定 + 路径包含性校验

### CLI（轻量端）

- **入口**：`src-tauri/src/modules/cli.rs` → `YaMet --prompt "..."` print-mode
- **命令面**：0（直连 `ai::client`，不走 Tauri IPC）
- **支持**：`--model` / `--base-url` / `--keyring-account` / `--reasoning-effort`
- **输出**：stdout 流式

### Gateway（IM 端）

- **入口**：`src-tauri/src/modules/gateway/`
- **适配器**：钉钉 / 飞书 / 企微 / QQ（OneBot v11）/ 微信（iLink Bot）/ 公众号
- **安全**：会话认证门禁（默认拒绝 + 按会话批准白名单）
- **凭据**：keyring（`gateway:<platform>`）+ 冗余 JSON（Windows DPAPI）

### MCP Server（协议端）

- **入口**：`src-tauri/src/modules/mcp_server/`
- **传输**：stdio / SSE，JSON-RPC 分帧
- **暴露**：YaMet 的 AI 工具作为 MCP tools 暴露给外部客户端

## 新增端接入协议

1. 在 `src/platform/<new>/` 实现 `types.ts` 的 16 个接口
2. 从 147 命令中挑选子集，注册 handler
3. 实现等效安全门（路径校验 + 命令过滤）
4. 新增 `smoke.test.ts` 锁定命令面一致性
5. `check-doc-drift.mjs` 自动校验

## 状态同步

| 状态类型 | 同步机制 | 跨端 |
|---|---|---|
| 全局记忆 | `ai-memory.json`（data_dir） | 是（共享文件） |
| 工作区记忆 | `<workspace>/.yamet/memory.json` | 是（共享文件） |
| Agent Registry | `AgentPlatformState`（Rust 内存） + 持久化 JSON | Tauri 端独占 |
| PTY 会话 | helper 进程 + buffer 快照 | Tauri 端独占 |
| 设置偏好 | plugin-store / localStorage | 端内隔离 |
