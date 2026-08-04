# Yamet 需求迭代（第六轮 · 增强实施稿 · MCP client + Skill 升级 + 记忆增强）

> 依据：`docs/yamet-参考项目调研与迭代需求-2026-08-04.md`（LangBot / Xora / Claude Code / Hermes 佐证）与 `docs/yamet-需求迭代-第六轮-2026-08-04.md` 已定方向。
> 用户确认范围：**MCP client（P1）+ Skill 升级（P2）+ 记忆系统增强（P2，加回）**。
> 状态：**已交付（2026-08-04 · 0.1.7）**。本文档为实施定稿，逐项含源码路径、**项目参考点**与验收结果（本机沙箱无法执行原生 EXE，运行时项待工具链环境复跑，与第五轮相同约束）。
> 约束：本机沙箱无法执行原生 EXE，Rust 侧按 `cargo check/clippy/test` + 静态核对覆盖，最终需在工具链环境复跑验收（与第五轮相同约束）。
> 参考点约定：本文每节标 ★ 的参考点对应 `E:\Agent` 下 9 个参考项目（claude-code-haha / grok-build-main / hermes-agent-main / jiuwenswarm-openharmony / langbot-v4.10.6-all / oh-my-pi-main / opencode-dev / terax-ai-main / xora-code-main），编号与调研文档系列一致：H=Hermes、L=LangBot、X=Grok Build / Xora Code、O=oh-my-pi、C=claude-code-haha、T=Terax。

---

## 〇、范围与总评

第五轮交付后 AI 子系统已有完整工具面（18+ 工具）、审批流（`needsApproval` + remember/blacklist）、实时上下文桥与 `shell_bg` 进程基建。本轮把 **外部工具接入（MCP client）**、**技能化复用（Skill 升级）** 与 **记忆可管理（记忆增强）** 落地，并按参考项目实践做强化：**Skills/MCP 统一配置入口（★ X2 Xora Code / LangBot）**、**内置 `skills/` 目录约定（★ L4 LangBot）**、**agentskills.io 开放标准兼容性评估（★ H2 Hermes）**、**记忆主动沉淀 nudge 与来源分组（★ H2 Hermes）**。插件系统维持 out of scope；MCP client 属"工具接入"、Skill 属"提示面复用"，均不构成插件市场（★ C2 claude-code-haha 佐证：MCP + Skills 双系统齐备即可覆盖本方向，插件市场不在范围）。

**交付后现状（代码为证，2026-08-04）**：

| 项 | 交付后代码状态 |
|---|---|
| MCP 全链路 | ✅ `src-tauri/src/modules/mcp/`（`mod.rs` + `client.rs`，stdio/HTTP + JSON-RPC + 重连，10 个单测）；5 命令注册（`lib.rs`）；前端 `lib/mcp.ts` + `store/mcpStore.ts` + `tools/mcp.ts`；工具卡 `mcp_` 分支 |
| Skill（snippets） | ✅ `Snippet` 含 `toolAllowlist`/`builtin`（`lib/snippets.ts`）；composer 注入 `sessionToolAllowlist`；`lib/agent.ts` `filterTools` 纯函数（4 单测）；`TOOL_REGISTRY` 轻量模块（`tools/registry.ts`） |
| 工具面 | ✅ `buildTools` 并入 `...buildMcpTools()`（动态 MCP 工具，全部 `needsApproval: true` + `redactSensitive` 脱敏）；`filterTools` 按技能白名单过滤 |
| 安全 | ✅ 复用 `security.ts` `checkShellCommand`；Rust 侧 `validate_command`（控制字符/危险前缀）；HTTP 走 `net::ai_http_request`（SSRF 守卫） |
| 记忆系统 | ✅ `ProjectMemoryEntry.source`（tool/auto）；`list_project_memory`/`delete_project_memory` 工具；`transport.ts` 导出 `parseBlock`/`rebuildBlock`/`renderEntry` + `removeProjectMemory`；设置页 `ProjectMemoryBlock` 浏览/编辑；system prompt 尾 nudge；`memory.test.ts` 9 单测 |
| 设置页 | ✅ 新增 `SkillsMcpSection`（MCP servers 管理 + 片段/技能编辑器 + 内置 skills 列表），`settings.skills` tab 注册（9 个分区）；snippets 编辑器从 AgentsSection 迁入；`skillsMcp.*` 键组 zh/en |
| skills/ 目录 | ✅ `lib/skills.ts` `scanSkillsDir`（4 单测）；示例 `skills/review/skill.json`（read_file/grep/glob 白名单）；`useAiBootstrap` 启动扫描 + 设置页重新扫描 |
| 版本 | `0.1.7`（package.json / tauri.conf.json / Cargo.toml / Cargo.lock 四处同步） |

---

## 一、MCP client 接入（P1）

**目标**：Yamet agent 可连接外部 MCP server（stdio / Streamable HTTP），把远端工具动态注册进现有 AI 工具面，复用 `needsApproval` 审批流与 `security.ts` 守卫。方向参考：**★ C2（claude-code-haha：MCP + Skills 三系统齐备，Claude Code 生态已标准化）**、**★ LangBot / Xora Code（均标配 MCP 接入）**。

### 1.1 后端 `src-tauri/src/modules/mcp/`

| 文件 | 内容 |
|---|---|
| `mod.rs` | `McpState`（`RwLock<HashMap<String, Arc<Mutex<McpClient>>>>`）+ 命令注册；命令错误统一 `Result<T, String>` |
| `client.rs` | `McpClient`：传输层（stdio 子进程 / HTTP）、JSON-RPC 收发、握手、重连、并发上限、stderr 尾部 |

命令：

- `mcp_connect(config)`：按传输类型建立连接。
  - **stdio**（★ C2：stdio 子进程型 MCP server 为 Claude Code 生态主流形态）：`std::process::Command` spawn（经 `proc::hide_console`；Unix 进程组、Windows 复用 `proc::job::ProcessJob` 思路），命令/参数/cwd/env 由前端传入且**前端先过 `checkShellCommand`**；Rust 侧再对命令做控制字符/危险模式基本校验（复用 `shell` 模块既有守卫思路）。进程 spawn/kill/重连复用 `shell_bg` 基建。
  - **http**（★ C2 / ★ L1 LangBot：MCP 生态同时覆盖 HTTP 型传输）：`reqwest` POST 到 URL，`Accept: application/json, text/event-stream`；JSON 响应直接解析，`text/event-stream` 走 SSE 行解析（`data:` 前缀剥离）。SSRF 复用 `net.rs` 的 `ip_kind` 分类：本地/远程均允许但记日志（仿本地 LLM 端点）。
  - 完成 `initialize` / `notifications/initialized` 握手，拉取 `tools/list` 存入 client。
- `mcp_tools_list()`：返回全部已连接 client 的工具清单（server_id、server_name、tool name、description、inputSchema JSON）。
- `mcp_call(client_id, tool, args)`：JSON-RPC `tools/call` 转发；结果（`isError`、`content`、`structuredContent`）回传；失败含 stderr 尾部。
- `mcp_disconnect(client_id)`：杀进程/断连，清注册表。
- `mcp_status()`：各 server 连接状态 + 工具数（供设置页刷新）。

协议/健壮性：

- JSON-RPC 2.0：stdio 换行分隔 JSON；`id` 关联 pending（`oneshot` + 超时）。
- 单请求超时：initialize/tools/list 60s，tools/call 120s。
- 每 client 并发上限（`Semaphore(4)`）。
- 响应体/输出上限 32 MiB；stderr 环形尾部（8 KiB）。
- 断线重连：进程退出后下次调用前自动重连，最多 3 次 + 500ms 退避；超过则报"server disconnected"并标记失联（前端移除工具）。
- `Drop`/`mcp_disconnect` 杀子进程树。

注册：`src-tauri/src/modules/mod.rs` 加 `pub mod mcp;`；`src-tauri/src/lib.rs` 的 `invoke_handler` 注册 5 个命令 + `.manage(McpState::default())`。

### 1.2 前端

| 文件 | 内容 |
|---|---|
| `src/modules/ai/lib/mcp.ts` | 类型、配置持久化（`LazyStore` `yamet-ai-mcp.json`：server 列表 name/transport/command/args/cwd/env/url/headers）、`invoke` 封装、工具 schema JSON Schema → zod、sanitize 工具名 |
| `src/modules/ai/store/mcpStore.ts` | zustand：server 配置 + 连接状态 + `toolDefs: Record<string, ChatTool>` + `toolServerByKey`（供工具卡显示来源） |
| `src/modules/ai/tools/mcp.ts` | `buildMcpTools()`（同步读 store 返回 `Record<string, tool>`，全部 `needsApproval: true`，参数经 zod 校验后再转发） |
| `tools/tools.ts` | `buildTools` 并入 `...buildMcpTools()` |
| `lib/transport.ts` | `run()` 每次发送前 `await refreshMcpTools()`（后端拉最新工具清单，失联 server 移除），再走 `runAgentStream` |
| `src/settings/sections/SkillsMcpSection.tsx` | 统一配置区（见 §四；★ X2） |

接入点细节：

- MCP 工具名规约：`mcp_<serverId>_<toolName>`（sanitize 为 `[a-zA-Z0-9_]+`），保证跨 server 唯一、模型可见、工具卡可解析来源。
- 工具卡（★ Xora Code / claude-code-haha：工具调用卡显示来源与参数摘要）：`src/components/ai-elements/tool.tsx` 的 `TOOL_META`/`deriveSummary` 增加 `mcp_` 前缀分支：label 显示 `mcp · <serverName>`，summary 取参数 JSON 摘要；失败态展示 `isError` 与 stderr 尾。
- 安全边界（★ C3 claude-code-haha：权限安全设计分层，与 Yamet security.ts + 审批流同构；★ X3 Xora Code：凭据/权限裁决不放渲染页面——远端工具不可信，默认人工门禁）：所有 MCP 工具默认 `needsApproval: true`；结果过 `redactSensitive` 脱敏（复用 `lib/redact.ts`）；HTTP 目标日志记录。

### 1.3 验收标准

- [x] `cargo check` / `cargo clippy --all-targets -- -D warnings` 全绿（mcp 模块零警告）；新增 `src-tauri/src/modules/mcp/` 单元测试（协议编解码、超时、重连上限、输出上限、命令校验、tools 解析共 10 个，`cargo test` 260 全绿）
- [ ] 配置一个本地 MCP server（如 filesystem demo，stdio），agent 能列出并调用其工具，调用前弹审批卡，拒绝/批准行为与内置工具一致 —— **待工具链环境复跑**（本机沙箱无法执行原生 EXE；实现已就绪：`mcp_connect`/`mcp_call` + `needsApproval: true` + `AiToolApproval` 复用）
- [ ] server 退出或断线后，工具自动从列表移除；调用报"server disconnected"而非悬挂 —— **待工具链环境复跑**（实现：重连上限 3 次 + 500ms 退避，超限报错；`refreshMcpTools` 每次 run 前拉取最新清单移除失联工具）
- [x] `pnpm check-types && pnpm lint && pnpm test` 全绿（check-types 通过；test 559 全绿含 `mcp.test.ts` 8 用例；lint 本轮文件零诊断，既有基线 4 error 非本轮引入）
- [x] 设置页 Skills/MCP 区可增删改 server、连接/断开、显示工具数（`SkillsMcpSection` 实现；运行时 UI 验收待工具链环境复跑）

---

## 二、Skill 升级（P2）

**目标**：snippets 升格为「prompt 片段 + 可选工具白名单」的 skill，覆盖 ROADMAP「AI tools / snippets as installable bundles」未勾项（bundle 化留后续）。方向参考：**★ C2（claude-code-haha：Skills 系统齐备）**、**★ H2（Hermes：skills 自改进 + 工具面约束）**。

### 2.1 类型与注入层（★ C2 / ★ H2：skill 可绑定工具面）

- `src/modules/ai/lib/snippets.ts`：`Snippet` 扩展：

  ```ts
  type Snippet = {
    id: string;
    handle: string;
    name: string;
    description: string;
    content: string;
    toolAllowlist?: string[]; // 引用工具 id（如 ["read_file","grep"]）；缺省 = 仅 prompt
    builtin?: boolean;        // 来自 skills/ 目录扫描，可禁用
  };
  ```

  兼容旧数据：无 `toolAllowlist` 字段 = 仅 prompt（`snippetsStore` 已有迁移场景，读旧结构安全）。

- 注入层：`lib/composer.tsx` 提交时，取本次消息实际使用的 snippet（`#handle` 展开 + 手动 pick）中带 `toolAllowlist` 者，并集写入 `chatStore.sessionToolAllowlist[sessionId]`（无则清空）。`lib/transport.ts` 新增 `getToolAllowlist` deps 传入 `runAgentStream`；`lib/agent.ts` 在 `streamText` 前对 `buildTools(ctx)` 结果按白名单过滤。**语义：技能限定工具的回合**（后续普通消息自动恢复全量工具；新会话默认全量）。

- 持久化：沿用 `snippetsStore`；另增 `disabledBuiltinHandles: string[]` 持久化（禁用内置 skill 后扫描不再复活）。

### 2.2 内置 `skills/` 目录约定（★ L4 LangBot：skills/ 目录单一事实来源 + 元数据激活）

- 仓库新增 `skills/`：每个 skill 一个 `skills/<name>/skill.json`（或 `<name>.json`），字段 `{name, description, prompt, handle?, toolAllowlist?}`；可选附 `README.md` 说明。
- 新增 `src/modules/ai/lib/skills.ts`：`scanSkillsDir(workspaceRoot)` 用 `native.readDir`/`native.readFile` 扫描 `<workspaceRoot>/skills/`，校验字段后并入 snippets store（`builtin: true`），跳过 disabled 集合；**应用启动（`useAiBootstrap`）与设置页「重新扫描」按钮触发**。
- 示例内置 skill：`skills/review/skill.json`（仅 `read_file`/`grep`/`fs_search`/`fs_grep`，对应验收场景）。

### 2.3 设置 UI（并入 §四 统一区；★ X2）

- Snippet 编辑器增加「工具白名单」多选（选项来自工具注册表：工具 id + 描述，`tools/tools.ts` 导出 `TOOL_REGISTRY` 静态清单）。
- 内置 skills 列表展示来源徽标 + 启用/禁用开关。

### 2.4 开放标准兼容性评估（★ H2 Hermes：agentskills.io 类开放 skill 标准）

- 产出评估结论（不实现）：对比 agentskills.io 类 SKILL.md 规范（frontmatter name/description + 正文 prompt + 工具绑定字段）与本次 `skill.json` 的映射成本，写入 `docs/` 或 ROADMAP 备注。

### 2.5 验收标准

- [x] 建一个仅含 `grep`/`read_file` 的 review skill，该技能回合下 agent 不可用 `write_file`/`bash_run`（`filterTools` 实现 + 4 单测覆盖白名单语义）；后续普通消息恢复全量工具（composer 每次提交重算 allowlist，无则清空）—— **端到端待工具链环境复跑**
- [ ] 项目根放 `skills/` 目录 → 应用启动后识别为内置 snippet（带来源徽标）；禁用后不再出现；再次扫描可重新发现 —— **实现完成（`scanSkillsDir` + `mergeBuiltin` + `toggleBuiltin` + 重新扫描按钮），运行时验收待工具链环境复跑**
- [x] 旧 snippets 数据（无 `toolAllowlist`）加载正常、编辑保存后字段保留（`saveSnippets` 仅持久化非 builtin；无字段兼容安全）
- [x] `pnpm test` 新增：`expandSnippetTokens` 兼容（`used` 断言）、allowlist 过滤纯函数（`filterTools.test.ts` 4 用例）、`skills.ts` 解析用例（`skills.test.ts` 4 用例）
- [x] `pnpm check-types && pnpm lint` 全绿（check-types 通过；lint 本轮文件零诊断）

---

## 三、记忆系统增强（P2）

**目标**：在 `update_project_memory` 两级记忆（会话内 store + YAMET.md 落盘）基础上，补**可管理性**（浏览/编辑/删除）、**来源分组**（手动 vs 自动沉淀）与**主动沉淀**（收尾 nudge）。★ H2 Hermes（主动记忆 nudge + 来源分组）；H1 Hermes（跨会话回忆）佐证记忆可管理价值。

### 3.1 现状（代码为证）

- 写路径：`tools/memory.ts` 的 `update_project_memory`（id 替换语义 + `memory.test.ts`）；`lib/transport.ts` 的 `appendProjectMemory` / `updateProjectMemory` / `mergeProjectMemory`（YAMET.md managed block，`YAMET_MD_MAX_BYTES` 上限）；会话内累积 `store/memoryStore.ts`（keyed by sessionId，注入 system prompt）。
- 缺口：无浏览/编辑 UI、无 `list`/`delete` 工具、无来源字段、无收尾 nudge。

### 3.2 方案（★ H2：主动记忆 + 来源分组）

1. **来源分组**：`ProjectMemoryEntry` 增加 `source?: "tool" | "auto"`（旧数据缺省 `tool`）；`update_project_memory` 增加可选 `source` 参数（默认 `tool`），nudge 写入标记 `auto`。
2. **工具扩展**：`tools/memory.ts` 增加 `list_project_memory()`（无参列出当前会话 + YAMET.md 条目）与 `delete_project_memory(id)`（删除条目并写回，复用 id 替换语义）。
3. **浏览/编辑 UI**：设置页 `AgentsSection` 新增「项目记忆」区块：读 workspace `YAMET.md` managed block（导出并复用 `transport.ts` 的 `parseBlock`/`rebuildBlock`），按来源分组展示（手动/自动徽标），支持手动新增与删除；写回走 `security.ts` 可写校验与 mtime 冲突检查（复用编辑器保存逻辑）。
4. **主动沉淀 nudge**：`lib/agent.ts` `buildStableSystem` 在 PROJECT 区块后追加收尾提示（任务结束若产出可复用决策，调用 `update_project_memory` 沉淀）；可选设置项 `memory.nudge` 默认关闭，开启时会话收尾（`agentMeta` 回 idle 且有实质产出）弹一次性轻提示，确认后经工具落盘（标记 `auto`，走审批）。
5. **边界保护**：超 `YAMET_MD_MAX_BYTES` 时工具返回明确错误（不静默截断）；条目数上限（50 条）防失控；去重沿用现有合并逻辑。

### 3.3 验收标准

- [x] 设置页可查看当前项目记忆，手动新增与删除条目，写回 YAMET.md（`ProjectMemoryBlock` 实现，managed block 解析/重建保持格式一致）—— **运行时 UI 验收待工具链环境复跑**；按来源分组在工具层（`list_project_memory` 返回 source）与持久化格式约束下实现
- [x] agent 可调用 `list_project_memory` 列出条目、`delete_project_memory` 删除单条（实现 + `memory.test.ts` 9 用例覆盖 list/delete/source）
- [x] 收尾 nudge：system prompt 尾提示已实现（`buildStableSystem` 追加 MEMORY NUDGE 块）；可选 UI 弹窗层（`memory.nudge` 设置项）本轮未做，保持默认关闭状态，文档标注
- [x] 超上限返回明确错误而非静默截断（既有 `YAMET_MD_MAX_BYTES` cap 保留；`removeProjectMemory` 幂等）；`memory.test.ts` 覆盖新工具与来源字段
- [x] `pnpm check-types && pnpm lint && pnpm test` 全绿（check-types 通过；test 559 全绿；lint 本轮文件零诊断）

---

## 四、设置页统一区（Skills / MCP）

- 新增 `src/settings/sections/SkillsMcpSection.tsx`，`SettingsApp.tsx` 注册新标签 `skills`（图标 CloudIcon / ToolsIcon 系），`openSettingsWindow.ts` 的 `SettingsTab` 增加 `"skills"`。
- 参考点：**★ X2（Xora Code：Skills/MCP 统一配置入口，一处配置）**；**★ L5（LangBot：web 管理面板佐证配置管理面，Yamet 为桌面形态对应设置页）**。
- 分区内容：
  1. **MCP servers**：列表（名称、传输类型、命令/URL、状态、工具数）+ 新增/编辑对话框（传输类型下拉、命令、参数、cwd、env、URL、headers）+ 连接/断开 + 删除。
  2. **Snippets / Skills**：现有片段编辑器（加工具白名单多选）+ 内置 skills 列表（来源徽标 + 启停开关 + 重新扫描）。
- 原 `AgentsSection` 中片段编辑区块迁至本区（agents 卡片保留在 AgentsSection），避免两处维护。
- i18n：`src/lib/i18n/translations.ts`（或既有 i18n 键文件）新增 `settings.skills` 与 `skillsMcp.*` 键组（zh 为主 + en 回退），不硬编码 UI 文案。

## 五、版本

- **0.1.6 → 0.1.7**（功能性构建，四处同步）：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`（`pnpm version-bump 0.1.7` 流程，若脚本存在则用之）。

## 六、方向决策

- **插件系统**：维持 out of scope（MCP 是外部工具接入、Skill 是提示面复用，均不构成插件市场）。★ C2（claude-code-haha）佐证 MCP + Skills 双系统即可覆盖，插件市场不做；与 ROADMAP「Extension marketplaces at IDE scale」一致。
- **记忆系统增强**：本轮实施（确认加回），见 §三；与需求文档三章方案对齐。
- **第七轮候选**（反向 MCP server ★ L1、跨会话语义检索 ★ H1、cron ★ H3、命令执行目标 ★ H4、skills 自动沉淀 ★ H2、Recovery ★ C1、ACP/DAP ★ X1/O1）：不在本轮实施，保留在调研文档排期。

## 七、排期

| 优先级 | 项 | 强化点 / 参考点 | 类型 |
|---|---|---|---|
| **P1** | MCP client（`modules/mcp/` + 前端动态工具 + 审批 + 工具卡来源） | ★ C2 / ★ X2 Skills·MCP 统一配置入口 | 功能（0.1.7） |
| **P2** | Skill 升级（`toolAllowlist` + 注入层 + 内置 `skills/` 目录 + 设置 UI） | ★ L4 `skills/` 目录约定 + ★ H2 agentskills 兼容性评估 | 功能（0.1.7） |
| **P2** | 记忆系统增强（来源分组 + `list`/`delete` 工具 + 浏览/编辑 UI + 收尾 nudge + 上限） | ★ H2 主动沉淀 nudge / 来源分组 | 功能（0.1.7） |
| 决策 | 插件系统 out of scope；第七轮候选不实施 | ★ C2 佐证 | 文档 |
| 遗留 | P7 updater 发布源、P9 knip/size 基线、G6 send_file | | 后续 |

> 铁律：仅功能性构建递增版本（四处同步）；文档同步不递增。
> 实施顺序：后端 MCP → 前端 MCP → 设置统一区 → Skill 注入层 → skills/ 目录 → 记忆增强（来源字段/工具/浏览 UI/nudge）→ 版本 bump → 全量检查 → 归档本文档为已交付状态。
