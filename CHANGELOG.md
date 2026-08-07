# 更新日志

Yamet 的所有重要变更都记录于此。版本遵循项目规则：**功能性构建递增版本**（默认递增补丁号），同步四个文件（`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock`）；bug 修复不递增。用 `pnpm version-bump <x.y.z>` 递增。

## [未发布]

### 新增
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
- **第十四轮（0.1.15）** 原生能力深化：终端滚动缓冲区下沉 Rust（新增 `pty/buffer.rs` RollingBuffer 环形 10k 行镜像 + `pty_buffer_lines(id,count,end)` 分页命令 + 前端 `PtySession.bufferLines`，大输出可经后端分页不占前端内存）；文件搜索增量缓存（新增 `fs/index_cache.rs`，按根目录子条目 name+mtime 签名缓存 `(root,query)->hits`，树未变跳过 walk+rank，缺失/变更回退全扫，正确性不依赖缓存）；会话持久化容错（`loadAll` 顶层容错，store 文件整体损坏回退空态防启动崩溃，已有 LazyStore 原子 + hydrateTabs 损坏条目跳过）。
- **第十三轮（0.1.14）** 产品成熟度补强：DAP 适配器缺失检测 + 可复制安装命令引导（多语言 launch.json 模板 node/rust/go）；五面板引导性空状态（dap/mcp/remote/search/gateway 用 EmptyState 组件）；Onboarding 能力引导 + Windows 首启签名提示；coverage 渐进基线 21%（补 6 轮测试，statements 18.76%→21.35%、测试 1020→1240）；命令面板搜索 + 快捷键搜索 + 搜索替换正则；主题扩充 + 导出/导入；工作区最近打开；会话导出/清理 + 容量提示；扩展边界固化 + i18n 扫描门禁 + 平台排障文档。
- **第十二轮（0.1.13）** 测试覆盖率接入：前端 `pnpm test:coverage`（v8 provider，CI 强制 statements ≥ 45% / branches ≥ 35% / functions ≥ 30% / lines ≥ 45%）；新增零测试模块覆盖（mcp store 状态机、dap store 会话/断点/栈帧、source-control remote indicator、gateway pending-meta 状态机）；Rust DAP 真实子进程 fake-adapter 集成测试（grok 思路，不 mock 传输层）。
- **第十二轮（0.1.13）** 漂移清偿 + 防漂移门禁：YAMET.md 修正 dap 命令面（统一为 `dap_session_create/connect/disconnect/list/get` + `dap_request_send`）、补 mcp 命令面与 mcp/search/gateway 模块布局、补启动命令；两篇英文架构文档（dap-protocol/mcp-protocol）汉化；需求汇总补第十/十一轮；ROADMAP 勾选发布自动化与打包体积优化；新建 `scripts/check-doc-drift.mjs`（命令面 / 模块布局 / 原生铁律三查）挂 verify + CI。
- **第十二轮（0.1.13）** i18n parity 恢复：en 补 54 个快捷键键；重新启用 `AssertSameKeys` 编译期类型守卫（zh/en 键集不一致即 `tsc` 报错）。
- **第十二轮（0.1.13）** 原生铁律固化：DAP/MCP/PTY/LSP + Skill/技能沉淀/插件系统必须原生（宿主/传输/UI 层 Rust 原生或 Yamet 自身实现，禁 tmux/vscode-debugadapter/js-debug/Node-Python 常驻桥接/非原生插件运行时）写进 YAMET.md 质量门槛；清理 `adapter.rs` vscode-js-debug 过时注释。
- **第十二轮（0.1.13）** 产品成熟度：硬编码英文 UI 清零（Commit Graph / No repository / No commits yet / Of which cached / Commit staged changes 等 5 处 + 3 处空状态文案走 i18n）；DAP 面板新增「创建示例配置」（一键写 `.yamet/launch.json` debugpy 示例，已存在不覆盖）；首启引导增加「配置 AI 密钥」步骤；空状态审计（dap/mcp/remote/search/gateway 五面板已达标）与静默 catch 审计（29 处均为 best-effort 分支，无需改）。
- **第十一轮（0.1.12）** 原生组件整合（以 0.1.12 为基座叠加 LSP/PTY/DAP/MCP 四大原生组件增强）：DAP 重构为完整 session+transport 模型（stdio/tcp 传输、`dap_session_create/connect/disconnect/list/get` + `dap_request_send`，前端 `modules/dap` 全新 DebugPanel + breakpointGutter 双向同步）；MCP 原生化（stdio/SSE 完整 client + server 生命周期，`mcp_server_add/remove/list/get/connect/disconnect/refresh` + `mcp_tool_call/mcp_resource_read`，前端 `modules/mcp` 全新 store + McpServersGroup）；复用 `lsp/framing.rs` 公共 Content-Length 分帧；设置页新增「集成」标签（IntegrationsSection 统一管理 DAP 适配器 + MCP 服务器）；AI 子系统 MCP 工具迁移到新原生 store（`@/modules/mcp`），删除旧 `modules/debug`/旧 `ai/lib/mcp`/旧 `ai/store/mcpStore`。
- **第十一轮（0.1.12）** SSH 健壮性修复：`SshTarget.identity_file` 接受前端 `identityFile`（camelCase）与后端 `identity_file` 两种 wire 形式（`rename`+`alias`），私钥不再被静默丢弃（原 MUST）；`sftp`/`ssh -N` 后台命令对 host/user 用 `clean_component` 校验，防 `-oProxyCommand=...` 选项注入；含空格/引号的远程路径经 batch 单引号转义；`sftp_read` 先 `ls -la` 预检 4 MiB 上限再下载（避免 OOM）；`sftp -b -` 与后台 `ssh -N` 加 `BatchMode=yes`（无 TTY 下首次连接新主机不挂死）；远程面板去掉恒真隧道 filter。
- **第十一轮（0.1.12）** DAP 调试器（Debug Adapter Protocol）：Rust 后端 modules/dap/（适配器注册表 debugpy/node-inspect/lldb-dap/gdb/dlv、复用 lsp/framing.rs 分帧、请求-响应 id 配对 + 30s 超时、reverse request 分发、孤儿响应转发现前端、fire-and-forget launch 适配 debugpy 延迟响应语义）+ 前端 modules/debug/ 调试面板（程序路径/适配器选择/启动停止/状态指示/单步/调用栈/变量树/Debug 输出），侧栏新增「调试」视图；debugpy 端到端验证通过（断点命中/调用栈/变量）。
- **第十一轮（0.1.12）** DAP 编辑器断点：CodeMirror 行内断点 gutter（红点 + 暂停高亮），编辑器断点 ↔ DAP `setBreakpoints` 双向同步；`.yamet/launch.json` / `launch.json` / `.vscode/launch.json` 配置解析与下拉选择。
- **第十一轮（0.1.12）** 远程面板（侧栏「远程」视图）：SFTP 远程文件浏览（`sftp_list`/`sftp_read`）+ 端口转发隧道管理（`-L`/`-R`，start/list/kill），接线先前仅后端实现的 SSH 后续能力。
- **第十一轮（0.1.12）** 打包体积：debug/remote 面板改为懒加载（移出 eager 启动图），xterm CSS 移入终端模块；total client JS 上限调整为 1550KB 并记录「图标集完整保留为不可减瓶颈」结论（eager 359KB 达标）。
- **第十一轮（0.1.12）** 遥测方向经维护者确认：维持现状（无遥测），与 ROADMAP/README 卖点一致。
- **第十一轮（0.1.12）** PTY Windows ConPTY 健壮性：openpty 5s 超时线程兜底（ConPTY 未初始化不再挂死）；Windows child.wait() 改 try_wait() 轮询（防无限挂起）。
- **第十一轮（0.1.12）** LSP 诊断行偏移（hermes range_shift）：diagnose.ts 新增 buildLineShift（LCS 行映射），写后诊断对比前先把基线行号按编辑 diff 平移，中部插行不再误报假新错误。
- **第十一轮（0.1.12）** PTY helper 判活修正：修复 protocol.rs 缺失 #[test] 导致 roundtrips_output_with_binary_payload 永不运行；非 PID 判活（socket + Auth + Pong 形状校验）已确认。
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
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
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
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
- **第七轮（0.1.8）** 反向 MCP server：`src-tauri/src/modules/mcp_server/`（JSON-RPC 2.0 stdio + 6 只读工具 read_file/list_directory/grep/glob/git_status/git_diff + 路径沙箱 + 1MiB 读取上限 + grep 排除 .git），CLI 入口 `yamet __mcp_server`，外部 agent（Claude Code / OpenCode）经 mcpServers 接入。
- **第七轮（0.1.8）** 跨会话语义检索：`search_memories(query)` 工具（★ H1），匹配历史会话 + 项目记忆，摘要注入上下文，纯函数已测。
- **第七轮（0.1.8）** cron 定时自动化：`src-tauri/src/modules/scheduler/`（★ H3，自实现 5 字段 cron + 30s tick + 持久化），前端 `yamet:scheduler-fire` 监听 spawn agent，设置页定时任务区（增删改/启停/下次触发预览）。
- **第七轮（0.1.8）** skills 自动沉淀：`create_skill(name, prompt, toolAllowlist?, handle?)` 工具（★ H2，走审批），写入 `skills/<name>/skill.json` 并刷新内置列表。
- **第七轮（0.1.8）** 全量测试覆盖提升：补测 sessions/todos/slashCommands/memoryStore/utils，覆盖率 11.76% → 31.65% 语句。

### 新增
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
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
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
- 第四轮迭代：git 分支状态栏徽标、编辑器右键菜单、文件浏览器多选、图片/PDF 文件预览、补全失败反馈 + 自动降级、终端路径补全的 `~` 展开、终端历史持久化到 `~/.yamet/history`、项目记忆写入工具。

## [0.1.4] — 2026-08-03

### 新增
- **第十七轮（0.1.18）** 全量补全：远程 SFTP 编辑回写（sftp_write 后端 + RemoteEditorDialog，闭合审计远程只读缺口）；统一 EmptyState（MCP/网关侧栏引导空态）；迷你窗 P1-a 边缘吸附（snapGeom 距边16px自动吸附）+ 双击最大化/还原 + P1-b 置顶 pin（z-40→z-50）；MCP 添加失败 toast 反馈；DAP 适配器缺失错误 banner；git-history 侧栏入口；会话导出全部（Markdown 下载）+ 清空全部按钮。闭合第十五轮 P1/P2 需求、audit-user-ux/audit-frontend 产品缺陷。1557 前端测试 + cargo clippy 全绿。
- **第十六轮（0.1.17）** 平台抽象层迁移（GUI/WebUI/TUI/CLI 共享核心逻辑）：全量收敛 `@tauri-apps/*` 直接引用到 `@/platform` 统一适配器层（136 处归零，仅 `platform/tauri/` 自身保留）——核心 IPC（invoke/Channel/convertFileSrc + 新增 invokeRaw 支持 PTY raw-body 写）、事件（listen/emit/UnlistenFn）、存储（LazyStore→createStorage，autoSave 语义由 adapter.set 自动 save 保证）、窗口/路径/开盖/os/app/process/dialog/notification/autostart/updater/clipboard 便捷函数，每个未初始化回退 Tauri 原生（测试 mock 生效）。架构：`types.ts` 16 接口 + `tauri/` 16 适配器 + `web/` 实现，`detectPlatform()` 按运行时选适配器。1557 前端测试全绿 + cargo clippy 通过。
- **第十五轮（0.1.16）** AI 聊天窗口补强：主窗口会话历史+新建(SessionBar 顶部栏含+新建+下拉切换/重命名/删除); 主窗口 Todo 展示(AiChatPanel 底部 TodoStrip, 与迷你窗共享 todoStore); Edit/Write 工具完成后可折叠展开查看改动内容(旧/新编辑内容); 迷你窗子 agent 进程视图(ActivityStrip 卡片化显示 subagent 类型/实时 step/summary/耗时); 迷你窗内嵌输入框(AiComposerInput 复用顶层 composer); 会话切换草稿保持(composer 按 sessionId 分键保存/恢复)。
- 第三轮迭代：AI 工具三件套（终端驱动、文件管理、git）、网关可用性（回调地址、白名单持久化、iLink 重新登录二维码）、Rust FS 工作区授权、扩展 shell 拒绝名单、stash / 冲突解决 / 分支管理 / 子模块、编辑器 code action、quick fix、斜杠命令、会话重命名、多选、历史持久化。
