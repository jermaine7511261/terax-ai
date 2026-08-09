# AGENTS.md

YaMet 是多端 AI Agent 工作台。本文档定义 Agent 系统架构、多端接入协议、扩展生态规范、会话可靠性保证和 Rust 工程规范。

改动前先读 `YAMET.md`（活架构文档）。

---

## 多端接入架构

YaMet 通过统一的 Agent Runtime Layer 支持四个前端形态共享同一核心：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Runtime Layer (Rust)                    │
│  AgentDef · Registry · Lifecycle · Trace · ToolBridge · Memory  │
├──────────┬──────────┬──────────┬──────────┬────────────────────┤
│  Tauri   │  WebUI   │   CLI    │  Gateway │  MCP Server        │
│  Desktop │  Browser │  stdio   │  IM 6平台 │  JSON-RPC stdio   │
└──────────┴──────────┴──────────┴──────────┴────────────────────┘
```

### 四端映射规则

| 端 | 入口 | 命令面范围 | PTY/Shell | FS 写 | 安全门 |
|---|---|---|---|---|---|
| **Tauri** | `tauri.conf.json` | 147+ 命令（全量） | portable-pty 原生 | workspace 授权 + 密钥拒绝名单 | 双层（security.ts + policy.rs） |
| **WebUI** | `scripts/dev-web.mjs` | 21 命令（受限子集） | 降级（PTY 关闭） | node fs（路径包含性校验 + 敏感文件门） | WS token + Origin + 回环绑定 |
| **CLI** | `modules/cli.rs --prompt` | 0（直连 ai::client） | 无 | stdout 输出 | keyring 取 key + SSRF 守卫 |
| **Gateway** | `modules/gateway/` | AI 工具面子集 | 无 | 经 workspace 授权 | 会话认证门禁（默认拒绝） |
| **MCP** | `modules/mcp_server/` | MCP tools/call | 无 | 经 workspace 授权 | 协议级权限协商 |

### 端间状态同步

- **会话恢复**：Tauri 桌面端恢复 PTY 会话（helper 进程持有 + buffer 快照回放），WebUI 无 PTY 只恢复文件布局。
- **记忆跨端**：global/workspace 记忆持久化到 `ai-memory.json`（data_dir），所有端共享；session 记忆仅内存。
- **Agent Registry**：Tauri 端通过 `AgentPlatformState` 管理 Rust 侧注册表；WebUI 端降级到本地 store。

### 新增端的接入协议

1. 在 `src/platform/` 新增适配器目录（`platform/<端>/`），实现 `types.ts` 定义的16个接口。
2. 命令面子集：从147个命令中挑选该端需要的命令，在对应 `server/` 中注册 handler。
3. 安全门：必须实现等效的路径校验 + 命令过滤，通过 `check-doc-drift.mjs` 门禁。
4. 测试：`smoke.test.ts` 锁定命令面一致性。

---

## 扩展生态

### 插件系统（当前范围外，预留设计）

**铁律**：插件 = 窄范围 AI 工具 + 片段 bundle，原生解析，禁止外部运行时。

```
skills/
  <skill-name>/
    skill.json          # 声明：name, description, tools, model, effort
    SKILL.md            # 正文：system prompt + frontmatter
    *.md / *.json       # 可选附件（模板、示例等）
```

### 技能生命周期

```
created → active → (idle > threshold) → reviewed by curator
                                          ├→ pinned   (用户标记)
                                          ├→ archived (自动归档)
                                          └→ kept     (近期活跃)
```

- `create_skill`：Agent 调用，写 `<workspace>/skills/<name>/skill.json` + `SKILL.md`
- `skillCurator.ts`：后台策展（inactivity-triggered），只动 agent 创建的 skill，永不删除
- `convertSkillMd`：SKILL.md frontmatter → skill.json 转换器

### MCP 集成

YaMet 同时是 MCP client 和 server：

- **Client**（`modules/mcp/`）：连接外部 MCP 服务器，注册其工具到 Agent 工具池
- **Server**（`modules/mcp_server/`）：将 YaMet 的能力暴露给外部 AI 客户端
- 传输：stdio / SSE，全链路原生 Rust 实现

### 工具扩展接口

新增 AI 工具的四步流程：

1. **Rust 后端**：`src-tauri/src/modules/<domain>/mod.rs` 实现 `#[tauri::command]`
2. **注册命令面**：`lib.rs` `generate_handler!` + `.manage(State)`
3. **前端封装**：`src/modules/ai/lib/native.ts` 加 invoke 封装
4. **工具注册**：`src/modules/ai/tools/<tool>.ts` 用 `tool()` 定义 + `buildTools()` 挂载

**验证门禁**：四级链路检查——后端实现 → 后端桥接 → 前端封装 → 前端使用。第 4 级为空 = 死代码。

---

## 会话可靠性

### PTY 会话

| 机制 | 说明 |
|---|---|
| **helper 进程** | 独立常驻进程持有全部 PTY，主进程崩溃后会话存活 |
| **重连** | 主进程启动时探测 helper，按 session id attach |
| **buffer 快照** | helper 不可用时回放 `~/.yamet/sessions/<id>.snap` |
| **ConPTY 生命周期锁** | Windows `SPAWN_LOCK` 防并发 spawn 导致管道停滞 |
| **Job Object** | Windows `KILL_ON_JOB_CLOSE` 杀整棵进程树 |
| **OSC 7/133** | cwd 追踪 + 命令边界标记（A/B/C/D），无提示符重解析 |

### AI 会话

| 机制 | 说明 |
|---|---|
| **Rust Harness** | `AiSessionState` 会话状态机 + `Channel<AiEvent>` 事件流 |
| **健壮退出** | `finish≠tool-calls 且无 pending tool` 才退出（不只信 stop_reason） |
| **Doom-loop 检测** | 连续 3 次相同 tool+args → 自动停止 |
| **子代理预算** | `MAX_SPAWN_DEPTH=3` + `SUBAGENT_SUMMARY_CAP=4000` |
| **Checkpoint** | Flock-style SQLite checkpoint，可从断点恢复 |
| **记忆隔离** | 子代理独立 session 记忆，不共享父 agent 上下文 |

### Graph 编排会话

| 机制 | 说明 |
|---|---|
| **Journal 断点续跑** | `hash_graph_def` request_hash 去重 + journal 文件落盘 |
| **状态机** | `Pending→Running→Done/Failed/WaitingHuman`，每节点事件推送 |
| **并行调度** | `Semaphore(4)` 限并发 + `tokio::spawn` 无依赖节点并行 |
| **三态审批** | `once/always/reject` + 级联 + 反馈纠错 |
| **Judge fail-open** | LLM 判定异常时放行不阻塞，连续 3 次失败才暂停 |

---

## Rust 工程规范

### 架构分层

```
src-tauri/src/
  lib.rs              # 命令面注册（generate_handler!）+ 状态管理
  modules/
    <domain>/
      mod.rs          # 模块入口 + pub use
      <impl>.rs       # 核心实现（纯函数优先）
      types.rs        # DTO / serde 类型
      tests.rs        # #[cfg(test)] 模块
```

### DTO 边界规则

1. **前端→后端**：所有传入参数必须是 `#[derive(Deserialize)]` 的 serde 类型，绝不接收裸 `serde_json::Value`（安全关键命令除外，如 `dap_request_send` 透传 JSON-RPC）。
2. **后端→前端**：所有返回值必须是 `#[derive(Serialize)]` 的类型。禁止返回裸 `String` 表示结构化数据。
3. **Option 语义**：`Option<T>` 表示"可选字段"，`null`/缺失在 JSON 层等价。不在 DTO 层用 `Option<Option<T>>`（嵌套 Option 是坏味道）。
4. **时间戳**：统一用 `u64` 毫秒（`SystemTime::now().duration_since(UNIX_EPOCH).as_millis() as u64`），不用 String 也不用 DateTime。
5. **枚举**：`#[serde(tag = "kind", rename_all = "lowercase")]` 标签枚举；变体名用 camelCase。

### 映射规则

| 概念 | Rust 侧 | TS 侧 | 映射 |
|---|---|---|---|
| AgentDef | `agents::agent_def::AgentDef` | `AgentDef` (native.ts) | serde camelCase ↔ TS camelCase |
| AgentState | `lifecycle::AgentState` | `AgentStateKind` | tagged enum → TS union type |
| ToolScope | `agent_def::ToolScope` | `ToolScope` | tagged enum → TS discriminated union |
| TokenUsage | `lifecycle::TokenUsage` | `{ input, output, cachedInput }` | 同名字段直接映射 |
| TraceSpan | `trace::TraceSpan` | `TraceSpan` (native.ts) | camelCase 自动映射 |

### 验证门禁

每个 Rust 命令必须通过：

```bash
cd src-tauri
cargo clippy --all-targets --locked -- -D warnings   # 零 warning
cargo nextest run --locked                            # 全绿（或 cargo test --locked）
```

每个前端改动必须通过：

```bash
pnpm check-types   # tsc --noEmit，零错误
pnpm lint          # biome lint，零 error
pnpm test          # vitest run，全绿
```

全局门禁：

```bash
pnpm check-drift   # 命令面 / 模块布局 / 原生铁律 一致性检查
pnpm size          # 体积预算（eager ≤540KB，total ≤1.6MB）
```

### 回复格式（所有 AI 工具）

工具执行结果必须包含结构化信息，便于模型理解：

```rust
// 成功
{ "ok": true, "path": "...", "bytesWritten": 123 }

// 失败 —— 必须包含 user-friendly reason + 可操作的下一步
{
  "error": "old_string not found: \"foobar\"",
  "path": "/src/main.rs",
  "hint": "Try read_file first to confirm the exact text."
}
```

**下一步建议 + 剩余风险**规则：

- `error` 字段：技术性错误信息（给模型理解）
- `hint` 字段（可选）：user-friendly 的修复建议（给 UI 展示）
- 安全拒绝必须带 `reason`，不泄露路径内容细节

### 测试规范

1. **纯函数优先**：核心逻辑抽为无副作用的纯函数（`fn compute_idf(...) -> HashMap`），放在模块内或 `lib/` 下。
2. **命名约定**：`<module>_<function>_<scenario>` 或 `<module>::tests::<name>`。
3. **边界覆盖**：空输入、零匹配、并发竞争、序列化往返（serde roundtrip）。
4. **安全测试**：`checkShellCommand` 的每种攻击模式必须有对应 assert。
5. **Rust 测试文件**：`#[cfg(test)] mod tests {}` 在同一文件内；跨文件集成测试放 `src-tauri/tests/`。

### 新增模块 checklist

- [ ] `mod.rs` 导出公共 API
- [ ] `types.rs` 定义 DTO（serde derive）
- [ ] `#[tauri::command]` 函数签名 + 注册到 `lib.rs`
- [ ] `native.ts` invoke 封装
- [ ] 前端消费者（不是仅存在，是被 import 并调用）
- [ ] `#[cfg(test)]` 至少 1 个 serde roundtrip + 1 个边界 case
- [ ] `check-doc-drift.mjs` 通过
- [ ] `cargo clippy -D warnings` + `cargo test` 全绿
- [ ] `tsc --noEmit` + `vitest run` 全绿
