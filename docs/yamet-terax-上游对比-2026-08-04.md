# Yamet × Terax 上游功能增量对比（吸收清单）

> 调研日期：2026-08-04　｜　来源：需求文档第七轮调研项（T1）
> 对象：上游 `E:\Agent\terax-ai-main`（Terax v0.8.6，crynta/terax-ai）　vs　本仓库 `E:\Agent\yamet`（Yamet v0.1.8）
> 方法：逐文件 diff `src/` 与 `src-tauri/src/`（文件清单 + 内容哈希 + 行数 + 关键文件内容比对）
> 结论一句话：**Yamet 是 Terax 的功能超集**——上游没有任何 Yamet 缺失的模块/组件；Yamet 在此之上新增了大量能力。真正的「可吸收增量」集中在**语音转写云端通道**与**推理 effort 参数**两处，且需在「不回退」前提下吸收。

---

## 一、模块 / 目录结构对比

### 1.1 前端 `src/`（模块层）

| 模块 | Terax | Yamet | 说明 |
|---|---|---|---|
| `agents` | ✅ | ✅ | 多 agent / 子 agent、通知桥 |
| `ai` | ✅ | ✅ | 聊天 / 工具 / 审批 / 会话 |
| `command-palette` | ✅ | ✅ | 命令面板 |
| `editor` | ✅ | ✅ | CodeMirror 编辑器 + 行内补全 |
| `explorer` | ✅ | ✅ | 文件浏览器 |
| `git-history` | ✅ | ✅ | 提交图历史 |
| `header` / `sidebar` / `statusbar` / `tabs` | ✅ | ✅ | 布局与标签 |
| `lsp` | ✅ | ✅ | 语言服务器（两版均较弱，非重型 IDE） |
| `markdown` / `preview` | ✅ | ✅ | 预览 |
| `settings` / `shortcuts` / `theme` / `updater` / `workspace` | ✅ | ✅ | 通用 |
| `spaces` | ✅ | ✅ | 空间 |
| `terminal` | ✅ | ✅ | 含 block 块终端 / 分屏 / PTY |
| `gateway` | ❌ | ✅ **Yamet 独有** | IM 网关前端桥接 |
| `i18n`（`lib/i18n/`） | ❌ | ✅ **Yamet 独有** | 简中为主 + 英文回退 |
| `OnboardingDialog` / `ErrorBoundary` | ❌ | ✅ **Yamet 独有** | 首次引导 / 错误边界 |

**关键结论：**
- 文件级对比：Terax 独有的前端文件 **仅 1 个**（`modules/theme/themes/terax-default.ts`，主题命名差异）；Yamet 独有的前端文件 **39 个**（全为新增能力）。
- 共用文件 446 个中 149 个内容不同，但**绝大多数 Yamet 行数更多**（Yamet 扩展），Terax 明显更大的只有 10 个，其中 9 个属「Terax 保留多 provider / 云 STT」差异（见第三、四节）。

### 1.2 后端 `src-tauri/src/`（Rust 模块）

| 模块 | Terax | Yamet | 说明 |
|---|---|---|---|
| `agent` `net` `secrets` `workspace` | ✅ | ✅ | 核心 |
| `fs/` `git/` `history/` `lsp/` `proc/` `shell/` `pty/` | ✅ | ✅ | 文件 / git / 历史 / LSP / 进程 / shell / PTY |
| `gateway/` | ❌ | ✅ **Yamet 独有** | IM 网关（dingtalk/feishu/wecom/qq/weixin/official_account 适配器 + 加密 + 平台协议） |
| `ssh/` | ❌ | ✅ **Yamet 独有** | SSH 目标 / PTY 认证 |
| `mcp/` + `mcp_server/` | ❌ | ✅ **Yamet 独有** | MCP client + 反向 MCP server |
| `scheduler/` | ❌ | ✅ **Yamet 独有** | cron 定时自动化 |
| `shell/external_agent.rs` | ❌ | ✅ **Yamet 独有** | 外部编码 agent（Claude Code / OpenCode 等）编排 |

**结论：** 后端共用 47 个文件、31 个内容不同，但 **Terax 无任何比 Yamet 更大（+8 行以上）的后端文件**——即 Yamet 后端是上游的严格超集。上游没有可吸收的后端增量。

---

## 二、依赖清单对比

### 2.1 `package.json`（前端 / JS 依赖）

两版结构、脚本、devDependencies **几乎完全一致**（pnpm + Vite 8 + React 19 + TypeScript 6 + Biome + Vitest + Tauri 2）。唯一实质差异：

| 依赖 | Terax | Yamet | 说明 |
|---|---|---|---|
| `@ai-sdk/anthropic` `@ai-sdk/cerebras` `@ai-sdk/google` `@ai-sdk/groq` `@ai-sdk/openai` `@ai-sdk/xai` | ✅ 6 个 | ❌ 已删 | Yamet 统一走 `@ai-sdk/openai-compatible`（包体积优化，**有意为之，不回退**，即需求文档 T2） |

### 2.2 `src-tauri/Cargo.toml`（Rust 依赖）

- 两者共享同一核心集（tauri 2、portable-pty、reqwest、tokio、grep、nucleo-matcher、keyring、notify、which 等）。
- **Terax 独有的后端依赖：无。** Terax 的依赖是 Yamet 的真子集。
- **Yamet 独有的后端依赖**（全部服务于 IM 网关 / SSH / 加密 / 调度）：
  `tokio-tungstenite`、`aes`、`cbc`、`cfb8`、`hmac`、`sha1`、`md-5`、`rand`、`base64`、`qrcode`、`url`、`hex`、`chrono`，以及 `tokio` 扩展特性（net/time/macros/sync/io-util/fs/process）与 `reqwest` 的 `json` 特性、`tauri-plugin-dialog`。

---

## 三、UI 组件对比

- **基础 UI 原语**（`components/ui/*`）：两版**完全一致**（shadcn + radix 生成，28+ 个原语）。
- **AI 元素**（`components/ai-elements/*`）：一致。
- **Yamet 独有 UI 组件（39 个前端文件）**：
  - 设置页：`settings/sections/GatewaySection.tsx`（IM 网关配置）、`SettingsMcpSection.tsx`（Skills/MCP 统一配置）。
  - 引导与健壮性：`OnboardingDialog.tsx`、`ErrorBoundary.tsx`。
  - SSH：`modules/tabs/SshConnectDialog.tsx`。
  - AI 面板：`AiChatPanel.tsx`、MCP store、memory store、scheduler store、skills/createSkill、externalAgent 等。
- **上游 Terax 独有 UI：无**（仅主题文件命名 `terax-default.ts` vs `yamet-default.ts`）。

---

## 四、值得吸收清单（Terax → Yamet，增强现有功能）

> 前提：Yamet 已是超集，可吸收项非常有限；均为「增强现有能力」而非「新增能力缺失」。

### ✅ 吸收项 1（建议，P2）：云语音转写通道（OpenAI / Groq STT）
- **上游现状**：Terax `ai/lib/stt.ts` 支持 **OpenAI `whisper-1`** 与 **Groq `whisper-large-v3-turbo`** 两条云端 REST 转写通道（带 30s 超时 + `fetchWithTimeout`）。
- **Yamet 现状**：已**删掉云端通道**，仅保留本地 **whisper.cpp**（`transcribeWhisperCpp`，loopback-only、180s 超时）。
- **吸收价值**：保留本地 whisper.cpp（不回退）的同时，恢复 OpenAI / Groq 云端转写，扩大语音输入可用范围。注意复用 Yamet 的 `assertLoopbackUrl` 安全语义——云端通道需走 `apiKeys` 校验而非裸 URL（上游用 `apiKeys.openai` / `apiKeys.groq`，Yamet 已删 provider，需改为兼容 `openai-compatible` 键位或保留独立 groq/openai key 字段）。

### ✅ 吸收项 2（建议，P3）：推理模型 `reasoningEffort` 参数透传
- **上游现状**：Terax `editor/lib/autocomplete/provider.ts` 为 reasoning 模型下发 `providerOptions`（anthropic `effort`、openai/groq/xai/cerebras `reasoningEffort`）。
- **Yamet 现状**：合并到 `openai-compatible` 后，**丢失了推理 effort 调节**。
- **吸收价值**：在 `openai-compatible` 请求上支持 `reasoningEffort` 透传（多数兼容端点接受该字段），恢复对推理模型的成本/质量权衡能力。

### ⚠️ 观察项（不强制吸收）：多 provider 注册表
- Terax `config.ts` 保留 12 个 ProviderId（openai/anthropic/google/xai/cerebras/groq/lmstudio/mlx/ollama…）+ 6 个官方 SDK 包；Yamet 收敛为 `openai-compatible` + `llama.cpp`（**T2 有意为之，不回退**）。不建议整体回退；如需扩展 provider，用 `openai-compatible` 注册即可，不必引入官方包。

---

## 五、Yamet 已有能力——不回退清单（Yamet 独有 / 领先于上游）

以下能力 Terax **完全没有**，是 Yamet 的差异化壁垒，吸收上游增量时**严禁回退或弱化**：

| 能力 | 前端 | 后端 | 说明 |
|---|---|---|---|
| **IM 网关** | `gateway/bridge.ts` + `GatewaySection` | `gateway/`（6 适配器 + 加密 + 平台协议 + 回调隧道） | 钉钉/飞书/企微/QQ/微信/公众号，认证门禁 |
| **SSH** | `SshConnectDialog` + tabs/terminal 集成 | `ssh/`（target.rs） | PTY 认证 + known_hosts |
| **spaces** | `spaces/` | — | 空间切换 / 布局恢复 |
| **block 终端** | `terminal/block/`（ShellInput、BlockOverlay、historyPopover、inlineSuggest、agentActivity…） | `pty/` + `shell/` | 块终端 + 行内建议（上游仅有行内建议雏形，无 block 架构） |
| **agent 编排（外部编码 agent）** | `AiChatPanel`、AgentRunBridge、LocalAgentNotificationsBridge | `shell/external_agent.rs` + `mcp_server/` | 派发 Claude Code / OpenCode 等 + 反向 MCP server |
| **MCP client** | `mcp.ts` / `mcpStore` | `mcp/` | 外部 MCP server 工具接入 |
| **Skills / 记忆增强** | `skills.ts`、`memoryStore` | `agent.rs` 扩展 | create_skill / 记忆工具 |
| **cron 定时自动化** | `schedulerStore` | `scheduler/cron.rs` | 定时投递 |
| **i18n / 双语 UI** | `lib/i18n/` | — | 简中为主 + 英文回退 |
| **健壮性** | `OnboardingDialog` / `ErrorBoundary` | — | 引导 / 崩溃隔离 |

> 后端文件级证据：上游 31 个差异文件中 **0 个**比 Yamet 大；前端 149 个差异文件里 Terax 明显更大的仅 10 个且集中于 provider/STT 差异。即 Yamet 的这些能力在上游不存在，吸收上游时不会触碰。

---

## 六、行动建议

1. **优先吸收云 STT 通道**（吸收项 1）：在保留 whisper.cpp 本地转写的前提下，恢复 OpenAI/Groq 云端转写；键位映射到 `openai-compatible`/保留独立 key 字段，复用安全校验。
2. **次要吸收 reasoningEffort 透传**（吸收项 2）：`openai-compatible` 请求增加推理 effort 参数，找回上游的推理成本控制。
3. **不回退**：IM 网关、SSH、spaces、block 终端、agent 编排、MCP client/server、Skills/记忆、cron、i18n 全部保持并继续增强。
4. **不引入**：Terax 的 6 个 `@ai-sdk/*` provider 包与多 provider 注册表（T2 有意收敛，避免包体积回退）。
5. **工程红线**：从上游吸收任何补丁前，先确认目标文件在 Yamet 已被扩展（多数差异文件 Yamet 行数更多），直接 `git checkout` 上游版本会覆盖 Yamet 独有改动——应逐 patch 迁移而非整文件覆盖。

---

*生成于需求文档第七轮 T1 调研；对比基线 Terax v0.8.6 vs Yamet v0.1.8，2026-08-04。*
