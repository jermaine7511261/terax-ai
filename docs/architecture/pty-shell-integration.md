# PTY shell 集成

本指南展开说明 `YaMet.md`。如有冲突，以 `YaMet.md` 为准。

## 会话模型

一个终端标签对应一个 PTY 会话。会话活在 `PtyState`（`src-tauri/src/modules/pty/mod.rs:20`）：

```rust
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}
```

id 从 1 开始单调递增，绝不重用，前端可把 `0` 视为未设置。

`pty_open`（`mod.rs:44`）在阻塞线程上 spawn 会话、插入 map、返回 id。输出经 `Channel<Response>` 流式推送；退出码经独立 `Channel<i32>` 流式推送。`pty_write`（`mod.rs:100`）接受带 `x-pty-id` 头的原始字节，避免每次击键都 JSON 序列化。

## Reader / flusher / waiter 线程

`session::spawn`（`session.rs:102`）每会话启动三个线程：

1. **Reader**：从 PTY master 读字节，跑 DA 过滤器与 agent 检测器，把过滤后的字节推入 pending buffer。
2. **Flusher**：合并输出并经数据通道发给前端。
3. **Waiter**：等子进程退出，冲刷尾部，发出退出码。

pending buffer 上限 4 MiB；溢出时丢弃整段并替换为 SGR-reset 提示，避免被切半的 CSI 序列破坏 xterm 状态。

## Shell 引导

`shell_init::build_command`（`shell_init.rs:53`）构建用于 spawn shell 的 `CommandBuilder`。路径与参数取决于平台与所选工作区环境（本地或某 WSL 发行版）。

### Unix

集成脚本在 `src-tauri/src/modules/pty/scripts/`：

- zsh 用 `zshenv.zsh`、`zprofile.zsh`、`zlogin.zsh`、`zshrc.zsh`
- bash 用 `bashrc.bash`
- fish 用 `init.fish`，安装到 `~/.config/fish/conf.d/yamet.fish`

zsh 以 `ZDOTDIR` 指向临时目录启动，先 source 我们的脚本再 source 用户真实配置。bash 用 `--rcfile` 包一层 wrapper，在 YaMet 的脚本之后 source 用户的 `~/.bashrc`。fish 用 `conf.d`，不替换任何用户文件。

所有集成 shell 都发出 **OSC 7**（cwd）与 **OSC 133 A/B/C/D**（提示符边界与退出码），让 YaMet 无需解析用户提示符即可跟踪 cwd 与命令边界。

### Windows

Windows 上 shell 优先级：

1. `pwsh.exe`（PowerShell 7+）
2. `powershell.exe`（Windows PowerShell 5.1）
3. `cmd.exe`（无集成）

PowerShell 经以下方式加载 `profile.ps1`：

```text
pwsh -NoLogo -NoExit -ExecutionPolicy Bypass -File <profile.ps1>
```

profile 在 `$PROFILE` 运行后包装用户现有 `prompt` 函数，发出 OSC 7 + OSC 133 A/B/D。cwd 传给 ConPTY 前归一化为反斜杠，因为 `CreateProcessW` 对正斜杠有异常。

### Fish 4.0+

Fish 4.0 自带 OSC 133 提示符标记。为避免重复，YaMet 设 `fish_features=no-mark-prompt`，并在 `config.fish` 运行后经 `-C` 重放自己的提示符。

## Windows 上的并发与进程生命周期

### `CONPTY_LIFECYCLE_LOCK`

`openpty + spawn_command` 及对应的关闭由 `session.rs:71` 的静态互斥锁串行化。并发的 ConPTY 生命周期调用会弄坏新控制台，导致其 shell 不再泵输出。

### 作业对象

每个 ConPTY 子进程挂到带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Windows 作业对象（`job.rs:34`）。作业句柄释放时（干净关闭、panic、甚至 YaMet 进程被 SIGKILL），内核杀掉 shell 的所有后代。没有它，`TerminateProcess` 只杀直接子进程，pwsh 里启动的 `npm run dev` 会变孤儿。

macOS 与 Linux 上，`Drop for Session` 调 `killer.kill()`。dev 下 `cargo run` 被 `Ctrl-C` 仍可能留孤儿，因为析构不一定执行；仅限开发可接受。

## 输入与转义序列处理

### DA 过滤器

PowerShell / PSReadLine 启动时会发光标位置查询（`ESC[6n`）并阻塞等答复。`DaFilter`（`da_filter.rs`）拦截该查询并在 PTY 输入上回复，避免 shell 挂起。

### Agent 检测

reader 线程对字节流跑 `AgentDetector`（`agent_detect.rs`）。它由 `OSC 133;C;<cmd>` 武装，或由自武装的 `OSC 777` 标记触发，发出 `yamet:agent-signal` 转换（`started`、`working`、`attention`、`finished`、`exited`）。检测只由 OSC 序列驱动，绝不凭原始输出，重绘 TUI 不会抖动。

### Enter 键

终端输入发 `\r`（CR），不是 `\n`（LF）。Windows PowerShell 要求 CR。

## 不变量

- 未经快速标签连开的首标签稳定性验证，不要移除 `CONPTY_LIFECYCLE_LOCK`。
- Windows 上没有替代孤儿守卫前，不要禁用作业对象。
- 平台专属 shell 逻辑放在 `shell_init.rs` 对应的 `#[cfg(unix)]` 或 `#[cfg(windows)]` 分支。
- 传给 ConPTY 的 cwd 必须用反斜杠；到达前端的 OSC 7 cwd 是正斜杠规范形态。

## 参见

- [`YaMet.md`](../../YaMet.md)：架构事实来源
- [`docs/README.md`](../README.md)：贡献者指南索引
- [双进程模型](two-process-model.md)：IPC 边界与命令目录
- [终端渲染池](terminal-renderer-pool.md)：槽位池化与 DormantRing
