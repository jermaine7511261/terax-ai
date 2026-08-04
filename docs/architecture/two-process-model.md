# 双进程模型与 IPC 命令参考

本指南展开说明 `YAMET.md`。如有冲突，以 `YAMET.md` 为准。

## 分工

Yamet 是两个进程：Rust 后端（`src-tauri/`）与 webview 前端（`src/`）。

- **Rust 持有全部 OS 访问**：PTY、文件系统、git、shell 启动、网络、密钥、工作区授权。
- **webview 绝不直接碰 FS、进程或 shell**。每个宿主操作都经 `invoke()` 调用注册在 `src-tauri/src/lib.rs` 的命令。

这个边界是安全模型的根基。不可信输入（终端转义序列、文件内容、AI 工具结果）在 Rust 或经过仔细限定的前端代码里解析与校验，绝不由渲染器执行。

## 新增 IPC 命令

1. 在对应的 `src-tauri/src/modules/<area>/` 模块里写 `#[tauri::command]` async 函数。
2. 在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 块中注册（`src-tauri/src/lib.rs:191`）。
3. 若命令使用 Tauri 插件 API（window、clipboard、dialog 等），把插件权限加到 `src-tauri/capabilities/default.json`。
4. 在对应的 `src/modules/<area>/lib/` 目录加类型化前端包装，经 Tauri 的 `invoke()` API 调用。
5. 若命令触碰文件系统、网络或 shell，必须走既有守卫（`security.ts` 拒绝名单、工作区授权注册表、SSRF 守卫、AI 工具审批）。

自定义命令无需在 `default.json` 里逐条列出；能力覆盖整个窗口。插件权限需要。

## 命令目录

以下命令按模块分组，均注册于 `src-tauri/src/lib.rs`。名称是前端看到的 Rust 函数名。

### PTY（`src-tauri/src/modules/pty/`）

长生命周期交互式终端会话。

- `pty_open`：新建 PTY 会话
- `pty_write`：发送输入字节（文本或控制序列）
- `pty_resize`：调整 PTY 尺寸
- `pty_close` / `pty_close_all`：销毁一个或全部会话
- `pty_has_foreground_process` / `pty_has_foreground_job`：检测是否有命令在运行
- `pty_shell_name` / `pty_list_shells`：shell 检测与枚举

`pty_open` 的输出经 Tauri `Channel<PtyEvent>` 流式推送。

### 文件系统（`src-tauri/src/modules/fs/`）

#### Tree

- `list_subdirs`：列子目录
- `fs_read_dir`：读目录

#### File

- `fs_read_file`：读文件内容
- `fs_write_file`：写文件内容
- `fs_stat`：文件元数据
- `fs_canonicalize`：规范路径

#### Mutate

- `fs_create_file` / `fs_create_dir`
- `fs_rename` / `fs_delete` / `fs_copy`

#### Watch

- `fs_watch_add` / `fs_watch_remove`：文件系统变更通知

#### Search

- `fs_search`：模糊文件查找
- `fs_list_files`：递归文件列表

#### Grep

- `fs_grep`：内容搜索
- `fs_grep_interactive`：交互式内容搜索
- `fs_glob`：glob 匹配

### Git（`src-tauri/src/modules/git/`）

所有 git 命令都经工作区授权注册表门控。

- `git_resolve_repo` / `git_panel_snapshot`
- `git_status`
- `git_diff` / `git_diff_content`
- `git_stage` / `git_unstage` / `git_discard`
- `git_commit`
- `git_fetch` / `git_pull_ff_only` / `git_push`
- `git_log` / `git_show_commit` / `git_commit_files` / `git_commit_file_diff`
- `git_remote_url`
- `git_list_branches` / `git_checkout_branch`

### Shell（`src-tauri/src/modules/shell/`）

三个截然不同的面：

- `shell_run_command`：AI 工具用的一次性子 shell 执行
- `shell_session_open` / `shell_session_run` / `shell_session_close`：跨调用保留状态的持久 agent shell
- `shell_bg_spawn` / `shell_bg_logs` / `shell_bg_kill` / `shell_bg_list`：带有限环形缓冲日志捕获的后台进程

### 工作区（`src-tauri/src/modules/workspace.rs`）

- `workspace_authorize` / `workspace_current_dir`：spawn/git/AI 的 cwd 授权注册表
- `wsl_list_distros` / `wsl_default_distro` / `wsl_home`：WSL 桥

### 网络（`src-tauri/src/modules/net.rs`）

- `ai_http_request` / `ai_http_stream`：带 SSRF 守卫的 AI HTTP 代理
- `lm_ping`：本地模型 ping

### 密钥（`src-tauri/src/modules/secrets.rs`）

- `secrets_get` / `secrets_set` / `secrets_delete` / `secrets_get_all`：OS 钥匙串访问，服务 `yamet-ai`

### Agent hooks（`src-tauri/src/modules/agent.rs`）

- `agent_enable_hooks` / `agent_hooks_status`：安装/查询终端编码 agent hooks（Claude Code、Codex、Gemini CLI）

### 历史（`src-tauri/src/modules/history/`）

- `history_suggest` / `history_commands` / `history_record` / `history_list`：shell 历史集成

### 设置窗口

- `get_launch_dir`：CLI 启动目录，首次读取即清空
- `open_settings_window`：打开独立设置 webview（可选 `tab` 深链）

## 不变量

- webview 不得经上述命令之外的途径 spawn 进程、读文件或发网络请求。
- 新命令必须在 `lib.rs` 注册，并在边界加守卫（工作区认证、拒绝名单、SSRF、审批流）。
- 命令使用插件 API 时，插件权限必须加到 `src-tauri/capabilities/default.json`。

## 参见

- [`YAMET.md`](../../YAMET.md)：架构事实来源
- [`docs/README.md`](../README.md)：贡献者指南索引
- [PTY shell 集成](pty-shell-integration.md)：会话与 shell 集成如何工作
- [安全模型](security-model.md)：每条命令都必须遵守的边界
