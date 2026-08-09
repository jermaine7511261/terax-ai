# AI 子系统

本指南展开说明 `YaMet.md`。如有冲突，以 `YaMet.md` 为准。

## 概览

AI 子系统是 BYOK（自带密钥）。云端提供商经 `@ai-sdk/*`，本地/离线提供商经 OpenAI 兼容端点。agent 层构建在 Vercel AI SDK v6 聊天语义上：`streamText`、工具定义与 `stopWhen` 步数上限。

主入口：`src/modules/ai/lib/agent.ts` 的 `runAgentStream`。

## 提供商

云端提供商定义在 `src/modules/ai/config.ts`：

- OpenAI、Anthropic、Google、xAI、Cerebras、Groq、DeepSeek、Mistral、OpenRouter
- `openai-compatible`：任意自定义 base URL
- 本地：LM Studio、MLX、Ollama

`src/modules/ai/lib/agent.ts:76` 的 `buildLanguageModel` 按 `provider` 分支构造正确的 AI SDK 提供商实例。本地提供商用带 `localProxyFetch` 的 `createOpenAICompatible`（允许私网访问），云端提供商用各自专属的 SDK 构造器。

模型元数据（上下文上限、成本、推理行为）在 `config.ts` 的模型注册表里。`resolveModel` 把模型 id 映射到其提供商与默认值。

### 新增提供商

1. 在 `src/modules/ai/config.ts` 的 `PROVIDERS` 加 `ProviderInfo` 条目。
2. 在同一个文件的模型注册表加模型 id 与元数据。
3. 在 `buildLanguageModel`（`src/modules/ai/lib/agent.ts:99`）加构造提供商实例的分支。OpenAI 兼容 API 通常可复用 `createOpenAICompatible`。
4. 提供商需要 API 密钥时，更新 `config.ts` 的 `providerNeedsKey` 与 keyring 服务映射。
5. 需要专属 `@ai-sdk/*` 包时，加到 `package.json` 并论证打包成本（见 `CONTRIBUTING.md`）。
6. 新增内置提供商必须论证超出 `openai-compatible` 与 OpenRouter 的独特价值；`CONTRIBUTING.md` 已明确这点。

密钥除 OS 钥匙串 / Linux 密钥文件外绝不持久化。

## Agent 运行循环

`runAgentStream`（`agent.ts:391`）：

1. 经 `buildConfiguredLanguageModel` 解析模型。
2. 由 `selectSystemPrompt(modelId)` 加可选人设、自定义指令与 `YaMet.md` 项目记忆构建稳定系统提示词。
3. 把 UI 消息转成模型消息，模型不保留推理时修剪 reasoning 内容，超上下文上限时压缩旧消息。
4. 用 `buildTools(ctx)` 的工具集与 `stopWhen: stepCountIs(MAX_AGENT_STEPS)` 经 `streamText` 流式输出。
5. 发出步骤标签、用量增量与结束元数据。

工具集在 `src/modules/ai/tools/tools.ts` 由 `fs`、`edit`、`search`、`shell`、`subagent`、`terminal`、`todo` 与 `managedAgent` 构造器组装。

## 子 agent

`src/modules/ai/agents/registry.ts` 定义只读子 agent：`explore`、`code-review`、`security` 与 `general`。每个有工具白名单与各自系统提示词。`run_subagent` 不可递归（子 agent 工具集排除 `run_subagent` 自身）。

## 会话

对话组织成会话。持久化在 `YaMet-ai-sessions.json`，经 `tauri-plugin-store`（`src/modules/ai/lib/sessions.ts`）：

- `sessions` 键：会话元数据列表
- `activeId` 键：活动会话 id
- `messages:<id>` 键：每会话消息，懒加载

`AgentRunBridge` 每次变更把活动会话消息镜像到磁盘，并自动从首条用户消息派生标题。

## Composer

`AiComposerProvider`（`src/modules/ai/lib/composer.tsx`）是 React context，为停靠输入条与任何其他面持有共享输入状态（文本、附件、语音）。附件可为图片、文本文件，或来自终端/编辑器的 `selection` chip。选区在提交时包成 `<selection source="terminal|editor">…</selection>` 块，不粘贴进 textarea。

composer 从 `agentMeta.status` 派生 `isBusy`，可在会话水合前安全挂载。

## 工具与审批

工具定义在 `src/modules/ai/tools/`：

- 只读工具（`read_file`、`list_directory`、`grep`、`glob`）过安全拒绝名单后自动执行。
- 变更工具（`write_file`、`edit`、`multi_edit`、`create_directory`、`bash_run`、`bash_background`）置 `needsApproval: true`。AI SDK 暂停，UI 渲染审批卡。
- `edit` / `multi_edit` 强制先读后改不变量：模型必须在本会话早前读过该文件。
- 计划模式下，变更工具把编辑排队批量评审，而非立即应用。

批准后自动发送用 `lastAssistantMessageIsCompleteWithApprovalResponses`。

## 编辑 diff

AI 提议的文件编辑打开 `ai-diff` 标签。用户逐块接受或拒绝。只有接受后 `write_file` 或 `edit` 工具才真正执行。这让审批 UI 与工具执行解耦。

## 实时上下文桥

`App.tsx` 调 `setLive({ getCwd, getTerminalContext, … })`，让工具读取当前活动终端的 cwd 与末 300 行 buffer。它刻意懒取：工具只在需要时调用，而非每轮预快照。

## 不变量

- 保持 Vercel AI SDK v6 聊天形态（`streamText`、工具、步数上限）；UI 其余部分依赖它。
- 密钥只经 `secrets_*` 命令；绝不着盘、进设置 store 或 `localStorage`。
- 新提供商必须论证打包成本与独特价值。
- 变更工具需要审批；只读工具仍要过拒绝名单。

## 参见

- [`YaMet.md`](../../YaMet.md)：架构事实来源
- [`docs/README.md`](../README.md)：贡献者指南索引
- [双进程模型](two-process-model.md)：IPC 边界与命令目录
- [安全模型](security-model.md)：每条工具都必须遵守的边界
