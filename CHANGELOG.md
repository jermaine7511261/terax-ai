# 更新日志

Yamet 的所有重要变更都记录于此。版本遵循项目规则：**功能性构建递增版本**（默认递增补丁号），同步四个文件（`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）；bug 修复不递增。用 `pnpm version-bump <x.y.z>` 递增。

## [未发布]

### 新增
- **第九轮（0.1.10）** 右下角 AgentSwitcher 合并 agent + model 选择器：输入框旁和底部状态栏的模型/agent 选项卡移除，右下角一个下拉同时切换 agent 和 model。
- **第九轮（0.1.10）** 设置页"技能"与"MCP"拆分为独立标签（SkillsSection + McpSection）。
- **第九轮（0.1.10）** 工作区配置持久化：用户选择的工作区根目录经 localStorage 持久化，配置到其它盘后重启不再回退到默认 C 盘用户目录。
- **第九轮（0.1.10）** 自动批准移到批准弹窗：批准框"记住"下拉新增"自动批准此工具"选项，移除对话页顶部的自动批准开关。

### 修复
- **第九轮（0.1.10）** 工作区换盘无效（home 用 useState 不持久化，重启回 C 盘）。



### 新增
- **第九轮（0.1.10）** 汉化收官：34 处显示文本 + 57 处属性硬编码英文全部走 i18n（仅剩白名单：shadcn 原语 / 品牌名 / 示例值 / 协议名）；新增 common.block / gateway.relogin / ai.emptyOutput / ai.resumeTurn / ai.editMessage / git.binary 等键（zh/en 双语）。
- **第九轮（0.1.10）** 锁中毒自愈：152 处 Mutex/RwLock `.unwrap()/.expect()`（含 read/write 与多行形态）改为 `.unwrap_or_else(|e| e.into_inner())`；新增 `src-tauri/tests/lock_poison.rs` 自愈单测；`scripts/verify.ps1` 加 lock poison 门禁。
- **第九轮（0.1.10）** 后台进程树杀：`bash_bg_*` kill 杀整棵进程树（Windows Job Object + Unix 进程组 `process_group(0)`）；补 Unix 组杀测试与 `tests/shell_background_windows.rs`。
- **第九轮（0.1.10）** 崩溃恢复：会话记录 incompleteTurn 标记，流式回合中断后重启，AI 面板显示「继续」入口一键续接。
- **第九轮（0.1.10）** 消息编辑/重做：末轮用户消息可编辑，保存后截断尾部并重发。
- **第九轮（0.1.10）** WeixinReloginOverlay 组件测试：QR 渲染 / scanned 状态 / confirmed 持久化 / 非微信忽略四分支。
- **第八轮（0.1.9）** 微信会话自动重连：会话过期后自动推送重登 QR 到前端（不再暂停 10 分钟），扫码确认后自动更新 token 恢复 poll。
- **第八轮（0.1.9）** 网关限流后置：已授权会话消息不再被限流丢弃（DM auto-trust + 手动批准会话突发消息全送达）。
- **第八轮（0.1.9）** 微信/QQ/Wecom 媒体下载：adapter 轮询循环自动下载图片/文件到 `~/.yamet/media/`，填充 `local_path` 给 agent 使用。
- **第八轮（0.1.9）** 主界面重登 QR 浮层：`WeixinReloginOverlay` 全局监听 `gateway-platform-event`，会话过期自动弹非阻塞浮层。
- **第八轮（0.1.9）** 模型选择器默认过滤无 key 模型：「全部」tab 默认只显示有 API key 的模型，provider 侧栏加"显示未配置"切换。
- **第八轮（0.1.9）** 汉化补全：33 个中文翻译键（ai/explorer/editor/source-control/preview 等）。
- **第八轮（0.1.9）** 自动更新端点配置：`tauri.conf.json` updater.endpoints 填入 GitHub Releases 模板（用户配仓库后替换）。

### 修复
- **第八轮（0.1.9）** P3 授权恢复核查：确认 `set_persist_path` 已内含 `load_from` 恢复，无需改动（审查修正）。

### 文档
- **第八轮（0.1.9）** ROADMAP 测试覆盖扩展已勾选。

### 新增
- **第七轮（0.1.8）** 反向 MCP server：`src-tauri/src/modules/mcp_server/`（JSON-RPC 2.0 stdio + 6 只读工具 read_file/list_directory/grep/glob/git_status/git_diff + 路径沙箱 + 1MiB 读取上限 + grep 排除 .git），CLI 入口 `yamet __mcp_server`，外部 agent（Claude Code / OpenCode）经 mcpServers 接入。
- **第七轮（0.1.8）** 跨会话语义检索：`search_memories(query)` 工具（★ H1），匹配历史会话 + 项目记忆，摘要注入上下文，纯函数已测。
- **第七轮（0.1.8）** cron 定时自动化：`src-tauri/src/modules/scheduler/`（★ H3，自实现 5 字段 cron + 30s tick + 持久化），前端 `yamet:scheduler-fire` 监听 spawn agent，设置页定时任务区（增删改/启停/下次触发预览）。
- **第七轮（0.1.8）** skills 自动沉淀：`create_skill(name, prompt, toolAllowlist?, handle?)` 工具（★ H2，走审批），写入 `skills/<name>/skill.json` 并刷新内置列表。
- **第七轮（0.1.8）** 全量测试覆盖提升：补测 sessions/todos/slashCommands/memoryStore/utils，覆盖率 11.76% → 31.65% 语句。

### 新增
- **第六轮（0.1.7）** MCP client：`src-tauri/src/modules/mcp/`（stdio / HTTP 传输 + JSON-RPC 2.0 + 断线重连 + 并发上限 + stderr 环形尾），5 个命令注册；前端动态工具注册（全部 `needsApproval: true` + `redactSensitive` 脱敏 + 工具卡 `mcp · <server>` 来源分支）。
- **第六轮（0.1.7）** Skill 升级：snippet 支持 `toolAllowlist`（技能限定工具回合，`filterTools` 纯函数）、内置 `skills/` 目录约定（`scanSkillsDir` 启动扫描，builtin 可禁用）、设置页工具白名单多选。
- **第六轮（0.1.7）** 记忆增强：`ProjectMemoryEntry.source` 来源分组（tool/auto）、`list_project_memory` / `delete_project_memory` 工具、系统提示尾 nudge、设置页项目记忆浏览/编辑区块。
- **第六轮（0.1.7）** 设置页新增「技能与 MCP」标签（`skillsMcp` 键组，zh/en），MCP 服务器增删改 + 连接/断开 + 工具数展示。
- AI 工具 `update_project_memory`：两级项目记忆（会话内 store + YAMET.md 落盘），完成 P2-9 写路径。
- `scripts/version-bump.mjs`：同步四个文件的版本号（四处同步）。
- `scripts/verify.ps1`：一次性前后端验证门禁（`pnpm verify`：check-types、lint、测试、size、cargo check+test、tauri build）。
- `modelCache` LRU 上限（24），避免长会话累积模型实例。
- 终端粘贴大于 32KiB 时改为分块写入，保持 UI 线程响应。
- 网关连接重入守卫（每平台不产生重复入站循环）。
- 钉钉 / 飞书出站调用复用共享 HTTP client。
- 主题导入遇到 id 冲突时明确提示，而非静默覆盖。
- 图片/PDF 文件预览支持缩放。
- LSP code action（客户端能力声明 + `textDocument/codeAction`）。
- git stash 管理（`git_stash_save/list/pop/apply/drop`）。
- git 冲突解决（`git_merge_abort`，`--ours`/`--theirs` checkout）。
- git 分支管理（创建/删除/重命名），无上游分支的 `push --set-upstream`，pull 策略（`--ff-only` / `--rebase` / `--no-rebase`）。
- git 子模块 status/update 命令。
- AI 工具 `apply_patch`：多文件 unified diff，原子化逐块应用。
- 审批决定可被记住（本会话 / 本项目），以及按工具的拒绝黑名单。
- 会话重命名 UI（会话选择器中的行内重命名）。
- 斜杠命令 `/review`、`/commit`、`/test`、`/fix`（send-prompt 配方）。
- 工作区「打开文件夹」入口：命令面板选目录，授权后将工作区重置到该目录。
- AI 会话历史面板：完整会话列表，支持搜索、按天分组、行内重命名与删除。

### 变更
- **第六轮（0.1.7）** 设置页片段编辑器从「智能体」区迁至「技能与 MCP」区（agents 卡片保留在智能体区）；`TOOL_REGISTRY` 抽为轻量模块，设置窗口不再急切拉取 AI 工具栈。
- 移除 6 个未使用的 `@ai-sdk/{anthropic,cerebras,google,groq,openai,xai}` 依赖（knip 确认为死依赖，应用只使用 `@ai-sdk/openai-compatible`）。

## [0.1.5] — 2026-08-04

### 新增
- 第四轮迭代：git 分支状态栏徽标、编辑器右键菜单、文件浏览器多选、图片/PDF 文件预览、补全失败反馈 + 自动降级、终端路径补全的 `~` 展开、终端历史持久化到 `~/.yamet/history`、项目记忆写入工具。

## [0.1.4] — 2026-08-03

### 新增
- 第三轮迭代：AI 工具三件套（终端驱动、文件管理、git）、网关可用性（回调地址、白名单持久化、iLink 重新登录二维码）、Rust FS 工作区授权、扩展 shell 拒绝名单、stash / 冲突解决 / 分支管理 / 子模块、编辑器 code action、quick fix、斜杠命令、会话重命名、多选、历史持久化。
