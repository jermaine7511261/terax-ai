# yamet 编辑器 + AI 子系统源码级调研报告（迭代需求清单）

调研范围（逐文件真实阅读）：
- `src/modules/editor/`（42 文件）：CodeMirror6 栈、autocomplete/(inlineExtension/projectContext/prompt/provider)、EditorPane、vim、externalFormat、eol/indent、theme、useDocument
- `src/modules/ai/`（78 文件）：agent.ts、chatStore/chatRuntime、tools/（tools/fs/edit/search/shell/subagent/externalAgent/terminal/todo/agent/context）、lib/（native/security/prompt/agent/compact/transport/composer/slashCommands/sessions/keyring）、agents/registry+runSubagent、components/（AiComposerInput 等）
- `src/modules/lsp/` + `src-tauri/src/modules/lsp/`：语言服务器（client/sessionManager/presets）
- 交叉验证：`src-tauri/src/modules/fs/file.rs`、`src-tauri/src/modules/workspace.rs`、`src/modules/ai/config.ts`

已忽略 ROADMAP 明示 in-scope 的重型 IDE 类（集成调试器、refactoring engine、IDE 级工作区搜索）。

总体评价：工程成熟度很高——路径安全做了 Windows 语义规范化（`comparisonForm`）、读前校验（read-before-edit）、LRU 聊天缓存、persist 防抖、LSP 会话崩溃退避/内存预算等都很扎实。以下缺口主要是**功能覆盖**与**纵深防御**层面。

---

## P0（高价值 · 建议优先）

### 1. 缺失文件管理工具（delete / move / rename）
- 【证据】`src/modules/ai/tools/fs.ts:20-216` 的 `buildFsTools` 仅暴露 `read_file / list_directory / write_file / create_directory`，没有任何删除/移动/重命名工具（grep 全 `tools/` 目录确认无 `delete_file/move_file/rename_file`）。
- 【现状】Agent 无法删除或重命名文件；要清一个旧文件只能 `bash_run rm`（需用户批准且绕过了路径安全检查，只过 `checkShellCommand` 的 denylist）。
- 【缺口/问题】文件操作能力不完整；Agent 常把"删除 X"退化为 shell 命令，丢失 `checkWritableCanonical` 的安全校验，且方案（plan mode）里无法把删除纳入待审 diff。
- 【迭代建议】新增 `delete_file`、`move_file/rename_file`（`needsApproval:true` + `checkWritableCanonical` + 在 plan mode 下入队到 planStore 供统一审阅），工具描述与系统提示词同步补充。

### 2. Agent 无法直接驱动终端（`injectIntoActivePty` 未被任何工具使用）
- 【证据】`src/modules/ai/tools/context.ts:13` 定义了 `injectIntoActivePty`，`chatRuntime.ts:29` 与 `chatStore.ts:32/166`、`useAiLiveBridge.ts:94` 均接入；但 `tools/` 下没有任何工具调用它。现有终端工具只有 `suggest_command`（terminal.ts:8-30，**仅渲染卡片靠用户点击插入**）、`get_terminal_output`（只读 tail）、`open_preview`（仅 localhost）。
- 【现状】Agent 能读终端、能建议命令，但**无法真的在可见终端里执行命令或向交互进程打字**。
- 【缺口/问题】这是"AI-native 终端"最大的体验断点之一：用户开个 REPL / dev server / npm prompt，Agent 只能隔着屏幕建议，不能接管。
- 【迭代建议】新增 `terminal_execute`（调用 `injectIntoActivePty(text)` 注入并回车，`needsApproval:true`）与可选的 `terminal_type`（注入不回车），并在系统提示词（config.ts:499-530）补充使用时机与"避免注入敏感凭据"的约束。

### 3. 无 Git 工具，但 Rust 已备好全套 git API
- 【证据】`src/modules/ai/tools/` 无任何 git 工具（grep 无 `git_`）；而 `src/modules/ai/lib/native.ts:271-393` 已封装 `gitStatus / gitDiff / gitDiffContent / gitCommit / gitPush / gitLog / gitListBranches` 等完整 IPC。
- 【现状】Agent 想"看看这个分支改了什么 / 提交一下"只能 `bash_run git ...`，拿不到结构化结果，也无法把提交纳入审阅。
- 【缺口/问题】git 是 ADE 的核心工作流，却没有任何 AI 工具；能力已就绪但未暴露。
- 【迭代建议】新增只读 `git_status` / `git_diff`（auto-exec），以及 `git_stage` / `git_commit`（`needsApproval:true`），工具描述强调"提交信息要精简、只提交本次相关文件"。

### 4. 图像附件无模型视觉能力门控
- 【证据】`src/modules/ai/lib/composer.tsx:295-304`（提交图像为 `type:"file"` part）与 `360-383`（`readAttachment` 读图）；而 `src/modules/ai/config.ts:131-143` 的 `ModelTag` 含 `"vision"`，但 `MODELS` 中**只有 mistral 系打了 vision 标签**（config.ts:184/192），默认 `deepseek-v4-flash` 无 vision；`composer.tsx` 全程未读取模型 vision 能力（grep `vision` 于 composer/modelPrefs 无命中）。
- 【现状】用户给默认模型贴图，图片会随消息发出去，但模型不支持视觉——要么报错要么被忽略，且无任何提示。
- 【缺口/问题】多模态输入与模型能力脱节，属明显 UX 缺陷；子代理（`runSubagent.ts`）则完全丢失附件上下文。
- 【迭代建议】发送前用 `model.tags?.includes("vision")` 校验：不支持的模型弹 toast 提示并拦截，或自动切换到已配置的 vision 模型；同时允许把图像/附件上下文透传给子代理。

---

## P1（重要 · 明显增益）

### 5. 安全纵深缺失：Rust FS 层未强制工作区授权
- 【证据】`src-tauri/src/modules/fs/file.rs:128-158` `fs_write_file` 仅 `resolve_path` 后直接 `write_atomic`，**从未调用授权检查**；`src-tauri/src/modules/workspace.rs:33` 的 `is_authorized` 现仅用于 spawn cwd（workspace.rs:75-101）。TS 侧 `security.ts` 的 denylist（secret basename + protected dir + write-deny prefix）是 AI 文件写的**唯一自动化闸门**。
- 【现状】AI 工具把绝对路径原样交给 fs 命令（`resolvePath` 对绝对路径直接透传，context.ts:26）；只要路径不命中 denylist 且用户点了批准，写入可落在任意允许范围外（如用户主目录下的任意非敏感目录）。
- 【缺口/问题】单点失效风险：`security.ts` 若漏一个 basename 模式，整个写路径失去防线。
- 【迭代建议】纵深防御：在 Rust `fs_write_file/fs_create_dir/fs_create_file` 加"解析后路径须处于已授权工作区内"的校验（复用 `WorkspaceRegistry::is_authorized`，AI/explorer 调用自动授权根目录即可），TS denylist 保留为第一道、Rust 授权为第二道。

### 6. `checkShellCommand` denylist 覆盖面有限
- 【证据】`src/modules/ai/lib/security.ts:324-402`：`rm -rf /` 与 `rm -rf ~/$HOME` 被拦（348-370），但 **`rm -rf .` / `rm -rf *` / `rm -rf 子目录`** 不拦；`curl|bash` 模式（394）不含 `sudo bash`；`dd of=/dev/sda`（375）不含 `> /dev/sda`；无 `chmod -R 777 /`、`shutdown`、`git push --force`。
- 【现状】denylist 是"兜底 + 二次校验"，主闸门是用户批准 UI。
- 【缺口/问题】对"批准后仍明显越界"的典型破坏性命令覆盖不全；这是设计取舍（白名单才稳），但当前黑名单容易给用户一种"已被防护"的错觉。
- 【迭代建议】补齐高频破坏性模式（`rm -rf .`、`curl|sudo bash`、`> /dev/*`、`chmod -R` 至根、`git push --force` 到受保护分支）；长远可在系统提示词中把 denylist 意图传达给模型以源头规避。

### 7. 内联补全：单候选、无 Tab 循环、上下文仅限同目录
- 【证据】`src/modules/editor/lib/autocomplete/inlineExtension.ts`：`suggestionField`（41-54）只存**一个** `Suggestion`；接受动作仅 `acceptSuggestion`/`acceptWord`（588-636），无多候选循环。`projectContext.ts:26-27`：`MAX_SIBLINGS=4`、`MAX_SIBLING_CHARS=1200`，只取同目录兄弟文件；无 import 关系、无最近编辑文件、无符号索引。
- 【现状】补全质量依赖纯 FIM + 少量同目录片段，遇到跨文件类型/符号时上下文不足。
- 【缺口/问题】单候选导致"Tab 只有一条路"，命中率敏感；上下文太浅，跨文件命名/类型一致性问题多。
- 【迭代建议】① 支持多候选（每键返回 N 个，`Alt-]`/`Tab` 循环）；② 扩展 projectContext：按当前文件 import 关系取被引文件头、或把"最近编辑的 N 个文件"纳入提示（轻量、不需索引）。

### 8. 编辑器缺少代码操作/快速修复
- 【证据】`src/modules/lsp/lib/client.ts:345-391` 的 `lspInteractions` keymap 只有 F12（定义）/Shift-F12（引用）/F2（改名）/Shift-Alt-f（格式化）；`src/modules/lsp/lib/diagnosticsStore.ts` 只统计 error/warning 计数；`codemirror-languageserver` 的 lint 诊断已接入，但未暴露 `textDocument/codeAction` / `executeCommand`。
- 【现状】诊断只能看，不能一键修（如 pyright "import 未使用"、TS "x is declared but never used"）。
- 【缺口/问题】quick-fix 是轻量非重型功能，ROADMAP 排除的是 refactoring engine，不是快速修复；缺失导致 lint 体验只到"报错"为止。
- 【迭代建议】在诊断 tooltip/lint 面板加 "Quick fix" 入口，调用 `textDocument/codeAction` + `executeCommand`，先覆盖单一 code-action 场景。

### 9. lint gutter 被隐藏
- 【证据】`src/modules/editor/lib/extensions.ts:56-58`：`.cm-gutter-lint { width: 0px }`。
- 【现状】诊断标记在行号栏被压成 0 宽，只有 count/面板可见；`codemirror-languageserver` 的 lint 波浪线装饰仍在内容区。
- 【缺口/问题】错误无法在行号栏一眼定位，可用性偏低。
- 【迭代建议】给 lint gutter 一个固定宽度并换行显示，或移除该规则让内置 lint gutter 生效。

### 10. 子代理只读，缺少可写/执行子代理
- 【证据】`src/modules/ai/agents/registry.ts:16-50`：四种 subagent 的 `tools` 全部等于 `READ_ONLY_TOOLS`（read_file/list_directory/grep/glob），`runSubagent.ts:44-51` 据此过滤工具集。
- 【现状】Agent 只能派"只读调查"子代理；并行做多文件修改无法委托（会污染主上下文）。
- 【缺口/问题】长任务/大范围改动时主 agent 上下文快速膨胀，缺一个"隔离执行"的编码子代理。
- 【迭代建议】新增 `code` / `executor` 子代理类型（工具集含 edit/multi_edit/write_file + bash_run，仍需批准），或把工具集改为可扩展并在系统提示词说明其边界。

---

## P2（可选 · 打磨）

### 11. 无 apply_patch / diff 编辑工具
- 【证据】`src/modules/ai/tools/edit.ts` 只有 `edit`/`multi_edit`（精确字符串替换，122-187），无 unified diff 应用。
- 【现状】大范围/多 hunk 改动要求模型逐字复现 `old_string`，跨行重排时易失败。
- 【迭代建议】增加 `apply_patch`（模型给 unified diff，Rust/TS 端解析校验后应用，plan mode 入队），作为 `multi_edit` 的鲁棒补充。

### 12. 项目记忆仅静态 YAMET.md，无会话内/跨会话记忆累积
- 【证据】`src/modules/ai/lib/transport.ts:13-34`：仅读取工作区根 `YAMET.md`（30s 缓存、32KB 截断），`buildStableSystem`（agent.ts:243-246）注入；无任何"本次会话学到的事实/长时记忆/scratchpad"。
- 【现状】会话内靠完整消息历史 + compact 截断；跨会话靠静态 YAMET.md。
- 【迭代建议】可选：会话结束/compact 时让 Agent 产出记忆摘要写入（每项目）记忆文件，下轮注入；或提供 `agent_memory` 读写工具（限 YAMET.md/记忆目录）。

### 13. ROADMAP 与实现不一致（技术债）
- 【证据】`ROADMAP.md:141` 将 "Full language-server integration" 列为 out of scope；但 `src/modules/lsp/` 已实现完整 LSP 客户端（diagnostics/hover/go-to-def/rename/format + 19 个服务器预设），`ROADMAP.md:107` 同时把 "AI autocomplete improvements" 标为已发货。
- 【现状】文档与代码脱节，会误导 contributor 判断。
- 【迭代建议】更新 ROADMAP：把 LSP 移入 Shipped，并注明"重型 IDE 能力（debugger、refactoring engine、IDE 级搜索）仍在 out of scope"。

### 14. `modelCache` 无清理 + compact 用字节/4 粗估
- 【证据】`src/modules/ai/lib/agent.ts:72` `const modelCache = new Map<string,LanguageModel>()`，只增不清（key 含 key，换 key 会产生新条目）；`src/modules/ai/lib/compact.ts:159` `approxTokens = approxBytes/4` 粗估。
- 【现状】长会话多模型切换时 cache 可能累积旧 key；compact 阈值对 tokenizer 差异大的模型估算偏差大。
- 【迭代建议】给 modelCache 加 LRU/上限；compact 时对已知模型用更接近真实的 token 估算（或配置化）。

### 15. 补全无回退/失败反馈
- 【证据】`src/modules/editor/lib/autocomplete/inlineExtension.ts:407-414`：请求失败静默 return，无任何 UI 提示（如网络错误、provider 无 key）。
- 【现状】用户按自动补全看不到任何反馈，无法区分"没有补全"与"补全坏了"。
- 【迭代建议】首次失败（非 abort）在状态栏/ghost 处给一次性轻提示（如 provider 错误原因），避免反复无响应。

---

## 附：调研中确认"已做好、无需动"的点
- 路径安全 `security.ts` 对 Windows 语义（ADS `:stream`、尾点空格、drive 前缀、大小写）处理极到位（150-179）。
- 读前编辑不变式 + 缓存去重（fs.ts:58-64、edit.ts:139-145）。
- persist 防抖 + LRU 聊天缓存（chatStore.ts:174-217）避免流式写盘卡顿。
- LSP 会话生命周期（sessionManager.ts）：崩溃退避、内存预算、idle 关闭、每 preset 会话上限都很完善。
- 外部格式化最小变更派发（externalFormat.ts:158-177）保持光标。
