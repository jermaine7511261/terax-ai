# 更新日志

Yamet 的所有重要变更都记录于此。版本遵循项目规则：**功能性构建递增版本**（默认递增补丁号），同步四个文件（`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）；bug 修复不递增。用 `pnpm version-bump <x.y.z>` 递增。

## [未发布]

### 新增
### 新增
- **第十一轮（0.1.11）** DAP 调试器（Debug Adapter Protocol）：Rust 后端 modules/dap/（适配器注册表 debugpy/node-inspect/lldb-dap/gdb/dlv、复用 lsp/framing.rs 分帧、请求-响应 id 配对 + 30s 超时、reverse request 分发、孤儿响应转发现前端、fire-and-forget launch 适配 debugpy 延迟响应语义）+ 前端 modules/debug/ 调试面板（程序路径/适配器选择/启动停止/状态指示/单步/调用栈/变量树/Debug 输出），侧栏新增「调试」视图；debugpy 端到端验证通过（断点命中/调用栈/变量）。
- **第十一轮（0.1.11）** PTY Windows ConPTY 健壮性：openpty 5s 超时线程兜底（ConPTY 未初始化不再挂死）；Windows child.wait() 改 try_wait() 轮询（防无限挂起）。
- **第十一轮（0.1.11）** LSP 诊断行偏移（hermes range_shift）：diagnose.ts 新增 buildLineShift（LCS 行映射），写后诊断对比前先把基线行号按编辑 diff 平移，中部插行不再误报假新错误。
- **第十一轮（0.1.11）** PTY helper 判活修正：修复 protocol.rs 缺失 #[test] 导致 roundtrips_output_with_binary_payload 永不运行；非 PID 判活（socket + Auth + Pong 形状校验）已确认。
- **第十轮（0.1.11）** 发布自动化：`scripts/release.mjs` 一键发布（CHANGELOG 门禁 → 四文件版本递增 → `[未发布]` 固化 → commit → tag vX.Y.Z）；`verify.ps1` 增加 CHANGELOG `[未发布]` 段非空门禁。
- **第十轮（0.1.11）** PTY helper 进程（进程级会话恢复 I1c）：detached 进程持有 portable-pty 会话，TCP 127.0.0.1 + 随机 token 认证，长度前缀帧协议；每会话环形输出缓冲 + 重连回放；主进程 helper 代理连接（`pty_helper_open/attach/write/resize/close/list`），前端新终端默认走 helper（失败自动降级进程内路径）；`attach` 经 Replay 帧回放既有会话；主进程退出发 Shutdown，helper 孤儿超时（10 分钟无客户端）自动退出。
- **第十轮（0.1.11）** 终端 buffer 快照回放（I1c 轻量路径 / helper 降级层）：空闲终端定期 + 关闭时序列化 buffer 到 `~/.yamet/sessions/<leafId>.snap`，重启激活冷标签时先回放上次会话输出再以原 cwd 新起 shell；前台任务 / TUI（alt-screen）运行中不落快照。
- **第十轮（0.1.11）** AI 工具 LSP 语义诊断反馈：`write_file` / `edit` / `multi_edit` 写后主动通知语言服务器（full-text didSave / didOpen）并拉取诊断，只报本次编辑新增项（编辑前基线 diff，freshness 门控），LSP 不可用时静默降级。
- **第十轮（0.1.11）** LSP 跨文件 workspace edits：F2 重命名 / code action 返回的跨文件 edits 不再静默丢弃，实际写入目标文件并通知服务器。
- **第十轮（0.1.11）** LSP WSL 工作区支持：移除 `lsp_spawn` 的 WSL 拒绝，服务器经 `wsl.exe -d <distro> --cd <root> --` 桥接在发行版内运行；`lsp_resolve_root` 增加 WSL 分支（每级一次 `wsl test -e` 参数化检查，无 shell 注入面）；前端 WSL 工作区可启用 LSP。
- **第十轮（0.1.11）** skill bundle 分享：内置/自建 skill 导出为 skill.json（复制到剪贴板），粘贴导入经校验写入 `skills/<name>.json`（同名拒绝覆盖，导入后自动重扫）。
- **第十轮（0.1.11）** mcp/skill i18n 键组彻底拆分：删除历史遗留 `skillsMcp` 混合键组，skill 键并入 `skills` 组、mcp 键并入 `mcp` 组，两个设置组件引用全部更新。
- **第十轮（0.1.11）** SSH 后续（后端）：SFTP 远程浏览（`sftp` 批命令 `ls -la`/`get`,argv 传参无 shell 注入，`ls` 行解析纯函数已测）；`ssh -N -L/-R` 端口转发隧道（start/list/kill，组件清理校验同 target.rs）。前端浏览面板与隧道 UI 待接线。
- **第十轮（0.1.11）** 终端快照回放标注：前台任务运行中退出时写入 busy 标记，恢复的标签显示「上次会话前台任务未保存」提示。
- **第十轮（0.1.11）** IDE 全项目搜索面板（E1）：侧栏新增「搜索」视图，复用 `fs_grep_interactive` 跨文件全文搜索，按文件分组 + 命中高亮 + 点击跳行；替换输入框支持全部替换（逐文件大小写敏感替换，跳过不可读写文件）。
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
