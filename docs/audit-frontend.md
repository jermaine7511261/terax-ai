# yamet 前端（src/）深度审计报告

> 审计范围：`src/`（app、components、lib、modules、platform、settings）
> 审计性质：只读研究，未修改任何文件。文件:行号 均以当前仓库为准。
> 结论分级：**P0**（阻断核心功能/数据/安全）· **P1**（高影响，明显违反要求/架构）· **P2**（中低，健壮性/一致性/可维护性）

---

## 一、结论摘要

| 级别 | 数量 | 一句话说明 |
|------|------|-----------|
| P0 | 0 | 未发现确定性的 P0（见「结论」章节的边界说明） |
| P1 | 2 | ① AI 界面大面积硬编码英文（zh 为必需主语言）② feature 模块绕过 `@/platform` 直连 `@tauri-apps/*` |
| P2 | 8 | 内联合并竞态、巨型单组件、agent 状态 store 碎片化、cwd 绑定、硬编码命名、脆弱依赖等 |
| Done well | 7 | 见文末 |

---

## 二、P1 — 高影响问题

### P1-1. AI 聊天/迷你窗口界面大面积硬编码英文（违反「zh 必需 + en 兜底」要求）

中文是主语言、英文为兜底，且项目有完整 `zhMessages`。但核心 AI 交互面在**已调用 `useI18n()` 的同文件里**大量直接写死英文字符串，导致中文用户看到英文 UI。证据（均为直接读取确认）：

**`src/modules/ai/components/AiChat.tsx`**
- 【AiChat.tsx:164-165】 `chipLabel()` 返回 `"Editor selection"` / `"Terminal selection"`（上下文芯片标签）
- 【AiChat.tsx:254】 空状态 `description="Explain command output, fix errors, generate snippets, or run a task."`
- 【AiChat.tsx:294】 `{step ?? "Thinking…"}`
- 【AiChat.tsx:302】 继续按钮文案 `"Continue from where you stopped. Don't recap — just keep going."`
- 【AiChat.tsx:309/318】 错误块 `"Request failed."` / `"Dismiss"`
- 【AiChat.tsx:339-340/347】 上下文压缩提示 `"Context compacted — {n} older tool result(s) elided..."` / `"Dismiss"`
- 【AiChat.tsx:361/368】 步数上限 `"Hit the step limit. Continue to keep going."` / `"Continue"`
- 【AiChat.tsx:623】 `{count} file{count===1?"":"s"}`（虽然 `ai.read` 用了 `t()`，但数量后缀是英文）

**`src/modules/ai/components/AiMiniWindow.tsx`**
- 【AiMiniWindow.tsx:65-84】 `SUGGESTIONS` 建议数组全部英文：`"Explain the last error"`、`"Generate a command"`、`"Summarize buffer"` 等
- 【AiMiniWindow.tsx:306/308/316】 `"Plan mode"`、`· ${queueLen} queued`/`"· no edits queued"`、`"Exit"`
- 【AiMiniWindow.tsx:341】 `"Loading sessions…"`
- 【AiMiniWindow.tsx:390】 `{step ?? "Thinking…"}`
- 【AiMiniWindow.tsx:408】 `title={pinned ? "Unpin" : "Pin on top"}`
- 【AiMiniWindow.tsx:493】 `"Last request"` / `"Estimated context"`
- 【AiMiniWindow.tsx:509/515/522/530】 上下文详情 `"Session input"`、`"Session output"`、`"Cache hit"`、`"Session cost"`
- 【AiMiniWindow.tsx:548-549】 页脚 `"Last request reflects current context size; session totals are cumulative."`、`"Token count is approximate (chars / 4)."`
- 【AiMiniWindow.tsx:582/597/662】 `"New chat"`、`"New session"`、`"New chat"`
- 【AiMiniWindow.tsx:699-700】 `dayKey()` 返回 `"Today"` / `"Yesterday"`

**`src/modules/ai/components/AiComposerInput.tsx`**
- 【AiComposerInput.tsx:200-204】 `voiceLabel`：`"Listening…"` / `"Transcribing…"`

**`src/modules/ai/lib/composer.tsx`**
- 【composer.tsx:240】 附件名 `sel.source === "editor" ? "Editor selection" : "Terminal selection"`（与 AiChat.tsx:164 同串重复）

**其它**
- 【SourceControlPanel.tsx】 `"Discard changes?"`（git 丢弃确认，属破坏性操作却未走 `t()`）
- 【App.tsx:1151】 新建工作区命名 `\`Space ${spaces.length + 1}\``

> 处理建议：上述字符串应收敛进 `zhMessages`/`enMessages` 新增键（沿用 `t()`/`tStatic()`），并过一遍 `tsc --noEmit`。因 zh/en 键位奇偶校验门已启用，新增键需两语言同时补齐。

### P1-2. feature 模块绕过 `@/platform` 抽象层，直接 `import "@tauri-apps/*"`

`@/platform`（`src/platform/index.ts:5-9`）明确要求「feature 代码不得直接 import `@tauri-apps/*`」。但发现 2 处直接引用（虽为动态 `import()`，仍破坏抽象、使 web 兜底失效）：

- 【PreviewAddressBar.tsx:312】 `void import("@tauri-apps/api/core").then((m) => m.invoke("toggle_devtools"))` — 绕过 `@/platform` 的 `invoke()`
- 【terminalClipboard.ts:16,30】 `import("@tauri-apps/plugin-clipboard-manager")` 的 `readText`/`writeText` — 而 `@/platform/index.ts:266-273` 已提供 `clipboardReadText()`/`clipboardWriteText()`（含 web 兜底），此处应改用它；否则该模块在 web 平台会抛错

---

## 三、P2 — 中低影响问题

### P2-1. `snippetsStore` 内建技能合并竞态（可能吞掉扫描结果）
【useAiBootstrap.ts:100-114】 同一 effect 里并发调用 `useSnippetsStore.getState().hydrate()` 和 `scanSkillsDir(root)`→`mergeBuiltin()`。`mergeBuiltin()` 直接读 `get().snippets`（snippetsStore.ts:67-77），而 `hydrate()` 是异步的（`Promise.all([loadSnippets, loadDisabledBuiltins])`，snippetsStore.ts:39-50）。若 `scanSkillsDir` 先于 `hydrate` 完成，`mergeBuiltin` 会把 builtin 合并进空列表，随后 `hydrate` 的 `set({ snippets })` 用 `loadSnippets()` 结果**覆盖**，builtin 丢失（直到下次重扫）。`useAiBootstrap` 与设置页都调用二者（snippetsStore.ts:87 注释已承认此重复），竞态窗口真实存在。建议：在 `hydrate` 完成后串行 `mergeBuiltin`，或将扫描纳入 `hydrate` 内部。

### P2-2. `App.tsx` 巨型单组件 + 渲染期直接写 ref
- 【App.tsx:146-1614】 1614 行的单一组件承载 tabs/panes/快捷键/AI/source-control/spaces/侧栏面板/命令面板等全部编排，耦合极高，测试与维护困难（同类逻辑在 `useTabs`/`useSpaces`/`useChatStore` 已拆出，但编排仍集中）。
- 【App.tsx:193-194】 `const tabsRef = useRef(tabs); tabsRef.current = tabs;` — 在渲染期直接改 ref，违反 React 惯例（应在 `useEffect` 或事件回调内更新），并发/StrictMode 下可能拿到不一致快照。属于「能跑但脆弱」的模式。

### P2-3. agent 生命周期状态被四个 store 分散跟踪
`src/modules/agents/store/agentStore.ts`（`useAgentStore.sessions`：叶子 agent 会话/状态/通知）、`src/modules/agents/store/managedAgentsStore.ts`（受管 claude 子 agent 轮次）、`src/modules/ai/store/agentActivityStore.ts`（ActivityStrip 活动流）、`chatStore.agentMeta.status`（主对话 agent 状态）。四者职责有重叠（都在描述"某 agent 正在 running/waiting/done"），状态流转分散在不同模块，出现一致性问题时难定位。建议至少抽公共类型/演进为单一活动事件流。

### P2-4. 侧栏 MCP 面板把「当前工作区 root」当服务器 cwd
【McpSidebarPanel.tsx:92】 `onClick={() => void connect(s.id, root)}`，而 `connect(id, root)` → `mcpServerConnect(id, root, null)`（mcp/lib/store.ts:53-57）。MCP 服务器在设置页是全局配置，但侧栏连接时把**当前激活工作区的 `explorerRoot`** 作为其启动目录；切换工作区后再连接会以错误 cwd 启动 stdio 服务器。建议服务器显式携带其配置时的工作区，或连接时由用户确认 cwd。

### P2-5. `onEditAndResend` 依赖数组 `[helpers]` 过粗（当前安全，属脆弱点）
【AiChatPanel.tsx:43-58】【AiMiniWindow.tsx:228-243】 `useCallback(() => { ...helpers.messages... }, [helpers])`。已核实 `@ai-sdk/react` 的 `useChat`（node_modules/@ai-sdk/react/dist/index.js:262-279）**每次渲染返回新对象**，故当前回调每次渲染都会重建、读到最新 `messages`，**并非 stale**。但 `[helpers]` 只依赖对象身份，一旦未来重构把 `helpers` 用 `useMemo` 固化，此回调即变成 stale-closure（正是任务担心的模式）。建议改为 `[helpers.messages, helpers.setMessages]` 或在回调内经 `useRef` 读最新。

### P2-6. 重复的中英文字符串常量散落多处
`"Editor selection"/"Terminal selection"` 在 AiChat.tsx:164-165 与 composer.tsx:240 重复；`"Thinking…"` 在 AiChat.tsx:294 与 AiMiniWindow.tsx:390 重复。若本地化，应收敛为同一 i18n 键（避免出现"一处已汉化、一处未汉化"）。

### P2-7. 平台剪贴板实现与抽象层职责重复
`terminalClipboard.ts` 自带一套基于 `@tauri-apps/plugin-clipboard-manager` 的实现（见 P1-2），与 `@/platform` 的 `clipboardReadText/WriteText` 重复且无 web 兜底。属「重复实现 + 绕过抽象」双重问题。

### P2-8. 通知/提示中散落的英文（运行时文本）
- 【useAiBootstrap.ts:136-137】 定时任务通知 `title: \`Yamet · ${fired.name}\``、body 截断——走系统通知，非 UI 渲染，但仍是英文。
- 大量 `console.warn`（如 useAiLiveBridge.ts:158、App.tsx:620）为英文——对开发者可见，可接受，不列证据块。

---

## 四、关于 P0 的边界说明

本次只读审计未构建/运行，无法做动态验证。以下原本可疑、经核实后**排除**为 bug 的点，如实记录：
- **API 密钥无明文落 localStorage**：密钥走系统钥匙串（`secrets_get/set/delete`，keyring.ts:22-58），`chatStore.apiKeys` 仅内存态；localStorage 只存非敏感 UI 偏好（侧栏宽度/视图/折叠、bg fast-path、mru、更新检查时间、迷你窗几何）。**此项干净**。
- **agent 初始化竞态**：`useAiBootstrap` 仅在 App.tsx:368 调用一次；`usePreferencesStore.init()` 用模块级 `initPromise` 去重（preferences.ts:15,51-70），各 store 用模块级 `initialized` 防重复 hydrate（agentsStore.ts:26,37-39）。**基本干净**，唯一真实竞态见 P2-1（属内建合并，非核心初始化）。
- **`onEditAndResend` stale-closure**：核实 `useChat` 每次渲染返回新对象，当前无 stale（见 P2-5）。

---

## 五、Done well（做得好的点）

1. **密钥安全**：`secrets_*` 系统钥匙串 + 内存态，无明文密钥落盘（keyring.ts）。
2. **i18n 键位奇偶校验门启用**：`translations.ts:2769-2777` `AssertSameKeys<typeof zhMessages, typeof enMessages>`，zh/en 键集若不一致编译即失败——这是硬约束，很扎实（因此本报告问题集中在「组件内硬编码字符串绕过该门」，而非键缺失）。
3. **AI live 桥用 ref 最新值模式**：`useAiLiveBridge`（useAiLiveBridge.ts:56-57 `ref.current = params`）避免 cwd/终端状态 stale，注释解释清晰。
4. **Composer submit 不 memo**：每次渲染生成新闭包读取最新 `value/files/snippets`，无 stale（composer.tsx:322-469）。
5. **启动包预算锁定**：`app/eager-budget.test.ts` 静态追踪禁止 editor/AI/markdown 进入主/设置窗口 eager 图；重面板（Debug/Remote/MCP/Gateway）在 App.tsx:21-37 全部 `lazy()`。
6. **侧栏 capability 面板真实执行**：DebugPanel（start/continue/step）、RemotePanel、McpSidebarPanel、GatewaySidebarPanel 均调用真实 IPC（connect/start），**非"只描述不执行"占位**。
7. **跨窗口偏好初始化幂等**：`initPromise` 去重（preferences.ts），多窗口安全。

---

## 六、修复优先级建议

1. **P1-1**（i18n）：把上述 ~25 处英文串收敛为 zh/en 键——一次性、影响面大、直接改善中文主用户。
2. **P1-2 + P2-7**（平台抽象）：`terminalClipboard.ts` 改走 `@/platform.clipboard`；`PreviewAddressBar.tsx:312` 改用 `@/platform.invoke("toggle_devtools")`。恢复 web 兜底。
3. **P2-1**（合并竞态）：将 skills 扫描并入 `hydrate` 串行完成，或在 hydrate 后触发 mergeBuiltin。
4. **P2-4**（MCP cwd）、**P2-2**（App 拆分/ref 更新时机）作为迭代轮次处理。
