# YaMet.md

YaMet 从工作区根目录加载 `YaMet.md` 作为 agent 记忆（类似 AGENTS.md / CLAUDE.md）。本文件同时也是项目的活架构文档：改动前先读它。

## 项目

**YaMet**：开源 AI 原生终端模拟器。Tauri 2 + Rust（`portable-pty`）后端，React 19 + TypeScript + xterm.js（webgl）客户端，BYOK AI 走 Vercel AI SDK v6。

- Bundle id：`app.yamet.YaMet`
- 包管理器：**pnpm**
- 平台：macOS、Linux、Windows
- 前端检查：`pnpm lint`、`pnpm check-types`、`pnpm test`
- Rust 检查：`cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`、`cd src-tauri && cargo nextest run --locked`（本地回退：`cargo test --locked`）

## 质量门槛

达到生产级才算完成，否则不发版。每个改动都要对照以下全部标准，而非只看"能跑"：

- **正确性**：边界情况、失败模式、并发访问。不接受"现在能用就行"。
- **性能**：超轻量就是产品本身。约 7-8 MB 的包体、高性能终端。每个改动都要问：耗多少内存、是否增加 IPC 往返或冗余请求、是否触发多余重渲染或浪费、是否引入重型依赖。未使用的功能不占任何资源。
- **安全**：无重大安全漏洞。在每个边界（IPC、fs、网络、AI 工具面）都做校验。密钥路径拒绝名单在读写两侧都生效，绝不能被绕过。
- **UI/UX**：精致、专业、有质感。每个状态与细节都考虑到位。
- **架构**：新增或变更的逻辑放在纯函数、少依赖的函数里（函数式核心）；tauri 命令与 React 组件保持薄壳（命令式外壳）。这样无需后续重写即可测试。

交付前必须验证：

- 前端：`pnpm lint`、`pnpm check-types`、`pnpm test`
- Rust：`cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`、`cd src-tauri && cargo nextest run --locked`（或 `cargo test --locked`）

核心子系统（终端/shell 启动、工作区认证、git、fs、IPC 或 AI 工具面）的改动需要一条锁定不变量的测试。

**原生铁律（维护者硬约束）**：DAP / MCP / PTY / LSP 的宿主/传输/UI 层必须 Rust 原生（PTY = `portable-pty` + 原生 helper；LSP/DAP = 复用 `lsp/framing.rs` 分帧 + 原生子进程宿主；MCP = Rust client/server + 前端原生 store）；Skill、技能沉淀、插件系统同样必须原生（`create_skill` 工具 + `skills/` 目录约定为 YaMet 自身实现，写盘走 Rust fs + 安全拒绝名单）。禁止 tmux、`vscode-debugadapter`/`js-debug`、Node/Python 常驻桥接、VSCode 式扩展宿主、非原生插件运行时。适配器/语言服务器二进制（debugpy/node/lldb-dap/gdb/dlv）是 DAP/LSP 协议固有设计，不违背。**扩展边界（插件系统）**：插件系统当前不在范围内（`ROADMAP.md`「范围外」）。一旦实现，只做**窄范围 AI 工具/片段 bundle**（`skills/` 目录约定 + JSON 配置 + 工具白名单，原生解析），UI/行为扩展必须走 Rust 原生 ABI + 前端原生 store。禁止 VSCode 式扩展宿主、禁止 Node/Python 插件运行时。技能沉淀（agent 长任务后 `create_skill` 固化可复用流程）为 YaMet 自身实现（前端原生 + Rust fs），无外部技能市场。

`scripts/check-doc-drift.mjs`（`pnpm check-drift`）在 CI 强制：命令面 / 模块布局 / 原生铁律三件事。

## 约定

- **注释**：默认不写，代码应自解释。确有必要时写 1-2 行"为什么"，绝不写"是什么"。不要 AI 通用废话。
- **禁 em-dash**：代码、注释、提交、文档任何地方都不用。
- **禁 emoji**：任何地方都不用。
- **导入**：前端一律 `@/...`，跨模块绝不使用相对路径。
- **只用 pnpm**，绝不使用 npm/npx/yarn。

## 架构

### 双进程模型

**Rust（`src-tauri/`）持有全部 OS 访问**。webview 绝不直接碰 fs、进程或 shell，一切经 `invoke()` 调用注册在 `src-tauri/src/lib.rs` 的命令：

- `pty::pty_*`：长生命周期交互式 PTY 会话（xterm ↔ portable-pty），由 `PtyState`（`RwLock<HashMap<id, Session>>`）管理。输出经 Tauri `Channel<PtyEvent>` 流式推送。每会话经 `pty/buffer.rs`（RollingBuffer）镜像滚动缓冲，`pty_buffer_lines(id,count,end)` 分页查询——大输出可从后端懒加载，不占前端内存。
- `fs::tree::*`（`fs_read_dir`、`list_subdirs`）、`fs::file::*`（`fs_read_file`、`fs_write_file`、`fs_stat`、`fs_canonicalize`）、`fs::mutate::*`（`fs_create_file`、`fs_create_dir`、`fs_rename`、`fs_delete`）：文件浏览器 + 编辑器 IO。**Office 套件**由 `fs::document::*` 纯 Rust 提供（office_oxide / pdf_oxide / lopdf / quick_xml / calamine / rust_xlsxwriter，零外部二进制）：`fs_read_file` 仅在 **AI 读路径**（`source=="ai"`）按 magic/扩展名提取文本——OOXML（DOCX/XLSX/PPTX）+ 旧二进制（DOC/XLS/PPT，经 OLE2/CFB 魔数嗅探）由 office_oxide 解析、PDF 由 pdf_oxide（整档 ≤50MB、总输出 ≤8MB）；编辑器/资源管理器路径仍视为 binary（保住 PDF iframe 预览，保存不会用文本覆盖二进制文档）。创建（富格式）：`fs_create_docx`（markdown→Word，含 styles/numbering）、`fs_create_xlsx`（数字/公式/粗体表头）、`fs_create_pptx`（标题/项目符号/文本框）、`fs_create_pdf`（lopdf 文本渲染 A4，`Td` 按行独立 `BT…ET` 绝对定位）；编辑（就地保真写回，未改动 part 逐字节保留）：`fs_edit_docx`/`fs_edit_pptx`（`replace_text`）、`fs_edit_xlsx`（`set_cell` 保留样式）；另有 `fs_pdf_merge`/`fs_pdf_encrypt`（AES-256）/`fs_pdf_page_count`。AI 写路径同受 workspace 授权 + 密钥拒绝名单门禁（原子写）。前端工具（全部需审批）：`create_docx`/`create_xlsx`/`create_pptx`/`create_pdf`/`edit_docx`/`edit_xlsx`/`edit_pptx`/`merge_pdf`/`encrypt_pdf`。
- `fs::search::*`（`fs_search`、`fs_list_files`）、`fs::grep::*`（`fs_grep`、`fs_glob`）：模糊文件查找 + 内容搜索（基于 `ignore` + `grep-*` crate）。`fs_search` 经 `fs/index_cache.rs` 增量缓存（按根目录子条目 name+mtime 签名缓存 `(root,query)->hits`，树未变跳过 walk+rank，缺失/变更回退全扫，正确性不依赖缓存）。
- `git::commands::*`：完整源码控制面（`git_status`、`git_diff`、`git_diff_content`、`git_stage`、`git_unstage`、`git_discard`、`git_commit`、`git_fetch`、`git_pull_ff_only`、`git_push`、`git_log`、`git_show_commit`、`git_commit_files`、`git_commit_file_diff`、`git_panel_snapshot`、`git_resolve_repo`、`git_remote_url`）。全部经工作区授权注册表门控。
- `shell::shell_run_command`：一次性子 shell 执行，供 AI 工具使用。不同于 PTY 会话，不是用户的交互终端。Windows 用 PowerShell（`-NoProfile -Command`），Unix 用 `$SHELL -lc`。共享助手 `build_oneshot_command`。
- `shell::shell_session_*`：跨调用保留状态的持久 agent shell。`shell::shell_bg_*`（`spawn`、`logs`、`kill`、`list`）：长运行后台进程（开发服务器等），带有限环形缓冲日志捕获。
- `workspace::*`：`workspace_authorize` / `workspace_current_dir`（spawn/git/AI 的 cwd 授权注册表）以及 WSL 桥（`wsl_list_distros`、`wsl_home`）。
- `lsp::*`（`lsp_detect`、`lsp_host_pid`、`lsp_resolve_root`、`lsp_spawn`、`lsp_send`、`lsp_kill`）：语言服务器进程宿主。哑 JSON-RPC 管道：Rust 侧做 Content-Length 帧协议 + 进程生命周期（`lsp/framing.rs`，纯函数 + 已测试），协议智能在前端。spawn 的 cwd 经工作区注册表门控；二进制经捕获的登录 shell 环境解析（`lsp/env.rs`，macOS GUI 应用是裸 PATH）；根目录发现向上找标记，但绝不越过 `$HOME`。Unix 下服务器在自己进程组运行并组杀（cargo check / proc-macro 子进程随服务器死）；Windows 子进程用 `proc::job::ProcessJob`（kill-on-close，与 pty 共用）。`RunEvent::Exit` 时杀全部会话。
- `dap::*`（`dap_session_create`、`dap_session_connect`、`dap_session_disconnect`、`dap_session_list`、`dap_session_get`、`dap_request_send`）：调试适配器进程宿主（Debug Adapter Protocol），原生 session+transport 模型（stdio/TCP）。与 LSP 同构：复用 `lsp/framing.rs` 的 Content-Length 帧 + 子进程模式；`DapSession` 做请求-响应 id 配对（30s 超时）、reverse request 分发、孤儿响应转发现前端、stderr tail。适配器注册表 `dap/adapter.rs`（debugpy/node-inspect/lldb-dap/gdb/dlv，按扩展名 + root marker 选择；适配器为协议固有的外部二进制，宿主/传输/UI 层全原生）。`launch` 用 fire-and-forget（debugpy 等延迟到 `configurationDone` 才回响应，阻塞会死锁），前端在 `initialized` 事件后发 `configurationDone`。`RunEvent::Exit` 时杀全部调试会话。
- `net::*`（`ai_http_request`、`ai_http_stream`、`lm_ping`）：带 SSRF 守卫的 AI HTTP 代理；把提供商调用与本地模型 ping 移出 webview。
- `net::web_search::*`（`web_search`，P1.5）：免 key DuckDuckGo HTML 搜索下沉 Rust。`uddg` 追踪链接还原真实 URL、anomaly/captcha「假成功」检测（200 + 空结果的挑战壳显式报错而非空数组）、词汇级重排（junk 黑名单 + 查询词覆盖 + registrable-domain 去重，junk 永不通过降级泄漏）、类型化失败分类（auth/quota/rate_limit/timeout/network/server/parse + 429 Retry-After）。`SearchProvider` trait + registry 为 key 化源（Exa/Brave/Parallel 经 MCP `tools/call`）预留。
- `cli::*`（迭代 25 补齐，`modules/cli.rs`）：**CLI agent 前端**——`YaMet --prompt "..."` print-mode 单次对话出口，复用 `ai::client`（SSRF 守卫）直连 OpenAI-compatible + keyring 取 key，stdout 流式输出；支持 `--model`/`--base-url`/`--keyring-account`/`--allow-private`/`--reasoning-effort` + `YAMET_API_KEY`/`YAMET_BASE_URL`/`YAMET_MODEL` env 回退；在 Tauri 运行时之前执行（对齐 `__mcp_server`/`--pty-helper`）。
- **WebUI（迭代 25 补齐，`src/platform/web/` + `scripts/dev-web.mjs`）**：`pnpm dev:web` 拉起 vite（:1420）+ Node 后端 WS（:127.0.0.1:31219）。**安全门**（MUST）：服务端绑定回环 + Origin 白名单 + 每帧 token（`dev-web.mjs` 注入 `VITE_WS_TOKEN`）；fs 路径包含性校验 + 敏感文件门 + 大小上限；`shell_run_command` cwd 约束 + 进程树杀；写面运行时限（git 写 / shell_bg / pty 拒）。后端命令域：`workspace_current_dir`/`workspace_authorize`、`fs_read_file`/`fs_write_file`/`fs_read_dir`/`fs_grep`/`fs_canonicalize`/`fs_create_dir`/`fs_delete`/`fs_rename`、`shell_run_command`、**git 只读**（`git_resolve_repo`/`git_status`/`git_log`/`git_diff`/`git_diff_content`/`git_list_branches`）、**history**（`history_record`/`history_list`/`history_suggest`）。`main.tsx` web 模式引导安全（window.show 经适配器、pty_close_all 静默降级）。`smoke.test.ts` 锁定命令面 + 安全门（18 测试）。
- `computer::*`（迭代 25 P3，`modules/computer/`）：计算机使用（computer use）。Windows M1 截屏（BitBlt → PNG data-URI，`MAX_CAPTURE_PIXELS=1.5M` 缩放）、M2 输入注入（`SendInput` 落点；needsApproval 门禁 + 敏感区黑名单（右上系统状态区拒绝）+ `MAX_ACTIONS_PER_SESSION=50` 动作预算）、视觉回环 fail-closed（主模型无视觉必走 aux vision）。命令面 `computer_session_open/close`、`computer_approve/revoke`、`computer_capture`、`computer_action`。`safety.rs` 纯函数已测；平台代码 `#[cfg(windows)]` 分文件（对齐 ssh/pty 模式）。
- `ai::*`（迭代 25 原生内置，`modules/ai/`）：**原生 AI harness**——LLM 调用下沉 Rust（`client` 直连 OpenAI-compatible `/chat/completions`，走 `net` 同一 SSRF 守卫，SSE 解码纯函数）、token 估算 + 压缩（`context`：`ai_estimate_tokens`/`ai_estimate_messages`，bytes/4 + 图片固定 2000；`compact` 纯函数核心复现前端 `compact.test.ts` 契约，头尾保护 + 永不切 toolResult）、会话状态机 + 事件流 + 命令面（`harness`：`ai_session_open/close/abort/status/send`，仿 `PtyState` 的 `AiSessionState`；`loop` 下沉 `should_exit_loop`/doom-loop 判定矩阵）、分节 prompt + 注入安全（`prompt`：`wrap_untrusted` + defang + `neutralize_reminder_tags` + `scrub_memory_echo`，纯函数 + 注入逃逸测试）、skill 原生解析（`skills`：`parse_skill_json`/`validate_skill_fields`/路径安全，镜像前端 `skills.ts`/`createSkill.ts`）。密钥在 keyring 内解析（`secrets::read_key`），前端只传 keyring account、绝不透传密钥；`AiEvent` 经 `Channel` 流式推送。**前端仅做展示与薄交互壳，核心逻辑已下沉 Rust（P0-P4）。** P4 收尾：`useNativeAi` 偏好开关（settings → Agents，双轨切换——默认关闭走前端 AI SDK，逐系统验证后切 Rust 原生路径）；`web_search` 前端工具薄壳化（删冗余 JS DDG 解析，直接调 Rust `web_search`）；`scripts/bench-native.mjs` 性能基准（token 估算 / 记忆召回，JS 基线 + 原生命令面）。 P2 状态系统命令面：`memory_remember` / `memory_recall` / `memory_stats`（`memory`：三层作用域 global/workspace/session 持久化到 `ai-memory.json`，召回 = 词汇打分 + CJK 2-gram + 时间衰减 + MMR + min_score，无嵌入降级为主）、`graph`（纯函数核心复现 `graph/engine.ts` 拓扑波浪调度 + `hash_graph_def` journal 断点键 + 三态审批 `decide` 级联 auto-approve/reject 记忆）、`agents`（capability_mode 交集 + 深度上限剥 task 工具 + `output_schema` 校验 + summary 预算封顶）。P3 命令面：`deep_search_start` / `deep_search_poll` / `deep_search_abort` / `deep_search_advance` / `deep_search_reserve`（`research`：L3 research harness——plan→poll 会话状态机、独立 `#dr` 预算 reserve/refund（`budget.rs`）、exact-ID 完整性校验（`verify.rs`，每个 claim_id 恰一次 verdict）、报告合成（`report.rs`））、`computer_session_open/close` + `computer_approve/revoke` + `computer_capture/action`（`modules/computer/`：Windows M1 截屏 BitBlt→PNG data-URI + 缩放预算，M2 输入注入 needsApproval + 敏感区黑名单（右上状态区）+ 动作预算 50/会话，视觉回环 fail-closed：主模型无视觉必走 aux；`safety.rs` 纯函数已测，平台层 `#[cfg(windows)]`）。
- `ai::*` 扩展（第二十九轮 27 项目横向对比补齐）：`memory_fts_search`（`memory/fts.rs` FTS5/BM25 全文检索，配合 `search_memories` 的 `mode: vector|fts|hybrid`）、`preferences_extract`/`preferences_get`（`preferences.rs` 用户偏好建模：编辑器/shell/常用工具/响应风格）、`generate_image`（`media.rs` 媒体生成：OpenAI DALL-E / Gemini / Stability，走 keyring，返回 data-URL）、`resilience_status`（`resilience.rs` Provider 熔断器状态：Closed/Open/HalfOpen + 失败/成功计数，供设置页降级链可视化）、`record_provider_success`/`record_provider_failure`/`is_provider_available`（`resilience.rs` R30 接线命令：chat 路径 fallback 时记录熔断/查询可用性，配合 TS `lib/resilience.ts` `generateTextWithFallback` 与主对话流级 fallback）。
- `net::web_fetch::*`（`web_fetch`）：**Grok grok-build 移植的网页抓取工具**——SSRF 双门控（DNS 每跳复检防 rebinding）、域名白名单（`modules/net/web_fetch/config.rs` 约 60 个开发文档域，host+path 前缀 O(1) 匹配，白名单外拒绝）、HTTPS 升级、HTML→markdown（htmd）、TTL 缓存、10MB 上限。`allow_local` 默认 false（fail-closed），仅显式 loopback 可被显式启用。**secret-in-URL 整体拒绝**（P1.5，决策点 6 对齐 Hermes）：四路检测（raw/unquote/normalized/unquote-normalized）命中 `api_key`/`token`/`secret`/`password` 等敏感 query 参数即整体拒绝 `SecretInUrl`。**抓取清洗增强**（`clean.rs`，webclaw/crw 移植）：两级 retry fallback（markdown 稀疏且原始 body 显著更大时保留原文，防导航页清洗丢信号）+ 5000 字符噪声反转护栏 + 链接密度惩罚判定（`LINK_DENSITY_THRESHOLD=0.4` 判导航/样板区）+ OG/Twitter/title 三级元数据回退。对应 AI 工具面 `fetch_url`/`web_search`（免 key DuckDuckGo）/`deep_search`（Grok deep-research 4 阶段编排），三者只读不进写路径。
- `secrets::secrets_*`：经 `keyring` crate 访问系统钥匙串。服务常量 `YaMet-ai`。Linux 用文件回退，以 `#[cfg(target_os = "linux")]` 门控。
- `gateway::*`（`modules/gateway/`）：国内 IM 网关。适配器（`adapters/*.rs`）覆盖钉钉 / 飞书 / 企微 / QQ（OneBot v11 WebSocket / go-cqhttp）/ 微信个人（iLink Bot API，二维码登录 + 长轮询）/ 公众号（回调）。`registry.rs` 持有适配器并把入站分发给 agent；`session.rs` 实施认证门禁（默认拒绝 + 按会话批准白名单 + 自动批准）。凭据落系统钥匙串（`gateway:<platform>`）并冗余存于 `gateway-creds/<platform>.json`（Windows 经 DPAPI 加密、Unix 0700/0600 属主权限）。`weixin.rs` 在会话过期时经二维码重登（`errcode -14` / 陈旧 `-2`）；`gateway_weixin_qr_login` 以 SVG data-URL 把二维码流式推给设置 UI。`agent_probe`（`shell/external_agent.rs`）检测已安装的外部 agent CLI 及版本。
- `mcp::*`（`mcp_server_add`、`mcp_server_remove`、`mcp_server_list`、`mcp_server_get`、`mcp_server_connect`、`mcp_server_disconnect`、`mcp_server_refresh`、`mcp_tool_call`、`mcp_resource_read`）：MCP（Model Context Protocol）原生 client（`modules/mcp/`）与 server 宿主（`modules/mcp_server/`）。自研 JSON-RPC 分帧 + stdio/SSE 传输，不依赖外部 `mcp` crate；会话生命周期、工具/资源注册在 Rust 侧管理。AI 子系统工具面经 `@/modules/mcp` 原生 store 接入（已删除旧 `ai/lib/mcp`）。全链路原生：无 Node/Python 常驻桥接。
- `ssh::tunnels::*`（`ssh_tunnel_start`、`ssh_tunnel_list`、`ssh_tunnel_kill`）：SSH 端口转发隧道管理（`-L`/`-R`），配合 `sftp_list`/`sftp_read`/`sftp_write`（`modules/ssh/sftp.rs`）做远程 SFTP 文件浏览与回写。命令/主机参数经 `clean_component` 校验，argv 传参无 shell 注入。
- `history::*`（`history_suggest`、`history_commands`、`history_record`、`history_list`）：命令历史记录与建议补全（`modules/history/`）。
- `agent::*`（`agent_enable_hooks`、`agent_hooks_status`）：终端 agent（Claude/Codex/Gemini/Pi/OpenCode/Grok）的 hook 启停与状态查询（`modules/agent.rs`，数据驱动 `AgentSpec`；`YAMET_TERMINAL` 门控，原子写、幂等）。
- `window::*`（`toggle_devtools`）：webview 开发者工具开关（release 下无操作，dev/devtools feature 下生效）。
- `scheduler::*`（`scheduler_list`、`scheduler_upsert`、`scheduler_delete`、`scheduler_toggle`）：定时任务调度（`modules/scheduler/`，持久化到 `data_dir/scheduler.json`）。
- `proc::stats::*`（`resource_stats`）：进程资源统计（CPU% 差分采样、内存工作集、运行时长），供状态栏资源指示器轮询；GPU 占用经前端 WebGL 上下文数呈现。
- `open_settings_window`：独立的设置 webview 窗口（可选 `tab` 参数深链到指定分区）。
- `get_launch_dir` / `get_launch_files`：返回启动时的工作目录与待打开文件（Tauri 启动参数）。

### PTY shell 集成

PTY shell 通过 `src-tauri/src/modules/pty/scripts/` 下的注入初始化脚本引导：

- **Unix**（`zshenv.zsh`、`zprofile.zsh`、`zlogin.zsh`、`zshrc.zsh`、`bashrc.bash`）用于 zsh/bash，另加 `init.fish` 安装到 `~/.config/fish/conf.d/yamet.fish` 用于 fish。发出 OSC 7（cwd）与 OSC 133 A/B/C/D（提示符边界 + 退出码），让宿主无需重解析提示符即可跟踪 cwd 与命令边界。Fish 4.0+ 自带 OSC 133 提示符标记；YaMet 设 `fish_features=no-mark-prompt` 并经 `-C` 重放自己的提示符避免重复。
- **Windows**（`profile.ps1`）：经 `pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <path>` 传入。在用户 `$PROFILE` 执行后包装其现有 `prompt` 函数，以发出 OSC 7 + OSC 133 A/B/D。shell 优先级：`pwsh.exe`（PS 7+）→ `powershell.exe`（PS 5.1）→ `cmd.exe`（无集成）。cwd 传给 ConPTY 前归一化为反斜杠（`CreateProcessW` 对正斜杠 cwd 有异常）。

`pty/shell_init.rs` 拆成 `#[cfg(unix)]` / `#[cfg(windows)]` 模块：新增平台专属代码时放在正确的 cfg 分支。

Windows 上 ConPTY 需要 `SPAWN_LOCK`（Mutex）包住 `session.rs` 里的 `openpty + spawn_command`。并发 spawn 会让其中一个 PTY 的输出管道停滞。未经快速标签连开的稳定性验证，不要移除该锁。

每个 ConPTY 子进程还挂到**作业对象**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，`pty/job.rs`）。当作业句柄释放（干净关闭、panic、甚至 YaMet 进程被 SIGKILL），内核会杀掉 shell 的所有后代（如从 pwsh 里启动的 `npm run dev`）。没有它，Windows 会因 `TerminateProcess` 只杀直接子进程而遗留整棵进程子树。macOS/Linux 依赖 `Drop for Session → killer.kill()`；`cargo run` 被 dev-`Ctrl-C` 时析构不触发，那里也可能有孤儿进程：目前可接受，仅限开发。

`AiComposerProvider` 无条件挂在 App.tsx 根部：条件包装会在密钥加载时改变父元素类型，导致整树重挂载（并在 `getAllKeys()` 解析瞬间重spawn 全部 PTY）。生产环境碰巧躲过（钥匙串读取可能与首帧同帧）；开发环境躲不过。保持无条件包装。

### 会话恢复

- 布局与每标签 cwd 恢复已交付：terminal 标签以 cold tab 持久化，激活时按原 cwd 新起 shell（`useSpacesBoot`），不 spawn PTY 直到首次激活。
- **前台进程级重连**（第十轮 I1c）：独立常驻 helper 进程持有全部 PTY 会话（`portable-pty`，Windows ConPTY 在 helper 内创建，不绑定主进程）；主进程经本地 IPC（unix socket / Windows 命名管道）控制并流式收发。启动时探测既有 helper，有则按会话 id attach，无则 spawn；主进程崩溃/被强杀后 helper 继续持有会话。参考 oh-my-pi `PtySession` 的 control/reader 双通道结构。不用 tmux：Windows 无原生 tmux，外部依赖违背跨平台对等原则。
- **buffer 快照回放**（辅助/降级）：helper 不可用时，激活标签先回放 `~/.yamet/sessions/<tab-id>.snap` 快照（`@xterm/addon-serialize`）再新起 shell，标注「会话已重连，前台进程未保留」。
- 不变量：**前台任务运行中不落快照**（OSC 133 C..D 或 `pty_has_foreground_job` 为真时不序列化；命令中途序列化会损坏 TUI，与 DormantRing 同一条不变量）。

### 前端（`src/`）

单窗口 React 应用。路径别名 `@/*` → `src/*`。标签是带标签联合（`kind`：`terminal` | `editor` | `preview` | `markdown` | `ai-diff` | `git-diff` | `git-history` | `git-commit-file`），切换时不卸载，而是用 `invisible pointer-events-none` 隐藏，让 PTY 与开发服务器持续后台流式输出。

`App.tsx` 负责把模块接线，保持协调者角色。新功能放进对应 `modules/<area>/`。

**i18n**（`lib/i18n/translations.ts`）：所有 UI 文案按键值组织并双语：简体中文为主（`zhMessages`，经 `Paths<>` 派生 `TranslationKey` 类型）+ 英文回退（`enMessages`）。键名/URL/模型名保持英文；绝不硬编码 UI 文本。组件用 `useI18n()`，模块作用域用 `tStatic()`。

### 模块布局（`src/modules/`）

每个模块自包含，经 `index.ts` 薄 barrel 导出，hooks 归到 `lib/` 下。

- **terminal/**：`TerminalStack` 通过 `useTerminalSession` + `pty-bridge` 为每标签保持一个挂载的 xterm。`osc-handlers.ts` 解析 OSC 7（含 Windows 盘符归一化：`/C:/Users/foo` → `C:/Users/foo`）与 OSC 133 标记。xterm 调色板由中心主题引擎（`modules/theme`）驱动，不是本地表。渲染槽有池化（`rendererPool.ts`，上限 5）：持有前台任务（OSC 133 C..D、agent 信号或 `pty_has_foreground_job`）的隐藏叶子保留活网格并以 `display:none` 暂停渲染；空闲隐藏叶子释放槽位但保留 buffer，仅在被抢占时懒序列化。`DormantRing`（1 MiB，溢出不清终端）只为槽位被抢占或从未绑定的叶子缓冲字节。绝不在命令中途序列化叶子：在快照上回放增量 TUI 重绘正是当初抹掉 Claude Code 的原因。
  **块终端**（`terminal/block/`）：可选的基于块的界面（`newBlockTab` / `TerminalPane blocks` 按标签切换），基于 OSC 133 A/B/C/D 把命令与输出分组为可选中块。工作区级单一 `ShellInput` 条（非每 pane 的 xterm 输入）驱动输入；`block/lib/modeMachine.ts` 跟踪提示符与运行态，`blockDecorations.ts` 渲染块，`BlockOverlay.tsx`/`BlockWatermark.tsx` 处理选中、重跑、搜索。`block/lib/inlineSuggest.ts` + `pathComplete.ts` 在条内提供 shell 建议。
- **editor/**：CodeMirror 6 栈（`EditorStack` 对应 `TerminalStack`）。`extensions.ts` 配置语言模式，支持 vim 模式。buffer 存于 LF 空间，保存时还原原 EOL（`lib/eol.ts`，多数票检测）；每文件经 per-pane compartment 检测缩进单位/制表符宽度（`lib/indent.ts`）。保存对照磁盘 mtime 做冲突检查（`fs_read_file`/`fs_write_file` 返回），不匹配则弹警告 toast 并显式覆盖，绝不静默 last-writer-wins；外部格式化保存时，仅当文档自保存快照以来未变才应用磁盘读回。超过 10 MB 给"仍然打开"（硬上限 50 MB，`force` 参数）；4 MB 以上关闭语法高亮与 LSP。编辑器标签激活时 Cmd-F 走 CodeMirror 自带搜索面板（查找/替换/正则），Ctrl-G 打开跳行；两个面板样式在 `chromeTheme.ts`。保存格式化器在 `lib/externalFormat.ts`（`FORMATTERS` 注册表：biome、prettier、ruff、rustfmt、gofmt、clang-format、shfmt、zig fmt + 自定义 `{file}` 命令模板）；`resolveFormatter` 按语言覆盖（`editorFormatterByLang`）应用在全局默认之上，全局外部默认只跑它懂的语言。diff 面板在挂载前解析语言：迟到的 compartment 重配置会让 merge 视图的删除块不高亮。AI 行内补全（`lib/autocomplete/`）随请求发送 buffer 缩进单位，并归一化响应中无歧义的 tab/空格不匹配（`normalizeIndent.ts`）；触发是 `autocompleteTrigger` 自动或手动，`editor.aiComplete` / `editor.codeComplete` 注册表快捷键（限定编辑器标签，让按键落到终端）；Tab 在 ghost 之前先接受打开的补全弹窗。多行 ghost 渲染为"首行内联 + 下方块级 widget"（绝不内联 `<br>`）；仅闭合符的行尾后缀（光标在 `fn(|)` 内）先隐藏、块后重挂，保证预览等于接受结果；带真实代码的行尾后缀把 ghost 压成一行（`capToLineSuffix`）。重复近期前缀的建议被丢弃，多行建议与闭合括号绝不从以 `;` 结尾的行开始，仅闭合符的行按上一行重缩进（`trimSuggestion`/`reindentClosers`，全部已测）。Markdown 编辑基于 GFM（`markdownLanguage` 基座），围栏代码高亮经共享懒语言注册表解析，Cmd/Ctrl+点击 URL、可点击任务复选框（`markdownExtras.ts`，全部在懒加载 markdown 块内；eager-budget 测试强制）。dotenv 文件（`.env`、`.env.*`、`*.env`）用懒加载 shell 语法。编辑器主题与应用主题解耦：`editorTheme` 偏好是 `"auto" | EditorThemeId`（默认 `"auto"`），渲染时由 `useEditorThemeExt` 经 `resolveEditorThemeId` 解析。`auto` 下编辑器跟随当前应用主题的 `editorTheme[mode]` 配对（实时，不陈旧）；显式选择则覆盖。主题 id + 标签在 `settings/store.ts`（`EDITOR_THEMES`/`EDITOR_THEME_LABELS`）；对应扩展在 `editor/lib/themes.ts`（`EDITOR_THEME_EXT`）。预构建 `@uiw` 主题 + `editor/lib/cmThemes.ts` 本地构建的（Kanagawa wave/lotus/dragon、Everforest、Dracula、Solarized、Catppuccin、Rosé Pine）经 `createTheme`（无额外依赖）。三块 CM 面（`EditorPane`、`AiDiffPane`、`GitDiffPane`）都经 `useEditorThemeExt` 读取主题。
  编辑器字号单独存为 `editorFontSize`，不影响 `terminalFontSize`。
- **explorer/**：带 Material/Catppuccin 图标的文件树（`iconResolver.ts`）、模糊搜索、键盘导航、行内重命名、右键动作。反斜杠感知的 `basename`。
- **preview/**：自动识别的开发服务器预览标签（检测到 localhost URL 时状态栏徽标建议打开）。
- **tabs/**：`useTabs` 是标签列表 + 活动 id 的事实来源。`useWorkspaceCwd` 从活动标签派生 explorer 根与新建标签的继承 cwd。`basename` 同时按 `/` 与 `\` 切分。
- **header/**：顶栏 + 行内搜索（`SearchInline` 经 `SearchTarget` 适配终端/编辑器）。`USE_CUSTOM_WINDOW_CONTROLS` 为真时渲染 `WindowControls`（Linux + Windows；macOS 用原生红绿灯）。
- **statusbar/**：底栏，`CwdBreadcrumb`（经 `pathUtils.segmentsFromCwd` 处理 Unix 路径、Windows 盘符与 home `~` 段）、AI 工具指示器。
- **shortcuts/**：按键映射注册表（`shortcuts.ts`）+ `useGlobalShortcuts`。处理器在 `App.tsx` 按 id 传入（`tab.new`、`ai.toggle`…）。跨平台 Cmd/Ctrl 用 `metaKey || ctrlKey`。
- **settings/**：设置 store（`store.ts`，`tauri-plugin-store`）、偏好 hook、设置窗口打开器。
- **sidebar/**：活动栏 + 可折叠侧面板（explorer、源码管理、git 历史）。
- **source-control/**：git status / stage / commit 面板与 diff 工作流。
- **mcp/**：MCP 服务器管理面板 + AI 工具面原生接入。`components/McpServersGroup.tsx` + `lib/store.ts`（zustand：server 增删/连接状态/工具列表）+ `lib/api.ts` 桥到 Rust `mcp_server_*`/`mcp_tool_call`/`mcp_resource_read`。AI 子系统 MCP 工具集成走该 store（已删除旧 `ai/lib/mcp`）。
- **search/**：全局搜索面板（`SearchPanel.tsx`），经 `fs_grep_interactive` 跨文件全文搜索 + 结果高亮。
- **ai/**：AI 聊天侧栏、BYOK 提供商（OpenAI/Anthropic/Google/Groq/xAI/Cerebras/OpenRouter/DeepSeek/Mistral + 本地 LM Studio/Ollama）、agentic 工作流（plans/子 agent/`YaMet.md` 项目记忆）、工具注册表（fs/编辑/grep/glob/bash/后台进程/`create_skill`）、Composer、计划模式与审批门禁。详见下文「AI 子系统」。
- **gateway/**：IM 网关前端桥（`bridge.ts`）与微信会话过期重登浮层（`WeixinReloginOverlay.tsx`，监听 platform-event）。
- **dap/**：DAP 调试面板（侧栏「调试」视图），原生增强版 session+transport 模型。`lib/api.ts` 桥到 Rust `dap_session_create/connect/disconnect/list/get` + `dap_request_send`（stdio/TCP 传输）；`components/DebugPanel.tsx` 提供适配器选择、启动/停止、状态指示、单步、调用栈/线程/变量树、Debug 输出；`lib/breakpointGutter.ts`（CodeMirror 断点 gutter：红点 + 暂停高亮、双向同步 `setBreakpoints`）注入编辑器；`lib/store.ts`（zustand `useDapStore`）持有会话与断点状态。`.yamet/launch.json` / `launch.json` / `.vscode/launch.json` 自动解析为配置下拉。
- **remote/**：远程面板（侧栏「远程」视图）。SFTP 文件浏览器（连接目标 → `sftp_list` 目录导航 → 文件经 `sftp_read` 读取为 preview）+ 端口转发隧道管理（`-L`/`-R`，`ssh_tunnel_start/list/kill`）。懒加载。
- **git-history/**：提交图轨道、refs、按提交的文件 diff。
- **lsp/**：可选的语言服务器支持，未启用时零开销（无进程、无 PATH 检查、eager bundle 里除 14.5 kB shell 外什么都没有）。状态栏徽标提供启用（发现二进制）或安装（可复制命令）入口，按语言；激活状态以 `lspActivation` 存设置 store（`enabled`/`dismissed`/未设）。`sessionManager.ts` 按（server，workspace root）建键、对打开的文档引用计数、3 分钟空闲杀掉、崩溃退避（冷却后重spawn；3 次/5 分钟 → 放弃 + 附 stderr 尾部的 toast）。资源不变量：**无根标记 → 无会话**（dirname 回退曾每目录起一个服务器、烧掉数 GB）、每服务器 4 会话硬顶、精简的按预设 `initializationOptions`（rust-analyzer：关 `cachePriming` + 有界 `lru`；tsls：`maxTsServerMemory`）。客户端是 `codemirror-languageserver` 懒加载 + 子类化（`lib/client.ts`）以补 didClose/didSave/shutdown、`textDocument/references`（Shift-F12；多结果定义与引用共用 `locationsPanel.ts` 选择器）以及该库漏掉的 publishDiagnostics 能力（没有它 tsls 不发诊断）；`lib/transport.ts` 桥到 Rust 管道并回答库忽略的 server-to-client 请求。`vscode-languageserver-protocol` 在 vite.config.ts 中别名到 4 枚举 shim（省约 117 kB）。预设：typescript、rust-analyzer、pyright、ruff、gopls 等；设置里支持自定义 stdio 服务器。多个预设可认领同一语言（pyright 与 ruff 都占 `py`）：`serverForLanguage` 优先已启用候选，启用 ruff 而 pyright 未设或被 dismiss 时，Python 路由到 ruff。WSL 工作区暂排除。
- **markdown/**：Markdown 预览渲染器（支撑 `markdown` 标签类型）。
- **workspace/**：工作区环境切换（本地 + WSL 发行版）。
- **theme/**：自定义主题引擎（无 `next-themes`）。`ThemeProvider` + `applyTheme` 写 CSS 变量；内置预设（yamet-default、claude、kanagawa、kanagawa-dragon、tokyo-night、catppuccin、rose-pine、everforest、nord、gruvbox、dracula、solarized、tide、sage、caffeine），每个可选声明 `editorTheme` 配对，供 `resolveEditorThemeId` 消费（见 editor/）。用户主题经 `customThemes.ts` + `validateTheme.ts`，可选背景图经 `bgImageStore.ts` + `SurfaceLayer`。
- **updater/**：基于 `tauri-plugin-updater` 的自动更新 UI。
- **agents/**：内置 YaMet agent 与终端编码 agent（Claude Code、Codex、Gemini CLI、Pi、OpenCode、Grok）的启动、通知与管理。顶栏启动器（`components/AgentLauncherPanel.tsx` + `lib/launcher.ts`）把各 agent 的启动命令持久化到偏好，原子构建平衡的一到四 pane 标签。共享 store（`store/agentStore.ts`：终端 `sessions` + `localAgent` + `notifications`）与共享路由（`lib/route.ts`：聚焦可见时抑制、失焦时系统通知、聚焦隐藏时应用内 Sonner toast）喂给顶栏 `NotificationBell`（管理面，YaMet agent 排第一，逐 agent 的 hook 启用行）。Toast 用 Sonner（`components/ui/sonner.tsx`），经中心引擎主题化；`lib/agentIcon.tsx` 渲染各 agent 品牌标记。终端检测在 Rust 侧（`pty/agent_detect.rs`），挂在 PTY 读线程的字节过滤器上，由 `OSC 133;C;<cmd>` 武装或自武装，发出 `yamet:agent-signal` 转换（`started`/`working`/`attention`/`finished`/`exited`），只由 OSC 序列驱动（绝不凭原始输出，重绘 TUI 不会抖动），无 agent 运行时零开销。基于 hook 的终端 agent 收敛到检测器读取的同一 `OSC 777` 标记，经 `agent_enable_hooks(agent)` / `agent_hooks_status(agent)`（`modules/agent.rs` 中数据驱动的 `AgentSpec` 用于 JSON-hook agent + YaMet 自有的 Pi 扩展；原子写、保留外部配置、幂等；以 `YAMET_TERMINAL` 门控）。OpenCode 与 Grok 用 OSC 133 进程生命周期检测但不装 attention hook。投递差异只因为 Claude 的 hook 协议能在 hook *响应*里返回终端字节：**Claude**（`~/.claude/settings.json`，`UserPromptSubmit`/`Notification`/`Stop`）经 `terminalSequence` 字段返回标记（旧式 3 字段 `notify;YaMet;<event>`）。**Codex**（`~/.codex/hooks.json`，`UserPromptSubmit`/`PermissionRequest`/`Stop`）与 **Gemini**（`~/.gemini/settings.json`，`BeforeAgent`/`Notification`/`AfterAgent`，`matcher:"*"`）做不到，所以 hook *命令*自己发 4 字段 `notify;YaMet;<agent>;<event>` 标记（Unix `printf > /dev/tty`，Windows `YaMet __yamet_notify` 经 `AttachConsole` 写 `CONOUT$`）并打印 `{}` 作为 JSON stdout 空操作（Codex 的 `Stop` 与 Gemini 都拒绝空/非 JSON stdout）。**Pi**（`~/.pi/agent/extensions/yamet-notifications.ts`）用 `agent_start`/`agent_settled` 扩展事件，把自己的具名标记直接写 stdout。带 agent 名的标记让自武装在无 preexec 时（bash/tmux/Windows）能指对 agent。YaMet agent 路径是 `ai/components/LocalAgentNotificationsBridge.tsx`，把 `chatStore.agentMeta`（`awaiting-approval`→attention，busy→idle→finished，`error`）映射进同一路由。
- **command-palette/**：模态命令面板（`CommandPalette.tsx`、`commands.ts`），动作与导航。
- **spaces/**：工作区 spaces/项目（name、root、env、color、按 space 的标签持久化）经 `useSpaces` 与 `SpaceSwitcher`。

### AI 子系统（`src/modules/ai/`）

BYOK。内置提供商（全部经 `@ai-sdk/openai-compatible`）：**DeepSeek、Mistral、OpenRouter**，外加 **OpenAI-compatible**（任意自定义 base URL，含内置 opencode-go 端点）与 **llama.cpp**（本地 GGUF 模型）。提供商列表在 `config.ts`（`PROVIDERS`）；模型注册表含 `DEFAULT_MODEL_ID` + `DEFAULT_AUTOCOMPLETE_MODEL`。`@ai-sdk/{openai,anthropic,google,xai,groq,cerebras}` 包已声明但未用，所有提供商都走 OpenAI-compatible 传输。

- **密钥存储**：OS 钥匙串（`keyring`，Rust）。前端经 `secrets_*` 命令读写。服务 `KEYRING_SERVICE = "YaMet-ai"`。绝不把密钥落盘、落设置 store 或 localStorage。
- **Agent**（`lib/agent.ts`）：`Experimental_Agent`，`stopWhen: stepCountIs(MAX_AGENT_STEPS)`，系统提示词在 `config.ts`。提供商分支在这里：保持 `Agent` / `DirectChatTransport` 形态，系统其余部分依赖 AI SDK v6 聊天语义。
- **子 agent**（`agents/registry.ts`、`agents/runSubagent.ts`）：具名子 agent，自带系统提示词与工具子集，由主 agent 经 `run_subagent` 工具调用。
- **并发 Worker 委派（第二十轮 L3）**：`runSubagent` 支持 `depth`/`parentId`/`context`（独立上下文注入，P1-2）+ summary 预算封顶（`SUBAGENT_SUMMARY_CAP`）；`tools/delegateMany.ts` 的 `delegate_many` 工具并行扇出（上限 `MAX_PARALLEL_WORKERS=4`、深度上限 `MAX_SPAWN_DEPTH=3`、per-fanout `IterationBudget` consume/refund）。`agentActivityStore` 活动卡片带 `group`/`depth`/`parentId` 供 Worker 树展示。
- **Graph 编排引擎（第二十轮 L4+H6）**：`graph/engine.ts` 前端 TS 轻量编排器（拓扑波浪调度 + Semaphore 并行 + judge 分支剪枝 + human 审批 + merge 聚合 + worker/verify 双轮），`graph/journal.ts` 断点续跑（request_hash 去重，`createStorage` 落盘），`graph/store.ts` 运行态 + 三态审批记忆，`graph/types.ts` 类型。前端 `GraphRunPanel.tsx` 节点可视化 + `tools/graph.ts` 的 `run_graph` 工具（needsApproval）。**注意：不做重 DAG（业界共识「主循环+隐式条件门+命令式委派」），本引擎是轻量编排而非 LangGraph。**
- **Loop 状态机（第二十轮 L2）**：`lib/loop.ts` phase（thinking/calling/observing/done）+ 健壮退出（opencode：`finish≠tool-calls 且无待执行工具`）+ doom-loop 检测（最近 3 条同工具同参数）；接入 `lib/agent.ts` 循环并映射到 `chatStore.agentMeta.phase/stepCount/doomLoopDetected`，ActivityStrip 展示。
- **Agent 配置 schema（第二十轮 L1）**：`lib/agents.ts` Agent 带 `mode`（subagent/primary/all）+ `hidden`；`mergeAgentOverrides`（opencode 语义：同名覆盖、`disabled:true` 删除）+ `selectablePrimaryAgents`/`selectableSubagentAgents` 过滤。
- **记忆系统（第二十轮 H7）**：`lib/transport.ts` 注入层改为**召回式**（`memoryStore.ts` `recallScore`/`recallTop` 按最新用户消息召回 top-8，替代全量拼接），注入块包 `[System note: recalled memory context]` 标记 + `scrubMemoryEcho` 清洗模型回显（防被当用户输入）；`lib/autoSettle.ts` `onTurnComplete` 回合结束自动沉淀（`source:"auto"`，去重）经 `chatRuntime.ts` 接入。
- **Skill 自动策展（第二十轮 H7 派生）**：`lib/skillCurator.ts` 生命周期状态机（archive/pin/keep，只动 agent 创建、pinned 豁免、永不删除）+ `lib/skillCuratorRunner.ts` 后台任务（每小时、inactivity 触发）；`lib/skills.ts` SkillFile 加 `agent_created/activity_ts/usage_count/archived`，`readSkillFile` 跳过 archived（非删除）。
- **审批三态（第二十轮 H3）**：`lib/approval.ts` once/always/reject + 级联 auto-approve（scope 记忆）+ reject 反馈；`graph/store.ts` + `GraphRunPanel` 的三态按钮。
- **压缩四元接口（第二十轮 L1）**：`lib/compact.ts` 拆 `shouldCompress`/`selectContext`（头尾保护区 `PROTECT_FIRST_N=3`/`PROTECT_LAST_N=6`）/`createCompressionDebouncer`（近两次省<10% 停，防抖动门）/`pruneToolResultsOnly`；`lib/agent.ts` 接入。
- **会话**（`lib/sessions.ts` + `store/chatStore.ts`）：对话组织成具名会话，经 `tauri-plugin-store` 持久化到 `YaMet-ai-sessions.json`（列表 + `activeId` + 每会话 `messages:<id>` 键）。`chatStore.ts` 维护模块级 `Map<sessionId, Chat<UIMessage>>`；`getOrCreateChat(apiKey, sessionId)` 懒构建 `Chat`，用 `hydrateSessions()`（`App.tsx` 启动时调一次）填充的水合映射播种。`AgentRunBridge` 每次变更把活动会话镜像到磁盘并自动从首条用户消息派生标题。切换 API 密钥清空 chat 映射；会话保留。第二十轮起 `SessionMeta.parentId` + `createSubSession`/`resolveRootSessionId`（cycle-safe）支持子会话 parentID 树（H2）。
- **Composer**（`lib/composer.tsx`）：React context，共享输入状态（文本、附件、语音），供停靠的 `AiInputBar` 与任何其他面使用。附件含图片、文本文件与 `selection` 类型；选区来自 `useChatStore.attachSelection(text, source)`（排空成 chip，不粘贴进 textarea），提交时包成 `<selection source="terminal|editor">…</selection>` 块。Composer 从 `agentMeta.status` 派生 `isBusy`，可在会话水合前安全挂载。
- **语音输入**：流式转写管道。从 composer 切换。
- **实时上下文桥**：`App.tsx` 调 `setLive({ getCwd, getTerminalContext, … })`，让工具读取*当前活动*终端的 cwd + 末 300 行 buffer。懒取设计，不预快照。
- **工具**（`tools/tools.ts`）：`read_file`、`list_directory`、`fs_search`、`fs_grep` 自动执行。`write_file`、`create_directory`、`rename`、`delete`、`run_command`、`shell_session_run`、`shell_bg_spawn` 置 `needsApproval: true`，AI SDK 暂停等待应用内确认卡。批准后自动发送用 `lastAssistantMessageIsCompleteWithApprovalResponses`。`lib/security.ts` 是拒绝名单，拒绝明显密钥路径（`.env*`、`.ssh/`、凭据、钥匙串目录）：**读写两侧**都生效且不可绕过。
- **编辑 diff**：AI 提议的编辑打开并排 diff 标签（`ai-diff` 类型）；写工具真正执行前逐块接受/拒绝。
- **MCP 工具面**：外部 MCP server 的 tools/resources 经原生 store（`@/modules/mcp`）接入 AI 工具集，默认审批 + 脱敏；宿主在 Rust（`mcp_server_*`），前端只做状态与参数。
- **Skill 与技能沉淀**：`create_skill` 工具把可复用流程沉淀为 `<workspace>/skills/<name>/skill.json`（YaMet 自身实现：写盘走 Rust fs + `checkWritableCanonical` 拒绝名单 + handle 校验）；内置扫描经 `lib/skills.ts` + `snippetsStore` 合并为 `builtin:true`；设置页 `SkillsSection` 可禁用/导入/重扫。技能沉淀 = agent 长任务后主动调 `create_skill`。
- **片段**：可复用提示词片段，经 composer 的 `#handle` 展示（设置在 Agents 下）。Tool-bundle 尚未实现。

### UI 约定

- **shadcn/ui** 已配置（`components.json`，style `radix-luma`，base `mist`，图标库 **hugeicons**）。原语在 `src/components/ui/`，不要手改；升级用 `pnpm dlx shadcn add`。
- **AI Elements**（Vercel）在 `src/components/ai-elements/`，来自 `components.json` 的 `@ai-elements` 注册表。同规则：重新生成而非手改；组合包装放 `modules/ai/components/`。
- **Tailwind v4**：无 `tailwind.config.*`，配置在 `src/App.css` 经 `@theme`。用 `cn()`（来自 `@/lib/utils`）。
- 动画：`motion`（Framer Motion 继任者）。可调布局：`react-resizable-panels`。
- 路径导入：一律 `@/…`，跨模块绝不用相对路径。
- 跨平台路径：任何可能来自 OSC 7、explorer 或 OS 的路径，用 `.split(/[\\/]/)` 归一化分隔符，而非 `.split("/")`。
- 前端规范路径形态是**正斜杠**。Windows 上 `homeDir()` 返回反斜杠；在边界转换（App.tsx setHome）。OSC 7 到达时已是正斜杠。规范字符串一致能避免 `useFileTree` 在 `tab.cwd` 首次到达时清树、闪烁 explorer。

### 窗口样式

- macOS：`tauri.conf.json` 里 `titleBarStyle: Overlay` + `hiddenTitle: true`（overlay 提供原生红绿灯）。
- Linux：`tauri.linux.conf.json` 里 `decorations: false` + `transparent: true`；realize 后为 GNOME/Mutter CSD 重设。
- Windows：经 `tauri.windows.conf.json` 与 Linux 相同。React 渲染自定义 `WindowControls`。

### Tauri capabilities

`src-tauri/capabilities/default.json` 是 webview 可用的插件 API 白名单。新插件（dialog、autostart、updater、window-state、store、opener、os、log 已在 `lib.rs` 接线）通常需要：
1. `Cargo.toml` 依赖
2. `lib.rs` 的 `run()` 里 `.plugin(...)` 调用
3. `default.json` 的能力条目

### 跨平台约定

- HOME / 缓存目录：用 `dirs` crate（`dirs::home_dir()`、`dirs::cache_dir()`），绝不裸用 `$HOME` / `%USERPROFILE%`。
- Shell 初始化脚本：Unix 专属逻辑用 `#[cfg(unix)]` 门控；Windows 分支在 `pty::shell_init::windows`。
- 终端输入：Enter 发 `\r`（CR），不是 `\n`（LF）：Windows PowerShell 要求 CR。

### 打包配置

- `bundle.targets: "all"`，外加 `tauri.conf.json` 里的各平台段：
  - **macOS**：`minimumSystemVersion: 10.15`。
  - **Linux**：deb 依赖 `libwebkit2gtk-4.1-0`、`libgtk-3-0`；rpm `webkit2gtk4.1`、`gtk3`；AppImage 自带媒体框架。
  - **Windows**：NSIS 安装器 `currentUser` 模式（无需管理员），WebView2 经 `downloadBootstrapper`（缺失时下载运行时；非离线内嵌）。
- 自动更新配置了公开 minisign 密钥；发布产物托管在你 fork 的发布通道（把 `tauri.conf.json` 的 updater `endpoints` 指向你的 `latest.json`）。

### 已知坑

- **React 19 严格模式**开发环境下双挂载 `useEffect` → 首帧终端 spawn 两次。第一个 PTY 几乎立刻清理。`SPAWN_LOCK` 互斥锁串行化此过程；开发日志里 `pty opened id=1` 后跟 `pty closed id=1` 不必惊慌。
- **Windows PowerShell 进程生命周期**：`portable-pty` 的 `killer.kill()` 只杀直接子进程。后代（如 pwsh 内启动的 `npm run dev`）除非有别的东西处理，否则存活。`pty/job.rs` 的作业对象处理 YaMet 进程死亡的情况；JS 显式 `pty_close` 也只杀直接子进程，其余靠作业对象。没有替代方案前不要禁用作业对象。
- **标签 `cwd` 存储**：来自 OSC 7，正斜杠（`parseOsc7` 剥掉 `/C:` → `C:` 之后）。任何消费 `tab.cwd` 并传给 Windows 上 Rust fs 命令的地方都必须归一化分隔符或同时接受两种形态：`pty::shell_init` 里的 `apply_common` 处理 PTY spawn，其他调用点要自己做。

## 延伸阅读

长文贡献者指南在 `docs/`。这些指南详述 `YaMet.md`；如有冲突，以 `YaMet.md` 为准。

- `docs/README.md`：贡献者指南索引
- `docs/architecture/two-process-model.md`：IPC 边界与命令参考
- `docs/architecture/pty-shell-integration.md`：PTY、shell 初始化脚本、OSC、ConPTY、作业对象
- `docs/architecture/security-model.md`：合并后的安全模型与边界
- `docs/architecture/ai-subsystem.md`：AI 栈、会话、工具、如何新增提供商
- `docs/architecture/terminal-renderer-pool.md`：渲染池与 DormantRing 不变量
- `docs/contributing/testing.md`：测试契约与核心子系统不变量
